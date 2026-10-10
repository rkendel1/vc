import type { FetchOutcome, PageKind } from "../domain/research.ts";
import { RELEVANT_WEIGHT, classifyPage, linkScore, looksLikePage } from "./classify.ts";
import type { FetchResult, PageFetcher } from "./fetcher.ts";
import { type ParsedPage, parseHtml, plainTextToPage } from "./html.ts";
import { canonicalPageUrl, inScope } from "./url.ts";

export type CrawlLimits = { maxPages: number; maxDepth: number };

export type CrawledPage = {
	requestedUrl: string;
	depth: number;
	kind: PageKind;
	fetch: FetchResult;
	parsed: ParsedPage | null;
	/** The page forbids storing or quoting it (meta/header robots noindex|noarchive|nosnippet). */
	restricted: boolean;
};

export type CrawlResult = {
	pages: CrawledPage[];
	/** Relevant candidates seen but never fetched because a bound was reached. */
	unvisitedRelevant: { url: string; kind: PageKind }[];
};

const MAX_VARIANTS_PER_PATH = 3;

/**
 * Bounded breadth-first-by-relevance crawl of one firm's own domain. Links to other domains are
 * never followed. The homepage is always fetched first; afterwards the most research-relevant
 * unvisited link goes next, until `maxPages` fetches or `maxDepth` levels. URL variants of one path
 * are capped so calendars, filters and pagination cannot absorb the budget.
 */
export async function crawlFirm(fetcher: PageFetcher, seedUrl: string, scopeDomain: string, limits: CrawlLimits): Promise<CrawlResult> {
	const pages: CrawledPage[] = [];
	const seen = new Set<string>();
	const perPath = new Map<string, number>();
	type Candidate = { url: string; depth: number; weight: number; kind: PageKind; order: number };
	const frontier: Candidate[] = [];
	let order = 0;

	const enqueue = (url: string, depth: number, weight: number, kind: PageKind) => {
		const canonical = canonicalPageUrl(url);
		if (!canonical || seen.has(canonical)) return;
		let parsed: URL;
		try {
			parsed = new URL(canonical);
		} catch {
			return;
		}
		if (!inScope(parsed.hostname, scopeDomain) || !looksLikePage(canonical)) return;
		const pathKey = `${parsed.host}${parsed.pathname}`;
		if ((perPath.get(pathKey) ?? 0) >= MAX_VARIANTS_PER_PATH) return;
		perPath.set(pathKey, (perPath.get(pathKey) ?? 0) + 1);
		seen.add(canonical);
		frontier.push({ url: canonical, depth, weight, kind, order: order++ });
	};

	const seed = canonicalPageUrl(seedUrl) ?? seedUrl;
	enqueue(seed, 0, 100, "home");
	const home = canonicalPageUrl(`https://${scopeDomain}/`);
	if (home && home !== seed) enqueue(home, 0, 99, "home");

	while (pages.length < limits.maxPages && frontier.length) {
		frontier.sort((a, b) => b.weight - a.weight || a.depth - b.depth || a.order - b.order);
		const next = frontier.shift()!;
		const result = await fetcher.fetchPage(next.url);
		const isHome = next.kind === "home";
		let parsed: ParsedPage | null = null;
		let restricted = false;
		if (result.outcome === "ok" && result.body !== null) {
			parsed = /html|xhtml/i.test(result.contentType ?? "") ? parseHtml(result.body, result.finalUrl) : plainTextToPage(result.body);
			const directives = [...parsed.metaRobots, ...(result.robotsHeader?.toLowerCase().split(/[,\s]+/) ?? [])];
			restricted = directives.some((d) => d === "noindex" || d === "noarchive" || d === "nosnippet" || d === "none");
		}
		const kind = result.outcome === "ok" ? classifyPage(result.finalUrl, parsed?.title ?? null, isHome).kind : next.kind;
		pages.push({ requestedUrl: next.url, depth: next.depth, kind, fetch: result, parsed, restricted });
		if (parsed && !restricted && !parsed.metaRobots.includes("nofollow") && next.depth < limits.maxDepth) {
			const finalCanonical = canonicalPageUrl(result.finalUrl);
			if (finalCanonical) seen.add(finalCanonical);
			for (const link of parsed.links) {
				const score = linkScore(link.url, link.text);
				enqueue(link.url, next.depth + 1, score.weight, score.kind);
			}
		}
	}
	// What was left on the table: relevant, in scope, within depth, but out of budget.
	const unvisitedRelevant = frontier.filter((c) => c.weight >= RELEVANT_WEIGHT && c.depth <= limits.maxDepth).map((c) => ({ url: c.url, kind: c.kind }));
	return { pages, unvisitedRelevant };
}

export const FAILED_OUTCOMES: ReadonlySet<FetchOutcome> = new Set(["http_error", "timeout", "network_error", "too_large", "unsupported_content", "redirect_limit"]);
export const BLOCKED_OUTCOMES: ReadonlySet<FetchOutcome> = new Set(["blocked_robots", "blocked_network_policy", "auth_required", "redirect_off_domain"]);
