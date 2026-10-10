import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { Evaluation } from "../domain/types.ts";
import { CONTOSO_DECK, NORTHWIND_AUDIT, NORTHWIND_DECK, SEED_SAAS_CRITERIA, SEED_SAAS_SETTINGS } from "../testing/fixtures.ts";
import { actor, createHarness, type Harness } from "../testing/harness.ts";

const A = actor("ws-a", "alice");
const B = actor("ws-a", "bob");

describe("review and decision records", () => {
	let h: Harness;
	let evaluation: Evaluation;

	async function evaluated(docs: [Uint8Array, "founder_deck" | "third_party_report"][]) {
		const draft = await h.service.theses.createDraft(A, { name: "Seed", criteria: SEED_SAAS_CRITERIA, settings: SEED_SAAS_SETTINGS });
		const { version } = await h.service.theses.approve(A, { thesisId: draft.id, expectedVersion: draft.__version! });
		const s = await h.service.startups.create(A, { name: "Co" });
		for (const [bytes, sourceType] of docs) await h.service.documents.upload(A, { startupId: s.id, bytes, filename: "f.pdf", mediaType: "application/pdf", sourceType });
		const e = await h.service.evaluations.start(A, { startupId: s.id, thesisVersionId: version.id, requestKey: `k-${Math.random().toString(36).slice(2)}` });
		await h.service.evaluations.settled(e.id);
		return h.service.evaluations.get(A, e.id);
	}

	beforeEach(async () => {
		h = await createHarness();
		evaluation = await evaluated([
			[NORTHWIND_DECK, "founder_deck"],
			[NORTHWIND_AUDIT, "third_party_report"],
		]);
	});
	afterEach(async () => h.close());

	it("blocks an invest decision until every review gate has an explicit reviewer action", async () => {
		let report = await h.service.decisions.report(A, evaluation.id);
		expect(report.summary?.reviewsOutstanding).toBeGreaterThan(0);
		expect(report.decisionBlockers.invest.length).toBeGreaterThan(0);
		await expect(h.service.decisions.recordDecision(A, { evaluationId: evaluation.id, decision: "invest", rationale: "Strong traction and team.", expectedSequence: 1 })).rejects.toMatchObject({
			code: "precondition",
		});

		const legal = report.findings.find((f) => f.criterionId === "legal-exposure")!;
		// Accepting does not establish the hard gate; only an explicit, reasoned override can.
		await h.service.decisions.recordReview(A, { evaluationId: evaluation.id, findingId: legal.id, action: "accept" });
		report = await h.service.decisions.report(A, evaluation.id);
		expect(report.decisionBlockers.invest.join(" ")).toContain("Hard gate not established");
		await h.service.decisions.recordReview(A, {
			evaluationId: evaluation.id,
			findingId: legal.id,
			action: "override",
			outcome: "supported",
			reason: "Counsel confirmed no pending litigation or regulatory actions (call 2026-10-08).",
		});
		for (const f of report.findings.filter((x) => x.reviewState === "outstanding" && x.id !== legal.id))
			await h.service.decisions.recordReview(A, { evaluationId: evaluation.id, findingId: f.id, action: "accept" });
		report = await h.service.decisions.report(A, evaluation.id);
		expect(report.summary?.reviewsOutstanding).toBe(0);
		expect(report.decisionBlockers.invest).toEqual([]);
		const decision = await h.service.decisions.recordDecision(A, { evaluationId: evaluation.id, decision: "invest", rationale: "Meets mandate after legal review.", expectedSequence: 1 });
		expect(decision).toMatchObject({ decision: "invest", decidedBy: "alice", sequence: 1 });
	});

	it("records overrides with actor, reason and timestamp and never edits the Jev finding", async () => {
		const report = await h.service.decisions.report(A, evaluation.id);
		const team = report.findings.find((f) => f.criterionId === "team")!;
		await expect(h.service.decisions.recordReview(A, { evaluationId: evaluation.id, findingId: team.id, action: "override", outcome: "contradicted", reason: "short" })).rejects.toMatchObject({
			code: "invalid",
		});
		await expect(h.service.decisions.recordReview(A, { evaluationId: evaluation.id, findingId: team.id, action: "override", reason: "Missing the outcome entirely." })).rejects.toMatchObject({ code: "invalid" });
		const action = await h.service.decisions.recordReview(B, {
			evaluationId: evaluation.id,
			findingId: team.id,
			action: "override",
			outcome: "contradicted",
			reason: "Reference calls showed the CTO left in 2025.",
		});
		expect(action).toMatchObject({ actorId: "bob", outcome: "contradicted", action: "override" });
		expect(Date.parse(action.createdAt)).not.toBeNaN();

		const stored = (await h.service.evaluations.findings(A, evaluation.id)).find((f) => f.id === team.id)!;
		expect(stored.outcome).toBe("supported");
		const after = await h.service.decisions.report(A, evaluation.id);
		const view = after.findings.find((f) => f.id === team.id)!;
		expect(view.outcome).toBe("supported");
		expect(view.effectiveOutcome).toBe("contradicted");
		expect(evaluation.summary?.byOutcome.contradicted).toBe(0); // the system's own summary is unchanged
		expect(after.summary?.byOutcome.contradicted).toBe(1);
		const audit = await h.service.audit.list(A, { eventType: "review.override" });
		expect(audit[0]).toMatchObject({ actorId: "bob", payload: { systemOutcome: "supported", overrideOutcome: "contradicted" } });
	});

	it("keeps findings separate from the decision: a decline leaves supported criteria supported", async () => {
		const decision = await h.service.decisions.recordDecision(A, { evaluationId: evaluation.id, decision: "decline", rationale: "Valuation outside our range for this fund.", expectedSequence: 1 });
		expect(decision.decision).toBe("decline");
		const report = await h.service.decisions.report(A, evaluation.id);
		expect(report.findings.find((f) => f.criterionId === "arr-floor")?.effectiveOutcome).toBe("supported");
		expect(report.currentDecision?.id).toBe(decision.id);
		const second = await h.service.decisions.recordDecision(A, { evaluationId: evaluation.id, decision: "hold", rationale: "Revisit next quarter after the raise.", expectedSequence: 2 });
		const history = (await h.service.decisions.report(A, evaluation.id)).decisions;
		expect(history.map((d) => d.decision)).toEqual(["decline", "hold"]);
		expect(history[0].rationale).toBe("Valuation outside our range for this fund.");
		expect(second.sequence).toBe(2);
	});

	it("lets only one of two simultaneous decisions become current", async () => {
		const results = await Promise.allSettled([
			h.service.decisions.recordDecision(A, { evaluationId: evaluation.id, decision: "decline", rationale: "Decline: outside mandate.", expectedSequence: 1 }),
			h.service.decisions.recordDecision(B, { evaluationId: evaluation.id, decision: "hold", rationale: "Hold: waiting for references.", expectedSequence: 1 }),
		]);
		expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
		expect((await h.service.decisions.report(A, evaluation.id)).decisions).toHaveLength(1);
	});

	it("tracks diligence requests to resolution exactly once", async () => {
		const report = await h.service.decisions.report(A, evaluation.id);
		const req = await h.service.decisions.requestEvidence(A, { evaluationId: evaluation.id, findingId: report.findings[0].id, question: "Send the last 12 months of bank statements.", assignee: "bob" });
		expect((await h.service.decisions.report(A, evaluation.id)).openRequests.map((r) => r.id)).toEqual([req.id]);
		await h.service.decisions.resolveRequest(B, { evaluationId: evaluation.id, requestId: req.id, resolution: "Received and reconciled with the audit." });
		await expect(h.service.decisions.resolveRequest(B, { evaluationId: evaluation.id, requestId: req.id, resolution: "Again." })).rejects.toMatchObject({ code: "precondition" });
		const after = await h.service.decisions.report(A, evaluation.id);
		expect(after.openRequests).toHaveLength(0);
		expect(after.closedRequests).toHaveLength(1);
	});

	it("never allows invest past a failed hard gate", async () => {
		const failing = await evaluated([[CONTOSO_DECK, "founder_deck"]]);
		const report = await h.service.decisions.report(A, failing.id);
		for (const f of report.findings.filter((x) => x.reviewState === "outstanding")) await h.service.decisions.recordReview(A, { evaluationId: failing.id, findingId: f.id, action: "accept" });
		const blockers = (await h.service.decisions.report(A, failing.id)).decisionBlockers.invest;
		expect(blockers.join(" ")).toContain("Hard gate failed: arr-floor");
		expect((await h.service.decisions.report(A, failing.id)).decisionBlockers.decline).toEqual([]);
	});
});
