import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ALL_PERMISSIONS, type Actor } from "../domain/types.ts";
import { DocumentStorage } from "../ingestion/document-storage.ts";
import { JEV_ADAPTER_VERSION, JEV_CONTRACT, JevError, type JevDecider, type JevDecisionRequest, type JevDecisionResponse, type JevIdentity, validateChoiceResponse } from "../jev/jev-client.ts";
import type { MonitoringOptions } from "../modules/monitoring.ts";
import type { ResearchDeps } from "../modules/investor-research.ts";
import { silentLogger } from "../logger.ts";
import { InvestmentService } from "../service.ts";
import { InvestStore } from "../store/store.ts";

export const TEST_RESEARCH_LIMITS = { maxPages: 12, maxDepth: 2, timeoutMs: 2_000, retries: 2, perDomainDelayMs: 10, maxBytes: 1_000_000, maxRedirects: 3 };

export const ANALYST_PERMISSIONS = ALL_PERMISSIONS.filter((p) => p !== "thesis.approve" && p !== "decision.record");

export function actor(workspaceId: string, principalId = `${workspaceId}-partner`, permissions: readonly string[] = ALL_PERMISSIONS): Actor {
	return { principalId, displayName: principalId, workspaceId, permissions };
}

type Responder = (request: JevDecisionRequest, call: number) => JevDecisionResponse | Error | Promise<JevDecisionResponse | Error>;

/** In-process Jev test double speaking the real contract; the response is still validated by the production validator. */
export class ScriptedJev implements JevDecider {
	readonly requests: JevDecisionRequest[] = [];
	readonly identity: JevIdentity = {
		configured: true,
		adapterVersion: JEV_ADAPTER_VERSION,
		contract: JEV_CONTRACT,
		endpointOrigin: "test://scripted",
		provider: "test",
		model: "scripted",
	};
	constructor(private readonly respond: Responder) {}
	async decide(request: JevDecisionRequest, signal: AbortSignal): Promise<{ raw: unknown; response: JevDecisionResponse }> {
		if (signal.aborted) throw new JevError("timeout", "deadline", false);
		this.requests.push(request);
		const out = await this.respond(request, this.requests.length);
		if (out instanceof Error) throw out;
		return { raw: out, response: validateChoiceResponse(out, (request.options ?? []).map((o) => o.id)) };
	}
}

/**
 * A crude, deterministic judge: reads the criterion name from the instructions and looks for
 * supporting words in the context. Good enough to drive end-to-end flows; it is a test double,
 * not a model, and every manifest it touches records `provider: test`.
 */
export function lexicalJudge(request: JevDecisionRequest): JevDecisionResponse {
	const context = (request.context ?? "").toLowerCase();
	const criterion = /Criterion: (.*)/.exec(request.instructions)?.[1]?.toLowerCase() ?? "";
	const has = (...words: string[]) => words.some((w) => context.includes(w));
	let selected = "insufficient_evidence";
	if (criterion.includes("demand")) selected = has("reference", "renewal") && has("customers") ? "supported" : has("customers") ? "partially_supported" : "insufficient_evidence";
	else if (criterion.includes("team")) selected = has("previously", "former", "led", "years") ? "supported" : "insufficient_evidence";
	else if (criterion.includes("market")) selected = has("tam", "market") ? "supported" : "insufficient_evidence";
	if (has("churn") && criterion.includes("demand") && has("9%")) selected = "contradicted";
	const probabilities: Record<string, number> = { supported: 0.04, partially_supported: 0.04, contradicted: 0.04, insufficient_evidence: 0.04, not_applicable: 0.04 };
	probabilities[selected] = 0.84;
	return { selectedId: selected, probabilities, rationale: `Lexical test judge selected ${selected}.` };
}

export type Harness = {
	service: InvestmentService;
	store: InvestStore;
	storage: DocumentStorage;
	dir: string;
	close(): Promise<void>;
};

export async function createHarness(options: { jev?: JevDecider; maxRetries?: number; timeoutMs?: number; jevTimeoutMs?: number; fetcherFor?: ResearchDeps["fetcherFor"]; staleAfterDays?: number; staleSourceDays?: number; lookbackDays?: number; monitoring?: Partial<MonitoringOptions>; clock?: () => Date } = {}): Promise<Harness> {
	const dir = await mkdtemp(join(tmpdir(), "invest-test-"));
	const store = await InvestStore.openDir(join(dir, "felt"), options.clock);
	const storage = new DocumentStorage(join(dir, "docs"), "test-link-secret-0123456789");
	const service = new InvestmentService({
		store,
		storage,
		jev: options.jev ?? new ScriptedJev(lexicalJudge),
		limits: { maxBytes: 5 * 1024 * 1024, allowedTypes: ["application/pdf"], maxPages: 50, parseTimeoutMs: 10_000 },
		evaluation: { timeoutMs: options.timeoutMs ?? 20_000, maxRetries: options.maxRetries ?? 2, jevTimeoutMs: options.jevTimeoutMs ?? 5_000, backoffMs: 5 },
		logger: silentLogger,
		research: {
			fetcherFor: options.fetcherFor ?? (() => ({ fetchPage: async () => { throw new Error("no research fetcher configured in this test"); } })),
			defaults: TEST_RESEARCH_LIMITS,
			staleAfterDays: options.staleAfterDays ?? 180,
			staleSourceDays: options.staleSourceDays ?? 14,
			lookbackDays: options.lookbackDays ?? 730,
			jevTimeoutMs: 5_000,
		},
		monitoring: { defaultIntervalMinutes: 1440, maxConcurrentFirms: 2, leaseMs: 15 * 60_000, retryBaseMs: 30 * 60_000, ceilings: { maxPages: 50, maxDepth: 4 }, random: () => 0.5, ...(options.monitoring ?? {}) },
	});
	return {
		service,
		store,
		storage,
		dir,
		async close() {
			await service.evaluations.settled();
			await store.close();
			await rm(dir, { recursive: true, force: true });
		},
	};
}
