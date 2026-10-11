import { mkdtemp, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient, createHttpTransport } from "@appport/sdk";
import { type InvestRuntime, type ResearchFetcherFactory, type SourceFetcherFactory, bootstrap } from "../bootstrap.ts";
import { loadConfig } from "../config.ts";
import { sha256Hex } from "../domain/canonical.ts";
import { createInvestHttpServer } from "../http.ts";
import type { JevDecider } from "../jev/jev-client.ts";
import { type Logger, silentLogger } from "../logger.ts";
import type { FailureLimiter } from "../security/rate-limit.ts";

export const TOKENS = {
	aPartner: "token-a-partner-0001",
	aAnalyst: "token-a-analyst-0002",
	aViewer: "token-a-viewer-0003",
	bPartner: "token-b-partner-0004",
	fFounder: "token-f-founder-0005",
	f2Founder: "token-f2-founder-0006",
	rRep: "token-r-rep-0007",
	mModerator: "token-m-moderator-0008",
} as const;

export type HttpHarness = {
	url: string;
	dir: string;
	registryPath: string;
	runtime: InvestRuntime;
	client(token?: string): ReturnType<typeof createClient>;
	close(): Promise<void>;
};

export async function startHttpHarness(options: { jev?: JevDecider; maxBytes?: number; webDist?: string; fetcherFor?: ResearchFetcherFactory; fetcherForSource?: SourceFetcherFactory; limiter?: FailureLimiter; logger?: Logger; production?: boolean } = {}): Promise<HttpHarness> {
	const dir = await mkdtemp(join(tmpdir(), "invest-http-"));
	const registryPath = join(dir, "auth.json");
	await writeFile(
		registryPath,
		JSON.stringify({
			workspaces: [
				{ id: "ws-a", name: "Fund A" },
				{ id: "ws-b", name: "Fund B" },
				{ id: "ws-f", name: "Founder workspace" },
				{ id: "ws-f2", name: "Second founder workspace" },
				{ id: "ws-rep", name: "Meridian representatives" },
				{ id: "ws-mod", name: "Platform moderation" },
			],
			principals: [
				{ id: "alice", displayName: "Alice (partner)", workspaceId: "ws-a", role: "partner", tokenSha256: sha256Hex(TOKENS.aPartner) },
				{ id: "arun", displayName: "Arun (analyst)", workspaceId: "ws-a", role: "analyst", tokenSha256: sha256Hex(TOKENS.aAnalyst) },
				{ id: "vera", displayName: "Vera (viewer)", workspaceId: "ws-a", role: "viewer", tokenSha256: sha256Hex(TOKENS.aViewer) },
				{ id: "bob", displayName: "Bob (other fund)", workspaceId: "ws-b", role: "partner", tokenSha256: sha256Hex(TOKENS.bPartner) },
				{ id: "fay", displayName: "Fay (founder)", workspaceId: "ws-f", role: "founder", tokenSha256: sha256Hex(TOKENS.fFounder) },
				{ id: "fred", displayName: "Fred (founder)", workspaceId: "ws-f2", role: "founder", tokenSha256: sha256Hex(TOKENS.f2Founder) },
				{ id: "rita", displayName: "Rita (firm representative)", workspaceId: "ws-rep", role: "investor_rep", tokenSha256: sha256Hex(TOKENS.rRep) },
				{ id: "mona", displayName: "Mona (moderator)", workspaceId: "ws-mod", role: "moderator", tokenSha256: sha256Hex(TOKENS.mModerator) },
			],
		}),
	);
	const { config } = loadConfig({
		APP_ENV: "test",
		FELTDB_DIR: join(dir, "felt"),
		DOCUMENT_STORAGE_DIR: join(dir, "docs"),
		DOCUMENT_STORAGE_LINK_SECRET: "http-harness-link-secret-123456",
		AUTHBOUNDRY_CONFIG_PATH: registryPath,
		DOCUMENT_MAX_BYTES: String(options.maxBytes ?? 2 * 1024 * 1024),
		EVALUATION_TIMEOUT_MS: "20000",
		EVALUATION_MAX_RETRIES: "1",
		JEV_TIMEOUT_MS: "5000",
	});
	const runtime = await bootstrap(config, silentLogger, { jev: options.jev, fetcherFor: options.fetcherFor, fetcherForSource: options.fetcherForSource });
	const server = createInvestHttpServer(runtime, { webDist: options.webDist ?? join(dir, "no-web"), logger: options.logger ?? silentLogger, limiter: options.limiter });
	await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
	const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	return {
		url,
		dir,
		registryPath,
		runtime,
		client(token?: string) {
			return createClient({ transport: createHttpTransport({ url: `${url}/appport`, headers: token ? { authorization: `Bearer ${token}` } : {} }) });
		},
		async close() {
			await runtime.close();
			await new Promise((r) => server.close(r));
			await rm(dir, { recursive: true, force: true });
		},
	};
}
