/**
 * Investor discovery and thesis research: persisted records and read models.
 *
 * Vocabulary (kept deliberately separate; none of these implies another):
 *  - research status  — what one research run established about a firm (not a claim about the firm);
 *  - assertion type   — how a criterion relates to its source: explicit | observed | inferred;
 *  - source class     — who published the source;
 *  - verification     — whether a captured passage supports the extracted statement (Jev, when configured);
 *  - freshness        — how old the capture is;
 *  - review state     — what a human did (flag, dispute, correct, approve). Approval is a separate record.
 * Research findings are never investor-approved theses. Types only; no runtime imports.
 */

export const RESEARCH_STATUSES = ["pending", "thesis_found", "no_thesis_found", "research_incomplete"] as const;
export type ResearchStatus = (typeof RESEARCH_STATUSES)[number];

export const CRITERION_FIELDS = ["stage", "sector", "geography", "check_size", "business_model", "company_characteristics", "exclusion", "traction", "application_requirements"] as const;
export type CriterionField = (typeof CRITERION_FIELDS)[number];

export type AssertionType = "explicit" | "observed" | "inferred";
export type SourceClass = "official_website" | "official_publication" | "third_party" | "other";
export type PageKind = "thesis" | "criteria" | "portfolio" | "announcement" | "faq" | "team" | "home" | "feed" | "other";

/** What happened when a page was requested. */
export type FetchOutcome =
	| "ok"
	| "http_error"
	| "blocked_robots"
	| "blocked_network_policy"
	| "redirect_off_domain"
	| "redirect_limit"
	| "unsupported_content"
	| "too_large"
	| "timeout"
	| "network_error"
	| "auth_required";

export type ResearchLimits = {
	maxPages: number;
	maxDepth: number;
	timeoutMs: number;
	retries: number;
	perDomainDelayMs: number;
	maxBytes: number;
	maxRedirects: number;
};

/** Immutable once written: keyed by firm + requested URL + content hash (or outcome, when nothing was captured). */
export type ResearchSource = {
	id: string;
	workspaceId: string;
	firmId: string;
	requestedUrl: string;
	finalUrl: string;
	sourceClass: SourceClass;
	pageKind: PageKind;
	outcome: FetchOutcome;
	httpStatus: number | null;
	contentType: string | null;
	title: string | null;
	contentHash: string | null;
	/** Hash of the content after navigation, boilerplate, dates and formatting are removed. Identity of the source version. */
	normalizedHash: string | null;
	/** Publication date declared by the page or feed (metadata), if any. Not the discovery date. */
	publishedAt: string | null;
	/** Only the passages relevant to research, never the page. */
	excerpts: string[];
	/** The page contained text that tries to instruct a reader; those sentences were not used. */
	hostileContent: boolean;
	firstRetrievedAt: string;
	firstRunId: string;
	extractorVersion: string;
	detail: string | null;
};

export type SourceCheck = {
	requestedUrl: string;
	finalUrl: string;
	sourceId: string;
	outcome: FetchOutcome;
	retrievedAt: string;
	depth: number;
	attempts: number;
};

export type ResearchRun = {
	id: string;
	workspaceId: string;
	firmId: string;
	status: "running" | "completed" | "failed";
	startedAt: string;
	completedAt: string | null;
	startedBy: string;
	pipelineVersion: string;
	extractorVersion: string;
	limits: ResearchLimits;
	outcome: ResearchStatus | null;
	/** The homepage was read: this run counts as a successful check for monitoring and "last successful research". */
	success: boolean;
	/** Criteria kept from earlier runs because their page could not be re-read this time. */
	carriedCriterionIds: string[];
	/** Monitoring: this was the firm's first completed run, so everything found is baseline, not news. */
	baseline: boolean;
	/** Why the outcome is what it is, in this run's own terms. */
	outcomeReasons: string[];
	checks: SourceCheck[];
	criterionIds: string[];
	counts: { pagesAttempted: number; pagesOk: number; pagesFailed: number; pagesBlocked: number; newSources: number; newCriteria: number };
	error: { message: string; retryable: boolean } | null;
	__version?: number;
};

export type ExtractionMethod = "rules/1";

/** Immutable. A changed source or extraction produces new records; "current" is the latest completed run's set. */
export type ResearchCriterion = {
	id: string;
	workspaceId: string;
	firmId: string;
	field: CriterionField;
	/** include: the firm says it invests here; exclude: the firm says it does not. */
	polarity: "include" | "exclude";
	/** Normalised value: a controlled term, or `{min,max}` USD for check_size. */
	value: string;
	valueRange: { minUsd: number | null; maxUsd: number | null } | null;
	label: string;
	assertionType: AssertionType;
	sourceId: string;
	sourceClass: SourceClass;
	passage: string;
	passageHash: string;
	capturedAt: string;
	runId: string;
	extractorVersion: string;
	method: ExtractionMethod;
	/** Uncertainty of the extraction method itself (rule coverage), never source verification. Null when the method has none. */
	extractionNote: string | null;
	/** For inferred criteria: the observations the pattern was derived from. */
	basis: { observations: number; of: number } | null;
};

export type VerificationStatus = "pending" | "source_supports" | "source_does_not_support" | "inconclusive" | "verification_error";

/** Immutable verification attempts; the latest conclusive one is shown. Pending is the absence of any record. */
export type CriterionVerification = {
	id: string;
	workspaceId: string;
	firmId: string;
	/** Exactly one of criterionId / eventId is set. */
	criterionId: string | null;
	eventId: string | null;
	status: Exclude<VerificationStatus, "pending">;
	passageHash: string;
	statement: string;
	jev: { provider: string | null; model: string | null; adapterVersion: string } | null;
	selectedId: string | null;
	rationale: string | null;
	error: string | null;
	createdAt: string;
	createdBy: string;
};

export type ReviewAction = "flag" | "dispute" | "correct" | "note" | "confirm" | "dismiss";

/** Immutable. A correction records what the reviewer says; it is never silently turned into an approved criterion. */
export type ResearchReview = {
	id: string;
	workspaceId: string;
	firmId: string;
	criterionId: string | null;
	eventId: string | null;
	findingId: string | null;
	/** VC-4 subjects: a reconciled third-party claim, a source record, or a contribution. Absent on older records. */
	claimId?: string | null;
	contributionId?: string | null;
	action: ReviewAction;
	note: string;
	correctedValue: string | null;
	createdAt: string;
	createdBy: string;
};

/** Investor-verified criteria. Append-only events; the current set is a fold. Never written by the pipeline. */
export type FirmApproval = {
	id: string;
	workspaceId: string;
	firmId: string;
	kind: "approve" | "withdraw";
	field: CriterionField;
	polarity: "include" | "exclude";
	value: string;
	valueRange: { minUsd: number | null; maxUsd: number | null } | null;
	/** The research criterion this approval was based on, if any. */
	basisCriterionId: string | null;
	/** For withdraw: the approval it withdraws. */
	withdrawsId: string | null;
	/** workspace (default, VC-2): adopted by this workspace. firm_representative (VC-4): approved by a verified representative of the firm itself. */
	authority?: "workspace" | "firm_representative";
	representativeClaimId?: string | null;
	note: string;
	createdAt: string;
	createdBy: string;
};

export type InvestorFirm = {
	id: string;
	workspaceId: string;
	/** Canonical identity: the normalised registrable-style host (lowercase, no www). */
	canonicalDomain: string;
	name: string;
	nameSource: "input" | "page_title" | "domain";
	website: string;
	aliasUrls: string[];
	sourceNotes: string[];
	/** Other names this firm is known by, from reviewer-confirmed matches. Absent on older records. */
	aliases?: string[];
	/** Identifiers the firm has in curated sources (VC-4). */
	externalIds?: { sourceId: string; id: string }[];
	researchStatus: ResearchStatus;
	lastRunId: string | null;
	lastRunStartedAt: string | null;
	/** When the latest run finished, successful or not. */
	lastResearchedAt: string | null;
	/** When the homepage was last read successfully. Independent of the most recent attempt. */
	lastSuccessAt: string | null;
	/** The criteria of the latest completed run, plus any carried forward from pages that could not be re-read. */
	currentCriterionIds: string[];
	conflictCount: number;
	sourcesChecked: number;
	stubReasons: string[];
	/** A later run may succeed where this one did not (timeouts, network and server errors); false for robots or access blocks. */
	retryable: boolean;
	lastError: { message: string; retryable: boolean; at: string } | null;
	createdAt: string;
	createdBy: string;
	updatedAt: string;
	__version?: number;
};

// --------------------------------------------------------------------------- read models

export type Freshness = "fresh" | "stale";

export type CriterionView = ResearchCriterion & {
	verification: VerificationStatus;
	verificationDetail: CriterionVerification | null;
	freshness: Freshness;
	/** Portfolio-derived patterns cannot be verified from one passage. */
	verificationApplicable: boolean;
	/** Kept from an earlier run because its page could not be re-read; ages until the page is read again. */
	carriedForward: boolean;
	lastConfirmedAt: string;
	current: boolean;
	reviews: ResearchReview[];
	source: Pick<ResearchSource, "id" | "requestedUrl" | "finalUrl" | "title" | "pageKind" | "firstRetrievedAt"> | null;
};

export type ConflictKind = "include_vs_exclude" | "check_size_differs" | "differs_from_approved" | "exclusion_of_approved";
export type Conflict = { kind: ConflictKind; field: CriterionField; value: string; criterionIds: string[]; approvalIds: string[]; message: string };

export type FirmListItem = Pick<
	InvestorFirm,
	"id" | "name" | "website" | "canonicalDomain" | "researchStatus" | "lastResearchedAt" | "lastSuccessAt" | "conflictCount" | "sourcesChecked" | "stubReasons"
> & { criteriaCount: number; explicitCount: number; stale: boolean; stub: boolean; retryable: boolean; monitoring: MonitoringSummary | null };

export type FirmProfile = {
	firm: InvestorFirm;
	stub: boolean;
	stubStatement: string | null;
	criteria: CriterionView[];
	/** Criteria from earlier runs that the latest run did not produce. */
	history: CriterionView[];
	conflicts: Conflict[];
	approvals: FirmApproval[];
	approvedCurrent: FirmApproval[];
	sources: ResearchSource[];
	runs: ResearchRun[];
	reviews: ResearchReview[];
	staleAfterDays: number;
	stale: boolean;
	monitoring: MonitoringTarget | null;
	events: InvestmentEventView[];
	findings: ResearchFinding[];
	health: ResearchHealth;
	disclaimer: string;
};

export const RESEARCH_DISCLAIMER =
	"Published material may not fully or currently represent the firm's strategy. These are public-source research findings, not an investor-approved thesis.";

// --------------------------------------------------------------------------- monitoring (VC-3)

export type MonitoringTarget = {
	/** Equal to the firm id (kind "firm") or the curated source id (kind "source"): one target per subject. */
	id: string;
	/** Absent on VC-3 records, meaning "firm". For a source target, `firmId` holds the source id and `canonicalDomain` its host. */
	kind?: "firm" | "source";
	workspaceId: string;
	firmId: string;
	canonicalDomain: string;
	website: string;
	enabled: boolean;
	intervalMinutes: number;
	/** Optional per-firm crawl bounds, never above the configured ceilings. */
	limits: { maxPages: number | null; maxDepth: number | null };
	nextCheckAt: string | null;
	lastAttemptAt: string | null;
	lastSuccessAt: string | null;
	lastRunId: string | null;
	consecutiveFailures: number;
	lastError: { message: string; retryable: boolean; at: string } | null;
	/** Held by one worker at a time. Fencing: only the holder of `token` may complete the check. */
	lease: { ownerId: string; token: string; acquiredAt: string; expiresAt: string } | null;
	pausedAt: string | null;
	pausedBy: string | null;
	createdAt: string;
	createdBy: string;
	updatedAt: string;
	__version?: number;
};

export type MonitoringSummary = Pick<MonitoringTarget, "enabled" | "intervalMinutes" | "nextCheckAt" | "lastAttemptAt" | "lastSuccessAt" | "consecutiveFailures"> & { running: boolean };

/** A check is "overdue" once it is this much later than it was scheduled (never less than 10 minutes, so a normal tick and run never trip it). */
export const overdueGraceMs = (intervalMinutes: number): number => Math.max(10 * 60_000, Math.round(intervalMinutes * 60_000 * 0.25));
export const FAILING_AFTER = 3;

export type MonitoringHealth = {
	enabled: number;
	overdue: number;
	failing: number;
	oldestOverdueMinutes: number | null;
	/**
	 * True when at least one enabled target is well past its scheduled time and nothing is checking it. Every check, successful or
	 * not, reschedules its target (failures back off), so an overdue target means nobody ran it: no scheduler, or a stalled one. It cannot
	 * distinguish "never started" from "stopped", and says nothing when there are no targets.
	 */
	schedulerLikelyMissing: boolean;
};

/** Pure: the alert-worthy facts about monitoring, from the schedule alone. */
export function monitoringHealth(targets: Pick<MonitoringSummary, "enabled" | "intervalMinutes" | "nextCheckAt" | "consecutiveFailures" | "running">[], now: Date): MonitoringHealth {
	let enabled = 0;
	let overdue = 0;
	let failing = 0;
	let oldest: number | null = null;
	for (const t of targets) {
		if (!t.enabled) continue;
		enabled++;
		if (t.consecutiveFailures >= FAILING_AFTER) failing++;
		const due = t.nextCheckAt ? Date.parse(t.nextCheckAt) : Number.NaN;
		if (t.running || !Number.isFinite(due)) continue;
		const late = now.getTime() - due;
		if (late > overdueGraceMs(t.intervalMinutes)) {
			overdue++;
			oldest = Math.max(oldest ?? 0, Math.round(late / 60_000));
		}
	}
	return { enabled, overdue, failing, oldestOverdueMinutes: oldest, schedulerLikelyMissing: overdue > 0 };
}

/** Current state of one source URL: what was last read successfully, independent of later failures. */
export type SourceState = {
	id: string;
	workspaceId: string;
	firmId: string;
	url: string;
	status: "present" | "missing" | "inaccessible";
	pageKind: PageKind;
	firstSeenAt: string;
	lastCheckedAt: string;
	lastOutcome: FetchOutcome;
	consecutiveMisses: number;
	/** Preserved when later checks fail. */
	lastSuccessAt: string | null;
	lastSuccessSourceId: string | null;
	lastNormalizedHash: string | null;
	/** Claim keys extracted from the last successful snapshot (field|polarity|value|assertion). */
	claimKeys: string[];
	/** Company names listed on a portfolio page at the last successful snapshot. */
	entries: string[];
	/** Short hashes of the normalised content blocks at the last successful snapshot (content itself is not kept). */
	blockHashes: string[];
	__version?: number;
};

export type EventType = "new_investment" | "seed_round" | "venture_round" | "follow_on" | "acquisition" | "portfolio_addition" | "other";
export type EventClassification = "new" | "historical" | "undated";
export type EventReviewState = "unreviewed" | "needs_review" | "confirmed" | "dismissed" | "disputed";

export type InvestmentEvent = {
	id: string;
	workspaceId: string;
	firmId: string;
	type: EventType;
	companyName: string;
	companyKey: string;
	/** Link text from the firm's own page. Recorded, never fetched. */
	companyUrl: string | null;
	/** unique: no similar company known; uncertain: a similarly named company already has an event (not merged). */
	companyMatch: { status: "unique" | "uncertain"; candidateEventIds: string[] };
	round: string | null;
	/** Only ever the amount of a *round*, taken verbatim from a source. A firm's own cheque is never inferred from it. */
	roundAmountUsd: number | null;
	firmAmountUsd: number | null;
	amountSourceStated: boolean;
	/** "stated": the passage says the firm took part. "implied_by_source": the firm's own post announces the round. */
	involvement: "stated" | "implied_by_source";
	/** The announcement date written in the passage, if any. */
	announcedAt: string | null;
	earliestPublishedAt: string | null;
	discoveredAt: string;
	discoveryRunId: string;
	classification: EventClassification;
	extractorVersion: string;
	/** Newly discovered by a non-baseline run. Baseline events are context, not news. */
	baseline: boolean;
};

export type EventEvidence = {
	id: string;
	workspaceId: string;
	firmId: string;
	eventId: string;
	sourceId: string;
	url: string;
	passage: string;
	passageHash: string;
	publishedAt: string | null;
	/** The announcement date written in this passage, if any. */
	announcedAt: string | null;
	/** What this passage itself states. The event view fills gaps from here; the event record stays immutable. */
	type: EventType;
	round: string | null;
	roundAmountUsd: number | null;
	firmAmountUsd: number | null;
	runId: string;
	discoveredAt: string;
	/** VC-4: where this evidence came from. Absent means the firm's own crawl. */
	category?: "official_public_source" | "third_party_source";
	publisher?: string;
};

export type InvestmentEventView = InvestmentEvent & {
	evidence: EventEvidence[];
	reviewState: EventReviewState;
	reviews: ResearchReview[];
	verification: VerificationStatus;
	verificationDetail: CriterionVerification | null;
	/** Independent evidence from more than one source. */
	corroborated: boolean;
};

export type FindingKind = "thesis_addition" | "thesis_modification" | "thesis_contradiction" | "thesis_retraction" | "thesis_conflict" | "inferred_pattern" | "source_changed" | "source_missing";

/** Immutable, versioned per subject: a later change to the same subject is version n+1, never an edit. */
export type ResearchFinding = {
	id: string;
	workspaceId: string;
	firmId: string;
	kind: FindingKind;
	severity: "material" | "informational";
	/** Stable identity of what the finding is about (field/value/polarity or a source URL). */
	subjectKey: string;
	subject: { field: CriterionField | "source"; value: string; polarity: "include" | "exclude" | null };
	version: number;
	supersedesId: string | null;
	summary: string;
	previousCriterionIds: string[];
	newCriterionIds: string[];
	/** Approved values this touches. The finding never changes them. */
	approvalIds: string[];
	evidence: { sourceId: string; url: string; passage: string; publishedAt: string | null }[];
	runId: string;
	priorRunId: string | null;
	discoveredAt: string;
	reviewRequired: boolean;
	extractorVersion: string;
	reviewState?: EventReviewState;
	reviews?: ResearchReview[];
	verification?: VerificationStatus;
};

export type ResearchHealth = {
	lastAttemptAt: string | null;
	lastSuccessAt: string | null;
	consecutiveFailures: number;
	failing: boolean;
	stale: boolean;
	staleSources: { url: string; lastSuccessAt: string | null; status: SourceState["status"] }[];
	inaccessibleSources: number;
	missingSources: number;
};

export type TimelineItemType = "investment_event" | "portfolio_addition" | "source_discovered" | "source_changed" | "source_missing" | "thesis_finding" | "conflict" | "research_failed" | "review";

export type TimelineItem = {
	id: string;
	type: TimelineItemType;
	/** What the item is about, in plain words. */
	title: string;
	detail: string;
	/** Dates are never merged: when the source says it happened, when we found it, when a person reviewed it. */
	publishedAt: string | null;
	announcedAt: string | null;
	discoveredAt: string;
	reviewedAt: string | null;
	reviewState: EventReviewState | "not_applicable";
	/** investor activity vs research health: failures are never presented as activity. */
	category: "investment_activity" | "strategy" | "source" | "health" | "review";
	baseline: boolean;
	evidence: { sourceId: string | null; url: string; passage: string | null }[];
	refs: { eventId?: string; findingId?: string; runId?: string; criterionId?: string; sourceId?: string };
};

export type AttentionItem = { firmId: string; firmName: string; kind: "new_investment" | "strategy_change" | "needs_review" | "research_failing" | "research_stale"; title: string; at: string; refId: string };
