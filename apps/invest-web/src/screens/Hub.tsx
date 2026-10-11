import { type FormEvent, useState } from "react";
import { call } from "../api.ts";
import { ErrorNote, Loading, Section, href, useAction, useCan, useLoad, when } from "../ui.tsx";

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
