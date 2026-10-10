# Attn Invest — notes for agents and contributors

Jev for Investment Evaluation. One application: `invest/` (server) and `apps/invest-web/` (web).
Toolchain: **Bun 1.3.13**. Do not use npm, yarn or pnpm.

## Rules that keep the design honest

- Durable state goes through `invest/store/` only (FeltDB 0.11.7 file runtime). Creates are fenced
  with `requireAbsent`, updates with `ifVersion`, and audit events ride in the same transaction.
- Only `invest/jev/` calls the network. Jev is reached through its HTTP decision contract; there is no
  Jev package. Never send whole documents to Jev, and never put document text in `instructions`.
- Thresholds, hard gates, evidence standards, review routing and decision rules live in
  `invest/modules/investment-policy.ts` as pure functions, so `evaluation.verify` can recompute them.
  If you change policy output, bump `POLICY_VERSION`; if you change extraction, bump `EXTRACTOR_VERSION`.
- Findings, versions, decisions and audit events are immutable. Reviewer judgments are new records.
- Workspace identity comes from the authenticated session, never from capability input.
- After changing capabilities, run `bun run generate` and commit the manifest and generated client.

`bun run check:architecture` enforces these. `bun run ci` runs typecheck, architecture checks, tests
and the quality gate. `bun run e2e:browser` needs Chromium (`CHROMIUM_PATH`).
