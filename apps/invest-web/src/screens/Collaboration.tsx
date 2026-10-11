import { type FormEvent, useState } from "react";
import type { ContributionKind, FieldReconciliation, LifecycleState, ReconciledClaim, SourceCategory } from "../../../../invest/domain/collab.ts";
import { call } from "../api.ts";
import { ErrorNote, Loading, Section, href, useAction, useCan, useLoad, when } from "../ui.tsx";

/* Provenance is never collapsed into one badge: category, assertion, directness, lifecycle and freshness are shown separately. */
export const CATEGORY_LABEL: Record<SourceCategory, string> = {
	investor_verified: "Published by the firm",
	official_public_source: "Firm's own site",
	third_party_source: "Third-party source",
	founder_contribution: "Founder contribution",
	community_contribution: "Community contribution",
};
const LIFECYCLE_LABEL: Record<LifecycleState, string> = { proposed: "Proposed", needs_review: "Needs review", accepted: "Accepted as evidence", rejected: "Rejected", disputed: "Disputed", superseded: "Superseded" };
const DIRECT_LABEL: Record<string, string> = { subject_stated: "stated by the firm", reported_by_third_party: "reported by a third party", contributed: "a participant's account", observed_activity: "observed activity", inferred_pattern: "inferred pattern" };

export function CategoryBadge({ value }: { value: SourceCategory }) {
	return <span className={`tag cat-${value}`}>{CATEGORY_LABEL[value]}</span>;
}

const isHttps = (u: string | null) => !!u && /^https:\/\//i.test(u);

// ---------------------------------------------------------------------------------------- reconciliation on a firm page

export function ReconciliationSection({ firmId, canReview, version }: { firmId: string; canReview: boolean; version: number }) {
	const { data, error, loading, reload } = useLoad(() => call<{ reconciliation: { fields: FieldReconciliation[]; published: { version: number; publishedAt: string } | null; counts: Record<SourceCategory, number> } }>("firm.reconciliation", { firmId }).then((r) => r.reconciliation), [firmId, version]);
	if (loading && !data) return <Section title="Sources and reconciliation"><Loading what="reconciliation" /></Section>;
	if (!data) return <ErrorNote error={error} />;
	return (
		<Section title="Sources and reconciliation">
			<p className="muted small">Every claim keeps its own source category, assertion type, age and reviewer decision. There is no single confidence score: read the reasons. Accepting a claim records that a person judged the evidence; it never makes it investor-verified.</p>
			{data.published ? <div className="note ok" data-testid="published-note">The firm has published an investor-approved profile (version {data.published.version}, {when(data.published.publishedAt)}). Other sources do not override it.</div> : null}
			<div className="row small" data-testid="category-counts">
				{(Object.keys(CATEGORY_LABEL) as SourceCategory[]).map((c) => (
					<span key={c} className={`tag cat-${c}`}>
						{CATEGORY_LABEL[c]}: {data.counts[c]}
					</span>
				))}
			</div>
			{!data.fields.length ? <p className="empty">No claims from any source yet: unknown.</p> : null}
			<div className="stack">
				{data.fields.map((f) => (
					<FieldCard key={f.field} firmId={firmId} f={f} canReview={canReview} reload={reload} />
				))}
			</div>
		</Section>
	);
}

function FieldCard({ firmId, f, canReview, reload }: { firmId: string; f: FieldReconciliation; canReview: boolean; reload: () => void }) {
	return (
		<details className={`criterion recon recon-${f.status}`} open={f.status === "conflicted"} data-testid={`field-${f.field}`}>
			<summary>
				<span className="rc-label">{f.field.replace(/_/g, " ")}</span>
				<span className={`tag recon-status-${f.status}`}>{f.status === "agreed" ? "Independent sources agree" : f.status === "conflicted" ? "Conflicted" : "One source"}</span>
				{f.conflicts.length ? <span className="flag conflict">{f.conflicts.length} conflict{f.conflicts.length === 1 ? "" : "s"}</span> : null}
				{f.approved.length ? <span className="tag cat-investor_verified">Approved value stands</span> : null}
			</summary>
			<div className="stack">
				<ul className="timeline">
					{f.explanation.map((e) => (
						<li key={e}>{e}</li>
					))}
				</ul>
				{f.conflicts.map((c) => (
					<div key={c.id} className="note warn" data-testid="conflict">
						<strong>{c.kind.replace(/_/g, " ")}</strong> ({c.reviewState}): {c.summary}
						<div className="muted small">{c.reasons.join("; ")}</div>
					</div>
				))}
				<div className="table-wrap">
					<table className="list">
						<thead>
							<tr>
								<th>Claim</th>
								<th>Source</th>
								<th>Kind of statement</th>
								<th>Status</th>
								<th />
							</tr>
						</thead>
						<tbody>
							{f.claims.map((c) => (
								<ClaimRow key={c.key} firmId={firmId} c={c} canReview={canReview} reload={reload} />
							))}
						</tbody>
					</table>
				</div>
			</div>
		</details>
	);
}

function ClaimRow({ firmId, c, canReview, reload }: { firmId: string; c: ReconciledClaim; canReview: boolean; reload: () => void }) {
	const [open, setOpen] = useState(false);
	const [note, setNote] = useState("");
	const a = useAction();
	const reviewable = c.claimRef.kind === "claim";
	const act = async (action: "confirm" | "dismiss" | "dispute") => {
		if (await a.run(() => call("firm.review", { firmId, claimId: c.claimRef.id, action, note }))) {
			setNote("");
			reload();
		}
	};
	return (
		<>
			<tr className={`claim lc-${c.lifecycle}`} data-lifecycle={c.lifecycle}>
				<td>
					{c.polarity === "exclude" ? "Excludes " : ""}
					<strong>{c.label}</strong>
				</td>
				<td>
					<CategoryBadge value={c.signals.category} /> <span className="muted small">{c.publisher}</span>
				</td>
				<td>
					<span className={`tag assert-${c.signals.assertionType}`}>{c.signals.assertionType}</span> <span className="muted small">{DIRECT_LABEL[c.signals.directness]}</span>
					<div className="muted small">
						{c.signals.ageDays} day(s) old{c.signals.freshness === "stale" ? " · stale" : ""}
						{c.signals.corroboratedBy > 1 ? ` · ${c.signals.corroboratedBy} independent publishers` : ""}
					</div>
				</td>
				<td>
					<span className={`tag lc-tag-${c.lifecycle}`}>{LIFECYCLE_LABEL[c.lifecycle]}</span>
				</td>
				<td>
					<button className="quiet" onClick={() => setOpen(!open)} aria-expanded={open}>
						{open ? "Hide evidence" : "Evidence"}
					</button>
				</td>
			</tr>
			{open ? (
				<tr>
					<td colSpan={5}>
						<div className="stack">
							<blockquote className="passage" data-testid="claim-passage">
								{c.passage}
							</blockquote>
							<div className="small">{c.url ? isHttps(c.url) ? <a href={c.url} target="_blank" rel="noopener noreferrer nofollow">{c.url}</a> : c.url : "No link: published through the platform."}</div>
							<ul className="timeline small">
								{c.reasons.map((r) => (
									<li key={r}>{r}</li>
								))}
							</ul>
							{canReview && reviewable ? (
								<div className="stack review-form">
									<label className="field">
										Review note
										<input value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
									</label>
									<ErrorNote error={a.error} />
									<div className="row">
										<button disabled={a.busy || !note.trim()} onClick={() => act("confirm")}>Accept as evidence</button>
										<button className="quiet" disabled={a.busy || !note.trim()} onClick={() => act("dispute")}>Dispute</button>
										<button className="quiet" disabled={a.busy || !note.trim()} onClick={() => act("dismiss")}>Reject</button>
									</div>
								</div>
							) : null}
						</div>
					</td>
				</tr>
			) : null}
		</>
	);
}

// ---------------------------------------------------------------------------------------- history

type HistoryItem = { at: string; kind: string; actor: string; authority: string; summary: string; note: string; ref: string };
export function ProfileHistorySection({ firmId, version }: { firmId: string; version: number }) {
	const { data } = useLoad(() => call<{ items: HistoryItem[] }>("profile.history", { firmId }).then((r) => r.items), [firmId, version]);
	if (!data?.length) return null;
	return (
		<Section title="Profile history">
			<ul className="timeline" data-testid="profile-history">
				{data.map((h) => (
					<li key={h.ref}>
						<strong>{h.summary}</strong> by {h.actor} ({h.authority === "firm_representative" ? "as the firm's representative" : "as this workspace"}), {when(h.at)}. {h.note}
					</li>
				))}
			</ul>
		</Section>
	);
}

// ---------------------------------------------------------------------------------------- representative panel on a firm page

type Claim = { claim: { id: string; canonicalDomain: string; firmName: string; challenge: string }; status: string; events: { kind: string; at: string; rationale: string }[] };
export function RepresentativePanel({ firmId, domain, approvals, reload }: { firmId: string; domain: string; approvals: { id: string; field: string; value: string; kind: string; authority?: string }[]; reload: () => void }) {
	const can = useCan("profile.publish");
	const { data } = useLoad(() => (can ? call<{ items: Claim[] }>("profile.claim.mine", {}).then((r) => r.items) : Promise.resolve([])), [can]);
	const [picked, setPicked] = useState<string[]>([]);
	const a = useAction();
	if (!can) return null;
	const mine = data?.find((c) => c.claim.canonicalDomain === domain);
	const repApprovals = approvals.filter((x) => x.authority === "firm_representative" && x.kind === "approve");
	return (
		<Section title="Your authority over this profile">
			{!mine || mine.status !== "verified" ? (
				<p className="empty" data-testid="no-authority">You are not a verified representative of this firm{mine ? ` (claim ${mine.status})` : ""}. Approving and publishing criteria needs a moderator-verified claim. Request one under Investors → Claims.</p>
			) : (
				<div className="stack" data-testid="authority">
					<div className="note ok">Verified representative of {mine.claim.firmName}. Approving a criterion below records it as the firm's own; publishing makes exactly the selected ones visible to every workspace.</div>
					{repApprovals.length ? (
						<>
							{repApprovals.map((x) => (
								<label key={x.id} className="check">
									<input type="checkbox" checked={picked.includes(x.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, x.id] : picked.filter((p) => p !== x.id))} /> {x.field.replace(/_/g, " ")}: {x.value.replace(/_/g, " ")}
								</label>
							))}
							<ErrorNote error={a.error} />
							<div className="row">
								<button
									className="primary"
									disabled={a.busy || !picked.length}
									onClick={async () => {
										if (await a.run(() => call("profile.publish", { firmId, approvalIds: picked, note: "" }))) {
											setPicked([]);
											reload();
										}
									}}
								>
									Publish selected criteria
								</button>
								<button className="quiet" disabled={a.busy} onClick={async () => (await a.run(() => call("profile.unpublish", { firmId, note: "Withdrawn from the browser." }))) && reload()}>
									Withdraw published profile
								</button>
							</div>
						</>
					) : (
						<p className="muted">No representative-approved criteria yet. Use "Approve as the firm" on a criterion above.</p>
					)}
				</div>
			)}
		</Section>
	);
}

export function ApproveAsFirmButton({ firmId, criterionId, domain, reload }: { firmId: string; criterionId: string; domain: string; reload: () => void }) {
	const can = useCan("profile.publish");
	const { data } = useLoad(() => (can ? call<{ items: Claim[] }>("profile.claim.mine", {}).then((r) => r.items) : Promise.resolve([])), [can]);
	const [note, setNote] = useState("");
	const [open, setOpen] = useState(false);
	const a = useAction();
	if (!can || data?.find((c) => c.claim.canonicalDomain === domain)?.status !== "verified") return null;
	return open ? (
		<div className="stack">
			<label className="field">
				Why you approve this as the firm
				<input value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
			</label>
			<ErrorNote error={a.error} />
			<div className="row">
				<button className="primary" disabled={a.busy || !note.trim()} onClick={async () => (await a.run(() => call("profile.approve", { firmId, criterionId, note }))) && (setOpen(false), reload())}>
					Approve as the firm
				</button>
				<button className="quiet" onClick={() => setOpen(false)}>Cancel</button>
			</div>
		</div>
	) : (
		<button className="quiet" onClick={() => setOpen(true)}>Approve as the firm…</button>
	);
}

// ---------------------------------------------------------------------------------------- contribution form

const KIND_LABEL: Record<ContributionKind, string> = { correction: "Correct a criterion", firsthand_note: "Firsthand note", flag_outdated: "Flag as outdated", suggest_relationship: "Suggest a portfolio relationship", interaction_note: "Record an investor interaction" };
const FIELDS = ["stage", "sector", "geography", "check_size", "business_model", "company_characteristics", "traction"];

export function ContributionForm({ domain, onDone }: { domain: string; onDone?: () => void }) {
	const can = useCan("contribution.write");
	const [kind, setKind] = useState<ContributionKind>("correction");
	const [field, setField] = useState("check_size");
	const [value, setValue] = useState("");
	const [min, setMin] = useState("");
	const [max, setMax] = useState("");
	const [text, setText] = useState("");
	const [url, setUrl] = useState("");
	const [done, setDone] = useState(false);
	const a = useAction();
	if (!can) return null;
	const structured = kind === "correction" || kind === "flag_outdated";
	const submit = async (e: FormEvent) => {
		e.preventDefault();
		const body: Record<string, unknown> = { kind, firmDomain: domain, text, ...(url.trim() ? { evidenceUrls: [url.trim()] } : {}) };
		if (structured && (kind === "correction" || value || min || max)) {
			body.field = field;
			if (field === "check_size") {
				if (min) body.minUsd = Number(min);
				if (max) body.maxUsd = Number(max);
			} else body.value = value;
		}
		if (await a.run(() => call("contribution.create", body))) {
			setText("");
			setValue("");
			setMin("");
			setMax("");
			setUrl("");
			setDone(true);
			onDone?.();
		}
	};
	return (
		<form className="stack" onSubmit={submit} data-testid="contribution-form">
			<div className="row">
				<label className="field">
					What you are contributing
					<select value={kind} onChange={(e) => setKind(e.target.value as ContributionKind)}>
						{(Object.keys(KIND_LABEL) as ContributionKind[]).map((k) => (
							<option key={k} value={k}>
								{KIND_LABEL[k]}
							</option>
						))}
					</select>
				</label>
				{structured ? (
					<label className="field">
						Field
						<select value={field} onChange={(e) => setField(e.target.value)}>
							{FIELDS.map((f) => (
								<option key={f} value={f}>
									{f.replace(/_/g, " ")}
								</option>
							))}
						</select>
					</label>
				) : null}
				{structured && field === "check_size" ? (
					<>
						<label className="field">
							Minimum (USD)
							<input type="number" min={0} value={min} onChange={(e) => setMin(e.target.value)} />
						</label>
						<label className="field">
							Maximum (USD)
							<input type="number" min={0} value={max} onChange={(e) => setMax(e.target.value)} />
						</label>
					</>
				) : structured ? (
					<label className="field">
						Value
						<input value={value} onChange={(e) => setValue(e.target.value)} placeholder="seed" />
					</label>
				) : null}
			</div>
			<label className="field">
				Details
				<textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={4000} required />
				<span className="hint">Private to your workspace. Nothing is shared or published unless you choose to share it.</span>
			</label>
			<label className="field">
				Public evidence link (optional, https)
				<input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" />
			</label>
			<ErrorNote error={a.error} />
			{done ? <div className="note ok">Saved privately. Share it from Investors → Contributions when you are ready.</div> : null}
			<div>
				<button className="primary" disabled={a.busy || !text.trim()}>
					Save privately
				</button>
			</div>
		</form>
	);
}

export { href };
