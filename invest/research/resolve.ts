import type { EntityKind, EntityRef, MatchCandidate, MatchSignal, MatchStatus } from "../domain/collab.ts";
import { companyKey } from "./events.ts";

/**
 * Conservative entity resolution. A source record matches an existing entity only on a *strong*
 * signal: a known external identifier, the same canonical website domain, or a name a reviewer has
 * already confirmed as an alias. A name alone (exact, alias or similar) never matches: it yields a
 * candidate for a person to confirm. Pure and deterministic: the same inputs give the same answer, so
 * repeated imports resolve identically.
 */
export const RESOLVER_VERSION = "invest-resolve/1.0.0";

export type PoolEntity = {
	ref: EntityRef;
	kind: EntityKind;
	name: string;
	key: string;
	domain: string | null;
	aliasKeys: string[];
	/** Name keys a reviewer confirmed for this entity. */
	confirmedAliasKeys: string[];
	externalIds: { sourceId: string; id: string }[];
};

export type ResolveInput = {
	subject: "investor" | "company";
	name: string;
	domain: string | null;
	sourceId: string;
	externalId: string | null;
	aliases: string[];
};

export type Resolution = { status: MatchStatus; entity: EntityRef | null; candidates: MatchCandidate[]; reasons: string[] };

const KINDS: Record<ResolveInput["subject"], EntityKind[]> = { investor: ["firm", "fund"], company: ["company"] };
const STRONG: ReadonlySet<MatchSignal> = new Set(["external_id", "domain", "confirmed_alias"]);

const tokens = (k: string) => k.split(/\s+/).filter(Boolean);
function editOne(a: string, b: string): boolean {
	if (Math.abs(a.length - b.length) > 1) return false;
	let i = 0;
	while (i < a.length && i < b.length && a[i] === b[i]) i++;
	if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
	return a.length > b.length ? a.slice(i + 1) === b.slice(i) : b.slice(i + 1) === a.slice(i);
}
const subset = (x: string[], y: string[]) => x.length > 0 && x.every((t) => y.includes(t));

export const refKey = (r: EntityRef) => `${r.type}:${r.id}`;

export function resolve(input: ResolveInput, pool: PoolEntity[], rejected: ReadonlySet<string> = new Set()): Resolution {
	const key = companyKey(input.name);
	const aliasKeys = input.aliases.map(companyKey).filter(Boolean);
	const out: MatchCandidate[] = [];
	for (const e of pool) {
		if (!KINDS[input.subject].includes(e.kind) || rejected.has(refKey(e.ref))) continue;
		const signals: MatchSignal[] = [];
		if (input.externalId && e.externalIds.some((x) => x.sourceId === input.sourceId && x.id === input.externalId)) signals.push("external_id");
		if (input.domain && e.domain && input.domain === e.domain) signals.push("domain");
		if ([key, ...aliasKeys].some((k) => e.confirmedAliasKeys.includes(k))) signals.push("confirmed_alias");
		if (key && key === e.key) signals.push("exact_name");
		else if ([key, ...aliasKeys].some((k) => k && e.aliasKeys.includes(k)) || aliasKeys.includes(e.key)) signals.push("alias");
		else if (key.length >= 4 && e.key.length >= 4 && (subset(tokens(key), tokens(e.key)) || subset(tokens(e.key), tokens(key)) || editOne(key, e.key))) signals.push("similar_name");
		if (signals.length) out.push({ ref: e.ref, name: e.name, signals, strong: signals.some((s) => STRONG.has(s)) });
	}
	const rank = (c: MatchCandidate) => (c.strong ? 100 : 0) + c.signals.length;
	out.sort((a, b) => rank(b) - rank(a) || refKey(a.ref).localeCompare(refKey(b.ref)));
	const strong = out.filter((c) => c.strong);
	const reasons: string[] = [];
	if (strong.length === 1) {
		const s = strong[0]!;
		reasons.push(`matched on ${s.signals.filter((x) => STRONG.has(x)).join(" + ").replace(/_/g, " ")}`);
		const nameOnly = out.filter((c) => !c.strong);
		if (nameOnly.length) reasons.push(`${nameOnly.length} other entit${nameOnly.length === 1 ? "y" : "ies"} share a similar name; a name alone is not used`);
		if (!s.signals.some((x) => x === "exact_name" || x === "alias" || x === "confirmed_alias" || x === "similar_name")) reasons.push("the names differ; the identifier or domain decided it");
		return { status: "matched", entity: s.ref, candidates: out, reasons };
	}
	if (strong.length > 1) return { status: "candidate_match", entity: null, candidates: out, reasons: ["more than one entity matches on a strong signal; a reviewer must choose"] };
	if (out.length) return { status: "candidate_match", entity: null, candidates: out, reasons: ["only names resemble an existing entity; a name alone never merges two entities"] };
	return { status: "unmatched", entity: null, candidates: [], reasons: ["no existing entity shares an identifier, domain or name"] };
}
