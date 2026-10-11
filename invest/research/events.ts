import { sha256Hex } from "../domain/canonical.ts";
import type { EventType, InvestmentEvent } from "../domain/research.ts";
import { toIsoDate, type FeedItem } from "./feed.ts";
import { isHostile } from "./extract.ts";
import { sentences } from "./html.ts";

/**
 * Investment-announcement extraction and identity. Rule-based and conservative:
 *  - a round amount is the round's amount, taken verbatim; the firm's own cheque is recorded only
 *    when the sentence says "we invested $X" and is never derived from a round size;
 *  - the announcement date is a date written in the passage; the page's/feed's publication date is
 *    kept apart; neither is replaced by the discovery date;
 *  - similarly named companies are never merged: they are linked as "uncertain" for review.
 */
export const NEW_WINDOW_DAYS = 30;

const STAGE = "(?:pre[- ]?seed|seed|series [a-e]\\+?|follow[- ]on|bridge)";
/** Same words, either case, for the company patterns (which must stay case-sensitive for the name itself). */
const STAGE_ANYCASE = "(?:[Pp]re[- ]?[Ss]eed|[Ss]eed|[Ss]eries [A-Ea-e]\\+?|[Ff]ollow[- ]on|[Bb]ridge)";
export const MONEY = "\\$\\s?(\\d{1,3}(?:,\\d{3})+|\\d+(?:\\.\\d+)?)\\s?([kK]|[tT]housand|MM|mm|[mM]|[mM]illion|[bB]n|[bB]|[bB]illion)?";
export const NAME = "([A-Z][A-Za-z0-9&.'’-]*(?:\\s+(?:[A-Z][A-Za-z0-9&.'’-]*|of|the|&|and)){0,3})";
const INVOLVEMENT = /\b(?:led|co-led|co-leads|leads|participat\w+|joined|invest(?:ed|s|ing)? in|backed|backs|our investment|partner(?:ed|s)? with|alongside|proud to (?:back|support)|excited to (?:back|announce))\b/i;
const ACQUISITION = /\b(?:acquir(?:e|ed|es|ing)|acquisition of)\b/i;
const FOLLOW_ON = /\bfollow[- ]on\b/i;

const SUFFIX = /\b(?:inc|incorporated|llc|ltd|limited|corp|corporation|co|gmbh|sa|ag|bv|plc|labs?|technologies|technology|holdings)\.?$/i;
const STOP_NAMES = new Set(["we", "our", "the", "today", "series", "seed", "round", "funding", "fund", "this", "that", "it", "they", "i", "in", "a", "an", "and", "of", "founders", "company", "companies", "investment", "investments"]);
const TRAILING_STOP = /\s+(?:a|an|the|and|of|to|in|for|as|is|was|which|that|with|by|on|at|has|have|will|raises?|raised)$/i;

export function companyKey(name: string): string {
	let n = name.toLowerCase().replace(/[’']/g, "").replace(/[^\p{L}\p{N}\s&-]/gu, " ").replace(/\s+/g, " ").trim();
	for (let i = 0; i < 3; i++) n = n.replace(SUFFIX, "").trim();
	return n.replace(/\s*&\s*/g, " and ");
}

export function cleanCompanyName(raw: string, firmName: string): string | null {
	let name = raw.trim();
	for (let i = 0; i < 4; i++) name = name.replace(TRAILING_STOP, "").trim();
	name = name.replace(/[.,;:]+$/, "").slice(0, 80);
	if (name.length < 2 || STOP_NAMES.has(name.toLowerCase())) return null;
	if (name.split(/\s+/).every((w) => STOP_NAMES.has(w.toLowerCase()))) return null;
	const key = companyKey(name);
	if (!key || key === companyKey(firmName) || /^(?:series|seed)\b/i.test(name)) return null;
	return name;
}

export function toUsd(amount: string, unit: string | undefined): number | null {
	const n = Number(amount.replace(/,/g, ""));
	if (!Number.isFinite(n)) return null;
	const u = (unit ?? "").toLowerCase();
	const usd = n * (u === "k" || u === "thousand" ? 1e3 : u === "m" || u === "mm" || u === "million" ? 1e6 : u === "b" || u === "bn" || u === "billion" ? 1e9 : 1);
	return usd >= 10_000 && usd <= 5e9 ? Math.round(usd) : null;
}

const MONTHS = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
const TEXT_DATE = new RegExp(`\\b(?:${MONTHS})\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4}\\b|\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:${MONTHS})\\.?,?\\s+\\d{4}\\b|\\b\\d{4}-\\d{2}-\\d{2}\\b`, "i");

export function dateInText(sentence: string): string | null {
	const m = TEXT_DATE.exec(sentence);
	return m ? toIsoDate(`${m[0].replace(/(\d)(?:st|nd|rd|th)/, "$1")} UTC`) : null;
}

export function roundType(sentence: string): { type: EventType; round: string | null } {
	const stage = new RegExp(STAGE, "i").exec(sentence)?.[0].toLowerCase().replace(/[- ]+/g, "_").replace(/^pre_?seed$/, "pre_seed") ?? null;
	const round = stage ? stage.replace(/_/g, " ") : null;
	if (ACQUISITION.test(sentence)) return { type: "acquisition", round };
	if (FOLLOW_ON.test(sentence) || stage === "follow_on") return { type: "follow_on", round: round === "follow on" ? null : round };
	if (stage === "seed" || stage === "pre_seed") return { type: "seed_round", round };
	if (stage?.startsWith("series") || stage === "bridge") return { type: "venture_round", round };
	return { type: "new_investment", round };
}

export type EventCandidate = {
	type: EventType;
	companyName: string;
	companyKey: string;
	companyUrl: string | null;
	round: string | null;
	roundAmountUsd: number | null;
	firmAmountUsd: number | null;
	involvement: "stated" | "implied_by_source";
	announcedAt: string | null;
	publishedAt: string | null;
	passage: string;
	passageHash: string;
};

/** The passage itself ties the firm (by name or as "we/our") to an investing verb. "Led by Someone Else" does not. */
function firmTookPart(sentence: string, firmNames: string[]): boolean {
	if (!INVOLVEMENT.test(sentence)) return false;
	const lower = sentence.toLowerCase();
	const named = firmNames.flatMap((n) => [n, n.split(/\s+/)[0] ?? ""]).filter((n) => n.length >= 4).some((n) => lower.includes(n.toLowerCase()));
	return named || /\b(?:we|our|we're|we've)\b/i.test(sentence);
}

function findCompany(sentence: string, firmName: string): string | null {
	const patterns: RegExp[] = [
		new RegExp(`${NAME}['’]s\\s+(?:${MONEY}\\s+)?${STAGE_ANYCASE}\\b`),
		new RegExp(`^(?:\\w+\\s+){0,2}?${NAME}\\s+(?:raises|raised|announces|announced|closes|closed|secures|secured|lands|landed|completes|completed|unveils|launches)\\b`),
		new RegExp(`\\b(?:led|co-led|co-leads|leads|participat\\w+ in|joined|invest(?:ed|s)? in|backed|backs|our investment in|investment in|partner(?:ed|s)? with|support(?:ed|s)?)\\s+(?:the\\s+)?(?:${MONEY}\\s+)?(?:${STAGE_ANYCASE}\\s+)?(?:round|financing|investment)?\\s*(?:of|in|for|into)?\\s*${NAME}`),
		new RegExp(`\\b(?:acquir(?:ed|es)|acquisition of)\\s+${NAME}`),
		new RegExp(`\\bround (?:of|in|for) ${NAME}`),
	];
	for (const re of patterns) {
		const m = re.exec(sentence);
		const name = m ? cleanCompanyName(m[m.length - 1]!, firmName) : null;
		if (name) return name;
	}
	return null;
}

export type EventSource = { firmName: string; /** Other names the firm goes by on its own site: the domain label, the home page title. */ firmAliases?: string[]; kind: string; links: { url: string; text: string }[]; publishedAt: string | null; scopeDomain: string };

function linkFor(name: string, links: EventSource["links"], scopeDomain: string): string | null {
	const key = companyKey(name);
	const hit = links.find((l) => l.text && companyKey(l.text) === key);
	if (!hit) return null;
	try {
		const u = new URL(hit.url);
		const host = u.hostname.replace(/^www\./, "");
		if (u.protocol !== "https:" || host === scopeDomain || host.endsWith(`.${scopeDomain}`)) return null;
		return `${u.origin}/`; // a pointer to the company, never fetched
	} catch {
		return null;
	}
}

export function extractEventsFromSentences(texts: string[], source: EventSource): { candidates: EventCandidate[]; hostile: boolean; dropped: number } {
	const out = new Map<string, EventCandidate>();
	let hostile = false;
	let dropped = 0;
	for (const sentence of texts) {
		if (isHostile(sentence)) {
			hostile = true;
			dropped++;
			continue;
		}
		const looksLikeRound = new RegExp(`${STAGE}|\\braises?\\b|\\braised\\b|\\bfunding\\b|\\bfinancing\\b`, "i").test(sentence) || INVOLVEMENT.test(sentence) || ACQUISITION.test(sentence);
		if (!looksLikeRound) continue;
		const company = findCompany(sentence, source.firmName);
		if (!company) continue;
		const { type, round } = roundType(sentence);
		// A passage that names no round, amount, or involvement is not an announcement.
		const amount = new RegExp(MONEY, "i").exec(sentence);
		const own = new RegExp(`\\b(?:we|our)\\s+(?:invested|investment of|check of|cheque of|committed)\\s+${MONEY}`, "i").exec(sentence);
		if (type === "new_investment" && !INVOLVEMENT.test(sentence) && !amount) continue;
		const firmAmountUsd = own ? toUsd(own[1]!, own[2]) : null;
		const roundAmountUsd = amount && !own ? toUsd(amount[1]!, amount[2]) : amount && own && amount.index !== own.index + own[0].length - amount[0].length ? toUsd(amount[1]!, amount[2]) : null;
		const passage = sentence.length > 420 ? `${sentence.slice(0, 419)}…` : sentence;
		const candidate: EventCandidate = {
			type,
			companyName: company,
			companyKey: companyKey(company),
			companyUrl: linkFor(company, source.links, source.scopeDomain),
			round,
			roundAmountUsd,
			firmAmountUsd,
			involvement: firmTookPart(sentence, [source.firmName, ...(source.firmAliases ?? [])]) ? "stated" : "implied_by_source",
			announcedAt: dateInText(sentence),
			publishedAt: source.publishedAt,
			passage,
			passageHash: sha256Hex(passage),
		};
		out.set(`${candidate.companyKey}|${candidate.type}|${candidate.passageHash}`, candidate);
	}
	return { candidates: [...out.values()], hostile, dropped };
}

export function extractEventsFromBlocks(blocks: string[], source: EventSource) {
	return extractEventsFromSentences(blocks.flatMap((b) => (sentences(b).length ? sentences(b) : b.length >= 12 && b.length <= 600 ? [b] : [])), source);
}

export function extractEventsFromFeed(items: FeedItem[], source: Omit<EventSource, "publishedAt">) {
	const all: EventCandidate[] = [];
	let hostile = false;
	let dropped = 0;
	for (const item of items) {
		const texts = [item.title, ...sentences(item.summary)].filter((t) => t.length >= 12);
		const r = extractEventsFromSentences(texts, { ...source, publishedAt: item.publishedAt });
		all.push(...r.candidates);
		hostile ||= r.hostile;
		dropped += r.dropped;
	}
	return { candidates: all, hostile, dropped };
}

/** Company names listed on a portfolio page. Listing is an observation about the page, not an announcement. */
export function extractPortfolioEntries(blocks: string[]): string[] {
	const names = new Map<string, string>();
	for (const block of blocks) {
		if (block.length < 4 || block.length > 300 || isHostile(block)) continue;
		const head = block.split(/\s[—–-]\s|:|\||,|\./)[0]!.trim();
		if (head.length < 2 || head.length > 40 || !/^[A-Z0-9]/.test(head) || head.split(/\s+/).length > 4) continue;
		const clean = cleanCompanyName(head, "");
		if (clean) names.set(companyKey(clean), clean);
	}
	return [...names.values()].slice(0, 200);
}

// ---------------------------------------------------------------------------------------- matching

const dayMs = 86_400_000;
const effective = (e: Pick<InvestmentEvent, "announcedAt" | "earliestPublishedAt">) => e.announcedAt ?? e.earliestPublishedAt;
const familyCompatible = (a: EventType, b: EventType) => a === b || a === "new_investment" || b === "new_investment" || a === "portfolio_addition" || b === "portfolio_addition";

function tokens(key: string) {
	return key.split(/\s+/).filter(Boolean);
}
function editDistanceAtMost1(a: string, b: string): boolean {
	if (Math.abs(a.length - b.length) > 1) return false;
	let i = 0;
	while (i < a.length && i < b.length && a[i] === b[i]) i++;
	if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
	return a.length > b.length ? a.slice(i + 1) === b.slice(i) : b.slice(i + 1) === a.slice(i);
}

export type EventMatch = { kind: "same"; event: InvestmentEvent } | { kind: "uncertain"; candidates: InvestmentEvent[] } | { kind: "new" };

/**
 * Same company and compatible round and dates → the same event (corroboration).
 * A different but similar company name → uncertain: separate event, linked for review, never merged.
 */
export function matchEvent(c: Pick<EventCandidate, "companyKey" | "type" | "announcedAt" | "publishedAt">, existing: InvestmentEvent[]): EventMatch {
	const cDate = c.announcedAt ?? c.publishedAt;
	const same = existing.find((e) => {
		if (e.companyKey !== c.companyKey || !familyCompatible(e.type, c.type)) return false;
		const eDate = effective(e);
		return !(cDate && eDate && Math.abs(Date.parse(cDate) - Date.parse(eDate)) > 120 * dayMs);
	});
	if (same) return { kind: "same", event: same };
	const similar = existing.filter((e) => {
		if (e.companyKey === c.companyKey) return false;
		const a = tokens(e.companyKey);
		const b = tokens(c.companyKey);
		const subset = (x: string[], y: string[]) => x.length > 0 && x.every((t) => y.includes(t));
		return subset(a, b) || subset(b, a) || (e.companyKey.length >= 4 && editDistanceAtMost1(e.companyKey, c.companyKey));
	});
	return similar.length ? { kind: "uncertain", candidates: similar } : { kind: "new" };
}

export function classifyEvent(effectiveDate: string | null, discoveredAt: string, lookbackDays: number): "new" | "historical" | "undated" | "out_of_window" {
	if (!effectiveDate) return "undated";
	const age = (Date.parse(discoveredAt) - Date.parse(effectiveDate)) / dayMs;
	if (age > lookbackDays) return "out_of_window";
	return age > NEW_WINDOW_DAYS ? "historical" : "new";
}
