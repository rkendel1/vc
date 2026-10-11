import { canonicalPageUrl } from "./url.ts";

/**
 * Minimal, dependency-free HTML reading. Page content is treated as inert data: scripts, styles
 * and embedded objects are dropped, nothing is executed, rendered or interpreted as instructions.
 */

export type ParsedPage = {
	title: string | null;
	/** Visible text blocks in document order. */
	blocks: string[];
	links: { url: string; text: string }[];
	metaRobots: string[];
	/** Date declared in page metadata (time[datetime], article:published_time, JSON-LD datePublished), if any. */
	publishedAt: string | null;
	/** RSS/Atom feeds advertised by <link rel="alternate">. */
	feedLinks: string[];
};

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”", hellip: "…", euro: "€", pound: "£" };

export function decodeEntities(text: string): string {
	return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
		if (e[0] === "#") {
			const code = e[1]?.toLowerCase() === "x" ? Number.parseInt(e.slice(2), 16) : Number.parseInt(e.slice(1), 10);
			return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : " ";
		}
		return ENTITIES[e.toLowerCase()] ?? m;
	});
}

const BLOCK_TAGS = "address|article|aside|blockquote|br|dd|div|dl|dt|figcaption|figure|footer|form|h[1-6]|header|hr|li|main|nav|ol|p|pre|section|table|tbody|td|th|thead|tr|ul";

const MAX_TAG = 2000;
const SKIPPED = new Set(["script", "style", "noscript", "template", "svg", "iframe", "object", "embed", "head", "nav", "footer", "aside"]);
const BLOCK = new Set(BLOCK_TAGS.replace("h[1-6]", "h1|h2|h3|h4|h5|h6").split("|"));

type Tag = { start: number; end: number; text: string; name: string; closing: boolean };

/** Next tag at or after `from`. The search for its end is bounded, so unterminated markup costs O(MAX_TAG), never O(rest of document). */
function tagAt(s: string, i: number): Tag | null {
	const limit = Math.min(s.length, i + MAX_TAG);
	let j = i + 1;
	while (j < limit && s.charCodeAt(j) !== 62) j++;
	if (j >= limit) return null;
	const text = s.slice(i, j + 1);
	const m = /^<(\/?)([a-zA-Z][a-zA-Z0-9]*)/.exec(text);
	return { start: i, end: j + 1, text, name: m ? m[2]!.toLowerCase() : "", closing: m ? m[1] === "/" : false };
}

function nextTag(s: string, from: number): Tag | null {
	for (let i = s.indexOf("<", from); i !== -1; i = s.indexOf("<", i + 1)) {
		const tag = tagAt(s, i);
		if (tag) return tag;
	}
	return null;
}

/** Finds `</name>` after `from`; remembers a miss so unclosed repeats cannot rescan the document. */
function closerFinder(s: string) {
	const missed = new Set<string>();
	const cache = new Map<string, RegExp>();
	return (name: string, from: number): { start: number; end: number } | null => {
		if (missed.has(name)) return null;
		let re = cache.get(name);
		if (!re) cache.set(name, (re = new RegExp(`</${name}\\s{0,20}>`, "gi")));
		re.lastIndex = from;
		const m = re.exec(s);
		if (!m) {
			missed.add(name);
			return null;
		}
		return { start: m.index, end: m.index + m[0].length };
	};
}

const attr = (tag: string, name: string): string | undefined => {
	const m = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
	return m?.[1] ?? m?.[2] ?? m?.[3];
};

const cleanText = (raw: string) => decodeEntities(raw.slice(0, MAX_TAG).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

/** Linear in the size of the input: every scan is bounded or remembered, so hostile markup cannot make parsing quadratic. */
export function parseHtml(html: string, baseUrl: string): ParsedPage {
	const source = html.slice(0, 3_000_000);
	let title: string | undefined;
	const metaRobots: string[] = [];
	const links: { url: string; text: string }[] = [];
	const feedLinks: string[] = [];
	let dateRaw: string | undefined;
	const findClose = closerFinder(source);

	// Pass 1: metadata and links, wherever they appear.
	let openAnchor: { href: string | undefined; rel: string; after: number } | null = null;
	for (let tag = nextTag(source, 0); tag; tag = nextTag(source, tag.end)) {
		if (tag.name === "title" && !tag.closing && title === undefined) {
			const close = findClose("title", tag.end);
			if (close) title = source.slice(tag.end, Math.min(close.start, tag.end + MAX_TAG));
		} else if (tag.name === "meta") {
			const name = attr(tag.text, "name") ?? attr(tag.text, "property") ?? "";
			const content = attr(tag.text, "content");
			if (/^(robots|googlebot)$/i.test(name) && content) metaRobots.push(...content.toLowerCase().split(/[,\s]+/).filter(Boolean));
			if (!dateRaw && content && /^(article:published_time|og:published_time|datePublished|date|pubdate)$/i.test(name)) dateRaw = content;
		} else if (tag.name === "time" && !tag.closing) {
			dateRaw ??= attr(tag.text, "datetime");
		} else if (tag.name === "link") {
			const type = attr(tag.text, "type") ?? "";
			if (/alternate/i.test(attr(tag.text, "rel") ?? "") && /^application\/(rss|atom)\+xml/i.test(type)) {
				const href = attr(tag.text, "href");
				const url = href ? canonicalPageUrl(decodeEntities(href), baseUrl) : null;
				if (url) feedLinks.push(url);
			}
		} else if (tag.name === "a" && !tag.closing) {
			if (!openAnchor) openAnchor = { href: attr(tag.text, "href"), rel: attr(tag.text, "rel") ?? "", after: tag.end };
		} else if (tag.name === "a" && tag.closing && openAnchor) {
			const { href: raw, rel, after } = openAnchor;
			openAnchor = null;
			if (!raw || /^\s*(#|mailto:|tel:|javascript:|data:)/i.test(raw) || /nofollow/i.test(rel)) continue;
			const url = canonicalPageUrl(decodeEntities(raw.trim()), baseUrl);
			if (url) links.push({ url, text: cleanText(source.slice(after, tag.start)).slice(0, 120) });
		}
	}
	dateRaw ??= /"datePublished"\s*:\s*"([^"]{1,64})"/i.exec(source)?.[1];

	// Pass 2: visible text, dropping comments and non-content elements.
	const parts: string[] = [];
	let pos = 0;
	let commentsClosed = true;
	for (;;) {
		const lt = source.indexOf("<", pos);
		if (lt === -1) break;
		parts.push(source.slice(pos, lt));
		if (commentsClosed && source.startsWith("<!--", lt)) {
			const e = source.indexOf("-->", lt + 4);
			if (e !== -1) {
				parts.push(" ");
				pos = e + 3;
				continue;
			}
			commentsClosed = false;
		}
		const tag = tagAt(source, lt);
		if (!tag) {
			parts.push("<");
			pos = lt + 1;
			continue;
		}
		pos = tag.end;
		if (!tag.closing && SKIPPED.has(tag.name)) {
			const close = findClose(tag.name, tag.end);
			if (close) pos = close.end;
			parts.push(" ");
		} else {
			parts.push(BLOCK.has(tag.name) ? "\n" : " ");
		}
	}
	parts.push(source.slice(pos));
	const blocks = decodeEntities(parts.join(""))
		.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, " ")
		.split(/\n+/)
		.map((b) => b.replace(/\s+/g, " ").trim())
		.filter((b) => b.length > 0);
	return { title: title ? cleanText(title).slice(0, 200) || null : null, blocks, links, metaRobots, publishedAt: toIso(dateRaw), feedLinks: [...new Set(feedLinks)].slice(0, 5) };
}

function toIso(raw: string | undefined): string | null {
	if (!raw) return null;
	const t = Date.parse(raw.trim());
	if (!Number.isFinite(t)) return null;
	const y = new Date(t).getUTCFullYear();
	return y >= 1990 && y <= 2100 ? new Date(t).toISOString() : null;
}

export function plainTextToPage(text: string): ParsedPage {
	return { title: null, blocks: text.split(/\n+/).map((b) => b.replace(/\s+/g, " ").trim()).filter(Boolean), links: [], metaRobots: [], publishedAt: null, feedLinks: [] };
}

/** Sentences of one block, kept short enough to quote. */
export function sentences(block: string): string[] {
	return block
		.split(/(?<=[.!?])\s+(?=[A-Z“"'(])|\s+[•·▪●]\s+|\s{2,}/)
		.map((s) => s.trim())
		.filter((s) => s.length >= 12 && s.length <= 600);
}
