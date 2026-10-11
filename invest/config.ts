import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Application configuration. These names are the application's own; this adapter translates
 * them into the supported package APIs (FeltDB file runtime directory, AppPort binding,
 * AuthBoundry adapter registry, Jev HTTP contract). Secrets come from the environment only and
 * are never logged, persisted, or sent to the browser.
 */
export type AppEnv = "development" | "test" | "production";
export type LogLevel = "debug" | "info" | "warn" | "error";

export type InvestConfig = {
	appEnv: AppEnv;
	logLevel: LogLevel;
	port: number;
	feltdbDir: string;
	authConfigPath: string | null;
	jev: { endpoint: string | null; apiKey: string | null; provider: string | null; model: string | null; timeoutMs: number };
	documents: { storageDir: string; linkSecret: string; maxBytes: number; allowedTypes: string[]; maxPages: number; parseTimeoutMs: number };
	evaluation: { timeoutMs: number; maxRetries: number };
	research: { maxPages: number; maxDepth: number; timeoutMs: number; retries: number; perDomainDelayMs: number; maxBytes: number; maxRedirects: number; userAgent: string; staleAfterDays: number; staleSourceDays: number; announcementLookbackDays: number };
	sources: { maxBytes: number; maxRecords: number };
	monitoring: { enabled: boolean; intervalMinutes: number; maxConcurrentFirms: number; leaseMinutes: number; retryBaseMinutes: number };
};

export class ConfigError extends Error {}

function int(env: NodeJS.ProcessEnv, name: string, fallback: number, min: number, max: number): number {
	const raw = env[name]?.trim();
	if (!raw) return fallback;
	const n = Number(raw);
	if (!Number.isInteger(n) || n < min || n > max) throw new ConfigError(`${name} must be an integer between ${min} and ${max}`);
	return n;
}

function bool(env: NodeJS.ProcessEnv, name: string, fallback: boolean): boolean {
	const raw = env[name]?.trim().toLowerCase();
	if (!raw) return fallback;
	if (["1", "true", "yes", "on"].includes(raw)) return true;
	if (["0", "false", "no", "off"].includes(raw)) return false;
	throw new ConfigError(`${name} must be 1/0 or true/false`);
}

function str(env: NodeJS.ProcessEnv, name: string): string | null {
	const v = env[name]?.trim();
	return v ? v : null;
}

export function defaultDataDir(env: NodeJS.ProcessEnv = process.env): string {
	return join(env.XDG_DATA_HOME || join(homedir(), ".local", "share"), "Attn", "Invest");
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): { config: InvestConfig; warnings: string[] } {
	const warnings: string[] = [];
	const appEnv = (str(env, "APP_ENV") ?? "development") as AppEnv;
	if (!["development", "test", "production"].includes(appEnv)) throw new ConfigError("APP_ENV must be development, test or production");
	const logLevel = (str(env, "LOG_LEVEL") ?? "info") as LogLevel;
	if (!["debug", "info", "warn", "error"].includes(logLevel)) throw new ConfigError("LOG_LEVEL must be debug, info, warn or error");

	const dataDir = defaultDataDir(env);
	if (str(env, "FELTDB_CONFIG_PATH")) warnings.push("FELTDB_CONFIG_PATH is not supported by the FeltDB 0.11.7 file runtime and is ignored; set FELTDB_DIR");

	const jevEndpoint = str(env, "JEV_ENDPOINT");
	if (jevEndpoint) {
		let url: URL;
		try {
			url = new URL(jevEndpoint);
		} catch {
			throw new ConfigError("JEV_ENDPOINT must be an absolute http(s) URL");
		}
		if (url.protocol !== "https:" && url.protocol !== "http:") throw new ConfigError("JEV_ENDPOINT must be http or https");
		if (appEnv === "production" && url.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
			throw new ConfigError("JEV_ENDPOINT must use https in production");
	}
	const jevKey = str(env, "JEV_API_KEY");
	if (jevEndpoint && !jevKey) warnings.push("JEV_ENDPOINT is set without JEV_API_KEY; requests will be sent unauthenticated");
	if (!jevEndpoint) warnings.push("Jev is not configured: semantic criteria will be recorded as evaluation_failed");

	let linkSecret = str(env, "DOCUMENT_STORAGE_LINK_SECRET");
	if (!linkSecret) {
		if (appEnv === "production") throw new ConfigError("DOCUMENT_STORAGE_LINK_SECRET is required in production");
		linkSecret = randomBytes(32).toString("hex");
		warnings.push("DOCUMENT_STORAGE_LINK_SECRET not set; using an ephemeral secret (document links expire on restart)");
	}
	if (linkSecret.length < 16) throw new ConfigError("DOCUMENT_STORAGE_LINK_SECRET must be at least 16 characters");

	const authConfigPath = str(env, "AUTHBOUNDRY_CONFIG_PATH");
	if (!authConfigPath && appEnv === "production") throw new ConfigError("AUTHBOUNDRY_CONFIG_PATH is required in production");

	const allowedTypes = (str(env, "DOCUMENT_ALLOWED_TYPES") ?? "application/pdf")
		.split(",")
		.map((t) => t.trim().toLowerCase())
		.filter(Boolean);
	const unsupported = allowedTypes.filter((t) => t !== "application/pdf");
	if (unsupported.length) throw new ConfigError(`DOCUMENT_ALLOWED_TYPES contains types this MVP cannot parse: ${unsupported.join(", ")}`);

	const config: InvestConfig = {
		appEnv,
		logLevel,
		port: int(env, "INVEST_PORT", 3100, 1, 65535),
		feltdbDir: str(env, "FELTDB_DIR") ?? join(dataDir, "FeltDB"),
		authConfigPath,
		jev: {
			endpoint: jevEndpoint,
			apiKey: jevKey,
			provider: str(env, "JEV_PROVIDER"),
			model: str(env, "JEV_MODEL"),
			timeoutMs: int(env, "JEV_TIMEOUT_MS", 30_000, 1_000, 600_000),
		},
		documents: {
			storageDir: str(env, "DOCUMENT_STORAGE_DIR") ?? join(dataDir, "documents"),
			linkSecret,
			maxBytes: int(env, "DOCUMENT_MAX_BYTES", 20 * 1024 * 1024, 1024, 200 * 1024 * 1024),
			allowedTypes,
			maxPages: int(env, "DOCUMENT_MAX_PAGES", 300, 1, 5000),
			parseTimeoutMs: int(env, "DOCUMENT_PARSE_TIMEOUT_MS", 30_000, 1_000, 600_000),
		},
		evaluation: {
			timeoutMs: int(env, "EVALUATION_TIMEOUT_MS", 120_000, 5_000, 3_600_000),
			maxRetries: int(env, "EVALUATION_MAX_RETRIES", 2, 0, 5),
		},
		research: {
			maxPages: int(env, "RESEARCH_MAX_PAGES", 12, 1, 50),
			maxDepth: int(env, "RESEARCH_MAX_DEPTH", 2, 0, 4),
			timeoutMs: int(env, "RESEARCH_TIMEOUT_MS", 10_000, 1_000, 60_000),
			retries: int(env, "RESEARCH_RETRIES", 2, 0, 4),
			perDomainDelayMs: int(env, "RESEARCH_DOMAIN_DELAY_MS", 1_500, 250, 60_000),
			maxBytes: int(env, "RESEARCH_MAX_BYTES", 1_500_000, 10_000, 10_000_000),
			maxRedirects: int(env, "RESEARCH_MAX_REDIRECTS", 3, 0, 5),
			userAgent: `AttnInvestResearchBot/1.0${str(env, "RESEARCH_CONTACT") ? ` (+${str(env, "RESEARCH_CONTACT")})` : ""}`,
			staleAfterDays: int(env, "RESEARCH_STALE_AFTER_DAYS", 180, 1, 3650),
			staleSourceDays: int(env, "RESEARCH_STALE_SOURCE_DAYS", 14, 1, 365),
			announcementLookbackDays: int(env, "RESEARCH_ANNOUNCEMENT_LOOKBACK_DAYS", 730, 30, 3650),
		},
		sources: {
			maxBytes: int(env, "SOURCES_MAX_BYTES", 5_000_000, 10_000, 25_000_000),
			maxRecords: int(env, "SOURCES_MAX_RECORDS", 5_000, 10, 20_000),
		},
		monitoring: {
			enabled: bool(env, "MONITORING_ENABLED", false),
			intervalMinutes: int(env, "MONITORING_INTERVAL_MINUTES", 1440, 15, 43_200),
			maxConcurrentFirms: int(env, "MONITORING_MAX_CONCURRENT_FIRMS", 2, 1, 8),
			leaseMinutes: int(env, "MONITORING_LEASE_MINUTES", 15, 5, 120),
			retryBaseMinutes: int(env, "MONITORING_RETRY_BASE_MINUTES", 30, 5, 720),
		},
	};
	// A lease must outlive a worst-case single request, or a healthy run could be taken over mid-flight.
	if (config.monitoring.enabled && config.monitoring.leaseMinutes * 60_000 < 2 * config.research.timeoutMs * (config.research.retries + 1))
		throw new ConfigError("MONITORING_LEASE_MINUTES is too short for RESEARCH_TIMEOUT_MS and RESEARCH_RETRIES");
	if (config.monitoring.enabled && config.monitoring.retryBaseMinutes > config.monitoring.intervalMinutes) warnings.push("MONITORING_RETRY_BASE_MINUTES exceeds MONITORING_INTERVAL_MINUTES; retries are capped at the interval");
	return { config, warnings };
}

/** What may be logged or shown: configuration identity without any secret. */
export function describeConfig(config: InvestConfig): Record<string, unknown> {
	return {
		appEnv: config.appEnv,
		port: config.port,
		feltdbDir: config.feltdbDir,
		auth: config.authConfigPath ? "AuthBoundry adapter (principal registry)" : "development principal (no AUTHBOUNDRY_CONFIG_PATH)",
		jev: config.jev.endpoint
			? { origin: new URL(config.jev.endpoint).origin, provider: config.jev.provider, model: config.jev.model, credential: config.jev.apiKey ? "set" : "absent" }
			: "not configured",
		documents: { maxBytes: config.documents.maxBytes, allowedTypes: config.documents.allowedTypes, maxPages: config.documents.maxPages },
		evaluation: config.evaluation,
		research: { ...config.research },
		monitoring: config.monitoring,
		sources: config.sources,
	};
}
