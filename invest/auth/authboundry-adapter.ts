import { timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Authenticate } from "@appport/server";
import { sha256Hex } from "../domain/canonical.ts";
import { ALL_PERMISSIONS, type Permission } from "../domain/types.ts";

/**
 * AuthBoundry integration for the investment application.
 *
 * `@authboundry/core` is not available; the established integration point is the
 * `AuthBoundryAuthority` adapter interface in rkendel1/attn `appport/authboundry.ts`. This module implements
 * that interface over a principal registry (AUTHBOUNDRY_CONFIG_PATH) and turns its decision into
 * an AppPort identity. It resolves identity only: permission enforcement stays with AppPort's
 * `permissionAuthorizer`, and workspace isolation with the server-side store filters. A
 * deployment with a live AuthBoundry service replaces this registry with an adapter that calls it;
 * the AppPort side does not change.
 */

/**
 * Structural mirror of `AuthBoundryAuthority` from `appport/authboundry.ts` in rkendel1/attn (that repository's
 * AuthBoundry integration point). Mirrored rather than imported because that file carries
 * pre-existing type errors outside this application's scope; the shapes are identical, so an
 * Attn AuthBoundry adapter satisfies this interface unchanged.
 */
export type AuthBoundryAuthorizationRequest = {
	transport: string;
	capability?: string;
	requiredPermissions: string[];
	credential?: string;
	headers: Record<string, string | undefined>;
	device: { deviceId?: string; displayName?: string; connectionId?: string; pairingToken?: string };
};
export type AuthBoundryAuthorizationDecision = {
	allowed: boolean;
	principal?: { id: string; type: string };
	tenantId?: string;
	permissions?: string[];
	sessionId?: string;
	attributes?: Record<string, unknown>;
	evidenceId?: string;
};
export type AuthBoundryAuthority = { authorize(request: AuthBoundryAuthorizationRequest): Promise<AuthBoundryAuthorizationDecision> };

export const ROLE_PERMISSIONS: Record<string, readonly Permission[]> = {
	viewer: ["invest.read", "audit.read"],
	analyst: ["invest.read", "thesis.write", "startup.write", "document.write", "evidence.write", "evaluation.run", "review.write", "audit.read"],
	partner: ALL_PERMISSIONS,
};

export type PrincipalEntry = { id: string; displayName: string; workspaceId: string; role: keyof typeof ROLE_PERMISSIONS | string; tokenSha256: string };
export type Registry = { workspaces: { id: string; name: string }[]; principals: PrincipalEntry[] };

export function validateRegistry(raw: unknown): Registry {
	const r = raw as Registry;
	if (!r || !Array.isArray(r.workspaces) || !Array.isArray(r.principals)) throw new Error("Auth registry needs workspaces[] and principals[]");
	const workspaces = new Set(r.workspaces.map((w) => w.id));
	for (const w of r.workspaces) if (typeof w.id !== "string" || !/^[A-Za-z0-9_-]{2,64}$/.test(w.id)) throw new Error(`Invalid workspace id: ${w.id}`);
	const tokens = new Set<string>();
	for (const p of r.principals) {
		if (typeof p.id !== "string" || !p.id) throw new Error("Principal needs an id");
		if (!workspaces.has(p.workspaceId)) throw new Error(`Principal ${p.id} names unknown workspace ${p.workspaceId}`);
		if (!ROLE_PERMISSIONS[p.role]) throw new Error(`Principal ${p.id} has unknown role ${p.role}`);
		if (!/^[a-f0-9]{64}$/.test(p.tokenSha256 ?? "")) throw new Error(`Principal ${p.id} needs tokenSha256 (hex SHA-256 of its bearer token)`);
		if (tokens.has(p.tokenSha256)) throw new Error("Two principals share a token");
		tokens.add(p.tokenSha256);
	}
	return r;
}

export async function loadRegistry(path: string): Promise<Registry> {
	return validateRegistry(JSON.parse(await readFile(path, "utf8")));
}

/** Development only: one workspace, one partner, a well-known token. Refused when APP_ENV=production. */
export function developmentRegistry(token = "dev-partner-token"): Registry {
	return {
		workspaces: [{ id: "ws-dev", name: "Development workspace" }],
		principals: [{ id: "dev-partner", displayName: "Dev Partner", workspaceId: "ws-dev", role: "partner", tokenSha256: sha256Hex(token) }],
	};
}

export class RegistryAuthority implements AuthBoundryAuthority {
	constructor(private readonly registry: Registry) {}

	get workspaceIds(): string[] {
		return this.registry.workspaces.map((w) => w.id);
	}

	async authorize(request: AuthBoundryAuthorizationRequest): Promise<AuthBoundryAuthorizationDecision> {
		if (!request.credential) return { allowed: false };
		const presented = Buffer.from(sha256Hex(request.credential), "hex");
		const entry = this.registry.principals.find((p) => {
			const expected = Buffer.from(p.tokenSha256, "hex");
			return expected.length === presented.length && timingSafeEqual(expected, presented);
		});
		if (!entry) return { allowed: false };
		const workspace = this.registry.workspaces.find((w) => w.id === entry.workspaceId);
		return {
			allowed: true,
			principal: { id: entry.id, type: "user" },
			tenantId: entry.workspaceId,
			permissions: [...ROLE_PERMISSIONS[entry.role]],
			attributes: { displayName: entry.displayName, workspaceName: workspace?.name ?? entry.workspaceId, role: entry.role },
		};
	}
}

function bearer(headers: Readonly<Record<string, string | undefined>> | undefined): string | undefined {
	const value = headers?.authorization ?? headers?.Authorization;
	if (!value) return undefined;
	const [scheme, ...rest] = value.split(" ");
	return scheme?.toLowerCase() === "bearer" ? rest.join(" ").trim() || undefined : undefined;
}

/** The AppPort `authenticate` hook: credential → AuthBoundry decision → session. No credential, no session. */
export function createInvestAuthenticate(authority: AuthBoundryAuthority, applicationId: string): Authenticate {
	return async (request) => {
		const credential = bearer(request.headers);
		if (!credential) return {};
		let decision: AuthBoundryAuthorizationDecision;
		try {
			decision = await authority.authorize({ transport: request.transport, requiredPermissions: [], credential, headers: {}, device: {} });
		} catch {
			return {};
		}
		if (!decision.allowed || !decision.principal || !decision.tenantId) return {};
		return {
			session: {
				id: `sess_${sha256Hex(credential).slice(0, 16)}`,
				applicationId,
				createdAt: new Date().toISOString(),
				principal: { id: decision.principal.id, type: "user" as const },
				attributes: { tenantId: decision.tenantId, ...(JSON.parse(JSON.stringify(decision.attributes ?? {})) as Record<string, string>) },
				permissions: decision.permissions ?? [],
			},
		};
	};
}
