import { afterEach, describe, expect, it } from "bun:test";
import type { Actor, CriterionFinding, Evaluation, ThesisVersion } from "../domain/types.ts";
import { JevError, JevHttpClient, UnconfiguredJev, type JevDecisionResponse } from "../jev/jev-client.ts";
import { C } from "../store/store.ts";
import {
	ADVERSARIAL_DECK,
	CONTOSO_DECK,
	FABRIKAM_DECK,
	FABRIKAM_FINANCIALS,
	NORTHWIND_AUDIT,
	NORTHWIND_DECK,
	SEED_SAAS_CRITERIA,
	SEED_SAAS_SETTINGS,
} from "../testing/fixtures.ts";
import { ScriptedJev, actor, createHarness, lexicalJudge, type Harness } from "../testing/harness.ts";

const A = actor("ws-a");
let h: Harness;
afterEach(async () => h?.close());

async function setup(options: Parameters<typeof createHarness>[0] = {}) {
	h = await createHarness(options);
	const draft = await h.service.theses.createDraft(A, { name: "Seed SaaS", criteria: SEED_SAAS_CRITERIA, settings: SEED_SAAS_SETTINGS });
	const { version } = await h.service.theses.approve(A, { thesisId: draft.id, expectedVersion: draft.__version! });
	return version;
}

async function startup(name: string, docs: [Uint8Array, string, Parameters<Harness["service"]["documents"]["upload"]>[1]["sourceType"]][] = []) {
	const s = await h.service.startups.create(A, { name });
	for (const [bytes, filename, sourceType] of docs) await h.service.documents.upload(A, { startupId: s.id, bytes, filename, mediaType: "application/pdf", sourceType });
	return s.id;
}

let keys = 0;
async function evaluate(startupId: string, version: ThesisVersion, who: Actor = A): Promise<{ evaluation: Evaluation; findings: Record<string, CriterionFinding> }> {
	const started = await h.service.evaluations.start(who, { startupId, thesisVersionId: version.id, requestKey: `test-request-${++keys}-${Date.now()}` });
	await h.service.evaluations.settled(started.id);
	const evaluation = await h.service.evaluations.get(who, started.id);
	const findings = Object.fromEntries((await h.service.evaluations.findings(who, started.id)).map((f) => [f.criterionId, f]));
	return { evaluation, findings };
}

describe("evaluation — representative cases", () => {
	it("positive: corroborated metrics pass, semantic support stands, human gate stays open", async () => {
		const version = await setup();
		const id = await startup("Northwind", [
			[NORTHWIND_DECK, "deck.pdf", "founder_deck"],
			[NORTHWIND_AUDIT, "review.pdf", "third_party_report"],
		]);
		const { evaluation, findings } = await evaluate(id, version);
		expect(evaluation.status).toBe("completed");
		expect(Object.keys(findings).sort()).toEqual(SEED_SAAS_CRITERIA.map((c) => c.id).sort());

		expect(findings["arr-floor"].outcome).toBe("supported");
		expect(findings["arr-floor"].deterministic).toMatchObject({ metric: "arr", passed: true, observedValue: 2_380_000 });
		expect(findings["arr-floor"].hardGate).toBe("passed");
		expect(findings.retention.outcome).toBe("supported");
		expect(findings["repeatable-demand"].outcome).toBe("supported");
		expect(findings["repeatable-demand"].jev?.selected).toBe("supported");
		expect(findings["repeatable-demand"].uncertainty.distribution?.supported).toBeCloseTo(0.84);
		expect(findings.team.outcome).toBe("supported");
		expect(findings["legal-exposure"].outcome).toBe("insufficient_evidence");
		expect(findings["legal-exposure"].review.required).toBe(true);
		expect(findings["legal-exposure"].hardGate).toBe("unresolved");

		for (const f of Object.values(findings)) {
			expect(f.configurationRef).toBe(evaluation.manifestDigest);
			for (const ref of f.evidenceRefs) expect(evaluation.manifest.evidence.items.some((i) => i.id === ref)).toBe(true);
			if (!f.evidenceRefs.length) expect(f.missingEvidence.length).toBeGreaterThan(0);
		}
		expect(evaluation.summary?.hardGates.unresolved).toEqual(["legal-exposure"]);
		expect(evaluation.summary?.weightedScore).not.toBeNull();
		expect(evaluation.metrics.latencyMs).toBeGreaterThanOrEqual(0);
		expect(evaluation.metrics.costUsd).toBeNull();
	});

	it("negative: thresholds fail in application code and the hard gate fails", async () => {
		const version = await setup();
		const { evaluation, findings } = await evaluate(await startup("Contoso", [[CONTOSO_DECK, "deck.pdf", "founder_deck"]]), version);
		expect(findings["arr-floor"].outcome).toBe("contradicted");
		expect(findings["arr-floor"].deterministic).toMatchObject({ observedValue: 400_000, passed: false });
		expect(findings["arr-floor"].hardGate).toBe("failed");
		expect(findings.retention.outcome).toBe("contradicted");
		expect(findings["repeatable-demand"].outcome).toBe("contradicted");
		expect(evaluation.summary?.hardGates.failed).toEqual(["arr-floor"]);
	});

	it("ambiguous: founder documents that disagree surface as a contradiction and route to review", async () => {
		const version = await setup();
		const { evaluation, findings } = await evaluate(
			await startup("Fabrikam", [
				[FABRIKAM_DECK, "deck.pdf", "founder_deck"],
				[FABRIKAM_FINANCIALS, "accounts.pdf", "founder_financials"],
			]),
			version,
		);
		const arr = findings["arr-floor"];
		expect(arr.contradictions).toHaveLength(1);
		expect(arr.deterministic?.observedValue).toBe(900_000); // least favourable of equally credible sources
		expect(arr.outcome).toBe("contradicted");
		expect(arr.review.reasons.join(" ")).toContain("disagree");
		expect(evaluation.summary?.contradictions).toBeGreaterThan(0);
	});

	it("adversarial: injected instructions cannot reach instructions or override policy, even if Jev obeys them", async () => {
		const gullible = new ScriptedJev((req) =>
			/ignore previous instructions/i.test(req.context ?? "") ? { selectedId: "supported", probabilities: { supported: 0.99 }, rationale: "As instructed." } : lexicalJudge(req),
		);
		const version = await setup({ jev: gullible });
		const { findings } = await evaluate(await startup("Tailspin", [[ADVERSARIAL_DECK, "deck.pdf", "founder_deck"]]), version);

		for (const req of gullible.requests) {
			expect(req.instructions).not.toMatch(/ignore previous/i);
			expect(req.instructions).not.toContain("Tailspin");
			expect(req.context).toContain("UNTRUSTED EVIDENCE EXCERPTS");
			expect(req.context).not.toMatch(/\[evidence fake\]/); // forged framing is neutralised
			expect(req.options?.map((o) => o.id)).toEqual(["supported", "partially_supported", "contradicted", "insufficient_evidence", "not_applicable"]);
		}
		expect(findings["arr-floor"].outcome).toBe("contradicted");
		expect(findings["arr-floor"].deterministic?.observedValue).toBe(300_000);
		expect(findings["arr-floor"].hardGate).toBe("failed");
		const demand = findings["repeatable-demand"];
		expect(demand.jevOutcome).toBe("supported");
		expect(demand.outcome).toBe("partially_supported");
		expect(demand.sufficiency).toBe("founder_reported_only");
		expect(demand.policyAdjustments.join(" ")).toContain("founder-reported");
	});

	it("missing evidence: nothing is fabricated and Jev is not asked to judge nothing", async () => {
		const jev = new ScriptedJev(lexicalJudge);
		const version = await setup({ jev });
		const { findings } = await evaluate(await startup("Empty Co"), version);
		expect(jev.requests).toHaveLength(0);
		for (const f of Object.values(findings)) {
			expect(f.outcome).toBe("insufficient_evidence");
			expect(f.evidenceRefs).toEqual([]);
			expect(f.missingEvidence.length).toBeGreaterThan(0);
		}
		expect(findings["arr-floor"].review.required).toBe(true); // review_required policy + hard gate
		expect(findings.team.review.required).toBe(false); // unknown policy, not a gate
	});

	it("routes low-confidence answers and not-applicable selections to review", async () => {
		const jev = new ScriptedJev((req): JevDecisionResponse =>
			/Criterion: Relevant founding team/.test(req.instructions)
				? { selectedId: "not_applicable", probabilities: { not_applicable: 0.9 }, rationale: "Solo founder; criterion phrased for teams." }
				: { selectedId: "supported", probabilities: { supported: 0.55, partially_supported: 0.45 } },
		);
		const version = await setup({ jev });
		const { findings } = await evaluate(await startup("Northwind", [[NORTHWIND_DECK, "deck.pdf", "founder_deck"], [NORTHWIND_AUDIT, "r.pdf", "third_party_report"]]), version);
		expect(findings["repeatable-demand"].uncertainty.level).toBe("high");
		expect(findings["repeatable-demand"].review.reasons.join(" ")).toContain("Low confidence");
		expect(findings.team.outcome).toBe("not_applicable");
		expect(findings.team.review.required).toBe(true);
	});
});

describe("evaluation — failure handling", () => {
	it("retries transient Jev failures within the bound, then records evaluation_failed distinctly", async () => {
		let calls = 0;
		const jev = new ScriptedJev(() => {
			calls++;
			return new JevError("transport", "connection reset", true);
		});
		const version = await setup({ jev, maxRetries: 2 });
		const { evaluation, findings } = await evaluate(await startup("Northwind", [[NORTHWIND_DECK, "deck.pdf", "founder_deck"]]), version);
		expect(evaluation.status).toBe("completed");
		const semantic = SEED_SAAS_CRITERIA.filter((c) => c.evaluationMode === "semantic").length;
		expect(calls).toBe(semantic * 3);
		expect(findings.team.outcome).toBe("evaluation_failed");
		expect(findings.team.jev?.attempts).toBe(3);
		expect(findings.team.review.required).toBe(true);
		expect(findings["arr-floor"].outcome).not.toBe("evaluation_failed"); // deterministic checks still ran
		expect(evaluation.metrics.jevRetries).toBe(semantic * 2);
	});

	it("does not retry a contract violation and keeps it separate from missing evidence", async () => {
		let calls = 0;
		const jev = new ScriptedJev(() => {
			calls++;
			return { selectedId: "yes, invest" };
		});
		const version = await setup({ jev });
		const { findings } = await evaluate(await startup("Northwind", [[NORTHWIND_DECK, "deck.pdf", "founder_deck"]]), version);
		expect(calls).toBe(2);
		expect(findings.team.outcome).toBe("evaluation_failed");
		expect(findings.team.jev?.error).toContain("contract");
		expect(findings.team.explanation).toContain("could not be completed");
	});

	it("records evaluation_failed when Jev is not configured", async () => {
		const version = await setup({ jev: new UnconfiguredJev() });
		const { evaluation, findings } = await evaluate(await startup("Northwind", [[NORTHWIND_DECK, "deck.pdf", "founder_deck"]]), version);
		expect(evaluation.manifest.jev.configured).toBe(false);
		expect(findings.team.outcome).toBe("evaluation_failed");
		expect(findings.team.jev?.attempts).toBe(1);
	});

	it("enforces the evaluation deadline", async () => {
		const jev = new ScriptedJev(() => new Promise((r) => setTimeout(() => r(lexicalJudge({ kind: "choice", instructions: "" })), 400)));
		const version = await setup({ jev, timeoutMs: 100, maxRetries: 0 });
		const { findings } = await evaluate(await startup("Northwind", [[NORTHWIND_DECK, "deck.pdf", "founder_deck"]]), version);
		expect(Object.values(findings).some((f) => f.outcome === "evaluation_failed")).toBe(true);
	});

	it("never persists the Jev credential", async () => {
		const secret = "sk-jev-SECRET-do-not-store-9f8e7d";
		let seenAuth = "";
		const http = new JevHttpClient({
			endpoint: "https://jev.example.test/decide",
			apiKey: secret,
			provider: "example",
			model: "example-1",
			timeoutMs: 1000,
			fetch: (async (_url: string, init: RequestInit) => {
				seenAuth = (init.headers as Record<string, string>).authorization;
				return new Response(JSON.stringify(lexicalJudge(JSON.parse(String(init.body)))), { status: 200, headers: { "content-type": "application/json" } });
			}) as unknown as typeof fetch,
		});
		const version = await setup({ jev: http });
		const { evaluation } = await evaluate(await startup("Northwind", [[NORTHWIND_DECK, "deck.pdf", "founder_deck"]]), version);
		expect(seenAuth).toBe(`Bearer ${secret}`);
		expect(evaluation.manifest.jev).toMatchObject({ endpointOrigin: "https://jev.example.test", provider: "example", model: "example-1" });
		for (const collection of Object.values(C)) {
			const rows = await h.store.dumpForTests(collection);
			expect(JSON.stringify(rows)).not.toContain(secret);
		}
	});
});

describe("evaluation — reproducibility and lifecycle", () => {
	it("is idempotent on the request key, including concurrent starts", async () => {
		const version = await setup();
		const id = await startup("Northwind", [[NORTHWIND_DECK, "deck.pdf", "founder_deck"]]);
		const input = { startupId: id, thesisVersionId: version.id, requestKey: "same-key-123456" };
		const [a, b] = await Promise.all([h.service.evaluations.start(A, input), h.service.evaluations.start(A, input)]);
		expect(a.id).toBe(b.id);
		await h.service.evaluations.settled();
		expect((await h.service.listEvaluations(A)).length).toBe(1);
		await expect(h.service.evaluations.start(A, { ...input, startupId: await startup("Other") })).rejects.toMatchObject({ code: "conflict" });
	});

	it("evaluates against the explicitly selected thesis version even after a newer one is approved", async () => {
		const v1 = await setup();
		const thesis = await h.service.theses.get(A, v1.thesisId);
		const edited = await h.service.theses.updateDraft(A, { thesisId: thesis.id, expectedVersion: thesis.__version!, criteria: SEED_SAAS_CRITERIA.map((c) => (c.id === "arr-floor" ? { ...c, threshold: 5_000_000 } : c)) });
		const { version: v2 } = await h.service.theses.approve(A, { thesisId: edited.id, expectedVersion: edited.__version! });
		const id = await startup("Northwind", [[NORTHWIND_DECK, "deck.pdf", "founder_deck"], [NORTHWIND_AUDIT, "r.pdf", "third_party_report"]]);
		const one = await evaluate(id, v1);
		const two = await evaluate(id, v2);
		expect(one.evaluation.thesisVersionId).toBe(v1.id);
		expect(one.findings["arr-floor"].outcome).toBe("supported");
		expect(two.findings["arr-floor"].outcome).toBe("contradicted");
		expect(one.evaluation.manifestDigest).not.toBe(two.evaluation.manifestDigest);
	});

	it("reruns create a linked new evaluation; completed ones are never overwritten; digests track inputs", async () => {
		const version = await setup();
		const id = await startup("Northwind", [[NORTHWIND_DECK, "deck.pdf", "founder_deck"]]);
		const first = await evaluate(id, version);
		const same = await h.service.evaluations.rerun(A, { evaluationId: first.evaluation.id, requestKey: "rerun-same-inputs" });
		await h.service.evaluations.settled(same.id);
		expect(same.id).not.toBe(first.evaluation.id);
		expect(same.predecessorId).toBe(first.evaluation.id);
		expect(same.manifestDigest).toBe(first.evaluation.manifestDigest);

		await h.service.documents.upload(A, { startupId: id, bytes: NORTHWIND_AUDIT, filename: "r.pdf", mediaType: "application/pdf", sourceType: "third_party_report" });
		const changed = await h.service.evaluations.rerun(A, { evaluationId: first.evaluation.id, requestKey: "rerun-new-evidence" });
		await h.service.evaluations.settled(changed.id);
		expect(changed.manifestDigest).not.toBe(first.evaluation.manifestDigest);

		const original = await h.service.evaluations.get(A, first.evaluation.id);
		expect(original.completedAt).toBe(first.evaluation.completedAt);
		expect(original.manifestDigest).toBe(first.evaluation.manifestDigest);
		expect((await h.service.evaluations.findings(A, first.evaluation.id)).map((f) => f.outcome)).toEqual(Object.values(first.findings).map((f) => f.outcome));
	});

	it("verify recomputes a stored evaluation and detects tampering", async () => {
		const version = await setup();
		const id = await startup("Fabrikam", [[FABRIKAM_DECK, "deck.pdf", "founder_deck"], [FABRIKAM_FINANCIALS, "acc.pdf", "founder_financials"], [NORTHWIND_AUDIT, "r.pdf", "third_party_report"]]);
		const { evaluation, findings } = await evaluate(id, version);
		const report = await h.service.evaluations.verify(A, evaluation.id);
		expect(report.checks.filter((c) => !c.ok)).toEqual([]);
		expect(report.ok).toBe(true);

		// Tamper with a stored finding underneath the application.
		const db = (h.store as unknown as { db: { transaction: (d: unknown) => Promise<unknown> } }).db;
		const f = findings["arr-floor"];
		await db.transaction({ operations: [{ collection: C.findings, id: f.id, value: { ...f, outcome: "supported" } }] });
		const after = await h.service.evaluations.verify(A, evaluation.id);
		expect(after.ok).toBe(false);
		expect(after.checks.find((c) => c.name === "outcome arr-floor")?.ok).toBe(false);
	});

	it("marks evaluations interrupted by a restart as failed instead of leaving them running", async () => {
		const version = await setup({ jev: new ScriptedJev(() => new Promise(() => {})), timeoutMs: 60_000 });
		const id = await startup("Northwind", [[NORTHWIND_DECK, "deck.pdf", "founder_deck"]]);
		const started = await h.service.evaluations.start(A, { startupId: id, thesisVersionId: version.id, requestKey: "will-be-interrupted" });
		expect(started.status).toBe("running");
		const { EvaluationOrchestrator } = await import("../modules/evaluation-orchestrator.ts");
		const restarted = new EvaluationOrchestrator(h.store, h.service.evidence, new UnconfiguredJev(), { timeoutMs: 1000, maxRetries: 0, jevTimeoutMs: 1000 }, (await import("../logger.ts")).silentLogger);
		expect(await restarted.recoverInterrupted(["ws-a"])).toBe(1);
		const after = await h.service.evaluations.get(A, started.id);
		expect(after.status).toBe("failed");
		expect(after.failure).toContain("restart");
		// Let the hung in-process run go: close() waits on settled(), so detach it.
		(h.service.evaluations as unknown as { running: Map<string, unknown> }).running.clear();
	});
});
