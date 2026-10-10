/**
 * Jev adapter: the TypeScript side of the decision contract Attn already uses.
 *
 * The request and response shapes mirror `JevDecisionRequest` / `JevDecisionResponse` exactly as
 * the Attn native client speaks them (rkendel1/attn id8-macos/Sources/ID8MacOS/JevClient.swift): a bounded `kind`, the
 * application's instructions, untrusted `context`, and the candidate `options` the provider must
 * choose from. No Jev package is assumed; this is the only module that calls Jev over the network.
 */
export const JEV_ADAPTER_VERSION = "invest-jev-http/1.0.0";
export const JEV_CONTRACT = "JevDecisionRequest/JevDecisionResponse (binary|choice|score)";

export type JevOption = { id: string; label: string; description?: string };

export type JevDecisionRequest = {
	kind: "binary" | "choice" | "score";
	instructions: string;
	context?: string;
	options?: JevOption[];
};

export type JevDecisionResponse = {
	selectedId?: string;
	value?: number;
	probabilities?: Record<string, number>;
	confidence?: number;
	rationale?: string;
};

export type JevIdentity = {
	configured: boolean;
	adapterVersion: string;
	contract: string;
	endpointOrigin: string | null;
	provider: string | null;
	model: string | null;
};

export type JevErrorKind = "not_configured" | "transport" | "timeout" | "http" | "contract" | "unauthorized";

export class JevError extends Error {
	constructor(
		readonly kind: JevErrorKind,
		message: string,
		readonly retryable: boolean,
		readonly status?: number,
	) {
		super(message);
		this.name = "JevError";
	}
}

export interface JevDecider {
	readonly identity: JevIdentity;
	/** Returns the provider's raw body (kept for audit) and the validated response. */
	decide(request: JevDecisionRequest, signal: AbortSignal): Promise<{ raw: unknown; response: JevDecisionResponse }>;
}

const MAX_RATIONALE = 2000;

/**
 * Validates a choice answer against the options the application offered. Anything outside the
 * contract is a contract error — never coerced into an accepted answer.
 */
export function validateChoiceResponse(raw: unknown, allowed: readonly string[]): JevDecisionResponse {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new JevError("contract", "Response is not a JSON object", false);
	const r = raw as Record<string, unknown>;
	if (typeof r.selectedId !== "string") throw new JevError("contract", "Response has no selectedId", false);
	if (!allowed.includes(r.selectedId)) throw new JevError("contract", `selectedId "${r.selectedId.slice(0, 40)}" is not one of the offered options`, false);
	const out: JevDecisionResponse = { selectedId: r.selectedId };
	if (r.probabilities !== undefined) {
		if (!r.probabilities || typeof r.probabilities !== "object" || Array.isArray(r.probabilities))
			throw new JevError("contract", "probabilities must be an object", false);
		const probs: Record<string, number> = {};
		for (const [k, v] of Object.entries(r.probabilities as Record<string, unknown>)) {
			if (!allowed.includes(k)) continue; // ignore mass on undeclared options rather than inventing meaning for it
			if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1) throw new JevError("contract", `probability for "${k}" is not in [0, 1]`, false);
			probs[k] = v;
		}
		out.probabilities = probs;
	}
	if (r.confidence !== undefined) {
		if (typeof r.confidence !== "number" || !Number.isFinite(r.confidence) || r.confidence < 0 || r.confidence > 1)
			throw new JevError("contract", "confidence is not in [0, 1]", false);
		out.confidence = r.confidence;
	}
	if (r.value !== undefined && typeof r.value === "number" && Number.isFinite(r.value)) out.value = r.value;
	if (typeof r.rationale === "string")
		out.rationale = r.rationale
			.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "")
			.trim()
			.slice(0, MAX_RATIONALE);
	return out;
}

export type JevHttpOptions = {
	endpoint: string;
	apiKey: string | null;
	provider: string | null;
	model: string | null;
	timeoutMs: number;
	fetch?: typeof fetch;
};

export class JevHttpClient implements JevDecider {
	readonly identity: JevIdentity;
	private readonly doFetch: typeof fetch;

	constructor(private readonly options: JevHttpOptions) {
		this.identity = {
			configured: true,
			adapterVersion: JEV_ADAPTER_VERSION,
			contract: JEV_CONTRACT,
			endpointOrigin: new URL(options.endpoint).origin,
			provider: options.provider,
			model: options.model,
		};
		this.doFetch = options.fetch ?? fetch;
	}

	async decide(request: JevDecisionRequest, signal: AbortSignal): Promise<{ raw: unknown; response: JevDecisionResponse }> {
		const timeout = AbortSignal.timeout(this.options.timeoutMs);
		const combined = AbortSignal.any([signal, timeout]);
		let res: Response;
		try {
			res = await this.doFetch(this.options.endpoint, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					accept: "application/json",
					...(this.options.apiKey ? { authorization: `Bearer ${this.options.apiKey}` } : {}),
				},
				body: JSON.stringify(request),
				signal: combined,
				redirect: "error",
			});
		} catch (error) {
			if (timeout.aborted) throw new JevError("timeout", `Jev did not answer within ${this.options.timeoutMs}ms`, true);
			if (signal.aborted) throw new JevError("timeout", "Evaluation deadline reached", false);
			throw new JevError("transport", `Jev could not be reached: ${(error as Error)?.message ?? "network error"}`, true);
		}
		if (res.status === 401 || res.status === 403) throw new JevError("unauthorized", `Jev refused the credential (HTTP ${res.status})`, false, res.status);
		if (!res.ok) throw new JevError("http", `Jev answered HTTP ${res.status}`, res.status >= 500 || res.status === 429, res.status);
		let raw: unknown;
		try {
			raw = await res.json();
		} catch {
			throw new JevError("contract", "Jev returned a body that is not JSON", false);
		}
		const allowed = (request.options ?? []).map((o) => o.id);
		return { raw, response: validateChoiceResponse(raw, allowed) };
	}
}

/** The decider used when no Jev endpoint is configured: every call fails explicitly, nothing is guessed. */
export class UnconfiguredJev implements JevDecider {
	readonly identity: JevIdentity = {
		configured: false,
		adapterVersion: JEV_ADAPTER_VERSION,
		contract: JEV_CONTRACT,
		endpointOrigin: null,
		provider: null,
		model: null,
	};
	async decide(): Promise<never> {
		throw new JevError("not_configured", "Jev is not configured (set JEV_ENDPOINT)", false);
	}
}
