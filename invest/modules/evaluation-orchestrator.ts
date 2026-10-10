import { digestOf, sha256Hex } from "../domain/canonical.ts";
import { InvestError, invalid, notFound, precondition } from "../domain/errors.ts";
import {
	JEV_SELECTABLE_OUTCOMES,
	type Actor,
	type CriterionFinding,
	type Evaluation,
	type EvaluationManifest,
	type InvestmentCriterion,
	type JevTrace,
	type ManifestEvidence,
	type Outcome,
	type Startup,
	type ThesisVersion,
} from "../domain/types.ts";
import { PARSER } from "../ingestion/pdf-parser.ts";
import { JevError, type JevDecider } from "../jev/jev-client.ts";
import type { Logger } from "../logger.ts";
import { C, type InvestStore } from "../store/store.ts";
import { EXTRACTOR_VERSION } from "./claim-extraction.ts";
import { buildQuestion } from "./evaluation-questions.ts";
import { type EvidenceRegistryModule, projectForCriterion } from "./evidence-registry.ts";
import {
	POLICY_VERSION,
	applyReviews,
	evaluateDeterministic,
	evaluateFailed,
	evaluateHumanReview,
	evaluateSemantic,
	evaluateWithoutEvidence,
	summarize,
} from "./investment-policy.ts";

export type OrchestratorOptions = { timeoutMs: number; maxRetries: number; jevTimeoutMs: number; concurrency?: number; backoffMs?: number };

function locationOf(item: { sourceLocation: { kind: string; page?: number; reference?: string; index?: number } }, filename?: string): string {
	const loc = item.sourceLocation;
	if (loc.kind === "document") return `${filename ?? "document"}, page ${loc.page}`;
	if (loc.kind === "profile") return `startup profile, founder claim ${(loc.index ?? 0) + 1}`;
	return `reviewer: ${loc.reference}`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The evaluation deadline is enforced here, not trusted to the adapter: a call still pending at the deadline is abandoned. */
function withinDeadline<T>(work: Promise<T>, deadline: AbortSignal): Promise<T> {
	if (deadline.aborted) return Promise.reject(new JevError("timeout", "Evaluation deadline reached", false));
	return new Promise<T>((resolve, reject) => {
		const onAbort = () => reject(new JevError("timeout", "Evaluation deadline reached", false));
		deadline.addEventListener("abort", onAbort, { once: true });
		work.then(
			(v) => {
				deadline.removeEventListener("abort", onAbort);
				resolve(v);
			},
			(e) => {
				deadline.removeEventListener("abort", onAbort);
				reject(e);
			},
		);
	});
}

/**
 * Constructs Jev requests and validates results. Every evaluation is bound to a frozen manifest
 * built at start; the run reads only that manifest, so the evidence a finding cites is exactly the
 * evidence the run saw. Completion is one atomic transaction: all findings, the completed
 * evaluation and its audit event, or none of them.
 */
export class EvaluationOrchestrator {
	private readonly running = new Map<string, Promise<void>>();

	constructor(
		private readonly store: InvestStore,
		private readonly evidence: EvidenceRegistryModule,
		private readonly jev: JevDecider,
		private readonly options: OrchestratorOptions,
		private readonly logger: Logger,
	) {}

	async buildManifest(actor: Actor, startupId: string, version: ThesisVersion): Promise<EvaluationManifest> {
		const { items, contradictions, documents } = await this.evidence.views(actor, startupId);
		const names = new Map(documents.map((d) => [d.id, d.filename]));
		const active = items.filter((i) => !i.superseded);
		const evidenceItems: ManifestEvidence[] = active.map((i) => ({
			id: i.id,
			documentId: i.documentId,
			documentHash: i.sourceLocation.kind === "document" ? i.sourceLocation.documentHash : null,
			claim: i.claim,
			metric: i.metric,
			provenanceClass: i.provenance.class,
			verification: i.effectiveVerification,
			topics: i.topics,
			location: locationOf(i, i.documentId ? names.get(i.documentId) : undefined),
		}));
		const usedDocs = new Set(active.map((i) => i.documentId).filter(Boolean));
		const projections: EvaluationManifest["projections"] = {};
		const questions: EvaluationManifest["questions"] = [];
		for (const criterion of version.criteria) {
			const view = active.map((i) => ({ ...i }));
			const projection = projectForCriterion(criterion, view);
			projections[criterion.id] = projection;
			if (criterion.evaluationMode === "semantic" && projection.evidenceIds.length) {
				const projected = projection.evidenceIds.map((id) => evidenceItems.find((e) => e.id === id) as ManifestEvidence);
				const q = buildQuestion(criterion, projected);
				questions.push({
					criterionId: criterion.id,
					kind: "choice",
					instructionsDigest: q.instructionsDigest,
					options: [...JEV_SELECTABLE_OUTCOMES],
					evidenceIds: q.included,
					contextDigest: q.contextDigest,
				});
			}
		}
		return {
			schema: "invest.evaluation-manifest/1",
			thesis: { thesisId: version.thesisId, versionId: version.id, version: version.version, contentHash: version.contentHash, criteria: version.criteria, settings: version.settings },
			evidence: {
				items: evidenceItems,
				documents: documents
					.filter((d) => usedDocs.has(d.id))
					.map((d) => ({ id: d.id, contentHash: d.contentHash, ingestionStatus: d.ingestionStatus, parser: `${d.parser.name}@${d.parser.version}`, extractorVersion: d.extractorVersion }))
					.sort((a, b) => a.id.localeCompare(b.id)),
				contradictions,
				digest: digestOf({ items: evidenceItems, contradictions }),
			},
			jev: { ...this.jev.identity, timeoutMs: this.options.jevTimeoutMs, maxRetries: this.options.maxRetries },
			projections,
			questions,
			policyVersion: POLICY_VERSION,
			parser: PARSER,
			extractorVersion: EXTRACTOR_VERSION,
		};
	}

	/**
	 * Starts an evaluation of a startup against an explicitly selected thesis version. The id is
	 * derived from the caller's request key and created with a FeltDB `requireAbsent` fence, so a
	 * retried start returns the same evaluation rather than a duplicate.
	 */
	async start(actor: Actor, input: { startupId: string; thesisVersionId: string; requestKey: string; predecessorId?: string }): Promise<Evaluation> {
		if (!/^[A-Za-z0-9_-]{8,100}$/.test(input.requestKey ?? "")) throw invalid("requestKey must be 8–100 characters of letters, digits, '-' or '_'");
		const id = `eval_${sha256Hex(`${actor.workspaceId}|${input.requestKey}`).slice(0, 24)}`;
		const existing = await this.store.get<Evaluation>(C.evaluations, id, actor.workspaceId);
		if (existing) {
			if (existing.startupId !== input.startupId || existing.thesisVersionId !== input.thesisVersionId || (existing.predecessorId ?? undefined) !== input.predecessorId)
				throw new InvestError("conflict", "This request key was already used for a different evaluation");
			return existing;
		}
		const startup = await this.store.get<Startup>(C.startups, input.startupId, actor.workspaceId);
		if (!startup) throw notFound("Startup");
		const version = await this.store.get<ThesisVersion>(C.thesisVersions, input.thesisVersionId, actor.workspaceId);
		if (!version) throw notFound("Thesis version");
		const manifest = await this.buildManifest(actor, startup.id, version);
		const manifestDigest = digestOf(manifest);
		const now = this.store.now();
		const evaluation: Evaluation = {
			id,
			workspaceId: actor.workspaceId,
			startupId: startup.id,
			thesisId: version.thesisId,
			thesisVersionId: version.id,
			status: "running",
			requestKey: input.requestKey,
			predecessorId: input.predecessorId ?? null,
			manifest,
			manifestDigest,
			summary: null,
			failure: null,
			metrics: { latencyMs: null, jevCalls: 0, jevFailures: 0, jevRetries: 0, costUsd: null },
			createdAt: now,
			createdBy: actor.principalId,
			completedAt: null,
		};
		try {
			await this.store.commit(actor, {
				writes: [{ collection: C.evaluations, id, value: evaluation, create: true }],
				audit: [
					{
						eventType: input.predecessorId ? "evaluation.rerun_started" : "evaluation.started",
						entityRef: { type: "evaluation", id },
						payload: {
							startupId: startup.id,
							thesisVersionId: version.id,
							thesisVersion: version.version,
							manifestDigest,
							evidenceItems: manifest.evidence.items.length,
							predecessorId: input.predecessorId ?? null,
							jev: manifest.jev,
						},
					},
				],
			});
		} catch (error) {
			// A concurrent start with the same key won the fence; return its evaluation.
			const winner = await this.store.get<Evaluation>(C.evaluations, id, actor.workspaceId);
			if (winner) return winner;
			throw error;
		}
		const stored = (await this.store.get<Evaluation>(C.evaluations, id, actor.workspaceId)) as Evaluation;
		this.schedule(actor, stored);
		return stored;
	}

	async rerun(actor: Actor, input: { evaluationId: string; requestKey: string; thesisVersionId?: string }): Promise<Evaluation> {
		const prior = await this.get(actor, input.evaluationId);
		if (prior.status === "running") throw precondition("The evaluation is still running");
		return this.start(actor, { startupId: prior.startupId, thesisVersionId: input.thesisVersionId ?? prior.thesisVersionId, requestKey: input.requestKey, predecessorId: prior.id });
	}

	async get(actor: Actor, evaluationId: string): Promise<Evaluation> {
		const evaluation = await this.store.get<Evaluation>(C.evaluations, evaluationId, actor.workspaceId);
		if (!evaluation) throw notFound("Evaluation");
		return evaluation;
	}

	async findings(actor: Actor, evaluationId: string): Promise<CriterionFinding[]> {
		const evaluation = await this.get(actor, evaluationId);
		const findings = await this.store.list<CriterionFinding>(C.findings, actor.workspaceId, { evaluationId });
		const order = evaluation.manifest.thesis.criteria.map((c) => c.id);
		return findings.sort((a, b) => order.indexOf(a.criterionId) - order.indexOf(b.criterionId));
	}

	/** Resolves when a scheduled run settles (tests and graceful shutdown). */
	async settled(evaluationId?: string): Promise<void> {
		if (evaluationId) await this.running.get(evaluationId);
		else await Promise.all([...this.running.values()]);
	}

	private schedule(actor: Actor, evaluation: Evaluation): void {
		const run = this.run(actor, evaluation)
			.catch((error) => this.logger.error("evaluation run crashed", { evaluationId: evaluation.id, error: String(error) }))
			.finally(() => this.running.delete(evaluation.id));
		this.running.set(evaluation.id, run);
	}

	private async run(actor: Actor, evaluation: Evaluation): Promise<void> {
		const started = Date.now();
		const deadline = AbortSignal.timeout(this.options.timeoutMs);
		const manifest = evaluation.manifest;
		const items = new Map(manifest.evidence.items.map((i) => [i.id, i]));
		const metrics = { jevCalls: 0, jevFailures: 0, jevRetries: 0 };
		const findings: CriterionFinding[] = [];
		const criteria = manifest.thesis.criteria;
		let next = 0;
		const worker = async () => {
			while (next < criteria.length) {
				const criterion = criteria[next++];
				findings.push(await this.evaluateCriterion(evaluation, criterion, items, deadline, metrics));
			}
		};
		try {
			await Promise.all(Array.from({ length: Math.min(this.options.concurrency ?? 3, criteria.length) }, worker));
			const ordered = criteria.map((c) => findings.find((f) => f.criterionId === c.id) as CriterionFinding);
			const summary = summarize(applyReviews(ordered, criteria, []), criteria, manifest.thesis.settings);
			const completed: Evaluation = {
				...evaluation,
				status: "completed",
				summary,
				completedAt: this.store.now(),
				metrics: { ...metrics, latencyMs: Date.now() - started, costUsd: null },
			};
			await this.store.commit(actor, {
				writes: [
					...ordered.map((f) => ({ collection: C.findings, id: f.id, value: f, create: true })),
					{ collection: C.evaluations, id: evaluation.id, value: completed, ifVersion: evaluation.__version },
				],
				audit: [
					{
						eventType: "evaluation.completed",
						entityRef: { type: "evaluation", id: evaluation.id },
						payload: { byOutcome: summary.byOutcome, hardGates: summary.hardGates, reviewsRequired: summary.reviewsRequired, latencyMs: completed.metrics.latencyMs, ...metrics },
					},
				],
			});
		} catch (error) {
			this.logger.error("evaluation could not complete", { evaluationId: evaluation.id, error: String(error) });
			await this.markFailed(actor, evaluation, `Evaluation could not be completed: ${(error as Error)?.message ?? String(error)}`, { ...metrics, latencyMs: Date.now() - started, costUsd: null });
		}
	}

	private async markFailed(actor: Actor, evaluation: Evaluation, failure: string, metrics: Evaluation["metrics"]): Promise<void> {
		const current = await this.store.get<Evaluation>(C.evaluations, evaluation.id, evaluation.workspaceId);
		if (!current || current.status !== "running") return;
		await this.store
			.commit(actor, {
				writes: [{ collection: C.evaluations, id: current.id, value: { ...current, status: "failed", failure, metrics, completedAt: this.store.now() }, ifVersion: current.__version }],
				audit: [{ eventType: "evaluation.failed", entityRef: { type: "evaluation", id: current.id }, payload: { failure } }],
			})
			.catch((e) => this.logger.error("could not record evaluation failure", { evaluationId: current.id, error: String(e) }));
	}

	/**
	 * A run lives in process memory. After a restart, an evaluation left `running` can never finish,
	 * so it is marked failed (fenced) and can be rerun; nothing is silently resumed or duplicated.
	 */
	async recoverInterrupted(workspaceIds: string[]): Promise<number> {
		let recovered = 0;
		for (const workspaceId of workspaceIds) {
			const stuck = await this.store.list<Evaluation>(C.evaluations, workspaceId, { status: "running" });
			for (const evaluation of stuck) {
				if (this.running.has(evaluation.id)) continue;
				await this.markFailed({ principalId: "system:recovery", workspaceId, displayName: "recovery", permissions: [] }, evaluation, "Interrupted by a server restart before completion; rerun to evaluate", evaluation.metrics);
				recovered++;
			}
		}
		return recovered;
	}

	private async evaluateCriterion(
		evaluation: Evaluation,
		criterion: InvestmentCriterion,
		items: Map<string, ManifestEvidence>,
		deadline: AbortSignal,
		metrics: { jevCalls: number; jevFailures: number; jevRetries: number },
	): Promise<CriterionFinding> {
		const manifest = evaluation.manifest;
		const projection = manifest.projections[criterion.id] ?? { evidenceIds: [], missing: [] };
		const projected = projection.evidenceIds.map((id) => items.get(id)).filter((i): i is ManifestEvidence => !!i);
		const contradictions = manifest.evidence.contradictions;
		const stamp = { id: `${evaluation.id}_${criterion.id}`, workspaceId: evaluation.workspaceId, evaluationId: evaluation.id, configurationRef: evaluation.manifestDigest, createdAt: this.store.now() };

		if (criterion.evaluationMode === "deterministic") return { ...stamp, ...evaluateDeterministic(criterion, projected, projection.missing, contradictions), jev: null };
		if (criterion.evaluationMode === "human_review") return { ...stamp, ...evaluateHumanReview(criterion, projected, projection.missing, contradictions), jev: null };
		if (!projected.length) return { ...stamp, ...evaluateWithoutEvidence(criterion, projection.missing), jev: null };

		const question = buildQuestion(criterion, projected);
		const trace: JevTrace = {
			attempts: 0,
			latencyMs: 0,
			request: { kind: "choice", options: (question.request.options ?? []).map((o) => o.id), instructionsDigest: question.instructionsDigest, contextDigest: question.contextDigest, contextChars: question.request.context?.length ?? 0 },
			rawResponse: null,
			selected: null,
			error: null,
		};
		const started = Date.now();
		for (let attempt = 0; attempt <= this.options.maxRetries; attempt++) {
			if (deadline.aborted) {
				trace.error = "evaluation deadline reached";
				break;
			}
			trace.attempts++;
			metrics.jevCalls++;
			if (attempt > 0) metrics.jevRetries++;
			try {
				const { raw, response } = await withinDeadline(this.jev.decide(question.request, deadline), deadline);
				trace.rawResponse = raw;
				trace.selected = response.selectedId ?? null;
				trace.error = null;
				trace.latencyMs = Date.now() - started;
				return {
					...stamp,
					...evaluateSemantic(
						criterion,
						projected,
						projection.missing,
						contradictions,
						{ selected: response.selectedId as Outcome, probabilities: response.probabilities, confidence: response.confidence, rationale: response.rationale },
						manifest.thesis.settings,
					),
					jev: trace,
				};
			} catch (error) {
				metrics.jevFailures++;
				const jevError = error instanceof JevError ? error : new JevError("transport", String(error), false);
				trace.error = `${jevError.kind}: ${jevError.message}`;
				if (jevError.kind === "contract" && error instanceof JevError) trace.rawResponse = null;
				if (!jevError.retryable || attempt === this.options.maxRetries) break;
				await sleep((this.options.backoffMs ?? 250) * 2 ** attempt);
			}
		}
		trace.latencyMs = Date.now() - started;
		return { ...stamp, ...evaluateFailed(criterion, projected, projection.missing, contradictions, trace.error ?? "unknown error"), jev: trace };
	}

	/**
	 * Independent check of a stored evaluation: recomputes the manifest digest, the evidence digest,
	 * every projection, every question digest, and re-applies the deterministic policy to the
	 * recorded inputs and Jev answers. Any divergence is reported, never repaired.
	 */
	async verify(actor: Actor, evaluationId: string): Promise<{ ok: boolean; checks: { name: string; ok: boolean; detail: string }[] }> {
		const evaluation = await this.get(actor, evaluationId);
		const findings = await this.findings(actor, evaluationId);
		const m = evaluation.manifest;
		const checks: { name: string; ok: boolean; detail: string }[] = [];
		const check = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });
		check("manifest digest", digestOf(m) === evaluation.manifestDigest, evaluation.manifestDigest);
		check("evidence digest", digestOf({ items: m.evidence.items, contradictions: m.evidence.contradictions }) === m.evidence.digest, m.evidence.digest);
		check("policy version", m.policyVersion === POLICY_VERSION, `${m.policyVersion} (running ${POLICY_VERSION})`);
		const items = new Map(m.evidence.items.map((i) => [i.id, i]));
		if (evaluation.status === "completed") check("one finding per criterion", findings.length === m.thesis.criteria.length, `${findings.length}/${m.thesis.criteria.length}`);
		for (const criterion of m.thesis.criteria) {
			const projection = projectForCriterion(
				criterion,
				m.evidence.items.map((i) => ({ id: i.id, claim: i.claim, metric: i.metric, topics: i.topics, provenance: { class: i.provenanceClass }, effectiveVerification: i.verification }) as never),
			);
			const recorded = m.projections[criterion.id];
			check(`projection ${criterion.id}`, JSON.stringify(projection) === JSON.stringify(recorded), `${recorded?.evidenceIds.length ?? 0} items`);
			const projected = (recorded?.evidenceIds ?? []).map((id) => items.get(id)).filter((i): i is ManifestEvidence => !!i);
			const question = m.questions.find((q) => q.criterionId === criterion.id);
			if (question) {
				const rebuilt = buildQuestion(criterion, projected);
				check(`question ${criterion.id}`, rebuilt.instructionsDigest === question.instructionsDigest && rebuilt.contextDigest === question.contextDigest, question.contextDigest);
			}
			const finding = findings.find((f) => f.criterionId === criterion.id);
			if (!finding) continue;
			check(`configuration ${criterion.id}`, finding.configurationRef === evaluation.manifestDigest, finding.configurationRef);
			let expected: Outcome | null = null;
			if (criterion.evaluationMode === "deterministic") expected = evaluateDeterministic(criterion, projected, recorded.missing, m.evidence.contradictions).outcome;
			else if (criterion.evaluationMode === "human_review") expected = evaluateHumanReview(criterion, projected, recorded.missing, m.evidence.contradictions).outcome;
			else if (!projected.length) expected = evaluateWithoutEvidence(criterion, recorded.missing).outcome;
			else if (finding.jev?.selected && finding.outcome !== "evaluation_failed") {
				const raw = (finding.jev.rawResponse ?? {}) as { probabilities?: Record<string, number>; confidence?: number; rationale?: string };
				expected = evaluateSemantic(criterion, projected, recorded.missing, m.evidence.contradictions, { selected: finding.jev.selected as Outcome, probabilities: finding.uncertainty.distribution ?? undefined, confidence: raw.confidence, rationale: raw.rationale }, m.thesis.settings).outcome;
			} else expected = "evaluation_failed";
			check(`outcome ${criterion.id}`, expected === finding.outcome, `recorded ${finding.outcome}, recomputed ${expected}`);
		}
		return { ok: checks.every((c) => c.ok), checks };
	}
}
