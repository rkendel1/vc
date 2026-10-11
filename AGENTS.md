# Attn Invest — notes for agents and contributors

Jev for Investment Evaluation. One application: `invest/` (server) and `apps/invest-web/` (web).
Toolchain: **Bun 1.3.13**. Do not use npm, yarn or pnpm.

## Rules that keep the design honest

- `feltdb.flow` is the authoritative declaration of durable state (collections, filtered fields, indexes). Add a collection there first; `store.ts` compiles it and refuses to start if the code and the flow disagree.
- Durable state goes through `invest/store/` only (FeltDB 0.11.7 file runtime). Creates are fenced
  with `requireAbsent`, updates with `ifVersion`, and audit events ride in the same transaction.
- Only `invest/jev/` and `invest/research/fetcher.ts` call the network. `invest/research/` is pure otherwise: no store, no environment, no process execution. Fetched pages and feeds are data, never instructions; page-derived text (including extracted company names) goes in Jev `context`, never `instructions`.
- Cross-workspace reads (`store.scanAll`) exist only for the scheduler, representative/moderator participation and the reconciliation read model; they expose only published profiles, contributions explicitly shared with that audience, and claims for moderators. Never add a capability that reads another workspace's records otherwise.
- Founder matching (`research/match.ts`) is pure and deterministic: no store, network, model or score. Mandate fit, readiness, evidence quality and research coverage stay separate; unknown is never a mismatch; only authoritative criteria can eliminate an investor. Bump `MATCH_POLICY_VERSION` when a rule changes a result. Evaluations and profile versions are immutable; identical versioned inputs reuse the existing evaluation. Founder data is private to its workspace and is never sent anywhere.
- Third-party and contributed claims never create or change an approval. Only `firm.approve` (workspace authority) or `profile.approve` (a moderator-verified representative) does. Reconciliation never uses a score or a vote.
- Research never writes or overwrites investor approvals (`firm_approvals`); findings and events are immutable and reviewed by new records. Monitoring leases are taken with `ifVersion` writes and fenced by token.
- Jev is reached only from `invest/jev/`, through its HTTP decision contract; there is no
  Jev package. Never send whole documents to Jev, and never put document text in `instructions`.
- Thresholds, hard gates, evidence standards, review routing and decision rules live in
  `invest/modules/investment-policy.ts` as pure functions, so `evaluation.verify` can recompute them.
  If you change policy output, bump `POLICY_VERSION`; if you change extraction, bump `EXTRACTOR_VERSION`.
- Findings, versions, decisions and audit events are immutable. Reviewer judgments are new records.
- Workspace identity comes from the authenticated session, never from capability input.
- After changing capabilities, run `bun run generate` and commit the manifest and generated client.

`bun run check:architecture` enforces these. `bun run ci` runs typecheck, architecture checks, tests
and the quality gate. `bun run e2e:browser` needs Chromium (`CHROMIUM_PATH`).
