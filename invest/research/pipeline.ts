import type { ResearchLimits, ResearchStatus } from "../domain/research.ts";
import type { Actor } from "../domain/types.ts";
import type { InvestorResearchModule, VerifySummary } from "../modules/investor-research.ts";
import type { MonitoringModule } from "../modules/monitoring.ts";
import { type FirmInput, type ParseResult, type PreparedFirm, prepareInputs } from "./input.ts";

export type PipelineOptions = {
	dryRun: boolean;
	limits?: Partial<ResearchLimits>;
	verify: boolean;
	/** Skip firms whose last completed research is newer than this many days (and not incomplete). */
	skipFreshDays?: number;
	concurrency: number;
	/** Register each firm as a persistent monitoring target before its initial research. */
	monitor?: { module: MonitoringModule; intervalMinutes?: number };
	now?: () => Date;
};

export type FirmReport = {
	domain: string;
	name: string | null;
	inputLines: number[];
	reconcile: "created" | "updated" | "unchanged" | "would_create" | "would_update" | "would_leave";
	monitoring: "registered" | "already_registered" | "would_register" | "not_requested";
	status: ResearchStatus | "skipped" | "not_run" | "error";
	runId: string | null;
	pagesRead: number | null;
	pagesAttempted: number | null;
	criteria: { explicit: number; observed: number; inferred: number } | null;
	reasons: string[];
	verification: VerifySummary | null;
	error: { message: string; retryable: boolean } | null;
};

export type PipelineReport = {
	dryRun: boolean;
	inputRows: number;
	firms: FirmReport[];
	rejected: ParseResult["errors"];
	duplicatesCollapsed: number;
	totals: Record<string, number>;
};

/**
 * One repeatable job: reconcile every firm, research it within bounds, record the result.
 * Re-running with the same input reconciles rather than duplicates. A failure for one firm is
 * recorded against that firm and never stops the others.
 */
export async function runPipeline(research: InvestorResearchModule, actor: Actor, inputs: FirmInput[], parseErrors: ParseResult["errors"], options: PipelineOptions): Promise<PipelineReport> {
	const prepared = prepareInputs(inputs, parseErrors);
	const reports: FirmReport[] = new Array(prepared.firms.length);
	const now = options.now ?? (() => new Date());

	const work = async (p: PreparedFirm, index: number) => {
		const report: FirmReport = { domain: p.canonicalDomain, name: p.name ?? null, inputLines: p.lines, reconcile: "unchanged", monitoring: "not_requested", status: "not_run", runId: null, pagesRead: null, pagesAttempted: null, criteria: null, reasons: [], verification: null, error: null };
		reports[index] = report;
		try {
			if (options.dryRun) {
				const existing = await research.lookup(actor, p.canonicalDomain);
				report.reconcile = !existing ? "would_create" : "would_leave";
				report.name = existing?.name ?? p.name ?? p.canonicalDomain;
				if (options.monitor) report.monitoring = existing && (await options.monitor.module.get(actor, existing.id)) ? "already_registered" : "would_register";
				if (existing) report.status = existing.researchStatus === "pending" ? "not_run" : existing.researchStatus;
				return;
			}
			const { firm, action } = await research.reconcile(actor, p);
			report.reconcile = action;
			report.name = firm.name;
			// The firm is a persistent monitoring target from here on, whatever the initial crawl does.
			if (options.monitor) report.monitoring = (await options.monitor.module.register(actor, firm, { intervalMinutes: options.monitor.intervalMinutes })).created ? "registered" : "already_registered";
			if (options.skipFreshDays && firm.lastResearchedAt && firm.researchStatus !== "research_incomplete" && firm.researchStatus !== "pending") {
				const ageDays = (now().getTime() - Date.parse(firm.lastResearchedAt)) / 86_400_000;
				if (ageDays < options.skipFreshDays) {
					report.status = "skipped";
					report.reasons = [`researched ${Math.floor(ageDays)} day(s) ago (--skip-fresh-days ${options.skipFreshDays})`];
					return;
				}
			}
			const result = await research.research(actor, firm.id, { limits: options.limits, verify: options.verify });
			report.runId = result.run.id;
			report.status = result.run.outcome ?? "research_incomplete";
			report.reasons = result.run.outcomeReasons;
			report.pagesRead = result.run.counts.pagesOk;
			report.pagesAttempted = result.run.counts.pagesAttempted;
			report.verification = result.verification;
			report.name = result.firm.name;
			const profile = await research.profile(actor, firm.id);
			report.criteria = {
				explicit: profile.criteria.filter((c) => c.assertionType === "explicit").length,
				observed: profile.criteria.filter((c) => c.assertionType === "observed").length,
				inferred: profile.criteria.filter((c) => c.assertionType === "inferred").length,
			};
		} catch (error) {
			report.status = "error";
			report.error = { message: (error as Error)?.message?.slice(0, 300) ?? "failed", retryable: true };
		}
	};

	let next = 0;
	const lanes = Math.max(1, Math.min(options.concurrency, 8));
	await Promise.all(
		Array.from({ length: lanes }, async () => {
			for (;;) {
				const i = next++;
				if (i >= prepared.firms.length) return;
				await work(prepared.firms[i]!, i);
			}
		}),
	);

	const totals: Record<string, number> = { firms: reports.length, rejectedRows: prepared.errors.length, duplicatesCollapsed: prepared.duplicatesCollapsed };
	for (const r of reports) totals[r.status] = (totals[r.status] ?? 0) + 1;
	return { dryRun: options.dryRun, inputRows: inputs.length + parseErrors.length, firms: reports, rejected: prepared.errors, duplicatesCollapsed: prepared.duplicatesCollapsed, totals };
}

export function formatReport(report: PipelineReport): string {
	const lines: string[] = [];
	lines.push(`Research pipeline ${report.dryRun ? "(dry run: no network requests, nothing written)" : "report"}`);
	lines.push(`Input rows: ${report.inputRows}; firms: ${report.firms.length}; duplicate rows collapsed: ${report.duplicatesCollapsed}; rejected rows: ${report.rejected.length}`);
	lines.push("");
	for (const f of report.firms) {
		lines.push(`${f.domain}${f.name && f.name !== f.domain ? ` (${f.name})` : ""}`);
		lines.push(`  firm: ${f.reconcile}; research: ${f.status}${f.runId ? `; run ${f.runId}` : ""}${f.monitoring !== "not_requested" ? `; monitoring: ${f.monitoring}` : ""}`);
		if (f.pagesAttempted !== null) lines.push(`  pages read: ${f.pagesRead}/${f.pagesAttempted}`);
		if (f.criteria) lines.push(`  criteria: ${f.criteria.explicit} explicit, ${f.criteria.observed} observed, ${f.criteria.inferred} inferred`);
		if (f.verification) lines.push(f.verification.skipped ? "  verification: pending (Jev not configured)" : `  verification: ${f.verification.supported} supported, ${f.verification.notSupported} not supported, ${f.verification.inconclusive} inconclusive, ${f.verification.errors} errors`);
		for (const r of f.reasons) lines.push(`  - ${r}`);
		if (f.error) lines.push(`  ERROR (retryable: ${f.error.retryable}): ${f.error.message}`);
	}
	if (report.rejected.length) {
		lines.push("", "Rejected input rows:");
		for (const e of report.rejected) lines.push(`  line ${e.line}: ${e.message}${e.value ? ` (${e.value})` : ""}`);
	}
	lines.push("", `Totals: ${Object.entries(report.totals).map(([k, v]) => `${k}=${v}`).join(", ")}`);
	return lines.join("\n");
}
