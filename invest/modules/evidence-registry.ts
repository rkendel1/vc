import { sha256Hex } from "../domain/canonical.ts";
import { invalid, notFound } from "../domain/errors.ts";
import {
	METRIC_KEYS,
	type Actor,
	type Contradiction,
	type DocumentRecord,
	type EvidenceItem,
	type EvidenceView,
	type InvestmentCriterion,
	type MetricKey,
	type ProvenanceClass,
	type Startup,
	type ThesisVersion,
} from "../domain/types.ts";
import { C, type InvestStore } from "../store/store.ts";
import { EXTRACTOR_VERSION, extractMetrics, termsFor, tokens, topicsOf } from "./claim-extraction.ts";

/** Values within 5% of each other agree; more than 10% apart disagree; in between is left alone. */
export const CORROBORATION_TOLERANCE = 0.05;
export const CONTRADICTION_TOLERANCE = 0.1;
const MAX_PROJECTED_ITEMS = 12;

const PROVENANCE_RANK: Record<ProvenanceClass, number> = { reviewer_verified: 3, independent: 2, founder_reported: 1 };

function sourceKey(item: Pick<EvidenceItem, "documentId" | "startupId" | "id" | "provenance">): string {
	if (item.documentId) return `doc:${item.documentId}`;
	return item.provenance.sourceType === "startup_profile" ? `profile:${item.startupId}` : `reviewer:${item.id}`;
}

function relativeDiff(a: number, b: number): number {
	const scale = Math.max(Math.abs(a), Math.abs(b), 1e-9);
	return Math.abs(a - b) / scale;
}

/**
 * Cross-source verification, derived on every read from immutable evidence. A founder's claim is
 * corroborated only by an independent or reviewer-verified source from a different document; two
 * founder documents agreeing with each other is not corroboration. Disagreement is flagged across
 * sources and within one source alike.
 */
export function analyzeEvidence(items: EvidenceItem[], inactive: Set<string>): { views: EvidenceView[]; contradictions: Contradiction[] } {
	const views: EvidenceView[] = items.map((i) => ({ ...i, effectiveVerification: i.verificationStatus, corroboratedBy: [], contradictedBy: [], superseded: inactive.has(i.id) }));
	const active = views.filter((v) => !v.superseded && v.metric);
	const byMetric = new Map<MetricKey, EvidenceView[]>();
	for (const v of active) {
		const key = v.metric!.key;
		byMetric.set(key, [...(byMetric.get(key) ?? []), v]);
	}
	const contradictions: Contradiction[] = [];
	for (const [metric, group] of byMetric) {
		const involved = new Set<string>();
		for (let i = 0; i < group.length; i++) {
			for (let j = i + 1; j < group.length; j++) {
				const a = group[i];
				const b = group[j];
				if (a.claim === b.claim) continue;
				const sameSource = sourceKey(a) === sourceKey(b);
				const diff = relativeDiff(a.metric!.value, b.metric!.value);
				// A source cannot corroborate itself, but it can contradict itself (a deck stating two different ARRs).
				if (diff <= CORROBORATION_TOLERANCE) {
					if (sameSource) continue;
					if (b.provenance.class !== "founder_reported") a.corroboratedBy.push(b.id);
					if (a.provenance.class !== "founder_reported") b.corroboratedBy.push(a.id);
				} else if (diff > CONTRADICTION_TOLERANCE) {
					a.contradictedBy.push(b.id);
					b.contradictedBy.push(a.id);
					involved.add(a.id).add(b.id);
				}
			}
		}
		if (involved.size) {
			const members = group.filter((g) => involved.has(g.id));
			const values = members.map((m) => m.metric!.value);
			contradictions.push({
				metric,
				evidenceIds: members.map((m) => m.id).sort(),
				values,
				relativeSpread: Math.round(relativeDiff(Math.max(...values), Math.min(...values)) * 1000) / 1000,
			});
		}
	}
	for (const v of views) {
		if (v.verificationStatus === "reviewer_verified") v.effectiveVerification = "reviewer_verified";
		else if (v.contradictedBy.length) v.effectiveVerification = "contradicted";
		else if (v.corroboratedBy.length) v.effectiveVerification = "corroborated";
		else v.effectiveVerification = "unverified";
	}
	return { views, contradictions: contradictions.sort((a, b) => a.metric.localeCompare(b.metric)) };
}

function stem(word: string): string {
	return word.replace(/ies$/, "y").replace(/(?<!s)s$/, "");
}

export type ProjectableEvidence = Pick<EvidenceView, "id" | "claim" | "metric" | "topics" | "provenance" | "effectiveVerification">;

/**
 * Which evidence a criterion is judged against, and which of its required evidence has none.
 * Deterministic and recorded in the evaluation manifest, so the projection can be recomputed.
 */
export function projectForCriterion(criterion: InvestmentCriterion, evidence: ProjectableEvidence[]): { evidenceIds: string[]; missing: string[] } {
	const required = criterion.requiredEvidence.map((phrase) => ({ phrase, ...termsFor(phrase), stems: tokens(phrase).map(stem) }));
	const requirementStems = new Set(tokens(`${criterion.name} ${criterion.requirement}`).map(stem));
	const satisfied = new Set<string>();
	const scored: { item: ProjectableEvidence; score: number; satisfies: string[] }[] = [];
	for (const item of evidence) {
		const itemStems = new Set(tokens(item.claim).map(stem));
		let score = 0;
		const satisfies: string[] = [];
		if (criterion.metric && item.metric?.key === criterion.metric) {
			score += 10;
		}
		for (const r of required) {
			const overlap = r.stems.filter((s) => itemStems.has(s)).length;
			const topicHit = r.topics.some((t) => item.topics.includes(t));
			if (r.metric && item.metric?.key === r.metric) {
				score += 5;
				satisfies.push(r.phrase);
			} else if (topicHit || (r.stems.length > 0 && overlap === r.stems.length)) {
				score += 2 + Math.min(overlap, 3);
				satisfies.push(r.phrase);
			}
		}
		score += Math.min([...requirementStems].filter((s) => itemStems.has(s)).length * 0.5, 2);
		if (score >= 2) scored.push({ item, score, satisfies });
	}
	scored.sort(
		(a, b) => b.score - a.score || PROVENANCE_RANK[b.item.provenance.class] - PROVENANCE_RANK[a.item.provenance.class] || a.item.id.localeCompare(b.item.id),
	);
	const chosen = scored.slice(0, MAX_PROJECTED_ITEMS);
	for (const c of chosen) for (const s of c.satisfies) satisfied.add(s);
	// A deterministic criterion's own metric counts as required evidence.
	const missing = required.map((r) => r.phrase).filter((p) => !satisfied.has(p));
	if (criterion.evaluationMode === "deterministic" && criterion.metric && !chosen.some((c) => c.item.metric?.key === criterion.metric))
		missing.unshift(`metric:${criterion.metric}`);
	return { evidenceIds: chosen.map((c) => c.item.id), missing: [...new Set(missing)] };
}

export function profileEvidenceId(startupId: string, claim: string): string {
	return `ev_prof_${sha256Hex(`${startupId}|${claim.trim()}`).slice(0, 24)}`;
}

export function profileEvidence(startup: Startup, claim: string, index: number, now: string, actor: Actor): EvidenceItem {
	const text = claim.trim();
	const metrics = extractMetrics(text);
	return {
		id: profileEvidenceId(startup.id, text),
		workspaceId: startup.workspaceId,
		startupId: startup.id,
		documentId: null,
		sourceLocation: { kind: "profile", field: "founderClaims", index, quote: text },
		claim: text,
		metric: metrics[0] ?? null,
		topics: topicsOf(text, metrics),
		provenance: { class: "founder_reported", sourceType: "startup_profile", extractor: EXTRACTOR_VERSION, recordedBy: actor.principalId },
		verificationStatus: "unverified",
		createdAt: now,
	};
}

export class EvidenceRegistryModule {
	constructor(private readonly store: InvestStore) {}

	/** Evidence for a startup, with derived verification, superseded flags and contradictions. */
	async views(actor: Actor, startupId: string): Promise<{ items: EvidenceView[]; contradictions: Contradiction[]; documents: DocumentRecord[] }> {
		const startup = await this.store.get<Startup>(C.startups, startupId, actor.workspaceId);
		if (!startup) throw notFound("Startup");
		const [items, documents] = await Promise.all([
			this.store.list<EvidenceItem>(C.evidence, actor.workspaceId, { startupId }),
			this.store.list<DocumentRecord>(C.documents, actor.workspaceId, { startupId }),
		]);
		const supersededDocs = new Set(documents.filter((d) => d.supersedesDocumentId && d.ingestionStatus !== "rejected").map((d) => d.supersedesDocumentId as string));
		const currentProfile = new Set(startup.founderClaims.map((c) => profileEvidenceId(startup.id, c)));
		const inactive = new Set(
			items
				.filter((i) => (i.documentId && supersededDocs.has(i.documentId)) || (i.provenance.sourceType === "startup_profile" && !currentProfile.has(i.id)))
				.map((i) => i.id),
		);
		const { views, contradictions } = analyzeEvidence(items, inactive);
		views.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
		return { items: views, contradictions, documents };
	}

	async get(actor: Actor, evidenceId: string): Promise<{ item: EvidenceView; document: DocumentRecord | null }> {
		const stored = await this.store.get<EvidenceItem>(C.evidence, evidenceId, actor.workspaceId);
		if (!stored) throw notFound("Evidence");
		const { items, documents } = await this.views(actor, stored.startupId);
		const item = items.find((i) => i.id === evidenceId) as EvidenceView;
		return { item, document: documents.find((d) => d.id === stored.documentId) ?? null };
	}

	/** Evidence a reviewer has verified directly (a bank statement seen on a call, a reference check). */
	async attachReviewerEvidence(actor: Actor, input: { startupId: string; claim: string; reference: string; metric?: { key: MetricKey; value: number } }): Promise<EvidenceView> {
		const startup = await this.store.get<Startup>(C.startups, input.startupId, actor.workspaceId);
		if (!startup) throw notFound("Startup");
		const claim = input.claim?.trim();
		const reference = input.reference?.trim();
		if (!claim || claim.length > 1000) throw invalid("The verified claim is required (≤1000 characters)");
		if (!reference || reference.length > 300) throw invalid("Say how it was verified (≤300 characters)");
		let metric = null;
		if (input.metric) {
			if (!METRIC_KEYS.includes(input.metric.key) || !Number.isFinite(input.metric.value)) throw invalid("Metric must be a known key with a numeric value");
			const unit = input.metric.key.endsWith("_pct") ? "percent" : input.metric.key === "runway_months" ? "months" : ["customers", "team_size"].includes(input.metric.key) ? "count" : "usd";
			metric = { key: input.metric.key, value: input.metric.value, unit, raw: String(input.metric.value) } as const;
		}
		const now = this.store.now();
		const id = `ev_rev_${sha256Hex(`${actor.workspaceId}|${startup.id}|${claim}|${reference}|${now}`).slice(0, 24)}`;
		const item: EvidenceItem = {
			id,
			workspaceId: actor.workspaceId,
			startupId: startup.id,
			documentId: null,
			sourceLocation: { kind: "reviewer", reference, quote: claim },
			claim,
			metric,
			topics: topicsOf(claim, metric ? [metric] : []),
			provenance: { class: "reviewer_verified", sourceType: "reviewer", extractor: "reviewer", recordedBy: actor.principalId },
			verificationStatus: "reviewer_verified",
			createdAt: now,
		};
		await this.store.commit(actor, {
			writes: [{ collection: C.evidence, id, value: item, create: true }],
			audit: [{ eventType: "evidence.reviewer_attached", entityRef: { type: "evidence", id }, payload: { startupId: startup.id, reference, metric } }],
		});
		return (await this.get(actor, id)).item;
	}

	/** Required evidence each criterion of a thesis version has no evidence for yet. */
	async gaps(actor: Actor, startupId: string, version: ThesisVersion): Promise<{ criterionId: string; criterionName: string; missing: string[] }[]> {
		const { items } = await this.views(actor, startupId);
		const active = items.filter((i) => !i.superseded);
		return version.criteria
			.map((c) => ({ criterionId: c.id, criterionName: c.name, missing: projectForCriterion(c, active).missing }))
			.filter((g) => g.missing.length);
	}
}
