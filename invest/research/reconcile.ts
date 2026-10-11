import { sha256Hex } from "../domain/canonical.ts";
import type { ClaimSignals, FieldReconciliation, LifecycleState, ReconciledClaim, ReconciliationConflict, SourceCategory } from "../domain/collab.ts";
import type { CriterionField } from "../domain/research.ts";

/**
 * Evidence-based reconciliation. It explains; it does not score.
 *
 * - No numeric confidence and no majority vote. Each claim keeps its own signals: category, how
 *   directly the subject is speaking, age, freshness, and how many *independent publishers* state the
 *   same value.
 * - An approved criterion (the workspace's, or a verified representative's) is never overridden. Claims
 *   that disagree with it become `conflicts_with_approved` and stay open until an authorised
 *   correction or a new approved version.
 * - Disagreement without a decisive signal stays an unresolved conflict. Unknown is a valid result.
 * - A person rejecting a claim removes it from consideration; accepting claims on both sides records
 *   that the difference was seen and kept.
 */
export type InClaim = {
	ref: ReconciledClaim["claimRef"];
	field: CriterionField;
	polarity: "include" | "exclude";
	value: string;
	valueRange: ReconciledClaim["valueRange"];
	label: string;
	category: SourceCategory;
	assertionType: "explicit" | "observed" | "inferred";
	/** Who published it, for display. */
	publisher: string;
	/** Who is speaking, for independence. The firm's own site and its verified representative are one speaker. Defaults to `publisher`. */
	publisherKey?: string;
	passage: string;
	url: string | null;
	publishedAt: string | null;
	capturedAt: string;
	lifecycle: LifecycleState;
	/** Set by the caller when a newer version from the same origin replaced this claim. */
	supersededBy: string | null;
};

export type InApproval = { label?: string; id: string; field: CriterionField; polarity: "include" | "exclude"; value: string; valueRange: ReconciledClaim["valueRange"]; authority: "workspace" | "firm_representative" };

const SET_FIELDS: ReadonlySet<CriterionField> = new Set(["stage", "sector", "geography", "business_model"]);
const DAY = 86_400_000;
const claimKey = (c: { ref: { kind: string; id: string } }) => `${c.ref.kind}:${c.ref.id}`;
const speaker = (c: { publisher: string; publisherKey?: string }) => c.publisherKey ?? c.publisher;
const overlaps = (a: NonNullable<InClaim["valueRange"]>, b: NonNullable<InClaim["valueRange"]>) => (a.maxUsd ?? Number.POSITIVE_INFINITY) >= (b.minUsd ?? 0) && (b.maxUsd ?? Number.POSITIVE_INFINITY) >= (a.minUsd ?? 0);

function directness(c: InClaim): ClaimSignals["directness"] {
	if (c.assertionType === "inferred") return "inferred_pattern";
	if (c.assertionType === "observed") return "observed_activity";
	if (c.category === "investor_verified" || c.category === "official_public_source") return "subject_stated";
	if (c.category === "third_party_source") return "reported_by_third_party";
	return "contributed";
}

const DIRECT_TEXT: Record<ClaimSignals["directness"], string> = {
	subject_stated: "stated by the firm itself",
	reported_by_third_party: "reported by a third party, not the firm's own statement",
	contributed: "a participant's own account",
	observed_activity: "observed from past activity, not a stated policy",
	inferred_pattern: "inferred from a pattern, not a stated policy",
};

/** A claim counts as a *statement of policy* when it is explicit; observed and inferred claims never conflict with stated policy by themselves. */
const statesPolicy = (c: InClaim) => c.assertionType === "explicit";
const active = (c: InClaim) => c.supersededBy === null && c.lifecycle !== "rejected";

export function reconcile(input: { claims: InClaim[]; approvals: InApproval[]; now: string; staleAfterDays: number }): FieldReconciliation[] {
	const { claims, approvals, now, staleAfterDays } = input;
	const nowMs = Date.parse(now);
	const live = claims.filter(active);
	// independent publishers per (field|polarity|value)
	const publishersFor = (c: InClaim) => new Set(live.filter((x) => x.field === c.field && x.polarity === c.polarity && x.value === c.value && x.assertionType !== "inferred").map(speaker));
	const byField = new Map<CriterionField, InClaim[]>();
	for (const c of claims) byField.set(c.field, [...(byField.get(c.field) ?? []), c]);
	for (const a of approvals) if (!byField.has(a.field)) byField.set(a.field, []);

	const out: FieldReconciliation[] = [];
	for (const [field, all] of byField) {
		const fieldLive = all.filter(active);
		const reasonsFor = (c: InClaim, signals: ClaimSignals): string[] => {
			const r = [`${c.category.replace(/_/g, " ")}: ${DIRECT_TEXT[signals.directness]}`];
			if (c.supersededBy) r.push("replaced by a newer version from the same source");
			if (signals.freshness === "stale") r.push(`last published or captured ${signals.ageDays} days ago`);
			else r.push(`${signals.ageDays <= 1 ? "published or captured today" : `${signals.ageDays} days old`}`);
			if (signals.corroboratedBy > 1) r.push(`${signals.corroboratedBy} independent publishers state this`);
			else if (c.assertionType !== "inferred") r.push("one publisher so far");
			if (c.category === "investor_verified") r.push("published by a verified representative of the firm");
			if (c.lifecycle === "accepted") r.push("accepted by a reviewer as evidence (not investor-verified)");
			if (c.lifecycle === "disputed") r.push("disputed by a reviewer");
			return r;
		};
		const reconciled: ReconciledClaim[] = all.map((c) => {
			const age = Math.max(0, Math.floor((nowMs - Date.parse(c.publishedAt ?? c.capturedAt)) / DAY));
			const signals: ClaimSignals = { category: c.category, assertionType: c.assertionType, directness: directness(c), publishedAt: c.publishedAt, capturedAt: c.capturedAt, ageDays: age, freshness: age > staleAfterDays ? "stale" : "fresh", corroboratedBy: active(c) ? publishersFor(c).size : 0 };
			return { key: claimKey(c), claimRef: c.ref, field: c.field, polarity: c.polarity, value: c.value, valueRange: c.valueRange, label: c.label, publisher: c.publisher, passage: c.passage, url: c.url, signals, lifecycle: c.supersededBy ? "superseded" : c.lifecycle, supersededBy: c.supersededBy, reasons: reasonsFor(c, signals) };
		});
		const byKey = new Map(reconciled.map((r) => [r.key, r]));

		const conflicts: ReconciliationConflict[] = [];
		const addConflict = (kind: ReconciliationConflict["kind"], summary: string, keys: string[], approvalIds: string[], reasons: string[]) => {
			const sorted = [...keys].sort();
			const id = `cf_${sha256Hex([field, kind, sorted.join(","), approvalIds.sort().join(",")].join("|")).slice(0, 20)}`;
			if (conflicts.some((c) => c.id === id)) return;
			const states = sorted.map((k) => byKey.get(k)?.lifecycle);
			const reviewState = states.some((s) => s === "disputed") ? "disputed" : states.length && states.every((s) => s === "accepted") ? "accepted" : "unresolved";
			conflicts.push({ id, kind, field, summary, claimKeys: sorted, approvalIds, reviewState, reasons });
		};
		const policy = fieldLive.filter(statesPolicy);
		// include vs exclude on the same value
		for (const ex of policy.filter((c) => c.polarity === "exclude"))
			for (const inc of policy.filter((c) => c.polarity === "include" && c.value === ex.value))
				addConflict("include_vs_exclude", `${ex.publisher} excludes ${field.replace(/_/g, " ")} "${ex.label}" while ${inc.publisher} includes it.`, [claimKey(ex), claimKey(inc)], [], ["opposite statements about the same value", "no decisive signal: both are current"]);
		// check size
		const sizes = policy.filter((c) => c.field === "check_size" && c.polarity === "include" && c.valueRange);
		for (let i = 0; i < sizes.length; i++)
			for (let j = i + 1; j < sizes.length; j++) {
				const a = sizes[i]!;
				const b = sizes[j]!;
				if (speaker(a) !== speaker(b) && !overlaps(a.valueRange!, b.valueRange!)) addConflict("check_size_differs", `${a.publisher} says ${a.label}; ${b.publisher} says ${b.label}.`, [claimKey(a), claimKey(b)], [], ["the ranges do not overlap", "different publishers"]);
			}
		// disjoint sets from different publishers
		if (SET_FIELDS.has(field)) {
			const byPub = new Map<string, InClaim[]>();
			for (const c of policy.filter((x) => x.polarity === "include")) byPub.set(speaker(c), [...(byPub.get(speaker(c)) ?? []), c]);
			const pubs = [...byPub.entries()];
			for (let i = 0; i < pubs.length; i++)
				for (let j = i + 1; j < pubs.length; j++) {
					const [pa, ca] = pubs[i]!;
					const [pb, cb] = pubs[j]!;
					const va = new Set(ca.map((c) => c.value));
					if (cb.some((c) => va.has(c.value))) continue;
					addConflict("values_differ", `${pa} lists ${[...va].map((v) => v.replace(/_/g, " ")).join(", ")}; ${pb} lists ${[...new Set(cb.map((c) => c.value))].map((v) => v.replace(/_/g, " ")).join(", ")}. They share no ${field.replace(/_/g, " ")}.`, [...ca, ...cb].map(claimKey), [], ["two publishers state disjoint sets", "a firm can invest in several; the sources cannot both be a complete list"]);
				}
		}
		// against approvals: never overridden
		const fieldApprovals = approvals.filter((a) => a.field === field);
		for (const ap of fieldApprovals) {
			for (const c of policy) {
				const differs =
					(ap.field === "check_size" && ap.valueRange && c.valueRange && c.polarity === "include" && !overlaps(ap.valueRange, c.valueRange)) ||
					(ap.polarity === "include" && c.polarity === "exclude" && c.value === ap.value) ||
					(ap.polarity === "exclude" && c.polarity === "include" && c.value === ap.value);
				if (differs) addConflict("conflicts_with_approved", `${c.publisher} (${c.category.replace(/_/g, " ")}) disagrees with the ${ap.authority === "firm_representative" ? "firm representative's" : "workspace-approved"} ${field.replace(/_/g, " ")}. The approved value stands.`, [claimKey(c)], [ap.id], ["approved values are never overridden by other sources", "an authorised correction or a new approved version is needed"]);
			}
		}

		const fieldPublishers = new Set(fieldLive.filter((c) => c.assertionType !== "inferred").map(speaker));
		const corroborated = fieldLive.some((c) => c.assertionType !== "inferred" && publishersFor(c).size >= 2);
		const open = conflicts.filter((c) => c.reviewState !== "accepted");
		const explanation: string[] = [];
		for (const ap of fieldApprovals) explanation.push(`${ap.authority === "firm_representative" ? "Approved by a verified firm representative" : "Approved by this workspace"}: ${(ap.label ?? ap.value).replace(/_/g, " ")}. Other sources do not override it.`);
		if (!fieldLive.length) explanation.push("No current claims: unknown.");
		else if (open.length) explanation.push(`${open.length} unresolved conflict(s); nothing was resolved automatically.`);
		else if (corroborated) explanation.push("Independent publishers agree on at least one value.");
		else explanation.push(`${fieldPublishers.size || 1} publisher(s); not independently corroborated.`);
		out.push({ field, status: open.length ? "conflicted" : corroborated ? "agreed" : "single_source", claims: reconciled.sort((a, b) => a.value.localeCompare(b.value) || a.publisher.localeCompare(b.publisher)), conflicts, approved: fieldApprovals.map((a) => ({ id: a.id, authority: a.authority, value: a.label ?? a.value })), explanation });
	}
	return out.sort((a, b) => a.field.localeCompare(b.field));
}
