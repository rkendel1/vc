import { ConditionalConflictError, FileJsDb, getTelemetryClient, open, parseFlowSpec, validateFlowSpec, type StateFirstDB } from "@feltdb/core";
import { readFileSync } from "node:fs";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { newId, type Clock, systemClock } from "../domain/canonical.ts";
import { conflict } from "../domain/errors.ts";
import type { Actor, AuditEvent } from "../domain/types.ts";

/**
 * The only module that touches FeltDB. Every durable record in the investment application is
 * read and written here, through the FeltDB 0.11.7 file runtime's atomic transaction.
 *
 * Concurrency (verified against the installed runtime, see docs/invest/PR1_ARCHITECTURE_BASELINE.md):
 * - creates are fenced with `requireAbsent`, so an immutable record can be written exactly once;
 * - updates are fenced with `ifVersion`, so a stale writer fails instead of overwriting;
 * - audit events ride in the same transaction as the change they describe.
 * Nothing here assumes last-write-wins.
 */
export const C = {
	theses: "investment_theses",
	thesisVersions: "thesis_versions",
	startups: "startups",
	documents: "documents",
	documentPages: "document_pages",
	evidence: "evidence_items",
	evaluations: "evaluations",
	findings: "criterion_findings",
	reviewActions: "review_actions",
	decisions: "investment_decisions",
	audit: "audit_events",
	firms: "investor_firms",
	researchRuns: "research_runs",
	researchSources: "research_sources",
	researchCriteria: "research_criteria",
	criterionVerifications: "criterion_verifications",
	researchReviews: "research_reviews",
	firmApprovals: "firm_approvals",
	monitoringTargets: "monitoring_targets",
	sourceStates: "source_states",
	investmentEvents: "investment_events",
	eventEvidence: "event_evidence",
	researchFindings: "research_findings",
	curatedSources: "curated_sources",
	sourceRuns: "source_runs",
	sourceSnapshots: "source_snapshots",
	sourceRecords: "source_records",
	entities: "entities",
	entityMatches: "entity_matches",
	matchDecisions: "match_decisions",
	claims: "claims",
	representativeClaims: "representative_claims",
	claimEvents: "claim_events",
	contributions: "contributions",
	contributionShares: "contribution_shares",
	publishedProfiles: "published_profiles",
	contributionResponses: "contribution_responses",
	startupProfiles: "startup_profiles",
	startupProfileVersions: "startup_profile_versions",
	matchEvaluations: "match_evaluations",
	shortlistEntries: "shortlist_entries",
} as const;
export type CollectionName = (typeof C)[keyof typeof C];

/**
 * The durable state declaration. `feltdb.flow` is authoritative for which collections exist and how
 * they are indexed (FeltDB invariant FELTDB-007: no independent representation of a .flow
 * declaration). This module compiles it; `C` only gives the declared names a typed handle, and the
 * two must agree exactly or the process refuses to start.
 */
export const FLOW_FILE = fileURLToPath(new URL("../../feltdb.flow", import.meta.url));
export const FLOW = parseFlowSpec(readFileSync(FLOW_FILE, "utf8"));
{
	const problems = validateFlowSpec(FLOW).filter((d) => d.severity === "error");
	if (problems.length) throw new Error(`feltdb.flow is invalid: ${problems.map((p) => p.message).join("; ")}`);
	const declared = FLOW.collections.map((c) => c.name).sort();
	const named = Object.values(C).sort();
	if (declared.join() !== named.join())
		throw new Error(`feltdb.flow and invest/store/store.ts disagree on collections: declared-only [${declared.filter((n) => !(named as string[]).includes(n))}], code-only [${(named as string[]).filter((n) => !declared.includes(n))}]`);
}
/** Hash-indexed fields per collection, read from the declaration. */
const INDEXED: Record<string, string[]> = Object.fromEntries(
	FLOW.collections.map((c) => [c.name, c.indexes.filter((i) => i.kind === "hash").map((i) => i.expression.replace(/[()\s]/g, "")).filter((f) => f !== "workspaceId")]),
);

export type StoreWrite = {
	collection: CollectionName;
	id: string;
	value: Record<string, unknown>;
	/** Create: the record must not exist. */
	create?: boolean;
	/** Update: the record must be at exactly this version. */
	ifVersion?: number;
};

export type StorePrecondition = { collection: CollectionName; id: string; ifVersion?: number; requireAbsent?: boolean };

export type AuditInput = {
	eventType: string;
	entityRef: { type: string; id: string };
	payload?: Record<string, unknown>;
};

const PAGE = 500;

function stripVersion(value: Record<string, unknown>): Record<string, unknown> {
	const { __version: _ignored, ...rest } = value;
	return rest;
}

/**
 * When neither state.json nor state.json.backup can be read, FeltDB "reinitializes state" and carries on EMPTY, which looks like a working
 * system that lost everything. For confidential deal data, refuse instead and let the operator restore from a backup.
 */
async function refuseUnreadableSnapshot(dir: string): Promise<void> {
	const names = await readdir(dir);
	if (!names.some((n) => /^state\./.test(n) && n !== "state.lock")) return; // a new directory
	for (const name of ["state.json", "state.json.backup"]) {
		try {
			JSON.parse(await readFile(join(dir, name), "utf8"));
			return;
		} catch {
			// try the next copy
		}
	}
	throw new Error(`The database in ${dir} has no readable snapshot (state.json and state.json.backup). Refusing to start empty; restore from a backup (bun run restore).`);
}

export class InvestStore {
	constructor(
		private readonly db: StateFirstDB,
		readonly clock: Clock = systemClock,
	) {}

	static async openDir(dir: string, clock?: Clock): Promise<InvestStore> {
		// FeltDB sends anonymous adoption telemetry to feltdb.com unless told not to. This application
		// holds confidential deal data and keeps outbound traffic to Jev alone, so it is off unless a
		// deployment opts in with FELTDB_TELEMETRY=1.
		if (process.env.FELTDB_TELEMETRY !== "1") {
			process.env.FELTDB_TELEMETRY = "0";
			getTelemetryClient().disable();
		}
		await mkdir(dir, { recursive: true, mode: 0o700 });
		await refuseUnreadableSnapshot(dir);
		const store = new InvestStore(await open(new FileJsDb(dir)), clock);
		await store.init();
		return store;
	}

	/** Registers the embedded indexes the MVP queries by. Idempotent. */
	async init(): Promise<void> {
		for (const [collection, fields] of Object.entries(INDEXED)) {
			const handle = this.db.collection(collection);
			for (const field of ["workspaceId", ...fields]) {
				try {
					handle.createIndex({ name: `${collection}_${field}`, type: "hash", field });
				} catch {
					// Already registered in this process.
				}
			}
		}
	}

	async close(): Promise<void> {
		await this.db.close();
	}

	now(): string {
		return this.clock().toISOString();
	}

	/** A record in the caller's workspace, or null. A record in another workspace is indistinguishable from none. */
	async get<T>(collection: CollectionName, id: string, workspaceId: string): Promise<T | null> {
		if (!id || typeof id !== "string") return null;
		const record = (await this.db.collection<Record<string, unknown>>(collection).get(id)) as Record<string, unknown> | undefined;
		if (!record || record.workspaceId !== workspaceId) return null;
		return record as T;
	}

	/** Every record in the caller's workspace matching the equality filter, paged through the bounded query. */
	async list<T>(collection: CollectionName, workspaceId: string, match: Record<string, string | number | boolean | null> = {}): Promise<T[]> {
		const where = [{ field: "workspaceId", eq: workspaceId }, ...Object.entries(match).map(([field, eq]) => ({ field, eq }))];
		const out: T[] = [];
		let cursor: string | undefined;
		for (;;) {
			const page = await this.db.query<T>({ collection, where, limit: PAGE, cursor });
			out.push(...page.records);
			if (page.exhausted || !page.nextCursor) break;
			cursor = page.nextCursor;
		}
		return out;
	}

	/**
	 * Commits writes, preconditions and their audit events as one atomic FeltDB transaction.
	 * A lost race surfaces as a `conflict`; nothing is written.
	 */
	async commit(
		actor: Pick<Actor, "principalId" | "workspaceId">,
		input: {
			writes: StoreWrite[];
			preconditions?: StorePrecondition[];
			audit: AuditInput[];
			/**
			 * The same audit events, also written to another workspace's history in the SAME transaction (a moderator deciding on a record
			 * that lives in a claimant's workspace: both histories get the event, or neither does). Writes are still confined to the actor's workspace.
			 */
			mirrorAudit?: { workspaceId: string; actorId: string }[];
		},
	): Promise<AuditEvent[]> {
		const timestamp = this.now();
		const events: AuditEvent[] = input.audit.map((a) => ({
			id: newId("aud"),
			workspaceId: actor.workspaceId,
			actorId: actor.principalId,
			eventType: a.eventType,
			entityRef: a.entityRef,
			timestamp,
			payload: a.payload ?? {},
		}));
		const mirrors: AuditEvent[] = (input.mirrorAudit ?? []).flatMap((m) => events.map((e) => ({ ...e, id: newId("aud"), workspaceId: m.workspaceId, actorId: m.actorId })));
		for (const write of input.writes) {
			if (write.value.workspaceId !== actor.workspaceId)
				throw new Error(`refusing cross-workspace write to ${write.collection}/${write.id}`);
		}
		try {
			await this.db.transaction({
				transactionId: newId("txn"),
				preconditions: (input.preconditions ?? []).map((p) => ({
					collection: p.collection,
					id: p.id,
					...(p.ifVersion !== undefined ? { ifVersion: p.ifVersion } : {}),
					...(p.requireAbsent ? { requireAbsent: true } : {}),
				})),
				operations: [
					...input.writes.map((w) => ({
						collection: w.collection,
						id: w.id,
						value: { ...stripVersion(w.value), id: w.id },
						...(w.create ? { requireAbsent: true } : {}),
						...(w.ifVersion !== undefined ? { ifVersion: w.ifVersion } : {}),
					})),
					...[...events, ...mirrors].map((e) => ({ collection: C.audit, id: e.id, value: e as unknown as Record<string, unknown>, requireAbsent: true })),
				],
			});
		} catch (error) {
			if (error instanceof ConditionalConflictError)
				throw conflict("The record changed or already exists; reload and try again", {
					writes: input.writes.map((w) => `${w.collection}/${w.id}`),
				});
			throw error;
		}
		return events;
	}

	/**
	 * Every record of a collection across workspaces. For the monitoring scheduler only, which must
	 * find due work in all workspaces; capability handlers never use it.
	 */
	async scanAll<T>(collection: CollectionName): Promise<T[]> {
		return this.db.collection<Record<string, unknown>>(collection).all() as unknown as Promise<T[]>;
	}

	/** Raw, unscoped read used only by integrity checks in tests (e.g. scanning for leaked secrets). */
	async dumpForTests(collection: CollectionName): Promise<Record<string, unknown>[]> {
		return this.db.collection<Record<string, unknown>>(collection).all() as Promise<Record<string, unknown>[]>;
	}
}
