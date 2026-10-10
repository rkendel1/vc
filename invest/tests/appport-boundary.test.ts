import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { AppPortError } from "@appport/sdk";
import type { DocumentRecord, Evaluation, InvestmentThesis, Startup, ThesisVersion } from "../domain/types.ts";
import type { EvaluationReport } from "../modules/decision-records.ts";
import { NORTHWIND_AUDIT, NORTHWIND_DECK, SEED_SAAS_CRITERIA, SEED_SAAS_SETTINGS } from "../testing/fixtures.ts";
import { type HttpHarness, TOKENS, startHttpHarness } from "../testing/http-harness.ts";

let h: HttpHarness;
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

async function call<T>(token: string | undefined, name: string, input: unknown): Promise<T> {
	const client = h.client(token);
	await client.connect();
	try {
		return await client.call<T>(name, input as never);
	} finally {
		await client.close();
	}
}
const code = async (p: Promise<unknown>) => p.then(() => "OK", (e: AppPortError) => e.code);

// Workspace A state built once through the AppPort boundary.
let thesis: InvestmentThesis;
let version: ThesisVersion;
let startup: Startup;
let document: DocumentRecord;
let evaluation: Evaluation;

beforeAll(async () => {
	h = await startHttpHarness();
	thesis = (await call<{ thesis: InvestmentThesis }>(TOKENS.aAnalyst, "thesis.create", { name: "Seed SaaS", criteria: SEED_SAAS_CRITERIA, settings: SEED_SAAS_SETTINGS })).thesis;
	version = (await call<{ version: ThesisVersion }>(TOKENS.aPartner, "thesis.approve", { thesisId: thesis.id, expectedVersion: thesis.__version, note: "v1" })).version;
	startup = (await call<{ startup: Startup }>(TOKENS.aAnalyst, "startup.create", { name: "Northwind", founderClaims: ["120 paying customers"] })).startup;
	document = (
		await call<{ document: DocumentRecord }>(TOKENS.aAnalyst, "document.upload", {
			startupId: startup.id,
			filename: "deck.pdf",
			mediaType: "application/pdf",
			sourceType: "founder_deck",
			contentBase64: b64(NORTHWIND_DECK),
		})
	).document;
	await call(TOKENS.aAnalyst, "document.upload", { startupId: startup.id, filename: "review.pdf", mediaType: "application/pdf", sourceType: "third_party_report", contentBase64: b64(NORTHWIND_AUDIT) });
	evaluation = (await call<{ evaluation: Evaluation }>(TOKENS.aAnalyst, "evaluation.start", { startupId: startup.id, thesisVersionId: version.id, requestKey: "boundary-test-0001" })).evaluation;
	await h.runtime.service.evaluations.settled(evaluation.id);
});
afterAll(async () => h?.close());

describe("AppPort contract", () => {
	it("publishes a manifest whose every capability requires a permission and none accepts a workspace id", async () => {
		const client = h.client(TOKENS.aViewer);
		await client.connect();
		const manifest = await client.load();
		await client.close();
		expect(manifest.application.id).toBe("com.rkendel1.attn.invest");
		const domain = manifest.capabilities.filter((c) => !c.name.startsWith("appport."));
		expect(domain.length).toBeGreaterThanOrEqual(30);
		for (const c of domain as unknown as { name: string; authorization: string[]; inputSchema: unknown }[]) {
			expect(`${c.name}:${c.authorization.length > 0}`).toBe(`${c.name}:true`);
			expect(JSON.stringify(c.inputSchema)).not.toMatch(/"workspaceId"|"tenantId"/);
		}
	});

	it("runs the whole flow through the boundary", async () => {
		expect(document.ingestionStatus).toBe("ingested");
		const { report } = await call<{ report: EvaluationReport }>(TOKENS.aViewer, "evaluation.get", { evaluationId: evaluation.id });
		expect(report.evaluation.status).toBe("completed");
		expect(report.findings).toHaveLength(SEED_SAAS_CRITERIA.length);
		const verify = await call<{ ok: boolean }>(TOKENS.aViewer, "evaluation.verify", { evaluationId: evaluation.id });
		expect(verify.ok).toBe(true);
		const replay = await call<{ evaluation: Evaluation }>(TOKENS.aAnalyst, "evaluation.start", { startupId: startup.id, thesisVersionId: version.id, requestKey: "boundary-test-0001" });
		expect(replay.evaluation.id).toBe(evaluation.id);
	});
});

describe("authentication and permissions", () => {
	it("refuses calls without a valid credential", async () => {
		expect(await code(call(undefined, "startup.list", {}))).toMatch(/UNAUTHORIZED|FORBIDDEN/);
		expect(await code(call("not-a-real-token", "startup.list", {}))).toMatch(/UNAUTHORIZED|FORBIDDEN/);
	});

	it("enforces role permissions server-side", async () => {
		expect(await code(call(TOKENS.aViewer, "startup.create", { name: "Nope" }))).toBe("FORBIDDEN");
		expect(await code(call(TOKENS.aViewer, "evaluation.start", { startupId: startup.id, thesisVersionId: version.id, requestKey: "viewer-attempt-1" }))).toBe("FORBIDDEN");
		const t = (await call<{ thesis: InvestmentThesis }>(TOKENS.aAnalyst, "thesis.create", { name: "Analyst draft", criteria: SEED_SAAS_CRITERIA })).thesis;
		expect(await code(call(TOKENS.aAnalyst, "thesis.approve", { thesisId: t.id, expectedVersion: t.__version }))).toBe("FORBIDDEN");
		expect(await code(call(TOKENS.aAnalyst, "decision.record", { evaluationId: evaluation.id, decision: "decline", rationale: "Analysts cannot decide.", expectedSequence: 1 }))).toBe("FORBIDDEN");
		expect(await code(call(TOKENS.aViewer, "audit.list", {}))).toBe("OK");
	});

	it("maps domain failures to the declared error codes", async () => {
		expect(await code(call(TOKENS.aPartner, "thesis.approve", { thesisId: thesis.id, expectedVersion: 999 }))).toBe("CONFLICT");
		expect(await code(call(TOKENS.aPartner, "review.record", { evaluationId: evaluation.id, findingId: null, action: "override", outcome: "supported", reason: "x" }))).toBe("INVALID_INPUT");
		expect(await code(call(TOKENS.aPartner, "startup.get", { startupId: "su_does_not_exist" }))).toBe("NOT_FOUND");
		expect(await code(call(TOKENS.aPartner, "startup.create", { name: "X", workspaceId: "ws-b" }))).toBe("INVALID_INPUT");
	});
});

describe("workspace isolation", () => {
	const B = TOKENS.bPartner;
	it("returns NOT_FOUND for every read of another workspace's identifiers", async () => {
		for (const [name, input] of [
			["thesis.get", { thesisId: thesis.id }],
			["thesis.version.get", { versionId: version.id }],
			["startup.get", { startupId: startup.id }],
			["document.get", { documentId: document.id }],
			["document.page", { documentId: document.id, page: 1 }],
			["document.link", { documentId: document.id }],
			["evidence.list", { startupId: startup.id }],
			["evaluation.get", { evaluationId: evaluation.id }],
			["evaluation.verify", { evaluationId: evaluation.id }],
		] as const)
			expect(`${name}:${await code(call(B, name, input))}`).toBe(`${name}:NOT_FOUND`);
	});

	it("refuses every write against another workspace's identifiers", async () => {
		expect(await code(call(B, "document.upload", { startupId: startup.id, filename: "x.pdf", mediaType: "application/pdf", sourceType: "founder_deck", contentBase64: b64(NORTHWIND_DECK) }))).toBe("NOT_FOUND");
		expect(await code(call(B, "evaluation.start", { startupId: startup.id, thesisVersionId: version.id, requestKey: "cross-workspace-1" }))).toBe("NOT_FOUND");
		expect(await code(call(B, "evaluation.rerun", { evaluationId: evaluation.id, requestKey: "cross-workspace-2" }))).toBe("NOT_FOUND");
		expect(await code(call(B, "review.record", { evaluationId: evaluation.id, findingId: null, action: "comment", reason: "hello" }))).toBe("NOT_FOUND");
		expect(await code(call(B, "decision.record", { evaluationId: evaluation.id, decision: "decline", rationale: "Not my evaluation at all.", expectedSequence: 1 }))).toBe("NOT_FOUND");
		expect(await code(call(B, "thesis.draft.update", { thesisId: thesis.id, expectedVersion: 1, criteria: SEED_SAAS_CRITERIA }))).toBe("NOT_FOUND");
		expect(await code(call(B, "evidence.attach", { startupId: startup.id, claim: "x", reference: "y" }))).toBe("NOT_FOUND");
		expect(await code(call(B, "document.purge", { documentId: document.id, reason: "malicious" }))).toBe("NOT_FOUND");
		expect(await code(call(B, "startup.update", { startupId: startup.id, expectedVersion: 1, name: "Hijacked" }))).toBe("NOT_FOUND");
	});

	it("shows another workspace nothing in lists, overview or audit", async () => {
		expect((await call<{ items: unknown[] }>(B, "startup.list", {})).items).toEqual([]);
		expect((await call<{ items: unknown[] }>(B, "thesis.list", {})).items).toEqual([]);
		expect((await call<{ items: unknown[] }>(B, "evaluation.list", {})).items).toEqual([]);
		expect((await call<{ items: unknown[] }>(B, "audit.list", {})).items).toEqual([]);
		const { overview } = await call<{ overview: { counts: Record<string, number> } }>(B, "workspace.overview", {});
		expect(overview.counts).toEqual({ startups: 0, evaluations: 0, documents: 0 });
		// A request key reused in another workspace creates that workspace's own evaluation, never a reference to A's.
		const own = (await call<{ startup: Startup }>(B, "startup.create", { name: "B's company" })).startup;
		expect(await code(call(B, "evaluation.start", { startupId: own.id, thesisVersionId: version.id, requestKey: "boundary-test-0001" }))).toBe("NOT_FOUND");
	});
});

describe("HTTP hardening", () => {
	it("refuses cross-origin writes and oversized bodies", async () => {
		const res = await fetch(`${h.url}/appport`, { method: "POST", headers: { origin: "https://evil.example", "content-type": "application/json" }, body: "{}" });
		expect(res.status).toBe(403);
		const big = await fetch(`${h.url}/appport`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${TOKENS.aAnalyst}` }, body: "x".repeat(4 * 1024 * 1024) });
		expect(big.status).toBe(413);
	});

	it("serves originals only through short-lived signed links, with a sandboxing CSP", async () => {
		const { url } = await call<{ url: string }>(TOKENS.aViewer, "document.link", { documentId: document.id });
		const res = await fetch(`${h.url}${url}`);
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toBe("application/pdf");
		expect(res.headers.get("content-security-policy")).toContain("sandbox");
		expect(new Uint8Array(await res.arrayBuffer()).byteLength).toBe(NORTHWIND_DECK.byteLength);
		expect((await fetch(`${h.url}${url}x`)).status).toBe(404);
		expect((await fetch(`${h.url}/files/forged.token`)).status).toBe(404);
	});
});
