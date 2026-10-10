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
	// 2. Only the Jev adapter makes outbound network calls.
	if (/\bfetch\s*\(/.test(src) && !rel.startsWith("jev/")) fail("network-only-in-jev-adapter", file, "calls fetch()");
	// Secrets are read only by configuration.
	if (/process\.env\.(JEV_API_KEY|DOCUMENT_STORAGE_LINK_SECRET)/.test(src) && rel !== "config.ts") fail("secrets-only-in-config", file, "reads a secret from the environment");
	// Untrusted document text must never be evaluated.
	if (/\beval\s*\(|new Function\s*\(|isEvalSupported:\s*true/.test(src)) fail("no-dynamic-evaluation", file, "dynamic code evaluation");
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
		const allowed = spec.endsWith("invest/appport/generated/client.ts") || spec.endsWith("invest/domain/types.ts") || spec.endsWith("invest/domain/views.ts");
		if (!allowed) fail("web-imports-only-contract", file, spec);
		if (spec.endsWith("domain/types.ts") || spec.endsWith("domain/views.ts")) {
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
