import type { Actor, DocumentRecord, Evaluation, InvestmentThesis, Startup, ThesisVersion } from "./domain/types.ts";
import type { EvaluationListItem } from "./domain/views.ts";
export type { EvaluationListItem };
import type { DocumentStorage } from "./ingestion/document-storage.ts";
import type { JevDecider } from "./jev/jev-client.ts";
import type { Logger } from "./logger.ts";
import { AuditModule } from "./modules/audit.ts";
import { DecisionRecordsModule } from "./modules/decision-records.ts";
import { DocumentIngestionModule, type IngestionLimits } from "./modules/document-ingestion.ts";
import { EvaluationOrchestrator, type OrchestratorOptions } from "./modules/evaluation-orchestrator.ts";
import { EvidenceRegistryModule } from "./modules/evidence-registry.ts";
import { InvestorResearchModule, type ResearchDeps } from "./modules/investor-research.ts";
import { MonitoringModule, type MonitoringOptions } from "./modules/monitoring.ts";
import { InvestmentThesisModule } from "./modules/investment-thesis.ts";
import { StartupRegistryModule } from "./modules/startup-registry.ts";
import { C, type InvestStore } from "./store/store.ts";

export type ServiceDeps = {
	store: InvestStore;
	storage: DocumentStorage;
	jev: JevDecider;
	limits: IngestionLimits;
	evaluation: OrchestratorOptions;
	logger: Logger;
	research: Omit<ResearchDeps, "store" | "jev">;
	monitoring: MonitoringOptions;
};


/** One application, explicit internal modules. Capability handlers call this; nothing else does. */
export class InvestmentService {
	readonly theses: InvestmentThesisModule;
	readonly startups: StartupRegistryModule;
	readonly documents: DocumentIngestionModule;
	readonly evidence: EvidenceRegistryModule;
	readonly evaluations: EvaluationOrchestrator;
	readonly decisions: DecisionRecordsModule;
	readonly audit: AuditModule;
	readonly research: InvestorResearchModule;
	readonly monitoring: MonitoringModule;

	constructor(private readonly deps: ServiceDeps) {
		this.theses = new InvestmentThesisModule(deps.store);
		this.startups = new StartupRegistryModule(deps.store);
		this.documents = new DocumentIngestionModule(deps.store, deps.storage, deps.limits);
		this.evidence = new EvidenceRegistryModule(deps.store);
		this.evaluations = new EvaluationOrchestrator(deps.store, this.evidence, deps.jev, deps.evaluation, deps.logger);
		this.decisions = new DecisionRecordsModule(deps.store);
		this.audit = new AuditModule(deps.store);
		this.research = new InvestorResearchModule({ ...deps.research, store: deps.store, jev: deps.jev });
		this.monitoring = new MonitoringModule(deps.store, this.research, deps.monitoring);
	}

	get jevIdentity() {
		return this.deps.jev.identity;
	}

	async listEvaluations(actor: Actor, filter: { startupId?: string } = {}): Promise<EvaluationListItem[]> {
		const [evaluations, startups, versions] = await Promise.all([
			this.deps.store.list<Evaluation>(C.evaluations, actor.workspaceId, filter.startupId ? { startupId: filter.startupId } : {}),
			this.deps.store.list<Startup>(C.startups, actor.workspaceId),
			this.deps.store.list<ThesisVersion>(C.thesisVersions, actor.workspaceId),
		]);
		evaluations.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
		const out: EvaluationListItem[] = [];
		for (const e of evaluations) {
			const report = e.status === "completed" ? await this.decisions.report(actor, e.id) : null;
			const { manifest: _m, requestKey: _r, workspaceId: _w, __version: _v, ...rest } = e;
			out.push({
				...rest,
				startupName: startups.find((s) => s.id === e.startupId)?.name ?? "(unknown)",
				thesisVersion: versions.find((v) => v.id === e.thesisVersionId)?.version ?? 0,
				reviewsOutstanding: report?.summary?.reviewsOutstanding ?? null,
				openRequests: report?.openRequests.length ?? 0,
				currentDecision: report?.currentDecision ?? null,
			});
		}
		return out;
	}

	/** Screen A: what is running, what needs a reviewer, what finished, and who is still missing evidence. */
	async overview(actor: Actor) {
		const [evaluations, startups, theses, documents] = await Promise.all([
			this.listEvaluations(actor),
			this.deps.store.list<Startup>(C.startups, actor.workspaceId),
			this.deps.store.list<InvestmentThesis>(C.theses, actor.workspaceId),
			this.deps.store.list<DocumentRecord>(C.documents, actor.workspaceId),
		]);
		const finalDecision = (e: EvaluationListItem) => e.currentDecision && ["invest", "decline"].includes(e.currentDecision.decision);
		return {
			active: evaluations.filter((e) => e.status === "running"),
			outstandingReviews: evaluations.filter((e) => e.status === "completed" && !finalDecision(e) && ((e.reviewsOutstanding ?? 0) > 0 || e.openRequests > 0)),
			recentlyCompleted: evaluations.filter((e) => e.status !== "running").slice(0, 10),
			awaitingEvidence: startups
				.map((s) => {
					const docs = documents.filter((d) => d.startupId === s.id);
					const usable = docs.filter((d) => d.ingestionStatus === "ingested" || d.ingestionStatus === "partial");
					const problems = docs.filter((d) => d.ingestionStatus === "failed" || d.ingestionStatus === "rejected" || d.ingestionStatus === "partial");
					return { startup: { id: s.id, name: s.name, stage: s.stage, sector: s.sector }, documents: docs.length, usableDocuments: usable.length, documentsWithIssues: problems.length };
				})
				.filter((s) => s.usableDocuments === 0 || s.documentsWithIssues > 0),
			theses: theses.map((t) => ({ id: t.id, name: t.name, status: t.status, versionCount: t.versionCount, hasDraft: !!t.draft, currentVersionId: t.currentVersionId })),
			counts: { startups: startups.length, evaluations: evaluations.length, documents: documents.length },
			jev: this.deps.jev.identity,
		};
	}

	/** Screen C: profile, documents, evidence with provenance, contradictions and gaps against a chosen thesis version. */
	async startupWorkspace(actor: Actor, input: { startupId: string; thesisVersionId?: string }) {
		const startup = await this.startups.get(actor, input.startupId);
		const [documents, evidence, evaluations, decisions] = await Promise.all([
			this.documents.list(actor, startup.id),
			this.evidence.views(actor, startup.id),
			this.listEvaluations(actor, { startupId: startup.id }),
			this.decisions.decisionsForStartup(actor, startup.id),
		]);
		const version = input.thesisVersionId ? await this.theses.getVersion(actor, input.thesisVersionId) : null;
		const gaps = version ? await this.evidence.gaps(actor, startup.id, version) : null;
		return { startup, documents, evidence: evidence.items, contradictions: evidence.contradictions, gaps, gapsAgainst: version ? { id: version.id, version: version.version, thesisId: version.thesisId } : null, evaluations, decisions };
	}
}
