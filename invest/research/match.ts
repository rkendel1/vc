import { sha256Hex } from "../domain/canonical.ts";
import type {
	ActionKind,
	ClaimQuality,
	ConstraintField,
	ConstraintResult,
	CoverageResult,
	CriterionFact,
	EvidenceQuality,
	EvidenceQualityResult,
	FieldProvenance,
	FieldCoverage,
	InvestorSnapshot,
	MandateResult,
	MatchAction,
	MatchResult,
	ProfileContent,
	ProfileMetric,
	ReadinessItem,
	ReadinessResult,
	ReadinessStatus,
} from "../domain/founder.ts";

/**
 * The matching policy. Pure and deterministic: the same startup profile, evidence and investor snapshot
 * (and the same `now`) always give the same result. No store, no network, no model, no randomness.
 *
 * Bump MATCH_POLICY_VERSION when any rule below changes what a result says. Bump
 * READINESS_FRAMEWORK_VERSION when the generic readiness checklist changes.
 *
 * Four dimensions are computed separately and never combined into one number:
 *   mandate   — do the investor's sourced criteria allow this startup (compatible / incompatible / unknown)?
 *   readiness — does the startup's evidence cover what is expected (investor-sourced, or a labelled generic checklist)?
 *   evidence quality — how well supported are the startup's own claims?
 *   coverage  — how much of the investor is actually known, and how well?
 * Unknown is a result. A missing criterion is never a mismatch, and a missing document is never a failure.
 */
export const MATCH_POLICY_VERSION = "match-policy/1";
export const READINESS_FRAMEWORK_VERSION = "readiness-framework/1";
export const EVIDENCE_STALE_DAYS = 180;
export const CORE_FIELDS: readonly ConstraintField[] = ["stage", "sector", "geography", "business_model", "check_size"];
const DAY = 86_400_000;

export type MatchEvidence = {
	id: string;
	documentId: string | null;
	claim: string;
	metric: { key: string; value: number } | null;
	provenanceClass: "founder_reported" | "independent" | "reviewer_verified";
	sourceType: string;
	effectiveVerification: "unverified" | "corroborated" | "contradicted" | "reviewer_verified";
	superseded: boolean;
	createdAt: string;
};

export type MatchInput = { profile: ProfileContent; evidence: MatchEvidence[]; investor: InvestorSnapshot; investorKey: string; now: string };

// --------------------------------------------------------------------------- vocabulary relations

const STAGE_ORDER = ["pre_seed", "seed", "series_a", "series_b", "series_c_plus"] as const;
/** An investor term covers these startup stages. Specific terms cover only themselves. */
const STAGE_COVER: Record<string, readonly string[]> = {
	early_stage: ["pre_seed", "seed", "series_a"],
	growth: ["series_b", "series_c_plus"],
	late_stage: ["series_c_plus"],
};
const GEO_PARENT: Record<string, readonly string[]> = {
	united_states: ["north_america"],
	canada: ["north_america"],
	united_kingdom: ["europe"],
	israel: ["middle_east"],
	india: ["asia"],
	china: ["asia"],
	southeast_asia: ["asia"],
};

export const stageCovers = (investor: string, startup: string) => investor === startup || (STAGE_COVER[investor]?.includes(startup) ?? false);
export const geoCovers = (investor: string, startup: string) => investor === "global" || investor === startup || (GEO_PARENT[startup]?.includes(investor) ?? false);
const COVERS: Record<string, (investor: string, startup: string) => boolean> = {
	stage: stageCovers,
	geography: geoCovers,
	sector: (a, b) => a === b,
	business_model: (a, b) => a === b || (a === "b2b" && b === "saas"),
};
void STAGE_ORDER;

const label = (v: string) => v.replace(/_/g, " ");

export function formatUsd(n: number | null): string {
	if (n === null) return "any";
	const f = (x: number, u: string) => `$${+x.toFixed(2)}${u}`;
	return n >= 1e9 ? f(n / 1e9, "B") : n >= 1e6 ? f(n / 1e6, "M") : n >= 1e3 ? f(n / 1e3, "K") : `$${n}`;
}
export function rangeLabel(r: { minUsd: number | null; maxUsd: number | null }): string {
	if (r.minUsd !== null && r.maxUsd !== null) return r.minUsd === r.maxUsd ? `about ${formatUsd(r.minUsd)}` : `${formatUsd(r.minUsd)}–${formatUsd(r.maxUsd)}`;
	return r.maxUsd !== null ? `up to ${formatUsd(r.maxUsd)}` : `from ${formatUsd(r.minUsd)}`;
}

// --------------------------------------------------------------------------- fact helpers

const live = (f: CriterionFact) => f.lifecycle !== "rejected" && f.lifecycle !== "superseded";
const approved = (f: CriterionFact) => f.authority === "investor_approved" || f.authority === "workspace_approved";
/**
 * Sufficiently authoritative to rule a startup out: approved by the investor (or adopted by this workspace),
 * or the firm's own explicit statement that is current, undisputed, not contradicted by its source and not in
 * an open conflict. A third party's report, a contribution, an observation or an inference never is.
 */
export function authoritative(f: CriterionFact): boolean {
	if (approved(f)) return true;
	return f.authority === "official_stated" && f.freshness === "fresh" && f.lifecycle !== "disputed" && f.verification !== "source_does_not_support" && f.conflictIds.length === 0;
}
const explicit = (f: CriterionFact) => f.authority === "investor_approved" || f.authority === "workspace_approved" || f.authority === "official_stated" || f.authority === "third_party" || f.authority === "contributed";
const patternOnly = (f: CriterionFact) => f.authority === "observed" || f.authority === "inferred";

const AUTH_TEXT: Record<CriterionFact["authority"], string> = {
	investor_approved: "approved by the investor",
	workspace_approved: "adopted by this workspace",
	official_stated: "stated on the firm's own site",
	third_party: "reported by a third party",
	contributed: "contributed by a participant",
	observed: "observed from past activity (not a stated policy)",
	inferred: "inferred from a pattern (not a stated policy)",
};

function decided(f: CriterionFact): NonNullable<ConstraintResult["decidedBy"]> {
	const { key, ref, label: l, polarity, authority, verification, lifecycle, freshness, publisher, passage, url, capturedAt } = f;
	return { key, ref, label: l, polarity, authority, verification, lifecycle, freshness, publisher, passage, url, capturedAt };
}
const considered = (facts: CriterionFact[]) => facts.map((f) => ({ key: f.key, label: f.label, polarity: f.polarity, authority: f.authority, freshness: f.freshness, lifecycle: f.lifecycle }));
const tierOf = (f: CriterionFact) => (authoritative(f) ? 0 : explicit(f) ? 1 : 2);
const byTier = (a: CriterionFact, b: CriterionFact) => tierOf(a) - tierOf(b) || a.key.localeCompare(b.key);

// --------------------------------------------------------------------------- startup values

function startupValues(profile: ProfileContent, field: ConstraintField): string[] {
	const get = <T,>(k: { state: string; value?: T }) => (k.state === "provided" ? (k as { value: T }).value : undefined);
	switch (field) {
		case "stage": {
			const raising = get<string>(profile.fundraisingStage);
			const current = get<string>(profile.currentStage);
			return raising ? [raising] : current ? [current] : [];
		}
		case "sector":
			return get<string[]>(profile.sectors) ?? [];
		case "business_model":
			return get<string[]>(profile.businessModels) ?? [];
		case "geography": {
			const hq = get<string>(profile.headquarters);
			return [...new Set([...(hq ? [hq] : []), ...(get<string[]>(profile.targetMarkets) ?? [])])];
		}
		case "check_size":
			return [];
	}
}

const raiseOf = (profile: ProfileContent) => (profile.targetRaise.state === "provided" ? profile.targetRaise.value : null);
function raiseBounds(r: { minUsd: number | null; maxUsd: number | null }) {
	const lo = r.minUsd ?? r.maxUsd;
	const hi = r.maxUsd ?? r.minUsd;
	return lo === null || hi === null ? null : { lo, hi };
}

// --------------------------------------------------------------------------- A. mandate

function unknownConstraint(field: ConstraintField, startupValue: string, reason: NonNullable<ConstraintResult["unknownReason"]>, rationale: string, facts: CriterionFact[], conflictIds: string[] = []): ConstraintResult {
	return { field, status: "unknown", strength: null, startupValue, rationale, unknownReason: reason, decidedBy: null, considered: considered(facts), conflictIds, notes: [] };
}

function evaluateField(field: ConstraintField, profile: ProfileContent, snapshot: InvestorSnapshot): ConstraintResult {
	const facts = snapshot.facts.filter((f) => f.field === field && live(f)).sort(byTier);
	const openConflicts = [...new Set(facts.flatMap((f) => f.conflictIds))].sort();
	const hasApproved = facts.some(approved);

	if (field === "check_size") return evaluateCheckSize(profile, facts, openConflicts, hasApproved);

	return evaluateSetField(field, startupValues(profile, field), facts, openConflicts, hasApproved);
}

function evaluateSetField(field: Exclude<ConstraintField, "check_size">, values: string[], facts: CriterionFact[], openConflicts: string[], hasApproved: boolean): ConstraintResult {
	const covers = COVERS[field]!;
	const shown = values.map(label).join(", ");
	const excludes = facts.filter((f) => f.polarity === "exclude");
	const includes = facts.filter((f) => f.polarity === "include");
	const notes: string[] = [];
	if (!values.length) return unknownConstraint(field, "", "startup_field_missing", `The startup profile does not state its ${label(field)}, so this cannot be compared. This is not a mismatch.`, facts);

	// Exclusions come first: an investor saying "we do not invest in X" is a stronger statement than a list that omits X.
	const hitExclude = excludes.find((e) => values.some((v) => covers(e.value, v)));
	if (hitExclude) {
		const hard = authoritative(hitExclude);
		return {
			field,
			status: "incompatible",
			strength: hard ? "hard" : "soft",
			startupValue: shown,
			rationale: hard
				? `${hitExclude.publisher} excludes ${label(field)} "${hitExclude.label}" (${AUTH_TEXT[hitExclude.authority]}), which the startup's ${shown} falls under.`
				: `A source excludes ${label(field)} "${hitExclude.label}", but it is ${AUTH_TEXT[hitExclude.authority]}${hitExclude.freshness === "stale" ? " and out of date" : ""}${hitExclude.conflictIds.length ? " and in an open conflict" : ""}. Confirm before ruling this investor out.`,
			unknownReason: null,
			decidedBy: decided(hitExclude),
			considered: considered(facts),
			conflictIds: openConflicts,
			notes: hard ? [] : ["Not authoritative enough to eliminate the investor on its own."],
		};
	}

	if (!includes.length) return unknownConstraint(field, shown, "no_criterion", `No ${label(field)} criterion is known for this investor. Unknown is not a mismatch.`, facts, openConflicts);

	// Unresolved disagreement among non-approved sources is shown, not settled.
	if (openConflicts.length && !hasApproved) {
		const matched = includes.filter((f) => values.some((v) => covers(f.value, v)));
		return unknownConstraint(field, shown, "sources_conflict", `Sources disagree about this investor's ${label(field)} and nothing approved settles it${matched.length ? ` (some sources would match ${shown}, others would not)` : ""}. Left unresolved.`, facts, openConflicts);
	}
	if (openConflicts.length) notes.push("There is an open conflict about this field; the approved value is used and the disagreement stays visible.");

	const tiers = [0, 1, 2] as const;
	for (const t of tiers) {
		const tier = includes.filter((f) => tierOf(f) === t);
		if (!tier.length) continue;
		const hit = tier.find((f) => values.some((v) => covers(f.value, v)));
		if (hit) {
			const inferred = patternOnly(hit);
			return {
				field,
				status: "compatible",
				strength: null,
				startupValue: shown,
				rationale: `${hit.publisher} lists ${label(field)} "${hit.label}" (${AUTH_TEXT[hit.authority]}); the startup's ${shown} matches.`,
				unknownReason: null,
				decidedBy: decided(hit),
				considered: considered(facts),
				conflictIds: openConflicts,
				notes: [...notes, ...(inferred ? ["Based on a pattern, not a stated policy: weak support."] : []), ...(t === 2 && !inferred ? ["Not from the investor itself."] : [])],
			};
		}
		// A tier of explicit statements that omits the startup is a mismatch; a tier of observations or inferences never is.
		if (t < 2) {
			const hard = t === 0 && field === "stage";
			const first = tier[0]!;
			return {
				field,
				status: "incompatible",
				strength: hard ? "hard" : "soft",
				startupValue: shown,
				rationale: hard
					? `${first.publisher}'s stated ${label(field)} (${tier.map((f) => f.label).join(", ")}; ${AUTH_TEXT[first.authority]}) does not include ${shown}.`
					: t === 0
						? `${first.publisher} states a focus on ${tier.map((f) => f.label).join(", ")} (${AUTH_TEXT[first.authority]}), which does not include ${shown}. A stated focus is not always an exclusion: confirm before ruling this investor out.`
						: `A source says ${tier.map((f) => f.label).join(", ")} (${AUTH_TEXT[first.authority]}), which does not include ${shown}. It is not from the investor itself: confirm before ruling this investor out.`,
				unknownReason: null,
				decidedBy: decided(first),
				considered: considered(facts),
				conflictIds: openConflicts,
				notes: [...notes, ...(hard ? [] : ["Treated as an apparent mismatch to confirm, not an elimination."])],
			};
		}
	}
	return unknownConstraint(field, shown, "only_inferred", `Only observed or inferred patterns exist for this investor's ${label(field)}. They do not establish a policy, so this is unknown rather than a mismatch.`, facts, openConflicts);
}

function evaluateCheckSize(profile: ProfileContent, facts: CriterionFact[], openConflicts: string[], hasApproved: boolean): ConstraintResult {
	const raise = raiseOf(profile);
	const b = raise ? raiseBounds(raise) : null;
	const field = "check_size" as const;
	if (!raise || !b) return unknownConstraint(field, "", "startup_field_missing", "The startup profile does not state a target raise, so the investor's check size cannot be compared. This is not a mismatch.", facts);
	const shown = rangeLabel(raise);
	const includes = facts.filter((f) => f.polarity === "include" && f.valueRange);
	if (!includes.length) return unknownConstraint(field, shown, "no_criterion", "No check-size criterion is known for this investor. Unknown is not a mismatch.", facts, openConflicts);
	if (openConflicts.length && !hasApproved) return unknownConstraint(field, shown, "sources_conflict", "Sources disagree about this investor's check size and nothing approved settles it. Left unresolved.", facts, openConflicts);
	for (const t of [0, 1, 2] as const) {
		const tier = includes.filter((f) => tierOf(f) === t);
		if (!tier.length) continue;
		const fits = tier.find((f) => (f.valueRange!.minUsd ?? 0) <= b.hi);
		if (fits) {
			const r = fits.valueRange!;
			const smaller = r.maxUsd !== null && r.maxUsd < b.lo;
			return {
				field,
				status: "compatible",
				strength: null,
				startupValue: shown,
				rationale: `${fits.publisher}'s check size ${rangeLabel(r)} (${AUTH_TEXT[fits.authority]}) can sit within a ${shown} round.`,
				unknownReason: null,
				decidedBy: decided(fits),
				considered: considered(facts),
				conflictIds: openConflicts,
				notes: [...(smaller ? ["A single check of this size is smaller than the whole round: other investors would be needed. Whether this investor leads is not known."] : []), ...(patternOnly(fits) ? ["Based on a pattern, not a stated policy: weak support."] : [])],
			};
		}
		if (t < 2) {
			const first = tier[0]!;
			const hard = t === 0;
			return {
				field,
				status: "incompatible",
				strength: hard ? "hard" : "soft",
				startupValue: shown,
				rationale: `${first.publisher}'s minimum check ${formatUsd(first.valueRange!.minUsd)} (${AUTH_TEXT[first.authority]}) is larger than the whole ${shown} round.`,
				unknownReason: null,
				decidedBy: decided(first),
				considered: considered(facts),
				conflictIds: openConflicts,
				notes: hard ? [] : ["Not authoritative enough to eliminate the investor on its own: confirm first."],
			};
		}
	}
	return unknownConstraint(field, shown, "only_inferred", "Only observed or inferred check sizes exist. They do not establish a policy, so this is unknown rather than a mismatch.", facts, openConflicts);
}

export function evaluateMandate(profile: ProfileContent, snapshot: InvestorSnapshot, investorKey: string): MandateResult {
	const constraints = CORE_FIELDS.map((f) => evaluateField(f, profile, snapshot));
	const solid = constraints.filter((c) => c.status === "compatible" && c.decidedBy && !patternOnly({ authority: c.decidedBy.authority } as CriterionFact));
	const counts = {
		compatible: constraints.filter((c) => c.status === "compatible").length,
		incompatible: constraints.filter((c) => c.status === "incompatible").length,
		unknown: constraints.filter((c) => c.status === "unknown").length,
		hard: constraints.filter((c) => c.strength === "hard").length,
		soft: constraints.filter((c) => c.strength === "soft").length,
	};
	const eliminatedBy = constraints.filter((c) => c.strength === "hard").map((c) => `${label(c.field)}: ${c.rationale}`);
	const excluded = profile.investorExclusions.map((d) => d.toLowerCase()).includes(investorKey.toLowerCase());
	let summary: MandateResult["summary"];
	let statement: string;
	if (counts.hard) {
		summary = "eliminated";
		statement = `Ruled out by ${counts.hard} authoritative ${counts.hard > 1 ? "criteria" : "criterion"}: ${constraints.filter((c) => c.strength === "hard").map((c) => label(c.field)).join(", ")}.`;
	} else if (counts.soft) {
		summary = "possible_mismatch";
		statement = `${counts.soft} apparent mismatch${counts.soft > 1 ? "es" : ""} to confirm (${constraints.filter((c) => c.strength === "soft").map((c) => label(c.field)).join(", ")}); none is authoritative enough to rule the investor out.`;
	} else if (solid.length >= 2) {
		summary = "compatible_on_known";
		statement = `Compatible on the ${solid.length} criteria that could be checked; ${counts.unknown} other${counts.unknown === 1 ? " is" : "s are"} unknown. Nothing found is not the same as nothing there.`;
	} else if (counts.compatible >= 1) {
		summary = "partially_assessed";
		statement = `Only ${counts.compatible} criterion could be checked with support; ${counts.unknown} unknown. Too little is known to call this a fit.`;
	} else {
		summary = "unknown";
		statement = "Nothing could be checked: the investor's criteria or the startup's profile fields are unknown. This is not a mismatch.";
	}
	return { summary, statement, constraints, counts, eliminatedBy, founderExcluded: excluded };
}

// --------------------------------------------------------------------------- C. evidence quality

const METRIC_OF: Partial<Record<ProfileMetric, string>> = { arr: "arr", mrr: "mrr", revenue_growth_pct: "revenue_growth_pct", gross_margin_pct: "gross_margin_pct", net_revenue_retention_pct: "net_revenue_retention_pct", customers: "customers", runway_months: "runway_months", team_size: "team_size" };
const METRIC_LABEL: Record<ProfileMetric, string> = { arr: "Annual recurring revenue", mrr: "Monthly recurring revenue", revenue_growth_pct: "Revenue growth", gross_margin_pct: "Gross margin", net_revenue_retention_pct: "Net revenue retention", customers: "Customers", runway_months: "Runway", team_size: "Team size" };
export const metricLabel = (k: ProfileMetric) => METRIC_LABEL[k];

const relDiff = (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-9);

export function evaluateEvidenceQuality(profile: ProfileContent, evidence: MatchEvidence[], now: string): EvidenceQualityResult {
	const active = evidence.filter((e) => !e.superseded);
	const nowMs = Date.parse(now);
	const claims: ClaimQuality[] = [];
	const assess = (field: string, claim: string, known: { provenance: FieldProvenance }, metric?: { key: string; value: number }) => {
		const linked = new Map<string, MatchEvidence>();
		for (const id of known.provenance.evidenceIds) {
			const e = active.find((x) => x.id === id);
			if (e) linked.set(e.id, e);
		}
		if (metric) for (const e of active) if (e.metric?.key === metric.key) linked.set(e.id, e);
		const items = [...linked.values()].sort((a, b) => a.id.localeCompare(b.id));
		const documents = items.filter((e) => e.documentId);
		const disagrees = metric ? items.filter((e) => e.metric?.key === metric.key && relDiff(e.metric.value, metric.value) > 0.1) : [];
		let quality: EvidenceQuality;
		let detail: string;
		if (items.some((e) => e.effectiveVerification === "contradicted") || disagrees.length) {
			quality = "conflicting";
			detail = disagrees.length ? `The profile says ${metric!.value}, but linked evidence says ${disagrees.map((e) => e.metric!.value).join(" / ")}.` : "Linked evidence conflicts with other evidence.";
		} else if (items.some((e) => e.effectiveVerification === "reviewer_verified")) {
			quality = "reviewer_verified";
			detail = "A reviewer verified this directly.";
		} else if (items.some((e) => e.effectiveVerification === "corroborated")) {
			quality = "corroborated";
			detail = "An independent source agrees.";
		} else if (documents.length) {
			quality = "supplied_by_founder";
			detail = "Stated in a document the founders supplied. A document being present does not make the statement true; no independent source has been compared.";
		} else if (known.provenance.basis === "official_public_source" || known.provenance.basis === "third_party_source") {
			quality = "source_cited";
			detail = `The founders cite ${known.provenance.basis === "official_public_source" ? "a public source" : "a third-party source"}${known.provenance.sourceUrl ? ` (${known.provenance.sourceUrl})` : ""}. The system has not fetched or checked it.`;
		} else {
			quality = "founder_assertion";
			detail = "The founders' own statement; no supporting evidence is linked.";
		}
		const dated = items.filter((e) => e.documentId || e.effectiveVerification === "reviewer_verified");
		const stale = dated.length > 0 && dated.every((e) => nowMs - Date.parse(e.createdAt) > EVIDENCE_STALE_DAYS * DAY);
		claims.push({ claim, field, declaredBasis: known.provenance.basis, quality, stale, evidenceIds: items.map((e) => e.id), detail: stale ? `${detail} The supporting evidence is more than ${EVIDENCE_STALE_DAYS} days old.` : detail });
	};
	const p = profile;
	if (p.currentStage.state === "provided") assess("currentStage", `Current stage: ${label(p.currentStage.value)}`, p.currentStage);
	if (p.fundraisingStage.state === "provided") assess("fundraisingStage", `Raising at: ${label(p.fundraisingStage.value)}`, p.fundraisingStage);
	if (p.sectors.state === "provided") assess("sectors", `Sector: ${p.sectors.value.map(label).join(", ")}`, p.sectors);
	if (p.targetRaise.state === "provided") assess("targetRaise", `Target raise ${rangeLabel(p.targetRaise.value)}`, p.targetRaise);
	if (p.revenueStatus.state === "provided") assess("revenueStatus", `Revenue status: ${label(p.revenueStatus.value)}`, p.revenueStatus);
	if (p.productStatus.state === "provided") assess("productStatus", `Product status: ${p.productStatus.value}`, p.productStatus);
	if (p.team.state === "provided") assess("team", "Founder and team experience", p.team);
	for (const key of Object.keys(p.metrics).sort() as ProfileMetric[]) {
		const m = p.metrics[key];
		if (m?.state === "provided") assess(`metrics.${key}`, `${METRIC_LABEL[key]}: ${m.value}`, m, { key: METRIC_OF[key] ?? key, value: m.value });
	}
	const zero = { reviewer_verified: 0, corroborated: 0, conflicting: 0, supplied_by_founder: 0, source_cited: 0, founder_assertion: 0 } satisfies Record<EvidenceQuality, number>;
	const counts = { ...zero, stale: claims.filter((c) => c.stale).length };
	for (const c of claims) counts[c.quality]++;
	const statement = !claims.length
		? "No claims are stated yet, so there is nothing to assess."
		: `${claims.length} claim${claims.length > 1 ? "s" : ""}: ${counts.reviewer_verified + counts.corroborated} independently supported, ${counts.supplied_by_founder} in founder documents only, ${counts.source_cited} citing an unchecked source, ${counts.founder_assertion} founder assertion only${counts.conflicting ? `, ${counts.conflicting} conflicting` : ""}${counts.stale ? `, ${counts.stale} with stale evidence` : ""}.`;
	return { claims, counts, statement };
}

// --------------------------------------------------------------------------- B. readiness

const REVENUE_METRICS: ProfileMetric[] = ["arr", "mrr", "revenue_growth_pct", "gross_margin_pct", "net_revenue_retention_pct"];
const RECURRING_MODELS = ["saas", "b2b"];

function metricOf(profile: ProfileContent, key: ProfileMetric) {
	const m = profile.metrics[key];
	return m?.state === "provided" ? m.value : m?.state === "not_applicable" ? "n/a" : undefined;
}
function revenueApplicable(profile: ProfileContent): { applicable: boolean; reason: string } {
	if (profile.revenueStatus.state === "provided" && profile.revenueStatus.value === "pre_revenue") return { applicable: false, reason: "The startup states it is pre-revenue." };
	if (profile.revenueStatus.state === "not_applicable") return { applicable: false, reason: "Revenue is marked not applicable." };
	const stage = profile.currentStage.state === "provided" ? profile.currentStage.value : null;
	if (stage === "pre_seed" && !(profile.revenueStatus.state === "provided" && profile.revenueStatus.value === "revenue_generating")) return { applicable: false, reason: "Revenue metrics are not expected at pre-seed." };
	return { applicable: true, reason: "" };
}

function item(id: string, text: string, basis: ReadinessItem["basis"], status: ReadinessStatus, detail: string, help: string, criterionKey: string | null = null): ReadinessItem {
	return { id, label: text, basis, criterionKey, status, detail, whatWouldHelp: help };
}

/** Investor-sourced traction expectations. A criterion says what the investor looks for; where it names no number, only presence is assessed. */
function investorReadiness(profile: ProfileContent, snapshot: InvestorSnapshot): ReadinessItem[] {
	const out: ReadinessItem[] = [];
	const rev = revenueApplicable(profile);
	for (const f of snapshot.facts.filter((x) => x.field === "traction" && x.polarity === "include" && live(x)).sort((a, b) => a.key.localeCompare(b.key))) {
		const id = `investor:${f.key}`;
		const src = `${f.publisher} (${AUTH_TEXT[f.authority]})`;
		const soft = patternOnly(f) ? " This is an observed or inferred pattern, not a stated requirement." : "";
		const num = (k: ProfileMetric) => metricOf(profile, k);
		switch (f.value) {
			case "paying_customers": {
				const c = num("customers");
				out.push(typeof c === "number" ? (c > 0 ? item(id, "Paying customers", "investor_criterion", "met", `${src} looks for paying customers; the profile states ${c}.${soft}`, "Customer references or invoices would corroborate the count.", f.key) : item(id, "Paying customers", "investor_criterion", "not_met", `${src} looks for paying customers; the profile states none.${soft}`, "Evidence of a first paying customer.", f.key)) : item(id, "Paying customers", "investor_criterion", "evidence_not_provided", `${src} looks for paying customers; the profile does not state a customer count.${soft}`, "State the number of paying customers, with an invoice export or customer reference.", f.key));
				break;
			}
			case "recurring_revenue": {
				const arr = num("arr");
				const mrr = num("mrr");
				const v = typeof arr === "number" ? arr : typeof mrr === "number" ? mrr : undefined;
				if (!rev.applicable && v === undefined) out.push(item(id, "Recurring revenue", "investor_criterion", "not_applicable", `${src} looks for recurring revenue. ${rev.reason}`, "None needed at this stage.", f.key));
				else out.push(v === undefined ? item(id, "Recurring revenue", "investor_criterion", "evidence_not_provided", `${src} looks for recurring revenue; the profile states neither ARR nor MRR.${soft}`, "State ARR or MRR with a billing export or financial statement.", f.key) : v > 0 ? item(id, "Recurring revenue", "investor_criterion", "met", `${src} looks for recurring revenue; the profile states ${typeof arr === "number" ? `ARR ${formatUsd(arr)}` : `MRR ${formatUsd(mrr as number)}`}.${soft}`, "A financial statement would corroborate it.", f.key) : item(id, "Recurring revenue", "investor_criterion", "not_met", `${src} looks for recurring revenue; the profile states none.${soft}`, "Evidence of recurring revenue.", f.key));
				break;
			}
			case "revenue_generating": {
				const any = [num("arr"), num("mrr")].find((x) => typeof x === "number" && x > 0);
				const stated = profile.revenueStatus.state === "provided" ? profile.revenueStatus.value : null;
				if (any !== undefined || stated === "revenue_generating") out.push(item(id, "Revenue", "investor_criterion", "met", `${src} looks for revenue; the profile states it is revenue-generating.${soft}`, "A financial statement would corroborate it.", f.key));
				else if (stated === "pre_revenue") out.push(item(id, "Revenue", "investor_criterion", "not_met", `${src} looks for revenue; the profile states the startup is pre-revenue.${soft}`, "Evidence of revenue, if there is any.", f.key));
				else out.push(item(id, "Revenue", "investor_criterion", "evidence_not_provided", `${src} looks for revenue; the profile does not say whether there is revenue.${soft}`, "State the revenue status and supporting figures.", f.key));
				break;
			}
			case "working_prototype": {
				const p = profile.productStatus.state === "provided" ? profile.productStatus.value : null;
				out.push(p === null ? item(id, "Working product", "investor_criterion", "evidence_not_provided", `${src} looks for a working prototype or MVP; the profile does not state product status.${soft}`, "State product status; a demo or release note would support it.", f.key) : p === "idea" ? item(id, "Working product", "investor_criterion", "not_met", `${src} looks for a working prototype or MVP; the profile states the product is at the idea stage.${soft}`, "A working prototype.", f.key) : item(id, "Working product", "investor_criterion", "met", `${src} looks for a working prototype or MVP; the profile states ${p}.${soft}`, "A demo, repository or release note would corroborate it.", f.key));
				break;
			}
			case "product_market_fit":
				out.push(item(id, "Product-market fit", "investor_criterion", "not_assessable", `${src} mentions product-market fit. It names no measurable threshold, so the system does not judge it.${soft}`, "Retention, repeat usage or customer references are what founders commonly show; which one this investor uses is not stated.", f.key));
				break;
			case "pre_revenue":
				out.push(item(id, "Pre-revenue companies", "investor_criterion", "not_applicable", `${src} says it invests in pre-revenue companies: not a requirement to meet.${soft}`, "None needed.", f.key));
				break;
			default:
				out.push(item(id, label(f.value), "investor_criterion", "not_assessable", `${src} mentions "${f.label}", which the system cannot assess automatically.${soft}`, "Read the source passage and judge directly.", f.key));
		}
	}
	return out;
}

/** The generic checklist. Never a statement about what a particular investor requires, and it contains no thresholds. */
function frameworkReadiness(profile: ProfileContent): ReadinessItem[] {
	const out: ReadinessItem[] = [];
	const rev = revenueApplicable(profile);
	const stage = profile.fundraisingStage.state === "provided" ? profile.fundraisingStage.value : profile.currentStage.state === "provided" ? profile.currentStage.value : null;
	const fw = (id: string, text: string, status: ReadinessStatus, detail: string, help: string) => out.push(item(`framework:${id}`, text, "general_framework", status, detail, help));
	fw("team", "Founder and team experience", profile.team.state === "provided" ? "met" : profile.team.state === "not_applicable" ? "not_applicable" : "evidence_not_provided", profile.team.state === "provided" ? "The profile describes the team's relevant experience." : "The profile does not describe team experience.", "Describe relevant experience; LinkedIn exports or references can support it.");
	const ps = profile.productStatus;
	fw("product", "Product maturity", ps.state === "provided" ? "met" : ps.state === "not_applicable" ? "not_applicable" : "evidence_not_provided", ps.state === "provided" ? `The profile states the product is at "${ps.value}".` : "The profile does not state product status.", "State product status; a demo or release note can support it.");
	const customers = metricOf(profile, "customers");
	fw("validation", "Customer validation", typeof customers === "number" ? "met" : customers === "n/a" ? "not_applicable" : "evidence_not_provided", typeof customers === "number" ? `The profile states ${customers} customers.` : "The profile gives no customer count or validation.", "A customer count, letters of intent or customer references.");
	const later = stage !== null && !["pre_seed", "seed"].includes(stage);
	for (const k of REVENUE_METRICS) {
		const recurringOnly = k === "net_revenue_retention_pct" || k === "arr" || k === "mrr";
		const models = profile.businessModels.state === "provided" ? profile.businessModels.value : [];
		const modelApplies = !recurringOnly || !models.length || models.some((m) => RECURRING_MODELS.includes(m));
		const v = metricOf(profile, k);
		const expectedAtStage = later || k === "arr" || k === "mrr";
		if (!rev.applicable) fw(k, METRIC_LABEL[k], "not_applicable", `${rev.reason} Not counted against the startup.`, "None needed.");
		else if (!modelApplies) fw(k, METRIC_LABEL[k], "not_applicable", "Not typical for the stated business model. Not counted against the startup.", "None needed.");
		else if (v === "n/a") fw(k, METRIC_LABEL[k], "not_applicable", "Marked not applicable by the founders.", "None needed.");
		else if (typeof v === "number") fw(k, METRIC_LABEL[k], "met", `The profile states ${v}.`, "A financial statement or billing export would corroborate it.");
		else if (expectedAtStage) fw(k, METRIC_LABEL[k], "evidence_not_provided", "The profile does not state it. This is missing evidence, not a failed requirement.", "State the figure with its source, or mark it not applicable.");
	}
	const runway = metricOf(profile, "runway_months");
	if (later) fw("runway", METRIC_LABEL.runway_months, typeof runway === "number" ? "met" : runway === "n/a" ? "not_applicable" : "evidence_not_provided", typeof runway === "number" ? `The profile states ${runway} months.` : "The profile does not state runway.", "State cash and monthly burn.");
	return out;
}

export function evaluateReadiness(profile: ProfileContent, snapshot: InvestorSnapshot): ReadinessResult {
	const items = [...investorReadiness(profile, snapshot), ...frameworkReadiness(profile)];
	const counts = { met: 0, not_met: 0, evidence_not_provided: 0, not_applicable: 0, not_assessable: 0 } satisfies Record<ReadinessStatus, number>;
	for (const i of items) counts[i.status]++;
	const inv = items.filter((i) => i.basis === "investor_criterion").length;
	const statement = `${inv ? `${inv} investor-sourced expectation${inv > 1 ? "s" : ""}` : "No investor-sourced traction expectations are known"}; ${items.length - inv} items from a generic checklist (not this investor's requirements). ${counts.met} met, ${counts.evidence_not_provided} without evidence provided, ${counts.not_met} not met, ${counts.not_applicable} not applicable.`;
	return { frameworkVersion: READINESS_FRAMEWORK_VERSION, items, counts, statement };
}

// --------------------------------------------------------------------------- D. coverage

export function evaluateCoverage(snapshot: InvestorSnapshot, mandate: MandateResult): CoverageResult {
	const fields = Object.fromEntries(
		CORE_FIELDS.map((f) => {
			const facts = snapshot.facts.filter((x) => x.field === f && live(x));
			const cov: FieldCoverage = facts.some(approved) ? "approved" : facts.some((x) => authoritative(x)) ? "stated" : facts.some(explicit) ? "reported" : facts.length ? "inferred" : "unknown";
			return [f, cov];
		}),
	) as Record<ConstraintField, FieldCoverage>;
	const values = Object.values(fields);
	const approvedCount = values.filter((v) => v === "approved").length;
	const flags: CoverageResult["flags"] = [];
	const liveFacts = snapshot.facts.filter(live);
	// A conflict on a field whose value is approved is already settled by that approval (reconciliation never lets another source override it): it stays visible in the explanation but does not make the investor look unresolved.
	const unsettled = snapshot.conflicts.filter((c) => !snapshot.facts.some((f) => f.field === c.field && approved(f) && live(f)));
	if (liveFacts.some((f) => f.lifecycle === "disputed" && !liveFacts.some((g) => g.field === f.field && approved(g))) || unsettled.some((c) => c.state === "disputed")) flags.push("disputed");
	if (snapshot.stale || (liveFacts.length > 0 && liveFacts.filter((f) => f.freshness === "fresh").length === 0)) flags.push("stale");
	if (unsettled.some((c) => c.state !== "accepted")) flags.push("conflicted");
	if (snapshot.stub) flags.push("stub");
	let level: CoverageResult["level"];
	if (approvedCount >= 3) level = "verified";
	else if (values.some((v) => v === "approved" || v === "stated")) level = "partially_verified";
	else if (values.some((v) => v === "reported")) level = "unverified_reports";
	else if (values.some((v) => v === "inferred")) level = "inferred";
	else level = "unknown";
	const assessed = mandate.counts.compatible + mandate.counts.incompatible;
	const limits = level === "unknown" || level === "inferred" || level === "unverified_reports" || assessed < 2 || flags.includes("conflicted");
	const text: Record<CoverageResult["level"], string> = {
		verified: "Most core criteria are approved by the investor or this workspace.",
		partially_verified: "Some criteria are approved or stated by the investor; others are unverified or unknown.",
		unverified_reports: "Criteria come from third-party or contributed reports, not the investor.",
		inferred: "Only patterns observed or inferred from past activity are known.",
		unknown: "Little or nothing is known about this investor's criteria.",
	};
	return { level, flags, fields, limitsPrecision: limits, statement: `${text[level]}${flags.length ? ` Flags: ${flags.join(", ")}.` : ""}${limits ? " Read the mandate result as a partial view." : ""}`, researchedAt: snapshot.lastResearchedAt };
}

// --------------------------------------------------------------------------- actions

const DISCLAIMER = "A recommendation about your materials, not a promise that doing it leads to investment.";
const aid = (kind: string, ref: string) => `act_${sha256Hex(`${kind}|${ref}`).slice(0, 16)}`;

export function buildActions(mandate: MandateResult, readiness: ReadinessResult, quality: EvidenceQualityResult, coverage: CoverageResult, snapshot: InvestorSnapshot): MatchAction[] {
	const out: MatchAction[] = [];
	const add = (kind: ActionKind, priority: number, title: string, why: string, dimension: MatchAction["finding"]["dimension"], ref: string) => out.push({ id: aid(kind, ref), kind, priority, title, why, finding: { dimension, ref }, disclaimer: DISCLAIMER });
	for (const c of mandate.constraints) {
		if (c.status === "incompatible") add("confirm_mismatch", c.strength === "hard" ? 1 : 2, `Confirm the ${label(c.field)} mismatch before ruling ${snapshot.name} out`, c.rationale, "mandate", `mandate:${c.field}`);
		if (c.status === "unknown" && c.unknownReason === "startup_field_missing") add("clarify_profile", 3, `State your ${label(c.field === "check_size" ? "target raise" : c.field)}`, `${snapshot.name}'s ${label(c.field)} cannot be compared until the profile states it.`, "mandate", `mandate:${c.field}`);
		if (c.unknownReason === "sources_conflict") add("review_criterion", 4, `Review conflicting sources on ${snapshot.name}'s ${label(c.field)}`, c.rationale, "coverage", `conflict:${c.field}`);
		if (c.decidedBy && (c.decidedBy.freshness === "stale" || c.decidedBy.lifecycle === "disputed" || patternOnly({ authority: c.decidedBy.authority } as CriterionFact)))
			add("review_criterion", 4, `Check ${snapshot.name}'s ${label(c.field)} criterion at its source`, `The criterion "${c.decidedBy.label}" is ${c.decidedBy.freshness === "stale" ? "out of date" : c.decidedBy.lifecycle === "disputed" ? "disputed" : "an inferred pattern"}; the result rests on it.`, "coverage", `criterion:${c.decidedBy.key}`);
	}
	for (const i of readiness.items) {
		if (i.status === "evidence_not_provided") add(i.basis === "investor_criterion" ? "add_evidence" : "clarify_profile", i.basis === "investor_criterion" ? 5 : 6, `${i.basis === "investor_criterion" ? "Add evidence" : "Consider adding"}: ${i.label}`, `${i.detail} ${i.whatWouldHelp}`, "readiness", i.id);
		if (i.status === "not_met" && i.basis === "investor_criterion") add("confirm_mismatch", 2, `Confirm "${i.label}" with ${snapshot.name}`, i.detail, "readiness", i.id);
	}
	for (const c of quality.claims) {
		if (c.quality === "conflicting") add("add_evidence", 3, `Resolve conflicting evidence: ${c.claim}`, c.detail, "evidence_quality", `claim:${c.field}`);
		else if (c.stale) add("add_evidence", 5, `Refresh stale evidence: ${c.claim}`, c.detail, "evidence_quality", `claim:${c.field}`);
		else if (c.quality === "founder_assertion" && /^metrics\./.test(c.field)) add("add_evidence", 6, `Support with a document: ${c.claim}`, c.detail, "evidence_quality", `claim:${c.field}`);
	}
	if (coverage.limitsPrecision) add("review_criterion", 7, `Treat ${snapshot.name}'s result as partial`, coverage.statement, "coverage", "coverage:limited");
	const seen = new Set<string>();
	return out
		.filter((a) => (seen.has(a.id) ? false : (seen.add(a.id), true)))
		.sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
}

// --------------------------------------------------------------------------- entry point

export function describeRelevance(profile: ProfileContent, snapshot: InvestorSnapshot, mandate: MandateResult): string[] {
	const out: string[] = [];
	for (const c of mandate.constraints) if (c.status === "compatible" && c.decidedBy) out.push(`${label(c.field)}: ${c.rationale}`);
	if (!out.length) out.push(mandate.summary === "unknown" ? "No criterion could be matched yet; this investor appears in the list only because it is in the directory." : "No compatible criterion was found.");
	void profile;
	void snapshot;
	return out;
}

export function evaluateMatch(input: MatchInput): MatchResult {
	const mandate = evaluateMandate(input.profile, input.investor, input.investorKey);
	const readiness = evaluateReadiness(input.profile, input.investor);
	const evidenceQuality = evaluateEvidenceQuality(input.profile, input.evidence, input.now);
	const coverage = evaluateCoverage(input.investor, mandate);
	const actions = buildActions(mandate, readiness, evidenceQuality, coverage, input.investor);
	return {
		mandate,
		readiness,
		evidenceQuality,
		coverage,
		relevance: describeRelevance(input.profile, input.investor, mandate),
		actions,
		labels: {
			sourcedFacts: "Investor criteria quoted from their sources, with the source's own category and verification status.",
			founderAssertions: "Statements in the startup profile; supported only as far as the evidence quality section says.",
			inferences: "Patterns observed or inferred from an investor's past activity. Never treated as a stated policy.",
			recommendations: "System-generated suggestions about your materials. They are not facts and not predictions.",
		},
	};
}

/** The order candidates are listed in. A sort key, not a score: it says nothing about likelihood of investment. */
export const MANDATE_ORDER: Record<MandateResult["summary"], number> = { compatible_on_known: 0, partially_assessed: 1, unknown: 2, possible_mismatch: 3, eliminated: 4 };
