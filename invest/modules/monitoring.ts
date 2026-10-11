import { newId } from "../domain/canonical.ts";
import { forbidden, invalid, notFound } from "../domain/errors.ts";
import type { InvestorFirm, MonitoringTarget, ResearchLimits } from "../domain/research.ts";
import type { Actor } from "../domain/types.ts";
import { C, type InvestStore } from "../store/store.ts";
import type { CuratedSource } from "../domain/collab.ts";
import type { InvestorResearchModule, RunOutcome } from "./investor-research.ts";
import type { SourceIngestionModule } from "./source-ingestion.ts";

/**
 * Persistent monitoring of registered firms.
 *
 * Durability: the schedule (`nextCheckAt`), failure count and lease live in FeltDB. A restart loses no
 * due work; the in-process runner only wakes up to look at what is due.
 *
 * Concurrency, verified against the FeltDB 0.11.7 file runtime used here: a write with `ifVersion`
 * succeeds for exactly one of several writers that read the same version (ConditionalConflictError
 * for the rest), and `requireAbsent` creates exactly once. FeltDB offers no lease primitive, so a
 * lease is a field on the target taken with that conditional write:
 *   acquire  ifVersion update setting lease{ownerId, token, expiresAt}; the loser skips the firm.
 *   fence    completion re-reads the target and only the holder of the current token may apply it;
 *            a worker whose lease expired and was taken over finds a different token and does nothing.
 *   expiry   a crashed worker's lease lapses after `leaseMs` (default 15 min); at boot the single
 *            server process releases leases (no other process can legitimately hold one).
 * A lease does not stop a *manual* refresh; InvestorResearchModule.beginRun does, per firm, by refusing
 * a second running run, so the two guards agree on "one run per firm at a time".
 */
export type MonitoringOptions = {
	defaultIntervalMinutes: number;
	maxConcurrentFirms: number;
	leaseMs: number;
	retryBaseMs: number;
	/** Fractional jitter applied to every computed delay: ±retryJitter for retries, +0..retryJitter/2 for regular checks. */
	retryJitter?: number;
	random?: () => number;
	ownerId?: string;
	ceilings: { maxPages: number; maxDepth: number };
};

export type CycleEntry = { workspaceId: string; firmId: string; domain: string; result: "ran" | "would_run" | "skipped_leased" | "skipped_running" | "failed" | "fenced"; runId: string | null; success: boolean | null; message: string | null };
export type CycleReport = { at: string; due: number; entries: CycleEntry[]; stopped: boolean };

const MIN_INTERVAL = 15;
const MAX_INTERVAL = 43_200;
const MINUTE = 60_000;

export class MonitoringModule {
	readonly ownerId: string;
	private stopping = false;
	private readonly random: () => number;
	private readonly jitter: number;
	private active = new Set<Promise<unknown>>();
	private ingestion: SourceIngestionModule | null = null;

	constructor(
		private readonly store: InvestStore,
		private readonly research: InvestorResearchModule,
		private readonly o: MonitoringOptions,
	) {
		this.ownerId = o.ownerId ?? `worker-${newId("w").slice(2, 14)}`;
		this.random = o.random ?? Math.random;
		this.jitter = o.retryJitter ?? 0.2;
		// Every run, however started (CLI, web refresh, scheduler), reports back here.
		research.setObserver(async (actor, outcome) => {
			await this.recordOutcome(actor, outcome);
		});
	}

	/** Curated sources are scheduled by the same targets, leases, backoff and runner as firms. */
	setIngestion(ingestion: SourceIngestionModule) {
		this.ingestion = ingestion;
		ingestion.setMonitoring(this);
		ingestion.setObserver(async (actor, outcome) => {
			await this.recordOutcome(actor, outcome);
		});
	}

	/** Makes a registered source a persistent target (kind "source"; the target id is the source id). Idempotent. */
	async registerSource(actor: Actor, source: Pick<CuratedSource, "id" | "canonicalUrl" | "allowedHosts">, options: { intervalMinutes?: number } = {}): Promise<MonitoringTarget> {
		const existing = await this.get(actor, source.id);
		if (existing) return existing;
		const now = this.store.now();
		const target: MonitoringTarget = { id: source.id, kind: "source", workspaceId: actor.workspaceId, firmId: source.id, canonicalDomain: source.allowedHosts[0] ?? "", website: source.canonicalUrl, enabled: true, intervalMinutes: this.cleanInterval(options.intervalMinutes), limits: { maxPages: null, maxDepth: null }, nextCheckAt: now, lastAttemptAt: null, lastSuccessAt: null, lastRunId: null, consecutiveFailures: 0, lastError: null, lease: null, pausedAt: null, pausedBy: null, createdAt: now, createdBy: actor.principalId, updatedAt: now };
		try {
			await this.store.commit(actor, { writes: [{ collection: C.monitoringTargets, id: target.id, value: target as unknown as Record<string, unknown>, create: true }], audit: [{ eventType: "monitoring.target_registered", entityRef: { type: "monitoring_target", id: target.id }, payload: { sourceId: source.id, kind: "source", intervalMinutes: target.intervalMinutes } }] });
		} catch (error) {
			if ((error as { code?: string }).code !== "conflict") throw error;
		}
		return (await this.get(actor, source.id))!;
	}

	// ------------------------------------------------------------------ targets

	async get(actor: Actor, firmId: string): Promise<MonitoringTarget | null> {
		return this.store.get<MonitoringTarget>(C.monitoringTargets, firmId, actor.workspaceId);
	}

	private cleanInterval(minutes: number | undefined): number {
		const v = minutes ?? this.o.defaultIntervalMinutes;
		if (!Number.isInteger(v) || v < MIN_INTERVAL || v > MAX_INTERVAL) throw invalid(`Interval must be a whole number of minutes between ${MIN_INTERVAL} and ${MAX_INTERVAL}`);
		return v;
	}

	private cleanLimits(limits?: { maxPages?: number | null; maxDepth?: number | null }) {
		const maxPages = limits?.maxPages ?? null;
		const maxDepth = limits?.maxDepth ?? null;
		if (maxPages !== null && (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > this.o.ceilings.maxPages)) throw invalid(`maxPages must be between 1 and ${this.o.ceilings.maxPages}`);
		if (maxDepth !== null && (!Number.isInteger(maxDepth) || maxDepth < 0 || maxDepth > this.o.ceilings.maxDepth)) throw invalid(`maxDepth must be between 0 and ${this.o.ceilings.maxDepth}`);
		return { maxPages, maxDepth };
	}

	/** Makes a registered firm a persistent monitoring target. Idempotent; never discards or resets an existing target. Due immediately, so the first check is the initial research. */
	async register(actor: Actor, firm: Pick<InvestorFirm, "id" | "canonicalDomain" | "website">, options: { intervalMinutes?: number; limits?: { maxPages?: number | null; maxDepth?: number | null } } = {}): Promise<{ target: MonitoringTarget; created: boolean }> {
		const existing = await this.get(actor, firm.id);
		if (existing) return { target: existing, created: false };
		const now = this.store.now();
		const target: MonitoringTarget = {
			id: firm.id,
			workspaceId: actor.workspaceId,
			firmId: firm.id,
			canonicalDomain: firm.canonicalDomain,
			website: firm.website,
			enabled: true,
			intervalMinutes: this.cleanInterval(options.intervalMinutes),
			limits: this.cleanLimits(options.limits),
			nextCheckAt: now,
			lastAttemptAt: null,
			lastSuccessAt: null,
			lastRunId: null,
			consecutiveFailures: 0,
			lastError: null,
			lease: null,
			pausedAt: null,
			pausedBy: null,
			createdAt: now,
			createdBy: actor.principalId,
			updatedAt: now,
		};
		try {
			await this.store.commit(actor, {
				writes: [{ collection: C.monitoringTargets, id: target.id, value: target as unknown as Record<string, unknown>, create: true }],
				audit: [{ eventType: "monitoring.target_registered", entityRef: { type: "monitoring_target", id: target.id }, payload: { firmId: firm.id, domain: firm.canonicalDomain, intervalMinutes: target.intervalMinutes } }],
			});
		} catch (error) {
			if ((error as { code?: string }).code === "conflict") return { target: (await this.get(actor, firm.id))!, created: false };
			throw error;
		}
		return { target: (await this.get(actor, firm.id))!, created: true };
	}

	/** Pause, resume or reconfigure. Pausing keeps the firm, its profile and all history; it only stops scheduling. */
	async configure(actor: Actor, firmId: string, change: { enabled?: boolean; intervalMinutes?: number; limits?: { maxPages?: number | null; maxDepth?: number | null } }): Promise<MonitoringTarget> {
		for (let attempt = 0; attempt < 5; attempt++) {
			const t = await this.get(actor, firmId);
			if (!t) throw notFound("Monitoring target");
			const need = t.kind === "source" ? "source.manage" : "research.run";
			if (!actor.permissions.includes(need)) throw forbidden(`Changing monitoring needs the ${need} permission`);
			const now = this.store.now();
			const next: MonitoringTarget = { ...t, updatedAt: now };
			const changed: string[] = [];
			if (change.intervalMinutes !== undefined && change.intervalMinutes !== t.intervalMinutes) {
				next.intervalMinutes = this.cleanInterval(change.intervalMinutes);
				changed.push("intervalMinutes");
			}
			if (change.limits) {
				next.limits = this.cleanLimits({ ...t.limits, ...change.limits });
				changed.push("limits");
			}
			let eventType = "monitoring.target_configured";
			if (change.enabled === false && t.enabled) {
				next.enabled = false;
				next.pausedAt = now;
				next.pausedBy = actor.principalId;
				next.nextCheckAt = null;
				eventType = "monitoring.target_paused";
				changed.push("enabled");
			} else if (change.enabled === true && !t.enabled) {
				next.enabled = true;
				next.pausedAt = null;
				next.pausedBy = null;
				next.nextCheckAt = now; // due promptly after resuming
				eventType = "monitoring.target_resumed";
				changed.push("enabled");
			} else if (changed.includes("intervalMinutes") && t.enabled && t.lastSuccessAt) {
				next.nextCheckAt = new Date(Math.min(Date.parse(t.nextCheckAt ?? now), Date.parse(t.lastSuccessAt) + next.intervalMinutes * MINUTE)).toISOString();
			}
			if (!changed.length) return t;
			try {
				await this.store.commit(actor, {
					writes: [{ collection: C.monitoringTargets, id: t.id, value: next as unknown as Record<string, unknown>, ifVersion: t.__version }],
					audit: [{ eventType, entityRef: { type: "monitoring_target", id: t.id }, payload: { firmId, changed, enabled: next.enabled, intervalMinutes: next.intervalMinutes } }],
				});
				return (await this.get(actor, firmId))!;
			} catch (error) {
				if ((error as { code?: string }).code !== "conflict") throw error;
			}
		}
		throw invalid("The monitoring target is changing too quickly; retry");
	}

	// ------------------------------------------------------------------ scheduling math

	/** Delay before the next check. Success: the interval (+ small jitter to spread load). Retryable failure: exponential backoff capped at the interval, ±jitter. Blocked or restricted: the full interval, never a hammering retry. */
	nextDelayMs(target: Pick<MonitoringTarget, "intervalMinutes">, outcome: { success: boolean; retryable: boolean }, consecutiveFailures: number): number {
		const interval = target.intervalMinutes * MINUTE;
		if (outcome.success) return Math.round(interval * (1 + this.random() * (this.jitter / 2)));
		if (!outcome.retryable) return Math.round(interval * (1 + this.random() * (this.jitter / 2)));
		const backoff = Math.min(this.o.retryBaseMs * 2 ** Math.max(0, consecutiveFailures - 1), interval);
		return Math.max(MINUTE, Math.round(backoff * (1 + (this.random() * 2 - 1) * this.jitter)));
	}

	/**
	 * Applied after every run. A scheduled run passes its lease token and is fenced; a manual or
	 * initial run (no token) updates the schedule only while nobody else holds a live lease.
	 */
	async recordOutcome(actor: Actor, outcome: RunOutcome, leaseToken?: string): Promise<"applied" | "fenced" | "no_target" | "busy"> {
		for (let attempt = 0; attempt < 6; attempt++) {
			const t = await this.get(actor, outcome.firmId);
			if (!t) return "no_target";
			const nowIso = this.store.now();
			const live = !!t.lease && Date.parse(t.lease.expiresAt) > Date.parse(nowIso);
			if (leaseToken !== undefined ? t.lease?.token !== leaseToken : live) return leaseToken !== undefined ? "fenced" : "busy";
			const failures = outcome.success ? 0 : t.consecutiveFailures + 1;
			const next: MonitoringTarget = {
				...t,
				lease: null,
				lastAttemptAt: outcome.at,
				lastRunId: outcome.runId ?? t.lastRunId,
				lastSuccessAt: outcome.success ? outcome.at : t.lastSuccessAt,
				consecutiveFailures: failures,
				lastError: outcome.success ? null : { message: outcome.message ?? "the check failed", retryable: outcome.retryable, at: outcome.at },
				nextCheckAt: t.enabled ? new Date(Date.parse(nowIso) + this.nextDelayMs(t, outcome, failures)).toISOString() : null,
				updatedAt: nowIso,
			};
			try {
				await this.store.commit(actor, {
					writes: [{ collection: C.monitoringTargets, id: t.id, value: next as unknown as Record<string, unknown>, ifVersion: t.__version }],
					audit: [{ eventType: "monitoring.check_recorded", entityRef: { type: "monitoring_target", id: t.id }, payload: { firmId: t.firmId, runId: outcome.runId, success: outcome.success, consecutiveFailures: failures, nextCheckAt: next.nextCheckAt, retryable: outcome.retryable } }],
				});
				return "applied";
			} catch (error) {
				if ((error as { code?: string }).code !== "conflict") throw error;
			}
		}
		return "busy";
	}

	// ------------------------------------------------------------------ the cycle

	/** Due targets (enabled, nextCheckAt passed, no live lease) across the given workspaces, oldest first. */
	async due(workspaceIds: string[] | null, at?: string): Promise<MonitoringTarget[]> {
		const nowIso = at ?? this.store.now();
		const all = await this.store.scanAll<MonitoringTarget>(C.monitoringTargets);
		return all
			.filter((t) => (!workspaceIds || workspaceIds.includes(t.workspaceId)) && t.enabled && !!t.nextCheckAt && t.nextCheckAt <= nowIso && (!t.lease || t.lease.expiresAt <= nowIso))
			.sort((a, b) => a.nextCheckAt!.localeCompare(b.nextCheckAt!) || a.id.localeCompare(b.id));
	}

	private systemActor(workspaceId: string): Actor {
		return { principalId: "monitor", displayName: "Monitoring", workspaceId, permissions: ["invest.read", "research.run", "source.manage"] };
	}

	/** Takes the lease with a conditional write. Returns the token, or null if another worker got there first. */
	private async acquire(t: MonitoringTarget): Promise<{ token: string; target: MonitoringTarget } | null> {
		const actor = this.systemActor(t.workspaceId);
		const fresh = await this.get(actor, t.id);
		const now = this.store.now();
		if (!fresh || !fresh.enabled || !fresh.nextCheckAt || fresh.nextCheckAt > now || (fresh.lease && fresh.lease.expiresAt > now)) return null;
		const token = newId("lease");
		const next: MonitoringTarget = { ...fresh, lease: { ownerId: this.ownerId, token, acquiredAt: now, expiresAt: new Date(Date.parse(now) + this.o.leaseMs).toISOString() }, updatedAt: now };
		try {
			await this.store.commit(actor, {
				writes: [{ collection: C.monitoringTargets, id: fresh.id, value: next as unknown as Record<string, unknown>, ifVersion: fresh.__version }],
				audit: [{ eventType: "monitoring.check_started", entityRef: { type: "monitoring_target", id: fresh.id }, payload: { firmId: fresh.firmId, ownerId: this.ownerId, expiresAt: next.lease!.expiresAt } }],
			});
		} catch (error) {
			if ((error as { code?: string }).code === "conflict") return null;
			throw error;
		}
		return { token, target: (await this.get(actor, fresh.id))! };
	}

	private async checkOne(t: MonitoringTarget): Promise<CycleEntry> {
		const entry: CycleEntry = { workspaceId: t.workspaceId, firmId: t.firmId, domain: t.canonicalDomain, result: "ran", runId: null, success: null, message: null };
		const lease = await this.acquire(t);
		if (!lease) return { ...entry, result: "skipped_leased" };
		const actor = this.systemActor(t.workspaceId);
		if (lease.target.kind === "source") return this.checkSource(actor, t, lease, entry);
		const limits: Partial<ResearchLimits> = {};
		if (lease.target.limits.maxPages) limits.maxPages = lease.target.limits.maxPages;
		if (lease.target.limits.maxDepth !== null) limits.maxDepth = lease.target.limits.maxDepth;
		let outcome: RunOutcome;
		try {
			const result = await this.research.research(actor, t.firmId, { limits, verify: true, observer: null });
			entry.runId = result.run.id;
			entry.success = result.run.success;
			outcome = { firmId: t.firmId, runId: result.run.id, at: result.run.completedAt ?? this.store.now(), success: result.run.success, retryable: result.firm.retryable, message: result.run.success ? null : (result.run.outcomeReasons.find((r) => /could not be read|blocked|failed/.test(r)) ?? "the homepage could not be read") };
		} catch (error) {
			const message = (error as Error)?.message?.slice(0, 300) ?? "check failed";
			if (/already running/.test(message)) {
				// A manual refresh is in progress. Not a failure: release the lease and look again soon.
				await this.release(actor, t.firmId, lease.token, 5 * MINUTE);
				return { ...entry, result: "skipped_running", message };
			}
			entry.success = false;
			entry.message = message;
			outcome = { firmId: t.firmId, runId: null, at: this.store.now(), success: false, retryable: true, message };
		}
		const applied = await this.recordOutcome(actor, outcome, lease.token);
		if (applied === "fenced") return { ...entry, result: "fenced", message: "the lease was lost; this result was not applied to the schedule" };
		return { ...entry, result: entry.success === false && !entry.runId ? "failed" : "ran" };
	}

	private async checkSource(actor: Actor, t: MonitoringTarget, lease: { token: string }, entry: CycleEntry): Promise<CycleEntry> {
		if (!this.ingestion) {
			await this.release(actor, t.firmId, lease.token, 5 * MINUTE);
			return { ...entry, result: "failed", message: "source ingestion is not configured in this process" };
		}
		let outcome: RunOutcome;
		try {
			const run = await this.ingestion.runSource(actor, t.firmId, { observer: null });
			entry.runId = run.id;
			entry.success = run.success;
			outcome = { firmId: t.firmId, runId: run.id, at: run.completedAt ?? this.store.now(), success: run.success, retryable: run.error?.retryable ?? false, message: run.error?.message ?? null };
		} catch (error) {
			const message = (error as Error)?.message?.slice(0, 300) ?? "check failed";
			if (/already being retrieved/.test(message)) {
				await this.release(actor, t.firmId, lease.token, 5 * MINUTE);
				return { ...entry, result: "skipped_running", message };
			}
			entry.success = false;
			entry.message = message;
			outcome = { firmId: t.firmId, runId: null, at: this.store.now(), success: false, retryable: true, message };
		}
		const applied = await this.recordOutcome(actor, outcome, lease.token);
		if (applied === "fenced") return { ...entry, result: "fenced", message: "the lease was lost; this result was not applied to the schedule" };
		return { ...entry, result: entry.success === false && !entry.runId ? "failed" : "ran" };
	}

	private async release(actor: Actor, firmId: string, token: string, retryInMs: number) {
		for (let attempt = 0; attempt < 4; attempt++) {
			const t = await this.get(actor, firmId);
			if (!t || t.lease?.token !== token) return;
			try {
				await this.store.commit(actor, {
					writes: [{ collection: C.monitoringTargets, id: t.id, value: { ...t, lease: null, nextCheckAt: new Date(Date.parse(this.store.now()) + retryInMs).toISOString(), updatedAt: this.store.now() } as unknown as Record<string, unknown>, ifVersion: t.__version }],
					audit: [],
				});
				return;
			} catch (error) {
				if ((error as { code?: string }).code !== "conflict") throw error;
			}
		}
	}

	/** Runs one monitoring cycle: every due target once, bounded concurrency, never two workers on one firm. */
	async runCycle(options: { workspaceIds?: string[] | null; limit?: number; dryRun?: boolean } = {}): Promise<CycleReport> {
		const at = this.store.now();
		let due = await this.due(options.workspaceIds ?? null, at);
		const total = due.length;
		if (options.limit) due = due.slice(0, options.limit);
		if (options.dryRun) return { at, due: total, stopped: false, entries: due.map((t) => ({ workspaceId: t.workspaceId, firmId: t.firmId, domain: t.canonicalDomain, result: "would_run", runId: null, success: null, message: null })) };
		const entries: CycleEntry[] = new Array(due.length);
		let next = 0;
		const lanes = Math.max(1, Math.min(this.o.maxConcurrentFirms, due.length || 1));
		await Promise.all(
			Array.from({ length: lanes }, async () => {
				for (;;) {
					if (this.stopping) return;
					const i = next++;
					if (i >= due.length) return;
					const job = this.checkOne(due[i]!);
					this.active.add(job);
					try {
						entries[i] = await job;
					} finally {
						this.active.delete(job);
					}
				}
			}),
		);
		return { at, due: total, stopped: this.stopping, entries: entries.filter(Boolean) };
	}

	// ------------------------------------------------------------------ lifecycle

	/** At boot of the single server process: runs and leases left by a dead process can never finish. */
	async recoverOnStartup(workspaceIds: string[]): Promise<{ runs: number; leases: number }> {
		const runs = await this.research.recoverInterrupted(workspaceIds);
		let leases = 0;
		for (const t of await this.store.scanAll<MonitoringTarget>(C.monitoringTargets)) {
			if (!t.lease || !workspaceIds.includes(t.workspaceId)) continue;
			const actor = this.systemActor(t.workspaceId);
			const fresh = await this.get(actor, t.id);
			if (!fresh?.lease) continue;
			try {
				await this.store.commit(actor, {
					writes: [{ collection: C.monitoringTargets, id: fresh.id, value: { ...fresh, lease: null, nextCheckAt: fresh.enabled ? this.store.now() : null, updatedAt: this.store.now() } as unknown as Record<string, unknown>, ifVersion: fresh.__version }],
					audit: [{ eventType: "monitoring.lease_released", entityRef: { type: "monitoring_target", id: fresh.id }, payload: { firmId: fresh.firmId, reason: "restart", previousOwner: fresh.lease.ownerId } }],
				});
				leases++;
			} catch {
				// Someone else resolved it.
			}
		}
		return { runs, leases };
	}

	/** Stop starting new checks; resolves when the checks in flight have finished (they are bounded by crawl limits). */
	async stop(): Promise<void> {
		this.stopping = true;
		await Promise.allSettled([...this.active]);
	}

	get isStopping() {
		return this.stopping;
	}
}

/** Periodically asks the module to run what is due. Holds no schedule of its own. */
export class MonitoringRunner {
	private timer: ReturnType<typeof setTimeout> | null = null;
	private inFlight: Promise<unknown> | null = null;
	private stopped = false;

	constructor(
		private readonly monitoring: MonitoringModule,
		private readonly workspaceIds: () => string[],
		private readonly log: { info(msg: string, f?: Record<string, unknown>): void; warn(msg: string, f?: Record<string, unknown>): void },
		private readonly tickMs = 60_000,
	) {}

	start() {
		this.stopped = false;
		const loop = () => {
			if (this.stopped) return;
			this.inFlight = this.monitoring
				.runCycle({ workspaceIds: this.workspaceIds() })
				.then((r) => r.entries.length && this.log.info("Monitoring cycle", { due: r.due, ran: r.entries.filter((e) => e.result === "ran").length, failed: r.entries.filter((e) => e.result === "failed").length }))
				.catch((e) => this.log.warn("Monitoring cycle failed", { error: (e as Error).message }))
				.finally(() => {
					this.inFlight = null;
					if (!this.stopped) this.timer = setTimeout(loop, this.tickMs);
				});
		};
		this.timer = setTimeout(loop, 1_000);
	}

	async stop() {
		this.stopped = true;
		if (this.timer) clearTimeout(this.timer);
		await this.monitoring.stop();
		await this.inFlight;
	}
}
