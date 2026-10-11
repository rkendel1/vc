import { type FormEvent, useRef, useState } from "react";
import { SOURCE_TYPES, type DocumentRecord } from "../../../../invest/domain/types.ts";
import { call, fileToBase64 } from "../api.ts";
import { Badge, ConfirmButton, ErrorNote, Notice, useAction, useCan, when } from "../ui.tsx";
import { plural } from "../format.ts";

export const SOURCE_LABEL: Record<(typeof SOURCE_TYPES)[number], string> = {
	founder_deck: "Pitch deck (written by the company)",
	founder_financials: "Financials (prepared by the company)",
	founder_other: "Other company material",
	third_party_report: "Third-party report",
	customer_reference: "Customer reference",
	bank_statement: "Bank statement",
	audited_financials: "Audited financials",
	data_room_other: "Other data-room file",
};
const FROM_THIRD_PARTY = new Set(["third_party_report", "customer_reference", "bank_statement", "audited_financials"]);

const STATUS: Record<string, { label: string; tone: "ok" | "caution" | "bad" | "neutral"; help: string }> = {
	processing: { label: "Reading", tone: "neutral", help: "The file is being read." },
	ingested: { label: "Read", tone: "ok", help: "The whole file was read and its statements extracted." },
	partial: { label: "Partly read", tone: "caution", help: "Only some pages could be read. Statements from those pages are used." },
	failed: { label: "Could not be read", tone: "bad", help: "The file could not be read. Nothing from it is used as evidence." },
	rejected: { label: "Not accepted", tone: "bad", help: "The file was refused. Nothing from it is used as evidence." },
};

/** What happened to an upload, in the person's terms: what was read, what was not, and what to do next. */
export function describeUpload(doc: DocumentRecord, duplicate: boolean): { kind: "success" | "warn" | "error"; title: string; detail: string } {
	if (duplicate) return { kind: "success", title: `${doc.filename} was already uploaded`, detail: "The same file is already on record, so nothing was duplicated." };
	if (doc.ingestionStatus === "ingested") return doc.claimCount === 0 ? { kind: "warn", title: `${doc.filename} was read, but no statements could be extracted`, detail: "The file may be a scan or contain mostly images. Upload a text-based PDF, or enter the figures in your profile." } : { kind: "success", title: `${doc.filename} was read`, detail: `${plural(doc.pageCount, "page")} read, ${plural(doc.claimCount, "statement")} extracted. They are provided by you until an independent source agrees.` };
	if (doc.ingestionStatus === "partial") return { kind: "warn", title: `${doc.filename} was only partly read`, detail: doc.ingestionIssues.join("; ") || "Some pages could not be read." };
	const empty = doc.pagesWithText === 0 && doc.pageCount > 0;
	return { kind: "error", title: `${doc.filename} could not be used`, detail: `${doc.ingestionIssues.join("; ") || (empty ? "It has no readable text." : "It was not accepted.")} Nothing from it is used as evidence. Upload a text-based PDF.` };
}

/**
 * Upload, replace and remove documents. Replacing keeps the old document and its evidence for every evaluation that cited it; "Delete original"
 * removes only the stored file, never the extracted statements or hashes, so a past evaluation can always be reconstructed.
 */
export type DocumentRow = DocumentRecord & { supersededBy?: string | null };
export function DocumentsPanel({ startupId, documents, onChanged, audience }: { startupId: string; documents: DocumentRow[]; onChanged: () => void; audience: "founder" | "fund" }) {
	const canUpload = useCan("document.write");
	const upload = useAction();
	const act = useAction();
	const fileRef = useRef<HTMLInputElement>(null);
	const [sourceType, setSourceType] = useState<(typeof SOURCE_TYPES)[number]>("founder_deck");
	const [supersedes, setSupersedes] = useState("");
	const [last, setLast] = useState<ReturnType<typeof describeUpload> | null>(null);
	const [fileError, setFileError] = useState<string | null>(null);

	const submit = async (e: FormEvent) => {
		e.preventDefault();
		setLast(null);
		const file = fileRef.current?.files?.[0];
		if (!file) return setFileError("Choose a PDF file first.");
		if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") return setFileError(`${file.name} is not a PDF. Only PDF files can be read.`);
		if (file.size === 0) return setFileError(`${file.name} is empty.`);
		setFileError(null);
		const before = new Set(documents.map((d) => d.id));
		const doc = await upload.run(async () => (await call<{ document: DocumentRecord }>("document.upload", { startupId, filename: file.name, mediaType: file.type || "application/pdf", sourceType, contentBase64: await fileToBase64(file), ...(supersedes ? { supersedesDocumentId: supersedes } : {}) })).document);
		if (doc) {
			setLast(describeUpload(doc, before.has(doc.id)));
			if (fileRef.current) fileRef.current.value = "";
			setSupersedes("");
			onChanged();
		}
	};
	const open = async (documentId: string) => {
		const r = await act.run(() => call<{ url: string }>("document.link", { documentId }));
		if (r) window.open(r.url, "_blank", "noopener,noreferrer");
	};
	const replaceable = documents.filter((d) => !d.supersededBy && d.ingestionStatus !== "rejected");
	return (
		<div className="stack" data-testid="documents">
			{canUpload ? (
				<form className="row bottom" onSubmit={submit} noValidate>
					<label className="field">
						PDF file
						<input ref={fileRef} type="file" accept="application/pdf,.pdf" aria-describedby={fileError ? "file-error" : undefined} aria-invalid={fileError ? true : undefined} />
					</label>
					<label className="field">
						What it is
						<select value={sourceType} onChange={(e) => setSourceType(e.target.value as typeof sourceType)}>
							{SOURCE_TYPES.map((s) => (
								<option key={s} value={s}>
									{SOURCE_LABEL[s]}
								</option>
							))}
						</select>
					</label>
					<label className="field">
						Replaces
						<select value={supersedes} onChange={(e) => setSupersedes(e.target.value)}>
							<option value="">Nothing (a new document)</option>
							{replaceable.map((d) => (
								<option key={d.id} value={d.id}>
									{d.filename}
								</option>
							))}
						</select>
					</label>
					<button className="primary" disabled={upload.busy}>
						{upload.busy ? "Reading…" : "Upload"}
					</button>
				</form>
			) : null}
			{canUpload && audience === "founder" && FROM_THIRD_PARTY.has(sourceType) ? <Notice kind="warn">Choose a third-party type only for a document you did not write, such as an auditor's report or a customer's letter. It is then treated as an independent source, and reviewers can see the type you chose.</Notice> : null}
			{fileError ? (
				<div className="notice error" role="alert" id="file-error">
					{fileError}
				</div>
			) : null}
			<ErrorNote error={upload.error} />
			{last ? (
				<Notice kind={last.kind === "error" ? "error" : last.kind === "warn" ? "warn" : "success"} title={last.title}>
					{last.detail}
				</Notice>
			) : null}
			<ErrorNote error={act.error} />
			{documents.length ? (
				<div className="table-wrap">
					<table className="list">
						<caption className="visually-hidden">Uploaded documents</caption>
						<thead>
							<tr>
								<th scope="col">File</th>
								<th scope="col">What it is</th>
								<th scope="col">Status</th>
								<th scope="col">Statements</th>
								<th scope="col">Uploaded</th>
								<th scope="col">
									<span className="visually-hidden">Actions</span>
								</th>
							</tr>
						</thead>
						<tbody>
							{documents.map((d) => {
								const s = STATUS[d.ingestionStatus] ?? STATUS.failed!;
								return (
									<tr key={d.id}>
										<td>
											{d.filename}
											{d.supersededBy ? <div className="muted small">Replaced by a newer upload. Its statements stay on record for earlier evaluations.</div> : null}
											{d.purgedAt ? <div className="muted small">Original file deleted {when(d.purgedAt)}. Extracted statements are kept.</div> : null}
											{d.ingestionIssues.length ? <div className="small">{d.ingestionIssues.join("; ")}</div> : null}
										</td>
										<td>{SOURCE_LABEL[d.sourceType]}</td>
										<td>
											<Badge tone={s.tone}>{s.label}</Badge>
										</td>
										<td>{d.ingestionStatus === "rejected" || d.ingestionStatus === "failed" ? "None used" : `${d.claimCount} from ${d.pagesWithText} of ${d.pageCount} pages`}</td>
										<td className="muted nowrap">{when(d.uploadedAt)}</td>
										<td className="nowrap">
											{d.storageRef && !d.purgedAt ? (
												<button type="button" className="quiet" onClick={() => open(d.id)}>
													Open original
												</button>
											) : null}
											{canUpload && d.storageRef && !d.purgedAt ? <DeleteOriginal d={d} onDone={onChanged} /> : null}
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>
			) : (
				<p className="empty">No documents yet. Upload a pitch deck, financials or a third-party report as a PDF. Statements are extracted from the text and shown as provided by you until an independent source agrees.</p>
			)}
		</div>
	);
}

function DeleteOriginal({ d, onDone }: { d: DocumentRecord; onDone: () => void }) {
	const [reason, setReason] = useState("");
	const a = useAction();
	return (
		<ConfirmButton
			label="Delete original"
			className="quiet danger"
			title={`Delete the original of ${d.filename}?`}
			confirmLabel="Delete the original file"
			danger
			consequence={<p>The stored PDF is removed and cannot be opened again. The statements read from it, and their hashes, are kept, so any evaluation that used them can still be reconstructed.</p>}
			onConfirm={async () => {
				if (reason.trim().length < 3) return;
				if (await a.run(() => call("document.purge", { documentId: d.id, reason: reason.trim() }))) onDone();
			}}
		>
			<label className="field">
				Why (recorded in the history)
				<input value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} />
			</label>
			<ErrorNote error={a.error} />
		</ConfirmButton>
	);
}
