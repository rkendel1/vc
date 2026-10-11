/**
 * Pre-start check for a deployment. Reads the same environment as the server and tells the operator, before the server is started,
 * whether it will start and what is wrong. Changes nothing and makes no network call.
 *
 *   APP_ENV=production ... bun run preflight          exit 0 = no blocking problem, 1 = do not start
 *
 * It does not open the database (that can repair a journal); it checks that the snapshot is readable JSON, that no other process holds
 * the writer lock, and that secrets and data are not readable by other accounts.
 */
import { rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadRegistry } from "../auth/authboundry-adapter.ts";
import { ConfigError, loadConfig } from "../config.ts";
import { privateEnough } from "../security/permissions.ts";
import { liveWriter, snapshotProblems } from "./lib/data-safety.ts";

export type Finding = { level: "blocking" | "warning" | "ok"; message: string };

export async function preflight(env: NodeJS.ProcessEnv): Promise<Finding[]> {
	const out: Finding[] = [];
	const add = (level: Finding["level"], message: string) => out.push({ level, message });
	let loaded: ReturnType<typeof loadConfig>;
	try {
		loaded = loadConfig(env);
	} catch (error) {
		add("blocking", `configuration: ${error instanceof ConfigError ? error.message : "invalid"}`);
		return out;
	}
	const { config, warnings } = loaded;
	const production = config.appEnv === "production";
	add("ok", `configuration valid (APP_ENV=${config.appEnv}, host ${config.host})`);
	for (const w of warnings) add("warning", w);
	if (!production) add("warning", "APP_ENV is not production: this is a development/test posture, not a deployment");

	if (config.authConfigPath) {
		try {
			const registry = await loadRegistry(config.authConfigPath, { production });
			add("ok", `identity registry valid: ${registry.principals.length} principal(s) in ${registry.workspaces.length} workspace(s)`);
		} catch (error) {
			add("blocking", `identity registry: ${String(error instanceof Error ? error.message : error).slice(0, 200)}`);
		}
	} else add(production ? "blocking" : "warning", "no identity registry: only the loopback development identity is available");

	for (const [what, dir] of [["database", config.feltdbDir], ["documents", config.documents.storageDir]] as const) {
		const st = await stat(dir).catch(() => null);
		if (!st) {
			add("warning", `${what} directory ${dir} does not exist yet; it will be created (mode 0700) on first start`);
			continue;
		}
		if (!st.isDirectory()) {
			add("blocking", `${what} path ${dir} is not a directory`);
			continue;
		}
		const probe = join(dir, `.preflight-${process.pid}`);
		try {
			await writeFile(probe, "x");
			await rm(probe);
			add("ok", `${what} directory is writable`);
		} catch {
			add("blocking", `${what} directory ${dir} is not writable`);
		}
		if (!(await privateEnough(dir)).ok) add(production ? "blocking" : "warning", `${what} directory is readable by other accounts; chmod o-rwx`);
	}
	if (config.authConfigPath && !(await privateEnough(config.authConfigPath)).ok) add(production ? "blocking" : "warning", "identity registry is readable by other accounts; chmod o-rwx");

	for (const p of await snapshotProblems(config.feltdbDir)) add("blocking", p);
	const pid = await liveWriter(config.feltdbDir);
	if (pid) add("warning", `process ${pid} currently holds the database lock (a server or monitor is running); starting a second server on it is not supported`);
	if (!config.jev.endpoint) add("warning", "JEV_ENDPOINT is not set: evaluations will fail until Jev is configured");
	add(config.monitoring.enabled ? "ok" : "warning", config.monitoring.enabled ? "monitoring: the server runs the scheduler in-process (MONITORING_ENABLED=1)" : "monitoring: MONITORING_ENABLED=0, so nothing re-reads firms unless you run `bun run monitor -- run --daemon` (or cron). See docs/invest/PRODUCTION_READINESS.md");
	return out;
}

if (import.meta.main) {
	const findings = await preflight(process.env);
	for (const f of findings) console.log(`${f.level === "ok" ? "  ok      " : f.level === "warning" ? "  warning " : "  BLOCKING"}  ${f.message}`);
	const blocking = findings.filter((f) => f.level === "blocking").length;
	console.log(blocking ? `\n${blocking} blocking problem(s): do not start.` : "\nNo blocking problems. This is not a security review; see docs/invest/PRODUCTION_READINESS.md.");
	process.exit(blocking ? 1 : 0);
}
