/**
 * Curated source CLI.
 *
 *   bun run sources -- register invest/examples/source.csv-directory.example.json --workspace ws-dev
 *   bun run sources -- list     --workspace ws-dev
 *   bun run sources -- run      <name or id> --workspace ws-dev     retrieve one source now
 *   bun run sources -- matches  --workspace ws-dev                  candidate matches awaiting review
 *
 * Registered sources are then checked on their schedule by `bun run monitor` or the server's runner,
 * exactly like firms. The spec file attests why automated access is permitted; see
 * docs/invest/VC4_COLLABORATION.md. No provider is built in.
 */
import { readFile } from "node:fs/promises";
import { type RegisterSourceInput } from "../modules/source-ingestion.ts";
import { openStack } from "./stack.ts";

const USAGE = `Usage: bun run sources -- <register <spec.json>|list|run <name|id>|matches> --workspace <id>`;
const fail = (m: string): never => {
	console.error(`${m}\n\n${USAGE}`);
	process.exit(2);
};
const argv = process.argv.slice(2);
const pos: string[] = [];
let workspace = "";
for (let i = 0; i < argv.length; i++) {
	if (argv[i] === "--workspace") workspace = argv[++i] ?? "";
	else if (argv[i] === "-h" || argv[i] === "--help") {
		console.log(USAGE);
		process.exit(0);
	} else pos.push(argv[i]!);
}
const command = pos[0] ?? fail("A command is required");
if (!["register", "list", "run", "matches"].includes(command)) fail(`Unknown command ${command}`);
if (!workspace) fail("--workspace is required");

const stack = await openStack({ workspace, fail });
const { sources, actor } = stack;
try {
	if (command === "register") {
		const file = pos[1] ?? fail("register needs a spec file");
		const spec = JSON.parse(await readFile(file, "utf8").catch((e: Error) => fail(`Cannot read ${file}: ${e.message}`))) as RegisterSourceInput;
		const { source, created } = await sources.register(actor, spec);
		console.log(`${created ? "Registered" : "Already registered"}: ${source.name} (${source.id})\n  hosts: ${source.allowedHosts.join(", ")}\n  access basis: ${source.accessBasis}\n  adapter: ${source.adapter}\nIt is monitored on its schedule; run it now with: bun run sources -- run "${source.name}" --workspace ${workspace}`);
	} else if (command === "list") {
		const list = await sources.list(actor);
		for (const x of list) console.log(`${x.source.name.padEnd(30)} ${x.source.adapter.padEnd(18)} ${x.target?.enabled ? "monitored" : "PAUSED   "} next ${x.target?.nextCheckAt ?? "—"}  last attempt ${x.lastRun?.completedAt ?? "—"} (${x.lastRun ? (x.lastRun.success ? "ok" : `failed: ${x.lastRun.error?.message ?? x.lastRun.fetchOutcome}`) : "never"})`);
		if (!list.length) console.log("No sources registered.");
	} else if (command === "run") {
		const needle = (pos[1] ?? fail("run needs a source name or id")).toLowerCase();
		const hit = (await sources.list(actor)).find((x) => x.source.id === pos[1] || x.source.name.toLowerCase() === needle);
		if (!hit) fail(`No source "${pos[1]}" in workspace ${workspace}`);
		const run = await sources.runSource(actor, hit!.source.id);
		console.log(`${hit!.source.name}: ${run.success ? "ok" : "FAILED"}${run.change ? ` (${run.change})` : ""}\n  records ${run.counts.records} (${run.counts.newRecords} new, ${run.counts.changedRecords} changed); matched ${run.counts.matched}, candidates ${run.counts.candidates}, unmatched ${run.counts.unmatched}; claims ${run.counts.claims}; events ${run.counts.events}; record errors ${run.counts.errors}`);
		for (const e of run.errors.slice(0, 10)) console.log(`  record ${e.index}: ${e.message}`);
		if (run.error) console.log(`  error (${run.error.retryable ? "retryable" : "not retryable"}): ${run.error.message}`);
		process.exitCode = run.success ? 0 : 1;
	} else {
		const open = await sources.openMatches(actor);
		for (const { match } of open) console.log(`${match.id}  "${match.subjectName}" (${match.subject}) — ${match.reasons[0]}\n    candidates: ${match.candidates.map((c) => `${c.name} [${c.signals.join("+")}]`).join("; ")}`);
		if (!open.length) console.log("No candidate matches awaiting review.");
	}
} finally {
	await stack.close();
}
