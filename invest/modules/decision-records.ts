import { newId } from "../domain/canonical.ts";
import { InvestError, invalid, notFound, precondition } from "../domain/errors.ts";
import {
	OUTCOMES,
	type Actor,
	type CriterionFinding,
	type DecisionKind,
	type Evaluation,
	type EvaluationSummary,
	type FindingView,
	type InvestmentDecision,
	type Outcome,
	type ReviewAction,
} from "../domain/types.ts";
import type { EvaluationReport } from "../domain/views.ts";
import { C, type InvestStore } from "../store/store.ts";

export type { EvaluationReport };
import { applyReviews, decisionBlockers, summarize } from "./investment-policy.ts";

const DECISIONS: DecisionKind[] = ["invest", "decline", "hold", "request_more_diligence"];
const MIN_REASON = 10;


/**
 * Reviewer findings, overrides, follow-ups and investment decisions. Everything here is
 * append-only: an override is a new ReviewAction (never an edit to a Jev finding), and a decision
 * is a new InvestmentDecision whose predecessors remain as history.
 */
export class DecisionRecordsModule {
	constructor(private readonly store: InvestStore) {}

	private async evaluation(actor: Actor, evaluationId: string): Promise<Evaluation> {
		const evaluation = await this.store.get<Evaluation>(C.evaluations, evaluationId, actor.workspaceId);
		if (!evaluation) throw notFound("Evaluation");
		return evaluation;
	}

	async report(actor: Actor, evaluationId: string): Promise<EvaluationReport> {
		const evaluation = await this.evaluation(actor, evaluationId);
		const [findings, actions, decisions] = await Promise.all([
			this.store.list<CriterionFinding>(C.findings, actor.workspaceId, { evaluationId }),
			this.store.list<ReviewAction>(C.reviewActions, actor.workspaceId, { evaluationId }),
			this.store.list<InvestmentDecision>(C.decisions, actor.workspaceId, { evaluationId }),
		]);
		const criteria = evaluation.manifest.thesis.criteria;
		const order = criteria.map((c) => c.id);
		findings.sort((a, b) => order.indexOf(a.criterionId) - order.indexOf(b.criterionId));
		const views = applyReviews(findings, criteria, actions);
		const summary = evaluation.status === "completed" ? summarize(views, criteria, evaluation.manifest.thesis.settings) : null;
		const resolvedIds = new Set(actions.filter((a) => a.action === "resolve_request").map((a) => a.targetActionId));
		const requests = actions.filter((a) => a.action === "request_evidence").sort((a, b) => a.createdAt.localeCompare(b.createdAt));
		decisions.sort((a, b) => a.sequence - b.sequence);
		const blockerFor = (d: DecisionKind) => decisionBlockers(d, summary ?? emptySummary(), evaluation.status);
		return {
			evaluation,
			findings: views,
			summary,
			openRequests: requests.filter((r) => !resolvedIds.has(r.id)),
			closedRequests: requests.filter((r) => resolvedIds.has(r.id)),
			comments: actions.filter((a) => a.action === "comment" && !a.findingId),
			decisions,
			currentDecision: decisions.at(-1) ?? null,
			decisionBlockers: Object.fromEntries(DECISIONS.map((d) => [d, blockerFor(d)])) as Record<DecisionKind, string[]>,
		};
	}

	/** Accept a finding, override its outcome, or comment on it. Overrides require an outcome and a reason. */
	async recordReview(actor: Actor, input: { evaluationId: string; findingId: string | null; action: "accept" | "override" | "comment"; outcome?: Outcome; reason?: string }): Promise<ReviewAction> {
		const evaluation = await this.evaluation(actor, input.evaluationId);
		if (evaluation.status !== "completed") throw precondition("Findings can be reviewed only on a completed evaluation");
		if (!["accept", "override", "comment"].includes(input.action)) throw invalid("Action must be accept, override or comment");
		const reason = input.reason?.trim() ?? "";
		let finding: CriterionFinding | null = null;
		if (input.findingId) {
			finding = await this.store.get<CriterionFinding>(C.findings, input.findingId, actor.workspaceId);
			if (!finding || finding.evaluationId !== evaluation.id) throw notFound("Finding");
		} else if (input.action !== "comment") throw invalid("Accept and override apply to a finding");
		if (input.action === "override") {
			if (!input.outcome || !OUTCOMES.includes(input.outcome) || input.outcome === "evaluation_failed") throw invalid("An override needs the reviewer's outcome");
			if (reason.length < MIN_REASON) throw invalid(`An override needs a reason of at least ${MIN_REASON} characters`);
		}
		if (input.action === "comment" && !reason) throw invalid("A comment cannot be empty");
		if (reason.length > 4000) throw invalid("Reason is too long (≤4000 characters)");
		const action: ReviewAction = {
			id: newId("ra"),
			workspaceId: actor.workspaceId,
			evaluationId: evaluation.id,
			findingId: finding?.id ?? null,
			action: input.action,
			outcome: input.action === "override" ? (input.outcome as Outcome) : null,
			reason,
			assignee: null,
			targetActionId: null,
			actorId: actor.principalId,
			actorName: actor.displayName,
			createdAt: this.store.now(),
		};
		await this.store.commit(actor, {
			writes: [{ collection: C.reviewActions, id: action.id, value: action, create: true }],
			audit: [
				{
					eventType: `review.${input.action}`,
					entityRef: { type: "finding", id: finding?.id ?? evaluation.id },
					payload: { evaluationId: evaluation.id, criterionId: finding?.criterionId ?? null, systemOutcome: finding?.outcome ?? null, overrideOutcome: action.outcome, reason },
				},
			],
		});
		return action;
	}

	async requestEvidence(actor: Actor, input: { evaluationId: string; findingId?: string | null; question: string; assignee?: string }): Promise<ReviewAction> {
		const evaluation = await this.evaluation(actor, input.evaluationId);
		const question = input.question?.trim();
		if (!question || question.length > 2000) throw invalid("The diligence question is required (≤2000 characters)");
		if (input.findingId) {
			const finding = await this.store.get<CriterionFinding>(C.findings, input.findingId, actor.workspaceId);
			if (!finding || finding.evaluationId !== evaluation.id) throw notFound("Finding");
		}
		const action: ReviewAction = {
			id: newId("ra"),
			workspaceId: actor.workspaceId,
			evaluationId: evaluation.id,
			findingId: input.findingId ?? null,
			action: "request_evidence",
			outcome: null,
			reason: question,
			assignee: input.assignee?.trim().slice(0, 120) || null,
			targetActionId: null,
			actorId: actor.principalId,
			actorName: actor.displayName,
			createdAt: this.store.now(),
		};
		await this.store.commit(actor, {
			writes: [{ collection: C.reviewActions, id: action.id, value: action, create: true }],
			audit: [{ eventType: "review.evidence_requested", entityRef: { type: "evaluation", id: evaluation.id }, payload: { findingId: action.findingId, question, assignee: action.assignee } }],
		});
		return action;
	}

	async resolveRequest(actor: Actor, input: { evaluationId: string; requestId: string; resolution: string }): Promise<ReviewAction> {
		const evaluation = await this.evaluation(actor, input.evaluationId);
		const request = await this.store.get<ReviewAction>(C.reviewActions, input.requestId, actor.workspaceId);
		if (!request || request.evaluationId !== evaluation.id || request.action !== "request_evidence") throw notFound("Diligence request");
		const resolution = input.resolution?.trim();
		if (!resolution || resolution.length > 2000) throw invalid("Describe how the request was resolved (≤2000 characters)");
		// The resolution id is derived from the request, so a request can be resolved exactly once.
		const action: ReviewAction = {
			id: `${request.id}_resolved`,
			workspaceId: actor.workspaceId,
			evaluationId: evaluation.id,
			findingId: request.findingId,
			action: "resolve_request",
			outcome: null,
			reason: resolution,
			assignee: null,
			targetActionId: request.id,
			actorId: actor.principalId,
			actorName: actor.displayName,
			createdAt: this.store.now(),
		};
		try {
			await this.store.commit(actor, {
				writes: [{ collection: C.reviewActions, id: action.id, value: action, create: true }],
				audit: [{ eventType: "review.request_resolved", entityRef: { type: "evaluation", id: evaluation.id }, payload: { requestId: request.id, resolution } }],
			});
		} catch (error) {
			if (error instanceof InvestError && error.code === "conflict") throw precondition("This request was already resolved");
			throw error;
		}
		return action;
	}

	/**
	 * Records an investment decision. The decision's sequence number is fenced with `requireAbsent`,
	 * so two reviewers deciding at once cannot both become "current"; the loser reloads and sees
	 * the other decision first.
	 */
	async recordDecision(actor: Actor, input: { evaluationId: string; decision: DecisionKind; rationale: string; expectedSequence: number }): Promise<InvestmentDecision> {
		if (!DECISIONS.includes(input.decision)) throw invalid(`Decision must be one of ${DECISIONS.join(", ")}`);
		const rationale = input.rationale?.trim() ?? "";
		if (rationale.length < MIN_REASON || rationale.length > 8000) throw invalid(`A decision needs a rationale of at least ${MIN_REASON} characters`);
		const report = await this.report(actor, input.evaluationId);
		const blockers = report.decisionBlockers[input.decision];
		if (blockers.length) throw precondition(`This decision cannot be recorded yet: ${blockers.join("; ")}`, { blockers });
		const sequence = (report.currentDecision?.sequence ?? 0) + 1;
		if (input.expectedSequence !== sequence) throw precondition("Another decision was recorded since you loaded this evaluation; reload first");
		const decision: InvestmentDecision = {
			id: `${report.evaluation.id}_d${sequence}`,
			workspaceId: actor.workspaceId,
			evaluationId: report.evaluation.id,
			startupId: report.evaluation.startupId,
			sequence,
			decision: input.decision,
			rationale,
			decidedBy: actor.principalId,
			decidedByName: actor.displayName,
			createdAt: this.store.now(),
		};
		await this.store.commit(actor, {
			writes: [{ collection: C.decisions, id: decision.id, value: decision, create: true }],
			audit: [
				{
					eventType: "decision.recorded",
					entityRef: { type: "decision", id: decision.id },
					payload: {
						evaluationId: decision.evaluationId,
						decision: decision.decision,
						sequence,
						supersedes: report.currentDecision?.id ?? null,
						effectiveSummary: report.summary,
					},
				},
			],
		});
		return decision;
	}

	async decisionsForStartup(actor: Actor, startupId: string): Promise<InvestmentDecision[]> {
		return (await this.store.list<InvestmentDecision>(C.decisions, actor.workspaceId, { startupId })).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
	}
}

function emptySummary(): EvaluationSummary {
	return {
		criteria: 0,
		byOutcome: Object.fromEntries(OUTCOMES.map((o) => [o, 0])) as Record<Outcome, number>,
		evidenceCoverage: 0,
		hardGates: { passed: 0, failed: [], unresolved: [] },
		reviewsRequired: 0,
		reviewsOutstanding: 0,
		contradictions: 0,
		weightedScore: null,
	};
}
