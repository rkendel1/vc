import { sha256Hex } from "../domain/canonical.ts";
import type { AdapterId, AdapterResult, DatasetMapping, NormalizedAnnouncement, NormalizedCriterion, NormalizedRecord, RecordError } from "../domain/collab.ts";
import { checkSizeLabel, checkSizeValue, GEOGRAPHIES, SECTORS, STAGES, isHostile } from "./extract.ts";
import { MONEY, NAME, cleanCompanyName, companyKey, dateInText, roundType, toUsd } from "./events.ts";
import { parseFeed } from "./feed.ts";
import { parseCsv } from "./input.ts";
import { normalizeFirmUrl } from "./url.ts";

/**
 * Source adapters: format-level, declarative, and narrow. Each turns one retrieved document into
 * normalised records without discarding the source's identity (external id, URL, passage, date).
 * Adapters are pure: no network, no storage, no execution of anything found in the data. Cell and
 * item text is untrusted: instruction-like text drops the record, and nothing is interpolated into
 * a prompt or a query.
 *
 * Implemented: funding_news_feed (RSS/Atom), csv_dataset, json_dataset. No named provider is
 * supported: a provider is usable only if its terms permit automated access and someone registers it
 * with an access basis (see docs/invest/VC4_COLLABORATION.md).
 */
export const ADAPTER_VERSION = "invest-adapters/1.0.0";
export const MAX_RECORDS_PER_DOCUMENT = 20_000;

export type AdapterInput = { body: string; contentType: string | null; url: string; mapping: DatasetMapping | null };
export interface SourceAdapter {
	readonly id: AdapterId;
	readonly formats: readonly string[];
	parse(input: AdapterInput): AdapterResult;
}

const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`);
const clean = (s: unknown, max = 200) =>
	String(s ?? "")
		.replace(/[\u0000-\u001F\u007F​-‏‪-‮⁦-⁩]/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, max);

const base = (o: Partial<NormalizedRecord> & Pick<NormalizedRecord, "kind" | "name" | "passage" | "sourceUrl" | "contentKey">): NormalizedRecord => ({ externalId: null, website: null, aliases: [], criteria: [], announcement: null, investorName: null, publishedAt: null, parseStatus: "ok", notes: [], hostile: false, ...o });

// ------------------------------------------------------------------------------ funding news (RSS/Atom)

const INV = "[A-Z][A-Za-z0-9&.'’-]*(?:\\s+[A-Z][A-Za-z0-9&.'’-]*){0,3}";
const LIST = `(${INV}(?:\\s*(?:,|&|\\band\\b)\\s*${INV})*)`;
const LEAD = new RegExp(`\\b(?:co-led|led|lead(?:s)?)\\s+by\\s+${LIST}`);
const PART = new RegExp(`\\b(?:with\\s+participation\\s+from|participation\\s+from|backed\\s+by|investors\\s+(?:including|include)|joined\\s+by|alongside|also\\s+from)\\s+${LIST}`);

function splitNames(list: string): string[] {
	return list
		.split(/\s*(?:,|&|\band\b)\s*/)
		.map((n) => clean(n, 80).replace(/[.;:]+$/, ""))
		.filter((n) => n.length >= 2 && !/^(?:the|a|an|others|existing investors|angels?)$/i.test(n));
}

const SUBJECT = new RegExp(`^(?:\\w+\\s+){0,2}?${NAME}\\s+(?:raises|raised|announces|announced|secures|secured|closes|closed|lands|landed|completes|completed|bags|nabs)\\b`);
const POSSESSIVE = new RegExp(`${NAME}['’]s\\s+(?:\\$[\\d.,]+\\s?\\w*\\s+)?(?:[Ss]eed|[Ss]eries [A-E]|[Pp]re-?[Ss]eed)`);

export function parseAnnouncement(text: string): NormalizedAnnouncement | null {
	const m = SUBJECT.exec(text) ?? POSSESSIVE.exec(text);
	const company = m ? cleanCompanyName(m[m.length - 1]!, "") : null;
	if (!company) return null;
	const { type, round } = roundType(text);
	const amount = new RegExp(MONEY, "i").exec(text);
	const investors: NormalizedAnnouncement["investors"] = [];
	const add = (names: string[], role: "lead" | "participant") => {
		for (const n of names) if (!investors.some((i) => companyKey(i.name) === companyKey(n))) investors.push({ name: n, role });
	};
	const lead = LEAD.exec(text);
	if (lead) add(splitNames(lead[1]!), "lead");
	const part = PART.exec(text);
	if (part) add(splitNames(part[1]!), "participant");
	return { company, companyUrl: null, type, round, roundAmountUsd: amount ? toUsd(amount[1]!, amount[2]) : null, announcedAt: dateInText(text), investors };
}

export const fundingNewsFeed: SourceAdapter = {
	id: "funding_news_feed",
	formats: ["rss", "atom"],
	parse({ body, url }) {
		const feed = parseFeed(body);
		if (!feed.ok) return { records: [], errors: [{ index: 0, message: `malformed feed: ${feed.error}` }], format: "feed" };
		const records: NormalizedRecord[] = [];
		const errors: RecordError[] = [];
		feed.items.forEach((item, index) => {
			const text = [item.title, item.summary].filter(Boolean).join(". ");
			if (isHostile(text)) return void errors.push({ index, message: "instruction-like text discarded" });
			const sentence = [item.title, ...item.summary.split(/(?<=[.!?])\s+/)].map((t) => t.trim()).find((t) => parseAnnouncement(t)) ?? text;
			const a = parseAnnouncement(sentence) ?? parseAnnouncement(text);
			if (!a) return void errors.push({ index, message: "not a funding announcement" });
			// Investors may be named in the headline, the summary, or both: take the union, lead first.
			const lead = LEAD.exec(text);
			const part = PART.exec(text);
			if (lead) for (const n of splitNames(lead[1]!)) if (!a.investors.some((x) => companyKey(x.name) === companyKey(n))) a.investors.unshift({ name: n, role: "lead" });
			if (part) for (const n of splitNames(part[1]!)) if (!a.investors.some((x) => companyKey(x.name) === companyKey(n))) a.investors.push({ name: n, role: "participant" });
			records.push(
				base({
					kind: "investment_announcement",
					externalId: item.link,
					contentKey: sha256Hex(`${item.link ?? ""}|${item.title}`).slice(0, 24),
					name: a.company,
					announcement: { ...a, announcedAt: a.announcedAt },
					publishedAt: item.publishedAt,
					passage: clip(sentence, 420),
					sourceUrl: item.link ?? url,
					parseStatus: a.investors.length ? "ok" : "partial",
					notes: a.investors.length ? [] : ["no investors named; nothing to match"],
				}),
			);
		});
		return { records, errors, format: "feed" };
	},
};

// ------------------------------------------------------------------------------ datasets (CSV, JSON)

function terms(text: string, vocab: [string, RegExp][]): string[] {
	return vocab.filter(([, re]) => re.test(text)).map(([v]) => v);
}

const UNIT: Record<NonNullable<DatasetMapping["checkUnit"]>, number> = { usd: 1, thousands: 1e3, millions: 1e6 };

function checkRange(minRaw: string, maxRaw: string, unit: NonNullable<DatasetMapping["checkUnit"]>): { range: NormalizedCriterion["valueRange"]; note: string | null } {
	const num = (s: string) => {
		const n = Number(s.replace(/[$,\s]/g, ""));
		return s.trim() !== "" && Number.isFinite(n) && n >= 0 ? Math.round(n * UNIT[unit]) : null;
	};
	const min = num(minRaw);
	const max = num(maxRaw);
	if (minRaw.trim() && min === null) return { range: null, note: `check minimum "${clip(minRaw, 30)}" is not a number` };
	if (maxRaw.trim() && max === null) return { range: null, note: `check maximum "${clip(maxRaw, 30)}" is not a number` };
	if (min === null && max === null) return { range: null, note: null };
	if (min !== null && max !== null && min > max) return { range: null, note: "check minimum is above the maximum" };
	return { range: { minUsd: min, maxUsd: max }, note: null };
}

type Cells = (field: string | undefined) => string;

function buildDatasetRecord(cells: Cells, m: DatasetMapping, index: number, sourceUrl: string, rowText: string): NormalizedRecord | { error: string } {
	const name = clean(cells(m.nameField), 120);
	if (!name) return { error: `row ${index + 1} has no ${m.nameField}` };
	if (isHostile(rowText)) return { error: "instruction-like text discarded" };
	const notes: string[] = [];
	const delimiter = m.listDelimiter ?? ";";
	const split = (s: string) => s.split(delimiter).map((x) => x.trim()).filter(Boolean);
	let website: string | null = null;
	const rawSite = clean(cells(m.websiteField), 300);
	if (rawSite) {
		try {
			website = normalizeFirmUrl(rawSite).canonicalDomain;
		} catch {
			notes.push(`website "${clip(rawSite, 40)}" is not a usable domain`);
		}
	}
	const criteria: NormalizedCriterion[] = [];
	if (m.recordKind !== "portfolio_company") {
		for (const [field, vocab, cellName] of [["stage", STAGES, m.stageField], ["sector", SECTORS, m.sectorsField], ["geography", GEOGRAPHIES, m.geographyField]] as const) {
			const raw = cells(cellName);
			if (!raw) continue;
			for (const part of split(raw)) {
				const hit = terms(part, vocab);
				if (!hit.length) notes.push(`${field} "${clip(part, 30)}" is not a recognised term and was not recorded`);
				for (const v of hit) criteria.push({ field, polarity: "include", value: v, valueRange: null, label: v.replace(/_/g, " ") });
			}
		}
		const { range, note } = checkRange(cells(m.checkMinField), cells(m.checkMaxField), m.checkUnit ?? "usd");
		if (note) notes.push(note);
		if (range) criteria.push({ field: "check_size", polarity: "include", value: checkSizeValue(range), valueRange: range, label: checkSizeLabel(range) });
	}
	const externalId = clean(cells(m.idField), 120) || null;
	const updated = clean(cells(m.updatedField), 40);
	const publishedAt = updated && Number.isFinite(Date.parse(updated)) ? new Date(updated).toISOString() : null;
	const unique = new Map(criteria.map((c) => [`${c.field}|${c.value}`, c]));
	return base({
		kind: m.recordKind ?? "investor",
		externalId,
		contentKey: sha256Hex(`${externalId ?? ""}|${name.toLowerCase()}|${website ?? ""}`).slice(0, 24),
		name,
		website,
		criteria: [...unique.values()],
		investorName: m.recordKind === "portfolio_company" ? clean(cells(m.investorField), 120) || null : null,
		publishedAt,
		passage: clip(rowText, 420),
		sourceUrl,
		parseStatus: notes.length ? "partial" : "ok",
		notes,
	});
}

function validateMapping(m: DatasetMapping | null): string | null {
	if (!m || !m.nameField) return "the source has no mapping with a nameField";
	return null;
}

export const csvDataset: SourceAdapter = {
	id: "csv_dataset",
	formats: ["csv"],
	parse({ body, url, mapping }) {
		const bad = validateMapping(mapping);
		if (bad) return { records: [], errors: [{ index: 0, message: bad }], format: "csv" };
		const rows = parseCsv(body.replace(/^﻿/, ""));
		if (rows.length < 2) return { records: [], errors: [{ index: 0, message: "no data rows" }], format: "csv" };
		const header = rows[0]!.map((h) => h.trim());
		const col = (field: string | undefined) => (field ? header.indexOf(field) : -1);
		const m = mapping!;
		if (col(m.nameField) < 0) return { records: [], errors: [{ index: 0, message: `column "${m.nameField}" not found in the header` }], format: "csv" };
		const records: NormalizedRecord[] = [];
		const errors: RecordError[] = [];
		rows.slice(1, MAX_RECORDS_PER_DOCUMENT + 1).forEach((r, i) => {
			if (r.length > header.length + 2) return void errors.push({ index: i, message: `row ${i + 2} has ${r.length} cells for ${header.length} columns` });
			const cells: Cells = (f) => (col(f) >= 0 ? (r[col(f)] ?? "") : "");
			const rowText = header.map((h, k) => `${h}=${clean(r[k], 60)}`).filter((x) => !x.endsWith("=")).join("; ");
			const out = buildDatasetRecord(cells, m, i, url, rowText);
			if ("error" in out) errors.push({ index: i, message: out.error });
			else records.push(out);
		});
		return { records, errors, format: "csv" };
	},
};

function dig(obj: unknown, path: string | undefined): unknown {
	if (!path) return obj;
	let cur: unknown = obj;
	for (const key of path.split(".")) {
		if (!cur || typeof cur !== "object" || Array.isArray(cur) || !Object.prototype.hasOwnProperty.call(cur, key)) return undefined;
		cur = (cur as Record<string, unknown>)[key];
	}
	return cur;
}

export const jsonDataset: SourceAdapter = {
	id: "json_dataset",
	formats: ["json"],
	parse({ body, url, mapping }) {
		const bad = validateMapping(mapping);
		if (bad) return { records: [], errors: [{ index: 0, message: bad }], format: "json" };
		let doc: unknown;
		try {
			doc = JSON.parse(body.replace(/^﻿/, ""));
		} catch (error) {
			return { records: [], errors: [{ index: 0, message: `invalid JSON: ${(error as Error).message.slice(0, 80)}` }], format: "json" };
		}
		const list = dig(doc, mapping!.recordsPath);
		if (!Array.isArray(list)) return { records: [], errors: [{ index: 0, message: `no array at "${mapping!.recordsPath ?? ""}"` }], format: "json" };
		const records: NormalizedRecord[] = [];
		const errors: RecordError[] = [];
		list.slice(0, MAX_RECORDS_PER_DOCUMENT).forEach((item, i) => {
			if (!item || typeof item !== "object" || Array.isArray(item)) return void errors.push({ index: i, message: "record is not an object" });
			const cells: Cells = (f) => {
				const v = f ? dig(item, f) : undefined;
				return Array.isArray(v) ? v.map((x) => String(x)).join(mapping!.listDelimiter ?? ";") : typeof v === "object" || v === undefined || v === null ? "" : String(v);
			};
			const rowText = Object.entries(item as Record<string, unknown>).filter(([, v]) => typeof v !== "object").slice(0, 12).map(([k, v]) => `${clean(k, 30)}=${clean(v, 60)}`).join("; ");
			const out = buildDatasetRecord(cells, mapping!, i, url, rowText);
			if ("error" in out) errors.push({ index: i, message: out.error });
			else records.push(out);
		});
		return { records, errors, format: "json" };
	},
};

export const ADAPTERS: Record<AdapterId, SourceAdapter> = { funding_news_feed: fundingNewsFeed, csv_dataset: csvDataset, json_dataset: jsonDataset };

/** Which fetch mode an adapter needs. */
export const ADAPTER_FETCH: Record<AdapterId, "feed" | "data"> = { funding_news_feed: "feed", csv_dataset: "data", json_dataset: "data" };
