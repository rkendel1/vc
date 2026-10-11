import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import { Readable } from "node:stream";
import { NetworkPolicyError, type Resolver, isPublicIp, systemResolver } from "./net-guard.ts";

/**
 * A `fetch` whose connection is pinned to an address that was validated at connection time.
 *
 * Validating a hostname and then letting the platform resolve it again leaves a window in which a hostile DNS server can answer
 * differently (DNS rebinding). Here the socket's own `lookup` is the only resolution that matters: it resolves the name through the
 * injected resolver, REFUSES the connection unless every address returned is public, and hands the validated addresses to the socket.
 * The address that was checked is the address that is connected to. Redirects are not followed (the caller validates each hop and calls again).
 *
 * Limits: this governs the connection, not the remote server's behaviour; it does not replace an egress filter on the host.
 * Content is read exactly as sent: `accept-encoding: identity` is requested, and a response that declares any content-encoding is
 * refused rather than decompressed, so there is no decompression to bomb.
 */
export type PinnedFetchOptions = { resolve?: Resolver; isPublic?: (ip: string) => boolean };

export function createPinnedFetch(options: PinnedFetchOptions = {}): typeof fetch {
	const resolve = options.resolve ?? systemResolver;
	const isPublic = options.isPublic ?? isPublicIp;

	const lookup = (hostname: string, lookupOptions: { all?: boolean; family?: number }, callback: (err: Error | null, address?: unknown, family?: number) => void) => {
		void (async () => {
			try {
				const bare = hostname.replace(/^\[|\]$/g, "");
				const addresses = isIP(bare) ? [bare] : await resolve(bare);
				if (!addresses.length) throw Object.assign(new NetworkPolicyError(`${bare} did not resolve`), { dns: true });
				const bad = addresses.find((a) => !isPublic(a));
				if (bad) throw new NetworkPolicyError(`${bare} resolves to a non-public address (${bad}) at connection time`);
				const entries = addresses.map((a) => ({ address: a, family: isIP(a) }));
				if (lookupOptions.all) callback(null, entries);
				else callback(null, entries[0]!.address, entries[0]!.family);
			} catch (error) {
				callback(error as Error);
			}
		})();
	};

	return (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
		const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
		if (url.protocol !== "http:" && url.protocol !== "https:") throw new NetworkPolicyError(`scheme ${url.protocol} is not allowed`);
		const transport = url.protocol === "https:" ? https : http;
		const headers: Record<string, string> = {};
		new Headers(init?.headers).forEach((v, k) => {
			headers[k] = v;
		});
		return new Promise<Response>((resolveResponse, reject) => {
			const host = url.hostname.replace(/^\[|\]$/g, "");
			const req = transport.request(
				{
					host,
					port: url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80,
					path: `${url.pathname}${url.search}`,
					method: "GET",
					headers: { ...headers, host: url.host },
					agent: false, // no connection reuse across hosts or requests
					lookup: lookup as never,
					...(url.protocol === "https:" && !isIP(host) ? { servername: host } : {}),
				},
				(res) => {
					const status = res.statusCode ?? 0;
					const encoding = String(res.headers["content-encoding"] ?? "").toLowerCase();
					if (encoding && encoding !== "identity") {
						res.destroy();
						return reject(Object.assign(new Error(`content-encoding ${encoding} is not accepted`), { code: "ENCODING" }));
					}
					const out = new Headers();
					for (const [k, v] of Object.entries(res.headers)) if (v !== undefined) out.set(k, Array.isArray(v) ? v.join(", ") : String(v));
					const empty = [101, 204, 205, 304].includes(status);
					resolveResponse(new Response(empty ? null : (Readable.toWeb(res) as unknown as ReadableStream), { status, statusText: res.statusMessage, headers: out }));
				},
			);
			const abort = () => {
				req.destroy(Object.assign(new Error("aborted"), { name: "AbortError" }));
			};
			if (init?.signal) {
				if (init.signal.aborted) return abort();
				init.signal.addEventListener("abort", abort, { once: true });
			}
			req.on("error", (error) => reject(error));
			req.end();
		});
	}) as typeof fetch;
}
