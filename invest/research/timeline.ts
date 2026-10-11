import type { EventReviewState, FirmProfile, TimelineItem, TimelineItemType } from "../domain/research.ts";

/**
 * The investor intelligence timeline, assembled from persisted records. Three dates are always
 * kept apart: what the source says (publishedAt / announcedAt), when this system found it
 * (discoveredAt), and when a person decided something (reviewedAt). Research health items
 * (failed or stale checks) are a different category from investor activity and are never worded as
 * activity.
 */
export type TimelineFilter = { types?: TimelineItemType[]; from?: string; to?: string; reviewStates?: (EventReviewState | "not_applicable")[]; limit?: number };

const TYPE_LABEL: Record<string, string> = { new_investment: "Investment", seed_round: "Seed round", venture_round: "Venture round", follow_on: "Follow-on", acquisition: "Acquisition", portfolio_addition: "Listed on portfolio page", other: "Other" };
const money = (n: number) => (n >= 1e9 ? `$${n / 1e9}B` : n >= 1e6 ? `$${n / 1e6}M` : n >= 1e3 ? `$${n / 1e3}K` : `$${n}`);

export function buildTimeline(profile: FirmProfile, filter: TimelineFilter = {}): TimelineItem[] {
	const items: TimelineItem[] = [];
	const baselineRuns = new Set(profile.runs.filter((r) => r.baseline).map((r) => r.id));
	const decisive = (rs: { action: string; createdAt: string }[]) => rs.find((r) => ["confirm", "dismiss", "dispute", "flag"].includes(r.action))?.createdAt ?? null;

	for (const e of profile.events) {
		const portfolio = e.type === "portfolio_addition";
		const amount = e.roundAmountUsd ? ` Round amount stated by the source: ${money(e.roundAmountUsd)} (the round, not necessarily this firm's investment).` : "";
		const own = e.firmAmountUsd ? ` Firm amount stated by the source: ${money(e.firmAmountUsd)}.` : "";
		items.push({
			id: `event:${e.id}`,
			type: portfolio ? "portfolio_addition" : "investment_event",
			title: `${e.companyName}: ${TYPE_LABEL[e.type] ?? e.type}${e.round && e.type !== "seed_round" ? ` (${e.round})` : ""}`,
			detail: `${portfolio ? "Newly listed on a portfolio page; not an announcement of an investment." : e.classification === "historical" ? "Historical announcement found now (backfilled), not new activity." : e.classification === "undated" ? "No announcement date was found." : "Recent announcement."}${e.involvement === "implied_by_source" && !portfolio ? " The source is the firm's own post; the passage does not say the firm took part." : ""}${e.companyMatch.status === "uncertain" ? " A similarly named company already has an event; they were not merged." : ""}${amount}${own}${e.corroborated ? " Reported by more than one source." : ""}`,
			publishedAt: e.earliestPublishedAt,
			announcedAt: e.announcedAt,
			discoveredAt: e.discoveredAt,
			reviewedAt: decisive(e.reviews),
			reviewState: portfolio ? e.reviewState : e.reviewState,
			category: "investment_activity",
			baseline: e.baseline,
			evidence: e.evidence.map((x) => ({ sourceId: x.sourceId, url: x.url, passage: x.passage })),
			refs: { eventId: e.id, runId: e.discoveryRunId },
		});
	}
	for (const f of profile.findings) {
		const type: TimelineItemType = f.kind === "source_changed" ? "source_changed" : f.kind === "source_missing" ? "source_missing" : f.kind === "thesis_conflict" ? "conflict" : "thesis_finding";
		const dates = f.evidence.map((x) => x.publishedAt).filter(Boolean).sort() as string[];
		items.push({
			id: `finding:${f.id}`,
			type,
			title: f.kind === "inferred_pattern" ? `Possible pattern (inferred): ${f.subject.value.replace(/_/g, " ")}` : f.summary.split(". ")[0]!.slice(0, 140),
			detail: `${f.summary}${f.version > 1 ? ` (version ${f.version})` : ""}${f.approvalIds.length ? " Touches an investor-verified value; that value was not changed." : ""}`,
			publishedAt: dates[0] ?? null,
			announcedAt: null,
			discoveredAt: f.discoveredAt,
			reviewedAt: decisive(f.reviews ?? []),
			reviewState: f.reviewState ?? "unreviewed",
			category: type === "source_changed" || type === "source_missing" ? "source" : "strategy",
			baseline: baselineRuns.has(f.runId),
			evidence: f.evidence.map((x) => ({ sourceId: x.sourceId, url: x.url, passage: x.passage })),
			refs: { findingId: f.id, runId: f.runId },
		});
	}
	const firstByUrl = new Map<string, (typeof profile.sources)[number]>();
	for (const s of [...profile.sources].sort((a, b) => a.firstRetrievedAt.localeCompare(b.firstRetrievedAt))) if (s.outcome === "ok" && !firstByUrl.has(s.requestedUrl)) firstByUrl.set(s.requestedUrl, s);
	for (const s of firstByUrl.values())
		items.push({ id: `source:${s.id}`, type: "source_discovered", title: `Source discovered: ${s.title ?? s.finalUrl}`, detail: `${s.pageKind} page${s.sourceClass === "official_publication" ? " (official publication)" : ""}.`, publishedAt: s.publishedAt, announcedAt: null, discoveredAt: s.firstRetrievedAt, reviewedAt: null, reviewState: "not_applicable", category: "source", baseline: baselineRuns.has(s.firstRunId), evidence: [{ sourceId: s.id, url: s.finalUrl, passage: s.excerpts[0] ?? null }], refs: { sourceId: s.id, runId: s.firstRunId } });
	for (const r of profile.runs.filter((r) => r.status === "failed" || (r.status === "completed" && !r.success)))
		items.push({ id: `run:${r.id}`, type: "research_failed", title: r.status === "failed" ? "Research run failed" : "Research could not read the site", detail: `${r.error?.message ?? r.outcomeReasons.join("; ")} Previous successful results were kept. This is research health, not investor activity.`, publishedAt: null, announcedAt: null, discoveredAt: r.completedAt ?? r.startedAt, reviewedAt: null, reviewState: "not_applicable", category: "health", baseline: false, evidence: [], refs: { runId: r.id } });
	for (const r of profile.reviews)
		items.push({ id: `review:${r.id}`, type: "review", title: `${r.action[0]!.toUpperCase()}${r.action.slice(1)} by ${r.createdBy}`, detail: `${r.note}${r.correctedValue ? ` Suggested value: ${r.correctedValue}.` : ""}`, publishedAt: null, announcedAt: null, discoveredAt: r.createdAt, reviewedAt: r.createdAt, reviewState: "not_applicable", category: "review", baseline: false, evidence: [], refs: { eventId: r.eventId ?? undefined, findingId: r.findingId ?? undefined, criterionId: r.criterionId ?? undefined } });

	let out = items;
	if (filter.types?.length) out = out.filter((i) => filter.types!.includes(i.type));
	if (filter.from) out = out.filter((i) => i.discoveredAt >= filter.from!);
	if (filter.to) out = out.filter((i) => i.discoveredAt <= filter.to!);
	if (filter.reviewStates?.length) out = out.filter((i) => filter.reviewStates!.includes(i.reviewState));
	return out.sort((a, b) => b.discoveredAt.localeCompare(a.discoveredAt) || a.id.localeCompare(b.id)).slice(0, Math.min(filter.limit ?? 300, 1000));
}
