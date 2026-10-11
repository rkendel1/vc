import { useState } from "react";
import { call } from "../api.ts";
import { clip } from "../format.ts";
import { SOURCE_CATEGORY } from "../vocab.ts";
import { Badge, ConfirmButton, EmptyState, ErrorNote, Loading, Notice, PageHead, Section, href, useAction, useCan, useLoad, when } from "../ui.tsx";

type Any = Record<string, any>; // eslint-disable-line

const DECISION_EVENTS = ["claim.verified", "claim.rejected", "claim.revoked", "match.confirmed", "match.rejected", "contribution.responded"];
const DECISION_LABEL: Record<string, string> = {
	"claim.verified": "Verified a representative",
	"claim.rejected": "Rejected a representative claim",
	"claim.revoked": "Revoked a representative",
	"match.confirmed": "Confirmed two records are the same entity",
	"match.rejected": "Decided two records are different entities",
	"contribution.responded": "Responded to a shared contribution",
};
const decisionText = (e: Any) => DECISION_LABEL[e.eventType] ?? e.eventType;

/**
 * The moderator's start page: what needs a decision, most consequential first, with the evidence beside each item.
 * Four different decisions live here and are worded differently on purpose: verifying a representative, resolving an entity match,
 * responding to a shared contribution, and reviewing conflicting claims. None of them approves a firm's criteria; only the firm can.
 */
export function ReviewScreen() {
	const claims = useLoad(() => call<{ items: Any[] }>("claim.pending", {}).then((r) => r.items), []);
	const matches = useLoad(() => call<{ open: Any[]; history: Any[] }>("match.list", {}), []);
	const shared = useLoad(() => call<{ items: Any[] }>("contribution.queue", {}).then((r) => r.items), []);
	const inbox = useLoad(() => call<{ items: Any[] }>("inbox.list", {}).then((r) => r.items), []);
	const directory = useLoad(() => call<{ items: Any[] }>("claim.directory", {}).then((r) => r.items), []);
	const history = useLoad(() => call<{ items: Any[] }>("audit.list", { limit: 200 }).then((r) => r.items), []);
	const reloadAll = () => {
		void claims.reload();
		void matches.reload();
		void shared.reload();
		void inbox.reload();
		void history.reload();
		void directory.reload();
	};
	const conflicts = (inbox.data ?? []).filter((i) => i.kind === "conflict" || i.kind === "proposed_claim");
	const counts = { claims: claims.data?.length ?? 0, matches: matches.data?.open.length ?? 0, shared: shared.data?.length ?? 0, conflicts: conflicts.length };
	const total = counts.claims + counts.matches + counts.shared + counts.conflicts;
	const loaded = claims.data && matches.data && shared.data && inbox.data;
	const errors = claims.error ?? matches.error ?? shared.error ?? inbox.error;
	const recent = (history.data ?? []).filter((e) => DECISION_EVENTS.includes(e.eventType)).slice(0, 12);
	return (
		<>
			<PageHead title="Review queue" sub="Everything waiting for a decision, most consequential first. Each decision needs a reason, is recorded with your name, and can be seen in History." />
			{!loaded && !errors ? <Loading what="your queue" /> : <ErrorNote error={errors} />}
			{loaded ? (
				<>
					<ul className="queue-summary plain" aria-label="Waiting for review" data-testid="queue-summary">
						<li><a href="#claims-section"><strong>{counts.claims}</strong> representative {counts.claims === 1 ? "claim" : "claims"}</a></li>
						<li><a href="#matches-section"><strong>{counts.matches}</strong> entity {counts.matches === 1 ? "match" : "matches"}</a></li>
						<li><a href="#shared-section"><strong>{counts.shared}</strong> shared {counts.shared === 1 ? "contribution" : "contributions"}</a></li>
						<li><a href="#conflicts-section"><strong>{counts.conflicts}</strong> {counts.conflicts === 1 ? "conflict or proposal" : "conflicts and proposals"}</a></li>
					</ul>
					{total === 0 ? <EmptyState title="Nothing needs your decision">New representative claims, entity matches and shared contributions appear here as they arrive.</EmptyState> : null}

					{counts.claims ? (<Section title={`Representative claims (${counts.claims})`} id="claims-section">
						<p className="muted small">Verifying lets a person approve and publish a firm's criteria for every workspace to see. A domain proof shows control of the website; it does not show authority to speak for the firm.</p>
						{claims.data!.map((c) => <ClaimReview key={c.claim.id} c={c} reload={reloadAll} />)}
					</Section>) : null}

					{counts.matches ? (<Section title={`Entity matches (${counts.matches})`} id="matches-section">
						<p className="muted small">A name alone never merges two records. Confirm only with evidence that they are the same entity; a rejected pairing is remembered and not proposed again. Nothing is merged destructively.</p>
						{matches.data!.open.map((o) => <MatchCard key={o.match.id} o={o} reload={reloadAll} />)}
					</Section>) : null}

					{counts.shared ? (<Section title={`Shared contributions (${counts.shared})`} id="shared-section">
						{shared.data!.map((q) => <ContributionResponse key={q.chainId} q={q} reload={reloadAll} />)}
					</Section>) : null}

					{counts.conflicts ? (<Section title={`Conflicts and proposals (${counts.conflicts})`} id="conflicts-section">
						{conflicts.length ? (
							<ul className="timeline">
								{conflicts.map((i, n) => (
									<li key={n}>
										{i.firmId ? <a href={href("investors", i.firmId)}>{i.title}</a> : i.title} <span className="muted small">{clip(i.detail, 160)} · {when(i.at)}</span>
									</li>
								))}
							</ul>
						) : null}
					</Section>) : null}

					<Section title={`Representatives you have decided (${directory.data?.length ?? 0})`} id="directory-section">
						<p className="muted small">Who is verified for which firm, on what basis. Revoking ends one person's authority; it does not touch anyone else's, and nothing already published is erased from the history.</p>
						{directory.data?.length ? directory.data.map((d) => <DecidedClaim key={d.claim.id} d={d} reload={reloadAll} />) : <p className="empty">No claim has been decided yet.</p>}
					</Section>

					<Section title="Recent decisions" actions={<a href={href("history")}>Full history</a>}>
						{recent.length ? (
							<ul className="timeline" data-testid="recent-decisions">
								{recent.map((e) => (
									<li key={e.id}>
										<strong>{decisionText(e)}</strong> by {e.actorId}, {when(e.timestamp)}
										{e.payload?.domain ? ` — ${e.payload.domain}` : e.payload?.name ? ` — "${e.payload.name}"` : ""}
										{e.payload?.rationale ? <span className="muted small"> ({clip(String(e.payload.rationale), 120)})</span> : null}
									</li>
								))}
							</ul>
						) : (
							<p className="empty">No decisions recorded yet.</p>
						)}
					</Section>
				</>
			) : null}
		</>
	);
}

function ClaimReview({ c, reload }: { c: Any; reload: () => void }) {
	const [why, setWhy] = useState("");
	const [ev, setEv] = useState("");
	const a = useAction();
	const proof = c.proof as { proofOk: boolean; proofDetail: string } | null;
	const ready = why.trim().length >= 10;
	const decide = (decision: "verify" | "reject") => async () => {
		if (await a.run(() => call("claim.review", { claimId: c.claim.id, decision, rationale: why.trim(), evidence: ev.trim() ? [ev.trim()] : [], expectedStatus: "requested" }))) reload();
	};
	return (
		<article className="card review-card" data-testid="claim-review">
			<h3>
				{c.claim.firmName} <span className="muted small">{c.claim.canonicalDomain}</span>
			</h3>
			<dl className="facts">
				<div>
					<dt>Their account of their role</dt>
					<dd>
						{c.claim.relationship} <span className="muted small">(self-reported, not independent evidence)</span>
					</dd>
				</div>
				<div>
					<dt>Domain proof</dt>
					<dd>
						{proof ? <Badge tone={proof.proofOk ? "ok" : "caution"}>{proof.proofOk ? "Found at the well-known address" : "Not confirmed"}</Badge> : <Badge tone="unknown">Not checked yet</Badge>}{" "}
						<span className="muted small">{proof?.proofOk ? "Shows control of the firm's website." : proof ? proof.proofDetail : "They have not run the check."}</span>
					</dd>
				</div>
				<div>
					<dt>Requested</dt>
					<dd>{when(c.claim.requestedAt)}</dd>
				</div>
			</dl>
			<label className="field">
				Evidence you reviewed <span className="muted small">(optional if the domain proof succeeded)</span>
				<input value={ev} onChange={(e) => setEv(e.target.value)} />
			</label>
			<label className="field">
				Your reason <span className="muted small">(required, at least 10 characters; recorded with your name)</span>
				<input value={why} onChange={(e) => setWhy(e.target.value)} />
			</label>
			<ErrorNote error={a.error} />
			<div className="row">
				<ConfirmButton
					label="Verify as representative…"
					className="primary"
					disabled={a.busy || !ready}
					title={`Verify a representative of ${c.claim.firmName}?`}
					confirmLabel="Verify representative"
					consequence={<p>They will be able to approve and publish {c.claim.firmName}'s criteria, which every workspace can then see. You can revoke this later; the decision and your reason are recorded.</p>}
					onConfirm={decide("verify")}
				/>
				<ConfirmButton
					label="Reject…"
					className="quiet"
					disabled={a.busy || !ready}
					title={`Reject the claim for ${c.claim.firmName}?`}
					confirmLabel="Reject claim"
					danger
					consequence={<p>They will not be able to approve or publish for this firm. Your reason is shown to them and recorded.</p>}
					onConfirm={decide("reject")}
				/>
			</div>
		</article>
	);
}

function MatchCard({ o, reload }: { o: Any; reload: () => void }) {
	const canReview = useCan("review.write");
	const first = o.match.candidates[0];
	const [pick, setPick] = useState<string>(first ? `${first.ref.type}:${first.ref.id}` : "");
	const [note, setNote] = useState("");
	const a = useAction();
	const ready = note.trim().length >= 5;
	const chosen = o.match.candidates.find((c: Any) => `${c.ref.type}:${c.ref.id}` === pick);
	const decide = (decision: "confirm" | "reject") => async () => {
		const [entityType, ...rest] = pick.split(":");
		if (await a.run(() => call("match.decide", { matchId: o.match.id, decision, entityType, entityId: rest.join(":"), rationale: note.trim() }))) reload();
	};
	return (
		<article className="card review-card" data-testid="match-card">
			<h3>
				"{o.match.subjectName}" <span className="muted small">may be one of these</span>
			</h3>
			<p className="muted small">
				From {o.record?.sourceUrl ? "the source record" : `a ${String(o.match.subject).replace(/_/g, " ")}`}: {o.match.reasons[0]}
			</p>
			{o.record ? <blockquote className="passage">{clip(o.record.passage, 400)}</blockquote> : null}
			<fieldset className="stack">
				<legend className="small">Which existing record could it be?</legend>
				{o.match.candidates.map((c: Any) => (
					<label key={`${c.ref.type}:${c.ref.id}`} className="check">
						<input type="radio" name={o.match.id} checked={pick === `${c.ref.type}:${c.ref.id}`} onChange={() => setPick(`${c.ref.type}:${c.ref.id}`)} /> <strong>{c.name}</strong>{" "}
						<span className="muted small">
							matched on {c.signals.map((s: string) => s.replace(/_/g, " ")).join(" and ")} — {c.strong ? "a strong signal" : "name only, which is never enough on its own"}
						</span>
					</label>
				))}
			</fieldset>
			{canReview ? (
				<>
					<label className="field">
						The evidence you considered <span className="muted small">(at least 5 characters)</span>
						<input value={note} onChange={(e) => setNote(e.target.value)} />
					</label>
					<ErrorNote error={a.error} />
					<div className="row">
						<ConfirmButton label="They are the same…" disabled={a.busy || !ready || !chosen} title="Confirm that these are the same entity?" confirmLabel="Confirm: same entity" consequence={<p>"{o.match.subjectName}" will be treated as {chosen?.name}. Nothing is merged or deleted, and the decision is recorded with your reason.</p>} onConfirm={decide("confirm")} />
						<ConfirmButton label="Not the same…" className="quiet" disabled={a.busy || !ready || !chosen} title="Record that these are different entities?" confirmLabel="Confirm: different entities" consequence={<p>This pairing is remembered and will not be proposed again.</p>} onConfirm={decide("reject")} />
					</div>
				</>
			) : (
				<Notice>You can read this match; deciding it needs review permission.</Notice>
			)}
		</article>
	);
}

function ContributionResponse({ q, reload }: { q: Any; reload: () => void }) {
	const [note, setNote] = useState("");
	const a = useAction();
	const respond = (action: string) => async () => {
		if (await a.run(() => call("contribution.respond", { chainId: q.chainId, action, note, as: "moderator" }))) {
			setNote("");
			reload();
		}
	};
	return (
		<article className="card review-card" data-testid="shared-contribution">
			<h3>
				{SOURCE_CATEGORY[q.category] ?? q.category} about {q.firmDomain} <span className="muted small">{String(q.kind).replace(/_/g, " ")}</span>
			</h3>
			{q.claim ? (
				<p className="small">
					Says: {String(q.claim.field).replace(/_/g, " ")} {q.claim.valueRange ? `${q.claim.valueRange.minUsd ?? "?"}–${q.claim.valueRange.maxUsd ?? "?"} USD` : q.claim.value}
				</p>
			) : null}
			<blockquote className="passage">{q.text}</blockquote>
			<p className="muted small">The author is not identified. A dispute is recorded beside the contribution; it never deletes it.</p>
			<label className="field">
				Your response <span className="muted small">(required)</span>
				<input value={note} onChange={(e) => setNote(e.target.value)} />
			</label>
			<ErrorNote error={a.error} />
			<div className="row">
				<button type="button" disabled={a.busy || !note.trim()} onClick={respond("confirm")}>
					Accept as evidence
				</button>
				<button type="button" className="quiet" disabled={a.busy || !note.trim()} onClick={respond("dispute")}>
					Dispute
				</button>
				<button type="button" className="quiet" disabled={a.busy || !note.trim()} onClick={respond("dismiss")}>
					Dismiss
				</button>
			</div>
		</article>
	);
}

function DecidedClaim({ d, reload }: { d: Any; reload: () => void }) {
	const [why, setWhy] = useState("");
	const [keep, setKeep] = useState(false);
	const a = useAction();
	const status = d.status as string;
	const ready = why.trim().length >= 10;
	const verified = status === "verified";
	const decide = (decision: "verify" | "revoke") => async () => {
		if (await a.run(() => call("claim.review", { claimId: d.claim.id, decision, rationale: why.trim(), expectedStatus: status, ...(decision === "revoke" && keep ? { keepPublished: true } : {}), ...(decision === "verify" ? { evidence: [] } : {}) }))) {
			setWhy("");
			reload();
		}
	};
	const last = d.events.filter((e: Any) => ["verified", "rejected", "revoked"].includes(e.kind)).at(-1);
	const publishedHere = d.published && !d.published.withdrawn && d.published.publishedByThisClaim;
	return (
		<article className="card review-card" data-testid="decided-claim" data-status={status}>
			<h3>
				{d.claim.firmName} <span className="muted small">{d.claim.canonicalDomain}</span> <Badge tone={verified ? "ok" : "bad"}>{verified ? "Verified" : status === "revoked" ? "Revoked" : "Rejected"}</Badge>
			</h3>
			<dl className="facts">
				<div>
					<dt>Decision</dt>
					<dd>
						{last ? `${DECISION_LABEL[`claim.${last.kind}`] ?? last.kind} by ${last.actorId}, ${when(last.at)}: ${last.rationale}` : "—"}
					</dd>
				</div>
				<div>
					<dt>Basis</dt>
					<dd>
						{d.lastProof ? (d.lastProof.proofOk ? "Domain proof found" : "Domain proof not found") : "No domain proof checked"}
						{last?.data?.evidence?.length ? `; ${last.data.evidence.length} item(s) of evidence you reviewed` : ""}
					</dd>
				</div>
				<div>
					<dt>What they did</dt>
					<dd>
						{d.representativeApprovals} criteria approved as the firm; {d.published ? (d.published.withdrawn ? `last published version ${d.published.version} was withdrawn` : `version ${d.published.version} is published${d.published.publishedByThisClaim ? " by this representative" : " by someone else"}`) : "nothing published"}
					</dd>
				</div>
				<div>
					<dt>Others with authority for this firm</dt>
					<dd>{d.otherVerifiedRepresentatives}</dd>
				</div>
			</dl>
			<details>
				<summary>Full history ({d.events.length})</summary>
				<ul className="timeline small">
					{d.events.map((e: Any) => (
						<li key={e.id}>
							<strong>{String(e.kind).replace(/_/g, " ")}</strong> by {e.actorId}, {when(e.at)} — {clip(e.rationale, 200)}
						</li>
					))}
				</ul>
			</details>
			<label className="field">
				Your reason <span className="muted small">(required, at least 10 characters; recorded with your name)</span>
				<input value={why} onChange={(e) => setWhy(e.target.value)} />
			</label>
			<ErrorNote error={a.error} />
			{verified ? (
				<div className="stack">
					{publishedHere ? (
						<label className="check small">
							<input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} /> Keep what they published visible (by default it is withdrawn with their authority)
						</label>
					) : null}
					<ConfirmButton
						label="Revoke verification…"
						className="quiet danger"
						danger
						disabled={a.busy || !ready}
						title={`Revoke ${d.claim.firmName}'s representative?`}
						confirmLabel="Revoke verification"
						consequence={
							<div className="stack">
								<p>This person can no longer approve, withdraw approvals, publish or unpublish for {d.claim.firmName}, immediately, including from a page they already have open.</p>
								<p>{d.otherVerifiedRepresentatives ? `${d.otherVerifiedRepresentatives} other verified representative(s) keep their own authority.` : "Nobody else is verified for this firm."}</p>
								<p>{publishedHere ? (keep ? "What they published stays visible." : `The published profile (version ${d.published.version}) is withdrawn; its history and provenance stay.`) : "Nothing they published is affected."} Their approvals stay on record. The decision and your reason are recorded in both histories.</p>
							</div>
						}
						onConfirm={decide("revoke")}
					/>
				</div>
			) : (
				<ConfirmButton
					label="Verify again…"
					disabled={a.busy || !ready}
					title={`Verify ${d.claim.firmName}'s representative again?`}
					confirmLabel="Verify representative"
					consequence={<p>This needs a domain proof checked after the last decision. They can then approve and publish for {d.claim.firmName} again.</p>}
					onConfirm={decide("verify")}
				/>
			)}
		</article>
	);
}
