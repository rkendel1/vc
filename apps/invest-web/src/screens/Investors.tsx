import { type FormEvent, useState } from "react";
import { RESEARCH_STATUSES, type CriterionView, type FirmListItem, type FirmProfile, type ResearchSource, type ResearchStatus } from "../../../../invest/domain/research.ts";
import { call } from "../api.ts";
import { ErrorNote, Loading, PageHead, Section, href, useAction, useCan, useLoad, when } from "../ui.tsx";

const STATUS_LABEL: Record<ResearchStatus, string> = {
	pending: "Not researched yet",
	thesis_found: "Thesis found",
	no_thesis_found: "No thesis found in this research",
	research_incomplete: "Research incomplete",
};
const STATUS_HELP: Record<ResearchStatus, string> = {
	pending: "A profile exists but no research has run.",
	thesis_found: "At least one explicit criterion was found in the firm's own public pages.",
	no_thesis_found: "The pages that could be read declared no criteria. This does not mean the firm has none.",
	research_incomplete: "Research was blocked, failed or could not cover enough of the site. Nothing can be concluded.",
};
const ASSERTION_TITLE = {
	explicit: { title: "Stated by the firm", help: "Taken from a statement on the firm's own pages." },
	observed: { title: "Observed from announcements", help: "What the firm did in a past financing. Not a statement of what it targets." },
	inferred: { title: "Inferred from portfolio patterns", help: "A pattern across past investments. Not the firm's declared policy." },
} as const;
const VERIFICATION_LABEL: Record<string, string> = {
	pending: "Source check pending",
	source_supports: "Passage supports the statement",
	source_does_not_support: "Passage does not support the statement",
	inconclusive: "Source check inconclusive",
	verification_error: "Source check failed",
};
const OUTCOME_LABEL: Record<string, string> = {
	ok: "Read",
	http_error: "HTTP error",
	blocked_robots: "Blocked by robots rules",
	blocked_network_policy: "Refused by network policy",
	redirect_off_domain: "Redirected off the firm's domain (not followed)",
	redirect_limit: "Too many redirects",
	unsupported_content: "Not readable text",
	too_large: "Too large",
	timeout: "Timed out",
	network_error: "Network error",
	auth_required: "Access restricted (not bypassed)",
};
const SOURCE_CLASS_LABEL: Record<string, string> = { official_website: "Official website", official_publication: "Official publication", third_party: "Third party", other: "Other" };

export function StatusBadge({ status }: { status: ResearchStatus }) {
	return (
		<span className={`rstatus ${status}`} title={STATUS_HELP[status]}>
			{STATUS_LABEL[status]}
		</span>
	);
}

const usd = (n: number) => (n >= 1e6 ? `$${n / 1e6}M` : n >= 1e3 ? `$${n / 1e3}K` : `$${n}`);
const usdRange = (r: { minUsd: number | null; maxUsd: number | null }) => (r.minUsd !== null && r.maxUsd !== null ? `${usd(r.minUsd)}–${usd(r.maxUsd)}` : r.maxUsd !== null ? `up to ${usd(r.maxUsd)}` : `from ${usd(r.minUsd ?? 0)}`);
const isHttps = (u: string) => /^https:\/\//i.test(u);
function UrlText({ url }: { url: string }) {
	return isHttps(url) ? (
		<a href={url} target="_blank" rel="noopener noreferrer nofollow">
			{url}
		</a>
	) : (
		<span>{url}</span>
	);
}

export function InvestorsScreen() {
	const [query, setQuery] = useState("");
	const [status, setStatus] = useState<ResearchStatus | "">("");
	const { data, error, loading } = useLoad(() => call<{ items: FirmListItem[] }>("firm.list", { ...(query.trim() ? { query: query.trim() } : {}), ...(status ? { status } : {}) }).then((r) => r.items), [query, status]);
	return (
		<>
			<PageHead title="Investors" sub="Public-source research on venture firms. Findings here are not investor-approved theses." />
			<div className="row" style={{ marginBottom: 12 }}>
				<label className="field">
					Search
					<input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name, domain, stage, sector…" />
				</label>
				<label className="field">
					Research status
					<select value={status} onChange={(e) => setStatus(e.target.value as ResearchStatus | "")}>
						<option value="">All</option>
						{RESEARCH_STATUSES.map((s) => (
							<option key={s} value={s}>
								{STATUS_LABEL[s]}
							</option>
						))}
					</select>
				</label>
			</div>
			{loading && !data ? <Loading what="investors" /> : <ErrorNote error={error} />}
			{data?.length ? (
				<div className="table-wrap">
					<table className="list">
						<thead>
							<tr>
								<th>Firm</th>
								<th>Research</th>
								<th>Criteria</th>
								<th>Last researched</th>
								<th>Flags</th>
							</tr>
						</thead>
						<tbody>
							{data.map((f) => (
								<tr key={f.id}>
									<td>
										<a href={href("investors", f.id)}>{f.name}</a>
										<div className="muted small">{f.canonicalDomain}</div>
									</td>
									<td>
										<StatusBadge status={f.researchStatus} />
										{f.stub ? <div className="muted small">Stub profile</div> : null}
									</td>
									<td>{f.criteriaCount ? `${f.criteriaCount} (${f.explicitCount} stated)` : "—"}</td>
									<td className="nowrap">{when(f.lastResearchedAt)}</td>
									<td>
										{f.stale ? <span className="flag stale">Stale</span> : null} {f.conflictCount ? <span className="flag conflict">{f.conflictCount} conflict{f.conflictCount === 1 ? "" : "s"}</span> : null}
										{f.researchStatus === "research_incomplete" ? <span className="flag">{f.retryable ? "Retry may help" : "Blocked"}</span> : null}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			) : data ? (
				<p className="empty">{query || status ? "No firms match." : "No firms yet. Run the research pipeline: bun run research -- <file> --workspace <id>."}</p>
			) : null}
		</>
	);
}

function ReviewForm({ firmId, criterion, onDone }: { firmId: string; criterion: CriterionView; onDone: () => void }) {
	const [action, setAction] = useState<"flag" | "dispute" | "correct" | "note">("flag");
	const [note, setNote] = useState("");
	const [corrected, setCorrected] = useState("");
	const a = useAction();
	const submit = async (e: FormEvent) => {
		e.preventDefault();
		const ok = await a.run(() => call("firm.review", { firmId, criterionId: criterion.id, action, note, ...(action === "correct" ? { correctedValue: corrected } : {}) }));
		if (ok) {
			setNote("");
			setCorrected("");
			onDone();
		}
	};
	return (
		<form className="stack review-form" onSubmit={submit}>
			<div className="row">
				<label className="field">
					Record as
					<select value={action} onChange={(e) => setAction(e.target.value as typeof action)}>
						<option value="flag">Flag for attention</option>
						<option value="dispute">Dispute</option>
						<option value="correct">Suggest a correction</option>
						<option value="note">Add a note</option>
					</select>
				</label>
				{action === "correct" ? (
					<label className="field">
						Corrected value
						<input value={corrected} onChange={(e) => setCorrected(e.target.value)} maxLength={200} required />
					</label>
				) : null}
			</div>
			<label className="field">
				Note
				<textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={2000} required />
				<span className="hint">Reviews sit beside the research result. They do not change it and do not make it investor-verified.</span>
			</label>
			<ErrorNote error={a.error} />
			<div>
				<button disabled={a.busy || !note.trim()}>Save review</button>
			</div>
		</form>
	);
}

function CriterionRow({ firmId, c, canReview, canApprove, reload }: { firmId: string; c: CriterionView; canReview: boolean; canApprove: boolean; reload: () => void }) {
	const approve = useAction();
	const [note, setNote] = useState("");
	const [confirming, setConfirming] = useState(false);
	return (
		<details className={`criterion rc ${c.assertionType}`}>
			<summary>
				<span className="rc-label">
					{c.polarity === "exclude" ? "Excludes: " : ""}
					{c.label}
				</span>
				<span className="muted small">{c.field.replace(/_/g, " ")}</span>
				<span className={`tag assert-${c.assertionType}`}>{c.assertionType}</span>
				<span className={`tag verif-${c.verification}`}>{c.verificationApplicable ? VERIFICATION_LABEL[c.verification] : "Not checkable from one passage"}</span>
				{c.freshness === "stale" ? <span className="flag stale">Stale</span> : null}
				{c.reviews.length ? <span className="flag">{c.reviews.length} review{c.reviews.length === 1 ? "" : "s"}</span> : null}
			</summary>
			<div className="stack">
				<blockquote className="passage" data-testid="passage">
					{c.passage}
				</blockquote>
				<dl className="facts">
					<dt>Source</dt>
					<dd>
						{c.source ? (
							<>
								{c.source.title ? <>{c.source.title}. </> : null}
								<UrlText url={c.source.finalUrl} />
							</>
						) : (
							"Source record unavailable"
						)}
					</dd>
					<dt>Source class</dt>
					<dd>{SOURCE_CLASS_LABEL[c.sourceClass] ?? c.sourceClass}</dd>
					<dt>Captured</dt>
					<dd>
						{when(c.capturedAt)}; last confirmed {when(c.lastConfirmedAt)}
					</dd>
					<dt>How it was extracted</dt>
					<dd>
						{c.method}, {c.extractorVersion}. {c.extractionNote ?? ""} {c.basis ? `Basis: ${c.basis.observations} of ${c.basis.of} entries.` : ""}
					</dd>
					{c.verificationDetail ? (
						<>
							<dt>Source check</dt>
							<dd>
								{c.verificationDetail.statement} Jev ({c.verificationDetail.jev?.provider ?? "unknown provider"}): {c.verificationDetail.selectedId ?? c.verificationDetail.error}. {c.verificationDetail.rationale ?? ""}
								<div className="muted small">Support from the passage is not proof that the firm's published material is complete or current.</div>
							</dd>
						</>
					) : null}
				</dl>
				{c.reviews.length ? (
					<ul className="timeline">
						{c.reviews.map((r) => (
							<li key={r.id}>
								<strong>{r.action}</strong> by {r.createdBy}, {when(r.createdAt)}: {r.note}
								{r.correctedValue ? <> Suggested value: <em>{r.correctedValue}</em></> : null}
							</li>
						))}
					</ul>
				) : null}
				{canReview ? <ReviewForm firmId={firmId} criterion={c} onDone={reload} /> : null}
				{canApprove && c.assertionType !== "inferred" && c.field !== "application_requirements" ? (
					<div className="stack">
						{confirming ? (
							<>
								<label className="field">
									Why you are adopting this as investor-verified
									<input value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
								</label>
								<ErrorNote error={approve.error} />
								<div className="row">
									<button
										className="primary"
										disabled={approve.busy || !note.trim()}
										onClick={async () => {
											if (await approve.run(() => call("firm.approve", { firmId, criterionId: c.id, note }))) {
												setConfirming(false);
												setNote("");
												reload();
											}
										}}
									>
										Record as investor-verified
									</button>
									<button className="quiet" onClick={() => setConfirming(false)}>
										Cancel
									</button>
								</div>
							</>
						) : (
							<div>
								<button className="quiet" onClick={() => setConfirming(true)}>
									Adopt as investor-verified…
								</button>
							</div>
						)}
					</div>
				) : null}
			</div>
		</details>
	);
}

function SourceRow({ s }: { s: ResearchSource }) {
	return (
		<tr>
			<td>
				<UrlText url={s.finalUrl || s.requestedUrl} />
				{s.title ? <div className="muted small">{s.title}</div> : null}
			</td>
			<td>{OUTCOME_LABEL[s.outcome] ?? s.outcome}{s.detail ? <div className="muted small">{s.detail}</div> : null}</td>
			<td>{SOURCE_CLASS_LABEL[s.sourceClass] ?? s.sourceClass}, {s.pageKind}</td>
			<td className="nowrap">{when(s.firstRetrievedAt)}</td>
			<td>{s.hostileContent ? <span className="flag conflict" title="The page contained text that tries to instruct a reader. Those sentences were discarded.">Instruction-like text discarded</span> : null}</td>
		</tr>
	);
}

export function InvestorScreen({ firmId }: { firmId: string }) {
	const canRun = useCan("research.run");
	const canReview = useCan("review.write");
	const canApprove = useCan("thesis.approve");
	const { data, error, loading, reload } = useLoad(() => call<{ profile: FirmProfile }>("firm.get", { firmId }).then((r) => r.profile), [firmId], {
		pollMs: (d) => (d?.runs[0]?.status === "running" ? 2000 : null),
	});
	const refresh = useAction();
	const verify = useAction();
	const [verifyNote, setVerifyNote] = useState<string | null>(null);
	if (loading && !data) return <Loading what="investor" />;
	if (!data) return <ErrorNote error={error} />;
	const p = data;
	const running = p.runs[0]?.status === "running";
	const groups = (["explicit", "observed", "inferred"] as const).map((k) => ({ k, items: p.criteria.filter((c) => c.assertionType === k) }));
	const criterionLabel = (id: string) => p.criteria.find((c) => c.id === id)?.label ?? id;
	return (
		<>
			<PageHead
				title={p.firm.name}
				sub={
					<>
						<UrlText url={p.firm.website} /> · <StatusBadge status={p.firm.researchStatus} /> · last researched {when(p.firm.lastResearchedAt)}
						{p.stale ? <span className="flag stale"> Stale (older than {p.staleAfterDays} days)</span> : null}
					</>
				}
				actions={
					canRun ? (
						<>
							<button
								disabled={refresh.busy || running}
								onClick={async () => {
									if (await refresh.run(() => call("firm.refresh", { firmId }))) reload();
								}}
							>
								{running ? "Researching…" : "Refresh research"}
							</button>
							<button
								className="quiet"
								disabled={verify.busy || running}
								onClick={async () => {
									const r = await verify.run(() => call<{ summary: { skipped: string | null; attempted: number; supported: number } }>("firm.verify", { firmId }));
									if (r) {
										setVerifyNote(r.summary.skipped ? "Jev is not configured; source checks stay pending." : `Checked ${r.summary.attempted} passage(s).`);
										reload();
									}
								}}
							>
								Check passages with Jev
							</button>
						</>
					) : null
				}
			/>
			<ErrorNote error={refresh.error ?? verify.error} />
			{verifyNote ? <div className="note">{verifyNote}</div> : null}
			<div className="note warn">{p.disclaimer}</div>

			{p.stub ? (
				<div className="note stub" data-testid="stub">
					<strong>{p.firm.researchStatus === "pending" ? "Not researched" : "Stub profile"}</strong>
					<p>{p.stubStatement}</p>
					{p.firm.stubReasons.length ? (
						<ul>
							{p.firm.stubReasons.map((r) => (
								<li key={r}>{r}</li>
							))}
						</ul>
					) : null}
					{p.firm.lastError ? <p>Last error ({p.firm.lastError.retryable ? "retryable" : "not retryable"}): {p.firm.lastError.message}</p> : null}
				</div>
			) : null}

			{p.conflicts.length ? (
				<Section title={`Conflicts to review (${p.conflicts.length})`}>
					<ul className="timeline" data-testid="conflicts">
						{p.conflicts.map((c) => (
							<li key={c.kind + c.criterionIds.join()}>
								{c.message} <span className="muted small">({c.criterionIds.map(criterionLabel).join("; ")}{c.approvalIds.length ? "; conflicts with an investor-approved value" : ""})</span>
							</li>
						))}
					</ul>
					<p className="muted small">Nothing was resolved automatically. Neither side is assumed correct.</p>
				</Section>
			) : null}

			<Section title="Investor-verified criteria">
				{p.approvedCurrent.length ? (
					<ul className="timeline">
						{p.approvedCurrent.map((a) => (
							<li key={a.id}>
								<strong>{a.polarity === "exclude" ? "Excludes " : ""}{a.field.replace(/_/g, " ")}: {a.valueRange ? usdRange(a.valueRange) : a.value.replace(/_/g, " ")}</strong> — approved by {a.createdBy}, {when(a.createdAt)}. {a.note}
								{canApprove ? (
									<>
										{" "}
										<WithdrawButton firmId={firmId} approvalId={a.id} reload={reload} />
									</>
								) : null}
							</li>
						))}
					</ul>
				) : (
					<p className="empty">Nothing here has been adopted as investor-verified. Research results are never promoted automatically.</p>
				)}
			</Section>

			{groups.map(({ k, items }) =>
				items.length ? (
					<Section key={k} title={`${ASSERTION_TITLE[k].title} (${items.length})`}>
						<p className="muted small">{ASSERTION_TITLE[k].help}</p>
						<div className="stack">
							{items.map((c) => (
								<CriterionRow key={c.id} firmId={firmId} c={c} canReview={canReview} canApprove={canApprove} reload={reload} />
							))}
						</div>
					</Section>
				) : null,
			)}
			{!p.criteria.length && !p.stub ? <p className="empty">No criteria in the latest run.</p> : null}

			<Section title={`Sources checked (${p.runs[0]?.checks.length ?? 0} in the latest run)`}>
				{p.sources.length ? (
					<div className="table-wrap">
						<table className="list">
							<thead>
								<tr>
									<th>Page</th>
									<th>Outcome</th>
									<th>Kind</th>
									<th>First captured</th>
									<th />
								</tr>
							</thead>
							<tbody>
								{p.sources.map((s) => (
									<SourceRow key={s.id} s={s} />
								))}
							</tbody>
						</table>
					</div>
				) : (
					<p className="empty">No pages have been checked.</p>
				)}
				<p className="muted small">Only short relevant passages are kept, not copies of pages. Blocked and failed pages are listed so the coverage is visible.</p>
			</Section>

			<Section title="Research runs">
				<div className="table-wrap">
					<table className="list">
						<thead>
							<tr>
								<th>Started</th>
								<th>Result</th>
								<th>Pages</th>
								<th>Why</th>
							</tr>
						</thead>
						<tbody>
							{p.runs.map((r) => (
								<tr key={r.id}>
									<td className="nowrap">{when(r.startedAt)}</td>
									<td>{r.status === "completed" && r.outcome ? STATUS_LABEL[r.outcome] : r.status}</td>
									<td>{r.counts.pagesOk}/{r.counts.pagesAttempted} read</td>
									<td>{r.error ? r.error.message : r.outcomeReasons.join("; ")}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</Section>

			{p.history.length ? (
				<Section title={`Earlier findings no longer in the latest run (${p.history.length})`}>
					<p className="muted small">Kept as history. A changed source or extraction produces new records; old ones are never edited.</p>
					<div className="stack">
						{p.history.map((c) => (
							<CriterionRow key={c.id} firmId={firmId} c={c} canReview={false} canApprove={false} reload={reload} />
						))}
					</div>
				</Section>
			) : null}
		</>
	);
}

function WithdrawButton({ firmId, approvalId, reload }: { firmId: string; approvalId: string; reload: () => void }) {
	const a = useAction();
	return (
		<>
			<button
				className="quiet"
				disabled={a.busy}
				onClick={async () => {
					const note = window.prompt("Why is this approval being withdrawn?");
					if (note?.trim() && (await a.run(() => call("firm.approval.withdraw", { firmId, approvalId, note })))) reload();
				}}
			>
				Withdraw
			</button>
			<ErrorNote error={a.error} />
		</>
	);
}
