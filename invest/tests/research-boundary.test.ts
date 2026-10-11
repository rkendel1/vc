import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { AppPortError } from "@appport/sdk";
import type { FirmListItem, FirmProfile } from "../domain/research.ts";
import { UnconfiguredJev } from "../jev/jev-client.ts";
import { FakeWeb, thesisSite } from "../testing/fake-web.ts";
import { type HttpHarness, TOKENS, startHttpHarness } from "../testing/http-harness.ts";
import { actor } from "../testing/harness.ts";

let h: HttpHarness;
let web: FakeWeb;
let firmId: string;

async function call<T>(token: string | undefined, name: string, input: unknown): Promise<T> {
	const client = h.client(token);
	await client.connect();
	try {
		return await client.call<T>(name, input as never);
	} finally {
		await client.close();
	}
}
const code = (p: Promise<unknown>) => p.then(() => "OK", (e: AppPortError) => e.code);

beforeAll(async () => {
	const site = thesisSite();
	site["/"] = { ...(site["/"] as object), delayMs: 400 }; // keeps the first refresh in flight long enough to observe
	web = new FakeWeb({ "alpine.vc": site });
	h = await startHttpHarness({ jev: new UnconfiguredJev(), fetcherFor: web.fetcherFor });
	const r = await h.runtime.service.research.reconcile(actor("ws-a"), { url: "https://alpine.vc", name: "Alpine" });
	firmId = r.firm.id;
});
afterAll(async () => h?.close());

describe("firm capabilities over AppPort", () => {
	it("starts a refresh by firm id only, in-process, and publishes the result through firm.get", async () => {
		// The capability takes a firm id only: a URL is not an accepted property, so a caller cannot aim the crawler.
		expect(await code(call(TOKENS.aAnalyst, "firm.refresh", { firmId, url: "http://127.0.0.1:9/" }))).toBe("INVALID_INPUT");
		const started = await call<{ run: { id: string; status: string } }>(TOKENS.aAnalyst, "firm.refresh", { firmId });
		expect(started.run.status).toBe("running");
		expect(await code(call(TOKENS.aAnalyst, "firm.refresh", { firmId }))).toBe("CONFLICT");
		await h.runtime.service.research.settled();
		expect(web.requests.every((r) => r.url.startsWith("https://alpine.vc/") || r.url.startsWith("https://www.alpine.vc/"))).toBe(true);
		const { profile } = await call<{ profile: FirmProfile }>(TOKENS.aViewer, "firm.get", { firmId });
		expect(profile.firm.researchStatus).toBe("thesis_found");
		expect(profile.criteria.length).toBeGreaterThan(5);
		expect(profile.runs[0]?.startedBy).toBe("arun");
		const list = await call<{ items: FirmListItem[] }>(TOKENS.aViewer, "firm.list", { query: "fintech", status: "thesis_found" });
		expect(list.items.map((i) => i.id)).toEqual([firmId]);
		expect((await call<{ items: FirmListItem[] }>(TOKENS.aViewer, "firm.list", { status: "no_thesis_found" })).items).toEqual([]);
		expect((await call<{ items: FirmListItem[] }>(TOKENS.aViewer, "firm.list", { query: "zzz" })).items).toEqual([]);
	});

	it("enforces permissions per capability", async () => {
		const { profile } = await call<{ profile: FirmProfile }>(TOKENS.aPartner, "firm.get", { firmId });
		const criterion = profile.criteria.find((c) => c.field === "check_size")!;
		expect(await code(call(undefined, "firm.list", {}))).toBe("UNAUTHORIZED");
		expect(await code(call(TOKENS.aViewer, "firm.refresh", { firmId }))).toBe("FORBIDDEN");
		expect(await code(call(TOKENS.aViewer, "firm.verify", { firmId }))).toBe("FORBIDDEN");
		expect(await code(call(TOKENS.aViewer, "firm.review", { firmId, action: "note", note: "x" }))).toBe("FORBIDDEN");
		expect(await code(call(TOKENS.aAnalyst, "firm.approve", { firmId, criterionId: criterion.id, note: "x" }))).toBe("FORBIDDEN");
		expect(await code(call(TOKENS.aAnalyst, "firm.review", { firmId, criterionId: criterion.id, action: "flag", note: "stale?" }))).toBe("OK");
		const approved = await call<{ approval: { id: string } }>(TOKENS.aPartner, "firm.approve", { firmId, criterionId: criterion.id, note: "partner confirmed" });
		expect(await code(call(TOKENS.aPartner, "firm.approve", { firmId, criterionId: criterion.id, note: "again" }))).toBe("CONFLICT");
		const after = (await call<{ profile: FirmProfile }>(TOKENS.aViewer, "firm.get", { firmId })).profile;
		expect(after.approvedCurrent.map((a) => a.id)).toEqual([approved.approval.id]);
		expect(after.criteria.find((c) => c.id === criterion.id)?.reviews).toHaveLength(1);
		expect(await code(call(TOKENS.aAnalyst, "firm.approval.withdraw", { firmId, approvalId: approved.approval.id, note: "x" }))).toBe("FORBIDDEN");
		// verify with no Jev: reported as skipped, not as success
		const v = await call<{ summary: { skipped: string | null; attempted: number } }>(TOKENS.aAnalyst, "firm.verify", { firmId });
		expect(v.summary).toMatchObject({ skipped: "jev_not_configured", attempted: 0 });
	});

	it("isolates workspaces: foreign firms are indistinguishable from missing ones", async () => {
		expect((await call<{ items: unknown[] }>(TOKENS.bPartner, "firm.list", {})).items).toEqual([]);
		for (const [name, input] of [
			["firm.get", { firmId }],
			["firm.refresh", { firmId }],
			["firm.verify", { firmId }],
			["firm.review", { firmId, action: "note", note: "x" }],
			["firm.approve", { firmId, field: "stage", value: "seed", note: "x" }],
			["firm.approval.withdraw", { firmId, approvalId: "fa_x", note: "x" }],
		] as const)
			expect(`${name}:${await code(call(TOKENS.bPartner, name, input))}`).toBe(`${name}:NOT_FOUND`);
		expect(await code(call(TOKENS.bPartner, "firm.get", { firmId: "firm_doesnotexist" }))).toBe("NOT_FOUND");
		const audit = await call<{ items: { workspaceId: string; eventType: string }[] }>(TOKENS.bPartner, "audit.list", { eventType: "research.run_completed" });
		expect(audit.items).toEqual([]);
		const own = await call<{ items: { eventType: string }[] }>(TOKENS.aPartner, "audit.list", { limit: 500 });
		const types = new Set(own.items.map((i) => i.eventType));
		for (const t of ["research.firm_created", "research.run_started", "research.run_completed", "research.review_recorded", "firm.criterion_approved"]) expect(types.has(t)).toBe(true);
	});

	it("accepts no workspace identifier and validates review input", async () => {
		const manifest = await (async () => {
			const c = h.client(TOKENS.aViewer);
			await c.connect();
			const m = await c.load();
			await c.close();
			return m;
		})();
		const firmCaps = (manifest.capabilities as unknown as { name: string; inputSchema: unknown }[]).filter((c) => c.name.startsWith("firm."));
		expect(firmCaps.map((c) => c.name).sort()).toEqual(["firm.approval.withdraw", "firm.approve", "firm.get", "firm.list", "firm.monitoring.set", "firm.reconciliation", "firm.refresh", "firm.review", "firm.timeline", "firm.verify"]);
		for (const c of firmCaps) expect(JSON.stringify(c.inputSchema)).not.toMatch(/workspaceId|tenantId|"url"/);
		expect(await code(call(TOKENS.aAnalyst, "firm.review", { firmId, action: "note", note: "" }))).toBe("INVALID_INPUT");
		expect(await code(call(TOKENS.aAnalyst, "firm.review", { firmId, action: "bogus", note: "x" }))).toBe("INVALID_INPUT");
		expect(await code(call(TOKENS.aPartner, "firm.approve", { firmId, field: "stage", value: "Not A Term!", note: "x" }))).toBe("INVALID_INPUT");
	});
});
