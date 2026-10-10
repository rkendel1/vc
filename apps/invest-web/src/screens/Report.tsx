import { useEffect, useMemo, useState } from "react";
import type { DecisionKind, DocumentPage, DocumentRecord, EvidenceView, FindingView, ManifestEvidence, Outcome, Startup, ThesisVersion } from "../../../../invest/domain/types.ts";
import type { EvaluationReport } from "../../../../invest/domain/views.ts";
import { call, requestKey } from "../api.ts";
import {
	CoverageBar,
	ErrorNote,
	Loading,
	OUTCOME_LABEL,
	OUTCOME_ORDER,
	OutcomeLabel,
	OutcomeMark,
	PageHead,
	Provenance,
	Section,
	Status,
	Verification,
	describeCheck,
	href,
	metricUnit,
	money,
	navigate,
	shortDigest,
	useAction,
	useCan,
	useLoad,
	when,
} from "../ui.tsx";

const DECISION_LABEL: Record<DecisionKind, string> = { invest: "Invest", decline: "Decline", hold: "Hold", request_more_diligence: "More diligence" };
const MODE_LABEL = { semantic: "Jev judgment", deterministic: "Checked in code", human_review: "Reviewer decides" } as const;

// ---------------------------------------------------------------------------
// Source viewer
// ---------------------------------------------------------------------------

function SourceViewer({ evidenceId, manifestItem, onClose }: { evidenceId: string; manifestItem: ManifestEvidence | undefined; onClose: () => void }) {
	const { data, error } = useLoad(async () => {
		const ev = await call<{ item: EvidenceView; document: DocumentRecord | null }>("evidence.get", { evidenceId });
		const loc = ev.item.sourceLocation;
		const page = loc.kind === "document" && ev.document && !ev.document.purgedAt ? (await call<{ page: DocumentPage }>("document.page", { documentId: loc.documentId, page: loc.page })).page : null;
		return { ...ev, page };
	}, [evidenceId]);
	const link = useAction();
	if (!data) return error ? <ErrorNote error={error} /> : <p className="muted">Opening source…</p>;
	const { item, document, page } = data;
	const loc = item.sourceLocation;
	const quote = loc.quote;
	const changed = manifestItem && manifestItem.verification !== item.effectiveVerification;
	return (
		<div className="stack">
			<div className="row" style={{ justifyContent: "space-between" }}>
				<h3>{loc.kind === "document" ? `${document?.filename ?? "Document"}, page ${loc.page}` : loc.kind === "profile" ? "Startup profile" : "Reviewer-verified evidence"}</h3>
				<button type="button" className="quiet" onClick={onClose}>
					Close
				</button>
			</div>
			<div className="row">
				<Provenance value={item.provenance.class} />
				<Verification value={item.effectiveVerification} />
				{item.metric ? <span className="small">{`${item.metric.key.replace(/_/g, " ")} = ${money(item.metric.value, item.metric.unit)}`}</span> : null}
			</div>
			{changed ? (
				<div className="note warn small">
					At evaluation time this was “{manifestItem?.verification.replace(/_/g, " ")}”. Evidence added since then changed its cross-check; rerun the evaluation to use it.
				</div>
			) : null}
			{loc.kind === "reviewer" ? <p className="small">Verified by your team: {loc.reference}</p> : null}
			{page ? (
				<div className="page" aria-label={`Text of page ${page.page}`}>
					{page.lines.map((l, i) => {
						const hit = quote.includes(l.text.trim()) && l.text.trim().length > 2;
						return (
							<div key={i} className={`line${hit ? " hit" : ""}`} ref={hit ? (el) => el?.scrollIntoView({ block: "nearest" }) : undefined}>
								{l.text}
							</div>
						);
					})}
				</div>
			) : (
				<blockquote className="page">{quote}</blockquote>
			)}
			{loc.kind === "document" && document ? (
				<div className="small muted">
					Source file hash <span className="digest">{document.contentHash.slice(0, 16)}</span>, parsed by {document.parser.name} {document.parser.version}, claims by {document.extractorVersion}.{" "}
					{document.storageRef && !document.purgedAt ? (
						<button
							type="button"
							className="quiet"
							onClick={async () => {
								const r = await link.run(() => call<{ url: string }>("document.link", { documentId: document.id }));
								if (r) window.open(`${r.url}#page=${loc.page}`, "_blank", "noopener,noreferrer");
							}}
						>
							Open original at page {loc.page}
						</button>
					) : (
						"The original file has been deleted."
					)}
				</div>
			) : null}
			<ErrorNote error={link.error} />
		</div>
	);
}

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

function Distribution({ dist }: { dist: Record<string, number> }) {
	return (
		<div className="dist">
			{OUTCOME_ORDER.filter((o) => dist[o] !== undefined).map((o) => (
				<div key={o} style={{ display: "contents" }}>
					<span className={`o-${o}`}>{OUTCOME_LABEL[o]}</span>
					<span className={`bar o-${o}`}>
						<span style={{ width: `${Math.round((dist[o] ?? 0) * 100)}%` }} />
					</span>
					<span>{Math.round((dist[o] ?? 0) * 100)}%</span>
				</div>
			))}
		</div>
	);
}

function ReviewControls({ evaluationId, finding, onDone, onAsk }: { evaluationId: string; finding: FindingView; onDone: () => void; onAsk: (q: string) => void }) {
	const [mode, setMode] = useState<"none" | "override" | "comment">("none");
	const [outcome, setOutcome] = useState<Outcome>(finding.effectiveOutcome === "supported" ? "contradicted" : "supported");
	const [reason, setReason] = useState("");
	const action = useAction();
	const submit = async (kind: "accept" | "override" | "comment") => {
		if (await action.run(() => call("review.record", { evaluationId, findingId: finding.id, action: kind, ...(kind === "override" ? { outcome } : {}), ...(reason ? { reason } : {}) }))) {
			setMode("none");
			setReason("");
			onDone();
		}
	};
	return (
		<div className="stack">
			<div className="row">
				<button type="button" onClick={() => submit("accept")} disabled={action.busy}>
					Accept finding
				</button>
				<button type="button" onClick={() => setMode(mode === "override" ? "none" : "override")}>
					Override outcome
				</button>
				<button type="button" className="quiet" onClick={() => setMode(mode === "comment" ? "none" : "comment")}>
					Comment
				</button>
			</div>
			{mode !== "none" ? (
				<div className="stack" style={{ maxWidth: 560 }}>
					{mode === "override" ? (
						<label className="field">
							Your outcome
							<select value={outcome} onChange={(e) => setOutcome(e.target.value as Outcome)}>
								{OUTCOME_ORDER.filter((o) => o !== "evaluation_failed").map((o) => (
									<option key={o} value={o}>
										{OUTCOME_LABEL[o]}
									</option>
								))}
							</select>
						</label>
					) : null}
					<label className="field">
						{mode === "override" ? "Reason (recorded with your name and the time)" : "Comment"}
						<textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
					</label>
					<div className="row">
						<button type="button" className="primary" disabled={action.busy || (mode === "override" ? reason.trim().length < 10 : !reason.trim())} onClick={() => submit(mode)}>
							{mode === "override" ? "Record override" : "Add comment"}
						</button>
						{mode === "override" && reason.trim().length < 10 ? <span className="muted small">At least 10 characters</span> : null}
					</div>
				</div>
			) : null}
			<ErrorNote error={action.error} />
			{finding.suggestedQuestions.length ? (
				<div>
					<div className="muted small">Suggested diligence</div>
					<ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
						{finding.suggestedQuestions.map((q) => (
							<li key={q}>
								{q}{" "}
								<button type="button" className="quiet" onClick={() => onAsk(q)}>
									Open as request
								</button>
							</li>
						))}
					</ul>
				</div>
			) : null}
		</div>
	);
}

function Finding({
	finding,
	evaluationId,
	items,
	open,
	onToggle,
	selectedRef,
	onSelectRef,
	canReview,
	onChanged,
	onAsk,
}: {
	finding: FindingView;
	evaluationId: string;
	items: Map<string, ManifestEvidence>;
	open: boolean;
	onToggle: () => void;
	selectedRef: string | null;
	onSelectRef: (id: string) => void;
	canReview: boolean;
	onChanged: () => void;
	onAsk: (q: string) => void;
}) {
	const overridden = finding.effectiveOutcome !== finding.outcome;
	return (
		<article className={`finding o-${finding.effectiveOutcome}${open ? " selected" : ""}`}>
			<button type="button" className="head" onClick={onToggle} aria-expanded={open}>
				<OutcomeMark outcome={finding.effectiveOutcome} />
				<div style={{ flex: 1, minWidth: 0 }}>
					<div className="title">{finding.criterionName}</div>
					<div className="meta">
						<OutcomeLabel outcome={finding.effectiveOutcome} />
						{overridden ? <span>overridden; system said {OUTCOME_LABEL[finding.outcome].toLowerCase()}</span> : null}
						<span>{MODE_LABEL[finding.mode]}</span>
						{finding.effectiveHardGate !== "not_applicable" ? <span className={`gate ${finding.effectiveHardGate}`}>hard gate {finding.effectiveHardGate}</span> : null}
						{finding.reviewState === "outstanding" ? <span className="verif contradicted">needs review</span> : finding.reviewState === "resolved" ? <span>reviewed</span> : null}
						{finding.contradictions.length ? <span className="verif contradicted">conflicting sources</span> : null}
					</div>
					<p style={{ marginTop: 6, fontSize: 14 }}>{finding.explanation}</p>
				</div>
			</button>
			{open ? (
				<div className="body">
					<dl>
						{finding.evidenceRefs.length ? (
							<>
								<dt>Evidence used</dt>
								<dd className="refs">
									{finding.evidenceRefs.map((id) => {
										const ev = items.get(id);
										return (
											<button key={id} type="button" className="ref" aria-pressed={selectedRef === id} onClick={() => onSelectRef(id)}>
												<Provenance value={ev?.provenanceClass ?? "founder_reported"} />
												<span style={{ flex: 1 }}>
													{ev?.claim ?? id}
													<span className="muted small"> ({ev?.location})</span>
												</span>
											</button>
										);
									})}
								</dd>
							</>
						) : null}
						{finding.missingEvidence.length ? (
							<>
								<dt>Missing evidence</dt>
								<dd>{finding.missingEvidence.join(", ")}</dd>
							</>
						) : null}
						{finding.deterministic ? (
							<>
								<dt>Exact check</dt>
								<dd>
									Requires {describeCheck(finding.deterministic.metric, finding.deterministic.comparator, finding.deterministic.threshold)}; observed{" "}
									{finding.deterministic.observedValue === null ? "nothing" : money(finding.deterministic.observedValue, metricUnit(finding.deterministic.metric))}
									{finding.deterministic.passed === null ? "" : finding.deterministic.passed ? ", passes" : ", fails"}
								</dd>
							</>
						) : null}
						<dt>Evidence standard</dt>
						<dd>{finding.sufficiency === "founder_reported_only" ? "Only founder-reported evidence; not independently confirmed" : finding.sufficiency.replace(/_/g, " ")}</dd>
						{finding.contradictions.length ? (
							<>
								<dt>Contradictions</dt>
								<dd>{finding.contradictions.map((c) => `${c.metric.replace(/_/g, " ")}: ${c.values.map((v) => money(v, metricUnit(c.metric))).join(" vs ")}`).join("; ")}</dd>
							</>
						) : null}
						{finding.policyAdjustments.length ? (
							<>
								<dt>Policy applied</dt>
								<dd>{finding.policyAdjustments.join("; ")}</dd>
							</>
						) : null}
						{finding.review.reasons.length ? (
							<>
								<dt>Why review</dt>
								<dd>{finding.review.reasons.join("; ")}</dd>
							</>
						) : null}
						{finding.jev ? (
							<>
								<dt>Jev</dt>
								<dd>
									{finding.jev.selected ? `Selected ${OUTCOME_LABEL[finding.jev.selected as Outcome]?.toLowerCase() ?? finding.jev.selected}` : "No answer"}
									{` in ${finding.jev.attempts} attempt${finding.jev.attempts === 1 ? "" : "s"}, ${finding.jev.latencyMs} ms`}
									{finding.jev.error ? <div className="verif contradicted">{finding.jev.error}</div> : null}
									{finding.uncertainty.distribution ? <Distribution dist={finding.uncertainty.distribution} /> : null}
									<div className="muted small">Confidence describes this answer only, not the company's prospects.</div>
								</dd>
							</>
						) : null}
					</dl>
					{finding.actions.length ? (
						<ul className="timeline">
							{finding.actions.map((a) => (
								<li key={a.id}>
									<strong>{a.actorName}</strong> {a.action === "override" ? `overrode to ${OUTCOME_LABEL[a.outcome as Outcome].toLowerCase()}` : a.action.replace(/_/g, " ")}
									{a.reason ? `: ${a.reason}` : ""} <span className="muted small">{when(a.createdAt)}</span>
								</li>
							))}
						</ul>
					) : null}
					{canReview ? <ReviewControls evaluationId={evaluationId} finding={finding} onDone={onChanged} onAsk={onAsk} /> : null}
				</div>
			) : null}
		</article>
	);
}

// ---------------------------------------------------------------------------
// Report screen
// ---------------------------------------------------------------------------

export function ReportScreen({ evaluationId }: { evaluationId: string }) {
	const canReview = useCan("review.write");
	const canDecide = useCan("decision.record");
	const canRun = useCan("evaluation.run");
	const { data, error, loading, reload } = useLoad(() => call<{ report: EvaluationReport }>("evaluation.get", { evaluationId }).then((r) => r.report), [evaluationId], {
		pollMs: (d) => (d?.evaluation.status === "running" ? 1500 : null),
	});
	const context = useLoad(async () => {
		if (!data) return null;
		const [{ workspace }, { version }] = await Promise.all([
			call<{ workspace: { startup: Startup } }>("startup.get", { startupId: data.evaluation.startupId }),
			call<{ version: ThesisVersion }>("thesis.version.get", { versionId: data.evaluation.thesisVersionId }),
		]);
		return { startup: workspace.startup, version };
	}, [data?.evaluation.startupId, data?.evaluation.thesisVersionId]);
	const [openFinding, setOpenFinding] = useState<string | null>(null);
	const [selectedRef, setSelectedRef] = useState<string | null>(null);
	const [question, setQuestion] = useState("");
	const [assignee, setAssignee] = useState("");
	const [decision, setDecision] = useState<DecisionKind>("request_more_diligence");
	const [rationale, setRationale] = useState("");
	const [resolutions, setResolutions] = useState<Record<string, string>>({});
	const [verify, setVerify] = useState<{ ok: boolean; checks: { name: string; ok: boolean; detail: string }[] } | null>(null);
	const act = useAction();
	const verifyAction = useAction();

	const items = useMemo(() => new Map((data?.evaluation.manifest.evidence.items ?? []).map((i) => [i.id, i])), [data]);
	useEffect(() => {
		if (data && !openFinding) setOpenFinding(data.findings.find((f) => f.reviewState === "outstanding")?.id ?? data.findings[0]?.id ?? null);
	}, [data, openFinding]);

	if (loading && !data) return <Loading what="evaluation" />;
	if (!data) return <ErrorNote error={error} />;
	const { evaluation, summary } = data;
	const m = evaluation.manifest;
	const title = context.data ? context.data.startup.name : "Evaluation";
	const blockers = data.decisionBlockers[decision];

	const ask = (q: string) => {
		setQuestion(q);
		document.getElementById("requests")?.scrollIntoView({ behavior: "smooth" });
	};

	return (
		<>
			<PageHead
				title={title}
				sub={
					<>
						Against {context.data ? <a href={href("theses", m.thesis.thesisId)}>thesis version {m.thesis.version}</a> : `thesis version ${m.thesis.version}`}, started {when(evaluation.createdAt)}
						{evaluation.predecessorId ? (
							<>
								, rerun of <a href={href("evaluations", evaluation.predecessorId)}>an earlier evaluation</a>
							</>
						) : null}
					</>
				}
				actions={
					<>
						<Status value={evaluation.status} />
						<a href={href("startups", evaluation.startupId)}>Startup evidence</a>
					</>
				}
			/>

			{evaluation.status === "running" ? <div className="note">Evaluating {m.thesis.criteria.length} criteria against {m.evidence.items.length} claims. This page updates on its own.</div> : null}
			{evaluation.status === "failed" ? <div className="note error">{evaluation.failure}</div> : null}

			{summary ? (
				<div className="stack" style={{ marginBottom: 8 }}>
					<CoverageBar byOutcome={summary.byOutcome} total={summary.criteria} />
					<div className="legend">
						{OUTCOME_ORDER.filter((o) => summary.byOutcome[o]).map((o) => (
							<span key={o} className="row" style={{ gap: 6 }}>
								<OutcomeLabel outcome={o} />
								<span>{summary.byOutcome[o]}</span>
							</span>
						))}
					</div>
					<div className="row small">
						<span>
							Evidence established {Math.round(summary.evidenceCoverage * 100)}% of applicable criteria.
						</span>
						{summary.hardGates.failed.length ? <span className="gate failed">Hard gate failed: {summary.hardGates.failed.join(", ")}</span> : null}
						{summary.hardGates.unresolved.length ? <span className="gate unresolved">Hard gate open: {summary.hardGates.unresolved.join(", ")}</span> : null}
						{summary.reviewsOutstanding ? <span className="verif contradicted">{summary.reviewsOutstanding} finding(s) need review</span> : <span>All review gates resolved.</span>}
						{summary.weightedScore !== null ? <span className="muted">Weighted summary {Math.round(summary.weightedScore * 100)} / 100</span> : null}
					</div>
				</div>
			) : null}

			<div className="report">
				<div>
					{data.findings.map((f) => (
						<Finding
							key={f.id}
							finding={f}
							evaluationId={evaluation.id}
							items={items}
							open={openFinding === f.id}
							onToggle={() => setOpenFinding(openFinding === f.id ? null : f.id)}
							selectedRef={selectedRef}
							onSelectRef={setSelectedRef}
							canReview={canReview && evaluation.status === "completed"}
							onChanged={reload}
							onAsk={ask}
						/>
					))}
					{!data.findings.length && evaluation.status !== "running" ? <p className="empty">No findings were recorded.</p> : null}
				</div>
				<aside className="source" aria-label="Source">
					{selectedRef ? (
						<SourceViewer evidenceId={selectedRef} manifestItem={items.get(selectedRef)} onClose={() => setSelectedRef(null)} />
					) : (
						<div className="stack small">
							<h3>Source</h3>
							<p className="muted">Open a finding and choose a piece of evidence to see it on its page.</p>
							<dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 12px", margin: 0 }}>
								<dt className="muted">Inputs digest</dt>
								<dd className="digest" style={{ margin: 0 }}>
									{shortDigest(evaluation.manifestDigest)}
								</dd>
								<dt className="muted">Claims in snapshot</dt>
								<dd style={{ margin: 0 }}>{m.evidence.items.length}</dd>
								<dt className="muted">Documents</dt>
								<dd style={{ margin: 0 }}>{m.evidence.documents.length}</dd>
								<dt className="muted">Jev</dt>
								<dd style={{ margin: 0 }}>{m.jev.configured ? `${m.jev.endpointOrigin}${m.jev.model ? `, ${m.jev.model}` : ""}` : "not configured"}</dd>
								<dt className="muted">Policy</dt>
								<dd style={{ margin: 0 }}>{m.policyVersion}</dd>
								<dt className="muted">Parser</dt>
								<dd style={{ margin: 0 }}>
									{m.parser.name} {m.parser.version}, {m.extractorVersion}
								</dd>
								<dt className="muted">Run</dt>
								<dd style={{ margin: 0 }}>
									{evaluation.metrics.latencyMs !== null ? `${(evaluation.metrics.latencyMs / 1000).toFixed(1)} s, ` : ""}
									{evaluation.metrics.jevCalls} Jev call(s), {evaluation.metrics.jevFailures} failed
								</dd>
							</dl>
							<div className="row">
								<button
									type="button"
									disabled={verifyAction.busy || evaluation.status === "running"}
									onClick={async () => {
										const r = await verifyAction.run(() => call<typeof verify>("evaluation.verify", { evaluationId }));
										if (r) setVerify(r);
									}}
								>
									Check this record
								</button>
								{canRun && evaluation.status !== "running" ? (
									<button
										type="button"
										onClick={async () => {
											const r = await act.run(() => call<{ evaluation: { id: string } }>("evaluation.rerun", { evaluationId, requestKey: requestKey("rerun") }));
											if (r) navigate("evaluations", r.evaluation.id);
										}}
									>
										Rerun with current evidence
									</button>
								) : null}
							</div>
							<ErrorNote error={verifyAction.error} />
							{verify ? (
								<div className={`note ${verify.ok ? "ok" : "error"}`}>
									{verify.ok
										? `All ${verify.checks.length} checks match: digests, evidence projections, questions and every outcome recompute to what was recorded.`
										: `Mismatch: ${verify.checks
												.filter((c) => !c.ok)
												.map((c) => `${c.name} (${c.detail})`)
												.join("; ")}`}
								</div>
							) : null}
						</div>
					)}
				</aside>
			</div>

			<Section title="Diligence requests" id="requests">
				{data.openRequests.length ? (
					<ul className="timeline">
						{data.openRequests.map((r) => (
							<li key={r.id}>
								<div>
									{r.reason}
									<span className="muted small">
										{" "}
										Asked by {r.actorName}
										{r.assignee ? `, assigned to ${r.assignee}` : ""}, {when(r.createdAt)}
									</span>
								</div>
								{canReview ? (
									<div className="row" style={{ marginTop: 4 }}>
										<input
											placeholder="What came back"
											value={resolutions[r.id] ?? ""}
											onChange={(e) => setResolutions({ ...resolutions, [r.id]: e.target.value })}
											style={{ flex: 1, minWidth: 200 }}
										/>
										<button
											type="button"
											disabled={!resolutions[r.id]?.trim() || act.busy}
											onClick={async () => {
												if (await act.run(() => call("review.resolve", { evaluationId, requestId: r.id, resolution: resolutions[r.id] }))) await reload();
											}}
										>
											Mark resolved
										</button>
									</div>
								) : null}
							</li>
						))}
					</ul>
				) : (
					<p className="empty">No open requests.</p>
				)}
				{data.closedRequests.length ? (
					<details style={{ marginTop: 8 }}>
						<summary className="small">{data.closedRequests.length} resolved</summary>
						<ul className="timeline" style={{ marginTop: 8 }}>
							{data.closedRequests.map((r) => (
								<li key={r.id} className="muted">
									{r.reason}
								</li>
							))}
						</ul>
					</details>
				) : null}
				{canReview ? (
					<div className="row" style={{ marginTop: 12, alignItems: "flex-end" }}>
						<label className="field" style={{ flex: 2, minWidth: 240 }}>
							New request
							<input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ask the founders for the last 12 months of bank statements" />
						</label>
						<label className="field" style={{ flex: 1, minWidth: 140 }}>
							Assign to
							<input value={assignee} onChange={(e) => setAssignee(e.target.value)} />
						</label>
						<button
							type="button"
							disabled={!question.trim() || act.busy}
							onClick={async () => {
								if (await act.run(() => call("review.request", { evaluationId, question, ...(assignee ? { assignee } : {}) }))) {
									setQuestion("");
									setAssignee("");
									await reload();
								}
							}}
						>
							Open request
						</button>
					</div>
				) : null}
				<ErrorNote error={act.error} />
			</Section>

			<Section title="Decision">
				<p className="muted small" style={{ marginBottom: 12 }}>
					The decision is yours and is recorded separately from the findings. Declining does not mark any criterion as failed.
				</p>
				{data.decisions.length ? (
					<ul className="timeline" style={{ marginBottom: 16 }}>
						{data.decisions.map((d) => (
							<li key={d.id} style={d.id === data.currentDecision?.id ? { borderColor: "var(--action)" } : undefined}>
								<strong>{DECISION_LABEL[d.decision]}</strong>
								{d.id === data.currentDecision?.id ? " (current)" : ""} by {d.decidedByName}, {when(d.createdAt)}
								<div>{d.rationale}</div>
							</li>
						))}
					</ul>
				) : null}
				{canDecide && evaluation.status !== "running" ? (
					<div className="stack" style={{ maxWidth: 640 }}>
						<div className="row" role="radiogroup" aria-label="Decision">
							{(Object.keys(DECISION_LABEL) as DecisionKind[]).map((k) => (
								<label key={k} className="check">
									<input type="radio" name="decision" checked={decision === k} onChange={() => setDecision(k)} />
									{DECISION_LABEL[k]}
								</label>
							))}
						</div>
						<label className="field">
							Rationale
							<textarea value={rationale} onChange={(e) => setRationale(e.target.value)} rows={3} />
						</label>
						{blockers.length ? (
							<ul className="blockers">
								{blockers.map((b) => (
									<li key={b}>{b}</li>
								))}
							</ul>
						) : null}
						<div>
							<button
								type="button"
								className="primary"
								disabled={!!blockers.length || rationale.trim().length < 10 || act.busy}
								onClick={async () => {
									if (await act.run(() => call("decision.record", { evaluationId, decision, rationale, expectedSequence: (data.currentDecision?.sequence ?? 0) + 1 }))) {
										setRationale("");
										await reload();
									}
								}}
							>
								Record decision: {DECISION_LABEL[decision].toLowerCase()}
							</button>
						</div>
					</div>
				) : !canDecide ? (
					<p className="muted small">A partner records the decision.</p>
				) : null}
			</Section>
		</>
	);
}
