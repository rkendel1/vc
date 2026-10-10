import { type FormEvent, useEffect, useMemo, useState } from "react";
import { METRIC_KEYS, type InvestmentCriterion, type InvestmentThesis, type ThesisSettings, type ThesisVersion } from "../../../../invest/domain/types.ts";
import { call } from "../api.ts";
import { ErrorNote, Loading, PageHead, Section, Status, describeCheck, href, navigate, shortDigest, useAction, useCan, useLoad, when } from "../ui.tsx";

type Issue = { path: string; message: string };
type Validation = { valid: boolean; errors: Issue[]; warnings: Issue[] };

const DEFAULT_SETTINGS: ThesisSettings = { showWeightedSummary: false, reviewConfidenceThreshold: 0.7 };

/** A starting point new users can edit, not a recommended mandate. */
const STARTER: InvestmentCriterion[] = [
	{
		id: "arr-floor",
		name: "ARR of at least $1M",
		requirement: "Annual recurring revenue is at least $1,000,000, from an identified source.",
		evaluationMode: "deterministic",
		importance: 30,
		requiredEvidence: ["arr"],
		metric: "arr",
		comparator: "gte",
		threshold: 1_000_000,
		hardGate: true,
		missingEvidencePolicy: "review_required",
		disqualifier: "ARR below $1M",
		evidenceStandard: "independent_required",
	},
	{
		id: "repeatable-demand",
		name: "Repeatable customer demand",
		requirement: "Multiple paying customers won through a repeatable sales motion, with signs that customers stay.",
		evaluationMode: "semantic",
		importance: 40,
		requiredEvidence: ["customers", "customer references"],
		hardGate: false,
		missingEvidencePolicy: "review_required",
		evidenceStandard: "independent_required",
	},
	{
		id: "legal-exposure",
		name: "No unresolved legal or regulatory exposure",
		requirement: "There is no unresolved litigation or regulatory action that threatens the business.",
		evaluationMode: "human_review",
		importance: 30,
		requiredEvidence: ["litigation", "regulatory"],
		hardGate: true,
		missingEvidencePolicy: "review_required",
		disqualifier: "Material unresolved litigation or regulatory action",
	},
];

export function ThesesScreen() {
	const canWrite = useCan("thesis.write");
	const { data, error, loading } = useLoad(() => call<{ items: InvestmentThesis[] }>("thesis.list", {}).then((r) => r.items), []);
	const [name, setName] = useState("");
	const [starter, setStarter] = useState(true);
	const action = useAction();
	const create = async (e: FormEvent) => {
		e.preventDefault();
		const r = await action.run(() => call<{ thesis: InvestmentThesis }>("thesis.create", { name, criteria: starter ? STARTER : [], settings: DEFAULT_SETTINGS }));
		if (r) navigate("theses", r.thesis.id);
	};
	return (
		<>
			<PageHead title="Investment theses" sub="Your mandate as explicit, versioned criteria. Evaluations always run against one approved version." />
			{loading && !data ? <Loading what="theses" /> : <ErrorNote error={error} />}
			{data?.length ? (
				<table className="list">
					<thead>
						<tr>
							<th>Thesis</th>
							<th>Status</th>
							<th>Approved versions</th>
							<th>Draft</th>
							<th>Updated</th>
						</tr>
					</thead>
					<tbody>
						{data.map((t) => (
							<tr key={t.id} className="clickable" onClick={() => navigate("theses", t.id)}>
								<td>
									<a className="serif" href={href("theses", t.id)} onClick={(e) => e.stopPropagation()}>
										{t.name}
									</a>
								</td>
								<td>
									<Status value={t.status} />
								</td>
								<td>{t.versionCount}</td>
								<td>{t.draft ? "Unapproved changes" : <span className="muted">None</span>}</td>
								<td className="muted">{when(t.updatedAt)}</td>
							</tr>
						))}
					</tbody>
				</table>
			) : data ? (
				<p className="empty">No theses yet.</p>
			) : null}
			{canWrite ? (
				<Section title="New thesis">
					<form className="stack" onSubmit={create} style={{ maxWidth: 520 }}>
						<label className="field">
							Name
							<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Seed-stage B2B software" required maxLength={120} />
						</label>
						<label className="check">
							<input type="checkbox" checked={starter} onChange={(e) => setStarter(e.target.checked)} />
							Start with three example criteria to edit
						</label>
						<ErrorNote error={action.error} />
						<div>
							<button className="primary" disabled={action.busy || !name.trim()}>
								Create draft
							</button>
						</div>
					</form>
				</Section>
			) : null}
		</>
	);
}

// ---------------------------------------------------------------------------

function issuesFor(index: number, issues: Issue[]) {
	return issues.filter((i) => i.path.startsWith(`criteria[${index}]`));
}

function CriterionEditor({
	value,
	index,
	count,
	issues,
	readOnly,
	onChange,
	onMove,
	onRemove,
}: {
	value: InvestmentCriterion;
	index: number;
	count: number;
	issues: Issue[];
	readOnly: boolean;
	onChange: (c: InvestmentCriterion) => void;
	onMove: (delta: number) => void;
	onRemove: () => void;
}) {
	const set = <K extends keyof InvestmentCriterion>(key: K, v: InvestmentCriterion[K]) => onChange({ ...value, [key]: v });
	const mine = issuesFor(index, issues);
	const setMode = (mode: InvestmentCriterion["evaluationMode"]) => {
		const next: InvestmentCriterion = { ...value, evaluationMode: mode };
		if (mode === "deterministic") {
			next.metric = next.metric ?? "arr";
			next.comparator = next.comparator ?? "gte";
			next.threshold = next.threshold ?? 0;
		} else {
			delete next.metric;
			delete next.comparator;
			delete next.threshold;
		}
		onChange(next);
	};
	return (
		<details className="criterion" open={mine.length > 0 || !value.name}>
			<summary>
				<strong className="serif">{value.name || "Untitled criterion"}</strong>
				<span className="muted small">
					{value.evaluationMode === "deterministic"
						? `Checked in code: ${describeCheck(value.metric ?? "", value.comparator ?? "", value.threshold ?? 0)}`
						: value.evaluationMode === "semantic"
							? "Judged by Jev against evidence"
							: "Decided by a reviewer"}
					{value.hardGate ? ", hard gate" : ""}, weight {value.importance}
				</span>
				{mine.length ? <span className="issues">{mine.length} to fix</span> : null}
			</summary>
			<fieldset disabled={readOnly} style={{ border: 0, padding: 0, margin: 0 }}>
				<div className="form-grid">
					<label className="field">
						Id
						<input value={value.id} onChange={(e) => set("id", e.target.value)} />
					</label>
					<label className="field" style={{ gridColumn: "span 2" }}>
						Name
						<input value={value.name} onChange={(e) => set("name", e.target.value)} />
					</label>
					<label className="field wide">
						Requirement
						<textarea value={value.requirement} onChange={(e) => set("requirement", e.target.value)} rows={2} />
					</label>
					<label className="field">
						How it is judged
						<select value={value.evaluationMode} onChange={(e) => setMode(e.target.value as InvestmentCriterion["evaluationMode"])}>
							<option value="deterministic">Exact check in code</option>
							<option value="semantic">Jev judgment</option>
							<option value="human_review">Reviewer decides</option>
						</select>
					</label>
					{value.evaluationMode === "deterministic" ? (
						<>
							<label className="field">
								Metric
								<select value={value.metric} onChange={(e) => set("metric", e.target.value as InvestmentCriterion["metric"])}>
									{METRIC_KEYS.map((m) => (
										<option key={m} value={m}>
											{m.replace(/_/g, " ")}
										</option>
									))}
								</select>
							</label>
							<label className="field">
								Comparison
								<select value={value.comparator} onChange={(e) => set("comparator", e.target.value as InvestmentCriterion["comparator"])}>
									<option value="gte">at least</option>
									<option value="gt">more than</option>
									<option value="lte">at most</option>
									<option value="lt">less than</option>
									<option value="eq">exactly</option>
								</select>
							</label>
							<label className="field">
								Threshold
								<input type="number" value={value.threshold ?? 0} onChange={(e) => set("threshold", Number(e.target.value))} />
								<span className="hint">Dollars, percent, months or a count</span>
							</label>
						</>
					) : null}
					<label className="field">
						Weight (0–100)
						<input type="number" min={0} max={100} value={value.importance} onChange={(e) => set("importance", Number(e.target.value))} />
					</label>
					<label className="field">
						If evidence is missing
						<select value={value.missingEvidencePolicy} onChange={(e) => set("missingEvidencePolicy", e.target.value as InvestmentCriterion["missingEvidencePolicy"])}>
							<option value="unknown">Record as unknown</option>
							<option value="review_required">Require a reviewer</option>
						</select>
					</label>
					<label className="field">
						Evidence standard
						<select value={value.evidenceStandard ?? "independent_required"} onChange={(e) => set("evidenceStandard", e.target.value as InvestmentCriterion["evidenceStandard"])}>
							<option value="independent_required">Needs independent evidence</option>
							<option value="founder_reported_ok">Founder statements can meet it</option>
						</select>
					</label>
					<label className="field wide">
						Required evidence
						<input value={value.requiredEvidence.join(", ")} onChange={(e) => set("requiredEvidence", e.target.value.split(",").map((s) => s.trim()).filter(Boolean))} />
						<span className="hint">Comma-separated: metric names (arr, customers) or short phrases (customer references)</span>
					</label>
					<label className="check">
						<input type="checkbox" checked={value.hardGate} onChange={(e) => set("hardGate", e.target.checked)} />
						Hard gate: failing it rules out investing
					</label>
					{value.hardGate ? (
						<label className="field wide">
							Disqualifier
							<input value={value.disqualifier ?? ""} onChange={(e) => set("disqualifier", e.target.value || undefined)} />
						</label>
					) : null}
				</div>
			</fieldset>
			{mine.length ? (
				<ul className="blockers">
					{mine.map((i) => (
						<li key={i.path + i.message}>{i.message}</li>
					))}
				</ul>
			) : null}
			{!readOnly ? (
				<div className="row" style={{ marginTop: 8 }}>
					<button type="button" className="quiet" disabled={index === 0} onClick={() => onMove(-1)}>
						Move up
					</button>
					<button type="button" className="quiet" disabled={index === count - 1} onClick={() => onMove(1)}>
						Move down
					</button>
					<button type="button" className="quiet danger" onClick={onRemove}>
						Remove
					</button>
				</div>
			) : null}
		</details>
	);
}

export function ThesisScreen({ thesisId }: { thesisId: string }) {
	const canWrite = useCan("thesis.write");
	const canApprove = useCan("thesis.approve");
	const { data, error, loading, reload } = useLoad(() => call<{ thesis: InvestmentThesis; versions: ThesisVersion[] }>("thesis.get", { thesisId }), [thesisId]);
	const [criteria, setCriteria] = useState<InvestmentCriterion[]>([]);
	const [settings, setSettings] = useState<ThesisSettings>(DEFAULT_SETTINGS);
	const [description, setDescription] = useState("");
	const [dirty, setDirty] = useState(false);
	const [validation, setValidation] = useState<Validation | null>(null);
	const [note, setNote] = useState("");
	const [compare, setCompare] = useState<{ from: string; to: string; changes: { criterionId: string; change: string; fields: string[] }[] } | null>(null);
	const save = useAction();
	const approve = useAction();
	const cmp = useAction();

	const thesis = data?.thesis;
	const current = data?.versions.find((v) => v.id === thesis?.currentVersionId) ?? null;
	useEffect(() => {
		if (!thesis) return;
		const source = thesis.draft ?? current;
		setCriteria(source?.criteria ?? []);
		setSettings(source?.settings ?? DEFAULT_SETTINGS);
		setDescription(source?.description ?? "");
		setDirty(false);
		setValidation(null);
	}, [thesis?.__version, current?.id]);

	const editing = !!thesis?.draft && canWrite;
	const change = (next: InvestmentCriterion[]) => {
		setCriteria(next);
		setDirty(true);
		setValidation(null);
	};
	const issues = useMemo(() => validation?.errors ?? [], [validation]);

	if (loading && !data) return <Loading what="thesis" />;
	if (!thesis || !data) return <ErrorNote error={error} />;

	const persist = () => save.run(() => call<{ thesis: InvestmentThesis }>("thesis.draft.update", { thesisId, expectedVersion: thesis.__version ?? 0, description, criteria, settings }));
	const doSave = async () => {
		if (await persist()) await reload();
	};
	const check = async () => {
		const v = await save.run(() => call<Validation>("thesis.validate", { criteria, settings }));
		if (v) setValidation(v);
	};
	const startDraft = async () => {
		if (!current) return;
		if (await save.run(() => call("thesis.draft.update", { thesisId, expectedVersion: thesis.__version ?? 0, description: current.description, criteria: current.criteria, settings: current.settings }))) await reload();
	};
	const discard = async () => {
		if (await save.run(() => call("thesis.draft.discard", { thesisId, expectedVersion: thesis.__version ?? 0 }))) await reload();
	};
	const doApprove = async () => {
		let expected = thesis.__version ?? 0;
		if (dirty) {
			const saved = await persist();
			if (!saved) return;
			expected = saved.thesis.__version ?? expected;
		}
		const v = await approve.run(() => call<Validation>("thesis.validate", { criteria, settings }));
		if (!v) return;
		setValidation(v);
		if (!v.valid) return;
		if (await approve.run(() => call("thesis.approve", { thesisId, expectedVersion: expected, note }))) {
			setNote("");
			await reload();
		}
	};
	const compareWith = async (fromVersionId: string, toVersionId?: string) => {
		const r = await cmp.run(() => call<typeof compare>("thesis.version.compare", toVersionId ? { fromVersionId, toVersionId } : { fromVersionId }));
		if (r) setCompare(r);
	};

	return (
		<>
			<PageHead
				title={thesis.name}
				sub={
					current ? (
						<>
							In force: version {current.version}, approved by {current.approvedByName} on {when(current.createdAt)}. <span className="digest">{shortDigest(current.contentHash)}</span>
						</>
					) : (
						"No approved version yet. Evaluations need an approved version."
					)
				}
				actions={<a href={href("theses")}>All theses</a>}
			/>

			<Section
				title={thesis.draft ? `Draft${current ? ` (changes to version ${current.version})` : ""}` : `Version ${current?.version ?? ""} criteria`}
				actions={
					!thesis.draft && canWrite && current ? (
						<button type="button" onClick={startDraft} disabled={save.busy}>
							Edit as a new draft
						</button>
					) : null
				}
			>
				<div className="stack">
					{editing ? (
						<label className="field">
							What this thesis is for
							<textarea value={description} onChange={(e) => (setDescription(e.target.value), setDirty(true))} rows={2} />
						</label>
					) : description ? (
						<p>{description}</p>
					) : null}
					{criteria.map((c, i) => (
						<CriterionEditor
							key={`${i}-${criteria.length}`}
							value={c}
							index={i}
							count={criteria.length}
							issues={issues}
							readOnly={!editing}
							onChange={(next) => change(criteria.map((x, j) => (j === i ? next : x)))}
							onMove={(d) => {
								const next = [...criteria];
								const [item] = next.splice(i, 1);
								next.splice(i + d, 0, item);
								change(next);
							}}
							onRemove={() => change(criteria.filter((_, j) => j !== i))}
						/>
					))}
					{!criteria.length ? <p className="empty">No criteria yet.</p> : null}
					{editing ? (
						<>
							<div>
								<button
									type="button"
									onClick={() =>
										change([
											...criteria,
											{ id: `criterion-${criteria.length + 1}`, name: "", requirement: "", evaluationMode: "semantic", importance: 10, requiredEvidence: [], hardGate: false, missingEvidencePolicy: "unknown", evidenceStandard: "independent_required" },
										])
									}
								>
									Add criterion
								</button>
							</div>
							<div className="form-grid" style={{ maxWidth: 640 }}>
								<label className="check">
									<input type="checkbox" checked={settings.showWeightedSummary} onChange={(e) => (setSettings({ ...settings, showWeightedSummary: e.target.checked }), setDirty(true))} />
									Show a weighted summary on reports
								</label>
								<label className="field">
									Route Jev answers to review below this confidence
									<input
										type="number"
										step={0.05}
										min={0.5}
										max={0.99}
										value={settings.reviewConfidenceThreshold}
										onChange={(e) => (setSettings({ ...settings, reviewConfidenceThreshold: Number(e.target.value) }), setDirty(true))}
									/>
								</label>
							</div>
							{validation?.valid ? <div className="note ok">The draft is valid.{validation.warnings.length ? ` ${validation.warnings.length} suggestion(s): ${validation.warnings.map((w) => w.message).join("; ")}.` : ""}</div> : null}
							{validation && !validation.valid ? (
								<div className="note error">{validation.errors.length} problem(s) to fix before approval. {validation.errors.filter((e) => !e.path.startsWith("criteria[")).map((e) => e.message).join(" ")}</div>
							) : null}
							<ErrorNote error={save.error} />
							<div className="row">
								<button type="button" className="primary" onClick={doSave} disabled={save.busy || !dirty}>
									{dirty ? "Save draft" : "Draft saved"}
								</button>
								<button type="button" onClick={check} disabled={save.busy}>
									Check draft
								</button>
								{current ? (
									<>
										<button type="button" onClick={() => compareWith(current.id)} disabled={dirty || cmp.busy}>
											Compare with version {current.version}
										</button>
										<button type="button" className="quiet danger" onClick={discard} disabled={save.busy}>
											Discard draft
										</button>
									</>
								) : null}
							</div>
							{canApprove ? (
								<div className="stack" style={{ maxWidth: 640, marginTop: 8 }}>
									<label className="field">
										Approval note
										<input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why this version, and what changed" />
									</label>
									<ErrorNote error={approve.error} />
									<div>
										<button type="button" className="primary" onClick={doApprove} disabled={approve.busy || !criteria.length}>
											Approve as version {thesis.versionCount + 1}
										</button>
									</div>
									<p className="muted small">Approval freezes these criteria. Earlier versions, and evaluations made with them, do not change.</p>
								</div>
							) : (
								<p className="muted small">A partner approves new versions.</p>
							)}
						</>
					) : null}
				</div>
			</Section>

			<Section title="Approved versions">
				{data.versions.length ? (
					<table className="list">
						<thead>
							<tr>
								<th>Version</th>
								<th>Approved</th>
								<th>By</th>
								<th>Note</th>
								<th>Criteria</th>
								<th>Content hash</th>
								<th />
							</tr>
						</thead>
						<tbody>
							{data.versions.map((v, i) => (
								<tr key={v.id}>
									<td>v{v.version}</td>
									<td className="nowrap">{when(v.createdAt)}</td>
									<td>{v.approvedByName}</td>
									<td>{v.approvalNote || <span className="muted">—</span>}</td>
									<td>{v.criteria.length}</td>
									<td className="digest">{shortDigest(v.contentHash)}</td>
									<td>
										{data.versions[i + 1] ? (
											<button type="button" className="quiet" onClick={() => compareWith(data.versions[i + 1].id, v.id)}>
												Changes from v{data.versions[i + 1].version}
											</button>
										) : null}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				) : (
					<p className="empty">Nothing approved yet.</p>
				)}
				<ErrorNote error={cmp.error} />
				{compare ? (
					<div className="note" style={{ marginTop: 12 }}>
						<strong>
							{compare.from} to {compare.to}
						</strong>
						{compare.changes.length ? (
							<ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
								{compare.changes.map((c) => (
									<li key={c.criterionId}>
										<code>{c.criterionId}</code> {c.change}
										{c.fields.length ? `: ${c.fields.join(", ")}` : ""}
									</li>
								))}
							</ul>
						) : (
							<p>No criterion changes.</p>
						)}
					</div>
				) : null}
			</Section>
		</>
	);
}
