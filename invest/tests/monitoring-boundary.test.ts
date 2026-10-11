import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { AppPortError } from "@appport/sdk";
import type { AttentionItem, MonitoringTarget, TimelineItem } from "../domain/research.ts";
import type { FirmProfile } from "../domain/research.ts";
import { UnconfiguredJev } from "../jev/jev-client.ts";
import { FakeWeb, html, meridianSite, rss } from "../testing/fake-web.ts";
import { actor } from "../testing/harness.ts";
import { type HttpHarness, TOKENS, startHttpHarness } from "../testing/http-harness.ts";

let h: HttpHarness;
let web: FakeWeb;
let firmId: string;
const sites = { "meridian.vc": meridianSite() as Record<string, unknown> };

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

beforeAll(async () => {
	web = new FakeWeb(sites as never);
	h = await startHttpHarness({ jev: new UnconfiguredJev(), fetcherFor: web.fetcherFor });
	const svc = h.runtime.service;
	const { firm } = await svc.research.reconcile(actor("ws-a"), { url: "meridian.vc" });
	await svc.monitoring.register(actor("ws-a"), firm);
	await svc.research.research(actor("ws-a"), firm.id, { verify: false });
	firmId = firm.id;
});
afterAll(async () => h?.close());

describe("monitoring over AppPort", () => {
	it("requires research.run to pause, resume or reconfigure, and is idempotent", async () => {
		expect(await code(call(undefined, "firm.monitoring.set", { firmId, enabled: false }))).toBe("UNAUTHORIZED");
		expect(await code(call(TOKENS.aViewer, "firm.monitoring.set", { firmId, enabled: false }))).toBe("FORBIDDEN");
		const paused = await call<{ target: MonitoringTarget }>(TOKENS.aAnalyst, "firm.monitoring.set", { firmId, enabled: false });
		expect(paused.target).toMatchObject({ enabled: false, nextCheckAt: null, pausedBy: "arun" });
		const again = await call<{ target: MonitoringTarget }>(TOKENS.aAnalyst, "firm.monitoring.set", { firmId, enabled: false });
		expect(again.target.updatedAt).toBe(paused.target.updatedAt);
		const list = await call<{ items: { id: string; monitoring: { enabled: boolean } | null }[] }>(TOKENS.aViewer, "firm.list", {});
		expect(list.items[0]?.monitoring?.enabled).toBe(false);
		expect(await code(call(TOKENS.aAnalyst, "firm.monitoring.set", { firmId, intervalMinutes: 3 }))).toBe("INVALID_INPUT");
		const resumed = await call<{ target: MonitoringTarget }>(TOKENS.aAnalyst, "firm.monitoring.set", { firmId, enabled: true, intervalMinutes: 720 });
		expect(resumed.target).toMatchObject({ enabled: true, intervalMinutes: 720 });
		const profile = (await call<{ profile: FirmProfile }>(TOKENS.aViewer, "firm.get", { firmId })).profile;
		expect(profile.criteria.length).toBeGreaterThan(0); // pausing and resuming kept the profile
		expect(profile.monitoring?.lease).toBeNull();
	});

	it("exposes no workspace, URL or path input on the new capabilities", async () => {
		const c = h.client(TOKENS.aViewer);
		await c.connect();
		const manifest = await c.load();
		await c.close();
		for (const cap of (manifest.capabilities as unknown as { name: string; inputSchema: unknown }[]).filter((x) => ["firm.monitoring.set", "firm.timeline", "attention.list", "firm.review"].includes(x.name))) expect(JSON.stringify(cap.inputSchema)).not.toMatch(/workspaceId|tenantId|"url"|"path"/);
	});

	it("isolates workspaces for monitoring, timeline, attention and review", async () => {
		for (const [name, input] of [
			["firm.monitoring.set", { firmId, enabled: false }],
			["firm.timeline", { firmId }],
			["firm.review", { firmId, action: "note", note: "x" }],
		] as const)
			expect(`${name}:${await code(call(TOKENS.bPartner, name, input))}`).toBe(`${name}:NOT_FOUND`);
		expect((await call<{ items: unknown[] }>(TOKENS.bPartner, "attention.list", {})).items).toEqual([]);
		expect(await code(call(TOKENS.bPartner, "firm.review", { firmId, eventId: "ev_x", action: "confirm", note: "x" }))).toBe("NOT_FOUND");
	});

	it("serves a filterable timeline with the three dates kept apart, and reviews events and findings without changing them", async () => {
		const all = (await call<{ items: TimelineItem[] }>(TOKENS.aViewer, "firm.timeline", { firmId })).items;
		const ev = all.find((i) => i.type === "investment_event" && i.title.startsWith("Gridcell"))!;
		expect(ev).toMatchObject({ category: "investment_activity", reviewedAt: null, baseline: true });
		expect(ev.publishedAt).toBe("2026-10-01T08:00:00.000Z");
		expect(ev.announcedAt).toBe("2026-10-01T00:00:00.000Z");
		expect(ev.discoveredAt).not.toBe(ev.publishedAt);
		expect(ev.evidence.length).toBeGreaterThan(1);
		expect(ev.evidence.every((e) => e.url.startsWith("https://meridian.vc/") && e.passage)).toBe(true);
		expect((await call<{ items: TimelineItem[] }>(TOKENS.aViewer, "firm.timeline", { firmId, types: ["source_discovered"] })).items.every((i) => i.type === "source_discovered")).toBe(true);
		expect((await call<{ items: TimelineItem[] }>(TOKENS.aViewer, "firm.timeline", { firmId, from: "2999-01-01T00:00:00Z" })).items).toEqual([]);
		const reviewed = await call<unknown>(TOKENS.aAnalyst, "firm.review", { firmId, eventId: ev.refs.eventId, action: "confirm", note: "Matches the press release" });
		expect(reviewed).toBeDefined();
		const after = (await call<{ items: TimelineItem[] }>(TOKENS.aViewer, "firm.timeline", { firmId })).items;
		const evAfter = after.find((i) => i.id === ev.id)!;
		expect(evAfter.reviewState).toBe("confirmed");
		expect(evAfter.reviewedAt).not.toBeNull();
		expect(evAfter.discoveredAt).toBe(ev.discoveredAt);
		expect(after.some((i) => i.type === "review")).toBe(true);
		expect((await call<{ items: TimelineItem[] }>(TOKENS.aViewer, "firm.timeline", { firmId, reviewStates: ["confirmed"] })).items.map((i) => i.id)).toContain(ev.id);
		expect(await code(call(TOKENS.aViewer, "firm.review", { firmId, eventId: ev.refs.eventId, action: "dismiss", note: "x" }))).toBe("FORBIDDEN");
		expect(await code(call(TOKENS.aAnalyst, "firm.review", { firmId, eventId: ev.refs.eventId, criterionId: "rc_x", action: "note", note: "x" }))).toBe("INVALID_INPUT");
		expect(await code(call(TOKENS.aAnalyst, "firm.review", { firmId, action: "confirm", note: "x" }))).toBe("INVALID_INPUT");
	});

	it("surfaces new activity, strategy changes and research health in separate attention categories, once each", async () => {
		sites["meridian.vc"]!["/thesis"] = html("Investment thesis", "<p>We invest in seed stage fintech companies in Europe.</p><p>Our typical check size is $1M-$3M.</p>");
		sites["meridian.vc"]!["/feed.xml"] = rss([{ title: "Meridian leads seed round in Freshco", date: "Mon, 12 Oct 2026 08:00:00 GMT", desc: "Meridian Ventures led the seed round of Freshco." }]);
		await call(TOKENS.aAnalyst, "firm.refresh", { firmId });
		await h.runtime.service.research.settled();
		const a = (await call<{ items: AttentionItem[] }>(TOKENS.aViewer, "attention.list", {})).items;
		const kinds = a.map((i) => i.kind);
		expect(kinds).toContain("strategy_change");
		expect(kinds.filter((k) => k === "strategy_change")).toHaveLength(1);
		expect(new Set(a.map((i) => i.refId)).size).toBe(a.length); // each item once
		const again = await call<{ items: AttentionItem[] }>(TOKENS.aViewer, "attention.list", {});
		expect(again.items.map((i) => i.refId).sort()).toEqual(a.map((i) => i.refId).sort()); // repeated reads raise nothing new
		const profile = (await call<{ profile: FirmProfile }>(TOKENS.aViewer, "firm.get", { firmId })).profile;
		expect(profile.monitoring?.lastAttemptAt).not.toBeNull(); // the manual refresh was recorded against the schedule
		const finding = profile.findings.find((f) => f.kind === "thesis_modification")!;
		await call(TOKENS.aAnalyst, "firm.review", { firmId, findingId: finding.id, action: "confirm", note: "Seen on the site" });
		const b = (await call<{ items: AttentionItem[] }>(TOKENS.aViewer, "attention.list", {})).items;
		expect(b.some((i) => i.refId === finding.id)).toBe(false); // reviewed items leave the list
		const audit = await call<{ items: { eventType: string }[] }>(TOKENS.aPartner, "audit.list", { limit: 1000 });
		const types = new Set(audit.items.map((i) => i.eventType));
		for (const t of ["monitoring.target_paused", "monitoring.target_resumed", "monitoring.check_recorded", "research.finding_created", "research.review_recorded"]) expect(types.has(t)).toBe(true);
		expect((await call<{ items: unknown[] }>(TOKENS.bPartner, "audit.list", { limit: 1000 })).items.filter((i) => /monitoring|research/.test((i as { eventType: string }).eventType))).toEqual([]);
	});
});
