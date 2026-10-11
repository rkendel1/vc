import { type ReactNode, useEffect, useState } from "react";
import { BUSINESS_MODEL_KEYS, GEOGRAPHY_KEYS, SECTOR_KEYS, STARTUP_STAGES } from "../../../../invest/domain/founder.ts";
import { call } from "../api.ts";
import { type Filters, NO_FILTERS, activeFilters } from "../rules.ts";
import { ageLabel, plural, sentence, term } from "../format.ts";
import { ACTION_KIND, AUTHORITY, COMPLETENESS, CONSTRAINT, EVIDENCE, FIELD_COMPLETENESS, FIT, FLAG, READINESS, SHORTLIST_STATUS, UNIVERSE, UNKNOWN_WHY, entry } from "../vocab.ts";
import { Badge, ConfirmButton, EmptyState, ErrorNote, Loading, Notice, Section, href, useAction, useLoad, when } from "../ui.tsx";

type Any = Record<string, any>; // eslint-disable-line

// ---------------------------------------------------------------------------------------- discovery

const narrowScreen = () => typeof window !== "undefined" && window.matchMedia?.("(max-width: 720px)").matches;

const FILTER_KEY = (id: string) => `attn-invest-filters:${id}`;

/** Filters survive going into a candidate and back, a refresh, and a visit to another step. */
function useFilters(startupId: string): [Filters, (f: Filters) => void] {
	const [filters, setFilters] = useState<Filters>(() => {
		try {
			const raw = sessionStorage.getItem(FILTER_KEY(startupId));
			return raw ? { ...NO_FILTERS, ...(JSON.parse(raw) as Partial<Filters>) } : NO_FILTERS;
		} catch {
			return NO_FILTERS;
		}
	});
	useEffect(() => {
		try {
			sessionStorage.setItem(FILTER_KEY(startupId), JSON.stringify(filters));
		} catch {
			/* private mode */
		}
	}, [filters, startupId]);
	return [filters, setFilters];
}

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
			<fieldset className="checks">
				<legend className="visually-hidden">{label}</legend>
				{options.map((o) => (
					<label key={o}>
						<input type="checkbox" checked={value.includes(o)} onChange={(e) => onChange(e.target.checked ? [...value, o] : value.filter((x) => x !== o))} /> {term(o)}
					</label>
				))}
			</fieldset>
		</details>
	);
}

export function DiscoverTab({ startupId, profileVersion, rev, onChanged }: { startupId: string; profileVersion: number; rev: number; onChanged: () => void }) {
	const [filters, setFilters] = useFilters(startupId);
	const [open, setOpen] = useState<string | null>(null);
	// Without a saved profile there is nothing to compare, so the server is not asked.
	const { data, error, loading, reload } = useLoad(() => (profileVersion ? call<Any>("fit.discover", { startupId, filters: toInput(filters) }) : Promise.resolve(null)), [startupId, rev, profileVersion, JSON.stringify(filters)]);
	const save = useAction();
	if (!profileVersion)
		return (
			<EmptyState title="Save your profile first" actions={<a className="button primary" href={href("founder", startupId, "profile")}>Go to your profile</a>}>
				Investors are compared with what you have said about the company. Add as much or as little as you know; unknown parts stay unknown.
			</EmptyState>
		);
	const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setFilters({ ...filters, [k]: v });
	const active = activeFilters(filters);
	const u = data?.universe as { published: number; researched: number } | undefined;
	return (
		<div className="stack">
			<p className="muted">
				Each investor is compared with your profile on four separate questions: <strong>Investor fit</strong>, <strong>Readiness</strong>, <strong>Evidence quality</strong> and <strong>Research completeness</strong>. None is a score or a prediction that anyone will invest.
			</p>
			{data ? (
				<Notice kind="info" title="Where these investors come from">
					<span data-testid="universe">
						{u && u.published + u.researched > 0 ? `${plural(u.published, "investor")} published by the firm itself and ${plural(u.researched, "investor")} researched in your workspace. ` : "No investor data is available to compare with yet. "}
						This is <strong>not the whole market</strong>: an investor appears only after a verified representative publishes its criteria or your workspace researches it. An investor missing here may well fit.
					</span>
				</Notice>
			) : null}
			<details className="filters-wrap" open={!narrowScreen()}>
			<summary>Filters{active.length ? ` (${active.length} active)` : ""}</summary>
			<div className="filters" data-testid="filters" role="search" aria-label="Filter investors">
				<MultiFilter label="Stage" options={STARTUP_STAGES} value={filters.stage} onChange={(v) => set("stage", v)} />
				<MultiFilter label="Sector" options={SECTOR_KEYS} value={filters.sector} onChange={(v) => set("sector", v)} />
				<MultiFilter label="Geography" options={GEOGRAPHY_KEYS} value={filters.geography} onChange={(v) => set("geography", v)} />
				<MultiFilter label="Business model" options={BUSINESS_MODEL_KEYS} value={filters.businessModel} onChange={(v) => set("businessModel", v)} />
				<label className="field inline">
					Cheque size from (US dollars)
					<input inputMode="numeric" value={filters.minUsd} onChange={(e) => set("minUsd", e.target.value)} placeholder="500000" />
				</label>
				<label className="field inline">
					to (US dollars)
					<input inputMode="numeric" value={filters.maxUsd} onChange={(e) => set("maxUsd", e.target.value)} placeholder="2000000" />
				</label>
				<label className="field inline">
					Name
					<input type="search" value={filters.query} onChange={(e) => set("query", e.target.value)} />
				</label>
				<label>
					<input type="checkbox" checked={filters.unknown} onChange={(e) => set("unknown", e.target.checked)} /> Keep investors whose criteria are unknown
				</label>
				<label>
					<input type="checkbox" checked={filters.approvedOnly} onChange={(e) => set("approvedOnly", e.target.checked)} /> Only criteria approved by the firm
				</label>
				<label>
					<input type="checkbox" checked={filters.freshOnly} onChange={(e) => set("freshOnly", e.target.checked)} /> Only current research
				</label>
				<label>
					<input type="checkbox" checked={filters.includeFounderExcluded} onChange={(e) => set("includeFounderExcluded", e.target.checked)} /> Show investors I excluded
				</label>
			</div>
			</details>
			{active.length ? (
				<ul className="chips plain" aria-label="Active filters">
					{active.map((a) => (
						<li key={a.label}>
							<span className="chip">
								{a.label}
								<button type="button" className="chip-x" aria-label={`Remove filter: ${a.label}`} onClick={() => setFilters({ ...filters, ...a.clear })}>
									×
								</button>
							</span>
						</li>
					))}
					<li>
						<button type="button" className="link" onClick={() => setFilters(NO_FILTERS)}>
							Clear all filters
						</button>
					</li>
				</ul>
			) : null}
			{loading && !data ? <Loading what="candidate investors" /> : <ErrorNote error={error} />}
			{data ? (
				<>
					<p className="muted small" role="status">
						{data.shown} of {data.total} investors shown · compared with profile version {data.profileVersion}
					</p>
					{data.empty === "no_investors" ? (
						<EmptyState title="No investor data is available yet" actions={<a className="button" href={href("founder", startupId, "profile")}>Review your profile</a>}>
							This is different from "no investor matches": there is nothing to compare with. Investors appear here after a verified representative publishes its criteria, or after research is run in your workspace. Check back later.
						</EmptyState>
					) : data.empty === "filtered_out" ? (
						<EmptyState title="No investor matches these filters" actions={<button type="button" onClick={() => setFilters(NO_FILTERS)}>Clear all filters</button>}>
							{plural(data.total, "investor")} {data.total === 1 ? "is" : "are"} available but none passes the filters above. Remove a filter, or keep investors whose criteria are unknown: unknown is not a mismatch.
						</EmptyState>
					) : null}
					<ul className="plain candidates" data-testid="candidates">
						{data.candidates.map((c: Any) => (
							<Candidate key={c.investorKey} c={c} startupId={startupId} open={open === c.investorKey} toggle={() => setOpen(open === c.investorKey ? null : c.investorKey)} onChanged={() => { onChanged(); void reload(); }} save={save} />
						))}
					</ul>
					<ErrorNote error={save.error} />
				</>
			) : null}
		</div>
	);
}

function Dimension({ id, title, children }: { id: string; title: string; children: ReactNode }) {
	return (
		<div className="dim" data-dim={id}>
			<span className="dim-title">{title}</span>
			{children}
		</div>
	);
}

function Candidate({ c, startupId, open, toggle, onChanged, save }: { c: Any; startupId: string; open: boolean; toggle: () => void; onChanged: () => void; save: ReturnType<typeof useAction> }) {
	const fit = entry(FIT, c.mandate.summary);
	const comp = entry(COMPLETENESS, c.coverage.level);
	const q = c.evidenceQuality;
	const supported = q.reviewer_verified + q.corroborated;
	const providedOnly = q.supplied_by_founder + q.source_cited + q.founder_assertion;
	const researched = c.investorRef.lastResearchedAt;
	return (
		<li className="candidate" data-investor={c.investorKey}>
			<div className="row between">
				<div>
					<h3>
						{c.name} <span className="muted small">{c.investorKey}</span>
					</h3>
					<div className="muted small">
						{UNIVERSE[c.source]}
						{c.investorRef.publishedVersion ? `, profile version ${c.investorRef.publishedVersion}` : ""}
						{researched ? `, ${c.source === "published_profile" ? "published" : "researched"} ${ageLabel(researched)}` : ""}
					</div>
				</div>
				<div className="row">
					{c.shortlisted ? (
						<Badge tone="ok">On your shortlist</Badge>
					) : (
						<button
							type="button"
							onClick={async () => {
								if (await save.run(() => call("shortlist.save", { startupId, investorKey: c.investorKey }))) onChanged();
							}}
							disabled={save.busy}
						>
							Save to shortlist
						</button>
					)}
					<button type="button" className="primary" onClick={toggle} aria-expanded={open}>
						{open ? "Hide explanation" : "Explain"}
					</button>
				</div>
			</div>
			<p className="candidate-why" data-testid="why-appears">
				<strong>Why it appears:</strong> {c.filterNotes.length ? `Kept despite unknown criteria (${c.filterNotes.join("; ")}). ` : ""}
				{c.mandate.statement}
			</p>
			{!open ? (
			<div className="dims">
				<Dimension id="mandate" title="Investor fit">
					<Badge entry={fit} />
					<span className="small">
						{c.mandate.counts.compatible} compatible · {c.mandate.counts.incompatible} incompatible · {c.mandate.counts.unknown} unknown
					</span>
				</Dimension>
				<Dimension id="readiness" title="Readiness">
					<span className="small">
						{c.readiness.met} provided · {c.readiness.evidence_not_provided} not provided yet · {c.readiness.not_met} not met
					</span>
				</Dimension>
				<Dimension id="quality" title="Evidence quality">
					<span className="small">
						{supported} independently supported · {providedOnly} provided by you only{q.conflicting ? ` · ${q.conflicting} conflicting` : ""}
					</span>
				</Dimension>
				<Dimension id="coverage" title="Research completeness">
					<Badge entry={comp} />
					{c.coverage.flags.map((f: string) => (
						<Badge key={f} entry={entry(FLAG, f)} />
					))}
				</Dimension>
			</div>
			) : null}
			{c.coverage.limitsPrecision && !open ? (
				<Notice kind="warn">
					<span data-testid="limited">Little is known about this investor, so read this as a partial view, not a verdict.</span> {comp.help}
				</Notice>
			) : null}
			{c.mandate.founderExcluded ? <p className="small">You excluded this investor.</p> : null}
			{c.latestEvaluation && !c.latestEvaluation.current ? <Notice kind="warn">Your last saved evaluation (#{c.latestEvaluation.sequence}) no longer matches your current data. Open the explanation to re-run it.</Notice> : null}
			{open ? <Explanation startupId={startupId} investorKey={c.investorKey} onChanged={onChanged} /> : null}
		</li>
	);
}

// ---------------------------------------------------------------------------------------- explanation

function SourceBlock({ d }: { d: Any }) {
	const a = entry(AUTHORITY, d.authority);
	return (
		<div className="source-block">
			<div className="small">
				<Badge entry={a} /> <span className="muted">via {String(d.publisher).replace(/^firm:/, "")}</span>
				{d.verification && !["unchecked", "approved", "not_applicable"].includes(d.verification) ? <> · source check: {term(d.verification)}</> : null}
				{d.freshness === "stale" ? (
					<>
						{" "}
						· <Badge entry={FLAG.stale} />
					</>
				) : null}
				{d.lifecycle === "disputed" ? (
					<>
						{" "}
						· <Badge entry={FLAG.disputed} />
					</>
				) : null}
			</div>
			<blockquote>{d.passage}</blockquote>
			<div className="muted small">
				{d.authority === "investor_approved" ? "Published by the firm" : "Captured"} {when(d.capturedAt)}
				{d.url && /^https:\/\//.test(d.url) ? (
					<>
						{" · "}
						<a href={d.url} target="_blank" rel="noopener noreferrer nofollow">
							Open the source page
						</a>
					</>
				) : null}
			</div>
		</div>
	);
}

function Verdict({ title, children, statement }: { title: string; children: ReactNode; statement: string }) {
	return (
		<div className="verdict">
			<div className="dim-title">{title}</div>
			{children}
			<p className="small">{statement}</p>
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
				<p className="muted small">An evaluation records exactly which profile, evidence and investor information it used, so it can be reproduced later. Running it changes nothing else and contacts no one.</p>
				<button className="primary" onClick={evaluate} disabled={run.busy}>
					{run.busy ? "Evaluating…" : "Evaluate and explain"}
				</button>
				<ErrorNote error={run.error} />
			</div>
		);
	const r = evaluation.result as Any;
	const inputs = evaluation.inputs as Any;
	const fit = entry(FIT, r.mandate.summary);
	const comp = entry(COMPLETENESS, r.coverage.level);
	const q = r.evidenceQuality.counts;
	const topActions = (r.actions as Any[]).slice(0, 5);
	return (
		<div className="explanation" data-testid="explanation">
			<p className="small" role="status">
				{meta?.reused ? "Nothing has changed since the last evaluation, so this is the same one, not a new one." : meta?.previous ? `New evaluation #${evaluation.sequence}. The earlier one is kept unchanged.` : `Evaluation #${evaluation.sequence}.`}
			</p>
			{evaluation.changes?.length ? (
				<Notice kind="info" title="What changed since the previous evaluation">
					<ul data-testid="changes">
						{evaluation.changes.map((c: string) => (
							<li key={c}>{c}</li>
						))}
					</ul>
				</Notice>
			) : null}

			<div className="verdicts" data-testid="verdicts">
				<Verdict title="Investor fit" statement={r.mandate.statement}>
					<Badge entry={fit} />
				</Verdict>
				<Verdict title="Readiness" statement={r.readiness.statement}>
					<span className="small">
						{r.readiness.counts.met} provided · {r.readiness.counts.evidence_not_provided} not provided yet · {r.readiness.counts.not_met} not met
					</span>
				</Verdict>
				<Verdict title="Evidence quality" statement={r.evidenceQuality.statement}>
					<span className="small">
						{q.reviewer_verified + q.corroborated} independently supported · {q.supplied_by_founder + q.source_cited + q.founder_assertion} provided by you only{q.conflicting ? ` · ${q.conflicting} conflicting` : ""}
					</span>
				</Verdict>
				<Verdict title="Research completeness" statement={r.coverage.statement}>
					<Badge entry={comp} />
				</Verdict>
			</div>

			<h4>The reasons</h4>
			<ul className="small" data-testid="reasons">
				{r.relevance.map((x: string) => (
					<li key={x}>{x}</li>
				))}
			</ul>

			<h4>Investor fit, criterion by criterion</h4>
			<div className="table-wrap">
				<table className="list responsive" data-testid="mandate-table">
					<caption className="visually-hidden">How the investor's criteria compare with your profile</caption>
					<thead>
						<tr>
							<th scope="col">Criterion</th>
							<th scope="col">Your profile</th>
							<th scope="col">Result</th>
							<th scope="col">Why, and the source</th>
						</tr>
					</thead>
					<tbody>
						{r.mandate.constraints.map((c: Any) => {
							const key = c.status === "incompatible" ? (c.strength === "hard" ? "incompatible_hard" : "incompatible_soft") : c.status;
							return (
								<tr key={c.field} data-field={c.field}>
									<th scope="row" data-label="Criterion">
										{sentence(c.field)}
									</th>
									<td data-label="Your profile">{c.startupValue || <span className="muted">Not stated</span>}</td>
									<td data-label="Result">
										<Badge entry={CONSTRAINT[key]} />
									</td>
									<td data-label="Why">
										<p className="small">{c.rationale}</p>
										{c.unknownReason && !["no_criterion", "startup_field_missing"].includes(c.unknownReason) ? <p className="muted small">{UNKNOWN_WHY[c.unknownReason]}</p> : null}
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
															{x.polarity === "exclude" ? "Excludes" : "Includes"} {x.label} — {entry(AUTHORITY, x.authority).label}
															{x.freshness === "stale" ? ", out of date" : ""}
														</li>
													))}
												</ul>
											</details>
										) : null}
										{c.conflictIds.length ? (
											<Notice kind="warn">{c.decidedBy && ["investor_approved", "workspace_approved"].includes(c.decidedBy.authority) ? "Another source disagrees. The approved value stands, so this is settled; the disagreement stays visible." : "Sources disagree on this and nothing approved settles it, so it is left unresolved."}</Notice>
										) : null}
									</td>
								</tr>
							);
						})}
					</tbody>
				</table>
			</div>

			<h4>What to do next</h4>
			<p className="muted small">{r.labels.recommendations}</p>
			<ol className="small" data-testid="actions">
				{topActions.map((a: Any) => (
					<li key={a.id}>
						<Badge tone="neutral">{ACTION_KIND[a.kind]?.label ?? a.kind}</Badge> <strong>{a.title}</strong>
						<div className="muted">Why: {a.why}</div>
					</li>
				))}
				{!r.actions.length ? <li className="muted">Nothing to recommend from the current findings.</li> : null}
			</ol>
			{r.actions.length > topActions.length ? <p className="muted small">{r.actions.length - topActions.length} lower-priority suggestions are on your shortlist.</p> : null}

			<details data-testid="readiness">
				<summary>Readiness in detail ({r.readiness.items.length} items)</summary>
				<ul className="plain small">
					{r.readiness.items.map((i: Any) => (
						<li key={i.id}>
							<Badge entry={entry(READINESS, i.status)} /> <strong>{i.label}</strong> <span className="muted">({i.basis === "investor_criterion" ? "from this investor's own criteria" : "general checklist, not this investor's requirement"})</span>
							<div>{i.detail}</div>
							{i.status === "evidence_not_provided" || i.status === "not_met" ? <div className="muted">What would help: {i.whatWouldHelp}</div> : null}
						</li>
					))}
				</ul>
			</details>
			<details data-testid="quality">
				<summary>Evidence quality in detail ({r.evidenceQuality.claims.length} statements)</summary>
				<ul className="plain small">
					{r.evidenceQuality.claims.map((c: Any) => (
						<li key={c.field}>
							<Badge entry={entry(EVIDENCE, c.quality)} /> {c.stale ? <Badge entry={FLAG.stale} /> : null} {c.claim}
							<div className="muted">{c.detail}</div>
						</li>
					))}
				</ul>
			</details>
			<details>
				<summary>Research completeness in detail</summary>
				<p className="small muted">
					{Object.entries(r.coverage.fields)
						.map(([f, v]) => `${sentence(f)}: ${FIELD_COMPLETENESS[v as string] ?? v}`)
						.join(" · ")}
				</p>
			</details>
			<details>
				<summary>Evaluation details: exactly what this used</summary>
				<ul className="small" data-testid="provenance">
					<li>Your profile, version {inputs.profile.version}</li>
					<li>{plural(inputs.evidence.refs.length, "evidence item")} on record</li>
					<li>
						The investor: {UNIVERSE[inputs.investor.source]}
						{inputs.investor.publishedVersion ? `, published profile version ${inputs.investor.publishedVersion}` : ""}, {plural(inputs.investor.factRefs.length, "criterion", "criteria")}
					</li>
					<li>
						Matching rules {evaluation.policyVersion}, readiness checklist {evaluation.frameworkVersion}; evaluated {when(evaluation.evaluatedAt)}
					</li>
					<li>No AI model was used. The rules are fixed, so the same inputs always give the same result.</li>
				</ul>
				<p className="small muted">
					Statement types: <strong>sourced facts</strong> — {r.labels.sourcedFacts} <strong>Provided by you</strong> — {r.labels.founderAssertions} <strong>Inferences</strong> — {r.labels.inferences}
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
								#{h.sequence}, {when(h.evaluatedAt)}, profile version {h.profileVersion}: {entry(FIT, h.mandate).label}
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
						<Notice kind="info" title={`#${cmp.data.from.sequence} → #${cmp.data.to.sequence}`}>
							<ul data-testid="comparison">
								{[...cmp.data.inputs, ...cmp.data.results].map((x: string) => (
									<li key={x}>{x}</li>
								))}
								{![...cmp.data.inputs, ...cmp.data.results].length ? <li>No differences.</li> : null}
							</ul>
						</Notice>
					) : null}
				</details>
			) : null}
		</div>
	);
}

// ---------------------------------------------------------------------------------------- shortlist and plan

const SHOW_FIRST = 3;

export function ShortlistTab({ startupId, rev, onChanged }: { startupId: string; rev: number; onChanged: () => void }) {
	const { data, error, loading, reload } = useLoad(() => call<{ items: Any[] }>("shortlist.list", { startupId }).then((r) => r.items), [startupId, rev]);
	const [open, setOpen] = useState<string | null>(null);
	const [showAllPlan, setShowAllPlan] = useState(false);
	const act = useAction();
	// Every edit is fenced on the entry's version, so wait for the reload before the next one: a stale version would be refused.
	const update = (e: Any, patch: Any) =>
		act.run(async () => {
			await call("shortlist.update", { entryId: e.id, expectedVersion: e.__version, ...patch });
			await reload();
			onChanged();
		});
	if (loading && !data) return <Loading what="your shortlist" />;
	if (!data) return <ErrorNote error={error} />;
	const plan = data
		.flatMap((r) => r.actions.filter((a: Any) => a.state === "open").map((a: Any) => ({ ...a, investorName: r.entry.investorName, investorKey: r.entry.investorKey })))
		.sort((a, b) => a.priority - b.priority || a.investorName.localeCompare(b.investorName));
	const important = plan.filter((a) => a.priority <= 5);
	const shown = showAllPlan ? plan : important.slice(0, 5);
	return (
		<div className="stack">
			<p className="muted">Your shortlist is private. Nothing is sent to anyone: no outreach, introductions or sharing happens here. The steps are suggestions about your own materials, not a promise that completing them leads to investment.</p>
			{!data.length ? (
				<EmptyState title="Nothing shortlisted yet" actions={<a className="button primary" href={href("founder", startupId, "investors")}>Find investors</a>}>
					Save investors you want to follow up from the Find investors step. They stay private to you.
				</EmptyState>
			) : null}
			{plan.length ? (
				<Section title="Your next steps">
					<ol data-testid="plan" className="small">
						{shown.map((a) => (
							<li key={`${a.investorKey}:${a.id}`}>
								<Badge tone="neutral">{ACTION_KIND[a.kind]?.label ?? a.kind}</Badge> <strong>{a.title}</strong> <span className="muted">— {a.investorName}</span>
								<div className="muted">Why: {a.why}</div>
							</li>
						))}
					</ol>
					{plan.length > shown.length || showAllPlan ? (
						<button type="button" className="link" onClick={() => setShowAllPlan(!showAllPlan)}>
							{showAllPlan ? "Show the most important only" : `Show ${plan.length - shown.length} more, lower priority`}
						</button>
					) : null}
				</Section>
			) : data.length ? (
				<Notice kind="success">No open next steps. If you change your profile or evidence, re-run the evaluations to see what changes.</Notice>
			) : null}
			<ul className="plain candidates" data-testid="shortlist">
				{data.map((r) => (
					<ShortlistRow
						key={r.entry.id}
						r={r}
						open={open === r.entry.id}
						toggle={() => setOpen(open === r.entry.id ? null : r.entry.id)}
						update={update}
						busy={act.busy}
						refresh={() => {
							void reload();
							onChanged();
						}}
						startupId={startupId}
					/>
				))}
			</ul>
			<ErrorNote error={act.error} />
		</div>
	);
}

function ShortlistRow({ r, open, toggle, update, busy, refresh, startupId }: { r: Any; open: boolean; toggle: () => void; update: (e: Any, patch: Any) => Promise<unknown>; busy: boolean; refresh: () => void; startupId: string }) {
	const [all, setAll] = useState(false);
	const [note, setNote] = useState<string>(r.entry.note ?? "");
	const fit = r.latest ? entry(FIT, r.latest.mandate) : null;
	const actions: Any[] = r.actions;
	const visible = all ? actions : actions.slice(0, SHOW_FIRST);
	return (
		<li className="candidate" data-investor={r.entry.investorKey}>
			<div className="row between">
				<div>
					<h3>
						{r.entry.investorName} <span className="muted small">{r.entry.investorKey}</span>
					</h3>
					{r.latest ? (
						<div className="small">
							{fit ? <Badge entry={fit} /> : null} <Badge entry={entry(COMPLETENESS, r.latest.coverage)} />{" "}
							<span className="muted">
								evaluation #{r.latest.sequence}, profile version {r.latest.profileVersion}, {when(r.latest.evaluatedAt)}
							</span>
						</div>
					) : (
						<div className="muted small">Not evaluated yet.</div>
					)}
				</div>
				<div className="row">
					<select aria-label={`Status for ${r.entry.investorName}`} value={r.entry.status} disabled={busy} onChange={(e) => void update(r.entry, { status: e.target.value })}>
						{SHORTLIST_STATUS.map((o) => (
							<option key={o.value} value={o.value}>
								{o.label}
							</option>
						))}
					</select>
					<button type="button" onClick={toggle} aria-expanded={open}>
						{open ? "Hide explanation" : "Explain"}
					</button>
					<ConfirmButton label="Remove" className="quiet" title={`Remove ${r.entry.investorName} from your shortlist?`} confirmLabel="Remove from shortlist" consequence={<p>It disappears from your shortlist. Your evaluations and notes are kept, and you can add it again later.</p>} onConfirm={() => update(r.entry, { remove: true })} />
				</div>
			</div>
			{r.staleness && !r.staleness.current ? (
				<Notice kind="warn">
					<span data-testid="stale">This evaluation no longer matches your current data.</span> {r.staleness.reasons.join(" ")} Open the explanation and re-run it.
				</Notice>
			) : null}
			<div className="row bottom">
				<label className="field inline grow">
					Private note
					<input value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
				</label>
				{note !== (r.entry.note ?? "") ? (
					<button type="button" disabled={busy} onClick={() => void update(r.entry, { note })}>
						Save note
					</button>
				) : null}
			</div>
			<ul className="plain small">
				{visible.map((a) => (
					<li key={a.id} className={a.state !== "open" ? "done" : ""}>
						<Badge tone={a.state === "open" ? "neutral" : "ok"}>{a.state === "open" ? (ACTION_KIND[a.kind]?.label ?? a.kind) : a.state === "done" ? "Done" : "Dismissed"}</Badge> <strong>{a.title}</strong>
						<div className="muted">Why: {a.why}</div>
						{a.kind !== "re_evaluate" ? (
							<div className="row">
								{a.state === "open" ? (
									<>
										<button type="button" className="quiet" disabled={busy} onClick={() => void update(r.entry, { actions: { [a.id]: "done" } })}>
											Mark done
										</button>
										<button type="button" className="quiet" disabled={busy} onClick={() => void update(r.entry, { actions: { [a.id]: "dismissed" } })}>
											Not relevant
										</button>
									</>
								) : (
									<button type="button" className="quiet" disabled={busy} onClick={() => void update(r.entry, { actions: { [a.id]: "open" } })}>
										Reopen
									</button>
								)}
							</div>
						) : null}
					</li>
				))}
			</ul>
			{actions.length > SHOW_FIRST ? (
				<button type="button" className="link" onClick={() => setAll(!all)}>
					{all ? "Show fewer" : `Show all ${actions.length} steps`}
				</button>
			) : null}
			{open ? <Explanation startupId={startupId} investorKey={r.entry.investorKey} onChanged={refresh} /> : null}
		</li>
	);
}
