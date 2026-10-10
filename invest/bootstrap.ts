import type { AppPortServer } from "@appport/sdk";
import { createInvestAppPortServer } from "./appport/server.ts";
import { RegistryAuthority, developmentRegistry, loadRegistry } from "./auth/authboundry-adapter.ts";
import { type InvestConfig, describeConfig } from "./config.ts";
import type { ResearchLimits } from "./domain/research.ts";
import type { ResearchDeps } from "./modules/investor-research.ts";
import { DocumentStorage } from "./ingestion/document-storage.ts";
import { JevHttpClient, UnconfiguredJev, type JevDecider } from "./jev/jev-client.ts";
import { SafeHttpFetcher } from "./research/fetcher.ts";
import type { Logger } from "./logger.ts";
import { InvestmentService } from "./service.ts";
import { InvestStore } from "./store/store.ts";

export type ResearchFetcherFactory = ResearchDeps["fetcherFor"];

export function researchLimits(config: InvestConfig): ResearchLimits {
	const r = config.research;
	return { maxPages: r.maxPages, maxDepth: r.maxDepth, timeoutMs: r.timeoutMs, retries: r.retries, perDomainDelayMs: r.perDomainDelayMs, maxBytes: r.maxBytes, maxRedirects: r.maxRedirects };
}

export function defaultFetcherFactory(config: InvestConfig): ResearchFetcherFactory {
	return (scopeDomain, limits) => new SafeHttpFetcher({ scopeDomain, limits, userAgent: config.research.userAgent, robotsToken: "AttnInvestResearchBot" });
}

export type InvestRuntime = {
	config: InvestConfig;
	store: InvestStore;
	storage: DocumentStorage;
	service: InvestmentService;
	authority: RegistryAuthority;
	appport: AppPortServer;
	close(): Promise<void>;
};

/** Translates application configuration into the supported package APIs and wires the one application. */
export async function bootstrap(config: InvestConfig, logger: Logger, overrides: { jev?: JevDecider; fetcherFor?: ResearchFetcherFactory } = {}): Promise<InvestRuntime> {
	const store = await InvestStore.openDir(config.feltdbDir);
	const storage = new DocumentStorage(config.documents.storageDir, config.documents.linkSecret);
	const jev =
		overrides.jev ??
		(config.jev.endpoint
			? new JevHttpClient({ endpoint: config.jev.endpoint, apiKey: config.jev.apiKey, provider: config.jev.provider, model: config.jev.model, timeoutMs: config.jev.timeoutMs })
			: new UnconfiguredJev());
	const service = new InvestmentService({
		store,
		storage,
		jev,
		limits: { maxBytes: config.documents.maxBytes, allowedTypes: config.documents.allowedTypes, maxPages: config.documents.maxPages, parseTimeoutMs: config.documents.parseTimeoutMs },
		evaluation: { timeoutMs: config.evaluation.timeoutMs, maxRetries: config.evaluation.maxRetries, jevTimeoutMs: config.jev.timeoutMs },
		logger,
		research: {
			fetcherFor: overrides.fetcherFor ?? defaultFetcherFactory(config),
			defaults: researchLimits(config),
			staleAfterDays: config.research.staleAfterDays,
			jevTimeoutMs: config.jev.timeoutMs,
		},
	});
	let registry;
	if (config.authConfigPath) registry = await loadRegistry(config.authConfigPath);
	else {
		if (config.appEnv === "production") throw new Error("AUTHBOUNDRY_CONFIG_PATH is required in production");
		registry = developmentRegistry(process.env.INVEST_DEV_TOKEN || undefined);
		logger.warn("Using the development principal registry (workspace ws-dev, role partner); set AUTHBOUNDRY_CONFIG_PATH for real identities", {});
	}
	const authority = new RegistryAuthority(registry);
	const recovered = await service.evaluations.recoverInterrupted(authority.workspaceIds);
	if (recovered) logger.warn("Marked evaluations interrupted by the last shutdown as failed", { recovered });
	const interruptedRuns = await service.research.recoverInterrupted(authority.workspaceIds);
	if (interruptedRuns) logger.warn("Marked research runs interrupted by the last shutdown as failed", { interruptedRuns });
	const appport = createInvestAppPortServer({ service, authority, maxUploadBytes: config.documents.maxBytes });
	logger.info("Attn Invest configured", describeConfig(config));
	return {
		config,
		store,
		storage,
		service,
		authority,
		appport,
		async close() {
			await service.evaluations.settled();
			await service.research.settled();
			await appport.close();
			await store.close();
		},
	};
}
