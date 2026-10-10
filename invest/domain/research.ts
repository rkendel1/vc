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
export type PageKind = "thesis" | "criteria" | "portfolio" | "announcement" | "faq" | "team" | "home" | "other";

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
	criterionId: string;
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

export type ReviewAction = "flag" | "dispute" | "correct" | "note";

/** Immutable. A correction records what the reviewer says; it is never silently turned into an approved criterion. */
export type ResearchReview = {
	id: string;
	workspaceId: string;
	firmId: string;
	criterionId: string | null;
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
	researchStatus: ResearchStatus;
	lastRunId: string | null;
	lastRunStartedAt: string | null;
	lastResearchedAt: string | null;
	/** The criteria of the latest completed run. */
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
	lastConfirmedAt: string;
	current: boolean;
	reviews: ResearchReview[];
	source: Pick<ResearchSource, "id" | "requestedUrl" | "finalUrl" | "title" | "pageKind" | "firstRetrievedAt"> | null;
};

export type ConflictKind = "include_vs_exclude" | "check_size_differs" | "differs_from_approved" | "exclusion_of_approved";
export type Conflict = { kind: ConflictKind; field: CriterionField; value: string; criterionIds: string[]; approvalIds: string[]; message: string };

export type FirmListItem = Pick<
	InvestorFirm,
	"id" | "name" | "website" | "canonicalDomain" | "researchStatus" | "lastResearchedAt" | "conflictCount" | "sourcesChecked" | "stubReasons"
> & { criteriaCount: number; explicitCount: number; stale: boolean; stub: boolean; retryable: boolean };

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
	disclaimer: string;
};

export const RESEARCH_DISCLAIMER =
	"Published material may not fully or currently represent the firm's strategy. These are public-source research findings, not an investor-approved thesis.";
