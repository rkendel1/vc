/**
 * Architecture invariants for Attn Invest (docs/invest/PR1_ARCHITECTURE_BASELINE.md §5).
 * Static checks over the source tree plus the generated manifest; exits non-zero on any violation.
 */
import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const violations: string[] = [];
const fail = (rule: string, file: string, detail: string) => violations.push(`${rule}: ${relative(root, file)}: ${detail}`);

async function walk(dir: string, filter: (f: string) => boolean): Promise<string[]> {
	const out: string[] = [];
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		if (["node_modules", "dist", "generated"].includes(entry.name)) continue;
		const path = join(dir, entry.name);
		if (entry.isDirectory()) out.push(...(await walk(path, filter)));
		else if (filter(path)) out.push(path);
	}
	return out;
}

const imports = (src: string) =>
	[...src.matchAll(/(?:import|export)\s[^;]*?from\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)|^\s*import\s+["']([^"']+)["']/gm)].map((m) => m[1] ?? m[2] ?? m[3]);

const server = await walk(join(root, "invest"), (f) => f.endsWith(".ts"));
const productionServer = server.filter((f) => !/\/(tests|testing|e2e|scripts|quality)\//.test(f));
const web = await walk(join(root, "apps/invest-web/src"), (f) => /\.(ts|tsx)$/.test(f));

for (const file of server) {
	const src = await readFile(file, "utf8");
	for (const spec of imports(src)) {
		// 3/4. No Chip/Compute/FX/control-plane source dependency; no packages that do not exist here.
		if (/chip|compute|(^|\/)fx(\/|$)|attn-control-plane|native-world/i.test(spec) && !spec.includes("@feltdb")) fail("no-agency-dependency", file, spec);
		if (/^@jev\/|^@authboundry\/|^@appport\/(services|appboundry)/.test(spec)) fail("no-fictional-packages", file, spec);
		if (spec.startsWith("../../appport/") || spec.startsWith("../appport/attn")) fail("no-attn-control-plane", file, spec);
	}
}

for (const file of productionServer) {
	const src = await readFile(file, "utf8");
	const rel = relative(join(root, "invest"), file);
	// 1. Durable state only through invest/store.
	if (imports(src).some((s) => s === "@feltdb/core" || s.startsWith("@feltdb/")) && !rel.startsWith("store/")) fail("feltdb-only-in-store", file, "imports @feltdb/core");
	// 2. Only the Jev adapter and the research fetcher make outbound network calls; the fetcher alone reaches public web pages.
	if (/\bfetch\s*\(/.test(src) && !rel.startsWith("jev/") && rel !== "research/fetcher.ts") fail("network-only-in-jev-adapter-and-research-fetcher", file, "calls fetch()");
	if (/\b(?:doFetch|fetchImpl)\b/.test(src) && !rel.startsWith("jev/") && rel !== "research/fetcher.ts") fail("network-only-in-jev-adapter-and-research-fetcher", file, "uses an injected fetch outside the sanctioned adapters");
	// Research code (crawl, extraction, verification wording) is network- and storage-free except the fetcher; persistence is the module's job.
	if (rel.startsWith("research/") && imports(src).some((s) => /(^|\/)store\/store\.ts$|appport\//.test(s))) fail("research-has-no-storage", file, "research/ must not import the store or AppPort");
	if (rel.startsWith("research/") && /process\.env/.test(src)) fail("research-has-no-env", file, "research/ must not read the environment; configuration is injected");
	// Cross-workspace scans are an explicit exception: only the scheduler, moderation/publication and the reconciliation read model may use them.
	if (/\.scanAll\(/.test(src) && !["modules/monitoring.ts", "modules/participation.ts", "modules/reconciliation.ts", "store/store.ts"].includes(rel)) fail("scanall-allowlist", file, "scanAll outside the scheduler, participation or reconciliation modules");
	// Crawled content is data: nothing under research/ may spawn processes or import dynamic code.
	if (rel.startsWith("research/") && (imports(src).some((s) => /^(node:)?(child_process|vm|worker_threads)$/.test(s)) || /Bun\.(spawn|\$)\b/.test(src))) fail("research-no-execution", file, "process or code execution");
	// Secrets are read only by configuration.
	if (/process\.env\.(JEV_API_KEY|DOCUMENT_STORAGE_LINK_SECRET)/.test(src) && rel !== "config.ts") fail("secrets-only-in-config", file, "reads a secret from the environment");
	// Untrusted document text must never be evaluated.
	if (/\beval\s*\(|new Function\s*\(|isEvalSupported:\s*true/.test(src)) fail("no-dynamic-evaluation", file, "dynamic code evaluation");
}

// 0. feltdb.flow is the authoritative state declaration: importing the store compiles it and fails if
//    it is invalid or disagrees with the collections the code names. Every collection must be workspace-scoped and indexed.
{
	const { FLOW } = await import("../store/store.ts");
	for (const c of FLOW.collections) {
		if (!c.fields.some((f) => f.name === "workspaceId" && !f.optional)) fail("flow-workspace-scoped", "feltdb.flow", `${c.name} has no workspaceId field`);
		if (!c.indexes.some((i) => i.expression.replace(/[()\s]/g, "") === "workspaceId")) fail("flow-workspace-indexed", "feltdb.flow", `${c.name} has no workspaceId index`);
	}
	for (const file of productionServer) {
		const src = await readFile(file, "utf8");
		if (/\.createIndex\(/.test(src) && !relative(join(root, "invest"), file).startsWith("store/")) fail("indexes-only-from-flow", file, "creates an index outside the store");
	}
}

// 5. No capability accepts a workspace or tenant id; every capability requires a permission.
const manifest = JSON.parse(await readFile(join(root, "invest/appport/manifest.json"), "utf8")) as { capabilities: { name: string; authorization: string[]; inputSchema: unknown }[] };
for (const c of manifest.capabilities.filter((c) => !c.name.startsWith("appport."))) {
	if (!c.authorization?.length) fail("capability-requires-permission", "invest/appport/manifest.json", c.name);
	if (/"(workspaceId|tenantId)"/.test(JSON.stringify(c.inputSchema))) fail("no-workspace-input", "invest/appport/manifest.json", c.name);
}

// 6. The web app reaches the server only through the generated AppPort client and shared types.
for (const file of web) {
	const src = await readFile(file, "utf8");
	for (const spec of imports(src)) {
		if (!spec.includes("invest/")) continue;
		const allowed = spec.endsWith("invest/appport/generated/client.ts") || spec.endsWith("invest/domain/types.ts") || spec.endsWith("invest/domain/views.ts") || spec.endsWith("invest/domain/research.ts") || spec.endsWith("invest/domain/collab.ts") || spec.endsWith("invest/domain/founder.ts");
		if (!allowed) fail("web-imports-only-contract", file, spec);
		if (spec.endsWith("domain/types.ts") || spec.endsWith("domain/views.ts") || spec.endsWith("domain/research.ts") || spec.endsWith("domain/collab.ts") || spec.endsWith("domain/founder.ts")) {
			const line = src.split("\n").find((l) => l.includes(spec)) ?? "";
			if (!/import\s+(type\s|\{\s*(METRIC_KEYS|SOURCE_TYPES|type\s))/.test(line) && !/^import \{[^}]*\} from/.test(line)) fail("web-imports-only-contract", file, `value import from ${spec}`);
		}
	}
	if (/fetch\s*\(\s*["'`]\/(?!appport|files)/.test(src)) fail("web-uses-appport", file, "fetches a non-AppPort endpoint");
}

if (violations.length) {
	console.error(`Architecture invariants violated (${violations.length}):\n${violations.map((v) => `  - ${v}`).join("\n")}`);
	process.exit(1);
}
console.log(`Architecture invariants hold (${server.length} server files, ${web.length} web files, ${manifest.capabilities.length} capabilities).`);
