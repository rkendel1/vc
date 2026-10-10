import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { validateThesisContent } from "../modules/investment-thesis.ts";
import { SEED_SAAS_CRITERIA, SEED_SAAS_SETTINGS } from "../testing/fixtures.ts";
import { actor, createHarness, type Harness } from "../testing/harness.ts";

const A = actor("ws-a");

describe("investment thesis", () => {
	let h: Harness;
	beforeEach(async () => {
		h = await createHarness();
	});
	afterEach(async () => h.close());

	it("validates structure, modes and thresholds", () => {
		expect(validateThesisContent(SEED_SAAS_CRITERIA, SEED_SAAS_SETTINGS).valid).toBe(true);
		const bad = validateThesisContent(
			[
				{ ...SEED_SAAS_CRITERIA[0], metric: undefined },
				{ ...SEED_SAAS_CRITERIA[2], threshold: 5 },
				{ ...SEED_SAAS_CRITERIA[2], id: "repeatable-demand" },
				{ ...SEED_SAAS_CRITERIA[3], importance: 140, missingEvidencePolicy: "ignore" },
			],
			{ showWeightedSummary: false, reviewConfidenceThreshold: 0.2 },
		);
		expect(bad.valid).toBe(false);
		const paths = bad.errors.map((e) => e.path);
		expect(paths).toContain("criteria[0].metric");
		expect(paths).toContain("criteria[1].threshold");
		expect(paths).toContain("criteria[2].id");
		expect(paths).toContain("criteria[3].importance");
		expect(paths).toContain("criteria[3].missingEvidencePolicy");
		expect(paths).toContain("settings.reviewConfidenceThreshold");
		expect(validateThesisContent([], SEED_SAAS_SETTINGS).valid).toBe(false);
	});

	it("approves immutable versions without changing earlier ones", async () => {
		const t = h.service.theses;
		let thesis = await t.createDraft(A, { name: "Seed SaaS", criteria: SEED_SAAS_CRITERIA, settings: SEED_SAAS_SETTINGS });
		expect((await t.validateDraft(A, thesis.id)).valid).toBe(true);
		const first = await t.approve(A, { thesisId: thesis.id, expectedVersion: thesis.__version!, note: "initial mandate" });
		expect(first.version.version).toBe(1);
		expect(first.thesis.currentVersionId).toBe(first.version.id);
		expect(first.thesis.draft).toBeNull();

		thesis = first.thesis;
		const raised = SEED_SAAS_CRITERIA.map((c) => (c.id === "arr-floor" ? { ...c, threshold: 2_000_000 } : c));
		thesis = await t.updateDraft(A, { thesisId: thesis.id, expectedVersion: thesis.__version!, criteria: raised });
		const diff = await t.compare(A, { fromVersionId: first.version.id });
		expect(diff.changes).toEqual([{ criterionId: "arr-floor", change: "modified", fields: ["threshold"] }]);
		const second = await t.approve(A, { thesisId: thesis.id, expectedVersion: thesis.__version! });
		expect(second.version.version).toBe(2);
		expect(second.version.previousVersionId).toBe(first.version.id);

		const v1 = await t.getVersion(A, first.version.id);
		expect(v1.criteria.find((c) => c.id === "arr-floor")?.threshold).toBe(1_000_000);
		expect(v1.contentHash).toBe(first.version.contentHash);
		expect((await t.listVersions(A, thesis.id)).map((v) => v.version)).toEqual([2, 1]);

		const events = await h.service.audit.list(A, { entityId: thesis.id });
		expect(events.map((e) => e.eventType)).toEqual(expect.arrayContaining(["thesis.created", "thesis.draft_updated", "thesis.version_approved"]));
	});

	it("refuses approval of an invalid or unchanged draft", async () => {
		const t = h.service.theses;
		const thesis = await t.createDraft(A, { name: "Broken", criteria: [{ ...SEED_SAAS_CRITERIA[0], comparator: undefined }], settings: SEED_SAAS_SETTINGS });
		await expect(t.approve(A, { thesisId: thesis.id, expectedVersion: thesis.__version! })).rejects.toMatchObject({ code: "invalid" });

		const ok = await t.createDraft(A, { name: "Fine", criteria: SEED_SAAS_CRITERIA, settings: SEED_SAAS_SETTINGS });
		const { thesis: approved, version } = await t.approve(A, { thesisId: ok.id, expectedVersion: ok.__version! });
		const same = await t.updateDraft(A, { thesisId: approved.id, expectedVersion: approved.__version!, criteria: version.criteria });
		await expect(t.approve(A, { thesisId: same.id, expectedVersion: same.__version! })).rejects.toMatchObject({ code: "precondition" });
	});

	it("lets exactly one of two concurrent approvals win", async () => {
		const t = h.service.theses;
		const thesis = await t.createDraft(A, { name: "Race", criteria: SEED_SAAS_CRITERIA, settings: SEED_SAAS_SETTINGS });
		const results = await Promise.allSettled([
			t.approve(A, { thesisId: thesis.id, expectedVersion: thesis.__version! }),
			t.approve(actor("ws-a", "other-partner"), { thesisId: thesis.id, expectedVersion: thesis.__version! }),
		]);
		expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
		expect((await t.listVersions(A, thesis.id)).length).toBe(1);
		const approvals = await h.service.audit.list(A, { eventType: "thesis.version_approved" });
		expect(approvals).toHaveLength(1);
	});

	it("rejects a stale draft edit instead of overwriting", async () => {
		const t = h.service.theses;
		const thesis = await t.createDraft(A, { name: "Stale", criteria: SEED_SAAS_CRITERIA, settings: SEED_SAAS_SETTINGS });
		await t.updateDraft(A, { thesisId: thesis.id, expectedVersion: thesis.__version!, criteria: SEED_SAAS_CRITERIA.slice(0, 2) });
		await expect(t.updateDraft(A, { thesisId: thesis.id, expectedVersion: thesis.__version!, criteria: SEED_SAAS_CRITERIA.slice(0, 3) })).rejects.toMatchObject({
			code: "precondition",
		});
	});
});
