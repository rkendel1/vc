import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import type { AppPortError } from "@appport/sdk";
import { ROLE_PERMISSIONS } from "../auth/authboundry-adapter.ts";
import type { AuditEvent } from "../domain/types.ts";
import { emptyProfile } from "../modules/founder-profiles.ts";
import { C } from "../store/store.ts";
import { UnconfiguredJev } from "../jev/jev-client.ts";
import { FakeWeb, type FakeSites, meridianSite } from "../testing/fake-web.ts";
import { type HttpHarness, TOKENS, startHttpHarness } from "../testing/http-harness.ts";
import { type Harness, createHarness } from "../testing/harness.ts";
import { as } from "../testing/roles.ts";
import { activeFilters } from "../../apps/invest-web/src/rules.ts";
import { missingForMatching, validateDraft } from "../../apps/invest-web/src/rules.ts";
import { ageLabel, clip, formatDate, NOT_STATED, plural, sentence, term, usd, usdRange } from "../../apps/invest-web/src/format.ts";
import { AUDIENCE_LABEL, audienceOf, canOpen, currentItem, homePath, navFor } from "../../apps/invest-web/src/nav.ts";
import { AUTHORITY, CLAIM, COMPLETENESS, CONSTRAINT, EVIDENCE, FIT, FLAG, LIFECYCLE, READINESS, RESEARCH, SOURCE_CATEGORY, TONE_MARK, entry } from "../../apps/invest-web/src/vocab.ts";

const who = (role: keyof typeof ROLE_PERMISSIONS) => ({ role: role as string, permissions: ROLE_PERMISSIONS[role] as readonly string[] });

describe("formatting: currency, ranges, dates and missing values", () => {
	it("formats money at the right scale and never shows a raw number", () => {
		expect(usd(500_000)).toBe("$500K");
		expect(usd(2_500_000)).toBe("$2.5M");
		expect(usd(1_000_000_000)).toBe("$1B");
		expect(usd(950)).toBe("$950");
		expect(usd(null)).toBe("not stated");
		expect(usd(undefined)).toBe("not stated");
		expect(usd(Number.NaN)).toBe("not stated");
	});
	it("formats ranges, open ranges, single figures and missing ranges", () => {
		expect(usdRange({ minUsd: 1e6, maxUsd: 5e6 })).toBe("$1M–$5M");
		expect(usdRange({ minUsd: null, maxUsd: 5e6 })).toBe("up to $5M");
		expect(usdRange({ minUsd: 250_000, maxUsd: null })).toBe("from $250K");
		expect(usdRange({ minUsd: 5e5, maxUsd: 5e5 })).toBe("about $500K");
		expect(usdRange({ minUsd: null, maxUsd: null })).toBe("not stated");
		expect(usdRange(null)).toBe("not stated");
	});
	it("says a missing or invalid date is missing, never an epoch or a dash", () => {
		expect(formatDate(null)).toBe(NOT_STATED);
		expect(formatDate("")).toBe(NOT_STATED);
		expect(formatDate("not a date")).toBe(NOT_STATED);
		expect(formatDate("2026-10-11T09:30:00Z")).toMatch(/2026/);
		expect(formatDate("2026-10-11T09:30:00Z", { time: false })).not.toMatch(/:/);
		const now = Date.parse("2026-10-11T00:00:00Z");
		expect(ageLabel("2026-10-11T00:00:00Z", now)).toBe("today");
		expect(ageLabel("2026-10-10T00:00:00Z", now)).toBe("yesterday");
		expect(ageLabel("2026-09-01T00:00:00Z", now)).toBe("40 days ago");
		expect(ageLabel("2026-01-01T00:00:00Z", now)).toBe("9 months ago");
		expect(ageLabel(null, now)).toBe(NOT_STATED);
	});
	it("turns storage terms into words", () => {
		expect(term("check_size")).toBe("check size");
		expect(sentence("business_model")).toBe("Business model");
		expect(plural(1, "investor")).toBe("1 investor");
		expect(plural(2, "criterion", "criteria")).toBe("2 criteria");
		expect(clip("a".repeat(300), 20)).toHaveLength(20);
	});
});

describe("one vocabulary: every recurring state has words, an explanation and a tone", () => {
	const tables = { AUTHORITY, FIT, CONSTRAINT, COMPLETENESS, FLAG, READINESS, EVIDENCE, RESEARCH, CLAIM, LIFECYCLE };
	it("never shows a raw enum, and always explains itself", () => {
		for (const [name, table] of Object.entries(tables))
			for (const [key, e] of Object.entries(table)) {
				expect(e.label, `${name}.${key}`).not.toMatch(/_/);
				expect(e.label.length, `${name}.${key}`).toBeGreaterThan(2);
				expect(e.help.length, `${name}.${key}`).toBeGreaterThan(10);
				expect(TONE_MARK[e.tone], `${name}.${key}`).toBeTruthy();
			}
		expect(Object.values(SOURCE_CATEGORY).every((v) => !/_/.test(v))).toBe(true);
	});
	it("uses the agreed product wording and keeps distinct states distinct", () => {
		expect(AUTHORITY.investor_approved!.label).toBe("Approved by the firm");
		expect(AUTHORITY.third_party!.label).toBe("External source");
		expect(FIT.eliminated!.label).not.toBe(FIT.possible_mismatch!.label);
		expect(FIT.unknown!.tone).toBe("unknown");
		expect(RESEARCH.no_thesis_found!.label).not.toBe(RESEARCH.research_incomplete!.label);
		expect(RESEARCH.no_thesis_found!.help).toContain("does not mean");
		expect(READINESS.evidence_not_provided!.label).not.toBe(READINESS.not_met!.label);
		expect(READINESS.evidence_not_provided!.help).toContain("not a failed requirement");
		expect(new Set(["unknown", "stale", "disputed", "rejected"].map((k) => (k === "stale" ? FLAG.stale!.label : k === "unknown" ? FIT.unknown!.label : LIFECYCLE[k]!.label))).size).toBe(4);
		expect(CLAIM.requested!.label).not.toBe(CLAIM.verified!.label);
		expect(entry({}, "some_new_state").label).toBe("some new state");
	});
});

describe("role-aware navigation and route access", () => {
	const roles = Object.keys(ROLE_PERMISSIONS) as (keyof typeof ROLE_PERMISSIONS)[];
	it("classifies every role, and gives each a landing page it may open", () => {
		expect(roles.map((r) => audienceOf(who(r)))).toEqual(["fund", "fund", "fund", "founder", "representative", "moderator"]);
		for (const r of roles) expect(canOpen(who(r), homePath(who(r)).split("/").filter(Boolean)), `${r} lands on a page it may open`).toBe(true);
		for (const a of ["founder", "representative", "moderator", "fund"] as const) expect(AUDIENCE_LABEL[a].length).toBeGreaterThan(3);
	});
	it("every navigation item leads somewhere the person may open", () => {
		for (const r of roles) {
			const nav = navFor(who(r), { startupId: "su_1" });
			for (const item of [...nav.main, ...nav.operations]) expect(canOpen(who(r), item.path.split("/").filter(Boolean)), `${r}: ${item.label}`).toBe(true);
			const labels = [...nav.main, ...nav.operations].map((i) => i.label);
			expect(new Set(labels).size, `${r} has no duplicate items`).toBe(labels.length);
		}
	});
	it("shows each role only its own journey", () => {
		const labels = (r: keyof typeof ROLE_PERMISSIONS) => navFor(who(r), { startupId: "su_1" }).main.map((i) => i.label);
		expect(labels("founder")).toEqual(["Startup", "Find investors", "Shortlist", "Your notes"]);
		expect(labels("investor_rep")).toEqual(["My firm", "History"]);
		expect(labels("moderator")).toEqual(["Review queue", "History"]);
		expect(labels("partner")).toEqual(["Overview", "Theses", "Startups", "Investor research", "History"]);
		expect(labels("viewer")).toContain("Overview");
		expect(navFor(who("founder")).operations).toEqual([]);
		expect(navFor(who("investor_rep")).operations).toEqual([]);
		expect(navFor(who("viewer")).operations).toEqual([]);
		expect(navFor(who("partner")).operations.map((i) => i.label)).toEqual(["Research sources", "Monitoring", "System health"]);
		expect(navFor(who("moderator")).operations.map((i) => i.label)).toEqual(["Research sources", "System health"]); // no monitoring without research.run
	});
	it("restricted routes are closed to the wrong roles", () => {
		const open = (r: keyof typeof ROLE_PERMISSIONS, route: string) => canOpen(who(r), route.split("/").filter(Boolean));
		expect(open("founder", "review")).toBe(false);
		expect(open("founder", "operations/sources")).toBe(false);
		expect(open("founder", "theses")).toBe(false);
		expect(open("founder", "investors")).toBe(false);
		expect(open("founder", "history")).toBe(false);
		expect(open("investor_rep", "review")).toBe(false);
		expect(open("investor_rep", "operations/sources")).toBe(false);
		expect(open("investor_rep", "founder")).toBe(false);
		expect(open("moderator", "theses")).toBe(false);
		expect(open("moderator", "founder")).toBe(false);
		expect(open("partner", "founder")).toBe(false);
		expect(open("partner", "review")).toBe(false);
		expect(open("viewer", "operations/sources")).toBe(false);
		expect(open("viewer", "firm")).toBe(false);
		expect(open("analyst", "operations/monitoring")).toBe(true);
		expect(open("moderator", "operations/monitoring")).toBe(false);
		expect(open("partner", "nonsense")).toBe(false);
	});
	it("marks the right item current, including the founder's step", () => {
		const items = navFor(who("founder"), { startupId: "su_1" }).main;
		expect(currentItem(items, ["founder", "su_1", "investors"])).toBe("Find investors");
		expect(currentItem(items, ["founder", "su_1", "shortlist"])).toBe("Shortlist");
		expect(currentItem(items, ["founder", "su_1"])).toBe("Startup");
		expect(currentItem(items, ["notes"])).toBe("Your notes");
		const fund = navFor(who("partner")).main;
		expect(currentItem(fund, [])).toBe("Overview");
		expect(currentItem(fund, ["evaluations", "ev_1"])).toBe("Overview");
		expect(currentItem(fund, ["investors", "fi_1"])).toBe("Investor research");
	});
});

describe("founder profile: inline validation keeps the person's data and explains what to fix", () => {
	const prov = { basis: "founder_assertion" as const, evidenceIds: [], sourceUrl: null };
	it("accepts an all-unknown profile: unknown is a complete answer", () => {
		expect(validateDraft(emptyProfile())).toEqual({});
	});
	it("names each problem next to its field", () => {
		const d = { ...emptyProfile(), sectors: { state: "provided" as const, value: [], provenance: prov }, targetRaise: { state: "provided" as const, value: { minUsd: 5, maxUsd: 1 }, provenance: prov }, metrics: { gross_margin_pct: { state: "provided" as const, value: 140, provenance: prov }, customers: { state: "provided" as const, value: -1, provenance: prov } }, investorExclusions: ["not a domain"] };
		const e = validateDraft(d);
		expect(e.sectors).toContain("at least one sector");
		expect(e.targetRaise).toContain("minimum is above");
		expect(e["metrics.gross_margin_pct"]).toContain("100%");
		expect(e["metrics.customers"]).toContain("negative");
		expect(e.investorExclusions).toContain("not a website domain");
	});
	it("says what is still needed to compare with investors", () => {
		expect(missingForMatching(emptyProfile())).toEqual(["stage", "sector", "location or target markets", "target raise"]);
		const ready = { ...emptyProfile(), currentStage: { state: "provided" as const, value: "seed", provenance: prov }, sectors: { state: "provided" as const, value: ["fintech"], provenance: prov }, headquarters: { state: "provided" as const, value: "europe", provenance: prov }, targetRaise: { state: "provided" as const, value: { minUsd: 1, maxUsd: 2 }, provenance: prov } };
		expect(missingForMatching(ready)).toEqual([]);
	});
});

describe("candidate filters are shown in words and can be removed one at a time", () => {
	it("describes every active filter", () => {
		const f = { stage: ["seed"], sector: [], geography: ["north_america"], businessModel: [], minUsd: "500000", maxUsd: "2000000", approvedOnly: true, freshOnly: false, unknown: false, includeFounderExcluded: false, query: "alp" };
		const a = activeFilters(f);
		expect(a.map((x) => x.label)).toEqual(["Stage: seed", "Geography: north america", "Cheque size from $500,000 to $2,000,000", "Approved by the firm only", "Hiding investors with unknown criteria", 'Name contains "alp"']);
		expect(activeFilters({ ...f, stage: [], geography: [], minUsd: "", maxUsd: "", approvedOnly: false, unknown: true, query: "" })).toEqual([]);
	});
});

// ---------------------------------------------------------------------------------------------------------------- server behaviour behind the cleanup

let h: Harness | undefined;
afterEach(async () => {
	await h?.close();
	h = undefined;
});
const WK = "/.well-known/attn-invest-claim.txt";

describe("a representative's claim also adds the firm, once", () => {
	let http: HttpHarness;
	const sites: FakeSites = { "meridian.vc": meridianSite() };
	const web = new FakeWeb(sites);
	beforeAll(async () => {
		http = await startHttpHarness({ jev: new UnconfiguredJev(), fetcherFor: web.fetcherFor, fetcherForSource: web.fetcherForSource });
	});
	afterAll(async () => http?.close());
	const call = async <T,>(token: string, name: string, input: unknown): Promise<T> => {
		const c = http.client(token);
		await c.connect();
		try {
			return await c.call<T>(name, input as never);
		} finally {
			await c.close();
		}
	};
	const code = (p: Promise<unknown>) => p.then(() => "OK", (e: AppPortError) => e.code);
	type Any = Record<string, any>; // eslint-disable-line

	it("registers the firm in the representative's workspace, starts research, and is idempotent", async () => {
		const REL = "Partner at Meridian Ventures; reachable at partners@meridian.vc.";
		const first = await call<Any>(TOKENS.rRep, "profile.claim.request", { domain: "https://www.meridian.vc/about", firmName: "Meridian Ventures", relationship: REL });
		expect(first.firmId).toMatch(/^firm_/);
		await http.runtime.service.research.settled();
		const firms = (await call<{ items: Any[] }>(TOKENS.rRep, "firm.list", {})).items;
		expect(firms.map((f) => f.canonicalDomain)).toEqual(["meridian.vc"]);
		expect(firms[0].researchStatus).toBe("thesis_found");
		const runs = await http.runtime.store.list(C.researchRuns, "ws-rep");
		const again = await call<Any>(TOKENS.rRep, "profile.claim.request", { domain: "meridian.vc", firmName: "Meridian Ventures", relationship: REL });
		await http.runtime.service.research.settled();
		expect(again.firmId).toBe(first.firmId);
		expect((await http.runtime.store.list(C.researchRuns, "ws-rep")).length).toBe(runs.length);
		// another workspace gains nothing: no firm record, no research
		expect((await call<{ items: Any[] }>(TOKENS.bPartner, "firm.list", {})).items).toEqual([]);
		expect(await code(call(TOKENS.fFounder, "profile.claim.request", { domain: "meridian.vc", firmName: "Meridian Ventures", relationship: REL }))).toBe("FORBIDDEN");
	}, 30_000);

	it("a moderator's decision is recorded under the moderator's own name in their own history, and the claimant's", async () => {
		const REL = "Partner at Meridian Ventures; reachable at partners@meridian.vc.";
		const req = await call<Any>(TOKENS.rRep, "profile.claim.request", { domain: "meridian.vc", firmName: "Meridian Ventures", relationship: REL });
		sites["meridian.vc"]![WK] = { type: "text/plain", body: req.claim.challenge };
		await call(TOKENS.rRep, "profile.claim.check", { claimId: req.claim.id });
		await call(TOKENS.mModerator, "claim.review", { claimId: req.claim.id, decision: "verify", rationale: "Domain proof succeeded; partner listed on the team page." });
		const mine = (await call<{ items: AuditEvent[] }>(TOKENS.mModerator, "audit.list", {})).items.filter((e) => e.eventType === "moderation.claim_decided");
		expect(mine).toHaveLength(1);
		expect(mine[0]).toMatchObject({ actorId: "mona", payload: { decision: "verified", domain: "meridian.vc" } });
		const theirs = (await call<{ items: AuditEvent[] }>(TOKENS.rRep, "audit.list", {})).items.filter((e) => e.eventType === "claim.verified");
		expect(theirs[0]).toMatchObject({ actorId: "mona" });
		// a founder cannot read either trail
		expect(await code(call(TOKENS.fFounder, "audit.list", {}))).toBe("FORBIDDEN");
	}, 30_000);
});

describe("roles: a founder cannot self-verify evidence", () => {
	it("holds no evidence.write, so reviewer-verified evidence cannot be attached by the person it would flatter", () => {
		expect(ROLE_PERMISSIONS.founder).not.toContain("evidence.write");
		expect(ROLE_PERMISSIONS.founder).toEqual(expect.arrayContaining(["startup.write", "document.write", "evaluation.run"]));
	});
});

describe("how many independent publishers: the firm's own site and its representative are one", () => {
	it("a firm that publishes its own criteria is not counted as corroborating itself", async () => {
		const sites: FakeSites = { "meridian.vc": meridianSite() };
		const web = new FakeWeb(sites);
		h = await createHarness({ fetcherFor: web.fetcherFor });
		const svc = h.service;
		const rep = as("investor_rep", "ws-rep", "rita");
		const mod = as("moderator", "ws-mod", "mona");
		const { firm } = await svc.research.reconcile(rep, { url: "meridian.vc", name: "Meridian Ventures" });
		await svc.research.research(rep, firm.id, { verify: false });
		const { claim } = await svc.participation.requestClaim(rep, { domain: "meridian.vc", firmName: "Meridian Ventures", relationship: "Partner at Meridian Ventures; reachable at partners@meridian.vc." });
		sites["meridian.vc"]![WK] = { type: "text/plain", body: claim.challenge };
		await svc.participation.checkProof(rep, claim.id);
		await svc.participation.reviewClaim(mod, { claimId: claim.id, decision: "verify", rationale: "Domain proof succeeded; partner is on the team page." });
		const crit = (await svc.research.profile(rep, firm.id)).criteria.find((c) => c.field === "sector" && c.polarity === "include")!;
		const ap = await svc.participation.approve(rep, { firmId: firm.id, criterionId: crit.id, note: "Ours." });
		await svc.participation.publish(rep, { firmId: firm.id, approvalIds: [ap.id], note: "v1" });
		const rec = await svc.reconciliation.forFirm(rep, firm.id);
		const sector = rec.fields.find((f) => f.field === "sector")!;
		const same = sector.claims.filter((c) => c.value === crit.value && c.signals.assertionType === "explicit");
		expect(same.length).toBeGreaterThanOrEqual(2); // the site's statement and the published one
		expect(same.every((c) => c.signals.corroboratedBy === 1)).toBe(true);
		expect(sector.status).not.toBe("agreed");
		expect(sector.status).toBe("single_source");
		expect(sector.explanation.join()).toContain("not independently corroborated");
	}, 30_000);
});

describe("conflicts: settled by an approved value, or still open", () => {
	it("a disagreement with an approved value is listed as resolved, and an unrelated disagreement stays open", async () => {
		const { reconcile } = await import("../research/reconcile.ts");
		const base = { polarity: "include" as const, valueRange: null, assertionType: "explicit" as const, passage: "p", url: null, publishedAt: null, capturedAt: "2026-10-01T00:00:00.000Z", lifecycle: "proposed" as const, supersededBy: null };
		const size = (id: string, publisher: string, lo: number, hi: number) => ({ ...base, ref: { kind: "claim" as const, id }, field: "check_size" as const, value: `${lo}-${hi}`, valueRange: { minUsd: lo, maxUsd: hi }, label: `${lo}-${hi}`, category: "third_party_source" as const, publisher });
		const approved = [{ id: "ap1", field: "check_size" as const, polarity: "include" as const, value: "1-2", valueRange: { minUsd: 1e6, maxUsd: 2e6 }, authority: "firm_representative" as const }];
		const now = "2026-10-11T00:00:00.000Z";
		const settledOnly = reconcile({ claims: [size("a", "A", 10e6, 20e6)], approvals: approved, now, staleAfterDays: 180 })[0]!;
		expect(settledOnly.conflicts).toHaveLength(1);
		expect(settledOnly.conflicts[0]!.resolution).toBe("approved_value_stands");
		expect(settledOnly.status).not.toBe("conflicted");
		expect(settledOnly.explanation.join()).toContain("disagrees with the approved value");
		const mixed = reconcile({ claims: [size("a", "A", 10e6, 20e6), size("b", "B", 100_000, 200_000), size("c", "C", 5e6, 9e6)], approvals: approved, now, staleAfterDays: 180 })[0]!;
		expect(mixed.conflicts.filter((c) => !c.resolution).every((c) => c.kind === "check_size_differs")).toBe(true);
		expect(mixed.status).toBe("conflicted");
		const none = reconcile({ claims: [size("a", "A", 1e6, 2e6)], approvals: [], now, staleAfterDays: 180 })[0]!;
		expect(none.conflicts).toEqual([]);
	});
});

describe("candidate discovery says where investors come from", () => {
	it("counts published and researched investors apart, so the list is never presented as the market", async () => {
		const sites: FakeSites = { "meridian.vc": meridianSite() };
		const web = new FakeWeb(sites);
		h = await createHarness({ fetcherFor: web.fetcherFor });
		const svc = h.service;
		const f = as("founder", "ws-f", "fay");
		const s = await svc.startups.create(f, { name: "Acme" });
		await svc.profiles.save(f, { startupId: s.id, expectedVersion: 0, content: { ...emptyProfile(), sectors: { state: "provided", value: ["fintech"], basis: "founder_assertion" } } });
		expect((await svc.matching.discover(f, { startupId: s.id })).universe).toEqual({ published: 0, researched: 0 });
		const partner = as("partner", "ws-b", "paula");
		await svc.research.reconcile(partner, { url: "meridian.vc", name: "Meridian Ventures" });
		const p = await svc.startups.create(partner, { name: "Acme" });
		await svc.profiles.save(partner, { startupId: p.id, expectedVersion: 0, content: { ...emptyProfile(), sectors: { state: "provided", value: ["fintech"], basis: "founder_assertion" } } });
		expect((await svc.matching.discover(partner, { startupId: p.id })).universe).toEqual({ published: 0, researched: 1 });
	});
});
