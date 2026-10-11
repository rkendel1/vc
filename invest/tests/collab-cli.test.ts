import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let dir: string;
beforeAll(async () => {
	dir = await mkdtemp(join(tmpdir(), "invest-srccli-"));
	await writeFile(join(dir, "spec.json"), JSON.stringify({ name: "Offline Directory", canonicalUrl: "https://directory.invalid/d.csv", publisher: "Nobody", sourceType: "directory", adapter: "csv_dataset", accessBasis: "licensed_dataset", termsNote: "A test source on a reserved TLD: never reachable, always blocked by network policy.", mapping: { nameField: "name" } }));
	await writeFile(join(dir, "bad.json"), JSON.stringify({ name: "No Basis", canonicalUrl: "https://directory.invalid/d.csv", publisher: "Nobody", sourceType: "directory", adapter: "csv_dataset", termsNote: "x", mapping: { nameField: "name" } }));
});
afterAll(async () => rm(dir, { recursive: true, force: true }));

async function sources(...args: string[]) {
	const p = Bun.spawn(["bun", "invest/scripts/sources.ts", ...args], { env: { ...process.env, FELTDB_DIR: join(dir, "felt"), DOCUMENT_STORAGE_DIR: join(dir, "docs"), APP_ENV: "test", JEV_ENDPOINT: "", FELTDB_TELEMETRY: "0" }, stdout: "pipe", stderr: "pipe" });
	const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
	return { out, err, code };
}

describe("sources CLI", () => {
	it("registers a source with an attested basis, lists it, runs it safely offline, and refuses bad specs", async () => {
		expect((await sources("list")).err).toContain("--workspace is required");
		expect((await sources("frobnicate", "--workspace", "ws-dev")).err).toContain("Unknown command");
		const reg = await sources("register", join(dir, "spec.json"), "--workspace", "ws-dev");
		expect(reg.out).toContain("Registered: Offline Directory");
		expect(reg.out).toContain("access basis: licensed_dataset");
		expect((await sources("register", join(dir, "spec.json"), "--workspace", "ws-dev")).out).toContain("Already registered");
		const bad = await sources("register", join(dir, "bad.json"), "--workspace", "ws-dev");
		expect(bad.code).not.toBe(0);
		expect(bad.err + bad.out).toMatch(/automated access is permitted|accessBasis/);
		const list = await sources("list", "--workspace", "ws-dev");
		expect(list.out).toContain("Offline Directory");
		expect(list.out).toContain("monitored");
		const run = await sources("run", "Offline Directory", "--workspace", "ws-dev");
		expect(run.code).toBe(1);
		expect(run.out).toContain("FAILED");
		expect(run.out).toContain("blocked_network_policy");
		expect((await sources("list", "--workspace", "ws-dev")).out).toContain("failed");
		expect((await sources("matches", "--workspace", "ws-dev")).out).toContain("No candidate matches");
	}, 60_000);
});
