import { afterEach, describe, expect, it } from "bun:test";
import type { AppPortError } from "@appport/sdk";
import type { AuditEvent } from "../domain/types.ts";
import { C } from "../store/store.ts";
import { type HttpHarness, TOKENS, startHttpHarness } from "../testing/http-harness.ts";

let h: HttpHarness | undefined;
afterEach(async () => {
	await h?.close();
	h = undefined;
});

async function call<T = unknown>(token: string, name: string, input: unknown = {}): Promise<T> {
	const client = h!.client(token);
	await client.connect();
	try {
		return await client.call<T>(name, input as never);
	} finally {
		await client.close();
	}
}
const code = (p: Promise<unknown>) => p.then(() => "OK", (e: AppPortError) => e.code);
const all = async () => (await h!.runtime.store.dumpForTests(C.audit)) as unknown as AuditEvent[];

describe("audit trail review", () => {
	it("is readable only with audit.read, and only for the caller's own workspace", async () => {
		h = await startHttpHarness();
		await call(TOKENS.aAnalyst, "startup.create", { name: "Northwind" });
		expect(await code(call(TOKENS.fFounder, "audit.list"))).toBe("FORBIDDEN"); // a founder has no audit permission
		expect((await call<{ items: AuditEvent[] }>(TOKENS.aViewer, "audit.list")).items.some((e) => e.eventType === "startup.created")).toBe(true);
		const other = await call<{ items: AuditEvent[] }>(TOKENS.bPartner, "audit.list");
		expect(other.items.every((e) => e.workspaceId === "ws-b")).toBe(true);
		expect(other.items.some((e) => e.eventType === "startup.created")).toBe(false);
	});

	it("records actor, action, target and time; a refused or failed action leaves no success record", async () => {
		h = await startHttpHarness();
		const before = (await all()).length;
		expect(await code(call(TOKENS.aViewer, "startup.create", { name: "Nope" }))).toBe("FORBIDDEN");
		expect(await code(call(TOKENS.aPartner, "thesis.approve", { thesisId: "th_missing", expectedVersion: 1 }))).not.toBe("OK");
		expect(await code(call(TOKENS.aAnalyst, "startup.get", { startupId: "su_missing" }))).toBe("NOT_FOUND");
		expect((await all()).length).toBe(before);
		await call(TOKENS.aAnalyst, "startup.create", { name: "Northwind" });
		const created = (await all()).filter((e) => e.eventType === "startup.created");
		expect(created).toHaveLength(1);
		expect(created[0]).toMatchObject({ actorId: "arun", workspaceId: "ws-a" });
		expect(Date.parse(created[0]!.timestamp)).not.toBeNaN();
		expect(created[0]!.entityRef).toBeTruthy();
	});

	it("never stores credentials, link secrets or submitted document/claim text in audit payloads", async () => {
		h = await startHttpHarness();
		const claim = "SENSITIVE-FOUNDER-CLAIM-TEXT-8841";
		await call(TOKENS.aAnalyst, "startup.create", { name: "Northwind", founderClaims: [claim] });
		await call(TOKENS.fFounder, "startup.create", { name: "Founder Co", founderClaims: [claim] }).catch(() => undefined);
		const dump = JSON.stringify(await all());
		for (const needle of [claim, ...Object.values(TOKENS), "http-harness-link-secret"]) expect(dump).not.toContain(needle);
		expect(dump).not.toMatch(/Bearer\s/);
	});

	it("audit records are not writable through any capability (append-only through the store)", async () => {
		h = await startHttpHarness();
		const names = h.runtime.appport ? JSON.stringify((await import("../appport/manifest.json")).default) : "";
		expect(names).not.toMatch(/audit\.(delete|update|edit|purge|write)/);
	});
});
