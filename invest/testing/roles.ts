import { ROLE_PERMISSIONS } from "../auth/authboundry-adapter.ts";
import type { Actor } from "../domain/types.ts";

/** An actor with the real permissions of a role, in a workspace of its own. */
export const as = (role: keyof typeof ROLE_PERMISSIONS, workspaceId: string, principalId: string): Actor => ({ principalId, displayName: principalId, workspaceId, permissions: [...ROLE_PERMISSIONS[role]], role });
