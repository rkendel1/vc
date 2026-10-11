/**
 * A small, in-memory limiter for failed authentication, keyed by client address. It slows guessing; it is not a substitute for
 * high-entropy tokens (see `bun run token`) and it is per process. Behind a proxy the address is the proxy's unless INVEST_TRUST_PROXY=1.
 */
export class FailureLimiter {
	private readonly failures = new Map<string, number[]>();
	private readonly blockedUntil = new Map<string, number>();

	constructor(
		private readonly options: { maxFailures: number; windowMs: number; blockMs: number; now?: () => number } = { maxFailures: 20, windowMs: 60_000, blockMs: 60_000 },
	) {}

	private now() {
		return (this.options.now ?? Date.now)();
	}

	/** Milliseconds until this address may try again, or 0. */
	retryAfterMs(key: string): number {
		const until = this.blockedUntil.get(key) ?? 0;
		const left = until - this.now();
		if (left <= 0) {
			this.blockedUntil.delete(key);
			return 0;
		}
		return left;
	}

	recordFailure(key: string): void {
		const now = this.now();
		const recent = (this.failures.get(key) ?? []).filter((t) => now - t < this.options.windowMs);
		recent.push(now);
		if (recent.length >= this.options.maxFailures) {
			this.blockedUntil.set(key, now + this.options.blockMs);
			this.failures.delete(key);
		} else this.failures.set(key, recent);
		// Bounded memory: forget addresses that have been quiet.
		if (this.failures.size > 10_000) for (const [k, v] of this.failures) if (now - (v.at(-1) ?? 0) > this.options.windowMs) this.failures.delete(k);
	}

	recordSuccess(key: string): void {
		this.failures.delete(key);
	}
}
