import { type FormEvent, useMemo, useRef, useState } from "react";
import { METRIC_KEYS, SOURCE_TYPES, type Contradiction, type DocumentRecord, type EvidenceView, type InvestmentDecision, type InvestmentThesis, type Startup, type ThesisVersion } from "../../../../invest/domain/types.ts";
import type { EvaluationListItem } from "../../../../invest/domain/views.ts";
import { call, fileToBase64, requestKey } from "../api.ts";
import { CoverageBar, ErrorNote, Loading, PageHead, Provenance, Section, Status, Verification, href, metricUnit, money, navigate, useAction, useCan, useLoad, when } from "../ui.tsx";

const SOURCE_LABEL: Record<(typeof SOURCE_TYPES)[number], string> = {
	founder_deck: "Founder pitch deck",
	founder_financials: "Founder financials",
	founder_other: "Other founder material",
	third_party_report: "Third-party report",
	customer_reference: "Customer reference",
	bank_statement: "Bank statement",
	audited_financials: "Audited financials",
	data_room_other: "Other data-room file",
};

type ProfileInput = { name: string; website: string; stage: string; sector: string; description: string; founderClaims: string };
const toInput = (s?: Startup): ProfileInput => ({
	name: s?.name ?? "",
	website: s?.website ?? "",
	stage: s?.stage ?? "",
	sector: s?.sector ?? "",
	description: s?.description ?? "",
	founderClaims: (s?.founderClaims ?? []).join("\n"),
});
const fromInput = (p: ProfileInput) => ({ ...p, founderClaims: p.founderClaims.split("\n").map((l) => l.trim()).filter(Boolean) });

function ProfileForm({ initial, submitLabel, busy, onSubmit }: { initial: ProfileInput; submitLabel: string; busy: boolean; onSubmit: (p: ProfileInput) => void }) {
	const [p, setP] = useState(initial);
	const set = (k: keyof ProfileInput) => (e: { target: { value: string } }) => setP({ ...p, [k]: e.target.value });
	return (
		<form
			className="stack"
			onSubmit={(e: FormEvent) => {
				e.preventDefault();
				onSubmit(p);
			}}
		>
			<div className="form-grid">
				<label className="field">
					Company name
					<input value={p.name} onChange={set("name")} required maxLength={120} />
				</label>
				<label className="field">
					Website
					<input value={p.website} onChange={set("website")} placeholder="https://" />
				</label>
				<label className="field">
					Stage
					<input value={p.stage} onChange={set("stage")} placeholder="Seed" />
				</label>
				<label className="field">
					Sector
					<input value={p.sector} onChange={set("sector")} />
				</label>
				<label className="field wide">
					Description
					<textarea value={p.description} onChange={set("description")} rows={2} />
				</label>
				<label className="field wide">
					What the founders say, one claim per line
					<textarea value={p.founderClaims} onChange={set("founderClaims")} rows={3} placeholder="We have 40 paying customers" />
					<span className="hint">Recorded as founder-reported evidence, never as confirmed fact.</span>
				</label>
			</div>
			<div>
				<button className="primary" disabled={busy || !p.name.trim()}>
					{submitLabel}
				</button>
			</div>
		</form>
	);
}

export function StartupsScreen() {
	const canWrite = useCan("startup.write");
	const { data, error, loading } = useLoad(() => call<{ items: Startup[] }>("startup.list", {}).then((r) => r.items), []);
	const action = useAction();
	return (
		<>
			<PageHead title="Startups" sub="Company profiles, their documents and the evidence extracted from them." />
			{loading && !data ? <Loading what="startups" /> : <ErrorNote error={error} />}
			{data?.length ? (
				<table className="list">
					<thead>
						<tr>
							<th>Company</th>
							<th>Stage</th>
							<th>Sector</th>
							<th>Updated</th>
						</tr>
					</thead>
					<tbody>
						{data.map((s) => (
							<tr key={s.id} className="clickable" onClick={() => navigate("startups", s.id)}>
								<td>
									<a className="serif" href={href("startups", s.id)} onClick={(e) => e.stopPropagation()}>
										{s.name}
									</a>
								</td>
								<td>{s.stage || <span className="muted">—</span>}</td>
								<td>{s.sector || <span className="muted">—</span>}</td>
								<td className="muted">{when(s.updatedAt)}</td>
							</tr>
						))}
					</tbody>
				</table>
			) : data ? (
				<p className="empty">No startups yet. Add the first company you are evaluating.</p>
			) : null}
			{canWrite ? (
				<Section title="Add a startup">
					<ErrorNote error={action.error} />
					<ProfileForm
						initial={toInput()}
						submitLabel="Add startup"
						busy={action.busy}
						onSubmit={async (p) => {
							const r = await action.run(() => call<{ startup: Startup }>("startup.create", fromInput(p)));
							if (r) navigate("startups", r.startup.id);
						}}
					/>
				</Section>
			) : null}
		</>
	);
}

// ---------------------------------------------------------------------------

type Workspace = {
	startup: Startup;
	documents: (DocumentRecord & { supersededBy: string | null })[];
	evidence: EvidenceView[];
	contradictions: Contradiction[];
	gaps: { criterionId: string; criterionName: string; missing: string[] }[] | null;
	gapsAgainst: { id: string; version: number; thesisId: string } | null;
	evaluations: EvaluationListItem[];
	decisions: InvestmentDecision[];
};

type VersionOption = { id: string; label: string };

function useVersionOptions() {
	return useLoad(async () => {
		const { items } = await call<{ items: InvestmentThesis[] }>("thesis.list", {});
		const out: VersionOption[] = [];
		for (const t of items.filter((x) => x.versionCount > 0)) {
			const { versions } = await call<{ versions: ThesisVersion[] }>("thesis.get", { thesisId: t.id });
			for (const v of versions) out.push({ id: v.id, label: `${t.name}, version ${v.version}${v.id === t.currentVersionId ? " (in force)" : ""}` });
		}
		return out;
	}, []);
}

function location(e: EvidenceView, docs: Map<string, DocumentRecord>): string {
	const l = e.sourceLocation;
	if (l.kind === "document") return `${docs.get(l.documentId)?.filename ?? "document"}, p. ${l.page}`;
	if (l.kind === "profile") return "Startup profile";
	return `Reviewer: ${l.reference}`;
}

export function StartupScreen({ startupId }: { startupId: string }) {
	const canUpload = useCan("document.write");
	const canEdit = useCan("startup.write");
	const canAttach = useCan("evidence.write");
	const canRun = useCan("evaluation.run");
	const versions = useVersionOptions();
	const [gapVersion, setGapVersion] = useState<string>("");
	const { data, error, loading, reload } = useLoad(() => call<{ workspace: Workspace }>("startup.get", gapVersion ? { startupId, thesisVersionId: gapVersion } : { startupId }).then((r) => r.workspace), [startupId, gapVersion], {
		pollMs: (d) => (d?.evaluations.some((e) => e.status === "running") ? 2000 : null),
	});
	const [editing, setEditing] = useState(false);
	const [filter, setFilter] = useState<"all" | "metrics" | "conflicts" | "founder">("all");
	const [showSuperseded, setShowSuperseded] = useState(false);
	const profile = useAction();
	const upload = useAction();
	const attach = useAction();
	const evaluate = useAction();
	const docAction = useAction();
	const fileRef = useRef<HTMLInputElement>(null);
	const [sourceType, setSourceType] = useState<(typeof SOURCE_TYPES)[number]>("founder_deck");
	const [supersedes, setSupersedes] = useState("");
	const [lastUpload, setLastUpload] = useState<DocumentRecord | null>(null);
	const [runVersion, setRunVersion] = useState("");
	const [attachForm, setAttachForm] = useState({ claim: "", reference: "", metric: "", value: "" });

	const docs = useMemo(() => new Map((data?.documents ?? []).map((d) => [d.id, d])), [data]);
	const evidence = useMemo(() => {
		const all = (data?.evidence ?? []).filter((e) => showSuperseded || !e.superseded);
		if (filter === "metrics") return all.filter((e) => e.metric);
		if (filter === "conflicts") return all.filter((e) => e.effectiveVerification === "contradicted");
		if (filter === "founder") return all.filter((e) => e.provenance.class === "founder_reported" && e.effectiveVerification !== "corroborated");
		return all;
	}, [data, filter, showSuperseded]);

	if (loading && !data) return <Loading what="startup" />;
	if (!data) return <ErrorNote error={error} />;
	const { startup } = data;
	const versionChoice = runVersion || versions.data?.find((v) => v.label.endsWith("(in force)"))?.id || versions.data?.[0]?.id || "";

	const doUpload = async (e: FormEvent) => {
		e.preventDefault();
		const file = fileRef.current?.files?.[0];
		if (!file) return;
		const doc = await upload.run(async () =>
			(
				await call<{ document: DocumentRecord }>("document.upload", {
					startupId,
					filename: file.name,
					mediaType: file.type || "application/octet-stream",
					sourceType,
					contentBase64: await fileToBase64(file),
					...(supersedes ? { supersedesDocumentId: supersedes } : {}),
				})
			).document,
		);
		if (doc) {
			setLastUpload(doc);
			if (fileRef.current) fileRef.current.value = "";
			setSupersedes("");
			await reload();
		}
	};

	const openOriginal = async (documentId: string, page?: number) => {
		const r = await docAction.run(() => call<{ url: string }>("document.link", { documentId }));
		if (r) window.open(`${r.url}${page ? `#page=${page}` : ""}`, "_blank", "noopener,noreferrer");
	};

	return (
		<>
			<PageHead
				title={startup.name}
				sub={[startup.stage, startup.sector, startup.website].filter(Boolean).join(", ") || "No profile details yet"}
				actions={
					<>
						<a href={href("startups")}>All startups</a>
						{canEdit ? (
							<button type="button" onClick={() => setEditing(!editing)}>
								{editing ? "Close editor" : "Edit profile"}
							</button>
						) : null}
					</>
				}
			/>
			{startup.description ? <p>{startup.description}</p> : null}
			{editing ? (
				<Section title="Profile">
					<ErrorNote error={profile.error} />
					<ProfileForm
						initial={toInput(startup)}
						submitLabel="Save profile"
						busy={profile.busy}
						onSubmit={async (p) => {
							if (await profile.run(() => call("startup.update", { startupId, expectedVersion: startup.__version ?? 0, ...fromInput(p) }))) {
								setEditing(false);
								await reload();
							}
						}}
					/>
				</Section>
			) : null}

			<Section title="Evaluations">
				{canRun ? (
					<div className="row" style={{ marginBottom: 12 }}>
						<select value={versionChoice} onChange={(e) => setRunVersion(e.target.value)} aria-label="Thesis version">
							{(versions.data ?? []).map((v) => (
								<option key={v.id} value={v.id}>
									{v.label}
								</option>
							))}
						</select>
						<button
							type="button"
							className="primary"
							disabled={!versionChoice || evaluate.busy}
							onClick={async () => {
								const r = await evaluate.run(() => call<{ evaluation: { id: string } }>("evaluation.start", { startupId, thesisVersionId: versionChoice, requestKey: requestKey("eval") }));
								if (r) navigate("evaluations", r.evaluation.id);
							}}
						>
							Evaluate against this version
						</button>
						{versions.data && !versions.data.length ? (
							<span className="muted small">
								Approve a <a href={href("theses")}>thesis</a> first.
							</span>
						) : null}
					</div>
				) : null}
				<ErrorNote error={evaluate.error} />
				{data.evaluations.length ? (
					<table className="list">
						<thead>
							<tr>
								<th>Started</th>
								<th>Thesis</th>
								<th>Status</th>
								<th>Findings</th>
								<th>Decision</th>
							</tr>
						</thead>
						<tbody>
							{data.evaluations.map((e) => (
								<tr key={e.id} className="clickable" onClick={() => navigate("evaluations", e.id)}>
									<td className="nowrap">
										<a href={href("evaluations", e.id)} onClick={(ev) => ev.stopPropagation()}>
											{when(e.createdAt)}
										</a>
									</td>
									<td>v{e.thesisVersion}</td>
									<td>
										<Status value={e.status} />
									</td>
									<td style={{ minWidth: 160 }}>{e.summary ? <CoverageBar byOutcome={e.summary.byOutcome} total={e.summary.criteria} /> : null}</td>
									<td>{e.currentDecision?.decision.replace(/_/g, " ") ?? <span className="muted">None yet</span>}</td>
								</tr>
							))}
						</tbody>
					</table>
				) : (
					<p className="empty">Not evaluated yet.</p>
				)}
			</Section>

			<Section title="Documents">
				{canUpload ? (
					<form className="row" onSubmit={doUpload} style={{ marginBottom: 12, alignItems: "flex-end" }}>
						<label className="field">
							PDF file
							<input ref={fileRef} type="file" accept="application/pdf,.pdf" required />
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
								<option value="">Nothing (new document)</option>
								{data.documents
									.filter((d) => !d.supersededBy && d.ingestionStatus !== "rejected")
									.map((d) => (
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
				<ErrorNote error={upload.error} />
				{lastUpload ? (
					<div className={`note ${lastUpload.ingestionStatus === "ingested" ? "ok" : lastUpload.ingestionStatus === "partial" ? "warn" : "error"}`} style={{ marginBottom: 12 }}>
						{lastUpload.filename}:{" "}
						{lastUpload.ingestionStatus === "ingested"
							? `read ${lastUpload.pageCount} page(s), ${lastUpload.claimCount} claim(s) extracted.`
							: lastUpload.ingestionStatus === "partial"
								? `partly read: ${lastUpload.ingestionIssues.join("; ")}.`
								: `not used as evidence: ${lastUpload.ingestionIssues.join("; ")}.`}
					</div>
				) : null}
				<ErrorNote error={docAction.error} />
				{data.documents.length ? (
					<table className="list">
						<thead>
							<tr>
								<th>File</th>
								<th>Source</th>
								<th>Status</th>
								<th>Pages read</th>
								<th>Claims</th>
								<th>Uploaded</th>
								<th />
							</tr>
						</thead>
						<tbody>
							{data.documents.map((d) => (
								<tr key={d.id}>
									<td>
										{d.filename}
										{d.supersededBy ? <div className="muted small">Replaced by a newer upload</div> : null}
										{d.purgedAt ? <div className="muted small">Original deleted {when(d.purgedAt)}</div> : null}
										{d.ingestionIssues.length ? <div className="small verif contradicted">{d.ingestionIssues.join("; ")}</div> : null}
									</td>
									<td>{SOURCE_LABEL[d.sourceType]}</td>
									<td>
										<Status value={d.ingestionStatus} />
									</td>
									<td>{d.pageCount ? `${d.pagesWithText} of ${d.pageCount}` : "—"}</td>
									<td>{d.claimCount}</td>
									<td className="muted nowrap">{when(d.uploadedAt)}</td>
									<td className="nowrap">
										{d.storageRef && !d.purgedAt ? (
											<button type="button" className="quiet" onClick={() => openOriginal(d.id)}>
												Open original
											</button>
										) : null}
										{canUpload && d.storageRef && !d.purgedAt ? (
											<button
												type="button"
												className="quiet danger"
												onClick={async () => {
													const reason = window.prompt("Why delete the original? Extracted claims stay for the audit trail.");
													if (reason && (await docAction.run(() => call("document.purge", { documentId: d.id, reason })))) await reload();
												}}
											>
												Delete original
											</button>
										) : null}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				) : (
					<p className="empty">No documents yet. Upload the pitch deck, financials, or third-party reports as PDFs.</p>
				)}
			</Section>

			<Section
				title="Evidence"
				actions={
					<>
						<select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} aria-label="Filter evidence">
							<option value="all">All claims</option>
							<option value="metrics">Figures only</option>
							<option value="conflicts">Conflicting</option>
							<option value="founder">Founder-reported, not corroborated</option>
						</select>
						<label className="check small">
							<input type="checkbox" checked={showSuperseded} onChange={(e) => setShowSuperseded(e.target.checked)} />
							Include replaced
						</label>
					</>
				}
			>
				{data.contradictions.length ? (
					<div className="note error" style={{ marginBottom: 12 }}>
						Sources disagree on {data.contradictions.map((c) => `${c.metric.replace(/_/g, " ")} (${c.values.map((v) => money(v, metricUnit(c.metric))).join(" vs ")})`).join("; ")}. Check which figure is current before relying on either.
					</div>
				) : null}
				<div className="legend muted" style={{ marginBottom: 8 }}>
					<span>
						<Provenance value="founder_reported" /> from the company
					</span>
					<span>
						<Provenance value="independent" /> from a third party
					</span>
					<span>
						<Provenance value="reviewer_verified" /> checked by your team
					</span>
				</div>
				{evidence.length ? (
					<div className="table-wrap">
						<table className="list">
							<thead>
								<tr>
									<th>Claim</th>
									<th>Figure</th>
									<th>Where</th>
									<th>Source</th>
									<th>Cross-check</th>
								</tr>
							</thead>
							<tbody>
								{evidence.map((e) => (
									<tr key={e.id} style={e.superseded ? { opacity: 0.55 } : undefined}>
										<td style={{ maxWidth: 520 }}>{e.claim}</td>
										<td className="nowrap">{e.metric ? `${e.metric.key.replace(/_/g, " ")}: ${money(e.metric.value, e.metric.unit)}` : ""}</td>
										<td className="nowrap">
											{e.sourceLocation.kind === "document" ? (
												<button type="button" className="quiet" onClick={() => openOriginal(e.sourceLocation.kind === "document" ? e.sourceLocation.documentId : "", e.sourceLocation.kind === "document" ? e.sourceLocation.page : undefined)}>
													{location(e, docs)}
												</button>
											) : (
												location(e, docs)
											)}
										</td>
										<td>
											<Provenance value={e.provenance.class} />
										</td>
										<td>
											<Verification value={e.effectiveVerification} />
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				) : (
					<p className="empty">{data.evidence.length ? "No claims match this filter." : "No evidence yet."}</p>
				)}
			</Section>

			<Section
				title="Evidence gaps"
				actions={
					<select value={gapVersion} onChange={(e) => setGapVersion(e.target.value)} aria-label="Check gaps against">
						<option value="">Choose a thesis version</option>
						{(versions.data ?? []).map((v) => (
							<option key={v.id} value={v.id}>
								{v.label}
							</option>
						))}
					</select>
				}
			>
				{!data.gaps ? (
					<p className="empty">Choose a thesis version to see which required evidence is still missing.</p>
				) : data.gaps.length ? (
					<ul className="timeline">
						{data.gaps.map((g) => (
							<li key={g.criterionId}>
								<strong>{g.criterionName}</strong>: no evidence yet for {g.missing.join(", ")}
							</li>
						))}
					</ul>
				) : (
					<p className="empty">Every criterion has at least some matching evidence.</p>
				)}
			</Section>

			{canAttach ? (
				<Section title="Add evidence you verified">
					<form
						className="stack"
						onSubmit={async (e) => {
							e.preventDefault();
							const metric = attachForm.metric && attachForm.value !== "" ? { key: attachForm.metric, value: Number(attachForm.value) } : undefined;
							if (await attach.run(() => call("evidence.attach", { startupId, claim: attachForm.claim, reference: attachForm.reference, ...(metric ? { metric } : {}) }))) {
								setAttachForm({ claim: "", reference: "", metric: "", value: "" });
								await reload();
							}
						}}
					>
						<div className="form-grid">
							<label className="field wide">
								What you confirmed
								<input value={attachForm.claim} onChange={(e) => setAttachForm({ ...attachForm, claim: e.target.value })} placeholder="Bank statements show $2.3M ARR" required />
							</label>
							<label className="field wide">
								How you confirmed it
								<input value={attachForm.reference} onChange={(e) => setAttachForm({ ...attachForm, reference: e.target.value })} placeholder="Reviewed bank statements on the 8 Oct call" required />
							</label>
							<label className="field">
								Figure (optional)
								<select value={attachForm.metric} onChange={(e) => setAttachForm({ ...attachForm, metric: e.target.value })}>
									<option value="">None</option>
									{METRIC_KEYS.map((m) => (
										<option key={m} value={m}>
											{m.replace(/_/g, " ")}
										</option>
									))}
								</select>
							</label>
							{attachForm.metric ? (
								<label className="field">
									Value
									<input type="number" value={attachForm.value} onChange={(e) => setAttachForm({ ...attachForm, value: e.target.value })} required />
								</label>
							) : null}
						</div>
						<ErrorNote error={attach.error} />
						<div>
							<button className="primary" disabled={attach.busy}>
								Record verified evidence
							</button>
						</div>
					</form>
				</Section>
			) : null}

			{data.decisions.length ? (
				<Section title="Decisions">
					<ul className="timeline">
						{data.decisions.map((d) => (
							<li key={d.id}>
								<strong>{d.decision.replace(/_/g, " ")}</strong> by {d.decidedByName}, {when(d.createdAt)}: {d.rationale}
							</li>
						))}
					</ul>
				</Section>
			) : null}
		</>
	);
}
