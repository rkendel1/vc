import { newId, sha256Hex } from "../domain/canonical.ts";
import { conflict, forbidden, invalid, notFound, precondition } from "../domain/errors.ts";
import {
	CRITERION_FIELDS,
	type CriterionField,
	type CriterionView,
	type CriterionVerification,
	type FirmApproval,
	type FirmListItem,
	type FirmProfile,
	type InvestorFirm,
	type ResearchCriterion,
	type ResearchLimits,
	type ResearchReview,
	type ResearchRun,
	type ResearchSource,
	type ResearchStatus,
	type ReviewAction,
	type SourceCheck,
	RESEARCH_DISCLAIMER,
	RESEARCH_STATUSES,
} from "../domain/research.ts";
import type { Actor } from "../domain/types.ts";
import type { JevDecider } from "../jev/jev-client.ts";
import { assessCoverage } from "../research/assess.ts";
import { sourceClassFor } from "../research/classify.ts";
import { detectConflicts } from "../research/conflicts.ts";
import { crawlFirm } from "../research/crawler.ts";
import { EXTRACTOR_VERSION, checkSizeValue, criterionId, extractFromPage } from "../research/extract.ts";
import type { PageFetcher } from "../research/fetcher.ts";
import type { FirmInput, PreparedFirm } from "../research/input.ts";
import { normalizeFirmUrl } from "../research/url.ts";
import { verifiable, verifyCriterion } from "../research/verification.ts";
import { C, type InvestStore, type StoreWrite } from "../store/store.ts";

export const PIPELINE_VERSION = "invest-research-pipeline/1.0.0";

export type ResearchDeps = {
	store: InvestStore;
	jev: JevDecider;
	fetcherFor: (scopeDomain: string, limits: ResearchLimits) => PageFetcher;
	defaults: ResearchLimits;
	staleAfterDays: number;
	jevTimeoutMs: number;
};

export type ReconcileResult = { firm: InvestorFirm; action: "created" | "updated" | "unchanged" };
export type VerifySummary = { attempted: number; supported: number; notSupported: number; inconclusive: number; errors: number; skipped: "jev_not_configured" | null };

const MAX_NOTES = 20;
const RUNNING_WINDOW_MS = 15 * 60 * 1000;
const RETRYABLE_OUTCOMES = new Set(["timeout", "network_error", "http_error"]);

export function firmIdFor(workspaceId: string, canonicalDomain: string): string {
	return `firm_${sha256Hex(`${workspaceId}|${canonicalDomain}`).slice(0, 32)}`;
}

function cleanTitleToName(title: string | null, domain: string): string | null {
	if (!title) return null;
	const parts = title.split(/\s+[|–—·•:-]\s+|\s*[|–—•]\s*/).map((p) => p.trim()).filter((p) => p && !/^(home|homepage|welcome|index)$/i.test(p));
	const best = parts.find((p) => p.length >= 2 && p.length <= 60) ?? null;
	if (!best) return null;
	void domain;
	return best.replace(/[\u0000-\u001F\u007F]/g, "").slice(0, 60);
}

/**
 * Investor discovery and thesis research.
 *
 * Persistence rules: firms are keyed by a deterministic id (workspace + canonical domain), so a
 * concurrent import converges on one record. Sources, criteria, verifications, reviews and approvals
 * are immutable and written with requireAbsent. Runs move running → completed|failed (ifVersion).
 * The firm profile is updated with ifVersion and only by the newest run. Research output is never
 * written into an approval and never overwrites one.
 */
export class InvestorResearchModule {
	private readonly inflight = new Map<string, Promise<unknown>>();

	constructor(private readonly deps: ResearchDeps) {}

	private get store() {
		return this.deps.store;
	}

	// ------------------------------------------------------------------ firms

	async lookup(actor: Actor, canonicalDomain: string): Promise<InvestorFirm | null> {
		return this.store.get<InvestorFirm>(C.firms, firmIdFor(actor.workspaceId, canonicalDomain), actor.workspaceId);
	}

	async getFirm(actor: Actor, firmId: string): Promise<InvestorFirm> {
		const firm = await this.store.get<InvestorFirm>(C.firms, firmId, actor.workspaceId);
		if (!firm) throw notFound("Firm");
		return firm;
	}

	/** Creates the canonical firm, or reconciles new names, notes and URLs into the existing one without losing any. */
	async reconcile(actor: Actor, prepared: PreparedFirm | (FirmInput & { url: string })): Promise<ReconcileResult> {
		const p: PreparedFirm = "canonicalDomain" in prepared ? prepared : this.prepare(prepared);
		const id = firmIdFor(actor.workspaceId, p.canonicalDomain);
		for (let attempt = 0; attempt < 4; attempt++) {
			const existing = await this.store.get<InvestorFirm>(C.firms, id, actor.workspaceId);
			const now = this.store.now();
			if (!existing) {
				const firm: InvestorFirm = {
					id,
					workspaceId: actor.workspaceId,
					canonicalDomain: p.canonicalDomain,
					name: p.name ?? p.canonicalDomain,
					nameSource: p.name ? "input" : "domain",
					website: p.website,
					aliasUrls: [...new Set(p.urls.filter((u) => u !== p.website))].slice(0, 10),
					sourceNotes: p.notes.slice(0, MAX_NOTES),
					researchStatus: "pending",
					lastRunId: null,
					lastRunStartedAt: null,
					lastResearchedAt: null,
					currentCriterionIds: [],
					conflictCount: 0,
					sourcesChecked: 0,
					stubReasons: ["Not researched yet."],
					retryable: false,
					lastError: null,
					createdAt: now,
					createdBy: actor.principalId,
					updatedAt: now,
				};
				try {
					await this.store.commit(actor, {
						writes: [{ collection: C.firms, id, value: firm as unknown as Record<string, unknown>, create: true }],
						audit: [{ eventType: "research.firm_created", entityRef: { type: "investor_firm", id }, payload: { firmId: id, name: firm.name, domain: firm.canonicalDomain } }],
					});
				} catch (error) {
					if ((error as { code?: string }).code === "conflict") continue; // another importer created it first: reconcile into theirs
					throw error;
				}
				return { firm: (await this.store.get<InvestorFirm>(C.firms, id, actor.workspaceId))!, action: "created" };
			}
			const next: InvestorFirm = { ...existing };
			const changed: string[] = [];
			if (p.name && existing.nameSource !== "input") {
				next.name = p.name;
				next.nameSource = "input";
				changed.push("name");
			} else if (p.name && p.name !== existing.name && !existing.sourceNotes.includes(`alternate name: ${p.name}`)) {
				next.sourceNotes = [...next.sourceNotes, `alternate name: ${p.name}`];
				changed.push("alternate_name");
			}
			const aliases = [...new Set([...existing.aliasUrls, ...p.urls.filter((u) => u !== existing.website)])].slice(0, 10);
			if (aliases.length !== existing.aliasUrls.length) {
				next.aliasUrls = aliases;
				changed.push("aliasUrls");
			}
			const notes = [...new Set([...next.sourceNotes, ...p.notes])].slice(0, MAX_NOTES);
			if (notes.length !== next.sourceNotes.length) {
				next.sourceNotes = notes;
				if (!changed.includes("sourceNotes")) changed.push("sourceNotes");
			}
			if (!changed.length) return { firm: existing, action: "unchanged" };
			next.updatedAt = now;
			try {
				await this.store.commit(actor, {
					writes: [{ collection: C.firms, id, value: next as unknown as Record<string, unknown>, ifVersion: existing.__version }],
					audit: [{ eventType: "research.firm_reconciled", entityRef: { type: "investor_firm", id }, payload: { firmId: id, changed } }],
				});
			} catch (error) {
				if ((error as { code?: string }).code === "conflict") continue;
				throw error;
			}
			return { firm: (await this.store.get<InvestorFirm>(C.firms, id, actor.workspaceId))!, action: "updated" };
		}
		throw conflict("The firm record is changing too quickly; retry");
	}

	private prepare(input: FirmInput): PreparedFirm {
		const n = normalizeFirmUrl(input.url);
		return { ...n, name: input.name?.trim() || undefined, notes: input.notes ? [input.notes.trim()] : [], urls: [input.url.trim()], lines: [] };
	}

	// ------------------------------------------------------------------ research runs

	/** Records that a run has started. The run is visible (and recoverable) before any network traffic. */
	async beginRun(actor: Actor, firmId: string, limits: Partial<ResearchLimits> = {}): Promise<{ firm: InvestorFirm; run: ResearchRun }> {
		const firm = await this.getFirm(actor, firmId);
		const merged = { ...this.deps.defaults, ...limits };
		const recent = (await this.store.list<ResearchRun>(C.researchRuns, actor.workspaceId, { firmId })).find((r) => r.status === "running" && Date.parse(r.startedAt) > Date.parse(this.store.now()) - RUNNING_WINDOW_MS);
		if (recent || this.inflight.has(firmId)) throw precondition("Research for this firm is already running");
		const run: ResearchRun = {
			id: newId("rr"),
			workspaceId: actor.workspaceId,
			firmId,
			status: "running",
			startedAt: this.store.now(),
			completedAt: null,
			startedBy: actor.principalId,
			pipelineVersion: PIPELINE_VERSION,
			extractorVersion: EXTRACTOR_VERSION,
			limits: merged,
			outcome: null,
			outcomeReasons: [],
			checks: [],
			criterionIds: [],
			counts: { pagesAttempted: 0, pagesOk: 0, pagesFailed: 0, pagesBlocked: 0, newSources: 0, newCriteria: 0 },
			error: null,
		};
		await this.store.commit(actor, {
			writes: [{ collection: C.researchRuns, id: run.id, value: run as unknown as Record<string, unknown>, create: true }],
			audit: [{ eventType: "research.run_started", entityRef: { type: "research_run", id: run.id }, payload: { firmId, runId: run.id, domain: firm.canonicalDomain, limits: merged } }],
		});
		return { firm, run: (await this.store.get<ResearchRun>(C.researchRuns, run.id, actor.workspaceId))! };
	}

	/** Begin and execute a run, then verify new criteria when Jev is configured. */
	async research(actor: Actor, firmId: string, options: { limits?: Partial<ResearchLimits>; verify?: boolean } = {}): Promise<{ firm: InvestorFirm; run: ResearchRun; verification: VerifySummary }> {
		const { run } = await this.beginRun(actor, firmId, options.limits);
		return this.execute(actor, firmId, run, options.verify !== false);
	}

	/** Starts a run in this process and returns at once; used by the web refresh. */
	async startRefresh(actor: Actor, firmId: string): Promise<{ firm: InvestorFirm; run: ResearchRun }> {
		const { firm, run } = await this.beginRun(actor, firmId);
		const task = this.execute(actor, firmId, run, true)
			.catch(() => undefined)
			.finally(() => this.inflight.delete(firmId));
		this.inflight.set(firmId, task);
		return { firm, run };
	}

	async settled(): Promise<void> {
		while (this.inflight.size) await Promise.allSettled([...this.inflight.values()]);
	}

	/** Runs interrupted by a restart can never finish; mark them failed (retryable) so they are visible and not "running" forever. */
	async recoverInterrupted(workspaceIds: string[]): Promise<number> {
		let n = 0;
		for (const workspaceId of workspaceIds) {
			const actor: Actor = { principalId: "system", displayName: "system", workspaceId, permissions: [] };
			for (const run of (await this.store.list<ResearchRun>(C.researchRuns, workspaceId)).filter((r) => r.status === "running")) {
				try {
					await this.store.commit(actor, {
						writes: [{ collection: C.researchRuns, id: run.id, value: { ...run, status: "failed", completedAt: this.store.now(), error: { message: "Interrupted by a restart before it finished", retryable: true } } as unknown as Record<string, unknown>, ifVersion: run.__version }],
						audit: [{ eventType: "research.run_failed", entityRef: { type: "research_run", id: run.id }, payload: { firmId: run.firmId, runId: run.id, reason: "interrupted by restart" } }],
					});
					n++;
				} catch {
					// Someone else resolved it first.
				}
			}
		}
		return n;
	}

	private async execute(actor: Actor, firmId: string, started: ResearchRun, verify: boolean) {
		try {
			const { firm, run } = await this.crawlAndRecord(actor, firmId, started);
			const verification = verify ? await this.verifyFirm(actor, firmId) : { attempted: 0, supported: 0, notSupported: 0, inconclusive: 0, errors: 0, skipped: null };
			return { firm, run, verification };
		} catch (error) {
			await this.recordFailure(actor, firmId, started, error);
			throw error;
		}
	}

	private async crawlAndRecord(actor: Actor, firmId: string, started: ResearchRun): Promise<{ firm: InvestorFirm; run: ResearchRun }> {
		const firm0 = await this.getFirm(actor, firmId);
		const limits = started.limits;
		const fetcher = this.deps.fetcherFor(firm0.canonicalDomain, limits);
		const crawl = await crawlFirm(fetcher, firm0.website, firm0.canonicalDomain, { maxPages: limits.maxPages, maxDepth: limits.maxDepth });
		const now = this.store.now();

		const sources: ResearchSource[] = [];
		const criteria: ResearchCriterion[] = [];
		const checks: SourceCheck[] = [];
		let homeTitle: string | null = null;
		for (const page of crawl.pages) {
			const f = page.fetch;
			const text = page.parsed && f.outcome === "ok" ? page.parsed.blocks.join("\n") : null;
			const contentHash = text !== null && !page.restricted ? `sha256:${sha256Hex(text)}` : null;
			const outcome = page.restricted ? "blocked_robots" : f.outcome;
			let hostile = false;
			let excerpts: string[] = [];
			let extracted: ReturnType<typeof extractFromPage>["criteria"] = [];
			const sourceClass = sourceClassFor(page.kind, f.finalUrl);
			if (page.parsed && f.outcome === "ok" && !page.restricted) {
				const ex = extractFromPage({ kind: page.kind, sourceClass, blocks: page.parsed.blocks, url: f.finalUrl });
				hostile = ex.hostile;
				extracted = ex.criteria;
				excerpts = ex.relevantExcerpts.slice(0, 8);
				if (page.depth === 0 && page.kind === "home") homeTitle = page.parsed.title;
			}
			const id = `src_${sha256Hex([firmId, page.requestedUrl, contentHash ?? `outcome:${outcome}`, EXTRACTOR_VERSION].join("|")).slice(0, 32)}`;
			const detail = page.restricted ? "The page's robots directives (noindex/noarchive/nosnippet) ask not to be indexed or quoted; it was not stored or used." : f.detail;
			sources.push({
				id,
				workspaceId: actor.workspaceId,
				firmId,
				requestedUrl: page.requestedUrl,
				finalUrl: f.finalUrl,
				sourceClass,
				pageKind: page.kind,
				outcome,
				httpStatus: f.httpStatus,
				contentType: f.contentType,
				title: page.restricted ? null : (page.parsed?.title ?? null)?.slice(0, 200) ?? null,
				contentHash,
				excerpts,
				hostileContent: hostile,
				firstRetrievedAt: now,
				firstRunId: started.id,
				extractorVersion: EXTRACTOR_VERSION,
				detail,
			});
			checks.push({ requestedUrl: page.requestedUrl, finalUrl: f.finalUrl, sourceId: id, outcome, retrievedAt: now, depth: page.depth, attempts: f.attempts });
			for (const c of extracted) {
				criteria.push({
					...c,
					id: criterionId(firmId, id, c),
					workspaceId: actor.workspaceId,
					firmId,
					sourceId: id,
					sourceClass,
					capturedAt: now,
					runId: started.id,
					extractorVersion: EXTRACTOR_VERSION,
					method: "rules/1",
				});
			}
		}
		const thesisCriteria = criteria.filter((c) => c.assertionType === "explicit" && c.field !== "application_requirements");
		const assessment = assessCoverage(crawl, { explicit: thesisCriteria.length, observedOrInferred: criteria.filter((c) => c.assertionType !== "explicit").length });
		if (assessment.status === "no_thesis_found" && criteria.some((c) => c.assertionType === "explicit")) assessment.reasons.push("only application wording was found, which is not an investment thesis");
		const pagesOk = checks.filter((c) => c.outcome === "ok").length;
		const blocked = checks.filter((c) => ["blocked_robots", "blocked_network_policy", "auth_required", "redirect_off_domain"].includes(c.outcome)).length;
		const retryable = assessment.status === "research_incomplete" && checks.some((c) => RETRYABLE_OUTCOMES.has(c.outcome));

		for (let attempt = 0; attempt < 5; attempt++) {
			const [firm, run, approvals] = await Promise.all([this.getFirm(actor, firmId), this.store.get<ResearchRun>(C.researchRuns, started.id, actor.workspaceId), this.approvalsFor(actor, firmId)]);
			if (!run) throw notFound("Run");
			const knownSources = new Set((await Promise.all(sources.map(async (s) => ((await this.store.get(C.researchSources, s.id, actor.workspaceId)) ? s.id : null)))).filter(Boolean) as string[]);
			const knownCriteria = new Set((await Promise.all(criteria.map(async (c) => ((await this.store.get(C.researchCriteria, c.id, actor.workspaceId)) ? c.id : null)))).filter(Boolean) as string[]);
			const newSources = sources.filter((s) => !knownSources.has(s.id));
			const newCriteria = criteria.filter((c) => !knownCriteria.has(c.id));
			const criterionIds = criteria.map((c) => c.id);
			const supersededByNewer = !!firm.lastRunStartedAt && (firm.lastRunStartedAt > run.startedAt || (firm.lastRunStartedAt === run.startedAt && (firm.lastRunId ?? "") > run.id));
			const conflicts = detectConflicts(criteria, currentApprovals(approvals));
			const completedAt = this.store.now();
			const reasons = supersededByNewer ? [...assessment.reasons, "a newer run for this firm had already been recorded; this run did not replace the profile"] : assessment.reasons;
			const completed: ResearchRun = {
				...run,
				status: "completed",
				completedAt,
				outcome: assessment.status,
				outcomeReasons: reasons,
				checks,
				criterionIds,
				counts: { pagesAttempted: checks.length, pagesOk, pagesFailed: checks.length - pagesOk - blocked, pagesBlocked: blocked, newSources: newSources.length, newCriteria: newCriteria.length },
			};
			const writes: StoreWrite[] = [
				...newSources.map((s) => ({ collection: C.researchSources, id: s.id, value: s as unknown as Record<string, unknown>, create: true })),
				...newCriteria.map((c) => ({ collection: C.researchCriteria, id: c.id, value: c as unknown as Record<string, unknown>, create: true })),
				{ collection: C.researchRuns, id: run.id, value: completed as unknown as Record<string, unknown>, ifVersion: run.__version },
			];
			const audit = [{ eventType: "research.run_completed", entityRef: { type: "research_run", id: run.id }, payload: { firmId, runId: run.id, status: assessment.status, pagesOk, pagesAttempted: checks.length, newSources: newSources.length, newCriteria: newCriteria.length, superseded: supersededByNewer } }];
			let next = firm;
			if (!supersededByNewer) {
				const added = criterionIds.filter((i) => !firm.currentCriterionIds.includes(i));
				const removed = firm.currentCriterionIds.filter((i) => !criterionIds.includes(i));
				const named = firm.nameSource === "domain" ? cleanTitleToName(homeTitle, firm.canonicalDomain) : null;
				next = {
					...firm,
					...(named ? { name: named, nameSource: "page_title" as const } : {}),
					researchStatus: assessment.status,
					lastRunId: run.id,
					lastRunStartedAt: run.startedAt,
					lastResearchedAt: completedAt,
					currentCriterionIds: criterionIds,
					conflictCount: conflicts.length,
					sourcesChecked: checks.length,
					stubReasons: assessment.status === "thesis_found" ? [] : reasons,
					retryable,
					lastError: null,
					updatedAt: completedAt,
				};
				writes.push({ collection: C.firms, id: firm.id, value: next as unknown as Record<string, unknown>, ifVersion: firm.__version });
				if (firm.researchStatus !== assessment.status) audit.push({ eventType: "research.status_changed", entityRef: { type: "investor_firm", id: firm.id }, payload: { firmId, from: firm.researchStatus, to: assessment.status, runId: run.id } } as never);
				if (added.length || removed.length) audit.push({ eventType: "research.criteria_changed", entityRef: { type: "investor_firm", id: firm.id }, payload: { firmId, runId: run.id, added: added.length, removed: removed.length } } as never);
				if (conflicts.length !== firm.conflictCount) audit.push({ eventType: "research.conflicts_changed", entityRef: { type: "investor_firm", id: firm.id }, payload: { firmId, runId: run.id, from: firm.conflictCount, to: conflicts.length } } as never);
			}
			try {
				await this.store.commit(actor, { writes, audit });
			} catch (error) {
				if ((error as { code?: string }).code === "conflict") continue;
				throw error;
			}
			return { firm: (await this.store.get<InvestorFirm>(C.firms, firmId, actor.workspaceId))!, run: (await this.store.get<ResearchRun>(C.researchRuns, run.id, actor.workspaceId))! };
		}
		throw conflict("Could not record the research run after repeated concurrent updates");
	}

	private async recordFailure(actor: Actor, firmId: string, started: ResearchRun, error: unknown) {
		const message = (error instanceof Error ? error.message : "Research failed").slice(0, 300);
		for (let attempt = 0; attempt < 4; attempt++) {
			try {
				const [run, firm] = await Promise.all([this.store.get<ResearchRun>(C.researchRuns, started.id, actor.workspaceId), this.store.get<InvestorFirm>(C.firms, firmId, actor.workspaceId)]);
				if (!run || !firm || run.status !== "running") return;
				const now = this.store.now();
				const writes: StoreWrite[] = [{ collection: C.researchRuns, id: run.id, value: { ...run, status: "failed", completedAt: now, error: { message, retryable: true } } as unknown as Record<string, unknown>, ifVersion: run.__version }];
				const keepStatus = firm.researchStatus !== "pending";
				writes.push({
					collection: C.firms,
					id: firm.id,
					value: { ...firm, researchStatus: keepStatus ? firm.researchStatus : "research_incomplete", stubReasons: keepStatus ? firm.stubReasons : [`The research run failed: ${message}`], retryable: true, lastError: { message, retryable: true, at: now }, updatedAt: now } as unknown as Record<string, unknown>,
					ifVersion: firm.__version,
				});
				await this.store.commit(actor, { writes, audit: [{ eventType: "research.run_failed", entityRef: { type: "research_run", id: run.id }, payload: { firmId, runId: run.id, reason: message } }] });
				return;
			} catch (e) {
				if ((e as { code?: string }).code !== "conflict") return;
			}
		}
	}

	// ------------------------------------------------------------------ verification

	/** Asks Jev whether each current, verifiable criterion's passage supports its statement. Pending stays pending when Jev is unavailable. */
	async verifyFirm(actor: Actor, firmId: string, limit = 25): Promise<VerifySummary> {
		const summary: VerifySummary = { attempted: 0, supported: 0, notSupported: 0, inconclusive: 0, errors: 0, skipped: null };
		const firm = await this.getFirm(actor, firmId);
		if (!this.deps.jev.identity.configured) return { ...summary, skipped: "jev_not_configured" };
		const [criteria, verifications] = await Promise.all([this.store.list<ResearchCriterion>(C.researchCriteria, actor.workspaceId, { firmId }), this.store.list<CriterionVerification>(C.criterionVerifications, actor.workspaceId, { firmId })]);
		const current = new Set(firm.currentCriterionIds);
		const todo = criteria.filter((c) => current.has(c.id) && verifiable(c) && !verifications.some((v) => v.criterionId === c.id && v.passageHash === c.passageHash && v.status !== "verification_error")).slice(0, limit);
		for (const c of todo) {
			const outcome = await verifyCriterion(this.deps.jev, c, this.deps.jevTimeoutMs);
			if (outcome === "not_configured") return { ...summary, skipped: "jev_not_configured" };
			const record: CriterionVerification = { id: newId("ver"), workspaceId: actor.workspaceId, firmId, criterionId: c.id, passageHash: c.passageHash, createdAt: this.store.now(), createdBy: actor.principalId, ...outcome };
			await this.store.commit(actor, {
				writes: [{ collection: C.criterionVerifications, id: record.id, value: record as unknown as Record<string, unknown>, create: true }],
				audit: [{ eventType: "research.verification_recorded", entityRef: { type: "research_criterion", id: c.id }, payload: { firmId, criterionId: c.id, status: record.status, provider: record.jev?.provider ?? null } }],
			});
			summary.attempted++;
			if (record.status === "source_supports") summary.supported++;
			else if (record.status === "source_does_not_support") summary.notSupported++;
			else if (record.status === "inconclusive") summary.inconclusive++;
			else summary.errors++;
		}
		return summary;
	}

	// ------------------------------------------------------------------ review and approval

	async review(actor: Actor, input: { firmId: string; criterionId?: string | null; action: ReviewAction; note: string; correctedValue?: string }): Promise<ResearchReview> {
		const firm = await this.getFirm(actor, input.firmId);
		if (!["flag", "dispute", "correct", "note"].includes(input.action)) throw invalid("Unknown review action");
		const note = input.note?.trim() ?? "";
		if (!note || note.length > 2000) throw invalid("A note of 1–2000 characters is required");
		const correctedValue = input.correctedValue?.trim() || null;
		if (input.action === "correct" && (!correctedValue || correctedValue.length > 200)) throw invalid("A correction needs the corrected value (≤200 characters)");
		if (input.criterionId) {
			const criterion = await this.store.get<ResearchCriterion>(C.researchCriteria, input.criterionId, actor.workspaceId);
			if (!criterion || criterion.firmId !== firm.id) throw notFound("Criterion");
		} else if (input.action === "correct") throw invalid("A correction must name the criterion it corrects");
		const record: ResearchReview = { id: newId("rev"), workspaceId: actor.workspaceId, firmId: firm.id, criterionId: input.criterionId ?? null, action: input.action, note, correctedValue: input.action === "correct" ? correctedValue : null, createdAt: this.store.now(), createdBy: actor.principalId };
		await this.store.commit(actor, {
			writes: [{ collection: C.researchReviews, id: record.id, value: record as unknown as Record<string, unknown>, create: true }],
			audit: [{ eventType: "research.review_recorded", entityRef: { type: "investor_firm", id: firm.id }, payload: { firmId: firm.id, criterionId: record.criterionId, action: record.action, reviewId: record.id } }],
		});
		return record;
	}

	private async approvalsFor(actor: Actor, firmId: string): Promise<FirmApproval[]> {
		return (await this.store.list<FirmApproval>(C.firmApprovals, actor.workspaceId, { firmId })).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
	}

	/** An investor adopts a value as verified. Written only on an explicit human request; the research criterion it came from is untouched. */
	async approve(actor: Actor, input: { firmId: string; criterionId?: string; field?: CriterionField; polarity?: "include" | "exclude"; value?: string; minUsd?: number; maxUsd?: number; note: string }): Promise<FirmApproval> {
		if (!actor.permissions.includes("thesis.approve")) throw forbidden("Approving firm criteria needs the thesis.approve permission");
		const firm = await this.getFirm(actor, input.firmId);
		const note = input.note?.trim() ?? "";
		if (!note || note.length > 2000) throw invalid("A note of 1–2000 characters is required");
		let field: CriterionField;
		let polarity: "include" | "exclude";
		let value: string;
		let valueRange: FirmApproval["valueRange"] = null;
		if (input.criterionId) {
			const c = await this.store.get<ResearchCriterion>(C.researchCriteria, input.criterionId, actor.workspaceId);
			if (!c || c.firmId !== firm.id) throw notFound("Criterion");
			if (c.assertionType === "inferred") throw invalid("A portfolio-derived pattern is not a stated criterion; enter the value yourself if you want to approve it");
			if (c.field === "application_requirements") throw invalid("Application requirements are not investment criteria");
			if (c.polarity === "exclude") {
				const [f, ...rest] = c.value.split(":");
				field = f as CriterionField;
				value = rest.join(":");
				polarity = "exclude";
			} else {
				field = c.field;
				value = c.value;
				polarity = "include";
				valueRange = c.valueRange;
			}
		} else {
			if (!input.field || !CRITERION_FIELDS.includes(input.field) || input.field === "exclusion" || input.field === "application_requirements") throw invalid("Choose a criterion field");
			field = input.field;
			polarity = input.polarity === "exclude" ? "exclude" : "include";
			if (field === "check_size") {
				const min = input.minUsd ?? null;
				const max = input.maxUsd ?? null;
				if ((min === null && max === null) || [min, max].some((n) => n !== null && (!Number.isFinite(n) || n < 0 || n > 1e10)) || (min !== null && max !== null && min > max)) throw invalid("Check size needs a valid minimum and/or maximum in USD");
				valueRange = { minUsd: min, maxUsd: max };
				value = checkSizeValue(valueRange);
			} else {
				value = (input.value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
				if (!/^[a-z0-9_]{1,60}$/.test(value)) throw invalid("Value must be a short term such as seed or fintech");
			}
		}
		const approvals = await this.approvalsFor(actor, firm.id);
		if (currentApprovals(approvals).some((a) => a.field === field && a.polarity === polarity && a.value === value)) throw precondition("This value is already approved");
		const record: FirmApproval = { id: newId("fa"), workspaceId: actor.workspaceId, firmId: firm.id, kind: "approve", field, polarity, value, valueRange, basisCriterionId: input.criterionId ?? null, withdrawsId: null, note, createdAt: this.store.now(), createdBy: actor.principalId };
		await this.commitApproval(actor, firm, record, approvals, "firm.criterion_approved");
		return record;
	}

	async withdraw(actor: Actor, input: { firmId: string; approvalId: string; note: string }): Promise<FirmApproval> {
		if (!actor.permissions.includes("thesis.approve")) throw forbidden("Withdrawing approved criteria needs the thesis.approve permission");
		const firm = await this.getFirm(actor, input.firmId);
		const note = input.note?.trim() ?? "";
		if (!note || note.length > 2000) throw invalid("A note of 1–2000 characters is required");
		const approvals = await this.approvalsFor(actor, firm.id);
		const target = currentApprovals(approvals).find((a) => a.id === input.approvalId);
		if (!target) throw notFound("Approval");
		const record: FirmApproval = { ...target, id: newId("fa"), kind: "withdraw", withdrawsId: target.id, note, createdAt: this.store.now(), createdBy: actor.principalId };
		await this.commitApproval(actor, firm, record, approvals, "firm.criterion_withdrawn");
		return record;
	}

	private async commitApproval(actor: Actor, firm: InvestorFirm, record: FirmApproval, approvals: FirmApproval[], eventType: string) {
		for (let attempt = 0; attempt < 4; attempt++) {
			const fresh = await this.getFirm(actor, firm.id);
			const criteria = await this.store.list<ResearchCriterion>(C.researchCriteria, actor.workspaceId, { firmId: firm.id });
			const set = new Set(fresh.currentCriterionIds);
			const conflicts = detectConflicts(criteria.filter((c) => set.has(c.id)), currentApprovals([...approvals, record]));
			try {
				await this.store.commit(actor, {
					writes: [
						{ collection: C.firmApprovals, id: record.id, value: record as unknown as Record<string, unknown>, create: true },
						{ collection: C.firms, id: fresh.id, value: { ...fresh, conflictCount: conflicts.length, updatedAt: this.store.now() } as unknown as Record<string, unknown>, ifVersion: fresh.__version },
					],
					audit: [{ eventType, entityRef: { type: "investor_firm", id: firm.id }, payload: { firmId: firm.id, approvalId: record.id, field: record.field, polarity: record.polarity, value: record.value, basisCriterionId: record.basisCriterionId } }],
				});
				return;
			} catch (error) {
				if ((error as { code?: string }).code !== "conflict") throw error;
			}
		}
		throw conflict("The firm changed while saving; retry");
	}

	// ------------------------------------------------------------------ reads

	private isStale(lastResearchedAt: string | null): boolean {
		return !!lastResearchedAt && Date.parse(this.store.now()) - Date.parse(lastResearchedAt) > this.deps.staleAfterDays * 86_400_000;
	}

	async list(actor: Actor, filter: { query?: string; status?: ResearchStatus } = {}): Promise<FirmListItem[]> {
		if (filter.status && !RESEARCH_STATUSES.includes(filter.status)) throw invalid("Unknown research status");
		const [firms, criteria] = await Promise.all([this.store.list<InvestorFirm>(C.firms, actor.workspaceId), this.store.list<ResearchCriterion>(C.researchCriteria, actor.workspaceId)]);
		const byId = new Map(criteria.map((c) => [c.id, c]));
		const q = filter.query?.trim().toLowerCase();
		const out: FirmListItem[] = [];
		for (const f of firms) {
			if (filter.status && f.researchStatus !== filter.status) continue;
			const current = f.currentCriterionIds.map((i) => byId.get(i)).filter(Boolean) as ResearchCriterion[];
			if (q) {
				const hay = [f.name, f.canonicalDomain, f.website, ...current.map((c) => `${c.field} ${c.label} ${c.value}`.replace(/_/g, " "))].join(" ").toLowerCase();
				if (!q.split(/\s+/).every((t) => hay.includes(t))) continue;
			}
			out.push({
				id: f.id,
				name: f.name,
				website: f.website,
				canonicalDomain: f.canonicalDomain,
				researchStatus: f.researchStatus,
				lastResearchedAt: f.lastResearchedAt,
				conflictCount: f.conflictCount,
				sourcesChecked: f.sourcesChecked,
				stubReasons: f.stubReasons,
				criteriaCount: current.length,
				explicitCount: current.filter((c) => c.assertionType === "explicit").length,
				stale: this.isStale(f.lastResearchedAt),
				stub: f.researchStatus !== "thesis_found",
				retryable: f.retryable,
			});
		}
		return out.sort((a, b) => a.name.localeCompare(b.name));
	}

	async profile(actor: Actor, firmId: string): Promise<FirmProfile> {
		const firm = await this.getFirm(actor, firmId);
		const [runs, sources, criteria, verifications, reviews, approvals] = await Promise.all([
			this.store.list<ResearchRun>(C.researchRuns, actor.workspaceId, { firmId }),
			this.store.list<ResearchSource>(C.researchSources, actor.workspaceId, { firmId }),
			this.store.list<ResearchCriterion>(C.researchCriteria, actor.workspaceId, { firmId }),
			this.store.list<CriterionVerification>(C.criterionVerifications, actor.workspaceId, { firmId }),
			this.store.list<ResearchReview>(C.researchReviews, actor.workspaceId, { firmId }),
			this.approvalsFor(actor, firmId),
		]);
		runs.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
		const sourceById = new Map(sources.map((s) => [s.id, s]));
		const lastSeen = new Map<string, string>();
		for (const r of runs.filter((r) => r.status === "completed" && r.completedAt)) for (const id of r.criterionIds) if (!lastSeen.has(id) || r.completedAt! > lastSeen.get(id)!) lastSeen.set(id, r.completedAt!);
		const current = new Set(firm.currentCriterionIds);
		const view = (c: ResearchCriterion): CriterionView => {
			const applicable = verifiable(c);
			const latest = verifications.filter((v) => v.criterionId === c.id && v.passageHash === c.passageHash).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
			const lastConfirmedAt = lastSeen.get(c.id) ?? c.capturedAt;
			const s = sourceById.get(c.sourceId);
			return {
				...c,
				verification: applicable && latest ? latest.status : "pending",
				verificationDetail: applicable ? latest : null,
				verificationApplicable: applicable,
				freshness: this.isStale(lastConfirmedAt) ? "stale" : "fresh",
				lastConfirmedAt,
				current: current.has(c.id),
				reviews: reviews.filter((r) => r.criterionId === c.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
				source: s ? { id: s.id, requestedUrl: s.requestedUrl, finalUrl: s.finalUrl, title: s.title, pageKind: s.pageKind, firstRetrievedAt: s.firstRetrievedAt } : null,
			};
		};
		const order = { explicit: 0, observed: 1, inferred: 2 } as const;
		const views = criteria.map(view).sort((a, b) => order[a.assertionType] - order[b.assertionType] || a.field.localeCompare(b.field) || a.label.localeCompare(b.label));
		const currentViews = views.filter((v) => v.current);
		const approvedCurrent = currentApprovals(approvals);
		return {
			firm,
			stub: firm.researchStatus !== "thesis_found",
			stubStatement: stubStatement(firm),
			criteria: currentViews,
			history: views.filter((v) => !v.current),
			conflicts: detectConflicts(currentViews, approvedCurrent),
			approvals,
			approvedCurrent,
			sources: sources.sort((a, b) => b.firstRetrievedAt.localeCompare(a.firstRetrievedAt)),
			runs,
			reviews: reviews.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
			staleAfterDays: this.deps.staleAfterDays,
			stale: this.isStale(firm.lastResearchedAt),
			disclaimer: RESEARCH_DISCLAIMER,
		};
	}
}

/** The approvals in force: approve events not later withdrawn. */
export function currentApprovals(events: FirmApproval[]): FirmApproval[] {
	const withdrawn = new Set(events.filter((e) => e.kind === "withdraw").map((e) => e.withdrawsId));
	return events.filter((e) => e.kind === "approve" && !withdrawn.has(e.id));
}

export function stubStatement(firm: InvestorFirm): string | null {
	const when = firm.lastResearchedAt ? ` on ${firm.lastResearchedAt.slice(0, 10)}` : "";
	switch (firm.researchStatus) {
		case "thesis_found":
			return null;
		case "pending":
			return `${firm.name} has not been researched yet.`;
		case "no_thesis_found":
			return `The research run${when} read ${firm.sourcesChecked} public page(s) and found no explicit investment criteria. This reports only what that run established; it does not mean ${firm.name} has no investment thesis.`;
		case "research_incomplete":
			return `The research run${when} could not adequately cover ${firm.name}'s public material, so nothing can be concluded about its thesis. ${firm.retryable ? "A retry may succeed." : "A retry is unlikely to help until access changes."}`;
	}
}
