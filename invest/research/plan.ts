import { sha256Hex } from "../domain/canonical.ts";
import type {
	EventEvidence,
	EventType,
	FirmApproval,
	InvestmentEvent,
	ResearchCriterion,
	ResearchFinding,
	ResearchSource,
	SourceCheck,
	SourceState,
	InvestorFirm,
	PageKind,
} from "../domain/research.ts";
import { sourceClassFor } from "./classify.ts";
import type { CrawlResult } from "./crawler.ts";
import { diffClaims } from "./diff.ts";
import { EXTRACTOR_VERSION, criterionId, extractFromPage } from "./extract.ts";
import type { EventCandidate } from "./events.ts";
import { classifyEvent, companyKey, extractEventsFromBlocks, extractEventsFromFeed, extractPortfolioEntries, matchEvent } from "./events.ts";
import { changeRatio, normalizeBlocks } from "./normalize.ts";
import { canonicalPageUrl } from "./url.ts";

/**
 * The pure core of one research run: given what the crawl read and what was already known, decide
 * what is new, changed, missing, carried forward, an event, or a finding. No I/O, no clock, no ids
 * from randomness, so the same inputs always yield the same plan (idempotent re-runs) and tests
 * can drive it directly.
 */
export const MATERIAL_CHANGE_RATIO = 0.15;
const EVENT_KINDS = new Set<PageKind>(["announcement", "home", "other", "portfolio", "feed"]);

export type PlanInput = {
	workspaceId: string;
	firm: Pick<InvestorFirm, "id" | "name" | "canonicalDomain">;
	runId: string;
	now: string;
	baseline: boolean;
	lookbackDays: number;
	crawl: CrawlResult;
	priorStates: Map<string, SourceState>;
	allCriteria: ResearchCriterion[];
	previousCurrentIds: string[];
	approvals: Pick<FirmApproval, "id" | "field" | "polarity" | "value" | "valueRange">[];
	existingEvents: InvestmentEvent[];
	existingEvidenceIds: ReadonlySet<string>;
	existingFindings: ResearchFinding[];
	sourceUrlById: ReadonlyMap<string, string>;
};

export type RunPlan = {
	sources: ResearchSource[];
	checks: SourceCheck[];
	freshCriteria: ResearchCriterion[];
	carriedCriteria: ResearchCriterion[];
	states: { state: SourceState; create: boolean; priorVersion: number | undefined }[];
	events: InvestmentEvent[];
	evidence: EventEvidence[];
	corroborations: { eventId: string; evidenceId: string }[];
	findings: ResearchFinding[];
	homeTitle: string | null;
	success: boolean;
	pagesRead: number;
};

const dedupeBy = <T>(items: T[], key: (t: T) => string) => [...new Map(items.map((i) => [key(i), i])).values()];
const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1)}…`);

function feedBlocks(items: { title: string; summary: string }[]): string[] {
	return items.flatMap((i) => [i.title, i.summary]).filter((b) => b.length >= 3);
}

export function planRun(i: PlanInput): RunPlan {
	const { firm, workspaceId, now } = i;
	const sources: ResearchSource[] = [];
	const checks: SourceCheck[] = [];
	const fresh: ResearchCriterion[] = [];
	const states: RunPlan["states"] = [];
	const findingDrafts: Omit<ResearchFinding, "id" | "version" | "supersedesId" | "workspaceId" | "firmId" | "runId" | "priorRunId" | "discoveredAt" | "extractorVersion">[] = [];
	const readUrls = new Set<string>();
	const restrictedUrls = new Set<string>();
	const reReadSourceIds = new Set<string>();
	const eventCands: { cand: EventCandidate; sourceId: string; url: string }[] = [];
	const portfolioAdds: { name: string; passage: string; sourceId: string; url: string; publishedAt: string | null }[] = [];
	let homeTitle: string | null = null;
	let pagesRead = 0;

	for (const page of i.crawl.pages) {
		const f = page.fetch;
		const urlKey = canonicalPageUrl(page.requestedUrl) ?? page.requestedUrl;
		const prior = i.priorStates.get(urlKey);
		const feedOk = page.feed?.ok ? page.feed : null;
		const blocks = feedOk ? feedBlocks(feedOk.items) : page.parsed && f.outcome === "ok" ? page.parsed.blocks : [];
		const readable = f.outcome === "ok" && !page.restricted && (feedOk !== null || page.parsed !== null);
		const norm = readable ? normalizeBlocks(blocks) : null;
		const rawHash = readable ? `sha256:${sha256Hex(blocks.join("\n"))}` : null;
		const outcome = page.restricted ? "blocked_robots" : f.outcome;
		const sourceClass = sourceClassFor(page.kind, f.finalUrl);
		const publishedAt = feedOk ? (feedOk.items.map((x) => x.publishedAt).filter(Boolean).sort().at(-1) ?? null) : (page.parsed?.publishedAt ?? null);
		let hostile = false;
		let excerpts: string[] = [];
		let extracted: ReturnType<typeof extractFromPage>["criteria"] = [];
		let candidates: EventCandidate[] = [];
		let entries: string[] = [];
		if (readable && page.parsed) {
			if (page.kind === "home" && page.depth === 0) homeTitle = page.parsed.title;
			const ex = extractFromPage({ kind: feedOk ? "announcement" : page.kind, sourceClass, blocks, url: f.finalUrl });
			hostile = ex.hostile;
			extracted = ex.criteria;
			excerpts = ex.relevantExcerpts.slice(0, 8);
			if (EVENT_KINDS.has(page.kind)) {
				const base = { firmName: firm.name, kind: page.kind, links: page.parsed.links, scopeDomain: firm.canonicalDomain };
				const ev = feedOk ? extractEventsFromFeed(feedOk.items, base) : extractEventsFromBlocks(blocks, { ...base, publishedAt });
				hostile ||= ev.hostile;
				candidates = ev.candidates;
				excerpts = [...new Set([...excerpts, ...candidates.map((c) => c.passage)])].slice(0, 10);
			}
			if (page.kind === "portfolio") entries = extractPortfolioEntries(blocks);
		}
		const id = `src_${sha256Hex([firm.id, page.requestedUrl, norm?.hash ?? `outcome:${outcome}`, EXTRACTOR_VERSION].join("|")).slice(0, 32)}`;
		sources.push({
			id,
			workspaceId,
			firmId: firm.id,
			requestedUrl: page.requestedUrl,
			finalUrl: f.finalUrl,
			sourceClass,
			pageKind: page.kind,
			outcome,
			httpStatus: f.httpStatus,
			contentType: f.contentType,
			title: page.restricted ? null : ((feedOk ? feedOk.title : page.parsed?.title) ?? null)?.slice(0, 200) ?? null,
			contentHash: rawHash,
			normalizedHash: norm?.hash ?? null,
			publishedAt,
			excerpts,
			hostileContent: hostile,
			firstRetrievedAt: now,
			firstRunId: i.runId,
			extractorVersion: EXTRACTOR_VERSION,
			detail: page.restricted ? "The page's robots directives (noindex/noarchive/nosnippet) ask not to be indexed or quoted; it was not stored or used." : f.detail,
		});
		checks.push({ requestedUrl: page.requestedUrl, finalUrl: f.finalUrl, sourceId: id, outcome, retrievedAt: now, depth: page.depth, attempts: f.attempts });
		if (f.outcome === "ok") pagesRead++;
		const pageCriteria = extracted.map((c) => ({ ...c, id: criterionId(firm.id, id, c), workspaceId, firmId: firm.id, sourceId: id, sourceClass, capturedAt: now, runId: i.runId, extractorVersion: EXTRACTOR_VERSION, method: "rules/1" as const }));
		fresh.push(...pageCriteria);
		for (const c of candidates) eventCands.push({ cand: c, sourceId: id, url: f.finalUrl });

		const stateBase = { id: `ss_${sha256Hex(`${firm.id}|${urlKey}`).slice(0, 32)}`, workspaceId, firmId: firm.id, url: urlKey, pageKind: page.kind };
		if (readable && norm) {
			readUrls.add(urlKey);
			if (prior?.lastSuccessSourceId) reReadSourceIds.add(prior.lastSuccessSourceId);
			const claimKeys = [...new Set(pageCriteria.map((c) => `${c.field}|${c.polarity}|${c.value}|${c.assertionType}`))].sort();
			const blockHashes = norm.blocks.map((b) => sha256Hex(b).slice(0, 10)).slice(0, 400);
			if (prior?.lastNormalizedHash && prior.lastNormalizedHash !== norm.hash && !i.baseline) {
				const claimsChanged = claimKeys.join() !== prior.claimKeys.join();
				const ratio = changeRatio(prior.blockHashes, blockHashes);
				const known = new Set(prior.blockHashes);
				const fresh1 = blocks.filter((b) => !known.has(sha256Hex(normalizeBlocks([b]).blocks[0] ?? "").slice(0, 10)) && normalizeBlocks([b]).blocks.length).slice(0, 2);
				if (!claimsChanged && ratio >= MATERIAL_CHANGE_RATIO && fresh1.length && page.kind !== "feed") {
					findingDrafts.push({
						kind: "source_changed",
						severity: "informational",
						subjectKey: `source|${urlKey}|${norm.hash}`,
						subject: { field: "source", value: urlKey, polarity: null },
						summary: `${Math.round(ratio * 100)}% of the substantive content of ${urlKey} changed. No stated criterion changed. Navigation, dates and formatting are ignored.`,
						previousCriterionIds: [],
						newCriterionIds: [],
						approvalIds: [],
						evidence: fresh1.map((b) => ({ sourceId: id, url: f.finalUrl, passage: clip(b, 300), publishedAt })),
						reviewRequired: false,
					});
				}
			}
			const next: SourceState = {
				...stateBase,
				status: "present",
				firstSeenAt: prior?.firstSeenAt ?? now,
				lastCheckedAt: now,
				lastOutcome: "ok",
				consecutiveMisses: 0,
				lastSuccessAt: now,
				lastSuccessSourceId: id,
				lastNormalizedHash: norm.hash,
				claimKeys,
				entries: entries.map((e) => companyKey(e)),
				blockHashes,
				...(prior?.__version !== undefined ? { __version: prior.__version } : {}),
			};
			states.push({ state: next, create: !prior, priorVersion: prior?.__version });
			if (page.kind === "portfolio" && prior && !i.baseline) {
				const old = new Set(prior.entries);
				for (const name of entries) {
					if (old.has(companyKey(name))) continue;
					const passage = blocks.find((b) => b.startsWith(name)) ?? name;
					portfolioAdds.push({ name, passage: clip(`Listed on a portfolio page: ${passage}`, 420), sourceId: id, url: f.finalUrl, publishedAt });
				}
			}
		} else {
			if (page.restricted) restrictedUrls.add(urlKey);
			const missing = f.httpStatus === 404 || f.httpStatus === 410;
			const next: SourceState = {
				...stateBase,
				status: missing ? "missing" : "inaccessible",
				firstSeenAt: prior?.firstSeenAt ?? now,
				lastCheckedAt: now,
				lastOutcome: outcome,
				consecutiveMisses: (prior?.consecutiveMisses ?? 0) + 1,
				lastSuccessAt: prior?.lastSuccessAt ?? null,
				lastSuccessSourceId: prior?.lastSuccessSourceId ?? null,
				lastNormalizedHash: prior?.lastNormalizedHash ?? null,
				claimKeys: prior?.claimKeys ?? [],
				entries: prior?.entries ?? [],
				blockHashes: prior?.blockHashes ?? [],
				...(prior?.__version !== undefined ? { __version: prior.__version } : {}),
			};
			states.push({ state: next, create: !prior, priorVersion: prior?.__version });
			if (missing && prior?.status === "present" && !i.baseline) {
				findingDrafts.push({
					kind: "source_missing",
					severity: "informational",
					subjectKey: `source|${urlKey}|missing`,
					subject: { field: "source", value: urlKey, polarity: null },
					summary: `${urlKey} now answers HTTP ${f.httpStatus}. The last successful snapshot is kept. A missing page does not show that the policy or a past announcement was withdrawn.`,
					previousCriterionIds: [],
					newCriterionIds: [],
					approvalIds: [],
					evidence: [{ sourceId: prior.lastSuccessSourceId ?? id, url: urlKey, passage: `The page answered HTTP ${f.httpStatus} on ${now.slice(0, 10)}.`, publishedAt: null }],
					reviewRequired: false,
				});
			}
		}
	}

	// Pages not re-read this time keep their last successful claims (aging, not erased). A page that now asks not to be used is dropped.
	const carriedSourceIds = new Set<string>();
	for (const [url, st] of i.priorStates) if (!readUrls.has(url) && !restrictedUrls.has(url) && st.lastSuccessSourceId) carriedSourceIds.add(st.lastSuccessSourceId);
	const freshIds = new Set(fresh.map((c) => c.id));
	const carried = dedupeBy(i.allCriteria.filter((c) => carriedSourceIds.has(c.sourceId) && !freshIds.has(c.id)), (c) => c.id);
	const uniqueFresh = dedupeBy(fresh, (c) => c.id);

	if (!i.baseline) {
		const byId = new Map(i.allCriteria.map((c) => [c.id, c]));
		const previous = i.previousCurrentIds.map((x) => byId.get(x)).filter(Boolean) as ResearchCriterion[];
		for (const d of diffClaims({ previous, next: [...uniqueFresh, ...carried], reReadSourceIds, approvals: i.approvals })) {
			const ev = (ids: string[]) => ids.map((x) => [...uniqueFresh, ...i.allCriteria].find((c) => c.id === x)).filter(Boolean).map((c) => ({ sourceId: c!.sourceId, url: sources.find((s) => s.id === c!.sourceId)?.finalUrl ?? i.sourceUrlById.get(c!.sourceId) ?? "", passage: c!.passage, publishedAt: sources.find((s) => s.id === c!.sourceId)?.publishedAt ?? null }));
			findingDrafts.push({ kind: d.kind, severity: d.severity, subjectKey: d.subjectKey, subject: d.subject, summary: d.summary, previousCriterionIds: d.previousIds, newCriterionIds: d.newIds, approvalIds: d.approvalIds, evidence: [...ev(d.newIds), ...ev(d.previousIds)].slice(0, 6), reviewRequired: d.severity === "material" });
		}
	}

	// Events: dedupe against known events, add corroboration, never merge similar names.
	const events: InvestmentEvent[] = [];
	const evidence: EventEvidence[] = [];
	const corroborations: RunPlan["corroborations"] = [];
	const known = [...i.existingEvents];
	const seenEvidence = new Set(i.existingEvidenceIds);
	const addEvidence = (eventId: string, evidenceId: string, c: { sourceId: string; url: string; passage: string; passageHash: string; publishedAt: string | null; announcedAt: string | null; type: EventType; round: string | null; roundAmountUsd: number | null; firmAmountUsd: number | null }) => {
		seenEvidence.add(evidenceId);
		evidence.push({ id: evidenceId, workspaceId, firmId: firm.id, eventId, sourceId: c.sourceId, url: c.url, passage: c.passage, passageHash: c.passageHash, publishedAt: c.publishedAt, announcedAt: c.announcedAt, type: c.type, round: c.round, roundAmountUsd: c.roundAmountUsd, firmAmountUsd: c.firmAmountUsd, runId: i.runId, discoveredAt: now });
	};
	const handle = (cand: EventCandidate, sourceId: string, url: string, forceType?: "portfolio_addition") => {
		const evidenceId = `evd_${sha256Hex([firm.id, sourceId, cand.passageHash, cand.companyKey].join("|")).slice(0, 32)}`;
		if (seenEvidence.has(evidenceId)) return;
		const match = matchEvent(cand, known);
		if (match.kind === "same") {
			addEvidence(match.event.id, evidenceId, { sourceId, url, passage: cand.passage, passageHash: cand.passageHash, publishedAt: cand.publishedAt, announcedAt: cand.announcedAt, type: cand.type, round: cand.round, roundAmountUsd: cand.roundAmountUsd, firmAmountUsd: cand.firmAmountUsd });
			corroborations.push({ eventId: match.event.id, evidenceId });
			return;
		}
		const effective = cand.announcedAt ?? cand.publishedAt;
		const cls = forceType ? "undated" : classifyEvent(effective, now, i.lookbackDays);
		if (cls === "out_of_window") return;
		const event: InvestmentEvent = {
			id: `ev_${sha256Hex(`${firm.id}|${evidenceId}`).slice(0, 32)}`,
			workspaceId,
			firmId: firm.id,
			type: forceType ?? cand.type,
			companyName: cand.companyName,
			companyKey: cand.companyKey,
			companyUrl: cand.companyUrl,
			companyMatch: match.kind === "uncertain" ? { status: "uncertain", candidateEventIds: match.candidates.map((c) => c.id) } : { status: "unique", candidateEventIds: [] },
			round: cand.round,
			roundAmountUsd: cand.roundAmountUsd,
			firmAmountUsd: cand.firmAmountUsd,
			amountSourceStated: cand.roundAmountUsd !== null || cand.firmAmountUsd !== null,
			involvement: forceType ? "implied_by_source" : cand.involvement,
			announcedAt: cand.announcedAt,
			earliestPublishedAt: cand.publishedAt,
			discoveredAt: now,
			discoveryRunId: i.runId,
			classification: cls,
			extractorVersion: EXTRACTOR_VERSION,
			baseline: i.baseline,
		};
		events.push(event);
		known.push(event);
		addEvidence(event.id, evidenceId, { sourceId, url, passage: cand.passage, passageHash: cand.passageHash, publishedAt: cand.publishedAt, announcedAt: cand.announcedAt, type: cand.type, round: cand.round, roundAmountUsd: cand.roundAmountUsd, firmAmountUsd: cand.firmAmountUsd });
	};
	for (const { cand, sourceId, url } of eventCands) handle(cand, sourceId, url);
	for (const p of portfolioAdds) {
		const passageHash = sha256Hex(p.passage);
		handle({ type: "other", companyName: p.name, companyKey: companyKey(p.name), companyUrl: null, round: null, roundAmountUsd: null, firmAmountUsd: null, involvement: "implied_by_source", announcedAt: null, publishedAt: p.publishedAt, passage: p.passage, passageHash }, p.sourceId, p.url, "portfolio_addition");
	}

	// Findings: versioned per subject, idempotent by signature.
	const latest = new Map<string, ResearchFinding>();
	for (const f of i.existingFindings) if (!latest.has(f.subjectKey) || latest.get(f.subjectKey)!.version < f.version) latest.set(f.subjectKey, f);
	const findings: ResearchFinding[] = [];
	for (const d of findingDrafts) {
		const signature = sha256Hex([d.kind, [...d.previousCriterionIds].sort().join(), [...d.newCriterionIds].sort().join(), [...d.approvalIds].sort().join()].join("|"));
		const id = `fd_${sha256Hex(`${firm.id}|${d.subjectKey}|${signature}`).slice(0, 32)}`;
		const existing = latest.get(d.subjectKey);
		if (i.existingFindings.some((f) => f.id === id) || findings.some((f) => f.id === id)) continue;
		findings.push({ ...d, id, workspaceId, firmId: firm.id, version: (existing?.version ?? 0) + 1, supersedesId: existing?.id ?? null, runId: i.runId, priorRunId: null, discoveredAt: now, extractorVersion: EXTRACTOR_VERSION });
	}

	const homeOk = i.crawl.pages[0]?.fetch.outcome === "ok" && !i.crawl.pages[0]?.restricted;
	return { sources, checks, freshCriteria: uniqueFresh, carriedCriteria: carried, states, events, evidence, corroborations, findings, homeTitle, success: !!homeOk, pagesRead };
}
