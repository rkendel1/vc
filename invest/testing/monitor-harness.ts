import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Actor } from "../domain/types.ts";
import { UnconfiguredJev, type JevDecider } from "../jev/jev-client.ts";
import { ROLE_PERMISSIONS } from "../auth/authboundry-adapter.ts";
import { InvestorResearchModule } from "../modules/investor-research.ts";
import { ParticipationModule } from "../modules/participation.ts";
import { ReconciliationModule } from "../modules/reconciliation.ts";
import { SourceIngestionModule } from "../modules/source-ingestion.ts";
import { MonitoringModule, type MonitoringOptions } from "../modules/monitoring.ts";
import { InvestStore } from "../store/store.ts";
import { FakeWeb, type FakeSites } from "./fake-web.ts";
import { TEST_RESEARCH_LIMITS, actor } from "./harness.ts";

/** A persistent store the tests can close and reopen to simulate a process restart, with a clock they control. */
export class MonitorRig {
	now: Date;
	store!: InvestStore;
	research!: InvestorResearchModule;
	monitoring!: MonitoringModule;
	sources!: SourceIngestionModule;
	participation!: ParticipationModule;
	reconciliation!: ReconciliationModule;
	readonly A: Actor = { ...actor("ws-a"), permissions: ["invest.read", "research.run", "review.write", "thesis.approve", "source.manage"], role: "partner" };

	private constructor(
		readonly dir: string,
		readonly web: FakeWeb,
		private readonly jev: JevDecider,
		private readonly options: Partial<MonitoringOptions>,
		start: Date,
	) {
		this.now = start;
	}

	static async create(sites: FakeSites, options: { jev?: JevDecider; monitoring?: Partial<MonitoringOptions>; start?: Date } = {}) {
		const dir = await mkdtemp(join(tmpdir(), "invest-mon-"));
		const rig = new MonitorRig(dir, new FakeWeb(sites), options.jev ?? new UnconfiguredJev(), options.monitoring ?? {}, options.start ?? new Date("2026-10-11T09:00:00Z"));
		await rig.open();
		return rig;
	}

	/** (Re)opens the same FeltDB directory with fresh module instances: what a restart looks like. */
	async open(ownerId?: string) {
		this.store = await InvestStore.openDir(join(this.dir, "felt"), () => new Date(this.now));
		this.research = new InvestorResearchModule({ store: this.store, jev: this.jev, fetcherFor: this.web.fetcherFor, defaults: TEST_RESEARCH_LIMITS, staleAfterDays: 180, staleSourceDays: 14, lookbackDays: 730, jevTimeoutMs: 5_000 });
		this.monitoring = this.newMonitoring(ownerId);
		this.sources = new SourceIngestionModule({ store: this.store, fetcherForSource: this.web.fetcherForSource, defaults: TEST_RESEARCH_LIMITS, maxBytes: 5_000_000, maxRecords: 5_000, lookbackDays: 730 });
		this.monitoring.setIngestion(this.sources);
		this.participation = new ParticipationModule({ store: this.store, research: this.research, fetcherFor: this.web.fetcherFor, limits: TEST_RESEARCH_LIMITS });
		this.reconciliation = new ReconciliationModule({ store: this.store, research: this.research, participation: this.participation, sources: this.sources, staleAfterDays: 180 });
	}

	/** An actor with the real permissions of a role, in a workspace of their own. */
	as(role: keyof typeof ROLE_PERMISSIONS, workspaceId: string, principalId = `${role}-${workspaceId}`): Actor {
		return { principalId, displayName: principalId, workspaceId, permissions: [...ROLE_PERMISSIONS[role]], role };
	}

	/** A second worker over the same store. */
	newMonitoring(ownerId?: string, extra: Partial<MonitoringOptions> = {}) {
		return new MonitoringModule(this.store, this.research, { defaultIntervalMinutes: 1440, maxConcurrentFirms: 2, leaseMs: 15 * 60_000, retryBaseMs: 30 * 60_000, ceilings: { maxPages: 50, maxDepth: 4 }, random: () => 0.5, ownerId, ...this.options, ...extra });
	}

	async restart() {
		await this.research.settled();
		await this.store.close();
		await this.open();
	}

	advance(ms: number) {
		this.now = new Date(this.now.getTime() + ms);
	}

	/** Registers a firm and runs its initial research, as `bun run research` does. */
	async register(url: string, name?: string) {
		const { firm } = await this.research.reconcile(this.A, { url, name });
		await this.monitoring.register(this.A, firm);
		await this.research.research(this.A, firm.id, { verify: false }).catch(() => undefined);
		return firm;
	}

	async close() {
		await this.research.settled();
		await this.store.close();
		await rm(this.dir, { recursive: true, force: true });
	}
}

export const DAY = 86_400_000;
export const MIN = 60_000;
