import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyData } from "../scripts/lib/data-safety.ts";

const dirs: string[] = [];
afterEach(async () => {
	for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

async function start(dir: string, port: number) {
	const proc = Bun.spawn(["bun", "invest/start-server.ts"], {
		env: { ...process.env, APP_ENV: "development", INVEST_HOST: "127.0.0.1", INVEST_PORT: String(port), FELTDB_DIR: join(dir, "felt"), DOCUMENT_STORAGE_DIR: join(dir, "docs"), JEV_ENDPOINT: "", FELTDB_TELEMETRY: "0", MONITORING_ENABLED: "1", LOG_LEVEL: "info" },
		stdout: "pipe",
		stderr: "pipe",
	});
	for (let i = 0; i < 100; i++) {
		const ok = await fetch(`http://127.0.0.1:${port}/healthz`).then((r) => r.ok, () => false);
		if (ok) return proc;
		await new Promise((r) => setTimeout(r, 100));
	}
	proc.kill(9);
	throw new Error("server did not start");
}

describe("the real server process", () => {
	it("stops cleanly on SIGTERM (exit 0, lock released, data verifies) and starts again on the same data", async () => {
		const dir = await mkdtemp(join(tmpdir(), "invest-proc-"));
		dirs.push(dir);
		const port = 20_000 + Math.floor(Math.random() * 20_000);
		const first = await start(dir, port);
		const res = await fetch(`http://127.0.0.1:${port}/appport`, { headers: { authorization: "Bearer dev-partner-token" } });
		expect(res.status).not.toBe(500);
		first.kill("SIGTERM");
		expect(await first.exited).toBe(0);
		expect((await verifyData({ feltDir: join(dir, "felt"), documentsDir: join(dir, "docs") })).ok).toBe(true);
		const second = await start(dir, port);
		second.kill("SIGINT");
		expect(await second.exited).toBe(0);
	}, 60_000);

	it("refuses to start in production without the required configuration, with a clear message and no stack trace", async () => {
		const proc = Bun.spawn(["bun", "invest/start-server.ts"], { env: { ...process.env, APP_ENV: "production", FELTDB_DIR: "", AUTHBOUNDRY_CONFIG_PATH: "" }, stdout: "pipe", stderr: "pipe" });
		const err = await new Response(proc.stderr).text();
		expect(await proc.exited).toBe(2);
		expect(err).toContain("Configuration error");
		expect(err).not.toContain("    at ");
	}, 30_000);
});
