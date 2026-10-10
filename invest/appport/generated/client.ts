/**
 * Generated from the AppPort manifest for com.rkendel1.attn.invest
 * (application version 0.1.0, protocol appport/1).
 *
 * Do not edit by hand: run `appport generate` to refresh it.
 */
import { createClient, type AppContract, type AppPortClient, type ClientOptions } from "@appport/sdk";

/** Returns the application manifest for this deployment. */
export type AppportManifestV1Input = Record<string, never>;
export type AppportManifestV1Output = {
  protocol: string;
  application: {
    id: string;
    name: string;
    version: string;
  };
  capabilities: Array<Record<string, unknown>>;
  events: Array<Record<string, unknown>>;
  transports: Array<Record<string, unknown>>;
};

export type AppportManifestInput = AppportManifestV1Input;
export type AppportManifestOutput = AppportManifestV1Output;

/** Liveness probe. Returns the server time. */
export type AppportPingV1Input = Record<string, never>;
export type AppportPingV1Output = {
  /** ISO-8601 timestamp */
  timestamp: string;
};

export type AppportPingInput = AppportPingV1Input;
export type AppportPingOutput = AppportPingV1Output;

/** Append-only audit history for the caller's workspace, newest first. */
export type AuditListV1Input = {
  entityId?: string;
  eventType?: string;
  limit?: number;
};
export type AuditListV1Output = {
  items: unknown;
};

export type AuditListInput = AuditListV1Input;
export type AuditListOutput = AuditListV1Output;

/** Records an investment decision. Invest requires every review gate resolved and no failed or unresolved hard gate. */
export type DecisionRecordV1Input = {
  evaluationId: string;
  decision: "invest" | "decline" | "hold" | "request_more_diligence";
  rationale: string;
  expectedSequence: number;
};
export type DecisionRecordV1Output = {
  decision: unknown;
};

export type DecisionRecordInput = DecisionRecordV1Input;
export type DecisionRecordOutput = DecisionRecordV1Output;

/** Ingestion status, issues, hashes and parser identity for one document. */
export type DocumentGetV1Input = {
  documentId: string;
};
export type DocumentGetV1Output = {
  document: unknown;
};

export type DocumentGetInput = DocumentGetV1Input;
export type DocumentGetOutput = DocumentGetV1Output;

/** A short-lived signed link to the original file (five minutes). */
export type DocumentLinkV1Input = {
  documentId: string;
};
export type DocumentLinkV1Output = {
  url: unknown;
  expiresAt: unknown;
};

export type DocumentLinkInput = DocumentLinkV1Input;
export type DocumentLinkOutput = DocumentLinkV1Output;

/** The extracted lines and coordinates of one page, for the source viewer. */
export type DocumentPageV1Input = {
  documentId: string;
  page: number;
};
export type DocumentPageV1Output = {
  page: unknown;
};

export type DocumentPageInput = DocumentPageV1Input;
export type DocumentPageOutput = DocumentPageV1Output;

/** Retention control: deletes the original file and extracted page text; evidence claims and hashes remain for audit. */
export type DocumentPurgeV1Input = {
  documentId: string;
  reason: string;
};
export type DocumentPurgeV1Output = {
  document: unknown;
};

export type DocumentPurgeInput = DocumentPurgeV1Input;
export type DocumentPurgeOutput = DocumentPurgeV1Output;

/** Uploads a document (base64). Type, extension and PDF signature are checked before parsing; rejected and failed files are recorded with their reasons and no evidence. */
export type DocumentUploadV1Input = {
  startupId: string;
  filename: string;
  mediaType: string;
  sourceType: "founder_deck" | "founder_financials" | "founder_other" | "third_party_report" | "customer_reference" | "bank_statement" | "audited_financials" | "data_room_other";
  contentBase64: string;
  supersedesDocumentId?: string;
};
export type DocumentUploadV1Output = {
  document: unknown;
};

export type DocumentUploadInput = DocumentUploadV1Input;
export type DocumentUploadOutput = DocumentUploadV1Output;

/** Evaluation report: manifest, findings with reviewer actions applied, open diligence requests, decision history and decision blockers. */
export type EvaluationGetV1Input = {
  evaluationId: string;
};
export type EvaluationGetV1Output = {
  report: unknown;
};

export type EvaluationGetInput = EvaluationGetV1Input;
export type EvaluationGetOutput = EvaluationGetV1Output;

/** Evaluations with status, summary and current decision. */
export type EvaluationListV1Input = {
  startupId?: string;
};
export type EvaluationListV1Output = {
  items: unknown;
};

export type EvaluationListInput = EvaluationListV1Input;
export type EvaluationListOutput = EvaluationListV1Output;

/** Creates a new evaluation linked to its predecessor. The predecessor is never modified. */
export type EvaluationRerunV1Input = {
  evaluationId: string;
  requestKey: string;
  thesisVersionId?: string;
};
export type EvaluationRerunV1Output = {
  evaluation: unknown;
};

export type EvaluationRerunInput = EvaluationRerunV1Input;
export type EvaluationRerunOutput = EvaluationRerunV1Output;

/** Evaluates a startup against an explicitly selected thesis version. Runs asynchronously; poll evaluation.get. */
export type EvaluationStartV1Input = {
  startupId: string;
  thesisVersionId: string;
  requestKey: string;
};
export type EvaluationStartV1Output = {
  evaluation: unknown;
};

export type EvaluationStartInput = EvaluationStartV1Input;
export type EvaluationStartOutput = EvaluationStartV1Output;

/** Independently recomputes the manifest digest, projections, question digests and every policy outcome of a stored evaluation. */
export type EvaluationVerifyV1Input = {
  evaluationId: string;
};
export type EvaluationVerifyV1Output = {
  ok: unknown;
  checks: unknown;
};

export type EvaluationVerifyInput = EvaluationVerifyV1Input;
export type EvaluationVerifyOutput = EvaluationVerifyV1Output;

/** Attaches evidence a reviewer verified directly, with how it was verified. */
export type EvidenceAttachV1Input = {
  startupId: string;
  claim: string;
  reference: string;
  metric?: {
    key: "arr" | "mrr" | "revenue" | "revenue_growth_pct" | "gross_margin_pct" | "net_revenue_retention_pct" | "customers" | "monthly_burn" | "runway_months" | "cash" | "team_size" | "funding_ask" | "pre_money_valuation" | "tam" | "churn_pct";
    value: number;
  };
};
export type EvidenceAttachV1Output = {
  item: unknown;
};

export type EvidenceAttachInput = EvidenceAttachV1Input;
export type EvidenceAttachOutput = EvidenceAttachV1Output;

/** One claim's provenance: source document, hash, page and coordinates, and cross-source verification. */
export type EvidenceGetV1Input = {
  evidenceId: string;
};
export type EvidenceGetV1Output = {
  item: unknown;
  document: unknown;
};

export type EvidenceGetInput = EvidenceGetV1Input;
export type EvidenceGetOutput = EvidenceGetV1Output;

/** Claims for a startup with provenance, derived verification and contradictions. */
export type EvidenceListV1Input = {
  startupId: string;
};
export type EvidenceListV1Output = {
  items: unknown;
  contradictions: unknown;
};

export type EvidenceListInput = EvidenceListV1Input;
export type EvidenceListOutput = EvidenceListV1Output;

/** Withdraws an investor-verified criterion by appending a withdrawal; the approval stays in the history. */
export type FirmApprovalWithdrawV1Input = {
  firmId: string;
  approvalId: string;
  note: string;
};
export type FirmApprovalWithdrawV1Output = {
  approval: unknown;
};

export type FirmApprovalWithdrawInput = FirmApprovalWithdrawV1Input;
export type FirmApprovalWithdrawOutput = FirmApprovalWithdrawV1Output;

/** Records an investor-verified criterion for a firm, from a research criterion or entered by hand. The only way research becomes investor-verified; requires thesis.approve. */
export type FirmApproveV1Input = {
  firmId: string;
  criterionId?: string;
  field?: "stage" | "sector" | "geography" | "check_size" | "business_model" | "company_characteristics" | "exclusion" | "traction" | "application_requirements";
  polarity?: "include" | "exclude";
  value?: string;
  minUsd?: number;
  maxUsd?: number;
  note: string;
};
export type FirmApproveV1Output = {
  approval: unknown;
};

export type FirmApproveInput = FirmApproveV1Input;
export type FirmApproveOutput = FirmApproveV1Output;

/** One firm profile: criteria with assertion type, source passage, verification and freshness; conflicts; approved criteria; sources checked; run history; reviews. */
export type FirmGetV1Input = {
  firmId: string;
};
export type FirmGetV1Output = {
  profile: unknown;
};

export type FirmGetInput = FirmGetV1Input;
export type FirmGetOutput = FirmGetV1Output;

/** Investor firm profiles in the caller's workspace, with research status, last research time and criteria counts. Optional search and status filter. */
export type FirmListV1Input = {
  query?: string;
  status?: "pending" | "thesis_found" | "no_thesis_found" | "research_incomplete";
};
export type FirmListV1Output = {
  items: unknown;
};

export type FirmListInput = FirmListV1Input;
export type FirmListOutput = FirmListV1Output;

/** Re-researches one existing firm in this server process within the configured crawl bounds. Accepts only a firm id, never a URL. Returns at once; poll firm.get. */
export type FirmRefreshV1Input = {
  firmId: string;
};
export type FirmRefreshV1Output = {
  firm: unknown;
  run: unknown;
};

export type FirmRefreshInput = FirmRefreshV1Input;
export type FirmRefreshOutput = FirmRefreshV1Output;

/** Flag, dispute, correct or annotate a research result. Recorded as a separate review; the extracted criterion is not changed and is not approved by it. */
export type FirmReviewV1Input = {
  firmId: string;
  criterionId?: string | null;
  action: "flag" | "dispute" | "correct" | "note";
  note: string;
  correctedValue?: string;
};
export type FirmReviewV1Output = {
  review: unknown;
};

export type FirmReviewInput = FirmReviewV1Input;
export type FirmReviewOutput = FirmReviewV1Output;

/** Asks Jev whether each current criterion's captured passage supports its statement. Reports skipped when Jev is not configured; never simulates a result. */
export type FirmVerifyV1Input = {
  firmId: string;
};
export type FirmVerifyV1Output = {
  summary: unknown;
};

export type FirmVerifyInput = FirmVerifyV1Input;
export type FirmVerifyOutput = FirmVerifyV1Output;

/** Accept a finding, override its outcome (outcome and reason required), or comment. Findings are never edited. */
export type ReviewRecordV1Input = {
  evaluationId: string;
  findingId: string | null;
  action: "accept" | "override" | "comment";
  outcome?: "supported" | "partially_supported" | "contradicted" | "insufficient_evidence" | "not_applicable" | "evaluation_failed";
  reason?: string;
};
export type ReviewRecordV1Output = {
  action: unknown;
};

export type ReviewRecordInput = ReviewRecordV1Input;
export type ReviewRecordOutput = ReviewRecordV1Output;

/** Opens a diligence request (follow-up), optionally tied to a finding and assigned to someone. */
export type ReviewRequestV1Input = {
  evaluationId: string;
  findingId?: string | null;
  question: string;
  assignee?: string;
};
export type ReviewRequestV1Output = {
  action: unknown;
};

export type ReviewRequestInput = ReviewRequestV1Input;
export type ReviewRequestOutput = ReviewRequestV1Output;

/** Resolves a diligence request. A request can be resolved exactly once. */
export type ReviewResolveV1Input = {
  evaluationId: string;
  requestId: string;
  resolution: string;
};
export type ReviewResolveV1Output = {
  action: unknown;
};

export type ReviewResolveInput = ReviewResolveV1Input;
export type ReviewResolveOutput = ReviewResolveV1Output;

/** The authenticated principal, its workspace and permissions, and the configured Jev identity (never credentials). */
export type SessionWhoamiV1Input = Record<string, never>;
export type SessionWhoamiV1Output = {
  principal: unknown;
  jev: unknown;
};

export type SessionWhoamiInput = SessionWhoamiV1Input;
export type SessionWhoamiOutput = SessionWhoamiV1Output;

/** Creates a startup profile. Founder claims are recorded as founder-reported evidence. */
export type StartupCreateV1Input = {
  name: string;
  website?: string;
  stage?: string;
  sector?: string;
  description?: string;
  founderClaims?: Array<string>;
};
export type StartupCreateV1Output = {
  startup: unknown;
};

export type StartupCreateInput = StartupCreateV1Input;
export type StartupCreateOutput = StartupCreateV1Output;

/** Startup and evidence workspace: profile, documents, evidence with provenance, contradictions, evaluations, decisions, and gaps against an optional thesis version. */
export type StartupGetV1Input = {
  startupId: string;
  thesisVersionId?: string;
};
export type StartupGetV1Output = {
  workspace: unknown;
};

export type StartupGetInput = StartupGetV1Input;
export type StartupGetOutput = StartupGetV1Output;

/** Startups in the caller's workspace. */
export type StartupListV1Input = Record<string, never>;
export type StartupListV1Output = {
  items: unknown;
};

export type StartupListInput = StartupListV1Input;
export type StartupListOutput = StartupListV1Output;

/** Updates a startup profile, fenced on expectedVersion. */
export type StartupUpdateV1Input = {
  startupId: string;
  expectedVersion: number;
  name: string;
  website?: string;
  stage?: string;
  sector?: string;
  description?: string;
  founderClaims?: Array<string>;
};
export type StartupUpdateV1Output = {
  startup: unknown;
};

export type StartupUpdateInput = StartupUpdateV1Input;
export type StartupUpdateOutput = StartupUpdateV1Output;

/** Freezes the draft as the next immutable version. Previous versions are never modified. */
export type ThesisApproveV1Input = {
  thesisId: string;
  expectedVersion: number;
  note?: string;
};
export type ThesisApproveV1Output = {
  thesis: unknown;
  version: unknown;
};

export type ThesisApproveInput = ThesisApproveV1Input;
export type ThesisApproveOutput = ThesisApproveV1Output;

/** Creates a thesis with a draft. Nothing is evaluable until a version is approved. */
export type ThesisCreateV1Input = {
  name: string;
  description?: string;
  criteria: Array<{
    id: string;
    name: string;
    requirement: string;
    evaluationMode: "semantic" | "deterministic" | "human_review";
    importance: number;
    requiredEvidence: Array<string>;
    threshold?: number;
    hardGate: boolean;
    missingEvidencePolicy: "unknown" | "review_required";
    disqualifier?: string;
    metric?: "arr" | "mrr" | "revenue" | "revenue_growth_pct" | "gross_margin_pct" | "net_revenue_retention_pct" | "customers" | "monthly_burn" | "runway_months" | "cash" | "team_size" | "funding_ask" | "pre_money_valuation" | "tam" | "churn_pct";
    comparator?: "gte" | "gt" | "lte" | "lt" | "eq";
    evidenceStandard?: "founder_reported_ok" | "independent_required";
  }>;
  settings?: {
    showWeightedSummary: boolean;
    reviewConfidenceThreshold: number;
  };
};
export type ThesisCreateV1Output = {
  thesis: unknown;
};

export type ThesisCreateInput = ThesisCreateV1Input;
export type ThesisCreateOutput = ThesisCreateV1Output;

/** Discards the draft of a thesis that already has an approved version. */
export type ThesisDraftDiscardV1Input = {
  thesisId: string;
  expectedVersion: number;
};
export type ThesisDraftDiscardV1Output = {
  thesis: unknown;
};

export type ThesisDraftDiscardInput = ThesisDraftDiscardV1Input;
export type ThesisDraftDiscardOutput = ThesisDraftDiscardV1Output;

/** Replaces the draft. Fenced on expectedVersion; a stale editor gets CONFLICT instead of overwriting. */
export type ThesisDraftUpdateV1Input = {
  thesisId: string;
  expectedVersion: number;
  name?: string;
  description?: string;
  criteria: Array<{
    id: string;
    name: string;
    requirement: string;
    evaluationMode: "semantic" | "deterministic" | "human_review";
    importance: number;
    requiredEvidence: Array<string>;
    threshold?: number;
    hardGate: boolean;
    missingEvidencePolicy: "unknown" | "review_required";
    disqualifier?: string;
    metric?: "arr" | "mrr" | "revenue" | "revenue_growth_pct" | "gross_margin_pct" | "net_revenue_retention_pct" | "customers" | "monthly_burn" | "runway_months" | "cash" | "team_size" | "funding_ask" | "pre_money_valuation" | "tam" | "churn_pct";
    comparator?: "gte" | "gt" | "lte" | "lt" | "eq";
    evidenceStandard?: "founder_reported_ok" | "independent_required";
  }>;
  settings?: {
    showWeightedSummary: boolean;
    reviewConfidenceThreshold: number;
  };
};
export type ThesisDraftUpdateV1Output = {
  thesis: unknown;
};

export type ThesisDraftUpdateInput = ThesisDraftUpdateV1Input;
export type ThesisDraftUpdateOutput = ThesisDraftUpdateV1Output;

/** A thesis with its draft and every approved version. */
export type ThesisGetV1Input = {
  thesisId: string;
};
export type ThesisGetV1Output = {
  thesis: unknown;
  versions: unknown;
};

export type ThesisGetInput = ThesisGetV1Input;
export type ThesisGetOutput = ThesisGetV1Output;

/** Theses in the caller's workspace. */
export type ThesisListV1Input = Record<string, never>;
export type ThesisListV1Output = {
  items: unknown;
};

export type ThesisListInput = ThesisListV1Input;
export type ThesisListOutput = ThesisListV1Output;

/** Validates criteria and settings without storing anything. */
export type ThesisValidateV1Input = {
  criteria: Array<unknown>;
  settings: unknown;
};
export type ThesisValidateV1Output = {
  valid: unknown;
  errors: unknown;
  warnings: unknown;
};

export type ThesisValidateInput = ThesisValidateV1Input;
export type ThesisValidateOutput = ThesisValidateV1Output;

/** Criterion-level differences between two versions, or between a version and the current draft. */
export type ThesisVersionCompareV1Input = {
  fromVersionId: string;
  toVersionId?: string;
};
export type ThesisVersionCompareV1Output = {
  from: unknown;
  to: unknown;
  changes: unknown;
};

export type ThesisVersionCompareInput = ThesisVersionCompareV1Input;
export type ThesisVersionCompareOutput = ThesisVersionCompareV1Output;

/** One immutable thesis version. */
export type ThesisVersionGetV1Input = {
  versionId: string;
};
export type ThesisVersionGetV1Output = {
  version: unknown;
};

export type ThesisVersionGetInput = ThesisVersionGetV1Input;
export type ThesisVersionGetOutput = ThesisVersionGetV1Output;

/** Active evaluations, outstanding reviews, recently completed assessments and startups awaiting evidence. */
export type WorkspaceOverviewV1Input = Record<string, never>;
export type WorkspaceOverviewV1Output = {
  overview: unknown;
};

export type WorkspaceOverviewInput = WorkspaceOverviewV1Input;
export type WorkspaceOverviewOutput = WorkspaceOverviewV1Output;

/** The capability contract published by com.rkendel1.attn.invest. */
export interface InvestContract extends AppContract {
  capabilities: {
    "appport.manifest": { input: AppportManifestInput; output: AppportManifestOutput; kind: "request"; version: 1 };
    "appport.ping": { input: AppportPingInput; output: AppportPingOutput; kind: "request"; version: 1 };
    "audit.list": { input: AuditListInput; output: AuditListOutput; kind: "request"; version: 1 };
    "decision.record": { input: DecisionRecordInput; output: DecisionRecordOutput; kind: "request"; version: 1 };
    "document.get": { input: DocumentGetInput; output: DocumentGetOutput; kind: "request"; version: 1 };
    "document.link": { input: DocumentLinkInput; output: DocumentLinkOutput; kind: "request"; version: 1 };
    "document.page": { input: DocumentPageInput; output: DocumentPageOutput; kind: "request"; version: 1 };
    "document.purge": { input: DocumentPurgeInput; output: DocumentPurgeOutput; kind: "request"; version: 1 };
    "document.upload": { input: DocumentUploadInput; output: DocumentUploadOutput; kind: "request"; version: 1 };
    "evaluation.get": { input: EvaluationGetInput; output: EvaluationGetOutput; kind: "request"; version: 1 };
    "evaluation.list": { input: EvaluationListInput; output: EvaluationListOutput; kind: "request"; version: 1 };
    "evaluation.rerun": { input: EvaluationRerunInput; output: EvaluationRerunOutput; kind: "request"; version: 1 };
    "evaluation.start": { input: EvaluationStartInput; output: EvaluationStartOutput; kind: "request"; version: 1 };
    "evaluation.verify": { input: EvaluationVerifyInput; output: EvaluationVerifyOutput; kind: "request"; version: 1 };
    "evidence.attach": { input: EvidenceAttachInput; output: EvidenceAttachOutput; kind: "request"; version: 1 };
    "evidence.get": { input: EvidenceGetInput; output: EvidenceGetOutput; kind: "request"; version: 1 };
    "evidence.list": { input: EvidenceListInput; output: EvidenceListOutput; kind: "request"; version: 1 };
    "firm.approval.withdraw": { input: FirmApprovalWithdrawInput; output: FirmApprovalWithdrawOutput; kind: "request"; version: 1 };
    "firm.approve": { input: FirmApproveInput; output: FirmApproveOutput; kind: "request"; version: 1 };
    "firm.get": { input: FirmGetInput; output: FirmGetOutput; kind: "request"; version: 1 };
    "firm.list": { input: FirmListInput; output: FirmListOutput; kind: "request"; version: 1 };
    "firm.refresh": { input: FirmRefreshInput; output: FirmRefreshOutput; kind: "request"; version: 1 };
    "firm.review": { input: FirmReviewInput; output: FirmReviewOutput; kind: "request"; version: 1 };
    "firm.verify": { input: FirmVerifyInput; output: FirmVerifyOutput; kind: "request"; version: 1 };
    "review.record": { input: ReviewRecordInput; output: ReviewRecordOutput; kind: "request"; version: 1 };
    "review.request": { input: ReviewRequestInput; output: ReviewRequestOutput; kind: "request"; version: 1 };
    "review.resolve": { input: ReviewResolveInput; output: ReviewResolveOutput; kind: "request"; version: 1 };
    "session.whoami": { input: SessionWhoamiInput; output: SessionWhoamiOutput; kind: "request"; version: 1 };
    "startup.create": { input: StartupCreateInput; output: StartupCreateOutput; kind: "request"; version: 1 };
    "startup.get": { input: StartupGetInput; output: StartupGetOutput; kind: "request"; version: 1 };
    "startup.list": { input: StartupListInput; output: StartupListOutput; kind: "request"; version: 1 };
    "startup.update": { input: StartupUpdateInput; output: StartupUpdateOutput; kind: "request"; version: 1 };
    "thesis.approve": { input: ThesisApproveInput; output: ThesisApproveOutput; kind: "request"; version: 1 };
    "thesis.create": { input: ThesisCreateInput; output: ThesisCreateOutput; kind: "request"; version: 1 };
    "thesis.draft.discard": { input: ThesisDraftDiscardInput; output: ThesisDraftDiscardOutput; kind: "request"; version: 1 };
    "thesis.draft.update": { input: ThesisDraftUpdateInput; output: ThesisDraftUpdateOutput; kind: "request"; version: 1 };
    "thesis.get": { input: ThesisGetInput; output: ThesisGetOutput; kind: "request"; version: 1 };
    "thesis.list": { input: ThesisListInput; output: ThesisListOutput; kind: "request"; version: 1 };
    "thesis.validate": { input: ThesisValidateInput; output: ThesisValidateOutput; kind: "request"; version: 1 };
    "thesis.version.compare": { input: ThesisVersionCompareInput; output: ThesisVersionCompareOutput; kind: "request"; version: 1 };
    "thesis.version.get": { input: ThesisVersionGetInput; output: ThesisVersionGetOutput; kind: "request"; version: 1 };
    "workspace.overview": { input: WorkspaceOverviewInput; output: WorkspaceOverviewOutput; kind: "request"; version: 1 };
  };
  events: {
  };
}

/** Capability versions this client sends by default (§42). */
export const capabilityVersions: Record<string, number> = {
  "appport.manifest": 1,
  "appport.ping": 1,
  "audit.list": 1,
  "decision.record": 1,
  "document.get": 1,
  "document.link": 1,
  "document.page": 1,
  "document.purge": 1,
  "document.upload": 1,
  "evaluation.get": 1,
  "evaluation.list": 1,
  "evaluation.rerun": 1,
  "evaluation.start": 1,
  "evaluation.verify": 1,
  "evidence.attach": 1,
  "evidence.get": 1,
  "evidence.list": 1,
  "firm.approval.withdraw": 1,
  "firm.approve": 1,
  "firm.get": 1,
  "firm.list": 1,
  "firm.refresh": 1,
  "firm.review": 1,
  "firm.verify": 1,
  "review.record": 1,
  "review.request": 1,
  "review.resolve": 1,
  "session.whoami": 1,
  "startup.create": 1,
  "startup.get": 1,
  "startup.list": 1,
  "startup.update": 1,
  "thesis.approve": 1,
  "thesis.create": 1,
  "thesis.draft.discard": 1,
  "thesis.draft.update": 1,
  "thesis.get": 1,
  "thesis.list": 1,
  "thesis.validate": 1,
  "thesis.version.compare": 1,
  "thesis.version.get": 1,
  "workspace.overview": 1,
};

/** Capabilities that answer with a stream (§20). */
export const streamCapabilities: string[] = [];

/** The manifest this client was generated from. */
export const manifest = {
  "protocol": "appport/1",
  "application": {
    "id": "com.rkendel1.attn.invest",
    "name": "Attn Invest",
    "version": "0.1.0",
    "description": "Jev for Investment Evaluation: versioned theses, traceable evidence, bounded Jev judgments and auditable human decisions."
  },
  "capabilities": [
    {
      "name": "appport.manifest",
      "versions": [
        1
      ],
      "latestVersion": 1,
      "description": "Returns the application manifest for this deployment.",
      "kind": "request",
      "inputSchema": {
        "type": "object",
        "properties": {},
        "additionalProperties": false
      },
      "outputSchema": {
        "type": "object",
        "properties": {
          "protocol": {
            "type": "string"
          },
          "application": {
            "type": "object",
            "properties": {
              "id": {
                "type": "string"
              },
              "name": {
                "type": "string"
              },
              "version": {
                "type": "string"
              }
            },
            "additionalProperties": true,
            "required": [
              "id",
              "name",
              "version"
            ]
          },
          "capabilities": {
            "type": "array",
            "items": {
              "type": "object",
              "additionalProperties": {}
            }
          },
          "events": {
            "type": "array",
            "items": {
              "type": "object",
              "additionalProperties": {}
            }
          },
          "transports": {
            "type": "array",
            "items": {
              "type": "object",
              "additionalProperties": {}
            }
          }
        },
        "additionalProperties": true,
        "required": [
          "protocol",
          "application",
          "capabilities",
          "events",
          "transports"
        ],
        "title": "AppPortManifest"
      },
      "authorization": [],
      "idempotency": "unsupported",
      "concurrency": {
        "mode": "parallel"
      },
      "definitions": [
        {
          "version": 1,
          "description": "Returns the application manifest for this deployment.",
          "kind": "request",
          "inputSchema": {
            "type": "object",
            "properties": {},
            "additionalProperties": false
          },
          "outputSchema": {
            "type": "object",
            "properties": {
              "protocol": {
                "type": "string"
              },
              "application": {
                "type": "object",
                "properties": {
                  "id": {
                    "type": "string"
                  },
                  "name": {
                    "type": "string"
                  },
                  "version": {
                    "type": "string"
                  }
                },
                "additionalProperties": true,
                "required": [
                  "id",
                  "name",
                  "version"
                ]
              },
              "capabilities": {
                "type": "array",
                "items": {
                  "type": "object",
                  "additionalProperties": {}
                }
              },
              "events": {
                "type": "array",
                "items": {
                  "type": "object",
                  "additionalProperties": {}
                }
              },
              "transports": {
                "type": "array",
                "items": {
                  "type": "object",
                  "additionalProperties": {}
                }
              }
            },
            "additionalProperties": true,
            "required": [
              "protocol",
              "application",
              "capabilities",
              "events",
              "transports"
            ],
            "title": "AppPortManifest"
          },
          "authorization": [],
          "idempotency": "unsupported",
          "concurrency": {
            "mode": "parallel"
          }
        }
      ]
    },
    {
      "name": "appport.ping",
      "versions": [
        1
      ],
      "latestVersion": 1,
      "description": "Liveness probe. Returns the server time.",
      "kind": "request",
      "inputSchema": {
        "type": "object",
        "properties": {},
        "additionalProperties": false
      },
      "outputSchema": {
        "type": "object",
        "properties": {
          "timestamp": {
            "type": "string",
            "description": "ISO-8601 timestamp",
            "format": "date-time"
          }
        },
        "additionalProperties": false,
        "required": [
          "timestamp"
        ]
      },
      "authorization": [],
      "idempotency": "unsupported",
      "concurrency": {
        "mode": "parallel"
      },
      "definitions": [
        {
          "version": 1,
          "description": "Liveness probe. Returns the server time.",
          "kind": "request",
          "inputSchema": {
            "type": "object",
            "properties": {},
            "additionalProperties": false
          },
          "outputSchema": {
            "type": "object",
            "properties": {
              "timestamp": {
                "type": "string",
                "description": "ISO-8601 timestamp",
                "format": "date-time"
              }
            },
            "additionalProperties": false,
            "required": [
              "timestamp"
            ]
          },
          "authorization": [],
          "idempotency": "unsupported",
          "concurrency": {
            "mode": "parallel"
          }
        }
      ]
    },
    {
      "name": "audit.list",
      "versions": [
        1
      ],
      "latestVersion": 1,
      "description": "Append-only audit history for the caller's workspace, newest first.",
      "kind": "request",
      "inputSchema": {
        "type": "object",
        "properties": {
          "entityId": {
            "type": "string"
          },
          "eventType": {
            "type": "string"
          },
          "limit": {
            "type": "integer"
          }
        },
        "additionalProperties": false
      },
      "outputSchema": {
        "type": "object",
        "properties": {
          "items": {}
        },
        "additionalProperties": false,
        "required": [
          "items"
        ]
      },
      "authorization": [
        "audit.read"
      ],
      "idempotency": "unsupported",
      "concurrency": {
        "mode": "parallel"
      },
      "definitions": [
        {
          "version": 1,
          "description": "Append-only audit history for the caller's workspace, newest first.",
          "kind": "request",
          "inputSchema": {
            "type": "object",
            "properties": {
              "entityId": {
                "type": "string"
              },
              "eventType": {
                "type": "string"
              },
              "limit": {
                "type": "integer"
              }
            },
            "additionalProperties": false
          },
          "outputSchema": {
            "type": "object",
            "properties": {
              "items": {}
            },
            "additionalProperties": false,
            "required": [
              "items"
            ]
          },
          "authorization": [
            "audit.read"
          ],
          "idempotency": "unsupported",
          "concurrency": {
            "mode": "parallel"
          }
        }
      ]
    },
    {
      "name": "decision.record",
      "versions": [
        1
      ],
      "latestVersion": 1,
      "description": "Records an investment decision. Invest requires every review gate resolved and no failed or unresolved hard gate.",
      "kind": "request",
      "inputSchema": {
        "type": "object",
        "properties": {
          "evaluationId": {
            "type": "string"
          },
          "decision": {
            "type": "string",
            "enum": [
              "invest",
              "decline",
              "hold",
              "request_more_diligence"
            ]
          },
          "rationale": {
            "type": "string"
          },
          "expectedSequence": {
            "type": "integer"
          }
        },
        "additionalProperties": false,
        "required": [
          "evaluationId",
          "decision",
          "rationale",
          "expectedSequence"
        ]
      },
      "outputSchema": {
        "type": "object",
        "properties": {
          "decision": {}
        },
        "additionalProperties": false,
        "required": [
          "decision"
        ]
      },
      "authorization": [
        "decision.record"
      ],
      "idempotency": "unsupported",
      "concurrency": {
        "mode": "keyed",
        "key": "evaluationId"
      },
      "definitions": [
        {
          "version": 1,
          "description": "Records an investment decision. Invest requires every review gate resolved and no failed or unresolved hard gate.",
          "kind": "request",
          "inputSchema": {
            "type": "object",
            "properties": {
              "evaluationId": {
                "type": "string"
              },
              "decision": {
                "type": "string",
                "enum": [
                  "invest",
                  "decline",
                  "hold",
                  "request_more_diligence"
                ]
              },
              "rationale": {
                "type": "string"
              },
              "expectedSequence": {
                "type": "integer"
              }
            },
            "additionalProperties": false,
            "required": [
              "evaluationId",
              "decision",
              "rationale",
              "expectedSequence"
            ]
          },
          "outputSchema": {
            "type": "object",
            "properties": {
              "decision": {}
            },
            "additionalProperties": false,
            "required": [
              "decision"
            ]
          },
          "authorization": [
            "decision.record"
          ],
          "idempotency": "unsupported",
          "concurrency": {
            "mode": "keyed",
            "key": "evaluationId"
          }
        }
      ]
    },
    {
      "name": "document.get",
      "versions": [
        1
      ],
      "latestVersion": 1,
      "description": "Ingestion status, issues, hashes and parser identity for one document.",
      "kind": "request",
      "inputSchema": {
        "type": "object",
        "properties": {
          "documentId": {
            "type": "string"
          }
        },
        "additionalProperties": false,
        "required": [
          "documentId"
        ]
      },
      "outputSchema": {
        "type": "object",
        "properties": {
          "document": {}
        },
        "additionalProperties": false,
        "required": [
          "document"
        ]
      },
      "authorization": [
        "invest.read"
      ],
      "idempotency": "unsupported",
      "concurrency": {
        "mode": "parallel"
      },
      "definitions": [
        {
          "version": 1,
          "description": "Ingestion status, issues, hashes and parser identity for one document.",
          "kind": "request",
          "inputSchema": {
            "type": "object",
            "properties": {
              "documentId": {
                "type": "string"
              }
            },
            "additionalProperties": false,
            "required": [
              "documentId"
            ]
          },
          "outputSchema": {
            "type": "object",
            "properties": {
              "document": {}
            },
            "additionalProperties": false,
            "required": [
              "document"
            ]
          },
          "authorization": [
            "invest.read"
          ],
          "idempotency": "unsupported",
          "concurrency": {
            "mode": "parallel"
          }
        }
      ]
    },
    {
      "name": "document.link",
      "versions": [
        1
      ],
      "latestVersion": 1,
      "description": "A short-lived signed link to the original file (five minutes).",
      "kind": "request",
      "inputSchema": {
        "type": "object",
        "properties": {
          "documentId": {
            "type": "string"
          }
        },
        "additionalProperties": false,
        "required": [
          "documentId"
        ]
      },
      "outputSchema": {
        "type": "object",
        "properties": {
          "url": {},
          "expiresAt": {}
        },
        "additionalProperties": false,
        "required": [
          "url",
          "expiresAt"
        ]
      },
      "authorization": [
        "invest.read"
      ],
      "idempotency": "unsupported",
      "concurrency": {
        "mode": "parallel"
      },
      "definitions": [
        {
          "version": 1,
          "description": "A short-lived signed link to the original file (five minutes).",
          "kind": "request",
          "inputSchema": {
            "type": "object",
            "properties": {
              "documentId": {
                "type": "string"
              }
            },
            "additionalProperties": false,
            "required": [
              "documentId"
            ]
          },
          "outputSchema": {
            "type": "object",
            "properties": {
              "url": {},
              "expiresAt": {}
            },
            "additionalProperties": false,
            "required": [
              "url",
              "expiresAt"
            ]
          },
          "authorization": [
            "invest.read"
          ],
          "idempotency": "unsupported",
          "concurrency": {
            "mode": "parallel"
          }
        }
      ]
    },
    {
      "name": "document.page",
      "versions": [
        1
      ],
      "latestVersion": 1,
      "description": "The extracted lines and coordinates of one page, for the source viewer.",
      "kind": "request",
      "inputSchema": {
        "type": "object",
        "properties": {
          "documentId": {
            "type": "string"
          },
          "page": {
            "type": "integer"
          }
        },
        "additionalProperties": false,
        "required": [
          "documentId",
          "page"
        ]
      },
      "outputSchema": {
        "type": "object",
        "properties": {
          "page": {}
        },
        "additionalProperties": false,
        "required": [
          "page"
        ]
      },
      "authorization": [
        "invest.read"
      ],
      "idempotency": "unsupported",
      "concurrency": {
        "mode": "parallel"
      },
      "definitions": [
        {
          "version": 1,
          "description": "The extracted lines and coordinates of one page, for the source viewer.",
          "kind": "request",
          "inputSchema": {
            "type": "object",
            "properties": {
              "documentId": {
                "type": "string"
              },
              "page": {
                "type": "integer"
              }
            },
            "additionalProperties": false,
            "required": [
              "documentId",
              "page"
            ]
          },
          "outputSchema": {
            "type": "object",
            "properties": {
              "page": {}
            },
            "additionalProperties": false,
            "required": [
              "page"
            ]
          },
          "authorization": [
            "invest.read"
          ],
          "idempotency": "unsupported",
          "concurrency": {
            "mode": "parallel"
          }
        }
      ]
    },
    {
      "name": "document.purge",
      "versions": [
        1
      ],
      "latestVersion": 1,
      "description": "Retention control: deletes the original file and extracted page text; evidence claims and hashes remain for audit.",
      "kind": "request",
      "inputSchema": {
        "type": "object",
        "properties": {
          "documentId": {
            "type": "string"
          },
          "reason": {
            "type": "string"
          }
        },
        "additionalProperties": false,
        "required": [
          "documentId",
          "reason"
        ]
      },
      "outputSchema": {
        "type": "object",
        "properties": {
          "document": {}
        },
        "additionalProperties": false,
        "required": [
          "document"
        ]
      },
      "authorization": [
        "document.write"
      ],
      "idempotency": "unsupported",
      "concurrency": {
        "mode": "keyed",
        "key": "documentId"
      },
      "definitions": [
        {
          "version": 1,
          "description": "Retention control: deletes the original file and extracted page text; evidence claims and hashes remain for audit.",
          "kind": "request",
          "inputSchema": {
            "type": "object",
            "properties": {
              "documentId": {
                "type": "string"
              },
              "reason": {
                "type": "string"
              }
            },
            "additionalProperties": false,
            "required": [
              "documentId",
              "reason"
            ]
          },
          "outputSchema": {
            "type": "object",
            "properties": {
              "document": {}
            },
            "additionalProperties": false,
            "required": [
              "document"
            ]
          },
          "authorization": [
            "document.write"
          ],
          "idempotency": "unsupported",
          "concurrency": {
            "mode": "keyed",
            "key": "documentId"
          }
        }
      ]
    },
    {
      "name": "document.upload",
      "versions": [
        1
      ],
      "latestVersion": 1,
      "description": "Uploads a document (base64). Type, extension and PDF signature are checked before parsing; rejected and failed files are recorded with their reasons and no evidence.",
      "kind": "request",
      "inputSchema": {
        "type": "object",
        "properties": {
          "startupId": {
            "type": "string"
          },
          "filename": {
            "type": "string"
          },
          "mediaType": {
            "type": "string"
          },
          "sourceType": {
            "type": "string",
            "enum": [
              "founder_deck",
              "founder_financials",
              "founder_other",
              "third_party_report",
              "customer_reference",
              "bank_statement",
              "audited_financials",
              "data_room_other"
            ]
          },
          "contentBase64": {
            "type": "string"
          },
          "supersedesDocumentId": {
            "type": "string"
          }
        },
        "additionalProperties": false,
        "required": [
          "startupId",
          "filename",
          "mediaType",
          "sourceType",
          "contentBase64"
        ]
      },
      "outputSchema": {
        "type": "object",
        "properties": {
          "document": {}
        },
        "additionalProperties": false,
        "required": [
          "document"
        ]
      },
      "authorization": [
        "document.write"
      ],
      "idempotency": "unsupported",
      "concurrency": {
        "mode": "keyed",
        "key": "startupId"
      },
      "definitions": [
        {
          "version": 1,
          "description": "Uploads a document (base64). Type, extension and PDF signature are checked before parsing; rejected and failed files are recorded with their reasons and no evidence.",
          "kind": "request",
          "inputSchema": {
            "type": "object",
            "properties": {
              "startupId": {
                "type": "string"
              },
              "filename": {
                "type": "string"
              },
              "mediaType": {
                "type": "string"
              },
              "sourceType": {
                "type": "string",
                "enum": [
                  "founder_deck",
                  "founder_financials",
                  "founder_other",
                  "third_party_report",
                  "customer_reference",
                  "bank_statement",
                  "audited_financials",
                  "data_room_other"
                ]
              },
              "contentBase64": {
                "type": "string"
              },
              "supersedesDocumentId": {
                "type": "string"
              }
            },
            "additionalProperties": false,
            "required": [
              "startupId",
              "filename",
              "mediaType",
              "sourceType",
              "contentBase64"
            ]
          },
          "outputSchema": {
            "type": "object",
            "properties": {
              "document": {}
            },
            "additionalProperties": false,
            "required": [
              "document"
            ]
          },
          "authorization": [
            "document.write"
          ],
          "idempotency": "unsupported",
          "concurrency": {
            "mode": "keyed",
            "key": "startupId"
          },
          "timeoutMs": 120000
        }
      ]
    },
    {
      "name": "evaluation.get",
      "versions": [
        1
      ],
      "latestVersion": 1,
      "description": "Evaluation report: manifest, findings with reviewer actions applied, open diligence requests, decision history and decision blockers.",
      "kind": "request",
      "inputSchema": {
        "type": "object",
        "properties": {
          "evaluationId": {
            "type": "string"
          }
        },
        "additionalProperties": false,
        "required": [
          "evaluationId"
        ]
      },
      "outputSchema": {
        "type": "object",
        "properties": {
          "report": {}
        },
        "additionalProperties": false,
        "required": [
          "report"
        ]
      },
      "authorization": [
        "invest.read"
      ],
      "idempotency": "unsupported",
      "concurrency": {
        "mode": "parallel"
      },
      "definitions": [
        {
          "version": 1,
          "description": "Evaluation report: manifest, findings with reviewer actions applied, open diligence requests, decision history and decision blockers.",
          "kind": "request",
          "inputSchema": {
            "type": "object",
            "properties": {
              "evaluationId": {
                "type": "string"
              }
            },
            "additionalProperties": false,
            "required": [
              "evaluationId"
            ]
          },
          "outputSchema": {
            "type": "object",
            "properties": {
              "report": {}
            },
            "additionalProperties": false,
            "required": [
              "report"
            ]
          },
          "authorization": [
            "invest.read"
          ],
          "idempotency": "unsupported",
          "concurrency": {
            "mode": "parallel"
          }
        }
      ]
    },
    {
      "name": "evaluation.list",
      "versions": [
        1
      ],
      "latestVersion": 1,
      "description": "Evaluations with status, summary and current decision.",
      "kind": "request",
      "inputSchema": {
        "type": "object",
        "properties": {
          "startupId": {
            "type": "string"
          }
        },
        "additionalProperties": false
      },
      "outputSchema": {
        "type": "object",
        "properties": {
          "items": {}
        },
        "additionalProperties": false,
        "required": [
          "items"
        ]
      },
      "authorization": [
        "invest.read"
      ],
      "idempotency": "unsupported",
      "concurrency": {
        "mode": "parallel"
      },
      "definitions": [
        {
          "version": 1,
          "description": "Evaluations with status, summary and current decision.",
          "kind": "request",
          "inputSchema": {
            "type": "object",
            "properties": {
              "startupId": {
                "type": "string"
              }
            },
            "additionalProperties": false
          },
          "outputSchema": {
            "type": "object",
            "properties": {
              "items": {}
            },
            "additionalProperties": false,
            "required": [
              "items"
            ]
          },
          "authorization": [
            "invest.read"
          ],
          "idempotency": "unsupported",
          "concurrency": {
            "mode": "parallel"
          }
        }
      ]
    },
    {
      "name": "evaluation.rerun",
      "versions": [
        1
      ],
      "latestVersion": 1,
      "description": "Creates a new evaluation linked to its predecessor. The predecessor is never modified.",
      "kind": "request",
      "inputSchema": {
        "type": "object",
        "properties": {
          "evaluationId": {
            "type": "string"
          },
          "requestKey": {
            "type": "string"
          },
          "thesisVersionId": {
            "type": "string"
          }
        },
        "additionalProperties": false,
        "required": [
          "evaluationId",
          "requestKey"
        ]
      },
      "outputSchema": {
        "type": "object",
        "properties": {
          "evaluation": {}
        },
        "additionalProperties": false,
        "required": [
          "evaluation"
        ]
      },
      "authorization": [
        "evaluation.run"
      ],
      "idempotency": "supported",
      "concurrency": {
        "mode": "parallel"
      },
      "definitions": [
        {
          "version": 1,
          "description": "Creates a new evaluation linked to its predecessor. The predecessor is never modified.",
          "kind": "request",
          "inputSchema": {
            "type": "object",
            "properties": {
              "evaluationId": {
                "type": "string"
              },
              "requestKey": {
                "type": "string"
              },
              "thesisVersionId": {
                "type": "string"
              }
            },
            "additionalProperties": false,
            "required": [
              "evaluationId",
              "requestKey"
            ]
          },
          "outputSchema": {
            "type": "object",
            "properties": {
              "evaluation": {}
            },
            "additionalProperties": false,
            "required": [
              "evaluation"
            ]
          },
          "authorization": [
            "evaluation.run"
          ],
          "idempotency": "supported",
          "concurrency": {
            "mode": "parallel"
          }
        }
      ]
    },
    {
      "name": "evaluation.start",
      "versions": [
        1
      ],
      "latestVersion": 1,
      "description": "Evaluates a startup against an explicitly selected thesis version. Runs asynchronously; poll evaluation.get.",
      "kind": "request",
      "inputSchema": {
        "type": "object",
        "properties": {
          "startupId": {
            "type": "string"
          },
          "thesisVersionId": {
            "type": "string"
          },
          "requestKey": {
            "type": "string"
          }
        },
        "additionalProperties": false,
        "required": [
          "startupId",
          "thesisVersionId",
          "requestKey"
        ]
      },
      "outputSchema": {
        "type": "object",
        "properties": {
          "evaluation": {}
        },
        "additionalProperties": false,
        "required": [
          "evaluation"
        ]
      },
      "authorization": [
        "evaluation.run"
      ],
      "idempotency": "supported",
      "concurrency": {
        "mode": "parallel"
      },
      "definitions": [
        {
          "version": 1,
          "description": "Evaluates a startup against an explicitly selected thesis version. Runs asynchronously; poll evaluation.get.",
          "kind": "request",
          "inputSchema": {
            "type": "object",
            "properties": {
              "startupId": {
                "type": "string"
              },
              "thesisVersionId": {
                "type": "string"
              },
              "requestKey": {
                "type": "string"
              }
            },
            "additionalProperties": false,
            "required": [
              "startupId",
              "thesisVersionId",
              "requestKey"
            ]
          },
          "outputSchema": {
            "type": "object",
            "properties": {
              "evaluation": {}
            },
            "additionalProperties": false,
            "required": [
              "evaluation"
            ]
          },
          "authorization": [
            "evaluation.run"
          ],
          "idempotency": "supported",
          "concurrency": {
            "mode": "parallel"
          }
        }
      ]
    },
    {
      "name": "evaluation.verify",
      "versions": [
        1
      ],
      "latestVersion": 1,
      "description": "Independently recomputes the manifest digest, projections, question digests and every policy outcome of a stored evaluation.",
      "kind": "request",
      "inputSchema": {
        "type": "object",
        "properties": {
          "evaluationId": {
            "type": "string"
          }
        },
        "additionalProperties": false,
        "required": [
          "evaluationId"
        ]
      },
      "outputSchema": {
        "type": "object",
        "properties": {
          "ok": {},
          "checks": {}
        },
        "additionalProperties": false,
        "required": [
          "ok",
          "checks"
        ]
      },
      "authorization": [
        "invest.read"
      ],
      "idempotency": "unsupported",
      "concurrency": {
        "mode": "parallel"
      },
      "definitions": [
        {
          "version": 1,
          "description": "Independently recomputes the manifest digest, projections, question digests and every policy outcome of a stored evaluation.",
          "kind": "request",
          "inputSchema": {
            "type": "object",
            "properties": {
              "evaluationId": {
                "type": "string"
              }
            },
            "additionalProperties": false,
            "required": [
              "evaluationId"
            ]
          },
          "outputSchema": {
            "type": "object",
            "properties": {
              "ok": {},
              "checks": {}
            },
            "additionalProperties": false,
            "required": [
              "ok",
              "checks"
            ]
          },
          "authorization": [
            "invest.read"
          ],
          "idempotency": "unsupported",
          "concurrency": {
            "mode": "parallel"
          }
        }
      ]
    },
    {
      "name": "evidence.attach",
      "versions": [
        1
      ],
      "latestVersion": 1,
      "description": "Attaches evidence a reviewer verified directly, with how it was verified.",
      "kind": "request",
      "inputSchema": {
        "type": "object",
        "properties": {
          "startupId": {
            "type": "string"
          },
          "claim": {
            "type": "string"
          },
          "reference": {
            "type": "string"
          },
          "metric": {
            "type": "object",
            "properties": {
              "key": {
                "type": "string",
                "enum": [
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
                  "churn_pct"
                ]
              },
              "value": {
                "type": "number"
              }
            },
            "additionalProperties": false,
            "required": [
              "key",
              "value"
            ]
          }
        },
        "additionalProperties": false,
        "required": [
          "startupId",
          "claim",
          "reference"
        ]
      },
      "outputSchema": {
        "type": "object",
        "properties": {
          "item": {}
        },
        "additionalProperties": false,
        "required": [
          "item"
        ]
      },
      "authorization": [
        "evidence.write"
      ],
      "idempotency": "unsupported",
      "concurrency": {
        "mode": "parallel"
      },
      "definitions": [
        {
          "version": 1,
          "description": "Attaches evidence a reviewer verified directly, with how it was verified.",
          "kind": "request",
          "inputSchema": {
            "type": "object",
            "properties": {
              "startupId": {
                "type": "string"
              },
              "claim": {
                "type": "string"
              },
              "reference": {
                "type": "string"
              },
              "metric": {
                "type": "object",
                "properties": {
                  "key": {
                    "type": "string",
                    "enum": [
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
                      "churn_pct"
                    ]
                  },
                  "value": {
                    "type": "number"
                  }
                },
                "additionalProperties": false,
                "required": [
                  "key",
                  "value"
                ]
              }
            },
            "additionalProperties": false,
            "required": [
              "startupId",
              "claim",
              "reference"
            ]
          },
          "outputSchema": {
            "type": "object",
            "properties": {
              "item": {}
            },
            "additionalProperties": false,
            "required": [
              "item"
            ]
          },
          "authorization": [
            "evidence.write"
          ],
          "idempotency": "unsupported",
          "concurrency": {
            "mode": "parallel"
          }
        }
      ]
    },
    {
      "name": "evidence.get",
      "versions": [
        1
      ],
      "latestVersion": 1,
      "description": "One claim's provenance: source document, hash, page and coordinates, and cross-source verification.",
      "kind": "request",
      "inputSchema": {
        "type": "object",
        "properties": {
          "evidenceId": {
            "type": "string"
          }
        },
        "additionalProperties": false,
        "required": [
          "evidenceId"
        ]
      },
      "outputSchema": {
        "type": "object",
        "properties": {
          "item": {},
          "document": {}
        },
        "additionalProperties": false,
        "required": [
          "item",
          "document"
        ]
      },
      "authorization": [
        "invest.read"
      ],
      "idempotency": "unsupported",
      "concurrency": {
        "mode": "parallel"
      },
      "definitions": [
        {
          "version": 1,
          "description": "One claim's provenance: source document, hash, page and coordinates, and cross-source verification.",
          "kind": "request",
          "inputSchema": {
            "type": "object",
            "properties": {
              "evidenceId": {
                "type": "string"
              }
            },
            "additionalProperties": false,
            "required": [
              "evidenceId"
            ]
          },
          "outputSchema": {
            "type": "object",
            "properties": {
              "item": {},
              "document": {}
            },
            "additionalProperties": false,
            "required": [
              "item",
              "document"
            ]
          },
          "authorization": [
            "invest.read"
          ],
          "idempotency": "unsupported",
          "concurrency": {
            "mode": "parallel"
          }
        }
      ]
    },
    {
      "name": "evidence.list",
      "versions": [
        1
      ],
      "latestVersion": 1,
      "description": "Claims for a startup with provenance, derived verification and contradictions.",
      "kind": "request",
      "inputSchema": {
        "type": "object",
        "properties": {
          "startupId": {
            "type": "string"
          }
        },
        "additionalProperties": false,
        "required": [
          "startupId"
        ]
      },
      "outputSchema": {
        "type": "object",
        "properties": {
          "items": {},
          "contradictions": {}
        },
        "additionalProperties": false,
        "required": [
          "items",
          "contradictions"
        ]
      },
      "authorization": [
        "invest.read"
      ],
      "idempotency": "unsupported",
      "concurrency": {
        "mode": "parallel"
      },
      "definitions": [
        {
          "version": 1,
          "description": "Claims for a startup with provenance, derived verification and contradictions.",
          "kind": "request",
          "inputSchema": {
            "type": "object",
            "properties": {
              "startupId": {
                "type": "string"
              }
            },
            "additionalProperties": false,
            "required": [
              "startupId"
            ]
          },
          "outputSchema": {
            "type": "object",
            "properties": {
              "items": {},
              "contradictions": {}
            },
            "additionalProperties": false,
            "required": [
              "items",
              "contradictions"
            ]
          },
          "authorization": [
            "invest.read"
          ],
          "idempotency": "unsupported",
          "concurrency": {
            "mode": "parallel"
          }
        }
      ]
    },
    {
      "name": "firm.approval.withdraw",
      "versions": [
        1
      ],
      "latestVersion": 1,
      "description": "Withdraws an investor-verified criterion by appending a withdrawal; the approval stays in the history.",
      "kind": "request",
      "inputSchema": {
        "type": "object",
        "properties": {
          "firmId": {
            "type": "string"
          },
          "approvalId": {
            "type": "string"
          },
          "note": {
            "type": "string"
          }
        },
        "additionalProperties": false,
        "required": [
          "firmId",
          "approvalId",
          "note"
        ]
      },
      "outputSchema": {
        "type": "object",
        "properties": {
          "approval": {}
        },
        "additionalProperties": false,
        "required": [
          "approval"
        ]
      },
      "authorization": [
        "thesis.approve"
      ],
      "idempotency": "unsupported",
      "concurrency": {
        "mode": "parallel"
      },
      "definitions": [
        {
          "version": 1,
          "description": "Withdraws an investor-verified criterion by appending a withdrawal; the approval stays in the history.",
          "kind": "request",
          "inputSchema": {
            "type": "object",
            "properties": {
              "firmId": {
                "type": "string"
              },
              "approvalId": {
                "type": "string"
              },
              "note": {
                "type": "string"
              }
            },
            "additionalProperties": false,
            "required": [
              "firmId",
              "approvalId",
              "note"
            ]
          },
          "outputSchema": {
            "type": "object",
            "properties": {
              "approval": {}
            },
            "additionalProperties": false,
            "required": [
              "approval"
            ]
          },
          "authorization": [
            "thesis.approve"
          ],
          "idempotency": "unsupported",
          "concurrency": {
            "mode": "parallel"
          }
        }
      ]
    },
    {
      "name": "firm.approve",
      "versions": [
        1
      ],
      "latestVersion": 1,
      "description": "Records an investor-verified criterion for a firm, from a research criterion or entered by hand. The only way research becomes investor-verified; requires thesis.approve.",
      "kind": "request",
      "inputSchema": {
        "type": "object",
        "properties": {
          "firmId": {
            "type": "string"
          },
          "criterionId": {
            "type": "string"
          },
          "field": {
            "type": "string",
            "enum": [
              "stage",
              "sector",
              "geography",
              "check_size",
              "business_model",
              "company_characteristics",
              "exclusion",
              "traction",
              "application_requirements"
            ]
          },
          "polarity": {
            "type": "string",
            "enum": [
              "include",
              "exclude"
            ]
          },
          "value": {
            "type": "string"
          },
          "minUsd": {
            "type": "number"
          },
          "maxUsd": {
            "type": "number"
          },
          "note": {
            "type": "string"
          }
        },
        "additionalProperties": false,
        "required": [
          "firmId",
          "note"
        ]
      },
      "outputSchema": {
        "type": "object",
        "properties": {
          "approval": {}
        },
        "additionalProperties": false,
        "required": [
          "approval"
        ]
      },
      "authorization": [
        "thesis.approve"
      ],
      "idempotency": "unsupported",
      "concurrency": {
        "mode": "parallel"
      },
      "definitions": [
        {
          "version": 1,
          "description": "Records an investor-verified criterion for a firm, from a research criterion or entered by hand. The only way research becomes investor-verified; requires thesis.approve.",
          "kind": "request",
          "inputSchema": {
            "type": "object",
            "properties": {
              "firmId": {
                "type": "string"
              },
              "criterionId": {
                "type": "string"
              },
              "field": {
                "type": "string",
                "enum": [
                  "stage",
                  "sector",
                  "geography",
                  "check_size",
                  "business_model",
                  "company_characteristics",
                  "exclusion",
                  "traction",
                  "application_requirements"
                ]
              },
              "polarity": {
                "type": "string",
                "enum": [
                  "include",
                  "exclude"
                ]
              },
              "value": {
                "type": "string"
              },
              "minUsd": {
                "type": "number"
              },
              "maxUsd": {
                "type": "number"
              },
              "note": {
                "type": "string"
              }
            },
            "additionalProperties": false,
            "required": [
              "firmId",
              "note"
            ]
          },
          "outputSchema": {
            "type": "object",
            "properties": {
              "approval": {}
            },
            "additionalProperties": false,
            "required": [
              "approval"
            ]
          },
          "authorization": [
            "thesis.approve"
          ],
          "idempotency": "unsupported",
          "concurrency": {
            "mode": "parallel"
          }
        }
      ]
    },
    {
      "name": "firm.get",
      "versions": [
        1
      ],
      "latestVersion": 1,
      "description": "One firm profile: criteria with assertion type, source passage, verification and freshness; conflicts; approved criteria; sources checked; run history; reviews.",
      "kind": "request",
      "inputSchema": {
        "type": "object",
        "properties": {
          "firmId": {
            "type": "string"
          }
        },
        "additionalProperties": false,
        "required": [
          "firmId"
        ]
      },
      "outputSchema": {
        "type": "object",
        "properties": {
          "profile": {}
        },
        "additionalProperties": false,
        "required": [
          "profile"
        ]
      },
      "authorization": [
        "invest.read"
      ],
      "idempotency": "unsupported",
      "concurrency": {
        "mode": "parallel"
      },
      "definitions": [
        {
          "version": 1,
          "description": "One firm profile: criteria with assertion type, source passage, verification and freshness; conflicts; approved criteria; sources checked; run history; reviews.",
          "kind": "request",
          "inputSchema": {
            "type": "object",
            "properties": {
              "firmId": {
                "type": "string"
              }
            },
            "additionalProperties": false,
            "required": [
              "firmId"
            ]
          },
          "outputSchema": {
            "type": "object",
            "properties": {
              "profile": {}
            },
            "additionalProperties": false,
            "required": [
              "profile"
            ]
          },
          "authorization": [
            "invest.read"
          ],
          "idempotency": "unsupported",
          "concurrency": {
            "mode": "parallel"
          }
        }
      ]
    },
    {
      "name": "firm.list",
      "versions": [
        1
      ],
      "latestVersion": 1,
      "description": "Investor firm profiles in the caller's workspace, with research status, last research time and criteria counts. Optional search and status filter.",
      "kind": "request",
      "inputSchema": {
        "type": "object",
        "properties": {
          "query": {
            "type": "string"
          },
          "status": {
            "type": "string",
            "enum": [
              "pending",
              "thesis_found",
              "no_thesis_found",
              "research_incomplete"
            ]
          }
        },
        "additionalProperties": false
      },
      "outputSchema": {
        "type": "object",
        "properties": {
          "items": {}
        },
        "additionalProperties": false,
        "required": [
          "items"
        ]
      },
      "authorization": [
        "invest.read"
      ],
      "idempotency": "unsupported",
      "concurrency": {
        "mode": "parallel"
      },
      "definitions": [
        {
          "version": 1,
          "description": "Investor firm profiles in the caller's workspace, with research status, last research time and criteria counts. Optional search and status filter.",
          "kind": "request",
          "inputSchema": {
            "type": "object",
            "properties": {
              "query": {
                "type": "string"
              },
              "status": {
                "type": "string",
                "enum": [
                  "pending",
                  "thesis_found",
                  "no_thesis_found",
                  "research_incomplete"
                ]
              }
            },
            "additionalProperties": false
          },
          "outputSchema": {
            "type": "object",
            "properties": {
              "items": {}
            },
            "additionalProperties": false,
            "required": [
              "items"
            ]
          },
          "authorization": [
            "invest.read"
          ],
          "idempotency": "unsupported",
          "concurrency": {
            "mode": "parallel"
          }
        }
      ]
    },
    {
      "name": "firm.refresh",
      "versions": [
        1
      ],
      "latestVersion": 1,
      "description": "Re-researches one existing firm in this server process within the configured crawl bounds. Accepts only a firm id, never a URL. Returns at once; poll firm.get.",
      "kind": "request",
      "inputSchema": {
        "type": "object",
        "properties": {
          "firmId": {
            "type": "string"
          }
        },
        "additionalProperties": false,
        "required": [
          "firmId"
        ]
      },
      "outputSchema": {
        "type": "object",
        "properties": {
          "firm": {},
          "run": {}
        },
        "additionalProperties": false,
        "required": [
          "firm",
          "run"
        ]
      },
      "authorization": [
        "research.run"
      ],
      "idempotency": "unsupported",
      "concurrency": {
        "mode": "keyed",
        "key": "firmId"
      },
      "definitions": [
        {
          "version": 1,
          "description": "Re-researches one existing firm in this server process within the configured crawl bounds. Accepts only a firm id, never a URL. Returns at once; poll firm.get.",
          "kind": "request",
          "inputSchema": {
            "type": "object",
            "properties": {
              "firmId": {
                "type": "string"
              }
            },
            "additionalProperties": false,
            "required": [
              "firmId"
            ]
          },
          "outputSchema": {
            "type": "object",
            "properties": {
              "firm": {},
              "run": {}
            },
            "additionalProperties": false,
            "required": [
              "firm",
              "run"
            ]
          },
          "authorization": [
            "research.run"
          ],
          "idempotency": "unsupported",
          "concurrency": {
            "mode": "keyed",
            "key": "firmId"
          }
        }
      ]
    },
    {
      "name": "firm.review",
      "versions": [
        1
      ],
      "latestVersion": 1,
      "description": "Flag, dispute, correct or annotate a research result. Recorded as a separate review; the extracted criterion is not changed and is not approved by it.",
      "kind": "request",
      "inputSchema": {
        "type": "object",
        "properties": {
          "firmId": {
            "type": "string"
          },
          "criterionId": {
            "anyOf": [
              {
                "type": "string"
              },
              {
                "type": "null"
              }
            ]
          },
          "action": {
            "type": "string",
            "enum": [
              "flag",
              "dispute",
              "correct",
              "note"
            ]
          },
          "note": {
            "type": "string"
          },
          "correctedValue": {
            "type": "string"
          }
        },
        "additionalProperties": false,
        "required": [
          "firmId",
          "action",
          "note"
        ]
      },
      "outputSchema": {
        "type": "object",
        "properties": {
          "review": {}
        },
        "additionalProperties": false,
        "required": [
          "review"
        ]
      },
      "authorization": [
        "review.write"
      ],
      "idempotency": "unsupported",
      "concurrency": {
        "mode": "parallel"
      },
      "definitions": [
        {
          "version": 1,
          "description": "Flag, dispute, correct or annotate a research result. Recorded as a separate review; the extracted criterion is not changed and is not approved by it.",
          "kind": "request",
          "inputSchema": {
            "type": "object",
            "properties": {
              "firmId": {
                "type": "string"
              },
              "criterionId": {
                "anyOf": [
                  {
                    "type": "string"
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "action": {
                "type": "string",
                "enum": [
                  "flag",
                  "dispute",
                  "correct",
                  "note"
                ]
              },
              "note": {
                "type": "string"
              },
              "correctedValue": {
                "type": "string"
              }
            },
            "additionalProperties": false,
            "required": [
              "firmId",
              "action",
              "note"
            ]
          },
          "outputSchema": {
            "type": "object",
            "properties": {
              "review": {}
            },
            "additionalProperties": false,
            "required": [
              "review"
            ]
          },
          "authorization": [
            "review.write"
          ],
          "idempotency": "unsupported",
          "concurrency": {
            "mode": "parallel"
          }
        }
      ]
    },
    {
      "name": "firm.verify",
      "versions": [
        1
      ],
      "latestVersion": 1,
      "description": "Asks Jev whether each current criterion's captured passage supports its statement. Reports skipped when Jev is not configured; never simulates a result.",
      "kind": "request",
      "inputSchema": {
        "type": "object",
        "properties": {
          "firmId": {
            "type": "string"
          }
        },
        "additionalProperties": false,
        "required": [
          "firmId"
        ]
      },
      "outputSchema": {
        "type": "object",
        "properties": {
          "summary": {}
        },
        "additionalProperties": false,
        "required": [
          "summary"
        ]
      },
      "authorization": [
        "research.run"
      ],
      "idempotency": "unsupported",
      "concurrency": {
        "mode": "parallel"
      },
      "definitions": [
        {
          "version": 1,
          "description": "Asks Jev whether each current criterion's captured passage supports its statement. Reports skipped when Jev is not configured; never simulates a result.",
          "kind": "request",
          "inputSchema": {
            "type": "object",
            "properties": {
              "firmId": {
                "type": "string"
              }
            },
            "additionalProperties": false,
            "required": [
              "firmId"
            ]
          },
          "outputSchema": {
            "type": "object",
            "properties": {
              "summary": {}
            },
            "additionalProperties": false,
            "required": [
              "summary"
            ]
          },
          "authorization": [
            "research.run"
          ],
          "idempotency": "unsupported",
          "concurrency": {
            "mode": "parallel"
          }
        }
      ]
    },
    {
      "name": "review.record",
      "versions": [
        1
      ],
      "latestVersion": 1,
      "description": "Accept a finding, override its outcome (outcome and reason required), or comment. Findings are never edited.",
      "kind": "request",
      "inputSchema": {
        "type": "object",
        "properties": {
          "evaluationId": {
            "type": "string"
          },
          "findingId": {
            "anyOf": [
              {
                "type": "string"
              },
              {
                "type": "null"
              }
            ]
          },
          "action": {
            "type": "string",
            "enum": [
              "accept",
              "override",
              "comment"
            ]
          },
          "outcome": {
            "type": "string",
            "enum": [
              "supported",
              "partially_supported",
              "contradicted",
              "insufficient_evidence",
              "not_applicable",
              "evaluation_failed"
            ]
          },
          "reason": {
            "type": "string"
          }
        },
        "additionalProperties": false,
        "required": [
          "evaluationId",
          "findingId",
          "action"
        ]
      },
      "outputSchema": {
        "type": "object",
        "properties": {
          "action": {}
        },
        "additionalProperties": false,
        "required": [
          "action"
        ]
      },
      "authorization": [
        "review.write"
      ],
      "idempotency": "unsupported",
      "concurrency": {
        "mode": "keyed",
        "key": "evaluationId"
      },
      "definitions": [
        {
          "version": 1,
          "description": "Accept a finding, override its outcome (outcome and reason required), or comment. Findings are never edited.",
          "kind": "request",
          "inputSchema": {
            "type": "object",
            "properties": {
              "evaluationId": {
                "type": "string"
              },
              "findingId": {
                "anyOf": [
                  {
                    "type": "string"
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "action": {
                "type": "string",
                "enum": [
                  "accept",
                  "override",
                  "comment"
                ]
              },
              "outcome": {
                "type": "string",
                "enum": [
                  "supported",
                  "partially_supported",
                  "contradicted",
                  "insufficient_evidence",
                  "not_applicable",
                  "evaluation_failed"
                ]
              },
              "reason": {
                "type": "string"
              }
            },
            "additionalProperties": false,
            "required": [
              "evaluationId",
              "findingId",
              "action"
            ]
          },
          "outputSchema": {
            "type": "object",
            "properties": {
              "action": {}
            },
            "additionalProperties": false,
            "required": [
              "action"
            ]
          },
          "authorization": [
            "review.write"
          ],
          "idempotency": "unsupported",
          "concurrency": {
            "mode": "keyed",
            "key": "evaluationId"
          }
        }
      ]
    },
    {
      "name": "review.request",
      "versions": [
        1
      ],
      "latestVersion": 1,
      "description": "Opens a diligence request (follow-up), optionally tied to a finding and assigned to someone.",
      "kind": "request",
      "inputSchema": {
        "type": "object",
        "properties": {
          "evaluationId": {
            "type": "string"
          },
          "findingId": {
            "anyOf": [
              {
                "type": "string"
              },
              {
                "type": "null"
              }
            ]
          },
          "question": {
            "type": "string"
          },
          "assignee": {
            "type": "string"
          }
        },
        "additionalProperties": false,
        "required": [
          "evaluationId",
          "question"
        ]
      },
      "outputSchema": {
        "type": "object",
        "properties": {
          "action": {}
        },
        "additionalProperties": false,
        "required": [
          "action"
        ]
      },
      "authorization": [
        "review.write"
      ],
      "idempotency": "unsupported",
      "concurrency": {
        "mode": "parallel"
      },
      "definitions": [
        {
          "version": 1,
          "description": "Opens a diligence request (follow-up), optionally tied to a finding and assigned to someone.",
          "kind": "request",
          "inputSchema": {
            "type": "object",
            "properties": {
              "evaluationId": {
                "type": "string"
              },
              "findingId": {
                "anyOf": [
                  {
                    "type": "string"
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "question": {
                "type": "string"
              },
              "assignee": {
                "type": "string"
              }
            },
            "additionalProperties": false,
            "required": [
              "evaluationId",
              "question"
            ]
          },
          "outputSchema": {
            "type": "object",
            "properties": {
              "action": {}
            },
            "additionalProperties": false,
            "required": [
              "action"
            ]
          },
          "authorization": [
            "review.write"
          ],
          "idempotency": "unsupported",
          "concurrency": {
            "mode": "parallel"
          }
        }
      ]
    },
    {
      "name": "review.resolve",
      "versions": [
        1
      ],
      "latestVersion": 1,
      "description": "Resolves a diligence request. A request can be resolved exactly once.",
      "kind": "request",
      "inputSchema": {
        "type": "object",
        "properties": {
          "evaluationId": {
            "type": "string"
          },
          "requestId": {
            "type": "string"
          },
          "resolution": {
            "type": "string"
          }
        },
        "additionalProperties": false,
        "required": [
          "evaluationId",
          "requestId",
          "resolution"
        ]
      },
      "outputSchema": {
        "type": "object",
        "properties": {
          "action": {}
        },
        "additionalProperties": false,
        "required": [
          "action"
        ]
      },
      "authorization": [
        "review.write"
      ],
      "idempotency": "unsupported",
      "concurrency": {
        "mode": "parallel"
      },
      "definitions": [
        {
          "version": 1,
          "description": "Resolves a diligence request. A request can be resolved exactly once.",
          "kind": "request",
          "inputSchema": {
            "type": "object",
            "properties": {
              "evaluationId": {
                "type": "string"
              },
              "requestId": {
                "type": "string"
              },
              "resolution": {
                "type": "string"
              }
            },
            "additionalProperties": false,
            "required": [
              "evaluationId",
              "requestId",
              "resolution"
            ]
          },
          "outputSchema": {
            "type": "object",
            "properties": {
              "action": {}
            },
            "additionalProperties": false,
            "required": [
              "action"
            ]
          },
          "authorization": [
            "review.write"
          ],
          "idempotency": "unsupported",
          "concurrency": {
            "mode": "parallel"
          }
        }
      ]
    },
    {
      "name": "session.whoami",
      "versions": [
        1
      ],
      "latestVersion": 1,
      "description": "The authenticated principal, its workspace and permissions, and the configured Jev identity (never credentials).",
      "kind": "request",
      "inputSchema": {
        "type": "object",
        "properties": {},
        "additionalProperties": false
      },
      "outputSchema": {
        "type": "object",
        "properties": {
          "principal": {},
          "jev": {}
        },
        "additionalProperties": false,
        "required": [
          "principal",
          "jev"
        ]
      },
      "authorization": [
        "invest.read"
      ],
      "idempotency": "unsupported",
      "concurrency": {
        "mode": "parallel"
      },
      "definitions": [
        {
          "version": 1,
          "description": "The authenticated principal, its workspace and permissions, and the configured Jev identity (never credentials).",
          "kind": "request",
          "inputSchema": {
            "type": "object",
            "properties": {},
            "additionalProperties": false
          },
          "outputSchema": {
            "type": "object",
            "properties": {
              "principal": {},
              "jev": {}
            },
            "additionalProperties": false,
            "required": [
              "principal",
              "jev"
            ]
          },
          "authorization": [
            "invest.read"
          ],
          "idempotency": "unsupported",
          "concurrency": {
            "mode": "parallel"
          }
        }
      ]
    },
    {
      "name": "startup.create",
      "versions": [
        1
      ],
      "latestVersion": 1,
      "description": "Creates a startup profile. Founder claims are recorded as founder-reported evidence.",
      "kind": "request",
      "inputSchema": {
        "type": "object",
        "properties": {
          "name": {
            "type": "string"
          },
          "website": {
            "type": "string"
          },
          "stage": {
            "type": "string"
          },
          "sector": {
            "type": "string"
          },
          "description": {
            "type": "string"
          },
          "founderClaims": {
            "type": "array",
            "items": {
              "type": "string"
            },
            "maxItems": 50
          }
        },
        "additionalProperties": false,
        "required": [
          "name"
        ]
      },
      "outputSchema": {
        "type": "object",
        "properties": {
          "startup": {}
        },
        "additionalProperties": false,
        "required": [
          "startup"
        ]
      },
      "authorization": [
        "startup.write"
      ],
      "idempotency": "unsupported",
      "concurrency": {
        "mode": "parallel"
      },
      "definitions": [
        {
          "version": 1,
          "description": "Creates a startup profile. Founder claims are recorded as founder-reported evidence.",
          "kind": "request",
          "inputSchema": {
            "type": "object",
            "properties": {
              "name": {
                "type": "string"
              },
              "website": {
                "type": "string"
              },
              "stage": {
                "type": "string"
              },
              "sector": {
                "type": "string"
              },
              "description": {
                "type": "string"
              },
              "founderClaims": {
                "type": "array",
                "items": {
                  "type": "string"
                },
                "maxItems": 50
              }
            },
            "additionalProperties": false,
            "required": [
              "name"
            ]
          },
          "outputSchema": {
            "type": "object",
            "properties": {
              "startup": {}
            },
            "additionalProperties": false,
            "required": [
              "startup"
            ]
          },
          "authorization": [
            "startup.write"
          ],
          "idempotency": "unsupported",
          "concurrency": {
            "mode": "parallel"
          }
        }
      ]
    },
    {
      "name": "startup.get",
      "versions": [
        1
      ],
      "latestVersion": 1,
      "description": "Startup and evidence workspace: profile, documents, evidence with provenance, contradictions, evaluations, decisions, and gaps against an optional thesis version.",
      "kind": "request",
      "inputSchema": {
        "type": "object",
        "properties": {
          "startupId": {
            "type": "string"
          },
          "thesisVersionId": {
            "type": "string"
          }
        },
        "additionalProperties": false,
        "required": [
          "startupId"
        ]
      },
      "outputSchema": {
        "type": "object",
        "properties": {
          "workspace": {}
        },
        "additionalProperties": false,
        "required": [
          "workspace"
        ]
      },
      "authorization": [
        "invest.read"
      ],
      "idempotency": "unsupported",
      "concurrency": {
        "mode": "parallel"
      },
      "definitions": [
        {
          "version": 1,
          "description": "Startup and evidence workspace: profile, documents, evidence with provenance, contradictions, evaluations, decisions, and gaps against an optional thesis version.",
          "kind": "request",
          "inputSchema": {
            "type": "object",
            "properties": {
              "startupId": {
                "type": "string"
              },
              "thesisVersionId": {
                "type": "string"
              }
            },
            "additionalProperties": false,
            "required": [
              "startupId"
            ]
          },
          "outputSchema": {
            "type": "object",
            "properties": {
              "workspace": {}
            },
            "additionalProperties": false,
            "required": [
              "workspace"
            ]
          },
          "authorization": [
            "invest.read"
          ],
          "idempotency": "unsupported",
          "concurrency": {
            "mode": "parallel"
          }
        }
      ]
    },
    {
      "name": "startup.list",
      "versions": [
        1
      ],
      "latestVersion": 1,
      "description": "Startups in the caller's workspace.",
      "kind": "request",
      "inputSchema": {
        "type": "object",
        "properties": {},
        "additionalProperties": false
      },
      "outputSchema": {
        "type": "object",
        "properties": {
          "items": {}
        },
        "additionalProperties": false,
        "required": [
          "items"
        ]
      },
      "authorization": [
        "invest.read"
      ],
      "idempotency": "unsupported",
      "concurrency": {
        "mode": "parallel"
      },
      "definitions": [
        {
          "version": 1,
          "description": "Startups in the caller's workspace.",
          "kind": "request",
          "inputSchema": {
            "type": "object",
            "properties": {},
            "additionalProperties": false
          },
          "outputSchema": {
            "type": "object",
            "properties": {
              "items": {}
            },
            "additionalProperties": false,
            "required": [
              "items"
            ]
          },
          "authorization": [
            "invest.read"
          ],
          "idempotency": "unsupported",
          "concurrency": {
            "mode": "parallel"
          }
        }
      ]
    },
    {
      "name": "startup.update",
      "versions": [
        1
      ],
      "latestVersion": 1,
      "description": "Updates a startup profile, fenced on expectedVersion.",
      "kind": "request",
      "inputSchema": {
        "type": "object",
        "properties": {
          "startupId": {
            "type": "string"
          },
          "expectedVersion": {
            "type": "integer"
          },
          "name": {
            "type": "string"
          },
          "website": {
            "type": "string"
          },
          "stage": {
            "type": "string"
          },
          "sector": {
            "type": "string"
          },
          "description": {
            "type": "string"
          },
          "founderClaims": {
            "type": "array",
            "items": {
              "type": "string"
            },
            "maxItems": 50
          }
        },
        "additionalProperties": false,
        "required": [
          "startupId",
          "expectedVersion",
          "name"
        ]
      },
      "outputSchema": {
        "type": "object",
        "properties": {
          "startup": {}
        },
        "additionalProperties": false,
        "required": [
          "startup"
        ]
      },
      "authorization": [
        "startup.write"
      ],
      "idempotency": "unsupported",
      "concurrency": {
        "mode": "keyed",
        "key": "startupId"
      },
      "definitions": [
        {
          "version": 1,
          "description": "Updates a startup profile, fenced on expectedVersion.",
          "kind": "request",
          "inputSchema": {
            "type": "object",
            "properties": {
              "startupId": {
                "type": "string"
              },
              "expectedVersion": {
                "type": "integer"
              },
              "name": {
                "type": "string"
              },
              "website": {
                "type": "string"
              },
              "stage": {
                "type": "string"
              },
              "sector": {
                "type": "string"
              },
              "description": {
                "type": "string"
              },
              "founderClaims": {
                "type": "array",
                "items": {
                  "type": "string"
                },
                "maxItems": 50
              }
            },
            "additionalProperties": false,
            "required": [
              "startupId",
              "expectedVersion",
              "name"
            ]
          },
          "outputSchema": {
            "type": "object",
            "properties": {
              "startup": {}
            },
            "additionalProperties": false,
            "required": [
              "startup"
            ]
          },
          "authorization": [
            "startup.write"
          ],
          "idempotency": "unsupported",
          "concurrency": {
            "mode": "keyed",
            "key": "startupId"
          }
        }
      ]
    },
    {
      "name": "thesis.approve",
      "versions": [
        1
      ],
      "latestVersion": 1,
      "description": "Freezes the draft as the next immutable version. Previous versions are never modified.",
      "kind": "request",
      "inputSchema": {
        "type": "object",
        "properties": {
          "thesisId": {
            "type": "string"
          },
          "expectedVersion": {
            "type": "integer"
          },
          "note": {
            "type": "string"
          }
        },
        "additionalProperties": false,
        "required": [
          "thesisId",
          "expectedVersion"
        ]
      },
      "outputSchema": {
        "type": "object",
        "properties": {
          "thesis": {},
          "version": {}
        },
        "additionalProperties": false,
        "required": [
          "thesis",
          "version"
        ]
      },
      "authorization": [
        "thesis.approve"
      ],
      "idempotency": "unsupported",
      "concurrency": {
        "mode": "keyed",
        "key": "thesisId"
      },
      "definitions": [
        {
          "version": 1,
          "description": "Freezes the draft as the next immutable version. Previous versions are never modified.",
          "kind": "request",
          "inputSchema": {
            "type": "object",
            "properties": {
              "thesisId": {
                "type": "string"
              },
              "expectedVersion": {
                "type": "integer"
              },
              "note": {
                "type": "string"
              }
            },
            "additionalProperties": false,
            "required": [
              "thesisId",
              "expectedVersion"
            ]
          },
          "outputSchema": {
            "type": "object",
            "properties": {
              "thesis": {},
              "version": {}
            },
            "additionalProperties": false,
            "required": [
              "thesis",
              "version"
            ]
          },
          "authorization": [
            "thesis.approve"
          ],
          "idempotency": "unsupported",
          "concurrency": {
            "mode": "keyed",
            "key": "thesisId"
          }
        }
      ]
    },
    {
      "name": "thesis.create",
      "versions": [
        1
      ],
      "latestVersion": 1,
      "description": "Creates a thesis with a draft. Nothing is evaluable until a version is approved.",
      "kind": "request",
      "inputSchema": {
        "type": "object",
        "properties": {
          "name": {
            "type": "string"
          },
          "description": {
            "type": "string"
          },
          "criteria": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "id": {
                  "type": "string"
                },
                "name": {
                  "type": "string"
                },
                "requirement": {
                  "type": "string"
                },
                "evaluationMode": {
                  "type": "string",
                  "enum": [
                    "semantic",
                    "deterministic",
                    "human_review"
                  ]
                },
                "importance": {
                  "type": "number"
                },
                "requiredEvidence": {
                  "type": "array",
                  "items": {
                    "type": "string"
                  },
                  "maxItems": 20
                },
                "threshold": {
                  "type": "number"
                },
                "hardGate": {
                  "type": "boolean"
                },
                "missingEvidencePolicy": {
                  "type": "string",
                  "enum": [
                    "unknown",
                    "review_required"
                  ]
                },
                "disqualifier": {
                  "type": "string"
                },
                "metric": {
                  "type": "string",
                  "enum": [
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
                    "churn_pct"
                  ]
                },
                "comparator": {
                  "type": "string",
                  "enum": [
                    "gte",
                    "gt",
                    "lte",
                    "lt",
                    "eq"
                  ]
                },
                "evidenceStandard": {
                  "type": "string",
                  "enum": [
                    "founder_reported_ok",
                    "independent_required"
                  ]
                }
              },
              "additionalProperties": false,
              "required": [
                "id",
                "name",
                "requirement",
                "evaluationMode",
                "importance",
                "requiredEvidence",
                "hardGate",
                "missingEvidencePolicy"
              ]
            },
            "maxItems": 50
          },
          "settings": {
            "type": "object",
            "properties": {
              "showWeightedSummary": {
                "type": "boolean"
              },
              "reviewConfidenceThreshold": {
                "type": "number"
              }
            },
            "additionalProperties": false,
            "required": [
              "showWeightedSummary",
              "reviewConfidenceThreshold"
            ]
          }
        },
        "additionalProperties": false,
        "required": [
          "name",
          "criteria"
        ]
      },
      "outputSchema": {
        "type": "object",
        "properties": {
          "thesis": {}
        },
        "additionalProperties": false,
        "required": [
          "thesis"
        ]
      },
      "authorization": [
        "thesis.write"
      ],
      "idempotency": "unsupported",
      "concurrency": {
        "mode": "parallel"
      },
      "definitions": [
        {
          "version": 1,
          "description": "Creates a thesis with a draft. Nothing is evaluable until a version is approved.",
          "kind": "request",
          "inputSchema": {
            "type": "object",
            "properties": {
              "name": {
                "type": "string"
              },
              "description": {
                "type": "string"
              },
              "criteria": {
                "type": "array",
                "items": {
                  "type": "object",
                  "properties": {
                    "id": {
                      "type": "string"
                    },
                    "name": {
                      "type": "string"
                    },
                    "requirement": {
                      "type": "string"
                    },
                    "evaluationMode": {
                      "type": "string",
                      "enum": [
                        "semantic",
                        "deterministic",
                        "human_review"
                      ]
                    },
                    "importance": {
                      "type": "number"
                    },
                    "requiredEvidence": {
                      "type": "array",
                      "items": {
                        "type": "string"
                      },
                      "maxItems": 20
                    },
                    "threshold": {
                      "type": "number"
                    },
                    "hardGate": {
                      "type": "boolean"
                    },
                    "missingEvidencePolicy": {
                      "type": "string",
                      "enum": [
                        "unknown",
                        "review_required"
                      ]
                    },
                    "disqualifier": {
                      "type": "string"
                    },
                    "metric": {
                      "type": "string",
                      "enum": [
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
                        "churn_pct"
                      ]
                    },
                    "comparator": {
                      "type": "string",
                      "enum": [
                        "gte",
                        "gt",
                        "lte",
                        "lt",
                        "eq"
                      ]
                    },
                    "evidenceStandard": {
                      "type": "string",
                      "enum": [
                        "founder_reported_ok",
                        "independent_required"
                      ]
                    }
                  },
                  "additionalProperties": false,
                  "required": [
                    "id",
                    "name",
                    "requirement",
                    "evaluationMode",
                    "importance",
                    "requiredEvidence",
                    "hardGate",
                    "missingEvidencePolicy"
                  ]
                },
                "maxItems": 50
              },
              "settings": {
                "type": "object",
                "properties": {
                  "showWeightedSummary": {
                    "type": "boolean"
                  },
                  "reviewConfidenceThreshold": {
                    "type": "number"
                  }
                },
                "additionalProperties": false,
                "required": [
                  "showWeightedSummary",
                  "reviewConfidenceThreshold"
                ]
              }
            },
            "additionalProperties": false,
            "required": [
              "name",
              "criteria"
            ]
          },
          "outputSchema": {
            "type": "object",
            "properties": {
              "thesis": {}
            },
            "additionalProperties": false,
            "required": [
              "thesis"
            ]
          },
          "authorization": [
            "thesis.write"
          ],
          "idempotency": "unsupported",
          "concurrency": {
            "mode": "parallel"
          }
        }
      ]
    },
    {
      "name": "thesis.draft.discard",
      "versions": [
        1
      ],
      "latestVersion": 1,
      "description": "Discards the draft of a thesis that already has an approved version.",
      "kind": "request",
      "inputSchema": {
        "type": "object",
        "properties": {
          "thesisId": {
            "type": "string"
          },
          "expectedVersion": {
            "type": "integer"
          }
        },
        "additionalProperties": false,
        "required": [
          "thesisId",
          "expectedVersion"
        ]
      },
      "outputSchema": {
        "type": "object",
        "properties": {
          "thesis": {}
        },
        "additionalProperties": false,
        "required": [
          "thesis"
        ]
      },
      "authorization": [
        "thesis.write"
      ],
      "idempotency": "unsupported",
      "concurrency": {
        "mode": "keyed",
        "key": "thesisId"
      },
      "definitions": [
        {
          "version": 1,
          "description": "Discards the draft of a thesis that already has an approved version.",
          "kind": "request",
          "inputSchema": {
            "type": "object",
            "properties": {
              "thesisId": {
                "type": "string"
              },
              "expectedVersion": {
                "type": "integer"
              }
            },
            "additionalProperties": false,
            "required": [
              "thesisId",
              "expectedVersion"
            ]
          },
          "outputSchema": {
            "type": "object",
            "properties": {
              "thesis": {}
            },
            "additionalProperties": false,
            "required": [
              "thesis"
            ]
          },
          "authorization": [
            "thesis.write"
          ],
          "idempotency": "unsupported",
          "concurrency": {
            "mode": "keyed",
            "key": "thesisId"
          }
        }
      ]
    },
    {
      "name": "thesis.draft.update",
      "versions": [
        1
      ],
      "latestVersion": 1,
      "description": "Replaces the draft. Fenced on expectedVersion; a stale editor gets CONFLICT instead of overwriting.",
      "kind": "request",
      "inputSchema": {
        "type": "object",
        "properties": {
          "thesisId": {
            "type": "string"
          },
          "expectedVersion": {
            "type": "integer"
          },
          "name": {
            "type": "string"
          },
          "description": {
            "type": "string"
          },
          "criteria": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "id": {
                  "type": "string"
                },
                "name": {
                  "type": "string"
                },
                "requirement": {
                  "type": "string"
                },
                "evaluationMode": {
                  "type": "string",
                  "enum": [
                    "semantic",
                    "deterministic",
                    "human_review"
                  ]
                },
                "importance": {
                  "type": "number"
                },
                "requiredEvidence": {
                  "type": "array",
                  "items": {
                    "type": "string"
                  },
                  "maxItems": 20
                },
                "threshold": {
                  "type": "number"
                },
                "hardGate": {
                  "type": "boolean"
                },
                "missingEvidencePolicy": {
                  "type": "string",
                  "enum": [
                    "unknown",
                    "review_required"
                  ]
                },
                "disqualifier": {
                  "type": "string"
                },
                "metric": {
                  "type": "string",
                  "enum": [
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
                    "churn_pct"
                  ]
                },
                "comparator": {
                  "type": "string",
                  "enum": [
                    "gte",
                    "gt",
                    "lte",
                    "lt",
                    "eq"
                  ]
                },
                "evidenceStandard": {
                  "type": "string",
                  "enum": [
                    "founder_reported_ok",
                    "independent_required"
                  ]
                }
              },
              "additionalProperties": false,
              "required": [
                "id",
                "name",
                "requirement",
                "evaluationMode",
                "importance",
                "requiredEvidence",
                "hardGate",
                "missingEvidencePolicy"
              ]
            },
            "maxItems": 50
          },
          "settings": {
            "type": "object",
            "properties": {
              "showWeightedSummary": {
                "type": "boolean"
              },
              "reviewConfidenceThreshold": {
                "type": "number"
              }
            },
            "additionalProperties": false,
            "required": [
              "showWeightedSummary",
              "reviewConfidenceThreshold"
            ]
          }
        },
        "additionalProperties": false,
        "required": [
          "thesisId",
          "expectedVersion",
          "criteria"
        ]
      },
      "outputSchema": {
        "type": "object",
        "properties": {
          "thesis": {}
        },
        "additionalProperties": false,
        "required": [
          "thesis"
        ]
      },
      "authorization": [
        "thesis.write"
      ],
      "idempotency": "unsupported",
      "concurrency": {
        "mode": "keyed",
        "key": "thesisId"
      },
      "definitions": [
        {
          "version": 1,
          "description": "Replaces the draft. Fenced on expectedVersion; a stale editor gets CONFLICT instead of overwriting.",
          "kind": "request",
          "inputSchema": {
            "type": "object",
            "properties": {
              "thesisId": {
                "type": "string"
              },
              "expectedVersion": {
                "type": "integer"
              },
              "name": {
                "type": "string"
              },
              "description": {
                "type": "string"
              },
              "criteria": {
                "type": "array",
                "items": {
                  "type": "object",
                  "properties": {
                    "id": {
                      "type": "string"
                    },
                    "name": {
                      "type": "string"
                    },
                    "requirement": {
                      "type": "string"
                    },
                    "evaluationMode": {
                      "type": "string",
                      "enum": [
                        "semantic",
                        "deterministic",
                        "human_review"
                      ]
                    },
                    "importance": {
                      "type": "number"
                    },
                    "requiredEvidence": {
                      "type": "array",
                      "items": {
                        "type": "string"
                      },
                      "maxItems": 20
                    },
                    "threshold": {
                      "type": "number"
                    },
                    "hardGate": {
                      "type": "boolean"
                    },
                    "missingEvidencePolicy": {
                      "type": "string",
                      "enum": [
                        "unknown",
                        "review_required"
                      ]
                    },
                    "disqualifier": {
                      "type": "string"
                    },
                    "metric": {
                      "type": "string",
                      "enum": [
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
                        "churn_pct"
                      ]
                    },
                    "comparator": {
                      "type": "string",
                      "enum": [
                        "gte",
                        "gt",
                        "lte",
                        "lt",
                        "eq"
                      ]
                    },
                    "evidenceStandard": {
                      "type": "string",
                      "enum": [
                        "founder_reported_ok",
                        "independent_required"
                      ]
                    }
                  },
                  "additionalProperties": false,
                  "required": [
                    "id",
                    "name",
                    "requirement",
                    "evaluationMode",
                    "importance",
                    "requiredEvidence",
                    "hardGate",
                    "missingEvidencePolicy"
                  ]
                },
                "maxItems": 50
              },
              "settings": {
                "type": "object",
                "properties": {
                  "showWeightedSummary": {
                    "type": "boolean"
                  },
                  "reviewConfidenceThreshold": {
                    "type": "number"
                  }
                },
                "additionalProperties": false,
                "required": [
                  "showWeightedSummary",
                  "reviewConfidenceThreshold"
                ]
              }
            },
            "additionalProperties": false,
            "required": [
              "thesisId",
              "expectedVersion",
              "criteria"
            ]
          },
          "outputSchema": {
            "type": "object",
            "properties": {
              "thesis": {}
            },
            "additionalProperties": false,
            "required": [
              "thesis"
            ]
          },
          "authorization": [
            "thesis.write"
          ],
          "idempotency": "unsupported",
          "concurrency": {
            "mode": "keyed",
            "key": "thesisId"
          }
        }
      ]
    },
    {
      "name": "thesis.get",
      "versions": [
        1
      ],
      "latestVersion": 1,
      "description": "A thesis with its draft and every approved version.",
      "kind": "request",
      "inputSchema": {
        "type": "object",
        "properties": {
          "thesisId": {
            "type": "string"
          }
        },
        "additionalProperties": false,
        "required": [
          "thesisId"
        ]
      },
      "outputSchema": {
        "type": "object",
        "properties": {
          "thesis": {},
          "versions": {}
        },
        "additionalProperties": false,
        "required": [
          "thesis",
          "versions"
        ]
      },
      "authorization": [
        "invest.read"
      ],
      "idempotency": "unsupported",
      "concurrency": {
        "mode": "parallel"
      },
      "definitions": [
        {
          "version": 1,
          "description": "A thesis with its draft and every approved version.",
          "kind": "request",
          "inputSchema": {
            "type": "object",
            "properties": {
              "thesisId": {
                "type": "string"
              }
            },
            "additionalProperties": false,
            "required": [
              "thesisId"
            ]
          },
          "outputSchema": {
            "type": "object",
            "properties": {
              "thesis": {},
              "versions": {}
            },
            "additionalProperties": false,
            "required": [
              "thesis",
              "versions"
            ]
          },
          "authorization": [
            "invest.read"
          ],
          "idempotency": "unsupported",
          "concurrency": {
            "mode": "parallel"
          }
        }
      ]
    },
    {
      "name": "thesis.list",
      "versions": [
        1
      ],
      "latestVersion": 1,
      "description": "Theses in the caller's workspace.",
      "kind": "request",
      "inputSchema": {
        "type": "object",
        "properties": {},
        "additionalProperties": false
      },
      "outputSchema": {
        "type": "object",
        "properties": {
          "items": {}
        },
        "additionalProperties": false,
        "required": [
          "items"
        ]
      },
      "authorization": [
        "invest.read"
      ],
      "idempotency": "unsupported",
      "concurrency": {
        "mode": "parallel"
      },
      "definitions": [
        {
          "version": 1,
          "description": "Theses in the caller's workspace.",
          "kind": "request",
          "inputSchema": {
            "type": "object",
            "properties": {},
            "additionalProperties": false
          },
          "outputSchema": {
            "type": "object",
            "properties": {
              "items": {}
            },
            "additionalProperties": false,
            "required": [
              "items"
            ]
          },
          "authorization": [
            "invest.read"
          ],
          "idempotency": "unsupported",
          "concurrency": {
            "mode": "parallel"
          }
        }
      ]
    },
    {
      "name": "thesis.validate",
      "versions": [
        1
      ],
      "latestVersion": 1,
      "description": "Validates criteria and settings without storing anything.",
      "kind": "request",
      "inputSchema": {
        "type": "object",
        "properties": {
          "criteria": {
            "type": "array",
            "items": {},
            "maxItems": 50
          },
          "settings": {}
        },
        "additionalProperties": false,
        "required": [
          "criteria",
          "settings"
        ]
      },
      "outputSchema": {
        "type": "object",
        "properties": {
          "valid": {},
          "errors": {},
          "warnings": {}
        },
        "additionalProperties": false,
        "required": [
          "valid",
          "errors",
          "warnings"
        ]
      },
      "authorization": [
        "invest.read"
      ],
      "idempotency": "unsupported",
      "concurrency": {
        "mode": "parallel"
      },
      "definitions": [
        {
          "version": 1,
          "description": "Validates criteria and settings without storing anything.",
          "kind": "request",
          "inputSchema": {
            "type": "object",
            "properties": {
              "criteria": {
                "type": "array",
                "items": {},
                "maxItems": 50
              },
              "settings": {}
            },
            "additionalProperties": false,
            "required": [
              "criteria",
              "settings"
            ]
          },
          "outputSchema": {
            "type": "object",
            "properties": {
              "valid": {},
              "errors": {},
              "warnings": {}
            },
            "additionalProperties": false,
            "required": [
              "valid",
              "errors",
              "warnings"
            ]
          },
          "authorization": [
            "invest.read"
          ],
          "idempotency": "unsupported",
          "concurrency": {
            "mode": "parallel"
          }
        }
      ]
    },
    {
      "name": "thesis.version.compare",
      "versions": [
        1
      ],
      "latestVersion": 1,
      "description": "Criterion-level differences between two versions, or between a version and the current draft.",
      "kind": "request",
      "inputSchema": {
        "type": "object",
        "properties": {
          "fromVersionId": {
            "type": "string"
          },
          "toVersionId": {
            "type": "string"
          }
        },
        "additionalProperties": false,
        "required": [
          "fromVersionId"
        ]
      },
      "outputSchema": {
        "type": "object",
        "properties": {
          "from": {},
          "to": {},
          "changes": {}
        },
        "additionalProperties": false,
        "required": [
          "from",
          "to",
          "changes"
        ]
      },
      "authorization": [
        "invest.read"
      ],
      "idempotency": "unsupported",
      "concurrency": {
        "mode": "parallel"
      },
      "definitions": [
        {
          "version": 1,
          "description": "Criterion-level differences between two versions, or between a version and the current draft.",
          "kind": "request",
          "inputSchema": {
            "type": "object",
            "properties": {
              "fromVersionId": {
                "type": "string"
              },
              "toVersionId": {
                "type": "string"
              }
            },
            "additionalProperties": false,
            "required": [
              "fromVersionId"
            ]
          },
          "outputSchema": {
            "type": "object",
            "properties": {
              "from": {},
              "to": {},
              "changes": {}
            },
            "additionalProperties": false,
            "required": [
              "from",
              "to",
              "changes"
            ]
          },
          "authorization": [
            "invest.read"
          ],
          "idempotency": "unsupported",
          "concurrency": {
            "mode": "parallel"
          }
        }
      ]
    },
    {
      "name": "thesis.version.get",
      "versions": [
        1
      ],
      "latestVersion": 1,
      "description": "One immutable thesis version.",
      "kind": "request",
      "inputSchema": {
        "type": "object",
        "properties": {
          "versionId": {
            "type": "string"
          }
        },
        "additionalProperties": false,
        "required": [
          "versionId"
        ]
      },
      "outputSchema": {
        "type": "object",
        "properties": {
          "version": {}
        },
        "additionalProperties": false,
        "required": [
          "version"
        ]
      },
      "authorization": [
        "invest.read"
      ],
      "idempotency": "unsupported",
      "concurrency": {
        "mode": "parallel"
      },
      "definitions": [
        {
          "version": 1,
          "description": "One immutable thesis version.",
          "kind": "request",
          "inputSchema": {
            "type": "object",
            "properties": {
              "versionId": {
                "type": "string"
              }
            },
            "additionalProperties": false,
            "required": [
              "versionId"
            ]
          },
          "outputSchema": {
            "type": "object",
            "properties": {
              "version": {}
            },
            "additionalProperties": false,
            "required": [
              "version"
            ]
          },
          "authorization": [
            "invest.read"
          ],
          "idempotency": "unsupported",
          "concurrency": {
            "mode": "parallel"
          }
        }
      ]
    },
    {
      "name": "workspace.overview",
      "versions": [
        1
      ],
      "latestVersion": 1,
      "description": "Active evaluations, outstanding reviews, recently completed assessments and startups awaiting evidence.",
      "kind": "request",
      "inputSchema": {
        "type": "object",
        "properties": {},
        "additionalProperties": false
      },
      "outputSchema": {
        "type": "object",
        "properties": {
          "overview": {}
        },
        "additionalProperties": false,
        "required": [
          "overview"
        ]
      },
      "authorization": [
        "invest.read"
      ],
      "idempotency": "unsupported",
      "concurrency": {
        "mode": "parallel"
      },
      "definitions": [
        {
          "version": 1,
          "description": "Active evaluations, outstanding reviews, recently completed assessments and startups awaiting evidence.",
          "kind": "request",
          "inputSchema": {
            "type": "object",
            "properties": {},
            "additionalProperties": false
          },
          "outputSchema": {
            "type": "object",
            "properties": {
              "overview": {}
            },
            "additionalProperties": false,
            "required": [
              "overview"
            ]
          },
          "authorization": [
            "invest.read"
          ],
          "idempotency": "unsupported",
          "concurrency": {
            "mode": "parallel"
          }
        }
      ]
    }
  ],
  "events": [],
  "transports": [],
  "conformance": 1
} as const;

/** Creates a typed client for Attn Invest. */
export function createInvestClient(options: ClientOptions): AppPortClient<InvestContract> {
  return createClient<InvestContract>({
    versions: capabilityVersions,
    streamCapabilities,
    ...options
  });
}
