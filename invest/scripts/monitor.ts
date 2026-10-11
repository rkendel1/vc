/**
 * Monitoring CLI.
 *
 *   bun run monitor -- run     --workspace ws-dev            one monitoring cycle: every due firm, once
 *   bun run monitor -- run     --workspace ws-dev --daemon   keep running cycles until SIGINT/SIGTERM (graceful)
 *   bun run monitor -- status  --workspace ws-dev            every target: schedule, last attempt, last success, failures
 *   bun run monitor -- pause   alpine.vc --workspace ws-dev  stop scheduling; profile and history are kept
 *   bun run monitor -- resume  alpine.vc --workspace ws-dev  schedule it again (due promptly)
 *
 * `--now <ISO time>` freezes the clock, so a cycle can be tested without waiting for an interval.
 * `--dry-run` lists what a cycle would check without touching the network or the store.
 */
import { writeFile } from "node:fs/promises";
import type { MonitoringTarget } from "../domain/research.ts";
import { MonitoringRunner } from "../modules/monitoring.ts";
import { normalizeFirmUrl } from "../research/url.ts";
import { C } from "../store/store.ts";
import { openStack } from "./stack.ts";

const USAGE = `Usage: bun run monitor -- <run|status|pause|resume> [domain] --workspace <id> [options]

  run                     Run one monitoring cycle (every due firm, once). Exits 1 if any check failed to run.
  status                  Show every monitoring target
  pause <domain>          Stop scheduling a firm. Its profile, sources, findings and history are kept.
  resume <domain>         Schedule a paused firm again; it becomes due promptly.

  --workspace <id>        Required
  --now <ISO time>        Freeze the clock (testing): firms due at or before this time are due now
  --limit <n>             Check at most n firms this cycle
  --dry-run               With run: list what is due; no network, no writes
  --daemon                With run: repeat cycles every --tick-seconds until SIGINT/SIGTERM
  --tick-seconds <n>      Daemon wake-up interval (default 60). The schedule itself is persisted.
  --interval-minutes <n>  With resume: also change the firm's interval
  --json <path>           Also write the result as JSON
`;
const fail = (m: string): never => {
	console.error(`${m}\n\n${USAGE}`);
	process.exit(2);
};

const argv = process.argv.slice(2);
const opts: Record<string, string | boolean> = {};
const positional: string[] = [];
for (let i = 0; i < argv.length; i++) {
	const a = argv[i]!;
	if (a === "-h" || a === "--help") {
		console.log(USAGE);
		process.exit(0);
	}
	if (a === "--dry-run" || a === "--daemon") opts[a.slice(2)] = true;
	else if (a.startsWith("--")) opts[a.slice(2)] = argv[++i] ?? fail(`${a} needs a value`);
	else positional.push(a);
}
const command = positional[0] ?? "run";
if (!["run", "status", "pause", "resume"].includes(command)) fail(`Unknown command ${command}`);
const workspace = String(opts.workspace ?? "") || fail("--workspace is required");
const int = (name: string, min: number, max: number): number | undefined => {
	if (opts[name] === undefined) return undefined;
	const n = Number(opts[name]);
	return Number.isInteger(n) && n >= min && n <= max ? n : fail(`--${name} must be an integer between ${min} and ${max}`);
};
let nowOverride: Date | null = null;
if (opts.now) {
	nowOverride = new Date(String(opts.now));
	if (Number.isNaN(nowOverride.getTime())) fail("--now must be an ISO time such as 2026-10-11T09:00:00Z");
}
const limit = int("limit", 1, 5000);
const tick = int("tick-seconds", 5, 3600) ?? 60;
const intervalMinutes = int("interval-minutes", 15, 43_200);

const stack = await openStack({ workspace, clock: nowOverride ? () => new Date(nowOverride!) : undefined, fail });
const { monitoring, store, actor } = stack;
let json: unknown = null;
try {
	if (command === "status") {
		const targets = (await store.list<MonitoringTarget>(C.monitoringTargets, workspace)).sort((a, b) => a.canonicalDomain.localeCompare(b.canonicalDomain));
		for (const t of targets)
			console.log(`${t.canonicalDomain.padEnd(32)} ${t.enabled ? "enabled" : "PAUSED "} every ${t.intervalMinutes}m  next ${t.nextCheckAt ?? "—"}  last attempt ${t.lastAttemptAt ?? "—"}  last success ${t.lastSuccessAt ?? "—"}  failures ${t.consecutiveFailures}${t.lease ? "  [checking]" : ""}${t.lastError ? `\n    last error: ${t.lastError.message}` : ""}`);
		if (!targets.length) console.log("No monitoring targets. Register firms with: bun run research -- <file> --workspace <id>");
		json = targets;
	} else if (command === "pause" || command === "resume") {
		const domain = positional[1] ?? fail(`${command} needs a firm domain`);
		const firm = await stack.research.lookup(actor, normalizeFirmUrl(domain).canonicalDomain);
		if (!firm) fail(`No firm ${domain} in workspace ${workspace}`);
		const target = await monitoring.configure(actor, firm!.id, { enabled: command === "resume", ...(command === "resume" && intervalMinutes ? { intervalMinutes } : {}) });
		console.log(`${firm!.canonicalDomain}: ${target.enabled ? `monitoring resumed; next check ${target.nextCheckAt}` : "monitoring paused (profile and history kept)"}`);
		json = target;
	} else if (opts.daemon) {
		const runner = new MonitoringRunner(monitoring, () => [workspace], { info: (m, f) => console.log(m, JSON.stringify(f ?? {})), warn: (m, f) => console.error(m, JSON.stringify(f ?? {})) }, tick * 1000);
		await monitoring.recoverOnStartup([workspace]);
		runner.start();
		console.log(`Monitoring ${workspace}; waking every ${tick}s. Ctrl-C to stop after the checks in flight finish.`);
		await new Promise<void>((resolve) => {
			const stop = () => resolve();
			process.once("SIGINT", stop);
			process.once("SIGTERM", stop);
		});
		console.log("Stopping: finishing checks in flight…");
		await runner.stop();
	} else {
		const report = await monitoring.runCycle({ workspaceIds: [workspace], limit, dryRun: opts["dry-run"] === true });
		console.log(`${opts["dry-run"] ? "Dry run: due now" : "Monitoring cycle"} at ${report.at}: ${report.due} due, ${report.entries.length} handled`);
		for (const e of report.entries) console.log(`  ${e.domain.padEnd(32)} ${e.result}${e.runId ? ` run ${e.runId}` : ""}${e.success === false ? " (check unsuccessful; will retry with backoff)" : ""}${e.message ? ` — ${e.message}` : ""}`);
		json = report;
		process.exitCode = report.entries.some((e) => e.result === "failed") ? 1 : 0;
	}
	if (opts.json) await writeFile(String(opts.json), `${JSON.stringify(json, null, 2)}\n`, { mode: 0o600 });
} finally {
	await stack.close();
}
