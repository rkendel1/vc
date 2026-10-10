# Attn Invest — pilot-readiness checklist (specification §10)

Each item names the evidence that demonstrates it. "Test" refers to files in `invest/tests/`; "E2E"
to `invest/e2e/browser.e2e.ts`; "Quality" to `bun run quality` (`docs/invest/PILOT_REPORT.md`).

## Thesis

| Item | Status | Evidence |
| --- | --- | --- |
| Create and validate a structured investment thesis | Done | `thesis.test.ts` "validates structure, modes and thresholds"; E2E thesis section |
| Approve a new thesis version without changing previous versions | Done | `thesis.test.ts` "approves immutable versions…", "lets exactly one of two concurrent approvals win" |
| Evaluate a startup against the explicitly selected thesis version | Done | `evaluation.test.ts` "evaluates against the explicitly selected thesis version even after a newer one is approved" |

## Evidence

| Item | Status | Evidence |
| --- | --- | --- |
| Upload a supported PDF and extract source-locatable claims | Done | `ingestion.test.ts` "extracts source-locatable claims…" (page, line, bbox, document hash) |
| Trace every material finding to evidence or record that evidence is missing | Done | `evaluation.test.ts` positive case asserts every ref is in the manifest and empty refs carry `missingEvidence`; "missing evidence" case |
| Distinguish founder-reported claims from corroborated evidence | Done | `ingestion.test.ts` "distinguishes founder-reported claims…"; policy downgrades founder-only support (`evaluation.test.ts` adversarial case) |
| Handle malformed files, parser errors and partial extraction without fabricating completeness | Done | `ingestion.test.ts` rejected / failed / partial cases; E2E fake PDF |

## Evaluation

| Item | Status | Evidence |
| --- | --- | --- |
| Return a valid criterion-level outcome for each applicable criterion | Done | `evaluation.test.ts` positive case; `evaluation.verify` "one finding per criterion" |
| Represent missing, contradictory and failed evaluations separately | Done | `evaluation.test.ts` failure-handling suite (`evaluation_failed` vs `insufficient_evidence` vs `contradicted`) |
| Apply deterministic thresholds and hard gates in application code | Done | `investment-policy.ts`; `evaluation.test.ts` negative and adversarial cases (a gullible Jev cannot pass a gate) |
| Persist sufficient configuration and source identity to reproduce or audit a run | Done | Manifest + digest; `evaluation.test.ts` "verify recomputes a stored evaluation and detects tampering"; Quality 6/6 verified |

## Human control

| Item | Status | Evidence |
| --- | --- | --- |
| Require explicit reviewer action for configured review gates | Done | `decisions.test.ts` "blocks an invest decision until every review gate…"; E2E |
| Record overrides with actor, reason and timestamp | Done | `decisions.test.ts` "records overrides with actor, reason and timestamp and never edits the Jev finding" |
| Keep evaluation findings separate from the investment decision | Done | `decisions.test.ts` "a decline leaves supported criteria supported" |

## Platform

| Item | Status | Evidence |
| --- | --- | --- |
| Persist authoritative state in FeltDB through supported contracts | Done | `invest/store/store.ts` (FeltDB 0.11.7 atomic transactions with `requireAbsent`/`ifVersion`, verified in PR 1); architecture check `feltdb-only-in-store` |
| Verify AppPort boundaries and server-side workspace authorization | Done | `appport-boundary.test.ts` permissions and error-contract suites over real HTTP |
| Verify no unauthorized cross-workspace access | Done | `appport-boundary.test.ts` workspace-isolation suite (9 reads, 9 writes, lists, audit); E2E sign-in as another fund |
| Pass architecture-invariant checks and relevant Jev verifier checks in CI | Done | `.github/workflows/ci.yml`: `check:architecture`, contract freshness, `quality` (runs `evaluation.verify` on every case) |

## Quality

| Item | Status | Evidence |
| --- | --- | --- |
| Test representative positive, negative, ambiguous and adversarial cases | Done for the pipeline | `evaluation.test.ts`; Quality cases |
| Measure false support, false contradiction, unknown handling and reviewer correction rates | Harness done | `invest/quality/run.ts`; current figures are from the stand-in on synthetic cases |
| Record evaluation latency, failure rates and per-evaluation cost where measurable | Done | `Evaluation.metrics` (latency, Jev calls, failures, retries); cost recorded as unknown because the Jev contract reports no usage |

## Before a real investor pilot

These remain open by design, because they need inputs this repository does not have:

1. Run `bun run quality` with `JEV_ENDPOINT` set to the production Jev configuration.
2. Replace the synthetic cases with real deals labelled blind by reviewers who have not seen the
   system's findings, and compare against those assessments (specification §10).
3. Issue real principals through the deployment's AuthBoundry service (or the registry adapter) and
   set `DOCUMENT_STORAGE_LINK_SECRET`; decide retention periods and back up the FeltDB and document
   directories.
4. Disclose to users what is sent to the Jev provider (per-criterion excerpts only) and that provider's
   retention terms.
