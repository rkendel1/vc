import type { Claim, FieldReconciliation, LifecycleState, ReconciledClaim, SourceCategory, SourceRecord } from "../domain/collab.ts";
import type { CriterionView, EventReviewState, FirmApproval, ResearchReview } from "../domain/research.ts";
import type { Actor } from "../domain/types.ts";
import { checkSizeLabel } from "../research/extract.ts";
import { type InApproval, type InClaim, reconcile } from "../research/reconcile.ts";
import { C, type InvestStore } from "../store/store.ts";
import { type InvestorResearchModule, currentApprovals, reviewStateOf } from "./investor-research.ts";
import type { ParticipationModule } from "./participation.ts";
import type { SourceIngestionModule } from "./source-ingestion.ts";

/** The existing review states under their VC-4 lifecycle names. Superseded is derived, never decided. */
export function lifecycleOf(state: EventReviewState): LifecycleState {
	return state === "confirmed" ? "accepted" : state === "dismissed" ? "rejected" : state === "unreviewed" ? "proposed" : state;
}

export type InboxItem = {
	kind: "candidate_match" | "conflict" | "proposed_claim" | "contribution_shared" | "representative_claim" | "my_contribution_disputed";
	title: string;
	detail: string;
	at: string;
	firmId?: string;
	refs: { matchId?: string; conflictId?: string; claimKey?: string; chainId?: string; claimId?: string };
};

const host = (url: string | null | undefined, fallback: string) => {
	try {
		return url ? new URL(url).hostname.replace(/^www\./, "") : fallback;
	} catch {
		return fallback;
	}
};

/**
 * Brings the four kinds of evidence about a firm into one explained view: its own crawled statements,
 * curated third-party claims, the viewer's own contributions, and what a verified representative has
 * published. Storage stays separate; reconciliation is computed, so nothing is ever overwritten.
 */
export class ReconciliationModule {
	constructor(
		private readonly deps: { store: InvestStore; research: InvestorResearchModule; participation: ParticipationModule; sources: SourceIngestionModule; staleAfterDays: number },
	) {}

	private get store() {
		return this.deps.store;
	}

	async forFirm(actor: Actor, firmId: string) {
		const ws = actor.workspaceId;
		const profile = await this.deps.research.profile(actor, firmId);
		const firm = profile.firm;
		const domain = firm.canonicalDomain;
		const [claims, reviews, ownContribs, olderVersions, published, responses] = await Promise.all([
			this.store.list<Claim>(C.claims, ws, { firmId }),
			this.store.list<ResearchReview>(C.researchReviews, ws, { firmId }),
			this.deps.participation.ownClaimsFor(actor, domain),
			this.deps.participation.olderVersions(actor, domain),
			this.deps.participation.publishedFor(domain),
			this.store.scanAll<import("../domain/collab.ts").ContributionResponse>(C.contributionResponses),
		]);
		void olderVersions;
		const inClaims: InClaim[] = [];

		const exclusion = (c: CriterionView) => {
			if (c.polarity !== "exclude") return { field: c.field, value: c.value };
			const [f, ...rest] = c.value.split(":");
			return { field: f as CriterionView["field"], value: rest.join(":") };
		};
		for (const c of profile.criteria) {
			if (c.field === "application_requirements") continue;
			const n = exclusion(c);
			inClaims.push({ ref: { kind: "criterion", id: c.id }, field: n.field, polarity: c.polarity, value: n.value, valueRange: c.valueRange, label: c.label, category: "official_public_source", assertionType: c.assertionType, publisher: host(c.source?.finalUrl, domain), publisherKey: `firm:${domain}`, passage: c.passage, url: c.source?.finalUrl ?? null, publishedAt: null, capturedAt: c.lastConfirmedAt, lifecycle: lifecycleOf(reviewStateOf(c.reviews, "unreviewed")), supersededBy: null });
		}

		// Third-party claims: a newer version of the same source record replaces the older one's claims.
		const sourceRecords = new Map<string, SourceRecord | null>();
		const records = await this.store.list<SourceRecord>(C.sourceRecords, ws);
		const latestByIdentity = new Map<string, SourceRecord>();
		for (const r of records) if (!latestByIdentity.has(`${r.sourceId}|${r.identity}`) || latestByIdentity.get(`${r.sourceId}|${r.identity}`)!.version < r.version) latestByIdentity.set(`${r.sourceId}|${r.identity}`, r);
		for (const r of records) sourceRecords.set(r.id, r);
		for (const cl of claims) {
			const rec = cl.origin.sourceRecordId ? sourceRecords.get(cl.origin.sourceRecordId) : null;
			const newest = rec ? latestByIdentity.get(`${rec.sourceId}|${rec.identity}`) : null;
			const rs = reviews.filter((r) => r.claimId === cl.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
			inClaims.push({ ref: { kind: "claim", id: cl.id }, field: cl.field, polarity: cl.polarity, value: cl.value, valueRange: cl.valueRange, label: cl.label, category: cl.category, assertionType: cl.assertionType, publisher: cl.publisher, passage: cl.passage, url: rec?.sourceUrl ?? null, publishedAt: cl.publishedAt, capturedAt: cl.capturedAt, lifecycle: lifecycleOf(reviewStateOf(rs, "unreviewed")), supersededBy: newest && rec && newest.id !== rec.id ? newest.id : null });
		}

		for (const ct of ownContribs) {
			const c = ct.claim!;
			const rs = responses.filter((r) => r.chainId === ct.chainId && r.authorWorkspaceId === ws).sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id));
			const decisive = rs.find((r) => r.action !== "note");
			const lifecycle: LifecycleState = !decisive ? "proposed" : decisive.action === "confirm" ? "accepted" : decisive.action === "dismiss" ? "rejected" : decisive.action === "dispute" ? "disputed" : "needs_review";
			inClaims.push({ ref: { kind: "contribution", id: ct.id }, field: c.field, polarity: c.polarity, value: c.value, valueRange: c.valueRange, label: c.valueRange ? c.value : c.value.replace(/_/g, " "), category: ct.category, assertionType: "explicit", publisher: `contributor:${ct.authorId}`, passage: ct.text, url: ct.evidenceUrls[0] ?? null, publishedAt: null, capturedAt: ct.createdAt, lifecycle, supersededBy: null });
		}

		const approvals: InApproval[] = currentApprovals(await this.deps.research.approvalsFor(actor, firmId)).map((a: FirmApproval) => ({ id: a.id, field: a.field, polarity: a.polarity, value: a.value, valueRange: a.valueRange, label: a.valueRange ? checkSizeLabel(a.valueRange) : undefined, authority: a.authority ?? "workspace" }));
		if (published) {
			for (const pc of published.criteria) {
				inClaims.push({ ref: { kind: "published", id: `${published.id}:${pc.approvalId}` }, field: pc.field, polarity: pc.polarity, value: pc.value, valueRange: pc.valueRange, label: pc.label, category: "investor_verified", assertionType: "explicit", publisher: `firm:${published.canonicalDomain}`, publisherKey: `firm:${published.canonicalDomain}`, passage: `Published by a verified representative of ${published.firmName} (version ${published.version}).`, url: null, publishedAt: published.publishedAt, capturedAt: published.publishedAt, lifecycle: "accepted", supersededBy: null });
				if (!approvals.some((a) => a.id === pc.approvalId)) approvals.push({ label: pc.valueRange ? pc.label : undefined, id: pc.approvalId, field: pc.field, polarity: pc.polarity, value: pc.value, valueRange: pc.valueRange, authority: "firm_representative" });
			}
		}

		const now = this.store.now();
		const fields = reconcile({ claims: inClaims, approvals, now, staleAfterDays: this.deps.staleAfterDays });
		const count = (cat: SourceCategory) => inClaims.filter((c) => c.category === cat).length;
		return { firm, fields, published, counts: Object.fromEntries((["investor_verified", "official_public_source", "third_party_source", "founder_contribution", "community_contribution"] as const).map((c) => [c, count(c)])) as Record<SourceCategory, number>, openConflicts: fields.flatMap((f) => f.conflicts).filter((c) => c.reviewState !== "accepted").length };
	}

	/** Review a reconciled third-party claim. Accepting it records that a person judged the evidence; it never makes it investor-verified. */
	async reviewClaim(actor: Actor, input: { firmId: string; claimId: string; action: "confirm" | "dispute" | "dismiss" | "flag" | "note"; note: string }) {
		return this.deps.research.review(actor, { firmId: input.firmId, claimId: input.claimId, action: input.action, note: input.note });
	}

	async inbox(actor: Actor): Promise<InboxItem[]> {
		const items: InboxItem[] = [];
		const has = (p: string) => actor.permissions.includes(p);
		if (has("review.write") || has("invest.read")) {
			for (const { match, record } of await this.deps.sources.openMatches(actor).catch(() => [])) items.push({ kind: "candidate_match", title: `Is "${match.subjectName}" one of these?`, detail: `${match.candidates.map((c) => c.name).slice(0, 3).join(", ")} — ${match.reasons[0] ?? ""}${record ? ` (from ${record.sourceUrl})` : ""}`, at: match.resolvedAt, refs: { matchId: match.id } });
		}
		if (has("invest.read")) {
			for (const f of await this.deps.research.list(actor)) {
				if (!f.criteriaCount && !f.conflictCount) { /* still check claims below */ }
				const r = await this.forFirm(actor, f.id).catch(() => null);
				if (!r) continue;
				for (const field of r.fields) {
					for (const c of field.conflicts.filter((x) => x.reviewState === "unresolved" || x.reviewState === "disputed")) items.push({ kind: "conflict", title: `${r.firm.name}: ${c.summary}`, detail: c.reasons.join("; "), at: now(this.store), firmId: f.id, refs: { conflictId: c.id } });
					for (const cl of field.claims.filter((x) => x.lifecycle === "proposed" && x.claimRef.kind === "claim" && x.signals.category === "third_party_source").slice(0, 3)) items.push({ kind: "proposed_claim", title: `${r.firm.name}: ${cl.publisher} says ${field.field.replace(/_/g, " ")} ${cl.label}`, detail: cl.reasons.join("; "), at: cl.signals.capturedAt, firmId: f.id, refs: { claimKey: cl.key, claimId: cl.claimRef.id } });
				}
			}
		}
		if (has("contribution.read_shared")) {
			for (const c of await this.deps.participation.myClaims(actor)) {
				if (c.status !== "verified") continue;
				for (const s of await this.deps.participation.sharedWithFirm(actor, c.claim.canonicalDomain).catch(() => [])) if (!s.responses.length) items.push({ kind: "contribution_shared", title: `A ${s.category.replace(/_/g, " ")} about ${c.claim.firmName}`, detail: `${s.kind.replace(/_/g, " ")}${s.claim ? `: ${s.claim.field.replace(/_/g, " ")} ${s.claim.value}` : ""}`, at: s.sharedAt, refs: { chainId: s.chainId } });
			}
		}
		if (has("moderation.review")) {
			for (const p of await this.deps.participation.pendingClaims(actor)) items.push({ kind: "representative_claim", title: `Representative claim for ${p.claim.canonicalDomain}`, detail: `${p.claim.firmName}; proof ${p.proof ? (p.proof.proofOk ? "checked ok" : "failed") : "not checked"}`, at: p.claim.requestedAt, refs: { claimId: p.claim.id } });
			for (const s of await this.deps.participation.moderatorQueue(actor)) if (!s.responses.length) items.push({ kind: "contribution_shared", title: `Contribution about ${s.firmDomain} shared with moderators`, detail: s.kind.replace(/_/g, " "), at: s.sharedAt, refs: { chainId: s.chainId } });
		}
		if (has("contribution.write")) {
			for (const m of await this.deps.participation.mine(actor)) if (m.lifecycle === "disputed" || m.lifecycle === "rejected") items.push({ kind: "my_contribution_disputed", title: `Your contribution about ${m.contribution.firmDomain} was ${m.lifecycle}`, detail: m.responses[0]?.note ?? "", at: m.responses[0]?.at ?? m.contribution.createdAt, refs: { chainId: m.contribution.chainId } });
		}
		return items.sort((a, b) => b.at.localeCompare(a.at));
	}
}

const now = (store: InvestStore) => store.now();
export type { FieldReconciliation, ReconciledClaim };
