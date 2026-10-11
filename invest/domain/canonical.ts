import { createHash, randomUUID } from "node:crypto";

/** JSON with object keys sorted recursively, so equal values always serialise identically. */
export function canonicalJson(value: unknown): string {
	return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(sortKeys);
	if (value && typeof value === "object") {
		const out: Record<string, unknown> = {};
		for (const key of Object.keys(value as Record<string, unknown>).sort()) {
			const v = (value as Record<string, unknown>)[key];
			if (v !== undefined) out[key] = sortKeys(v);
		}
		return out;
	}
	return value;
}

export function sha256Hex(input: string | Uint8Array): string {
	return createHash("sha256").update(input).digest("hex");
}

export function digestOf(value: unknown): string {
	return `sha256:${sha256Hex(canonicalJson(value))}`;
}

export function newId(prefix: string): string {
	return `${prefix}_${randomUUID().replace(/-/g, "")}`;
}

let sequence = 0;
/**
 * An id that sorts in creation order within a process even when the clock is coarse or frozen: wall time, then a
 * counter, then randomness. Used for records whose order decides meaning (decisions, consent, reviews).
 */
export function newSortableId(prefix: string): string {
	const t = Date.now().toString(16).padStart(12, "0");
	const n = (sequence++ % 0xffffff).toString(16).padStart(6, "0");
	return `${prefix}_${t}${n}${randomUUID().replace(/-/g, "").slice(0, 10)}`;
}

export type Clock = () => Date;
export const systemClock: Clock = () => new Date();
