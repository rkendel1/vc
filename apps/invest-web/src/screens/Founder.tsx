import { type FormEvent, useEffect, useState } from "react";
import { BUSINESS_MODEL_KEYS, DECLARED_BASES, GEOGRAPHY_KEYS, PRODUCT_STATUSES, PROFILE_METRICS, REVENUE_STATUSES, SECTOR_KEYS, STARTUP_STAGES, type DeclaredBasis, type FieldProvenance, type Known, type ProfileContent, type ProfileMetric } from "../../../../invest/domain/founder.ts";
import type { EvidenceView, Startup } from "../../../../invest/domain/types.ts";
import { call } from "../api.ts";
import { ErrorNote, Loading, PageHead, Provenance, Section, Verification, href, navigate, useAction, useCan, useLoad, when } from "../ui.tsx";
import { term, usdRange } from "../format.ts";
import { DiscoverTab, ShortlistTab } from "./FounderMatch.tsx";

type Any = Record<string, any>; // eslint-disable-line


const BASIS_LABEL: Record<DeclaredBasis, string> = {
	founder_assertion: "Our own statement",
	uploaded_document: "An uploaded document",
	official_public_source: "An official public source",
	third_party_source: "A third-party source",
};
const METRIC_LABEL: Record<ProfileMetric, { label: string; unit: string }> = {
	arr: { label: "Annual recurring revenue", unit: "USD" },
	mrr: { label: "Monthly recurring revenue", unit: "USD" },
	revenue_growth_pct: { label: "Revenue growth", unit: "%" },
	gross_margin_pct: { label: "Gross margin", unit: "%" },
	net_revenue_retention_pct: { label: "Net revenue retention", unit: "%" },
	customers: { label: "Customers", unit: "count" },
	runway_months: { label: "Runway", unit: "months" },
	team_size: { label: "Team size", unit: "count" },
};

// ---------------------------------------------------------------------------------------- screen

const TABS = [
	{ id: "profile", label: "Profile" },
	{ id: "evidence", label: "Evidence" },
	{ id: "investors", label: "Investors" },
	{ id: "shortlist", label: "Shortlist & plan" },
] as const;
type TabId = (typeof TABS)[number]["id"];

export function FounderScreen({ startupId }: { startupId?: string }) {
	const canWrite = useCan("startup.write");
	const list = useLoad(() => call<{ items: Startup[] }>("startup.list", {}).then((r) => r.items), []);
	const action = useAction();
	const [name, setName] = useState("");
	if (!startupId) {
		return (
			<>
				<PageHead title="Your startups" sub="Private to this workspace. Nothing here is shared with investors, published or sent anywhere." />
				{list.loading && !list.data ? <Loading what="startups" /> : <ErrorNote error={list.error} />}
				{list.data?.length ? (
					<ul className="plain" data-testid="startup-list">
						{list.data.map((s) => (
							<li key={s.id}>
								<a href={href("founder", s.id)}>{s.name}</a> <span className="muted small">updated {when(s.updatedAt)}</span>
							</li>
						))}
					</ul>
				) : list.data ? (
					<p className="empty">No startup yet. Create one to start your private profile.</p>
				) : null}
				{canWrite ? (
					<Section title="New startup">
						<form
							className="row"
							onSubmit={async (e: FormEvent) => {
								e.preventDefault();
								const r = await action.run(() => call<{ startup: Startup }>("startup.create", { name }));
								if (r) navigate("founder", r.startup.id);
							}}
						>
							<label className="field">
								Company name
								<input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required />
							</label>
							<button className="primary" disabled={action.busy || !name.trim()}>
								Create startup
							</button>
						</form>
						<ErrorNote error={action.error} />
					</Section>
				) : (
					<p className="muted">Your role cannot create startups.</p>
				)}
			</>
		);
	}
	return <StartupJourney startupId={startupId} />;
}

function StartupJourney({ startupId }: { startupId: string }) {
  const [tab, setTab] = useState<TabId>("profile");
	// Bumped when anything the other tabs depend on changes (profile saved, evidence added, shortlist edited).
	const [rev, setRev] = useState(0);
	const bump = () => setRev((n) => n + 1);
	const profile = useLoad(() => call<Any>("startup.profile.get", { startupId }), [startupId, rev]);
	if (profile.loading && !profile.data) return <Loading what="profile" />;
	if (!profile.data) return <ErrorNote error={profile.error} />;
	const p = profile.data;
	return (
		<>
			<PageHead
				title={p.startup.name}
				sub={
					<>
						Private profile, {p.version ? `version ${p.version}` : "not saved yet"}. <a href={href("founder")}>All startups</a>
					</>
				}
			/>
			<div className="tabs" role="tablist" aria-label="Founder journey">
				{TABS.map((t) => (
					<button key={t.id} role="tab" aria-selected={tab === t.id} className={`tab ${tab === t.id ? "on" : ""}`} onClick={() => setTab(t.id)}>
						{t.label}
					</button>
				))}
			</div>
			{tab === "profile" ? <ProfileTab startupId={startupId} data={p} onSaved={bump} /> : null}
			{tab === "evidence" ? <EvidenceTab startupId={startupId} onChanged={bump} /> : null}
			{tab === "investors" ? <DiscoverTab startupId={startupId} profileVersion={p.version} rev={rev} onChanged={bump} goToProfile={() => setTab("profile")} /> : null}
			{tab === "shortlist" ? <ShortlistTab startupId={startupId} rev={rev} onChanged={bump} /> : null}
		</>
	);
}

// ---------------------------------------------------------------------------------------- profile

type Draft = ProfileContent;

function ProvControls({ prov, onChange, evidence, metric }: { prov: FieldProvenance; onChange: (p: FieldProvenance) => void; evidence: EvidenceView[]; metric?: string }) {
	const candidates = evidence.filter((e) => !e.superseded && (!metric || e.metric?.key === metric));
	return (
		<div className="prov-controls">
			<label className="field inline">
				Basis
				<select value={prov.basis} onChange={(e) => onChange({ ...prov, basis: e.target.value as DeclaredBasis })}>
					{DECLARED_BASES.map((b) => (
						<option key={b} value={b}>
							{BASIS_LABEL[b]}
						</option>
					))}
				</select>
			</label>
			{prov.basis === "official_public_source" || prov.basis === "third_party_source" ? (
				<label className="field inline">
					Source link
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
					<p className="muted small">Linking a document does not make a claim true. The Evidence tab and each explanation say how well it is supported.</p>
				</details>
			) : null}
		</div>
	);
}

/** One profile field that can be provided, unknown or not applicable. */
function KnownField<T>({ id, label, help, value, onChange, evidence, metric, na = true, render }: { id: string; label: string; help?: string; value: Known<T>; onChange: (v: Known<T>) => void; evidence: EvidenceView[]; metric?: string; na?: boolean; render: (v: T | undefined, set: (v: T) => void) => React.ReactNode }) {
	const state = value.state;
	return (
		<div className="known-field" data-field={id}>
			<div className="row between">
				<strong>{label}</strong>
				<select aria-label={`${label} status`} value={state} onChange={(e) => {
					const s = e.target.value;
					if (s === "unknown") onChange({ state: "unknown" });
					else if (s === "not_applicable") onChange({ state: "not_applicable" });
					else onChange({ state: "provided", value: undefined as T, provenance: { basis: "founder_assertion", evidenceIds: [], sourceUrl: null } });
				}}>
					<option value="unknown">Unknown / not stated</option>
					<option value="provided">Provided</option>
					{na ? <option value="not_applicable">Not applicable</option> : null}
				</select>
			</div>
			{help ? <p className="muted small">{help}</p> : null}
			{value.state === "provided" ? (
				<>
					{render(value.value, (v) => onChange({ ...value, value: v }))}
					<ProvControls prov={value.provenance} onChange={(provenance) => onChange({ ...value, provenance })} evidence={evidence} metric={metric} />
				</>
			) : (
				<p className="muted small">{state === "unknown" ? "Left unknown. Matching treats this as missing information, never as a failure." : "Marked not applicable. It is not counted against the startup."}</p>
			)}
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
					{term(o)}
				</option>
			))}
		</select>
	);
}

function ProfileTab({ startupId, data, onSaved }: { startupId: string; data: Any; onSaved: () => void }) {
	const canWrite = useCan("startup.write");
	const evidence = useLoad(() => call<{ items: EvidenceView[] }>("evidence.list", { startupId }).then((r) => r.items), [startupId]);
	const [draft, setDraft] = useState<Draft>(data.content as Draft);
	const [version, setVersion] = useState<number>(data.version);
	const [note, setNote] = useState("");
	const [saved, setSaved] = useState<string | null>(null);
	const action = useAction();
	useEffect(() => {
		setDraft(data.content as Draft);
		setVersion(data.version);
	}, [data.version]);
	const ev = evidence.data ?? [];
	const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft({ ...draft, [k]: v });
	const lines = (v: string) => v.split("\n").map((l) => l.trim()).filter(Boolean);
	const submit = async (e: FormEvent) => {
		e.preventDefault();
		setSaved(null);
		const r = await action.run(() => call<Any>("startup.profile.save", { startupId, expectedVersion: version, content: draft, note }));
		if (r) {
			setSaved(r.unchanged ? "No change: this matches the current version." : `Saved as version ${r.version}.`);
			setVersion(r.version);
			setNote("");
			onSaved();
		}
	};
	const metrics = draft.metrics ?? {};
	return (
		<form className="stack" onSubmit={submit} data-testid="profile-form">
			<p className="muted">Everything here is private to your workspace. Leave anything you do not know as unknown: matching treats it as missing, not as a failure. Each material claim records its basis, and the system never treats a claim as confirmed because you stated it.</p>
			<Section title="About the company">
				<label className="field wide">
					Concise description
					<textarea value={draft.description} onChange={(e) => set("description", e.target.value)} rows={2} maxLength={600} />
				</label>
				<KnownField id="sectors" label="Sector" value={draft.sectors} onChange={(v) => set("sectors", v)} evidence={ev} na={false} render={(v, s) => <Checks options={SECTOR_KEYS} value={v} onChange={s} />} />
				<KnownField id="businessModels" label="Business model" value={draft.businessModels} onChange={(v) => set("businessModels", v)} evidence={ev} na={false} render={(v, s) => <Checks options={BUSINESS_MODEL_KEYS} value={v} onChange={s} />} />
				<KnownField id="headquarters" label="Headquarters" value={draft.headquarters} onChange={(v) => set("headquarters", v)} evidence={ev} na={false} render={(v, s) => <Select label="Headquarters" options={GEOGRAPHY_KEYS} value={v} onChange={s} />} />
				<KnownField id="targetMarkets" label="Target markets" value={draft.targetMarkets} onChange={(v) => set("targetMarkets", v)} evidence={ev} na={false} render={(v, s) => <Checks options={GEOGRAPHY_KEYS} value={v} onChange={s} />} />
			</Section>
			<Section title="Stage and fundraising">
				<KnownField id="currentStage" label="Current stage" value={draft.currentStage} onChange={(v) => set("currentStage", v)} evidence={ev} na={false} render={(v, s) => <Select label="Current stage" options={STARTUP_STAGES} value={v} onChange={s} />} />
				<KnownField id="fundraisingStage" label="Round you are raising" value={draft.fundraisingStage} onChange={(v) => set("fundraisingStage", v)} evidence={ev} render={(v, s) => <Select label="Round you are raising" options={STARTUP_STAGES} value={v} onChange={s} />} />
				<KnownField
					id="targetRaise"
					label="Target raise (USD)"
					help="Amounts are in US dollars. Give a range, or the same figure twice."
					value={draft.targetRaise}
					onChange={(v) => set("targetRaise", v)}
					evidence={ev}
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
							{v && (v.minUsd !== null || v.maxUsd !== null) ? <span className="muted small">= {usdRange(v)}</span> : null}
						</div>
					)}
				/>
			</Section>
			<Section title="Traction and product">
				<KnownField id="revenueStatus" label="Revenue status" help="Pre-revenue companies are not asked for revenue metrics." value={draft.revenueStatus} onChange={(v) => set("revenueStatus", v)} evidence={ev} render={(v, s) => <Select label="Revenue status" options={REVENUE_STATUSES} value={v} onChange={s} />} />
				<KnownField id="productStatus" label="Product status" value={draft.productStatus} onChange={(v) => set("productStatus", v)} evidence={ev} render={(v, s) => <Select label="Product status" options={PRODUCT_STATUSES} value={v} onChange={s} />} />
				{PROFILE_METRICS.map((m) => (
					<KnownField
						key={m}
						id={`metrics.${m}`}
						label={`${METRIC_LABEL[m].label} (${METRIC_LABEL[m].unit})`}
						value={metrics[m] ?? { state: "unknown" }}
						onChange={(v) => setDraft({ ...draft, metrics: { ...metrics, [m]: v } })}
						evidence={ev}
						metric={m}
						render={(v, s) => <input aria-label={METRIC_LABEL[m].label} inputMode="decimal" value={v ?? ""} onChange={(e) => s(e.target.value === "" ? (undefined as never) : Number(e.target.value))} />}
					/>
				))}
			</Section>
			<Section title="Team and constraints">
				<KnownField id="team" label="Team and relevant founder experience" value={draft.team} onChange={(v) => set("team", v)} evidence={ev} render={(v, s) => <textarea aria-label="Team experience" rows={3} value={v ?? ""} onChange={(e) => s(e.target.value)} maxLength={2000} />} />
				<label className="field wide">
					Investors you do not want matched (website domains, one per line)
					<textarea value={draft.investorExclusions.join("\n")} onChange={(e) => set("investorExclusions", lines(e.target.value))} rows={2} />
					<span className="hint">Your own choice. It is shown separately from what any investor says.</span>
				</label>
				<label className="field wide">
					Other fundraising constraints (shown to you, never interpreted)
					<textarea value={draft.constraints.join("\n")} onChange={(e) => set("constraints", lines(e.target.value))} rows={2} />
				</label>
			</Section>
			<div className="row">
				<label className="field inline">
					Note on this change
					<input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
				</label>
				<button className="primary" disabled={!canWrite || action.busy}>
					Save profile
				</button>
				{saved ? (
					<span className="note ok" role="status">
						{saved}
					</span>
				) : null}
			</div>
			<ErrorNote error={action.error} />
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
					<p className="muted small">Each evaluation names the version it used, so an earlier result can always be reconstructed.</p>
				</details>
			) : null}
		</form>
	);
}

// ---------------------------------------------------------------------------------------- evidence

function EvidenceTab({ startupId }: { startupId: string; onChanged: () => void }) {
	const { data, error, loading } = useLoad(() => call<{ items: EvidenceView[]; contradictions: Any[] }>("evidence.list", { startupId }), [startupId]);
	if (loading && !data) return <Loading what="evidence" />;
	if (!data) return <ErrorNote error={error} />;
	const items = data.items.filter((i) => !i.superseded);
	return (
		<>
			<p className="muted">Evidence is what documents and reviewers have said about your claims. A document being present does not make a statement true: each item shows whether it is only your own statement, corroborated by an independent source, or in conflict with another.</p>
			<p>
				<a className="button" href={href("startups", startupId)}>
					Upload documents or review extracted evidence
				</a>{" "}
				<span className="muted small">Uses the same document pipeline as the rest of the application.</span>
			</p>
			{data.contradictions.length ? (
				<div className="note warn" role="alert">
					Conflicting evidence: {data.contradictions.map((c) => `${term(c.metric)} (${c.values.join(" vs ")})`).join("; ")}. Resolve it before sharing these figures.
				</div>
			) : null}
			{items.length ? (
				<div className="table-wrap">
					<table className="list" data-testid="evidence-list">
						<thead>
							<tr>
								<th>Statement</th>
								<th>Where it comes from</th>
								<th>Support</th>
								<th>Recorded</th>
							</tr>
						</thead>
						<tbody>
							{items.map((i) => (
								<tr key={i.id}>
									<td>{i.claim}</td>
									<td>
										<Provenance value={i.provenance.class} /> <span className="muted small">{term(String(i.provenance.sourceType))}</span>
									</td>
									<td>
										<Verification value={i.effectiveVerification} />
									</td>
									<td className="muted small">{when(i.createdAt)}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			) : (
				<p className="empty">No evidence yet. Upload a deck or financials, or link evidence to individual profile fields.</p>
			)}
		</>
	);
}
