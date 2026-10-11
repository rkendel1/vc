import { newId, newSortableId, sha256Hex } from "../domain/canonical.ts";
import { conflict, forbidden, invalid, notFound, precondition } from "../domain/errors.ts";
import {
	ACCESS_BASES,
	ADAPTER_IDS,
	type Claim,
	type CuratedSource,
	type DatasetMapping,
	type Entity,
	type EntityMatch,
	type EntityRef,
	type MatchDecision,
	type NormalizedRecord,
	type RecordError,
	type SourceRecord,
	type SourceRun,
	type SourceSnapshot,
	type SourceType,
} from "../domain/collab.ts";
import type { EventEvidence, InvestmentEvent, InvestorFirm, MonitoringTarget, ResearchLimits } from "../domain/research.ts";
import type { Actor } from "../domain/types.ts";
import { ADAPTERS, ADAPTER_FETCH, ADAPTER_VERSION } from "../research/adapters.ts";
import { classifyEvent, companyKey, matchEvent } from "../research/events.ts";
import type { PageFetcher } from "../research/fetcher.ts";
import { RESOLVER_VERSION, type PoolEntity, refKey, resolve } from "../research/resolve.ts";
import { normalizeFirmUrl } from "../research/url.ts";
import { C, type InvestStore, type StoreWrite } from "../store/store.ts";
import type { RunOutcome } from "./investor-research.ts";
import { firmIdFor } from "./investor-research.ts";

export type SourceRunObserver = (actor: Actor, outcome: RunOutcome) => Promise<void>;

export type IngestionDeps = {
	store: InvestStore;
	fetcherForSource: (source: CuratedSource, limits: ResearchLimits) => PageFetcher;
	defaults: ResearchLimits;
	maxBytes: number;
	maxRecords: number;
	lookbackDays: number;
};

export type RegisterSourceInput = {
	name: string;
	canonicalUrl: string;
	publisher: string;
	sourceType: SourceType;
	adapter: CuratedSource["adapter"];
	accessBasis: CuratedSource["accessBasis"];
	termsNote: string;
	limitations?: string;
	extraHosts?: string[];
	mapping?: DatasetMapping | null;
	intervalMinutes?: number;
};

const SOURCE_TYPES: SourceType[] = ["directory", "curated_list", "funding_news", "portfolio_aggregator", "dataset"];
const RUNNING_WINDOW_MS = 15 * 60_000;
const CHUNK = 20;
const MAX_ERRORS = 200;

export const sourceIdFor = (workspaceId: string, canonicalUrl: string) => `cs_${sha256Hex(`${workspaceId}|${canonicalUrl}`).slice(0, 32)}`;

function cleanMapping(m: DatasetMapping | null | undefined, adapter: CuratedSource["adapter"]): DatasetMapping | null {
	if (adapter === "funding_news_feed") return null;
	if (!m || typeof m.nameField !== "string" || !m.nameField.trim()) throw invalid("A dataset source needs a mapping with a nameField");
	const out: DatasetMapping = { nameField: m.nameField.trim().slice(0, 80) };
	for (const k of ["recordsPath", "idField", "websiteField", "stageField", "sectorsField", "geographyField", "checkMinField", "checkMaxField", "updatedField", "investorField"] as const) {
		const v = m[k];
		if (v === undefined || v === null || v === "") continue;
		if (typeof v !== "string" || v.length > 80 || /[\u0000-\u001F]/.test(v)) throw invalid(`Mapping ${k} must be a short name`);
		out[k] = v.trim();
	}
	if (m.listDelimiter !== undefined) {
		if (typeof m.listDelimiter !== "string" || m.listDelimiter.length !== 1) throw invalid("listDelimiter must be one character");
		out.listDelimiter = m.listDelimiter;
	}
	if (m.checkUnit !== undefined) {
		if (!["usd", "thousands", "millions"].includes(m.checkUnit)) throw invalid("checkUnit must be usd, thousands or millions");
		out.checkUnit = m.checkUnit;
	}
	if (m.recordKind !== undefined) {
		if (!["investor", "portfolio_company"].includes(m.recordKind)) throw invalid("recordKind must be investor or portfolio_company");
		out.recordKind = m.recordKind;
	}
	if (out.recordKind === "portfolio_company" && !out.investorField) throw invalid("A portfolio_company dataset needs an investorField");
	return out;
}

/**
 * Curated third-party sources: registry, scheduled retrieval through the safe fetcher, adapter
 * normalisation, entity resolution and claim creation. A source failing records its own run as failed
 * and nothing else; partial parses persist what parsed plus per-record errors. Every id is deterministic,
 * so an unchanged document is skipped and a repeated import creates nothing.
 */
export class SourceIngestionModule {
	private observer: SourceRunObserver | null = null;
	private monitoring: { registerSource(actor: Actor, source: CuratedSource, o: { intervalMinutes?: number }): Promise<MonitoringTarget> } | null = null;
	private readonly inflight = new Map<string, Promise<unknown>>();

	constructor(private readonly deps: IngestionDeps) {}

	private get store() {
		return this.deps.store;
	}

	setObserver(o: SourceRunObserver | null) {
		this.observer = o;
	}
	setMonitoring(m: NonNullable<SourceIngestionModule["monitoring"]>) {
		this.monitoring = m;
	}

	// ------------------------------------------------------------------ registry

	async register(actor: Actor, input: RegisterSourceInput): Promise<{ source: CuratedSource; created: boolean }> {
		if (!actor.permissions.includes("source.manage")) throw forbidden("Registering a source needs the source.manage permission");
		const name = input.name?.trim() ?? "";
		const publisher = input.publisher?.trim() ?? "";
		if (name.length < 2 || name.length > 120 || publisher.length < 2 || publisher.length > 120) throw invalid("Name and publisher are required (2–120 characters)");
		if (!SOURCE_TYPES.includes(input.sourceType)) throw invalid("Unknown source type");
		if (!ADAPTER_IDS.includes(input.adapter)) throw invalid("Unknown adapter");
		if (!ACCESS_BASES.includes(input.accessBasis)) throw invalid("State why automated access is permitted: published_terms_permit, public_feed, licensed_dataset or owner_permission");
		const termsNote = input.termsNote?.trim() ?? "";
		if (termsNote.length < 20 || termsNote.length > 2000) throw invalid("Describe the source's terms and where they say automated access is allowed (20–2000 characters)");
		let url: URL;
		try {
			url = new URL(input.canonicalUrl);
			if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) throw new Error("scheme");
			normalizeFirmUrl(url.toString()); // a public domain name, not an IP, a bare suffix or localhost
		} catch {
			throw invalid("canonicalUrl must be a public http(s) URL without credentials");
		}
		// The system never sends credentials, so a secret in the URL could only be stored, shown and logged. Refuse it.
		if ([...url.searchParams.keys()].some((k) => /(token|key|secret|passw|pwd|sig|signature|auth|credential|session)/i.test(k))) throw invalid("The URL carries what looks like a credential in its query string. Sources are read anonymously: use a URL without it.");
		url.hash = "";
		const host = url.hostname.toLowerCase().replace(/^www\./, "");
		const extras: string[] = [];
		for (const h of input.extraHosts ?? []) {
			try {
				extras.push(normalizeFirmUrl(h).canonicalDomain);
			} catch {
				throw invalid(`"${String(h).slice(0, 60)}" is not a usable download host`);
			}
		}
		if (extras.length > 3) throw invalid("At most 3 extra download hosts");
		const mapping = cleanMapping(input.mapping, input.adapter);
		const id = sourceIdFor(actor.workspaceId, url.toString());
		const existing = await this.store.get<CuratedSource>(C.curatedSources, id, actor.workspaceId);
		if (existing) return { source: existing, created: false };
		const now = this.store.now();
		const source: CuratedSource = { id, workspaceId: actor.workspaceId, name, canonicalUrl: url.toString(), publisher, sourceType: input.sourceType, adapter: input.adapter, allowedHosts: [...new Set([host, ...extras])], accessBasis: input.accessBasis, termsNote, limitations: (input.limitations ?? "").trim().slice(0, 2000), mapping, createdAt: now, createdBy: actor.principalId, updatedAt: now };
		try {
			await this.store.commit(actor, {
				writes: [{ collection: C.curatedSources, id, value: source as unknown as Record<string, unknown>, create: true }],
				audit: [{ eventType: "source.registered", entityRef: { type: "curated_source", id }, payload: { sourceId: id, name, publisher, adapter: source.adapter, accessBasis: source.accessBasis, hosts: source.allowedHosts } }],
			});
		} catch (error) {
			if ((error as { code?: string }).code === "conflict") return { source: (await this.get(actor, id)).source, created: false };
			throw error;
		}
		await this.monitoring?.registerSource(actor, source, { intervalMinutes: input.intervalMinutes });
		return { source: (await this.store.get<CuratedSource>(C.curatedSources, id, actor.workspaceId))!, created: true };
	}

	async update(actor: Actor, sourceId: string, patch: { name?: string; termsNote?: string; limitations?: string; mapping?: DatasetMapping | null }): Promise<CuratedSource> {
		if (!actor.permissions.includes("source.manage")) throw forbidden("Changing a source needs the source.manage permission");
		for (let attempt = 0; attempt < 4; attempt++) {
			const s = await this.store.get<CuratedSource>(C.curatedSources, sourceId, actor.workspaceId);
			if (!s) throw notFound("Source");
			const next = { ...s, updatedAt: this.store.now() };
			const changed: string[] = [];
			if (patch.name !== undefined && patch.name.trim() !== s.name) {
				if (patch.name.trim().length < 2) throw invalid("Name is required");
				next.name = patch.name.trim().slice(0, 120);
				changed.push("name");
			}
			if (patch.termsNote !== undefined && patch.termsNote.trim() !== s.termsNote) {
				if (patch.termsNote.trim().length < 20) throw invalid("Describe the source's terms (20+ characters)");
				next.termsNote = patch.termsNote.trim().slice(0, 2000);
				changed.push("termsNote");
			}
			if (patch.limitations !== undefined && patch.limitations.trim() !== s.limitations) {
				next.limitations = patch.limitations.trim().slice(0, 2000);
				changed.push("limitations");
			}
			if (patch.mapping !== undefined) {
				const m = cleanMapping(patch.mapping, s.adapter);
				if (JSON.stringify(m) !== JSON.stringify(s.mapping)) {
					next.mapping = m;
					changed.push("mapping");
				}
			}
			if (!changed.length) return s;
			try {
				await this.store.commit(actor, { writes: [{ collection: C.curatedSources, id: s.id, value: next as unknown as Record<string, unknown>, ifVersion: s.__version }], audit: [{ eventType: "source.updated", entityRef: { type: "curated_source", id: s.id }, payload: { sourceId: s.id, changed } }] });
				return (await this.store.get<CuratedSource>(C.curatedSources, s.id, actor.workspaceId))!;
			} catch (error) {
				if ((error as { code?: string }).code !== "conflict") throw error;
			}
		}
		throw conflict("The source is changing too quickly; retry");
	}

	async get(actor: Actor, sourceId: string) {
		const source = await this.store.get<CuratedSource>(C.curatedSources, sourceId, actor.workspaceId);
		if (!source) throw notFound("Source");
		const ws = actor.workspaceId;
		const [runs, snapshots, records, target] = await Promise.all([
			this.store.list<SourceRun>(C.sourceRuns, ws, { sourceId }),
			this.store.list<SourceSnapshot>(C.sourceSnapshots, ws, { sourceId }),
			this.store.list<SourceRecord>(C.sourceRecords, ws, { sourceId }),
			this.store.get<MonitoringTarget>(C.monitoringTargets, sourceId, ws),
		]);
		runs.sort((a, b) => b.startedAt.localeCompare(a.startedAt) || b.id.localeCompare(a.id));
		const latest = new Map<string, SourceRecord>();
		for (const r of records) if (!latest.has(r.identity) || latest.get(r.identity)!.version < r.version) latest.set(r.identity, r);
		const matches = await this.store.list<EntityMatch>(C.entityMatches, ws);
		const byRecord = new Map<string, EntityMatch[]>();
		for (const m of matches) byRecord.set(m.recordId, [...(byRecord.get(m.recordId) ?? []), m]);
		const tally = { matched: 0, candidate_match: 0, unmatched: 0 };
		for (const r of latest.values()) for (const m of byRecord.get(r.id) ?? []) tally[m.status]++;
		return { source, target, runs: runs.slice(0, 20), snapshots: snapshots.sort((a, b) => b.firstRetrievedAt.localeCompare(a.firstRetrievedAt)).slice(0, 10), recordCount: latest.size, tally, lastRun: runs[0] ?? null };
	}

	async list(actor: Actor) {
		const [sources, targets, runs] = await Promise.all([this.store.list<CuratedSource>(C.curatedSources, actor.workspaceId), this.store.list<MonitoringTarget>(C.monitoringTargets, actor.workspaceId), this.store.list<SourceRun>(C.sourceRuns, actor.workspaceId)]);
		const target = new Map(targets.filter((t) => t.kind === "source").map((t) => [t.id, t]));
		return sources
			.map((s) => {
				const mine = runs.filter((r) => r.sourceId === s.id).sort((a, b) => b.startedAt.localeCompare(a.startedAt) || b.id.localeCompare(a.id));
				return { source: s, target: target.get(s.id) ?? null, lastRun: mine[0] ?? null, lastSuccessfulRun: mine.find((r) => r.success) ?? null };
			})
			.sort((a, b) => a.source.name.localeCompare(b.source.name));
	}

	// ------------------------------------------------------------------ runs

	async beginRun(actor: Actor, sourceId: string): Promise<{ source: CuratedSource; run: SourceRun }> {
		const source = await this.store.get<CuratedSource>(C.curatedSources, sourceId, actor.workspaceId);
		if (!source) throw notFound("Source");
		const recent = (await this.store.list<SourceRun>(C.sourceRuns, actor.workspaceId, { sourceId })).find((r) => r.status === "running" && Date.parse(r.startedAt) > Date.parse(this.store.now()) - RUNNING_WINDOW_MS);
		if (recent || this.inflight.has(sourceId)) throw precondition("This source is already being retrieved");
		const prior = await this.store.list<SourceSnapshot>(C.sourceSnapshots, actor.workspaceId, { sourceId });
		const run: SourceRun = { id: newSortableId("sr"), workspaceId: actor.workspaceId, sourceId, status: "running", startedAt: this.store.now(), completedAt: null, startedBy: actor.principalId, adapter: source.adapter, adapterVersion: ADAPTER_VERSION, fetchOutcome: null, snapshotId: null, change: null, success: false, counts: { records: 0, newRecords: 0, changedRecords: 0, matched: 0, candidates: 0, unmatched: 0, claims: 0, events: 0, errors: 0 }, errors: [], error: null, baseline: prior.length === 0 };
		await this.store.commit(actor, { writes: [{ collection: C.sourceRuns, id: run.id, value: run as unknown as Record<string, unknown>, create: true }], audit: [{ eventType: "source.run_started", entityRef: { type: "source_run", id: run.id }, payload: { sourceId, runId: run.id, adapter: source.adapter } }] });
		return { source, run: (await this.store.get<SourceRun>(C.sourceRuns, run.id, actor.workspaceId))! };
	}

	async runSource(actor: Actor, sourceId: string, options: { observer?: SourceRunObserver | null } = {}): Promise<SourceRun> {
		const { source, run } = await this.beginRun(actor, sourceId);
		return this.execute(actor, source, run, options.observer);
	}

	async startRefresh(actor: Actor, sourceId: string): Promise<SourceRun> {
		if (!actor.permissions.includes("source.manage")) throw forbidden("Refreshing a source needs the source.manage permission");
		const { source, run } = await this.beginRun(actor, sourceId);
		const task = this.execute(actor, source, run).catch(() => undefined).finally(() => this.inflight.delete(sourceId));
		this.inflight.set(sourceId, task);
		return run;
	}

	async settled() {
		while (this.inflight.size) await Promise.allSettled([...this.inflight.values()]);
	}

	async recoverInterrupted(workspaceIds: string[]): Promise<number> {
		let n = 0;
		for (const workspaceId of workspaceIds) {
			const actor: Actor = { principalId: "system", displayName: "system", workspaceId, permissions: [] };
			for (const run of (await this.store.list<SourceRun>(C.sourceRuns, workspaceId)).filter((r) => r.status === "running")) {
				try {
					await this.store.commit(actor, { writes: [{ collection: C.sourceRuns, id: run.id, value: { ...run, status: "failed", completedAt: this.store.now(), error: { message: "Interrupted by a restart before it finished", retryable: true } } as unknown as Record<string, unknown>, ifVersion: run.__version }], audit: [{ eventType: "source.run_failed", entityRef: { type: "source_run", id: run.id }, payload: { sourceId: run.sourceId, runId: run.id, reason: "interrupted by restart" } }] });
					n++;
				} catch {
					// resolved elsewhere
				}
			}
		}
		return n;
	}

	private async notify(actor: Actor, outcome: RunOutcome, override?: SourceRunObserver | null) {
		const o = override === undefined ? this.observer : override;
		if (!o) return;
		try {
			await o(actor, outcome);
		} catch {
			// scheduling bookkeeping never fails a recorded run
		}
	}

	private async finish(actor: Actor, run: SourceRun, patch: Partial<SourceRun>, extra: StoreWrite[] = [], audit: { eventType: string; entityRef: { type: string; id: string }; payload: Record<string, unknown> }[] = []) {
		for (let attempt = 0; attempt < 4; attempt++) {
			const cur = await this.store.get<SourceRun>(C.sourceRuns, run.id, actor.workspaceId);
			if (!cur) throw notFound("Run");
			try {
				await this.store.commit(actor, { writes: [...extra, { collection: C.sourceRuns, id: run.id, value: { ...cur, ...patch, completedAt: this.store.now() } as unknown as Record<string, unknown>, ifVersion: cur.__version }], audit });
				return (await this.store.get<SourceRun>(C.sourceRuns, run.id, actor.workspaceId))!;
			} catch (error) {
				if ((error as { code?: string }).code !== "conflict") throw error;
			}
		}
		throw conflict("Could not record the source run");
	}

	private async execute(actor: Actor, source: CuratedSource, run: SourceRun, observer?: SourceRunObserver | null): Promise<SourceRun> {
		try {
			const done = await this.ingest(actor, source, run);
			await this.notify(actor, { firmId: source.id, runId: done.id, at: done.completedAt ?? this.store.now(), success: done.success, retryable: done.error?.retryable ?? false, message: done.error?.message ?? null }, observer);
			return done;
		} catch (error) {
			const message = (error as Error)?.message?.slice(0, 300) ?? "ingestion failed";
			await this.finish(actor, run, { status: "failed", success: false, error: { message, retryable: true } }, [], [{ eventType: "source.run_failed", entityRef: { type: "source_run", id: run.id }, payload: { sourceId: source.id, runId: run.id, reason: message } }]).catch(() => undefined);
			await this.notify(actor, { firmId: source.id, runId: run.id, at: this.store.now(), success: false, retryable: true, message }, observer);
			throw error;
		}
	}

	// ------------------------------------------------------------------ the pipeline

	private async ingest(actor: Actor, source: CuratedSource, run: SourceRun): Promise<SourceRun> {
		const ws = actor.workspaceId;
		const limits: ResearchLimits = { ...this.deps.defaults, maxBytes: this.deps.maxBytes };
		const fetcher = this.deps.fetcherForSource(source, limits);
		const mode = ADAPTER_FETCH[source.adapter];
		const fetched = await fetcher.fetchPage(source.canonicalUrl, mode === "feed" ? { feed: true } : { data: true });
		if (fetched.outcome !== "ok" || fetched.body === null) {
			const transient = ["timeout", "network_error", "http_error", "too_large"].includes(fetched.outcome);
			const message = `${fetched.outcome}${fetched.detail ? `: ${fetched.detail}` : ""}`;
			return this.finish(actor, run, { status: "completed", success: false, fetchOutcome: fetched.outcome, error: { message, retryable: transient && fetched.outcome !== "too_large" } }, [], [{ eventType: "source.run_completed", entityRef: { type: "source_run", id: run.id }, payload: { sourceId: source.id, runId: run.id, success: false, fetchOutcome: fetched.outcome } }]);
		}
		const normalizedBody = fetched.body.replace(/\r\n?/g, "\n").split("\n").map((l) => l.trim()).filter(Boolean).join("\n");
		const normalizedHash = `sha256:${sha256Hex([normalizedBody, ADAPTER_VERSION, RESOLVER_VERSION, JSON.stringify(source.mapping)].join("\u0000"))}`;
		const snapshots = (await this.store.list<SourceSnapshot>(C.sourceSnapshots, ws, { sourceId: source.id })).sort((a, b) => b.firstRetrievedAt.localeCompare(a.firstRetrievedAt));
		const snapshotId = `snap_${sha256Hex(`${source.id}|${normalizedHash}`).slice(0, 32)}`;
		const same = snapshots.find((s) => s.id === snapshotId);
		if (same && snapshots[0]?.id === snapshotId) {
			return this.finish(actor, run, { status: "completed", success: true, fetchOutcome: "ok", snapshotId, change: "unchanged" }, [], [{ eventType: "source.run_completed", entityRef: { type: "source_run", id: run.id }, payload: { sourceId: source.id, runId: run.id, success: true, change: "unchanged" } }]);
		}
		const parsed = ADAPTERS[source.adapter].parse({ body: fetched.body, contentType: fetched.contentType, url: fetched.finalUrl, mapping: source.mapping });
		let records = parsed.records;
		const errors: RecordError[] = [...parsed.errors];
		if (records.length > this.deps.maxRecords) {
			errors.push({ index: this.deps.maxRecords, message: `record limit reached: ${records.length - this.deps.maxRecords} record(s) not processed (SOURCES_MAX_RECORDS)` });
			records = records.slice(0, this.deps.maxRecords);
		}
		const snapshot: SourceSnapshot = { id: snapshotId, workspaceId: ws, sourceId: source.id, url: fetched.finalUrl, contentType: fetched.contentType, contentHash: `sha256:${sha256Hex(fetched.body)}`, normalizedHash, bytes: Buffer.byteLength(fetched.body), recordCount: records.length, firstRetrievedAt: this.store.now(), firstRunId: run.id };
		if (!records.length) {
			const message = `no records could be parsed${errors[0] ? `: ${errors[0].message}` : ""}`;
			return this.finish(actor, run, { status: "completed", success: false, fetchOutcome: "ok", snapshotId, change: snapshots.length ? "changed" : "new", errors: errors.slice(0, MAX_ERRORS), counts: { ...run.counts, errors: errors.length }, error: { message, retryable: false } }, same ? [] : [{ collection: C.sourceSnapshots, id: snapshot.id, value: snapshot as unknown as Record<string, unknown>, create: true }], [{ eventType: "source.run_completed", entityRef: { type: "source_run", id: run.id }, payload: { sourceId: source.id, runId: run.id, success: false, reason: "no records" } }]);
		}
		if (!same) await this.store.commit(actor, { writes: [{ collection: C.sourceSnapshots, id: snapshot.id, value: snapshot as unknown as Record<string, unknown>, create: true }], audit: [] }).catch((e) => { if ((e as { code?: string }).code !== "conflict") throw e; });

		const counts = { ...run.counts, records: records.length, errors: errors.length };
		const priorRecords = await this.store.list<SourceRecord>(C.sourceRecords, ws, { sourceId: source.id });
		const latest = new Map<string, SourceRecord>();
		for (const r of priorRecords) if (!latest.has(r.identity) || latest.get(r.identity)!.version < r.version) latest.set(r.identity, r);

		const ctx = await this.resolutionContext(actor);
		for (let i = 0; i < records.length; i += CHUNK) {
			const chunk = records.slice(i, i + CHUNK);
			for (let attempt = 0; attempt < 4; attempt++) {
				try {
					await this.processChunk(actor, source, run, snapshot, chunk, latest, ctx, counts);
					break;
				} catch (error) {
					if ((error as { code?: string }).code !== "conflict" || attempt === 3) throw error;
					Object.assign(ctx, await this.resolutionContext(actor));
				}
			}
		}
		const partial = errors.length > 0;
		return this.finish(actor, run, { status: "completed", success: true, fetchOutcome: "ok", snapshotId, change: snapshots.length ? "changed" : "new", errors: errors.slice(0, MAX_ERRORS), counts }, [], [{ eventType: "source.run_completed", entityRef: { type: "source_run", id: run.id }, payload: { sourceId: source.id, runId: run.id, success: true, partial, ...counts } }]);
	}

	private async resolutionContext(actor: Actor) {
		const ws = actor.workspaceId;
		const [firms, entities, decisions] = await Promise.all([this.store.list<InvestorFirm>(C.firms, ws), this.store.list<Entity>(C.entities, ws), this.store.list<MatchDecision>(C.matchDecisions, ws)]);
		return { firms, entities, decisions };
	}

	private poolOf(ctx: { firms: InvestorFirm[]; entities: Entity[]; decisions: MatchDecision[] }): PoolEntity[] {
		const confirmedFor = new Map<string, string[]>();
		for (const d of ctx.decisions.filter((d) => d.decision === "confirm")) confirmedFor.set(refKey(d.entity), [...(confirmedFor.get(refKey(d.entity)) ?? []), companyKey(d.subjectName)]);
		const firms: PoolEntity[] = ctx.firms.map((f) => ({ ref: { type: "firm", id: f.id }, kind: "firm", name: f.name, key: companyKey(f.name), domain: f.canonicalDomain, aliasKeys: (f.aliases ?? []).map(companyKey), confirmedAliasKeys: [...(f.aliases ?? []).map(companyKey), ...(confirmedFor.get(`firm:${f.id}`) ?? [])], externalIds: f.externalIds ?? [] }));
		const entities: PoolEntity[] = ctx.entities.map((e) => ({ ref: { type: "entity", id: e.id }, kind: e.kind, name: e.canonicalName, key: e.key, domain: e.domain, aliasKeys: e.aliases.map(companyKey), confirmedAliasKeys: confirmedFor.get(`entity:${e.id}`) ?? [], externalIds: e.externalIds }));
		return [...firms, ...entities];
	}

	private rejectedFor(ctx: { decisions: MatchDecision[] }, identity: string, subjectName: string): Set<string> {
		const key = companyKey(subjectName);
		return new Set(ctx.decisions.filter((d) => d.decision === "reject" && (d.recordId === identity || companyKey(d.subjectName) === key)).map((d) => refKey(d.entity)));
	}

	private async processChunk(actor: Actor, source: CuratedSource, run: SourceRun, snapshot: SourceSnapshot, chunk: NormalizedRecord[], latest: Map<string, SourceRecord>, ctx: { firms: InvestorFirm[]; entities: Entity[]; decisions: MatchDecision[] }, counts: SourceRun["counts"]) {
		const ws = actor.workspaceId;
		const now = this.store.now();
		const writes: StoreWrite[] = [];
		const audit: { eventType: string; entityRef: { type: string; id: string }; payload: Record<string, unknown> }[] = [];
		const claimedIds = new Set<string>();
		const entityWrites = new Map<string, Entity>();
		const firmUpdates = new Map<string, InvestorFirm>();
		const tally = { newRecords: 0, changedRecords: 0, matched: 0, candidates: 0, unmatched: 0, claims: 0, events: 0 };
		const pool = () => this.poolOf({ ...ctx, entities: [...ctx.entities.filter((e) => !entityWrites.has(e.id)), ...entityWrites.values()] });
		const events = await this.store.list<InvestmentEvent>(C.investmentEvents, ws);
		const evidenceIds = new Set((await this.store.list<EventEvidence>(C.eventEvidence, ws)).map((e) => e.id));
		const newEvents: InvestmentEvent[] = [];

		for (const rec of chunk) {
			const identity = rec.externalId ? `ext:${rec.externalId}` : rec.contentKey;
			const recordHash = sha256Hex(JSON.stringify({ ...rec, notes: undefined })).slice(0, 40);
			const prior = latest.get(identity);
			if (prior && prior.recordHash === recordHash) continue;
			const record: SourceRecord = { ...rec, identity, id: `srv_${sha256Hex(`${source.id}|${identity}|${recordHash}`).slice(0, 32)}`, workspaceId: ws, sourceId: source.id, snapshotId: snapshot.id, runId: run.id, recordHash, version: (prior?.version ?? 0) + 1, supersedesId: prior?.id ?? null, retrievedAt: now, baseline: run.baseline };
			writes.push({ collection: C.sourceRecords, id: record.id, value: record as unknown as Record<string, unknown>, create: true });
			latest.set(identity, record);
			if (prior) tally.changedRecords++;
			else tally.newRecords++;

			// Subjects to resolve: the record's own entity, or every investor an announcement names.
			type Subject = { subject: "investor" | "company"; name: string; role: EntityMatch["subjectRole"]; domain: string | null; externalId: string | null; aliases: string[] };
			const subjects: Subject[] = [];
			if (rec.kind === "investor") subjects.push({ subject: "investor", name: rec.name, role: "record", domain: rec.website, externalId: rec.externalId, aliases: rec.aliases });
			else if (rec.kind === "portfolio_company") {
				subjects.push({ subject: "company", name: rec.name, role: "record", domain: rec.website, externalId: rec.externalId, aliases: rec.aliases });
				if (rec.investorName) subjects.push({ subject: "investor", name: rec.investorName, role: "record", domain: null, externalId: null, aliases: [] });
			} else if (rec.announcement) {
				subjects.push({ subject: "company", name: rec.announcement.company, role: "record", domain: null, externalId: null, aliases: [] });
				for (const inv of rec.announcement.investors) subjects.push({ subject: "investor", name: inv.name, role: inv.role, domain: null, externalId: null, aliases: [] });
			}
			const resolved: { subject: Subject; match: EntityMatch }[] = [];
			for (const sub of subjects) {
				const res = resolve({ subject: sub.subject, name: sub.name, domain: sub.domain, sourceId: source.id, externalId: sub.externalId, aliases: sub.aliases }, pool(), this.rejectedFor(ctx, identity, sub.name));
				const confirmed = ctx.decisions.filter((d) => d.decision === "confirm" && (d.recordId === identity || companyKey(d.subjectName) === companyKey(sub.name)));
				let status = res.status;
				let entity = res.entity;
				const reasons = [...res.reasons];
				if (status !== "matched" && confirmed.length) {
					const last = confirmed.sort((a, b) => b.decidedAt.localeCompare(a.decidedAt))[0]!;
					status = "matched";
					entity = last.entity;
					reasons.unshift("confirmed by a reviewer");
				}
				let ref = entity;
				if (status === "unmatched") {
					const ent: Entity = { id: `en_${sha256Hex(`${ws}|${sub.subject}|${companyKey(sub.name)}|${source.id}|${sub.externalId ?? ""}`).slice(0, 32)}`, workspaceId: ws, kind: sub.subject === "company" ? "company" : "firm", canonicalName: clip(sub.name, 120), key: companyKey(sub.name), domain: sub.domain, aliases: [], externalIds: sub.externalId ? [{ sourceId: source.id, id: sub.externalId }] : [], urls: [], createdFromRecordId: record.id, createdAt: now, updatedAt: now };
					if (!ctx.entities.some((e) => e.id === ent.id) && !entityWrites.has(ent.id)) {
						entityWrites.set(ent.id, ent);
						writes.push({ collection: C.entities, id: ent.id, value: ent as unknown as Record<string, unknown>, create: true });
						audit.push({ eventType: "entity.created", entityRef: { type: "entity", id: ent.id }, payload: { entityId: ent.id, kind: ent.kind, name: ent.canonicalName, sourceId: source.id, recordId: record.id } });
					}
					ref = { type: "entity", id: ent.id };
				}
				if (status === "matched" && ref && sub.externalId) {
					// A strong match teaches the entity this source's identifier, so the next sighting needs no name at all.
					if (ref.type === "firm") {
						const f = firmUpdates.get(ref.id) ?? ctx.firms.find((x) => x.id === ref!.id);
						if (f && !(f.externalIds ?? []).some((x) => x.sourceId === source.id && x.id === sub.externalId)) {
							const nf = { ...f, externalIds: [...(f.externalIds ?? []), { sourceId: source.id, id: sub.externalId }], updatedAt: now };
							firmUpdates.set(f.id, nf);
							audit.push({ eventType: "entity.identity_added", entityRef: { type: "investor_firm", id: f.id }, payload: { firmId: f.id, externalIdSource: source.id } });
						}
					}
				}
				const match: EntityMatch = { id: `em_${sha256Hex([record.id, sub.subject, sub.name, sub.role, RESOLVER_VERSION, status, ref ? refKey(ref) : "", res.candidates.map((c) => refKey(c.ref)).join(",")].join("|")).slice(0, 32)}`, workspaceId: ws, recordId: record.id, subject: sub.subject, subjectName: clip(sub.name, 120), subjectRole: sub.role, status, entity: ref, candidates: res.candidates.slice(0, 8), reasons, runId: run.id, resolverVersion: RESOLVER_VERSION, resolvedAt: now };
				writes.push({ collection: C.entityMatches, id: match.id, value: match as unknown as Record<string, unknown>, create: true });
				if (status === "matched") tally.matched++;
				else if (status === "candidate_match") {
					tally.candidates++;
					audit.push({ eventType: "match.proposed", entityRef: { type: "entity_match", id: match.id }, payload: { matchId: match.id, recordId: record.id, name: match.subjectName, candidates: match.candidates.length } });
				} else tally.unmatched++;
				resolved.push({ subject: sub, match });
			}

			// Claims and events only for investors matched to a monitored firm.
			for (const { subject, match } of resolved) {
				if (subject.subject !== "investor" || match.status !== "matched" || match.entity?.type !== "firm") continue;
				const firmId = match.entity.id;
				if (rec.kind === "investor") {
					for (const c of rec.criteria) {
						const claim: Claim = { id: `cl_${sha256Hex([record.id, firmId, c.field, c.polarity, c.value].join("|")).slice(0, 32)}`, workspaceId: ws, firmId, field: c.field, polarity: c.polarity, value: c.value, valueRange: c.valueRange, label: c.label, category: "third_party_source", assertionType: "explicit", origin: { sourceRecordId: record.id, sourceId: source.id }, publisher: source.publisher, passage: rec.passage, publishedAt: rec.publishedAt, capturedAt: now, runId: run.id, matchId: match.id, extractorVersion: ADAPTER_VERSION };
						if (claimedIds.has(claim.id)) continue;
						claimedIds.add(claim.id);
						writes.push({ collection: C.claims, id: claim.id, value: claim as unknown as Record<string, unknown>, create: true });
						tally.claims++;
					}
				} else if (rec.announcement || rec.kind === "portfolio_company") {
					const a = rec.announcement;
					const company = a?.company ?? rec.name;
					const cKey = companyKey(company);
					const evidenceId = `evd_${sha256Hex([firmId, record.id, cKey].join("|")).slice(0, 32)}`;
					if (evidenceIds.has(evidenceId)) continue;
					const type = a?.type ?? "portfolio_addition";
					const cand = { companyKey: cKey, type, announcedAt: a?.announcedAt ?? null, publishedAt: rec.publishedAt };
					const firmEvents = [...events.filter((e) => e.firmId === firmId), ...newEvents.filter((e) => e.firmId === firmId)];
					const m = matchEvent(cand, firmEvents);
					const detail = { sourceId: record.id, url: rec.sourceUrl, passage: rec.passage, passageHash: sha256Hex(rec.passage), publishedAt: rec.publishedAt, announcedAt: a?.announcedAt ?? null, type, round: a?.round ?? null, roundAmountUsd: a?.roundAmountUsd ?? null, firmAmountUsd: null };
					let eventId: string;
					if (m.kind === "same") eventId = m.event.id;
					else {
						const effective = detail.announcedAt ?? detail.publishedAt;
						const cls = type === "portfolio_addition" ? "undated" : classifyEvent(effective, now, this.deps.lookbackDays);
						if (cls === "out_of_window") continue;
						const event: InvestmentEvent = { id: `ev_${sha256Hex(`${firmId}|${evidenceId}`).slice(0, 32)}`, workspaceId: ws, firmId, type, companyName: clip(company, 80), companyKey: cKey, companyUrl: null, companyMatch: m.kind === "uncertain" ? { status: "uncertain", candidateEventIds: m.candidates.map((c) => c.id) } : { status: "unique", candidateEventIds: [] }, round: detail.round, roundAmountUsd: detail.roundAmountUsd, firmAmountUsd: null, amountSourceStated: detail.roundAmountUsd !== null, involvement: "implied_by_source", announcedAt: detail.announcedAt, earliestPublishedAt: rec.publishedAt, discoveredAt: now, discoveryRunId: run.id, classification: cls, extractorVersion: ADAPTER_VERSION, baseline: run.baseline };
						writes.push({ collection: C.investmentEvents, id: event.id, value: event as unknown as Record<string, unknown>, create: true });
						newEvents.push(event);
						eventId = event.id;
						tally.events++;
						audit.push({ eventType: "research.event_discovered", entityRef: { type: "investment_event", id: event.id }, payload: { firmId, eventId: event.id, company: event.companyName, type, classification: cls, source: source.publisher, category: "third_party_source" } });
					}
					const ev: EventEvidence = { id: evidenceId, workspaceId: ws, firmId, eventId, sourceId: detail.sourceId, url: detail.url, passage: detail.passage, passageHash: detail.passageHash, publishedAt: detail.publishedAt, announcedAt: detail.announcedAt, type: detail.type, round: detail.round, roundAmountUsd: detail.roundAmountUsd, firmAmountUsd: null, runId: run.id, discoveredAt: now, category: "third_party_source", publisher: source.publisher };
					writes.push({ collection: C.eventEvidence, id: ev.id, value: ev as unknown as Record<string, unknown>, create: true });
					evidenceIds.add(ev.id);
				}
			}
		}
		for (const f of firmUpdates.values()) writes.push({ collection: C.firms, id: f.id, value: f as unknown as Record<string, unknown>, ifVersion: f.__version });
		if (!writes.length) return;
		// A deterministic id that already exists means a concurrent identical write: drop it, keep the rest.
		const filtered: StoreWrite[] = [];
		for (const w of writes) {
			if (w.create && (await this.store.get(w.collection, w.id, ws))) continue;
			filtered.push(w);
		}
		if (filtered.length) await this.store.commit(actor, { writes: filtered, audit });
		for (const e of entityWrites.values()) if (!ctx.entities.some((x) => x.id === e.id)) ctx.entities.push(e);
		for (const f of firmUpdates.values()) ctx.firms = ctx.firms.map((x) => (x.id === f.id ? f : x));
		counts.newRecords += tally.newRecords;
		counts.changedRecords += tally.changedRecords;
		counts.matched += tally.matched;
		counts.candidates += tally.candidates;
		counts.unmatched += tally.unmatched;
		counts.claims += tally.claims;
		counts.events += tally.events;
	}

	// ------------------------------------------------------------------ human decisions on matches

	async decideMatch(actor: Actor, input: { matchId: string; decision: "confirm" | "reject"; entity: EntityRef; rationale: string }): Promise<MatchDecision> {
		if (!actor.permissions.includes("review.write")) throw forbidden("Deciding a match needs the review.write permission");
		const match = await this.store.get<EntityMatch>(C.entityMatches, input.matchId, actor.workspaceId);
		if (!match) throw notFound("Match");
		const rationale = input.rationale?.trim() ?? "";
		if (rationale.length < 5 || rationale.length > 2000) throw invalid("A rationale of 5–2000 characters is required");
		const known = match.candidates.some((c) => refKey(c.ref) === refKey(input.entity)) || (match.entity && refKey(match.entity) === refKey(input.entity));
		if (!known) throw invalid("The entity is not one of this match's candidates");
		if (input.entity.type === "firm" ? !(await this.store.get(C.firms, input.entity.id, actor.workspaceId)) : !(await this.store.get(C.entities, input.entity.id, actor.workspaceId))) throw notFound("Entity");
		const record = await this.store.get<SourceRecord>(C.sourceRecords, match.recordId, actor.workspaceId);
		const decision: MatchDecision = { id: newSortableId("md"), workspaceId: actor.workspaceId, matchId: match.id, recordId: record?.identity ?? match.recordId, decision: input.decision, entity: input.entity, rationale, evidenceRecordIds: [match.recordId], decidedBy: actor.principalId, decidedAt: this.store.now(), subjectName: match.subjectName };
		const writes: StoreWrite[] = [{ collection: C.matchDecisions, id: decision.id, value: decision as unknown as Record<string, unknown>, create: true }];
		const audit = [{ eventType: input.decision === "confirm" ? "match.confirmed" : "match.rejected", entityRef: { type: "entity_match", id: match.id }, payload: { matchId: match.id, recordId: match.recordId, name: match.subjectName, entity: refKey(input.entity), rationale } }];
		// A confirmed firm match teaches the firm the alias; nothing is merged and nothing is deleted.
		if (input.decision === "confirm" && input.entity.type === "firm") {
			const f = await this.store.get<InvestorFirm>(C.firms, input.entity.id, actor.workspaceId);
			if (f && !(f.aliases ?? []).some((a) => companyKey(a) === companyKey(match.subjectName)) && companyKey(f.name) !== companyKey(match.subjectName)) writes.push({ collection: C.firms, id: f.id, value: { ...f, aliases: [...(f.aliases ?? []), match.subjectName], updatedAt: this.store.now() } as unknown as Record<string, unknown>, ifVersion: f.__version });
		}
		await this.store.commit(actor, { writes, audit });
		if (input.decision === "confirm" && match.subject === "investor" && input.entity.type === "firm" && record) await this.applyConfirmed(actor, record, match, input.entity.id);
		return decision;
	}

	/** After a person links a record to a firm, the record's claims and events are created as if it had matched. Idempotent: ids are deterministic. */
	private async applyConfirmed(actor: Actor, record: SourceRecord, match: EntityMatch, firmId: string) {
		const ws = actor.workspaceId;
		const source = await this.store.get<CuratedSource>(C.curatedSources, record.sourceId, ws);
		if (!source) return;
		const now = this.store.now();
		const writes: StoreWrite[] = [];
		if (record.kind === "investor") {
			for (const c of record.criteria) {
				const id = `cl_${sha256Hex([record.id, firmId, c.field, c.polarity, c.value].join("|")).slice(0, 32)}`;
				if (await this.store.get(C.claims, id, ws)) continue;
				const claim: Claim = { id, workspaceId: ws, firmId, field: c.field, polarity: c.polarity, value: c.value, valueRange: c.valueRange, label: c.label, category: "third_party_source", assertionType: "explicit", origin: { sourceRecordId: record.id, sourceId: source.id }, publisher: source.publisher, passage: record.passage, publishedAt: record.publishedAt, capturedAt: now, runId: record.runId, matchId: match.id, extractorVersion: ADAPTER_VERSION };
				writes.push({ collection: C.claims, id, value: claim as unknown as Record<string, unknown>, create: true });
			}
		} else if (record.announcement || record.kind === "portfolio_company") {
			const a = record.announcement;
			const company = a?.company ?? record.name;
			const cKey = companyKey(company);
			const evidenceId = `evd_${sha256Hex([firmId, record.id, cKey].join("|")).slice(0, 32)}`;
			if (!(await this.store.get(C.eventEvidence, evidenceId, ws))) {
				const events = (await this.store.list<InvestmentEvent>(C.investmentEvents, ws)).filter((e) => e.firmId === firmId);
				const type = a?.type ?? "portfolio_addition";
				const m = matchEvent({ companyKey: cKey, type, announcedAt: a?.announcedAt ?? null, publishedAt: record.publishedAt }, events);
				let eventId: string | null = m.kind === "same" ? m.event.id : null;
				const cls = type === "portfolio_addition" ? "undated" : classifyEvent(a?.announcedAt ?? record.publishedAt, now, this.deps.lookbackDays);
				if (!eventId && cls !== "out_of_window") {
					const event: InvestmentEvent = { id: `ev_${sha256Hex(`${firmId}|${evidenceId}`).slice(0, 32)}`, workspaceId: ws, firmId, type, companyName: clip(company, 80), companyKey: cKey, companyUrl: null, companyMatch: m.kind === "uncertain" ? { status: "uncertain", candidateEventIds: m.candidates.map((c) => c.id) } : { status: "unique", candidateEventIds: [] }, round: a?.round ?? null, roundAmountUsd: a?.roundAmountUsd ?? null, firmAmountUsd: null, amountSourceStated: (a?.roundAmountUsd ?? null) !== null, involvement: "implied_by_source", announcedAt: a?.announcedAt ?? null, earliestPublishedAt: record.publishedAt, discoveredAt: now, discoveryRunId: record.runId, classification: cls, extractorVersion: ADAPTER_VERSION, baseline: false };
					writes.push({ collection: C.investmentEvents, id: event.id, value: event as unknown as Record<string, unknown>, create: true });
					eventId = event.id;
				}
				if (eventId) writes.push({ collection: C.eventEvidence, id: evidenceId, value: { id: evidenceId, workspaceId: ws, firmId, eventId, sourceId: record.id, url: record.sourceUrl, passage: record.passage, passageHash: sha256Hex(record.passage), publishedAt: record.publishedAt, announcedAt: a?.announcedAt ?? null, type, round: a?.round ?? null, roundAmountUsd: a?.roundAmountUsd ?? null, firmAmountUsd: null, runId: record.runId, discoveredAt: now, category: "third_party_source", publisher: source.publisher } as unknown as Record<string, unknown>, create: true });
			}
		}
		if (writes.length) await this.store.commit(actor, { writes, audit: [{ eventType: "match.applied", entityRef: { type: "entity_match", id: match.id }, payload: { matchId: match.id, firmId, recordId: record.id, writes: writes.length } }] });
	}

	/** Matches awaiting a person: candidate matches whose record has no decision yet. Unmatched are listed separately. */
	async openMatches(actor: Actor) {
		const ws = actor.workspaceId;
		const [matches, decisions, records] = await Promise.all([this.store.list<EntityMatch>(C.entityMatches, ws), this.store.list<MatchDecision>(C.matchDecisions, ws), this.store.list<SourceRecord>(C.sourceRecords, ws)]);
		const latestId = new Map<string, SourceRecord>();
		for (const r of records) if (!latestId.has(`${r.sourceId}|${r.identity}`) || latestId.get(`${r.sourceId}|${r.identity}`)!.version < r.version) latestId.set(`${r.sourceId}|${r.identity}`, r);
		const current = new Set([...latestId.values()].map((r) => r.id));
		const byRecord = new Map(records.map((r) => [r.id, r]));
		const decided = new Set(decisions.map((d) => `${d.matchId}`));
		return matches
			.filter((m) => m.status === "candidate_match" && current.has(m.recordId) && !decided.has(m.id) && !decisions.some((d) => d.decision === "confirm" && companyKey(d.subjectName) === companyKey(m.subjectName)))
			.map((m) => ({ match: m, record: byRecord.get(m.recordId) ?? null }))
			.sort((a, b) => b.match.resolvedAt.localeCompare(a.match.resolvedAt) || a.match.id.localeCompare(b.match.id));
	}

	async matchHistory(actor: Actor): Promise<MatchDecision[]> {
		return (await this.store.list<MatchDecision>(C.matchDecisions, actor.workspaceId)).sort((a, b) => b.decidedAt.localeCompare(a.decidedAt));
	}

	async records(actor: Actor, sourceId: string, limit = 200) {
		const source = await this.store.get<CuratedSource>(C.curatedSources, sourceId, actor.workspaceId);
		if (!source) throw notFound("Source");
		const recs = await this.store.list<SourceRecord>(C.sourceRecords, actor.workspaceId, { sourceId });
		return recs.sort((a, b) => b.retrievedAt.localeCompare(a.retrievedAt) || a.id.localeCompare(b.id)).slice(0, Math.min(limit, 1000));
	}
}

const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1)}…`);
export { firmIdFor };
