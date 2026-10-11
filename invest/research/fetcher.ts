import type { FetchOutcome, ResearchLimits } from "../domain/research.ts";
import { DEFAULT_PORTS, NetworkPolicyError, type Resolver, assertPublicDestination, systemResolver } from "./net-guard.ts";
import { createPinnedFetch } from "./pinned-fetch.ts";
import { ALLOW_ALL, DISALLOW_ALL_UNAVAILABLE, type RobotsRules, parseRobots, robotsAllows } from "./robots.ts";
import { inScope } from "./url.ts";

export type FetchResult = {
	outcome: FetchOutcome;
	requestedUrl: string;
	finalUrl: string;
	httpStatus: number | null;
	contentType: string | null;
	body: string | null;
	attempts: number;
	detail: string | null;
	/** `noindex`/`noarchive`/`nosnippet`-style directives seen in headers. */
	robotsHeader: string | null;
};

/** The crawler's only view of the network. Tests supply deterministic fixtures through `fetchImpl`. */
export interface PageFetcher {
	/** `feed: true` additionally accepts RSS/Atom/XML content types. Same destination, scope, robots and size rules. */
	fetchPage(url: string, options?: { feed?: boolean; data?: boolean }): Promise<FetchResult>;
}

export type SafeFetcherOptions = {
	scopeDomain: string;
	/** Additional hosts that are in scope (a curated source's explicitly registered download host). Each is validated like any other host. */
	extraHosts?: string[];
	limits: ResearchLimits;
	userAgent: string;
	/** Product token matched against robots.txt groups. */
	robotsToken: string;
	fetchImpl?: typeof fetch;
	resolve?: Resolver;
	allowedPorts?: number[];
	sleep?: (ms: number) => Promise<void>;
	now?: () => number;
	retryBackoffMs?: number;
};

const TEXT_TYPES = /^(text\/html|application\/xhtml\+xml|text\/plain)\b/i;
const DATA_TYPES = /^(text\/csv|application\/(?:json|csv|vnd\.ms-excel|octet-stream)|text\/plain|text\/json)\b/i;
const FEED_TYPES = /^(application\/(?:rss|atom)\+xml|application\/xml|text\/xml|text\/plain|application\/rdf\+xml)\b/i;
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Bounded, polite, same-domain fetching.
 *  - every hop (first request and each redirect) is checked against the destination policy and the domain scope;
 *  - redirects are followed manually, never off the firm's domain, and never to a non-public address;
 *  - robots.txt is honoured (an unreachable robots.txt that answers 5xx is treated as "do not crawl");
 *  - requests to one host are spaced by the larger of the configured delay and Crawl-delay;
 *  - timeouts, response size and content type are bounded; transient failures are retried with backoff;
 *  - no cookies, no credentials, no authentication; 401/402/403 are recorded as access restricted and not retried.
 * The connection itself is pinned (`pinned-fetch.ts`): the name is resolved by the socket's own lookup, every answer must be public, and the
 * validated address is the one connected to, so a DNS answer that changes between the check and the connection cannot reach a private address.
 * That governs the connection only; still run the job behind an egress filter that blocks private ranges (docs/invest/PRODUCTION_READINESS.md).
 */
export class SafeHttpFetcher implements PageFetcher {
	private readonly doFetch: typeof fetch;
	private readonly resolve: Resolver;
	private readonly ports: number[];
	private readonly sleep: (ms: number) => Promise<void>;
	private readonly now: () => number;
	private readonly robots = new Map<string, Promise<RobotsRules>>();
	private readonly nextSlot = new Map<string, number>();
	private readonly backoff: number;

	constructor(private readonly o: SafeFetcherOptions) {
		this.resolve = o.resolve ?? systemResolver;
		// Production connections are pinned to the address validated at connect time; tests inject `fetchImpl`.
		this.doFetch = o.fetchImpl ?? createPinnedFetch({ resolve: this.resolve });
		this.ports = o.allowedPorts ?? DEFAULT_PORTS;
		this.sleep = o.sleep ?? defaultSleep;
		this.now = o.now ?? Date.now;
		this.backoff = o.retryBackoffMs ?? 500;
	}

	private scoped(host: string): boolean {
		return inScope(host, this.o.scopeDomain) || (this.o.extraHosts ?? []).some((h) => inScope(host, h));
	}

	private async pace(host: string, extraDelayMs: number | null) {
		const gap = Math.max(this.o.limits.perDomainDelayMs, extraDelayMs ?? 0);
		const at = this.nextSlot.get(host) ?? 0;
		const now = this.now();
		const start = Math.max(now, at);
		this.nextSlot.set(host, start + gap);
		if (start > now) await this.sleep(start - now);
	}

	private async robotsFor(url: URL): Promise<RobotsRules> {
		const key = url.origin;
		let pending = this.robots.get(key);
		if (!pending) {
			pending = this.loadRobots(url);
			this.robots.set(key, pending);
		}
		return pending;
	}

	private async loadRobots(url: URL): Promise<RobotsRules> {
		const robotsUrl = `${url.origin}/robots.txt`;
		const res = await this.request(robotsUrl, { robots: true });
		if (res.outcome === "ok" && res.body !== null) return parseRobots(res.body, this.o.robotsToken);
		if (res.httpStatus && res.httpStatus >= 400 && res.httpStatus < 500) return ALLOW_ALL; // RFC 9309: no robots file
		return DISALLOW_ALL_UNAVAILABLE; // 5xx, timeout, network failure, policy refusal: do not guess
	}

	async fetchPage(raw: string, options: { feed?: boolean; data?: boolean } = {}): Promise<FetchResult> {
		let url: URL;
		try {
			url = new URL(raw);
		} catch {
			return this.fail(raw, raw, "network_error", "not a URL");
		}
		if (!this.scoped(url.hostname)) return this.fail(raw, raw, "redirect_off_domain", "outside the firm's domain");
		try {
			await assertPublicDestination(url, { allowedPorts: this.ports, resolve: this.resolve });
		} catch (error) {
			return this.policyFailure(raw, raw, error);
		}
		const rules = await this.robotsFor(url);
		if (!robotsAllows(rules, url.pathname + url.search)) {
			return this.fail(raw, raw, "blocked_robots", rules.unavailable ? "robots.txt could not be retrieved, so the site was not crawled" : "disallowed by robots.txt");
		}
		return this.request(raw, { delayMs: rules.crawlDelayMs, feed: options.feed, data: options.data });
	}

	private fail(requested: string, finalUrl: string, outcome: FetchOutcome, detail: string, extra: Partial<FetchResult> = {}): FetchResult {
		return { outcome, requestedUrl: requested, finalUrl, httpStatus: null, contentType: null, body: null, attempts: 0, detail, robotsHeader: null, ...extra };
	}

	private policyFailure(requested: string, finalUrl: string, error: unknown): FetchResult {
		if (error instanceof NetworkPolicyError && (error as { dns?: boolean }).dns) return this.fail(requested, finalUrl, "network_error", error.message);
		return this.fail(requested, finalUrl, "blocked_network_policy", error instanceof Error ? error.message : "refused by network policy");
	}

	/** One logical request with redirects and retries. */
	private async request(raw: string, opts: { robots?: boolean; delayMs?: number | null; feed?: boolean; data?: boolean }): Promise<FetchResult> {
		let last: FetchResult | null = null;
		const attempts = this.o.limits.retries + 1;
		for (let attempt = 1; attempt <= attempts; attempt++) {
			const result = await this.once(raw, opts);
			result.attempts = attempt;
			last = result;
			const retryable = result.outcome === "timeout" || result.outcome === "network_error" || (result.outcome === "http_error" && result.httpStatus !== null && RETRYABLE_STATUS.has(result.httpStatus));
			if (!retryable || attempt === attempts) break;
			await this.sleep(this.backoff * 2 ** (attempt - 1));
		}
		return last!;
	}

	private async once(raw: string, opts: { robots?: boolean; delayMs?: number | null; feed?: boolean; data?: boolean }): Promise<FetchResult> {
		let current = raw;
		const { limits } = this.o;
		for (let hop = 0; hop <= limits.maxRedirects; hop++) {
			let url: URL;
			try {
				url = new URL(current);
			} catch {
				return this.fail(raw, current, "network_error", "bad redirect target");
			}
			if (!this.scoped(url.hostname)) return this.fail(raw, current, "redirect_off_domain", `redirected to ${url.hostname}, outside the firm's domain; not followed`);
			try {
				await assertPublicDestination(url, { allowedPorts: this.ports, resolve: this.resolve });
			} catch (error) {
				return this.policyFailure(raw, current, error);
			}
			if (hop > 0 && !opts.robots) {
				const rules = await this.robotsFor(url);
				if (!robotsAllows(rules, url.pathname + url.search)) return this.fail(raw, current, "blocked_robots", "redirect target disallowed by robots.txt");
			}
			await this.pace(url.host, opts.delayMs ?? null);
			const timeout = AbortSignal.timeout(limits.timeoutMs);
			let res: Response;
			try {
				res = await this.doFetch(url.toString(), {
					method: "GET",
					redirect: "manual",
					signal: timeout,
					credentials: "omit",
					headers: { "user-agent": this.o.userAgent, accept: opts.robots ? "text/plain" : opts.data ? "text/csv,application/json;q=0.9,text/plain;q=0.8" : opts.feed ? "application/rss+xml,application/atom+xml,application/xml;q=0.9,text/xml;q=0.8" : "text/html,application/xhtml+xml,text/plain;q=0.8", "accept-language": "en", "accept-encoding": "identity" },
				});
			} catch (error) {
				if (timeout.aborted) return this.fail(raw, current, "timeout", `no answer within ${limits.timeoutMs}ms`);
				if (error instanceof NetworkPolicyError) return this.policyFailure(raw, current, error);
				if ((error as { code?: string })?.code === "ENCODING") return this.fail(raw, current, "unsupported_content", (error as Error).message);
				return this.fail(raw, current, "network_error", (error as Error)?.message?.slice(0, 160) ?? "network error");
			}
			if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
				await res.body?.cancel().catch(() => undefined);
				try {
					current = new URL(res.headers.get("location")!, url).toString();
				} catch {
					return this.fail(raw, current, "network_error", "unusable redirect location", { httpStatus: res.status });
				}
				continue;
			}
			const finalUrl = current;
			if (res.status === 401 || res.status === 402 || res.status === 403) {
				await res.body?.cancel().catch(() => undefined);
				return this.fail(raw, finalUrl, "auth_required", `access restricted (HTTP ${res.status}); not bypassed`, { httpStatus: res.status });
			}
			if (!res.ok) {
				await res.body?.cancel().catch(() => undefined);
				return this.fail(raw, finalUrl, "http_error", `HTTP ${res.status}`, { httpStatus: res.status });
			}
			const contentType = res.headers.get("content-type");
			if (!opts.robots && (!contentType || !(opts.data ? DATA_TYPES : opts.feed ? FEED_TYPES : TEXT_TYPES).test(contentType))) {
				await res.body?.cancel().catch(() => undefined);
				return this.fail(raw, finalUrl, "unsupported_content", `content type ${contentType ?? "absent"} is not readable text`, { httpStatus: res.status, contentType });
			}
			const robotsHeader = res.headers.get("x-robots-tag");
			let body: string;
			try {
				const read = await this.readBounded(res, limits.maxBytes, timeout);
				if (read === null) return this.fail(raw, finalUrl, "too_large", `response exceeded ${limits.maxBytes} bytes`, { httpStatus: res.status, contentType });
				body = read;
			} catch {
				return timeout.aborted ? this.fail(raw, finalUrl, "timeout", `body not received within ${limits.timeoutMs}ms`, { httpStatus: res.status }) : this.fail(raw, finalUrl, "network_error", "body could not be read", { httpStatus: res.status });
			}
			return { outcome: "ok", requestedUrl: raw, finalUrl, httpStatus: res.status, contentType, body, attempts: 1, detail: hop > 0 ? `followed ${hop} redirect${hop === 1 ? "" : "s"}` : null, robotsHeader };
		}
		return this.fail(raw, current, "redirect_limit", `more than ${limits.maxRedirects} redirects`);
	}

	private async readBounded(res: Response, maxBytes: number, signal: AbortSignal): Promise<string | null> {
		if (!res.body) return "";
		const reader = res.body.getReader();
		const chunks: Uint8Array[] = [];
		let size = 0;
		for (;;) {
			if (signal.aborted) throw new Error("aborted");
			const { done, value } = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > maxBytes) {
				await reader.cancel().catch(() => undefined);
				return null;
			}
			chunks.push(value);
		}
		return new TextDecoder("utf-8", { fatal: false }).decode(Buffer.concat(chunks));
	}
}
