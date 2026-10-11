import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let dir: string;
beforeAll(async () => {
	dir = await mkdtemp(join(tmpdir(), "invest-moncli-"));
	await writeFile(join(dir, "firms.txt"), "ghost-capital.invalid\nsecond-ghost.invalid\n");
});
afterAll(async () => rm(dir, { recursive: true, force: true }));

async function bunRun(script: string, ...args: string[]) {
	const p = Bun.spawn(["bun", script, ...args], { env: { ...process.env, FELTDB_DIR: join(dir, "felt"), DOCUMENT_STORAGE_DIR: join(dir, "docs"), APP_ENV: "test", JEV_ENDPOINT: "", FELTDB_TELEMETRY: "0" }, stdout: "pipe", stderr: "pipe" });
	const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
	return { out, err, code };
}
const research = (...a: string[]) => bunRun("invest/scripts/research-firms.ts", ...a);
const monitor = (...a: string[]) => bunRun("invest/scripts/monitor.ts", ...a);

describe("monitor CLI", () => {
	it("explains usage and rejects bad input", async () => {
		expect((await monitor("--help")).out).toContain("--now");
		expect((await monitor("run")).err).toContain("--workspace is required");
		expect((await monitor("frobnicate", "--workspace", "ws-dev")).err).toContain("Unknown command");
		expect((await monitor("run", "--workspace", "ws-dev", "--now", "yesterday")).err).toContain("ISO time");
		expect((await monitor("pause", "--workspace", "ws-dev")).err).toContain("needs a firm domain");
	});

	it("registers targets with the research command, runs a cycle on demand with a frozen clock, pauses and resumes", async () => {
		const reg = await research(join(dir, "firms.txt"), "--workspace", "ws-dev", "--retries", "0");
		expect(reg.code).toBe(0);
		expect(reg.out).toContain("monitoring: registered");
		const status = await monitor("status", "--workspace", "ws-dev");
		expect(status.out).toContain("ghost-capital.invalid");
		expect(status.out).toContain("enabled every 1440m");
		// nothing is due right after registration
		const none = await monitor("run", "--workspace", "ws-dev");
		expect(none.out).toContain("0 due");
		// two days later, on demand, without waiting
		const later = new Date(Date.now() + 2 * 86_400_000).toISOString();
		const dry = await monitor("run", "--workspace", "ws-dev", "--now", later, "--dry-run");
		expect(dry.out).toContain("2 due");
		expect(dry.out).toContain("would_run");
		const ran = await monitor("run", "--workspace", "ws-dev", "--now", later, "--json", join(dir, "cycle.json"));
		expect(ran.code).toBe(0);
		expect(ran.out).toContain("ghost-capital.invalid");
		const cycle = JSON.parse(await readFile(join(dir, "cycle.json"), "utf8"));
		expect(cycle.entries.map((e: { result: string }) => e.result)).toEqual(["ran", "ran"]);
		expect((await monitor("run", "--workspace", "ws-dev", "--now", later)).out).toContain("0 due"); // idempotent
		const paused = await monitor("pause", "ghost-capital.invalid", "--workspace", "ws-dev");
		expect(paused.out).toContain("paused (profile and history kept)");
		expect((await monitor("status", "--workspace", "ws-dev")).out).toContain("PAUSED");
		const farLater = new Date(Date.now() + 9 * 86_400_000).toISOString();
		expect((await monitor("run", "--workspace", "ws-dev", "--now", farLater, "--dry-run")).out).toContain("1 due");
		expect((await monitor("resume", "ghost-capital.invalid", "--workspace", "ws-dev", "--interval-minutes", "720")).out).toContain("resumed");
		expect((await monitor("pause", "nosuch.vc", "--workspace", "ws-dev")).err).toContain("No firm");
		// registering again keeps the target; --no-monitor leaves new firms unmonitored
		expect((await research(join(dir, "firms.txt"), "--workspace", "ws-dev", "--retries", "0")).out).toContain("monitoring: already_registered");
	});
});
