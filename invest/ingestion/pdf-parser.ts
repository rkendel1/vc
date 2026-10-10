import { getDocument, version as pdfjsVersion } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PageLine } from "../domain/types.ts";

/**
 * PDF text and coordinates via pdfjs-dist, configured as a pure parser: no script evaluation,
 * no font loading, no XFA, no network fetches, no rendering. The bytes are only ever parsed;
 * nothing in a document is executed or followed.
 */
export const PARSER = { name: "pdfjs-dist", version: pdfjsVersion as string };

export type ParsedPage = { page: number; width: number; height: number; lines: PageLine[]; error: string | null };
export type ParsedPdf = { pageCount: number; pages: ParsedPage[]; issues: string[] };

export class PdfRejectedError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "PdfRejectedError";
	}
}

/** Structural signature checks done before any parser sees the bytes. */
export function checkPdfSignature(bytes: Uint8Array): string | null {
	if (bytes.byteLength < 64) return "File is too small to be a PDF";
	const head = Buffer.from(bytes.subarray(0, Math.min(1024, bytes.byteLength))).toString("latin1");
	if (!head.includes("%PDF-")) return "File does not have a PDF signature (%PDF-)";
	const tail = Buffer.from(bytes.subarray(Math.max(0, bytes.byteLength - 2048))).toString("latin1");
	if (!tail.includes("%%EOF")) return "PDF is truncated (no end-of-file marker)";
	return null;
}

type TextItem = { str: string; transform: number[]; width: number; height: number };

function linesOf(items: TextItem[], pageHeight: number): PageLine[] {
	const usable = items.filter((i) => typeof i.str === "string" && i.str.trim() && Array.isArray(i.transform));
	const rows: { y: number; h: number; parts: TextItem[] }[] = [];
	for (const item of usable) {
		const y = item.transform[5];
		const h = Math.max(item.height || Math.abs(item.transform[3]) || 10, 1);
		const row = rows.find((r) => Math.abs(r.y - y) <= Math.max(r.h, h) * 0.5);
		if (row) row.parts.push(item);
		else rows.push({ y, h, parts: [item] });
	}
	return rows
		.map((row) => {
			const parts = row.parts.sort((a, b) => a.transform[4] - b.transform[4]);
			const x = parts[0].transform[4];
			const last = parts[parts.length - 1];
			const text = parts
				.map((p) => p.str)
				.join(" ")
				.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "")
				.replace(/\s+/g, " ")
				.trim();
			return { text, x, y: pageHeight - (row.y + row.h), width: last.transform[4] + last.width - x, height: row.h };
		})
		.filter((l) => l.text)
		.sort((a, b) => a.y - b.y || a.x - b.x);
}

function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout: () => void): Promise<T> {
	let timer: ReturnType<typeof setTimeout>;
	return Promise.race([
		promise.finally(() => clearTimeout(timer)),
		new Promise<T>((_, reject) => {
			timer = setTimeout(() => {
				onTimeout();
				reject(new Error(`PDF parsing exceeded ${ms}ms`));
			}, ms);
		}),
	]);
}

export async function parsePdf(bytes: Uint8Array, options: { maxPages: number; timeoutMs: number }): Promise<ParsedPdf> {
	const task = getDocument({
		data: new Uint8Array(bytes), // pdfjs may transfer the buffer; never hand it the caller's copy
		isEvalSupported: false,
		disableFontFace: true,
		useSystemFonts: false,
		enableXfa: false,
		stopAtErrors: false,
		disableAutoFetch: true,
		disableStream: true,
		isOffscreenCanvasSupported: false,
		verbosity: 0,
	});
	let doc: Awaited<typeof task.promise>;
	try {
		doc = await withTimeout(task.promise, options.timeoutMs, () => void task.destroy());
	} catch (error) {
		const name = (error as { name?: string })?.name;
		if (name === "PasswordException") throw new PdfRejectedError("PDF is password-protected");
		if (name === "InvalidPDFException") throw new PdfRejectedError("PDF structure is invalid");
		throw new PdfRejectedError(`PDF could not be opened: ${(error as Error)?.message ?? "unknown error"}`);
	}
	const issues: string[] = [];
	const pageCount = doc.numPages;
	const limit = Math.min(pageCount, options.maxPages);
	if (pageCount > options.maxPages) issues.push(`Only the first ${options.maxPages} of ${pageCount} pages were processed`);
	const pages: ParsedPage[] = [];
	const deadline = Date.now() + options.timeoutMs;
	try {
		for (let n = 1; n <= limit; n++) {
			if (Date.now() > deadline) {
				issues.push(`Parsing stopped at page ${n} after the time limit; later pages were not processed`);
				break;
			}
			try {
				const page = await doc.getPage(n);
				const viewport = page.getViewport({ scale: 1 });
				const content = await page.getTextContent();
				const lines = linesOf(content.items as TextItem[], viewport.height);
				pages.push({ page: n, width: viewport.width, height: viewport.height, lines, error: null });
				page.cleanup();
			} catch (error) {
				pages.push({ page: n, width: 0, height: 0, lines: [], error: (error as Error)?.message ?? "page could not be read" });
				issues.push(`Page ${n} could not be read`);
			}
		}
	} finally {
		await doc.destroy();
	}
	return { pageCount, pages, issues };
}
