import { type CapabilityContext, defineCapability, errors, s } from "@appport/sdk";
import { InvestError } from "../domain/errors.ts";
import { ADAPTER_IDS, ACCESS_BASES, CONTRIBUTION_KINDS, type DatasetMapping, type ShareAudience } from "../domain/collab.ts";
import { attentionFor } from "../modules/investor-research.ts";
import { CRITERION_FIELDS, RESEARCH_STATUSES, type CriterionField, type ResearchStatus, type ReviewAction } from "../domain/research.ts";
import { METRIC_KEYS, OUTCOMES, SOURCE_TYPES, type Actor, type InvestmentCriterion, type ThesisSettings } from "../domain/types.ts";
import { validateThesisContent } from "../modules/investment-thesis.ts";
import type { InvestmentService } from "../service.ts";

/**
 * The declared AppPort surface of the investment application. Handlers are thin: resolve the
 * actor from the authenticated session, call one service operation, map domain errors.
 *
 * Workspace identity is taken only from `session.attributes.tenantId`, set by the AuthBoundry
 * adapter. No capability accepts a workspace id, so a caller cannot address another workspace by
 * changing an input; a foreign record id resolves to NOT_FOUND exactly like a missing one.
 *
 * Failure contract (all capabilities): UNAUTHORIZED without a valid credential; FORBIDDEN without
 * the listed permission; INVALID_INPUT for schema or domain validation failures (details carry
 * field paths); NOT_FOUND for absent or foreign records; CONFLICT for lost races, stale
 * `expectedVersion`/`expectedSequence`, or unmet preconditions (details.reason = "precondition");
 * PAYLOAD_TOO_LARGE for uploads over DOCUMENT_MAX_BYTES; INTERNAL for anything else (sanitised).
 */

function service(context: CapabilityContext): InvestmentService {
	const svc = context.services.invest as InvestmentService | undefined;
	if (!svc) throw errors.internal("Investment service is unavailable");
	return svc;
}

export function actorFrom(context: CapabilityContext): Actor {
	const session = context.session;
	const workspaceId = session?.attributes?.tenantId;
	if (!session?.principal?.id || typeof workspaceId !== "string" || !workspaceId) throw errors.unauthorized("An authenticated workspace session is required");
	const displayName = typeof session.attributes?.displayName === "string" ? session.attributes.displayName : session.principal.id;
	const role = typeof session.attributes?.role === "string" ? session.attributes.role : undefined;
	return { principalId: session.principal.id, displayName, workspaceId, permissions: session.permissions ?? [], role };
}

function mapError(error: unknown): never {
	if (error instanceof InvestError) {
		const details = (error.details ?? undefined) as never;
		switch (error.code) {
			case "invalid":
				throw errors.invalidInput(error.message, details);
			case "not_found":
				throw errors.notFound(error.message);
			case "conflict":
				throw errors.conflict(error.message, details);
			case "precondition":
				throw errors.conflict(error.message, { reason: "precondition", ...((error.details as object) ?? {}) } as never);
			case "forbidden":
				throw errors.forbidden(error.message);
			case "too_large":
				throw errors.payloadTooLarge(error.message);
			default:
				throw errors.internal("The operation could not be completed");
		}
	}
	throw error;
}

function run<I, O>(fn: (svc: InvestmentService, actor: Actor, input: I) => Promise<O>) {
	return async (input: I, context: CapabilityContext): Promise<O> => {
		const actor = actorFrom(context);
		try {
			return await fn(service(context), actor, input);
		} catch (error) {
			mapError(error);
		}
	};
}

const id = () => s.string();
const out = (...keys: string[]) => s.object(Object.fromEntries(keys.map((k) => [k, s.unknown()])));
const contract = (idempotency: string, notes?: string) => ({ idempotency, ...(notes ? { notes } : {}) });

const criterion = s.object({
	id: s.string(),
	name: s.string(),
	requirement: s.string(),
	evaluationMode: s.enum(["semantic", "deterministic", "human_review"]),
	importance: s.number(),
	requiredEvidence: s.array(s.string(), { maxItems: 20 }),
	threshold: s.optional(s.number()),
	hardGate: s.boolean(),
	missingEvidencePolicy: s.enum(["unknown", "review_required"]),
	disqualifier: s.optional(s.string()),
	metric: s.optional(s.enum(METRIC_KEYS)),
	comparator: s.optional(s.enum(["gte", "gt", "lte", "lt", "eq"])),
	evidenceStandard: s.optional(s.enum(["founder_reported_ok", "independent_required"])),
});
const settings = s.object({ showWeightedSummary: s.boolean(), reviewConfidenceThreshold: s.number() });
const asCriteria = (c: unknown) => c as InvestmentCriterion[];
const asSettings = (v: unknown) => v as ThesisSettings | undefined;

// ---------------------------------------------------------------------------
// session / workspace
// ---------------------------------------------------------------------------

export const sessionWhoami = defineCapability({
	name: "session.whoami",
	version: 1,
	description: "The authenticated principal, its workspace and permissions, and the configured Jev identity (never credentials).",
	authorization: ["invest.read"],
	input: s.object({}),
	output: out("principal", "jev"),
	attributes: contract("read-only"),
	handler: (_input, context) => {
		const actor = actorFrom(context);
		return {
			principal: { ...actor, workspaceName: context.session?.attributes?.workspaceName ?? actor.workspaceId, role: context.session?.attributes?.role ?? null },
			jev: service(context).jevIdentity,
		};
	},
});

export const workspaceOverview = defineCapability({
	name: "workspace.overview",
	version: 1,
	description: "Active evaluations, outstanding reviews, recently completed assessments and startups awaiting evidence.",
	authorization: ["invest.read"],
	input: s.object({}),
	output: out("overview"),
	attributes: contract("read-only"),
	handler: run(async (svc, actor) => ({ overview: await svc.overview(actor) })),
});

// ---------------------------------------------------------------------------
// investment-thesis
// ---------------------------------------------------------------------------

export const thesisList = defineCapability({
	name: "thesis.list",
	version: 1,
	description: "Theses in the caller's workspace.",
	authorization: ["invest.read"],
	input: s.object({}),
	output: out("items"),
	attributes: contract("read-only"),
	handler: run(async (svc, actor) => ({ items: await svc.theses.list(actor) })),
});

export const thesisGet = defineCapability({
	name: "thesis.get",
	version: 1,
	description: "A thesis with its draft and every approved version.",
	authorization: ["invest.read"],
	input: s.object({ thesisId: id() }),
	output: out("thesis", "versions"),
	attributes: contract("read-only"),
	handler: run(async (svc, actor, input: { thesisId: string }) => ({ thesis: await svc.theses.get(actor, input.thesisId), versions: await svc.theses.listVersions(actor, input.thesisId) })),
});

export const thesisCreate = defineCapability({
	name: "thesis.create",
	version: 1,
	description: "Creates a thesis with a draft. Nothing is evaluable until a version is approved.",
	authorization: ["thesis.write"],
	input: s.object({ name: s.string(), description: s.optional(s.string()), criteria: s.array(criterion, { maxItems: 50 }), settings: s.optional(settings) }),
	output: out("thesis"),
	attributes: contract("not idempotent: each call creates a thesis"),
	handler: run(async (svc, actor, input: { name: string; description?: string; criteria: unknown; settings?: unknown }) => ({
		thesis: await svc.theses.createDraft(actor, { name: input.name, description: input.description, criteria: asCriteria(input.criteria), settings: asSettings(input.settings) }),
	})),
});

export const thesisDraftUpdate = defineCapability({
	name: "thesis.draft.update",
	version: 1,
	description: "Replaces the draft. Fenced on expectedVersion; a stale editor gets CONFLICT instead of overwriting.",
	authorization: ["thesis.write"],
	concurrency: { mode: "keyed", key: "thesisId" },
	input: s.object({
		thesisId: id(),
		expectedVersion: s.integer(),
		name: s.optional(s.string()),
		description: s.optional(s.string()),
		criteria: s.array(criterion, { maxItems: 50 }),
		settings: s.optional(settings),
	}),
	output: out("thesis"),
	attributes: contract("version-fenced: replaying with the same expectedVersion after success yields CONFLICT"),
	handler: run(async (svc, actor, input: { thesisId: string; expectedVersion: number; name?: string; description?: string; criteria: unknown; settings?: unknown }) => ({
		thesis: await svc.theses.updateDraft(actor, { ...input, criteria: asCriteria(input.criteria), settings: asSettings(input.settings) }),
	})),
});

export const thesisDraftDiscard = defineCapability({
	name: "thesis.draft.discard",
	version: 1,
	description: "Discards the draft of a thesis that already has an approved version.",
	authorization: ["thesis.write"],
	concurrency: { mode: "keyed", key: "thesisId" },
	input: s.object({ thesisId: id(), expectedVersion: s.integer() }),
	output: out("thesis"),
	attributes: contract("idempotent: discarding an absent draft is a no-op"),
	handler: run(async (svc, actor, input: { thesisId: string; expectedVersion: number }) => ({ thesis: await svc.theses.discardDraft(actor, input) })),
});

export const thesisValidate = defineCapability({
	name: "thesis.validate",
	version: 1,
	description: "Validates criteria and settings without storing anything.",
	authorization: ["invest.read"],
	input: s.object({ criteria: s.array(s.unknown(), { maxItems: 50 }), settings: s.unknown() }),
	output: out("valid", "errors", "warnings"),
	attributes: contract("pure"),
	handler: run(async (_svc, _actor, input: { criteria: unknown; settings: unknown }) => validateThesisContent(input.criteria, input.settings)),
});

export const thesisApprove = defineCapability({
	name: "thesis.approve",
	version: 1,
	description: "Freezes the draft as the next immutable version. Previous versions are never modified.",
	authorization: ["thesis.approve"],
	concurrency: { mode: "keyed", key: "thesisId" },
	input: s.object({ thesisId: id(), expectedVersion: s.integer(), note: s.optional(s.string()) }),
	output: out("thesis", "version"),
	attributes: contract("version-fenced and requireAbsent on the new version: two concurrent approvals cannot both succeed"),
	handler: run(async (svc, actor, input: { thesisId: string; expectedVersion: number; note?: string }) => svc.theses.approve(actor, input)),
});

export const thesisVersionGet = defineCapability({
	name: "thesis.version.get",
	version: 1,
	description: "One immutable thesis version.",
	authorization: ["invest.read"],
	input: s.object({ versionId: id() }),
	output: out("version"),
	attributes: contract("read-only"),
	handler: run(async (svc, actor, input: { versionId: string }) => ({ version: await svc.theses.getVersion(actor, input.versionId) })),
});

export const thesisVersionCompare = defineCapability({
	name: "thesis.version.compare",
	version: 1,
	description: "Criterion-level differences between two versions, or between a version and the current draft.",
	authorization: ["invest.read"],
	input: s.object({ fromVersionId: id(), toVersionId: s.optional(id()) }),
	output: out("from", "to", "changes"),
	attributes: contract("read-only"),
	handler: run(async (svc, actor, input: { fromVersionId: string; toVersionId?: string }) => svc.theses.compare(actor, input)),
});

// ---------------------------------------------------------------------------
// startup-registry
// ---------------------------------------------------------------------------

const startupFields = {
	name: s.string(),
	website: s.optional(s.string()),
	stage: s.optional(s.string()),
	sector: s.optional(s.string()),
	description: s.optional(s.string()),
	founderClaims: s.optional(s.array(s.string(), { maxItems: 50 })),
};

export const startupList = defineCapability({
	name: "startup.list",
	version: 1,
	description: "Startups in the caller's workspace.",
	authorization: ["invest.read"],
	input: s.object({}),
	output: out("items"),
	attributes: contract("read-only"),
	handler: run(async (svc, actor) => ({ items: await svc.startups.list(actor) })),
});

export const startupGet = defineCapability({
	name: "startup.get",
	version: 1,
	description: "Startup and evidence workspace: profile, documents, evidence with provenance, contradictions, evaluations, decisions, and gaps against an optional thesis version.",
	authorization: ["invest.read"],
	input: s.object({ startupId: id(), thesisVersionId: s.optional(id()) }),
	output: out("workspace"),
	attributes: contract("read-only"),
	handler: run(async (svc, actor, input: { startupId: string; thesisVersionId?: string }) => ({ workspace: await svc.startupWorkspace(actor, input) })),
});

export const startupCreate = defineCapability({
	name: "startup.create",
	version: 1,
	description: "Creates a startup profile. Founder claims are recorded as founder-reported evidence.",
	authorization: ["startup.write"],
	input: s.object(startupFields),
	output: out("startup"),
	attributes: contract("not idempotent: each call creates a startup"),
	handler: run(async (svc, actor, input: { name: string }) => ({ startup: await svc.startups.create(actor, input) })),
});

export const startupUpdate = defineCapability({
	name: "startup.update",
	version: 1,
	description: "Updates a startup profile, fenced on expectedVersion.",
	authorization: ["startup.write"],
	concurrency: { mode: "keyed", key: "startupId" },
	input: s.object({ startupId: id(), expectedVersion: s.integer(), ...startupFields }),
	output: out("startup"),
	attributes: contract("version-fenced"),
	handler: run(async (svc, actor, input: { startupId: string; expectedVersion: number; name: string }) => ({ startup: await svc.startups.update(actor, input) })),
});

// ---------------------------------------------------------------------------
// document-ingestion
// ---------------------------------------------------------------------------

export function createDocumentUpload(maxBytes: number) {
	return defineCapability({
		name: "document.upload",
		version: 1,
		description:
			"Uploads a document (base64). Type, extension and PDF signature are checked before parsing; rejected and failed files are recorded with their reasons and no evidence.",
		authorization: ["document.write"],
		concurrency: { mode: "keyed", key: "startupId" },
		timeoutMs: 120_000,
		input: s.object({
			startupId: id(),
			filename: s.string(),
			mediaType: s.string(),
			sourceType: s.enum(SOURCE_TYPES),
			contentBase64: s.string(),
			supersedesDocumentId: s.optional(id()),
		}),
		output: out("document"),
		attributes: contract("content-addressed: the same bytes for the same startup return the existing document", `max ${maxBytes} bytes`),
		handler: run(async (svc, actor, input: { startupId: string; filename: string; mediaType: string; sourceType: (typeof SOURCE_TYPES)[number]; contentBase64: string; supersedesDocumentId?: string }) => {
			if (Math.floor((input.contentBase64.length * 3) / 4) > maxBytes + 3) throw new InvestError("too_large", `The file exceeds the ${maxBytes}-byte limit`);
			if (!/^[A-Za-z0-9+/]*={0,2}$/.test(input.contentBase64)) throw new InvestError("invalid", "contentBase64 is not valid base64");
			const bytes = new Uint8Array(Buffer.from(input.contentBase64, "base64"));
			return { document: await svc.documents.upload(actor, { ...input, bytes }) };
		}),
	});
}

export const documentGet = defineCapability({
	name: "document.get",
	version: 1,
	description: "Ingestion status, issues, hashes and parser identity for one document.",
	authorization: ["invest.read"],
	input: s.object({ documentId: id() }),
	output: out("document"),
	attributes: contract("read-only"),
	handler: run(async (svc, actor, input: { documentId: string }) => ({ document: await svc.documents.get(actor, input.documentId) })),
});

export const documentPage = defineCapability({
	name: "document.page",
	version: 1,
	description: "The extracted lines and coordinates of one page, for the source viewer.",
	authorization: ["invest.read"],
	input: s.object({ documentId: id(), page: s.integer() }),
	output: out("page"),
	attributes: contract("read-only"),
	handler: run(async (svc, actor, input: { documentId: string; page: number }) => ({ page: await svc.documents.page(actor, input.documentId, input.page) })),
});

export const documentLink = defineCapability({
	name: "document.link",
	version: 1,
	description: "A short-lived signed link to the original file (five minutes).",
	authorization: ["invest.read"],
	input: s.object({ documentId: id() }),
	output: out("url", "expiresAt"),
	attributes: contract("each call issues a fresh link"),
	handler: run(async (svc, actor, input: { documentId: string }) => svc.documents.accessLink(actor, input.documentId)),
});

export const documentPurge = defineCapability({
	name: "document.purge",
	version: 1,
	description: "Retention control: deletes the original file and extracted page text; evidence claims and hashes remain for audit.",
	authorization: ["document.write"],
	concurrency: { mode: "keyed", key: "documentId" },
	input: s.object({ documentId: id(), reason: s.string() }),
	output: out("document"),
	attributes: contract("idempotent: purging a purged document is a no-op"),
	handler: run(async (svc, actor, input: { documentId: string; reason: string }) => ({ document: await svc.documents.purge(actor, input) })),
});

// ---------------------------------------------------------------------------
// evidence-registry
// ---------------------------------------------------------------------------

export const evidenceList = defineCapability({
	name: "evidence.list",
	version: 1,
	description: "Claims for a startup with provenance, derived verification and contradictions.",
	authorization: ["invest.read"],
	input: s.object({ startupId: id() }),
	output: out("items", "contradictions"),
	attributes: contract("read-only"),
	handler: run(async (svc, actor, input: { startupId: string }) => {
		const { items, contradictions } = await svc.evidence.views(actor, input.startupId);
		return { items, contradictions };
	}),
});

export const evidenceGet = defineCapability({
	name: "evidence.get",
	version: 1,
	description: "One claim's provenance: source document, hash, page and coordinates, and cross-source verification.",
	authorization: ["invest.read"],
	input: s.object({ evidenceId: id() }),
	output: out("item", "document"),
	attributes: contract("read-only"),
	handler: run(async (svc, actor, input: { evidenceId: string }) => svc.evidence.get(actor, input.evidenceId)),
});

export const evidenceAttach = defineCapability({
	name: "evidence.attach",
	version: 1,
	description: "Attaches evidence a reviewer verified directly, with how it was verified.",
	authorization: ["evidence.write"],
	input: s.object({ startupId: id(), claim: s.string(), reference: s.string(), metric: s.optional(s.object({ key: s.enum(METRIC_KEYS), value: s.number() })) }),
	output: out("item"),
	attributes: contract("not idempotent: each call records a reviewer attestation"),
	handler: run(async (svc, actor, input: { startupId: string; claim: string; reference: string; metric?: { key: (typeof METRIC_KEYS)[number]; value: number } }) => ({
		item: await svc.evidence.attachReviewerEvidence(actor, input),
	})),
});

// ---------------------------------------------------------------------------
// investment-evaluation
// ---------------------------------------------------------------------------

export const evaluationStart = defineCapability({
	name: "evaluation.start",
	version: 1,
	description: "Evaluates a startup against an explicitly selected thesis version. Runs asynchronously; poll evaluation.get.",
	authorization: ["evaluation.run"],
	idempotency: "supported",
	input: s.object({ startupId: id(), thesisVersionId: id(), requestKey: s.string() }),
	output: out("evaluation"),
	attributes: contract("durable: requestKey derives the evaluation id under a FeltDB requireAbsent fence; a retry returns the same evaluation"),
	handler: run(async (svc, actor, input: { startupId: string; thesisVersionId: string; requestKey: string }) => ({ evaluation: strip(await svc.evaluations.start(actor, input)) })),
});

export const evaluationRerun = defineCapability({
	name: "evaluation.rerun",
	version: 1,
	description: "Creates a new evaluation linked to its predecessor. The predecessor is never modified.",
	authorization: ["evaluation.run"],
	idempotency: "supported",
	input: s.object({ evaluationId: id(), requestKey: s.string(), thesisVersionId: s.optional(id()) }),
	output: out("evaluation"),
	attributes: contract("durable on requestKey, as evaluation.start"),
	handler: run(async (svc, actor, input: { evaluationId: string; requestKey: string; thesisVersionId?: string }) => ({ evaluation: strip(await svc.evaluations.rerun(actor, input)) })),
});

export const evaluationList = defineCapability({
	name: "evaluation.list",
	version: 1,
	description: "Evaluations with status, summary and current decision.",
	authorization: ["invest.read"],
	input: s.object({ startupId: s.optional(id()) }),
	output: out("items"),
	attributes: contract("read-only"),
	handler: run(async (svc, actor, input: { startupId?: string }) => ({ items: await svc.listEvaluations(actor, input) })),
});

export const evaluationGet = defineCapability({
	name: "evaluation.get",
	version: 1,
	description: "Evaluation report: manifest, findings with reviewer actions applied, open diligence requests, decision history and decision blockers.",
	authorization: ["invest.read"],
	input: s.object({ evaluationId: id() }),
	output: out("report"),
	attributes: contract("read-only"),
	handler: run(async (svc, actor, input: { evaluationId: string }) => ({ report: await svc.decisions.report(actor, input.evaluationId) })),
});

export const evaluationVerify = defineCapability({
	name: "evaluation.verify",
	version: 1,
	description: "Independently recomputes the manifest digest, projections, question digests and every policy outcome of a stored evaluation.",
	authorization: ["invest.read"],
	input: s.object({ evaluationId: id() }),
	output: out("ok", "checks"),
	attributes: contract("read-only"),
	handler: run(async (svc, actor, input: { evaluationId: string }) => svc.evaluations.verify(actor, input.evaluationId)),
});

// ---------------------------------------------------------------------------
// investment-review
// ---------------------------------------------------------------------------

export const reviewRecord = defineCapability({
	name: "review.record",
	version: 1,
	description: "Accept a finding, override its outcome (outcome and reason required), or comment. Findings are never edited.",
	authorization: ["review.write"],
	concurrency: { mode: "keyed", key: "evaluationId" },
	input: s.object({
		evaluationId: id(),
		findingId: s.nullable(id()),
		action: s.enum(["accept", "override", "comment"]),
		outcome: s.optional(s.enum(OUTCOMES)),
		reason: s.optional(s.string()),
	}),
	output: out("action"),
	attributes: contract("append-only: each call records a new review action"),
	handler: run(async (svc, actor, input: { evaluationId: string; findingId: string | null; action: "accept" | "override" | "comment"; outcome?: (typeof OUTCOMES)[number]; reason?: string }) => ({
		action: await svc.decisions.recordReview(actor, input),
	})),
});

export const reviewRequest = defineCapability({
	name: "review.request",
	version: 1,
	description: "Opens a diligence request (follow-up), optionally tied to a finding and assigned to someone.",
	authorization: ["review.write"],
	input: s.object({ evaluationId: id(), findingId: s.optional(s.nullable(id())), question: s.string(), assignee: s.optional(s.string()) }),
	output: out("action"),
	attributes: contract("append-only"),
	handler: run(async (svc, actor, input: { evaluationId: string; findingId?: string | null; question: string; assignee?: string }) => ({ action: await svc.decisions.requestEvidence(actor, input) })),
});

export const reviewResolve = defineCapability({
	name: "review.resolve",
	version: 1,
	description: "Resolves a diligence request. A request can be resolved exactly once.",
	authorization: ["review.write"],
	input: s.object({ evaluationId: id(), requestId: id(), resolution: s.string() }),
	output: out("action"),
	attributes: contract("requireAbsent on a request-derived id: a second resolution is CONFLICT"),
	handler: run(async (svc, actor, input: { evaluationId: string; requestId: string; resolution: string }) => ({ action: await svc.decisions.resolveRequest(actor, input) })),
});

export const decisionRecord = defineCapability({
	name: "decision.record",
	version: 1,
	description: "Records an investment decision. Invest requires every review gate resolved and no failed or unresolved hard gate.",
	authorization: ["decision.record"],
	concurrency: { mode: "keyed", key: "evaluationId" },
	input: s.object({ evaluationId: id(), decision: s.enum(["invest", "decline", "hold", "request_more_diligence"]), rationale: s.string(), expectedSequence: s.integer() }),
	output: out("decision"),
	attributes: contract("sequence-fenced: requireAbsent on the decision sequence; a concurrent second decision is CONFLICT"),
	handler: run(async (svc, actor, input: { evaluationId: string; decision: "invest" | "decline" | "hold" | "request_more_diligence"; rationale: string; expectedSequence: number }) => ({
		decision: await svc.decisions.recordDecision(actor, input),
	})),
});

// ---------------------------------------------------------------------------
// audit
// ---------------------------------------------------------------------------

export const auditList = defineCapability({
	name: "audit.list",
	version: 1,
	description: "Append-only audit history for the caller's workspace, newest first.",
	authorization: ["audit.read"],
	input: s.object({ entityId: s.optional(s.string()), eventType: s.optional(s.string()), limit: s.optional(s.integer()) }),
	output: out("items"),
	attributes: contract("read-only"),
	handler: run(async (svc, actor, input: { entityId?: string; eventType?: string; limit?: number }) => ({ items: await svc.audit.list(actor, input) })),
});


// ---------------------------------------------------------------------------
// investor research (public-source findings; never investor-approved theses)
// ---------------------------------------------------------------------------

export const firmList = defineCapability({
	name: "firm.list",
	version: 1,
	description: "Investor firm profiles in the caller's workspace, with research status, last research time and criteria counts. Optional search and status filter.",
	authorization: ["invest.read"],
	input: s.object({ query: s.optional(s.string()), status: s.optional(s.enum(RESEARCH_STATUSES)) }),
	output: out("items"),
	attributes: contract("read-only"),
	handler: run(async (svc, actor, input: { query?: string; status?: ResearchStatus }) => ({ items: await svc.research.list(actor, input) })),
});

export const firmGet = defineCapability({
	name: "firm.get",
	version: 1,
	description: "One firm profile: criteria with assertion type, source passage, verification and freshness; conflicts; approved criteria; sources checked; run history; reviews.",
	authorization: ["invest.read"],
	input: s.object({ firmId: id() }),
	output: out("profile"),
	attributes: contract("read-only"),
	handler: run(async (svc, actor, input: { firmId: string }) => ({ profile: await svc.research.profile(actor, input.firmId) })),
});

export const firmRefresh = defineCapability({
	name: "firm.refresh",
	version: 1,
	description: "Re-researches one existing firm in this server process within the configured crawl bounds. Accepts only a firm id, never a URL. Returns at once; poll firm.get.",
	authorization: ["research.run"],
	concurrency: { mode: "keyed", key: "firmId" },
	input: s.object({ firmId: id() }),
	output: out("firm", "run"),
	attributes: contract("append-only: each call records a new research run; a run already in progress for the firm is CONFLICT"),
	handler: run(async (svc, actor, input: { firmId: string }) => svc.research.startRefresh(actor, input.firmId)),
});

export const firmVerify = defineCapability({
	name: "firm.verify",
	version: 1,
	description: "Asks Jev whether each current criterion's captured passage supports its statement. Reports skipped when Jev is not configured; never simulates a result.",
	authorization: ["research.run"],
	input: s.object({ firmId: id() }),
	output: out("summary"),
	attributes: contract("append-only: each attempt is a new verification record; conclusive results for an unchanged passage are not re-asked"),
	handler: run(async (svc, actor, input: { firmId: string }) => ({ summary: await svc.research.verifyFirm(actor, input.firmId) })),
});

export const firmReview = defineCapability({
	name: "firm.review",
	version: 1,
	description: "Flag, dispute, correct, annotate, confirm or dismiss a research criterion, an investment event or a finding. Recorded as a separate review; the research record is not changed and nothing is approved by it.",
	authorization: ["review.write"],
	input: s.object({ firmId: id(), criterionId: s.optional(s.nullable(id())), eventId: s.optional(s.nullable(id())), findingId: s.optional(s.nullable(id())), claimId: s.optional(s.nullable(id())), action: s.enum(["flag", "dispute", "correct", "note", "confirm", "dismiss"]), note: s.string(), correctedValue: s.optional(s.string()) }),
	output: out("review"),
	attributes: contract("append-only"),
	handler: run(async (svc, actor, input: { firmId: string; criterionId?: string | null; eventId?: string | null; findingId?: string | null; claimId?: string | null; action: ReviewAction; note: string; correctedValue?: string }) => ({ review: await svc.research.review(actor, input) })),
});

export const firmMonitoringSet = defineCapability({
	name: "firm.monitoring.set",
	version: 1,
	description: "Pause or resume continuous monitoring of a firm, or change its interval or crawl bounds. Pausing keeps the profile and all history.",
	authorization: ["research.run"],
	concurrency: { mode: "keyed", key: "firmId" },
	input: s.object({ firmId: id(), enabled: s.optional(s.boolean()), intervalMinutes: s.optional(s.integer()), maxPages: s.optional(s.integer()), maxDepth: s.optional(s.integer()) }),
	output: out("target"),
	attributes: contract("idempotent: setting the state it already has changes nothing and records nothing"),
	handler: run(async (svc, actor, input: { firmId: string; enabled?: boolean; intervalMinutes?: number; maxPages?: number; maxDepth?: number }) => ({
		target: await svc.monitoring.configure(actor, input.firmId, { enabled: input.enabled, intervalMinutes: input.intervalMinutes, ...(input.maxPages !== undefined || input.maxDepth !== undefined ? { limits: { maxPages: input.maxPages ?? null, maxDepth: input.maxDepth ?? null } } : {}) }),
	})),
});

export const firmTimeline = defineCapability({
	name: "firm.timeline",
	version: 1,
	description: "The firm's intelligence timeline: investment events, source discoveries and changes, proposed thesis changes, conflicts, failed research and reviews. Filter by type, time range and review state.",
	authorization: ["invest.read"],
	input: s.object({ firmId: id(), types: s.optional(s.array(s.string(), { maxItems: 12 })), from: s.optional(s.string()), to: s.optional(s.string()), reviewStates: s.optional(s.array(s.string(), { maxItems: 8 })), limit: s.optional(s.integer()) }),
	output: out("items"),
	attributes: contract("read-only"),
	handler: run(async (svc, actor, input: { firmId: string; types?: string[]; from?: string; to?: string; reviewStates?: string[]; limit?: number }) => ({ items: await svc.research.timeline(actor, input.firmId, input as never) })),
});

export const attentionList = defineCapability({
	name: "attention.list",
	version: 1,
	description: "What needs a person across the workspace: new investment activity, proposed strategy changes, findings awaiting review, and research that is failing or stale. Each item appears once.",
	authorization: ["invest.read"],
	input: s.object({}),
	output: out("items"),
	attributes: contract("read-only"),
	handler: run(async (svc, actor) => ({ items: await attentionFor(svc.research, actor) })),
});

export const firmApprove = defineCapability({
	name: "firm.approve",
	version: 1,
	description: "Records an investor-verified criterion for a firm, from a research criterion or entered by hand. The only way research becomes investor-verified; requires thesis.approve.",
	authorization: ["thesis.approve"],
	input: s.object({
		firmId: id(),
		criterionId: s.optional(id()),
		field: s.optional(s.enum(CRITERION_FIELDS)),
		polarity: s.optional(s.enum(["include", "exclude"])),
		value: s.optional(s.string()),
		minUsd: s.optional(s.number()),
		maxUsd: s.optional(s.number()),
		note: s.string(),
	}),
	output: out("approval"),
	attributes: contract("append-only: an existing active approval of the same value is CONFLICT"),
	handler: run(async (svc, actor, input: { firmId: string; criterionId?: string; field?: CriterionField; polarity?: "include" | "exclude"; value?: string; minUsd?: number; maxUsd?: number; note: string }) => ({ approval: await svc.research.approve(actor, input) })),
});

export const firmApprovalWithdraw = defineCapability({
	name: "firm.approval.withdraw",
	version: 1,
	description: "Withdraws an investor-verified criterion by appending a withdrawal; the approval stays in the history.",
	authorization: ["thesis.approve"],
	input: s.object({ firmId: id(), approvalId: id(), note: s.string() }),
	output: out("approval"),
	attributes: contract("append-only"),
	handler: run(async (svc, actor, input: { firmId: string; approvalId: string; note: string }) => ({ approval: await svc.research.withdraw(actor, input) })),
});


// ---------------------------------------------------------------------------
// VC-4: curated sources, matches, reconciliation
// ---------------------------------------------------------------------------

const mappingSchema = s.object({
	recordsPath: s.optional(s.string()),
	idField: s.optional(s.string()),
	nameField: s.string(),
	websiteField: s.optional(s.string()),
	stageField: s.optional(s.string()),
	sectorsField: s.optional(s.string()),
	geographyField: s.optional(s.string()),
	checkMinField: s.optional(s.string()),
	checkMaxField: s.optional(s.string()),
	updatedField: s.optional(s.string()),
	listDelimiter: s.optional(s.string()),
	checkUnit: s.optional(s.enum(["usd", "thousands", "millions"])),
	recordKind: s.optional(s.enum(["investor", "portfolio_company"])),
	investorField: s.optional(s.string()),
});
const audienceSchema = s.object({ kind: s.enum(["firm", "moderator"]), domain: s.optional(s.string()) });
const asAudience = (a: { kind: "firm" | "moderator"; domain?: string }): ShareAudience => (a.kind === "firm" ? { kind: "firm", domain: a.domain ?? "" } : { kind: "moderator" });

export const sourceRegister = defineCapability({
	name: "source.register",
	version: 1,
	description: "Registers a curated third-party source (directory, dataset, funding-news feed) for monitoring. The registrant attests why automated access is permitted and where the terms say so; fetching uses the safe-fetch boundary.",
	authorization: ["source.manage"],
	input: s.object({
		name: s.string(),
		canonicalUrl: s.string(),
		publisher: s.string(),
		sourceType: s.enum(["directory", "curated_list", "funding_news", "portfolio_aggregator", "dataset"]),
		adapter: s.enum(ADAPTER_IDS),
		accessBasis: s.enum(ACCESS_BASES),
		termsNote: s.string(),
		limitations: s.optional(s.string()),
		extraHosts: s.optional(s.array(s.string(), { maxItems: 3 })),
		mapping: s.optional(mappingSchema),
		intervalMinutes: s.optional(s.integer()),
	}),
	output: out("source", "created"),
	attributes: contract("idempotent: the same URL in the same workspace returns the existing source"),
	handler: run(async (svc, actor, input: { name: string; canonicalUrl: string; publisher: string; sourceType: "directory" | "curated_list" | "funding_news" | "portfolio_aggregator" | "dataset"; adapter: (typeof ADAPTER_IDS)[number]; accessBasis: (typeof ACCESS_BASES)[number]; termsNote: string; limitations?: string; extraHosts?: string[]; mapping?: DatasetMapping; intervalMinutes?: number }) => svc.sources.register(actor, input)),
});

export const sourceUpdate = defineCapability({
	name: "source.update",
	version: 1,
	description: "Updates a source's name, terms note, limitations or mapping. A changed mapping reprocesses the next retrieval.",
	authorization: ["source.manage"],
	input: s.object({ sourceId: id(), name: s.optional(s.string()), termsNote: s.optional(s.string()), limitations: s.optional(s.string()), mapping: s.optional(mappingSchema) }),
	output: out("source"),
	attributes: contract("version-fenced; unchanged input changes nothing"),
	handler: run(async (svc, actor, input: { sourceId: string; name?: string; termsNote?: string; limitations?: string; mapping?: DatasetMapping }) => ({ source: await svc.sources.update(actor, input.sourceId, input) })),
});

export const sourceList = defineCapability({
	name: "source.list",
	version: 1,
	description: "Curated sources with monitoring status, last attempt, last success and next check.",
	authorization: ["invest.read"],
	input: s.object({}),
	output: out("items"),
	attributes: contract("read-only"),
	handler: run(async (svc, actor) => ({ items: await svc.sources.list(actor) })),
});

export const sourceGet = defineCapability({
	name: "source.get",
	version: 1,
	description: "One source: terms and limitations, run history with per-record errors, snapshots, record counts and match tallies.",
	authorization: ["invest.read"],
	input: s.object({ sourceId: id() }),
	output: out("detail"),
	attributes: contract("read-only"),
	handler: run(async (svc, actor, input: { sourceId: string }) => ({ detail: await svc.sources.get(actor, input.sourceId) })),
});

export const sourceRecords = defineCapability({
	name: "source.records",
	version: 1,
	description: "Normalised records a source produced, with their original identifiers, passages and parse notes.",
	authorization: ["invest.read"],
	input: s.object({ sourceId: id(), limit: s.optional(s.integer()) }),
	output: out("items"),
	attributes: contract("read-only"),
	handler: run(async (svc, actor, input: { sourceId: string; limit?: number }) => ({ items: await svc.sources.records(actor, input.sourceId, input.limit) })),
});

export const sourceRefresh = defineCapability({
	name: "source.refresh",
	version: 1,
	description: "Retrieves one registered source now, in this process. Accepts a source id only, never a URL.",
	authorization: ["source.manage"],
	concurrency: { mode: "keyed", key: "sourceId" },
	input: s.object({ sourceId: id() }),
	output: out("run"),
	attributes: contract("append-only: each call records a run; a run in progress is CONFLICT"),
	handler: run(async (svc, actor, input: { sourceId: string }) => ({ run: await svc.sources.startRefresh(actor, input.sourceId) })),
});

export const sourceMonitoringSet = defineCapability({
	name: "source.monitoring.set",
	version: 1,
	description: "Pauses or resumes monitoring of a source, or changes its interval. Pausing keeps its records, claims and history.",
	authorization: ["source.manage"],
	input: s.object({ sourceId: id(), enabled: s.optional(s.boolean()), intervalMinutes: s.optional(s.integer()) }),
	output: out("target"),
	attributes: contract("idempotent"),
	handler: run(async (svc, actor, input: { sourceId: string; enabled?: boolean; intervalMinutes?: number }) => {
		await svc.sources.get(actor, input.sourceId);
		return { target: await svc.monitoring.configure(actor, input.sourceId, input) };
	}),
});

export const matchDecide = defineCapability({
	name: "match.decide",
	version: 1,
	description: "Confirms or rejects a candidate match between a source record and an existing entity, with a rationale. Rejections are remembered; nothing is merged or deleted.",
	authorization: ["review.write"],
	input: s.object({ matchId: id(), decision: s.enum(["confirm", "reject"]), entityType: s.enum(["firm", "entity"]), entityId: id(), rationale: s.string() }),
	output: out("decision"),
	attributes: contract("append-only"),
	handler: run(async (svc, actor, input: { matchId: string; decision: "confirm" | "reject"; entityType: "firm" | "entity"; entityId: string; rationale: string }) => ({ decision: await svc.sources.decideMatch(actor, { matchId: input.matchId, decision: input.decision, entity: { type: input.entityType, id: input.entityId }, rationale: input.rationale }) })),
});

export const matchList = defineCapability({
	name: "match.list",
	version: 1,
	description: "Candidate matches awaiting a decision, and the history of decisions.",
	authorization: ["invest.read"],
	input: s.object({}),
	output: out("open", "history"),
	attributes: contract("read-only"),
	handler: run(async (svc, actor) => ({ open: await svc.sources.openMatches(actor), history: await svc.sources.matchHistory(actor) })),
});

export const firmReconciliation = defineCapability({
	name: "firm.reconciliation",
	version: 1,
	description: "Per-field reconciliation of the firm's own statements, third-party claims, the viewer's contributions and the firm's published profile: signals, reasons and conflicts, never a score.",
	authorization: ["invest.read"],
	input: s.object({ firmId: id() }),
	output: out("reconciliation"),
	attributes: contract("read-only"),
	handler: run(async (svc, actor, input: { firmId: string }) => ({ reconciliation: await svc.reconciliation.forFirm(actor, input.firmId) })),
});

export const inboxList = defineCapability({
	name: "inbox.list",
	version: 1,
	description: "What needs the caller's decision: candidate matches, unresolved conflicts, proposed claims, shared contributions, representative claims (moderators) and disputed contributions (authors).",
	authorization: ["invest.read"],
	input: s.object({}),
	output: out("items"),
	attributes: contract("read-only"),
	handler: run(async (svc, actor) => ({ items: await svc.reconciliation.inbox(actor) })),
});

// ---------------------------------------------------------------------------
// VC-4: participation
// ---------------------------------------------------------------------------

export const profileClaimRequest = defineCapability({
	name: "profile.claim.request",
	version: 1,
	description: "Requests to represent a firm. Returns a challenge to publish at /.well-known/attn-invest-claim.txt. Signing up is not authority: a moderator must verify the claim.",
	authorization: ["profile.claim"],
	input: s.object({ domain: s.string(), firmName: s.string(), relationship: s.string() }),
	output: out("claim", "status"),
	attributes: contract("idempotent per principal and domain"),
	handler: run(async (svc, actor, input: { domain: string; firmName: string; relationship: string }) => svc.participation.requestClaim(actor, input)),
});

export const profileClaimCheck = defineCapability({
	name: "profile.claim.check",
	version: 1,
	description: "Checks the domain-control proof for the caller's own claim through the safe-fetch boundary. The result is evidence for the moderator, not authority.",
	authorization: ["profile.claim"],
	input: s.object({ claimId: id() }),
	output: out("event"),
	attributes: contract("append-only"),
	handler: run(async (svc, actor, input: { claimId: string }) => ({ event: await svc.participation.checkProof(actor, input.claimId) })),
});

export const profileClaimMine = defineCapability({
	name: "profile.claim.mine",
	version: 1,
	description: "The caller's representative claims with their status and history.",
	authorization: ["profile.claim"],
	input: s.object({}),
	output: out("items"),
	attributes: contract("read-only"),
	handler: run(async (svc, actor) => ({ items: await svc.participation.myClaims(actor) })),
});

export const claimPending = defineCapability({
	name: "claim.pending",
	version: 1,
	description: "Representative claims awaiting a moderator decision, across workspaces. Challenges are not included.",
	authorization: ["moderation.review"],
	input: s.object({}),
	output: out("items"),
	attributes: contract("read-only"),
	handler: run(async (svc, actor) => ({ items: await svc.participation.pendingClaims(actor) })),
});

export const claimReview = defineCapability({
	name: "claim.review",
	version: 1,
	description: "A moderator verifies, rejects or revokes a representative claim, with a rationale and the evidence considered. Verification needs a successful domain proof or documented evidence.",
	authorization: ["moderation.review"],
	input: s.object({ claimId: id(), decision: s.enum(["verify", "reject", "revoke"]), rationale: s.string(), evidence: s.optional(s.array(s.string(), { maxItems: 10 })) }),
	output: out("event"),
	attributes: contract("append-only"),
	handler: run(async (svc, actor, input: { claimId: string; decision: "verify" | "reject" | "revoke"; rationale: string; evidence?: string[] }) => ({ event: await svc.participation.reviewClaim(actor, input) })),
});

export const profileApprove = defineCapability({
	name: "profile.approve",
	version: 1,
	description: "A verified representative approves one of the firm's criteria as the firm itself, from a research criterion, a third-party claim, or entered by hand. Works only with a verified claim for the firm's domain.",
	authorization: ["profile.publish"],
	input: s.object({ firmId: id(), criterionId: s.optional(id()), claimId: s.optional(id()), field: s.optional(s.enum(CRITERION_FIELDS)), polarity: s.optional(s.enum(["include", "exclude"])), value: s.optional(s.string()), minUsd: s.optional(s.number()), maxUsd: s.optional(s.number()), note: s.string() }),
	output: out("approval"),
	attributes: contract("append-only; an existing active approval of the same value is CONFLICT"),
	handler: run(async (svc, actor, input: { firmId: string; criterionId?: string; claimId?: string; field?: CriterionField; polarity?: "include" | "exclude"; value?: string; minUsd?: number; maxUsd?: number; note: string }) => ({ approval: await svc.participation.approve(actor, input) })),
});

export const profileApprovalWithdraw = defineCapability({
	name: "profile.approval.withdraw",
	version: 1,
	description: "A verified representative withdraws one of their approvals by appending a withdrawal.",
	authorization: ["profile.publish"],
	input: s.object({ firmId: id(), approvalId: id(), note: s.string() }),
	output: out("approval"),
	attributes: contract("append-only"),
	handler: run(async (svc, actor, input: { firmId: string; approvalId: string; note: string }) => ({ approval: await svc.participation.withdrawApproval(actor, input) })),
});

export const profilePublish = defineCapability({
	name: "profile.publish",
	version: 1,
	description: "Publishes exactly the chosen representative-approved criteria as a new version of the firm's public profile, readable by every workspace. Nothing is published unless chosen.",
	authorization: ["profile.publish"],
	input: s.object({ firmId: id(), approvalIds: s.array(id(), { maxItems: 50 }), note: s.optional(s.string()) }),
	output: out("profile"),
	attributes: contract("append-only: each call is a new version; a concurrent publish retries on the next version"),
	handler: run(async (svc, actor, input: { firmId: string; approvalIds: string[]; note?: string }) => ({ profile: await svc.participation.publish(actor, input) })),
});

export const profileUnpublish = defineCapability({
	name: "profile.unpublish",
	version: 1,
	description: "Withdraws the published profile by appending a withdrawal version. Earlier versions stay in the history.",
	authorization: ["profile.publish"],
	input: s.object({ firmId: id(), note: s.string() }),
	output: out("profile"),
	attributes: contract("append-only"),
	handler: run(async (svc, actor, input: { firmId: string; note: string }) => ({ profile: await svc.participation.unpublish(actor, input) })),
});

export const profileHistory = defineCapability({
	name: "profile.history",
	version: 1,
	description: "Approvals, withdrawals, publications and claim decisions for a firm, newest first.",
	authorization: ["invest.read"],
	input: s.object({ firmId: id() }),
	output: out("items"),
	attributes: contract("read-only"),
	handler: run(async (svc, actor, input: { firmId: string }) => ({ items: await svc.participation.history(actor, input.firmId) })),
});

export const directoryList = defineCapability({
	name: "directory.list",
	version: 1,
	description: "Firms that have published an investor-approved profile (current versions only). The one place a workspace reads another workspace's data, and only what a verified representative chose to publish.",
	authorization: ["invest.read"],
	input: s.object({}),
	output: out("items"),
	attributes: contract("read-only"),
	handler: run(async (svc) => ({ items: await svc.participation.directory() })),
});

export const directoryGet = defineCapability({
	name: "directory.get",
	version: 1,
	description: "A firm's published profile for a domain, or null.",
	authorization: ["invest.read"],
	input: s.object({ domain: s.string() }),
	output: out("profile"),
	attributes: contract("read-only"),
	handler: run(async (svc, _actor, input: { domain: string }) => ({ profile: await svc.participation.publishedFor(input.domain.trim().toLowerCase().replace(/^www\./, "")) })),
});

const contributionInput = { kind: s.enum(CONTRIBUTION_KINDS), firmDomain: s.string(), field: s.optional(s.enum(CRITERION_FIELDS)), polarity: s.optional(s.enum(["include", "exclude"])), value: s.optional(s.string()), minUsd: s.optional(s.number()), maxUsd: s.optional(s.number()), text: s.string(), evidenceUrls: s.optional(s.array(s.string(), { maxItems: 5 })) };
type ContribIn = { kind: (typeof CONTRIBUTION_KINDS)[number]; firmDomain: string; field?: CriterionField; polarity?: "include" | "exclude"; value?: string; minUsd?: number; maxUsd?: number; text: string; evidenceUrls?: string[] };

export const contributionCreate = defineCapability({
	name: "contribution.create",
	version: 1,
	description: "Records a private contribution about a firm: a correction, firsthand note, outdated-criterion flag, suggested relationship or interaction note. Private to the author's workspace until shared.",
	authorization: ["contribution.write"],
	input: s.object(contributionInput),
	output: out("contribution"),
	attributes: contract("append-only"),
	handler: run(async (svc, actor, input: ContribIn) => ({ contribution: await svc.participation.contribute(actor, input) })),
});

export const contributionEdit = defineCapability({
	name: "contribution.edit",
	version: 1,
	description: "Edits a contribution by creating a new version; earlier versions stay.",
	authorization: ["contribution.write"],
	input: s.object({ chainId: id(), ...contributionInput }),
	output: out("contribution"),
	attributes: contract("append-only versions"),
	handler: run(async (svc, actor, input: ContribIn & { chainId: string }) => ({ contribution: await svc.participation.edit(actor, input.chainId, input) })),
});

export const contributionMine = defineCapability({
	name: "contribution.mine",
	version: 1,
	description: "The caller's own contributions with sharing state, share history and the responses received.",
	authorization: ["contribution.write"],
	input: s.object({ firmDomain: s.optional(s.string()) }),
	output: out("items"),
	attributes: contract("read-only"),
	handler: run(async (svc, actor, input: { firmDomain?: string }) => ({ items: await svc.participation.mine(actor, input) })),
});

export const contributionShare = defineCapability({
	name: "contribution.share",
	version: 1,
	description: "Shares a contribution with the firm it is about, or with moderators. Sharing is consent for that audience only; it is not publishing. Aggregate-analysis consent is a separate, explicit flag.",
	authorization: ["contribution.share"],
	input: s.object({ chainId: id(), audience: audienceSchema, aggregateConsent: s.optional(s.boolean()), note: s.optional(s.string()) }),
	output: out("share"),
	attributes: contract("append-only consent events"),
	handler: run(async (svc, actor, input: { chainId: string; audience: { kind: "firm" | "moderator"; domain?: string }; aggregateConsent?: boolean; note?: string }) => ({ share: await svc.participation.share(actor, { ...input, audience: asAudience(input.audience) }) })),
});

export const contributionRevoke = defineCapability({
	name: "contribution.revoke",
	version: 1,
	description: "Revokes sharing for one audience. The receiver can no longer read it; their earlier responses remain.",
	authorization: ["contribution.share"],
	input: s.object({ chainId: id(), audience: audienceSchema }),
	output: out("share"),
	attributes: contract("append-only consent events"),
	handler: run(async (svc, actor, input: { chainId: string; audience: { kind: "firm" | "moderator"; domain?: string } }) => ({ share: await svc.participation.revoke(actor, { chainId: input.chainId, audience: asAudience(input.audience) }) })),
});

export const contributionSharedWithFirm = defineCapability({
	name: "contribution.shared",
	version: 1,
	description: "Contributions authors shared with the firm. Only a verified representative of that firm can read them; authors are not identified.",
	authorization: ["contribution.read_shared"],
	input: s.object({ domain: s.string() }),
	output: out("items"),
	attributes: contract("read-only"),
	handler: run(async (svc, actor, input: { domain: string }) => ({ items: await svc.participation.sharedWithFirm(actor, input.domain) })),
});

export const contributionModeratorQueue = defineCapability({
	name: "contribution.queue",
	version: 1,
	description: "Contributions authors chose to share with moderators.",
	authorization: ["moderation.review"],
	input: s.object({}),
	output: out("items"),
	attributes: contract("read-only"),
	handler: run(async (svc, actor) => ({ items: await svc.participation.moderatorQueue(actor) })),
});

export const contributionRespond = defineCapability({
	name: "contribution.respond",
	version: 1,
	description: "A verified representative or moderator responds to a shared contribution. A dispute is recorded beside the contribution; it never edits or deletes it.",
	authorization: ["invest.read"],
	input: s.object({ chainId: id(), action: s.enum(["confirm", "dispute", "dismiss", "flag", "note"]), note: s.string(), as: s.enum(["firm_representative", "moderator"]) }),
	output: out("response"),
	attributes: contract("append-only"),
	handler: run(async (svc, actor, input: { chainId: string; action: "confirm" | "dispute" | "dismiss" | "flag" | "note"; note: string; as: "firm_representative" | "moderator" }) => ({ response: await svc.participation.respond(actor, input) })),
});

function strip<T extends { requestKey?: string; manifest?: unknown }>(e: T) {
	const { requestKey: _k, ...rest } = e;
	return rest;
}

export function investCapabilities(options: { maxUploadBytes: number }) {
	return [
		sessionWhoami,
		workspaceOverview,
		thesisList,
		thesisGet,
		thesisCreate,
		thesisDraftUpdate,
		thesisDraftDiscard,
		thesisValidate,
		thesisApprove,
		thesisVersionGet,
		thesisVersionCompare,
		startupList,
		startupGet,
		startupCreate,
		startupUpdate,
		createDocumentUpload(options.maxUploadBytes),
		documentGet,
		documentPage,
		documentLink,
		documentPurge,
		evidenceList,
		evidenceGet,
		evidenceAttach,
		evaluationStart,
		evaluationRerun,
		evaluationList,
		evaluationGet,
		evaluationVerify,
		reviewRecord,
		reviewRequest,
		reviewResolve,
		decisionRecord,
		auditList,
		firmList,
		firmGet,
		firmRefresh,
		firmVerify,
		firmReview,
		firmMonitoringSet,
		firmTimeline,
		attentionList,
		firmApprove,
		firmApprovalWithdraw,
		sourceRegister,
		sourceUpdate,
		sourceList,
		sourceGet,
		sourceRecords,
		sourceRefresh,
		sourceMonitoringSet,
		matchDecide,
		matchList,
		firmReconciliation,
		inboxList,
		profileClaimRequest,
		profileClaimCheck,
		profileClaimMine,
		claimPending,
		claimReview,
		profileApprove,
		profileApprovalWithdraw,
		profilePublish,
		profileUnpublish,
		profileHistory,
		directoryList,
		directoryGet,
		contributionCreate,
		contributionEdit,
		contributionMine,
		contributionShare,
		contributionRevoke,
		contributionSharedWithFirm,
		contributionModeratorQueue,
		contributionRespond,
	];
}
