import { digestOf, newId } from "../domain/canonical.ts";
import { invalid, notFound, precondition } from "../domain/errors.ts";
import {
	DEFAULT_THESIS_SETTINGS,
	METRIC_KEYS,
	type Actor,
	type InvestmentCriterion,
	type InvestmentThesis,
	type ThesisSettings,
	type ThesisVersion,
} from "../domain/types.ts";
import { C, type InvestStore } from "../store/store.ts";

export type ValidationIssue = { path: string; message: string };
export type ValidationResult = { valid: boolean; errors: ValidationIssue[]; warnings: ValidationIssue[] };

const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,47}$/;
const MODES = ["semantic", "deterministic", "human_review"];
const POLICIES = ["unknown", "review_required"];
const COMPARATORS = ["gte", "gt", "lte", "lt", "eq"];
const STANDARDS = ["founder_reported_ok", "independent_required"];

/** Validates a criterion list and settings. Pure; the same rules guard drafts and approvals. */
export function validateThesisContent(criteria: unknown, settings: unknown): ValidationResult {
	const errors: ValidationIssue[] = [];
	const warnings: ValidationIssue[] = [];
	const err = (path: string, message: string) => errors.push({ path, message });

	if (!Array.isArray(criteria)) {
		err("criteria", "Criteria must be a list");
		return { valid: false, errors, warnings };
	}
	if (criteria.length === 0) err("criteria", "A thesis needs at least one criterion");
	if (criteria.length > 50) err("criteria", "At most 50 criteria");
	const seen = new Set<string>();
	criteria.forEach((raw, i) => {
		const p = `criteria[${i}]`;
		if (!raw || typeof raw !== "object") return err(p, "Criterion must be an object");
		const c = raw as Record<string, unknown>;
		if (typeof c.id !== "string" || !ID_PATTERN.test(c.id)) err(`${p}.id`, "Id must be 1–48 lowercase letters, digits, '-' or '_'");
		else if (seen.has(c.id)) err(`${p}.id`, `Duplicate criterion id "${c.id}"`);
		else seen.add(c.id);
		if (typeof c.name !== "string" || !c.name.trim() || c.name.length > 120) err(`${p}.name`, "Name is required (≤120 characters)");
		if (typeof c.requirement !== "string" || !c.requirement.trim() || c.requirement.length > 2000)
			err(`${p}.requirement`, "Requirement is required (≤2000 characters)");
		if (!MODES.includes(c.evaluationMode as string)) err(`${p}.evaluationMode`, "Mode must be semantic, deterministic or human_review");
		if (typeof c.importance !== "number" || !Number.isFinite(c.importance) || c.importance < 0 || c.importance > 100)
			err(`${p}.importance`, "Importance must be a number from 0 to 100");
		if (!Array.isArray(c.requiredEvidence) || c.requiredEvidence.some((e) => typeof e !== "string" || !e.trim() || e.length > 80))
			err(`${p}.requiredEvidence`, "Required evidence must be a list of short phrases (≤80 characters)");
		else if (c.requiredEvidence.length > 20) err(`${p}.requiredEvidence`, "At most 20 required-evidence entries");
		if (typeof c.hardGate !== "boolean") err(`${p}.hardGate`, "hardGate must be true or false");
		if (!POLICIES.includes(c.missingEvidencePolicy as string)) err(`${p}.missingEvidencePolicy`, "Must be unknown or review_required");
		if (c.disqualifier !== undefined && (typeof c.disqualifier !== "string" || c.disqualifier.length > 500))
			err(`${p}.disqualifier`, "Disqualifier must be text (≤500 characters)");
		if (c.evidenceStandard !== undefined && !STANDARDS.includes(c.evidenceStandard as string))
			err(`${p}.evidenceStandard`, "Must be founder_reported_ok or independent_required");

		if (c.evaluationMode === "deterministic") {
			if (!METRIC_KEYS.includes(c.metric as never)) err(`${p}.metric`, `Deterministic criteria need a metric (${METRIC_KEYS.join(", ")})`);
			if (!COMPARATORS.includes(c.comparator as string)) err(`${p}.comparator`, "Deterministic criteria need a comparator (gte, gt, lte, lt, eq)");
			if (typeof c.threshold !== "number" || !Number.isFinite(c.threshold)) err(`${p}.threshold`, "Deterministic criteria need a numeric threshold");
		} else {
			if (c.threshold !== undefined) err(`${p}.threshold`, "A threshold applies only to deterministic criteria");
			if (c.metric !== undefined || c.comparator !== undefined)
				err(`${p}.metric`, "Metric and comparator apply only to deterministic criteria");
		}
		if (c.hardGate === true && !c.disqualifier) warnings.push({ path: `${p}.disqualifier`, message: "Hard gates read better with an explicit disqualifier" });
		if (c.evaluationMode === "semantic" && Array.isArray(c.requiredEvidence) && c.requiredEvidence.length === 0)
			warnings.push({ path: `${p}.requiredEvidence`, message: "Without required evidence the projection relies on the requirement text alone" });
	});

	const s = settings as Partial<ThesisSettings> | undefined;
	if (!s || typeof s !== "object") err("settings", "Settings are required");
	else {
		if (typeof s.showWeightedSummary !== "boolean") err("settings.showWeightedSummary", "Must be true or false");
		if (typeof s.reviewConfidenceThreshold !== "number" || s.reviewConfidenceThreshold < 0.5 || s.reviewConfidenceThreshold > 0.99)
			err("settings.reviewConfidenceThreshold", "Must be between 0.5 and 0.99");
		if (s.showWeightedSummary && Array.isArray(criteria) && !criteria.some((c) => (c as InvestmentCriterion)?.importance > 0))
			err("settings.showWeightedSummary", "A weighted summary needs at least one criterion with importance above 0");
	}
	return { valid: errors.length === 0, errors, warnings };
}

/** Keeps only declared fields, trimmed, so a stored criterion never carries unvalidated extras. */
export function normaliseCriterion(c: InvestmentCriterion): InvestmentCriterion {
	const out: InvestmentCriterion = {
		id: c.id,
		name: c.name.trim(),
		requirement: c.requirement.trim(),
		evaluationMode: c.evaluationMode,
		importance: c.importance,
		requiredEvidence: c.requiredEvidence.map((e) => e.trim()),
		hardGate: c.hardGate,
		missingEvidencePolicy: c.missingEvidencePolicy,
		evidenceStandard: c.evidenceStandard ?? "independent_required",
	};
	if (c.disqualifier?.trim()) out.disqualifier = c.disqualifier.trim();
	if (c.evaluationMode === "deterministic") {
		out.metric = c.metric;
		out.comparator = c.comparator;
		out.threshold = c.threshold;
	}
	return out;
}

export function thesisContentHash(criteria: InvestmentCriterion[], settings: ThesisSettings): string {
	return digestOf({ criteria: criteria.map(normaliseCriterion), settings });
}

export type CriterionChange = { criterionId: string; change: "added" | "removed" | "modified"; fields: string[] };

export function compareCriteria(from: InvestmentCriterion[], to: InvestmentCriterion[]): CriterionChange[] {
	const a = new Map(from.map((c) => [c.id, normaliseCriterion(c)]));
	const b = new Map(to.map((c) => [c.id, normaliseCriterion(c)]));
	const changes: CriterionChange[] = [];
	for (const [id, next] of b) {
		const prev = a.get(id);
		if (!prev) {
			changes.push({ criterionId: id, change: "added", fields: [] });
			continue;
		}
		const fields = [...new Set([...Object.keys(prev), ...Object.keys(next)])].filter(
			(k) => JSON.stringify((prev as Record<string, unknown>)[k]) !== JSON.stringify((next as Record<string, unknown>)[k]),
		);
		if (fields.length) changes.push({ criterionId: id, change: "modified", fields: fields.sort() });
	}
	for (const id of a.keys()) if (!b.has(id)) changes.push({ criterionId: id, change: "removed", fields: [] });
	return changes;
}

export type DraftInput = { name?: string; description?: string; criteria: InvestmentCriterion[]; settings?: ThesisSettings };

export class InvestmentThesisModule {
	constructor(private readonly store: InvestStore) {}

	async list(actor: Actor): Promise<InvestmentThesis[]> {
		const all = await this.store.list<InvestmentThesis>(C.theses, actor.workspaceId);
		return all.sort((x, y) => y.updatedAt.localeCompare(x.updatedAt));
	}

	async get(actor: Actor, thesisId: string): Promise<InvestmentThesis> {
		const thesis = await this.store.get<InvestmentThesis>(C.theses, thesisId, actor.workspaceId);
		if (!thesis) throw notFound("Thesis");
		return thesis;
	}

	async createDraft(actor: Actor, input: DraftInput & { name: string }): Promise<InvestmentThesis> {
		const name = input.name?.trim();
		if (!name || name.length > 120) throw invalid("Thesis name is required (≤120 characters)");
		const now = this.store.now();
		const thesis: InvestmentThesis = {
			id: newId("thesis"),
			workspaceId: actor.workspaceId,
			name,
			status: "draft",
			currentVersionId: null,
			versionCount: 0,
			draft: {
				description: input.description?.trim() ?? "",
				criteria: input.criteria ?? [],
				settings: input.settings ?? DEFAULT_THESIS_SETTINGS,
				updatedAt: now,
				updatedBy: actor.principalId,
			},
			createdAt: now,
			createdBy: actor.principalId,
			updatedAt: now,
		};
		await this.store.commit(actor, {
			writes: [{ collection: C.theses, id: thesis.id, value: thesis, create: true }],
			audit: [{ eventType: "thesis.created", entityRef: { type: "thesis", id: thesis.id }, payload: { name, criteria: thesis.draft?.criteria.length ?? 0 } }],
		});
		return this.get(actor, thesis.id);
	}

	/** Replaces the draft. Fenced on the thesis version the editor loaded, so concurrent edits cannot silently overwrite each other. */
	async updateDraft(actor: Actor, input: DraftInput & { thesisId: string; expectedVersion: number }): Promise<InvestmentThesis> {
		const thesis = await this.get(actor, input.thesisId);
		if (thesis.__version !== input.expectedVersion) throw precondition("This thesis changed since you opened it; reload before editing");
		const now = this.store.now();
		const base = thesis.draft ?? (await this.currentVersionAsDraft(actor, thesis));
		const draft = {
			description: input.description?.trim() ?? base.description,
			criteria: input.criteria,
			settings: input.settings ?? base.settings,
			updatedAt: now,
			updatedBy: actor.principalId,
		};
		const name = input.name?.trim() || thesis.name;
		const previous = thesis.currentVersionId ? await this.getVersion(actor, thesis.currentVersionId) : null;
		const next: InvestmentThesis = { ...thesis, name, draft, updatedAt: now };
		await this.store.commit(actor, {
			writes: [{ collection: C.theses, id: thesis.id, value: next, ifVersion: input.expectedVersion }],
			audit: [
				{
					eventType: "thesis.draft_updated",
					entityRef: { type: "thesis", id: thesis.id },
					payload: {
						criteria: draft.criteria.length,
						changesFromCurrentVersion: previous ? compareCriteria(previous.criteria, draft.criteria) : null,
					},
				},
			],
		});
		return this.get(actor, thesis.id);
	}

	async discardDraft(actor: Actor, input: { thesisId: string; expectedVersion: number }): Promise<InvestmentThesis> {
		const thesis = await this.get(actor, input.thesisId);
		if (!thesis.draft) return thesis;
		if (!thesis.currentVersionId) throw precondition("A thesis with no approved version cannot discard its only draft");
		if (thesis.__version !== input.expectedVersion) throw precondition("This thesis changed since you opened it; reload first");
		await this.store.commit(actor, {
			writes: [{ collection: C.theses, id: thesis.id, value: { ...thesis, draft: null, updatedAt: this.store.now() }, ifVersion: input.expectedVersion }],
			audit: [{ eventType: "thesis.draft_discarded", entityRef: { type: "thesis", id: thesis.id } }],
		});
		return this.get(actor, thesis.id);
	}

	async validateDraft(actor: Actor, thesisId: string): Promise<ValidationResult> {
		const thesis = await this.get(actor, thesisId);
		if (!thesis.draft) return { valid: false, errors: [{ path: "draft", message: "There is no draft to validate" }], warnings: [] };
		return validateThesisContent(thesis.draft.criteria, thesis.draft.settings);
	}

	/**
	 * Freezes the draft as the next immutable version. The version record is a fenced create and
	 * the thesis head pointer a fenced update, in one transaction: two concurrent approvals cannot
	 * both succeed, and an earlier version is never touched.
	 */
	async approve(actor: Actor, input: { thesisId: string; expectedVersion: number; note?: string }): Promise<{ thesis: InvestmentThesis; version: ThesisVersion }> {
		const thesis = await this.get(actor, input.thesisId);
		if (thesis.__version !== input.expectedVersion) throw precondition("This thesis changed since you opened it; reload before approving");
		if (!thesis.draft) throw precondition("There is no draft to approve");
		const validation = validateThesisContent(thesis.draft.criteria, thesis.draft.settings);
		if (!validation.valid) throw invalid("The draft is not valid", { errors: validation.errors });
		const criteria = thesis.draft.criteria.map(normaliseCriterion);
		const contentHash = thesisContentHash(criteria, thesis.draft.settings);
		const previous = thesis.currentVersionId ? await this.getVersion(actor, thesis.currentVersionId) : null;
		if (previous && previous.contentHash === contentHash) throw precondition("The draft is identical to the current version; nothing to approve");

		const now = this.store.now();
		const versionNumber = thesis.versionCount + 1;
		const version: ThesisVersion = {
			id: `${thesis.id}_v${versionNumber}`,
			workspaceId: actor.workspaceId,
			thesisId: thesis.id,
			version: versionNumber,
			description: thesis.draft.description,
			criteria,
			settings: thesis.draft.settings,
			contentHash,
			previousVersionId: previous?.id ?? null,
			createdAt: now,
			approvedBy: actor.principalId,
			approvedByName: actor.displayName,
			approvalNote: input.note?.trim() ?? "",
		};
		const next: InvestmentThesis = { ...thesis, status: "active", currentVersionId: version.id, versionCount: versionNumber, draft: null, updatedAt: now };
		await this.store.commit(actor, {
			writes: [
				{ collection: C.thesisVersions, id: version.id, value: version, create: true },
				{ collection: C.theses, id: thesis.id, value: next, ifVersion: input.expectedVersion },
			],
			audit: [
				{
					eventType: "thesis.version_approved",
					entityRef: { type: "thesis_version", id: version.id },
					payload: {
						thesisId: thesis.id,
						version: versionNumber,
						contentHash,
						note: version.approvalNote,
						changes: previous ? compareCriteria(previous.criteria, criteria) : criteria.map((c) => ({ criterionId: c.id, change: "added", fields: [] })),
					},
				},
			],
		});
		return { thesis: await this.get(actor, thesis.id), version };
	}

	async listVersions(actor: Actor, thesisId: string): Promise<ThesisVersion[]> {
		await this.get(actor, thesisId);
		const versions = await this.store.list<ThesisVersion>(C.thesisVersions, actor.workspaceId, { thesisId });
		return versions.sort((a, b) => b.version - a.version);
	}

	async getVersion(actor: Actor, versionId: string): Promise<ThesisVersion> {
		const version = await this.store.get<ThesisVersion>(C.thesisVersions, versionId, actor.workspaceId);
		if (!version) throw notFound("Thesis version");
		return version;
	}

	async compare(actor: Actor, input: { fromVersionId: string; toVersionId?: string; thesisId?: string }) {
		const from = await this.getVersion(actor, input.fromVersionId);
		let toCriteria: InvestmentCriterion[];
		let toLabel: string;
		if (input.toVersionId) {
			const to = await this.getVersion(actor, input.toVersionId);
			toCriteria = to.criteria;
			toLabel = `v${to.version}`;
		} else {
			const thesis = await this.get(actor, input.thesisId ?? from.thesisId);
			if (!thesis.draft) throw precondition("There is no draft to compare with");
			toCriteria = thesis.draft.criteria;
			toLabel = "draft";
		}
		return { from: `v${from.version}`, to: toLabel, changes: compareCriteria(from.criteria, toCriteria) };
	}

	private async currentVersionAsDraft(actor: Actor, thesis: InvestmentThesis) {
		if (!thesis.currentVersionId) return { description: "", criteria: [], settings: DEFAULT_THESIS_SETTINGS };
		const v = await this.getVersion(actor, thesis.currentVersionId);
		return { description: v.description, criteria: v.criteria, settings: v.settings };
	}
}
