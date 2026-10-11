import type { ResearchLimits } from "../domain/research.ts";
import { SafeHttpFetcher } from "../research/fetcher.ts";

/**
 * A deterministic, in-memory "web" for research tests. Requests go through the production
 * SafeHttpFetcher (destination policy, redirects, robots, retries, limits); only the socket is
 * replaced. No test touches a real site.
 */
export type FakeResponse = { status?: number; body?: string; type?: string; headers?: Record<string, string>; delayMs?: number; failTimes?: number; throws?: string; chunks?: number };
export type FakeSites = Record<string, Record<string, FakeResponse | string>>;

export function html(title: string, body: string, extraHead = ""): FakeResponse {
	return { type: "text/html; charset=utf-8", body: `<!doctype html><html><head><title>${title}</title>${extraHead}</head><body>${body}</body></html>` };
}

export class FakeWeb {
	readonly requests: { url: string; at: number }[] = [];
	readonly sleeps: number[] = [];
	readonly counts = new Map<string, number>();
	clock = 0;

	constructor(readonly sites: FakeSites) {}

	fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
		const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
		this.requests.push({ url: url.toString(), at: this.clock });
		const key = url.toString();
		this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
		const site = this.sites[url.host];
		if (!site) throw new Error(`ENOTFOUND ${url.host}`);
		const entry = site[url.pathname + url.search] ?? site[url.pathname];
		if (entry === undefined) return new Response("not found", { status: 404, headers: { "content-type": "text/plain" } });
		const spec: FakeResponse = typeof entry === "string" ? { body: entry, type: "text/html" } : entry;
		if (spec.throws) throw new Error(spec.throws);
		if (spec.failTimes && (this.counts.get(key) ?? 0) <= spec.failTimes) return new Response("busy", { status: 503 });
		if (spec.delayMs) {
			await new Promise((resolve, reject) => {
				const timer = setTimeout(resolve, spec.delayMs);
				init?.signal?.addEventListener("abort", () => {
					clearTimeout(timer);
					reject(new DOMException("aborted", "AbortError"));
				});
			});
		}
		return new Response(spec.status && spec.status >= 300 && spec.status < 400 ? null : (spec.body ?? ""), { status: spec.status ?? 200, headers: { "content-type": spec.type ?? "text/html", ...(spec.headers ?? {}) } });
	}) as unknown as typeof fetch;

	fetcherFor = (scopeDomain: string, limits: ResearchLimits) =>
		new SafeHttpFetcher({
			scopeDomain,
			limits,
			userAgent: "AttnInvestResearchBot/test",
			robotsToken: "AttnInvestResearchBot",
			fetchImpl: this.fetchImpl,
			resolve: async (host) => (host.startsWith("private.") ? ["10.0.0.5"] : ["93.184.216.34"]),
			sleep: async (ms) => {
				this.sleeps.push(ms);
				this.clock += ms;
			},
			now: () => this.clock,
			retryBackoffMs: 10,
		});
}

export function redirect(to: string, status = 302): FakeResponse {
	return { status, headers: { location: to } };
}

/** A firm whose site states a thesis on its own pages. */
export function thesisSite(): Record<string, FakeResponse | string> {
	return {
		"/robots.txt": { type: "text/plain", body: "User-agent: *\nDisallow: /private/\n" },
		"/": html("Alpine Ventures | Seed investors", `<h1>Alpine Ventures</h1><p>We are an early-stage venture firm backing founders across Europe.</p><nav><a href="/thesis">Investment thesis</a> <a href="/portfolio">Portfolio</a> <a href="/faq">FAQ</a> <a href="/news/seed-round">News</a> <a href="https://elsewhere.example/">Partner site</a> <a href="/private/lp-portal">LP portal</a></nav><p>${"Alpine Ventures was founded to support exceptional teams from the earliest days of their company. ".repeat(4)}</p>`),
		"/thesis": html(
			"Our investment thesis",
			`<h1>Investment thesis</h1><p>We invest in pre-seed and seed stage fintech and climate companies in Europe and the United Kingdom.</p><p>Our typical check size is $500K-$2M.</p><p>We do not invest in crypto or gaming companies.</p><p>We look for technical founders building B2B software.</p>`,
		),
		"/faq": html("FAQ", `<h2>How do I apply?</h2><p>Please apply through the form on our website and send a pitch deck. We do not accept unsolicited cold emails.</p>`),
		"/portfolio": html(
			"Portfolio",
			`<ul><li>Ledgerly — fintech payments platform for small business in Berlin.</li><li>Payvale — fintech lending infrastructure in London.</li><li>Finbridge — fintech compliance software in Paris.</li><li>Gridcell — climate grid storage in Madrid.</li></ul>`,
		),
		"/news/seed-round": html("Alpine leads seed round in Gridcell", `<p>Alpine Ventures led the seed round of Gridcell, a climate storage company.</p>`),
	};
}

export const rss = (items: { title: string; link?: string; date?: string; desc?: string }[], title = "Meridian news") =>
	({
		type: "application/rss+xml",
		body: `<?xml version="1.0"?><rss version="2.0"><channel><title>${title}</title>${items.map((i) => `<item><title>${i.title}</title>${i.link ? `<link>${i.link}</link>` : ""}${i.date ? `<pubDate>${i.date}</pubDate>` : ""}<description><![CDATA[${i.desc ?? ""}]]></description></item>`).join("")}</channel></rss>`,
	}) as FakeResponse;

export const atom = (entries: { title: string; link: string; date?: string; summary?: string }[]) =>
	({
		type: "application/atom+xml",
		body: `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Meridian</title>${entries.map((e) => `<entry><title>${e.title}</title><link rel="alternate" href="${e.link}"/>${e.date ? `<published>${e.date}</published>` : ""}<summary>${e.summary ?? ""}</summary></entry>`).join("")}</feed>`,
	}) as FakeResponse;

/**
 * A firm that publishes a thesis, a portfolio, a newsroom and an RSS feed. All dates are relative to the
 * test clock 2026-10-11, so "recent", "historical" and "out of window" are unambiguous.
 */
export function meridianSite(): Record<string, FakeResponse | string> {
	return {
		"/robots.txt": { status: 404 },
		"/": html(
			"Meridian Ventures",
			`<nav><a href="/thesis">Thesis</a> <a href="/portfolio">Portfolio</a> <a href="/news">News</a></nav><h1>Meridian Ventures</h1><p>${"Meridian Ventures backs founders building the next generation of financial infrastructure. ".repeat(4)}</p><footer>© 2026 Meridian Ventures. All rights reserved.</footer>`,
			'<link rel="alternate" type="application/rss+xml" href="/feed.xml">',
		),
		"/thesis": html("Investment thesis", "<p>We invest in seed stage fintech companies in Europe.</p><p>Our typical check size is $500K-$2M.</p>"),
		"/portfolio": html("Portfolio", "<ul><li>Ledgerly — fintech payments for small business.</li><li>Payvale — fintech lending infrastructure.</li><li>Finbridge — fintech compliance software.</li></ul>"),
		"/news": html("News", '<p>Latest from Meridian.</p><a href="/news/gridcell">Meridian leads Gridcell seed round</a>'),
		"/news/gridcell": html("Meridian leads Gridcell's seed round", "<p>Meridian Ventures led the $4 million seed round of Gridcell, a climate storage company, announced on October 1, 2026.</p>", '<meta property="article:published_time" content="2026-10-01T08:00:00Z">'),
		"/feed.xml": rss([
			{ title: "Meridian leads $4M seed round in Gridcell", link: "https://meridian.vc/news/gridcell", date: "Thu, 01 Oct 2026 08:00:00 GMT", desc: "Meridian Ventures led the seed round of Gridcell, a climate storage company." },
			{ title: "Meridian backs Oldco in Series A", link: "https://meridian.vc/news/oldco", date: "Wed, 15 Jan 2025 08:00:00 GMT", desc: "Meridian Ventures led the Series A of Oldco." },
			{ title: "Meridian backs Ancientco in seed", link: "https://meridian.vc/news/ancientco", date: "Mon, 03 Jun 2019 08:00:00 GMT", desc: "Meridian Ventures led the seed round of Ancientco." },
		]),
	};
}
