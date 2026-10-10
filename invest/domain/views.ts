import type { DecisionKind, Evaluation, EvaluationSummary, FindingView, InvestmentDecision, ReviewAction } from "./types.ts";

/** Read models shared by the server and the web app. Types only; no runtime imports. */

export type EvaluationListItem = Pick<
	Evaluation,
	"id" | "startupId" | "thesisId" | "thesisVersionId" | "status" | "predecessorId" | "manifestDigest" | "summary" | "failure" | "metrics" | "createdAt" | "completedAt" | "createdBy"
> & {
	startupName: string;
	thesisVersion: number;
	reviewsOutstanding: number | null;
	openRequests: number;
	currentDecision: InvestmentDecision | null;
};

export type EvaluationReport = {
	evaluation: Evaluation;
	findings: FindingView[];
	/** Recomputed with reviewer actions applied. `evaluation.summary` keeps the system's own result. */
	summary: EvaluationSummary | null;
	openRequests: ReviewAction[];
	closedRequests: ReviewAction[];
	comments: ReviewAction[];
	decisions: InvestmentDecision[];
	currentDecision: InvestmentDecision | null;
	decisionBlockers: Record<DecisionKind, string[]>;
};
