import { decodeEntities } from "./html.ts";

/**
 * RSS 2.0 and Atom 1.0 reading, without an XML parser: DOCTYPE and entity declarations are never
 * interpreted, so there is no entity-expansion or external-entity surface. Feed text is untrusted
 * data exactly like page text. Malformed feeds return an error, never a guess.
 */
export type FeedItem = { title: string; link: string | null; publishedAt: string | null; summary: string };
export type ParsedFeed = { ok: true; title: string | null; items: FeedItem[] } | { ok: false; error: string };

export const MAX_FEED_ITEMS = 50;

const cdata = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
const strip = (s: string) => decodeEntities(cdata(s).replace(/<[^>]*>/g, " ")).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
function tag(block: string, name: string): string | null {
	const m = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}\\s*>`, "i").exec(block);
	return m ? m[1]! : null;
}

export function toIsoDate(raw: string | null | undefined): string | null {
	if (!raw) return null;
	const t = Date.parse(raw.trim());
	if (!Number.isFinite(t)) return null;
	const d = new Date(t);
	return d.getUTCFullYear() >= 1990 && d.getUTCFullYear() <= 2100 ? d.toISOString() : null;
}

export function looksLikeFeed(body: string): boolean {
	return /<(rss|feed|rdf:RDF)\b/i.test(body.slice(0, 2000));
}

export function parseFeed(body: string): ParsedFeed {
	const text = body.slice(0, 2_000_000).replace(/^\uFEFF/, "");
	if (!looksLikeFeed(text)) return { ok: false, error: "not an RSS or Atom document" };
	const atom = /<feed\b/i.test(text.slice(0, 2000));
	const itemRe = atom ? /<entry\b[^>]*>([\s\S]*?)<\/entry\s*>/gi : /<item\b[^>]*>([\s\S]*?)<\/item\s*>/gi;
	const items: FeedItem[] = [];
	for (const m of text.matchAll(itemRe)) {
		const block = m[1]!;
		const title = strip(tag(block, "title") ?? "");
		let link: string | null = null;
		if (atom) {
			const links = [...block.matchAll(/<link\b([^>]*)\/?>/gi)].map((l) => l[1]!);
			const chosen = links.find((a) => /rel\s*=\s*["']alternate["']/i.test(a)) ?? links.find((a) => !/rel\s*=/i.test(a));
			link = chosen ? (/href\s*=\s*["']([^"']+)["']/i.exec(chosen)?.[1] ?? null) : null;
		} else link = strip(tag(block, "link") ?? "") || null;
		const date = atom ? (tag(block, "published") ?? tag(block, "updated")) : (tag(block, "pubDate") ?? tag(block, "dc:date"));
		const summary = strip(tag(block, atom ? "summary" : "description") ?? tag(block, "content:encoded") ?? tag(block, "content") ?? "");
		if (!title && !summary) continue;
		items.push({ title: title.slice(0, 300), link: link ? decodeEntities(link.trim()).slice(0, 2048) : null, publishedAt: toIsoDate(date ? strip(date) : null), summary: summary.slice(0, 2000) });
		if (items.length >= MAX_FEED_ITEMS) break;
	}
	const unterminated = (atom ? /<entry\b/gi : /<item\b/gi).test(text) && !items.length;
	if (unterminated) return { ok: false, error: "feed entries are malformed or empty" };
	const channelTitle = strip(tag(text.replace(atom ? /<entry\b[\s\S]*$/i : /<item\b[\s\S]*$/i, ""), "title") ?? "");
	return { ok: true, title: channelTitle || null, items };
}
