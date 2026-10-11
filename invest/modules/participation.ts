import { randomBytes } from "node:crypto";
import { newId, newSortableId, sha256Hex } from "../domain/canonical.ts";
import { conflict, forbidden, invalid, notFound, precondition } from "../domain/errors.ts";
import {
	type ClaimEvent,
	type ClaimStatus,
	type Contribution,
	type ContributionKind,
	type ContributionResponse,
	type ContributionShare,
	type PublishedCriterion,
	type PublishedProfile,
	type RepresentativeClaim,
	type ShareAudience,
	CONTRIBUTION_KINDS,
} from "../domain/collab.ts";
import type { CriterionField, FirmApproval, InvestorFirm, ResearchLimits } from "../domain/research.ts";
import { CRITERION_FIELDS } from "../domain/research.ts";
import type { Actor } from "../domain/types.ts";
import { checkSizeLabel, checkSizeValue, isHostile } from "../research/extract.ts";
import type { PageFetcher } from "../research/fetcher.ts";
import { normalizeFirmUrl } from "../research/url.ts";
import { C, type InvestStore, type StoreWrite } from "../store/store.ts";
import { type InvestorResearchModule, currentApprovals } from "./investor-research.ts";

const WELL_KNOWN = "/.well-known/attn-invest-claim.txt";
const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1)}…`);

export function claimStatusOf(events: ClaimEvent[]): ClaimStatus {
	const decisive = [...events].filter((e) => ["verified", "rejected", "revoked"].includes(e.kind)).sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id)).at(-1);
	return decisive ? (decisive.kind as ClaimStatus) : "requested";
}

export type ParticipationDeps = { store: InvestStore; research: InvestorResearchModule; fetcherFor: (scopeDomain: string, limits: ResearchLimits) => PageFetcher; limits: ResearchLimits };

type ContributionInput = {
	kind: ContributionKind;
	firmDomain: string;
	field?: CriterionField;
	polarity?: "include" | "exclude";
	value?: string;
	minUsd?: number;
	maxUsd?: number;
	text: string;
	evidenceUrls?: string[];
};

/**
 * Two-sided participation.
 *
 * Authority: signing up is not authority. A representative claim becomes effective only after a
 * moderator verifies it against evidence (a domain-control proof is evidence, not authority), and a
 * moderator can revoke it. Only an actor holding a verified claim for a firm's domain can approve that
 * firm's criteria as its representative or publish them. A fund partner approving in their own
 * workspace is a different, weaker authority ("workspace") and stays labelled as such.
 *
 * Privacy: a contribution lives in its author's workspace and is invisible to everyone else until the
 * author shares it, per audience, with an event that can later be revoked. Sharing is not publishing,
 * and a dispute by the receiver never edits or deletes the contribution.
 *
 * Moderation is a platform duty: a moderator reads and writes across workspaces through these methods
 * only, and writes land in the subject's workspace with the moderator's principal preserved.
 */
export class ParticipationModule {
	constructor(private readonly deps: ParticipationDeps) {}

	private get store() {
		return this.deps.store;
	}

	/** Moderation writes into the subject's workspace on behalf of the moderator. The principal stays the moderator's. */
	private onBehalf(moderator: Actor, workspaceId: string): Actor {
		return { ...moderator, workspaceId };
	}

	// ------------------------------------------------------------------ representative claims

	async requestClaim(actor: Actor, input: { domain: string; firmName: string; relationship: string }): Promise<{ claim: RepresentativeClaim; status: ClaimStatus }> {
		if (!actor.permissions.includes("profile.claim")) throw forbidden("Claiming a profile needs the profile.claim permission");
		let domain: string;
		try {
			domain = normalizeFirmUrl(input.domain).canonicalDomain;
		} catch {
			throw invalid("Give the firm's website domain");
		}
		const firmName = input.firmName?.trim() ?? "";
		const relationship = input.relationship?.trim() ?? "";
		if (firmName.length < 2 || firmName.length > 120) throw invalid("The firm's name is required");
		if (relationship.length < 10 || relationship.length > 1000) throw invalid("Describe your role at the firm and how it can be confirmed (10–1000 characters)");
		const id = `rc_${sha256Hex(`${actor.workspaceId}|${actor.principalId}|${domain}`).slice(0, 32)}`;
		const existing = await this.store.get<RepresentativeClaim>(C.representativeClaims, id, actor.workspaceId);
		if (existing) return { claim: existing, status: claimStatusOf(await this.eventsOf(actor.workspaceId, id)) };
		const now = this.store.now();
		const claim: RepresentativeClaim = { id, workspaceId: actor.workspaceId, principalId: actor.principalId, canonicalDomain: domain, firmName, relationship, challenge: `attn-invest-claim:${randomBytes(18).toString("hex")}`, requestedAt: now };
		const ev: ClaimEvent = { id: newSortableId("ce"), workspaceId: actor.workspaceId, claimId: id, kind: "requested", actorId: actor.principalId, rationale: relationship, data: null, at: now };
		try {
			await this.store.commit(actor, {
				writes: [
					{ collection: C.representativeClaims, id, value: claim as unknown as Record<string, unknown>, create: true },
					{ collection: C.claimEvents, id: ev.id, value: ev as unknown as Record<string, unknown>, create: true },
				],
				audit: [{ eventType: "claim.requested", entityRef: { type: "representative_claim", id }, payload: { claimId: id, domain, firmName } }],
			});
		} catch (error) {
			if ((error as { code?: string }).code === "conflict") return { claim: (await this.store.get<RepresentativeClaim>(C.representativeClaims, id, actor.workspaceId))!, status: "requested" };
			throw error;
		}
		return { claim, status: "requested" };
	}

	private async eventsOf(workspaceId: string, claimId: string): Promise<ClaimEvent[]> {
		return this.store.list<ClaimEvent>(C.claimEvents, workspaceId, { claimId });
	}

	async myClaims(actor: Actor) {
		const claims = (await this.store.list<RepresentativeClaim>(C.representativeClaims, actor.workspaceId)).filter((c) => c.principalId === actor.principalId);
		const out = [];
		for (const c of claims) {
			const events = (await this.eventsOf(actor.workspaceId, c.id)).sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
			out.push({ claim: c, status: claimStatusOf(events), events: events.map(({ data, ...rest }) => ({ ...rest, data })) });
		}
		return out.sort((a, b) => a.claim.canonicalDomain.localeCompare(b.claim.canonicalDomain));
	}

	/** The claimant checks that they control the domain: the safe fetcher reads the well-known file. Evidence only. */
	async checkProof(actor: Actor, claimId: string): Promise<ClaimEvent> {
		const claim = await this.store.get<RepresentativeClaim>(C.representativeClaims, claimId, actor.workspaceId);
		if (!claim || claim.principalId !== actor.principalId) throw notFound("Claim");
		const fetcher = this.deps.fetcherFor(claim.canonicalDomain, this.deps.limits);
		const res = await fetcher.fetchPage(`https://${claim.canonicalDomain}${WELL_KNOWN}`);
		const ok = res.outcome === "ok" && typeof res.body === "string" && res.body.trim() === claim.challenge;
		const detail = ok ? "The challenge was found at the well-known path." : res.outcome === "ok" ? "The file does not contain this claim's challenge." : `The proof file could not be read (${res.outcome}${res.detail ? `: ${res.detail}` : ""}).`;
		const ev: ClaimEvent = { id: newSortableId("ce"), workspaceId: actor.workspaceId, claimId, kind: "proof_checked", actorId: actor.principalId, rationale: detail, data: { proofOk: ok, proofDetail: detail }, at: this.store.now() };
		await this.store.commit(actor, { writes: [{ collection: C.claimEvents, id: ev.id, value: ev as unknown as Record<string, unknown>, create: true }], audit: [{ eventType: "claim.proof_checked", entityRef: { type: "representative_claim", id: claimId }, payload: { claimId, domain: claim.canonicalDomain, ok } }] });
		return ev;
	}

	/** Moderator inbox: claims awaiting a decision, across workspaces. */
	async pendingClaims(actor: Actor) {
		if (!actor.permissions.includes("moderation.review")) throw forbidden("Reviewing claims needs the moderation.review permission");
		const claims = await this.store.scanAll<RepresentativeClaim>(C.representativeClaims);
		const events = await this.store.scanAll<ClaimEvent>(C.claimEvents);
		return claims
			.map((c) => {
				const mine = events.filter((e) => e.claimId === c.id).sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
				return { claim: { ...c, challenge: undefined as never }, status: claimStatusOf(mine), proof: [...mine].reverse().find((e) => e.kind === "proof_checked")?.data ?? null, events: mine };
			})
			.filter((c) => c.status === "requested")
			.sort((a, b) => a.claim.requestedAt.localeCompare(b.claim.requestedAt));
	}

	/**
	 * A moderator's decision on a representative claim.
	 *
	 * Consistency protocol (FeltDB gives one atomic transaction across collections; it does not know about workspaces, so this store
	 * confines each write to one workspace explicitly):
	 *  - ONE transaction writes the decision event, the fenced claim record (and, on revocation, the withdrawal of what that
	 *    representative published), the claimant's audit event, and a mirror of it in the moderator's own history. All of it happens or none of it.
	 *  - The claim record is written with `ifVersion`: two moderators deciding at once cannot both succeed; the loser re-reads and is told
	 *    what happened. `expectedStatus` refuses a decision taken on a stale view.
	 *  - A retry of the same decision by the same moderator (same state, same reason) returns the recorded event instead of writing another.
	 * Failure cases: a rejected transaction writes nothing and records nothing; there is no state in which a decision exists without its audit.
	 */
	async reviewClaim(actor: Actor, input: { claimId: string; decision: "verify" | "reject" | "revoke"; rationale: string; evidence?: string[]; expectedStatus?: ClaimStatus; keepPublished?: boolean }): Promise<ClaimEvent & { effects?: { withdrawnPublishedVersion: number | null; otherVerifiedRepresentatives: number } }> {
		if (!actor.permissions.includes("moderation.review")) throw forbidden("Reviewing claims needs the moderation.review permission");
		const located = (await this.store.scanAll<RepresentativeClaim>(C.representativeClaims)).find((c) => c.id === input.claimId);
		if (!located) throw notFound("Claim");
		const rationale = input.rationale?.trim() ?? "";
		if (rationale.length < 10 || rationale.length > 2000) throw invalid("A rationale of 10–2000 characters is required");
		const evidence = (input.evidence ?? []).map((e) => clip(String(e).trim(), 300)).filter(Boolean).slice(0, 10);
		const kind: ClaimEvent["kind"] = input.decision === "verify" ? "verified" : input.decision === "reject" ? "rejected" : "revoked";
		for (let attempt = 0; attempt < 4; attempt++) {
			const claim = await this.store.get<RepresentativeClaim & { __version?: number }>(C.representativeClaims, located.id, located.workspaceId);
			if (!claim) throw notFound("Claim");
			const events = (await this.eventsOf(claim.workspaceId, claim.id)).sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
			const status = claimStatusOf(events);
			const decisive = [...events].reverse().find((e) => ["verified", "rejected", "revoked"].includes(e.kind)) ?? null;
			if (input.expectedStatus && input.expectedStatus !== status) throw precondition(`This claim changed since you opened it (it is now ${status}). Reload and decide again.`, { currentStatus: status });
			// A retry of a decision that already went through is answered with that decision, not refused and not repeated.
			if (decisive && decisive.kind === kind && decisive.actorId === actor.principalId && decisive.rationale === rationale) return decisive;
			if (kind === "verified" && status === "verified") throw precondition("This claim is already verified");
			if (kind === "rejected" && status === "verified") throw precondition("Revoke a verified claim instead of rejecting it");
			if (kind === "rejected" && status === "rejected") throw precondition("This claim is already rejected");
			if (kind === "revoked" && status !== "verified") throw precondition("Only a verified claim can be revoked");
			// A proof counts only if it was checked after the last decision: control of a domain can be lost, so re-verification needs a fresh one.
			const sinceDecision = decisive ? events.filter((e) => e.at > decisive.at || (e.at === decisive.at && e.id > decisive.id)) : events;
			const proofOk = sinceDecision.some((e) => e.kind === "proof_checked" && e.data?.proofOk);
			if (kind === "verified" && !proofOk && !evidence.length) throw invalid("Verifying needs evidence: a domain proof checked since the last decision, or documented evidence you reviewed");
			const at = this.store.now();
			const ev: ClaimEvent = { id: newSortableId("ce"), workspaceId: claim.workspaceId, claimId: claim.id, kind, actorId: actor.principalId, rationale, data: { evidence, proofOk }, at };
			const writes: StoreWrite[] = [
				{ collection: C.claimEvents, id: ev.id, value: ev as unknown as Record<string, unknown>, create: true },
				{ collection: C.representativeClaims, id: claim.id, value: { ...claim, lastDecisionId: ev.id } as unknown as Record<string, unknown>, ifVersion: claim.__version },
			];
			const audit = [{ eventType: `claim.${kind}`, entityRef: { type: "representative_claim", id: claim.id }, payload: { claimId: claim.id, domain: claim.canonicalDomain, firmName: claim.firmName, principal: claim.principalId, decisionId: ev.id, previousStatus: status, rationale, evidence: evidence.length } }];
			// Revocation ends this person's authority. What they already published is withdrawn with it, unless the moderator keeps it:
			// the published versions and their provenance stay in the history either way.
			let withdrawnVersion: number | null = null;
			if (kind === "revoked" && !input.keepPublished) {
				const latest = (await this.store.scanAll<PublishedProfile>(C.publishedProfiles)).filter((p) => p.canonicalDomain === claim.canonicalDomain).sort((a, b) => b.version - a.version)[0];
				if (latest && !latest.withdrawn && latest.claimId === claim.id) {
					const version = latest.version + 1;
					const profile: PublishedProfile = { id: `pp_${sha256Hex(`${claim.canonicalDomain}|${version}`).slice(0, 32)}`, workspaceId: claim.workspaceId, canonicalDomain: claim.canonicalDomain, firmName: latest.firmName, version, supersedesId: latest.id, criteria: [], withdrawn: true, note: clip(`Withdrawn because the publishing representative's verification was revoked: ${rationale}`, 1000), claimId: claim.id, publishedBy: actor.principalId, publishedAt: at };
					writes.push({ collection: C.publishedProfiles, id: profile.id, value: profile as unknown as Record<string, unknown>, create: true });
					audit.push({ eventType: "profile.unpublished", entityRef: { type: "published_profile", id: profile.id }, payload: { claimId: claim.id, domain: claim.canonicalDomain, firmName: latest.firmName, principal: claim.principalId, decisionId: ev.id, previousStatus: "published", rationale, evidence: 0, version } as never });
					withdrawnVersion = version;
				}
			}
			try {
				await this.store.commit(this.onBehalf(actor, claim.workspaceId), { writes, audit, mirrorAudit: [{ workspaceId: actor.workspaceId, actorId: actor.principalId }] });
			} catch (error) {
				if ((error as { code?: string }).code === "conflict" && attempt < 3) continue; // another decision or publication landed first: re-read and decide against the new state
				if ((error as { code?: string }).code === "conflict") throw conflict("Another decision on this claim was recorded at the same moment. Reload and decide again.");
				throw error;
			}
			const all = await this.store.scanAll<ClaimEvent>(C.claimEvents);
			const others = (await this.store.scanAll<RepresentativeClaim>(C.representativeClaims)).filter((c) => c.canonicalDomain === claim.canonicalDomain && c.id !== claim.id && claimStatusOf(all.filter((e) => e.claimId === c.id)) === "verified").length;
			return { ...ev, effects: { withdrawnPublishedVersion: withdrawnVersion, otherVerifiedRepresentatives: others } };
		}
		throw conflict("This claim is changing too quickly; reload and try again");
	}

	/** Moderator view of every decided claim: who is verified for which firm, on what basis, and what revoking them would change. */
	async claimDirectory(actor: Actor) {
		if (!actor.permissions.includes("moderation.review")) throw forbidden("Reviewing claims needs the moderation.review permission");
		const [claims, events, published, approvals] = await Promise.all([this.store.scanAll<RepresentativeClaim>(C.representativeClaims), this.store.scanAll<ClaimEvent>(C.claimEvents), this.store.scanAll<PublishedProfile>(C.publishedProfiles), this.store.scanAll<FirmApproval>(C.firmApprovals)]);
		const statusOf = new Map(claims.map((c) => [c.id, claimStatusOf(events.filter((e) => e.claimId === c.id))] as const));
		return claims
			.filter((c) => statusOf.get(c.id) !== "requested")
			.map((c) => {
				const mine = events.filter((e) => e.claimId === c.id).sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
				const status = statusOf.get(c.id)!;
				const latest = published.filter((p) => p.canonicalDomain === c.canonicalDomain).sort((a, b) => b.version - a.version)[0] ?? null;
				return {
					claim: { id: c.id, canonicalDomain: c.canonicalDomain, firmName: c.firmName, requestedAt: c.requestedAt, relationship: c.relationship, principalId: c.principalId, workspaceId: c.workspaceId },
					status,
					events: mine.map((e) => ({ id: e.id, kind: e.kind, at: e.at, actorId: e.actorId, rationale: e.rationale, data: e.data })),
					lastProof: [...mine].reverse().find((e) => e.kind === "proof_checked")?.data ?? null,
					published: latest ? { version: latest.version, withdrawn: latest.withdrawn, publishedAt: latest.publishedAt, publishedByThisClaim: latest.claimId === c.id, criteria: latest.criteria.length } : null,
					representativeApprovals: approvals.filter((a) => a.representativeClaimId === c.id && a.kind === "approve").length,
					otherVerifiedRepresentatives: claims.filter((o) => o.canonicalDomain === c.canonicalDomain && o.id !== c.id && statusOf.get(o.id) === "verified").length,
				};
			})
			.sort((a, b) => a.claim.canonicalDomain.localeCompare(b.claim.canonicalDomain) || a.claim.requestedAt.localeCompare(b.claim.requestedAt));
	}

	/** The actor's verified claim for a firm domain, or null. Authority is checked here, every time, from the stored events. */
	async verifiedClaim(actor: Actor, domain: string): Promise<RepresentativeClaim | null> {
		const id = `rc_${sha256Hex(`${actor.workspaceId}|${actor.principalId}|${domain}`).slice(0, 32)}`;
		const claim = await this.store.get<RepresentativeClaim>(C.representativeClaims, id, actor.workspaceId);
		if (!claim) return null;
		return claimStatusOf(await this.eventsOf(actor.workspaceId, id)) === "verified" ? claim : null;
	}

	private async requireAuthority(actor: Actor, firmId: string, permission: string) {
		if (!actor.permissions.includes(permission)) throw forbidden(`This needs the ${permission} permission`);
		const firm = await this.deps.research.getFirm(actor, firmId);
		const claim = await this.verifiedClaim(actor, firm.canonicalDomain);
		if (!claim) throw forbidden("Only a verified representative of this firm can do this. Request and complete verification first.");
		return { firm, claim };
	}

	// ------------------------------------------------------------------ representative approval and publication

	async approve(actor: Actor, input: { firmId: string; criterionId?: string; claimId?: string; field?: CriterionField; polarity?: "include" | "exclude"; value?: string; minUsd?: number; maxUsd?: number; note: string }): Promise<FirmApproval> {
		const { claim } = await this.requireAuthority(actor, input.firmId, "profile.publish");
		return this.deps.research.approveWith(actor, { ...input, basisClaimId: input.claimId }, { authority: "firm_representative", claimId: claim.id });
	}

	async withdrawApproval(actor: Actor, input: { firmId: string; approvalId: string; note: string }): Promise<FirmApproval> {
		await this.requireAuthority(actor, input.firmId, "profile.publish");
		return this.deps.research.withdrawWith(actor, input, "firm_representative");
	}

	/** Publishes exactly the chosen representative-approved criteria as a new version. Nothing is published unless chosen. */
	async publish(actor: Actor, input: { firmId: string; approvalIds: string[]; note?: string }): Promise<PublishedProfile> {
		const { firm, claim } = await this.requireAuthority(actor, input.firmId, "profile.publish");
		const approvals = currentApprovals(await this.deps.research.approvalsFor(actor, firm.id)).filter((a) => a.authority === "firm_representative");
		const chosen = input.approvalIds.map((id) => approvals.find((a) => a.id === id));
		if (!input.approvalIds.length || chosen.some((c) => !c)) throw invalid("Choose among your current representative-approved criteria");
		const criteria: PublishedCriterion[] = (chosen as FirmApproval[]).map((a) => ({ field: a.field, polarity: a.polarity, value: a.value, valueRange: a.valueRange, label: a.valueRange ? checkSizeLabel(a.valueRange) : a.value.replace(/_/g, " "), approvalId: a.id }));
		return this.writeVersion(actor, firm, claim, criteria, false, input.note ?? "");
	}

	async unpublish(actor: Actor, input: { firmId: string; note: string }): Promise<PublishedProfile> {
		const { firm, claim } = await this.requireAuthority(actor, input.firmId, "profile.publish");
		return this.writeVersion(actor, firm, claim, [], true, input.note);
	}

	private async writeVersion(actor: Actor, firm: InvestorFirm, claim: RepresentativeClaim, criteria: PublishedCriterion[], withdrawn: boolean, note: string): Promise<PublishedProfile> {
		for (let attempt = 0; attempt < 6; attempt++) {
			const all = (await this.store.scanAll<PublishedProfile>(C.publishedProfiles)).filter((p) => p.canonicalDomain === firm.canonicalDomain);
			const latest = all.sort((a, b) => b.version - a.version)[0] ?? null;
			if (withdrawn && (!latest || latest.withdrawn)) throw precondition("Nothing is published for this firm");
			const version = (latest?.version ?? 0) + 1;
			const profile: PublishedProfile = { id: `pp_${sha256Hex(`${firm.canonicalDomain}|${version}`).slice(0, 32)}`, workspaceId: actor.workspaceId, canonicalDomain: firm.canonicalDomain, firmName: firm.name, version, supersedesId: latest?.id ?? null, criteria, withdrawn, note: note.trim().slice(0, 1000), claimId: claim.id, publishedBy: actor.principalId, publishedAt: this.store.now() };
			try {
				await this.store.commit(actor, { writes: [{ collection: C.publishedProfiles, id: profile.id, value: profile as unknown as Record<string, unknown>, create: true }], audit: [{ eventType: withdrawn ? "profile.unpublished" : "profile.published", entityRef: { type: "published_profile", id: profile.id }, payload: { domain: firm.canonicalDomain, version, criteria: criteria.length, claimId: claim.id } }] });
				return profile;
			} catch (error) {
				if ((error as { code?: string }).code !== "conflict") throw error;
			}
		}
		throw conflict("The published profile is changing too quickly; retry");
	}

	/** What a firm has chosen to publish: readable by every workspace, current version only. */
	async publishedFor(domain: string): Promise<PublishedProfile | null> {
		const latest = (await this.store.scanAll<PublishedProfile>(C.publishedProfiles)).filter((p) => p.canonicalDomain === domain).sort((a, b) => b.version - a.version)[0];
		if (!latest || latest.withdrawn) return null;
		const { __version: _v, ...rest } = latest as PublishedProfile & { __version?: number };
		return rest;
	}

	async directory(): Promise<{ canonicalDomain: string; firmName: string; version: number; publishedAt: string; criteriaCount: number }[]> {
		const latest = new Map<string, PublishedProfile>();
		for (const p of await this.store.scanAll<PublishedProfile>(C.publishedProfiles)) if (!latest.has(p.canonicalDomain) || latest.get(p.canonicalDomain)!.version < p.version) latest.set(p.canonicalDomain, p);
		return [...latest.values()].filter((p) => !p.withdrawn).map((p) => ({ canonicalDomain: p.canonicalDomain, firmName: p.firmName, version: p.version, publishedAt: p.publishedAt, criteriaCount: p.criteria.length })).sort((a, b) => a.firmName.localeCompare(b.firmName));
	}

	/** Changes to a firm's approvals and publications, newest first: new information, corrections and what superseded what. */
	async history(actor: Actor, firmId: string) {
		const firm = await this.deps.research.getFirm(actor, firmId);
		const [approvals, published, claims] = await Promise.all([this.deps.research.approvalsFor(actor, firmId), this.store.scanAll<PublishedProfile>(C.publishedProfiles), this.store.list<RepresentativeClaim>(C.representativeClaims, actor.workspaceId)]);
		const claimEvents = (await Promise.all(claims.filter((c) => c.canonicalDomain === firm.canonicalDomain).map((c) => this.eventsOf(actor.workspaceId, c.id)))).flat();
		const items = [
			...approvals.map((a) => ({ at: a.createdAt, kind: a.kind === "approve" ? "approved" : "approval_withdrawn", actor: a.createdBy, authority: a.authority ?? "workspace", summary: `${a.kind === "approve" ? "Approved" : "Withdrew"} ${a.field.replace(/_/g, " ")}: ${a.valueRange ? checkSizeLabel(a.valueRange) : a.value.replace(/_/g, " ")}`, note: a.note, ref: a.id })),
			...published.filter((p) => p.canonicalDomain === firm.canonicalDomain && p.workspaceId === actor.workspaceId).map((p) => ({ at: p.publishedAt, kind: p.withdrawn ? "unpublished" : "published", actor: p.publishedBy, authority: "firm_representative", summary: p.withdrawn ? `Withdrew the published profile (version ${p.version})` : `Published version ${p.version} with ${p.criteria.length} criteria`, note: p.note, ref: p.id })),
			...claimEvents.filter((e) => e.kind !== "proof_checked").map((e) => ({ at: e.at, kind: `claim_${e.kind}`, actor: e.actorId, authority: "firm_representative", summary: `Representative claim ${e.kind}`, note: e.rationale, ref: e.id })),
		];
		return items.sort((a, b) => b.at.localeCompare(a.at));
	}

	// ------------------------------------------------------------------ contributions

	private cleanContribution(actor: Actor, input: ContributionInput) {
		if (!CONTRIBUTION_KINDS.includes(input.kind)) throw invalid("Unknown contribution kind");
		let domain: string;
		try {
			domain = normalizeFirmUrl(input.firmDomain).canonicalDomain;
		} catch {
			throw invalid("Give the firm's website domain");
		}
		const text = input.text?.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ").trim() ?? "";
		if (!text || text.length > 4000) throw invalid("Text of 1–4000 characters is required");
		const urls: string[] = [];
		for (const u of input.evidenceUrls ?? []) {
			try {
				const url = new URL(u);
				if (url.protocol !== "https:" || url.username || url.password) throw new Error("x");
				urls.push(url.toString().slice(0, 500));
			} catch {
				throw invalid(`"${String(u).slice(0, 60)}" is not an https URL`);
			}
		}
		if (urls.length > 5) throw invalid("At most 5 evidence links");
		let claim: Contribution["claim"] = null;
		if (input.field) {
			if (!CRITERION_FIELDS.includes(input.field) || input.field === "exclusion" || input.field === "application_requirements") throw invalid("Choose a criterion field");
			const polarity = input.polarity === "exclude" ? "exclude" : "include";
			if (input.field === "check_size") {
				const min = input.minUsd ?? null;
				const max = input.maxUsd ?? null;
				if ((min === null && max === null) || [min, max].some((n) => n !== null && (!Number.isFinite(n) || n < 0 || n > 1e10)) || (min !== null && max !== null && min > max)) throw invalid("Check size needs a valid minimum and/or maximum in USD");
				claim = { field: "check_size", polarity, value: checkSizeValue({ minUsd: min, maxUsd: max }), valueRange: { minUsd: min, maxUsd: max } };
			} else {
				const value = (input.value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
				if (!/^[a-z0-9_]{1,60}$/.test(value)) throw invalid("Value must be a short term such as seed or fintech");
				claim = { field: input.field, polarity, value, valueRange: null };
			}
		} else if (input.kind === "correction") throw invalid("A correction names the field it corrects");
		return { domain, text, urls, claim, hostile: isHostile(text) };
	}

	async contribute(actor: Actor, input: ContributionInput): Promise<Contribution> {
		if (!actor.permissions.includes("contribution.write")) throw forbidden("Contributing needs the contribution.write permission");
		const c = this.cleanContribution(actor, input);
		const chainId = newId("ch");
		const rec: Contribution = { id: `ct_${sha256Hex(`${chainId}|1`).slice(0, 32)}`, workspaceId: actor.workspaceId, chainId, version: 1, supersedesId: null, authorId: actor.principalId, category: actor.role === "founder" ? "founder_contribution" : "community_contribution", kind: input.kind, firmDomain: c.domain, claim: c.claim, text: c.text, evidenceUrls: c.urls, hostile: c.hostile, createdAt: this.store.now() };
		await this.store.commit(actor, { writes: [{ collection: C.contributions, id: rec.id, value: rec as unknown as Record<string, unknown>, create: true }], audit: [{ eventType: "contribution.created", entityRef: { type: "contribution", id: rec.id }, payload: { chainId, kind: rec.kind, domain: c.domain, hostile: c.hostile, private: true } }] });
		return rec;
	}

	private async chain(actor: Actor, chainId: string): Promise<Contribution[]> {
		const versions = (await this.store.list<Contribution>(C.contributions, actor.workspaceId, { chainId })).sort((a, b) => a.version - b.version);
		if (!versions.length) throw notFound("Contribution");
		if (versions[0]!.authorId !== actor.principalId && !actor.permissions.includes("thesis.approve")) throw notFound("Contribution");
		return versions;
	}

	/** Editing creates a new version; earlier versions stay. Private notes are editable only by their author. */
	async edit(actor: Actor, chainId: string, input: ContributionInput): Promise<Contribution> {
		if (!actor.permissions.includes("contribution.write")) throw forbidden("Contributing needs the contribution.write permission");
		const versions = await this.chain(actor, chainId);
		if (versions[0]!.authorId !== actor.principalId) throw forbidden("Only the author can edit a contribution");
		const prev = versions.at(-1)!;
		const c = this.cleanContribution(actor, input);
		const rec: Contribution = { ...prev, id: `ct_${sha256Hex(`${chainId}|${prev.version + 1}`).slice(0, 32)}`, version: prev.version + 1, supersedesId: prev.id, kind: input.kind, firmDomain: c.domain, claim: c.claim, text: c.text, evidenceUrls: c.urls, hostile: c.hostile, createdAt: this.store.now() };
		await this.store.commit(actor, { writes: [{ collection: C.contributions, id: rec.id, value: rec as unknown as Record<string, unknown>, create: true }], audit: [{ eventType: "contribution.edited", entityRef: { type: "contribution", id: rec.id }, payload: { chainId, version: rec.version, domain: c.domain } }] });
		return rec;
	}

	private sharesOf(workspaceId: string, chainId: string) {
		return this.store.list<ContributionShare>(C.contributionShares, workspaceId, { chainId });
	}

	/** Current audiences: for each audience the latest share/revoke event decides. */
	private activeShares(events: ContributionShare[]): ContributionShare[] {
		const latest = new Map<string, ContributionShare>();
		for (const e of [...events].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id))) latest.set(e.audience.kind === "firm" ? `firm:${e.audience.domain}` : "moderator", e);
		return [...latest.values()].filter((e) => e.event === "share");
	}

	async share(actor: Actor, input: { chainId: string; audience: ShareAudience; aggregateConsent?: boolean; note?: string }): Promise<ContributionShare> {
		if (!actor.permissions.includes("contribution.share")) throw forbidden("Sharing needs the contribution.share permission");
		const versions = await this.chain(actor, input.chainId);
		if (versions[0]!.authorId !== actor.principalId) throw forbidden("Only the author can share a contribution");
		let audience: ShareAudience = input.audience;
		if (audience.kind === "firm") {
			try {
				audience = { kind: "firm", domain: normalizeFirmUrl(audience.domain).canonicalDomain };
			} catch {
				throw invalid("Name the firm's domain");
			}
			if (audience.domain !== versions.at(-1)!.firmDomain) throw invalid("A contribution can only be shared with the firm it is about");
		} else if (audience.kind !== "moderator") throw invalid("Unknown audience");
		const ev: ContributionShare = { id: newSortableId("cs"), workspaceId: actor.workspaceId, chainId: input.chainId, event: "share", audience, aggregateConsent: input.aggregateConsent === true, note: (input.note ?? "").trim().slice(0, 500), actorId: actor.principalId, at: this.store.now() };
		await this.store.commit(actor, { writes: [{ collection: C.contributionShares, id: ev.id, value: ev as unknown as Record<string, unknown>, create: true }], audit: [{ eventType: "contribution.shared", entityRef: { type: "contribution", id: input.chainId }, payload: { chainId: input.chainId, audience, aggregateConsent: ev.aggregateConsent } }] });
		return ev;
	}

	async revoke(actor: Actor, input: { chainId: string; audience: ShareAudience }): Promise<ContributionShare> {
		if (!actor.permissions.includes("contribution.share")) throw forbidden("Sharing needs the contribution.share permission");
		const versions = await this.chain(actor, input.chainId);
		if (versions[0]!.authorId !== actor.principalId) throw forbidden("Only the author can change sharing");
		const audience: ShareAudience = input.audience.kind === "firm" ? { kind: "firm", domain: input.audience.domain.toLowerCase() } : { kind: "moderator" };
		const active = this.activeShares(await this.sharesOf(actor.workspaceId, input.chainId));
		if (!active.some((e) => JSON.stringify(e.audience) === JSON.stringify(audience))) throw precondition("This contribution is not shared with that audience");
		const ev: ContributionShare = { id: newSortableId("cs"), workspaceId: actor.workspaceId, chainId: input.chainId, event: "revoke", audience, aggregateConsent: false, note: "", actorId: actor.principalId, at: this.store.now() };
		await this.store.commit(actor, { writes: [{ collection: C.contributionShares, id: ev.id, value: ev as unknown as Record<string, unknown>, create: true }], audit: [{ eventType: "contribution.share_revoked", entityRef: { type: "contribution", id: input.chainId }, payload: { chainId: input.chainId, audience } }] });
		return ev;
	}

	private responsesFor(chainId: string, authorWorkspaceId: string, all: ContributionResponse[]) {
		return all.filter((r) => r.chainId === chainId && r.authorWorkspaceId === authorWorkspaceId).sort((a, b) => b.at.localeCompare(a.at));
	}

	/** The author's own contributions with their sharing state and the responses they have received. Private by default. */
	async mine(actor: Actor, filter: { firmDomain?: string } = {}) {
		const all = (await this.store.list<Contribution>(C.contributions, actor.workspaceId)).filter((c) => c.authorId === actor.principalId);
		const latest = new Map<string, Contribution>();
		for (const c of all) if (!latest.has(c.chainId) || latest.get(c.chainId)!.version < c.version) latest.set(c.chainId, c);
		const responses = await this.store.scanAll<ContributionResponse>(C.contributionResponses);
		const out = [];
		for (const c of latest.values()) {
			if (filter.firmDomain && c.firmDomain !== filter.firmDomain) continue;
			const shares = await this.sharesOf(actor.workspaceId, c.chainId);
			const active = this.activeShares(shares);
			const mine = this.responsesFor(c.chainId, actor.workspaceId, responses);
			const decisive = mine.find((r) => r.action !== "note");
			out.push({
				contribution: c,
				visibility: active.length ? "shared" : "private",
				audiences: active.map((s) => ({ audience: s.audience, aggregateConsent: s.aggregateConsent, since: s.at })),
				shareHistory: shares.sort((a, b) => b.at.localeCompare(a.at)),
				lifecycle: !active.length && !mine.length ? "private" : !decisive ? (active.length ? "proposed" : "private") : decisive.action === "confirm" ? "accepted" : decisive.action === "dismiss" ? "rejected" : decisive.action === "dispute" ? "disputed" : "needs_review",
				// A dispute or dismissal is shown with its reason; the contribution and its evidence stay.
				responses: mine.map((r) => ({ action: r.action, note: r.note, by: r.responderKind, at: r.at })),
				versions: all.filter((x) => x.chainId === c.chainId).length,
			});
		}
		return out.sort((a, b) => b.contribution.createdAt.localeCompare(a.contribution.createdAt));
	}

	private async sharedTo(match: (a: ShareAudience) => boolean) {
		const [contribs, shares] = await Promise.all([this.store.scanAll<Contribution>(C.contributions), this.store.scanAll<ContributionShare>(C.contributionShares)]);
		const byChain = new Map<string, ContributionShare[]>();
		for (const s of shares) byChain.set(s.chainId, [...(byChain.get(s.chainId) ?? []), s]);
		const latest = new Map<string, Contribution>();
		for (const c of contribs) if (!latest.has(c.chainId) || latest.get(c.chainId)!.version < c.version) latest.set(c.chainId, c);
		const out: { contribution: Contribution; share: ContributionShare }[] = [];
		for (const c of latest.values()) {
			const active = this.activeShares(byChain.get(c.chainId) ?? []).find((s) => match(s.audience));
			if (active) out.push({ contribution: c, share: active });
		}
		return out;
	}

	/** What a verified representative can see: only contributions the author shared with their firm. Authors are not identified. */
	async sharedWithFirm(actor: Actor, domain: string) {
		if (!actor.permissions.includes("contribution.read_shared")) throw forbidden("Reading shared contributions needs the contribution.read_shared permission");
		const d = normalizeFirmUrl(domain).canonicalDomain;
		if (!(await this.verifiedClaim(actor, d))) throw forbidden("Only a verified representative of this firm can read contributions shared with it");
		return this.present(actor, await this.sharedTo((a) => a.kind === "firm" && a.domain === d), "firm_representative");
	}

	async moderatorQueue(actor: Actor) {
		if (!actor.permissions.includes("moderation.review")) throw forbidden("Moderation needs the moderation.review permission");
		return this.present(actor, await this.sharedTo((a) => a.kind === "moderator"), "moderator");
	}

	private async present(actor: Actor, items: { contribution: Contribution; share: ContributionShare }[], as: ContributionResponse["responderKind"]) {
		const responses = (await this.store.scanAll<ContributionResponse>(C.contributionResponses)).filter((r) => r.workspaceId === actor.workspaceId || as === "moderator");
		return items
			.map(({ contribution: c, share }) => ({
				chainId: c.chainId,
				kind: c.kind,
				category: c.category,
				firmDomain: c.firmDomain,
				claim: c.claim,
				// Untrusted text. Instruction-like content is withheld from the receiver; the author still has it.
				text: c.hostile ? "[withheld: the text contains instruction-like content]" : c.text,
				hostile: c.hostile,
				evidenceUrls: c.evidenceUrls,
				sharedAt: share.at,
				version: c.version,
				responses: this.responsesFor(c.chainId, c.workspaceId, responses.filter((r) => r.actorId === actor.principalId || as === "moderator")).map((r) => ({ action: r.action, note: r.note, by: r.responderKind, at: r.at })),
			}))
			.sort((a, b) => b.sharedAt.localeCompare(a.sharedAt));
	}

	/** The receiving side responds. Nothing here edits or deletes the contribution: a dispute is a record beside it. */
	async respond(actor: Actor, input: { chainId: string; action: ContributionResponse["action"]; note: string; as: "firm_representative" | "moderator" }): Promise<ContributionResponse> {
		const note = input.note?.trim() ?? "";
		if (!note || note.length > 2000) throw invalid("A note of 1–2000 characters is required");
		if (!["confirm", "dispute", "dismiss", "flag", "note"].includes(input.action)) throw invalid("Unknown action");
		const contribs = (await this.store.scanAll<Contribution>(C.contributions)).filter((c) => c.chainId === input.chainId);
		const c = contribs.sort((a, b) => b.version - a.version)[0];
		if (!c) throw notFound("Contribution");
		let visible = false;
		if (input.as === "moderator") {
			if (!actor.permissions.includes("moderation.review")) throw forbidden("Moderation needs the moderation.review permission");
			visible = (await this.sharedTo((a) => a.kind === "moderator")).some((x) => x.contribution.chainId === input.chainId);
		} else {
			if (!actor.permissions.includes("contribution.read_shared")) throw forbidden("Responding needs the contribution.read_shared permission");
			if (!(await this.verifiedClaim(actor, c.firmDomain))) throw forbidden("Only a verified representative of this firm can respond");
			visible = (await this.sharedTo((a) => a.kind === "firm" && a.domain === c.firmDomain)).some((x) => x.contribution.chainId === input.chainId);
		}
		if (!visible) throw notFound("Contribution"); // not shared with you, or the share was revoked
		const rec: ContributionResponse = { id: newSortableId("cr"), workspaceId: actor.workspaceId, chainId: input.chainId, domain: c.firmDomain, authorWorkspaceId: c.workspaceId, action: input.action, note, responderKind: input.as, actorId: actor.principalId, at: this.store.now() };
		await this.store.commit(actor, { writes: [{ collection: C.contributionResponses, id: rec.id, value: rec as unknown as Record<string, unknown>, create: true }], audit: [{ eventType: "contribution.responded", entityRef: { type: "contribution", id: input.chainId }, payload: { chainId: input.chainId, action: input.action, as: input.as, domain: c.firmDomain } }] });
		return rec;
	}

	/** Contribution chains whose author gave explicit, unrevoked consent to aggregate use. Nothing consumes this yet; it is the gate any future analysis must pass. */
	async aggregateEligible(): Promise<string[]> {
		const shares = await this.store.scanAll<ContributionShare>(C.contributionShares);
		const byChain = new Map<string, ContributionShare[]>();
		for (const s of shares) byChain.set(s.chainId, [...(byChain.get(s.chainId) ?? []), s]);
		return [...byChain.entries()].filter(([, evs]) => this.activeShares(evs).some((s) => s.aggregateConsent)).map(([id]) => id);
	}

	/** The author's current contribution claims for a firm, for reconciliation inside their own workspace. */
	async ownClaimsFor(actor: Actor, domain: string): Promise<Contribution[]> {
		const all = (await this.store.list<Contribution>(C.contributions, actor.workspaceId)).filter((c) => c.firmDomain === domain && c.authorId === actor.principalId);
		const latest = new Map<string, Contribution>();
		for (const c of all) if (!latest.has(c.chainId) || latest.get(c.chainId)!.version < c.version) latest.set(c.chainId, c);
		return [...latest.values()].filter((c) => c.claim);
	}

	/** Superseded earlier versions of this author's contributions, for reconciliation's supersession state. */
	async olderVersions(actor: Actor, domain: string): Promise<Map<string, string>> {
		const all = (await this.store.list<Contribution>(C.contributions, actor.workspaceId)).filter((c) => c.firmDomain === domain);
		const latest = new Map<string, Contribution>();
		for (const c of all) if (!latest.has(c.chainId) || latest.get(c.chainId)!.version < c.version) latest.set(c.chainId, c);
		const out = new Map<string, string>();
		for (const c of all) if (latest.get(c.chainId)!.id !== c.id) out.set(c.id, latest.get(c.chainId)!.id);
		return out;
	}
}

export type { StoreWrite };
