import { type FormEvent, useState } from "react";
import type { ContributionKind } from "../../../../invest/domain/collab.ts";
import { call } from "../api.ts";
import { ErrorNote, Loading, Section, href, useAction, useCan, useLoad, when } from "../ui.tsx";
import { CATEGORY_LABEL } from "./Collaboration.tsx";

type Any = Record<string, any>; // eslint-disable-line

const ADAPTERS = [
	{ value: "csv_dataset", label: "CSV dataset" },
	{ value: "json_dataset", label: "JSON dataset" },
	{ value: "funding_news_feed", label: "Funding-news feed (RSS/Atom)" },
];
const BASES = [
	{ value: "published_terms_permit", label: "Published terms permit automated access" },
	{ value: "public_feed", label: "A public feed offered for reading" },
	{ value: "licensed_dataset", label: "A licensed dataset" },
	{ value: "owner_permission", label: "The owner gave permission" },
];

// ---------------------------------------------------------------------------------------- sources

export function SourcesPanel() {
	const canManage = useCan("source.manage");
	const { data, error, loading, reload } = useLoad(() => call<{ items: Any[] }>("source.list", {}).then((r) => r.items), []);
	const [open, setOpen] = useState<string | null>(null);
	return (
		<>
			<p className="muted small">Curated third-party sources are monitored on a schedule through the same safe-fetch boundary as firms. Each one records why automated access is permitted. No provider is built in: register only sources whose terms allow it.</p>
			{loading && !data ? <Loading what="sources" /> : <ErrorNote error={error} />}
			{data?.length ? (
				<div className="table-wrap">
					<table className="list" data-testid="sources">
						<thead>
							<tr>
								<th>Source</th>
								<th>Format</th>
								<th>Monitoring</th>
								<th>Last attempt</th>
								<th>Last success</th>
								<th />
							</tr>
						</thead>
						<tbody>
							{data.map((x) => (
								<SourceRow key={x.source.id} x={x} canManage={canManage} open={open === x.source.id} toggle={() => setOpen(open === x.source.id ? null : x.source.id)} reload={reload} />
							))}
						</tbody>
					</table>
				</div>
			) : data ? (
				<p className="empty">No curated sources yet.</p>
			) : null}
			{canManage ? <RegisterSource onDone={reload} /> : null}
		</>
	);
}

function SourceRow({ x, canManage, open, toggle, reload }: { x: Any; canManage: boolean; open: boolean; toggle: () => void; reload: () => void }) {
	const a = useAction();
	const t = x.target;
	return (
		<>
			<tr>
				<td>
					<strong>{x.source.name}</strong>
					<div className="muted small">{x.source.publisher} · {x.source.sourceType.replace(/_/g, " ")}</div>
				</td>
				<td>{x.source.adapter.replace(/_/g, " ")}</td>
				<td>
					<span className={`flag ${t?.enabled ? "" : "stale"}`}>{t?.enabled ? "Monitored" : "Paused"}</span>
					{t?.consecutiveFailures ? <span className="flag conflict">{t.consecutiveFailures} failed</span> : null}
					{t?.enabled ? <div className="muted small">Next {when(t.nextCheckAt)}</div> : null}
				</td>
				<td>
					{x.lastRun ? (x.lastRun.success ? `${when(x.lastRun.completedAt)}${x.lastRun.change === "unchanged" ? " (unchanged)" : ""}` : <span className="flag conflict">Failed: {x.lastRun.error?.message ?? x.lastRun.fetchOutcome}</span>) : "never"}
				</td>
				<td>{x.lastSuccessfulRun ? when(x.lastSuccessfulRun.completedAt) : "—"}</td>
				<td className="nowrap">
					<button className="quiet" onClick={toggle} aria-expanded={open}>
						{open ? "Hide" : "Details"}
					</button>
					{canManage ? (
						<>
							<button className="quiet" disabled={a.busy} onClick={async () => (await a.run(() => call("source.refresh", { sourceId: x.source.id }))) && setTimeout(reload, 400)}>
								Refresh
							</button>
							<button className="quiet" disabled={a.busy} onClick={async () => (await a.run(() => call("source.monitoring.set", { sourceId: x.source.id, enabled: !t?.enabled }))) && reload()}>
								{t?.enabled ? "Pause" : "Resume"}
							</button>
						</>
					) : null}
					<ErrorNote error={a.error} />
				</td>
			</tr>
			{open ? (
				<tr>
					<td colSpan={6}>
						<SourceDetail id={x.source.id} source={x.source} />
					</td>
				</tr>
			) : null}
		</>
	);
}

function SourceDetail({ id, source }: { id: string; source: Any }) {
	const { data } = useLoad(() => call<{ detail: Any }>("source.get", { sourceId: id }).then((r) => r.detail), [id]);
	return (
		<div className="stack" data-testid="source-detail">
			<dl className="facts">
				<dt>Access basis</dt>
				<dd>{BASES.find((b) => b.value === source.accessBasis)?.label ?? source.accessBasis}</dd>
				<dt>Terms</dt>
				<dd>{source.termsNote}</dd>
				<dt>Known limitations</dt>
				<dd>{source.limitations || "none recorded"}</dd>
				<dt>Hosts contacted</dt>
				<dd>{source.allowedHosts.join(", ")}</dd>
				<dt>Records</dt>
				<dd>
					{data ? `${data.recordCount} (matched ${data.tally.matched}, candidates ${data.tally.candidate_match}, unmatched ${data.tally.unmatched})` : "…"}
				</dd>
			</dl>
			{data?.runs?.length ? (
				<table className="list">
					<thead>
						<tr>
							<th>Started</th>
							<th>Result</th>
							<th>Records</th>
							<th>Errors</th>
						</tr>
					</thead>
					<tbody>
						{data.runs.map((r: Any) => (
							<tr key={r.id}>
								<td className="nowrap">{when(r.startedAt)}</td>
								<td>{r.status === "running" ? "running" : r.success ? (r.change ?? "ok") : `failed: ${r.error?.message ?? r.fetchOutcome}`}</td>
								<td>{r.counts.records} ({r.counts.newRecords} new, {r.counts.changedRecords} changed)</td>
								<td>{r.counts.errors ? r.errors.slice(0, 3).map((e: Any) => `#${e.index}: ${e.message}`).join("; ") : "none"}</td>
							</tr>
						))}
					</tbody>
				</table>
			) : null}
		</div>
	);
}

function RegisterSource({ onDone }: { onDone: () => void }) {
	const [f, setF] = useState({ name: "", canonicalUrl: "", publisher: "", sourceType: "directory", adapter: "csv_dataset", accessBasis: "", termsNote: "", limitations: "", mapping: '{"nameField": "name", "websiteField": "website", "idField": "id"}' });
	const a = useAction();
	const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
	const submit = async (e: FormEvent) => {
		e.preventDefault();
		let mapping: unknown;
		if (f.adapter !== "funding_news_feed") {
			try {
				mapping = JSON.parse(f.mapping);
			} catch {
				return void a.run(async () => {
					throw Object.assign(new Error("The mapping is not valid JSON"), { code: "INVALID_INPUT" });
				});
			}
		}
		if (await a.run(() => call("source.register", { name: f.name, canonicalUrl: f.canonicalUrl, publisher: f.publisher, sourceType: f.sourceType, adapter: f.adapter, accessBasis: f.accessBasis, termsNote: f.termsNote, limitations: f.limitations, ...(mapping ? { mapping } : {}) }))) onDone();
	};
	return (
		<Section title="Register a source">
			<form className="stack" onSubmit={submit} data-testid="register-source">
				<div className="form-grid">
					<label className="field">Name<input value={f.name} onChange={set("name")} required /></label>
					<label className="field">Publisher<input value={f.publisher} onChange={set("publisher")} required /></label>
					<label className="field wide">URL (https)<input value={f.canonicalUrl} onChange={set("canonicalUrl")} required placeholder="https://" /></label>
					<label className="field">Kind of source
						<select value={f.sourceType} onChange={set("sourceType")}>
							{["directory", "curated_list", "funding_news", "portfolio_aggregator", "dataset"].map((v) => <option key={v} value={v}>{v.replace(/_/g, " ")}</option>)}
						</select>
					</label>
					<label className="field">Format
						<select value={f.adapter} onChange={set("adapter")}>
							{ADAPTERS.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
						</select>
					</label>
					<label className="field wide">Why automated access is permitted
						<select value={f.accessBasis} onChange={set("accessBasis")} required>
							<option value="">Choose…</option>
							{BASES.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
						</select>
					</label>
					<label className="field wide">Terms and where they say so<textarea value={f.termsNote} onChange={set("termsNote")} rows={2} required minLength={20} /></label>
					<label className="field wide">Known limitations<textarea value={f.limitations} onChange={set("limitations")} rows={2} /></label>
					{f.adapter !== "funding_news_feed" ? <label className="field wide">Column or key mapping (JSON)<textarea value={f.mapping} onChange={set("mapping")} rows={3} /></label> : null}
				</div>
				<ErrorNote error={a.error} />
				<div><button className="primary" disabled={a.busy}>Register and schedule</button></div>
			</form>
		</Section>
	);
}

// ---------------------------------------------------------------------------------------- inbox

const INBOX_TITLE: Record<string, string> = {
	candidate_match: "Candidate matches",
	conflict: "Unresolved conflicts",
	proposed_claim: "Proposed claims",
	contribution_shared: "Contributions shared with you",
	representative_claim: "Representative claims",
	my_contribution_disputed: "Your contributions that were disputed or rejected",
};

export function InboxPanel() {
	const canModerate = useCan("moderation.review");
	const inbox = useLoad(() => call<{ items: Any[] }>("inbox.list", {}).then((r) => r.items), []);
	const matches = useLoad(() => call<{ open: Any[]; history: Any[] }>("match.list", {}), []);
	const items = inbox.data ?? [];
	const kinds = Object.keys(INBOX_TITLE).filter((k) => k !== "candidate_match" && items.some((i) => i.kind === k));
	return (
		<div className="stack" data-testid="inbox">
			{inbox.loading && !inbox.data ? <Loading what="inbox" /> : <ErrorNote error={inbox.error} />}
			{!items.length && inbox.data ? <p className="empty">Nothing needs your decision.</p> : null}
			{matches.data?.open.length ? (
				<Section title={`${INBOX_TITLE.candidate_match} (${matches.data.open.length})`}>
					<p className="muted small">A name alone never merges two entities. Confirm only when you have evidence they are the same; a rejected pairing is remembered and never proposed again.</p>
					{matches.data.open.map((o) => (
						<MatchCard key={o.match.id} o={o} reload={() => { matches.reload(); inbox.reload(); }} />
					))}
				</Section>
			) : null}
			{kinds.map((k) => (
				<Section key={k} title={`${INBOX_TITLE[k]} (${items.filter((i) => i.kind === k).length})`}>
					<ul className="timeline">
						{items.filter((i) => i.kind === k).map((i, n) => (
							<li key={`${k}${n}`}>
								{i.firmId ? <a href={href("investors", i.firmId)}>{i.title}</a> : i.title} <span className="muted small">{i.detail} · {when(i.at)}</span>
							</li>
						))}
					</ul>
				</Section>
			))}
			{canModerate ? <ModerationPanel reload={inbox.reload} /> : null}
			{matches.data?.history.length ? (
				<Section title="Match decisions">
					<ul className="timeline">
						{matches.data.history.slice(0, 20).map((d) => (
							<li key={d.id}>
								<strong>{d.decision}</strong> "{d.subjectName}" by {d.decidedBy}, {when(d.decidedAt)}: {d.rationale}
							</li>
						))}
					</ul>
				</Section>
			) : null}
		</div>
	);
}

function MatchCard({ o, reload }: { o: Any; reload: () => void }) {
	const canReview = useCan("review.write");
	const [pick, setPick] = useState<string>(`${o.match.candidates[0]?.ref.type}:${o.match.candidates[0]?.ref.id}`);
	const [note, setNote] = useState("");
	const a = useAction();
	const decide = async (decision: "confirm" | "reject") => {
		const [entityType, ...rest] = pick.split(":");
		if (await a.run(() => call("match.decide", { matchId: o.match.id, decision, entityType, entityId: rest.join(":"), rationale: note }))) reload();
	};
	return (
		<div className="note" data-testid="match-card">
			<strong>"{o.match.subjectName}"</strong> <span className="muted small">({o.match.subject}{o.match.subjectRole !== "record" ? `, ${o.match.subjectRole}` : ""}) — {o.match.reasons[0]}</span>
			{o.record ? <blockquote className="passage">{o.record.passage}</blockquote> : null}
			<div className="stack">
				{o.match.candidates.map((c: Any) => (
					<label key={`${c.ref.type}:${c.ref.id}`} className="check">
						<input type="radio" name={o.match.id} checked={pick === `${c.ref.type}:${c.ref.id}`} onChange={() => setPick(`${c.ref.type}:${c.ref.id}`)} /> {c.name} <span className="muted small">[{c.signals.join(" + ").replace(/_/g, " ")}{c.strong ? ", strong" : ", name only"}]</span>
					</label>
				))}
				{canReview ? (
					<>
						<label className="field">Rationale (the evidence you considered)<input value={note} onChange={(e) => setNote(e.target.value)} /></label>
						<ErrorNote error={a.error} />
						<div className="row">
							<button disabled={a.busy || note.trim().length < 5} onClick={() => decide("confirm")}>They are the same</button>
							<button className="quiet" disabled={a.busy || note.trim().length < 5} onClick={() => decide("reject")}>Not the same</button>
						</div>
					</>
				) : null}
			</div>
		</div>
	);
}

function ModerationPanel({ reload }: { reload: () => void }) {
	const claims = useLoad(() => call<{ items: Any[] }>("claim.pending", {}).then((r) => r.items), []);
	const queue = useLoad(() => call<{ items: Any[] }>("contribution.queue", {}).then((r) => r.items), []);
	return (
		<Section title="Moderation">
			{claims.data?.length ? claims.data.map((c) => <ClaimReview key={c.claim.id} c={c} reload={() => { claims.reload(); reload(); }} />) : <p className="empty">No representative claims are waiting.</p>}
			{queue.data?.length ? (
				<div className="stack">
					<h3>Contributions shared with moderators</h3>
					{queue.data.map((q) => (
						<ContributionResponse key={q.chainId} q={q} as="moderator" reload={() => { queue.reload(); reload(); }} />
					))}
				</div>
			) : null}
		</Section>
	);
}

function ClaimReview({ c, reload }: { c: Any; reload: () => void }) {
	const [why, setWhy] = useState("");
	const [ev, setEv] = useState("");
	const a = useAction();
	const decide = async (decision: "verify" | "reject") => (await a.run(() => call("claim.review", { claimId: c.claim.id, decision, rationale: why, evidence: ev.trim() ? [ev.trim()] : [] }))) && reload();
	return (
		<div className="note" data-testid="claim-review">
			<strong>{c.claim.firmName}</strong> ({c.claim.canonicalDomain}) — {c.claim.relationship}
			<div className="muted small">Domain proof: {c.proof ? (c.proof.proofOk ? "found at the well-known path" : `not confirmed (${c.proof.proofDetail})`) : "not checked yet"}. A proof is evidence of control of the domain, not authority to represent the fund.</div>
			<label className="field">Evidence you reviewed (optional if the domain proof succeeded)<input value={ev} onChange={(e) => setEv(e.target.value)} /></label>
			<label className="field">Rationale<input value={why} onChange={(e) => setWhy(e.target.value)} /></label>
			<ErrorNote error={a.error} />
			<div className="row">
				<button disabled={a.busy || why.trim().length < 10} onClick={() => decide("verify")}>Verify as representative</button>
				<button className="quiet" disabled={a.busy || why.trim().length < 10} onClick={() => decide("reject")}>Reject</button>
			</div>
		</div>
	);
}

function ContributionResponse({ q, as, reload }: { q: Any; as: "moderator" | "firm_representative"; reload: () => void }) {
	const [note, setNote] = useState("");
	const a = useAction();
	const respond = async (action: string) => (await a.run(() => call("contribution.respond", { chainId: q.chainId, action, note, as }))) && (setNote(""), reload());
	return (
		<div className="note" data-testid="shared-contribution">
			<strong>{CATEGORY_LABEL[q.category as keyof typeof CATEGORY_LABEL] ?? q.category}</strong> about {q.firmDomain} — {String(q.kind).replace(/_/g, " ")}{q.claim ? `: ${q.claim.field.replace(/_/g, " ")} ${q.claim.valueRange ? `${q.claim.valueRange.minUsd ?? "?"}–${q.claim.valueRange.maxUsd ?? "?"} USD` : q.claim.value}` : ""}
			<blockquote className="passage">{q.text}</blockquote>
			<div className="muted small">The author is not identified. A dispute is recorded beside the contribution; it does not delete it.</div>
			<label className="field">Your response<input value={note} onChange={(e) => setNote(e.target.value)} /></label>
			<ErrorNote error={a.error} />
			<div className="row">
				<button disabled={a.busy || !note.trim()} onClick={() => respond("confirm")}>Confirm</button>
				<button className="quiet" disabled={a.busy || !note.trim()} onClick={() => respond("dispute")}>Dispute</button>
				<button className="quiet" disabled={a.busy || !note.trim()} onClick={() => respond("dismiss")}>Dismiss</button>
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------------------- claims (investor side)

export function ClaimsPanel() {
	const canClaim = useCan("profile.claim");
	const mine = useLoad(() => (canClaim ? call<{ items: Any[] }>("profile.claim.mine", {}).then((r) => r.items) : Promise.resolve([])), [canClaim]);
	const dir = useLoad(() => call<{ items: Any[] }>("directory.list", {}).then((r) => r.items), []);
	return (
		<div className="stack" data-testid="claims">
			<Section title="Firms with a published profile">
				<p className="muted small">Only what a verified representative chose to publish. Other workspaces' research, notes and approvals are never shown here.</p>
				{dir.data?.length ? (
					<table className="list">
						<thead><tr><th>Firm</th><th>Version</th><th>Published</th><th>Criteria</th></tr></thead>
						<tbody>{dir.data.map((d) => <tr key={d.canonicalDomain}><td>{d.firmName} <span className="muted small">{d.canonicalDomain}</span></td><td>{d.version}</td><td>{when(d.publishedAt)}</td><td>{d.criteriaCount}</td></tr>)}</tbody>
					</table>
				) : (
					<p className="empty">No firm has published a profile yet.</p>
				)}
			</Section>
			{canClaim ? (
				<Section title="Your representative claims">
					<p className="muted small">Signing up does not make you a firm's representative. Request a claim, place the challenge at the well-known path on the firm's website, check the proof, and a moderator decides. Until then you cannot approve or publish anything.</p>
					{mine.data?.map((c) => (
						<ClaimCard key={c.claim.id} c={c} reload={mine.reload} />
					))}
					<RequestClaim onDone={mine.reload} />
				</Section>
			) : null}
		</div>
	);
}

function ClaimCard({ c, reload }: { c: Any; reload: () => void }) {
	const a = useAction();
	const [result, setResult] = useState<string | null>(null);
	return (
		<div className="note" data-testid="my-claim">
			<strong>{c.claim.firmName}</strong> ({c.claim.canonicalDomain}) — <span className={`tag claim-${c.status}`}>{c.status}</span>
			{c.status === "requested" ? (
				<div className="stack">
					<div className="small">Publish this exact text at <code>https://{c.claim.canonicalDomain}/.well-known/attn-invest-claim.txt</code>:</div>
					<code className="digest">{c.claim.challenge}</code>
					<ErrorNote error={a.error} />
					<div className="row">
						<button className="quiet" disabled={a.busy} onClick={async () => { const r = await a.run(() => call<{ event: Any }>("profile.claim.check", { claimId: c.claim.id })); if (r) { setResult(r.event.rationale); reload(); } }}>Check the proof</button>
						{result ? <span className="muted small">{result}</span> : null}
					</div>
				</div>
			) : null}
			<ul className="timeline small">
				{c.events.map((e: Any) => <li key={e.id}>{e.kind.replace(/_/g, " ")} — {e.rationale} <span className="muted">({when(e.at)})</span></li>)}
			</ul>
		</div>
	);
}

function RequestClaim({ onDone }: { onDone: () => void }) {
	const [f, setF] = useState({ domain: "", firmName: "", relationship: "" });
	const a = useAction();
	const submit = async (e: FormEvent) => {
		e.preventDefault();
		if (await a.run(() => call("profile.claim.request", f))) {
			setF({ domain: "", firmName: "", relationship: "" });
			onDone();
		}
	};
	return (
		<form className="stack" onSubmit={submit} data-testid="request-claim">
			<div className="form-grid">
				<label className="field">Firm website<input value={f.domain} onChange={(e) => setF({ ...f, domain: e.target.value })} required placeholder="firm.vc" /></label>
				<label className="field">Firm name<input value={f.firmName} onChange={(e) => setF({ ...f, firmName: e.target.value })} required /></label>
				<label className="field wide">Your role and how it can be confirmed<textarea value={f.relationship} onChange={(e) => setF({ ...f, relationship: e.target.value })} rows={2} required minLength={10} /></label>
			</div>
			<ErrorNote error={a.error} />
			<div><button className="primary" disabled={a.busy}>Request to represent this firm</button></div>
		</form>
	);
}

// ---------------------------------------------------------------------------------------- contributions

export function ContributionsPanel() {
	const canWrite = useCan("contribution.write");
	const canRead = useCan("contribution.read_shared");
	const mine = useLoad(() => (canWrite ? call<{ items: Any[] }>("contribution.mine", {}).then((r) => r.items) : Promise.resolve([])), [canWrite]);
	const claims = useLoad(() => (canRead ? call<{ items: Any[] }>("profile.claim.mine", {}).then((r) => r.items) : Promise.resolve([])), [canRead]);
	const verified = (claims.data ?? []).filter((c) => c.status === "verified");
	return (
		<div className="stack" data-testid="contributions">
			{canWrite ? (
				<Section title="Your contributions (private by default)">
					<p className="muted small">Corrections, firsthand notes and investor-interaction notes stay in your workspace. Sharing is a separate choice, per audience, and can be revoked. Sharing is not publishing.</p>
					{mine.loading && !mine.data ? <Loading what="contributions" /> : null}
					{mine.data?.length ? mine.data.map((m) => <MyContribution key={m.contribution.chainId} m={m} reload={mine.reload} />) : mine.data ? <p className="empty">You have no contributions. Add one from an investor's page.</p> : null}
				</Section>
			) : null}
			{verified.map((v) => <SharedWithMe key={v.claim.id} domain={v.claim.canonicalDomain} name={v.claim.firmName} />)}
		</div>
	);
}

function MyContribution({ m, reload }: { m: Any; reload: () => void }) {
	const [aggregate, setAggregate] = useState(false);
	const a = useAction();
	const c = m.contribution;
	const shared = (kind: string) => m.audiences.some((x: Any) => x.audience.kind === kind);
	const share = (audience: Any) => a.run(() => call("contribution.share", { chainId: c.chainId, audience, aggregateConsent: aggregate })).then((r) => r && reload());
	const revoke = (audience: Any) => a.run(() => call("contribution.revoke", { chainId: c.chainId, audience })).then((r) => r && reload());
	return (
		<div className="note" data-testid="my-contribution">
			<strong>{String(c.kind).replace(/_/g, " ")}</strong> about {c.firmDomain} <span className={`tag lc-tag-${m.lifecycle === "private" ? "proposed" : m.lifecycle}`}>{m.visibility === "private" ? "Private" : `Shared · ${m.lifecycle}`}</span>
			{c.hostile ? <span className="flag conflict">Instruction-like text: receivers will not see it</span> : null}
			<blockquote className="passage">{c.text}</blockquote>
			{m.responses.map((r: Any) => <div key={r.at + r.action} className="small"><strong>{r.by === "moderator" ? "Moderator" : "The firm"} {r.action}d:</strong> {r.note} <span className="muted">({when(r.at)}). Your contribution and evidence are kept.</span></div>)}
			<ErrorNote error={a.error} />
			<div className="row">
				{shared("firm") ? <button className="quiet" disabled={a.busy} onClick={() => revoke({ kind: "firm", domain: c.firmDomain })}>Stop sharing with the firm</button> : <button className="quiet" disabled={a.busy} onClick={() => share({ kind: "firm", domain: c.firmDomain })}>Share with the firm</button>}
				{shared("moderator") ? <button className="quiet" disabled={a.busy} onClick={() => revoke({ kind: "moderator" })}>Stop sharing with moderators</button> : <button className="quiet" disabled={a.busy} onClick={() => share({ kind: "moderator" })}>Share with moderators</button>}
				<label className="check small"><input type="checkbox" checked={aggregate} onChange={(e) => setAggregate(e.target.checked)} /> Also allow use in future aggregate analysis (off by default; applies when you share)</label>
			</div>
		</div>
	);
}

function SharedWithMe({ domain, name }: { domain: string; name: string }) {
	const { data, reload } = useLoad(() => call<{ items: Any[] }>("contribution.shared", { domain }).then((r) => r.items), [domain]);
	return (
		<Section title={`Shared with ${name}`}>
			{data?.length ? data.map((q) => <ContributionResponse key={q.chainId} q={q} as="firm_representative" reload={reload} />) : <p className="empty">Nothing has been shared with your firm.</p>}
		</Section>
	);
}

export type { ContributionKind };
