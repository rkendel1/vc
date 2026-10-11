import { newId, sha256Hex } from "../domain/canonical.ts";
import { conflict, forbidden, invalid, notFound, precondition } from "../domain/errors.ts";
import {
	CRITERION_FIELDS,
	type CriterionField,
	type CriterionView,
	type CriterionVerification,
	type EventEvidence,
	type EventReviewState,
	type InvestmentEvent,
	type InvestmentEventView,
	type MonitoringTarget,
	type ResearchFinding,
	type ResearchHealth,
	type AttentionItem,
	type SourceState,
	type TimelineItem,
	type VerificationStatus,
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
import { type TimelineFilter, buildTimeline } from "../research/timeline.ts";
import { planRun } from "../research/plan.ts";
import { EXTRACTOR_VERSION, checkSizeValue, criterionId, extractFromPage } from "../research/extract.ts";
import type { PageFetcher } from "../research/fetcher.ts";
import type { FirmInput, PreparedFirm } from "../research/input.ts";
import { normalizeFirmUrl } from "../research/url.ts";
import { eventStatement, statementFor, verifiable, verifyStatement } from "../research/verification.ts";
import { C, type InvestStore, type StoreWrite } from "../store/store.ts";

export const PIPELINE_VERSION = "invest-research-pipeline/1.1.0";

export type ResearchDeps = {
	store: InvestStore;
	jev: JevDecider;
	fetcherFor: (scopeDomain: string, limits: ResearchLimits) => PageFetcher;
	defaults: ResearchLimits;
	staleAfterDays: number;
	/** A source not read successfully for this long is reported as stale research health. */
	staleSourceDays: number;
	/** Announcements whose date is older than this are out of scope and not recorded. */
	lookbackDays: number;
	jevTimeoutMs: number;
};

/** What a finished run means for scheduling. Delivered to the observer (the monitoring module) after every run, successful or not. */
export type RunOutcome = { firmId: string; runId: string | null; at: string; success: boolean; retryable: boolean; message: string | null };
export type RunObserver = (actor: Actor, outcome: RunOutcome) => Promise<void>;

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
	private observer: RunObserver | null = null;

	/** One observer: the monitoring module records attempts and schedules the next check from every run, however it was started. */
	setObserver(observer: RunObserver | null) {
		this.observer = observer;
	}

	private async notify(actor: Actor, outcome: RunOutcome, override?: RunObserver | null) {
		const observer = override === undefined ? this.observer : override;
		if (!observer) return;
		try {
			await observer(actor, outcome);
		} catch {
			// Scheduling bookkeeping must never turn a recorded run into a failure.
		}
	}

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
					lastSuccessAt: null,
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
			success: false,
			carriedCriterionIds: [],
			baseline: false,
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
	async research(actor: Actor, firmId: string, options: { limits?: Partial<ResearchLimits>; verify?: boolean; observer?: RunObserver | null } = {}): Promise<{ firm: InvestorFirm; run: ResearchRun; verification: VerifySummary }> {
		const { run } = await this.beginRun(actor, firmId, options.limits);
		return this.execute(actor, firmId, run, options.verify !== false, options.observer);
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

	private async execute(actor: Actor, firmId: string, started: ResearchRun, verify: boolean, observer?: RunObserver | null) {
		let recorded: { firm: InvestorFirm; run: ResearchRun };
		try {
			recorded = await this.crawlAndRecord(actor, firmId, started);
		} catch (error) {
			await this.recordFailure(actor, firmId, started, error);
			await this.notify(actor, { firmId, runId: started.id, at: this.store.now(), success: false, retryable: true, message: (error as Error)?.message?.slice(0, 300) ?? "research failed" }, observer);
			throw error;
		}
		const { firm, run } = recorded;
		await this.notify(actor, { firmId, runId: run.id, at: run.completedAt ?? this.store.now(), success: run.success, retryable: firm.retryable, message: run.success ? null : (run.outcomeReasons.find((r) => /could not be read|blocked|failed/.test(r)) ?? run.outcomeReasons[1] ?? "the homepage could not be read") }, observer);
		try {
			const verification = verify ? await this.verifyFirm(actor, firmId) : { attempted: 0, supported: 0, notSupported: 0, inconclusive: 0, errors: 0, skipped: null };
			return { firm, run, verification };
		} catch (error) {
			// The run is recorded and scheduled; only the optional Jev step failed. Report it without losing the run.
			return { firm, run, verification: { attempted: 0, supported: 0, notSupported: 0, inconclusive: 0, errors: 1, skipped: null } as VerifySummary };
		}
	}

	private async crawlAndRecord(actor: Actor, firmId: string, started: ResearchRun): Promise<{ firm: InvestorFirm; run: ResearchRun }> {
		const firm0 = await this.getFirm(actor, firmId);
		const limits = started.limits;
		const fetcher = this.deps.fetcherFor(firm0.canonicalDomain, limits);
		const crawl = await crawlFirm(fetcher, firm0.website, firm0.canonicalDomain, { maxPages: limits.maxPages, maxDepth: limits.maxDepth });
		const ws = actor.workspaceId;

		for (let attempt = 0; attempt < 5; attempt++) {
			const [firm, run, approvalEvents, states, allCriteria, existingEvents, existingEvidence, existingFindings, knownSources] = await Promise.all([
				this.getFirm(actor, firmId),
				this.store.get<ResearchRun>(C.researchRuns, started.id, ws),
				this.approvalsFor(actor, firmId),
				this.store.list<SourceState>(C.sourceStates, ws, { firmId }),
				this.store.list<ResearchCriterion>(C.researchCriteria, ws, { firmId }),
				this.store.list<InvestmentEvent>(C.investmentEvents, ws, { firmId }),
				this.store.list<EventEvidence>(C.eventEvidence, ws, { firmId }),
				this.store.list<ResearchFinding>(C.researchFindings, ws, { firmId }),
				this.store.list<ResearchSource>(C.researchSources, ws, { firmId }),
			]);
			if (!run) throw notFound("Run");
			const now = this.store.now();
			const approvals = currentApprovals(approvalEvents);
			// Baseline: nothing from this firm has ever been read successfully, so everything found is context, not news.
			const baseline = !states.some((s) => s.lastSuccessAt);
			const plan = planRun({
				workspaceId: ws,
				firm,
				runId: started.id,
				now,
				baseline,
				lookbackDays: this.deps.lookbackDays,
				crawl,
				priorStates: new Map(states.map((s) => [s.url, s])),
				allCriteria,
				previousCurrentIds: firm.currentCriterionIds,
				approvals,
				existingEvents,
				existingEvidenceIds: new Set(existingEvidence.map((e) => e.id)),
				existingFindings,
				sourceUrlById: new Map(knownSources.map((s) => [s.id, s.finalUrl])),
			});
			const knownSourceIds = new Set(knownSources.map((s) => s.id));
			const knownCriterionIds = new Set(allCriteria.map((c) => c.id));
			const newSources = plan.sources.filter((s) => !knownSourceIds.has(s.id));
			const newCriteria = plan.freshCriteria.filter((c) => !knownCriterionIds.has(c.id));
			const freshIds = plan.freshCriteria.map((c) => c.id);
			const carriedIds = plan.carriedCriteria.map((c) => c.id);
			const union = [...plan.freshCriteria, ...plan.carriedCriteria];
			const currentIds = [...freshIds, ...carriedIds];

			const assessment = assessCoverage(crawl, {
				explicit: union.filter((c) => c.assertionType === "explicit" && c.field !== "application_requirements").length,
				observedOrInferred: union.filter((c) => c.assertionType !== "explicit").length,
			});
			if (assessment.status === "no_thesis_found" && union.some((c) => c.assertionType === "explicit")) assessment.reasons.push("only application wording was found, which is not an investment thesis");
			if (carriedIds.length) assessment.reasons.push(`${carriedIds.length} criterion/criteria kept from earlier runs because their pages were not re-read this time`);
			const pagesOk = plan.checks.filter((c) => c.outcome === "ok").length;
			const blocked = plan.checks.filter((c) => ["blocked_robots", "blocked_network_policy", "auth_required", "redirect_off_domain"].includes(c.outcome)).length;
			const retryable = assessment.status === "research_incomplete" && plan.checks.some((c) => RETRYABLE_OUTCOMES.has(c.outcome));
			const supersededByNewer = !!firm.lastRunStartedAt && (firm.lastRunStartedAt > run.startedAt || (firm.lastRunStartedAt === run.startedAt && (firm.lastRunId ?? "") > run.id));
			const conflicts = detectConflicts(union, approvals);
			const completedAt = this.store.now();
			const reasons = supersededByNewer ? [...assessment.reasons, "a newer run for this firm had already been recorded; this run did not replace the profile"] : assessment.reasons;
			const findings = plan.findings.map((f) => ({ ...f, priorRunId: firm.lastRunId }));
			const completed: ResearchRun = {
				...run,
				status: "completed",
				completedAt,
				outcome: assessment.status,
				success: plan.success,
				baseline,
				carriedCriterionIds: carriedIds,
				outcomeReasons: reasons,
				checks: plan.checks,
				criterionIds: freshIds,
				counts: { pagesAttempted: plan.checks.length, pagesOk, pagesFailed: plan.checks.length - pagesOk - blocked, pagesBlocked: blocked, newSources: newSources.length, newCriteria: newCriteria.length },
			};
			const asRecord = (v: unknown) => v as Record<string, unknown>;
			const writes: StoreWrite[] = [
				...newSources.map((s) => ({ collection: C.researchSources, id: s.id, value: asRecord(s), create: true })),
				...newCriteria.map((c) => ({ collection: C.researchCriteria, id: c.id, value: asRecord(c), create: true })),
				{ collection: C.researchRuns, id: run.id, value: asRecord(completed), ifVersion: run.__version },
			];
			const audit: { eventType: string; entityRef: { type: string; id: string }; payload: Record<string, unknown> }[] = [
				{ eventType: "research.run_completed", entityRef: { type: "research_run", id: run.id }, payload: { firmId, runId: run.id, status: assessment.status, success: plan.success, baseline, pagesOk, pagesAttempted: plan.checks.length, newSources: newSources.length, newCriteria: newCriteria.length, findings: findings.length, events: plan.events.length, superseded: supersededByNewer } },
			];
			let nextFirm = firm;
			if (!supersededByNewer) {
				for (const st of plan.states) writes.push({ collection: C.sourceStates, id: st.state.id, value: asRecord(st.state), ...(st.create ? { create: true } : { ifVersion: st.priorVersion }) });
				for (const e of plan.events) writes.push({ collection: C.investmentEvents, id: e.id, value: asRecord(e), create: true });
				for (const e of plan.evidence) writes.push({ collection: C.eventEvidence, id: e.id, value: asRecord(e), create: true });
				for (const f of findings) writes.push({ collection: C.researchFindings, id: f.id, value: asRecord(f), create: true });
				for (const f of findings) audit.push({ eventType: "research.finding_created", entityRef: { type: "research_finding", id: f.id }, payload: { firmId, findingId: f.id, runId: run.id, kind: f.kind, severity: f.severity, version: f.version } });
				for (const e of plan.events) audit.push({ eventType: "research.event_discovered", entityRef: { type: "investment_event", id: e.id }, payload: { firmId, eventId: e.id, runId: run.id, company: e.companyName, type: e.type, classification: e.classification, baseline: e.baseline } });
				for (const c of plan.corroborations) audit.push({ eventType: "research.event_corroborated", entityRef: { type: "investment_event", id: c.eventId }, payload: { firmId, eventId: c.eventId, evidenceId: c.evidenceId, runId: run.id } });
				const added = currentIds.filter((x) => !firm.currentCriterionIds.includes(x));
				const removed = firm.currentCriterionIds.filter((x) => !currentIds.includes(x));
				const named = firm.nameSource === "domain" ? cleanTitleToName(plan.homeTitle, firm.canonicalDomain) : null;
				nextFirm = {
					...firm,
					...(named ? { name: named, nameSource: "page_title" as const } : {}),
					researchStatus: assessment.status,
					lastRunId: run.id,
					lastRunStartedAt: run.startedAt,
					lastResearchedAt: completedAt,
					lastSuccessAt: plan.success ? completedAt : firm.lastSuccessAt,
					currentCriterionIds: currentIds,
					conflictCount: conflicts.length,
					sourcesChecked: plan.checks.length,
					stubReasons: assessment.status === "thesis_found" ? [] : reasons,
					retryable,
					lastError: null,
					updatedAt: completedAt,
				};
				writes.push({ collection: C.firms, id: firm.id, value: asRecord(nextFirm), ifVersion: firm.__version });
				if (firm.researchStatus !== assessment.status) audit.push({ eventType: "research.status_changed", entityRef: { type: "investor_firm", id: firm.id }, payload: { firmId, from: firm.researchStatus, to: assessment.status, runId: run.id } });
				if (added.length || removed.length) audit.push({ eventType: "research.criteria_changed", entityRef: { type: "investor_firm", id: firm.id }, payload: { firmId, runId: run.id, added: added.length, removed: removed.length } });
				if (conflicts.length !== firm.conflictCount) audit.push({ eventType: "research.conflicts_changed", entityRef: { type: "investor_firm", id: firm.id }, payload: { firmId, runId: run.id, from: firm.conflictCount, to: conflicts.length } });
			}
			try {
				await this.store.commit(actor, { writes, audit });
			} catch (error) {
				if ((error as { code?: string }).code === "conflict") continue;
				throw error;
			}
			return { firm: (await this.store.get<InvestorFirm>(C.firms, firmId, ws))!, run: (await this.store.get<ResearchRun>(C.researchRuns, run.id, ws))! };
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

	/** Asks Jev whether each current, verifiable criterion's and event's passage supports its statement. Pending stays pending when Jev is unavailable. */
	async verifyFirm(actor: Actor, firmId: string, limit = 25): Promise<VerifySummary> {
		const summary: VerifySummary = { attempted: 0, supported: 0, notSupported: 0, inconclusive: 0, errors: 0, skipped: null };
		const firm = await this.getFirm(actor, firmId);
		if (!this.deps.jev.identity.configured) return { ...summary, skipped: "jev_not_configured" };
		const ws = actor.workspaceId;
		const [criteria, verifications, events, evidence] = await Promise.all([
			this.store.list<ResearchCriterion>(C.researchCriteria, ws, { firmId }),
			this.store.list<CriterionVerification>(C.criterionVerifications, ws, { firmId }),
			this.store.list<InvestmentEvent>(C.investmentEvents, ws, { firmId }),
			this.store.list<EventEvidence>(C.eventEvidence, ws, { firmId }),
		]);
		const current = new Set(firm.currentCriterionIds);
		const conclusive = (v: CriterionVerification) => v.status !== "verification_error";
		type Job = { criterionId: string | null; eventId: string | null; passageHash: string; statement: string; passage: string; name?: string };
		const jobs: Job[] = [];
		for (const c of criteria.filter((x) => current.has(x.id) && verifiable(x) && !verifications.some((v) => v.criterionId === x.id && v.passageHash === x.passageHash && conclusive(v)))) jobs.push({ criterionId: c.id, eventId: null, passageHash: c.passageHash, statement: statementFor(c), passage: c.passage });
		for (const e of events.filter((x) => x.type !== "portfolio_addition")) {
			const first = evidence.filter((x) => x.eventId === e.id).sort((a, b) => a.discoveredAt.localeCompare(b.discoveredAt))[0];
			if (!first || verifications.some((v) => v.eventId === e.id && v.passageHash === first.passageHash && conclusive(v))) continue;
			jobs.push({ criterionId: null, eventId: e.id, passageHash: first.passageHash, statement: eventStatement(e), passage: first.passage, name: e.companyName });
		}
		for (const job of jobs.slice(0, limit)) {
			const outcome = await verifyStatement(this.deps.jev, job.statement, job.passage, this.deps.jevTimeoutMs, job.name);
			if (outcome === "not_configured") return { ...summary, skipped: "jev_not_configured" };
			const record: CriterionVerification = { id: newId("ver"), workspaceId: ws, firmId, criterionId: job.criterionId, eventId: job.eventId, passageHash: job.passageHash, createdAt: this.store.now(), createdBy: actor.principalId, ...outcome };
			await this.store.commit(actor, {
				writes: [{ collection: C.criterionVerifications, id: record.id, value: record as unknown as Record<string, unknown>, create: true }],
				audit: [{ eventType: "research.verification_recorded", entityRef: { type: job.eventId ? "investment_event" : "research_criterion", id: (job.eventId ?? job.criterionId)! }, payload: { firmId, criterionId: job.criterionId, eventId: job.eventId, status: record.status, provider: record.jev?.provider ?? null } }],
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

	async review(actor: Actor, input: { firmId: string; criterionId?: string | null; eventId?: string | null; findingId?: string | null; action: ReviewAction; note: string; correctedValue?: string }): Promise<ResearchReview> {
		const firm = await this.getFirm(actor, input.firmId);
		if (!["flag", "dispute", "correct", "note", "confirm", "dismiss"].includes(input.action)) throw invalid("Unknown review action");
		const note = input.note?.trim() ?? "";
		if (!note || note.length > 2000) throw invalid("A note of 1–2000 characters is required");
		const correctedValue = input.correctedValue?.trim() || null;
		if (input.action === "correct" && (!correctedValue || correctedValue.length > 200)) throw invalid("A correction needs the corrected value (≤200 characters)");
		const subjects = [input.criterionId, input.eventId, input.findingId].filter(Boolean);
		if (subjects.length > 1) throw invalid("A review concerns one criterion, event or finding");
		if (input.criterionId) {
			const criterion = await this.store.get<ResearchCriterion>(C.researchCriteria, input.criterionId, actor.workspaceId);
			if (!criterion || criterion.firmId !== firm.id) throw notFound("Criterion");
		} else if (input.eventId) {
			const event = await this.store.get<InvestmentEvent>(C.investmentEvents, input.eventId, actor.workspaceId);
			if (!event || event.firmId !== firm.id) throw notFound("Event");
		} else if (input.findingId) {
			const finding = await this.store.get<ResearchFinding>(C.researchFindings, input.findingId, actor.workspaceId);
			if (!finding || finding.firmId !== firm.id) throw notFound("Finding");
		} else if (input.action === "correct" || input.action === "confirm" || input.action === "dismiss") throw invalid(`${input.action} must name what it concerns`);
		const record: ResearchReview = { id: newId("rev"), workspaceId: actor.workspaceId, firmId: firm.id, criterionId: input.criterionId ?? null, eventId: input.eventId ?? null, findingId: input.findingId ?? null, action: input.action, note, correctedValue: input.action === "correct" ? correctedValue : null, createdAt: this.store.now(), createdBy: actor.principalId };
		await this.store.commit(actor, {
			writes: [{ collection: C.researchReviews, id: record.id, value: record as unknown as Record<string, unknown>, create: true }],
			audit: [{ eventType: "research.review_recorded", entityRef: { type: "investor_firm", id: firm.id }, payload: { firmId: firm.id, criterionId: record.criterionId, eventId: record.eventId, findingId: record.findingId, action: record.action, reviewId: record.id } }],
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

	private isStale(lastSuccessAt: string | null): boolean {
		return !!lastSuccessAt && Date.parse(this.store.now()) - Date.parse(lastSuccessAt) > this.deps.staleAfterDays * 86_400_000;
	}

	async list(actor: Actor, filter: { query?: string; status?: ResearchStatus } = {}): Promise<FirmListItem[]> {
		if (filter.status && !RESEARCH_STATUSES.includes(filter.status)) throw invalid("Unknown research status");
		const [firms, criteria, targets] = await Promise.all([this.store.list<InvestorFirm>(C.firms, actor.workspaceId), this.store.list<ResearchCriterion>(C.researchCriteria, actor.workspaceId), this.store.list<MonitoringTarget>(C.monitoringTargets, actor.workspaceId)]);
		const byId = new Map(criteria.map((c) => [c.id, c]));
		const targetByFirm = new Map(targets.map((t) => [t.firmId, t]));
		const q = filter.query?.trim().toLowerCase();
		const out: FirmListItem[] = [];
		for (const f of firms) {
			if (filter.status && f.researchStatus !== filter.status) continue;
			const current = f.currentCriterionIds.map((i) => byId.get(i)).filter(Boolean) as ResearchCriterion[];
			if (q) {
				const hay = [f.name, f.canonicalDomain, f.website, ...current.map((c) => `${c.field} ${c.label} ${c.value}`.replace(/_/g, " "))].join(" ").toLowerCase();
				if (!q.split(/\s+/).every((t) => hay.includes(t))) continue;
			}
			const t = targetByFirm.get(f.id);
			out.push({
				id: f.id,
				name: f.name,
				website: f.website,
				canonicalDomain: f.canonicalDomain,
				researchStatus: f.researchStatus,
				lastResearchedAt: f.lastResearchedAt,
				lastSuccessAt: f.lastSuccessAt,
				conflictCount: f.conflictCount,
				sourcesChecked: f.sourcesChecked,
				stubReasons: f.stubReasons,
				criteriaCount: current.length,
				explicitCount: current.filter((c) => c.assertionType === "explicit").length,
				stale: this.isStale(f.lastSuccessAt ?? f.lastResearchedAt),
				stub: f.researchStatus !== "thesis_found",
				retryable: f.retryable,
				monitoring: t ? { enabled: t.enabled, intervalMinutes: t.intervalMinutes, nextCheckAt: t.nextCheckAt, lastAttemptAt: t.lastAttemptAt, lastSuccessAt: t.lastSuccessAt, consecutiveFailures: t.consecutiveFailures, running: !!t.lease && Date.parse(t.lease.expiresAt) > Date.parse(this.store.now()) } : null,
			});
		}
		return out.sort((a, b) => a.name.localeCompare(b.name));
	}

	async timeline(actor: Actor, firmId: string, filter: TimelineFilter = {}): Promise<TimelineItem[]> {
		return buildTimeline(await this.profile(actor, firmId), filter);
	}

	async profile(actor: Actor, firmId: string): Promise<FirmProfile> {
		const firm = await this.getFirm(actor, firmId);
		const ws = actor.workspaceId;
		const [runs, sources, criteria, verifications, reviews, approvals, target, states, events, evidence, findings] = await Promise.all([
			this.store.list<ResearchRun>(C.researchRuns, ws, { firmId }),
			this.store.list<ResearchSource>(C.researchSources, ws, { firmId }),
			this.store.list<ResearchCriterion>(C.researchCriteria, ws, { firmId }),
			this.store.list<CriterionVerification>(C.criterionVerifications, ws, { firmId }),
			this.store.list<ResearchReview>(C.researchReviews, ws, { firmId }),
			this.approvalsFor(actor, firmId),
			this.store.get<MonitoringTarget>(C.monitoringTargets, firmId, ws),
			this.store.list<SourceState>(C.sourceStates, ws, { firmId }),
			this.store.list<InvestmentEvent>(C.investmentEvents, ws, { firmId }),
			this.store.list<EventEvidence>(C.eventEvidence, ws, { firmId }),
			this.store.list<ResearchFinding>(C.researchFindings, ws, { firmId }),
		]);
		runs.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
		const sourceById = new Map(sources.map((s) => [s.id, s]));
		const lastSeen = new Map<string, string>();
		for (const r of runs.filter((r) => r.status === "completed" && r.completedAt)) for (const id of r.criterionIds) if (!lastSeen.has(id) || r.completedAt! > lastSeen.get(id)!) lastSeen.set(id, r.completedAt!);
		const current = new Set(firm.currentCriterionIds);
		const carried = new Set(runs.find((r) => r.status === "completed" && r.id === firm.lastRunId)?.carriedCriterionIds ?? []);
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
				carriedForward: carried.has(c.id),
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
		const eventViews = events
			.map((e): InvestmentEventView => {
				const ev = evidence.filter((x) => x.eventId === e.id).sort((a, b) => a.discoveredAt.localeCompare(b.discoveredAt));
				const rv = reviews.filter((r) => r.eventId === e.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
				const first = ev[0];
				const vlatest = verifications.filter((v) => v.eventId === e.id && (!first || v.passageHash === first.passageHash)).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
				const published = ev.map((x) => x.publishedAt).filter(Boolean).sort() as string[];
				return {
					...e,
					earliestPublishedAt: published[0] ?? e.earliestPublishedAt,
					announcedAt: e.announcedAt ?? (ev.map((x) => x.announcedAt).filter(Boolean).sort()[0] as string | undefined) ?? null,
					type: e.type === "new_investment" ? (ev.find((x) => x.type !== "new_investment" && x.type !== "portfolio_addition")?.type ?? e.type) : e.type,
					round: e.round ?? ev.find((x) => x.round)?.round ?? null,
					roundAmountUsd: e.roundAmountUsd ?? ev.find((x) => x.roundAmountUsd !== null)?.roundAmountUsd ?? null,
					firmAmountUsd: e.firmAmountUsd ?? ev.find((x) => x.firmAmountUsd !== null)?.firmAmountUsd ?? null,
					amountSourceStated: e.amountSourceStated || ev.some((x) => x.roundAmountUsd !== null || x.firmAmountUsd !== null),
					evidence: ev,
					reviews: rv,
					reviewState: reviewStateOf(rv, e.involvement === "implied_by_source" || e.companyMatch.status === "uncertain" ? "needs_review" : "unreviewed"),
					verification: e.type === "portfolio_addition" ? "pending" : (vlatest?.status ?? "pending"),
					verificationDetail: vlatest,
					corroborated: new Set(ev.map((x) => x.sourceId)).size > 1,
				};
			})
			.sort((a, b) => b.discoveredAt.localeCompare(a.discoveredAt));
		const findingViews = findings
			.map((f) => {
				const rv = reviews.filter((r) => r.findingId === f.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
				const crits = f.newCriterionIds.map((id) => views.find((v) => v.id === id)).filter(Boolean) as CriterionView[];
				const verification: VerificationStatus = !crits.length ? "pending" : crits.every((c) => c.verification === "source_supports") ? "source_supports" : crits.some((c) => c.verification === "source_does_not_support") ? "source_does_not_support" : crits.some((c) => c.verification === "verification_error") ? "verification_error" : crits.some((c) => c.verification === "inconclusive") ? "inconclusive" : "pending";
				return { ...f, reviews: rv, reviewState: reviewStateOf(rv, f.reviewRequired ? "needs_review" : "unreviewed"), verification };
			})
			.sort((a, b) => b.discoveredAt.localeCompare(a.discoveredAt) || b.version - a.version);
		const staleDays = this.deps.staleSourceDays;
		const nowMs = Date.parse(this.store.now());
		const staleSources = states.filter((s) => s.status !== "present" || !s.lastSuccessAt || nowMs - Date.parse(s.lastSuccessAt) > staleDays * 86_400_000).map((s) => ({ url: s.url, lastSuccessAt: s.lastSuccessAt, status: s.status }));
		const lastSuccessAt = firm.lastSuccessAt;
		const health: ResearchHealth = {
			lastAttemptAt: target?.lastAttemptAt ?? firm.lastResearchedAt,
			lastSuccessAt,
			consecutiveFailures: target?.consecutiveFailures ?? 0,
			failing: (target?.consecutiveFailures ?? 0) >= 3,
			stale: lastSuccessAt ? nowMs - Date.parse(lastSuccessAt) > staleDays * 86_400_000 : firm.researchStatus !== "pending",
			staleSources,
			inaccessibleSources: states.filter((s) => s.status === "inaccessible").length,
			missingSources: states.filter((s) => s.status === "missing").length,
		};
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
			stale: this.isStale(lastSuccessAt ?? firm.lastResearchedAt),
			monitoring: target,
			events: eventViews,
			findings: findingViews,
			health,
			disclaimer: RESEARCH_DISCLAIMER,
		};
	}
}

/** What a person last decided about an item. `note` and `flag` do not close it; confirm/dismiss/dispute do. */
export function reviewStateOf(reviews: ResearchReview[], fallback: EventReviewState): EventReviewState {
	const decisive = reviews.find((r) => r.action === "confirm" || r.action === "dismiss" || r.action === "dispute" || r.action === "flag");
	if (!decisive) return fallback;
	return decisive.action === "confirm" ? "confirmed" : decisive.action === "dismiss" ? "dismissed" : decisive.action === "dispute" ? "disputed" : "needs_review";
}

export type { TimelineFilter };

/** What needs a person, across the workspace, each item exactly once and in one category. Items come from persisted records with deterministic ids, so repeated runs never raise the same item twice. No delivery channel exists yet: this is the attention list the UI reads. */
export async function attentionFor(research: InvestorResearchModule, actor: Actor): Promise<AttentionItem[]> {
	const out: AttentionItem[] = [];
	for (const f of await research.list(actor)) {
		const p = await research.profile(actor, f.id);
		const seen = new Set<string>();
		const add = (kind: AttentionItem["kind"], title: string, at: string, refId: string) => {
			if (seen.has(refId)) return;
			seen.add(refId);
			out.push({ firmId: f.id, firmName: f.name, kind, title, at, refId });
		};
		const latest = new Map<string, (typeof p.findings)[number]>();
		for (const x of p.findings) if (!latest.has(x.subjectKey) || latest.get(x.subjectKey)!.version < x.version) latest.set(x.subjectKey, x);
		const baseline = new Set(p.runs.filter((r) => r.baseline).map((r) => r.id));
		for (const x of latest.values()) if (x.severity === "material" && !baseline.has(x.runId) && (x.reviewState === "needs_review" || x.reviewState === "unreviewed")) add("strategy_change", x.summary.slice(0, 160), x.discoveredAt, x.id);
		for (const e of p.events) if (e.type !== "portfolio_addition" && e.classification === "new" && !e.baseline && (e.reviewState === "unreviewed" || e.reviewState === "needs_review")) add("new_investment", `${e.companyName}: ${e.type.replace(/_/g, " ")}`, e.discoveredAt, e.id);
		for (const e of p.events) if (e.reviewState === "needs_review") add("needs_review", `${e.companyName}: check this ${e.type === "portfolio_addition" ? "portfolio listing" : "announcement"}`, e.discoveredAt, e.id);
		for (const x of latest.values()) if (x.reviewState === "needs_review") add("needs_review", x.summary.slice(0, 160), x.discoveredAt, x.id);
		if (p.health.failing) add("research_failing", `Research is failing (${p.health.consecutiveFailures} checks in a row)${p.monitoring?.lastError ? `: ${p.monitoring.lastError.message}` : ""}`, p.health.lastAttemptAt ?? p.firm.updatedAt, `health:${f.id}`);
		else if (p.health.stale) add("research_stale", "No successful research recently; showing the last successful results", p.health.lastSuccessAt ?? p.firm.updatedAt, `stale:${f.id}`);
	}
	return out.sort((a, b) => b.at.localeCompare(a.at));
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
