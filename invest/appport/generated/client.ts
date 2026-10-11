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

/** What needs a person across the workspace: new investment activity, proposed strategy changes, findings awaiting review, and research that is failing or stale. Each item appears once. */
export type AttentionListV1Input = Record<string, never>;
export type AttentionListV1Output = {
  items: unknown;
};

export type AttentionListInput = AttentionListV1Input;
export type AttentionListOutput = AttentionListV1Output;

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

/** Representative claims awaiting a moderator decision, across workspaces. Challenges are not included. */
export type ClaimPendingV1Input = Record<string, never>;
export type ClaimPendingV1Output = {
  items: unknown;
};

export type ClaimPendingInput = ClaimPendingV1Input;
export type ClaimPendingOutput = ClaimPendingV1Output;

/** A moderator verifies, rejects or revokes a representative claim, with a rationale and the evidence considered. Verification needs a successful domain proof or documented evidence. */
export type ClaimReviewV1Input = {
  claimId: string;
  decision: "verify" | "reject" | "revoke";
  rationale: string;
  evidence?: Array<string>;
};
export type ClaimReviewV1Output = {
  event: unknown;
};

export type ClaimReviewInput = ClaimReviewV1Input;
export type ClaimReviewOutput = ClaimReviewV1Output;

/** Records a private contribution about a firm: a correction, firsthand note, outdated-criterion flag, suggested relationship or interaction note. Private to the author's workspace until shared. */
export type ContributionCreateV1Input = {
  kind: "correction" | "firsthand_note" | "flag_outdated" | "suggest_relationship" | "interaction_note";
  firmDomain: string;
  field?: "stage" | "sector" | "geography" | "check_size" | "business_model" | "company_characteristics" | "exclusion" | "traction" | "application_requirements";
  polarity?: "include" | "exclude";
  value?: string;
  minUsd?: number;
  maxUsd?: number;
  text: string;
  evidenceUrls?: Array<string>;
};
export type ContributionCreateV1Output = {
  contribution: unknown;
};

export type ContributionCreateInput = ContributionCreateV1Input;
export type ContributionCreateOutput = ContributionCreateV1Output;

/** Edits a contribution by creating a new version; earlier versions stay. */
export type ContributionEditV1Input = {
  chainId: string;
  kind: "correction" | "firsthand_note" | "flag_outdated" | "suggest_relationship" | "interaction_note";
  firmDomain: string;
  field?: "stage" | "sector" | "geography" | "check_size" | "business_model" | "company_characteristics" | "exclusion" | "traction" | "application_requirements";
  polarity?: "include" | "exclude";
  value?: string;
  minUsd?: number;
  maxUsd?: number;
  text: string;
  evidenceUrls?: Array<string>;
};
export type ContributionEditV1Output = {
  contribution: unknown;
};

export type ContributionEditInput = ContributionEditV1Input;
export type ContributionEditOutput = ContributionEditV1Output;

/** The caller's own contributions with sharing state, share history and the responses received. */
export type ContributionMineV1Input = {
  firmDomain?: string;
};
export type ContributionMineV1Output = {
  items: unknown;
};

export type ContributionMineInput = ContributionMineV1Input;
export type ContributionMineOutput = ContributionMineV1Output;

/** Contributions authors chose to share with moderators. */
export type ContributionQueueV1Input = Record<string, never>;
export type ContributionQueueV1Output = {
  items: unknown;
};

export type ContributionQueueInput = ContributionQueueV1Input;
export type ContributionQueueOutput = ContributionQueueV1Output;

/** A verified representative or moderator responds to a shared contribution. A dispute is recorded beside the contribution; it never edits or deletes it. */
export type ContributionRespondV1Input = {
  chainId: string;
  action: "confirm" | "dispute" | "dismiss" | "flag" | "note";
  note: string;
  as: "firm_representative" | "moderator";
};
export type ContributionRespondV1Output = {
  response: unknown;
};

export type ContributionRespondInput = ContributionRespondV1Input;
export type ContributionRespondOutput = ContributionRespondV1Output;

/** Revokes sharing for one audience. The receiver can no longer read it; their earlier responses remain. */
export type ContributionRevokeV1Input = {
  chainId: string;
  audience: {
    kind: "firm" | "moderator";
    domain?: string;
  };
};
export type ContributionRevokeV1Output = {
  share: unknown;
};

export type ContributionRevokeInput = ContributionRevokeV1Input;
export type ContributionRevokeOutput = ContributionRevokeV1Output;

/** Shares a contribution with the firm it is about, or with moderators. Sharing is consent for that audience only; it is not publishing. Aggregate-analysis consent is a separate, explicit flag. */
export type ContributionShareV1Input = {
  chainId: string;
  audience: {
    kind: "firm" | "moderator";
    domain?: string;
  };
  aggregateConsent?: boolean;
  note?: string;
};
export type ContributionShareV1Output = {
  share: unknown;
};

export type ContributionShareInput = ContributionShareV1Input;
export type ContributionShareOutput = ContributionShareV1Output;

/** Contributions authors shared with the firm. Only a verified representative of that firm can read them; authors are not identified. */
export type ContributionSharedV1Input = {
  domain: string;
};
export type ContributionSharedV1Output = {
  items: unknown;
};

export type ContributionSharedInput = ContributionSharedV1Input;
export type ContributionSharedOutput = ContributionSharedV1Output;

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

/** A firm's published profile for a domain, or null. */
export type DirectoryGetV1Input = {
  domain: string;
};
export type DirectoryGetV1Output = {
  profile: unknown;
};

export type DirectoryGetInput = DirectoryGetV1Input;
export type DirectoryGetOutput = DirectoryGetV1Output;

/** Firms that have published an investor-approved profile (current versions only). The one place a workspace reads another workspace's data, and only what a verified representative chose to publish. */
export type DirectoryListV1Input = Record<string, never>;
export type DirectoryListV1Output = {
  items: unknown;
};

export type DirectoryListInput = DirectoryListV1Input;
export type DirectoryListOutput = DirectoryListV1Output;

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

/** Pause or resume continuous monitoring of a firm, or change its interval or crawl bounds. Pausing keeps the profile and all history. */
export type FirmMonitoringSetV1Input = {
  firmId: string;
  enabled?: boolean;
  intervalMinutes?: number;
  maxPages?: number;
  maxDepth?: number;
};
export type FirmMonitoringSetV1Output = {
  target: unknown;
};

export type FirmMonitoringSetInput = FirmMonitoringSetV1Input;
export type FirmMonitoringSetOutput = FirmMonitoringSetV1Output;

/** Per-field reconciliation of the firm's own statements, third-party claims, the viewer's contributions and the firm's published profile: signals, reasons and conflicts, never a score. */
export type FirmReconciliationV1Input = {
  firmId: string;
};
export type FirmReconciliationV1Output = {
  reconciliation: unknown;
};

export type FirmReconciliationInput = FirmReconciliationV1Input;
export type FirmReconciliationOutput = FirmReconciliationV1Output;

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

/** Flag, dispute, correct, annotate, confirm or dismiss a research criterion, an investment event or a finding. Recorded as a separate review; the research record is not changed and nothing is approved by it. */
export type FirmReviewV1Input = {
  firmId: string;
  criterionId?: string | null;
  eventId?: string | null;
  findingId?: string | null;
  claimId?: string | null;
  action: "flag" | "dispute" | "correct" | "note" | "confirm" | "dismiss";
  note: string;
  correctedValue?: string;
};
export type FirmReviewV1Output = {
  review: unknown;
};

export type FirmReviewInput = FirmReviewV1Input;
export type FirmReviewOutput = FirmReviewV1Output;

/** The firm's intelligence timeline: investment events, source discoveries and changes, proposed thesis changes, conflicts, failed research and reviews. Filter by type, time range and review state. */
export type FirmTimelineV1Input = {
  firmId: string;
  types?: Array<string>;
  from?: string;
  to?: string;
  reviewStates?: Array<string>;
  limit?: number;
};
export type FirmTimelineV1Output = {
  items: unknown;
};

export type FirmTimelineInput = FirmTimelineV1Input;
export type FirmTimelineOutput = FirmTimelineV1Output;

/** Asks Jev whether each current criterion's captured passage supports its statement. Reports skipped when Jev is not configured; never simulates a result. */
export type FirmVerifyV1Input = {
  firmId: string;
};
export type FirmVerifyV1Output = {
  summary: unknown;
};

export type FirmVerifyInput = FirmVerifyV1Input;
export type FirmVerifyOutput = FirmVerifyV1Output;

/** What differs between two evaluations of the same startup and investor: inputs, then results. */
export type FitCompareV1Input = {
  fromId: string;
  toId: string;
};
export type FitCompareV1Output = {
  from: unknown;
  to: unknown;
  inputs: unknown;
  results: unknown;
};

export type FitCompareInput = FitCompareV1Input;
export type FitCompareOutput = FitCompareV1Output;

/** Candidate investors for a startup, each with mandate fit, readiness, evidence quality and research coverage kept separate. Computed on demand from the current profile; nothing is stored. */
export type FitDiscoverV1Input = {
  startupId: string;
  filters?: {
    stage?: Array<string>;
    sector?: Array<string>;
    geography?: Array<string>;
    businessModel?: Array<string>;
    checkSize?: {
      minUsd?: number;
      maxUsd?: number;
    };
    approvedOnly?: boolean;
    freshOnly?: boolean;
    coverage?: Array<string>;
    mandate?: Array<string>;
    unknown?: boolean;
    includeFounderExcluded?: boolean;
    query?: string;
  };
};
export type FitDiscoverV1Output = {
  candidates: unknown;
  total: unknown;
  shown: unknown;
  empty: unknown;
  universe: unknown;
  profileVersion: unknown;
  policyVersion: unknown;
  evaluatedAt: unknown;
};

export type FitDiscoverInput = FitDiscoverV1Input;
export type FitDiscoverOutput = FitDiscoverV1Output;

/** Evaluates one investor against the startup's current profile and evidence and records the evaluation with every input version. Identical inputs return the existing evaluation; changed inputs create a new one and never alter an earlier one. */
export type FitEvaluateV1Input = {
  startupId: string;
  investorKey: string;
};
export type FitEvaluateV1Output = {
  evaluation: unknown;
  reused: unknown;
  previous: unknown;
};

export type FitEvaluateInput = FitEvaluateV1Input;
export type FitEvaluateOutput = FitEvaluateV1Output;

/** A recorded evaluation with its explanation, and whether its inputs are still current. */
export type FitGetV1Input = {
  evaluationId: string;
};
export type FitGetV1Output = {
  evaluation: unknown;
  staleness: unknown;
};

export type FitGetInput = FitGetV1Input;
export type FitGetOutput = FitGetV1Output;

/** Recorded evaluations for a startup, newest first, optionally for one investor. */
export type FitHistoryV1Input = {
  startupId: string;
  investorKey?: string;
};
export type FitHistoryV1Output = {
  items: unknown;
};

export type FitHistoryInput = FitHistoryV1Input;
export type FitHistoryOutput = FitHistoryV1Output;

/** What needs the caller's decision: candidate matches, unresolved conflicts, proposed claims, shared contributions, representative claims (moderators) and disputed contributions (authors). */
export type InboxListV1Input = Record<string, never>;
export type InboxListV1Output = {
  items: unknown;
};

export type InboxListInput = InboxListV1Input;
export type InboxListOutput = InboxListV1Output;

/** Confirms or rejects a candidate match between a source record and an existing entity, with a rationale. Rejections are remembered; nothing is merged or deleted. */
export type MatchDecideV1Input = {
  matchId: string;
  decision: "confirm" | "reject";
  entityType: "firm" | "entity";
  entityId: string;
  rationale: string;
};
export type MatchDecideV1Output = {
  decision: unknown;
};

export type MatchDecideInput = MatchDecideV1Input;
export type MatchDecideOutput = MatchDecideV1Output;

/** Candidate matches awaiting a decision, and the history of decisions. */
export type MatchListV1Input = Record<string, never>;
export type MatchListV1Output = {
  open: unknown;
  history: unknown;
};

export type MatchListInput = MatchListV1Input;
export type MatchListOutput = MatchListV1Output;

/** A verified representative withdraws one of their approvals by appending a withdrawal. */
export type ProfileApprovalWithdrawV1Input = {
  firmId: string;
  approvalId: string;
  note: string;
};
export type ProfileApprovalWithdrawV1Output = {
  approval: unknown;
};

export type ProfileApprovalWithdrawInput = ProfileApprovalWithdrawV1Input;
export type ProfileApprovalWithdrawOutput = ProfileApprovalWithdrawV1Output;

/** A verified representative approves one of the firm's criteria as the firm itself, from a research criterion, a third-party claim, or entered by hand. Works only with a verified claim for the firm's domain. */
export type ProfileApproveV1Input = {
  firmId: string;
  criterionId?: string;
  claimId?: string;
  field?: "stage" | "sector" | "geography" | "check_size" | "business_model" | "company_characteristics" | "exclusion" | "traction" | "application_requirements";
  polarity?: "include" | "exclude";
  value?: string;
  minUsd?: number;
  maxUsd?: number;
  note: string;
};
export type ProfileApproveV1Output = {
  approval: unknown;
};

export type ProfileApproveInput = ProfileApproveV1Input;
export type ProfileApproveOutput = ProfileApproveV1Output;

/** Checks the domain-control proof for the caller's own claim through the safe-fetch boundary. The result is evidence for the moderator, not authority. */
export type ProfileClaimCheckV1Input = {
  claimId: string;
};
export type ProfileClaimCheckV1Output = {
  event: unknown;
};

export type ProfileClaimCheckInput = ProfileClaimCheckV1Input;
export type ProfileClaimCheckOutput = ProfileClaimCheckV1Output;

/** The caller's representative claims with their status and history. */
export type ProfileClaimMineV1Input = Record<string, never>;
export type ProfileClaimMineV1Output = {
  items: unknown;
};

export type ProfileClaimMineInput = ProfileClaimMineV1Input;
export type ProfileClaimMineOutput = ProfileClaimMineV1Output;

/** Requests to represent a firm. Returns a challenge to publish at /.well-known/attn-invest-claim.txt. Signing up is not authority: a moderator must verify the claim. */
export type ProfileClaimRequestV1Input = {
  domain: string;
  firmName: string;
  relationship: string;
};
export type ProfileClaimRequestV1Output = {
  claim: unknown;
  status: unknown;
  firmId: unknown;
};

export type ProfileClaimRequestInput = ProfileClaimRequestV1Input;
export type ProfileClaimRequestOutput = ProfileClaimRequestV1Output;

/** Approvals, withdrawals, publications and claim decisions for a firm, newest first. */
export type ProfileHistoryV1Input = {
  firmId: string;
};
export type ProfileHistoryV1Output = {
  items: unknown;
};

export type ProfileHistoryInput = ProfileHistoryV1Input;
export type ProfileHistoryOutput = ProfileHistoryV1Output;

/** Publishes exactly the chosen representative-approved criteria as a new version of the firm's public profile, readable by every workspace. Nothing is published unless chosen. */
export type ProfilePublishV1Input = {
  firmId: string;
  approvalIds: Array<string>;
  note?: string;
};
export type ProfilePublishV1Output = {
  profile: unknown;
};

export type ProfilePublishInput = ProfilePublishV1Input;
export type ProfilePublishOutput = ProfilePublishV1Output;

/** Withdraws the published profile by appending a withdrawal version. Earlier versions stay in the history. */
export type ProfileUnpublishV1Input = {
  firmId: string;
  note: string;
};
export type ProfileUnpublishV1Output = {
  profile: unknown;
};

export type ProfileUnpublishInput = ProfileUnpublishV1Input;
export type ProfileUnpublishOutput = ProfileUnpublishV1Output;

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

/** The startup's private shortlist with each investor's latest evaluation, whether it is still current, and its prioritised recommended actions. */
export type ShortlistListV1Input = {
  startupId: string;
  includeRemoved?: boolean;
};
export type ShortlistListV1Output = {
  items: unknown;
};

export type ShortlistListInput = ShortlistListV1Input;
export type ShortlistListOutput = ShortlistListV1Output;

/** Open recommended actions across the shortlist, in priority order. Recommendations about the startup's materials, not predictions. */
export type ShortlistPlanV1Input = {
  startupId: string;
};
export type ShortlistPlanV1Output = {
  actions: unknown;
};

export type ShortlistPlanInput = ShortlistPlanV1Input;
export type ShortlistPlanOutput = ShortlistPlanV1Output;

/** Adds an investor to the startup's private shortlist, or restores a removed one. */
export type ShortlistSaveV1Input = {
  startupId: string;
  investorKey: string;
  status?: "considering" | "ready" | "parked" | "ruled_out";
  note?: string;
};
export type ShortlistSaveV1Output = {
  entry: unknown;
};

export type ShortlistSaveInput = ShortlistSaveV1Input;
export type ShortlistSaveOutput = ShortlistSaveV1Output;

/** Changes a shortlist entry's status or note, marks recommended actions done or dismissed, or removes it. Fenced on expectedVersion. */
export type ShortlistUpdateV1Input = {
  entryId: string;
  expectedVersion: number;
  status?: "considering" | "ready" | "parked" | "ruled_out";
  note?: string;
  actions?: unknown;
  remove?: boolean;
};
export type ShortlistUpdateV1Output = {
  entry: unknown;
};

export type ShortlistUpdateInput = ShortlistUpdateV1Input;
export type ShortlistUpdateOutput = ShortlistUpdateV1Output;

/** One source: terms and limitations, run history with per-record errors, snapshots, record counts and match tallies. */
export type SourceGetV1Input = {
  sourceId: string;
};
export type SourceGetV1Output = {
  detail: unknown;
};

export type SourceGetInput = SourceGetV1Input;
export type SourceGetOutput = SourceGetV1Output;

/** Curated sources with monitoring status, last attempt, last success and next check. */
export type SourceListV1Input = Record<string, never>;
export type SourceListV1Output = {
  items: unknown;
};

export type SourceListInput = SourceListV1Input;
export type SourceListOutput = SourceListV1Output;

/** Pauses or resumes monitoring of a source, or changes its interval. Pausing keeps its records, claims and history. */
export type SourceMonitoringSetV1Input = {
  sourceId: string;
  enabled?: boolean;
  intervalMinutes?: number;
};
export type SourceMonitoringSetV1Output = {
  target: unknown;
};

export type SourceMonitoringSetInput = SourceMonitoringSetV1Input;
export type SourceMonitoringSetOutput = SourceMonitoringSetV1Output;

/** Normalised records a source produced, with their original identifiers, passages and parse notes. */
export type SourceRecordsV1Input = {
  sourceId: string;
  limit?: number;
};
export type SourceRecordsV1Output = {
  items: unknown;
};

export type SourceRecordsInput = SourceRecordsV1Input;
export type SourceRecordsOutput = SourceRecordsV1Output;

/** Retrieves one registered source now, in this process. Accepts a source id only, never a URL. */
export type SourceRefreshV1Input = {
  sourceId: string;
};
export type SourceRefreshV1Output = {
  run: unknown;
};

export type SourceRefreshInput = SourceRefreshV1Input;
export type SourceRefreshOutput = SourceRefreshV1Output;

/** Registers a curated third-party source (directory, dataset, funding-news feed) for monitoring. The registrant attests why automated access is permitted and where the terms say so; fetching uses the safe-fetch boundary. */
export type SourceRegisterV1Input = {
  name: string;
  canonicalUrl: string;
  publisher: string;
  sourceType: "directory" | "curated_list" | "funding_news" | "portfolio_aggregator" | "dataset";
  adapter: "funding_news_feed" | "csv_dataset" | "json_dataset";
  accessBasis: "published_terms_permit" | "public_feed" | "licensed_dataset" | "owner_permission";
  termsNote: string;
  limitations?: string;
  extraHosts?: Array<string>;
  mapping?: {
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
    listDelimiter?: string;
    checkUnit?: "usd" | "thousands" | "millions";
    recordKind?: "investor" | "portfolio_company";
    investorField?: string;
  };
  intervalMinutes?: number;
};
export type SourceRegisterV1Output = {
  source: unknown;
  created: unknown;
};

export type SourceRegisterInput = SourceRegisterV1Input;
export type SourceRegisterOutput = SourceRegisterV1Output;

/** Updates a source's name, terms note, limitations or mapping. A changed mapping reprocesses the next retrieval. */
export type SourceUpdateV1Input = {
  sourceId: string;
  name?: string;
  termsNote?: string;
  limitations?: string;
  mapping?: {
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
    listDelimiter?: string;
    checkUnit?: "usd" | "thousands" | "millions";
    recordKind?: "investor" | "portfolio_company";
    investorField?: string;
  };
};
export type SourceUpdateV1Output = {
  source: unknown;
};

export type SourceUpdateInput = SourceUpdateV1Input;
export type SourceUpdateOutput = SourceUpdateV1Output;

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

/** The startup's private profile (current version, its content with per-field provenance, and the version history). */
export type StartupProfileGetV1Input = {
  startupId: string;
};
export type StartupProfileGetV1Output = {
  startup: unknown;
  version: unknown;
  content: unknown;
  versions: unknown;
};

export type StartupProfileGetInput = StartupProfileGetV1Input;
export type StartupProfileGetOutput = StartupProfileGetV1Output;

/** Saves the startup profile as a new immutable version, fenced on expectedVersion (0 for the first). Saving identical content creates no new version. Unknown and not-applicable are valid field states. */
export type StartupProfileSaveV1Input = {
  startupId: string;
  expectedVersion: number;
  content: unknown;
  note?: string;
};
export type StartupProfileSaveV1Output = {
  unchanged: unknown;
  version: unknown;
  content: unknown;
  versions: unknown;
};

export type StartupProfileSaveInput = StartupProfileSaveV1Input;
export type StartupProfileSaveOutput = StartupProfileSaveV1Output;

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
    "attention.list": { input: AttentionListInput; output: AttentionListOutput; kind: "request"; version: 1 };
    "audit.list": { input: AuditListInput; output: AuditListOutput; kind: "request"; version: 1 };
    "claim.pending": { input: ClaimPendingInput; output: ClaimPendingOutput; kind: "request"; version: 1 };
    "claim.review": { input: ClaimReviewInput; output: ClaimReviewOutput; kind: "request"; version: 1 };
    "contribution.create": { input: ContributionCreateInput; output: ContributionCreateOutput; kind: "request"; version: 1 };
    "contribution.edit": { input: ContributionEditInput; output: ContributionEditOutput; kind: "request"; version: 1 };
    "contribution.mine": { input: ContributionMineInput; output: ContributionMineOutput; kind: "request"; version: 1 };
    "contribution.queue": { input: ContributionQueueInput; output: ContributionQueueOutput; kind: "request"; version: 1 };
    "contribution.respond": { input: ContributionRespondInput; output: ContributionRespondOutput; kind: "request"; version: 1 };
    "contribution.revoke": { input: ContributionRevokeInput; output: ContributionRevokeOutput; kind: "request"; version: 1 };
    "contribution.share": { input: ContributionShareInput; output: ContributionShareOutput; kind: "request"; version: 1 };
    "contribution.shared": { input: ContributionSharedInput; output: ContributionSharedOutput; kind: "request"; version: 1 };
    "decision.record": { input: DecisionRecordInput; output: DecisionRecordOutput; kind: "request"; version: 1 };
    "directory.get": { input: DirectoryGetInput; output: DirectoryGetOutput; kind: "request"; version: 1 };
    "directory.list": { input: DirectoryListInput; output: DirectoryListOutput; kind: "request"; version: 1 };
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
    "firm.monitoring.set": { input: FirmMonitoringSetInput; output: FirmMonitoringSetOutput; kind: "request"; version: 1 };
    "firm.reconciliation": { input: FirmReconciliationInput; output: FirmReconciliationOutput; kind: "request"; version: 1 };
    "firm.refresh": { input: FirmRefreshInput; output: FirmRefreshOutput; kind: "request"; version: 1 };
    "firm.review": { input: FirmReviewInput; output: FirmReviewOutput; kind: "request"; version: 1 };
    "firm.timeline": { input: FirmTimelineInput; output: FirmTimelineOutput; kind: "request"; version: 1 };
    "firm.verify": { input: FirmVerifyInput; output: FirmVerifyOutput; kind: "request"; version: 1 };
    "fit.compare": { input: FitCompareInput; output: FitCompareOutput; kind: "request"; version: 1 };
    "fit.discover": { input: FitDiscoverInput; output: FitDiscoverOutput; kind: "request"; version: 1 };
    "fit.evaluate": { input: FitEvaluateInput; output: FitEvaluateOutput; kind: "request"; version: 1 };
    "fit.get": { input: FitGetInput; output: FitGetOutput; kind: "request"; version: 1 };
    "fit.history": { input: FitHistoryInput; output: FitHistoryOutput; kind: "request"; version: 1 };
    "inbox.list": { input: InboxListInput; output: InboxListOutput; kind: "request"; version: 1 };
    "match.decide": { input: MatchDecideInput; output: MatchDecideOutput; kind: "request"; version: 1 };
    "match.list": { input: MatchListInput; output: MatchListOutput; kind: "request"; version: 1 };
    "profile.approval.withdraw": { input: ProfileApprovalWithdrawInput; output: ProfileApprovalWithdrawOutput; kind: "request"; version: 1 };
    "profile.approve": { input: ProfileApproveInput; output: ProfileApproveOutput; kind: "request"; version: 1 };
    "profile.claim.check": { input: ProfileClaimCheckInput; output: ProfileClaimCheckOutput; kind: "request"; version: 1 };
    "profile.claim.mine": { input: ProfileClaimMineInput; output: ProfileClaimMineOutput; kind: "request"; version: 1 };
    "profile.claim.request": { input: ProfileClaimRequestInput; output: ProfileClaimRequestOutput; kind: "request"; version: 1 };
    "profile.history": { input: ProfileHistoryInput; output: ProfileHistoryOutput; kind: "request"; version: 1 };
    "profile.publish": { input: ProfilePublishInput; output: ProfilePublishOutput; kind: "request"; version: 1 };
    "profile.unpublish": { input: ProfileUnpublishInput; output: ProfileUnpublishOutput; kind: "request"; version: 1 };
    "review.record": { input: ReviewRecordInput; output: ReviewRecordOutput; kind: "request"; version: 1 };
    "review.request": { input: ReviewRequestInput; output: ReviewRequestOutput; kind: "request"; version: 1 };
    "review.resolve": { input: ReviewResolveInput; output: ReviewResolveOutput; kind: "request"; version: 1 };
    "session.whoami": { input: SessionWhoamiInput; output: SessionWhoamiOutput; kind: "request"; version: 1 };
    "shortlist.list": { input: ShortlistListInput; output: ShortlistListOutput; kind: "request"; version: 1 };
    "shortlist.plan": { input: ShortlistPlanInput; output: ShortlistPlanOutput; kind: "request"; version: 1 };
    "shortlist.save": { input: ShortlistSaveInput; output: ShortlistSaveOutput; kind: "request"; version: 1 };
    "shortlist.update": { input: ShortlistUpdateInput; output: ShortlistUpdateOutput; kind: "request"; version: 1 };
    "source.get": { input: SourceGetInput; output: SourceGetOutput; kind: "request"; version: 1 };
    "source.list": { input: SourceListInput; output: SourceListOutput; kind: "request"; version: 1 };
    "source.monitoring.set": { input: SourceMonitoringSetInput; output: SourceMonitoringSetOutput; kind: "request"; version: 1 };
    "source.records": { input: SourceRecordsInput; output: SourceRecordsOutput; kind: "request"; version: 1 };
    "source.refresh": { input: SourceRefreshInput; output: SourceRefreshOutput; kind: "request"; version: 1 };
    "source.register": { input: SourceRegisterInput; output: SourceRegisterOutput; kind: "request"; version: 1 };
    "source.update": { input: SourceUpdateInput; output: SourceUpdateOutput; kind: "request"; version: 1 };
    "startup.create": { input: StartupCreateInput; output: StartupCreateOutput; kind: "request"; version: 1 };
    "startup.get": { input: StartupGetInput; output: StartupGetOutput; kind: "request"; version: 1 };
    "startup.list": { input: StartupListInput; output: StartupListOutput; kind: "request"; version: 1 };
    "startup.profile.get": { input: StartupProfileGetInput; output: StartupProfileGetOutput; kind: "request"; version: 1 };
    "startup.profile.save": { input: StartupProfileSaveInput; output: StartupProfileSaveOutput; kind: "request"; version: 1 };
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
  "attention.list": 1,
  "audit.list": 1,
  "claim.pending": 1,
  "claim.review": 1,
  "contribution.create": 1,
  "contribution.edit": 1,
  "contribution.mine": 1,
  "contribution.queue": 1,
  "contribution.respond": 1,
  "contribution.revoke": 1,
  "contribution.share": 1,
  "contribution.shared": 1,
  "decision.record": 1,
  "directory.get": 1,
  "directory.list": 1,
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
  "firm.monitoring.set": 1,
  "firm.reconciliation": 1,
  "firm.refresh": 1,
  "firm.review": 1,
  "firm.timeline": 1,
  "firm.verify": 1,
  "fit.compare": 1,
  "fit.discover": 1,
  "fit.evaluate": 1,
  "fit.get": 1,
  "fit.history": 1,
  "inbox.list": 1,
  "match.decide": 1,
  "match.list": 1,
  "profile.approval.withdraw": 1,
  "profile.approve": 1,
  "profile.claim.check": 1,
  "profile.claim.mine": 1,
  "profile.claim.request": 1,
  "profile.history": 1,
  "profile.publish": 1,
  "profile.unpublish": 1,
  "review.record": 1,
  "review.request": 1,
  "review.resolve": 1,
  "session.whoami": 1,
  "shortlist.list": 1,
  "shortlist.plan": 1,
  "shortlist.save": 1,
  "shortlist.update": 1,
  "source.get": 1,
  "source.list": 1,
  "source.monitoring.set": 1,
  "source.records": 1,
  "source.refresh": 1,
  "source.register": 1,
  "source.update": 1,
  "startup.create": 1,
  "startup.get": 1,
  "startup.list": 1,
  "startup.profile.get": 1,
  "startup.profile.save": 1,
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
      "name": "attention.list",
      "versions": [
        1
      ],
      "latestVersion": 1,
      "description": "What needs a person across the workspace: new investment activity, proposed strategy changes, findings awaiting review, and research that is failing or stale. Each item appears once.",
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
          "description": "What needs a person across the workspace: new investment activity, proposed strategy changes, findings awaiting review, and research that is failing or stale. Each item appears once.",
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
      "name": "claim.pending",
      "versions": [
        1
      ],
      "latestVersion": 1,
      "description": "Representative claims awaiting a moderator decision, across workspaces. Challenges are not included.",
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
        "moderation.review"
      ],
      "idempotency": "unsupported",
      "concurrency": {
        "mode": "parallel"
      },
      "definitions": [
        {
          "version": 1,
          "description": "Representative claims awaiting a moderator decision, across workspaces. Challenges are not included.",
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
            "moderation.review"
          ],
          "idempotency": "unsupported",
          "concurrency": {
            "mode": "parallel"
          }
        }
      ]
    },
    {
      "name": "claim.review",
      "versions": [
        1
      ],
      "latestVersion": 1,
      "description": "A moderator verifies, rejects or revokes a representative claim, with a rationale and the evidence considered. Verification needs a successful domain proof or documented evidence.",
      "kind": "request",
      "inputSchema": {
        "type": "object",
        "properties": {
          "claimId": {
            "type": "string"
          },
          "decision": {
            "type": "string",
            "enum": [
              "verify",
              "reject",
              "revoke"
            ]
          },
          "rationale": {
            "type": "string"
          },
          "evidence": {
            "type": "array",
            "items": {
              "type": "string"
            },
            "maxItems": 10
          }
        },
        "additionalProperties": false,
        "required": [
          "claimId",
          "decision",
          "rationale"
        ]
      },
      "outputSchema": {
        "type": "object",
        "properties": {
          "event": {}
        },
        "additionalProperties": false,
        "required": [
          "event"
        ]
      },
      "authorization": [
        "moderation.review"
      ],
      "idempotency": "unsupported",
      "concurrency": {
        "mode": "parallel"
      },
      "definitions": [
        {
          "version": 1,
          "description": "A moderator verifies, rejects or revokes a representative claim, with a rationale and the evidence considered. Verification needs a successful domain proof or documented evidence.",
          "kind": "request",
          "inputSchema": {
            "type": "object",
            "properties": {
              "claimId": {
                "type": "string"
              },
              "decision": {
                "type": "string",
                "enum": [
                  "verify",
                  "reject",
                  "revoke"
                ]
              },
              "rationale": {
                "type": "string"
              },
              "evidence": {
                "type": "array",
                "items": {
                  "type": "string"
                },
                "maxItems": 10
              }
            },
            "additionalProperties": false,
            "required": [
              "claimId",
              "decision",
              "rationale"
            ]
          },
          "outputSchema": {
            "type": "object",
            "properties": {
              "event": {}
            },
            "additionalProperties": false,
            "required": [
              "event"
            ]
          },
          "authorization": [
            "moderation.review"
          ],
          "idempotency": "unsupported",
          "concurrency": {
            "mode": "parallel"
          }
        }
      ]
    },
    {
      "name": "contribution.create",
      "versions": [
        1
      ],
      "latestVersion": 1,
      "description": "Records a private contribution about a firm: a correction, firsthand note, outdated-criterion flag, suggested relationship or interaction note. Private to the author's workspace until shared.",
      "kind": "request",
      "inputSchema": {
        "type": "object",
        "properties": {
          "kind": {
            "type": "string",
            "enum": [
              "correction",
              "firsthand_note",
              "flag_outdated",
              "suggest_relationship",
              "interaction_note"
            ]
          },
          "firmDomain": {
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
          "text": {
            "type": "string"
          },
          "evidenceUrls": {
            "type": "array",
            "items": {
              "type": "string"
            },
            "maxItems": 5
          }
        },
        "additionalProperties": false,
        "required": [
          "kind",
          "firmDomain",
          "text"
        ]
      },
      "outputSchema": {
        "type": "object",
        "properties": {
          "contribution": {}
        },
        "additionalProperties": false,
        "required": [
          "contribution"
        ]
      },
      "authorization": [
        "contribution.write"
      ],
      "idempotency": "unsupported",
      "concurrency": {
        "mode": "parallel"
      },
      "definitions": [
        {
          "version": 1,
          "description": "Records a private contribution about a firm: a correction, firsthand note, outdated-criterion flag, suggested relationship or interaction note. Private to the author's workspace until shared.",
          "kind": "request",
          "inputSchema": {
            "type": "object",
            "properties": {
              "kind": {
                "type": "string",
                "enum": [
                  "correction",
                  "firsthand_note",
                  "flag_outdated",
                  "suggest_relationship",
                  "interaction_note"
                ]
              },
              "firmDomain": {
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
              "text": {
                "type": "string"
              },
              "evidenceUrls": {
                "type": "array",
                "items": {
                  "type": "string"
                },
                "maxItems": 5
              }
            },
            "additionalProperties": false,
            "required": [
              "kind",
              "firmDomain",
              "text"
            ]
          },
          "outputSchema": {
            "type": "object",
            "properties": {
              "contribution": {}
            },
            "additionalProperties": false,
            "required": [
              "contribution"
            ]
          },
          "authorization": [
            "contribution.write"
          ],
          "idempotency": "unsupported",
          "concurrency": {
            "mode": "parallel"
          }
        }
      ]
    },
    {
      "name": "contribution.edit",
      "versions": [
        1
      ],
      "latestVersion": 1,
      "description": "Edits a contribution by creating a new version; earlier versions stay.",
      "kind": "request",
      "inputSchema": {
        "type": "object",
        "properties": {
          "chainId": {
            "type": "string"
          },
          "kind": {
            "type": "string",
            "enum": [
              "correction",
              "firsthand_note",
              "flag_outdated",
              "suggest_relationship",
              "interaction_note"
            ]
          },
          "firmDomain": {
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
          "text": {
            "type": "string"
          },
          "evidenceUrls": {
            "type": "array",
            "items": {
              "type": "string"
            },
            "maxItems": 5
          }
        },
        "additionalProperties": false,
        "required": [
          "chainId",
          "kind",
          "firmDomain",
          "text"
        ]
      },
      "outputSchema": {
        "type": "object",
        "properties": {
          "contribution": {}
        },
        "additionalProperties": false,
        "required": [
          "contribution"
        ]
      },
      "authorization": [
        "contribution.write"
      ],
      "idempotency": "unsupported",
      "concurrency": {
        "mode": "parallel"
      },
      "definitions": [
        {
          "version": 1,
          "description": "Edits a contribution by creating a new version; earlier versions stay.",
          "kind": "request",
          "inputSchema": {
            "type": "object",
            "properties": {
              "chainId": {
                "type": "string"
              },
              "kind": {
                "type": "string",
                "enum": [
                  "correction",
                  "firsthand_note",
                  "flag_outdated",
                  "suggest_relationship",
                  "interaction_note"
                ]
              },
              "firmDomain": {
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
              "text": {
                "type": "string"
              },
              "evidenceUrls": {
                "type": "array",
                "items": {
                  "type": "string"
                },
                "maxItems": 5
              }
            },
            "additionalProperties": false,
            "required": [
              "chainId",
              "kind",
              "firmDomain",
              "text"
            ]
          },
          "outputSchema": {
            "type": "object",
            "properties": {
              "contribution": {}
            },
            "additionalProperties": false,
            "required": [
              "contribution"
            ]
          },
          "authorization": [
            "contribution.write"
          ],
          "idempotency": "unsupported",
          "concurrency": {
            "mode": "parallel"
          }
        }
      ]
    },
    {
      "name": "contribution.mine",
      "versions": [
        1
      ],
      "latestVersion": 1,
      "description": "The caller's own contributions with sharing state, share history and the responses received.",
      "kind": "request",
      "inputSchema": {
        "type": "object",
        "properties": {
          "firmDomain": {
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
        "contribution.write"
      ],
      "idempotency": "unsupported",
      "concurrency": {
        "mode": "parallel"
      },
      "definitions": [
        {
          "version": 1,
          "description": "The caller's own contributions with sharing state, share history and the responses received.",
          "kind": "request",
          "inputSchema": {
            "type": "object",
            "properties": {
              "firmDomain": {
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
            "contribution.write"
          ],
          "idempotency": "unsupported",
          "concurrency": {
            "mode": "parallel"
          }
        }
      ]
    },
    {
      "name": "contribution.queue",
      "versions": [
        1
      ],
      "latestVersion": 1,
      "description": "Contributions authors chose to share with moderators.",
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
        "moderation.review"
      ],
      "idempotency": "unsupported",
      "concurrency": {
        "mode": "parallel"
      },
      "definitions": [
        {
          "version": 1,
          "description": "Contributions authors chose to share with moderators.",
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
            "moderation.review"
          ],
          "idempotency": "unsupported",
          "concurrency": {
            "mode": "parallel"
          }
        }
      ]
    },
    {
      "name": "contribution.respond",
      "versions": [
        1
      ],
      "latestVersion": 1,
      "description": "A verified representative or moderator responds to a shared contribution. A dispute is recorded beside the contribution; it never edits or deletes it.",
      "kind": "request",
      "inputSchema": {
        "type": "object",
        "properties": {
          "chainId": {
            "type": "string"
          },
          "action": {
            "type": "string",
            "enum": [
              "confirm",
              "dispute",
              "dismiss",
              "flag",
              "note"
            ]
          },
          "note": {
            "type": "string"
          },
          "as": {
            "type": "string",
            "enum": [
              "firm_representative",
              "moderator"
            ]
          }
        },
        "additionalProperties": false,
        "required": [
          "chainId",
          "action",
          "note",
          "as"
        ]
      },
      "outputSchema": {
        "type": "object",
        "properties": {
          "response": {}
        },
        "additionalProperties": false,
        "required": [
          "response"
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
          "description": "A verified representative or moderator responds to a shared contribution. A dispute is recorded beside the contribution; it never edits or deletes it.",
          "kind": "request",
          "inputSchema": {
            "type": "object",
            "properties": {
              "chainId": {
                "type": "string"
              },
              "action": {
                "type": "string",
                "enum": [
                  "confirm",
                  "dispute",
                  "dismiss",
                  "flag",
                  "note"
                ]
              },
              "note": {
                "type": "string"
              },
              "as": {
                "type": "string",
                "enum": [
                  "firm_representative",
                  "moderator"
                ]
              }
            },
            "additionalProperties": false,
            "required": [
              "chainId",
              "action",
              "note",
              "as"
            ]
          },
          "outputSchema": {
            "type": "object",
            "properties": {
              "response": {}
            },
            "additionalProperties": false,
            "required": [
              "response"
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
      "name": "contribution.revoke",
      "versions": [
        1
      ],
      "latestVersion": 1,
      "description": "Revokes sharing for one audience. The receiver can no longer read it; their earlier responses remain.",
      "kind": "request",
      "inputSchema": {
        "type": "object",
        "properties": {
          "chainId": {
            "type": "string"
          },
          "audience": {
            "type": "object",
            "properties": {
              "kind": {
                "type": "string",
                "enum": [
                  "firm",
                  "moderator"
                ]
              },
              "domain": {
                "type": "string"
              }
            },
            "additionalProperties": false,
            "required": [
              "kind"
            ]
          }
        },
        "additionalProperties": false,
        "required": [
          "chainId",
          "audience"
        ]
      },
      "outputSchema": {
        "type": "object",
        "properties": {
          "share": {}
        },
        "additionalProperties": false,
        "required": [
          "share"
        ]
      },
      "authorization": [
        "contribution.share"
      ],
      "idempotency": "unsupported",
      "concurrency": {
        "mode": "parallel"
      },
      "definitions": [
        {
          "version": 1,
          "description": "Revokes sharing for one audience. The receiver can no longer read it; their earlier responses remain.",
          "kind": "request",
          "inputSchema": {
            "type": "object",
            "properties": {
              "chainId": {
                "type": "string"
              },
              "audience": {
                "type": "object",
                "properties": {
                  "kind": {
                    "type": "string",
                    "enum": [
                      "firm",
                      "moderator"
                    ]
                  },
                  "domain": {
                    "type": "string"
                  }
                },
                "additionalProperties": false,
                "required": [
                  "kind"
                ]
              }
            },
            "additionalProperties": false,
            "required": [
              "chainId",
              "audience"
            ]
          },
          "outputSchema": {
            "type": "object",
            "properties": {
              "share": {}
            },
            "additionalProperties": false,
            "required": [
              "share"
            ]
          },
          "authorization": [
            "contribution.share"
          ],
          "idempotency": "unsupported",
          "concurrency": {
            "mode": "parallel"
          }
        }
      ]
    },
    {
      "name": "contribution.share",
      "versions": [
        1
      ],
      "latestVersion": 1,
      "description": "Shares a contribution with the firm it is about, or with moderators. Sharing is consent for that audience only; it is not publishing. Aggregate-analysis consent is a separate, explicit flag.",
      "kind": "request",
      "inputSchema": {
        "type": "object",
        "properties": {
          "chainId": {
            "type": "string"
          },
          "audience": {
            "type": "object",
            "properties": {
              "kind": {
                "type": "string",
                "enum": [
                  "firm",
                  "moderator"
                ]
              },
              "domain": {
                "type": "string"
              }
            },
            "additionalProperties": false,
            "required": [
              "kind"
            ]
          },
          "aggregateConsent": {
            "type": "boolean"
          },
          "note": {
            "type": "string"
          }
        },
        "additionalProperties": false,
        "required": [
          "chainId",
          "audience"
        ]
      },
      "outputSchema": {
        "type": "object",
        "properties": {
          "share": {}
        },
        "additionalProperties": false,
        "required": [
          "share"
        ]
      },
      "authorization": [
        "contribution.share"
      ],
      "idempotency": "unsupported",
      "concurrency": {
        "mode": "parallel"
      },
      "definitions": [
        {
          "version": 1,
          "description": "Shares a contribution with the firm it is about, or with moderators. Sharing is consent for that audience only; it is not publishing. Aggregate-analysis consent is a separate, explicit flag.",
          "kind": "request",
          "inputSchema": {
            "type": "object",
            "properties": {
              "chainId": {
                "type": "string"
              },
              "audience": {
                "type": "object",
                "properties": {
                  "kind": {
                    "type": "string",
                    "enum": [
                      "firm",
                      "moderator"
                    ]
                  },
                  "domain": {
                    "type": "string"
                  }
                },
                "additionalProperties": false,
                "required": [
                  "kind"
                ]
              },
              "aggregateConsent": {
                "type": "boolean"
              },
              "note": {
                "type": "string"
              }
            },
            "additionalProperties": false,
            "required": [
              "chainId",
              "audience"
            ]
          },
          "outputSchema": {
            "type": "object",
            "properties": {
              "share": {}
            },
            "additionalProperties": false,
            "required": [
              "share"
            ]
          },
          "authorization": [
            "contribution.share"
          ],
          "idempotency": "unsupported",
          "concurrency": {
            "mode": "parallel"
          }
        }
      ]
    },
    {
      "name": "contribution.shared",
      "versions": [
        1
      ],
      "latestVersion": 1,
      "description": "Contributions authors shared with the firm. Only a verified representative of that firm can read them; authors are not identified.",
      "kind": "request",
      "inputSchema": {
        "type": "object",
        "properties": {
          "domain": {
            "type": "string"
          }
        },
        "additionalProperties": false,
        "required": [
          "domain"
        ]
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
        "contribution.read_shared"
      ],
      "idempotency": "unsupported",
      "concurrency": {
        "mode": "parallel"
      },
      "definitions": [
        {
          "version": 1,
          "description": "Contributions authors shared with the firm. Only a verified representative of that firm can read them; authors are not identified.",
          "kind": "request",
          "inputSchema": {
            "type": "object",
            "properties": {
              "domain": {
                "type": "string"
              }
            },
            "additionalProperties": false,
            "required": [
              "domain"
            ]
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
            "contribution.read_shared"
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
      "name": "directory.get",
      "versions": [
        1
      ],
      "latestVersion": 1,
      "description": "A firm's published profile for a domain, or null.",
      "kind": "request",
      "inputSchema": {
        "type": "object",
        "properties": {
          "domain": {
            "type": "string"
          }
        },
        "additionalProperties": false,
        "required": [
          "domain"
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
          "description": "A firm's published profile for a domain, or null.",
          "kind": "request",
          "inputSchema": {
            "type": "object",
            "properties": {
              "domain": {
                "type": "string"
              }
            },
            "additionalProperties": false,
            "required": [
              "domain"
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
      "name": "directory.list",
      "versions": [
        1
      ],
      "latestVersion": 1,
      "description": "Firms that have published an investor-approved profile (current versions only). The one place a workspace reads another workspace's data, and only what a verified representative chose to publish.",
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
          "description": "Firms that have published an investor-approved profile (current versions only). The one place a workspace reads another workspace's data, and only what a verified representative chose to publish.",
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
      "name": "firm.monitoring.set",
      "versions": [
        1
      ],
      "latestVersion": 1,
      "description": "Pause or resume continuous monitoring of a firm, or change its interval or crawl bounds. Pausing keeps the profile and all history.",
      "kind": "request",
      "inputSchema": {
        "type": "object",
        "properties": {
          "firmId": {
            "type": "string"
          },
          "enabled": {
            "type": "boolean"
          },
          "intervalMinutes": {
            "type": "integer"
          },
          "maxPages": {
            "type": "integer"
          },
          "maxDepth": {
            "type": "integer"
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
          "target": {}
        },
        "additionalProperties": false,
        "required": [
          "target"
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
          "description": "Pause or resume continuous monitoring of a firm, or change its interval or crawl bounds. Pausing keeps the profile and all history.",
          "kind": "request",
          "inputSchema": {
            "type": "object",
            "properties": {
              "firmId": {
                "type": "string"
              },
              "enabled": {
                "type": "boolean"
              },
              "intervalMinutes": {
                "type": "integer"
              },
              "maxPages": {
                "type": "integer"
              },
              "maxDepth": {
                "type": "integer"
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
              "target": {}
            },
            "additionalProperties": false,
            "required": [
              "target"
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
      "name": "firm.reconciliation",
      "versions": [
        1
      ],
      "latestVersion": 1,
      "description": "Per-field reconciliation of the firm's own statements, third-party claims, the viewer's contributions and the firm's published profile: signals, reasons and conflicts, never a score.",
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
          "reconciliation": {}
        },
        "additionalProperties": false,
        "required": [
          "reconciliation"
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
          "description": "Per-field reconciliation of the firm's own statements, third-party claims, the viewer's contributions and the firm's published profile: signals, reasons and conflicts, never a score.",
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
              "reconciliation": {}
            },
            "additionalProperties": false,
            "required": [
              "reconciliation"
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
      "description": "Flag, dispute, correct, annotate, confirm or dismiss a research criterion, an investment event or a finding. Recorded as a separate review; the research record is not changed and nothing is approved by it.",
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
          "eventId": {
            "anyOf": [
              {
                "type": "string"
              },
              {
                "type": "null"
              }
            ]
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
          "claimId": {
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
              "note",
              "confirm",
              "dismiss"
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
          "description": "Flag, dispute, correct, annotate, confirm or dismiss a research criterion, an investment event or a finding. Recorded as a separate review; the research record is not changed and nothing is approved by it.",
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
              "eventId": {
                "anyOf": [
                  {
                    "type": "string"
                  },
                  {
                    "type": "null"
                  }
                ]
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
              "claimId": {
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
                  "note",
                  "confirm",
                  "dismiss"
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
      "name": "firm.timeline",
      "versions": [
        1
      ],
      "latestVersion": 1,
      "description": "The firm's intelligence timeline: investment events, source discoveries and changes, proposed thesis changes, conflicts, failed research and reviews. Filter by type, time range and review state.",
      "kind": "request",
      "inputSchema": {
        "type": "object",
        "properties": {
          "firmId": {
            "type": "string"
          },
          "types": {
            "type": "array",
            "items": {
              "type": "string"
            },
            "maxItems": 12
          },
          "from": {
            "type": "string"
          },
          "to": {
            "type": "string"
          },
          "reviewStates": {
            "type": "array",
            "items": {
              "type": "string"
            },
            "maxItems": 8
          },
          "limit": {
            "type": "integer"
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
          "description": "The firm's intelligence timeline: investment events, source discoveries and changes, proposed thesis changes, conflicts, failed research and reviews. Filter by type, time range and review state.",
          "kind": "request",
          "inputSchema": {
            "type": "object",
            "properties": {
              "firmId": {
                "type": "string"
              },
              "types": {
                "type": "array",
                "items": {
                  "type": "string"
                },
                "maxItems": 12
              },
              "from": {
                "type": "string"
              },
              "to": {
                "type": "string"
              },
              "reviewStates": {
                "type": "array",
                "items": {
                  "type": "string"
                },
                "maxItems": 8
              },
              "limit": {
                "type": "integer"
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
      "name": "fit.compare",
      "versions": [
        1
      ],
      "latestVersion": 1,
      "description": "What differs between two evaluations of the same startup and investor: inputs, then results.",
      "kind": "request",
      "inputSchema": {
        "type": "object",
        "properties": {
          "fromId": {
            "type": "string"
          },
          "toId": {
            "type": "string"
          }
        },
        "additionalProperties": false,
        "required": [
          "fromId",
          "toId"
        ]
      },
      "outputSchema": {
        "type": "object",
        "properties": {
          "from": {},
          "to": {},
          "inputs": {},
          "results": {}
        },
        "additionalProperties": false,
        "required": [
          "from",
          "to",
          "inputs",
          "results"
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
          "description": "What differs between two evaluations of the same startup and investor: inputs, then results.",
          "kind": "request",
          "inputSchema": {
            "type": "object",
            "properties": {
              "fromId": {
                "type": "string"
              },
              "toId": {
                "type": "string"
              }
            },
            "additionalProperties": false,
            "required": [
              "fromId",
              "toId"
            ]
          },
          "outputSchema": {
            "type": "object",
            "properties": {
              "from": {},
              "to": {},
              "inputs": {},
              "results": {}
            },
            "additionalProperties": false,
            "required": [
              "from",
              "to",
              "inputs",
              "results"
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
      "name": "fit.discover",
      "versions": [
        1
      ],
      "latestVersion": 1,
      "description": "Candidate investors for a startup, each with mandate fit, readiness, evidence quality and research coverage kept separate. Computed on demand from the current profile; nothing is stored.",
      "kind": "request",
      "inputSchema": {
        "type": "object",
        "properties": {
          "startupId": {
            "type": "string"
          },
          "filters": {
            "type": "object",
            "properties": {
              "stage": {
                "type": "array",
                "items": {
                  "type": "string"
                },
                "maxItems": 12
              },
              "sector": {
                "type": "array",
                "items": {
                  "type": "string"
                },
                "maxItems": 12
              },
              "geography": {
                "type": "array",
                "items": {
                  "type": "string"
                },
                "maxItems": 12
              },
              "businessModel": {
                "type": "array",
                "items": {
                  "type": "string"
                },
                "maxItems": 12
              },
              "checkSize": {
                "type": "object",
                "properties": {
                  "minUsd": {
                    "type": "number"
                  },
                  "maxUsd": {
                    "type": "number"
                  }
                },
                "additionalProperties": false
              },
              "approvedOnly": {
                "type": "boolean"
              },
              "freshOnly": {
                "type": "boolean"
              },
              "coverage": {
                "type": "array",
                "items": {
                  "type": "string"
                },
                "maxItems": 5
              },
              "mandate": {
                "type": "array",
                "items": {
                  "type": "string"
                },
                "maxItems": 5
              },
              "unknown": {
                "type": "boolean"
              },
              "includeFounderExcluded": {
                "type": "boolean"
              },
              "query": {
                "type": "string"
              }
            },
            "additionalProperties": false
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
          "candidates": {},
          "total": {},
          "shown": {},
          "empty": {},
          "universe": {},
          "profileVersion": {},
          "policyVersion": {},
          "evaluatedAt": {}
        },
        "additionalProperties": false,
        "required": [
          "candidates",
          "total",
          "shown",
          "empty",
          "universe",
          "profileVersion",
          "policyVersion",
          "evaluatedAt"
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
          "description": "Candidate investors for a startup, each with mandate fit, readiness, evidence quality and research coverage kept separate. Computed on demand from the current profile; nothing is stored.",
          "kind": "request",
          "inputSchema": {
            "type": "object",
            "properties": {
              "startupId": {
                "type": "string"
              },
              "filters": {
                "type": "object",
                "properties": {
                  "stage": {
                    "type": "array",
                    "items": {
                      "type": "string"
                    },
                    "maxItems": 12
                  },
                  "sector": {
                    "type": "array",
                    "items": {
                      "type": "string"
                    },
                    "maxItems": 12
                  },
                  "geography": {
                    "type": "array",
                    "items": {
                      "type": "string"
                    },
                    "maxItems": 12
                  },
                  "businessModel": {
                    "type": "array",
                    "items": {
                      "type": "string"
                    },
                    "maxItems": 12
                  },
                  "checkSize": {
                    "type": "object",
                    "properties": {
                      "minUsd": {
                        "type": "number"
                      },
                      "maxUsd": {
                        "type": "number"
                      }
                    },
                    "additionalProperties": false
                  },
                  "approvedOnly": {
                    "type": "boolean"
                  },
                  "freshOnly": {
                    "type": "boolean"
                  },
                  "coverage": {
                    "type": "array",
                    "items": {
                      "type": "string"
                    },
                    "maxItems": 5
                  },
                  "mandate": {
                    "type": "array",
                    "items": {
                      "type": "string"
                    },
                    "maxItems": 5
                  },
                  "unknown": {
                    "type": "boolean"
                  },
                  "includeFounderExcluded": {
                    "type": "boolean"
                  },
                  "query": {
                    "type": "string"
                  }
                },
                "additionalProperties": false
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
              "candidates": {},
              "total": {},
              "shown": {},
              "empty": {},
              "universe": {},
              "profileVersion": {},
              "policyVersion": {},
              "evaluatedAt": {}
            },
            "additionalProperties": false,
            "required": [
              "candidates",
              "total",
              "shown",
              "empty",
              "universe",
              "profileVersion",
              "policyVersion",
              "evaluatedAt"
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
      "name": "fit.evaluate",
      "versions": [
        1
      ],
      "latestVersion": 1,
      "description": "Evaluates one investor against the startup's current profile and evidence and records the evaluation with every input version. Identical inputs return the existing evaluation; changed inputs create a new one and never alter an earlier one.",
      "kind": "request",
      "inputSchema": {
        "type": "object",
        "properties": {
          "startupId": {
            "type": "string"
          },
          "investorKey": {
            "type": "string"
          }
        },
        "additionalProperties": false,
        "required": [
          "startupId",
          "investorKey"
        ]
      },
      "outputSchema": {
        "type": "object",
        "properties": {
          "evaluation": {},
          "reused": {},
          "previous": {}
        },
        "additionalProperties": false,
        "required": [
          "evaluation",
          "reused",
          "previous"
        ]
      },
      "authorization": [
        "evaluation.run"
      ],
      "idempotency": "unsupported",
      "concurrency": {
        "mode": "parallel"
      },
      "definitions": [
        {
          "version": 1,
          "description": "Evaluates one investor against the startup's current profile and evidence and records the evaluation with every input version. Identical inputs return the existing evaluation; changed inputs create a new one and never alter an earlier one.",
          "kind": "request",
          "inputSchema": {
            "type": "object",
            "properties": {
              "startupId": {
                "type": "string"
              },
              "investorKey": {
                "type": "string"
              }
            },
            "additionalProperties": false,
            "required": [
              "startupId",
              "investorKey"
            ]
          },
          "outputSchema": {
            "type": "object",
            "properties": {
              "evaluation": {},
              "reused": {},
              "previous": {}
            },
            "additionalProperties": false,
            "required": [
              "evaluation",
              "reused",
              "previous"
            ]
          },
          "authorization": [
            "evaluation.run"
          ],
          "idempotency": "unsupported",
          "concurrency": {
            "mode": "parallel"
          }
        }
      ]
    },
    {
      "name": "fit.get",
      "versions": [
        1
      ],
      "latestVersion": 1,
      "description": "A recorded evaluation with its explanation, and whether its inputs are still current.",
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
          "evaluation": {},
          "staleness": {}
        },
        "additionalProperties": false,
        "required": [
          "evaluation",
          "staleness"
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
          "description": "A recorded evaluation with its explanation, and whether its inputs are still current.",
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
              "evaluation": {},
              "staleness": {}
            },
            "additionalProperties": false,
            "required": [
              "evaluation",
              "staleness"
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
      "name": "fit.history",
      "versions": [
        1
      ],
      "latestVersion": 1,
      "description": "Recorded evaluations for a startup, newest first, optionally for one investor.",
      "kind": "request",
      "inputSchema": {
        "type": "object",
        "properties": {
          "startupId": {
            "type": "string"
          },
          "investorKey": {
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
          "description": "Recorded evaluations for a startup, newest first, optionally for one investor.",
          "kind": "request",
          "inputSchema": {
            "type": "object",
            "properties": {
              "startupId": {
                "type": "string"
              },
              "investorKey": {
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
      "name": "inbox.list",
      "versions": [
        1
      ],
      "latestVersion": 1,
      "description": "What needs the caller's decision: candidate matches, unresolved conflicts, proposed claims, shared contributions, representative claims (moderators) and disputed contributions (authors).",
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
          "description": "What needs the caller's decision: candidate matches, unresolved conflicts, proposed claims, shared contributions, representative claims (moderators) and disputed contributions (authors).",
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
      "name": "match.decide",
      "versions": [
        1
      ],
      "latestVersion": 1,
      "description": "Confirms or rejects a candidate match between a source record and an existing entity, with a rationale. Rejections are remembered; nothing is merged or deleted.",
      "kind": "request",
      "inputSchema": {
        "type": "object",
        "properties": {
          "matchId": {
            "type": "string"
          },
          "decision": {
            "type": "string",
            "enum": [
              "confirm",
              "reject"
            ]
          },
          "entityType": {
            "type": "string",
            "enum": [
              "firm",
              "entity"
            ]
          },
          "entityId": {
            "type": "string"
          },
          "rationale": {
            "type": "string"
          }
        },
        "additionalProperties": false,
        "required": [
          "matchId",
          "decision",
          "entityType",
          "entityId",
          "rationale"
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
        "review.write"
      ],
      "idempotency": "unsupported",
      "concurrency": {
        "mode": "parallel"
      },
      "definitions": [
        {
          "version": 1,
          "description": "Confirms or rejects a candidate match between a source record and an existing entity, with a rationale. Rejections are remembered; nothing is merged or deleted.",
          "kind": "request",
          "inputSchema": {
            "type": "object",
            "properties": {
              "matchId": {
                "type": "string"
              },
              "decision": {
                "type": "string",
                "enum": [
                  "confirm",
                  "reject"
                ]
              },
              "entityType": {
                "type": "string",
                "enum": [
                  "firm",
                  "entity"
                ]
              },
              "entityId": {
                "type": "string"
              },
              "rationale": {
                "type": "string"
              }
            },
            "additionalProperties": false,
            "required": [
              "matchId",
              "decision",
              "entityType",
              "entityId",
              "rationale"
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
      "name": "match.list",
      "versions": [
        1
      ],
      "latestVersion": 1,
      "description": "Candidate matches awaiting a decision, and the history of decisions.",
      "kind": "request",
      "inputSchema": {
        "type": "object",
        "properties": {},
        "additionalProperties": false
      },
      "outputSchema": {
        "type": "object",
        "properties": {
          "open": {},
          "history": {}
        },
        "additionalProperties": false,
        "required": [
          "open",
          "history"
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
          "description": "Candidate matches awaiting a decision, and the history of decisions.",
          "kind": "request",
          "inputSchema": {
            "type": "object",
            "properties": {},
            "additionalProperties": false
          },
          "outputSchema": {
            "type": "object",
            "properties": {
              "open": {},
              "history": {}
            },
            "additionalProperties": false,
            "required": [
              "open",
              "history"
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
      "name": "profile.approval.withdraw",
      "versions": [
        1
      ],
      "latestVersion": 1,
      "description": "A verified representative withdraws one of their approvals by appending a withdrawal.",
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
        "profile.publish"
      ],
      "idempotency": "unsupported",
      "concurrency": {
        "mode": "parallel"
      },
      "definitions": [
        {
          "version": 1,
          "description": "A verified representative withdraws one of their approvals by appending a withdrawal.",
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
            "profile.publish"
          ],
          "idempotency": "unsupported",
          "concurrency": {
            "mode": "parallel"
          }
        }
      ]
    },
    {
      "name": "profile.approve",
      "versions": [
        1
      ],
      "latestVersion": 1,
      "description": "A verified representative approves one of the firm's criteria as the firm itself, from a research criterion, a third-party claim, or entered by hand. Works only with a verified claim for the firm's domain.",
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
          "claimId": {
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
        "profile.publish"
      ],
      "idempotency": "unsupported",
      "concurrency": {
        "mode": "parallel"
      },
      "definitions": [
        {
          "version": 1,
          "description": "A verified representative approves one of the firm's criteria as the firm itself, from a research criterion, a third-party claim, or entered by hand. Works only with a verified claim for the firm's domain.",
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
              "claimId": {
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
            "profile.publish"
          ],
          "idempotency": "unsupported",
          "concurrency": {
            "mode": "parallel"
          }
        }
      ]
    },
    {
      "name": "profile.claim.check",
      "versions": [
        1
      ],
      "latestVersion": 1,
      "description": "Checks the domain-control proof for the caller's own claim through the safe-fetch boundary. The result is evidence for the moderator, not authority.",
      "kind": "request",
      "inputSchema": {
        "type": "object",
        "properties": {
          "claimId": {
            "type": "string"
          }
        },
        "additionalProperties": false,
        "required": [
          "claimId"
        ]
      },
      "outputSchema": {
        "type": "object",
        "properties": {
          "event": {}
        },
        "additionalProperties": false,
        "required": [
          "event"
        ]
      },
      "authorization": [
        "profile.claim"
      ],
      "idempotency": "unsupported",
      "concurrency": {
        "mode": "parallel"
      },
      "definitions": [
        {
          "version": 1,
          "description": "Checks the domain-control proof for the caller's own claim through the safe-fetch boundary. The result is evidence for the moderator, not authority.",
          "kind": "request",
          "inputSchema": {
            "type": "object",
            "properties": {
              "claimId": {
                "type": "string"
              }
            },
            "additionalProperties": false,
            "required": [
              "claimId"
            ]
          },
          "outputSchema": {
            "type": "object",
            "properties": {
              "event": {}
            },
            "additionalProperties": false,
            "required": [
              "event"
            ]
          },
          "authorization": [
            "profile.claim"
          ],
          "idempotency": "unsupported",
          "concurrency": {
            "mode": "parallel"
          }
        }
      ]
    },
    {
      "name": "profile.claim.mine",
      "versions": [
        1
      ],
      "latestVersion": 1,
      "description": "The caller's representative claims with their status and history.",
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
        "profile.claim"
      ],
      "idempotency": "unsupported",
      "concurrency": {
        "mode": "parallel"
      },
      "definitions": [
        {
          "version": 1,
          "description": "The caller's representative claims with their status and history.",
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
            "profile.claim"
          ],
          "idempotency": "unsupported",
          "concurrency": {
            "mode": "parallel"
          }
        }
      ]
    },
    {
      "name": "profile.claim.request",
      "versions": [
        1
      ],
      "latestVersion": 1,
      "description": "Requests to represent a firm. Returns a challenge to publish at /.well-known/attn-invest-claim.txt. Signing up is not authority: a moderator must verify the claim.",
      "kind": "request",
      "inputSchema": {
        "type": "object",
        "properties": {
          "domain": {
            "type": "string"
          },
          "firmName": {
            "type": "string"
          },
          "relationship": {
            "type": "string"
          }
        },
        "additionalProperties": false,
        "required": [
          "domain",
          "firmName",
          "relationship"
        ]
      },
      "outputSchema": {
        "type": "object",
        "properties": {
          "claim": {},
          "status": {},
          "firmId": {}
        },
        "additionalProperties": false,
        "required": [
          "claim",
          "status",
          "firmId"
        ]
      },
      "authorization": [
        "profile.claim"
      ],
      "idempotency": "unsupported",
      "concurrency": {
        "mode": "parallel"
      },
      "definitions": [
        {
          "version": 1,
          "description": "Requests to represent a firm. Returns a challenge to publish at /.well-known/attn-invest-claim.txt. Signing up is not authority: a moderator must verify the claim.",
          "kind": "request",
          "inputSchema": {
            "type": "object",
            "properties": {
              "domain": {
                "type": "string"
              },
              "firmName": {
                "type": "string"
              },
              "relationship": {
                "type": "string"
              }
            },
            "additionalProperties": false,
            "required": [
              "domain",
              "firmName",
              "relationship"
            ]
          },
          "outputSchema": {
            "type": "object",
            "properties": {
              "claim": {},
              "status": {},
              "firmId": {}
            },
            "additionalProperties": false,
            "required": [
              "claim",
              "status",
              "firmId"
            ]
          },
          "authorization": [
            "profile.claim"
          ],
          "idempotency": "unsupported",
          "concurrency": {
            "mode": "parallel"
          }
        }
      ]
    },
    {
      "name": "profile.history",
      "versions": [
        1
      ],
      "latestVersion": 1,
      "description": "Approvals, withdrawals, publications and claim decisions for a firm, newest first.",
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
          "description": "Approvals, withdrawals, publications and claim decisions for a firm, newest first.",
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
      "name": "profile.publish",
      "versions": [
        1
      ],
      "latestVersion": 1,
      "description": "Publishes exactly the chosen representative-approved criteria as a new version of the firm's public profile, readable by every workspace. Nothing is published unless chosen.",
      "kind": "request",
      "inputSchema": {
        "type": "object",
        "properties": {
          "firmId": {
            "type": "string"
          },
          "approvalIds": {
            "type": "array",
            "items": {
              "type": "string"
            },
            "maxItems": 50
          },
          "note": {
            "type": "string"
          }
        },
        "additionalProperties": false,
        "required": [
          "firmId",
          "approvalIds"
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
        "profile.publish"
      ],
      "idempotency": "unsupported",
      "concurrency": {
        "mode": "parallel"
      },
      "definitions": [
        {
          "version": 1,
          "description": "Publishes exactly the chosen representative-approved criteria as a new version of the firm's public profile, readable by every workspace. Nothing is published unless chosen.",
          "kind": "request",
          "inputSchema": {
            "type": "object",
            "properties": {
              "firmId": {
                "type": "string"
              },
              "approvalIds": {
                "type": "array",
                "items": {
                  "type": "string"
                },
                "maxItems": 50
              },
              "note": {
                "type": "string"
              }
            },
            "additionalProperties": false,
            "required": [
              "firmId",
              "approvalIds"
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
            "profile.publish"
          ],
          "idempotency": "unsupported",
          "concurrency": {
            "mode": "parallel"
          }
        }
      ]
    },
    {
      "name": "profile.unpublish",
      "versions": [
        1
      ],
      "latestVersion": 1,
      "description": "Withdraws the published profile by appending a withdrawal version. Earlier versions stay in the history.",
      "kind": "request",
      "inputSchema": {
        "type": "object",
        "properties": {
          "firmId": {
            "type": "string"
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
          "profile": {}
        },
        "additionalProperties": false,
        "required": [
          "profile"
        ]
      },
      "authorization": [
        "profile.publish"
      ],
      "idempotency": "unsupported",
      "concurrency": {
        "mode": "parallel"
      },
      "definitions": [
        {
          "version": 1,
          "description": "Withdraws the published profile by appending a withdrawal version. Earlier versions stay in the history.",
          "kind": "request",
          "inputSchema": {
            "type": "object",
            "properties": {
              "firmId": {
                "type": "string"
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
              "profile": {}
            },
            "additionalProperties": false,
            "required": [
              "profile"
            ]
          },
          "authorization": [
            "profile.publish"
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
      "name": "shortlist.list",
      "versions": [
        1
      ],
      "latestVersion": 1,
      "description": "The startup's private shortlist with each investor's latest evaluation, whether it is still current, and its prioritised recommended actions.",
      "kind": "request",
      "inputSchema": {
        "type": "object",
        "properties": {
          "startupId": {
            "type": "string"
          },
          "includeRemoved": {
            "type": "boolean"
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
          "description": "The startup's private shortlist with each investor's latest evaluation, whether it is still current, and its prioritised recommended actions.",
          "kind": "request",
          "inputSchema": {
            "type": "object",
            "properties": {
              "startupId": {
                "type": "string"
              },
              "includeRemoved": {
                "type": "boolean"
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
      "name": "shortlist.plan",
      "versions": [
        1
      ],
      "latestVersion": 1,
      "description": "Open recommended actions across the shortlist, in priority order. Recommendations about the startup's materials, not predictions.",
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
          "actions": {}
        },
        "additionalProperties": false,
        "required": [
          "actions"
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
          "description": "Open recommended actions across the shortlist, in priority order. Recommendations about the startup's materials, not predictions.",
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
              "actions": {}
            },
            "additionalProperties": false,
            "required": [
              "actions"
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
      "name": "shortlist.save",
      "versions": [
        1
      ],
      "latestVersion": 1,
      "description": "Adds an investor to the startup's private shortlist, or restores a removed one.",
      "kind": "request",
      "inputSchema": {
        "type": "object",
        "properties": {
          "startupId": {
            "type": "string"
          },
          "investorKey": {
            "type": "string"
          },
          "status": {
            "type": "string",
            "enum": [
              "considering",
              "ready",
              "parked",
              "ruled_out"
            ]
          },
          "note": {
            "type": "string"
          }
        },
        "additionalProperties": false,
        "required": [
          "startupId",
          "investorKey"
        ]
      },
      "outputSchema": {
        "type": "object",
        "properties": {
          "entry": {}
        },
        "additionalProperties": false,
        "required": [
          "entry"
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
          "description": "Adds an investor to the startup's private shortlist, or restores a removed one.",
          "kind": "request",
          "inputSchema": {
            "type": "object",
            "properties": {
              "startupId": {
                "type": "string"
              },
              "investorKey": {
                "type": "string"
              },
              "status": {
                "type": "string",
                "enum": [
                  "considering",
                  "ready",
                  "parked",
                  "ruled_out"
                ]
              },
              "note": {
                "type": "string"
              }
            },
            "additionalProperties": false,
            "required": [
              "startupId",
              "investorKey"
            ]
          },
          "outputSchema": {
            "type": "object",
            "properties": {
              "entry": {}
            },
            "additionalProperties": false,
            "required": [
              "entry"
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
      "name": "shortlist.update",
      "versions": [
        1
      ],
      "latestVersion": 1,
      "description": "Changes a shortlist entry's status or note, marks recommended actions done or dismissed, or removes it. Fenced on expectedVersion.",
      "kind": "request",
      "inputSchema": {
        "type": "object",
        "properties": {
          "entryId": {
            "type": "string"
          },
          "expectedVersion": {
            "type": "integer"
          },
          "status": {
            "type": "string",
            "enum": [
              "considering",
              "ready",
              "parked",
              "ruled_out"
            ]
          },
          "note": {
            "type": "string"
          },
          "actions": {},
          "remove": {
            "type": "boolean"
          }
        },
        "additionalProperties": false,
        "required": [
          "entryId",
          "expectedVersion"
        ]
      },
      "outputSchema": {
        "type": "object",
        "properties": {
          "entry": {}
        },
        "additionalProperties": false,
        "required": [
          "entry"
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
          "description": "Changes a shortlist entry's status or note, marks recommended actions done or dismissed, or removes it. Fenced on expectedVersion.",
          "kind": "request",
          "inputSchema": {
            "type": "object",
            "properties": {
              "entryId": {
                "type": "string"
              },
              "expectedVersion": {
                "type": "integer"
              },
              "status": {
                "type": "string",
                "enum": [
                  "considering",
                  "ready",
                  "parked",
                  "ruled_out"
                ]
              },
              "note": {
                "type": "string"
              },
              "actions": {},
              "remove": {
                "type": "boolean"
              }
            },
            "additionalProperties": false,
            "required": [
              "entryId",
              "expectedVersion"
            ]
          },
          "outputSchema": {
            "type": "object",
            "properties": {
              "entry": {}
            },
            "additionalProperties": false,
            "required": [
              "entry"
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
      "name": "source.get",
      "versions": [
        1
      ],
      "latestVersion": 1,
      "description": "One source: terms and limitations, run history with per-record errors, snapshots, record counts and match tallies.",
      "kind": "request",
      "inputSchema": {
        "type": "object",
        "properties": {
          "sourceId": {
            "type": "string"
          }
        },
        "additionalProperties": false,
        "required": [
          "sourceId"
        ]
      },
      "outputSchema": {
        "type": "object",
        "properties": {
          "detail": {}
        },
        "additionalProperties": false,
        "required": [
          "detail"
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
          "description": "One source: terms and limitations, run history with per-record errors, snapshots, record counts and match tallies.",
          "kind": "request",
          "inputSchema": {
            "type": "object",
            "properties": {
              "sourceId": {
                "type": "string"
              }
            },
            "additionalProperties": false,
            "required": [
              "sourceId"
            ]
          },
          "outputSchema": {
            "type": "object",
            "properties": {
              "detail": {}
            },
            "additionalProperties": false,
            "required": [
              "detail"
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
      "name": "source.list",
      "versions": [
        1
      ],
      "latestVersion": 1,
      "description": "Curated sources with monitoring status, last attempt, last success and next check.",
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
          "description": "Curated sources with monitoring status, last attempt, last success and next check.",
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
      "name": "source.monitoring.set",
      "versions": [
        1
      ],
      "latestVersion": 1,
      "description": "Pauses or resumes monitoring of a source, or changes its interval. Pausing keeps its records, claims and history.",
      "kind": "request",
      "inputSchema": {
        "type": "object",
        "properties": {
          "sourceId": {
            "type": "string"
          },
          "enabled": {
            "type": "boolean"
          },
          "intervalMinutes": {
            "type": "integer"
          }
        },
        "additionalProperties": false,
        "required": [
          "sourceId"
        ]
      },
      "outputSchema": {
        "type": "object",
        "properties": {
          "target": {}
        },
        "additionalProperties": false,
        "required": [
          "target"
        ]
      },
      "authorization": [
        "source.manage"
      ],
      "idempotency": "unsupported",
      "concurrency": {
        "mode": "parallel"
      },
      "definitions": [
        {
          "version": 1,
          "description": "Pauses or resumes monitoring of a source, or changes its interval. Pausing keeps its records, claims and history.",
          "kind": "request",
          "inputSchema": {
            "type": "object",
            "properties": {
              "sourceId": {
                "type": "string"
              },
              "enabled": {
                "type": "boolean"
              },
              "intervalMinutes": {
                "type": "integer"
              }
            },
            "additionalProperties": false,
            "required": [
              "sourceId"
            ]
          },
          "outputSchema": {
            "type": "object",
            "properties": {
              "target": {}
            },
            "additionalProperties": false,
            "required": [
              "target"
            ]
          },
          "authorization": [
            "source.manage"
          ],
          "idempotency": "unsupported",
          "concurrency": {
            "mode": "parallel"
          }
        }
      ]
    },
    {
      "name": "source.records",
      "versions": [
        1
      ],
      "latestVersion": 1,
      "description": "Normalised records a source produced, with their original identifiers, passages and parse notes.",
      "kind": "request",
      "inputSchema": {
        "type": "object",
        "properties": {
          "sourceId": {
            "type": "string"
          },
          "limit": {
            "type": "integer"
          }
        },
        "additionalProperties": false,
        "required": [
          "sourceId"
        ]
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
          "description": "Normalised records a source produced, with their original identifiers, passages and parse notes.",
          "kind": "request",
          "inputSchema": {
            "type": "object",
            "properties": {
              "sourceId": {
                "type": "string"
              },
              "limit": {
                "type": "integer"
              }
            },
            "additionalProperties": false,
            "required": [
              "sourceId"
            ]
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
      "name": "source.refresh",
      "versions": [
        1
      ],
      "latestVersion": 1,
      "description": "Retrieves one registered source now, in this process. Accepts a source id only, never a URL.",
      "kind": "request",
      "inputSchema": {
        "type": "object",
        "properties": {
          "sourceId": {
            "type": "string"
          }
        },
        "additionalProperties": false,
        "required": [
          "sourceId"
        ]
      },
      "outputSchema": {
        "type": "object",
        "properties": {
          "run": {}
        },
        "additionalProperties": false,
        "required": [
          "run"
        ]
      },
      "authorization": [
        "source.manage"
      ],
      "idempotency": "unsupported",
      "concurrency": {
        "mode": "keyed",
        "key": "sourceId"
      },
      "definitions": [
        {
          "version": 1,
          "description": "Retrieves one registered source now, in this process. Accepts a source id only, never a URL.",
          "kind": "request",
          "inputSchema": {
            "type": "object",
            "properties": {
              "sourceId": {
                "type": "string"
              }
            },
            "additionalProperties": false,
            "required": [
              "sourceId"
            ]
          },
          "outputSchema": {
            "type": "object",
            "properties": {
              "run": {}
            },
            "additionalProperties": false,
            "required": [
              "run"
            ]
          },
          "authorization": [
            "source.manage"
          ],
          "idempotency": "unsupported",
          "concurrency": {
            "mode": "keyed",
            "key": "sourceId"
          }
        }
      ]
    },
    {
      "name": "source.register",
      "versions": [
        1
      ],
      "latestVersion": 1,
      "description": "Registers a curated third-party source (directory, dataset, funding-news feed) for monitoring. The registrant attests why automated access is permitted and where the terms say so; fetching uses the safe-fetch boundary.",
      "kind": "request",
      "inputSchema": {
        "type": "object",
        "properties": {
          "name": {
            "type": "string"
          },
          "canonicalUrl": {
            "type": "string"
          },
          "publisher": {
            "type": "string"
          },
          "sourceType": {
            "type": "string",
            "enum": [
              "directory",
              "curated_list",
              "funding_news",
              "portfolio_aggregator",
              "dataset"
            ]
          },
          "adapter": {
            "type": "string",
            "enum": [
              "funding_news_feed",
              "csv_dataset",
              "json_dataset"
            ]
          },
          "accessBasis": {
            "type": "string",
            "enum": [
              "published_terms_permit",
              "public_feed",
              "licensed_dataset",
              "owner_permission"
            ]
          },
          "termsNote": {
            "type": "string"
          },
          "limitations": {
            "type": "string"
          },
          "extraHosts": {
            "type": "array",
            "items": {
              "type": "string"
            },
            "maxItems": 3
          },
          "mapping": {
            "type": "object",
            "properties": {
              "recordsPath": {
                "type": "string"
              },
              "idField": {
                "type": "string"
              },
              "nameField": {
                "type": "string"
              },
              "websiteField": {
                "type": "string"
              },
              "stageField": {
                "type": "string"
              },
              "sectorsField": {
                "type": "string"
              },
              "geographyField": {
                "type": "string"
              },
              "checkMinField": {
                "type": "string"
              },
              "checkMaxField": {
                "type": "string"
              },
              "updatedField": {
                "type": "string"
              },
              "listDelimiter": {
                "type": "string"
              },
              "checkUnit": {
                "type": "string",
                "enum": [
                  "usd",
                  "thousands",
                  "millions"
                ]
              },
              "recordKind": {
                "type": "string",
                "enum": [
                  "investor",
                  "portfolio_company"
                ]
              },
              "investorField": {
                "type": "string"
              }
            },
            "additionalProperties": false,
            "required": [
              "nameField"
            ]
          },
          "intervalMinutes": {
            "type": "integer"
          }
        },
        "additionalProperties": false,
        "required": [
          "name",
          "canonicalUrl",
          "publisher",
          "sourceType",
          "adapter",
          "accessBasis",
          "termsNote"
        ]
      },
      "outputSchema": {
        "type": "object",
        "properties": {
          "source": {},
          "created": {}
        },
        "additionalProperties": false,
        "required": [
          "source",
          "created"
        ]
      },
      "authorization": [
        "source.manage"
      ],
      "idempotency": "unsupported",
      "concurrency": {
        "mode": "parallel"
      },
      "definitions": [
        {
          "version": 1,
          "description": "Registers a curated third-party source (directory, dataset, funding-news feed) for monitoring. The registrant attests why automated access is permitted and where the terms say so; fetching uses the safe-fetch boundary.",
          "kind": "request",
          "inputSchema": {
            "type": "object",
            "properties": {
              "name": {
                "type": "string"
              },
              "canonicalUrl": {
                "type": "string"
              },
              "publisher": {
                "type": "string"
              },
              "sourceType": {
                "type": "string",
                "enum": [
                  "directory",
                  "curated_list",
                  "funding_news",
                  "portfolio_aggregator",
                  "dataset"
                ]
              },
              "adapter": {
                "type": "string",
                "enum": [
                  "funding_news_feed",
                  "csv_dataset",
                  "json_dataset"
                ]
              },
              "accessBasis": {
                "type": "string",
                "enum": [
                  "published_terms_permit",
                  "public_feed",
                  "licensed_dataset",
                  "owner_permission"
                ]
              },
              "termsNote": {
                "type": "string"
              },
              "limitations": {
                "type": "string"
              },
              "extraHosts": {
                "type": "array",
                "items": {
                  "type": "string"
                },
                "maxItems": 3
              },
              "mapping": {
                "type": "object",
                "properties": {
                  "recordsPath": {
                    "type": "string"
                  },
                  "idField": {
                    "type": "string"
                  },
                  "nameField": {
                    "type": "string"
                  },
                  "websiteField": {
                    "type": "string"
                  },
                  "stageField": {
                    "type": "string"
                  },
                  "sectorsField": {
                    "type": "string"
                  },
                  "geographyField": {
                    "type": "string"
                  },
                  "checkMinField": {
                    "type": "string"
                  },
                  "checkMaxField": {
                    "type": "string"
                  },
                  "updatedField": {
                    "type": "string"
                  },
                  "listDelimiter": {
                    "type": "string"
                  },
                  "checkUnit": {
                    "type": "string",
                    "enum": [
                      "usd",
                      "thousands",
                      "millions"
                    ]
                  },
                  "recordKind": {
                    "type": "string",
                    "enum": [
                      "investor",
                      "portfolio_company"
                    ]
                  },
                  "investorField": {
                    "type": "string"
                  }
                },
                "additionalProperties": false,
                "required": [
                  "nameField"
                ]
              },
              "intervalMinutes": {
                "type": "integer"
              }
            },
            "additionalProperties": false,
            "required": [
              "name",
              "canonicalUrl",
              "publisher",
              "sourceType",
              "adapter",
              "accessBasis",
              "termsNote"
            ]
          },
          "outputSchema": {
            "type": "object",
            "properties": {
              "source": {},
              "created": {}
            },
            "additionalProperties": false,
            "required": [
              "source",
              "created"
            ]
          },
          "authorization": [
            "source.manage"
          ],
          "idempotency": "unsupported",
          "concurrency": {
            "mode": "parallel"
          }
        }
      ]
    },
    {
      "name": "source.update",
      "versions": [
        1
      ],
      "latestVersion": 1,
      "description": "Updates a source's name, terms note, limitations or mapping. A changed mapping reprocesses the next retrieval.",
      "kind": "request",
      "inputSchema": {
        "type": "object",
        "properties": {
          "sourceId": {
            "type": "string"
          },
          "name": {
            "type": "string"
          },
          "termsNote": {
            "type": "string"
          },
          "limitations": {
            "type": "string"
          },
          "mapping": {
            "type": "object",
            "properties": {
              "recordsPath": {
                "type": "string"
              },
              "idField": {
                "type": "string"
              },
              "nameField": {
                "type": "string"
              },
              "websiteField": {
                "type": "string"
              },
              "stageField": {
                "type": "string"
              },
              "sectorsField": {
                "type": "string"
              },
              "geographyField": {
                "type": "string"
              },
              "checkMinField": {
                "type": "string"
              },
              "checkMaxField": {
                "type": "string"
              },
              "updatedField": {
                "type": "string"
              },
              "listDelimiter": {
                "type": "string"
              },
              "checkUnit": {
                "type": "string",
                "enum": [
                  "usd",
                  "thousands",
                  "millions"
                ]
              },
              "recordKind": {
                "type": "string",
                "enum": [
                  "investor",
                  "portfolio_company"
                ]
              },
              "investorField": {
                "type": "string"
              }
            },
            "additionalProperties": false,
            "required": [
              "nameField"
            ]
          }
        },
        "additionalProperties": false,
        "required": [
          "sourceId"
        ]
      },
      "outputSchema": {
        "type": "object",
        "properties": {
          "source": {}
        },
        "additionalProperties": false,
        "required": [
          "source"
        ]
      },
      "authorization": [
        "source.manage"
      ],
      "idempotency": "unsupported",
      "concurrency": {
        "mode": "parallel"
      },
      "definitions": [
        {
          "version": 1,
          "description": "Updates a source's name, terms note, limitations or mapping. A changed mapping reprocesses the next retrieval.",
          "kind": "request",
          "inputSchema": {
            "type": "object",
            "properties": {
              "sourceId": {
                "type": "string"
              },
              "name": {
                "type": "string"
              },
              "termsNote": {
                "type": "string"
              },
              "limitations": {
                "type": "string"
              },
              "mapping": {
                "type": "object",
                "properties": {
                  "recordsPath": {
                    "type": "string"
                  },
                  "idField": {
                    "type": "string"
                  },
                  "nameField": {
                    "type": "string"
                  },
                  "websiteField": {
                    "type": "string"
                  },
                  "stageField": {
                    "type": "string"
                  },
                  "sectorsField": {
                    "type": "string"
                  },
                  "geographyField": {
                    "type": "string"
                  },
                  "checkMinField": {
                    "type": "string"
                  },
                  "checkMaxField": {
                    "type": "string"
                  },
                  "updatedField": {
                    "type": "string"
                  },
                  "listDelimiter": {
                    "type": "string"
                  },
                  "checkUnit": {
                    "type": "string",
                    "enum": [
                      "usd",
                      "thousands",
                      "millions"
                    ]
                  },
                  "recordKind": {
                    "type": "string",
                    "enum": [
                      "investor",
                      "portfolio_company"
                    ]
                  },
                  "investorField": {
                    "type": "string"
                  }
                },
                "additionalProperties": false,
                "required": [
                  "nameField"
                ]
              }
            },
            "additionalProperties": false,
            "required": [
              "sourceId"
            ]
          },
          "outputSchema": {
            "type": "object",
            "properties": {
              "source": {}
            },
            "additionalProperties": false,
            "required": [
              "source"
            ]
          },
          "authorization": [
            "source.manage"
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
      "name": "startup.profile.get",
      "versions": [
        1
      ],
      "latestVersion": 1,
      "description": "The startup's private profile (current version, its content with per-field provenance, and the version history).",
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
          "startup": {},
          "version": {},
          "content": {},
          "versions": {}
        },
        "additionalProperties": false,
        "required": [
          "startup",
          "version",
          "content",
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
          "description": "The startup's private profile (current version, its content with per-field provenance, and the version history).",
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
              "startup": {},
              "version": {},
              "content": {},
              "versions": {}
            },
            "additionalProperties": false,
            "required": [
              "startup",
              "version",
              "content",
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
      "name": "startup.profile.save",
      "versions": [
        1
      ],
      "latestVersion": 1,
      "description": "Saves the startup profile as a new immutable version, fenced on expectedVersion (0 for the first). Saving identical content creates no new version. Unknown and not-applicable are valid field states.",
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
          "content": {},
          "note": {
            "type": "string"
          }
        },
        "additionalProperties": false,
        "required": [
          "startupId",
          "expectedVersion",
          "content"
        ]
      },
      "outputSchema": {
        "type": "object",
        "properties": {
          "unchanged": {},
          "version": {},
          "content": {},
          "versions": {}
        },
        "additionalProperties": false,
        "required": [
          "unchanged",
          "version",
          "content",
          "versions"
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
          "description": "Saves the startup profile as a new immutable version, fenced on expectedVersion (0 for the first). Saving identical content creates no new version. Unknown and not-applicable are valid field states.",
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
              "content": {},
              "note": {
                "type": "string"
              }
            },
            "additionalProperties": false,
            "required": [
              "startupId",
              "expectedVersion",
              "content"
            ]
          },
          "outputSchema": {
            "type": "object",
            "properties": {
              "unchanged": {},
              "version": {},
              "content": {},
              "versions": {}
            },
            "additionalProperties": false,
            "required": [
              "unchanged",
              "version",
              "content",
              "versions"
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
