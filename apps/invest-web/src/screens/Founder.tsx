import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import { BUSINESS_MODEL_KEYS, GEOGRAPHY_KEYS, PRODUCT_STATUSES, PROFILE_METRICS, REVENUE_STATUSES, SECTOR_KEYS, STARTUP_STAGES, type DeclaredBasis, type FieldProvenance, type Known, type ProfileContent, type ProfileMetric } from "../../../../invest/domain/founder.ts";
import type { EvidenceView, Startup } from "../../../../invest/domain/types.ts";
import { call } from "../api.ts";
import { DocumentsPanel, type DocumentRow } from "../components/Documents.tsx";
import { sentence, term, usdRange } from "../format.ts";
import { BASIS, EVIDENCE } from "../vocab.ts";
import { Badge, EmptyState, ErrorNote, Loading, Notice, PageHead, Section, href, navigate, useAction, useCan, useLoad, when } from "../ui.tsx";
import { type Draft, missingForMatching, validateDraft, type Errors } from "../rules.ts";
import { DiscoverTab, ShortlistTab } from "./FounderMatch.tsx";

type Any = Record<string, any>; // eslint-disable-line

const METRIC_LABEL: Record<ProfileMetric, { label: string; unit: string; revenue: boolean }> = {
	arr: { label: "Annual recurring revenue", unit: "USD", revenue: true },
	mrr: { label: "Monthly recurring revenue", unit: "USD", revenue: true },
	revenue_growth_pct: { label: "Revenue growth", unit: "%", revenue: true },
	gross_margin_pct: { label: "Gross margin", unit: "%", revenue: true },
	net_revenue_retention_pct: { label: "Net revenue retention", unit: "%", revenue: true },
	customers: { label: "Customers", unit: "count", revenue: false },
	runway_months: { label: "Runway", unit: "months", revenue: false },
	team_size: { label: "Team size", unit: "count", revenue: false },
};

/** Why each question is asked, and what it is used for. Shown beside the field so no request is unexplained. */
const WHY: Record<string, { use: "match" | "readiness"; why: string }> = {
	sectors: { use: "match", why: "Investors list the sectors they back. This is compared with their stated focus." },
	businessModels: { use: "match", why: "Some investors only back certain models, such as software or marketplaces." },
	headquarters: { use: "match", why: "Many investors invest only in certain regions." },
	targetMarkets: { use: "match", why: "Where you sell can matter as much as where you are based." },
	currentStage: { use: "match", why: "Investors state the stages they invest at." },
	fundraisingStage: { use: "match", why: "The round you are raising is compared with the stages investors back. If it is not stated, your current stage is used." },
	targetRaise: { use: "match", why: "Compared with each investor's cheque size. A single cheque smaller than your round is fine; a minimum above the whole round is not." },
	revenueStatus: { use: "readiness", why: "Decides whether revenue figures are expected of you at all." },
	productStatus: { use: "readiness", why: "Some investors look for a working product before they consider a company." },
	team: { use: "readiness", why: "Shown to you as a checklist item. It is never interpreted or scored." },
};
const USE_LABEL = { match: "Used to compare with investors", readiness: "Used for readiness" } as const;

const DEFAULT_PROVENANCE = (): FieldProvenance => ({ basis: "founder_assertion", evidenceIds: [], sourceUrl: null });

// ---------------------------------------------------------------------------------------- screen

const STEPS = [
	{ id: "profile", label: "Profile", help: "What you say about the company" },
	{ id: "evidence", label: "Evidence", help: "Documents that back it up" },
	{ id: "investors", label: "Find investors", help: "Who fits, and why" },
	{ id: "shortlist", label: "Shortlist", help: "Your next steps" },
] as const;
type StepId = (typeof STEPS)[number]["id"];

export function FounderScreen({ startupId, step }: { startupId?: string; step?: string }) {
	const canWrite = useCan("startup.write");
	const list = useLoad(() => call<{ items: Startup[] }>("startup.list", {}).then((r) => r.items), []);
	const action = useAction();
	const [name, setName] = useState("");
	const [nameError, setNameError] = useState<string | null>(null);
	// A founder with one startup resumes straight into it.
	useEffect(() => {
		if (!startupId && list.data?.length === 1) window.location.replace(href("founder", list.data[0]!.id, "profile"));
	}, [startupId, list.data]);
	if (startupId) return <StartupJourney startupId={startupId} step={(STEPS.find((s) => s.id === step)?.id ?? "profile") as StepId} />;
	return (
		<>
			<PageHead title="Your startups" sub="Everything here is private to your workspace. Nothing is shared with investors, published or sent anywhere." />
			{list.loading && !list.data ? <Loading what="your startups" /> : <ErrorNote error={list.error} />}
			{list.data?.length ? (
				<ul className="plain cards" data-testid="startup-list">
					{list.data.map((s) => (
						<li key={s.id} className="card">
							<a href={href("founder", s.id, "profile")}>
								<strong>{s.name}</strong>
							</a>
							<span className="muted small"> last changed {when(s.updatedAt)}</span>
						</li>
					))}
				</ul>
			) : list.data ? (
				<EmptyState title="No startup yet">Create one to start your private profile. You can leave anything you do not know blank.</EmptyState>
			) : null}
			{canWrite ? (
				<Section title="Add a startup">
					<form
						className="row bottom"
						noValidate
						onSubmit={async (e: FormEvent) => {
							e.preventDefault();
							if (!name.trim()) return setNameError("Enter the company name.");
							setNameError(null);
							const r = await action.run(() => call<{ startup: Startup }>("startup.create", { name: name.trim() }));
							if (r) navigate("founder", r.startup.id, "profile");
						}}
					>
						<label className="field">
							Company name <span className="muted small">(required)</span>
							<input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} aria-invalid={nameError ? true : undefined} aria-describedby={nameError ? "name-error" : undefined} />
							{nameError ? (
								<span className="field-error" id="name-error" role="alert">
									{nameError}
								</span>
							) : null}
						</label>
						<button className="primary" disabled={action.busy}>
							Create startup
						</button>
					</form>
					<ErrorNote error={action.error} />
				</Section>
			) : null}
		</>
	);
}

function StartupJourney({ startupId, step }: { startupId: string; step: StepId }) {
	// Bumped when anything another step depends on changes (profile saved, evidence added, shortlist edited).
	const [rev, setRev] = useState(0);
	const bump = () => setRev((n) => n + 1);
	const profile = useLoad(() => call<Any>("startup.profile.get", { startupId }), [startupId, rev]);
	if (profile.loading && !profile.data) return <Loading what="your startup" />;
	if (!profile.data) return <ErrorNote error={profile.error} />;
	const p = profile.data;
	return (
		<>
			<PageHead
				title={p.startup.name}
				sub={
					<>
						Private to your workspace · {p.version ? `profile version ${p.version}` : "profile not saved yet"} · <a href={href("founder")}>All startups</a>
					</>
				}
			/>
			<nav className="steps-nav" aria-label="Your journey">
				<ol>
					{STEPS.map((s, i) => (
						<li key={s.id}>
							<a href={href("founder", startupId, s.id)} aria-current={step === s.id ? "step" : undefined}>
								<span className="step-no" aria-hidden="true">
									{i + 1}
								</span>
								<span>
									<strong>{s.label}</strong>
									<span className="muted small"> {s.help}</span>
								</span>
							</a>
						</li>
					))}
				</ol>
			</nav>
			{step === "profile" ? <ProfileTab startupId={startupId} data={p} onSaved={bump} /> : null}
			{step === "evidence" ? <EvidenceTab startupId={startupId} onChanged={bump} /> : null}
			{step === "investors" ? <DiscoverTab startupId={startupId} profileVersion={p.version} rev={rev} onChanged={bump} /> : null}
			{step === "shortlist" ? <ShortlistTab startupId={startupId} rev={rev} onChanged={bump} /> : null}
		</>
	);
}

// ---------------------------------------------------------------------------------------- profile

function ProvControls({ prov, onChange, evidence, metric }: { prov: FieldProvenance; onChange: (p: FieldProvenance) => void; evidence: EvidenceView[]; metric?: string }) {
	const candidates = evidence.filter((e) => !e.superseded && (!metric || e.metric?.key === metric));
	return (
		<div className="prov-controls">
			<label className="field inline">
				Where this comes from
				<select value={prov.basis} onChange={(e) => onChange({ ...prov, basis: e.target.value as DeclaredBasis })}>
					{Object.entries(BASIS).map(([k, v]) => (
						<option key={k} value={k}>
							{v}
						</option>
					))}
				</select>
			</label>
			{prov.basis === "official_public_source" || prov.basis === "third_party_source" ? (
				<label className="field inline">
					Link to the source
					<input value={prov.sourceUrl ?? ""} onChange={(e) => onChange({ ...prov, sourceUrl: e.target.value || null })} placeholder="https://" />
				</label>
			) : null}
			{candidates.length ? (
				<details>
					<summary>Link evidence ({prov.evidenceIds.length})</summary>
					<ul className="plain small">
						{candidates.map((e) => (
							<li key={e.id}>
								<label>
									<input type="checkbox" checked={prov.evidenceIds.includes(e.id)} onChange={(ev) => onChange({ ...prov, evidenceIds: ev.target.checked ? [...prov.evidenceIds, e.id] : prov.evidenceIds.filter((i) => i !== e.id) })} /> {e.claim}
								</label>
							</li>
						))}
					</ul>
					<p className="muted small">Linking a document does not make a claim true. The Evidence step and each explanation say how well it is supported.</p>
				</details>
			) : null}
		</div>
	);
}

/** One profile field that can be provided, unknown or not applicable, with the reason it is asked and its own validation message. */
function KnownField<T>({ id, label, value, onChange, evidence, metric, na = true, error, render }: { id: string; label: string; value: Known<T>; onChange: (v: Known<T>) => void; evidence: EvidenceView[]; metric?: string; na?: boolean; error?: string; render: (v: T | undefined, set: (v: T) => void) => ReactNode }) {
	const why = WHY[id];
	const state = value.state;
	return (
		<div className={`known-field ${error ? "has-error" : ""}`} data-field={id}>
			<div className="row between">
				<div>
					<strong>{label}</strong> {why ? <span className="badge tone-neutral small-badge">{USE_LABEL[why.use]}</span> : null}
				</div>
				<select
					aria-label={`${label} status`}
					value={state}
					onChange={(e) => {
						const s = e.target.value;
						if (s === "unknown") onChange({ state: "unknown" });
						else if (s === "not_applicable") onChange({ state: "not_applicable" });
						else onChange({ state: "provided", value: undefined as T, provenance: DEFAULT_PROVENANCE() });
					}}
				>
					<option value="unknown">Unknown or not stated</option>
					<option value="provided">I will provide it</option>
					{na ? <option value="not_applicable">Not applicable</option> : null}
				</select>
			</div>
			{why ? <p className="muted small">{why.why}</p> : null}
			{value.state === "provided" ? (
				<>
					{render(value.value, (v) => onChange({ ...value, value: v }))}
					<ProvControls prov={value.provenance} onChange={(provenance) => onChange({ ...value, provenance })} evidence={evidence} metric={metric} />
				</>
			) : (
				<p className="muted small">{state === "unknown" ? "Left unknown. Matching treats this as missing information, never as a failure." : "Marked not applicable. It is not counted against you."}</p>
			)}
			{error ? (
				<p className="field-error" role="alert">
					{error}
				</p>
			) : null}
		</div>
	);
}

function Checks({ options, value, onChange }: { options: readonly string[]; value: string[] | undefined; onChange: (v: string[]) => void }) {
	const v = value ?? [];
	return (
		<div className="checks">
			{options.map((o) => (
				<label key={o}>
					<input type="checkbox" checked={v.includes(o)} onChange={(e) => onChange(e.target.checked ? [...v, o] : v.filter((x) => x !== o))} /> {term(o)}
				</label>
			))}
		</div>
	);
}
function Select<T extends string>({ options, value, onChange, label }: { options: readonly T[]; value: T | undefined; onChange: (v: T) => void; label: string }) {
	return (
		<select aria-label={label} value={value ?? ""} onChange={(e) => onChange(e.target.value as T)}>
			<option value="" disabled>
				Choose…
			</option>
			{options.map((o) => (
				<option key={o} value={o}>
					{sentence(o)}
				</option>
			))}
		</select>
	);
}

const draftKey = (id: string) => `attn-invest-profile-draft:${id}`;
const readDraft = (id: string, version: number): Draft | null => {
	try {
		const raw = sessionStorage.getItem(draftKey(id));
		const d = raw ? (JSON.parse(raw) as { version: number; content: Draft }) : null;
		return d && d.version === version ? d.content : null;
	} catch {
		return null;
	}
};
const writeDraft = (id: string, version: number, content: Draft | null) => {
	try {
		if (content) sessionStorage.setItem(draftKey(id), JSON.stringify({ version, content }));
		else sessionStorage.removeItem(draftKey(id));
	} catch {
		/* storage unavailable: the draft just stays in the page */
	}
};

function ProfileTab({ startupId, data, onSaved }: { startupId: string; data: Any; onSaved: () => void }) {
	const canWrite = useCan("startup.write");
	const workspace = useLoad(() => call<{ workspace: { evidence: EvidenceView[] } }>("startup.get", { startupId }).then((r) => r.workspace.evidence), [startupId]);
	const saved = data.content as Draft;
	// What was typed survives a failed save, moving to another step, and a refresh, until it is saved or discarded.
	const [draft, setDraft] = useState<Draft>(() => readDraft(startupId, data.version) ?? saved);
	const [version, setVersion] = useState<number>(data.version);
	const [note, setNote] = useState("");
	const [errors, setErrors] = useState<Errors>({});
	const [done, setDone] = useState<{ text: string; stale: number } | null>(null);
	const [showRevenue, setShowRevenue] = useState(false);
	const action = useAction();
	const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
	useEffect(() => {
		writeDraft(startupId, version, dirty ? draft : null);
	}, [draft, dirty, version, startupId]);
	const ev = (workspace.data ?? []).filter((e) => !e.superseded);
	const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft({ ...draft, [k]: v });
	const lines = (v: string) => v.split("\n").map((l) => l.trim()).filter(Boolean);
	const missing = useMemo(() => missingForMatching(draft), [draft]);
	const preRevenue = (draft.revenueStatus.state === "provided" && draft.revenueStatus.value === "pre_revenue") || (draft.currentStage.state === "provided" && draft.currentStage.value === "pre_seed" && !(draft.revenueStatus.state === "provided" && draft.revenueStatus.value === "revenue_generating"));
	const metrics = draft.metrics ?? {};

	const submit = async (e: FormEvent) => {
		e.preventDefault();
		setDone(null);
		const found = validateDraft(draft);
		setErrors(found);
		if (Object.keys(found).length) {
			setTimeout(() => document.getElementById("profile-errors")?.focus(), 0);
			return;
		}
		const r = await action.run(() => call<Any>("startup.profile.save", { startupId, expectedVersion: version, content: draft, note }));
		if (!r) return;
		setVersion(r.version);
		setNote("");
		writeDraft(startupId, r.version, null);
		let stale = 0;
		if (!r.unchanged) {
			// Saved evaluations name the profile version they used; say which are now behind.
			const h = await call<{ items: Any[] }>("fit.history", { startupId }).catch(() => ({ items: [] as Any[] }));
			const latest = new Map<string, Any>();
			for (const i of h.items) if ((latest.get(i.investorKey)?.sequence ?? 0) < i.sequence) latest.set(i.investorKey, i);
			stale = [...latest.values()].filter((i) => i.profileVersion < r.version).length;
		}
		setDone({ text: r.unchanged ? "Nothing changed: this matches the saved version." : `Saved as version ${r.version}.`, stale });
		onSaved();
	};

	return (
		<form className="stack" onSubmit={submit} data-testid="profile-form" noValidate>
			<div className="note-block">
				<p>
					<strong>Only the company name is required, and you have given it.</strong> Everything below is optional. <em>Unknown</em> is a complete answer: matching treats it as missing information, never as a failure. Each statement records where it comes from, and nothing is treated as confirmed because you said it.
				</p>
				{missing.length ? (
					<p data-testid="missing-for-matching">
						<Badge tone="caution">To compare with investors</Badge> add: {missing.join(", ")}. Until then, those parts of the comparison stay unknown.
					</p>
				) : (
					<p data-testid="ready-for-matching">
						<Badge tone="ok">Ready to compare</Badge> You have given enough to compare with investors.
					</p>
				)}
				{dirty ? (
					<p role="status" data-testid="unsaved">
						<Badge tone="caution">Unsaved changes</Badge> Kept in this browser tab until you save.{" "}
						<button type="button" className="link" onClick={() => { setDraft(saved); setErrors({}); }}>
							Discard changes
						</button>
					</p>
				) : null}
			</div>
			{Object.keys(errors).length ? (
				<div className="notice error" role="alert" tabIndex={-1} id="profile-errors">
					<strong>{Object.keys(errors).length === 1 ? "One thing to fix before saving" : `${Object.keys(errors).length} things to fix before saving`}</strong>
					<ul>
						{Object.entries(errors).map(([k, m]) => (
							<li key={k}>
								<button type="button" className="link" onClick={() => document.querySelector(`[data-field="${k}"]`)?.scrollIntoView({ block: "center" })}>
									{m}
								</button>
							</li>
						))}
					</ul>
					<p className="small">Nothing you typed has been lost.</p>
				</div>
			) : null}

			<Section title="About the company">
				<label className="field wide">
					Concise description <span className="muted small">(optional, shown only to you)</span>
					<textarea value={draft.description} onChange={(e) => set("description", e.target.value)} rows={2} maxLength={700} aria-invalid={errors.description ? true : undefined} />
					{errors.description ? <span className="field-error">{errors.description}</span> : null}
				</label>
				<KnownField id="sectors" label="Sector" value={draft.sectors} onChange={(v) => set("sectors", v)} evidence={ev} na={false} error={errors.sectors} render={(v, s) => <Checks options={SECTOR_KEYS} value={v} onChange={s} />} />
				<KnownField id="businessModels" label="Business model" value={draft.businessModels} onChange={(v) => set("businessModels", v)} evidence={ev} na={false} error={errors.businessModels} render={(v, s) => <Checks options={BUSINESS_MODEL_KEYS} value={v} onChange={s} />} />
				<KnownField id="headquarters" label="Headquarters" value={draft.headquarters} onChange={(v) => set("headquarters", v)} evidence={ev} na={false} error={errors.headquarters} render={(v, s) => <Select label="Headquarters" options={GEOGRAPHY_KEYS} value={v} onChange={s} />} />
				<KnownField id="targetMarkets" label="Target markets" value={draft.targetMarkets} onChange={(v) => set("targetMarkets", v)} evidence={ev} na={false} error={errors.targetMarkets} render={(v, s) => <Checks options={GEOGRAPHY_KEYS} value={v} onChange={s} />} />
			</Section>

			<Section title="Stage and fundraising">
				<KnownField id="currentStage" label="Current stage" value={draft.currentStage} onChange={(v) => set("currentStage", v)} evidence={ev} na={false} error={errors.currentStage} render={(v, s) => <Select label="Current stage" options={STARTUP_STAGES} value={v} onChange={s} />} />
				<KnownField id="fundraisingStage" label="Round you are raising" value={draft.fundraisingStage} onChange={(v) => set("fundraisingStage", v)} evidence={ev} error={errors.fundraisingStage} render={(v, s) => <Select label="Round you are raising" options={STARTUP_STAGES} value={v} onChange={s} />} />
				<KnownField
					id="targetRaise"
					label="Target raise (US dollars)"
					value={draft.targetRaise}
					onChange={(v) => set("targetRaise", v)}
					evidence={ev}
					error={errors.targetRaise}
					render={(v, s) => (
						<div className="row">
							<label className="field inline">
								Minimum
								<input inputMode="numeric" value={v?.minUsd ?? ""} onChange={(e) => s({ minUsd: e.target.value === "" ? null : Number(e.target.value), maxUsd: v?.maxUsd ?? null })} placeholder="1000000" />
							</label>
							<label className="field inline">
								Maximum
								<input inputMode="numeric" value={v?.maxUsd ?? ""} onChange={(e) => s({ minUsd: v?.minUsd ?? null, maxUsd: e.target.value === "" ? null : Number(e.target.value) })} placeholder="1500000" />
							</label>
							{v && (v.minUsd !== null || v.maxUsd !== null) ? (
								<span className="muted small" aria-live="polite">
									= {usdRange(v)}
								</span>
							) : null}
						</div>
					)}
				/>
			</Section>

			<Section title="Traction and product">
				<KnownField id="revenueStatus" label="Revenue status" value={draft.revenueStatus} onChange={(v) => set("revenueStatus", v)} evidence={ev} error={errors.revenueStatus} render={(v, s) => <Select label="Revenue status" options={REVENUE_STATUSES} value={v} onChange={s} />} />
				<KnownField id="productStatus" label="Product status" value={draft.productStatus} onChange={(v) => set("productStatus", v)} evidence={ev} error={errors.productStatus} render={(v, s) => <Select label="Product status" options={PRODUCT_STATUSES} value={v} onChange={s} />} />
				{preRevenue ? (
					<Notice>
						Revenue figures are hidden because you are pre-revenue. They are not expected of you and are not counted against you.{" "}
						<button type="button" className="link" onClick={() => setShowRevenue(!showRevenue)}>
							{showRevenue ? "Hide revenue figures" : "Show revenue figures anyway"}
						</button>
					</Notice>
				) : null}
				{PROFILE_METRICS.filter((m) => !METRIC_LABEL[m].revenue || !preRevenue || showRevenue || metrics[m]?.state === "provided").map((m) => (
					<KnownField
						key={m}
						id={`metrics.${m}`}
						label={`${METRIC_LABEL[m].label} (${METRIC_LABEL[m].unit})`}
						value={metrics[m] ?? { state: "unknown" }}
						onChange={(v) => setDraft({ ...draft, metrics: { ...metrics, [m]: v } })}
						evidence={ev}
						metric={m}
						error={errors[`metrics.${m}`]}
						render={(v, s) => <input aria-label={METRIC_LABEL[m].label} inputMode="decimal" value={v ?? ""} onChange={(e) => s(e.target.value === "" ? (undefined as never) : Number(e.target.value))} />}
					/>
				))}
			</Section>

			<Section title="Team and constraints">
				<KnownField id="team" label="Team and relevant founder experience" value={draft.team} onChange={(v) => set("team", v)} evidence={ev} error={errors.team} render={(v, s) => <textarea aria-label="Team experience" rows={3} value={v ?? ""} onChange={(e) => s(e.target.value)} maxLength={2000} />} />
				<label className="field wide" data-field="investorExclusions">
					Investors you do not want matched <span className="muted small">(website domains, one per line)</span>
					<textarea value={draft.investorExclusions.join("\n")} onChange={(e) => set("investorExclusions", lines(e.target.value))} rows={2} aria-invalid={errors.investorExclusions ? true : undefined} />
					<span className="hint">Your own choice. It is kept separate from anything an investor says.</span>
					{errors.investorExclusions ? <span className="field-error">{errors.investorExclusions}</span> : null}
				</label>
				<label className="field wide">
					Other fundraising constraints <span className="muted small">(shown to you, never interpreted)</span>
					<textarea value={draft.constraints.join("\n")} onChange={(e) => set("constraints", lines(e.target.value))} rows={2} />
				</label>
			</Section>

			<div className="row bottom sticky-actions">
				<label className="field inline">
					Note on this change <span className="muted small">(optional)</span>
					<input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
				</label>
				<button className="primary" disabled={!canWrite || action.busy}>
					{action.busy ? "Saving…" : "Save profile"}
				</button>
			</div>
			<ErrorNote error={action.error} />
			{done ? (
				<Notice kind="success" title={done.text}>
					{done.stale ? (
						<>
							{done.stale === 1 ? "One saved evaluation used" : `${done.stale} saved evaluations used`} an earlier version of this profile. <a href={href("founder", startupId, "shortlist")}>Re-run {done.stale === 1 ? "it" : "them"} from your shortlist</a>; the earlier results are kept.
						</>
					) : (
						"No saved evaluation is affected."
					)}
				</Notice>
			) : null}
			{data.versions?.length ? (
				<details>
					<summary>Version history ({data.versions.length})</summary>
					<ul className="plain small" data-testid="profile-versions">
						{data.versions.map((v: Any) => (
							<li key={v.id}>
								Version {v.version}, {when(v.createdAt)}: {v.changed.map(term).join(", ")}
								{v.note ? ` — ${v.note}` : ""}
							</li>
						))}
					</ul>
					<p className="muted small">Each evaluation names the profile version it used, so an earlier result can always be reconstructed.</p>
				</details>
			) : null}
		</form>
	);
}

// ---------------------------------------------------------------------------------------- evidence

const SOURCE_NOTE = (e: EvidenceView, docs: Map<string, DocumentRow>): string => {
	const l = e.sourceLocation;
	if (l.kind === "document") return `${docs.get(l.documentId)?.filename ?? "A document"}, page ${l.page}`;
	if (l.kind === "profile") return "Your own profile statement";
	return `Reviewer: ${l.reference}`;
};
const OTHER_METRICS: Record<string, string> = { monthly_burn: "Monthly burn", cash: "Cash", funding_ask: "Funding ask", pre_money_valuation: "Pre-money valuation", tam: "Market size", churn_pct: "Churn", revenue: "Revenue" };
const METRIC_NAME: Record<string, string> = { ...OTHER_METRICS, ...Object.fromEntries(PROFILE_METRICS.map((m) => [m, METRIC_LABEL[m].label])) };

function EvidenceTab({ startupId, onChanged }: { startupId: string; onChanged: () => void }) {
	const { data, error, loading, reload } = useLoad(() => call<{ workspace: Any }>("startup.get", { startupId }).then((r) => r.workspace), [startupId]);
	if (loading && !data) return <Loading what="evidence" />;
	if (!data) return <ErrorNote error={error} />;
	const docs = new Map<string, DocumentRow>((data.documents as DocumentRow[]).map((d) => [d.id, d]));
	const items = (data.evidence as EvidenceView[]).filter((i) => !i.superseded);
	const after = () => {
		void reload();
		onChanged();
	};
	return (
		<div className="stack">
			<p className="muted">
				Evidence is what documents say about your claims. A document being present does not make a statement true: each statement shows whether it is only provided by you, independently supported, or in conflict with another. Replacing or removing a file never erases what earlier evaluations relied on.
			</p>
			<Section title="Documents">
				<DocumentsPanel startupId={startupId} documents={data.documents} onChanged={after} audience="founder" />
			</Section>
			<Section title="What your documents say">
				{(data.contradictions as Any[]).length ? (
					<Notice kind="error" title="Evidence conflicts">
						{(data.contradictions as Any[]).map((c) => `${METRIC_NAME[c.metric] ?? sentence(c.metric)} (${c.values.join(" vs ")})`).join("; ")}. Decide which figure is current and replace the document that is out of date.
					</Notice>
				) : null}
				{items.length ? (
					<div className="table-wrap">
						<table className="list" data-testid="evidence-list">
							<caption className="visually-hidden">Statements extracted from your documents</caption>
							<thead>
								<tr>
									<th scope="col">Statement</th>
									<th scope="col">Supports</th>
									<th scope="col">Comes from</th>
									<th scope="col">How well supported</th>
								</tr>
							</thead>
							<tbody>
								{items.map((i) => {
									const status = i.effectiveVerification === "reviewer_verified" ? EVIDENCE.reviewer_verified! : i.effectiveVerification === "corroborated" ? EVIDENCE.corroborated! : i.effectiveVerification === "contradicted" ? EVIDENCE.conflicting! : i.documentId ? EVIDENCE.supplied_by_founder! : EVIDENCE.founder_assertion!;
									return (
										<tr key={i.id}>
											<td>{i.claim}</td>
											<td>{i.metric ? (METRIC_NAME[i.metric.key] ?? sentence(i.metric.key)) : <span className="muted">General statement</span>}</td>
											<td className="small">{SOURCE_NOTE(i, docs)}</td>
											<td>{i.effectiveVerification === "unverified" ? <span className="muted small">Provided by you, not independently supported</span> : <Badge entry={status} />}</td>
										</tr>
									);
								})}
							</tbody>
						</table>
					</div>
				) : (
					<EmptyState title="No statements yet">Upload a deck or financials above. Figures you enter in the profile can be linked to the statements that back them.</EmptyState>
				)}
			</Section>
		</div>
	);
}
