/** Display formatting. Pure, so it is unit-tested; no raw storage values, enums or nulls reach the screen. */
export const NOT_STATED = "Not stated";

/** `check_size` → "check size". */
export const term = (v: string): string => v.replace(/_/g, " ");
/** "check size" → "Check size". */
export const sentence = (v: string): string => {
	const t = term(v);
	return t.charAt(0).toUpperCase() + t.slice(1);
};
export const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

export const usd = (n: number | null | undefined): string => {
	if (n === null || n === undefined || Number.isNaN(n)) return NOT_STATED.toLowerCase();
	const abs = Math.abs(n);
	if (abs >= 1e9) return `$${+(n / 1e9).toFixed(2)}B`;
	if (abs >= 1e6) return `$${+(n / 1e6).toFixed(2)}M`;
	if (abs >= 1e3) return `$${+(n / 1e3).toFixed(1)}K`;
	return `$${n}`;
};
export const usdRange = (r: { minUsd: number | null; maxUsd: number | null } | null | undefined): string => {
	if (!r || (r.minUsd === null && r.maxUsd === null)) return NOT_STATED.toLowerCase();
	if (r.minUsd !== null && r.maxUsd !== null) return r.minUsd === r.maxUsd ? `about ${usd(r.minUsd)}` : `${usd(r.minUsd)}–${usd(r.maxUsd)}`;
	return r.maxUsd !== null ? `up to ${usd(r.maxUsd)}` : `from ${usd(r.minUsd)}`;
};

/** Local, short date and time. A missing value is said to be missing, never shown as a dash or an epoch. */
export function formatDate(iso: string | null | undefined, opts: { time?: boolean } = {}): string {
	if (!iso) return NOT_STATED;
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return NOT_STATED;
	return d.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", ...(opts.time === false ? {} : { hour: "2-digit", minute: "2-digit" }) });
}

/** "3 days ago" style age, for freshness lines. */
export function ageLabel(iso: string | null | undefined, now: number = Date.now()): string {
	if (!iso) return NOT_STATED;
	const days = Math.floor((now - Date.parse(iso)) / 86_400_000);
	if (Number.isNaN(days)) return NOT_STATED;
	if (days <= 0) return "today";
	if (days === 1) return "yesterday";
	if (days < 60) return `${days} days ago`;
	return `${Math.round(days / 30)} months ago`;
}

/** A short excerpt for tables; the full text stays one click away. */
export const clip = (s: string, n = 140): string => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
