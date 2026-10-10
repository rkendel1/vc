# Jev for Investment Evaluation — PR 1: architecture and dependency baseline

Status: verified against this repository on 2026-10-10.
Everything below was established by reading installed package typings and by executing probes
against the installed packages, not from the specification's package inventory.

## 1. What the specification assumed vs. what exists

| Specification inventory | Reality in this repository | Decision |
| --- | --- | --- |
| `@feltdb/core` recorded 0.11.9 | **0.11.7** pinned in `package.json` and `bun.lock` | Use 0.11.7. No upgrade. |
| `@appport/core` recorded 1.0.3 | **1.0.1**, transitive through `@appport/sdk` | Consume through `@appport/sdk` only, as the Attn server does. |
| `@appport/sdk` recorded 1.1.22 | **1.1.19** pinned | Use 1.1.19. |
| `@appport/appboundry` 1.1.1 | **Not installed.** AppBoundry types are vendored inside the `appport` CLI only | Not used. Not needed for a single application. |
| `@appport/services` 0.4.10 | **Not installed** | Not used. Nothing to reuse. |
| `@authboundry/core` 1.15.3 | **Not installed.** The repository's AuthBoundry integration point is the `AuthBoundryAuthority` adapter interface in `appport/authboundry.ts` in rkendel1/attn | Implement that interface (`invest/auth/authboundry-adapter.ts`). No independent auth system: the adapter resolves identity and the AppPort permission authorizer enforces it. |
| "Existing Jev package/API" | **No TypeScript Jev package exists.** The real contract is the HTTP decision endpoint the native client speaks (rkendel1/attn `id8-macos/Sources/ID8MacOS/JevClient.swift`): `JevDecisionRequest {kind: binary\|choice\|score, instructions, context?, options?[{id,label,description?}]}` → `JevDecisionResponse {selectedId?, value?, probabilities?, confidence?, rationale?}`, bearer-authenticated | Implement a TypeScript HTTP adapter to exactly that contract (`invest/jev/jev-client.ts`). No `@jev/core` is invented. |
| "Web framework of the Attn web control plane" | React 18 + Vite 5 (`apps/web`), served by a Bun `node:http` server with an AppPort `HttpBinding` | Reuse the same stack for `apps/invest-web`. |
| PDF parsing | Nothing in the dependency tree parses PDF | **One added dependency: `pdfjs-dist@4.10.38`** (exact pin; legacy build). Justified below. |

FeltDB also exports a semantic-decision surface (`db.semanticDecisions.execute`). It was inspected and
rejected for this MVP: in 0.11.7 it only works against a remote `HttpJsDb`, and its runtime parameter is
`deterministic` or `recording` — the caller must already hold the result. It records decisions; it does
not obtain them. Jev remains the decision provider. Its `DecisionResult` shape (selected value plus
weighted options) is the model for how raw Jev distributions are normalised and kept.

## 2. Verified FeltDB behaviour (0.11.7, `FileJsDb` + `open`)

Probed by executing code against the installed package:

- `db.transaction({operations, preconditions})` is atomic on the file runtime.
- `requireAbsent: true` on a write raises `ConditionalConflictError` when the record exists. **This is a
  real fence**, used for immutable records (thesis versions, findings, decisions, audit events) and for
  durable idempotency of evaluation start.
- `preconditions: [{ifVersion}]` raises `ConditionalConflictError` on a stale version. Used for the
  thesis head pointer and evaluation status transitions.
- `collection.updateIfVersion` returns `{updated: false}` on a stale version.
- `db.query` requires `limit` between 1 and 1000 and returns a cursor.
- A second `open(new FileJsDb(dir))` sees the first one's committed writes (it re-reads), so the
  fences above hold across processes on one directory.

Consequence for the specification's concurrency warning: the application never relies on "last write
wins". Every write that could race is either a create fenced by `requireAbsent` or an update fenced
by `ifVersion`, and audit events are committed in the **same** atomic transaction as the change they
describe.

## 3. Verified AppPort behaviour (`@appport/sdk` 1.1.19)

- Capabilities: `defineCapability({name, version, input, output, authorization, idempotency,
  concurrency, timeoutMs, handler})`. Names must match `^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$`
  (no underscores or hyphens), so the specification's logical names map to dotted names such as
  `thesis.approve` and `evaluation.start`.
- `permissionAuthorizer()` enforces each capability's `authorization` list against the session's
  permissions before the handler runs.
- `CapabilityContext` carries `session` (with `principal` and `attributes`) — workspace scoping is read
  from `session.attributes.tenantId`, **never** from capability input.
- `idempotency: "supported"` replays from an in-memory store (per process). Durable idempotency for
  evaluation start is therefore implemented in FeltDB (deterministic id + `requireAbsent`); AppPort
  replay is a convenience on top.
- `HttpBinding` serves one `POST` endpoint and calls the server's `authenticate(request)` hook with the
  request headers. The generated manifest and client come from `appport build --config …`.

## 4. Configuration mapping

| Application setting | Maps to |
| --- | --- |
| `APP_ENV` | `development \| test \| production`; production refuses to start without auth config and a link-signing secret |
| `FELTDB_DIR` | `open(new FileJsDb(dir))` — the established Attn pattern (`appport/felt-store.ts`). The investment store is a separate directory from the Attn working world so confidential deal data never mixes with it; it is the same FeltDB, not a second database technology |
| `FELTDB_CONFIG_PATH` | Not supported by FeltDB 0.11.7's file runtime; accepted for forward compatibility and ignored with a warning |
| `APPPORT_CONFIG_PATH` | `invest/appport.config.ts` (manifest/client generation) |
| `AUTHBOUNDRY_CONFIG_PATH` | JSON principal registry for the `AuthBoundryAuthority` adapter (token SHA-256 → principal, workspace, role) |
| `JEV_ENDPOINT`, `JEV_API_KEY` | `JevDecisionRequest` endpoint + bearer credential (secret: env only) |
| `JEV_PROVIDER`, `JEV_MODEL` | Recorded configuration identity in every evaluation manifest. The HTTP contract has no field for them, so they are declarative and are never sent |
| `JEV_TIMEOUT_MS` | Per-request abort |
| `DOCUMENT_STORAGE_DIR` | Private content-addressed store (mode 0700 dir / 0600 files) |
| `DOCUMENT_STORAGE_LINK_SECRET` | HMAC key for short-lived access links (secret: env only) |
| `DOCUMENT_MAX_BYTES`, `DOCUMENT_ALLOWED_TYPES` | Upload validation |
| `EVALUATION_TIMEOUT_MS`, `EVALUATION_MAX_RETRIES` | Whole-run deadline; bounded per-question retry |
| `LOG_LEVEL` | Structured JSON logger with credential redaction |

## 5. Architecture invariants (checked in CI by `invest/scripts/check-architecture.ts`)

1. Durable state goes through `invest/store/` only; no module outside it imports `@feltdb/core`.
2. Only `invest/jev/` performs network calls to Jev; no other module calls `fetch`.
3. No source dependency on Chip, Compute, FX, or the Attn control plane from `invest/`.
4. No `@jev/*`, `@authboundry/*`, `@appport/services` or `@appport/appboundry` import (they do not
   exist here).
5. Capability handlers read workspace identity from the session only (no `workspaceId` input field
   in any capability schema).
6. The web app imports no server module except types and the generated AppPort client.
7. Secrets (`JEV_API_KEY`, `DOCUMENT_STORAGE_LINK_SECRET`) never appear in persisted records
   (asserted by tests that scan the store after an evaluation).

## 6. Why `pdfjs-dist`

The specification requires page-level source coordinates. `pdfjs-dist` (Mozilla) returns text items
with their page and transform matrix, so every extracted claim carries page, line and bounding box.
It runs without a DOM in Bun using the legacy build, is configured with `isEvalSupported: false`,
no font loading, no scripting and no network, and rejects malformed structure with
`InvalidPDFException` (verified). It is the smallest dependency that satisfies the requirement.

## 7. Agency runtime

This feature performs no agency dispatch and makes no Chip calls, so the `runtime:verify`
prerequisite in Attn's `AGENTS.md` does not apply and no Tier 3 claim is made.

## 8. Toolchain note

The container runs Bun 1.4.2; the repository pins 1.3.13 and CI uses 1.3.13. No 1.4-only API is used.
