/**
 * Investor research pipeline CLI.
 *
 *   bun run research -- invest/examples/vc-firms.example.csv --workspace ws-dev [--dry-run] [options]
 *
 * Reads a CSV, JSON or newline-delimited text file of VC firm URLs, reconciles one profile per
 * firm in the workspace's FeltDB store, researches each firm's own public pages within bounds,
 * and prints a report. Safe to re-run: firms, sources and criteria are deduplicated.
 * See docs/invest/VC2_RESEARCH_PIPELINE.md.
 */
import { readFile, writeFile } from "node:fs/promises";
import { loadConfig } from "../config.ts";
import type { ResearchLimits } from "../domain/research.ts";
import type { Actor } from "../domain/types.ts";
import { JevHttpClient, UnconfiguredJev } from "../jev/jev-client.ts";
import { loadRegistry } from "../auth/authboundry-adapter.ts";
import { InvestorResearchModule } from "../modules/investor-research.ts";
import { SafeHttpFetcher } from "../research/fetcher.ts";
import { parseInput } from "../research/input.ts";
import { formatReport, runPipeline } from "../research/pipeline.ts";
import { InvestStore } from "../store/store.ts";

const USAGE = `Usage: bun run research -- <input.csv|json|txt> --workspace <id> [options]

  --workspace <id>        Workspace that will own the profiles (required)
  --dry-run               Normalise, deduplicate and show what would be created. No network requests, no writes.
  --max-pages <n>         Pages per firm (default RESEARCH_MAX_PAGES=12, ceiling 50)
  --max-depth <n>         Link depth from the homepage (default 2, ceiling 4)
  --timeout-ms <n>        Per-request timeout (default 10000)
  --retries <n>           Retries for transient failures (default 2, ceiling 4)
  --delay-ms <n>          Minimum gap between requests to one host (default 1500, floor 250)
  --skip-fresh-days <n>   Skip firms researched successfully within n days
  --concurrency <n>       Firms in parallel, 1-8 (default 1; each host is still rate limited)
  --no-verify             Do not ask Jev to verify passages (verification stays pending)
  --json <path>           Also write the report as JSON
  -h, --help
`;

function fail(message: string): never {
	console.error(`${message}\n\n${USAGE}`);
	process.exit(2);
}

type Args = { file: string; workspace: string; dryRun: boolean; limits: Partial<ResearchLimits>; skipFreshDays?: number; concurrency: number; verify: boolean; json?: string };

function parseArgs(argv: string[]): Args {
	const args: Args = { file: "", workspace: "", dryRun: false, limits: {}, concurrency: 1, verify: true };
	const num = (name: string, value: string | undefined, min: number, max: number) => {
		const n = Number(value);
		if (!Number.isInteger(n) || n < min || n > max) fail(`${name} must be an integer between ${min} and ${max}`);
		return n;
	};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i]!;
		const next = () => argv[++i];
		switch (a) {
			case "-h":
			case "--help":
				console.log(USAGE);
				process.exit(0);
			// biome-ignore lint/suspicious/noFallthroughSwitchClause: exit above
			case "--workspace":
				args.workspace = next() ?? "";
				break;
			case "--dry-run":
				args.dryRun = true;
				break;
			case "--no-verify":
				args.verify = false;
				break;
			case "--max-pages":
				args.limits.maxPages = num(a, next(), 1, 50);
				break;
			case "--max-depth":
				args.limits.maxDepth = num(a, next(), 0, 4);
				break;
			case "--timeout-ms":
				args.limits.timeoutMs = num(a, next(), 1000, 60_000);
				break;
			case "--retries":
				args.limits.retries = num(a, next(), 0, 4);
				break;
			case "--delay-ms":
				args.limits.perDomainDelayMs = num(a, next(), 250, 60_000);
				break;
			case "--skip-fresh-days":
				args.skipFreshDays = num(a, next(), 1, 3650);
				break;
			case "--concurrency":
				args.concurrency = num(a, next(), 1, 8);
				break;
			case "--json":
				args.json = next();
				break;
			default:
				if (a.startsWith("-")) fail(`Unknown option ${a}`);
				if (args.file) fail("Only one input file is accepted");
				args.file = a;
		}
	}
	if (!args.file) fail("An input file is required");
	if (!args.workspace) fail("--workspace is required");
	return args;
}

const args = parseArgs(process.argv.slice(2));
const { config, warnings } = loadConfig();
for (const w of warnings.filter((w) => !/Jev is not configured|DOCUMENT_STORAGE/.test(w))) console.error(`warning: ${w}`);

// The workspace must exist in the identity registry when one is configured; the CLI never invents workspaces.
if (config.authConfigPath) {
	const registry = await loadRegistry(config.authConfigPath);
	if (!registry.workspaces.some((w) => w.id === args.workspace)) fail(`Workspace "${args.workspace}" is not in ${config.authConfigPath}`);
} else if (config.appEnv === "production") fail("AUTHBOUNDRY_CONFIG_PATH is required in production");
else if (args.workspace !== "ws-dev") console.error(`warning: no AUTHBOUNDRY_CONFIG_PATH; the development registry only knows workspace "ws-dev"`);

const text = await readFile(args.file, "utf8").catch((e: Error) => fail(`Cannot read ${args.file}: ${e.message}`));
const parsed = parseInput(text, args.file);
if (!parsed.inputs.length && !parsed.errors.length) fail("The input file contains no firms");

const store = await InvestStore.openDir(config.feltdbDir);
try {
	const jev = config.jev.endpoint ? new JevHttpClient({ endpoint: config.jev.endpoint, apiKey: config.jev.apiKey, provider: config.jev.provider, model: config.jev.model, timeoutMs: config.jev.timeoutMs }) : new UnconfiguredJev();
	const r = config.research;
	const research = new InvestorResearchModule({
		store,
		jev,
		fetcherFor: (scopeDomain, limits) => new SafeHttpFetcher({ scopeDomain, limits, userAgent: r.userAgent, robotsToken: "AttnInvestResearchBot" }),
		defaults: { maxPages: r.maxPages, maxDepth: r.maxDepth, timeoutMs: r.timeoutMs, retries: r.retries, perDomainDelayMs: r.perDomainDelayMs, maxBytes: r.maxBytes, maxRedirects: r.maxRedirects },
		staleAfterDays: r.staleAfterDays,
		jevTimeoutMs: config.jev.timeoutMs,
	});
	const actor: Actor = { principalId: "research-cli", displayName: "Research CLI", workspaceId: args.workspace, permissions: ["invest.read", "research.run"] };
	const report = await runPipeline(research, actor, parsed.inputs, parsed.errors, { dryRun: args.dryRun, limits: args.limits, verify: args.verify, skipFreshDays: args.skipFreshDays, concurrency: args.concurrency });
	console.log(formatReport(report));
	if (args.json) await writeFile(args.json, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
	// Exit 1 if any firm hit a processing error (retryable by re-running the same command); research_incomplete is a result, not an error.
	process.exitCode = report.firms.some((f) => f.status === "error") ? 1 : 0;
} finally {
	await store.close();
}
