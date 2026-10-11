import { loadRegistry } from "../auth/authboundry-adapter.ts";
import { monitoringOptions } from "../bootstrap.ts";
import { type InvestConfig, loadConfig } from "../config.ts";
import type { Actor } from "../domain/types.ts";
import { JevHttpClient, UnconfiguredJev } from "../jev/jev-client.ts";
import { InvestorResearchModule } from "../modules/investor-research.ts";
import { MonitoringModule } from "../modules/monitoring.ts";
import { SafeHttpFetcher } from "../research/fetcher.ts";
import { InvestStore } from "../store/store.ts";

/** What the command-line tools share: the store, the research and monitoring modules, and the operator's actor. No server, no AppPort. */
export type Stack = { config: InvestConfig; store: InvestStore; research: InvestorResearchModule; monitoring: MonitoringModule; actor: Actor; close(): Promise<void> };

export async function openStack(options: { workspace: string; clock?: () => Date; fail: (message: string) => never }): Promise<Stack> {
	const { config, warnings } = loadConfig();
	for (const w of warnings.filter((w) => !/Jev is not configured|DOCUMENT_STORAGE/.test(w))) console.error(`warning: ${w}`);
	// The workspace must exist in the identity registry when one is configured; the CLI never invents workspaces.
	if (config.authConfigPath) {
		const registry = await loadRegistry(config.authConfigPath);
		if (!registry.workspaces.some((w) => w.id === options.workspace)) options.fail(`Workspace "${options.workspace}" is not in ${config.authConfigPath}`);
	} else if (config.appEnv === "production") options.fail("AUTHBOUNDRY_CONFIG_PATH is required in production");
	else if (options.workspace !== "ws-dev") console.error(`warning: no AUTHBOUNDRY_CONFIG_PATH; the development registry only knows workspace "ws-dev"`);

	const store = await InvestStore.openDir(config.feltdbDir, options.clock);
	const jev = config.jev.endpoint ? new JevHttpClient({ endpoint: config.jev.endpoint, apiKey: config.jev.apiKey, provider: config.jev.provider, model: config.jev.model, timeoutMs: config.jev.timeoutMs }) : new UnconfiguredJev();
	const r = config.research;
	const research = new InvestorResearchModule({
		store,
		jev,
		fetcherFor: (scopeDomain, limits) => new SafeHttpFetcher({ scopeDomain, limits, userAgent: r.userAgent, robotsToken: "AttnInvestResearchBot" }),
		defaults: { maxPages: r.maxPages, maxDepth: r.maxDepth, timeoutMs: r.timeoutMs, retries: r.retries, perDomainDelayMs: r.perDomainDelayMs, maxBytes: r.maxBytes, maxRedirects: r.maxRedirects },
		staleAfterDays: r.staleAfterDays,
		staleSourceDays: r.staleSourceDays,
		lookbackDays: r.announcementLookbackDays,
		jevTimeoutMs: config.jev.timeoutMs,
	});
	const monitoring = new MonitoringModule(store, research, monitoringOptions(config));
	const actor: Actor = { principalId: "research-cli", displayName: "Research CLI", workspaceId: options.workspace, permissions: ["invest.read", "research.run"] };
	return { config, store, research, monitoring, actor, close: () => store.close() };
}
