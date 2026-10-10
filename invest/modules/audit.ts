import type { Actor, AuditEvent } from "../domain/types.ts";
import { C, type InvestStore } from "../store/store.ts";

/**
 * Read side of the append-only audit trail. Events are written only by `InvestStore.commit`,
 * inside the same atomic transaction as the change they describe, with `requireAbsent` so an
 * event can never be rewritten. There is no update or delete path.
 */
export class AuditModule {
	constructor(private readonly store: InvestStore) {}

	async list(actor: Actor, filter: { entityId?: string; eventType?: string; limit?: number } = {}): Promise<AuditEvent[]> {
		const match: Record<string, string> = filter.eventType ? { eventType: filter.eventType } : {};
		let events = await this.store.list<AuditEvent>(C.audit, actor.workspaceId, match);
		if (filter.entityId) {
			const id = filter.entityId;
			events = events.filter(
				(e) => e.entityRef.id === id || Object.values(e.payload).some((v) => v === id || (Array.isArray(v) && v.includes(id))),
			);
		}
		events.sort((a, b) => b.timestamp.localeCompare(a.timestamp) || b.id.localeCompare(a.id));
		return events.slice(0, Math.min(Math.max(filter.limit ?? 200, 1), 1000));
	}
}
