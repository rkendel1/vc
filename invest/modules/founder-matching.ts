import { canonicalJson, sha256Hex } from "../domain/canonical.ts";
import type { PublishedProfile } from "../domain/collab.ts";
import { conflict, invalid, notFound, precondition } from "../domain/errors.ts";
import {
	type ActionState,
	type CoverageLevel,
	type CriterionFact,
	type EvidenceRef,
	type FactAuthority,
	type FactVerification,
	type InvestorSnapshot,
	type MatchAction,
	type MatchEvaluation,
	type MatchResult,
	type ProfileContent,
	type ShortlistEntry,
	type ShortlistStatus,
} from "../domain/founder.ts";
import type { CriterionField, CriterionView } from "../domain/research.ts";
import type { Actor } from "../domain/types.ts";
import { EVIDENCE_STALE_DAYS, MANDATE_ORDER, MATCH_POLICY_VERSION, READINESS_FRAMEWORK_VERSION, evaluateMatch, formatUsd, geoCovers, rangeLabel, stageCovers, type MatchEvidence } from "../research/match.ts";
import { normalizeFirmUrl } from "../research/url.ts";
import { C, type InvestStore } from "../store/store.ts";
import type { EvidenceRegistryModule } from "./evidence-registry.ts";
import type { FounderProfileModule } from "./founder-profiles.ts";
import { currentApprovals, type InvestorResearchModule } from "./investor-research.ts";
import type { ParticipationModule } from "./participation.ts";
import type { ReconciliationModule } from "./reconciliation.ts";

const DAY = 86_400_000;
const PASSAGE_MAX = 320;
const clip = (s: string) => (s.length > PASSAGE_MAX ? `${s.slice(0, PASSAGE_MAX - 1)}…` : s);

const AUTH_RANK: Record<FactAuthority, number> = { investor_approved: 0, workspace_approved: 1, official_stated: 2, third_party: 3, contributed: 4, observed: 5, inferred: 6 };

export type DiscoverFilters = {
	/** Show investors whose criteria include any of these, or are unknown (see `unknown`). */
	stage?: string[];
	sector?: string[];
	geography?: string[];
	businessModel?: string[];
	checkSize?: { minUsd: number | null; maxUsd: number | null };
	/** Only investors with at least one criterion approved by the investor or this workspace. */
	approvedOnly?: boolean;
	/** Only investors whose criteria are not flagged stale. */
	freshOnly?: boolean;
	coverage?: CoverageLevel[];
	mandate?: MatchResult["mandate"]["summary"][];
	/** Keep investors whose criterion for a filtered field is unknown. Default true: unknown is not a mismatch. */
	unknown?: boolean;
	/** Show investors the founder excluded. Default false. */
	includeFounderExcluded?: boolean;
	query?: string;
};

export type Candidate = {
	investorKey: string;
	name: string;
	source: InvestorSnapshot["source"];
	investorRef: Pick<InvestorSnapshot, "firmId" | "publishedVersion" | "researchRunId" | "lastResearchedAt" | "snapshotHash" | "researchStatus">;
	mandate: Pick<MatchResult["mandate"], "summary" | "statement" | "counts" | "eliminatedBy" | "founderExcluded">;
	readiness: MatchResult["readiness"]["counts"];
	evidenceQuality: MatchResult["evidenceQuality"]["counts"];
	coverage: Pick<MatchResult["coverage"], "level" | "flags" | "limitsPrecision" | "statement">;
	topActions: Pick<MatchAction, "id" | "title" | "kind">[];
	filterNotes: string[];
	latestEvaluation: { id: string; sequence: number; evaluatedAt: string; current: boolean } | null;
	shortlisted: boolean;
};

const COVERAGE_RANK: Record<CoverageLevel, number> = { verified: 0, partially_verified: 1, unverified_reports: 2, inferred: 3, unknown: 4 };

// --------------------------------------------------------------------------- evaluation diff (pure)

/** What differs between two evaluations of the same startup and investor, in words. */
export function diffEvaluations(prev: MatchEvaluation, next: MatchEvaluation): { inputs: string[]; results: string[] } {
	const inputs: string[] = [];
	const results: string[] = [];
	if (prev.inputs.profile.contentHash !== next.inputs.profile.contentHash) inputs.push(`Startup profile changed (version ${prev.inputs.profile.version} → ${next.inputs.profile.version}).`);
	const pe = new Map(prev.inputs.evidence.refs.map((r) => [r.id, r]));
	const ne = new Map(next.inputs.evidence.refs.map((r) => [r.id, r]));
	const addedE = [...ne.keys()].filter((k) => !pe.has(k));
	const removedE = [...pe.keys()].filter((k) => !ne.has(k));
	if (addedE.length) inputs.push(`${addedE.length} evidence item${addedE.length > 1 ? "s" : ""} added.`);
	if (removedE.length) inputs.push(`${removedE.length} evidence item${removedE.length > 1 ? "s" : ""} superseded or removed.`);
	const verifChanged = [...ne.values()].filter((r) => pe.has(r.id) && (pe.get(r.id)!.verification !== r.verification || pe.get(r.id)!.stale !== r.stale));
	if (verifChanged.length) inputs.push(`${verifChanged.length} evidence item${verifChanged.length > 1 ? "s" : ""} changed verification or became stale.`);
	const pi = prev.inputs.investor;
	const ni = next.inputs.investor;
	if (pi.snapshotHash !== ni.snapshotHash) {
		const pf = new Map(pi.factRefs.map((f) => [f.key, f]));
		const nf = new Map(ni.factRefs.map((f) => [f.key, f]));
		const added = [...nf.keys()].filter((k) => !pf.has(k)).length;
		const removed = [...pf.keys()].filter((k) => !nf.has(k)).length;
		const moved = [...nf.values()].filter((f) => pf.has(f.key) && (pf.get(f.key)!.lifecycle !== f.lifecycle || pf.get(f.key)!.freshness !== f.freshness || pf.get(f.key)!.authority !== f.authority)).length;
		inputs.push(`Investor research changed: ${added} criteria added, ${removed} removed, ${moved} changed state${pi.publishedVersion !== ni.publishedVersion ? `; published profile version ${pi.publishedVersion ?? "none"} → ${ni.publishedVersion ?? "none"}` : ""}.`);
	}
	if (prev.policyVersion !== next.policyVersion) inputs.push(`Matching policy changed (${prev.policyVersion} → ${next.policyVersion}).`);
	const a = prev.result;
	const b = next.result;
	if (a.mandate.summary !== b.mandate.summary) results.push(`Mandate fit: ${a.mandate.summary.replace(/_/g, " ")} → ${b.mandate.summary.replace(/_/g, " ")}.`);
	for (const c of b.mandate.constraints) {
		const old = a.mandate.constraints.find((x) => x.field === c.field);
		if (old && old.status !== c.status) results.push(`${c.field.replace(/_/g, " ")}: ${old.status} → ${c.status}.`);
	}
	for (const i of b.readiness.items) {
		const old = a.readiness.items.find((x) => x.id === i.id);
		if (old && old.status !== i.status) results.push(`Readiness "${i.label}": ${old.status.replace(/_/g, " ")} → ${i.status.replace(/_/g, " ")}.`);
		if (!old) results.push(`Readiness "${i.label}" is now assessed (${i.status.replace(/_/g, " ")}).`);
	}
	if (a.coverage.level !== b.coverage.level) results.push(`Research coverage: ${a.coverage.level.replace(/_/g, " ")} → ${b.coverage.level.replace(/_/g, " ")}.`);
	for (const c of b.evidenceQuality.claims) {
		const old = a.evidenceQuality.claims.find((x) => x.field === c.field);
		if (old && old.quality !== c.quality) results.push(`Evidence for ${c.claim}: ${old.quality.replace(/_/g, " ")} → ${c.quality.replace(/_/g, " ")}.`);
	}
	const aa = new Set(a.actions.map((x) => x.id));
	const bb = new Set(b.actions.map((x) => x.id));
	const closed = a.actions.filter((x) => !bb.has(x.id));
	const opened = b.actions.filter((x) => !aa.has(x.id));
	if (closed.length) results.push(`${closed.length} earlier recommendation${closed.length > 1 ? "s" : ""} no longer apply.`);
	if (opened.length) results.push(`${opened.length} new recommendation${opened.length > 1 ? "s" : ""}.`);
	return { inputs, results };
}

// --------------------------------------------------------------------------- module

type Deps = { store: InvestStore; profiles: FounderProfileModule; evidence: EvidenceRegistryModule; research: InvestorResearchModule; reconciliation: ReconciliationModule; participation: ParticipationModule };

/**
 * Candidate discovery, explainable evaluation, shortlist and action plan. Everything reads and writes the
 * caller's own workspace; the investor side is the caller's own research plus the public directory of
 * representative-published profiles. Nothing here sends anything anywhere.
 */
export class FounderMatchingModule {
	constructor(private readonly deps: Deps) {}

	private get store() {
		return this.deps.store;
	}

	// ----------------------------------------------------------------------- investor side

	/** The investor as the matcher sees it. Facts are references with short excerpts: full text stays in the immutable source records. */
	private async snapshotForFirm(actor: Actor, firmId: string): Promise<InvestorSnapshot> {
		const [recon, profile, approvals] = await Promise.all([this.deps.reconciliation.forFirm(actor, firmId), this.deps.research.profile(actor, firmId), this.deps.research.approvalsFor(actor, firmId)]);
		const verification = new Map<string, CriterionView>(profile.criteria.map((c) => [c.id, c]));
		const openConflict = recon.fields.flatMap((f) => f.conflicts).filter((c) => c.reviewState !== "accepted" && c.reviewState !== "rejected");
		const facts: CriterionFact[] = [];
		for (const field of recon.fields) {
			for (const c of field.claims) {
				const a = c.signals.assertionType;
				const authority: FactAuthority =
					c.claimRef.kind === "published" || c.signals.category === "investor_verified"
						? "investor_approved"
						: a === "observed"
							? "observed"
							: a === "inferred"
								? "inferred"
								: c.signals.category === "official_public_source"
									? "official_stated"
									: c.signals.category === "third_party_source"
										? "third_party"
										: "contributed";
				const crit = c.claimRef.kind === "criterion" ? verification.get(c.claimRef.id) : undefined;
				const v: FactVerification = authority === "investor_approved" ? "approved" : crit ? (crit.verification === "pending" ? "unchecked" : crit.verification === "verification_error" ? "inconclusive" : crit.verification) : "unchecked";
				facts.push({ key: c.key, ref: c.claimRef, field: field.field, polarity: c.polarity, value: c.value, valueRange: c.valueRange, label: c.label, authority, verification: v, lifecycle: c.lifecycle, freshness: c.signals.freshness, publisher: c.publisher, passage: clip(c.passage), url: c.url, capturedAt: c.signals.capturedAt, conflictIds: openConflict.filter((x) => x.claimKeys.includes(c.key)).map((x) => x.id).sort(), alsoStatedBy: [] });
			}
		}
		for (const ap of currentApprovals(approvals)) {
			const rep = (ap.authority ?? "workspace") === "firm_representative";
			facts.push({ key: `approval:${ap.id}`, ref: { kind: "approval", id: ap.id }, field: ap.field, polarity: ap.polarity, value: ap.value, valueRange: ap.valueRange, label: ap.valueRange ? rangeLabel(ap.valueRange) : ap.value.replace(/_/g, " "), authority: rep ? "investor_approved" : "workspace_approved", verification: "approved", lifecycle: "accepted", freshness: "fresh", publisher: rep ? `firm:${recon.firm.canonicalDomain}` : "this workspace", passage: clip(ap.note || (rep ? "Approved by a verified representative of the firm." : "Approved by this workspace.")), url: null, capturedAt: ap.createdAt, conflictIds: [], alsoStatedBy: [] });
		}
		return this.finishSnapshot({
			canonicalDomain: recon.firm.canonicalDomain,
			name: recon.firm.name,
			source: "workspace_research",
			firmId: recon.firm.id,
			publishedVersion: recon.published?.version ?? null,
			researchRunId: recon.firm.lastRunId,
			lastResearchedAt: recon.firm.lastSuccessAt,
			researchStatus: recon.firm.researchStatus,
			stub: profile.stub,
			stale: profile.stale,
			facts,
			fieldStatus: Object.fromEntries(recon.fields.map((f) => [f.field, f.status])),
			conflicts: recon.fields.flatMap((f) => f.conflicts).map((c) => ({ id: c.id, field: c.field, summary: c.summary, state: c.reviewState })),
		});
	}

	private snapshotForPublished(p: PublishedProfile): InvestorSnapshot {
		const facts: CriterionFact[] = p.criteria.map((pc) => ({ key: `published:${p.id}:${pc.approvalId}`, ref: { kind: "published", id: `${p.id}:${pc.approvalId}` }, field: pc.field, polarity: pc.polarity, value: pc.value, valueRange: pc.valueRange, label: pc.label, authority: "investor_approved", verification: "approved", lifecycle: "accepted", freshness: "fresh", publisher: `firm:${p.canonicalDomain}`, passage: clip(`Published by a verified representative of ${p.firmName} (version ${p.version}).`), url: null, capturedAt: p.publishedAt, conflictIds: [], alsoStatedBy: [] }));
		return this.finishSnapshot({ canonicalDomain: p.canonicalDomain, name: p.firmName, source: "published_profile", firmId: null, publishedVersion: p.version, researchRunId: null, lastResearchedAt: p.publishedAt, researchStatus: null, stub: false, stale: false, facts, fieldStatus: {}, conflicts: [] });
	}

	/** Merges facts that state the same thing, keeping the strongest authority first and naming the others, then hashes everything matching reads. */
	private finishSnapshot(s: Omit<InvestorSnapshot, "snapshotHash">): InvestorSnapshot {
		const groups = new Map<string, CriterionFact[]>();
		for (const f of s.facts) {
			const k = `${f.field}|${f.polarity}|${f.value}|${f.valueRange ? `${f.valueRange.minUsd}-${f.valueRange.maxUsd}` : ""}`;
			groups.set(k, [...(groups.get(k) ?? []), f]);
		}
		const facts: CriterionFact[] = [];
		for (const group of groups.values()) {
			const sorted = [...group].sort((a, b) => AUTH_RANK[a.authority] - AUTH_RANK[b.authority] || a.key.localeCompare(b.key));
			const [primary, ...rest] = sorted;
			const conflictIds = [...new Set(group.flatMap((g) => g.conflictIds))].sort();
			facts.push({ ...primary!, conflictIds: primary!.authority === "investor_approved" || primary!.authority === "workspace_approved" ? [] : conflictIds, alsoStatedBy: rest.map((r) => ({ ref: r.ref, publisher: r.publisher, authority: r.authority })) });
		}
		facts.sort((a, b) => a.key.localeCompare(b.key));
		const snapshotHash = sha256Hex(
			canonicalJson({
				d: s.canonicalDomain,
				pv: s.publishedVersion,
				stub: s.stub,
				stale: s.stale,
				facts: facts.map((f) => [f.key, f.field, f.polarity, f.value, f.valueRange, f.authority, f.verification, f.lifecycle, f.freshness, f.conflictIds, f.alsoStatedBy.map((x) => x.ref)]),
				conflicts: s.conflicts.map((c) => [c.id, c.state]).sort(),
				fs: s.fieldStatus,
			}),
		);
		return { ...s, facts, snapshotHash };
	}

	/** Every investor this workspace can evaluate against: its own researched firms and the published directory. */
	async snapshots(actor: Actor): Promise<InvestorSnapshot[]> {
		const out = new Map<string, InvestorSnapshot>();
		for (const f of await this.deps.research.list(actor)) out.set(f.canonicalDomain, await this.snapshotForFirm(actor, f.id));
		for (const row of await this.deps.participation.directory()) {
			if (out.has(row.canonicalDomain)) continue;
			const p = await this.deps.participation.publishedFor(row.canonicalDomain);
			if (p) out.set(p.canonicalDomain, this.snapshotForPublished(p));
		}
		return [...out.values()].sort((a, b) => a.name.localeCompare(b.name) || a.canonicalDomain.localeCompare(b.canonicalDomain));
	}

	private async snapshot(actor: Actor, key: string): Promise<InvestorSnapshot> {
		let domain: string;
		try {
			domain = normalizeFirmUrl(key).canonicalDomain;
		} catch {
			throw notFound("Investor");
		}
		const firm = (await this.deps.research.list(actor)).find((f) => f.canonicalDomain === domain);
		if (firm) return this.snapshotForFirm(actor, firm.id);
		const p = await this.deps.participation.publishedFor(domain);
		if (!p) throw notFound("Investor");
		return this.snapshotForPublished(p);
	}

	// ----------------------------------------------------------------------- startup side

	private async startupInputs(actor: Actor, startupId: string) {
		const profile = await this.deps.profiles.get(actor, startupId);
		if (!profile.current) throw precondition("Save a startup profile before matching");
		const { items } = await this.deps.evidence.views(actor, startupId);
		const now = Date.parse(this.store.now());
		const active = items.filter((i) => !i.superseded);
		const evidence: MatchEvidence[] = active.map((i) => ({ id: i.id, documentId: i.documentId, claim: i.claim, metric: i.metric ? { key: i.metric.key, value: i.metric.value } : null, provenanceClass: i.provenance.class, sourceType: i.provenance.sourceType, effectiveVerification: i.effectiveVerification, superseded: false, createdAt: i.createdAt }));
		const refs: EvidenceRef[] = active
			.map((i) => ({ id: i.id, documentId: i.documentId, provenanceClass: i.provenance.class, sourceType: i.provenance.sourceType, verification: i.effectiveVerification, superseded: false, createdAt: i.createdAt, stale: now - Date.parse(i.createdAt) > EVIDENCE_STALE_DAYS * DAY }))
			.sort((a, b) => a.id.localeCompare(b.id));
		return { version: profile.current, evidence, refs, setHash: sha256Hex(canonicalJson(refs.map((r) => [r.id, r.verification, r.stale]))) };
	}

	private inputHash(startup: Awaited<ReturnType<FounderMatchingModule["startupInputs"]>>, snap: InvestorSnapshot) {
		return sha256Hex(canonicalJson({ policy: MATCH_POLICY_VERSION, framework: READINESS_FRAMEWORK_VERSION, profile: startup.version.contentHash, evidence: startup.setHash, investor: snap.snapshotHash, key: snap.canonicalDomain }));
	}

	// ----------------------------------------------------------------------- discovery

	async discover(actor: Actor, input: { startupId: string; filters?: DiscoverFilters }) {
		const startup = await this.startupInputs(actor, input.startupId);
		const filters = input.filters ?? {};
		const keepUnknown = filters.unknown !== false;
		const [snaps, evaluations, shortlist] = await Promise.all([this.snapshots(actor), this.store.list<MatchEvaluation>(C.matchEvaluations, actor.workspaceId, { startupId: input.startupId }), this.store.list<ShortlistEntry>(C.shortlistEntries, actor.workspaceId, { startupId: input.startupId })]);
		const now = this.store.now();
		const candidates: Candidate[] = [];
		for (const snap of snaps) {
			const result = evaluateMatch({ profile: startup.version.content, evidence: startup.evidence, investor: snap, investorKey: snap.canonicalDomain, now });
			const notes: string[] = [];
			if (!this.passes(snap, filters, keepUnknown, notes)) continue;
			if (filters.approvedOnly && !snap.facts.some((f) => f.authority === "investor_approved" || f.authority === "workspace_approved")) continue;
			if (filters.freshOnly && result.coverage.flags.includes("stale")) continue;
			if (filters.coverage?.length && !filters.coverage.includes(result.coverage.level)) continue;
			if (filters.mandate?.length && !filters.mandate.includes(result.mandate.summary)) continue;
			if (result.mandate.founderExcluded && !filters.includeFounderExcluded) continue;
			if (filters.query && !`${snap.name} ${snap.canonicalDomain}`.toLowerCase().includes(filters.query.trim().toLowerCase())) continue;
			const latest = evaluations.filter((e) => e.investorKey === snap.canonicalDomain).sort((a, b) => b.sequence - a.sequence)[0];
			const entry = shortlist.find((s) => s.investorKey === snap.canonicalDomain && !s.removedAt);
			candidates.push({
				investorKey: snap.canonicalDomain,
				name: snap.name,
				source: snap.source,
				investorRef: { firmId: snap.firmId, publishedVersion: snap.publishedVersion, researchRunId: snap.researchRunId, lastResearchedAt: snap.lastResearchedAt, snapshotHash: snap.snapshotHash, researchStatus: snap.researchStatus },
				mandate: { summary: result.mandate.summary, statement: result.mandate.statement, counts: result.mandate.counts, eliminatedBy: result.mandate.eliminatedBy, founderExcluded: result.mandate.founderExcluded },
				readiness: result.readiness.counts,
				evidenceQuality: result.evidenceQuality.counts,
				coverage: { level: result.coverage.level, flags: result.coverage.flags, limitsPrecision: result.coverage.limitsPrecision, statement: result.coverage.statement },
				topActions: result.actions.slice(0, 3).map((a) => ({ id: a.id, title: a.title, kind: a.kind })),
				filterNotes: notes,
				latestEvaluation: latest ? { id: latest.id, sequence: latest.sequence, evaluatedAt: latest.evaluatedAt, current: latest.inputHash === this.inputHash(startup, snap) } : null,
				shortlisted: !!entry,
			});
		}
		// A sort key, not a score: mandate state first, then how well the investor is known, then name.
		candidates.sort((a, b) => MANDATE_ORDER[a.mandate.summary] - MANDATE_ORDER[b.mandate.summary] || COVERAGE_RANK[a.coverage.level] - COVERAGE_RANK[b.coverage.level] || a.name.localeCompare(b.name));
		return {
			startupId: input.startupId,
			profileVersion: startup.version.version,
			policyVersion: MATCH_POLICY_VERSION,
			total: snaps.length,
			shown: candidates.length,
			/** Where the comparable investors come from. It is never the whole market. */
			universe: { published: snaps.filter((x) => x.source === "published_profile").length, researched: snaps.filter((x) => x.source === "workspace_research").length },
			candidates,
			empty: snaps.length === 0 ? ("no_investors" as const) : candidates.length === 0 ? ("filtered_out" as const) : null,
			evaluatedAt: now,
		};
	}

	/** A filter is a lens over sourced criteria: it keeps investors that list a wanted value, and (by default) those whose criterion is unknown. */
	private passes(snap: InvestorSnapshot, f: DiscoverFilters, keepUnknown: boolean, notes: string[]): boolean {
		const live = (x: CriterionFact) => x.lifecycle !== "rejected" && x.lifecycle !== "superseded";
		const setFilter = (field: CriterionField, wanted: string[] | undefined, covers: (inv: string, want: string) => boolean) => {
			if (!wanted?.length) return true;
			const facts = snap.facts.filter((x) => x.field === field && live(x));
			const includes = facts.filter((x) => x.polarity === "include");
			if (!includes.length) {
				if (keepUnknown) notes.push(`${field.replace(/_/g, " ")}: no criterion known`);
				return keepUnknown;
			}
			const excluded = facts.filter((x) => x.polarity === "exclude").some((e) => wanted.some((w) => covers(e.value, w)));
			return !excluded && includes.some((x) => wanted.some((w) => covers(x.value, w)));
		};
		if (!setFilter("stage", f.stage, stageCovers)) return false;
		if (!setFilter("sector", f.sector, (a, b) => a === b)) return false;
		if (!setFilter("geography", f.geography, geoCovers)) return false;
		if (!setFilter("business_model", f.businessModel, (a, b) => a === b)) return false;
		if (f.checkSize) {
			const ranges = snap.facts.filter((x) => x.field === "check_size" && x.polarity === "include" && x.valueRange && live(x));
			if (!ranges.length) {
				if (keepUnknown) notes.push("check size: no criterion known");
				return keepUnknown;
			}
			const lo = f.checkSize.minUsd ?? 0;
			const hi = f.checkSize.maxUsd ?? Number.POSITIVE_INFINITY;
			if (!ranges.some((x) => (x.valueRange!.maxUsd ?? Number.POSITIVE_INFINITY) >= lo && (x.valueRange!.minUsd ?? 0) <= hi)) return false;
		}
		return true;
	}

	// ----------------------------------------------------------------------- evaluation

	/** Evaluates one investor. Identical versioned inputs return the existing evaluation; anything else writes a new one and leaves the old intact. */
	async evaluate(actor: Actor, input: { startupId: string; investorKey: string }) {
		const startup = await this.startupInputs(actor, input.startupId);
		const snap = await this.snapshot(actor, input.investorKey);
		const hash = this.inputHash(startup, snap);
		for (let attempt = 0; attempt < 3; attempt++) {
			const history = (await this.store.list<MatchEvaluation>(C.matchEvaluations, actor.workspaceId, { startupId: input.startupId })).filter((e) => e.investorKey === snap.canonicalDomain).sort((a, b) => b.sequence - a.sequence);
			const latest = history[0] ?? null;
			if (latest && latest.inputHash === hash) return { evaluation: this.view(latest), reused: true as const, previous: null };
			const now = this.store.now();
			const result = evaluateMatch({ profile: startup.version.content, evidence: startup.evidence, investor: snap, investorKey: snap.canonicalDomain, now });
			const { facts, ...snapRest } = snap;
			const sequence = (latest?.sequence ?? 0) + 1;
			const evaluation: MatchEvaluation = {
				id: `me_${sha256Hex(`${input.startupId}|${snap.canonicalDomain}|${sequence}|${hash}`).slice(0, 28)}`,
				workspaceId: actor.workspaceId,
				startupId: input.startupId,
				investorKey: snap.canonicalDomain,
				investorName: snap.name,
				sequence,
				policyVersion: MATCH_POLICY_VERSION,
				frameworkVersion: READINESS_FRAMEWORK_VERSION,
				evaluatedAt: now,
				evaluatedBy: actor.principalId,
				inputHash: hash,
				inputs: {
					profile: { versionId: startup.version.id, version: startup.version.version, contentHash: startup.version.contentHash },
					evidence: { setHash: startup.setHash, refs: startup.refs },
					investor: { ...snapRest, factRefs: facts.map((f) => ({ key: f.key, ref: f.ref, authority: f.authority, lifecycle: f.lifecycle, freshness: f.freshness })) },
				},
				previousEvaluationId: latest?.id ?? null,
				changes: [],
				result,
				modelUse: null,
			};
			if (latest) {
				const d = diffEvaluations(latest, evaluation);
				evaluation.changes = [...d.inputs, ...d.results];
			}
			try {
				await this.store.commit(actor, {
					writes: [{ collection: C.matchEvaluations, id: evaluation.id, value: evaluation, create: true }],
					audit: [{ eventType: "match.evaluated", entityRef: { type: "match_evaluation", id: evaluation.id }, payload: { startupId: input.startupId, investor: snap.canonicalDomain, sequence, policyVersion: MATCH_POLICY_VERSION, profileVersion: startup.version.version, mandate: result.mandate.summary, coverage: result.coverage.level, changed: evaluation.changes.length } }],
				});
			} catch (error) {
				if ((error as { code?: string }).code === "conflict") continue;
				throw error;
			}
			return { evaluation: this.view(evaluation), reused: false as const, previous: latest ? this.view(latest) : null };
		}
		throw conflict("This evaluation is changing too quickly; retry");
	}

	private view(e: MatchEvaluation): MatchEvaluation {
		const { __version: _v, ...rest } = e as MatchEvaluation & { __version?: number };
		return rest;
	}

	async get(actor: Actor, evaluationId: string) {
		const e = await this.store.get<MatchEvaluation>(C.matchEvaluations, evaluationId, actor.workspaceId);
		if (!e) throw notFound("Evaluation");
		return { evaluation: this.view(e), staleness: await this.staleness(actor, e) };
	}

	/** Whether an evaluation still describes today's inputs, and what moved if not. */
	private async staleness(actor: Actor, e: MatchEvaluation): Promise<{ current: boolean; reasons: string[] }> {
		try {
			const startup = await this.startupInputs(actor, e.startupId);
			const snap = await this.snapshot(actor, e.investorKey);
			if (this.inputHash(startup, snap) === e.inputHash) return { current: true, reasons: [] };
			const reasons: string[] = [];
			if (startup.version.contentHash !== e.inputs.profile.contentHash) reasons.push(`The startup profile changed (version ${e.inputs.profile.version} → ${startup.version.version}).`);
			if (startup.setHash !== e.inputs.evidence.setHash) reasons.push("Evidence was added, superseded, verified or went stale.");
			if (snap.snapshotHash !== e.inputs.investor.snapshotHash) reasons.push("The investor's research or published criteria changed.");
			if (e.policyVersion !== MATCH_POLICY_VERSION) reasons.push("The matching policy changed.");
			return { current: false, reasons };
		} catch {
			return { current: false, reasons: ["The inputs can no longer be read (the investor may have withdrawn its profile)."] };
		}
	}

	async history(actor: Actor, input: { startupId: string; investorKey?: string }) {
		await this.deps.profiles.get(actor, input.startupId);
		const all = (await this.store.list<MatchEvaluation>(C.matchEvaluations, actor.workspaceId, { startupId: input.startupId })).filter((e) => !input.investorKey || e.investorKey === input.investorKey.toLowerCase());
		return all
			.sort((a, b) => b.evaluatedAt.localeCompare(a.evaluatedAt) || b.sequence - a.sequence)
			.map((e) => ({ id: e.id, investorKey: e.investorKey, investorName: e.investorName, sequence: e.sequence, evaluatedAt: e.evaluatedAt, policyVersion: e.policyVersion, profileVersion: e.inputs.profile.version, mandate: e.result.mandate.summary, coverage: e.result.coverage.level, readiness: e.result.readiness.counts, changes: e.changes, previousEvaluationId: e.previousEvaluationId }));
	}

	async compare(actor: Actor, input: { fromId: string; toId: string }) {
		const [a, b] = await Promise.all([this.store.get<MatchEvaluation>(C.matchEvaluations, input.fromId, actor.workspaceId), this.store.get<MatchEvaluation>(C.matchEvaluations, input.toId, actor.workspaceId)]);
		if (!a || !b) throw notFound("Evaluation");
		if (a.startupId !== b.startupId || a.investorKey !== b.investorKey) throw invalid("Only evaluations of the same startup and investor can be compared");
		return { from: this.view(a), to: this.view(b), ...diffEvaluations(a, b) };
	}

	// ----------------------------------------------------------------------- shortlist and action plan

	private entryId(startupId: string, key: string) {
		return `sl_${sha256Hex(`${startupId}|${key}`).slice(0, 24)}`;
	}

	async shortlistSave(actor: Actor, input: { startupId: string; investorKey: string; status?: ShortlistStatus; note?: string }) {
		await this.deps.profiles.get(actor, input.startupId);
		const snap = await this.snapshot(actor, input.investorKey);
		const note = (input.note ?? "").trim();
		if (note.length > 1000) throw invalid("Note must be at most 1000 characters");
		const id = this.entryId(input.startupId, snap.canonicalDomain);
		const existing = await this.store.get<ShortlistEntry>(C.shortlistEntries, id, actor.workspaceId);
		const now = this.store.now();
		if (!existing) {
			const entry: ShortlistEntry = { id, workspaceId: actor.workspaceId, startupId: input.startupId, investorKey: snap.canonicalDomain, investorName: snap.name, status: input.status ?? "considering", note, actionStates: {}, addedAt: now, addedBy: actor.principalId, removedAt: null, updatedAt: now };
			await this.store.commit(actor, { writes: [{ collection: C.shortlistEntries, id, value: entry, create: true }], audit: [{ eventType: "shortlist.saved", entityRef: { type: "shortlist_entry", id }, payload: { startupId: input.startupId, investor: snap.canonicalDomain, status: entry.status } }] });
			return this.entry(actor, id);
		}
		if (!existing.removedAt && (input.status === undefined || input.status === existing.status) && (input.note === undefined || note === existing.note)) return existing;
		const next: ShortlistEntry = { ...existing, investorName: snap.name, status: input.status ?? (existing.removedAt ? "considering" : existing.status), note: input.note === undefined ? existing.note : note, removedAt: null, updatedAt: now };
		await this.store.commit(actor, { writes: [{ collection: C.shortlistEntries, id, value: next, ifVersion: existing.__version }], audit: [{ eventType: existing.removedAt ? "shortlist.restored" : "shortlist.updated", entityRef: { type: "shortlist_entry", id }, payload: { startupId: input.startupId, investor: snap.canonicalDomain, status: next.status } }] });
		return this.entry(actor, id);
	}

	async shortlistUpdate(actor: Actor, input: { entryId: string; expectedVersion: number; status?: ShortlistStatus; note?: string; actions?: Record<string, ActionState>; remove?: boolean }) {
		const e = await this.store.get<ShortlistEntry>(C.shortlistEntries, input.entryId, actor.workspaceId);
		if (!e) throw notFound("Shortlist entry");
		if (e.__version !== input.expectedVersion) throw precondition("This shortlist entry changed since you opened it; reload before saving");
		if (input.note !== undefined && input.note.length > 1000) throw invalid("Note must be at most 1000 characters");
		for (const [k, v] of Object.entries(input.actions ?? {})) if (!/^act_[0-9a-f]{16}$/.test(k) || !["open", "done", "dismissed"].includes(v)) throw invalid("Unknown action or state");
		const now = this.store.now();
		const next: ShortlistEntry = { ...e, status: input.status ?? e.status, note: input.note === undefined ? e.note : input.note.trim(), actionStates: { ...e.actionStates, ...(input.actions ?? {}) }, removedAt: input.remove ? now : e.removedAt, updatedAt: now };
		await this.store.commit(actor, { writes: [{ collection: C.shortlistEntries, id: e.id, value: next, ifVersion: input.expectedVersion }], audit: [{ eventType: input.remove ? "shortlist.removed" : "shortlist.updated", entityRef: { type: "shortlist_entry", id: e.id }, payload: { startupId: e.startupId, investor: e.investorKey, status: next.status, actionsChanged: Object.keys(input.actions ?? {}).length } }] });
		return this.entry(actor, e.id);
	}

	private async entry(actor: Actor, id: string) {
		const e = await this.store.get<ShortlistEntry>(C.shortlistEntries, id, actor.workspaceId);
		if (!e) throw notFound("Shortlist entry");
		return e;
	}

	/** The founder's private shortlist with, for each investor, the latest evaluation, whether it is still current, and the prioritised actions. */
	async shortlist(actor: Actor, input: { startupId: string; includeRemoved?: boolean }) {
		await this.deps.profiles.get(actor, input.startupId);
		const [entries, evaluations] = await Promise.all([this.store.list<ShortlistEntry>(C.shortlistEntries, actor.workspaceId, { startupId: input.startupId }), this.store.list<MatchEvaluation>(C.matchEvaluations, actor.workspaceId, { startupId: input.startupId })]);
		const out = [];
		for (const e of entries.filter((x) => input.includeRemoved || !x.removedAt).sort((a, b) => a.addedAt.localeCompare(b.addedAt) || a.id.localeCompare(b.id))) {
			const latest = evaluations.filter((x) => x.investorKey === e.investorKey).sort((a, b) => b.sequence - a.sequence)[0] ?? null;
			const staleness = latest ? await this.staleness(actor, latest) : null;
			const actions = (latest?.result.actions ?? []).map((a) => ({ ...a, state: (e.actionStates[a.id] ?? "open") as ActionState }));
			if (staleness && !staleness.current)
				actions.unshift({ id: `act_${sha256Hex("re_evaluate|inputs").slice(0, 16)}`, kind: "re_evaluate", priority: 0, title: "Re-run the evaluation", why: staleness.reasons.join(" "), finding: { dimension: "change", ref: "inputs" }, disclaimer: "A recommendation about your materials, not a promise that doing it leads to investment.", state: "open" });
			if (!latest) actions.unshift({ id: `act_${sha256Hex("re_evaluate|first").slice(0, 16)}`, kind: "re_evaluate", priority: 0, title: "Run the first evaluation", why: "This investor is shortlisted but has not been evaluated yet.", finding: { dimension: "change", ref: "first" }, disclaimer: "A recommendation about your materials, not a promise that doing it leads to investment.", state: "open" });
			out.push({
				entry: e,
				latest: latest ? { id: latest.id, sequence: latest.sequence, evaluatedAt: latest.evaluatedAt, mandate: latest.result.mandate.summary, mandateStatement: latest.result.mandate.statement, coverage: latest.result.coverage.level, flags: latest.result.coverage.flags, readiness: latest.result.readiness.counts, evidenceQuality: latest.result.evidenceQuality.counts, profileVersion: latest.inputs.profile.version } : null,
				staleness,
				actions,
			});
		}
		return out;
	}

	/** Prioritised actions across the whole shortlist, open ones first. */
	async actionPlan(actor: Actor, input: { startupId: string }) {
		const rows = await this.shortlist(actor, input);
		const items = rows.flatMap((r) => r.actions.map((a) => ({ ...a, investorKey: r.entry.investorKey, investorName: r.entry.investorName, entryId: r.entry.id })));
		return items.filter((i) => i.state === "open").sort((a, b) => a.priority - b.priority || a.investorName.localeCompare(b.investorName) || a.id.localeCompare(b.id));
	}
}

export type { ProfileContent };
void formatUsd;
