import { newId } from "../domain/canonical.ts";
import { invalid, notFound, precondition } from "../domain/errors.ts";
import type { Actor, Startup } from "../domain/types.ts";
import { C, type InvestStore, type StoreWrite } from "../store/store.ts";
import { profileEvidence, profileEvidenceId } from "./evidence-registry.ts";

export type StartupInput = { name: string; website?: string; stage?: string; sector?: string; description?: string; founderClaims?: string[] };

function clean(input: StartupInput) {
	const name = input.name?.trim();
	if (!name || name.length > 120) throw invalid("Startup name is required (≤120 characters)");
	const website = input.website?.trim() ?? "";
	if (website && !/^https?:\/\/[^\s]+$/i.test(website)) throw invalid("Website must be an http(s) URL");
	const claims = (input.founderClaims ?? []).map((c) => c.trim()).filter(Boolean);
	if (claims.length > 50 || claims.some((c) => c.length > 1000)) throw invalid("At most 50 founder claims of ≤1000 characters each");
	return {
		name,
		website,
		stage: input.stage?.trim().slice(0, 60) ?? "",
		sector: input.sector?.trim().slice(0, 120) ?? "",
		description: input.description?.trim().slice(0, 4000) ?? "",
		founderClaims: [...new Set(claims)],
	};
}

/**
 * Startup profiles. Founder claims typed into a profile are recorded as founder-reported evidence
 * (never as facts); editing the profile adds new evidence and retires removed claims by
 * derivation, without rewriting evidence a past evaluation may cite.
 */
export class StartupRegistryModule {
	constructor(private readonly store: InvestStore) {}

	async list(actor: Actor): Promise<Startup[]> {
		return (await this.store.list<Startup>(C.startups, actor.workspaceId)).sort((a, b) => a.name.localeCompare(b.name));
	}

	async get(actor: Actor, startupId: string): Promise<Startup> {
		const startup = await this.store.get<Startup>(C.startups, startupId, actor.workspaceId);
		if (!startup) throw notFound("Startup");
		return startup;
	}

	async create(actor: Actor, input: StartupInput): Promise<Startup> {
		const fields = clean(input);
		const now = this.store.now();
		const startup: Startup = { id: newId("su"), workspaceId: actor.workspaceId, ...fields, createdAt: now, createdBy: actor.principalId, updatedAt: now };
		await this.store.commit(actor, {
			writes: [{ collection: C.startups, id: startup.id, value: startup, create: true }, ...(await this.claimWrites(actor, startup, []))],
			audit: [{ eventType: "startup.created", entityRef: { type: "startup", id: startup.id }, payload: { name: startup.name, founderClaims: startup.founderClaims.length } }],
		});
		return this.get(actor, startup.id);
	}

	async update(actor: Actor, input: StartupInput & { startupId: string; expectedVersion: number }): Promise<Startup> {
		const current = await this.get(actor, input.startupId);
		if (current.__version !== input.expectedVersion) throw precondition("This startup changed since you opened it; reload before saving");
		const next: Startup = { ...current, ...clean(input), updatedAt: this.store.now() };
		const changed = (["name", "website", "stage", "sector", "description"] as const).filter((k) => current[k] !== next[k]);
		const added = next.founderClaims.filter((c) => !current.founderClaims.includes(c));
		const removed = current.founderClaims.filter((c) => !next.founderClaims.includes(c));
		await this.store.commit(actor, {
			writes: [{ collection: C.startups, id: current.id, value: next, ifVersion: input.expectedVersion }, ...(await this.claimWrites(actor, next, current.founderClaims))],
			audit: [{ eventType: "startup.updated", entityRef: { type: "startup", id: current.id }, payload: { changed, founderClaimsAdded: added.length, founderClaimsRemoved: removed.length } }],
		});
		return this.get(actor, current.id);
	}

	/** Evidence for claims not already recorded. A claim removed and later restored reuses its original evidence. */
	private async claimWrites(actor: Actor, startup: Startup, previous: string[]): Promise<StoreWrite[]> {
		const known = new Set(previous.map((c) => profileEvidenceId(startup.id, c)));
		const now = this.store.now();
		const writes: StoreWrite[] = [];
		for (const [index, claim] of startup.founderClaims.entries()) {
			const evidence = profileEvidence(startup, claim, index, now, actor);
			if (known.has(evidence.id) || (await this.store.get(C.evidence, evidence.id, actor.workspaceId))) continue;
			writes.push({ collection: C.evidence, id: evidence.id, value: evidence, create: true });
		}
		return writes;
	}
}
