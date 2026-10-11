import type { CriterionField, EventType, FetchOutcome, ResearchStatus } from "./research.ts";

/**
 * VC-4: collaborative investor intelligence. Types only.
 *
 * Four dimensions stay separate on every claim, and none implies another:
 *   category   — where it came from (who published or submitted it);
 *   assertion  — explicit | observed | inferred (how the source relates to the claim);
 *   verification — whether a passage supports the statement (Jev, when configured);
 *   freshness  — how old the capture is.
 * A review state (proposed … accepted) records what a person decided. Accepting evidence never makes
 * it investor-verified: only a verified firm representative's approval does.
 */
export type SourceCategory = "investor_verified" | "official_public_source" | "third_party_source" | "founder_contribution" | "community_contribution";
export const SOURCE_CATEGORIES: readonly SourceCategory[] = ["investor_verified", "official_public_source", "third_party_source", "founder_contribution", "community_contribution"];

/** Lifecycle shown to users. `proposed`/`accepted`/`rejected` are the existing review states under their lifecycle names. */
export type LifecycleState = "proposed" | "needs_review" | "accepted" | "rejected" | "disputed" | "superseded";

// --------------------------------------------------------------------------- curated sources

export type AdapterId = "funding_news_feed" | "csv_dataset" | "json_dataset";
export const ADAPTER_IDS: readonly AdapterId[] = ["funding_news_feed", "csv_dataset", "json_dataset"];
export type SourceType = "directory" | "curated_list" | "funding_news" | "portfolio_aggregator" | "dataset";
/** Why automated retrieval of this source is allowed. The registering person attests to it; there is no "unknown". */
export type AccessBasis = "published_terms_permit" | "public_feed" | "licensed_dataset" | "owner_permission";
export const ACCESS_BASES: readonly AccessBasis[] = ["published_terms_permit", "public_feed", "licensed_dataset", "owner_permission"];

/** Declarative mapping for tabular datasets: which column or JSON key holds what. No code, no expressions. */
export type DatasetMapping = {
	/** JSON only: dotted path to the array of records; empty means the document itself is the array. */
	recordsPath?: string;
	idField?: string;
	nameField: string;
	websiteField?: string;
	stageField?: string;
	sectorsField?: string;
	geographyField?: string;
	checkMinField?: string;
	checkMaxField?: string;
	updatedField?: string;
	/** Separator inside multi-value cells. */
	listDelimiter?: string;
	/** Unit of check-size cells. */
	checkUnit?: "usd" | "thousands" | "millions";
	/** What each record is: an investor/fund (default) or a portfolio company of the investor named in `investorField`. */
	recordKind?: "investor" | "portfolio_company";
	investorField?: string;
};

export type CuratedSource = {
	id: string;
	workspaceId: string;
	name: string;
	canonicalUrl: string;
	publisher: string;
	sourceType: SourceType;
	adapter: AdapterId;
	/** Hosts the fetcher may contact for this source: the URL's own host and any explicitly listed download host. */
	allowedHosts: string[];
	accessBasis: AccessBasis;
	/** What the terms say and where, in the registrant's words. Required. */
	termsNote: string;
	limitations: string;
	mapping: DatasetMapping | null;
	createdAt: string;
	createdBy: string;
	updatedAt: string;
	__version?: number;
};

export type SourceRunStatus = "running" | "completed" | "failed";
export type RecordError = { index: number; message: string };

/** Same lifecycle as a research run: visible while running, completed or failed, never silently absent. */
export type SourceRun = {
	id: string;
	workspaceId: string;
	sourceId: string;
	status: SourceRunStatus;
	startedAt: string;
	completedAt: string | null;
	startedBy: string;
	adapter: AdapterId;
	adapterVersion: string;
	fetchOutcome: FetchOutcome | null;
	snapshotId: string | null;
	/** unchanged: the normalised content equals the last snapshot, nothing was reprocessed. */
	change: "new" | "changed" | "unchanged" | null;
	success: boolean;
	counts: { records: number; newRecords: number; changedRecords: number; matched: number; candidates: number; unmatched: number; claims: number; events: number; errors: number };
	errors: RecordError[];
	error: { message: string; retryable: boolean } | null;
	baseline: boolean;
	__version?: number;
};

export type SourceSnapshot = {
	id: string;
	workspaceId: string;
	sourceId: string;
	url: string;
	contentType: string | null;
	contentHash: string;
	normalizedHash: string;
	bytes: number;
	recordCount: number;
	firstRetrievedAt: string;
	firstRunId: string;
};

// --------------------------------------------------------------------------- adapter contract

export type NormalizedCriterion = { field: CriterionField; polarity: "include" | "exclude"; value: string; valueRange: { minUsd: number | null; maxUsd: number | null } | null; label: string };

export type NormalizedAnnouncement = {
	company: string;
	companyUrl: string | null;
	type: EventType;
	round: string | null;
	roundAmountUsd: number | null;
	announcedAt: string | null;
	investors: { name: string; role: "lead" | "participant" | "unspecified" }[];
};

/** What every adapter produces. Original identity (external id, URL, passage) is carried, never dropped. */
export type NormalizedRecord = {
	kind: "investor" | "portfolio_company" | "investment_announcement";
	externalId: string | null;
	/** Stable key for records without an external id (derived from their identifying fields). */
	contentKey: string;
	name: string;
	website: string | null;
	aliases: string[];
	criteria: NormalizedCriterion[];
	announcement: NormalizedAnnouncement | null;
	/** For portfolio_company records: the investor the source says holds it. */
	investorName: string | null;
	publishedAt: string | null;
	passage: string;
	sourceUrl: string;
	parseStatus: "ok" | "partial";
	notes: string[];
	hostile: boolean;
};

export type AdapterResult = { records: NormalizedRecord[]; errors: RecordError[]; format: string };

/** Stored, immutable per content version: a changed record is a new version that supersedes the old. */
export type SourceRecord = NormalizedRecord & {
	/** Stable identity across versions: the external id when the source has one, else the content key. */
	identity: string;
	id: string;
	workspaceId: string;
	sourceId: string;
	snapshotId: string;
	runId: string;
	recordHash: string;
	version: number;
	supersedesId: string | null;
	retrievedAt: string;
	baseline: boolean;
};

// --------------------------------------------------------------------------- entity resolution

export type EntityKind = "firm" | "fund" | "person" | "company";
export type EntityRef = { type: "firm" | "entity"; id: string };

/** Canonical entities that are not (yet) monitored firms: companies and unlinked investors. Identity only ever grows. */
export type Entity = {
	id: string;
	workspaceId: string;
	kind: EntityKind;
	canonicalName: string;
	key: string;
	domain: string | null;
	aliases: string[];
	externalIds: { sourceId: string; id: string }[];
	urls: string[];
	createdFromRecordId: string;
	createdAt: string;
	updatedAt: string;
	__version?: number;
};

export type MatchStatus = "matched" | "candidate_match" | "unmatched";
export type MatchSignal = "external_id" | "domain" | "confirmed_alias" | "exact_name" | "alias" | "similar_name" | "profile_url";

export type MatchCandidate = { ref: EntityRef; name: string; signals: MatchSignal[]; strong: boolean };

/** A resolver proposal for one source record. Immutable. A person's decision is a separate MatchDecision. */
export type EntityMatch = {
	id: string;
	workspaceId: string;
	recordId: string;
	subject: "investor" | "company";
	/** The name being resolved (an announcement can name several investors). */
	subjectName: string;
	subjectRole: "lead" | "participant" | "unspecified" | "record";
	status: MatchStatus;
	entity: EntityRef | null;
	candidates: MatchCandidate[];
	reasons: string[];
	runId: string;
	resolverVersion: string;
	resolvedAt: string;
};

export type MatchDecision = {
	id: string;
	workspaceId: string;
	matchId: string;
	/** The record's stable identity (not a version id), so the decision outlives record versions. */
	recordId: string;
	/** The name that was being resolved. A confirmed name becomes a confirmed alias; a rejected one stays rejected. */
	subjectName: string;
	decision: "confirm" | "reject";
	entity: EntityRef;
	rationale: string;
	/** Records the reviewer looked at. */
	evidenceRecordIds: string[];
	decidedBy: string;
	decidedAt: string;
};

// --------------------------------------------------------------------------- claims

/** A third-party or contributed claim about a firm, normalised so it can be reconciled with the firm's own statements. Immutable. */
export type Claim = {
	id: string;
	workspaceId: string;
	firmId: string;
	field: CriterionField;
	polarity: "include" | "exclude";
	value: string;
	valueRange: { minUsd: number | null; maxUsd: number | null } | null;
	label: string;
	category: SourceCategory;
	assertionType: "explicit" | "observed" | "inferred";
	/** Origin: a source record, a contribution, or a published profile. Exactly one is set. */
	origin: { sourceRecordId?: string; sourceId?: string; contributionId?: string; publishedProfileId?: string };
	publisher: string;
	passage: string;
	publishedAt: string | null;
	capturedAt: string;
	runId: string | null;
	matchId: string | null;
	extractorVersion: string;
};

// --------------------------------------------------------------------------- participation

export type ClaimStatus = "requested" | "verified" | "rejected" | "revoked";

/** A request to represent a firm. Signing up is not authority: only a moderator's verification makes it effective. */
export type RepresentativeClaim = {
	id: string;
	workspaceId: string;
	principalId: string;
	canonicalDomain: string;
	firmName: string;
	relationship: string;
	/** Placed at https://<domain>/.well-known/attn-invest-claim.txt to show control of the domain. Evidence, not authority. */
	challenge: string;
	requestedAt: string;
};

export type ClaimEvent = {
	id: string;
	workspaceId: string;
	claimId: string;
	kind: "requested" | "proof_checked" | "verified" | "rejected" | "revoked";
	actorId: string;
	rationale: string;
	data: { proofOk?: boolean; proofDetail?: string; evidence?: string[] } | null;
	at: string;
};

export type ContributionKind = "correction" | "firsthand_note" | "flag_outdated" | "suggest_relationship" | "interaction_note";
export const CONTRIBUTION_KINDS: readonly ContributionKind[] = ["correction", "firsthand_note", "flag_outdated", "suggest_relationship", "interaction_note"];

/** Private to the author's workspace until shared. Immutable versions: an edit is a new version. */
export type Contribution = {
	id: string;
	workspaceId: string;
	chainId: string;
	version: number;
	supersedesId: string | null;
	authorId: string;
	category: "founder_contribution" | "community_contribution";
	kind: ContributionKind;
	firmDomain: string;
	claim: { field: CriterionField; polarity: "include" | "exclude"; value: string; valueRange: { minUsd: number | null; maxUsd: number | null } | null } | null;
	/** The author's words. Untrusted text: shown, never interpreted. */
	text: string;
	evidenceUrls: string[];
	hostile: boolean;
	createdAt: string;
};

export type ShareAudience = { kind: "firm"; domain: string } | { kind: "moderator" };

/** Consent is an event, not a flag: sharing and revoking are both recorded. Aggregate use is a separate, explicit consent. */
export type ContributionShare = {
	id: string;
	workspaceId: string;
	chainId: string;
	event: "share" | "revoke";
	audience: ShareAudience;
	aggregateConsent: boolean;
	note: string;
	actorId: string;
	at: string;
};

export type PublishedCriterion = { field: CriterionField; polarity: "include" | "exclude"; value: string; valueRange: { minUsd: number | null; maxUsd: number | null } | null; label: string; approvalId: string };

/** What a verified representative chose to publish. Versioned; readable by every workspace. */
export type PublishedProfile = {
	id: string;
	workspaceId: string;
	canonicalDomain: string;
	firmName: string;
	version: number;
	supersedesId: string | null;
	criteria: PublishedCriterion[];
	withdrawn: boolean;
	note: string;
	claimId: string;
	publishedBy: string;
	publishedAt: string;
};

// --------------------------------------------------------------------------- reconciliation read model

export type ClaimSignals = {
	category: SourceCategory;
	assertionType: "explicit" | "observed" | "inferred";
	/** subject_stated: the firm or its verified representative; reported: a third party; contributed: a participant's own account. */
	directness: "subject_stated" | "reported_by_third_party" | "contributed" | "observed_activity" | "inferred_pattern";
	publishedAt: string | null;
	capturedAt: string;
	ageDays: number;
	freshness: "fresh" | "stale";
	/** Distinct publishers independently stating the same value. */
	corroboratedBy: number;
};

export type ReconciledClaim = {
	key: string;
	claimRef: { kind: "criterion" | "claim" | "contribution" | "published"; id: string };
	field: CriterionField;
	polarity: "include" | "exclude";
	value: string;
	valueRange: { minUsd: number | null; maxUsd: number | null } | null;
	label: string;
	publisher: string;
	passage: string;
	url: string | null;
	signals: ClaimSignals;
	lifecycle: LifecycleState;
	supersededBy: string | null;
	reasons: string[];
};

export type ReconciliationConflict = {
	id: string;
	kind: "include_vs_exclude" | "check_size_differs" | "values_differ" | "conflicts_with_approved";
	field: CriterionField;
	summary: string;
	claimKeys: string[];
	approvalIds: string[];
	reviewState: "unresolved" | "disputed" | "accepted" | "rejected";
	reasons: string[];
};

export type FieldReconciliation = {
	field: CriterionField;
	/** agreed: more than one independent publisher states the same; single_source; conflicted; unknown has no claims. */
	status: "agreed" | "single_source" | "conflicted";
	claims: ReconciledClaim[];
	conflicts: ReconciliationConflict[];
	approved: { id: string; authority: "workspace" | "firm_representative"; value: string }[];
	explanation: string[];
};

export type { ResearchStatus };

/** A response from the receiving side to a shared contribution. Lives in the responder's workspace; the contribution is never edited or deleted by it. */
export type ContributionResponse = {
	id: string;
	workspaceId: string;
	chainId: string;
	domain: string;
	authorWorkspaceId: string;
	action: "confirm" | "dispute" | "dismiss" | "flag" | "note";
	note: string;
	responderKind: "firm_representative" | "moderator";
	actorId: string;
	at: string;
};
