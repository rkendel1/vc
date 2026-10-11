/**
 * Opt-in live smoke check: fetches a handful of PUBLIC pages YOU name, through the production fetcher (pinned connection, robots.txt,
 * size/time limits), and reports what it saw. It proves the fetch path works from this host against the real internet. It does not prove
 * coverage, accuracy, or that any provider is "supported".
 *
 *   INVEST_LIVE_SMOKE=1 bun run smoke:live -- https://example-fund.com/portfolio https://another.vc/team
 *
 * - Refuses to run unless INVEST_LIVE_SMOKE=1 and at least one https URL is given (at most 5). CI never sets the flag.
 * - Fetches only the pages named (one page each, plus that host's robots.txt). No crawling, no feeds, no Jev, no model calls.
 * - Opens no database and writes nothing durable: it cannot create or change an approval, finding or event.
 * - Respect each site's terms: run it rarely, against sites you are entitled to read.
 */
import { parseHtml } from "../research/html.ts";
import { SafeHttpFetcher } from "../research/fetcher.ts";
import { normalizeFirmUrl } from "../research/url.ts";

export const MAX_SMOKE_URLS = 5;

export class SmokeRefused extends Error {}

export type SmokeRow = { url: string; outcome: string; httpStatus: number | null; contentType: string | null; bytes: number | null; title: string | null; textBlocks: number | null; links: number | null; detail: string | null };

export function checkSmokeRequest(env: NodeJS.ProcessEnv, urls: string[]): string[] {
	if (env.INVEST_LIVE_SMOKE !== "1") throw new SmokeRefused("Live smoke is opt-in. Set INVEST_LIVE_SMOKE=1 to confirm you are authorised to make these requests. Nothing was fetched.");
	if (!urls.length) throw new SmokeRefused("Name the pages to check, e.g. https://example-fund.com/portfolio. Nothing was fetched.");
	if (urls.length > MAX_SMOKE_URLS) throw new SmokeRefused(`At most ${MAX_SMOKE_URLS} URLs per run. Nothing was fetched.`);
	for (const u of urls) if (!/^https:\/\//i.test(u)) throw new SmokeRefused(`${u} is not an https URL. Nothing was fetched.`);
	return urls;
}

export async function runSmoke(urls: string[], options: { fetcherFor?: (domain: string) => { fetchPage(url: string): Promise<{ outcome: string; httpStatus: number | null; contentType: string | null; body: string | null; detail: string | null }> } } = {}): Promise<SmokeRow[]> {
	const rows: SmokeRow[] = [];
	for (const raw of urls) {
		const { canonicalDomain } = normalizeFirmUrl(raw);
		const fetcher =
			options.fetcherFor?.(canonicalDomain) ??
			new SafeHttpFetcher({
				scopeDomain: canonicalDomain,
				limits: { maxPages: 1, maxDepth: 0, timeoutMs: 10_000, retries: 0, perDomainDelayMs: 1000, maxBytes: 1_000_000, maxRedirects: 2 },
				userAgent: "AttnInvestSmoke/1.0 (+opt-in operator check)",
				robotsToken: "AttnInvestResearchBot",
			});
		const r = await fetcher.fetchPage(raw);
		const page = r.body ? parseHtml(r.body, raw) : null;
		rows.push({ url: raw, outcome: r.outcome, httpStatus: r.httpStatus, contentType: r.contentType, bytes: r.body ? Buffer.byteLength(r.body) : null, title: page?.title ?? null, textBlocks: page?.blocks.length ?? null, links: page?.links.length ?? null, detail: r.detail });
	}
	return rows;
}

if (import.meta.main) {
	try {
		const urls = checkSmokeRequest(process.env, process.argv.slice(2).filter((a) => !a.startsWith("--")));
		const rows = await runSmoke(urls);
		for (const r of rows) console.log(`${r.outcome.padEnd(22)} ${r.url}  status ${r.httpStatus ?? "—"}  ${r.bytes ?? 0} bytes  ${r.textBlocks ?? 0} text blocks  ${r.links ?? 0} links${r.title ? `  "${r.title}"` : ""}${r.detail ? `  (${r.detail})` : ""}`);
		console.log("\nNothing was stored and no approval was created or changed. This shows the fetch path worked today from this host; it is not a coverage or accuracy claim.");
		process.exit(rows.every((r) => r.outcome === "ok") ? 0 : 1);
	} catch (error) {
		console.error(error instanceof SmokeRefused ? error.message : `Smoke failed: ${String(error).slice(0, 300)}`);
		process.exit(2);
	}
}
