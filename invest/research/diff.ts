import type { Conflict, CriterionField, FindingKind, FirmApproval, ResearchCriterion } from "../domain/research.ts";
import { detectConflicts } from "./conflicts.ts";

/**
 * Claim-level comparison between what was current before a run and what is current after it.
 * Compares extracted claims, never page hashes: a menu, timestamp or formatting change produces
 * no finding. Nothing here edits a criterion or an approval; a finding is a proposal for a human.
 */
type C = Pick<ResearchCriterion, "id" | "field" | "polarity" | "value" | "valueRange" | "assertionType" | "sourceId" | "passage" | "label">;
type A = Pick<FirmApproval, "id" | "field" | "polarity" | "value" | "valueRange">;

export type FindingDraft = {
	kind: FindingKind;
	severity: "material" | "informational";
	subjectKey: string;
	subject: { field: CriterionField; value: string; polarity: "include" | "exclude" | null };
	summary: string;
	previousIds: string[];
	newIds: string[];
	approvalIds: string[];
};

const keyOf = (c: Pick<C, "field" | "polarity" | "value">) => `${c.field}|${c.polarity}|${c.value}`;
const human = (c: Pick<C, "field" | "value" | "label">) => `${c.field.replace(/_/g, " ")} "${c.label || c.value.replace(/_/g, " ")}"`;
const target = (c: C): { field: string; value: string } | null => {
	if (c.polarity !== "exclude") return null;
	const [field, ...rest] = c.value.split(":");
	return field && rest.length ? { field, value: rest.join(":") } : null;
};
const isThesis = (c: C) => c.assertionType === "explicit" && c.field !== "application_requirements";

export function diffClaims(input: { previous: C[]; next: C[]; reReadSourceIds: ReadonlySet<string>; approvals: A[] }): FindingDraft[] {
	const { previous, next, reReadSourceIds, approvals } = input;
	const drafts: FindingDraft[] = [];
	const prevKeys = new Map<string, C[]>();
	for (const c of previous.filter(isThesis)) prevKeys.set(keyOf(c), [...(prevKeys.get(keyOf(c)) ?? []), c]);
	const nextKeys = new Map<string, C[]>();
	for (const c of next.filter(isThesis)) nextKeys.set(keyOf(c), [...(nextKeys.get(keyOf(c)) ?? []), c]);
	const approvalsFor = (field: string, value: string) => approvals.filter((a) => a.field === field && a.value === value).map((a) => a.id);
	const handled = new Set<string>();

	for (const [key, cs] of nextKeys) {
		if (prevKeys.has(key)) continue;
		const c = cs[0]!;
		const t = target(c);
		const subjectField = (t?.field ?? c.field) as CriterionField;
		const subjectValue = t?.value ?? c.value;
		if (c.field === "check_size") {
			const olds = [...prevKeys.values()].flat().filter((p) => p.field === "check_size" && p.polarity === "include");
			if (olds.length) {
				for (const o of olds) handled.add(keyOf(o));
				drafts.push({ kind: "thesis_modification", severity: "material", subjectKey: "check_size", subject: { field: "check_size", value: "check_size", polarity: "include" }, summary: `Published check size changed from ${olds.map((o) => o.label).join(", ")} to ${cs.map((n) => n.label).join(", ")}.`, previousIds: olds.map((o) => o.id), newIds: cs.map((n) => n.id), approvalIds: approvals.filter((a) => a.field === "check_size").map((a) => a.id) });
				continue;
			}
		}
		const opposite = t ? [...prevKeys.values()].flat().filter((p) => p.polarity === "include" && p.field === t.field && p.value === t.value) : [...prevKeys.values()].flat().filter((p) => { const pt = target(p); return pt && pt.field === c.field && pt.value === c.value; });
		if (opposite.length) {
			drafts.push({ kind: "thesis_contradiction", severity: "material", subjectKey: `${subjectField}:${subjectValue}`, subject: { field: subjectField, value: subjectValue, polarity: null }, summary: t ? `A source now says the firm does not invest in ${human(c)}, which was previously stated as included.` : `A source now says the firm invests in ${human(c)}, which was previously stated as excluded.`, previousIds: opposite.map((o) => o.id), newIds: cs.map((n) => n.id), approvalIds: approvalsFor(subjectField, subjectValue) });
			continue;
		}
		drafts.push({ kind: "thesis_addition", severity: "material", subjectKey: keyOf(c), subject: { field: subjectField, value: subjectValue, polarity: c.polarity }, summary: t ? `New exclusion stated: ${human(c)}.` : `New criterion stated: ${human(c)}.`, previousIds: [], newIds: cs.map((n) => n.id), approvalIds: approvalsFor(subjectField, subjectValue) });
	}

	for (const [key, cs] of prevKeys) {
		if (nextKeys.has(key) || handled.has(key)) continue;
		// Only a page that was read again can have dropped a statement. A page that could not be read has said nothing.
		const gone = cs.filter((c) => reReadSourceIds.has(c.sourceId));
		if (!gone.length) continue;
		if (drafts.some((d) => d.kind === "thesis_contradiction" && d.previousIds.some((id) => gone.some((g) => g.id === id)))) continue;
		const c = gone[0]!;
		const t = target(c);
		drafts.push({ kind: "thesis_retraction", severity: "material", subjectKey: keyOf(c), subject: { field: (t?.field ?? c.field) as CriterionField, value: t?.value ?? c.value, polarity: c.polarity }, summary: `The statement ${human(c)} no longer appears on the page that carried it. This does not show the firm's policy changed.`, previousIds: gone.map((g) => g.id), newIds: [], approvalIds: approvalsFor(t?.field ?? c.field, t?.value ?? c.value) });
	}

	const before = detectConflicts(previous.filter(isThesis), approvals);
	const sig = (c: Conflict) => `${c.kind}|${c.field}|${c.value}|${[...c.approvalIds].sort().join(",")}`;
	const known = new Set(before.map(sig));
	for (const conflict of detectConflicts(next.filter(isThesis), approvals)) {
		if (known.has(sig(conflict))) continue;
		if (drafts.some((d) => d.kind === "thesis_contradiction" && conflict.kind === "include_vs_exclude" && d.subject.field === conflict.field && d.subject.value === conflict.value)) continue;
		drafts.push({ kind: "thesis_conflict", severity: "material", subjectKey: `conflict|${sig(conflict)}`, subject: { field: conflict.field, value: conflict.value, polarity: null }, summary: `Unresolved conflict: ${conflict.message}`, previousIds: [], newIds: conflict.criterionIds, approvalIds: conflict.approvalIds });
	}

	const prevInferred = new Set(previous.filter((c) => c.assertionType === "inferred").map(keyOf));
	for (const c of next.filter((x) => x.assertionType === "inferred" && !prevInferred.has(keyOf(x)))) {
		drafts.push({ kind: "inferred_pattern", severity: "informational", subjectKey: keyOf(c), subject: { field: c.field, value: c.value, polarity: c.polarity }, summary: `A portfolio pattern now suggests ${human(c)}. This is an inference from past investments, not a stated policy.`, previousIds: [], newIds: [c.id], approvalIds: [] });
	}
	return drafts;
}
