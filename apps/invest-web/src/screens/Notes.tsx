import { useState } from "react";
import { call } from "../api.ts";
import { EmptyState, ErrorNote, Loading, PageHead, Section, useAction, useCan, useLoad, when } from "../ui.tsx";
import { ContributionForm } from "./Collaboration.tsx";

type Any = Record<string, any>; // eslint-disable-line

/** Private notes and corrections about investors. Private by default; sharing is a separate, per-audience choice that can be revoked. */
export function NotesScreen() {
	const canWrite = useCan("contribution.write");
	const mine = useLoad(() => (canWrite ? call<{ items: Any[] }>("contribution.mine", {}).then((r) => r.items) : Promise.resolve([] as Any[])), [canWrite]);
	const directory = useLoad(() => call<{ items: Any[] }>("directory.list", {}).then((r) => r.items), []);
	const [domain, setDomain] = useState("");
	return (
		<>
			<PageHead title="Your notes" sub="What you know about an investor that public sources do not say. Private to you until you choose to share, per audience, and you can stop sharing at any time. Sharing is not publishing." />
			{mine.loading && !mine.data ? <Loading what="your notes" /> : <ErrorNote error={mine.error} />}
			{mine.data?.length ? (
				<div className="stack">
					{mine.data.map((m) => (
						<MyContribution key={m.contribution.chainId} m={m} reload={mine.reload} />
					))}
				</div>
			) : mine.data ? (
				<EmptyState title="You have no notes yet">Add a correction, a firsthand note or an interaction note below. It stays in your workspace.</EmptyState>
			) : null}
			<Section title="Add a note about an investor">
				<label className="field">
					Investor
					<select value={domain} onChange={(e) => setDomain(e.target.value)}>
						<option value="">Choose an investor…</option>
						{(directory.data ?? []).map((d) => (
							<option key={d.canonicalDomain} value={d.canonicalDomain}>
								{d.firmName} ({d.canonicalDomain})
							</option>
						))}
					</select>
					<span className="hint">Investors who have published a profile. A note about another firm can be added from its research page.</span>
				</label>
				{domain ? <ContributionForm key={domain} domain={domain} onDone={mine.reload} /> : null}
			</Section>
		</>
	);
}

function MyContribution({ m, reload }: { m: Any; reload: () => void }) {
	const [aggregate, setAggregate] = useState(false);
	const a = useAction();
	const c = m.contribution;
	const shared = (kind: string) => m.audiences.some((x: Any) => x.audience.kind === kind);
	const share = (audience: Any) => a.run(() => call("contribution.share", { chainId: c.chainId, audience, aggregateConsent: aggregate })).then((r) => r && reload());
	const revoke = (audience: Any) => a.run(() => call("contribution.revoke", { chainId: c.chainId, audience })).then((r) => r && reload());
	const state = m.visibility === "private" ? "Private to you" : `Shared · ${String(m.lifecycle).replace(/_/g, " ")}`;
	return (
		<article className="card" data-testid="my-contribution">
			<h3>
				{String(c.kind).replace(/_/g, " ")} about {c.firmDomain} <span className="badge tone-neutral">{state}</span>
			</h3>
			{c.hostile ? <p className="note warn">This text looks like instructions, so receivers will not see it.</p> : null}
			<blockquote className="passage">{c.text}</blockquote>
			{m.responses.map((r: Any) => (
				<p key={r.at + r.action} className="small">
					<strong>{r.by === "moderator" ? "A moderator" : "The firm"} marked it {r.action === "confirm" ? "confirmed" : r.action === "dispute" ? "disputed" : "dismissed"}:</strong> {r.note} <span className="muted">({when(r.at)}). Your note and evidence are kept.</span>
				</p>
			))}
			<ErrorNote error={a.error} />
			<div className="row">
				{shared("firm") ? (
					<button type="button" className="quiet" disabled={a.busy} onClick={() => revoke({ kind: "firm", domain: c.firmDomain })}>
						Stop sharing with the firm
					</button>
				) : (
					<button type="button" className="quiet" disabled={a.busy} onClick={() => share({ kind: "firm", domain: c.firmDomain })}>
						Share with the firm
					</button>
				)}
				{shared("moderator") ? (
					<button type="button" className="quiet" disabled={a.busy} onClick={() => revoke({ kind: "moderator" })}>
						Stop sharing with moderators
					</button>
				) : (
					<button type="button" className="quiet" disabled={a.busy} onClick={() => share({ kind: "moderator" })}>
						Share with moderators
					</button>
				)}
				<label className="check small">
					<input type="checkbox" checked={aggregate} onChange={(e) => setAggregate(e.target.checked)} /> Also allow use in future aggregate analysis (off by default; applies when you share)
				</label>
			</div>
		</article>
	);
}
