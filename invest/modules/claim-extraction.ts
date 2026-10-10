import type { ExtractedMetric, MetricKey, PageLine } from "../domain/types.ts";

/**
 * Deterministic claim extraction. Rules only — no model sees a document here — so text inside a
 * document cannot influence what is extracted beyond being matched as data. Extraction is
 * versioned; every evidence item and evaluation manifest records the version that produced it.
 */
export const EXTRACTOR_VERSION = "claims-rules/1.2.0";

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

const SCALE: Record<string, number> = {
	k: 1e3,
	thousand: 1e3,
	m: 1e6,
	mm: 1e6,
	mn: 1e6,
	million: 1e6,
	b: 1e9,
	bn: 1e9,
	billion: 1e9,
};

type NumberHit = { value: number; index: number; end: number; raw: string };

function parseNumber(text: string): number {
	return Number(text.replace(/,/g, ""));
}

/** Dollar amounts: "$2.4M", "$2,400,000", "USD 3m", "2.4M USD", "$150k". Bare numbers without a currency or scale are not money. */
function moneyHits(line: string): NumberHit[] {
	const hits: NumberHit[] = [];
	const patterns = [
		/(?:US\$|\$|USD\s?)\s?(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s*(thousand|million|billion|mm|mn|bn|k|m|b)?\b/gi,
		/(\d+(?:\.\d+)?)\s*(thousand|million|billion|mm|mn|bn|k|m|b)\s*(?:USD|dollars)\b/gi,
	];
	for (const pattern of patterns) {
		for (const m of line.matchAll(pattern)) {
			const base = parseNumber(m[1]);
			const scale = m[2] ? SCALE[m[2].toLowerCase()] ?? 1 : 1;
			if (!Number.isFinite(base)) continue;
			hits.push({ value: base * scale, index: m.index ?? 0, end: (m.index ?? 0) + m[0].length, raw: m[0].trim() });
		}
	}
	// Scaled numbers next to a money keyword but without a currency marker ("ARR 2.4M").
	for (const m of line.matchAll(/(?<![\d.$])(\d+(?:\.\d+)?)\s?(million|billion|mm|mn|bn|k|m|b)\b/gi)) {
		const index = m.index ?? 0;
		if (hits.some((h) => index >= h.index && index < h.end)) continue;
		hits.push({ value: parseNumber(m[1]) * (SCALE[m[2].toLowerCase()] ?? 1), index, end: index + m[0].length, raw: m[0].trim() });
	}
	return hits;
}

function percentHits(line: string): NumberHit[] {
	return [...line.matchAll(/(-?\d+(?:\.\d+)?)\s?(%|percent\b)/gi)].map((m) => ({
		value: Number(m[1]),
		index: m.index ?? 0,
		end: (m.index ?? 0) + m[0].length,
		raw: m[0].trim(),
	}));
}

function nearest(hits: NumberHit[], anchor: number): NumberHit | undefined {
	return [...hits].sort((a, b) => Math.abs(a.index - anchor) - Math.abs(b.index - anchor))[0];
}

// ---------------------------------------------------------------------------
// Metric rules
// ---------------------------------------------------------------------------

type Rule = {
	key: MetricKey;
	anchor: RegExp;
	kind: "money" | "percent" | "count" | "months";
	unless?: RegExp;
	count?: RegExp;
};

const RULES: Rule[] = [
	{ key: "arr", anchor: /\b(ARR|annual(?:ized)? recurring revenue|annual run[- ]rate)\b/i, kind: "money" },
	{ key: "mrr", anchor: /\b(MRR|monthly recurring revenue)\b/i, kind: "money" },
	{ key: "revenue", anchor: /\b(revenue|revenues|sales)\b/i, kind: "money", unless: /\b(ARR|MRR|recurring|run[- ]rate)\b/i },
	{ key: "revenue_growth_pct", anchor: /\b(grew|growth|growing|increase[d]?|yoy|year[- ]over[- ]year|mom|month[- ]over[- ]month)\b/i, kind: "percent", unless: /\b(margin|churn|retention|NRR|NDR)\b/i },
	{ key: "gross_margin_pct", anchor: /\bgross margins?\b/i, kind: "percent" },
	{ key: "net_revenue_retention_pct", anchor: /\b(NRR|NDR|net (?:revenue|dollar) retention)\b/i, kind: "percent" },
	{ key: "churn_pct", anchor: /\bchurn\b/i, kind: "percent" },
	{ key: "monthly_burn", anchor: /\b(burn|burn rate|net burn)\b/i, kind: "money", unless: /\b(annual|yearly) burn\b/i },
	{ key: "cash", anchor: /\b(cash on hand|cash in (?:the )?bank|cash balance|in the bank)\b/i, kind: "money" },
	{ key: "funding_ask", anchor: /\b(raising|raise of|seeking|round size|funding ask|we are raising)\b/i, kind: "money" },
	{ key: "pre_money_valuation", anchor: /\bpre[- ]money\b/i, kind: "money" },
	{ key: "tam", anchor: /\b(TAM|total addressable market)\b/i, kind: "money" },
	{
		key: "customers",
		anchor: /\b(customers|clients|logos|paying accounts)\b/i,
		kind: "count",
		count: /(\d{1,3}(?:,\d{3})+|\d+)\+?\s+(?:(?:paying|active|enterprise|b2b|signed|live|new)\s+){0,2}(?:customers|clients|logos|paying accounts)\b/i,
		// "calls with 5 customers" counts people interviewed, not the customer base.
		unless: /\b(reference|references|interview(?:s|ed)?|calls?|survey(?:s|ed)?|spoke|spoken|case stud(?:y|ies)|testimonials?)\b/i,
	},
	{
		key: "team_size",
		anchor: /\b(team|employees|FTEs?|headcount|people)\b/i,
		kind: "count",
		count: /(?:team of|headcount(?: of)?:?|employees:?)\s*(\d{1,4})\b|(\d{1,4})\s+(?:full[- ]time\s+)?(?:employees|FTEs?|people on the team|team members)\b/i,
	},
	{
		key: "runway_months",
		anchor: /\brunway\b/i,
		kind: "months",
		count: /(\d+(?:\.\d+)?)\s+months?\s+(?:of\s+)?runway|runway\s+(?:of\s+)?(\d+(?:\.\d+)?)\s+months?/i,
	},
];

const UNIT: Record<Rule["kind"], ExtractedMetric["unit"]> = { money: "usd", percent: "percent", count: "count", months: "months" };

/** Targets, plans and forecasts are not statements about the company's current state. */
const FORWARD_LOOKING = /\b(target|targets|targeting|goal|goals|projected|projection|projections|forecast|forecasts|plan to|planned|expect(?:ed|s)? to|will reach|aim(?:s|ing)? to|by (?:the )?(?:end of )?20\d\d)\b/i;

/** Every metric a single claim states. One claim may state several ("ARR $2.4M, up 150% YoY"). Forward-looking claims state none. */
export function extractMetrics(text: string): ExtractedMetric[] {
	const found: ExtractedMetric[] = [];
	if (FORWARD_LOOKING.test(text)) return found;
	const money = moneyHits(text);
	const percents = percentHits(text);
	const taken = new Set<number>();
	for (const rule of RULES) {
		if (rule.unless?.test(text)) continue;
		const anchor = rule.anchor.exec(text);
		if (!anchor) continue;
		let hit: NumberHit | undefined;
		if (rule.kind === "money") hit = nearest(money.filter((h) => !taken.has(h.index)), anchor.index);
		else if (rule.kind === "percent") hit = nearest(percents.filter((h) => !taken.has(h.index)), anchor.index);
		else if (rule.count) {
			const m = rule.count.exec(text);
			const value = m ? parseNumber(m[1] ?? m[2]) : Number.NaN;
			if (m && Number.isFinite(value)) hit = { value, index: m.index, end: m.index + m[0].length, raw: m[0].trim() };
		}
		if (!hit || !Number.isFinite(hit.value)) continue;
		// A burn stated per year is not monthly burn.
		let value = hit.value;
		if (rule.key === "monthly_burn" && /\b(per year|annually|\/yr|a year)\b/i.test(text)) continue;
		if (rule.key === "customers" && value >= 1900 && value <= 2100 && !/,/.test(hit.raw)) continue;
		value = Math.round(value * 1e6) / 1e6;
		taken.add(hit.index);
		found.push({ key: rule.key, value, unit: UNIT[rule.kind], raw: hit.raw });
	}
	return found;
}

// ---------------------------------------------------------------------------
// Topics and tokens
// ---------------------------------------------------------------------------

const TOPIC_WORDS: Record<string, string[]> = {
	customers: ["customer", "customers", "client", "clients", "logo", "logos", "pilot", "pilots", "reference", "references", "testimonial", "contract", "contracts"],
	revenue: ["revenue", "revenues", "arr", "mrr", "sales", "bookings", "pricing", "acv"],
	growth: ["growth", "grew", "growing", "yoy", "mom", "increase", "doubled", "tripled"],
	retention: ["retention", "churn", "nrr", "ndr", "renewal", "renewals", "expansion"],
	team: ["founder", "founders", "ceo", "cto", "coo", "team", "hire", "hires", "engineer", "engineers", "experience", "previously", "employees", "headcount"],
	market: ["market", "tam", "sam", "som", "industry", "segment", "addressable"],
	product: ["product", "platform", "feature", "features", "launch", "launched", "roadmap", "technology", "api"],
	competition: ["competitor", "competitors", "competition", "alternative", "incumbent", "incumbents", "moat", "differentiation", "differentiated"],
	traction: ["users", "waitlist", "pipeline", "signed", "loi", "lois", "traction", "adoption", "active"],
	unit_economics: ["cac", "ltv", "payback", "margin", "margins", "burn", "runway", "cash", "unit"],
	regulatory: ["regulation", "regulatory", "compliance", "license", "licensed", "fda", "gdpr", "hipaa", "soc"],
	intellectual_property: ["patent", "patents", "proprietary", "ip", "trade", "secret"],
	legal: ["litigation", "lawsuit", "dispute", "settlement", "liability"],
	fundraising: ["raising", "round", "valuation", "investors", "seed", "series", "pre-money", "safe"],
};

const STOPWORDS = new Set(
	"a an and are as at be been by for from has have in is it its of on or our that the their this to was we were will with which who what more than over under per into about must should company startup business evidence".split(
		" ",
	),
);

export function tokens(text: string): string[] {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9%$\- ]+/g, " ")
		.split(/\s+/)
		.map((t) => t.replace(/^-+|-+$/g, ""))
		.filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

export function topicsOf(text: string, metrics: ExtractedMetric[]): string[] {
	const words = new Set(tokens(text));
	const topics = new Set<string>();
	for (const [topic, list] of Object.entries(TOPIC_WORDS)) if (list.some((w) => words.has(w))) topics.add(topic);
	for (const m of metrics) topics.add(`metric:${m.key}`);
	return [...topics].sort();
}

/** Expands a required-evidence phrase into match terms: metric keys match exactly, phrases by topic and token. */
export function termsFor(phrase: string): { metric: MetricKey | null; topics: string[]; words: string[] } {
	const normalised = phrase.trim().toLowerCase();
	const metric = (normalised.startsWith("metric:") ? normalised.slice(7) : normalised).replace(/\s+/g, "_");
	const isMetric = (
		[
			"arr",
			"mrr",
			"revenue",
			"revenue_growth_pct",
			"gross_margin_pct",
			"net_revenue_retention_pct",
			"customers",
			"monthly_burn",
			"runway_months",
			"cash",
			"team_size",
			"funding_ask",
			"pre_money_valuation",
			"tam",
			"churn_pct",
		] as string[]
	).includes(metric);
	const words = tokens(phrase);
	const topics = Object.entries(TOPIC_WORDS)
		.filter(([topic, list]) => topic === normalised.replace(/\s+/g, "_") || list.some((w) => words.includes(w)))
		.map(([topic]) => topic);
	return { metric: isMetric ? (metric as MetricKey) : null, topics, words };
}

// ---------------------------------------------------------------------------
// Lines → claims
// ---------------------------------------------------------------------------

export type ExtractedClaim = {
	text: string;
	line: number;
	bbox: [number, number, number, number];
	metrics: ExtractedMetric[];
	topics: string[];
};

const MAX_CLAIM_CHARS = 600;

function joinable(prev: PageLine, next: PageLine): boolean {
	if (/[.!?:;]$/.test(prev.text.trim())) return false;
	if (!/^[a-z(]/.test(next.text.trim())) return false;
	return Math.abs(prev.y - next.y) <= Math.max(prev.height, next.height) * 1.8;
}

function informative(text: string, metrics: ExtractedMetric[]): boolean {
	if (metrics.length) return true;
	const words = text.split(/\s+/).filter((w) => /[a-z]/i.test(w));
	if (words.length < 4) return false;
	const letters = text.replace(/[^a-z]/gi, "").length;
	return letters / Math.max(text.length, 1) > 0.5;
}

/** Assembles a page's lines into claims (wrapped lines are rejoined) and extracts metrics and topics. */
export function extractClaims(lines: PageLine[]): ExtractedClaim[] {
	const claims: ExtractedClaim[] = [];
	let i = 0;
	while (i < lines.length) {
		const group = [lines[i]];
		let j = i + 1;
		while (j < lines.length && joinable(group[group.length - 1], lines[j]) && group.map((l) => l.text).join(" ").length < MAX_CLAIM_CHARS) {
			group.push(lines[j]);
			j++;
		}
		const text = group
			.map((l) => l.text.trim())
			.join(" ")
			.replace(/\s+/g, " ")
			.slice(0, MAX_CLAIM_CHARS);
		const metrics = extractMetrics(text);
		if (informative(text, metrics)) {
			const x0 = Math.min(...group.map((l) => l.x));
			const y0 = Math.min(...group.map((l) => l.y));
			const x1 = Math.max(...group.map((l) => l.x + l.width));
			const y1 = Math.max(...group.map((l) => l.y + l.height));
			claims.push({ text, line: i, bbox: [round(x0), round(y0), round(x1 - x0), round(y1 - y0)], metrics, topics: topicsOf(text, metrics) });
		}
		i = j;
	}
	return claims;
}

function round(n: number): number {
	return Math.round(n * 100) / 100;
}
