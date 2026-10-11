import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let dir: string;
beforeAll(async () => {
	dir = await mkdtemp(join(tmpdir(), "invest-cli-"));
	await writeFile(join(dir, "firms.csv"), "url,name,notes\nghost-capital.invalid,Ghost Capital,from a list\nhttps://www.ghost-capital.invalid/about,,dup\nhttp://10.0.0.1/,Internal,\nlocalhost,Local,\n");
});
afterAll(async () => rm(dir, { recursive: true, force: true }));

async function cli(...args: string[]) {
	const p = Bun.spawn(["bun", "invest/scripts/research-firms.ts", ...args], { env: { ...process.env, FELTDB_DIR: join(dir, "felt"), DOCUMENT_STORAGE_DIR: join(dir, "docs"), APP_ENV: "test", JEV_ENDPOINT: "", FELTDB_TELEMETRY: "0" }, stdout: "pipe", stderr: "pipe" });
	const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
	return { out, err, code };
}

describe("research CLI", () => {
	it("explains usage and rejects bad arguments", async () => {
		expect((await cli("--help")).out).toContain("--dry-run");
		const bad = await cli(join(dir, "firms.csv"));
		expect(bad.code).toBe(2);
		expect(bad.err).toContain("--workspace is required");
		expect((await cli(join(dir, "firms.csv"), "--workspace", "ws-dev", "--max-pages", "500")).err).toContain("between 1 and 50");
	});
	it("dry-runs without writing, then runs, then re-runs without duplicating", async () => {
		const file = join(dir, "firms.csv");
		const dry = await cli(file, "--workspace", "ws-dev", "--dry-run");
		expect(dry.code).toBe(0);
		expect(dry.out).toContain("would_create");
		expect(dry.out).toContain("duplicate rows collapsed: 1");
		expect(dry.out).toContain("rejected rows: 2");
		const real = await cli(file, "--workspace", "ws-dev", "--retries", "0", "--json", join(dir, "r.json"));
		expect(real.code).toBe(0);
		expect(real.out).toContain("firm: created; research: research_incomplete");
		const json = JSON.parse(await readFile(join(dir, "r.json"), "utf8"));
		expect(json.firms).toHaveLength(1);
		expect(json.firms[0]).toMatchObject({ domain: "ghost-capital.invalid", name: "Ghost Capital", status: "research_incomplete" });
		expect(json.rejected).toHaveLength(2);
		const again = await cli(file, "--workspace", "ws-dev", "--retries", "0");
		expect(again.out).toContain("firm: unchanged; research: research_incomplete");
		const dry2 = await cli(file, "--workspace", "ws-dev", "--dry-run");
		expect(dry2.out).toContain("would_leave");
	}, 60_000);
});
