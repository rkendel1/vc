import { type FormEvent, useState } from "react";
import { call } from "../api.ts";
import { usdRange } from "../format.ts";
import { CLAIM, SOURCE_CATEGORY, entry } from "../vocab.ts";
import { Badge, EmptyState, ErrorNote, Loading, Notice, PageHead, Section, Steps, href, useAction, useLoad, when } from "../ui.tsx";

type Any = Record<string, any>; // eslint-disable-line

/**
 * An investor representative's page. Three things are kept apart on purpose, each with its own status: the claim (am I who I say I am),
 * verification (did a moderator accept it), and publication (what every workspace can currently see).
 */
export function FirmScreen() {
	const mine = useLoad(() => call<{ items: Any[] }>("profile.claim.mine", {}).then((r) => r.items), []);
	const firms = useLoad(() => call<{ items: Any[] }>("firm.list", {}).then((r) => r.items), []);
	const directory = useLoad(() => call<{ items: Any[] }>("directory.list", {}).then((r) => r.items), []);
	const reloadAll = () => {
		void mine.reload();
		void firms.reload();
		void directory.reload();
	};
	return (
		<>
			<PageHead title="My firm" sub="Claim your firm's profile, prove you control its website, and publish the criteria you approve. Until a moderator verifies you, you can read and suggest but not approve or publish." />
			{mine.loading && !mine.data ? <Loading what="your claims" /> : <ErrorNote error={mine.error} />}
			{mine.data && !mine.data.length ? (
				<EmptyState title="You have not claimed a firm yet">
					Claiming a firm takes four steps: tell us which firm and your role, place a short challenge on the firm's website to show you control it, wait for a moderator to verify you, then review and publish the firm's criteria. Start below.
				</EmptyState>
			) : null}
			{(mine.data ?? []).map((c) => (
				<ClaimCard key={c.claim.id} c={c} firm={(firms.data ?? []).find((f) => f.canonicalDomain === c.claim.canonicalDomain) ?? null} published={(directory.data ?? []).find((d) => d.canonicalDomain === c.claim.canonicalDomain) ?? null} reload={reloadAll} />
			))}
			<Section title={mine.data?.length ? "Claim another firm" : "Claim your firm"}>
				<RequestClaim onDone={reloadAll} />
			</Section>
		</>
	);
}

function stepsFor(c: Any, published: Any | null): { label: string; state: "done" | "current" | "todo" | "blocked"; note?: string }[] {
	const events: Any[] = c.events;
	const proofOk = events.some((e) => e.kind === "proof_checked" && e.data?.proofOk);
	const status = c.status as string;
	const verified = status === "verified";
	const stopped = status === "rejected" || status === "revoked";
	return [
		{ label: "Claim submitted", state: "done" },
		{ label: "Domain proof checked", state: proofOk || verified ? "done" : stopped ? "todo" : "current", note: proofOk || verified ? "The challenge was found on the firm's website." : "Place the challenge below on the firm's website, then check it." },
		{ label: "Verified by a moderator", state: verified ? "done" : stopped ? "blocked" : proofOk ? "current" : "todo", note: verified ? "You may approve and publish." : stopped ? CLAIM[status]!.help : proofOk ? "Waiting for a moderator." : undefined },
		{ label: "Criteria approved", state: verified ? (published ? "done" : "current") : "todo", note: verified && !published ? "Open the firm's profile and approve the criteria that are right." : undefined },
		{ label: "Published", state: published ? "done" : "todo", note: published ? `Version ${published.version}, visible to every workspace.` : undefined },
	];
}

function ClaimCard({ c, firm, published, reload }: { c: Any; firm: Any | null; published: Any | null; reload: () => void }) {
	const a = useAction();
	const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
	const status = c.status as string;
	const events: Any[] = c.events;
	const proofOk = events.some((e) => e.kind === "proof_checked" && e.data?.proofOk);
	const lastProof = [...events].reverse().find((e) => e.kind === "proof_checked");
	const claimEntry = status === "requested" && lastProof ? (lastProof.data?.proofOk ? CLAIM.proof_ok! : CLAIM.proof_failed!) : entry(CLAIM, status);
	const verified = status === "verified";
	return (
		<article className="card" data-testid="my-claim">
			<header className="row between">
				<div>
					<h2>
						{c.claim.firmName} <span className="muted small">{c.claim.canonicalDomain}</span>
					</h2>
				</div>
				<div className="status-trio" data-testid="status-trio">
					<div>
						<span className="dim-title">Claim</span> <Badge entry={claimEntry} />
					</div>
					<div>
						<span className="dim-title">Publication</span> <Badge tone={published ? "ok" : "unknown"}>{published ? `Published, version ${published.version}` : "Not published"}</Badge>
					</div>
				</div>
			</header>
			<Steps steps={stepsFor(c, published)} />
			<p className="small" data-testid="claim-next">
				<strong>What happens next:</strong> {claimEntry.help}
			</p>

			{status === "requested" ? (
				<div className="stack">
					{proofOk ? (
						<p className="small">Keep the challenge file in place until a moderator has decided. You can check it again at any time.</p>
					) : (
						<>
							<p className="small">
								Publish this exact text at <code>https://{c.claim.canonicalDomain}/.well-known/attn-invest-claim.txt</code>, then check it.
							</p>
							<code className="digest">{c.claim.challenge}</code>
						</>
					)}
					<ErrorNote error={a.error} />
					<div className="row">
						<button
							type="button"
							className="primary"
							disabled={a.busy}
							onClick={async () => {
								const r = await a.run(() => call<{ event: Any }>("profile.claim.check", { claimId: c.claim.id }));
								if (r) {
									setResult({ ok: !!r.event.data?.proofOk, text: r.event.rationale });
									reload();
								}
							}}
						>
							{a.busy ? "Checking…" : "Check the proof"}
						</button>
					</div>
					{result ? (
						<Notice kind={result.ok ? "success" : "warn"} title={result.ok ? "The challenge was found" : "The challenge was not found"}>
							{result.text}
						</Notice>
					) : null}
				</div>
			) : null}

			{verified ? (
				<div className="stack">
					{firm ? (
						<p>
							<a className="button primary" href={href("investors", firm.id)}>
								Review and approve the firm's criteria
							</a>{" "}
							<span className="muted small">Approved by the firm, suggestions awaiting review, and external observations are listed separately.</span>
						</p>
					) : (
						<Notice kind="warn">The firm's research profile is still being prepared. Reload in a moment.</Notice>
					)}
					{published ? <PublishedSummary domain={c.claim.canonicalDomain} /> : <Notice>Nothing is published yet. Approve criteria on the firm's profile, then publish the ones you choose. Until then no other workspace sees anything from you.</Notice>}
					<SharedWithFirm domain={c.claim.canonicalDomain} name={c.claim.firmName} />
				</div>
			) : null}

			<details>
				<summary>History of this claim ({events.length})</summary>
				<ul className="timeline small">
					{events.map((e) => (
						<li key={e.id}>
							<strong>{e.kind.replace(/_/g, " ")}</strong> — {e.rationale} <span className="muted">({when(e.at)})</span>
						</li>
					))}
				</ul>
			</details>
		</article>
	);
}

function PublishedSummary({ domain }: { domain: string }) {
	const { data } = useLoad(() => call<{ profile: Any | null }>("directory.get", { domain }).then((r) => r.profile), [domain]);
	if (!data) return null;
	return (
		<div data-testid="published-summary">
			<h3>What every workspace currently sees</h3>
			<p className="muted small">
				Version {data.version}, published {when(data.publishedAt)}. These are the only criteria shown as <strong>Approved by the firm</strong>.
			</p>
			<ul className="timeline">
				{data.criteria.map((c: Any) => (
					<li key={c.approvalId}>
						{c.polarity === "exclude" ? "Excludes " : ""}
						{String(c.field).replace(/_/g, " ")}: <strong>{c.valueRange ? usdRange(c.valueRange) : c.label}</strong>
					</li>
				))}
			</ul>
		</div>
	);
}

function SharedWithFirm({ domain, name }: { domain: string; name: string }) {
	const { data, reload } = useLoad(() => call<{ items: Any[] }>("contribution.shared", { domain }).then((r) => r.items), [domain]);
	return (
		<div>
			<h3>Shared with {name}</h3>
			<p className="muted small">Founders and others can choose to share a note or correction with your firm. They are not identified. Responding records your view beside it; it never deletes it.</p>
			{data?.length ? data.map((q) => <SharedItem key={q.chainId} q={q} reload={reload} />) : <p className="empty">Nothing has been shared with your firm.</p>}
		</div>
	);
}

function SharedItem({ q, reload }: { q: Any; reload: () => void }) {
	const [note, setNote] = useState("");
	const a = useAction();
	const respond = (action: string) => async () => {
		if (await a.run(() => call("contribution.respond", { chainId: q.chainId, action, note, as: "firm_representative" }))) {
			setNote("");
			reload();
		}
	};
	return (
		<article className="card" data-testid="shared-contribution">
			<strong>{SOURCE_CATEGORY[q.category] ?? q.category}</strong> <span className="muted small">{String(q.kind).replace(/_/g, " ")}</span>
			<blockquote className="passage">{q.text}</blockquote>
			<label className="field">
				Your response
				<input value={note} onChange={(e) => setNote(e.target.value)} />
			</label>
			<ErrorNote error={a.error} />
			<div className="row">
				<button type="button" disabled={a.busy || !note.trim()} onClick={respond("confirm")}>
					Confirm it is right
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

function RequestClaim({ onDone }: { onDone: () => void }) {
	const [f, setF] = useState({ domain: "", firmName: "", relationship: "" });
	const [errors, setErrors] = useState<Record<string, string>>({});
	const a = useAction();
	const submit = async (e: FormEvent) => {
		e.preventDefault();
		const found: Record<string, string> = {};
		if (!f.domain.trim()) found.domain = "Enter the firm's website, for example firm.vc.";
		if (f.firmName.trim().length < 2) found.firmName = "Enter the firm's name.";
		if (f.relationship.trim().length < 10) found.relationship = "Say what your role is and how a moderator can confirm it (at least 10 characters).";
		setErrors(found);
		if (Object.keys(found).length) return;
		if (await a.run(() => call("profile.claim.request", f))) {
			setF({ domain: "", firmName: "", relationship: "" });
			onDone();
		}
	};
	const err = (k: string) => (errors[k] ? <span className="field-error" role="alert">{errors[k]}</span> : null);
	return (
		<form className="stack" onSubmit={submit} data-testid="request-claim" noValidate>
			<p className="muted small">Asking to represent a firm gives you no authority yet. We add the firm to your workspace and start reading its public pages, so its criteria are ready to review once a moderator verifies you.</p>
			<div className="form-grid">
				<label className="field">
					Firm website
					<input value={f.domain} onChange={(e) => setF({ ...f, domain: e.target.value })} placeholder="firm.vc" aria-invalid={errors.domain ? true : undefined} />
					{err("domain")}
				</label>
				<label className="field">
					Firm name
					<input value={f.firmName} onChange={(e) => setF({ ...f, firmName: e.target.value })} aria-invalid={errors.firmName ? true : undefined} />
					{err("firmName")}
				</label>
				<label className="field wide">
					Your role, and how it can be confirmed
					<textarea value={f.relationship} onChange={(e) => setF({ ...f, relationship: e.target.value })} rows={2} aria-invalid={errors.relationship ? true : undefined} />
					{err("relationship")}
				</label>
			</div>
			<ErrorNote error={a.error} />
			<div>
				<button className="primary" disabled={a.busy}>
					{a.busy ? "Submitting…" : "Request to represent this firm"}
				</button>
			</div>
		</form>
	);
}
