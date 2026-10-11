import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { AppPortError } from "@appport/sdk";
import { UnconfiguredJev } from "../jev/jev-client.ts";
import { type FakeSites, csvFile, DIRECTORY_CSV, FUNDING_FEED, meridianSite } from "../testing/fake-web.ts";
import { FakeWeb } from "../testing/fake-web.ts";
import { actor } from "../testing/harness.ts";
import { type HttpHarness, TOKENS, startHttpHarness } from "../testing/http-harness.ts";

let h: HttpHarness;
let web: FakeWeb;
const sites: FakeSites = { "meridian.vc": meridianSite(), "directory.example.com": { "/robots.txt": { status: 404 }, "/investors.csv": csvFile(DIRECTORY_CSV) }, "fundingnews.example.com": { "/robots.txt": { status: 404 }, "/feed.xml": FUNDING_FEED() } };

async function call<T>(token: string | undefined, name: string, input: unknown): Promise<T> {
	const client = h.client(token);
	await client.connect();
	try {
		return await client.call<T>(name, input as never);
	} finally {
		await client.close();
	}
}
const code = (p: Promise<unknown>) => p.then(() => "OK", (e: AppPortError) => e.code);
type Any = Record<string, any>; // eslint-disable-line

beforeAll(async () => {
	web = new FakeWeb(sites);
	h = await startHttpHarness({ jev: new UnconfiguredJev(), fetcherFor: web.fetcherFor, fetcherForSource: web.fetcherForSource });
});
afterAll(async () => h?.close());

const SRC = { name: "Example Directory", canonicalUrl: "https://directory.example.com/investors.csv", publisher: "Example Directory", sourceType: "directory", adapter: "csv_dataset", accessBasis: "licensed_dataset", termsNote: "Dataset licence permits automated retrieval; see the licence page.", mapping: { idField: "id", nameField: "name", websiteField: "website", stageField: "stage", sectorsField: "sectors", checkMinField: "min_k", checkMaxField: "max_k", checkUnit: "thousands", listDelimiter: ";" } };
const REL = "Partner at Meridian Ventures; reachable at partners@meridian.vc.";

describe("curated sources over AppPort", () => {
	it("registers, runs and reads a source with the right permissions, and keeps it inside the workspace", async () => {
		expect(await code(call(TOKENS.aViewer, "source.register", SRC))).toBe("FORBIDDEN");
		expect(await code(call(TOKENS.fFounder, "source.register", SRC))).toBe("FORBIDDEN");
		const reg = await call<Any>(TOKENS.aAnalyst, "source.register", SRC);
		expect(reg.created).toBe(true);
		const id = reg.source.id as string;
		expect(await code(call(TOKENS.aAnalyst, "source.register", { ...SRC, accessBasis: "whatever" }))).toBe("INVALID_INPUT");
		expect(await code(call(TOKENS.aAnalyst, "source.register", { ...SRC, canonicalUrl: "http://127.0.0.1/x.csv", name: "Loopback" }))).toBe("INVALID_INPUT");
		expect(await code(call(TOKENS.aAnalyst, "source.refresh", { sourceId: id, url: "http://127.0.0.1" }))).toBe("INVALID_INPUT"); // an id only, never a URL
		await call(TOKENS.aAnalyst, "source.refresh", { sourceId: id });
		await h.runtime.service.sources.settled();
		const detail = (await call<Any>(TOKENS.aViewer, "source.get", { sourceId: id })).detail;
		expect(detail.lastRun).toMatchObject({ success: true, counts: { records: 4 } });
		expect(detail.target).toMatchObject({ kind: "source", enabled: true });
		expect((await call<Any>(TOKENS.aViewer, "source.records", { sourceId: id })).items.length).toBe(4);
		expect((await call<Any>(TOKENS.aViewer, "source.list", {})).items[0].lastSuccessfulRun).not.toBeNull();
		for (const [name, input] of [["source.get", { sourceId: id }], ["source.records", { sourceId: id }], ["source.refresh", { sourceId: id }], ["source.monitoring.set", { sourceId: id, enabled: false }], ["source.update", { sourceId: id, name: "x" }]] as const) expect(`${name}:${await code(call(TOKENS.bPartner, name, input))}`).toBe(`${name}:NOT_FOUND`);
		expect((await call<Any>(TOKENS.bPartner, "source.list", {})).items).toEqual([]);
		const paused = await call<Any>(TOKENS.aAnalyst, "source.monitoring.set", { sourceId: id, enabled: false });
		expect(paused.target).toMatchObject({ enabled: false, nextCheckAt: null });
		expect(await code(call(TOKENS.aViewer, "source.monitoring.set", { sourceId: id, enabled: true }))).toBe("FORBIDDEN");
	});

	it("exposes matches to reviewers and records decisions, with permission and isolation", async () => {
		const svc = h.runtime.service;
		await svc.monitoring; // wired
		const { firm } = await svc.research.reconcile(actor("ws-a"), { url: "meridian.vc" });
		await svc.research.research(actor("ws-a"), firm.id, { verify: false });
		const feed = await call<Any>(TOKENS.aAnalyst, "source.register", { name: "Funding News", canonicalUrl: "https://fundingnews.example.com/feed.xml", publisher: "Funding News", sourceType: "funding_news", adapter: "funding_news_feed", accessBasis: "public_feed", termsNote: "Public RSS feed; terms allow personal and automated reading of the feed." });
		await call(TOKENS.aAnalyst, "source.refresh", { sourceId: feed.source.id });
		await svc.sources.settled();
		const m = await call<Any>(TOKENS.aViewer, "match.list", {});
		const open = m.open.find((o: Any) => o.match.subjectName === "Meridian Ventures");
		expect(open.match.status).toBe("candidate_match");
		const decide = { matchId: open.match.id, decision: "confirm", entityType: "firm", entityId: firm.id, rationale: "The article links to meridian.vc." };
		expect(await code(call(TOKENS.aViewer, "match.decide", decide))).toBe("FORBIDDEN");
		expect(await code(call(TOKENS.bPartner, "match.decide", decide))).toBe("NOT_FOUND");
		expect(await code(call(TOKENS.aAnalyst, "match.decide", { ...decide, entityId: "firm_other" }))).toBe("INVALID_INPUT");
		await call(TOKENS.aAnalyst, "match.decide", decide);
		expect((await call<Any>(TOKENS.aViewer, "match.list", {})).history[0]).toMatchObject({ decision: "confirm", decidedBy: "arun" });
		expect((await call<Any>(TOKENS.bPartner, "match.list", {})).history).toEqual([]);
		const rec = (await call<Any>(TOKENS.aViewer, "firm.reconciliation", { firmId: firm.id })).reconciliation;
		expect(JSON.stringify(rec)).not.toMatch(/confidence|"score"/i);
		expect(rec.fields.some((f: Any) => f.claims.some((c: Any) => c.signals.category === "third_party_source"))).toBe(false); // the feed has events, not criteria
		expect(await code(call(TOKENS.bPartner, "firm.reconciliation", { firmId: firm.id }))).toBe("NOT_FOUND");
		const claimReview = await code(call(TOKENS.aAnalyst, "firm.review", { firmId: firm.id, claimId: "cl_missing", action: "confirm", note: "x" }));
		expect(claimReview).toBe("NOT_FOUND");
	});
});

describe("participation over AppPort", () => {
	it("runs claim → proof → moderator verification → approval → publication across workspaces with each role's permissions", async () => {
		const svc = h.runtime.service;
		const rep = actor("ws-rep", "rita", ["invest.read", "research.run"]);
		const { firm } = await svc.research.reconcile(rep, { url: "meridian.vc", name: "Meridian Ventures" });
		await svc.research.research(rep, firm.id, { verify: false });
		// permissions by role
		expect(await code(call(TOKENS.aAnalyst, "profile.claim.request", { domain: "meridian.vc", firmName: "Meridian Ventures", relationship: REL }))).toBe("FORBIDDEN"); // a fund analyst is not a representative
		expect(await code(call(TOKENS.fFounder, "profile.claim.request", { domain: "meridian.vc", firmName: "Meridian Ventures", relationship: REL }))).toBe("FORBIDDEN");
		const req = await call<Any>(TOKENS.rRep, "profile.claim.request", { domain: "meridian.vc", firmName: "Meridian Ventures", relationship: REL });
		expect(req.status).toBe("requested");
		const claimId = req.claim.id as string;
		expect(await code(call(TOKENS.rRep, "profile.approve", { firmId: firm.id, field: "stage", value: "seed", note: "ours" }))).toBe("FORBIDDEN"); // not yet verified
		expect(await code(call(TOKENS.rRep, "claim.pending", {}))).toBe("FORBIDDEN");
		expect(await code(call(TOKENS.aPartner, "claim.pending", {}))).toBe("FORBIDDEN"); // a fund partner is not a platform moderator
		expect(await code(call(TOKENS.aPartner, "claim.review", { claimId, decision: "verify", rationale: "I verify this myself.", evidence: ["me"] }))).toBe("FORBIDDEN");
		expect(await code(call(TOKENS.rRep, "claim.review", { claimId, decision: "verify", rationale: "I verify this myself.", evidence: ["me"] }))).toBe("FORBIDDEN");
		sites["meridian.vc"]!["/.well-known/attn-invest-claim.txt"] = { type: "text/plain", body: req.claim.challenge };
		expect((await call<Any>(TOKENS.rRep, "profile.claim.check", { claimId })).event.data.proofOk).toBe(true);
		const pending = (await call<Any>(TOKENS.mModerator, "claim.pending", {})).items;
		expect(pending).toHaveLength(1);
		expect(JSON.stringify(pending)).not.toContain(req.claim.challenge);
		await call(TOKENS.mModerator, "claim.review", { claimId, decision: "verify", rationale: "Domain proof succeeded; partner listed on the firm's team page." });
		expect((await call<Any>(TOKENS.rRep, "profile.claim.mine", {})).items[0].status).toBe("verified");
		// approve and publish
		const ap = await call<Any>(TOKENS.rRep, "profile.approve", { firmId: firm.id, field: "check_size", minUsd: 750000, maxUsd: 3000000, note: "Our range." });
		expect(ap.approval.authority).toBe("firm_representative");
		expect(await code(call(TOKENS.rRep, "profile.approve", { firmId: firm.id, field: "check_size", minUsd: 750000, maxUsd: 3000000, note: "again" }))).toBe("CONFLICT");
		expect(await code(call(TOKENS.aAnalyst, "profile.publish", { firmId: firm.id, approvalIds: [ap.approval.id] }))).toBe("FORBIDDEN");
		expect(await code(call(TOKENS.bPartner, "profile.publish", { firmId: firm.id, approvalIds: [ap.approval.id] }))).toBe("NOT_FOUND"); // another workspace's firm id does not exist for a fund partner
		const pub = await call<Any>(TOKENS.rRep, "profile.publish", { firmId: firm.id, approvalIds: [ap.approval.id], note: "v1" });
		expect(pub.profile).toMatchObject({ version: 1, canonicalDomain: "meridian.vc" });
		// every workspace reads the published layer, but not the approvals
		expect((await call<Any>(TOKENS.bPartner, "directory.list", {})).items).toHaveLength(1);
		expect((await call<Any>(TOKENS.fFounder, "directory.get", { domain: "https://www.meridian.vc" })).profile.criteria[0]).toMatchObject({ field: "check_size" });
		expect(await code(call(TOKENS.bPartner, "profile.history", { firmId: firm.id }))).toBe("NOT_FOUND");
		const hist = (await call<Any>(TOKENS.rRep, "profile.history", { firmId: firm.id })).items;
		expect(hist.map((x: Any) => x.kind)).toEqual(expect.arrayContaining(["approved", "published", "claim_verified"]));
		expect(await code(call(TOKENS.mModerator, "profile.history", { firmId: firm.id }))).toBe("NOT_FOUND"); // moderation does not grant reading a workspace's profile
		await call(TOKENS.mModerator, "claim.review", { claimId, decision: "revoke", rationale: "Representative left the firm." });
		expect(await code(call(TOKENS.rRep, "profile.unpublish", { firmId: firm.id, note: "x" }))).toBe("FORBIDDEN");
		// audit: the moderator's decisions are in the claimant's workspace trail
		const audit = await call<Any>(TOKENS.rRep, "audit.list", { limit: 500 });
		expect(audit.items.some((e: Any) => e.eventType === "claim.verified" && e.actorId === "mona")).toBe(true); // the moderator's decision is in the claimant's own trail
		expect(audit.items.some((e: Any) => e.eventType === "claim.revoked" && e.actorId === "mona")).toBe(true);
		expect((await call<Any>(TOKENS.aPartner, "audit.list", { limit: 500 })).items.some((e: Any) => /^(claim|profile)\./.test(e.eventType))).toBe(false); // and nowhere else
	});

	it("keeps founder contributions private, shares by consent, and shows the author a dispute without deleting anything", async () => {
		const correction = { kind: "correction", firmDomain: "meridian.vc", field: "check_size", minUsd: 100000, maxUsd: 400000, text: "Their partner said cheques are $100–400K." };
		const created = await call<Any>(TOKENS.fFounder, "contribution.create", correction);
		const chainId = created.contribution.chainId as string;
		expect(await code(call(TOKENS.aViewer, "contribution.create", correction))).toBe("FORBIDDEN");
		expect(await code(call(TOKENS.fFounder, "contribution.create", { ...correction, evidenceUrls: ["http://not-https.example.com"] }))).toBe("INVALID_INPUT");
		expect((await call<Any>(TOKENS.f2Founder, "contribution.mine", {})).items).toEqual([]);
		expect((await call<Any>(TOKENS.aAnalyst, "contribution.mine", {})).items).toEqual([]);
		expect(await code(call(TOKENS.f2Founder, "contribution.share", { chainId, audience: { kind: "moderator" } }))).toBe("NOT_FOUND");
		expect(await code(call(TOKENS.fFounder, "contribution.share", { chainId, audience: { kind: "firm", domain: "meridian.vc" } }))).toBe("OK"); // share first; the rep's claim was revoked above
		expect(await code(call(TOKENS.rRep, "contribution.shared", { domain: "meridian.vc" }))).toBe("FORBIDDEN"); // revoked: no authority to read it
		expect(await code(call(TOKENS.rRep, "contribution.respond", { chainId, action: "dispute", note: "Out of date.", as: "firm_representative" }))).toBe("FORBIDDEN");
		await call(TOKENS.fFounder, "contribution.share", { chainId, audience: { kind: "moderator" }, aggregateConsent: false });
		expect((await call<Any>(TOKENS.mModerator, "contribution.queue", {})).items).toHaveLength(1);
		expect(await code(call(TOKENS.fFounder, "contribution.queue", {}))).toBe("FORBIDDEN");
		await call(TOKENS.mModerator, "contribution.respond", { chainId, action: "dispute", note: "Cannot be corroborated by a second source.", as: "moderator" });
		const mine = (await call<Any>(TOKENS.fFounder, "contribution.mine", {})).items[0];
		expect(mine).toMatchObject({ lifecycle: "disputed", visibility: "shared" });
		expect(mine.contribution.text).toBe(correction.text);
		await call(TOKENS.fFounder, "contribution.revoke", { chainId, audience: { kind: "moderator" } });
		expect((await call<Any>(TOKENS.mModerator, "contribution.queue", {})).items).toEqual([]);
		const inbox = (await call<Any>(TOKENS.fFounder, "inbox.list", {})).items;
		expect(inbox.some((i: Any) => i.kind === "my_contribution_disputed")).toBe(true);
		expect((await call<Any>(TOKENS.mModerator, "inbox.list", {})).items.every((i: Any) => i.kind !== "my_contribution_disputed")).toBe(true);
	});

	it("never accepts a workspace id, a URL or a path on the new capabilities", async () => {
		const c = h.client(TOKENS.aViewer);
		await c.connect();
		const manifest = await c.load();
		await c.close();
		const caps = (manifest.capabilities as unknown as { name: string; inputSchema: unknown; authorization: string[] }[]).filter((x) => /^(source|match|profile|claim|contribution|directory|inbox)\./.test(x.name) || x.name === "firm.reconciliation");
		expect(caps.length).toBeGreaterThanOrEqual(30);
		for (const cap of caps) {
			expect(`${cap.name}:${cap.authorization.length > 0}`).toBe(`${cap.name}:true`);
			expect(JSON.stringify(cap.inputSchema).replace(/"canonicalUrl"|"evidenceUrls"|"extraHosts"/g, "")).not.toMatch(/workspaceId|tenantId|"url"|"path"|"filePath"/);
		}
	});
});
