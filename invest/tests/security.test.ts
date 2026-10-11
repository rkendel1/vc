import { afterEach, describe, expect, it } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import type { AppPortError } from "@appport/sdk";
import { ConfigError, loadConfig } from "../config.ts";
import { sha256Hex } from "../domain/canonical.ts";
import { createLogger } from "../logger.ts";
import { FailureLimiter } from "../security/rate-limit.ts";
import { type HttpHarness, TOKENS, startHttpHarness } from "../testing/http-harness.ts";

let h: HttpHarness | undefined;
afterEach(async () => {
	await h?.close();
	h = undefined;
});

async function call(token: string | undefined, name: string, input: unknown = {}): Promise<string> {
	const client = h!.client(token);
	try {
		await client.connect();
		await client.call(name, input as never);
		return "OK";
	} catch (e) {
		return (e as AppPortError).code ?? "ERR";
	} finally {
		await client.close().catch(() => undefined);
	}
}
const rawStatus = async (headers: Record<string, string>) => (await fetch(`${h!.url}/appport`, { headers })).status;
const rewrite = async (edit: (r: { principals: Record<string, unknown>[] }) => void) => {
	const reg = JSON.parse(await readFile(h!.registryPath, "utf8"));
	edit(reg);
	await writeFile(h!.registryPath, JSON.stringify(reg));
};

describe("credentials", () => {
	it("no, malformed, wrong and near-miss tokens never authenticate", async () => {
		h = await startHttpHarness();
		for (const t of [undefined, "", "x", "dev-partner-token", `${TOKENS.aPartner} `.trim() + "0", TOKENS.aPartner.toUpperCase(), "Bearer"]) expect(await call(t, "audit.list")).not.toBe("OK");
		expect(await call(TOKENS.aPartner, "audit.list")).toBe("OK");
	});

	it("a token whose principal is disabled or expired stops working on the next request, with no restart", async () => {
		h = await startHttpHarness();
		expect(await call(TOKENS.aAnalyst, "audit.list")).toBe("OK");
		await rewrite((r) => void (r.principals.find((p) => p.id === "arun")!.disabled = true));
		expect(await call(TOKENS.aAnalyst, "audit.list")).not.toBe("OK");
		await rewrite((r) => {
			const p = r.principals.find((x) => x.id === "arun")!;
			p.disabled = false;
			p.expiresAt = "2020-01-01T00:00:00Z";
		});
		expect(await call(TOKENS.aAnalyst, "audit.list")).not.toBe("OK");
		await rewrite((r) => void (r.principals.find((p) => p.id === "arun")!.expiresAt = "2999-01-01T00:00:00Z"));
		expect(await call(TOKENS.aAnalyst, "audit.list")).toBe("OK");
	});

	it("a removed principal is revoked; an unreadable or invalid registry fails closed for everyone and /healthz says so", async () => {
		h = await startHttpHarness();
		await rewrite((r) => void (r.principals = r.principals.filter((p) => p.id !== "vera")));
		expect(await call(TOKENS.aViewer, "audit.list")).not.toBe("OK");
		expect(await call(TOKENS.aPartner, "audit.list")).toBe("OK");
		await writeFile(h.registryPath, "{ not json");
		expect(await call(TOKENS.aPartner, "audit.list")).not.toBe("OK");
		expect((await fetch(`${h.url}/healthz`)).status).toBe(503);
		const body = await (await fetch(`${h.url}/healthz`)).text();
		expect(body).not.toContain("json"); // the reason is for the operator's log, not the response
		await rewrite(() => undefined).catch(() => undefined);
	});

	it("repeated failed sign-ins are rate limited (429); the block is per address, so a good token from the blocked address waits too", async () => {
		const limiter = new FailureLimiter({ maxFailures: 3, windowMs: 60_000, blockMs: 60_000 });
		h = await startHttpHarness({ limiter });
		for (let i = 0; i < 3; i++) expect(await call("nope-nope-nope", "audit.list")).not.toBe("OK");
		expect(await rawStatus({ authorization: "Bearer nope-nope-nope" })).toBe(429);
		expect(await rawStatus({ authorization: `Bearer ${TOKENS.aPartner}` })).toBe(429);
	});
});

describe("authorization and isolation", () => {
	it("roles cannot reach capabilities above their permissions, and workspace identity cannot be supplied in input", async () => {
		h = await startHttpHarness();
		expect(await call(TOKENS.aViewer, "startup.create", { name: "x" })).toBe("FORBIDDEN");
		expect(await call(TOKENS.aAnalyst, "claim.directory")).toBe("FORBIDDEN");
		expect(await call(TOKENS.aPartner, "claim.directory")).toBe("FORBIDDEN");
		expect(await call(TOKENS.fFounder, "claim.directory")).toBe("FORBIDDEN");
		expect(await call(TOKENS.rRep, "claim.directory")).toBe("FORBIDDEN");
		expect(await call(TOKENS.mModerator, "claim.directory")).toBe("OK");
		// A forged workspace id in the input is rejected, never honoured.
		expect(await call(TOKENS.aAnalyst, "startup.create", { name: "x", workspaceId: "ws-b" })).toBe("INVALID_INPUT");
	});

	it("fund B cannot read fund A's records by id", async () => {
		h = await startHttpHarness();
		const client = h.client(TOKENS.aAnalyst);
		await client.connect();
		const { startup } = await client.call<{ startup: { id: string } }>("startup.create", { name: "Northwind" } as never);
		await client.close();
		expect(await call(TOKENS.aAnalyst, "startup.get", { startupId: startup.id })).toBe("OK");
		expect(await call(TOKENS.bPartner, "startup.get", { startupId: startup.id })).toBe("NOT_FOUND");
		expect(await call(TOKENS.fFounder, "startup.get", { startupId: startup.id })).not.toBe("OK");
	});
});

describe("what the server says and logs", () => {
	it("errors carry no stack trace, file path or internal detail", async () => {
		h = await startHttpHarness();
		const res = await fetch(`${h.url}/appport/startup.get`, { method: "POST", headers: { authorization: `Bearer ${TOKENS.aPartner}`, "content-type": "application/json" }, body: "{ broken" });
		const text = await res.text();
		for (const needle of ["at ", "/home/", "node_modules", ".ts:", "Error:"]) expect(text).not.toContain(needle);
		const miss = await (await fetch(`${h.url}/files/not-a-real-link`)).text();
		expect(miss).not.toContain("not-a-real-link");
	});

	it("an internal failure is logged without the signed file link or any bearer token", async () => {
		const lines: string[] = [];
		const logger = createLogger("debug", (l) => void lines.push(l));
		h = await startHttpHarness({ logger });
		const secret = "SIGNED.LINK.SECRET";
		// Force a 500 on the file route by making link verification throw.
		(h.runtime.storage as unknown as { verifyLink: () => never }).verifyLink = () => {
			throw new Error(`boom Bearer ${TOKENS.aPartner}`);
		};
		const res = await fetch(`${h.url}/files/${secret}`);
		expect(res.status).toBe(500);
		expect(await res.text()).not.toContain("boom");
		expect(lines.join("\n")).not.toContain(secret);
		expect(lines.join("\n")).not.toContain(TOKENS.aPartner);
	});

	it("HSTS is sent only in production behind TLS; every response carries nosniff and no CORS", async () => {
		h = await startHttpHarness();
		const res = await fetch(`${h.url}/healthz`);
		expect(res.headers.get("x-content-type-options")).toBe("nosniff");
		expect(res.headers.get("access-control-allow-origin")).toBeNull();
		expect(res.headers.get("strict-transport-security")).toBeNull();
		expect((await fetch(`${h.url}/appport`, { method: "OPTIONS" })).status).toBe(403);
		expect((await fetch(`${h.url}/appport/startup.create`, { method: "POST", headers: { origin: "https://evil.example", authorization: `Bearer ${TOKENS.aPartner}` }, body: "{}" })).status).toBe(403);
	});
});

describe("startup policy", () => {
	const prod = { APP_ENV: "production", FELTDB_DIR: "/srv/felt", DOCUMENT_STORAGE_DIR: "/srv/docs", DOCUMENT_STORAGE_LINK_SECRET: "a-long-random-link-secret-1", AUTHBOUNDRY_CONFIG_PATH: "/srv/auth.json" };
	it("production starts only with explicit directories, a registry, a link secret and no dev token", () => {
		expect(() => loadConfig(prod)).not.toThrow();
		for (const drop of ["FELTDB_DIR", "DOCUMENT_STORAGE_DIR", "DOCUMENT_STORAGE_LINK_SECRET", "AUTHBOUNDRY_CONFIG_PATH"]) {
			const env: Record<string, string | undefined> = { ...prod, [drop]: undefined };
			expect(() => loadConfig(env), drop).toThrow(ConfigError);
		}
		expect(() => loadConfig({ ...prod, INVEST_DEV_TOKEN: "dev-partner-token" })).toThrow(ConfigError);
		expect(() => loadConfig({ ...prod, JEV_ENDPOINT: "https://jev.example/decide" })).toThrow(/JEV_API_KEY/);
		expect(() => loadConfig({ ...prod, JEV_ENDPOINT: "http://jev.example/decide", JEV_API_KEY: "k" })).toThrow(/https/);
	});
	it("the development identity can only be served on loopback", () => {
		expect(() => loadConfig({ APP_ENV: "development", INVEST_HOST: "0.0.0.0" })).toThrow(ConfigError);
		expect(() => loadConfig({ APP_ENV: "development", INVEST_HOST: "127.0.0.1" })).not.toThrow();
	});
	it("the well-known dev token is refused in any production registry", async () => {
		const { validateRegistry } = await import("../auth/authboundry-adapter.ts");
		const reg = { workspaces: [{ id: "w", name: "W" }], principals: [{ id: "p", displayName: "P", workspaceId: "w", role: "partner", tokenSha256: sha256Hex("dev-partner-token") }] };
		expect(() => validateRegistry(reg, { production: true })).toThrow();
	});
});

describe("the browser bundle", () => {
	it("contains no server-only configuration names, secrets or known development tokens (when it has been built)", async () => {
		const { readdir, readFile: rf, stat: st } = await import("node:fs/promises");
		const { join: j } = await import("node:path");
		const root = j(import.meta.dir, "../../apps/invest-web/dist");
		if (!(await st(root).then(() => true, () => false))) return; // `bun run build:web` first; the e2e run scans it unconditionally
		const files = (await readdir(root, { recursive: true })).filter((f) => /\.(js|css|html|map)$/.test(f));
		expect(files.length).toBeGreaterThan(0);
		for (const f of files) {
			const text = await rf(j(root, f), "utf8");
			for (const needle of ["JEV_API_KEY", "DOCUMENT_STORAGE_LINK_SECRET", "AUTHBOUNDRY_CONFIG_PATH", "FELTDB_DIR", "tokenSha256", "dev-partner-token", "INVEST_DEV_TOKEN", ...Object.values(TOKENS)]) expect(text.includes(needle), `${f} contains ${needle}`).toBe(false);
		}
	});
});
