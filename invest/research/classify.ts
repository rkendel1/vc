import type { PageKind, SourceClass } from "../domain/research.ts";

/** Page relevance, by URL and title only. Used to order the crawl and to label sources; never to trust content. */

const RULES: { kind: PageKind; weight: number; re: RegExp }[] = [
	{ kind: "thesis", weight: 10, re: /thesis|strateg|investment-?focus|our-?focus|focus-?areas?|what-?we-?(?:invest|look|back)|how-?we-?invest|approach|philosoph|invest(?:ing|ment)s?(?:\/|$|-)/i },
	{ kind: "criteria", weight: 10, re: /criteria|guidelines|apply|application|submit|pitch(?:ing)?|get-?funded|founders\/?$|for-?founders/i },
	{ kind: "faq", weight: 7, re: /faq|frequently|questions/i },
	{ kind: "portfolio", weight: 6, re: /portfolio|companies|our-?investments|investments?\/?$|startups|founders-?we|backed/i },
	{ kind: "announcement", weight: 4, re: /\/(?:news|blog|press|insights?|announce\w*|posts?|writing|stories|updates|perspectives|essays|letters)(?:\/|$)|announc|raises|leads|backs|funding-round/i },
	{ kind: "team", weight: 3, re: /team|people|partners\/?$|about(?:-us)?\/?$|who-?we-?are|fund(?:s)?\/?$/i },
];

export function classifyPage(url: string, title: string | null, isHome: boolean): { kind: PageKind; weight: number } {
	if (isHome) return { kind: "home", weight: 8 };
	let path = "";
	try {
		path = new URL(url).pathname;
	} catch {
		// keep empty
	}
	for (const rule of RULES) if (rule.re.test(path)) return { kind: rule.kind, weight: rule.weight };
	for (const rule of RULES) if (title && rule.re.test(title.replace(/\s+/g, "-"))) return { kind: rule.kind, weight: Math.max(1, rule.weight - 2) };
	return { kind: "other", weight: 1 };
}

/** Score for an unvisited link, before the page is fetched. */
export function linkScore(url: string, anchor: string): { kind: PageKind; weight: number } {
	const byUrl = classifyPage(url, null, false);
	if (byUrl.kind !== "other") return byUrl;
	const byAnchor = classifyPage(`/${anchor.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, null, false);
	return byAnchor.kind === "other" ? byUrl : { kind: byAnchor.kind, weight: Math.max(1, byAnchor.weight - 1) };
}

/** A page is relevant enough that failing to read it undermines the research. */
export const RELEVANT_WEIGHT = 7;

const NON_PAGE = /\.(?:pdf|png|jpe?g|gif|webp|svg|ico|css|js|json|xml|zip|gz|mp[34]|mov|avi|woff2?|ttf|eot|docx?|xlsx?|pptx?|csv|rss|atom)(?:$|\?)/i;
export function looksLikePage(url: string): boolean {
	try {
		return !NON_PAGE.test(new URL(url).pathname + new URL(url).search);
	} catch {
		return false;
	}
}

export function sourceClassFor(kind: PageKind, url: string): SourceClass {
	if (kind === "announcement" || /\/(?:blog|news|insights?|press|writing|essays|letters|perspectives)(?:\/|$)/i.test(safePath(url))) return "official_publication";
	return "official_website";
}
function safePath(url: string): string {
	try {
		return new URL(url).pathname;
	} catch {
		return "";
	}
}
