/**
 * Quality harness and pilot report.
 *
 *   bun run quality                        # stand-in judge, prints the report
 *   bun run quality --out docs/invest/PILOT_REPORT.md
 *   JEV_ENDPOINT=… JEV_API_KEY=… bun run quality   # measure a real Jev deployment
 *
 * Measures what the specification asks for: false support, false contradiction, unknown handling,
 * reviewer correction rate, latency, failure rate and cost (where measurable).
 */
import { writeFile } from "node:fs/promises";
import { loadConfig } from "../config.ts";
import type { Actor, CriterionFinding, Evaluation, Outcome } from "../domain/types.ts";
import { JevHttpClient, type JevDecider } from "../jev/jev-client.ts";
import { SEED_SAAS_CRITERIA, SEED_SAAS_SETTINGS } from "../testing/fixtures.ts";
import { ScriptedJev, createHarness, lexicalJudge } from "../testing/harness.ts";
import { QUALITY_CASES } from "./cases.ts";

export type Row = { case: string; kind: string; criterion: string; mode: string; label: Outcome; system: Outcome; reviewRequired: boolean };
export type QualityResult = {
	judge: string;
	rows: Row[];
	metrics: {
		findings: number;
		agreement: number;
		falseSupportRate: number;
		falseSupportCount: number;
		falseContradictionRate: number;
		falseContradictionCount: number;
		unknownHandling: number;
		reviewRoutingRecall: number;
		reviewerCorrectionRate: number;
		evaluationFailureRate: number;
		latencyMs: { p50: number; p95: number; max: number };
		costPerEvaluationUsd: null;
	};
	verification: { evaluations: number; verified: number };
};

const ratio = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 1000 : 0);
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
function percentile(values: number[], p: number): number {
	if (!values.length) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

export async function runQuality(jev: JevDecider, judge: string): Promise<QualityResult> {
	const h = await createHarness({ jev, maxRetries: 2 });
	const actor: Actor = { principalId: "quality", displayName: "Quality harness", workspaceId: "ws-quality", permissions: [] };
	const rows: Row[] = [];
	const latencies: number[] = [];
	let verified = 0;
	let corrections = 0;
	try {
		const draft = await h.service.theses.createDraft(actor, { name: "Quality", criteria: SEED_SAAS_CRITERIA, settings: SEED_SAAS_SETTINGS });
		const { version } = await h.service.theses.approve(actor, { thesisId: draft.id, expectedVersion: draft.__version ?? 1 });
		for (const c of QUALITY_CASES) {
			const s = await h.service.startups.create(actor, { name: c.name, founderClaims: c.founderClaims });
			for (const d of c.docs) await h.service.documents.upload(actor, { startupId: s.id, bytes: d.bytes, filename: d.filename, mediaType: "application/pdf", sourceType: d.sourceType });
			const started = await h.service.evaluations.start(actor, { startupId: s.id, thesisVersionId: version.id, requestKey: `quality-${s.id}` });
			await h.service.evaluations.settled(started.id);
			const evaluation: Evaluation = await h.service.evaluations.get(actor, started.id);
			if (evaluation.metrics.latencyMs !== null) latencies.push(evaluation.metrics.latencyMs);
			if ((await h.service.evaluations.verify(actor, evaluation.id)).ok) verified++;
			const findings: CriterionFinding[] = await h.service.evaluations.findings(actor, evaluation.id);
			for (const f of findings) {
				const label = c.labels[f.criterionId];
				rows.push({ case: c.name, kind: c.kind, criterion: f.criterionId, mode: f.mode, label, system: f.outcome, reviewRequired: f.review.required });
				// Simulated reviewer: corrects every finding that disagrees with the label, through the real override path.
				if (f.outcome !== label && label !== "evaluation_failed") {
					await h.service.decisions.recordReview(actor, { evaluationId: evaluation.id, findingId: f.id, action: "override", outcome: label, reason: "Quality harness: reviewer label differs." });
					corrections++;
				}
			}
		}
	} finally {
		await h.close();
	}
	const notSupported = rows.filter((r) => r.label !== "supported");
	const notContradicted = rows.filter((r) => r.label !== "contradicted");
	const unknowns = rows.filter((r) => r.label === "insufficient_evidence");
	const wrong = rows.filter((r) => r.system !== r.label);
	const semantic = rows.filter((r) => r.mode === "semantic");
	return {
		judge,
		rows,
		metrics: {
			findings: rows.length,
			agreement: ratio(rows.length - wrong.length, rows.length),
			falseSupportCount: notSupported.filter((r) => r.system === "supported").length,
			falseSupportRate: ratio(notSupported.filter((r) => r.system === "supported").length, notSupported.length),
			falseContradictionCount: notContradicted.filter((r) => r.system === "contradicted").length,
			falseContradictionRate: ratio(notContradicted.filter((r) => r.system === "contradicted").length, notContradicted.length),
			unknownHandling: ratio(unknowns.filter((r) => r.system === "insufficient_evidence" || r.system === "evaluation_failed").length, unknowns.length),
			reviewRoutingRecall: ratio(wrong.filter((r) => r.reviewRequired).length, wrong.length),
			reviewerCorrectionRate: ratio(corrections, rows.length),
			evaluationFailureRate: ratio(semantic.filter((r) => r.system === "evaluation_failed").length, semantic.length),
			latencyMs: { p50: percentile(latencies, 50), p95: percentile(latencies, 95), max: Math.max(0, ...latencies) },
			costPerEvaluationUsd: null,
		},
		verification: { evaluations: QUALITY_CASES.length, verified },
	};
}

export function renderReport(r: QualityResult, generatedAt = new Date().toISOString()): string {
	const m = r.metrics;
	const disagreements = r.rows.filter((x) => x.system !== x.label);
	return `# Attn Invest — quality and pilot-readiness report

Generated ${generatedAt} by \`bun run quality\`. Judge: **${r.judge}**.

> These figures come from ${r.verification.evaluations} synthetic, labelled regression cases (positive, negative,
> ambiguous, adversarial, missing evidence). They measure the pipeline's behaviour, not Jev's real-world accuracy.
> Before an investor pilot, run this harness against the production Jev configuration and replace the cases with
> real deals labelled blind by reviewers who have not seen the system's findings (specification §10).

## Metrics

| Measure | Value | Meaning |
| --- | --- | --- |
| Findings | ${m.findings} | ${r.verification.evaluations} evaluations × ${SEED_SAAS_CRITERIA.length} criteria |
| Agreement with label | ${pct(m.agreement)} | System outcome equals the reviewer's label |
| False support rate | ${pct(m.falseSupportRate)} (${m.falseSupportCount}) | Labelled anything but supported, system said supported |
| False contradiction rate | ${pct(m.falseContradictionRate)} (${m.falseContradictionCount}) | Labelled anything but contradicted, system said contradicted |
| Unknown handling | ${pct(m.unknownHandling)} | Labelled insufficient evidence, system did not claim a conclusion |
| Review routing recall | ${pct(m.reviewRoutingRecall)} | Of findings the reviewer disagrees with, share the system had already routed to review |
| Reviewer correction rate | ${pct(m.reviewerCorrectionRate)} | Overrides needed to reach the labels |
| Semantic failure rate | ${pct(m.evaluationFailureRate)} | Jev judgments that could not complete |
| Latency per evaluation | p50 ${m.latencyMs.p50} ms, p95 ${m.latencyMs.p95} ms, max ${m.latencyMs.max} ms | Start to atomic completion |
| Cost per evaluation | not measurable | The Jev HTTP contract reports no usage; recorded as null, not estimated |
| Independent verification | ${r.verification.verified}/${r.verification.evaluations} | \`evaluation.verify\` recomputed every stored evaluation |

## Disagreements

${
	disagreements.length
		? `| Case | Kind | Criterion | Label | System | Routed to review |\n| --- | --- | --- | --- | --- | --- |\n${disagreements.map((d) => `| ${d.case} | ${d.kind} | ${d.criterion} | ${d.label} | ${d.system} | ${d.reviewRequired ? "yes" : "**no**"} |`).join("\n")}`
		: "None."
}

## All findings

| Case | Criterion | Mode | Label | System |
| --- | --- | --- | --- | --- |
${r.rows.map((x) => `| ${x.case} | ${x.criterion} | ${x.mode} | ${x.label} | ${x.system} |`).join("\n")}
`;
}

if (import.meta.main) {
	const { jev: cfg } = loadConfig({ ...process.env, APP_ENV: "test" }).config;
	const jev: JevDecider = cfg.endpoint
		? new JevHttpClient({ endpoint: cfg.endpoint, apiKey: cfg.apiKey, provider: cfg.provider, model: cfg.model, timeoutMs: cfg.timeoutMs })
		: new ScriptedJev(lexicalJudge);
	const judge = cfg.endpoint ? `Jev at ${new URL(cfg.endpoint).origin}${cfg.model ? ` (${cfg.model})` : ""}` : "lexical test stand-in (not Jev)";
	const result = await runQuality(jev, judge);
	const report = renderReport(result);
	const outIndex = process.argv.indexOf("--out");
	if (outIndex > 0) {
		await writeFile(process.argv[outIndex + 1], report);
		console.log(`Wrote ${process.argv[outIndex + 1]}`);
	} else console.log(report);
	const gate = Number(process.env.QUALITY_MAX_FALSE_SUPPORT ?? 0);
	if (result.metrics.falseSupportRate > gate) {
		console.error(`False support rate ${result.metrics.falseSupportRate} exceeds the gate ${gate}`);
		process.exit(1);
	}
	if (result.verification.verified !== result.verification.evaluations) {
		console.error("Some evaluations failed independent verification");
		process.exit(1);
	}
}
