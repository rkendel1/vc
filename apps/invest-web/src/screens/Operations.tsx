import { type AttentionItem, monitoringHealth } from "../../../../invest/domain/research.ts";
import { call } from "../api.ts";
import { Badge, EmptyState, ErrorNote, Loading, PageHead, Section, href, useCan, useLoad, useSession, when } from "../ui.tsx";
import { type Principal } from "../ui.tsx";
import { SourcesPanel } from "./Hub.tsx";
import { JevLine } from "./Workspace.tsx";
import { AttentionPanel } from "./Investors.tsx";

type Any = Record<string, any>; // eslint-disable-line

const TABS = [
	{ id: "sources", label: "Research sources", needs: "source.manage" },
	{ id: "monitoring", label: "Monitoring", needs: "research.run" },
	{ id: "system", label: "System health", needs: "source.manage" },
] as const;

/** The operator's corner: where research data comes from, how often it is refreshed, and what the system is connected to. Not part of any user's main journey. */
export function OperationsScreen({ tab }: { tab?: string }) {
	const session = useSession();
	const can = (p: string) => (session.principal as Principal).permissions.includes(p);
	const current = TABS.find((t) => t.id === tab && can(t.needs))?.id ?? TABS.find((t) => can(t.needs))?.id ?? "sources";
	return (
		<>
			<PageHead title="Operations" sub="Where investor research comes from, how it is kept current, and what the system is connected to." />
			<nav className="steps-nav tabs-nav" aria-label="Operations">
				<ol>
					{TABS.filter((t) => can(t.needs)).map((t) => (
						<li key={t.id}>
							<a href={href("operations", t.id)} aria-current={current === t.id ? "page" : undefined}>
								<strong>{t.label}</strong>
							</a>
						</li>
					))}
				</ol>
			</nav>
			{current === "sources" ? <SourcesPanel /> : current === "monitoring" ? <MonitoringPanel /> : <SystemPanel />}
		</>
	);
}

function MonitoringPanel() {
	const attention = useLoad(() => call<{ items: AttentionItem[] }>("attention.list", {}).then((r) => r.items), []);
	const firms = useLoad(() => call<{ items: Any[] }>("firm.list", {}).then((r) => r.items), []);
	const health = firms.data ? monitoringHealth(firms.data.filter((f) => f.monitoring).map((f) => f.monitoring), new Date()) : null;
	return (
		<>
			<p className="muted small">Firms are re-read on a schedule. A failing or stale firm shows here first. Findings never change anything a firm has approved.</p>
			{health?.schedulerLikelyMissing ? (
				<p className="notice error" role="alert">
					{health.overdue} monitored {health.overdue === 1 ? "firm is" : "firms are"} overdue (the longest by {health.oldestOverdueMinutes} minutes). Nothing appears to be running the schedule; ask whoever operates the server to start the monitoring job.
				</p>
			) : null}
			<AttentionPanel items={attention.data ?? []} />
			{firms.loading && !firms.data ? <Loading what="monitoring" /> : <ErrorNote error={firms.error} />}
			{firms.data?.length ? (
				<div className="table-wrap">
					<table className="list responsive">
						<caption className="visually-hidden">Monitoring status per firm</caption>
						<thead>
							<tr>
								<th scope="col">Firm</th>
								<th scope="col">Monitoring</th>
								<th scope="col">Last success</th>
								<th scope="col">State</th>
							</tr>
						</thead>
						<tbody>
							{firms.data.map((f) => (
								<tr key={f.id}>
									<th scope="row" data-label="Firm">
										<a href={href("investors", f.id)}>{f.name}</a>
									</th>
									<td data-label="Monitoring">{f.monitoring ? (f.monitoring.enabled ? (f.monitoring.running ? "Checking now" : `Next ${when(f.monitoring.nextCheckAt)}`) : "Paused") : "Not monitored"}</td>
									<td data-label="Last success">{when(f.lastSuccessAt)}</td>
									<td data-label="State">
										{f.monitoring?.consecutiveFailures ? <Badge tone="bad">{f.monitoring.consecutiveFailures} failed checks</Badge> : f.stale ? <Badge tone="caution">Out of date</Badge> : <Badge tone="ok">Current</Badge>}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			) : firms.data ? (
				<EmptyState title="No firms are monitored yet">Add firms with the research command; they are monitored on the interval you set. See the README.</EmptyState>
			) : null}
		</>
	);
}

function SystemPanel() {
	const session = useSession();
	const canOps = useCan("source.manage");
	const overview = useLoad(() => call<Any>("workspace.overview", {}).then((r) => r.overview), []);
	return (
		<>
			<Section title="Connections">
				<dl className="facts">
					<div>
						<dt>Evaluation service (Jev)</dt>
						<dd>
							<JevLine jev={session.jev} />
						</dd>
					</div>
					<div>
						<dt>Access</dt>
						<dd>
							Signed in as {session.principal.displayName} in {session.principal.workspaceName}.
						</dd>
					</div>
				</dl>
			</Section>
			{canOps && overview.data ? (
				<Section title="This workspace">
					<dl className="facts">
						<div>
							<dt>Startups</dt>
							<dd>{overview.data.counts.startups}</dd>
						</div>
						<div>
							<dt>Documents</dt>
							<dd>{overview.data.counts.documents}</dd>
						</div>
						<div>
							<dt>Evaluations</dt>
							<dd>{overview.data.counts.evaluations}</dd>
						</div>
					</dl>
				</Section>
			) : null}
			<p className="muted small">Developer diagnostics (capability inventory, generated contracts, architecture checks) are not part of the application: run the commands listed in the README.</p>
		</>
	);
}
