export const term = (v: string) => v.replace(/_/g, " ");
export const usd = (n: number | null): string => (n === null ? "any" : n >= 1e9 ? `$${+(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${+(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${+(n / 1e3).toFixed(1)}K` : `$${n}`);
export const usdRange = (r: { minUsd: number | null; maxUsd: number | null }): string => (r.minUsd !== null && r.maxUsd !== null ? (r.minUsd === r.maxUsd ? `about ${usd(r.minUsd)}` : `${usd(r.minUsd)}–${usd(r.maxUsd)}`) : r.maxUsd !== null ? `up to ${usd(r.maxUsd)}` : `from ${usd(r.minUsd)}`);
