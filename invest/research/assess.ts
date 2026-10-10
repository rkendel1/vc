import type { CrawlResult } from "./crawler.ts";
import { BLOCKED_OUTCOMES, FAILED_OUTCOMES } from "./crawler.ts";
import type { ResearchStatus } from "../domain/research.ts";

/**
 * Turns what a run established into a research status. Pure, so tests and `verify` can recompute it.
 *
 *  thesis_found        at least one explicit, sourced criterion
 *  no_thesis_found     coverage was adequate and nothing explicit was found (observed/inferred signals may exist)
 *  research_incomplete the homepage or a relevant page could not be read, the budget ran out with relevant
 *                      pages unvisited, or the site yielded too little readable text to conclude anything
 *
 * "No thesis found" describes this run's reach only. It never means the firm has no thesis.
 */
export const MIN_HOME_CHARS = 300;
const RELEVANT_KINDS: ReadonlySet<string> = new Set(["thesis", "criteria", "faq", "portfolio"]);

export type Assessment = { status: ResearchStatus; reasons: string[] };

export function assessCoverage(crawl: CrawlResult, counts: { explicit: number; observedOrInferred: number }): Assessment {
	const reasons: string[] = [];
	const problems: string[] = [];
	const home = crawl.pages[0];
	if (!home) problems.push("no page was fetched");
	else if (home.fetch.outcome !== "ok") problems.push(`the homepage could not be read (${home.fetch.outcome}${home.fetch.detail ? `: ${home.fetch.detail}` : ""})`);
	else if (home.restricted) problems.push("the homepage asks not to be indexed or quoted, so it was not used");
	else {
		const text = (home.parsed?.blocks ?? []).join(" ");
		if (text.length < MIN_HOME_CHARS && crawl.pages.length < 3) problems.push("the homepage has almost no server-rendered text; the site may need JavaScript or may be unreadable to this crawler");
	}
	for (const page of crawl.pages.slice(1)) {
		if (RELEVANT_KINDS.has(page.kind) && page.fetch.outcome !== "ok") {
			const how = BLOCKED_OUTCOMES.has(page.fetch.outcome) ? "was blocked" : FAILED_OUTCOMES.has(page.fetch.outcome) ? "failed" : "was not read";
			problems.push(`a page that looks relevant (${page.requestedUrl}) ${how}: ${page.fetch.outcome}`);
		}
	}
	if (crawl.unvisitedRelevant.length) problems.push(`${crawl.unvisitedRelevant.length} relevant-looking page(s) were not visited because a crawl limit was reached`);

	const ok = crawl.pages.filter((p) => p.fetch.outcome === "ok").length;
	reasons.push(`${ok} of ${crawl.pages.length} page(s) read`);
	if (counts.explicit > 0) {
		reasons.push(`${counts.explicit} explicit criterion statement(s) found in public sources`);
		for (const p of problems) reasons.push(`coverage warning: ${p}`);
		return { status: "thesis_found", reasons };
	}
	if (problems.length) return { status: "research_incomplete", reasons: [...reasons, ...problems] };
	reasons.push("no explicit investment criteria were found in the pages this run could read");
	if (counts.observedOrInferred) reasons.push(`${counts.observedOrInferred} observed or portfolio-derived signal(s) exist but are not declared criteria`);
	return { status: "no_thesis_found", reasons };
}
