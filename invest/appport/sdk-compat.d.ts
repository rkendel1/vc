/**
 * Version-skew bridge. `appport build` (CLI 1.1.19) emits a client that imports `AppContract` and
 * `ClientOptions` from "@appport/sdk", but the pinned @appport/sdk 1.1.19 does not re-export them
 * from @appport/client (Attn's own generated client has the same skew). These aliases restore the
 * two names without editing generated output or upgrading a foundational package.
 */
import type { createClient } from "@appport/sdk";

declare module "@appport/sdk" {
	export interface AppContract {
		capabilities: Record<string, { input: unknown; output: unknown; kind?: "request" | "stream"; version?: number }>;
		events: Record<string, unknown>;
	}
	export type ClientOptions = Parameters<typeof createClient>[0];
}
