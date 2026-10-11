import { afterEach, describe, expect, it } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sha256Hex } from "../domain/canonical.ts";
import { preflight } from "../scripts/preflight.ts";

const dirs: string[] = [];
afterEach(async () => {
	for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

async function prodEnv() {
	const root = await mkdtemp(join(tmpdir(), "invest-pf-"));
	dirs.push(root);
	const felt = join(root, "felt");
	const docs = join(root, "docs");
	await mkdir(felt, { mode: 0o700 });
	await mkdir(docs, { mode: 0o700 });
	const auth = join(root, "auth.json");
	await writeFile(auth, JSON.stringify({ workspaces: [{ id: "ws-w", name: "W" }], principals: [{ id: "p", displayName: "P", workspaceId: "ws-w", role: "partner", tokenSha256: sha256Hex("x".repeat(43)) }] }), { mode: 0o600 });
	await chmod(root, 0o700);
	return { felt, auth, env: { APP_ENV: "production", FELTDB_DIR: felt, DOCUMENT_STORAGE_DIR: docs, DOCUMENT_STORAGE_LINK_SECRET: "a-long-random-link-secret-1", AUTHBOUNDRY_CONFIG_PATH: auth } };
}
const blocking = (f: { level: string; message: string }[]) => f.filter((x) => x.level === "blocking").map((x) => x.message);

describe("preflight", () => {
	it("passes a sound production configuration and says who runs the monitoring scheduler", async () => {
		const { env } = await prodEnv();
		const f = await preflight(env);
		expect(blocking(f)).toEqual([]);
		expect(f.some((x) => x.message.includes("MONITORING_ENABLED=0"))).toBe(true);
		expect((await preflight({ ...env, MONITORING_ENABLED: "1" })).some((x) => x.message.includes("in-process"))).toBe(true);
	});
	it("blocks on bad configuration, an unreadable snapshot, an invalid registry and loose permissions", async () => {
		const { env, felt, auth } = await prodEnv();
		expect(blocking(await preflight({ ...env, DOCUMENT_STORAGE_LINK_SECRET: undefined })).join()).toContain("LINK_SECRET");
		await writeFile(join(felt, "state.json"), "{ garbage");
		expect(blocking(await preflight(env)).join()).toContain("not valid JSON");
		await rm(join(felt, "state.json"));
		await chmod(auth, 0o644);
		expect(blocking(await preflight(env)).join()).toContain("readable by other accounts");
		await chmod(auth, 0o600);
		await writeFile(auth, "nope");
		expect(blocking(await preflight(env)).join()).toContain("identity registry");
	});
});
