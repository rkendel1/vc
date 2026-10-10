import { sha256Hex } from "../domain/canonical.ts";
import { invalid, notFound, precondition } from "../domain/errors.ts";
import {
	SOURCE_TYPES,
	provenanceOf,
	type Actor,
	type DocumentPage,
	type DocumentRecord,
	type EvidenceItem,
	type IngestionStatus,
	type SourceType,
	type Startup,
} from "../domain/types.ts";
import type { DocumentStorage } from "../ingestion/document-storage.ts";
import { PARSER, PdfRejectedError, checkPdfSignature, parsePdf, type ParsedPdf } from "../ingestion/pdf-parser.ts";
import { C, type InvestStore, type StoreWrite } from "../store/store.ts";
import { EXTRACTOR_VERSION, extractClaims } from "./claim-extraction.ts";

export type IngestionLimits = { maxBytes: number; allowedTypes: string[]; maxPages: number; parseTimeoutMs: number };

export type UploadInput = {
	startupId: string;
	filename: string;
	mediaType: string;
	sourceType: SourceType;
	bytes: Uint8Array;
	supersedesDocumentId?: string;
};

const MAX_CLAIMS_PER_DOCUMENT = 2000;

/**
 * Upload, validate, parse and extract. Every outcome is recorded honestly: a rejected or failed
 * file becomes a document record that says so, with no evidence; a partially readable file is
 * `partial` and lists what was not read. Nothing is reported as complete that was not.
 */
export class DocumentIngestionModule {
	constructor(
		private readonly store: InvestStore,
		private readonly storage: DocumentStorage,
		private readonly limits: IngestionLimits,
	) {}

	async upload(actor: Actor, input: UploadInput): Promise<DocumentRecord> {
		const startup = await this.store.get<Startup>(C.startups, input.startupId, actor.workspaceId);
		if (!startup) throw notFound("Startup");
		const filename = (input.filename ?? "").replace(/[\\/\u0000-\u001F]/g, "_").trim().slice(0, 200);
		if (!filename) throw invalid("A file name is required");
		if (!SOURCE_TYPES.includes(input.sourceType)) throw invalid(`Source type must be one of ${SOURCE_TYPES.join(", ")}`);
		if (input.bytes.byteLength === 0) throw invalid("The file is empty");
		if (input.bytes.byteLength > this.limits.maxBytes) throw invalid(`The file exceeds the ${this.limits.maxBytes}-byte limit`);
		if (input.supersedesDocumentId) {
			const prior = await this.store.get<DocumentRecord>(C.documents, input.supersedesDocumentId, actor.workspaceId);
			if (!prior || prior.startupId !== startup.id) throw notFound("Superseded document");
		}

		const contentHash = sha256Hex(input.bytes);
		const id = `doc_${sha256Hex(`${actor.workspaceId}|${startup.id}|${contentHash}`).slice(0, 24)}`;
		const existing = await this.store.get<DocumentRecord>(C.documents, id, actor.workspaceId);
		if (existing && !existing.purgedAt) return existing; // the same bytes for the same startup: idempotent
		const documentId = existing ? `${id}_${Date.now().toString(36)}` : id;

		const mediaType = (input.mediaType ?? "").toLowerCase().split(";")[0].trim();
		const base: Omit<DocumentRecord, "ingestionStatus" | "ingestionIssues" | "pageCount" | "pagesWithText" | "claimCount" | "storageRef"> = {
			id: documentId,
			workspaceId: actor.workspaceId,
			startupId: startup.id,
			filename,
			mediaType,
			sizeBytes: input.bytes.byteLength,
			contentHash,
			sourceType: input.sourceType,
			parser: PARSER,
			extractorVersion: EXTRACTOR_VERSION,
			supersedesDocumentId: input.supersedesDocumentId ?? null,
			uploadedBy: actor.principalId,
			uploadedAt: this.store.now(),
			purgedAt: null,
			purgedBy: null,
		};

		// 1. Declared type, extension and file signature must all agree before a parser sees the bytes.
		const rejection = !this.limits.allowedTypes.includes(mediaType)
			? `Media type "${mediaType || "unknown"}" is not accepted (allowed: ${this.limits.allowedTypes.join(", ")})`
			: !filename.toLowerCase().endsWith(".pdf")
				? "Only .pdf files are accepted"
				: checkPdfSignature(input.bytes);
		if (rejection) return this.record(actor, { ...base, storageRef: null, ingestionStatus: "rejected", ingestionIssues: [rejection], pageCount: 0, pagesWithText: 0, claimCount: 0 }, [], []);

		// 2. Parse. A structurally invalid or encrypted PDF is a failed ingestion, not an exception.
		let parsed: ParsedPdf;
		try {
			parsed = await parsePdf(input.bytes, { maxPages: this.limits.maxPages, timeoutMs: this.limits.parseTimeoutMs });
		} catch (error) {
			const message = error instanceof PdfRejectedError ? error.message : `Parser error: ${(error as Error)?.message ?? "unknown"}`;
			return this.record(actor, { ...base, storageRef: null, ingestionStatus: "failed", ingestionIssues: [message], pageCount: 0, pagesWithText: 0, claimCount: 0 }, [], []);
		}

		// 3. Extract claims with page and line coordinates.
		const storageRef = await this.storage.put(actor.workspaceId, contentHash, input.bytes);
		const issues = [...parsed.issues];
		const pages: DocumentPage[] = [];
		const evidence: EvidenceItem[] = [];
		const provenance = provenanceOf(input.sourceType);
		let pagesWithText = 0;
		for (const page of parsed.pages) {
			pages.push({ id: `${documentId}_p${page.page}`, workspaceId: actor.workspaceId, documentId, page: page.page, width: page.width, height: page.height, lines: page.lines });
			if (page.error) continue;
			if (page.lines.length === 0) {
				issues.push(`Page ${page.page} has no extractable text (scanned or image-only; OCR is not supported)`);
				continue;
			}
			pagesWithText++;
			const claims = extractClaims(page.lines);
			claims.forEach((claim, ci) => {
				const variants = claim.metrics.length ? claim.metrics : [null];
				variants.forEach((metric, mi) => {
					if (evidence.length >= MAX_CLAIMS_PER_DOCUMENT) return;
					evidence.push({
						id: `ev_${documentId.slice(4)}_${page.page}_${ci}_${mi}`,
						workspaceId: actor.workspaceId,
						startupId: startup.id,
						documentId,
						sourceLocation: { kind: "document", documentId, documentHash: contentHash, page: page.page, line: claim.line, bbox: claim.bbox, quote: claim.text },
						claim: claim.text,
						metric,
						topics: claim.topics,
						provenance: { class: provenance, sourceType: input.sourceType, extractor: EXTRACTOR_VERSION, recordedBy: actor.principalId },
						verificationStatus: "unverified",
						createdAt: base.uploadedAt,
					});
				});
			});
		}
		if (evidence.length >= MAX_CLAIMS_PER_DOCUMENT) issues.push(`Claim extraction stopped at ${MAX_CLAIMS_PER_DOCUMENT} claims`);

		let status: IngestionStatus;
		if (pagesWithText === 0) {
			status = "failed";
			issues.unshift("No extractable text in this PDF; no evidence was recorded");
		} else status = issues.length ? "partial" : "ingested";

		return this.record(
			actor,
			{ ...base, storageRef, ingestionStatus: status, ingestionIssues: issues, pageCount: parsed.pageCount, pagesWithText, claimCount: evidence.length },
			pages,
			evidence,
		);
	}

	private async record(actor: Actor, document: DocumentRecord, pages: DocumentPage[], evidence: EvidenceItem[]): Promise<DocumentRecord> {
		const writes: StoreWrite[] = [
			{ collection: C.documents, id: document.id, value: document, create: true },
			...pages.map((p) => ({ collection: C.documentPages, id: p.id, value: p, create: true })),
			...evidence.map((e) => ({ collection: C.evidence, id: e.id, value: e, create: true })),
		];
		await this.store.commit(actor, {
			writes,
			audit: [
				{
					eventType: `document.${document.ingestionStatus}`,
					entityRef: { type: "document", id: document.id },
					payload: {
						startupId: document.startupId,
						filename: document.filename,
						contentHash: document.contentHash,
						sourceType: document.sourceType,
						claims: evidence.length,
						issues: document.ingestionIssues,
						supersedes: document.supersedesDocumentId,
					},
				},
			],
		});
		return (await this.store.get<DocumentRecord>(C.documents, document.id, actor.workspaceId)) as DocumentRecord;
	}

	async list(actor: Actor, startupId: string): Promise<(DocumentRecord & { supersededBy: string | null })[]> {
		const docs = await this.store.list<DocumentRecord>(C.documents, actor.workspaceId, { startupId });
		return docs
			.map((d) => ({ ...d, supersededBy: docs.find((o) => o.supersedesDocumentId === d.id && o.ingestionStatus !== "rejected")?.id ?? null }))
			.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
	}

	async get(actor: Actor, documentId: string): Promise<DocumentRecord> {
		const doc = await this.store.get<DocumentRecord>(C.documents, documentId, actor.workspaceId);
		if (!doc) throw notFound("Document");
		return doc;
	}

	/** The page a source reference points into, for the evidence viewer. */
	async page(actor: Actor, documentId: string, page: number): Promise<DocumentPage> {
		await this.get(actor, documentId);
		const p = await this.store.get<DocumentPage>(C.documentPages, `${documentId}_p${page}`, actor.workspaceId);
		if (!p) throw notFound("Page");
		return p;
	}

	async accessLink(actor: Actor, documentId: string): Promise<{ url: string; expiresAt: string }> {
		const doc = await this.get(actor, documentId);
		if (!doc.storageRef || doc.purgedAt) throw precondition("The original file is not stored (rejected or purged)");
		const { token, expiresAt } = this.storage.signLink({ workspaceId: actor.workspaceId, documentId: doc.id, storageRef: doc.storageRef });
		return { url: `/files/${token}`, expiresAt };
	}

	/**
	 * Retention control: removes the original bytes and the extracted page text. Evidence claims
	 * and hashes stay, because past evaluations cite them; the purge itself is audited.
	 */
	async purge(actor: Actor, input: { documentId: string; reason: string }): Promise<DocumentRecord> {
		const doc = await this.get(actor, input.documentId);
		if (doc.purgedAt) return doc;
		if (!input.reason?.trim()) throw invalid("A reason is required to purge a document");
		const pages = await this.store.list<DocumentPage>(C.documentPages, actor.workspaceId, { documentId: doc.id });
		const now = this.store.now();
		await this.store.commit(actor, {
			writes: [
				{ collection: C.documents, id: doc.id, value: { ...doc, storageRef: null, purgedAt: now, purgedBy: actor.principalId }, ifVersion: doc.__version },
				...pages.map((p) => ({ collection: C.documentPages, id: p.id, value: { ...p, lines: [], purged: true } })),
			],
			audit: [{ eventType: "document.purged", entityRef: { type: "document", id: doc.id }, payload: { reason: input.reason.trim(), contentHash: doc.contentHash } }],
		});
		if (doc.storageRef) {
			const others = await this.store.list<DocumentRecord>(C.documents, actor.workspaceId);
			if (!others.some((o) => o.id !== doc.id && o.storageRef === doc.storageRef)) await this.storage.remove(actor.workspaceId, doc.storageRef);
		}
		return this.get(actor, doc.id);
	}
}
