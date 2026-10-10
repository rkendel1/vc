/**
 * Application-level domain types for Jev Investment Evaluation.
 *
 * These are not FeltDB SDK types. They are validated at the application boundary
 * (`investment-thesis.ts`, capability schemas) and persisted through `invest/store`.
 * Every persisted record carries `workspaceId`, and every read is filtered by the
 * caller's workspace, so changing an identifier never reaches another investor's data.
 */

// ---------------------------------------------------------------------------
// Actor (resolved from the authenticated AppPort session, never from input)
// ---------------------------------------------------------------------------

export type Permission =
	| "invest.read"
	| "thesis.write"
	| "thesis.approve"
	| "startup.write"
	| "document.write"
	| "evidence.write"
	| "evaluation.run"
	| "review.write"
	| "decision.record"
	| "audit.read";

export const ALL_PERMISSIONS: readonly Permission[] = [
	"invest.read",
	"thesis.write",
	"thesis.approve",
	"startup.write",
	"document.write",
	"evidence.write",
	"evaluation.run",
	"review.write",
	"decision.record",
	"audit.read",
];

export type Actor = {
	principalId: string;
	displayName: string;
	workspaceId: string;
	permissions: readonly string[];
};

// ---------------------------------------------------------------------------
// Criteria and theses
// ---------------------------------------------------------------------------

export type EvaluationMode = "semantic" | "deterministic" | "human_review";
export type MissingEvidencePolicy = "unknown" | "review_required";
export type Comparator = "gte" | "gt" | "lte" | "lt" | "eq";

/**
 * Metric keys the deterministic extractor recognises. Deterministic criteria name one.
 * Monetary values are normalised to USD units; percentages to percent (e.g. 120 for 120%).
 */
export const METRIC_KEYS = [
	"arr",
	"mrr",
	"revenue",
	"revenue_growth_pct",
	"gross_margin_pct",
	"net_revenue_retention_pct",
	"customers",
	"monthly_burn",
	"runway_months",
	"cash",
	"team_size",
	"funding_ask",
	"pre_money_valuation",
	"tam",
	"churn_pct",
] as const;
export type MetricKey = (typeof METRIC_KEYS)[number];

export type EvidenceStandard = "founder_reported_ok" | "independent_required";

/** The criterion contract from the specification, plus the fields a deterministic check needs. */
export type InvestmentCriterion = {
	id: string;
	name: string;
	requirement: string;
	evaluationMode: EvaluationMode;
	/** Relative weight, 0–100. Used only by the optional weighted summary. */
	importance: number;
	/** Evidence the investor expects: metric keys (e.g. "arr") or short topic phrases (e.g. "customer references"). */
	requiredEvidence: string[];
	threshold?: number;
	hardGate: boolean;
	missingEvidencePolicy: MissingEvidencePolicy;
	/** Plain statement of what disqualifies, shown when a hard gate fails. */
	disqualifier?: string;
	/** Deterministic criteria: which metric to compare against `threshold`, and how. */
	metric?: MetricKey;
	comparator?: Comparator;
	/** Whether a founder's own claim can meet the standard. Default: independent_required. */
	evidenceStandard?: EvidenceStandard;
};

export type ThesisSettings = {
	/** Show a weighted summary. Off by default: the report leads with evidence, not a score. */
	showWeightedSummary: boolean;
	/** Jev answers whose selected-option probability falls below this are routed to review. */
	reviewConfidenceThreshold: number;
};

export const DEFAULT_THESIS_SETTINGS: ThesisSettings = {
	showWeightedSummary: false,
	reviewConfidenceThreshold: 0.7,
};

export type ThesisDraft = {
	description: string;
	criteria: InvestmentCriterion[];
	settings: ThesisSettings;
	updatedAt: string;
	updatedBy: string;
};

export type InvestmentThesis = {
	id: string;
	workspaceId: string;
	name: string;
	status: "draft" | "active" | "archived";
	currentVersionId: string | null;
	versionCount: number;
	draft: ThesisDraft | null;
	createdAt: string;
	createdBy: string;
	updatedAt: string;
	__version?: number;
};

/** Immutable. Created once by approval; never updated. */
export type ThesisVersion = {
	id: string;
	workspaceId: string;
	thesisId: string;
	version: number;
	description: string;
	criteria: InvestmentCriterion[];
	settings: ThesisSettings;
	/** SHA-256 of the canonical criteria + settings. */
	contentHash: string;
	previousVersionId: string | null;
	createdAt: string;
	approvedBy: string;
	approvedByName: string;
	approvalNote: string;
};

// ---------------------------------------------------------------------------
// Startups and documents
// ---------------------------------------------------------------------------

export type Startup = {
	id: string;
	workspaceId: string;
	name: string;
	website: string;
	stage: string;
	sector: string;
	description: string;
	/** Free-text assertions entered from the founder's own statements. Always founder_reported. */
	founderClaims: string[];
	createdAt: string;
	createdBy: string;
	updatedAt: string;
	__version?: number;
};

/** Declared by the uploader. Provenance comes from this, never from what the document says about itself. */
export const SOURCE_TYPES = [
	"founder_deck",
	"founder_financials",
	"founder_other",
	"third_party_report",
	"customer_reference",
	"bank_statement",
	"audited_financials",
	"data_room_other",
] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export type ProvenanceClass = "founder_reported" | "independent" | "reviewer_verified";

export function provenanceOf(sourceType: SourceType): ProvenanceClass {
	return sourceType.startsWith("founder_") || sourceType === "data_room_other" ? "founder_reported" : "independent";
}

export type IngestionStatus = "processing" | "ingested" | "partial" | "failed" | "rejected";

/** Immutable once ingestion settles. A changed file is a new Document that `supersedes` the old one. */
export type DocumentRecord = {
	id: string;
	workspaceId: string;
	startupId: string;
	filename: string;
	mediaType: string;
	sizeBytes: number;
	contentHash: string;
	storageRef: string | null;
	sourceType: SourceType;
	ingestionStatus: IngestionStatus;
	ingestionIssues: string[];
	pageCount: number;
	pagesWithText: number;
	claimCount: number;
	parser: { name: string; version: string };
	extractorVersion: string;
	supersedesDocumentId: string | null;
	uploadedBy: string;
	uploadedAt: string;
	/** Retention: original bytes removed. Extracted evidence and hashes remain for audit. */
	purgedAt: string | null;
	purgedBy: string | null;
	__version?: number;
};

export type PageLine = { text: string; x: number; y: number; width: number; height: number };

export type DocumentPage = {
	id: string;
	workspaceId: string;
	documentId: string;
	page: number;
	width: number;
	height: number;
	lines: PageLine[];
};

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

export type SourceLocation =
	| {
			kind: "document";
			documentId: string;
			documentHash: string;
			page: number;
			line: number;
			bbox: [number, number, number, number];
			quote: string;
	  }
	| { kind: "profile"; field: "founderClaims"; index: number; quote: string }
	| { kind: "reviewer"; reference: string; quote: string };

export type ExtractedMetric = {
	key: MetricKey;
	value: number;
	unit: "usd" | "percent" | "count" | "months";
	raw: string;
};

export type VerificationStatus = "unverified" | "corroborated" | "contradicted" | "reviewer_verified";

/** Immutable. Verification status is derived across evidence (see evidence-registry), never edited in place. */
export type EvidenceItem = {
	id: string;
	workspaceId: string;
	startupId: string;
	documentId: string | null;
	sourceLocation: SourceLocation;
	claim: string;
	metric: ExtractedMetric | null;
	topics: string[];
	provenance: {
		class: ProvenanceClass;
		sourceType: SourceType | "startup_profile" | "reviewer";
		extractor: string;
		recordedBy: string;
	};
	/** Status at creation: unverified, or reviewer_verified for reviewer-attached evidence. */
	verificationStatus: VerificationStatus;
	createdAt: string;
};

export type Contradiction = {
	metric: MetricKey;
	evidenceIds: string[];
	values: number[];
	relativeSpread: number;
};

/** Evidence as projected for a reader: stored item plus derived cross-document verification. */
export type EvidenceView = EvidenceItem & {
	effectiveVerification: VerificationStatus;
	corroboratedBy: string[];
	contradictedBy: string[];
	superseded: boolean;
};

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

export const OUTCOMES = [
	"supported",
	"partially_supported",
	"contradicted",
	"insufficient_evidence",
	"not_applicable",
	"evaluation_failed",
] as const;
export type Outcome = (typeof OUTCOMES)[number];

/** The outcomes Jev may select. `evaluation_failed` is the application's, never the model's. */
export const JEV_SELECTABLE_OUTCOMES: readonly Outcome[] = [
	"supported",
	"partially_supported",
	"contradicted",
	"insufficient_evidence",
	"not_applicable",
];

export type EvaluationStatus = "running" | "completed" | "failed";

export type ManifestEvidence = {
	id: string;
	documentId: string | null;
	documentHash: string | null;
	claim: string;
	metric: ExtractedMetric | null;
	provenanceClass: ProvenanceClass;
	verification: VerificationStatus;
	topics: string[];
	location: string;
};

export type JevQuestion = {
	criterionId: string;
	kind: "choice";
	instructionsDigest: string;
	options: string[];
	evidenceIds: string[];
	contextDigest: string;
};

/** Frozen at evaluation start. Its digest identifies the inputs; any material change yields a new digest. */
export type EvaluationManifest = {
	schema: "invest.evaluation-manifest/1";
	thesis: {
		thesisId: string;
		versionId: string;
		version: number;
		contentHash: string;
		criteria: InvestmentCriterion[];
		settings: ThesisSettings;
	};
	evidence: {
		items: ManifestEvidence[];
		documents: { id: string; contentHash: string; ingestionStatus: IngestionStatus; parser: string; extractorVersion: string }[];
		contradictions: Contradiction[];
		digest: string;
	};
	jev: {
		configured: boolean;
		adapterVersion: string;
		contract: string;
		endpointOrigin: string | null;
		provider: string | null;
		model: string | null;
		timeoutMs: number;
		maxRetries: number;
	};
	/** Which evidence each criterion was judged against, and which required evidence had none. */
	projections: Record<string, { evidenceIds: string[]; missing: string[] }>;
	questions: JevQuestion[];
	policyVersion: string;
	parser: { name: string; version: string };
	extractorVersion: string;
};

export type Uncertainty = {
	level: "low" | "medium" | "high" | "not_applicable";
	selectedProbability: number | null;
	distribution: Record<string, number> | null;
};

export type HardGateState = "passed" | "failed" | "unresolved" | "not_applicable";

export type JevTrace = {
	attempts: number;
	latencyMs: number;
	request: { kind: "choice"; options: string[]; instructionsDigest: string; contextDigest: string; contextChars: number };
	rawResponse: unknown;
	selected: string | null;
	error: string | null;
};

/** Immutable. Reviewer judgments are separate ReviewActions and never edit a finding. */
export type CriterionFinding = {
	id: string;
	workspaceId: string;
	evaluationId: string;
	criterionId: string;
	criterionName: string;
	mode: EvaluationMode;
	outcome: Outcome;
	/** Jev's selection before application policy; null for non-semantic criteria. */
	jevOutcome: Outcome | null;
	explanation: string;
	evidenceRefs: string[];
	missingEvidence: string[];
	contradictions: Contradiction[];
	sufficiency: "met" | "founder_reported_only" | "missing" | "not_applicable";
	uncertainty: Uncertainty;
	hardGate: HardGateState;
	review: { required: boolean; reasons: string[] };
	suggestedQuestions: string[];
	deterministic: null | {
		metric: MetricKey;
		comparator: Comparator;
		threshold: number;
		observedValue: number | null;
		sourceEvidenceId: string | null;
		passed: boolean | null;
	};
	policyAdjustments: string[];
	jev: JevTrace | null;
	configurationRef: string;
	createdAt: string;
};

export type EvaluationSummary = {
	criteria: number;
	byOutcome: Record<Outcome, number>;
	/** Share of non-N/A criteria whose outcome was established by evidence (supported, partial or contradicted). */
	evidenceCoverage: number;
	hardGates: { passed: number; failed: string[]; unresolved: string[] };
	reviewsRequired: number;
	reviewsOutstanding: number;
	contradictions: number;
	/** Present only when the thesis enables it. */
	weightedScore: number | null;
};

export type EvaluationMetrics = {
	latencyMs: number | null;
	jevCalls: number;
	jevFailures: number;
	jevRetries: number;
	/** Not measurable through the Jev HTTP contract, which reports no usage. Recorded as null rather than guessed. */
	costUsd: number | null;
};

export type Evaluation = {
	id: string;
	workspaceId: string;
	startupId: string;
	thesisId: string;
	thesisVersionId: string;
	status: EvaluationStatus;
	requestKey: string;
	predecessorId: string | null;
	manifest: EvaluationManifest;
	manifestDigest: string;
	summary: EvaluationSummary | null;
	failure: string | null;
	metrics: EvaluationMetrics;
	createdAt: string;
	createdBy: string;
	completedAt: string | null;
	__version?: number;
};

// ---------------------------------------------------------------------------
// Review and decisions
// ---------------------------------------------------------------------------

export type ReviewActionKind = "accept" | "override" | "request_evidence" | "resolve_request" | "comment";

/** Append-only. */
export type ReviewAction = {
	id: string;
	workspaceId: string;
	evaluationId: string;
	findingId: string | null;
	action: ReviewActionKind;
	/** For override: the reviewer's outcome. */
	outcome: Outcome | null;
	reason: string;
	assignee: string | null;
	targetActionId: string | null;
	actorId: string;
	actorName: string;
	createdAt: string;
};

export type DecisionKind = "invest" | "decline" | "hold" | "request_more_diligence";

/** Append-only. The latest decision for an evaluation is current; earlier ones remain as history. */
export type InvestmentDecision = {
	id: string;
	workspaceId: string;
	evaluationId: string;
	startupId: string;
	sequence: number;
	decision: DecisionKind;
	rationale: string;
	decidedBy: string;
	decidedByName: string;
	createdAt: string;
};

export type AuditEvent = {
	id: string;
	workspaceId: string;
	actorId: string;
	eventType: string;
	entityRef: { type: string; id: string };
	timestamp: string;
	payload: Record<string, unknown>;
};

/** Derived view of a finding with the reviewer's actions applied. Nothing here is stored. */
export type FindingView = CriterionFinding & {
	effectiveOutcome: Outcome;
	effectiveHardGate: HardGateState;
	reviewState: "not_required" | "outstanding" | "resolved";
	actions: ReviewAction[];
};
