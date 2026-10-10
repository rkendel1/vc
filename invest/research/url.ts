import { isIP } from "node:net";

/**
 * Firm URL identity. A firm is identified by its normalised host: lowercase, no trailing dot, no
 * leading `www.`, IDNA-encoded by the URL parser. Paths, queries, fragments and schemes do not
 * make a second firm. Subdomains of the canonical domain are in scope for crawling; other
 * domains never are.
 */

/** A small set of two-label public suffixes so that `co.uk` can never be mistaken for a firm domain. Not a substitute for the Public Suffix List. */
const TWO_LABEL_SUFFIXES = new Set(["co.uk", "org.uk", "ac.uk", "com.au", "net.au", "org.au", "co.nz", "co.jp", "co.in", "com.br", "com.cn", "com.sg", "co.za", "com.mx", "github.io", "vercel.app", "netlify.app", "pages.dev", "herokuapp.com"]);

export class UrlError extends Error {}

export type NormalizedFirmUrl = { canonicalDomain: string; website: string; seedUrl: string };

export function normalizeHost(host: string): string {
	return host.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
}

export function normalizeFirmUrl(raw: string): NormalizedFirmUrl {
	const text = (raw ?? "").trim();
	if (!text || text.length > 2048 || /\s/.test(text)) throw new UrlError("Not a URL");
	const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`;
	let url: URL;
	try {
		url = new URL(withScheme);
	} catch {
		throw new UrlError(`Not a valid URL: ${text.slice(0, 80)}`);
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") throw new UrlError("Only http(s) URLs are accepted");
	if (url.username || url.password) throw new UrlError("URLs with embedded credentials are refused");
	const host = normalizeHost(url.hostname);
	if (!host || isIP(host.replace(/^\[|\]$/g, "")) || /^[0-9.]+$/.test(host)) throw new UrlError("A firm needs a domain name, not an IP address");
	const labels = host.split(".");
	if (labels.length < 2 || labels.some((l) => !l) || TWO_LABEL_SUFFIXES.has(host)) throw new UrlError(`"${host}" is not a firm domain`);
	url.hash = "";
	const seed = new URL(url.toString());
	seed.hostname = host;
	return { canonicalDomain: host, website: `https://${host}/`, seedUrl: seed.pathname === "/" && !seed.search ? `https://${host}/` : seed.toString() };
}

/** True when `host` is the canonical domain or a subdomain of it. */
export function inScope(host: string, canonicalDomain: string): boolean {
	const h = normalizeHost(host);
	return h === canonicalDomain || h.endsWith(`.${canonicalDomain}`);
}

const TRACKING = /^(utm_|fbclid|gclid|mc_|ref$|ref_|source$|_hs)/i;

/** A stable form of a page URL for deduplication: fragment dropped, tracking parameters dropped, www and default ports folded. */
export function canonicalPageUrl(raw: string, base?: string): string | null {
	let url: URL;
	try {
		url = new URL(raw, base);
	} catch {
		return null;
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") return null;
	url.hash = "";
	url.hostname = url.hostname.toLowerCase().replace(/\.$/, "");
	for (const key of [...url.searchParams.keys()]) if (TRACKING.test(key)) url.searchParams.delete(key);
	url.searchParams.sort();
	if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "") || "/";
	return url.toString();
}
