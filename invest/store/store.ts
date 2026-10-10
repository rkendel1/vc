import { ConditionalConflictError, FileJsDb, getTelemetryClient, open, type StateFirstDB } from "@feltdb/core";
import { mkdir } from "node:fs/promises";
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
} as const;
export type CollectionName = (typeof C)[keyof typeof C];

/** Secondary fields each collection is filtered by, besides workspaceId. */
const INDEXED: Record<CollectionName, string[]> = {
	investment_theses: [],
	thesis_versions: ["thesisId"],
	startups: [],
	documents: ["startupId"],
	document_pages: ["documentId"],
	evidence_items: ["startupId", "documentId"],
	evaluations: ["startupId", "status"],
	criterion_findings: ["evaluationId"],
	review_actions: ["evaluationId"],
	investment_decisions: ["evaluationId", "startupId"],
	audit_events: ["eventType"],
	investor_firms: [],
	research_runs: ["firmId"],
	research_sources: ["firmId"],
	research_criteria: ["firmId"],
	criterion_verifications: ["firmId"],
	research_reviews: ["firmId"],
	firm_approvals: ["firmId"],
};

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
	async commit(actor: Pick<Actor, "principalId" | "workspaceId">, input: { writes: StoreWrite[]; preconditions?: StorePrecondition[]; audit: AuditInput[] }): Promise<AuditEvent[]> {
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
					...events.map((e) => ({ collection: C.audit, id: e.id, value: e as unknown as Record<string, unknown>, requireAbsent: true })),
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

	/** Raw, unscoped read used only by integrity checks in tests (e.g. scanning for leaked secrets). */
	async dumpForTests(collection: CollectionName): Promise<Record<string, unknown>[]> {
		return this.db.collection<Record<string, unknown>>(collection).all() as Promise<Record<string, unknown>[]>;
	}
}
