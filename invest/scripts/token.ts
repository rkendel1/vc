/**
 * Issue an access token and the registry entry for it.
 *
 *   bun run token -- --principal fay --workspace ws-f --role founder --name "Fay (founder)" [--expires 2027-01-01]
 *
 * Prints the token ONCE, and the JSON entry (token hash only) to add to the file named by AUTHBOUNDRY_CONFIG_PATH. The token itself is never
 * written to disk by this command: hand it to its owner through a secure channel. 256 random bits; the registry stores only its SHA-256.
 * The registry file is re-read when it changes, so a new entry (or "disabled": true on an old one) takes effect without a restart.
 */
import { randomBytes } from "node:crypto";
import { ROLE_PERMISSIONS } from "../auth/authboundry-adapter.ts";
import { sha256Hex } from "../domain/canonical.ts";

const argv = process.argv.slice(2);
const opts: Record<string, string> = {};
for (let i = 0; i < argv.length; i++) {
	const a = argv[i]!;
	if (a === "-h" || a === "--help") {
		console.log("Usage: bun run token -- --principal <id> --workspace <id> --role <role> [--name <display name>] [--expires <ISO date>]");
		console.log(`Roles: ${Object.keys(ROLE_PERMISSIONS).join(", ")}`);
		process.exit(0);
	}
	if (a.startsWith("--")) opts[a.slice(2)] = argv[++i] ?? "";
}
const fail = (m: string): never => {
	console.error(m);
	process.exit(2);
};
const principal = opts.principal || fail("--principal is required");
const workspace = opts.workspace || fail("--workspace is required");
const role = opts.role || fail("--role is required");
if (!ROLE_PERMISSIONS[role]) fail(`Unknown role ${role}; one of: ${Object.keys(ROLE_PERMISSIONS).join(", ")}`);
if (!/^[A-Za-z0-9_-]{2,64}$/.test(workspace)) fail("--workspace must be 2-64 letters, digits, - or _");
if (opts.expires && Number.isNaN(Date.parse(opts.expires))) fail("--expires must be a date such as 2027-01-01");
const token = randomBytes(32).toString("base64url");
const entry = { id: principal, displayName: opts.name || principal, workspaceId: workspace, role, tokenSha256: sha256Hex(token), ...(opts.expires ? { expiresAt: new Date(opts.expires).toISOString() } : {}) };
console.log(`Token (shown once; give it to ${principal} securely):\n  ${token}\n\nRegistry entry (add to "principals" in the registry file; make sure workspace "${workspace}" is listed in "workspaces"):\n${JSON.stringify(entry, null, 2)}`);
