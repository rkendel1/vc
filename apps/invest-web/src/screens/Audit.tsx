import { useState } from "react";
import type { AuditEvent } from "../../../../invest/domain/types.ts";
import { call } from "../api.ts";
import { ErrorNote, Loading, PageHead, useCan, useLoad, when } from "../ui.tsx";

function summarise(e: AuditEvent): string {
	const p = e.payload as Record<string, unknown>;
	switch (e.eventType) {
		case "thesis.version_approved":
			return `Version ${p.version} approved${p.note ? `: ${p.note}` : ""}`;
		case "review.override":
			return `Overrode ${p.criterionId}: ${p.systemOutcome} to ${p.overrideOutcome}. ${p.reason ?? ""}`;
		case "decision.recorded":
			return `Decision: ${String(p.decision).replace(/_/g, " ")}`;
		case "evaluation.completed":
			return `Completed in ${p.latencyMs} ms`;
		case "document.purged":
			return `Original deleted: ${p.reason}`;
		default:
			return [p.filename, p.name, p.reason, p.question].filter(Boolean).join(" ") || "";
	}
}

export function AuditScreen() {
	const canRead = useCan("audit.read");
	const [type, setType] = useState("");
	const [entity, setEntity] = useState("");
	const { data, error, loading } = useLoad(
		() => (canRead ? call<{ items: AuditEvent[] }>("audit.list", { ...(type ? { eventType: type } : {}), ...(entity ? { entityId: entity } : {}), limit: 500 }).then((r) => r.items) : Promise.resolve([])),
		[type, entity, canRead],
	);
	return (
		<>
			<PageHead title="Audit trail" sub="Every material change, newest first. Entries are append-only and are written in the same transaction as the change they record." />
			<div className="row" style={{ marginBottom: 12 }}>
				<label className="field">
					Event type
					<input value={type} onChange={(e) => setType(e.target.value)} placeholder="decision.recorded" />
				</label>
				<label className="field">
					Record id
					<input value={entity} onChange={(e) => setEntity(e.target.value)} placeholder="eval_…" />
				</label>
			</div>
			{!canRead ? <p className="empty">Your role cannot read the audit trail.</p> : null}
			{loading && !data ? <Loading what="audit trail" /> : <ErrorNote error={error} />}
			{data?.length ? (
				<div className="table-wrap">
					<table className="list">
						<thead>
							<tr>
								<th>When</th>
								<th>Who</th>
								<th>Event</th>
								<th>Record</th>
								<th>Detail</th>
							</tr>
						</thead>
						<tbody>
							{data.map((e) => (
								<tr key={e.id}>
									<td className="nowrap">{when(e.timestamp)}</td>
									<td>{e.actorId}</td>
									<td className="nowrap">{e.eventType}</td>
									<td className="digest">
										<button type="button" className="quiet" onClick={() => setEntity(e.entityRef.id)} title="Show everything about this record">
											{e.entityRef.type} {e.entityRef.id.slice(0, 22)}
										</button>
									</td>
									<td>{summarise(e)}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			) : data && canRead ? (
				<p className="empty">No events match.</p>
			) : null}
		</>
	);
}
