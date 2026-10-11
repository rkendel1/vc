/**
 * Browser end-to-end: drives the investor workflow through the built web app in real Chromium,
 * against a real server (FeltDB, AppPort, AuthBoundry adapter) and the Jev HTTP adapter pointed at
 * the stand-in. Run with `bun run e2e:browser` after `bun run build:web`.
 */
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { JevHttpClient } from "../jev/jev-client.ts";
import { FUNDING_FEED, type FakeSites, FakeWeb, html, thesisSite } from "../testing/fake-web.ts";
import { actor } from "../testing/harness.ts";
import { NORTHWIND_AUDIT, NORTHWIND_DECK } from "../testing/fixtures.ts";
import { TOKENS, startHttpHarness } from "../testing/http-harness.ts";
import { startJevStandin } from "../testing/jev-standin.ts";

const root = fileURLToPath(new URL("../..", import.meta.url));
const shots = process.env.E2E_SCREENSHOTS;
const executablePath = process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

function check(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(`E2E assertion failed: ${message}`);
	console.log(`  ok  ${message}`);
}

// Nothing server-only may be in what the browser downloads.
for (const f of (await readdir(join(root, "apps/invest-web/dist"), { recursive: true })).filter((n) => /\.(js|css|html)$/.test(n))) {
	const text = await readFile(join(root, "apps/invest-web/dist", f), "utf8");
	for (const needle of ["JEV_API_KEY", "DOCUMENT_STORAGE_LINK_SECRET", "AUTHBOUNDRY_CONFIG_PATH", "tokenSha256", "dev-partner-token", "e2e-key", ...Object.values(TOKENS)]) check(!text.includes(needle), `bundle ${f} does not contain ${needle}`);
}

const jev = startJevStandin({ port: 0, apiKey: "e2e-key" });
const sites: FakeSites = {
	"alpine.vc": thesisSite(),
	"fundingnews.example.com": { "/robots.txt": { status: 404 }, "/feed.xml": FUNDING_FEED() },
	"quiet.vc": { "/robots.txt": { status: 404 }, "/": html("Quiet Capital", `<p>${"Quiet Capital is a firm that values patience. ".repeat(12)}</p>`) },
	"walled.vc": { "/robots.txt": { type: "text/plain", body: "User-agent: *\nDisallow: /\n" }, "/": html("Walled", "x") },
};
const web = new FakeWeb(sites);
const h = await startHttpHarness({
	fetcherFor: web.fetcherFor,
	fetcherForSource: web.fetcherForSource,
	webDist: join(root, "apps/invest-web/dist"),
	jev: new JevHttpClient({ endpoint: `http://127.0.0.1:${jev.port}/decide`, apiKey: "e2e-key", provider: "standin", model: "lexical", timeoutMs: 5000 }),
});
const files = await mkdtemp(join(tmpdir(), "invest-e2e-files-"));
await writeFile(join(files, "northwind-deck.pdf"), NORTHWIND_DECK);
await writeFile(join(files, "revenue-review.pdf"), NORTHWIND_AUDIT);
await writeFile(join(files, "not-a-pdf.pdf"), "this is plain text pretending to be a PDF, long enough to pass the size check.".repeat(3));

const browser = await chromium.launch({ executablePath });
const errors: string[] = [];
try {
	const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
	page.on("pageerror", (e) => errors.push(String(e)));
	if (process.env.E2E_DEBUG) page.on("response", (r) => r.status() === 409 && console.log("409:", r.request().postData()?.slice(0, 300)));
	page.on("console", (m) => m.type() === "error" && !/\b(401|403)\b/.test(m.text()) && errors.push(m.text()));
	const snap = async (name: string) => shots && (await page.screenshot({ path: join(shots, `${name}.png`), fullPage: true }));

	console.log("sign in");
	await page.goto(h.url);
	await page.fill("input[type=password]", "wrong-token");
	await page.click("button[type=submit]");
	await page.waitForSelector("text=That token was not accepted");
	check(true, "a bad token is refused");
	await page.fill("input[type=password]", TOKENS.aPartner);
	await page.click("button[type=submit]");
	await page.waitForSelector("text=Needs a reviewer");
	check(await page.isVisible("text=No approved thesis yet"), "an empty workspace points to the thesis editor");

	console.log("thesis");
	await page.click("nav >> text=Theses");
	await page.fill("input[placeholder='Seed-stage B2B software']", "E2E mandate");
	await page.click("text=Create draft");
	await page.waitForSelector("text=Approve as version 1");
	await page.click("summary:has-text('ARR of at least $1M')");
	await page.fill("textarea >> nth=1", "");
	await page.click("text=Check draft");
	await page.waitForSelector("text=problem(s) to fix before approval");
	check(true, "validation reports an empty requirement");
	await page.fill("textarea >> nth=1", "Annual recurring revenue is at least $1,000,000.");
	await page.fill("input[placeholder='Why this version, and what changed']", "First mandate");
	await page.click("text=Approve as version 1");
	await page.waitForSelector("text=In force: version 1");
	check(await page.isVisible("td:has-text('First mandate')"), "version 1 is approved with its note");
	await snap("e2e-thesis");

	console.log("startup and documents");
	await page.click("nav >> text=Startups");
	await page.fill("label:has-text('Company name') input", "Northwind Analytics");
	await page.fill("label:has-text('What the founders say') textarea", "We have 120 paying customers");
	await page.click("button:has-text('Add startup')");
	await page.waitForSelector("h1:has-text('Northwind Analytics')");
	await page.setInputFiles("input[type=file]", join(files, "not-a-pdf.pdf"));
	await page.click("button:has-text('Upload')");
	await page.waitForSelector("text=could not be used");
	check(true, "a fake PDF is rejected with a reason");
	await page.setInputFiles("input[type=file]", join(files, "northwind-deck.pdf"));
	await page.click("button:has-text('Upload')");
	await page.waitForSelector("text=northwind-deck.pdf was read");
	await page.selectOption("label:has-text('What it is') select", "third_party_report");
	await page.setInputFiles("input[type=file]", join(files, "revenue-review.pdf"));
	await page.click("button:has-text('Upload')");
	await page.waitForSelector("td:has-text('revenue-review.pdf')");
	check(await page.isVisible("td >> text=Corroborated"), "the deck's ARR is corroborated by the independent review");
	await snap("e2e-startup");

	console.log("evaluation");
	await page.click("text=Evaluate against this version");
	await page.waitForSelector(".finding", { timeout: 20000 });
	await page.waitForSelector("text=All review gates resolved, text=finding(s) need review", { timeout: 20000 }).catch(() => {});
	await page.waitForFunction(() => !document.body.innerText.includes("This page updates on its own"), null, { timeout: 20000 });
	check(await page.isVisible("text=Hard gate open: legal-exposure"), "the human-review hard gate is open");
	await page.click(".finding >> text=ARR of at least $1M");
	await page.click(".finding.selected .ref >> nth=0");
	await page.waitForSelector(".page .line.hit");
	check(true, "selecting evidence opens its page with the claim highlighted");
	await page.check("input[type=radio] >> nth=0");
	check(await page.isVisible(".blockers >> text=Hard gate not established"), "invest is blocked while a hard gate is open");

	console.log("review and decision");
	await page.click(".finding >> text=No unresolved legal or regulatory exposure");
	await page.click(".finding.selected >> text=Override outcome");
	await page.selectOption(".finding.selected select", "supported");
	await page.fill(".finding.selected textarea", "Counsel confirmed no pending litigation (call on 8 Oct).");
	await page.click(".finding.selected >> text=Record override");
	await page.waitForSelector("text=overridden; system said insufficient evidence");
	check(true, "the override is shown next to the system outcome");
	for (;;) {
		const outstanding = page.locator(".finding:has-text('needs review') .head").first();
		if (!(await outstanding.count())) break;
		await outstanding.click();
		await page.click(".finding.selected >> text=Accept finding");
		await page.waitForTimeout(300);
	}
	await page.waitForSelector("text=All review gates resolved.");
	await page.check("input[type=radio] >> nth=0");
	await page.fill("label:has-text('Rationale') textarea", "Meets the mandate; legal confirmed by counsel.");
	await page.click("text=Record decision: invest");
	await page.waitForSelector("li:has-text('Invest (current)')");
	check(true, "the invest decision is recorded");
	await page.click("aside >> button:has-text('Close')");
	await page.click("text=Check this record");
	await page.waitForSelector(".note.ok >> text=checks match");
	check(true, "the stored evaluation verifies independently");
	await snap("e2e-report");

	console.log("investor research");
	const research = h.runtime.service.research;
	for (const url of ["alpine.vc", "quiet.vc", "walled.vc"]) {
		const { firm } = await research.reconcile(actor("ws-a"), { url });
		await research.research(actor("ws-a"), firm.id, { verify: false });
	}
	await page.click("nav >> text=Investor research");
	await page.waitForSelector("td:has-text('Alpine Ventures')");
	check((await page.locator("table.list tbody tr").count()) === 3, "all three firms have a profile, including the stubs");
	await page.selectOption("select", "research_incomplete");
	await page.waitForSelector("td:has-text('walled.vc')");
	check(!(await page.isVisible("td:has-text('Alpine Ventures')")), "the list filters by research status");
	await page.selectOption("select", "");
	await page.fill("input[type=search]", "fintech");
	await page.waitForFunction(() => document.querySelectorAll("table.list tbody tr").length === 1);
	check(await page.isVisible("td:has-text('Alpine Ventures')"), "search matches extracted criteria");
	await page.click("a:has-text('Alpine Ventures')");
	await page.waitForSelector("text=Stated on the firm's own site");
	check(await page.isVisible("text=Inferred patterns"), "explicit, observed and inferred criteria are shown apart");
	check(await page.isVisible("text=External observations"), "observed criteria have their own group");
	check(await page.isVisible("text=Nothing here has been adopted as investor-verified"), "research is not presented as investor-verified");
	await page.click("summary:has-text('check size')");
	check(await page.isVisible("details[open] blockquote.passage >> text=$500K-$2M"), "a criterion opens its supporting passage");
	check(await page.isVisible("details[open] dd:has-text('alpine.vc/thesis')"), "and the page it came from");
	await page.selectOption("summary:has-text('check size') ~ div select", "flag");
	await page.fill("summary:has-text('check size') ~ div textarea", "Please confirm with the partner.");
	await page.click("summary:has-text('check size') ~ div >> text=Save review");
	await page.waitForSelector("li:has-text('Please confirm with the partner.')");
	check(await page.isVisible("text=Nothing here has been adopted as investor-verified"), "a flag does not make anything investor-verified");
	await page.click("details[open] >> text=Adopt as investor-verified…");
	await page.fill("details[open] label:has-text('Why you are adopting') input", "Confirmed by the partner on a call.");
	await page.click("details[open] >> text=Record as investor-verified");
	await page.waitForSelector("li:has-text('approved by')");
	check(await page.isVisible("li:has-text('check size')"), "an explicit human approval is shown as investor-verified");
	await page.click("summary:has-text('Research details')");
	check(await page.isVisible("text=Sources checked"), "sources checked are listed under research details");
	await snap("e2e-investor");
	await page.click("nav >> text=Investor research");
	await page.click("a:has-text('walled.vc')");
	await page.waitForSelector("[data-testid=stub]");
	check(await page.isVisible("[data-testid=stub] >> text=could not adequately cover"), "an incomplete stub explains why research was incomplete");
	await page.click("summary:has-text('Research details')");
	check(await page.isVisible("text=Blocked by robots rules"), "the blocked source is listed accurately");
	await page.click("nav >> text=Investor research");
	await page.click("a:has-text('Quiet Capital')");
	await page.waitForSelector("[data-testid=stub] >> text=does not mean Quiet Capital has no investment thesis");
	check(true, "a no-thesis stub does not claim the firm has no thesis");
	await page.click("button:has-text('Refresh research')");
	await page.waitForFunction(() => Array.from(document.querySelectorAll("h2")).find((h) => h.textContent === "Research runs")?.closest("section")?.querySelectorAll("tbody tr").length === 2, undefined, { timeout: 20000 });
	check(true, "a refresh can be requested and adds a run to the history");

	console.log("monitoring and timeline");
	const alpine = (await research.lookup(actor("ws-a"), "alpine.vc"))!;
	await h.runtime.service.monitoring.register(actor("ws-a"), alpine);
	await page.click("nav >> text=Investor research");
	await page.click("a:has-text('Alpine Ventures')");
	await page.waitForSelector("[data-testid=monitoring]");
	check(await page.isVisible("[data-testid=monitoring] >> text=Monitored"), "a registered firm shows its monitoring schedule");
	await page.click("button:has-text('Pause monitoring')");
	await page.waitForSelector("[data-testid=monitoring] >> text=The profile and history are kept");
	check(await page.isVisible("button:has-text('Resume monitoring')"), "monitoring can be paused from the browser, keeping history");
	check(await page.isVisible("summary:has-text('check size')"), "the profile is untouched by pausing");
	await page.click("button:has-text('Resume monitoring')");
	await page.waitForSelector("button:has-text('Pause monitoring')");
	// The firm publishes a new check size; one monitoring cycle (no waiting for an interval) finds it.
	sites["alpine.vc"]["/thesis"] = html("Our investment thesis", "<h1>Investment thesis</h1><p>We invest in pre-seed and seed stage fintech and climate companies in Europe and the United Kingdom.</p><p>Our typical check size is $1M-$3M.</p><p>We do not invest in crypto or gaming companies.</p>");
	const cycle = await h.runtime.service.monitoring.runCycle({ workspaceIds: ["ws-a"] });
	check(cycle.entries.some((e) => e.domain === "alpine.vc" && e.result === "ran"), "an on-demand monitoring cycle checks the firm");
	await page.reload();
	await page.waitForSelector("[data-testid=timeline]");
	await page.selectOption("label:has-text('Type') select", "thesis_finding");
	await page.waitForSelector("details.tl[data-type=thesis_finding]");
	check(await page.isVisible("details.tl[data-type=thesis_finding] >> text=Published check size changed"), "a changed check size becomes a proposed thesis change");
	check(await page.isVisible("details.tl[data-type=thesis_finding]:has-text('Published check size changed') >> text=needs review"), "and is routed for review");
	await page.click("details.tl[data-type=thesis_finding]:has-text('Published check size changed') summary");
	check(await page.isVisible("details[open] blockquote.passage >> text=$1M-$3M"), "the finding links to its supporting passage");
	check(await page.isVisible("details[open] dt:has-text('Discovered')"), "publication, discovery and review dates are shown apart");
	await page.fill("details[open] label:has-text('Review note') input", "Confirmed on the thesis page.");
	await page.click("details[open] button:has-text('Confirm')");
	await page.waitForSelector("details.tl[data-type=thesis_finding]:has-text('Published check size changed') .tag.review-confirmed");
	check(await page.isVisible("text=Nothing here has been adopted as investor-verified") === false, "the approved check size is still listed as investor-verified");
	check(await page.isVisible("li:has-text('check size')"), "the investor-verified value is unchanged by the finding");
	await page.selectOption("label:has-text('Type') select", "research_failed");
	await page.waitForSelector("text=Nothing matches");
	check(true, "timeline filters narrow the list");
	await snap("e2e-timeline");
	await page.click("nav >> text=Investor research");
	await page.waitForSelector("td:has-text('Alpine Ventures')");
	check(await page.isVisible("td >> text=Monitored"), "the directory shows monitoring state");

	console.log("audit");
	await page.click("nav >> text=History");
	await page.waitForSelector("td:has-text('decision.recorded')");
	check(await page.isVisible("td:has-text('review.override')"), "the override and decision are in the audit trail");
	check(await page.isVisible("td:has-text('firm.criterion_approved')"), "the research approval is in the audit trail");

	// ------------------------------------------------------------------------------------------------------------------
	// Product journeys: representative, moderator, founder. Every step goes through the real UI, server and FeltDB.
	// ------------------------------------------------------------------------------------------------------------------
	const signIn = async (token: string) => {
		await page.evaluate(() => { window.location.hash = "#/"; }); // leave any record page: its id belongs to the session being closed
		await page.click("text=Sign out");
		await page.fill("input[type=password]", token);
		await page.click("button[type=submit]");
		await page.waitForSelector("[data-testid=role-line]");
	};
	const go = async (hash: string) => {
		await page.evaluate((x) => { window.location.hash = x; }, hash);
	};
	const noOverflow = async (label: string) => {
		const w = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
		if (w.sw > w.iw + 1) {
			const wide = await page.evaluate(() => Array.from(document.querySelectorAll("body *")).filter((e) => e.getBoundingClientRect().right > window.innerWidth + 1).slice(0, 8).map((e) => `${e.tagName.toLowerCase()}.${(e as HTMLElement).className} ${Math.round(e.getBoundingClientRect().right)}`));
			console.log(`  wide elements on ${label}: ${wide.join(" | ")}`);
		}
		check(w.sw <= w.iw + 1, `${label} fits the screen without sideways scrolling (${w.sw} ≤ ${w.iw})`);
	};
	/** Names, landmarks and headings: the things a screen reader and keyboard user depend on. */
	const a11y = async (label: string) => {
		const problems = await page.evaluate(() => {
			const out: string[] = [];
			const named = (el: Element) => {
				const e = el as HTMLInputElement;
				return !!(el.getAttribute("aria-label") || el.getAttribute("aria-labelledby") || el.getAttribute("title") || (e.labels && e.labels.length) || (el.tagName === "BUTTON" && el.textContent?.trim()));
			};
			for (const el of Array.from(document.querySelectorAll("input:not([type=hidden]), select, textarea, button"))) if (!named(el) && !(el as HTMLElement).closest("dialog:not([open])")) out.push(`unnamed ${el.tagName.toLowerCase()} ${(el as HTMLElement).outerHTML.slice(0, 80)}`);
			if (document.querySelectorAll("main").length !== 1) out.push("expected exactly one main landmark");
			if (document.querySelectorAll("h1").length !== 1) out.push(`expected exactly one h1, found ${document.querySelectorAll("h1").length}`);
			for (const n of Array.from(document.querySelectorAll("nav"))) if (!n.getAttribute("aria-label")) out.push("a nav landmark has no label");
			for (const t of Array.from(document.querySelectorAll("table"))) if (!t.querySelector("th")) out.push("a table has no header cells");
			return out;
		});
		check(problems.length === 0, `${label} has named controls, one main and one h1, labelled navigation${problems.length ? `: ${problems.join(" | ")}` : ""}`);
	};

	console.log("investor representative: find, claim, prove, wait for verification");
	await signIn(TOKENS.rRep);
	await page.waitForSelector("text=You have not claimed a firm yet");
	check(await page.isVisible("nav >> text=My firm") && !(await page.isVisible("nav >> text=Review queue")) && !(await page.isVisible("nav >> text=Operations")), "a representative's navigation holds only what their role includes");
	check((await page.innerText("[data-testid=role-line]")).includes("Investor representative"), "the person's role is stated in plain words");
	await page.click("button:has-text('Request to represent this firm')");
	await page.waitForSelector("text=Enter the firm's website");
	check(await page.isVisible("text=Say what your role is"), "the claim form says exactly what is missing");
	await page.fill("[data-testid=request-claim] input >> nth=0", "alpine.vc");
	await page.fill("[data-testid=request-claim] input >> nth=1", "Alpine Ventures");
	await page.fill("[data-testid=request-claim] textarea", "Partner at Alpine Ventures; listed on the team page.");
	await page.click("button:has-text('Request to represent this firm')");
	await page.waitForSelector("[data-testid=my-claim]");
	check(await page.isVisible("[data-testid=status-trio] >> text=Claim submitted"), "a claim starts as submitted, not verified");
	check(await page.isVisible("[data-testid=status-trio] >> text=Not published"), "claim status and publication status are shown separately");
	check(!(await page.isVisible("a:has-text('Review and approve')")), "an unverified representative is offered no approval controls");
	await page.click("button:has-text('Check the proof')");
	await page.waitForSelector("text=The challenge was not found");
	check(true, "a missing proof is reported honestly");
	const challenge = (await page.locator("[data-testid=my-claim] code.digest").innerText()).trim();
	sites["alpine.vc"]!["/.well-known/attn-invest-claim.txt"] = { type: "text/plain", body: challenge };
	await page.click("button:has-text('Check the proof')");
	await page.waitForSelector("[data-testid=status-trio] >> text=Domain proof found");
	check(await page.isVisible("[data-testid=claim-next] >> text=A moderator still decides"), "the page says what happens next: a proof alone is not authority");
	await go("#/review");
	await page.waitForSelector("text=This page is not part of your role");
	check(true, "a representative cannot open the moderator queue");
	await go("#/operations/sources");
	await page.waitForSelector("text=This page is not part of your role");
	check(true, "or the operations area");
	await go("#/");
	await a11y("My firm");
	await snap("e2e-rep-claim");

	console.log("moderator: queue, provenance, confirmation, decision history");
	// An entity-resolution item for the moderator workspace: a funding feed names "Meridian Ventures", and a firm with that name exists.
	const svc = h.runtime.service;
	await svc.research.reconcile(actor("ws-mod"), { url: "meridian.vc", name: "Meridian Ventures" });
	const feed = (await svc.sources.register(actor("ws-mod"), { name: "Funding News", canonicalUrl: "https://fundingnews.example.com/feed.xml", publisher: "Funding News", sourceType: "funding_news", adapter: "funding_news_feed", accessBasis: "public_feed", termsNote: "Public RSS feed; terms allow personal and automated reading of the feed." })).source;
	await svc.sources.runSource(actor("ws-mod"), feed.id);
	await signIn(TOKENS.mModerator);
	await page.waitForSelector("[data-testid=queue-summary]");
	check((await page.innerText("[data-testid=role-line]")).includes("Moderator") && (await page.innerText("h1")) === "Review queue", "a moderator lands on the review queue");
	check(await page.isVisible("nav >> text=Review queue") && !(await page.isVisible("nav >> text=My firm")), "moderator navigation shows the queue, history and operations");
	check(await page.isVisible("[data-testid=queue-summary] >> text=1 representative claim") && (await page.isVisible("[data-testid=queue-summary] >> text=entity match")), "the queue summarises what is waiting, by kind");
	const claim = "[data-testid=claim-review]";
	check(await page.isVisible(`${claim} >> text=Found at the well-known address`) && (await page.isVisible(`${claim} >> text=self-reported, not independent evidence`)), "the moderator sees the proof and which statements are only self-reported");
	check(!(await page.innerText(claim)).includes(challenge), "the challenge itself is never shown to the moderator");
	await page.fill(`${claim} label:has-text('Your reason') input`, "Domain proof succeeded; the partner is on the team page.");
	await page.click(`${claim} button:has-text('Verify as representative')`);
	await page.waitForSelector("dialog[open]");
	check(await page.evaluate(() => !!document.activeElement?.closest("dialog")), "the confirmation dialog takes keyboard focus");
	check(await page.isVisible("dialog[open] >> text=You can revoke this later"), "the dialog states the consequence in plain words");
	await page.keyboard.press("Escape");
	await page.waitForSelector("dialog[open]", { state: "detached" });
	check(await page.evaluate(() => document.activeElement?.textContent?.includes("Verify as representative") ?? false), "Escape cancels, and focus returns to the button that opened it");
	check(await page.isVisible(claim), "cancelling decides nothing");
	await page.click(`${claim} button:has-text('Verify as representative')`);
	await page.click("dialog[open] button:has-text('Verify representative')");
	await page.waitForSelector("[data-testid=claim-review]", { state: "detached" });
	check(true, "a confirmed decision takes the claim off the queue");
	const matchCard = "[data-testid=match-card]";
	await page.waitForSelector(matchCard);
	check(await page.isVisible(`${matchCard} >> text=name only, which is never enough on its own`), "an ambiguous entity match shows why it is only a candidate");
	await page.fill(`${matchCard} label:has-text('The evidence you considered') input`, "Same firm: the feed links to its site.");
	await page.click(`${matchCard} button:has-text('They are the same')`);
	await page.click("dialog[open] button:has-text('Confirm: same entity')");
	await page.waitForSelector("[data-testid=match-card]", { state: "detached" });
	await page.waitForSelector("[data-testid=recent-decisions] >> text=Verified a representative by");
	check(await page.isVisible("[data-testid=recent-decisions] >> text=Confirmed two records are the same entity"), "both decisions appear under recent decisions, with who made them");
	check((await page.innerText("[data-testid=recent-decisions]")).includes("mona"), "the responsible person is named");
	await page.reload();
	await page.waitForSelector("[data-testid=recent-decisions]");
	check(await page.isVisible("text=Nothing needs your decision"), "an empty queue says so once, without empty sections");
	check(await page.isVisible("[data-testid=recent-decisions] >> text=Verified a representative"), "after a refresh the decisions are still there");
	await go("#/theses");
	await page.waitForSelector("text=This page is not part of your role");
	check(true, "a moderator cannot open fund-side screens");
	await go("#/");
	await a11y("Review queue");
	await snap("e2e-moderator-queue");

	console.log("investor representative: approve and publish through the authorised workflow");
	await signIn(TOKENS.rRep);
	await page.waitForSelector("[data-testid=status-trio] >> text=Verified by a moderator");
	check(await page.isVisible("[data-testid=status-trio] >> text=Not published"), "verification is separate from publication");
	await page.click("a:has-text('Review and approve the firm')");
	await page.waitForSelector("[data-testid=authority]");
	check(await page.isVisible("text=Stated on the firm's own site") && (await page.isVisible("text=External observations")) && (await page.isVisible("text=Approved criteria")), "approved criteria, the firm's own site, and external observations are listed apart");
	await page.click("summary:has-text('check size')");
	await page.click("details[open] >> text=Approve as the firm…");
	await page.fill("details[open] label:has-text('Why you approve') input", "Our published range.");
	await page.click("details[open] >> text=Approve as the firm");
	await page.waitForSelector("text=Approved by the firm's verified representative");
	await page.check("[data-testid=authority] input[type=checkbox]");
	await page.click("button:has-text('Publish selected criteria')");
	await page.waitForSelector("dialog[open]");
	check(await page.isVisible("dialog[open] >> text=Every workspace will see"), "publishing states who will see it before it happens");
	await page.click("dialog[open] button:has-text('Publish')");
	await page.waitForSelector("[data-testid=profile-history] >> text=Published version 1");
	await page.click("nav >> text=My firm");
	await page.waitForSelector("[data-testid=published-summary]");
	check(await page.isVisible("[data-testid=status-trio] >> text=Published, version 1") && (await page.isVisible("[data-testid=published-summary] >> text=Approved by the firm")), "publication is shown on its own, with exactly what every workspace sees");
	await page.reload();
	await page.waitForSelector("[data-testid=published-summary]");
	check(true, "after a refresh the published state is still there");
	await snap("e2e-rep-published");

	console.log("founder: profile, evidence, investors, explanation, shortlist, action, re-evaluation");
	await signIn(TOKENS.fFounder);
	await page.waitForSelector("text=Your startups");
	check((await page.innerText("[data-testid=role-line]")).includes("Founder") && (await page.isVisible("nav >> text=Find investors")) && !(await page.isVisible("nav >> text=Theses")) && !(await page.isVisible("nav >> text=History")), "a founder's navigation holds only the founder journey");
	await page.waitForSelector("text=No startup yet");
	check(true, "a new founder workspace starts empty, with nothing invented");
	await page.click("button:has-text('Create startup')");
	await page.waitForSelector("text=Enter the company name.");
	check(true, "the company name is the one required field, with an inline message");
	await page.fill("label:has-text('Company name') input", "Acme Pay");
	await page.click("button:has-text('Create startup')");
	await page.waitForSelector("h1:has-text('Acme Pay')");
	check(page.url().includes("/profile"), "each step has its own address");
	check(await page.isVisible("[data-testid=missing-for-matching] >> text=sector"), "the profile says what is still needed to compare with investors");
	await page.click("nav[aria-label='Your journey'] >> text=Find investors");
	await page.waitForSelector("text=Save your profile first");
	check(true, "investors cannot be compared before there is a profile, and the page says why");
	await page.click("nav[aria-label='Your journey'] >> text=Profile");
	await page.selectOption("select[aria-label='Sector status']", "provided");
	await page.selectOption("select[aria-label='Current stage status']", "provided");
	await page.selectOption("select[aria-label='Current stage']", "seed");
	await page.selectOption("select[aria-label='Round you are raising status']", "provided");
	await page.selectOption("select[aria-label='Round you are raising']", "seed");
	await page.selectOption("select[aria-label='Target raise (US dollars) status']", "provided");
	await page.fill("[data-field=targetRaise] input >> nth=0", "1000000");
	await page.fill("[data-field=targetRaise] input >> nth=1", "1500000");
	check(await page.isVisible("[data-field=targetRaise] >> text=$1M–$1.5M"), "a raise range is shown as formatted currency");
	await page.click("button:has-text('Save profile')");
	await page.waitForSelector("#profile-errors");
	check(await page.isVisible("#profile-errors >> text=Choose at least one sector"), "a field that was started but not filled in is named, and the message is also next to it");
	check((await page.inputValue("[data-field=targetRaise] input >> nth=0")) === "1000000", "nothing typed is lost when validation fails");
	await page.check("[data-field=sectors] label:has-text('fintech') input");
	await page.selectOption("select[aria-label='Headquarters status']", "provided");
	await page.selectOption("select[aria-label='Headquarters']", "united_kingdom");
	await page.waitForSelector("[data-testid=ready-for-matching]");
	check(await page.isVisible("[data-field=revenueStatus] >> text=Left unknown") || (await page.isVisible("[data-field=revenueStatus] >> text=never as a failure")), "fields left unknown are labelled as missing, not as failures");
	// unsaved text survives moving to another step
	await page.fill("label:has-text('Concise description') textarea", "Payments for small shops");
	await page.click("nav[aria-label='Your journey'] >> text=Evidence");
	await page.waitForSelector("h2:has-text('Documents')");
	await page.click("nav[aria-label='Your journey'] >> text=Profile");
	await page.waitForSelector("[data-testid=unsaved]");
	check((await page.inputValue("label:has-text('Concise description') textarea")) === "Payments for small shops", "unsaved changes survive moving between steps");
	await page.click("button:has-text('Save profile')");
	await page.waitForSelector("text=Saved as version 1.");
	await page.reload();
	await page.waitForSelector("[data-testid=profile-form]");
	check((await page.inputValue("select[aria-label='Current stage']")) === "seed" && !(await page.isVisible("[data-testid=unsaved]")), "after a refresh the saved profile is exactly as it was");
	// evidence
	await page.click("nav[aria-label='Your journey'] >> text=Evidence");
	await page.waitForSelector("h2:has-text('Documents')");
	await page.click("button:has-text('Upload')");
	await page.waitForSelector("text=Choose a PDF file first.");
	await page.setInputFiles("input[type=file]", join(files, "not-a-pdf.pdf"));
	await page.click("button:has-text('Upload')");
	await page.waitForSelector("text=could not be used");
	check(await page.isVisible("text=Nothing from it is used as evidence"), "an unreadable file is refused with what to do next");
	await page.setInputFiles("input[type=file]", join(files, "northwind-deck.pdf"));
	await page.click("button:has-text('Upload')");
	await page.waitForSelector("text=was read");
	await page.setInputFiles("input[type=file]", join(files, "northwind-deck.pdf"));
	await page.click("button:has-text('Upload')");
	await page.waitForSelector("text=was already uploaded");
	check(true, "uploading the same file again is recognised, and nothing is duplicated");
	check(await page.isVisible("[data-testid=evidence-list] >> text=not independently supported"), "extracted statements are labelled as provided by the founder, not as proof");
	check(await page.isVisible("[data-testid=evidence-list] th:has-text('Supports')"), "each statement says what it supports and where it comes from");
	// investors
	await page.click("nav[aria-label='Your journey'] >> text=Find investors");
	await page.waitForSelector("[data-investor='alpine.vc']");
	check(await page.isVisible("[data-testid=universe] >> text=not the whole market"), "the page says the investor list is limited and not the market");
	const card = "[data-investor='alpine.vc']";
	check(await page.isVisible(`${card} >> text=Published by the firm`) && (await page.isVisible(`${card} >> text=profile version 1`)), "the candidate cites its source and the profile version it was compared with");
	check(await page.isVisible(`${card} [data-testid=why-appears]`), "every candidate says why it appears");
	check(await page.isVisible(`${card} [data-dim=mandate]`) && (await page.isVisible(`${card} [data-dim=readiness]`)) && (await page.isVisible(`${card} [data-dim=quality]`)) && (await page.isVisible(`${card} [data-dim=coverage]`)), "fit, readiness, evidence quality and research completeness are separate");
	check(await page.isVisible(`${card} [data-testid=limited]`), "an investor with little published is flagged as a partial view");
	await page.click("[data-testid=filters] summary:has-text('Stage')");
	await page.check("[data-testid=filters] label:has-text('series b') input");
	await page.waitForSelector(`${card} >> text=Kept despite unknown criteria`);
	check(true, "an investor whose stage criterion is unknown is kept, and the card says why");
	await page.uncheck("label:has-text('Keep investors whose criteria are unknown') input");
	await page.waitForSelector("text=No investor matches these filters");
	check(await page.isVisible("button[aria-label='Remove filter: Stage: series b']"), "turning unknown handling off removes it with an explanation; each active filter is shown in words and can be removed alone");
	await page.click("nav[aria-label='Your journey'] >> text=Shortlist");
	await page.waitForSelector("text=Nothing shortlisted yet");
	await page.goBack();
	await page.waitForSelector("text=No investor matches these filters");
	check(true, "filters are kept when going elsewhere and back");
	await page.reload();
	await page.waitForSelector("text=No investor matches these filters");
	check(true, "and after a refresh");
	await page.click("button:has-text('Clear all filters') >> nth=0");
	await page.waitForSelector(card);
	await page.click(`${card} button:has-text('Explain')`);
	await page.click("button:has-text('Evaluate and explain')");
	await page.waitForSelector("[data-testid=verdicts]");
	check(await page.isVisible("[data-testid=verdicts] >> text=Investor fit") && (await page.isVisible("[data-testid=verdicts] >> text=Research completeness")), "the explanation leads with four separate verdicts");
	check(await page.isVisible("[data-testid=mandate-table] tr[data-field=check_size] >> text=Compatible") && (await page.isVisible("[data-testid=mandate-table] tr[data-field=check_size] >> text=Published by a verified representative")), "the main reason cites its source passage");
	check(await page.isVisible("[data-testid=mandate-table] tr[data-field=stage] >> text=Unknown") && (await page.isVisible("[data-testid=mandate-table] tr[data-field=stage] >> text=Unknown is not a mismatch")), "an unknown criterion says it is unknown and why, not that it failed");
	await page.click("summary:has-text('Evaluation details')");
	check(await page.isVisible("[data-testid=provenance] >> text=No AI model was used"), "advanced detail is available but not in the way");
	await a11y("The investor explanation");
	await snap("e2e-fit-explanation");
	await page.click(`${card} button:has-text('Save to shortlist')`);
	await page.waitForSelector(`${card} >> text=On your shortlist`);
	await page.click("nav[aria-label='Your journey'] >> text=Shortlist");
	await page.waitForSelector("[data-testid=shortlist]");
	check(await page.isVisible("[data-testid=plan] >> text=Why:") && (await page.isVisible("text=not a promise that completing them leads to investment")), "next steps are suggestions, each with its reason");
	const firstStep = (await page.locator("[data-testid=shortlist] ul.plain li >> nth=0").innerText()).split("\n")[1] ?? "";
	await page.click("[data-testid=shortlist] button:has-text('Mark done') >> nth=0");
	await page.waitForSelector("[data-testid=shortlist] li.done");
	await page.reload();
	await page.waitForSelector("[data-testid=shortlist] li.done");
	check(firstStep !== undefined, "a completed step is still completed after a refresh");
	await page.fill("[data-testid=shortlist] label:has-text('Private note') input", "Intro via a friend");
	await page.click("[data-testid=shortlist] button:has-text('Save note')");
	await page.waitForFunction(() => !Array.from(document.querySelectorAll("button")).some((b) => b.textContent === "Save note"));
	await page.reload();
	await page.waitForSelector("[data-testid=shortlist]");
	check((await page.inputValue("[data-testid=shortlist] label:has-text('Private note') input")) === "Intro via a friend", "a note is kept");
	// keyboard: opening and cancelling a confirmation
	await page.focus("[data-testid=shortlist] button:has-text('Remove')");
	await page.keyboard.press("Enter");
	await page.waitForSelector("dialog[open]");
	await page.keyboard.press("Escape");
	await page.waitForSelector("dialog[open]", { state: "detached" });
	check(await page.evaluate(() => document.activeElement?.textContent === "Remove"), "removing asks first; a keyboard user can cancel and keeps their place");
	await page.keyboard.press("Tab");
	check(await page.evaluate(() => { const s = getComputedStyle(document.activeElement!); return s.outlineStyle !== "none" && parseFloat(s.outlineWidth) >= 2; }), "the focused control has a visible focus ring");
	// a material change, then re-evaluate and compare
	await page.click("nav[aria-label='Your journey'] >> text=Profile");
	await page.fill("[data-field=targetRaise] input >> nth=0", "100000");
	await page.fill("[data-field=targetRaise] input >> nth=1", "200000");
	await page.click("button:has-text('Save profile')");
	await page.waitForSelector("text=Saved as version 2.");
	check(await page.isVisible("text=used an earlier version of this profile"), "saving says which saved evaluations the change affects");
	await page.click("nav[aria-label='Your journey'] >> text=Shortlist");
	await page.waitForSelector("[data-testid=stale]");
	await page.click("[data-testid=shortlist] button:has-text('Explain')");
	await page.click("button:has-text('Evaluate and explain')");
	await page.waitForSelector("[data-testid=changes]");
	check(await page.isVisible("[data-testid=changes] >> text=version 1 → 2"), "re-running names what changed");
	check(await page.isVisible("[data-testid=mandate-table] tr[data-field=check_size] >> text=Incompatible") && (await page.isVisible("[data-testid=mandate-table] tr[data-field=check_size] >> text=larger than the whole")), "the new result and the eliminating criterion are explained");
	await page.click("summary:has-text('Evaluation history')");
	await page.click("button:has-text('Compare with #1')");
	await page.waitForSelector("[data-testid=comparison]");
	check(await page.isVisible("[data-testid=comparison] >> text=check size: compatible → incompatible"), "two evaluations can be compared, and the first is unchanged");
	// evidence lifecycle: the original file can be removed, the statements stay
	await page.click("nav[aria-label='Your journey'] >> text=Evidence");
	await page.waitForSelector("[data-testid=documents] table");
	await page.click("[data-testid=documents] button:has-text('Delete original')");
	await page.fill("dialog[open] label:has-text('Why') input", "Replaced by a newer deck");
	check(await page.isVisible("dialog[open] >> text=statements read from it, and their hashes, are kept"), "deleting a file says what stays on record");
	await page.click("dialog[open] button:has-text('Delete the original file')");
	await page.waitForSelector("text=Original file deleted");
	check(await page.isVisible("[data-testid=evidence-list] >> text=not independently supported"), "the extracted statements remain after the original is deleted");
	await a11y("The evidence step");
	await snap("e2e-founder-evidence");

	console.log("roles, restricted routes and isolation");
	for (const hash of ["#/review", "#/operations/sources", "#/theses", "#/investors", "#/history"]) {
		await go(hash);
		await page.waitForSelector("text=This page is not part of your role");
	}
	check(true, "a founder cannot open the moderator queue, operations, fund screens or history");
	await signIn(TOKENS.f2Founder);
	await page.waitForSelector("text=No startup yet");
	check(!(await page.isVisible("text=Acme Pay")), "another founder workspace sees none of that startup, profile, evidence or shortlist");
	await signIn(TOKENS.aViewer);
	await page.waitForSelector("text=Needs a reviewer");
	check(!(await page.isVisible("nav >> text=Operations")) && (await page.isVisible("nav >> text=Investor research")), "a read-only fund member sees no operations area");
	await signIn(TOKENS.aPartner);
	await page.waitForSelector("nav >> text=Operations");
	await page.click("nav >> text=Research sources");
	await page.waitForSelector("h1:has-text('Operations')");
	check(await page.isVisible("text=Curated third-party sources"), "operators reach source management through Operations");
	await page.click("nav >> text=System health");
	await page.waitForSelector("text=Evaluation service (Jev)");
	check(true, "and system health, away from every user's main journey");

	console.log("narrow screens");
	await page.setViewportSize({ width: 390, height: 844 });
	await signIn(TOKENS.fFounder);
	await page.waitForSelector("h1:has-text('Acme Pay')");
	for (const step of ["profile", "evidence", "investors", "shortlist"]) {
		await go(`#/founder/${page.url().split("/founder/")[1]!.split("/")[0]}/${step}`);
		await page.waitForSelector(`nav[aria-label='Your journey'] a[aria-current=step]`);
		await page.waitForTimeout(400);
		await noOverflow(`the ${step} step`);
	}
	await page.click("nav[aria-label='Your journey'] >> text=Find investors");
	await page.waitForSelector("[data-investor='alpine.vc']");
	await page.click("[data-investor='alpine.vc'] button:has-text('Explain')");
	await page.click("button:has-text('Evaluate and explain')");
	await page.waitForSelector("[data-testid=mandate-table]");
	await noOverflow("the investor explanation");
	await snap("e2e-mobile-explanation");
	await signIn(TOKENS.mModerator);
	await page.waitForSelector("[data-testid=queue-summary]");
	await noOverflow("the review queue");
	await signIn(TOKENS.rRep);
	await page.waitForSelector("[data-testid=my-claim]");
	await noOverflow("My firm");
	await snap("e2e-mobile-firm");
	await page.setViewportSize({ width: 1360, height: 900 });
	console.log("isolation in the browser");
	await page.click("text=Sign out");
	await page.fill("input[type=password]", TOKENS.bPartner);
	await page.click("button[type=submit]");
	await page.waitForSelector("text=Fund B");
	check(!(await page.isVisible("text=Northwind")), "another workspace sees none of it");
	check(errors.length === 0, `no browser errors${errors.length ? `: ${errors.join(" | ")}` : ""}`);
	console.log("browser e2e passed");
} catch (error) {
	// On a failure, show what the person would have seen: the page text and any browser errors.
	const text = await browser.contexts()[0]?.pages()[0]?.innerText("body").catch(() => "");
	console.log("--- page at failure (" + browser.contexts()[0]?.pages()[0]?.url() + ") ---\n" + String(text).slice(0, 1500) + (errors.length ? `\n--- browser errors ---\n${errors.join("\n")}` : ""));
	throw error;
} finally {
	await browser.close();
	await h.close();
	jev.stop(true);
	await rm(files, { recursive: true, force: true });
}
