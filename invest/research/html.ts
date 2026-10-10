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

export function parseHtml(html: string, baseUrl: string): ParsedPage {
	const source = html.slice(0, 3_000_000);
	const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(source)?.[1];
	const metaRobots: string[] = [];
	for (const m of source.matchAll(/<meta\b[^>]*>/gi)) {
		const tag = m[0];
		if (/name\s*=\s*["']?(robots|googlebot)["']?/i.test(tag)) {
			const content = /content\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1];
			if (content) metaRobots.push(...content.toLowerCase().split(/[,\s]+/).filter(Boolean));
		}
	}
	const links: { url: string; text: string }[] = [];
	for (const m of source.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
		const href = /href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(m[1]!);
		const raw = href?.[1] ?? href?.[2] ?? href?.[3];
		if (!raw || /^\s*(#|mailto:|tel:|javascript:|data:)/i.test(raw)) continue;
		if (/rel\s*=\s*["'][^"']*nofollow/i.test(m[1]!)) continue;
		const url = canonicalPageUrl(decodeEntities(raw.trim()), baseUrl);
		if (url) links.push({ url, text: decodeEntities(m[2]!.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim().slice(0, 120) });
	}
	const stripped = source
		.replace(/<!--[\s\S]*?-->/g, " ")
		.replace(/<(script|style|noscript|template|svg|iframe|object|embed|head)\b[\s\S]*?<\/\1\s*>/gi, " ")
		.replace(new RegExp(`</?(${BLOCK_TAGS})\\b[^>]*>`, "gi"), "\n")
		.replace(/<[^>]+>/g, " ");
	const blocks = decodeEntities(stripped)
		.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁦-⁩﻿]/g, " ")
		.split(/\n+/)
		.map((b) => b.replace(/\s+/g, " ").trim())
		.filter((b) => b.length > 0);
	return { title: title ? decodeEntities(title.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim().slice(0, 200) || null : null, blocks, links, metaRobots };
}

export function plainTextToPage(text: string): ParsedPage {
	return { title: null, blocks: text.split(/\n+/).map((b) => b.replace(/\s+/g, " ").trim()).filter(Boolean), links: [], metaRobots: [] };
}

/** Sentences of one block, kept short enough to quote. */
export function sentences(block: string): string[] {
	return block
		.split(/(?<=[.!?])\s+(?=[A-Z“"'(])|\s+[•·▪●]\s+|\s{2,}/)
		.map((s) => s.trim())
		.filter((s) => s.length >= 12 && s.length <= 600);
}
