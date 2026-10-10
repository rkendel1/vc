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
const h = await startHttpHarness({
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

	console.log("audit");
	await page.click("nav >> text=Audit trail");
	await page.waitForSelector("td:has-text('decision.recorded')");
	check(await page.isVisible("td:has-text('review.override')"), "the override and decision are in the audit trail");

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
