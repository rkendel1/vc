import { timingSafeEqual } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
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
	analyst: ["invest.read", "thesis.write", "startup.write", "document.write", "evidence.write", "evaluation.run", "review.write", "audit.read", "research.run", "contribution.write", "contribution.share", "source.manage"],
	// A fund partner administers their own workspace. Verifying who may represent a firm is a platform duty, never a fund's.
	partner: ALL_PERMISSIONS.filter((p) => p !== "moderation.review"),
	// A founder works in their own workspace: keeps a private startup profile and evidence, evaluates investor fit, reads the public directory, and chooses what to share.
	founder: ["invest.read", "contribution.write", "contribution.share", "startup.write", "document.write", "evaluation.run"],
	// A firm representative can ask to represent a firm; approval and publishing only work once a moderator has verified the claim.
	investor_rep: ["invest.read", "audit.read", "review.write", "research.run", "profile.claim", "profile.publish", "contribution.read_shared"],
	// A moderator verifies representative claims, resolves matches and reviews proposals across workspaces. No access to private notes.
	moderator: ["invest.read", "audit.read", "moderation.review", "source.manage", "review.write"],
};

export type PrincipalEntry = {
	id: string;
	displayName: string;
	workspaceId: string;
	role: keyof typeof ROLE_PERMISSIONS | string;
	tokenSha256: string;
	/** Revokes the principal without deleting its entry (and without losing the record of who it was). */
	disabled?: boolean;
	/** ISO time after which the token stops working. */
	expiresAt?: string;
};
export type Registry = { workspaces: { id: string; name: string }[]; principals: PrincipalEntry[] };

/** Tokens that are published in this repository's documentation and tests. A registry that accepts one is a development registry, whatever it is called. */
export const KNOWN_DEV_TOKENS = ["dev-partner-token"];

export function validateRegistry(raw: unknown, options: { production?: boolean } = {}): Registry {
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
		if (p.expiresAt !== undefined && Number.isNaN(Date.parse(p.expiresAt))) throw new Error(`Principal ${p.id} has an invalid expiresAt`);
		if (p.disabled !== undefined && typeof p.disabled !== "boolean") throw new Error(`Principal ${p.id} has an invalid disabled flag`);
		if (options.production && KNOWN_DEV_TOKENS.some((t) => sha256Hex(t) === p.tokenSha256)) throw new Error(`Principal ${p.id} uses a token published in this repository's documentation; issue a new one with "bun run token"`);
	}
	return r;
}

export async function loadRegistry(path: string, options: { production?: boolean } = {}): Promise<Registry> {
	return validateRegistry(JSON.parse(await readFile(path, "utf8")), options);
}

/** Development only: one workspace, one partner, a well-known token. Refused when APP_ENV=production. */
export function developmentRegistry(token = "dev-partner-token"): Registry {
	return {
		workspaces: [{ id: "ws-dev", name: "Development workspace" }],
		principals: [{ id: "dev-partner", displayName: "Dev Partner", workspaceId: "ws-dev", role: "partner", tokenSha256: sha256Hex(token) }],
	};
}

export type AuthorityStatus = { ok: boolean; principals: number; loadedAt: string | null; error: string | null };

/**
 * Identity from a principal registry. When it is built from a file, the file is re-read whenever it changes, so adding, disabling or
 * expiring a principal takes effect on the next request without a restart. If the file becomes unreadable or invalid the authority
 * FAILS CLOSED: nobody is authenticated until it is fixed, because "keep the old registry" would silently keep a token the
 * operator just tried to revoke.
 */
export class RegistryAuthority implements AuthBoundryAuthority {
	private registry: Registry | null;
	private error: string | null = null;
	private loadedAt: string | null;
	private signature: string | null = null;
	private reloading: Promise<void> | null = null;

	constructor(
		registry: Registry,
		private readonly options: { path?: string; production?: boolean; now?: () => number } = {},
	) {
		this.registry = registry;
		this.loadedAt = new Date((options.now ?? Date.now)()).toISOString();
	}

	get workspaceIds(): string[] {
		return this.registry?.workspaces.map((w) => w.id) ?? [];
	}

	status(): AuthorityStatus {
		return { ok: !this.error && !!this.registry, principals: this.registry?.principals.length ?? 0, loadedAt: this.loadedAt, error: this.error };
	}

	private async refresh(): Promise<void> {
		const path = this.options.path;
		if (!path) return;
		if (this.reloading) return this.reloading;
		this.reloading = (async () => {
			try {
				const st = await stat(path);
				const signature = `${st.mtimeMs}:${st.size}`;
				if (signature === this.signature && !this.error) return;
				this.registry = await loadRegistry(path, { production: this.options.production });
				this.signature = signature;
				this.error = null;
				this.loadedAt = new Date((this.options.now ?? Date.now)()).toISOString();
			} catch (error) {
				this.registry = null;
				this.signature = null;
				this.error = error instanceof Error ? error.message.slice(0, 200) : "unreadable";
			}
		})().finally(() => {
			this.reloading = null;
		});
		return this.reloading;
	}

	async authorize(request: AuthBoundryAuthorizationRequest): Promise<AuthBoundryAuthorizationDecision> {
		if (!request.credential) return { allowed: false };
		await this.refresh();
		if (!this.registry) return { allowed: false };
		const presented = Buffer.from(sha256Hex(request.credential), "hex");
		const entry = this.registry.principals.find((p) => {
			const expected = Buffer.from(p.tokenSha256, "hex");
			return expected.length === presented.length && timingSafeEqual(expected, presented);
		});
		if (!entry || entry.disabled) return { allowed: false };
		if (entry.expiresAt && Date.parse(entry.expiresAt) <= (this.options.now ?? Date.now)()) return { allowed: false };
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
				// Derived from who the principal is, never from the credential: nothing derived from a secret leaves the server.
				id: `sess_${sha256Hex(`${decision.principal.id}|${decision.tenantId}`).slice(0, 16)}`,
				applicationId,
				createdAt: new Date().toISOString(),
				principal: { id: decision.principal.id, type: "user" as const },
				attributes: { tenantId: decision.tenantId, ...(JSON.parse(JSON.stringify(decision.attributes ?? {})) as Record<string, string>) },
				permissions: decision.permissions ?? [],
			},
		};
	};
}
