/**
 * Founder-facing records and the matching read model (VC-5). Types only; no runtime imports beyond type
 * vocabulary shared with research.
 *
 * Four dimensions stay separate everywhere: mandate fit, investment readiness, evidence quality and
 * research coverage. None is a score; none is a prediction.
 */
import type { LifecycleState } from "./collab.ts";
import type { CriterionField, Freshness } from "./research.ts";

type FreshnessState = Freshness;

// --------------------------------------------------------------------------- vocabulary

/** Controlled terms, kept equal to the research extractor's vocabulary (a test enforces it), so a profile value and an investor criterion are comparable. */
export const STARTUP_STAGES = ["pre_seed", "seed", "series_a", "series_b", "series_c_plus"] as const;
export const SECTOR_KEYS = ["fintech", "healthcare", "biotech", "climate", "enterprise_software", "artificial_intelligence", "cybersecurity", "deep_tech", "developer_tools", "consumer", "marketplaces", "crypto_web3", "education", "real_estate", "hardware", "space_defense", "gaming_media", "agriculture_food", "logistics_mobility", "insurance", "legal_govtech"] as const;
export const GEOGRAPHY_KEYS = ["united_states", "north_america", "canada", "europe", "united_kingdom", "israel", "india", "southeast_asia", "asia", "china", "latin_america", "africa", "middle_east", "global"] as const;
export const BUSINESS_MODEL_KEYS = ["b2b", "b2c", "b2b2c", "marketplace", "saas", "hardware"] as const;

// --------------------------------------------------------------------------- profile

/** What the founder says the basis for a claim is. "Independently corroborated" is never declared: it is derived from evidence. */
export const DECLARED_BASES = ["founder_assertion", "uploaded_document", "official_public_source", "third_party_source"] as const;
export type DeclaredBasis = (typeof DECLARED_BASES)[number];

export type FieldProvenance = {
	basis: DeclaredBasis;
	/** Evidence items (uploaded documents or reviewer evidence) the founder links to this claim. */
	evidenceIds: string[];
	/** A public page the founder cites. Recorded, never fetched by matching. */
	sourceUrl: string | null;
};

export type Known<T> = { state: "provided"; value: T; provenance: FieldProvenance } | { state: "unknown" } | { state: "not_applicable" };

export const PRODUCT_STATUSES = ["idea", "prototype", "mvp", "launched", "scaling"] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];
export const REVENUE_STATUSES = ["pre_revenue", "revenue_generating"] as const;
export type RevenueStatus = (typeof REVENUE_STATUSES)[number];

/** Metrics a founder may state. Each maps to a metric key the evidence extractor already recognises. */
export const PROFILE_METRICS = ["arr", "mrr", "revenue_growth_pct", "gross_margin_pct", "net_revenue_retention_pct", "customers", "runway_months", "team_size"] as const;
export type ProfileMetric = (typeof PROFILE_METRICS)[number];

export type ProfileContent = {
	description: string;
	sectors: Known<string[]>;
	businessModels: Known<string[]>;
	headquarters: Known<string>;
	targetMarkets: Known<string[]>;
	currentStage: Known<string>;
	fundraisingStage: Known<string>;
	targetRaise: Known<{ minUsd: number | null; maxUsd: number | null }>;
	revenueStatus: Known<RevenueStatus>;
	productStatus: Known<ProductStatus>;
	metrics: Partial<Record<ProfileMetric, Known<number>>>;
	/** Relevant founder experience, in the founders' own words. Displayed, never interpreted by matching. */
	team: Known<string>;
	/** Investors (website domains) the founder does not want matched. A fundraising constraint, not a claim about the investor. */
	investorExclusions: string[];
	/** Other fundraising constraints, in the founders' own words. Displayed, never interpreted. */
	constraints: string[];
};

/** Mutable head: the only record that moves. Versions are immutable. */
export type StartupProfileHead = {
	id: string;
	workspaceId: string;
	startupId: string;
	currentVersion: number;
	currentVersionId: string;
	updatedAt: string;
	__version?: number;
};

export type StartupProfileVersion = {
	id: string;
	workspaceId: string;
	startupId: string;
	version: number;
	content: ProfileContent;
	contentHash: string;
	/** Which fields changed against the previous version. */
	changed: string[];
	previousVersionId: string | null;
	note: string;
	createdAt: string;
	createdBy: string;
};

// --------------------------------------------------------------------------- investor snapshot

export type FactAuthority = "investor_approved" | "workspace_approved" | "official_stated" | "third_party" | "contributed" | "observed" | "inferred";
export type FactVerification = "approved" | "source_supports" | "source_does_not_support" | "inconclusive" | "unchecked" | "not_applicable";

/** One investor criterion as the matcher saw it. The passage is a short excerpt; the full text stays in its immutable source record. */
export type CriterionFact = {
	key: string;
	ref: { kind: "criterion" | "claim" | "contribution" | "published" | "approval"; id: string };
	field: CriterionField;
	polarity: "include" | "exclude";
	value: string;
	valueRange: { minUsd: number | null; maxUsd: number | null } | null;
	label: string;
	authority: FactAuthority;
	verification: FactVerification;
	lifecycle: LifecycleState;
	freshness: FreshnessState;
	publisher: string;
	passage: string;
	url: string | null;
	capturedAt: string;
	/** Open reconciliation conflicts this fact takes part in. */
	conflictIds: string[];
	/** Other records stating the same thing (kept so the explanation can cite every source). */
	alsoStatedBy: { ref: { kind: string; id: string }; publisher: string; authority: FactAuthority }[];
};

export type InvestorSnapshot = {
	canonicalDomain: string;
	name: string;
	source: "workspace_research" | "published_profile";
	firmId: string | null;
	publishedVersion: number | null;
	researchRunId: string | null;
	lastResearchedAt: string | null;
	researchStatus: string | null;
	stub: boolean;
	stale: boolean;
	facts: CriterionFact[];
	fieldStatus: Partial<Record<CriterionField, "agreed" | "single_source" | "conflicted">>;
	conflicts: { id: string; field: CriterionField; summary: string; state: string }[];
	/** Hash of everything above that matching reads. Equal hash, equal investor inputs. */
	snapshotHash: string;
};

// --------------------------------------------------------------------------- result

export type ConstraintField = "stage" | "sector" | "geography" | "business_model" | "check_size";
export type ConstraintStatus = "compatible" | "incompatible" | "unknown";

export type ConstraintResult = {
	field: ConstraintField;
	status: ConstraintStatus;
	/** hard: a sufficiently authoritative criterion rules the startup out. soft: apparent mismatch to confirm. */
	strength: "hard" | "soft" | null;
	startupValue: string;
	/** Why the status is what it is. */
	rationale: string;
	/** Why it is unknown, when it is. */
	unknownReason: "startup_field_missing" | "no_criterion" | "only_inferred" | "sources_conflict" | null;
	/** The criterion that decided it, with its provenance. */
	decidedBy: Pick<CriterionFact, "key" | "ref" | "label" | "polarity" | "authority" | "verification" | "lifecycle" | "freshness" | "publisher" | "passage" | "url" | "capturedAt"> | null;
	/** Every other criterion about this field, so nothing is silently ignored. */
	considered: { key: string; label: string; polarity: "include" | "exclude"; authority: FactAuthority; freshness: FreshnessState; lifecycle: LifecycleState }[];
	conflictIds: string[];
	notes: string[];
};

export const MANDATE_SUMMARIES = ["eliminated", "possible_mismatch", "compatible_on_known", "partially_assessed", "unknown"] as const;
export type MandateSummary = (typeof MANDATE_SUMMARIES)[number];

export type MandateResult = {
	summary: MandateSummary;
	statement: string;
	constraints: ConstraintResult[];
	counts: { compatible: number; incompatible: number; unknown: number; hard: number; soft: number };
	eliminatedBy: string[];
	/** The founder's own exclusion of this investor, shown but kept apart from the investor's mandate. */
	founderExcluded: boolean;
};

export type ReadinessStatus = "met" | "not_met" | "evidence_not_provided" | "not_applicable" | "not_assessable";
export type ReadinessItem = {
	id: string;
	label: string;
	/** investor_criterion: this investor's sourced criterion asks for it. general_framework: the generic checklist, never an investor requirement. */
	basis: "investor_criterion" | "general_framework";
	criterionKey: string | null;
	status: ReadinessStatus;
	detail: string;
	whatWouldHelp: string;
};
export type ReadinessResult = {
	frameworkVersion: string;
	items: ReadinessItem[];
	counts: Record<ReadinessStatus, number>;
	statement: string;
};

export type EvidenceQuality = "reviewer_verified" | "corroborated" | "conflicting" | "supplied_by_founder" | "source_cited" | "founder_assertion";
export type ClaimQuality = {
	claim: string;
	field: string;
	declaredBasis: DeclaredBasis;
	quality: EvidenceQuality;
	stale: boolean;
	evidenceIds: string[];
	detail: string;
};
export type EvidenceQualityResult = {
	claims: ClaimQuality[];
	counts: Record<EvidenceQuality, number> & { stale: number };
	statement: string;
};

export type CoverageLevel = "verified" | "partially_verified" | "unverified_reports" | "inferred" | "unknown";
export type FieldCoverage = "approved" | "stated" | "reported" | "inferred" | "unknown";
export type CoverageResult = {
	level: CoverageLevel;
	flags: ("disputed" | "stale" | "conflicted" | "stub")[];
	fields: Record<ConstraintField, FieldCoverage>;
	/** True when too little is known for the mandate result to be read as more than a partial view. */
	limitsPrecision: boolean;
	statement: string;
	researchedAt: string | null;
};

export type ActionKind = "confirm_mismatch" | "clarify_profile" | "review_criterion" | "add_evidence" | "re_evaluate";
export type MatchAction = {
	/** Deterministic: the same finding yields the same id, so a status the founder set survives re-evaluation. */
	id: string;
	kind: ActionKind;
	/** 1 is first. A rank for ordering, not a measure of anything. */
	priority: number;
	title: string;
	why: string;
	finding: { dimension: "mandate" | "readiness" | "evidence_quality" | "coverage" | "change"; ref: string };
	disclaimer: string;
};

export type MatchResult = {
	mandate: MandateResult;
	readiness: ReadinessResult;
	evidenceQuality: EvidenceQualityResult;
	coverage: CoverageResult;
	relevance: string[];
	actions: MatchAction[];
	/** What kind of statement each part of the explanation is. */
	labels: { sourcedFacts: string; founderAssertions: string; inferences: string; recommendations: string };
};

export type EvidenceRef = { id: string; documentId: string | null; provenanceClass: string; sourceType: string; verification: string; superseded: boolean; stale: boolean; createdAt: string };

export type MatchEvaluation = {
	id: string;
	workspaceId: string;
	startupId: string;
	investorKey: string;
	investorName: string;
	/** 1 for the first evaluation of this startup and investor, then counting up. Orders history independent of clocks. */
	sequence: number;
	policyVersion: string;
	frameworkVersion: string;
	evaluatedAt: string;
	evaluatedBy: string;
	inputHash: string;
	inputs: {
		profile: { versionId: string; version: number; contentHash: string };
		evidence: { setHash: string; refs: EvidenceRef[] };
		investor: Omit<InvestorSnapshot, "facts"> & { factRefs: { key: string; ref: CriterionFact["ref"]; authority: FactAuthority; lifecycle: LifecycleState; freshness: FreshnessState }[] };
	};
	previousEvaluationId: string | null;
	/** What differs from the previous evaluation of the same pair, in words. */
	changes: string[];
	result: MatchResult;
	/** No model is used by this policy. Recorded explicitly so the absence is a fact, not an omission. */
	modelUse: null;
	__version?: number;
};

export type ShortlistStatus = "considering" | "ready" | "parked" | "ruled_out";
export type ActionState = "open" | "done" | "dismissed";

/** Private to the founder's workspace. The only mutable record in the matching workflow besides the profile head. */
export type ShortlistEntry = {
	id: string;
	workspaceId: string;
	startupId: string;
	investorKey: string;
	investorName: string;
	status: ShortlistStatus;
	note: string;
	actionStates: Record<string, ActionState>;
	addedAt: string;
	addedBy: string;
	/** Removal is recorded, not deleted: the history of what a founder considered stays. */
	removedAt: string | null;
	updatedAt: string;
	__version?: number;
};
