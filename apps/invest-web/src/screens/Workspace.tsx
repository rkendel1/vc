import type { EvaluationListItem } from "../../../../invest/domain/views.ts";
import { call } from "../api.ts";
import { CoverageBar, ErrorNote, Loading, PageHead, Section, Status, href, navigate, useLoad, useSession, when, type JevIdentity } from "../ui.tsx";

type Overview = {
	active: EvaluationListItem[];
	outstandingReviews: EvaluationListItem[];
	recentlyCompleted: EvaluationListItem[];
	awaitingEvidence: { startup: { id: string; name: string; stage: string; sector: string }; documents: number; usableDocuments: number; documentsWithIssues: number }[];
	theses: { id: string; name: string; status: string; versionCount: number; hasDraft: boolean }[];
	counts: { startups: number; evaluations: number; documents: number };
	jev: JevIdentity;
};

export function JevLine({ jev }: { jev: JevIdentity }) {
	if (!jev.configured) return <span className="verif contradicted">Jev is not configured, so semantic criteria are recorded as failed evaluations.</span>;
	return (
		<span className="muted">
			Jev at {jev.endpointOrigin}
			{jev.provider || jev.model ? `, ${[jev.provider, jev.model].filter(Boolean).join(" / ")}` : ""}
		</span>
	);
}

function EvaluationRows({ items, empty, columns }: { items: EvaluationListItem[]; empty: string; columns: "review" | "done" | "running" }) {
	if (!items.length) return <p className="empty">{empty}</p>;
	return (
		<div className="table-wrap">
			<table className="list">
				<thead>
					<tr>
						<th>Startup</th>
						<th>Thesis</th>
						{columns === "review" ? <th>Needs</th> : null}
						{columns === "done" ? <th>Findings</th> : null}
						{columns === "done" ? <th>Decision</th> : null}
						<th>{columns === "running" ? "Started" : "Finished"}</th>
					</tr>
				</thead>
				<tbody>
					{items.map((e) => (
						<tr key={e.id} className="clickable" onClick={() => navigate("evaluations", e.id)}>
							<td>
								<a href={href("evaluations", e.id)} className="serif" onClick={(ev) => ev.stopPropagation()}>
									{e.startupName}
								</a>
								{e.predecessorId ? <span className="muted small"> (rerun)</span> : null}
							</td>
							<td className="nowrap">v{e.thesisVersion}</td>
							{columns === "review" ? (
								<td>
									{[
										e.reviewsOutstanding ? `${e.reviewsOutstanding} finding${e.reviewsOutstanding === 1 ? "" : "s"} to review` : null,
										e.openRequests ? `${e.openRequests} open request${e.openRequests === 1 ? "" : "s"}` : null,
									]
										.filter(Boolean)
										.join(", ")}
								</td>
							) : null}
							{columns === "done" ? (
								<td style={{ minWidth: 180 }}>
									{e.status === "completed" && e.summary ? <CoverageBar byOutcome={e.summary.byOutcome} total={e.summary.criteria} /> : <Status value={e.status} />}
								</td>
							) : null}
							{columns === "done" ? <td>{e.currentDecision ? e.currentDecision.decision.replace(/_/g, " ") : <span className="muted">None yet</span>}</td> : null}
							<td className="nowrap muted">{when(columns === "running" ? e.createdAt : e.completedAt)}</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

export function WorkspaceScreen() {
	const session = useSession();
	const { data, error, loading } = useLoad(() => call<{ overview: Overview }>("workspace.overview", {}).then((r) => r.overview), [], {
		pollMs: (d) => (d?.active.length ? 3000 : null),
	});
	if (loading && !data) return <Loading what="workspace" />;
	if (!data) return <ErrorNote error={error} />;
	const noTheses = !data.theses.some((t) => t.versionCount > 0);
	return (
		<>
			<PageHead title="Overview" sub={`Startup evaluations in ${session.principal.workspaceName}: what needs a reviewer, what is running, and who is still missing evidence.`} />
			{noTheses ? (
				<div className="note warn">
					No approved thesis yet. <a href={href("theses")}>Write and approve your investment thesis</a> before running evaluations.
				</div>
			) : null}
			<Section title="Needs a reviewer">
				<EvaluationRows items={data.outstandingReviews} columns="review" empty="Nothing is waiting for review." />
			</Section>
			{data.active.length ? (
				<Section title="Running now">
					<EvaluationRows items={data.active} columns="running" empty="" />
				</Section>
			) : null}
			<Section title="Recently finished">
				<EvaluationRows items={data.recentlyCompleted} columns="done" empty="No evaluations yet. Open a startup and run one against an approved thesis." />
			</Section>
			<Section title="Waiting on evidence" actions={<a href={href("startups")}>All startups</a>}>
				{data.awaitingEvidence.length ? (
					<table className="list">
						<thead>
							<tr>
								<th>Startup</th>
								<th>Usable documents</th>
								<th>Documents with issues</th>
							</tr>
						</thead>
						<tbody>
							{data.awaitingEvidence.map((s) => (
								<tr key={s.startup.id} className="clickable" onClick={() => navigate("startups", s.startup.id)}>
									<td className="serif">{s.startup.name}</td>
									<td>{s.usableDocuments}</td>
									<td>{s.documentsWithIssues ? <span className="verif contradicted">{s.documentsWithIssues}</span> : 0}</td>
								</tr>
							))}
						</tbody>
					</table>
				) : (
					<p className="empty">Every startup has readable evidence.</p>
				)}
			</Section>
		</>
	);
}
