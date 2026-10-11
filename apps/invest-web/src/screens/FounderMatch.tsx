import { useState } from "react";
import { BUSINESS_MODEL_KEYS, GEOGRAPHY_KEYS, SECTOR_KEYS, STARTUP_STAGES } from "../../../../invest/domain/founder.ts";
import { call } from "../api.ts";
import { ErrorNote, Loading, Section, useAction, useLoad, when } from "../ui.tsx";
import { term } from "../format.ts";

type Any = Record<string, any>; // eslint-disable-line

const MANDATE_LABEL: Record<string, { label: string; help: string }> = {
	compatible_on_known: { label: "Compatible on what is known", help: "No incompatibility found among the criteria that could be checked. Unknown criteria are not counted either way." },
	partially_assessed: { label: "Partly assessed", help: "Too few criteria could be checked to call this a fit." },
	unknown: { label: "Unknown", help: "Nothing could be checked yet. This is not a mismatch." },
	possible_mismatch: { label: "Possible mismatch to confirm", help: "A source suggests a mismatch, but none is authoritative enough to rule the investor out." },
	eliminated: { label: "Ruled out by an authoritative criterion", help: "An approved or current, undisputed statement from the investor excludes this startup." },
};
const COVERAGE_LABEL: Record<string, string> = {
	verified: "Verified",
	partially_verified: "Partly verified",
	unverified_reports: "Reports only, not verified",
	inferred: "Inferred patterns only",
	unknown: "Unknown",
};
const FIELD_COV: Record<string, string> = { approved: "approved", stated: "stated by the firm", reported: "reported, not the firm's own", inferred: "inferred pattern", unknown: "unknown" };
const AUTH_LABEL: Record<string, string> = {
	investor_approved: "Approved by the investor",
	workspace_approved: "Adopted by this workspace",
	official_stated: "Stated on the firm's own site",
	third_party: "Reported by a third party",
	contributed: "Contributed by a participant",
	observed: "Observed from past activity",
	inferred: "Inferred from a pattern",
};
const READY_LABEL: Record<string, string> = { met: "Met", not_met: "Not met", evidence_not_provided: "Evidence not provided", not_applicable: "Not applicable", not_assessable: "Not assessable" };
const QUALITY_LABEL: Record<string, string> = {
	reviewer_verified: "Verified by a reviewer",
	corroborated: "Independently corroborated",
	conflicting: "Conflicting evidence",
	supplied_by_founder: "In a founder document (not independently verified)",
	source_cited: "Cites a source (not checked)",
	founder_assertion: "Founder assertion only",
};
const SOURCE_LABEL: Record<string, string> = { published_profile: "Published by the investor", workspace_research: "From this workspace's research" };
const ACTION_KIND: Record<string, string> = { confirm_mismatch: "Confirm", clarify_profile: "Clarify", review_criterion: "Review", add_evidence: "Evidence", re_evaluate: "Re-evaluate" };

const Chip = ({ kind, children, title }: { kind: string; children: React.ReactNode; title?: string }) => (
	<span className={`fit-chip ${kind}`} title={title}>
		{children}
	</span>
);

// ---------------------------------------------------------------------------------------- discovery

type Filters = { stage: string[]; sector: string[]; geography: string[]; businessModel: string[]; minUsd: string; maxUsd: string; approvedOnly: boolean; freshOnly: boolean; unknown: boolean; includeFounderExcluded: boolean; query: string };
const NO_FILTERS: Filters = { stage: [], sector: [], geography: [], businessModel: [], minUsd: "", maxUsd: "", approvedOnly: false, freshOnly: false, unknown: true, includeFounderExcluded: false, query: "" };

function toInput(f: Filters) {
	const out: Any = {};
	for (const k of ["stage", "sector", "geography", "businessModel"] as const) if (f[k].length) out[k] = f[k];
	if (f.minUsd || f.maxUsd) out.checkSize = { ...(f.minUsd ? { minUsd: Number(f.minUsd) } : {}), ...(f.maxUsd ? { maxUsd: Number(f.maxUsd) } : {}) };
	if (f.approvedOnly) out.approvedOnly = true;
	if (f.freshOnly) out.freshOnly = true;
	if (!f.unknown) out.unknown = false;
	if (f.includeFounderExcluded) out.includeFounderExcluded = true;
	if (f.query.trim()) out.query = f.query.trim();
	return out;
}

function MultiFilter({ label, options, value, onChange }: { label: string; options: readonly string[]; value: string[]; onChange: (v: string[]) => void }) {
	return (
		<details className="filter">
			<summary>
				{label}
				{value.length ? ` (${value.length})` : ""}
			</summary>
			<div className="checks">
				{options.map((o) => (
					<label key={o}>
						<input type="checkbox" checked={value.includes(o)} onChange={(e) => onChange(e.target.checked ? [...value, o] : value.filter((x) => x !== o))} /> {term(o)}
					</label>
				))}
			</div>
		</details>
	);
}

export function DiscoverTab({ startupId, profileVersion, rev, onChanged, goToProfile }: { startupId: string; profileVersion: number; rev: number; onChanged: () => void; goToProfile: () => void }) {
	const [filters, setFilters] = useState<Filters>(NO_FILTERS);
	const [open, setOpen] = useState<string | null>(null);
	// Without a saved profile there is nothing to compare, so the server is not asked.
	const { data, error, loading, reload } = useLoad(() => (profileVersion ? call<Any>("fit.discover", { startupId, filters: toInput(filters) }) : Promise.resolve(null)), [startupId, rev, profileVersion, JSON.stringify(filters)]);
	const save = useAction();
	if (!profileVersion)
		return (
			<div className="note warn">
				Save a startup profile first, so candidates can be compared with it. <button className="link" onClick={goToProfile}>Go to the profile</button>
			</div>
		);
	const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setFilters({ ...filters, [k]: v });
	const filtered = JSON.stringify(filters) !== JSON.stringify(NO_FILTERS);
	return (
		<>
			<p className="muted">
				Candidates come from investors who published their own criteria and from research in this workspace. Fit, readiness, evidence quality and research coverage are shown separately. None is a score, a prediction of investment, or a statement about your quality. Unknown means unknown.
			</p>
			<div className="filters" data-testid="filters">
				<MultiFilter label="Stage" options={STARTUP_STAGES} value={filters.stage} onChange={(v) => set("stage", v)} />
				<MultiFilter label="Sector" options={SECTOR_KEYS} value={filters.sector} onChange={(v) => set("sector", v)} />
				<MultiFilter label="Geography" options={GEOGRAPHY_KEYS} value={filters.geography} onChange={(v) => set("geography", v)} />
				<MultiFilter label="Business model" options={BUSINESS_MODEL_KEYS} value={filters.businessModel} onChange={(v) => set("businessModel", v)} />
				<label className="field inline">
					Check size from (USD)
					<input inputMode="numeric" value={filters.minUsd} onChange={(e) => set("minUsd", e.target.value)} placeholder="500000" />
				</label>
				<label className="field inline">
					to (USD)
					<input inputMode="numeric" value={filters.maxUsd} onChange={(e) => set("maxUsd", e.target.value)} placeholder="2000000" />
				</label>
				<label className="field inline">
					Name
					<input value={filters.query} onChange={(e) => set("query", e.target.value)} />
				</label>
				<label>
					<input type="checkbox" checked={filters.unknown} onChange={(e) => set("unknown", e.target.checked)} /> Keep investors whose criteria are unknown
				</label>
				<label>
					<input type="checkbox" checked={filters.approvedOnly} onChange={(e) => set("approvedOnly", e.target.checked)} /> Only investor-approved criteria
				</label>
				<label>
					<input type="checkbox" checked={filters.freshOnly} onChange={(e) => set("freshOnly", e.target.checked)} /> Only current research
				</label>
				<label>
					<input type="checkbox" checked={filters.includeFounderExcluded} onChange={(e) => set("includeFounderExcluded", e.target.checked)} /> Show investors I excluded
				</label>
				{filtered ? (
					<button className="quiet" onClick={() => setFilters(NO_FILTERS)}>
						Clear filters
					</button>
				) : null}
			</div>
			{loading && !data ? <Loading what="candidate investors" /> : <ErrorNote error={error} />}
			{data ? (
				<>
					<p className="muted small" role="status">
						{data.shown} of {data.total} investors shown, compared with profile version {data.profileVersion} under {data.policyVersion}. Computed {when(data.evaluatedAt)}.
					</p>
					{data.empty === "no_investors" ? (
						<p className="empty" data-testid="empty-directory">
							No investors are available to compare with yet. Investors appear here after a verified representative publishes their criteria, or once this workspace researches them. Nothing is shown in their place.
						</p>
					) : data.empty === "filtered_out" ? (
						<p className="empty">No investor matches these filters. Clear a filter, or keep investors whose criteria are unknown.</p>
					) : null}
					<ul className="plain candidates" data-testid="candidates">
						{data.candidates.map((c: Any) => (
							<li key={c.investorKey} className="candidate" data-investor={c.investorKey}>
								<div className="row between">
									<div>
										<strong>{c.name}</strong> <span className="muted small">{c.investorKey}</span>
										<div className="muted small">
											{SOURCE_LABEL[c.source]}
											{c.investorRef.publishedVersion ? `, profile version ${c.investorRef.publishedVersion}` : ""}
											{c.investorRef.lastResearchedAt ? `, ${c.source === "published_profile" ? "published" : "researched"} ${when(c.investorRef.lastResearchedAt)}` : ""}
										</div>
									</div>
									<div className="row">
										{c.shortlisted ? (
											<Chip kind="ok">On your shortlist</Chip>
										) : (
											<button
												onClick={async () => {
													if (await save.run(() => call("shortlist.save", { startupId, investorKey: c.investorKey }))) {
														onChanged();
														reload();
													}
												}}
												disabled={save.busy}
											>
												Save to shortlist
											</button>
										)}
										<button className="primary" onClick={() => setOpen(open === c.investorKey ? null : c.investorKey)} aria-expanded={open === c.investorKey}>
											{open === c.investorKey ? "Hide explanation" : "Explain"}
										</button>
									</div>
								</div>
								<div className="dims">
									<div className="dim" data-dim="mandate">
										<span className="dim-title">Mandate fit</span>
										<Chip kind={`mandate-${c.mandate.summary}`} title={MANDATE_LABEL[c.mandate.summary].help}>
											{MANDATE_LABEL[c.mandate.summary].label}
										</Chip>
										<span className="small">{c.mandate.counts.compatible} compatible · {c.mandate.counts.incompatible} incompatible · {c.mandate.counts.unknown} unknown</span>
									</div>
									<div className="dim" data-dim="readiness">
										<span className="dim-title">Readiness</span>
										<span className="small">{c.readiness.met} met · {c.readiness.evidence_not_provided} evidence not provided · {c.readiness.not_met} not met</span>
									</div>
									<div className="dim" data-dim="quality">
										<span className="dim-title">Evidence quality</span>
										<span className="small">
											{c.evidenceQuality.reviewer_verified + c.evidenceQuality.corroborated} independently supported · {c.evidenceQuality.supplied_by_founder + c.evidenceQuality.source_cited} not independently verified · {c.evidenceQuality.founder_assertion} assertion only
											{c.evidenceQuality.conflicting ? ` · ${c.evidenceQuality.conflicting} conflicting` : ""}
										</span>
									</div>
									<div className="dim" data-dim="coverage">
										<span className="dim-title">Research coverage</span>
										<Chip kind={`cov-${c.coverage.level}`}>{COVERAGE_LABEL[c.coverage.level]}</Chip>
										{c.coverage.flags.map((f: string) => (
											<Chip key={f} kind="flag">
												{f}
											</Chip>
										))}
									</div>
								</div>
								<p className="small">{c.mandate.statement}</p>
								{c.coverage.limitsPrecision ? <p className="note warn small">Limited research: read this as a partial view, not a verdict. {c.coverage.statement}</p> : null}
								{c.mandate.founderExcluded ? <p className="small">You excluded this investor.</p> : null}
								{c.filterNotes.length ? <p className="muted small">Kept because: {c.filterNotes.join("; ")}.</p> : null}
								{c.latestEvaluation && !c.latestEvaluation.current ? <p className="note warn small">Your last saved evaluation (#{c.latestEvaluation.sequence}) is out of date.</p> : null}
								{open === c.investorKey ? <Explanation startupId={startupId} investorKey={c.investorKey} onChanged={() => { onChanged(); reload(); }} /> : null}
							</li>
						))}
					</ul>
					<ErrorNote error={save.error} />
				</>
			) : null}
		</>
	);
}

// ---------------------------------------------------------------------------------------- explanation

function SourceBlock({ d }: { d: Any }) {
	return (
		<div className="source-block">
			<div className="small">
				<Chip kind={`auth-${d.authority}`}>{AUTH_LABEL[d.authority]}</Chip> <span className="muted">via {d.publisher}</span>
				{d.verification && d.verification !== "unchecked" && d.verification !== "approved" ? <> · source check: {term(d.verification)}</> : null}
				{d.freshness === "stale" ? <> · <strong>out of date</strong></> : null}
				{d.lifecycle === "disputed" ? <> · <strong>disputed</strong></> : null}
			</div>
			<blockquote>{d.passage}</blockquote>
			<div className="muted small">
				captured {when(d.capturedAt)}
				{d.url && /^https:\/\//.test(d.url) ? (
					<>
						{" · "}
						<a href={d.url} target="_blank" rel="noopener noreferrer nofollow">
							open source
						</a>
					</>
				) : null}
			</div>
		</div>
	);
}

export function Explanation({ startupId, investorKey, onChanged }: { startupId: string; investorKey: string; onChanged: () => void }) {
	const run = useAction();
	const [evaluation, setEvaluation] = useState<Any | null>(null);
	const [meta, setMeta] = useState<{ reused: boolean; previous: Any | null } | null>(null);
	const history = useLoad(() => call<{ items: Any[] }>("fit.history", { startupId, investorKey }).then((r) => r.items), [startupId, investorKey, evaluation?.id]);
	const [pair, setPair] = useState<{ from: string; to: string } | null>(null);
	const cmp = useLoad(() => (pair ? call<Any>("fit.compare", { fromId: pair.from, toId: pair.to }) : Promise.resolve(null)), [pair?.from, pair?.to]);
	const evaluate = async () => {
		const r = await run.run(() => call<Any>("fit.evaluate", { startupId, investorKey }));
		if (r) {
			setEvaluation(r.evaluation);
			setMeta({ reused: r.reused, previous: r.previous });
			onChanged();
		}
	};
	if (!evaluation)
		return (
			<div className="explanation" data-testid="explanation">
				<p className="muted small">An evaluation records the exact profile, evidence and investor versions it used, so it can be reproduced later. Running it changes nothing else and contacts no one.</p>
				<button className="primary" onClick={evaluate} disabled={run.busy}>
					{run.busy ? "Evaluating…" : "Evaluate and explain"}
				</button>
				<ErrorNote error={run.error} />
			</div>
		);
	const r = evaluation.result as Any;
	const inputs = evaluation.inputs as Any;
	return (
		<div className="explanation" data-testid="explanation">
			<p className="small">
				{meta?.reused ? "Identical inputs: this is the existing evaluation, not a new one." : meta?.previous ? `New evaluation #${evaluation.sequence}; the earlier one is kept unchanged.` : `Evaluation #${evaluation.sequence}.`}
			</p>
			{evaluation.changes?.length ? (
				<div className="note" data-testid="changes">
					<strong>What changed since the previous evaluation</strong>
					<ul>
						{evaluation.changes.map((c: string) => (
							<li key={c}>{c}</li>
						))}
					</ul>
				</div>
			) : null}
			<h4>Why this investor appears</h4>
			<ul className="small">
				{r.relevance.map((x: string) => (
					<li key={x}>{x}</li>
				))}
			</ul>

			<h4>Mandate fit — {MANDATE_LABEL[r.mandate.summary].label}</h4>
			<p className="small">{r.mandate.statement}</p>
			<div className="table-wrap">
				<table className="list" data-testid="mandate-table">
					<thead>
						<tr>
							<th>Criterion</th>
							<th>Your profile</th>
							<th>Result</th>
							<th>Why, and the source</th>
						</tr>
					</thead>
					<tbody>
						{r.mandate.constraints.map((c: Any) => (
							<tr key={c.field} data-field={c.field}>
								<td>{term(c.field)}</td>
								<td>{c.startupValue || <span className="muted">not stated</span>}</td>
								<td>
									<Chip kind={`status-${c.status}`}>{c.status === "incompatible" ? (c.strength === "hard" ? "Incompatible (authoritative)" : "Apparent mismatch to confirm") : c.status === "compatible" ? "Compatible" : "Unknown"}</Chip>
								</td>
								<td>
									<p className="small">{c.rationale}</p>
									{c.notes.map((n: string) => (
										<p key={n} className="muted small">
											{n}
										</p>
									))}
									{c.decidedBy ? <SourceBlock d={c.decidedBy} /> : null}
									{c.considered.length > 1 || (c.considered.length === 1 && !c.decidedBy) ? (
										<details>
											<summary>All {c.considered.length} criteria considered</summary>
											<ul className="small">
												{c.considered.map((x: Any) => (
													<li key={x.key}>
														{x.polarity === "exclude" ? "Excludes" : "Includes"} {x.label} — {AUTH_LABEL[x.authority]}
														{x.freshness === "stale" ? ", out of date" : ""}
													</li>
												))}
											</ul>
										</details>
									) : null}
									{c.conflictIds.length ? (
										<p className="note warn small">{c.decidedBy && (c.decidedBy.authority === "investor_approved" || c.decidedBy.authority === "workspace_approved") ? "Another source disagrees. The approved value stands and the disagreement stays visible." : "Sources disagree on this; the conflict is left visible, not settled."}</p>
									) : null}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>

			<h4>Investment readiness</h4>
			<p className="small">{r.readiness.statement}</p>
			<ul className="plain small" data-testid="readiness">
				{r.readiness.items.map((i: Any) => (
					<li key={i.id}>
						<Chip kind={`ready-${i.status}`}>{READY_LABEL[i.status]}</Chip> <strong>{i.label}</strong> <span className="muted">({i.basis === "investor_criterion" ? "this investor's sourced criterion" : "generic checklist, not this investor's requirement"})</span>
						<div>{i.detail}</div>
						{i.status === "evidence_not_provided" || i.status === "not_met" ? <div className="muted">What would help: {i.whatWouldHelp}</div> : null}
					</li>
				))}
			</ul>

			<h4>Evidence quality</h4>
			<p className="small">{r.evidenceQuality.statement}</p>
			<ul className="plain small" data-testid="quality">
				{r.evidenceQuality.claims.map((c: Any) => (
					<li key={c.field}>
						<Chip kind={`q-${c.quality}`}>{QUALITY_LABEL[c.quality]}</Chip>
						{c.stale ? <Chip kind="flag">stale</Chip> : null} {c.claim}
						<div className="muted">{c.detail}</div>
					</li>
				))}
			</ul>

			<h4>Research coverage — {COVERAGE_LABEL[r.coverage.level]}</h4>
			<p className="small">{r.coverage.statement}</p>
			<p className="small muted">{Object.entries(r.coverage.fields).map(([f, v]) => `${term(f)}: ${FIELD_COV[v as string]}`).join(" · ")}</p>

			<h4>Recommended next steps</h4>
			<p className="muted small">{r.labels.recommendations}</p>
			<ol className="small" data-testid="actions">
				{r.actions.map((a: Any) => (
					<li key={a.id}>
						<Chip kind={`act-${a.kind}`}>{ACTION_KIND[a.kind]}</Chip> <strong>{a.title}</strong>
						<div className="muted">Why: {a.why}</div>
					</li>
				))}
				{!r.actions.length ? <li className="muted">Nothing to recommend from the current findings.</li> : null}
			</ol>

			<details>
				<summary>Provenance: exactly what this evaluation used</summary>
				<ul className="small" data-testid="provenance">
					<li>Startup profile version {inputs.profile.version} ({inputs.profile.contentHash.slice(0, 12)})</li>
					<li>{inputs.evidence.refs.length} evidence item{inputs.evidence.refs.length === 1 ? "" : "s"} (set {inputs.evidence.setHash.slice(0, 12)})</li>
					<li>
						Investor: {SOURCE_LABEL[inputs.investor.source]}
						{inputs.investor.publishedVersion ? `, published profile version ${inputs.investor.publishedVersion}` : ""}
						{inputs.investor.researchRunId ? `, research run ${inputs.investor.researchRunId}` : ""}, {inputs.investor.factRefs.length} criteria (snapshot {inputs.investor.snapshotHash.slice(0, 12)})
					</li>
					<li>
						Matching policy {evaluation.policyVersion}, readiness checklist {evaluation.frameworkVersion}; evaluated {when(evaluation.evaluatedAt)}.
					</li>
					<li>No AI model was used: the policy is deterministic and the same inputs give the same result.</li>
				</ul>
				<p className="small muted">
					Statement types: <strong>sourced facts</strong> — {r.labels.sourcedFacts} <strong>Founder assertions</strong> — {r.labels.founderAssertions} <strong>Inferences</strong> — {r.labels.inferences}
				</p>
			</details>

			<div className="row">
				<button onClick={evaluate} disabled={run.busy}>
					Re-run with current data
				</button>
				<ErrorNote error={run.error} />
			</div>

			{history.data && history.data.length > 1 ? (
				<details data-testid="history">
					<summary>Evaluation history ({history.data.length})</summary>
					<ul className="plain small">
						{history.data.map((h: Any, i: number) => (
							<li key={h.id}>
								#{h.sequence}, {when(h.evaluatedAt)}, profile v{h.profileVersion}: {MANDATE_LABEL[h.mandate].label}
								{history.data![i + 1] ? (
									<>
										{" "}
										<button className="link" onClick={() => setPair({ from: history.data![i + 1]!.id, to: h.id })}>
											Compare with #{history.data![i + 1]!.sequence}
										</button>
									</>
								) : null}
							</li>
						))}
					</ul>
					{cmp.data ? (
						<div className="note" data-testid="comparison">
							<strong>
								#{cmp.data.from.sequence} → #{cmp.data.to.sequence}
							</strong>
							<ul>
								{[...cmp.data.inputs, ...cmp.data.results].map((x: string) => (
									<li key={x}>{x}</li>
								))}
								{![...cmp.data.inputs, ...cmp.data.results].length ? <li>No differences.</li> : null}
							</ul>
						</div>
					) : null}
				</details>
			) : null}
		</div>
	);
}

// ---------------------------------------------------------------------------------------- shortlist and plan

const STATUS_OPTIONS = [
	{ value: "considering", label: "Considering" },
	{ value: "ready", label: "Ready to approach (your decision)" },
	{ value: "parked", label: "Parked" },
	{ value: "ruled_out", label: "Ruled out" },
];

export function ShortlistTab({ startupId, rev, onChanged }: { startupId: string; rev: number; onChanged: () => void }) {
	const { data, error, loading, reload } = useLoad(() => call<{ items: Any[] }>("shortlist.list", { startupId }).then((r) => r.items), [startupId, rev]);
	const [open, setOpen] = useState<string | null>(null);
	const act = useAction();
	const refresh = () => {
		reload();
		onChanged();
	};
	// Every edit is fenced on the entry's version, so wait for the reload before the next one: a stale version would be refused.
	const update = (entry: Any, patch: Any) =>
		act.run(async () => {
			await call("shortlist.update", { entryId: entry.id, expectedVersion: entry.__version, ...patch });
			await reload();
			onChanged();
		});
	if (loading && !data) return <Loading what="shortlist" />;
	if (!data) return <ErrorNote error={error} />;
	const plan = data
		.flatMap((r) => r.actions.filter((a: Any) => a.state === "open").map((a: Any) => ({ ...a, investorName: r.entry.investorName, investorKey: r.entry.investorKey })))
		.sort((a, b) => a.priority - b.priority || a.investorName.localeCompare(b.investorName));
	return (
		<>
			<p className="muted">Your shortlist is private. Nothing is sent to anyone: no outreach, introductions or sharing happens here. The steps below are recommendations about your own materials, not a promise that completing them leads to investment.</p>
			{!data.length ? <p className="empty" data-testid="empty-shortlist">Nothing shortlisted yet. Save candidates from the Investors tab.</p> : null}
			{plan.length ? (
				<Section title="Prioritised next steps">
					<ol data-testid="plan" className="small">
						{plan.slice(0, 12).map((a) => (
							<li key={`${a.investorKey}:${a.id}`}>
								<Chip kind={`act-${a.kind}`}>{ACTION_KIND[a.kind]}</Chip> <strong>{a.title}</strong> <span className="muted">— {a.investorName}</span>
								<div className="muted">Why: {a.why}</div>
							</li>
						))}
					</ol>
				</Section>
			) : null}
			<ul className="plain candidates" data-testid="shortlist">
				{data.map((r) => (
					<li key={r.entry.id} className="candidate" data-investor={r.entry.investorKey}>
						<div className="row between">
							<div>
								<strong>{r.entry.investorName}</strong> <span className="muted small">{r.entry.investorKey}</span>
								{r.latest ? (
									<div className="small">
										<Chip kind={`mandate-${r.latest.mandate}`}>{MANDATE_LABEL[r.latest.mandate].label}</Chip> <Chip kind={`cov-${r.latest.coverage}`}>{COVERAGE_LABEL[r.latest.coverage]}</Chip>{" "}
										<span className="muted">evaluation #{r.latest.sequence}, profile v{r.latest.profileVersion}, {when(r.latest.evaluatedAt)}</span>
									</div>
								) : (
									<div className="muted small">Not evaluated yet.</div>
								)}
							</div>
							<div className="row">
								<select
									aria-label={`Status for ${r.entry.investorName}`}
									value={r.entry.status}
									disabled={act.busy}
									onChange={(e) => void update(r.entry, { status: e.target.value })}
								>
									{STATUS_OPTIONS.map((o) => (
										<option key={o.value} value={o.value}>
											{o.label}
										</option>
									))}
								</select>
								<button onClick={() => setOpen(open === r.entry.id ? null : r.entry.id)}>{open === r.entry.id ? "Hide" : "Explain"}</button>
								<button
									className="quiet"
									disabled={act.busy}
									onClick={() => void update(r.entry, { remove: true })}
								>
									Remove
								</button>
							</div>
						</div>
						{r.staleness && !r.staleness.current ? (
							<div className="note warn small" data-testid="stale">
								This evaluation no longer matches your current data. {r.staleness.reasons.join(" ")}
							</div>
						) : null}
						<NoteEditor entry={r.entry} busy={act.busy} save={(note) => update(r.entry, { note })} />
						<ul className="plain small">
							{r.actions.map((a: Any) => (
								<li key={a.id} className={a.state !== "open" ? "done" : ""}>
									<Chip kind={`act-${a.kind}`}>{ACTION_KIND[a.kind]}</Chip> <strong>{a.title}</strong>
									<div className="muted">Why: {a.why}</div>
									{a.kind !== "re_evaluate" ? (
										<div className="row">
											{a.state === "open" ? (
												<>
													<button className="quiet" disabled={act.busy} onClick={() => void update(r.entry, { actions: { [a.id]: "done" } })}>
														Mark done
													</button>
													<button className="quiet" disabled={act.busy} onClick={() => void update(r.entry, { actions: { [a.id]: "dismissed" } })}>
														Dismiss
													</button>
												</>
											) : (
												<>
													<span className="muted">{a.state}</span>
													<button className="quiet" disabled={act.busy} onClick={() => void update(r.entry, { actions: { [a.id]: "open" } })}>
														Reopen
													</button>
												</>
											)}
										</div>
									) : null}
								</li>
							))}
						</ul>
						{open === r.entry.id ? <Explanation startupId={startupId} investorKey={r.entry.investorKey} onChanged={refresh} /> : null}
					</li>
				))}
			</ul>
			<ErrorNote error={act.error} />
		</>
	);
}

function NoteEditor({ entry, busy, save }: { entry: Any; busy: boolean; save: (note: string) => Promise<unknown> }) {
	const [note, setNote] = useState<string>(entry.note ?? "");
	return (
		<div className="row">
			<label className="field inline">
				Private note
				<input value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
			</label>
			{note !== (entry.note ?? "") ? (
				<button disabled={busy} onClick={() => void save(note)}>
					Save note
				</button>
			) : null}
		</div>
	);
}
