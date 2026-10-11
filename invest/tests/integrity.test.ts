import { afterEach, describe, expect, it } from "bun:test";
import type { AuditEvent } from "../domain/types.ts";
import type { ClaimEvent, PublishedProfile } from "../domain/collab.ts";
import { C } from "../store/store.ts";
import { FakeWeb, type FakeSites, meridianSite } from "../testing/fake-web.ts";
import { type Harness, createHarness } from "../testing/harness.ts";
import { as } from "../testing/roles.ts";

let h: Harness | undefined;
afterEach(async () => {
	await h?.close();
	h = undefined;
});
const WK = "/.well-known/attn-invest-claim.txt";
const REL = "Partner at Meridian Ventures; reachable at partners@meridian.vc.";
const WHY = "Domain proof succeeded; the partner is listed on the team page.";

async function make() {
	const sites: FakeSites = { "meridian.vc": meridianSite() };
	const web = new FakeWeb(sites);
	let now = new Date("2026-10-11T09:00:00Z");
	h = await createHarness({ fetcherFor: web.fetcherFor, clock: () => new Date(now) });
	return { svc: h.service, store: h.store, sites, tick: (ms = 1000) => (now = new Date(now.getTime() + ms)), rep: as("investor_rep", "ws-rep", "rita"), rep2: as("investor_rep", "ws-rep2", "ravi"), mod: as("moderator", "ws-mod", "mona"), mod2: as("moderator", "ws-mod2", "mira"), founder: as("founder", "ws-f", "fay") };
}
type Ctx = Awaited<ReturnType<typeof make>>;

/** A representative with a researched firm, a claim and a successful proof; nobody has decided yet. */
async function claimed(c: Ctx, who = c.rep) {
	const { firm } = await c.svc.research.reconcile(who, { url: "meridian.vc", name: "Meridian Ventures" });
	await c.svc.research.research(who, firm.id, { verify: false });
	const { claim } = await c.svc.participation.requestClaim(who, { domain: "meridian.vc", firmName: "Meridian Ventures", relationship: REL });
	c.sites["meridian.vc"]![WK] = { type: "text/plain", body: claim.challenge };
	await c.svc.participation.checkProof(who, claim.id);
	return { firm, claim };
}
const events = (c: Ctx, workspaceId: string, claimId: string) => c.store.list<ClaimEvent>(C.claimEvents, workspaceId, { claimId });
const audit = (c: Ctx, workspaceId: string, eventType: string) => c.store.list<AuditEvent>(C.audit, workspaceId, { eventType });
const decided = (list: ClaimEvent[]) => list.filter((e) => ["verified", "rejected", "revoked"].includes(e.kind));

describe("moderator decisions are atomic with their audit records", () => {
	it("a decision that cannot be made durable leaves no decision, no audit and no changed state; the retry then succeeds exactly once", async () => {
		const c = await make();
		const { claim } = await claimed(c);
		const db = (c.store as unknown as { db: { transaction: (x: unknown) => Promise<unknown> } }).db;
		const real = db.transaction.bind(db);
		db.transaction = async () => {
			throw new Error("disk full");
		};
		await expect(c.svc.participation.reviewClaim(c.mod, { claimId: claim.id, decision: "verify", rationale: WHY })).rejects.toThrow("disk full");
		db.transaction = real;
		expect(decided(await events(c, "ws-rep", claim.id))).toHaveLength(0);
		expect(await audit(c, "ws-rep", "claim.verified")).toHaveLength(0);
		expect(await audit(c, "ws-mod", "claim.verified")).toHaveLength(0);
		expect(await c.svc.participation.verifiedClaim(c.rep, "meridian.vc")).toBeNull();
		await c.svc.participation.reviewClaim(c.mod, { claimId: claim.id, decision: "verify", rationale: WHY });
		expect(decided(await events(c, "ws-rep", claim.id))).toHaveLength(1);
		expect(await audit(c, "ws-rep", "claim.verified")).toHaveLength(1);
		expect(await audit(c, "ws-mod", "claim.verified")).toHaveLength(1);
	});

	it("records actor, target, decision, reason, time and resulting state in both histories", async () => {
		const c = await make();
		const { claim } = await claimed(c);
		const ev = await c.svc.participation.reviewClaim(c.mod, { claimId: claim.id, decision: "verify", rationale: WHY });
		for (const ws of ["ws-rep", "ws-mod"]) {
			const [a] = await audit(c, ws, "claim.verified");
			expect(a).toMatchObject({ actorId: "mona", workspaceId: ws, entityRef: { type: "representative_claim", id: claim.id }, payload: { domain: "meridian.vc", principal: "rita", decisionId: ev.id, previousStatus: "requested", rationale: WHY } });
			expect(a!.timestamp).toBe(ev.at);
		}
		expect(await c.svc.participation.verifiedClaim(c.rep, "meridian.vc")).not.toBeNull();
	});

	it("a refused decision is not recorded as a success anywhere", async () => {
		const c = await make();
		const { claim } = await claimed(c);
		await expect(c.svc.participation.reviewClaim(c.mod, { claimId: claim.id, decision: "revoke", rationale: WHY })).rejects.toThrow("Only a verified claim");
		await expect(c.svc.participation.reviewClaim(c.mod, { claimId: claim.id, decision: "verify", rationale: "short" })).rejects.toThrow("rationale");
		await expect(c.svc.participation.reviewClaim(c.rep, { claimId: claim.id, decision: "verify", rationale: WHY })).rejects.toThrow("moderation.review");
		for (const t of ["claim.verified", "claim.revoked", "claim.rejected"]) {
			expect(await audit(c, "ws-rep", t)).toHaveLength(0);
			expect(await audit(c, "ws-mod", t)).toHaveLength(0);
		}
	});
});

describe("duplicate, concurrent and stale decisions", () => {
	it("a retry of the same decision returns the recorded one and writes nothing more", async () => {
		const c = await make();
		const { claim } = await claimed(c);
		const first = await c.svc.participation.reviewClaim(c.mod, { claimId: claim.id, decision: "verify", rationale: WHY });
		const again = await c.svc.participation.reviewClaim(c.mod, { claimId: claim.id, decision: "verify", rationale: WHY });
		expect(again.id).toBe(first.id);
		expect(decided(await events(c, "ws-rep", claim.id))).toHaveLength(1);
		expect(await audit(c, "ws-rep", "claim.verified")).toHaveLength(1);
		expect(await audit(c, "ws-mod", "claim.verified")).toHaveLength(1);
	});

	it("two moderators deciding at the same moment: exactly one decision is recorded, the other is told what happened", async () => {
		const c = await make();
		const { claim } = await claimed(c);
		const results = await Promise.allSettled([c.svc.participation.reviewClaim(c.mod, { claimId: claim.id, decision: "verify", rationale: WHY }), c.svc.participation.reviewClaim(c.mod2, { claimId: claim.id, decision: "verify", rationale: "A second moderator reviewed the same proof." })]);
		expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
		const loser = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
		expect(String(loser.reason.message)).toMatch(/already verified|same moment|changed/);
		expect(decided(await events(c, "ws-rep", claim.id))).toHaveLength(1);
		expect(await audit(c, "ws-rep", "claim.verified")).toHaveLength(1);
		const mirrored = (await audit(c, "ws-mod", "claim.verified")).length + (await audit(c, "ws-mod2", "claim.verified")).length;
		expect(mirrored).toBe(1);
	});

	it("a decision taken on a stale view is refused, and cannot overwrite the newer state", async () => {
		const c = await make();
		const { claim } = await claimed(c);
		await c.svc.participation.reviewClaim(c.mod, { claimId: claim.id, decision: "reject", rationale: "Could not confirm the relationship." });
		c.tick();
		await expect(c.svc.participation.reviewClaim(c.mod2, { claimId: claim.id, decision: "verify", rationale: WHY, expectedStatus: "requested" })).rejects.toThrow("changed since you opened it");
		expect(decided(await events(c, "ws-rep", claim.id)).map((e) => e.kind)).toEqual(["rejected"]);
		expect(await c.svc.participation.verifiedClaim(c.rep, "meridian.vc")).toBeNull();
	});
});

describe("revocation: what it does, what it does not, and re-verification", () => {
	async function published(c: Ctx) {
		const { firm, claim } = await claimed(c);
		await c.svc.participation.reviewClaim(c.mod, { claimId: claim.id, decision: "verify", rationale: WHY });
		const crit = (await c.svc.research.profile(c.rep, firm.id)).criteria.find((x) => x.field === "sector" && x.polarity === "include")!;
		const ap = await c.svc.participation.approve(c.rep, { firmId: firm.id, criterionId: crit.id, note: "Ours." });
		await c.svc.participation.publish(c.rep, { firmId: firm.id, approvalIds: [ap.id], note: "v1" });
		c.tick();
		return { firm, claim, ap };
	}

	it("the revoked representative loses every action that depends on verification, at once; history and approvals remain", async () => {
		const c = await make();
		const { firm, claim, ap } = await published(c);
		expect(await c.svc.participation.publishedFor("meridian.vc")).not.toBeNull();
		const ev = await c.svc.participation.reviewClaim(c.mod, { claimId: claim.id, decision: "revoke", rationale: "Left the firm; confirmed by the firm's general counsel." });
		expect(ev.effects).toMatchObject({ withdrawnPublishedVersion: 2, otherVerifiedRepresentatives: 0 });
		const forbidden = "Only a verified representative";
		await expect(c.svc.participation.approve(c.rep, { firmId: firm.id, field: "stage", value: "seed", note: "again" })).rejects.toThrow(forbidden);
		await expect(c.svc.participation.withdrawApproval(c.rep, { firmId: firm.id, approvalId: ap.id, note: "x" })).rejects.toThrow(forbidden);
		await expect(c.svc.participation.publish(c.rep, { firmId: firm.id, approvalIds: [ap.id] })).rejects.toThrow(forbidden);
		await expect(c.svc.participation.unpublish(c.rep, { firmId: firm.id, note: "x" })).rejects.toThrow(forbidden);
		await expect(c.svc.participation.sharedWithFirm(c.rep, "meridian.vc")).rejects.toThrow("verified representative");
		// the published profile is withdrawn; every version and its provenance is still on record
		expect(await c.svc.participation.publishedFor("meridian.vc")).toBeNull();
		const versions = (await c.store.list<PublishedProfile>(C.publishedProfiles, "ws-rep")).sort((a, b) => a.version - b.version);
		expect(versions.map((v) => [v.version, v.withdrawn, v.claimId])).toEqual([[1, false, claim.id], [2, true, claim.id]]);
		expect(versions[0]!.criteria).toHaveLength(1);
		expect(versions[1]).toMatchObject({ supersedesId: versions[0]!.id, publishedBy: "mona" });
		expect(currentApprovalsOf(await c.svc.research.approvalsFor(c.rep, firm.id))).toHaveLength(1);
		expect(await audit(c, "ws-rep", "profile.unpublished")).toHaveLength(1);
		expect(await audit(c, "ws-mod", "profile.unpublished")).toHaveLength(1);
		const all = await events(c, "ws-rep", claim.id);
		expect(all.map((e) => e.kind)).toEqual(expect.arrayContaining(["requested", "proof_checked", "verified", "revoked"]));
	});

	it("keepPublished leaves what was published visible, and says so", async () => {
		const c = await make();
		const { claim } = await published(c);
		const ev = await c.svc.participation.reviewClaim(c.mod, { claimId: claim.id, decision: "revoke", rationale: "Role changed; keep the profile until the firm decides.", keepPublished: true });
		expect(ev.effects!.withdrawnPublishedVersion).toBeNull();
		expect((await c.svc.participation.publishedFor("meridian.vc"))?.version).toBe(1);
	});

	it("revoking one representative does not touch another verified representative of the same firm", async () => {
		const c = await make();
		const { claim } = await published(c);
		const { firm: firm2, claim: claim2 } = await claimed(c, c.rep2);
		await c.svc.participation.reviewClaim(c.mod, { claimId: claim2.id, decision: "verify", rationale: "Evidence reviewed: confirmed by the firm's managing partner.", evidence: ["call with the managing partner, 2026-10-10"] });
		const ev = await c.svc.participation.reviewClaim(c.mod, { claimId: claim.id, decision: "revoke", rationale: "Left the firm; confirmed by general counsel." });
		expect(ev.effects!.otherVerifiedRepresentatives).toBe(1);
		expect(await c.svc.participation.verifiedClaim(c.rep, "meridian.vc")).toBeNull();
		expect(await c.svc.participation.verifiedClaim(c.rep2, "meridian.vc")).not.toBeNull();
		await c.svc.participation.approve(c.rep2, { firmId: firm2.id, field: "stage", value: "seed", note: "Ours." });
	});

	it("re-verification needs a proof checked after the revocation, or evidence", async () => {
		const c = await make();
		const { claim } = await published(c);
		await c.svc.participation.reviewClaim(c.mod, { claimId: claim.id, decision: "revoke", rationale: "Left the firm; confirmed by general counsel." });
		c.tick();
		await expect(c.svc.participation.reviewClaim(c.mod, { claimId: claim.id, decision: "verify", rationale: "Back at the firm after a leave of absence." })).rejects.toThrow("checked since the last decision");
		await c.svc.participation.checkProof(c.rep, claim.id);
		c.tick();
		await c.svc.participation.reviewClaim(c.mod, { claimId: claim.id, decision: "verify", rationale: "Back at the firm; proof checked again.", expectedStatus: "revoked" });
		expect(await c.svc.participation.verifiedClaim(c.rep, "meridian.vc")).not.toBeNull();
	});

	it("the moderator directory shows who is verified, on what basis, and what revoking would change; nobody else can read it", async () => {
		const c = await make();
		const { claim } = await published(c);
		const [d] = await c.svc.participation.claimDirectory(c.mod);
		expect(d).toMatchObject({ status: "verified", claim: { id: claim.id, canonicalDomain: "meridian.vc", principalId: "rita" }, published: { version: 1, withdrawn: false, publishedByThisClaim: true }, representativeApprovals: 1, otherVerifiedRepresentatives: 0 });
		expect(d!.lastProof).toMatchObject({ proofOk: true });
		expect(JSON.stringify(d)).not.toContain("attn-invest-claim:"); // the challenge is never listed
		for (const who of [c.rep, c.founder]) await expect(c.svc.participation.claimDirectory(who)).rejects.toThrow("moderation.review");
	});
});

const currentApprovalsOf = (a: { kind: string }[]) => a.filter((x) => x.kind === "approve");
