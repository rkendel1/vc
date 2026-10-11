/**
 * Browser end-to-end: drives the investor workflow through the built web app in real Chromium,
 * against a real server (FeltDB, AppPort, AuthBoundry adapter) and the Jev HTTP adapter pointed at
 * the stand-in. Run with `bun run e2e:browser` after `bun run build:web`.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { JevHttpClient } from "../jev/jev-client.ts";
import { FakeWeb, html, thesisSite } from "../testing/fake-web.ts";
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

const jev = startJevStandin({ port: 0, apiKey: "e2e-key" });
const sites = {
	"alpine.vc": thesisSite(),
	"quiet.vc": { "/robots.txt": { status: 404 }, "/": html("Quiet Capital", `<p>${"Quiet Capital is a firm that values patience. ".repeat(12)}</p>`) },
	"walled.vc": { "/robots.txt": { type: "text/plain", body: "User-agent: *\nDisallow: /\n" }, "/": html("Walled", "x") },
};
const web = new FakeWeb(sites);
const h = await startHttpHarness({
	fetcherFor: web.fetcherFor,
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
	await page.waitForSelector("text=not used as evidence");
	check(true, "a fake PDF is rejected with a reason");
	await page.setInputFiles("input[type=file]", join(files, "northwind-deck.pdf"));
	await page.click("button:has-text('Upload')");
	await page.waitForSelector("text=claim(s) extracted");
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
	await page.click("nav >> text=Investors");
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
	await page.waitForSelector("text=Stated by the firm");
	check(await page.isVisible("text=Inferred from portfolio patterns"), "explicit, observed and inferred criteria are shown apart");
	check(await page.isVisible("text=Observed from announcements"), "observed criteria have their own group");
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
	check(await page.isVisible("text=Sources checked"), "sources checked are listed");
	await snap("e2e-investor");
	await page.click("nav >> text=Investors");
	await page.click("a:has-text('walled.vc')");
	await page.waitForSelector("[data-testid=stub]");
	check(await page.isVisible("[data-testid=stub] >> text=could not adequately cover"), "an incomplete stub explains why research was incomplete");
	check(await page.isVisible("text=Blocked by robots rules"), "the blocked source is listed accurately");
	await page.click("nav >> text=Investors");
	await page.click("a:has-text('Quiet Capital')");
	await page.waitForSelector("[data-testid=stub] >> text=does not mean Quiet Capital has no investment thesis");
	check(true, "a no-thesis stub does not claim the firm has no thesis");
	await page.click("button:has-text('Refresh research')");
	await page.waitForFunction(() => Array.from(document.querySelectorAll("h2")).find((h) => h.textContent === "Research runs")?.closest("section")?.querySelectorAll("tbody tr").length === 2, undefined, { timeout: 20000 });
	check(true, "a refresh can be requested and adds a run to the history");

	console.log("monitoring and timeline");
	const alpine = (await research.lookup(actor("ws-a"), "alpine.vc"))!;
	await h.runtime.service.monitoring.register(actor("ws-a"), alpine);
	await page.click("nav >> text=Investors");
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
	await page.click("nav >> text=Investors");
	await page.waitForSelector("td:has-text('Alpine Ventures')");
	check(await page.isVisible("td >> text=Monitored"), "the directory shows monitoring state");

	console.log("audit");
	await page.click("nav >> text=Audit trail");
	await page.waitForSelector("td:has-text('decision.recorded')");
	check(await page.isVisible("td:has-text('review.override')"), "the override and decision are in the audit trail");
	check(await page.isVisible("td:has-text('firm.criterion_approved')"), "the research approval is in the audit trail");

	console.log("collaboration: representative, moderator, founder");
	const signIn = async (token: string, waitFor: string) => {
		await page.evaluate(() => { window.location.hash = "#/"; }); // leave any record page: its id belongs to the session being closed
		await page.click("text=Sign out");
		await page.fill("input[type=password]", token);
		await page.click("button[type=submit]");
		await page.waitForSelector(waitFor);
		await page.click("nav >> text=Investors");
		await page.click("role=tab[name='Directory']");
	};
	const toDirectory = async () => {
		await page.click("nav >> text=Investors");
		await page.click("role=tab[name='Directory']");
	};
	for (const ws of ["ws-rep", "ws-f"]) {
		const { firm } = await research.reconcile(actor(ws), { url: "alpine.vc" });
		await research.research(actor(ws), firm.id, { verify: false });
	}
	// the representative asks to represent the firm: signing up grants nothing
	await signIn(TOKENS.rRep, "text=Meridian representatives");
	await page.click("role=tab[name='Claims & published profiles']");
	await page.fill("[data-testid=request-claim] input >> nth=0", "alpine.vc");
	await page.fill("[data-testid=request-claim] input >> nth=1", "Alpine Ventures");
	await page.fill("[data-testid=request-claim] textarea", "Partner at Alpine Ventures; listed on the team page.");
	await page.click("text=Request to represent this firm");
	await page.waitForSelector("[data-testid=my-claim]");
	check(await page.isVisible("[data-testid=my-claim] >> text=requested"), "a claim starts as requested, not verified");
	const challenge = (await page.locator("[data-testid=my-claim] code.digest").innerText()).trim();
	sites["alpine.vc"]["/.well-known/attn-invest-claim.txt"] = { type: "text/plain", body: challenge };
	await page.click("button:has-text('Check the proof')");
	await page.waitForSelector("text=The challenge was found at the well-known path.");
	await toDirectory();
	await page.click("a:has-text('Alpine Ventures')");
	await page.waitForSelector("[data-testid=no-authority]");
	check(true, "a proof alone gives no authority: the representative cannot approve or publish yet");
	// a founder keeps a private contribution
	await signIn(TOKENS.fFounder, "text=Founder workspace");
	await page.click("a:has-text('Alpine Ventures')");
	await page.waitForSelector("[data-testid=contribution-form]");
	await page.selectOption("[data-testid=contribution-form] select >> nth=1", "check_size");
	await page.fill("[data-testid=contribution-form] input[type=number] >> nth=0", "100000");
	await page.fill("[data-testid=contribution-form] input[type=number] >> nth=1", "400000");
	await page.fill("[data-testid=contribution-form] textarea", "Their partner told me their cheques are 100 to 400 thousand.");
	await page.click("text=Save privately");
	await page.waitForSelector("text=Saved privately.");
	await toDirectory();
	await page.click("role=tab[name='Contributions']");
	await page.waitForSelector("[data-testid=my-contribution]");
	check(await page.isVisible("[data-testid=my-contribution] .tag >> text=Private"), "a founder contribution is private by default");
	check(await page.isVisible("text=Share with moderators"), "sharing is an explicit, separate choice");
	await page.click("text=Share with moderators");
	await page.waitForSelector("text=Stop sharing with moderators");
	// the moderator verifies the representative, and sees only what was shared
	await signIn(TOKENS.mModerator, "text=Platform moderation");
	await page.click("role=tab[name='Inbox']");
	await page.waitForSelector("[data-testid=claim-review]");
	check(await page.isVisible("[data-testid=claim-review] >> text=found at the well-known path"), "the moderator sees the domain proof as evidence");
	check(await page.isVisible("[data-testid=shared-contribution] >> text=The author is not identified"), "a shared contribution is shown without identifying its author");
	await page.fill("[data-testid=shared-contribution] input", "Not corroborated by a second source.");
	await page.click("[data-testid=shared-contribution] button:has-text('Dispute')");
	await page.fill("[data-testid=claim-review] input >> nth=1", "Domain proof succeeded; partner is on the team page.");
	await page.click("text=Verify as representative");
	await page.waitForSelector("text=No representative claims are waiting.");
	check(true, "a moderator verifies the claim with a rationale");
	// the verified representative approves as the firm and publishes
	await signIn(TOKENS.rRep, "text=Meridian representatives");
	await page.click("a:has-text('Alpine Ventures')");
	await page.waitForSelector("[data-testid=authority]");
	await page.click("summary:has-text('check size')");
	await page.click("details[open] >> text=Approve as the firm…");
	await page.fill("details[open] label:has-text('Why you approve') input", "Our published range.");
	await page.click("details[open] >> text=Approve as the firm");
	await page.waitForSelector("text=Approved by the firm's verified representative");
	await page.check("[data-testid=authority] input[type=checkbox]");
	await page.click("text=Publish selected criteria");
	await page.waitForSelector("[data-testid=profile-history] >> text=Published version 1");
	check(true, "a verified representative approves a criterion as the firm and publishes it");
	// another fund sees the published layer only, and the firm's page marks it as the firm's own statement
	await signIn(TOKENS.aPartner, "text=Fund A");
	await page.click("role=tab[name='Claims & published profiles']");
	await page.waitForSelector("td:has-text('Alpine Ventures')");
	check(!(await page.isVisible("text=Their partner told me")), "a founder's private note is not visible to another workspace");
	await toDirectory();
	await page.click("a:has-text('Alpine Ventures')");
	await page.waitForSelector("[data-testid=published-note]");
	check(await page.isVisible("[data-testid=published-note] >> text=Other sources do not override it"), "the published profile is shown as the firm's own, and not overridable");
	await page.click("[data-testid=field-check_size] summary");
	check(await page.isVisible("[data-testid=field-check_size] .tag.cat-investor_verified"), "claims keep separate provenance labels per category");
	await snap("e2e-reconciliation");
	// the founder sees the dispute and that the contribution was kept
	await signIn(TOKENS.fFounder, "text=Founder workspace");
	await page.click("role=tab[name='Contributions']");
	await page.waitForSelector("text=Your contribution and evidence are kept.");
	check(await page.isVisible("[data-testid=my-contribution] >> text=Not corroborated by a second source."), "a dispute is shown with its reason; the contribution stays");

	console.log("founder matching: profile, evidence, candidates, explanation, shortlist, re-evaluation");
	await page.evaluate(() => { window.location.hash = "#/"; });
	await page.click("nav >> text=Founder");
	await page.waitForSelector("text=Your startups");
	await page.waitForSelector("text=No startup yet");
	check(true, "a new founder workspace starts empty, with nothing invented");
	await page.fill("label:has-text('Company name') input", "Acme Pay");
	await page.click("button:has-text('Create startup')");
	await page.waitForSelector("h1:has-text('Acme Pay')");
	// before a profile exists the candidate view refuses to guess
	await page.click("role=tab[name='Investors']");
	check(await page.isVisible("text=Save a startup profile first"), "candidates need a saved profile first");
	await page.click("role=tab[name='Profile']");
	await page.selectOption("select[aria-label='Sector status']", "provided");
	await page.check("[data-field=sectors] label:has-text('fintech') input");
	await page.selectOption("select[aria-label='Current stage status']", "provided");
	await page.selectOption("select[aria-label='Current stage']", "seed");
	await page.selectOption("select[aria-label='Round you are raising status']", "provided");
	await page.selectOption("select[aria-label='Round you are raising']", "seed");
	await page.selectOption("select[aria-label='Target raise (USD) status']", "provided");
	await page.fill("[data-field=targetRaise] input >> nth=0", "1000000");
	await page.fill("[data-field=targetRaise] input >> nth=1", "1500000");
	check(await page.isVisible("[data-field=targetRaise] >> text=$1M–$1.5M"), "a raise range is shown as formatted currency");
	await page.selectOption("select[aria-label='Annual recurring revenue (USD) status']", "provided");
	await page.fill("input[aria-label='Annual recurring revenue']", "2400000");
	check(await page.isVisible("[data-field=revenueStatus] >> text=Left unknown"), "fields left unknown are labelled as missing, not as failures");
	await page.click("button:has-text('Save profile')");
	await page.waitForSelector("text=Saved as version 1.");
	check(true, "the profile is saved as version 1");
	// evidence reuses the existing document pipeline
	await page.click("role=tab[name='Evidence']");
	await page.click("a:has-text('Upload documents or review extracted evidence')");
	await page.waitForSelector("input[type=file]");
	await page.setInputFiles("input[type=file]", join(files, "northwind-deck.pdf"));
	await page.click("button:has-text('Upload')");
	await page.waitForSelector("text=claim(s) extracted");
	await page.goBack();
	await page.waitForSelector("h1:has-text('Acme Pay')");
	await page.click("role=tab[name='Evidence']");
	await page.waitForSelector("[data-testid=evidence-list]");
	check(await page.isVisible("[data-testid=evidence-list] >> text=Founder-reported"), "uploaded evidence is labelled founder-supplied, not as proof");
	// candidates
	await page.click("role=tab[name='Investors']");
	await page.waitForSelector("[data-investor='alpine.vc']");
	const card = "[data-investor='alpine.vc']";
	check(await page.isVisible(`${card} >> text=profile version 1`) && (await page.isVisible(`${card} >> text=From this workspace's research`)), "the candidate cites its source and the investor profile version it was compared with");
	check(await page.isVisible(`${card} [data-dim=mandate] >> text=Compatible on what is known`), "mandate fit is stated only for the criteria that could be checked");
	check(await page.isVisible(`${card} [data-dim=readiness]`) && (await page.isVisible(`${card} [data-dim=quality]`)) && (await page.isVisible(`${card} [data-dim=coverage]`)), "fit, readiness, evidence quality and coverage are separate");
	// filters over sourced criteria
	await page.click("[data-testid=filters] summary:has-text('Stage')");
	await page.check("[data-testid=filters] label:has-text('series b') input");
	await page.waitForSelector("text=No investor matches these filters");
	check(true, "a stage filter removes an investor whose stated stages do not include it, and says so");
	await page.click("button:has-text('Clear filters')");
	await page.waitForSelector(card);
	// explanation
	await page.click(`${card} button:has-text('Explain')`);
	await page.click("button:has-text('Evaluate and explain')");
	await page.waitForSelector("[data-testid=mandate-table]");
	check(await page.isVisible("[data-testid=mandate-table] tr[data-field=check_size] >> text=Compatible"), "the check-size criterion is compatible");
	check(await page.isVisible("[data-testid=mandate-table] tr[data-field=check_size] >> text=Published by a verified representative"), "the criterion's source passage is shown");
	check(await page.isVisible("[data-testid=mandate-table] tr[data-field=business_model] >> text=Unknown"), "a criterion the startup has not stated is unknown, not a failure");
	check(await page.isVisible("[data-testid=mandate-table] tr[data-field=stage] >> text=Stated on the firm's own site"), "a criterion from the firm's own site is labelled as stated, not approved");
	check(await page.isVisible("[data-testid=readiness] >> text=generic checklist, not this investor's requirement"), "generic readiness items are labelled as such");
	check(await page.isVisible("[data-testid=quality] >> text=Annual recurring revenue"), "the profile's claims are assessed for evidence quality");
	await page.click("summary:has-text('Provenance')");
	check(await page.isVisible("[data-testid=provenance] >> text=Startup profile version 1") && (await page.isVisible("[data-testid=provenance] >> text=No AI model was used")), "the evaluation records the versions it used");
	await snap("e2e-fit-explanation");
	// shortlist and plan
	await page.click(`${card} button:has-text('Save to shortlist')`);
	await page.waitForSelector(`${card} >> text=On your shortlist`);
	await page.click("role=tab[name='Shortlist & plan']");
	await page.waitForSelector("[data-testid=shortlist]");
	check(await page.isVisible("[data-testid=plan]") && (await page.isVisible("text=not a promise that completing them leads to investment")), "next steps are recommendations, each with its reason");
	check(await page.isVisible("[data-testid=plan] >> text=Why:"), "each next step explains the finding behind it");
	await page.fill("[data-testid=shortlist] label:has-text('Private note') input", "Intro via a friend");
	await page.click("[data-testid=shortlist] button:has-text('Save note')");
	await page.selectOption("[data-testid=shortlist] select", "ready");
	await snap("e2e-shortlist");
	// a material change makes the saved evaluation stale; re-running shows what changed
	await page.click("role=tab[name='Profile']");
	await page.fill("[data-field=targetRaise] input >> nth=0", "100000");
	await page.fill("[data-field=targetRaise] input >> nth=1", "200000");
	await page.click("button:has-text('Save profile')");
	await page.waitForSelector("text=Saved as version 2.");
	await page.click("role=tab[name='Shortlist & plan']");
	await page.waitForSelector("[data-testid=stale]");
	check(await page.isVisible("[data-testid=stale] >> text=startup profile changed"), "the shortlist says the evaluation no longer matches the profile");
	await page.click("[data-testid=shortlist] button:has-text('Explain')");
	await page.click("button:has-text('Evaluate and explain')");
	await page.waitForSelector("[data-testid=changes]");
	check(await page.isVisible("[data-testid=changes] >> text=version 1 → 2"), "re-running names what changed");
	check(await page.isVisible("[data-testid=mandate-table] tr[data-field=check_size] >> text=Incompatible (authoritative)"), "the new result reflects the changed raise");
	check(await page.isVisible("[data-testid=mandate-table] tr[data-field=check_size] >> text=larger than the whole"), "the eliminating constraint is explained");
	await page.click("summary:has-text('Evaluation history')");
	await page.click("button:has-text('Compare with #1')");
	await page.waitForSelector("[data-testid=comparison]");
	check(await page.isVisible("[data-testid=comparison] >> text=check size: compatible → incompatible"), "two evaluations can be compared; the first is unchanged");
	await snap("e2e-fit-compare");
	// a second founder sees none of it
	await signIn(TOKENS.f2Founder, "text=Second founder workspace");
	await page.click("nav >> text=Founder");
	await page.waitForSelector("text=Your startups");
	await page.waitForSelector("text=No startup yet");
	check(!(await page.isVisible("text=Acme Pay")), "another founder workspace cannot see the startup, profile or shortlist");
	await page.evaluate(() => { window.location.hash = "#/"; });
	await signIn(TOKENS.fFounder, "text=Founder workspace");

	console.log("isolation in the browser");
	await page.click("text=Sign out");
	await page.fill("input[type=password]", TOKENS.bPartner);
	await page.click("button[type=submit]");
	await page.waitForSelector("text=Fund B");
	check(!(await page.isVisible("text=Northwind")), "another workspace sees none of it");
	check(errors.length === 0, `no browser errors${errors.length ? `: ${errors.join(" | ")}` : ""}`);
	console.log("browser e2e passed");
} finally {
	await browser.close();
	await h.close();
	jev.stop(true);
	await rm(files, { recursive: true, force: true });
}
