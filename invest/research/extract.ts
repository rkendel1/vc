import { sha256Hex } from "../domain/canonical.ts";
import type { AssertionType, CriterionField, PageKind, ResearchCriterion, SourceClass } from "../domain/research.ts";
import { sentences } from "./html.ts";

/**
 * Deterministic, rule-based criterion extraction. Bump EXTRACTOR_VERSION when any rule changes.
 *
 * Trust boundary: page text is data. The extractor only matches patterns against it and emits
 * values from closed vocabularies (or parsed numbers); no page text is executed, interpolated into
 * prompts or allowed to change behaviour. Sentences that try to instruct a reader are dropped and
 * the page is flagged. There is no model here, so there is no model confidence: `extractionNote`
 * says only what the rule matched, and "unknown" is a normal result.
 */
export const EXTRACTOR_VERSION = "invest-research-rules/1.1.0";

const STAGES: [string, RegExp][] = [
	["pre_seed", /\bpre[- ]?seed\b/i],
	["seed", /(?<!pre[- ]?)\bseed\b/i],
	["series_a", /\bseries[- ]a\b/i],
	["series_b", /\bseries[- ]b\b/i],
	["series_c_plus", /\bseries[- ][c-f]\b/i],
	["early_stage", /\bearly[- ]stage\b/i],
	["growth", /\b(growth[- ]stage|growth equity)\b/i],
	["late_stage", /\blate[- ]stage\b/i],
];

const SECTORS: [string, RegExp][] = [
	["fintech", /\b(fintech|financial technology|financial services|payments|banking)\b/i],
	["healthcare", /\b(healthcare|health care|healthtech|digital health|medtech|medical devices?)\b/i],
	["biotech", /\b(biotech(?:nology)?|life sciences?|therapeutics|drug discovery)\b/i],
	["climate", /\b(climate|cleantech|clean energy|decarboni[sz]ation|energy transition|sustainability)\b/i],
	["enterprise_software", /\b(enterprise software|b2b software|saas|enterprise saas|software[- ]as[- ]a[- ]service)\b/i],
	["artificial_intelligence", /\b(?:artificial intelligence|machine learning|generative ai|ai|ml)\b/i],
	["cybersecurity", /\b(cyber ?security|information security|infosec)\b/i],
	["deep_tech", /\b(deep ?tech|frontier tech(?:nology)?)\b/i],
	["developer_tools", /\b(developer tools?|dev ?tools|developer infrastructure|devops)\b/i],
	["consumer", /\b(consumer (?:internet|products?|apps?|software|technology|brands?)|direct[- ]to[- ]consumer|d2c|dtc)\b/i],
	["marketplaces", /\bmarketplaces?\b/i],
	["crypto_web3", /\b(crypto(?:currency|currencies)?|web3|blockchain|digital assets?|defi)\b/i],
	["education", /\b(edtech|education technology|education)\b/i],
	["real_estate", /\b(proptech|real estate)\b/i],
	["hardware", /\b(hardware|robotics|semiconductors?|iot)\b/i],
	["space_defense", /\b(aerospace|space tech(?:nology)?|defen[sc]e|national security)\b/i],
	["gaming_media", /\b(gaming|games|media|entertainment)\b/i],
	["agriculture_food", /\b(agtech|agriculture|food tech|foodtech)\b/i],
	["logistics_mobility", /\b(logistics|supply chain|mobility|transportation)\b/i],
	["insurance", /\b(insurtech|insurance)\b/i],
	["legal_govtech", /\b(legal tech|govtech|civic tech)\b/i],
];

const GEOGRAPHIES: [string, RegExp][] = [
	["united_states", /\b(?:united states|usa|u\.s\.a?)(?![a-z])|\bus[- ](?:based|companies|founders|startups)\b/i],
	["north_america", /\bnorth america(?:n)?\b/i],
	["canada", /\bcanad(?:a|ian)\b/i],
	["europe", /\b(europe(?:an)?|eu-based|emea)\b/i],
	["united_kingdom", /\b(?:united kingdom|u\.k\.|uk|britain|british)\b/i],
	["israel", /\bisrael(?:i)?\b/i],
	["india", /\bindia(?:n)?\b/i],
	["southeast_asia", /\b(southeast asia|south-east asia|sea region|singapore|indonesia|vietnam)\b/i],
	["asia", /\b(asia(?:n)?|apac|asia-pacific)\b/i],
	["china", /\bchin(?:a|ese)\b/i],
	["latin_america", /\b(latin america|latam|brazil|mexico)\b/i],
	["africa", /\bafrica(?:n)?\b/i],
	["middle_east", /\b(middle east|mena|gulf region)\b/i],
	["global", /\b(global(?:ly)?|worldwide|anywhere in the world|borderless)\b/i],
];

const BUSINESS_MODELS: [string, RegExp][] = [
	["b2b", /\b(b2b|business[- ]to[- ]business)\b/i],
	["b2c", /\b(b2c|business[- ]to[- ]consumer)\b/i],
	["b2b2c", /\bb2b2c\b/i],
	["marketplace", /\bmarketplace\b/i],
	["saas", /\b(saas|subscription (?:software|business(?:es)?))\b/i],
	["hardware", /\bhardware (?:startups?|companies|businesses)\b/i],
];

const CHARACTERISTICS: [string, RegExp][] = [
	["technical_founders", /\btechnical (?:co-?)?founders?\b/i],
	["repeat_founders", /\b(repeat|second-time|serial) founders?\b/i],
	["first_time_founders", /\bfirst[- ]time founders?\b/i],
	["mission_driven", /\bmission[- ]driven\b/i],
	["capital_efficient", /\bcapital[- ]efficient\b/i],
	["women_led", /\b(women|female)[- ]led\b/i],
	["underrepresented_founders", /\bunderrepresented (?:founders|entrepreneurs)\b/i],
];

const TRACTION: [string, RegExp][] = [
	["pre_revenue", /\bpre[- ]revenue\b/i],
	["revenue_generating", /\b(revenue[- ]generating|generating revenue|early revenue|have revenue)\b/i],
	["product_market_fit", /\bproduct[- ]market fit\b/i],
	["working_prototype", /\b(working )?(prototype|mvp|minimum viable product)\b/i],
	["paying_customers", /\bpaying customers?\b/i],
	["recurring_revenue", /\b(arr|mrr|annual recurring revenue|monthly recurring revenue)\b/i],
];

const APPLICATION: [string, RegExp][] = [
	["warm_introduction_preferred", /\b(warm intro(?:duction)?s?|introduced by|referral|referred by)\b/i],
	["no_unsolicited_submissions", /\b(do(?:es)? not|don't|doesn't|cannot|can't) (?:accept|review|consider|respond to) (?:any )?(?:unsolicited|cold)\b/i],
	["accepts_cold_submissions", /\b(?:accept|welcome|review|consider) (?:unsolicited|cold)\b|\bcold (?:emails?|pitches|outreach) (?:are )?(?:welcome|accepted)\b/i],
	["application_form", /\b(?:apply|application|submit)\b.{0,40}\b(?:form|online|through our website|via our website)\b/i],
	["pitch_deck_requested", /\b(?:pitch deck|deck|one[- ]pager|executive summary)\b/i],
	["email_submissions", /\b(?:email|e-mail|send us)\b.{0,40}\b(?:pitch|deck|submission|introduction|intro)\b/i],
];

const NEGATION = /\b(?:do(?:es)? not|don't|doesn't|won't|will not|cannot|can't|never|avoid|not (?:currently )?(?:invest|back|fund|consider|participate)|no (?:longer )?invest|exclud\w+|except|other than|rule[sd]? out|not a fit|outside (?:of )?our)\b/i;
const INVEST_STATEMENT =
	/\b(?:we|our (?:fund|firm|team|investments?)|the (?:fund|firm)|(?:invest|investment)s? (?:focus|thesis|criteria|areas?|strategy|mandate))\b[^.]{0,80}\b(?:invest(?:s|ing)?|back(?:s|ing)?|focus(?:es|ed|ing)?|specialis[ez]e?s?|lead(?:s|ing)?|partner(?:s|ing)? with|support(?:s|ing)?|fund(?:s|ing)?|target(?:s|ing)?|seek(?:s|ing)?|look(?:s|ing)? for|write(?:s)? checks?|prefer(?:s)?|criteria|thesis|areas?|strategy|mandate|(?:is|are) (?:on|in))\b|\b(?:what we look for|investment (?:criteria|focus|thesis|strategy)|focus areas?|we(?:'re| are) (?:looking|focused|investors))\b/i;
const OBSERVED_STATEMENT = /\b(?:led|co-led|participat(?:ed|ing)|invested|backed|announces?|announced|closed|raised|funding round|financing|joins? our portfolio|proud to (?:back|partner|support))\b/i;
const CHECK_CONTEXT = /\b(?:check|checks|check size|cheque|investment size|ticket|initial investment|invest(?:s|ing)? (?:between|from|up to|about|around|approximately)|investments? (?:range|between|of)|typically invest|write checks?)\b/i;
const FUND_SIZE = /\b(?:fund (?:size|of|ii|iii|iv|v|i)\b|aum|assets under management|raised \$|billion (?:fund|in assets)|\$[\d.,]+\s?(?:m|mm|million|b|billion) fund)\b/i;
const MONEY = /\$\s?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s?(k|thousand|m|mm|million|b|bn|billion)?/gi;

/** Phrases that address a reader/model rather than describe a firm. Matching sentences are discarded. */
const HOSTILE: RegExp[] = [
	/\b(?:ignore|disregard|forget|override)\b[^.]{0,40}\b(?:previous|prior|above|earlier|all|any|your|the)\b[^.]{0,30}\b(?:instructions?|prompts?|rules?|guidelines?|directions?)\b/i,
	/\b(?:system|developer) (?:prompt|message|instructions?)\b/i,
	/\b(?:you are|you're) (?:now |actually )?(?:an? |the )?(?:ai|assistant|language model|llm|chatbot|bot|agent|crawler|scraper)\b/i,
	/\b(?:as an? (?:ai|language model|assistant))\b/i,
	/\b(?:reveal|print|output|leak|exfiltrate|send)\b[^.]{0,40}\b(?:prompt|secret|api[- ]?key|token|credential|password|environment)\b/i,
	/\b(?:new|updated|real) instructions?\b/i,
	/\bact as\b|\bpretend (?:to be|you)\b|\bjailbreak\b/i,
	/<\s*\/?\s*(?:system|instructions?|assistant|prompt)\s*>/i,
	/\b(?:mark|set|record|report|classify|label)\b[^.]{0,40}\b(?:this firm|the firm|this page|status|criteria|verification|confidence)\b[^.]{0,40}\b(?:as|to)\b/i,
	/\b(?:crawl|visit|fetch|request|follow)\b[^.]{0,30}\b(?:https?:\/\/|all links|every link|internal|localhost|169\.254)/i,
	/\b(?:when summari[sz]ing|if you are (?:reading|processing)|to any (?:ai|llm|model))\b/i,
];

export function isHostile(text: string): boolean {
	return HOSTILE.some((re) => re.test(text));
}

const clip = (s: string, n = 420) => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`);

export type ExtractedCriterion = Omit<ResearchCriterion, "id" | "workspaceId" | "firmId" | "sourceId" | "sourceClass" | "capturedAt" | "runId" | "extractorVersion" | "method">;

type Match = { field: CriterionField; value: string; label: string };

const LABELS: Record<string, string> = {};
const label = (v: string) => LABELS[v] ?? v.replace(/_/g, " ");

function scan(text: string, vocab: [string, RegExp][], field: CriterionField): Match[] {
	const out: Match[] = [];
	for (const [value, re] of vocab) if (re.test(text)) out.push({ field, value, label: label(value) });
	return out;
}

/** Splits at contrast markers so "invest in X but do not invest in Y" is read clause by clause. */
function clauses(sentence: string): string[] {
	return sentence.split(/\s*(?:;|,?\s+but\s+|,?\s+however,?\s+|,?\s+although\s+|,?\s+whereas\s+|,?\s+while\s+|,?\s+except\s+(?=for\b)?)/i).filter((c) => c.trim().length > 3);
}

function toUsd(amount: string, unit: string | undefined, fallbackUnit?: string): number | null {
	const n = Number(amount.replace(/,/g, ""));
	if (!Number.isFinite(n)) return null;
	const u = (unit ?? fallbackUnit ?? "").toLowerCase();
	const mult = u === "k" || u === "thousand" ? 1e3 : u === "m" || u === "mm" || u === "million" ? 1e6 : u === "b" || u === "bn" || u === "billion" ? 1e9 : 1;
	const usd = n * mult;
	return usd >= 1000 && usd <= 1e9 ? Math.round(usd) : null;
}

const NUM = "(\\d{1,3}(?:,\\d{3})+|\\d+(?:\\.\\d+)?)";
const UNIT = "(k|thousand|mm|m|million|bn|b|billion)?";
const RANGE = new RegExp(`\\$\\s?${NUM}\\s?${UNIT}\\s?(?:-|–|—|to|and|through)\\s?\\$?\\s?${NUM}\\s?${UNIT}(?![a-z])`, "i");

/** Check-size ranges stated in one sentence. Dollar amounts only; other currencies are left unknown rather than converted. */
export function parseCheckSize(sentence: string): { minUsd: number | null; maxUsd: number | null } | null {
	if (!CHECK_CONTEXT.test(sentence) || FUND_SIZE.test(sentence)) return null;
	if ((sentence.match(/\$/g) ?? []).length > 2) return null;
	const range = RANGE.exec(sentence);
	if (range) {
		const lead = toUsd(range[1]!, range[2], range[4]);
		const trail = toUsd(range[3]!, range[4]);
		if (lead === null || trail === null) return null;
		return { minUsd: Math.min(lead, trail), maxUsd: Math.max(lead, trail) };
	}
	const amounts = [...sentence.matchAll(MONEY)];
	if (amounts.length !== 1) return null;
	const only = amounts[0]!;
	const amount = toUsd(only[1]!, only[2]);
	if (amount === null) return null;
	const before = sentence.slice(Math.max(0, only.index! - 24), only.index!).toLowerCase();
	if (/(?:up to|maximum of|at most|no more than|as much as)\s*$/.test(before)) return { minUsd: null, maxUsd: amount };
	if (/(?:at least|minimum of|starting at|from|over|more than)\s*$/.test(before)) return { minUsd: amount, maxUsd: null };
	return { minUsd: amount, maxUsd: amount };
}

export function checkSizeValue(range: { minUsd: number | null; maxUsd: number | null }): string {
	return `usd_${range.minUsd ?? "any"}_${range.maxUsd ?? "any"}`;
}
export function checkSizeLabel(range: { minUsd: number | null; maxUsd: number | null }): string {
	if (range.minUsd !== null && range.maxUsd !== null) return range.minUsd === range.maxUsd ? `about ${formatUsd(range.minUsd)}` : `${formatUsd(range.minUsd)}–${formatUsd(range.maxUsd)}`;
	return range.maxUsd !== null ? `up to ${formatUsd(range.maxUsd)}` : `from ${formatUsd(range.minUsd)}`;
}
export function formatUsd(n: number | null): string {
	if (n === null) return "any";
	return n >= 1e9 ? `$${n / 1e9}B` : n >= 1e6 ? `$${n / 1e6}M` : n >= 1e3 ? `$${n / 1e3}K` : `$${n}`;
}

export type PageInput = { kind: PageKind; sourceClass: SourceClass; blocks: string[]; url: string };
export type PageExtraction = { criteria: ExtractedCriterion[]; hostile: boolean; relevantExcerpts: string[]; droppedSentences: number };


/** Criteria and quotable excerpts from one page. Pure function of its input. */
export function extractFromPage(page: PageInput): PageExtraction {
	const criteria: ExtractedCriterion[] = [];
	const excerpts: string[] = [];
	let hostile = false;
	let dropped = 0;
	const push = (c: Omit<ExtractedCriterion, "polarity" | "valueRange" | "basis" | "extractionNote" | "passageHash"> & Partial<Pick<ExtractedCriterion, "polarity" | "valueRange" | "basis" | "extractionNote">>) => {
		criteria.push({ polarity: "include", valueRange: null, basis: null, extractionNote: null, ...c, passageHash: sha256Hex(c.passage) });
	};
	const isPortfolio = page.kind === "portfolio";
	const portfolioEntries: string[] = [];

	for (const block of page.blocks) {
		for (const sentence of sentences(block).length ? sentences(block) : [block].filter((b) => b.length >= 12 && b.length <= 600)) {
			if (isHostile(sentence)) {
				hostile = true;
				dropped++;
				continue;
			}
			if (isPortfolio && !INVEST_STATEMENT.test(sentence)) {
				if (sentence.length >= 20 && sentence.length <= 400) portfolioEntries.push(sentence);
				continue;
			}
			const passage = clip(sentence);
			const declarative = INVEST_STATEMENT.test(sentence) && !/^(?:we|our)\b[^.]{0,30}\b(?:invested|backed|led|participated)\b/i.test(sentence);
			const announcement = !declarative && OBSERVED_STATEMENT.test(sentence);

			if (declarative) {
				let any = false;
				for (const clause of clauses(sentence)) {
					const polarity = NEGATION.test(clause) ? "exclude" : "include";
					const matches = [
						...scan(clause, STAGES, "stage"),
						...scan(clause, SECTORS, "sector"),
						...scan(clause, GEOGRAPHIES, "geography"),
						...scan(clause, BUSINESS_MODELS, "business_model"),
						...scan(clause, CHARACTERISTICS, "company_characteristics"),
						...scan(clause, TRACTION, "traction"),
					];
					for (const m of matches) {
						push({
							field: polarity === "exclude" ? "exclusion" : m.field,
							polarity,
							value: polarity === "exclude" ? `${m.field}:${m.value}` : m.value,
							label: polarity === "exclude" ? `${m.field.replace(/_/g, " ")}: ${m.label}` : m.label,
							assertionType: "explicit",
							passage,
							extractionNote: "Matched a first-person investment statement by rule.",
						});
						any = true;
					}
					const range = parseCheckSize(clause);
					if (range && polarity === "include") {
						push({
							field: "check_size",
							value: checkSizeValue(range),
							valueRange: range,
							label: checkSizeLabel(range),
							assertionType: "explicit",
							passage,
							extractionNote: "Dollar amounts parsed from a check-size sentence; other currencies are not converted.",
						});
						any = true;
					}
				}
				if (any) excerpts.push(passage);
			} else if (announcement) {
				// A past investment is an observation about what the firm did, not what it says it does.
				const stage = scan(sentence, STAGES, "stage").filter((m) => m.value !== "early_stage" || /\bearly[- ]stage\b/i.test(sentence));
				for (const m of stage.slice(0, 2)) {
					push({ field: "stage", value: m.value, label: `Took part in a ${m.label.replace(/_/g, " ")} financing`, assertionType: "observed", passage, extractionNote: "A financing described in an announcement; says what the firm did, not what it targets." });
					excerpts.push(passage);
				}
			}

			if (!declarative && !isPortfolio && page.kind !== "announcement") {
				const range = parseCheckSize(sentence);
				if (range && !NEGATION.test(sentence)) {
					push({ field: "check_size", value: checkSizeValue(range), valueRange: range, label: checkSizeLabel(range), assertionType: "explicit", passage, extractionNote: "Dollar amounts parsed from a check-size sentence; other currencies are not converted." });
					excerpts.push(passage);
				}
			}
			if (!isPortfolio && page.kind !== "announcement") {
				for (const [value, re] of APPLICATION) {
					if (!re.test(sentence)) continue;
					if (value === "accepts_cold_submissions" && NEGATION.test(sentence)) continue;
					if (value === "pitch_deck_requested" && !/\b(?:send|submit|share|include|attach|require|ask)/i.test(sentence)) continue;
					push({ field: "application_requirements", value, label: label(value), assertionType: "explicit", passage, extractionNote: "Matched application wording by rule." });
					excerpts.push(passage);
				}
			}
		}
	}

	// Portfolio pattern: a term appearing in several distinct entries is an inference about the firm, never its declared policy.
	if (isPortfolio && portfolioEntries.length >= 3) {
		const MIN = 3;
		for (const [field, vocab] of [["sector", SECTORS], ["stage", STAGES], ["geography", GEOGRAPHIES]] as const) {
			for (const [value, re] of vocab) {
				const hits = portfolioEntries.filter((e) => re.test(e));
				if (hits.length < MIN) continue;
				push({
					field,
					value,
					label: `${label(value)} (portfolio pattern)`,
					assertionType: "inferred",
					passage: clip(hits[0]!),
					basis: { observations: hits.length, of: portfolioEntries.length },
					extractionNote: `Mentioned in ${hits.length} of ${portfolioEntries.length} portfolio entries on this page. A pattern in past investments, not a stated policy.`,
				});
				excerpts.push(clip(hits[0]!));
			}
		}
	}

	const unique = new Map<string, ExtractedCriterion>();
	for (const c of criteria) unique.set(`${c.field}|${c.polarity}|${c.value}|${c.assertionType}|${c.passageHash}`, c);
	return { criteria: [...unique.values()], hostile, relevantExcerpts: [...new Set(excerpts)], droppedSentences: dropped };
}

/** Stable identity: the same statement from the same passage at the same extractor version is one criterion. */
export function criterionId(firmId: string, sourceId: string, c: Pick<ExtractedCriterion, "field" | "polarity" | "value" | "assertionType" | "passageHash">): string {
	return `rc_${sha256Hex([firmId, sourceId, c.field, c.polarity, c.value, c.assertionType, c.passageHash, EXTRACTOR_VERSION].join("|")).slice(0, 32)}`;
}

export type { AssertionType };
