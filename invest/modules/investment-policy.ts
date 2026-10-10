import {
	OUTCOMES,
	type Comparator,
	type Contradiction,
	type CriterionFinding,
	type DecisionKind,
	type EvaluationSummary,
	type FindingView,
	type HardGateState,
	type InvestmentCriterion,
	type ManifestEvidence,
	type Outcome,
	type ReviewAction,
	type ThesisSettings,
	type Uncertainty,
} from "../domain/types.ts";

/**
 * Deterministic investment policy. Pure functions only: given the frozen manifest and Jev's
 * recorded answer, these always produce the same finding, which is what lets `evaluation.verify`
 * recompute a stored evaluation independently. Model output never decides thresholds, hard
 * gates, evidence sufficiency, review routing, or whether a decision may be recorded.
 */
export const POLICY_VERSION = "invest-policy/1.0.1";

const RANK = { reviewer_verified: 3, independent: 2, founder_reported: 1 } as const;
const SYMBOL: Record<Comparator, string> = { gte: "≥", gt: ">", lte: "≤", lt: "<", eq: "=" };

const METRIC_LABEL: Record<string, string> = {
	arr: "ARR",
	mrr: "MRR",
	revenue: "revenue",
	revenue_growth_pct: "revenue growth",
	gross_margin_pct: "gross margin",
	net_revenue_retention_pct: "net revenue retention",
	customers: "customer count",
	monthly_burn: "monthly burn",
	runway_months: "runway",
	cash: "cash",
	team_size: "team size",
	funding_ask: "funding ask",
	pre_money_valuation: "pre-money valuation",
	tam: "TAM",
	churn_pct: "churn",
};
export const metricLabel = (key: string) => METRIC_LABEL[key] ?? key.replace(/_/g, " ");

export function compare(value: number, comparator: Comparator, threshold: number): boolean {
	switch (comparator) {
		case "gte":
			return value >= threshold;
		case "gt":
			return value > threshold;
		case "lte":
			return value <= threshold;
		case "lt":
			return value < threshold;
		case "eq":
			return Math.abs(value - threshold) <= Math.max(Math.abs(threshold), 1) * 1e-9;
	}
}

/** Counts toward an "independent evidence" standard: independent or reviewer-verified, or a founder claim an independent source corroborates. */
export function isIndependent(item: ManifestEvidence): boolean {
	return item.provenanceClass !== "founder_reported" || item.verification === "corroborated" || item.verification === "reviewer_verified";
}

export function formatValue(value: number, unit?: string): string {
	if (unit === "usd") {
		const abs = Math.abs(value);
		if (abs >= 1e9) return `$${+(value / 1e9).toFixed(2)}B`;
		if (abs >= 1e6) return `$${+(value / 1e6).toFixed(2)}M`;
		if (abs >= 1e3) return `$${+(value / 1e3).toFixed(1)}K`;
		return `$${value}`;
	}
	if (unit === "percent") return `${value}%`;
	if (unit === "months") return `${value} months`;
	return String(value);
}

export function hardGateFor(criterion: Pick<InvestmentCriterion, "hardGate">, outcome: Outcome): HardGateState {
	if (!criterion.hardGate) return "not_applicable";
	if (outcome === "contradicted") return "failed";
	if (outcome === "supported" || outcome === "not_applicable") return "passed";
	return "unresolved";
}

type Base = Omit<CriterionFinding, "id" | "workspaceId" | "evaluationId" | "configurationRef" | "createdAt" | "jev">;

function finish(criterion: InvestmentCriterion, partial: Omit<Base, "hardGate" | "criterionId" | "criterionName" | "mode" | "suggestedQuestions"> & { questions?: string[] }): Base {
	const hardGate = hardGateFor(criterion, partial.outcome);
	const reasons = [...partial.review.reasons];
	if (criterion.hardGate && hardGate !== "passed") reasons.push(hardGate === "failed" ? "Hard gate failed" : "Hard gate not established");
	if (partial.missingEvidence.length && criterion.missingEvidencePolicy === "review_required") reasons.push("Required evidence is missing (policy: review required)");
	const questions = [...(partial.questions ?? [])];
	for (const m of partial.missingEvidence) questions.push(`Request evidence of "${m}" for "${criterion.name}".`);
	for (const c of partial.contradictions)
		questions.push(`Reconcile conflicting ${metricLabel(c.metric)} figures (${c.values.map((v) => formatValue(v, c.metric.endsWith("_pct") ? "percent" : ["customers", "team_size"].includes(c.metric) ? "count" : c.metric === "runway_months" ? "months" : "usd")).join(" vs ")}) across ${c.evidenceIds.length} sources.`);
	const { questions: _q, ...rest } = partial;
	return {
		...rest,
		criterionId: criterion.id,
		criterionName: criterion.name,
		mode: criterion.evaluationMode,
		hardGate,
		review: { required: reasons.length > 0, reasons: [...new Set(reasons)] },
		suggestedQuestions: [...new Set(questions)].slice(0, 6),
	};
}

function contradictionsFor(items: ManifestEvidence[], all: Contradiction[]): Contradiction[] {
	const ids = new Set(items.map((i) => i.id));
	return all.filter((c) => c.evidenceIds.some((id) => ids.has(id)));
}

const NO_UNCERTAINTY: Uncertainty = { level: "not_applicable", selectedProbability: null, distribution: null };

/** Exact comparison of a metric against the criterion's threshold, in application code. */
export function evaluateDeterministic(criterion: InvestmentCriterion, projected: ManifestEvidence[], missing: string[], allContradictions: Contradiction[]): Base {
	const metric = criterion.metric!;
	const comparator = criterion.comparator!;
	const threshold = criterion.threshold!;
	// Strongest provenance first; among equally credible sources, the value least favourable to passing.
	const favour = comparator === "lte" || comparator === "lt" ? -1 : comparator === "eq" ? 0 : 1;
	const distance = (v: number) => (comparator === "eq" ? -Math.abs(v - threshold) : favour * v);
	const candidates = projected
		.filter((i) => i.metric?.key === metric)
		.sort(
			(a, b) =>
				RANK[b.provenanceClass] - RANK[a.provenanceClass] ||
				Number(isIndependent(b)) - Number(isIndependent(a)) ||
				distance(a.metric!.value) - distance(b.metric!.value) ||
				a.id.localeCompare(b.id),
		);
	const contradictions = contradictionsFor(candidates, allContradictions);
	const unit = candidates[0]?.metric?.unit ?? (metric.endsWith("_pct") ? "percent" : metric === "runway_months" ? "months" : ["customers", "team_size"].includes(metric) ? "count" : "usd");
	const requirementText = `${metricLabel(metric)} ${SYMBOL[comparator]} ${formatValue(threshold, unit)}`;
	if (!candidates.length) {
		return finish(criterion, {
			outcome: "insufficient_evidence",
			jevOutcome: null,
			explanation: `No source states ${metricLabel(metric)}; the requirement (${requirementText}) cannot be checked.`,
			evidenceRefs: [],
			missingEvidence: missing,
			contradictions: [],
			sufficiency: "missing",
			uncertainty: NO_UNCERTAINTY,
			review: { required: false, reasons: [] },
			deterministic: { metric, comparator, threshold, observedValue: null, sourceEvidenceId: null, passed: null },
			policyAdjustments: [],
		});
	}
	const best = candidates[0];
	const value = best.metric!.value;
	const passed = compare(value, comparator, threshold);
	const dissent = candidates.filter((c) => compare(c.metric!.value, comparator, threshold) !== passed);
	const adjustments: string[] = [];
	const reasons: string[] = [];
	const questions: string[] = [];
	let outcome: Outcome = passed ? "supported" : "contradicted";
	let sufficiency: Base["sufficiency"] = "met";
	const standard = criterion.evidenceStandard ?? "independent_required";
	if (passed && standard === "independent_required" && !isIndependent(best)) {
		outcome = "partially_supported";
		sufficiency = "founder_reported_only";
		adjustments.push("Threshold met only by a founder-reported figure that no independent source corroborates");
		questions.push(`Obtain independent confirmation of ${metricLabel(metric)} (${formatValue(value, best.metric!.unit)}, currently founder-reported).`);
	}
	if (dissent.length) {
		if (outcome === "supported") outcome = "partially_supported";
		adjustments.push(`${dissent.length} other source(s) give a value on the other side of the threshold`);
		reasons.push("Sources disagree on whether the threshold is met");
	} else if (contradictions.length) reasons.push("Sources report conflicting values for this metric");
	if (!passed) questions.push(`Confirm current ${metricLabel(metric)}: observed ${formatValue(value, best.metric!.unit)}, required ${requirementText}.`);
	return finish(criterion, {
		outcome,
		jevOutcome: null,
		explanation: `${best.provenanceClass === "founder_reported" ? "The company reports" : best.provenanceClass === "independent" ? "An independent source states" : "A reviewer verified"} ${metricLabel(metric)} of ${formatValue(value, best.metric!.unit)} (${best.location}); the requirement ${requirementText} is ${passed ? "met" : "not met"}.`,
		evidenceRefs: candidates.map((c) => c.id),
		missingEvidence: missing.filter((m) => m !== `metric:${metric}`),
		contradictions,
		sufficiency,
		uncertainty: NO_UNCERTAINTY,
		review: { required: false, reasons },
		deterministic: { metric, comparator, threshold, observedValue: value, sourceEvidenceId: best.id, passed },
		policyAdjustments: adjustments,
		questions,
	});
}

export function uncertaintyOf(selected: string | null, response: { probabilities?: Record<string, number>; confidence?: number } | null, threshold: number): Uncertainty {
	if (!selected || !response) return { level: "high", selectedProbability: null, distribution: null };
	const p = response.probabilities?.[selected] ?? response.confidence ?? null;
	const level = p === null ? "high" : p >= Math.max(0.85, threshold) ? "low" : p >= threshold ? "medium" : "high";
	return { level, selectedProbability: p, distribution: response.probabilities ?? null };
}

/** No evidence matched the criterion: Jev is not asked to judge nothing. */
export function evaluateWithoutEvidence(criterion: InvestmentCriterion, missing: string[]): Base {
	return finish(criterion, {
		outcome: "insufficient_evidence",
		jevOutcome: null,
		explanation: "No evidence in the snapshot matches this criterion, so it was not put to Jev.",
		evidenceRefs: [],
		missingEvidence: missing.length ? missing : ["any evidence for this criterion"],
		contradictions: [],
		sufficiency: "missing",
		uncertainty: NO_UNCERTAINTY,
		review: { required: false, reasons: [] },
		deterministic: null,
		policyAdjustments: [],
	});
}

export function evaluateFailed(criterion: InvestmentCriterion, projected: ManifestEvidence[], missing: string[], allContradictions: Contradiction[], error: string): Base {
	return finish(criterion, {
		outcome: "evaluation_failed",
		jevOutcome: null,
		explanation: `The semantic judgment could not be completed: ${error}`,
		evidenceRefs: projected.map((p) => p.id),
		missingEvidence: missing,
		contradictions: contradictionsFor(projected, allContradictions),
		sufficiency: "not_applicable",
		uncertainty: { level: "high", selectedProbability: null, distribution: null },
		review: { required: true, reasons: ["Automated judgment unavailable"] },
		deterministic: null,
		policyAdjustments: [],
		questions: [`Assess "${criterion.name}" manually or re-run once Jev is available.`],
	});
}

/** Applies evidence-sufficiency and review policy to Jev's bounded answer. */
export function evaluateSemantic(
	criterion: InvestmentCriterion,
	projected: ManifestEvidence[],
	missing: string[],
	allContradictions: Contradiction[],
	answer: { selected: Outcome; probabilities?: Record<string, number>; confidence?: number; rationale?: string },
	settings: ThesisSettings,
): Base {
	const uncertainty = uncertaintyOf(answer.selected, answer, settings.reviewConfidenceThreshold);
	const contradictions = contradictionsFor(projected, allContradictions);
	const adjustments: string[] = [];
	const reasons: string[] = [];
	const questions: string[] = [];
	let outcome: Outcome = answer.selected;
	let sufficiency: Base["sufficiency"] = outcome === "supported" ? "met" : outcome === "insufficient_evidence" ? "missing" : "not_applicable";
	const standard = criterion.evidenceStandard ?? "independent_required";
	if (outcome === "supported" && standard === "independent_required" && !projected.some(isIndependent)) {
		outcome = "partially_supported";
		sufficiency = "founder_reported_only";
		adjustments.push("Jev selected supported, but every cited excerpt is founder-reported and the criterion requires independent evidence");
		const example = projected[0];
		if (example) questions.push(`Obtain independent confirmation of: "${example.claim.slice(0, 160)}" (currently founder-reported).`);
	}
	if (outcome === "not_applicable") {
		reasons.push("Not applicable must be confirmed by a reviewer");
		if (!answer.rationale) adjustments.push("Jev gave no reason for not applicable");
	}
	if (uncertainty.selectedProbability === null) reasons.push("Jev reported no probability for its answer");
	else if (uncertainty.selectedProbability < settings.reviewConfidenceThreshold)
		reasons.push(`Low confidence (${uncertainty.selectedProbability.toFixed(2)} < ${settings.reviewConfidenceThreshold})`);
	if (contradictions.length) reasons.push("Evidence for this criterion contains contradictions");
	if (outcome === "contradicted") questions.push(`Discuss the conflicting evidence for "${criterion.name}" with the founders.`);
	return finish(criterion, {
		outcome,
		jevOutcome: answer.selected,
		explanation: answer.rationale?.trim() || `Jev selected ${answer.selected.replace(/_/g, " ")} without a rationale.`,
		evidenceRefs: projected.map((p) => p.id),
		missingEvidence: missing,
		contradictions,
		sufficiency,
		uncertainty,
		review: { required: false, reasons },
		deterministic: null,
		policyAdjustments: adjustments,
		questions,
	});
}

export function evaluateHumanReview(criterion: InvestmentCriterion, projected: ManifestEvidence[], missing: string[], allContradictions: Contradiction[]): Base {
	return finish(criterion, {
		outcome: "insufficient_evidence",
		jevOutcome: null,
		explanation: "This criterion is configured for human judgment; the system records the relevant evidence and does not decide it.",
		evidenceRefs: projected.map((p) => p.id),
		missingEvidence: missing,
		contradictions: contradictionsFor(projected, allContradictions),
		sufficiency: projected.length ? "not_applicable" : "missing",
		uncertainty: NO_UNCERTAINTY,
		review: { required: true, reasons: ["Criterion requires human judgment"] },
		deterministic: null,
		policyAdjustments: [],
	});
}

// ---------------------------------------------------------------------------
// Review overlay, summary and decision rules
// ---------------------------------------------------------------------------

/** Applies reviewer actions to findings as a derived view. Findings themselves are never edited. */
export function applyReviews(findings: CriterionFinding[], criteria: InvestmentCriterion[], actions: ReviewAction[]): FindingView[] {
	return findings.map((f) => {
		const own = actions.filter((a) => a.findingId === f.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
		const override = [...own].reverse().find((a) => a.action === "override");
		const resolved = own.some((a) => a.action === "accept" || a.action === "override");
		const criterion = criteria.find((c) => c.id === f.criterionId) ?? { hardGate: false };
		const effectiveOutcome = override?.outcome ?? f.outcome;
		return {
			...f,
			effectiveOutcome,
			effectiveHardGate: hardGateFor(criterion, effectiveOutcome),
			reviewState: !f.review.required ? (resolved ? "resolved" : "not_required") : resolved ? "resolved" : "outstanding",
			actions: own,
		};
	});
}

const CREDIT: Record<Outcome, number> = { supported: 1, partially_supported: 0.5, contradicted: 0, insufficient_evidence: 0, not_applicable: 0, evaluation_failed: 0 };

export function summarize(views: FindingView[], criteria: InvestmentCriterion[], settings: ThesisSettings): EvaluationSummary {
	const byOutcome = Object.fromEntries(OUTCOMES.map((o) => [o, 0])) as Record<Outcome, number>;
	for (const v of views) byOutcome[v.effectiveOutcome]++;
	const applicable = views.filter((v) => v.effectiveOutcome !== "not_applicable");
	const established = applicable.filter((v) => ["supported", "partially_supported", "contradicted"].includes(v.effectiveOutcome));
	let weightedScore: number | null = null;
	if (settings.showWeightedSummary) {
		let total = 0;
		let earned = 0;
		for (const v of applicable) {
			const weight = criteria.find((c) => c.id === v.criterionId)?.importance ?? 0;
			total += weight;
			earned += weight * CREDIT[v.effectiveOutcome];
		}
		weightedScore = total > 0 ? Math.round((earned / total) * 1000) / 1000 : null;
	}
	const contradictionKeys = new Set(views.flatMap((v) => v.contradictions.map((c) => `${c.metric}:${c.evidenceIds.join(",")}`)));
	return {
		criteria: views.length,
		byOutcome,
		evidenceCoverage: applicable.length ? Math.round((established.length / applicable.length) * 1000) / 1000 : 0,
		hardGates: {
			passed: views.filter((v) => v.effectiveHardGate === "passed").length,
			failed: views.filter((v) => v.effectiveHardGate === "failed").map((v) => v.criterionId),
			unresolved: views.filter((v) => v.effectiveHardGate === "unresolved").map((v) => v.criterionId),
		},
		reviewsRequired: views.filter((v) => v.review.required).length,
		reviewsOutstanding: views.filter((v) => v.reviewState === "outstanding").length,
		contradictions: contradictionKeys.size,
		weightedScore,
	};
}

/**
 * Whether a decision may be recorded. Investing requires every configured review gate to have an
 * explicit reviewer action and no hard gate to be failed or unresolved. Declining, holding and
 * asking for more diligence are always open: a decision is the investor's, not the model's.
 */
export function decisionBlockers(decision: DecisionKind, summary: EvaluationSummary, evaluationStatus: string): string[] {
	const blockers: string[] = [];
	if (evaluationStatus === "running") blockers.push("The evaluation is still running");
	if (decision !== "invest") return blockers;
	if (evaluationStatus !== "completed") blockers.push("Only a completed evaluation can support an invest decision");
	if (summary.reviewsOutstanding > 0) blockers.push(`${summary.reviewsOutstanding} finding(s) still need reviewer action`);
	if (summary.hardGates.failed.length) blockers.push(`Hard gate failed: ${summary.hardGates.failed.join(", ")}`);
	if (summary.hardGates.unresolved.length) blockers.push(`Hard gate not established: ${summary.hardGates.unresolved.join(", ")}`);
	return blockers;
}
