import { UrlError, normalizeFirmUrl } from "./url.ts";

/** Input files: CSV, JSON or newline-delimited text of VC firm URLs. */

export type FirmInput = { url: string; name?: string; notes?: string; line?: number };
export type PreparedFirm = { canonicalDomain: string; website: string; seedUrl: string; name?: string; notes: string[]; urls: string[]; lines: number[] };
export type ParseResult = { inputs: FirmInput[]; errors: { line: number; message: string; value: string }[] };

export const MAX_INPUT_BYTES = 5 * 1024 * 1024;
export const MAX_FIRMS = 5000;

export function parseCsv(text: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let cell = "";
	let quoted = false;
	for (let i = 0; i < text.length; i++) {
		const ch = text[i]!;
		if (quoted) {
			if (ch === '"' && text[i + 1] === '"') {
				cell += '"';
				i++;
			} else if (ch === '"') quoted = false;
			else cell += ch;
		} else if (ch === '"' && cell === "") quoted = true;
		else if (ch === ",") {
			row.push(cell);
			cell = "";
		} else if (ch === "\n" || ch === "\r") {
			if (ch === "\r" && text[i + 1] === "\n") i++;
			row.push(cell);
			cell = "";
			if (row.some((c) => c.trim() !== "")) rows.push(row);
			row = [];
		} else cell += ch;
	}
	row.push(cell);
	if (row.some((c) => c.trim() !== "")) rows.push(row);
	return rows;
}

const URL_HEADERS = ["url", "website", "site", "firm_url", "firm_website", "link", "domain"];
const NAME_HEADERS = ["name", "firm", "firm_name", "company"];
const NOTE_HEADERS = ["notes", "note", "source_notes", "source", "comments"];
const looksLikeUrl = (s: string) => /^(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$|\?|#)/i.test(s.trim());

function fromCsv(text: string): ParseResult {
	const rows = parseCsv(text.replace(/^﻿/, ""));
	const result: ParseResult = { inputs: [], errors: [] };
	if (!rows.length) return result;
	const head = rows[0]!.map((h) => h.trim().toLowerCase().replace(/[\s-]+/g, "_"));
	const hasHeader = head.some((h) => URL_HEADERS.includes(h));
	const col = (names: string[]) => head.findIndex((h) => names.includes(h));
	const urlCol = hasHeader ? col(URL_HEADERS) : 0;
	const nameCol = hasHeader ? col(NAME_HEADERS) : 1;
	const noteCol = hasHeader ? col(NOTE_HEADERS) : 2;
	if (!hasHeader && !looksLikeUrl(rows[0]![0] ?? "")) {
		result.errors.push({ line: 1, message: "CSV needs a header with a url (or website) column", value: (rows[0]![0] ?? "").slice(0, 80) });
		return result;
	}
	rows.slice(hasHeader ? 1 : 0).forEach((r, i) => {
		const line = i + (hasHeader ? 2 : 1);
		const url = (r[urlCol] ?? "").trim();
		if (!url) return void result.errors.push({ line, message: "Missing URL", value: "" });
		result.inputs.push({ url, name: nameCol >= 0 ? r[nameCol]?.trim() || undefined : undefined, notes: noteCol >= 0 ? r[noteCol]?.trim() || undefined : undefined, line });
	});
	return result;
}

function fromJson(text: string): ParseResult {
	const result: ParseResult = { inputs: [], errors: [] };
	let data: unknown;
	try {
		data = JSON.parse(text);
	} catch (error) {
		result.errors.push({ line: 1, message: `Invalid JSON: ${(error as Error).message}`, value: "" });
		return result;
	}
	const list = Array.isArray(data) ? data : data && typeof data === "object" && Array.isArray((data as { firms?: unknown }).firms) ? (data as { firms: unknown[] }).firms : null;
	if (!list) {
		result.errors.push({ line: 1, message: "JSON must be an array, or an object with a firms array", value: "" });
		return result;
	}
	list.forEach((item, i) => {
		const line = i + 1;
		if (typeof item === "string") return void result.inputs.push({ url: item, line });
		if (item && typeof item === "object") {
			const o = item as Record<string, unknown>;
			const url = [o.url, o.website, o.site].find((v) => typeof v === "string") as string | undefined;
			if (!url) return void result.errors.push({ line, message: "Entry has no url or website", value: JSON.stringify(item).slice(0, 80) });
			const notes = Array.isArray(o.notes) ? o.notes.filter((n) => typeof n === "string").join("; ") : typeof o.notes === "string" ? o.notes : typeof o.sourceNotes === "string" ? o.sourceNotes : undefined;
			return void result.inputs.push({ url, name: typeof o.name === "string" ? o.name.trim() || undefined : undefined, notes: notes?.trim() || undefined, line });
		}
		result.errors.push({ line, message: "Entry must be a string or object", value: String(item).slice(0, 80) });
	});
	return result;
}

function fromText(text: string): ParseResult {
	const result: ParseResult = { inputs: [], errors: [] };
	text.replace(/^﻿/, "").split(/\r?\n/).forEach((raw, i) => {
		const line = raw.trim();
		if (!line || line.startsWith("#")) return;
		if (/\s/.test(line)) return void result.errors.push({ line: i + 1, message: "One URL per line, no spaces", value: line.slice(0, 80) });
		result.inputs.push({ url: line, line: i + 1 });
	});
	return result;
}

export function parseInput(text: string, filename: string): ParseResult {
	if (Buffer.byteLength(text) > MAX_INPUT_BYTES) return { inputs: [], errors: [{ line: 0, message: `Input is larger than ${MAX_INPUT_BYTES} bytes`, value: "" }] };
	const lower = filename.toLowerCase();
	const trimmed = text.trimStart();
	const parsed = lower.endsWith(".json") || trimmed.startsWith("[") || trimmed.startsWith("{") ? fromJson(text) : lower.endsWith(".csv") ? fromCsv(text) : fromText(text);
	if (parsed.inputs.length > MAX_FIRMS) return { inputs: [], errors: [{ line: 0, message: `At most ${MAX_FIRMS} firms per file`, value: "" }] };
	return parsed;
}

export type Prepared = { firms: PreparedFirm[]; errors: ParseResult["errors"]; duplicatesCollapsed: number };

/** Normalises every URL and collapses entries for the same domain into one firm, keeping every name and note. */
export function prepareInputs(inputs: FirmInput[], priorErrors: ParseResult["errors"] = []): Prepared {
	const byDomain = new Map<string, PreparedFirm>();
	const errors = [...priorErrors];
	let duplicates = 0;
	for (const input of inputs) {
		let n: ReturnType<typeof normalizeFirmUrl>;
		try {
			n = normalizeFirmUrl(input.url);
		} catch (error) {
			errors.push({ line: input.line ?? 0, message: error instanceof UrlError ? error.message : "Invalid URL", value: input.url.slice(0, 80) });
			continue;
		}
		const name = input.name?.replace(/\s+/g, " ").trim().slice(0, 120) || undefined;
		const note = input.notes?.replace(/\s+/g, " ").trim().slice(0, 500) || undefined;
		const existing = byDomain.get(n.canonicalDomain);
		if (!existing) {
			byDomain.set(n.canonicalDomain, { canonicalDomain: n.canonicalDomain, website: n.website, seedUrl: n.seedUrl, name, notes: note ? [note] : [], urls: [input.url.trim()], lines: input.line ? [input.line] : [] });
			continue;
		}
		duplicates++;
		existing.urls.push(input.url.trim());
		if (input.line) existing.lines.push(input.line);
		if (name && !existing.name) existing.name = name;
		else if (name && name !== existing.name) existing.notes.push(`alternate name: ${name}`);
		if (note && !existing.notes.includes(note)) existing.notes.push(note);
	}
	return { firms: [...byDomain.values()], errors, duplicatesCollapsed: duplicates };
}
