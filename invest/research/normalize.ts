import { sha256Hex } from "../domain/canonical.ts";

/**
 * Content normalisation for change detection. Two fetches of a page are "the same content" when
 * their normalised text is equal, whatever changed in navigation, footers, cookie banners, dates,
 * counters or markup. Deliberately conservative about what it removes: substantive sentences are kept.
 */
export const NORMALIZER_VERSION = "invest-normalize/1.0.0";

const MONTHS = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
const DATE_PATTERNS: RegExp[] = [
	/\b\d{4}-\d{2}-\d{2}(?:[t ]\d{2}:\d{2}(?::\d{2})?(?:z|[+-]\d{2}:?\d{2})?)?\b/gi,
	new RegExp(`\\b(?:${MONTHS})\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4}\\b`, "gi"),
	new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:${MONTHS})\\.?,?\\s+\\d{4}\\b`, "gi"),
	/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g,
	/\b\d{1,2}:\d{2}(?::\d{2})?\s?(?:am|pm)?\b/gi,
	/\b(?:updated|last updated|published|posted|modified|reviewed)\s*(?:on|:)?\s*/gi,
	/\b\d+\s+(?:seconds?|minutes?|hours?|days?|weeks?|months?|years?)\s+ago\b/gi,
	/\b(?:©|copyright)\s*(?:\d{4}\s*)?/gi,
];
const BOILERPLATE = /\b(?:cookies?|privacy policy|terms (?:of use|and conditions|of service)|all rights reserved|skip to (?:main )?content|subscribe to (?:our )?newsletter|sign up for|follow us|menu|toggle navigation|back to top|accept all|manage preferences|share on|read more|learn more|view all|load more)\b/i;

/** Blocks that are navigation, boilerplate or decoration rather than content. */
export function isBoilerplateBlock(block: string): boolean {
	const text = block.trim();
	if (text.length < 20 && !/[.!?]$/.test(text)) return true; // menu items, buttons, labels
	if (text.length < 80 && BOILERPLATE.test(text)) return true;
	return false;
}

export function normalizeText(text: string): string {
	let out = text.toLowerCase();
	for (const re of DATE_PATTERNS) out = out.replace(re, " ");
	return out
		.replace(/\b\d+\s+(?:likes?|views?|shares?|comments?|min read)\b/g, " ")
		.replace(/[^\p{L}\p{N}$%.\s-]/gu, " ")
		.replace(/\s+/g, " ")
		.trim();
}

export type NormalizedContent = { blocks: string[]; hash: string };

export function normalizeBlocks(blocks: string[]): NormalizedContent {
	const kept = blocks.filter((b) => !isBoilerplateBlock(b)).map(normalizeText).filter((b) => b.length >= 12);
	return { blocks: kept, hash: `sha256:${sha256Hex(kept.join("\n"))}` };
}

/** Fraction of normalised blocks that differ between two snapshots (0 = identical, 1 = nothing in common). */
export function changeRatio(before: string[], after: string[]): number {
	const a = new Set(before);
	const b = new Set(after);
	const union = new Set([...a, ...b]);
	if (!union.size) return 0;
	let shared = 0;
	for (const x of a) if (b.has(x)) shared++;
	return 1 - shared / union.size;
}
