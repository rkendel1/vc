import { bootstrap } from "../bootstrap.ts";
import { loadConfig } from "../config.ts";
import type { Actor } from "../domain/types.ts";
import { createLogger } from "../logger.ts";
import {
	ADVERSARIAL_DECK,
	CONTOSO_DECK,
	FABRIKAM_DECK,
	FABRIKAM_FINANCIALS,
	NORTHWIND_AUDIT,
	NORTHWIND_DECK,
	SEED_SAAS_CRITERIA,
	SEED_SAAS_SETTINGS,
} from "../testing/fixtures.ts";

/**
 * Seeds a development workspace with a demo thesis, four fictional startups and their documents,
 * and runs one evaluation each, all through the application service (same code paths as the UI).
 * Refuses to run against production. Companies and figures are invented test fixtures.
 */
const { config, warnings } = loadConfig();
if (config.appEnv === "production") {
	console.error("seed-demo refuses to run with APP_ENV=production");
	process.exit(2);
}
const logger = createLogger(config.logLevel);
for (const w of warnings) logger.warn(w);
const runtime = await bootstrap(config, logger);
const workspaceId = process.env.SEED_WORKSPACE ?? runtime.authority.workspaceIds[0];
const actor: Actor = { principalId: "seed", displayName: "Demo seed", workspaceId, permissions: [] };
const svc = runtime.service;

if ((await svc.theses.list(actor)).length) {
	console.log(`Workspace ${workspaceId} already has data; nothing seeded.`);
	await runtime.close();
	process.exit(0);
}

const draft = await svc.theses.createDraft(actor, {
	name: "Seed-stage B2B software",
	description: "Seed rounds in B2B software with real recurring revenue and evidence of repeatable demand.",
	criteria: SEED_SAAS_CRITERIA,
	settings: SEED_SAAS_SETTINGS,
});
const { version } = await svc.theses.approve(actor, { thesisId: draft.id, expectedVersion: draft.__version ?? 1, note: "Initial mandate" });

const companies = [
	{ name: "Northwind Analytics", stage: "Seed", sector: "Logistics analytics", docs: [[NORTHWIND_DECK, "northwind-deck.pdf", "founder_deck"], [NORTHWIND_AUDIT, "northwind-revenue-review.pdf", "third_party_report"]] },
	{ name: "Contoso Robotics", stage: "Seed", sector: "Warehouse robotics", docs: [[CONTOSO_DECK, "contoso-deck.pdf", "founder_deck"]] },
	{ name: "Fabrikam Health", stage: "Seed", sector: "Hospital software", docs: [[FABRIKAM_DECK, "fabrikam-deck.pdf", "founder_deck"], [FABRIKAM_FINANCIALS, "fabrikam-accounts.pdf", "founder_financials"]] },
	{ name: "Tailspin Toys", stage: "Pre-seed", sector: "Consumer", docs: [[ADVERSARIAL_DECK, "tailspin-deck.pdf", "founder_deck"]] },
] as const;

for (const c of companies) {
	const startup = await svc.startups.create(actor, { name: c.name, stage: c.stage, sector: c.sector });
	for (const [bytes, filename, sourceType] of c.docs) await svc.documents.upload(actor, { startupId: startup.id, bytes, filename, mediaType: "application/pdf", sourceType });
	const evaluation = await svc.evaluations.start(actor, { startupId: startup.id, thesisVersionId: version.id, requestKey: `seed-${startup.id}` });
	await svc.evaluations.settled(evaluation.id);
	console.log(`Seeded ${c.name}: evaluation ${evaluation.id}`);
}
await runtime.close();
