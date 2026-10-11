import { canonicalJson, sha256Hex } from "../domain/canonical.ts";
import { invalid, notFound, precondition } from "../domain/errors.ts";
import {
	BUSINESS_MODEL_KEYS,
	DECLARED_BASES,
	GEOGRAPHY_KEYS,
	PRODUCT_STATUSES,
	PROFILE_METRICS,
	REVENUE_STATUSES,
	SECTOR_KEYS,
	STARTUP_STAGES,
	type FieldProvenance,
	type Known,
	type ProfileContent,
	type ProfileMetric,
	type StartupProfileHead,
	type StartupProfileVersion,
} from "../domain/founder.ts";
import type { Actor, EvidenceItem, Startup } from "../domain/types.ts";
import { C, type InvestStore } from "../store/store.ts";

const UNKNOWN = { state: "unknown" } as const;
export const emptyProfile = (): ProfileContent => ({
	description: "",
	sectors: UNKNOWN,
	businessModels: UNKNOWN,
	headquarters: UNKNOWN,
	targetMarkets: UNKNOWN,
	currentStage: UNKNOWN,
	fundraisingStage: UNKNOWN,
	targetRaise: UNKNOWN,
	revenueStatus: UNKNOWN,
	productStatus: UNKNOWN,
	metrics: {},
	team: UNKNOWN,
	investorExclusions: [],
	constraints: [],
});

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown, max: number, what: string): string => {
	if (v === undefined || v === null) return "";
	if (typeof v !== "string") throw invalid(`${what} must be text`);
	if (v.length > max) throw invalid(`${what} must be at most ${max} characters`);
	return v.trim();
};
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], what: string): T => {
	if (typeof v !== "string" || !(allowed as readonly string[]).includes(v)) throw invalid(`${what} must be one of: ${allowed.join(", ")}`);
	return v as T;
};

/**
 * The profile is validated here and nowhere interpreted afterwards: controlled fields take controlled terms,
 * free text is stored and displayed but never read by matching, and evidence links must name evidence that
 * exists for this startup in this workspace.
 */
export function validateProfile(raw: unknown, knownEvidence: Set<string>): ProfileContent {
	if (!isObj(raw)) throw invalid("Profile content is required");
	const out = emptyProfile();
	const known = <T,>(key: string, value: unknown, parse: (v: unknown) => T): Known<T> => {
		if (value === undefined || value === null) return UNKNOWN;
		if (!isObj(value)) throw invalid(`${key} must be an object with a state`);
		if (value.state === undefined || value.state === "unknown") return UNKNOWN;
		if (value.state === "not_applicable") return { state: "not_applicable" };
		if (value.state !== "provided") throw invalid(`${key}.state must be provided, unknown or not_applicable`);
		const basis = value.basis === undefined ? "founder_assertion" : oneOf(value.basis, DECLARED_BASES, `${key}.basis`);
		const ids = value.evidenceIds === undefined ? [] : Array.isArray(value.evidenceIds) ? value.evidenceIds : null;
		if (!ids || ids.length > 20 || ids.some((i) => typeof i !== "string")) throw invalid(`${key}.evidenceIds must be a list of at most 20 evidence ids`);
		for (const id of ids as string[]) if (!knownEvidence.has(id)) throw invalid(`${key} links evidence that does not exist for this startup`);
		const url = value.sourceUrl === undefined || value.sourceUrl === null || value.sourceUrl === "" ? null : text(value.sourceUrl, 500, `${key}.sourceUrl`);
		if (url && !/^https?:\/\/[^\s]+$/i.test(url)) throw invalid(`${key}.sourceUrl must be an http(s) URL`);
		const provenance: FieldProvenance = { basis, evidenceIds: [...new Set(ids as string[])].sort(), sourceUrl: url };
		return { state: "provided", value: parse(value.value), provenance };
	};
	const list = (allowed: readonly string[], what: string) => (v: unknown): string[] => {
		if (!Array.isArray(v) || v.length === 0 || v.length > 12) throw invalid(`${what} must list 1–12 terms`);
		return [...new Set(v.map((x) => oneOf(x, allowed, what)))].sort();
	};
	out.description = text(raw.description, 600, "Description");
	out.sectors = known("sectors", raw.sectors, list(SECTOR_KEYS, "Sector"));
	out.businessModels = known("businessModels", raw.businessModels, list(BUSINESS_MODEL_KEYS, "Business model"));
	out.headquarters = known("headquarters", raw.headquarters, (v) => oneOf(v, GEOGRAPHY_KEYS, "Headquarters"));
	out.targetMarkets = known("targetMarkets", raw.targetMarkets, list(GEOGRAPHY_KEYS, "Target market"));
	out.currentStage = known("currentStage", raw.currentStage, (v) => oneOf(v, STARTUP_STAGES, "Current stage"));
	out.fundraisingStage = known("fundraisingStage", raw.fundraisingStage, (v) => oneOf(v, STARTUP_STAGES, "Fundraising stage"));
	out.revenueStatus = known("revenueStatus", raw.revenueStatus, (v) => oneOf(v, REVENUE_STATUSES, "Revenue status"));
	out.productStatus = known("productStatus", raw.productStatus, (v) => oneOf(v, PRODUCT_STATUSES, "Product status"));
	out.team = known("team", raw.team, (v) => {
		const t = text(v, 2000, "Team");
		if (!t) throw invalid("Team experience is empty; mark it unknown instead");
		return t;
	});
	out.targetRaise = known("targetRaise", raw.targetRaise, (v) => {
		if (!isObj(v)) throw invalid("Target raise needs minUsd and/or maxUsd");
		const n = (x: unknown) => (x === null || x === undefined ? null : typeof x === "number" && Number.isFinite(x) && x >= 0 && x <= 1e11 ? x : (() => { throw invalid("Target raise amounts must be USD numbers between 0 and 100 billion"); })());
		const minUsd = n(v.minUsd);
		const maxUsd = n(v.maxUsd);
		if (minUsd === null && maxUsd === null) throw invalid("Give a target raise amount, or mark it unknown");
		if (minUsd !== null && maxUsd !== null && minUsd > maxUsd) throw invalid("Target raise minimum is above its maximum");
		return { minUsd, maxUsd };
	});
	if (raw.metrics !== undefined) {
		if (!isObj(raw.metrics)) throw invalid("metrics must be an object");
		for (const [k, v] of Object.entries(raw.metrics)) {
			const key = oneOf(k, PROFILE_METRICS, "Metric") as ProfileMetric;
			const m = known(`metrics.${key}`, v, (x) => {
				if (typeof x !== "number" || !Number.isFinite(x) || x < 0 || x > 1e12) throw invalid(`${key} must be a non-negative number`);
				if (key === "gross_margin_pct" && x > 100) throw invalid("Gross margin cannot exceed 100%");
				return x;
			});
			if (m.state !== "unknown") out.metrics[key] = m;
		}
	}
	const strings = (v: unknown, what: string, max: number, each: number) => {
		if (v === undefined) return [];
		if (!Array.isArray(v) || v.length > max) throw invalid(`${what} must be a list of at most ${max}`);
		return [...new Set(v.map((x) => text(x, each, what)).filter(Boolean))];
	};
	out.investorExclusions = [...new Set(strings(raw.investorExclusions, "Investor exclusions", 50, 120).map((d) => d.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "")))].sort();
	out.constraints = strings(raw.constraints, "Constraints", 20, 500);
	return out;
}

const FIELD_KEYS = ["description", "sectors", "businessModels", "headquarters", "targetMarkets", "currentStage", "fundraisingStage", "targetRaise", "revenueStatus", "productStatus", "team", "investorExclusions", "constraints"] as const;
export function changedFields(a: ProfileContent | null, b: ProfileContent): string[] {
	if (!a) return ["created"];
	const out: string[] = FIELD_KEYS.filter((k) => canonicalJson(a[k]) !== canonicalJson(b[k]));
	for (const m of new Set([...Object.keys(a.metrics), ...Object.keys(b.metrics)])) if (canonicalJson(a.metrics[m as ProfileMetric]) !== canonicalJson(b.metrics[m as ProfileMetric])) out.push(`metrics.${m}`);
	return out.sort();
}

export const profileHash = (c: ProfileContent) => sha256Hex(canonicalJson(c));
const headId = (startupId: string) => `sp_${startupId}`;
const versionId = (startupId: string, n: number) => `spv_${startupId}_${n}`;

/**
 * The founder's private startup profile. Each material change is a new immutable version; the head record
 * only says which version is current. A previous evaluation names the version it used, so it can always be rebuilt.
 */
export class FounderProfileModule {
	constructor(private readonly store: InvestStore) {}

	private async startup(actor: Actor, startupId: string): Promise<Startup> {
		const s = await this.store.get<Startup>(C.startups, startupId, actor.workspaceId);
		if (!s) throw notFound("Startup");
		return s;
	}

	async get(actor: Actor, startupId: string) {
		const startup = await this.startup(actor, startupId);
		const head = await this.store.get<StartupProfileHead>(C.startupProfiles, headId(startupId), actor.workspaceId);
		const versions = (await this.store.list<StartupProfileVersion>(C.startupProfileVersions, actor.workspaceId, { startupId })).sort((a, b) => b.version - a.version);
		const current = head ? (versions.find((v) => v.id === head.currentVersionId) ?? null) : null;
		return { startup, head, current, content: current?.content ?? emptyProfile(), version: current?.version ?? 0, versions: versions.map(({ content: _c, ...rest }) => rest) };
	}

	async version(actor: Actor, startupId: string, version: number): Promise<StartupProfileVersion> {
		const v = await this.store.get<StartupProfileVersion>(C.startupProfileVersions, versionId(startupId, version), actor.workspaceId);
		if (!v) throw notFound("Profile version");
		return v;
	}

	async getVersionById(actor: Actor, id: string): Promise<StartupProfileVersion | null> {
		return this.store.get<StartupProfileVersion>(C.startupProfileVersions, id, actor.workspaceId);
	}

	async save(actor: Actor, input: { startupId: string; expectedVersion: number; content: unknown; note?: string }) {
		const startup = await this.startup(actor, input.startupId);
		const evidence = await this.store.list<EvidenceItem>(C.evidence, actor.workspaceId, { startupId: startup.id });
		const content = validateProfile(input.content, new Set(evidence.map((e) => e.id)));
		const head = await this.store.get<StartupProfileHead>(C.startupProfiles, headId(startup.id), actor.workspaceId);
		const currentNumber = head?.currentVersion ?? 0;
		if (currentNumber !== input.expectedVersion) throw precondition("This profile changed since you opened it; reload before saving", { currentVersion: currentNumber });
		const previous = head ? await this.version(actor, startup.id, head.currentVersion) : null;
		const hash = profileHash(content);
		if (previous && previous.contentHash === hash) return { unchanged: true as const, ...(await this.get(actor, startup.id)) };
		const n = currentNumber + 1;
		const now = this.store.now();
		const note = text(input.note, 300, "Note");
		const version: StartupProfileVersion = { id: versionId(startup.id, n), workspaceId: actor.workspaceId, startupId: startup.id, version: n, content, contentHash: hash, changed: changedFields(previous?.content ?? null, content), previousVersionId: previous?.id ?? null, note, createdAt: now, createdBy: actor.principalId };
		const nextHead: StartupProfileHead = { id: headId(startup.id), workspaceId: actor.workspaceId, startupId: startup.id, currentVersion: n, currentVersionId: version.id, updatedAt: now };
		await this.store.commit(actor, {
			writes: [
				{ collection: C.startupProfileVersions, id: version.id, value: version, create: true },
				head ? { collection: C.startupProfiles, id: head.id, value: nextHead, ifVersion: head.__version } : { collection: C.startupProfiles, id: nextHead.id, value: nextHead, create: true },
			],
			audit: [{ eventType: "startup.profile_versioned", entityRef: { type: "startup", id: startup.id }, payload: { version: n, changed: version.changed, contentHash: hash } }],
		});
		return { unchanged: false as const, ...(await this.get(actor, startup.id)) };
	}
}
