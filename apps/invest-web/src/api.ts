import { createHttpTransport } from "@appport/sdk";
import { type InvestContract, createInvestClient } from "../../../invest/appport/generated/client.ts";

/**
 * The browser's only backend: the generated AppPort client against `/appport`. Inputs are typed by
 * the generated contract; outputs by the shared domain types at each call site. The access token
 * lives in sessionStorage (cleared with the tab), never in localStorage or the bundle.
 */
type Caps = InvestContract["capabilities"];
export type CapabilityName = keyof Caps & string;

const TOKEN_KEY = "attn-invest-token";

export class ApiError extends Error {
	constructor(
		readonly code: string,
		message: string,
		readonly details?: unknown,
	) {
		super(message);
	}
}

export function getToken(): string | null {
	try {
		return sessionStorage.getItem(TOKEN_KEY);
	} catch {
		return null;
	}
}

export function setToken(token: string | null) {
	try {
		if (token) sessionStorage.setItem(TOKEN_KEY, token);
		else sessionStorage.removeItem(TOKEN_KEY);
	} catch {
		// Storage unavailable: the token lives only in memory for this page.
	}
	memoryToken = token;
	client = null;
}

let memoryToken: string | null = getToken();
let client: ReturnType<typeof createInvestClient> | null = null;
let connecting: Promise<void> | null = null;

async function ensureClient() {
	if (!memoryToken) throw new ApiError("UNAUTHORIZED", "Sign in to continue");
	if (!client) {
		client = createInvestClient({ transport: createHttpTransport({ url: "/appport", headers: { authorization: `Bearer ${memoryToken}` } }) });
		connecting = client.connect();
	}
	await connecting;
	return client;
}

export async function call<T>(name: CapabilityName, input: Caps[CapabilityName]["input"] | Record<string, unknown>): Promise<T> {
	const c = await ensureClient();
	try {
		return (await c.call<T>(name, input as never)) as T;
	} catch (error) {
		const e = error as { code?: string; message?: string; details?: unknown };
		const apiError = new ApiError(e.code ?? "INTERNAL", e.message ?? "The request failed", e.details);
		if (apiError.code === "UNAUTHORIZED") {
			setToken(null);
			window.dispatchEvent(new CustomEvent("invest:signed-out"));
		}
		throw apiError;
	}
}

export function requestKey(prefix: string): string {
	return `${prefix}-${crypto.randomUUID()}`;
}

export function fileToBase64(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
		reader.onerror = () => reject(reader.error);
		reader.readAsDataURL(file);
	});
}
