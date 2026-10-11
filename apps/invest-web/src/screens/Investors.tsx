import { type FormEvent, useState } from "react";
import { RESEARCH_STATUSES, type AttentionItem, type CriterionView, type FirmListItem, type FirmProfile, type MonitoringTarget, type ResearchSource, type ResearchStatus, type TimelineItem } from "../../../../invest/domain/research.ts";
import { call } from "../api.ts";
import { RESEARCH } from "../vocab.ts";
import { Badge, EmptyState, ErrorNote, Loading, PageHead, Section, href, useAction, useCan, useLoad, when } from "../ui.tsx";
import { ApproveAsFirmButton, ContributionForm, ProfileHistorySection, ReconciliationSection, RepresentativePanel } from "./Collaboration.tsx";

const STATUS_LABEL: Record<ResearchStatus, string> = Object.fromEntries(Object.entries(RESEARCH).map(([k, v]) => [k, v.label])) as Record<ResearchStatus, string>;
const ASSERTION_TITLE = {
	explicit: { title: "Stated on the firm's own site", help: "Read from the firm's public pages. Pages can be out of date, and nothing here is the firm's own criterion until an authorised person approves it." },
	observed: { title: "External observations", help: "What the firm did in past deals. It says nothing about what the firm targets." },
	inferred: { title: "Inferred patterns", help: "A pattern across past investments. Never the firm's declared policy." },
} as const;
const VERIFICATION_LABEL: Record<string, string> = {
	pending: "Source not yet checked",
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
	return <Badge entry={RESEARCH[status]} />;
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

/** Investor research: the firms this workspace researches. Source operations live under Operations; claims and decisions have their own pages. */
export function InvestorsScreen() {
	return (
		<>
			<PageHead title="Investor research" sub="Public-source research on venture firms. Findings are research, not the firm's own criteria; only criteria marked approved are." />
			<DirectoryTab />
		</>
	);
}

function DirectoryTab() {
	const [query, setQuery] = useState("");
	const [status, setStatus] = useState<ResearchStatus | "">("");
	const { data, error, loading } = useLoad(() => call<{ items: FirmListItem[] }>("firm.list", { ...(query.trim() ? { query: query.trim() } : {}), ...(status ? { status } : {}) }).then((r) => r.items), [query, status]);
	const attention = useLoad(() => call<{ items: AttentionItem[] }>("attention.list", {}).then((r) => r.items), []);
	return (
		<>
			<AttentionPanel items={attention.data ?? []} />
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
								<th>Last successful research</th>
								<th>Monitoring</th>
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
									<td className="nowrap">
										{when(f.lastSuccessAt)}
										{f.lastResearchedAt && f.lastResearchedAt !== f.lastSuccessAt ? <div className="muted small">Last attempt {when(f.lastResearchedAt)}</div> : null}
									</td>
									<td>
										{f.monitoring ? (
											<>
												<span className={`flag ${f.monitoring.enabled ? "" : "stale"}`}>{f.monitoring.enabled ? (f.monitoring.running ? "Checking now" : "Monitored") : "Paused"}</span>
												{f.monitoring.consecutiveFailures ? <span className="flag conflict">{f.monitoring.consecutiveFailures} failed</span> : null}
												{f.monitoring.enabled ? <div className="muted small">Next {when(f.monitoring.nextCheckAt)}</div> : null}
											</>
										) : (
											<span className="muted small">Not monitored</span>
										)}
									</td>
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
				<EmptyState title={query || status ? "No firms match these filters" : "No firms are being researched yet"}>{query || status ? "Clear the search or the research filter." : "Firms appear here once research is run for them. An operator adds firms with the research command (see the README); a representative's own firm is added when they claim it."}</EmptyState>
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

function CriterionRow({ firmId, c, canReview, canApprove, reload, domain }: { firmId: string; c: CriterionView; canReview: boolean; canApprove: boolean; reload: () => void; domain?: string }) {
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
				<span className={`tag assert-${c.assertionType}`}>{({ explicit: "Stated", observed: "Seen in past activity", inferred: "Inferred pattern" } as Record<string, string>)[c.assertionType] ?? c.assertionType}</span>
				<span className={`tag verif-${c.verification}`}>{c.verificationApplicable ? VERIFICATION_LABEL[c.verification] : "Not checkable from one passage"}</span>
				{c.freshness === "stale" ? <span className="flag stale">Out of date</span> : null}
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
				{domain && c.assertionType !== "inferred" && c.field !== "application_requirements" ? <ApproveAsFirmButton firmId={firmId} criterionId={c.id} domain={domain} reload={reload} /> : null}
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
	const [bump, setBump] = useState(0);
	const reloadAll = () => {
		setBump((b) => b + 1);
		reload();
	};
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
						<UrlText url={p.firm.website} /> · <StatusBadge status={p.firm.researchStatus} /> · last successful research {when(p.firm.lastSuccessAt)}
						{p.firm.lastResearchedAt && p.firm.lastResearchedAt !== p.firm.lastSuccessAt ? <span className="muted"> (latest attempt {when(p.firm.lastResearchedAt)})</span> : null}
						{p.stale ? <span className="flag stale"> Stale (older than {p.staleAfterDays} days)</span> : null}
						{p.health.failing ? <span className="flag conflict"> Research failing</span> : null}
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

			<Section title="Approved criteria">
				<p className="muted small">Only these are criteria someone with authority stands behind. Everything below is research.</p>
				{p.approvedCurrent.length ? (
					<ul className="timeline">
						{p.approvedCurrent.map((a) => (
							<li key={a.id}>
								<strong>{a.polarity === "exclude" ? "Excludes " : ""}{a.field.replace(/_/g, " ")}: {a.valueRange ? usdRange(a.valueRange) : a.value.replace(/_/g, " ")}</strong> — {a.authority === "firm_representative" ? <span className="tag cat-investor_verified">Approved by the firm's verified representative</span> : <span className="tag">Approved by this workspace</span>} {a.createdBy}, {when(a.createdAt)}. {a.note}
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

			<RepresentativePanel firmId={firmId} domain={p.firm.canonicalDomain} approvals={p.approvals} reload={reloadAll} />

			{groups.map(({ k, items }) =>
				items.length ? (
					<Section key={k} title={`${ASSERTION_TITLE[k].title} (${items.length})`}>
						<p className="muted small">{ASSERTION_TITLE[k].help}</p>
						<div className="stack">
							{items.map((c) => (
								<CriterionRow key={c.id} firmId={firmId} c={c} canReview={canReview} canApprove={canApprove} reload={reloadAll} domain={p.firm.canonicalDomain} />
							))}
						</div>
					</Section>
				) : null,
			)}
			{!p.criteria.length && !p.stub ? <p className="empty">No criteria in the latest run.</p> : null}

			<ReconciliationSection firmId={firmId} canReview={canReview} version={p.runs.length + p.findings.length + p.events.length + p.reviews.length + p.approvals.length + bump} />
			<ProfileHistorySection firmId={firmId} version={p.approvals.length + bump} />
			<Section title="Contribute">
				<p className="muted small">Add a correction, firsthand knowledge or a note about this firm. It stays private to your workspace until you share it.</p>
				<ContributionForm domain={p.firm.canonicalDomain} />
			</Section>
			<MonitoringSection p={p} canRun={canRun} reload={reload} />
			<TimelineSection firmId={firmId} canReview={canReview} version={p.runs.length + p.findings.length + p.events.length + p.reviews.length} reload={reload} />

			<details className="ops-details" data-testid="research-details">
			<summary>Research details: pages read, research runs and earlier findings</summary>
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
			</details>
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

const ATTENTION_TITLE: Record<AttentionItem["kind"], string> = {
	new_investment: "New investment activity",
	strategy_change: "Potential strategy changes",
	needs_review: "Findings requiring review",
	research_failing: "Research failing",
	research_stale: "Research stale",
};

/** Four different things, never blended: activity, strategy, review queue, and research health. */
export function AttentionPanel({ items }: { items: AttentionItem[] }) {
	if (!items.length) return null;
	const kinds = Object.keys(ATTENTION_TITLE) as AttentionItem["kind"][];
	return (
		<section className="attention" aria-label="Needs attention" data-testid="attention">
			<div className="grid-2">
				{kinds.map((k) => {
					const rows = items.filter((i) => i.kind === k);
					if (!rows.length) return null;
					return (
						<div key={k} className={`attn attn-${k}`}>
							<h3>
								{ATTENTION_TITLE[k]} ({rows.length})
							</h3>
							<ul className="timeline">
								{rows.slice(0, 6).map((r) => (
									<li key={r.refId}>
										<a href={href("investors", r.firmId)}>{r.firmName}</a>: {r.title} <span className="muted small">found {when(r.at)}</span>
									</li>
								))}
							</ul>
						</div>
					);
				})}
			</div>
		</section>
	);
}

const INTERVALS = [
	{ label: "Every 6 hours", minutes: 360 },
	{ label: "Daily", minutes: 1440 },
	{ label: "Every 3 days", minutes: 4320 },
	{ label: "Weekly", minutes: 10080 },
];

function MonitoringSection({ p, canRun, reload }: { p: FirmProfile; canRun: boolean; reload: () => void }) {
	const t: MonitoringTarget | null = p.monitoring;
	const a = useAction();
	if (!t) return <Section title="Monitoring"><p className="empty">This firm is not monitored. Register it with the research command to schedule recurring checks.</p></Section>;
	const set = (change: { enabled?: boolean; intervalMinutes?: number }) => a.run(() => call("firm.monitoring.set", { firmId: p.firm.id, ...change })).then((r) => r && reload());
	const checking = !!t.lease && Date.parse(t.lease.expiresAt) > Date.now();
	return (
		<Section title="Monitoring" actions={canRun ? <button className="quiet" disabled={a.busy} onClick={() => set({ enabled: !t.enabled })}>{t.enabled ? "Pause monitoring" : "Resume monitoring"}</button> : null}>
			<dl className="facts" data-testid="monitoring">
				<dt>State</dt>
				<dd>{t.enabled ? (checking ? "Checking now" : "Monitored") : `Paused ${when(t.pausedAt)}${t.pausedBy ? ` by ${t.pausedBy}` : ""}. The profile and history are kept.`}</dd>
				<dt>Schedule</dt>
				<dd>
					Every {t.intervalMinutes >= 1440 ? `${t.intervalMinutes / 1440} day(s)` : `${t.intervalMinutes / 60} hour(s)`}; next check {t.enabled ? when(t.nextCheckAt) : "—"}
					{canRun ? (
						<select aria-label="Check interval" value={INTERVALS.some((i) => i.minutes === t.intervalMinutes) ? t.intervalMinutes : ""} onChange={(e) => e.target.value && set({ intervalMinutes: Number(e.target.value) })} style={{ marginLeft: 8 }}>
							<option value="">Custom</option>
							{INTERVALS.map((i) => (
								<option key={i.minutes} value={i.minutes}>
									{i.label}
								</option>
							))}
						</select>
					) : null}
				</dd>
				<dt>Last attempt</dt>
				<dd>{when(t.lastAttemptAt)}</dd>
				<dt>Last successful check</dt>
				<dd>{when(t.lastSuccessAt)}</dd>
				<dt>Research health</dt>
				<dd>
					{p.health.failing ? "Failing" : p.health.stale ? "Stale" : "Healthy"}
					{t.consecutiveFailures ? `; ${t.consecutiveFailures} failed check(s) in a row` : ""}
					{t.lastError ? `. Last error: ${t.lastError.message}` : ""}
					{p.health.inaccessibleSources || p.health.missingSources ? `. ${p.health.inaccessibleSources} source(s) inaccessible, ${p.health.missingSources} missing; their last successful snapshots are kept.` : ""}
				</dd>
			</dl>
			<ErrorNote error={a.error} />
		</Section>
	);
}

const TYPE_FILTERS: { value: string; label: string }[] = [
	{ value: "", label: "All types" },
	{ value: "investment_event", label: "Investment announcements" },
	{ value: "portfolio_addition", label: "Portfolio additions" },
	{ value: "thesis_finding", label: "Proposed thesis changes" },
	{ value: "conflict", label: "Conflicting evidence" },
	{ value: "source_discovered", label: "New sources" },
	{ value: "source_changed", label: "Material page changes" },
	{ value: "source_missing", label: "Missing sources" },
	{ value: "research_failed", label: "Failed research" },
	{ value: "review", label: "Reviewer decisions" },
];
const RANGES: { value: string; label: string; days: number | null }[] = [
	{ value: "all", label: "All time", days: null },
	{ value: "7", label: "Last 7 days", days: 7 },
	{ value: "30", label: "Last 30 days", days: 30 },
	{ value: "365", label: "Last year", days: 365 },
];
const REVIEW_FILTERS = [
	{ value: "", label: "Any review state" },
	{ value: "needs_review", label: "Needs review" },
	{ value: "unreviewed", label: "Unreviewed" },
	{ value: "confirmed", label: "Confirmed" },
	{ value: "dismissed", label: "Dismissed" },
	{ value: "disputed", label: "Disputed" },
];

function TimelineSection({ firmId, canReview, version, reload }: { firmId: string; canReview: boolean; version: number; reload: () => void }) {
	const [type, setType] = useState("");
	const [range, setRange] = useState("all");
	const [review, setReview] = useState("");
	const days = RANGES.find((r) => r.value === range)?.days ?? null;
	const { data, error, loading, reload: reloadTimeline } = useLoad(
		() =>
			call<{ items: TimelineItem[] }>("firm.timeline", {
				firmId,
				...(type ? { types: [type] } : {}),
				...(review ? { reviewStates: [review] } : {}),
				...(days ? { from: new Date(Date.now() - days * 86_400_000).toISOString() } : {}),
			}).then((r) => r.items),
		[firmId, type, range, review, version],
	);
	return (
		<Section title="Intelligence timeline">
			<p className="muted small">What the source says happened (published, announced), when this system found it (discovered) and when a person decided (reviewed) are shown separately. Failed research is health information, not investor activity.</p>
			<div className="row" style={{ marginBottom: 8 }}>
				<label className="field">
					Type
					<select value={type} onChange={(e) => setType(e.target.value)}>
						{TYPE_FILTERS.map((t) => (
							<option key={t.value} value={t.value}>
								{t.label}
							</option>
						))}
					</select>
				</label>
				<label className="field">
					Found
					<select value={range} onChange={(e) => setRange(e.target.value)}>
						{RANGES.map((t) => (
							<option key={t.value} value={t.value}>
								{t.label}
							</option>
						))}
					</select>
				</label>
				<label className="field">
					Review
					<select value={review} onChange={(e) => setReview(e.target.value)}>
						{REVIEW_FILTERS.map((t) => (
							<option key={t.value} value={t.value}>
								{t.label}
							</option>
						))}
					</select>
				</label>
			</div>
			{loading && !data ? <Loading what="timeline" /> : <ErrorNote error={error} />}
			{data?.length ? (
				<div className="stack" data-testid="timeline">
					{data.map((i) => (
						<TimelineRow key={i.id} item={i} firmId={firmId} canReview={canReview} onChange={() => { reloadTimeline(); reload(); }} />
					))}
				</div>
			) : data ? (
				<p className="empty">Nothing matches.</p>
			) : null}
		</Section>
	);
}

const CATEGORY_LABEL: Record<TimelineItem["category"], string> = { investment_activity: "Investment activity", strategy: "Strategy", source: "Source", health: "Research health", review: "Review" };

function TimelineRow({ item, firmId, canReview, onChange }: { item: TimelineItem; firmId: string; canReview: boolean; onChange: () => void }) {
	const [note, setNote] = useState("");
	const a = useAction();
	const subject = item.refs.eventId ? { eventId: item.refs.eventId } : item.refs.findingId && item.type !== "review" ? { findingId: item.refs.findingId } : null;
	const decide = async (action: "confirm" | "dismiss" | "dispute" | "flag") => {
		if (!subject || !note.trim()) return;
		if (await a.run(() => call("firm.review", { firmId, ...subject, action, note }))) {
			setNote("");
			onChange();
		}
	};
	return (
		<details className={`criterion tl tl-${item.category}`} data-type={item.type}>
			<summary>
				<span className="rc-label">{item.title}</span>
				<span className="tag">{CATEGORY_LABEL[item.category]}</span>
				{item.baseline ? <span className="tag" title="Found by the first successful research run: context, not news">Baseline</span> : null}
				{item.reviewState !== "not_applicable" ? <span className={`tag review-${item.reviewState}`}>{item.reviewState.replace(/_/g, " ")}</span> : null}
			</summary>
			<div className="stack">
				<p>{item.detail}</p>
				<dl className="facts">
					<dt>Published</dt>
					<dd>{item.publishedAt ? when(item.publishedAt) : "not stated by the source"}</dd>
					{item.announcedAt ? (
						<>
							<dt>Announced</dt>
							<dd>{when(item.announcedAt)}</dd>
						</>
					) : null}
					<dt>Discovered</dt>
					<dd>{when(item.discoveredAt)}</dd>
					<dt>Reviewed</dt>
					<dd>{item.reviewedAt ? when(item.reviewedAt) : "not reviewed"}</dd>
				</dl>
				{item.evidence.map((e) => (
					<div key={`${e.url}${e.passage}`}>
						{e.passage ? <blockquote className="passage">{e.passage}</blockquote> : null}
						<div className="small">
							<UrlText url={e.url} />
						</div>
					</div>
				))}
				{canReview && subject ? (
					<div className="stack review-form">
						<label className="field">
							Review note
							<input value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
							<span className="hint">A review records your judgment beside the finding. It does not edit the finding or change any investor-verified criterion.</span>
						</label>
						<ErrorNote error={a.error} />
						<div className="row">
							<button disabled={a.busy || !note.trim()} onClick={() => decide("confirm")}>Confirm</button>
							<button className="quiet" disabled={a.busy || !note.trim()} onClick={() => decide("dispute")}>Dispute</button>
							<button className="quiet" disabled={a.busy || !note.trim()} onClick={() => decide("dismiss")}>Dismiss</button>
							<button className="quiet" disabled={a.busy || !note.trim()} onClick={() => decide("flag")}>Flag for review</button>
						</div>
					</div>
				) : null}
			</div>
		</details>
	);
}
