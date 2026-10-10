import type { Conflict, FirmApproval, ResearchCriterion } from "../domain/research.ts";

/**
 * Conflicts are derived, never resolved: two sources disagreeing, or research disagreeing with a
 * value an investor approved, are surfaced for a human. Nothing here chooses a winner.
 */
type C = Pick<ResearchCriterion, "id" | "field" | "polarity" | "value" | "valueRange" | "assertionType" | "sourceId">;

const overlaps = (a: { minUsd: number | null; maxUsd: number | null }, b: { minUsd: number | null; maxUsd: number | null }) =>
	(a.maxUsd ?? Number.POSITIVE_INFINITY) >= (b.minUsd ?? 0) && (b.maxUsd ?? Number.POSITIVE_INFINITY) >= (a.minUsd ?? 0);

/** The field/value an exclusion criterion refers to, e.g. "sector:crypto_web3". */
function excluded(c: C): { field: string; value: string } | null {
	if (c.polarity !== "exclude") return null;
	const [field, ...rest] = c.value.split(":");
	return field && rest.length ? { field, value: rest.join(":") } : null;
}

export function detectConflicts(criteria: C[], approvedCurrent: Pick<FirmApproval, "id" | "field" | "polarity" | "value" | "valueRange">[]): Conflict[] {
	const out: Conflict[] = [];
	const included = criteria.filter((c) => c.polarity === "include");
	for (const ex of criteria) {
		const target = excluded(ex);
		if (!target) continue;
		const hit = included.filter((c) => c.field === target.field && c.value === target.value);
		if (hit.length)
			out.push({
				kind: "include_vs_exclude",
				field: target.field as Conflict["field"],
				value: target.value,
				criterionIds: [ex.id, ...hit.map((h) => h.id)],
				approvalIds: [],
				message: `Sources both include and exclude ${target.field.replace(/_/g, " ")} "${target.value.replace(/_/g, " ")}".`,
			});
	}
	const sizes = included.filter((c) => c.field === "check_size" && c.valueRange);
	for (let i = 0; i < sizes.length; i++)
		for (let j = i + 1; j < sizes.length; j++) {
			const a = sizes[i]!;
			const b = sizes[j]!;
			if (a.value === b.value || a.sourceId === b.sourceId) continue;
			if (!overlaps(a.valueRange!, b.valueRange!))
				out.push({ kind: "check_size_differs", field: "check_size", value: `${a.value} vs ${b.value}`, criterionIds: [a.id, b.id], approvalIds: [], message: "Two sources state check sizes that do not overlap." });
		}
	// Against investor-approved values: surfaced, never overwritten.
	for (const ap of approvedCurrent) {
		if (ap.field === "check_size" && ap.valueRange) {
			for (const c of sizes) if (!overlaps(ap.valueRange, c.valueRange!)) out.push({ kind: "differs_from_approved", field: "check_size", value: c.value, criterionIds: [c.id], approvalIds: [ap.id], message: "Researched check size does not overlap the approved check size." });
			continue;
		}
		if (ap.polarity === "include") {
			for (const ex of criteria) {
				const t = excluded(ex);
				if (t && t.field === ap.field && t.value === ap.value) out.push({ kind: "exclusion_of_approved", field: ap.field, value: ap.value, criterionIds: [ex.id], approvalIds: [ap.id], message: `Research says the firm excludes ${ap.field.replace(/_/g, " ")} "${ap.value.replace(/_/g, " ")}", which is approved as included.` });
			}
		} else {
			for (const c of included) if (c.field === ap.field && c.value === ap.value) out.push({ kind: "differs_from_approved", field: ap.field, value: ap.value, criterionIds: [c.id], approvalIds: [ap.id], message: `Research says the firm includes ${ap.field.replace(/_/g, " ")} "${ap.value.replace(/_/g, " ")}", which is approved as excluded.` });
		}
	}
	return out;
}
