# Attn Invest — Jev for Investment Evaluation

A web application that evaluates a startup against an investor's own, versioned criteria. Startup
claims become traceable evidence, Jev answers one bounded question per semantic criterion, and
application code enforces thresholds, hard gates, evidence standards and review gates. The
investor's decision is recorded separately, with every override attributable and audited.

It is not a deal-sourcing tool, an investment adviser, or a company score.

## Layout

| Path | Contents |
| --- | --- |
| `invest/` | Server: AppPort capabilities, domain modules, FeltDB store, Jev adapter, ingestion, tests, quality harness |
| `apps/invest-web/` | The investor web interface (React, Vite) |
| `docs/invest/` | Architecture baseline, acceptance checklist, pilot quality report, investor research pipeline (VC-2) |

## Run it

Requires Bun 1.3.13. This repository was extracted from [rkendel1/attn](https://github.com/rkendel1/attn), whose platform packages (FeltDB, AppPort) it uses as published npm dependencies; it has no source dependency on Attn.

```sh
bun install
bun run jev:standin        # optional, development only: a lexical stand-in that speaks the Jev contract
# in another shell:
JEV_ENDPOINT=http://127.0.0.1:4500/decide JEV_API_KEY=dev-jev-key JEV_PROVIDER=standin \
  bun run seed             # optional: demo thesis, four fictional startups, one evaluation each
JEV_ENDPOINT=http://127.0.0.1:4500/decide JEV_API_KEY=dev-jev-key JEV_PROVIDER=standin \
  bun run start            # builds apps/invest-web and serves everything on http://localhost:3100
```

Sign in with `dev-partner-token` (development only; production requires `AUTHBOUNDRY_CONFIG_PATH`).
For UI work, `bun run dev` (server, restarts on change) plus `bun run dev:web` (Vite on
5174, proxying `/appport` and `/files`).

The stand-in is a keyword heuristic, not Jev. Every manifest records `provider: standin`, so a report
made with it can never be mistaken for a real judgment. Point `JEV_ENDPOINT` at a real Jev deployment
for anything that matters.

## Investor research (VC-2)

`bun run research -- invest/examples/vc-firms.example.csv --workspace ws-dev [--dry-run]` reconciles one profile per venture firm and researches each firm's own public pages within bounds. Findings are labelled explicit, observed or inferred, are traced to a source passage, and are never investor-approved theses; a firm with nothing found gets an explicit stub. See [`docs/invest/VC2_RESEARCH_PIPELINE.md`](docs/invest/VC2_RESEARCH_PIPELINE.md). Browse results under **Investors** in the web app.

Firms are also **monitored continuously** (VC-3): `bun run monitor -- run --workspace ws-dev` runs one cycle on demand, finds new announcements, source changes and proposed thesis changes, and shows them in a timeline for review without ever modifying investor-approved criteria. See [`docs/invest/VC3_MONITORING.md`](docs/invest/VC3_MONITORING.md). Durable state is declared in [`feltdb.flow`](feltdb.flow).

## Check it

| Command | What it proves |
| --- | --- |
| `bun run test` | 153 tests (47 original, 55 for VC-2 research, 51 for VC-3 monitoring):  thesis versioning and races, ingestion (good, malformed, truncated, text-less, partial, adversarial PDFs), evaluation (positive, negative, ambiguous, adversarial, missing, Jev failures, deadlines, idempotency, reruns, tamper detection, crash recovery, credential leakage), decisions, telemetry off, and the AppPort boundary over real HTTP including cross-workspace isolation |
| `bun run typecheck` | Server and web app typecheck |
| `bun run check:architecture` | The invariants in `docs/invest/PR1_ARCHITECTURE_BASELINE.md` §5 |
| `bun run generate:check`, `doctor` | Generated manifest/client are current; AppPort doctor is clean |
| `bun run quality` | Labelled regression cases: false support, false contradiction, unknown handling, review-routing recall, reviewer correction rate, latency, failures; fails on any false support or unverifiable evaluation |
| `bun run e2e:browser` | The whole workflow through the real UI in Chromium |

`bun run ci` runs the first five.

## Architecture

```
apps/invest-web (React)  ──generated AppPort client──▶  /appport (HttpBinding)
                                                           │  authenticate: AuthBoundry adapter (bearer → principal, workspace, role)
                                                           │  permissionAuthorizer: capability permissions
                                                           ▼
                                              invest/appport/capabilities.ts  (45 capabilities)
                                                           ▼
                                              invest/service.ts → modules → invest/store (FeltDB 0.11.7)
                                                                        └→ invest/jev (Jev HTTP contract)
```

One deployable application with explicit internal modules (`invest/modules/`):

| Module | Responsibility |
| --- | --- |
| `investment-thesis` | Criterion validation, drafts fenced on version, immutable approved versions, comparison |
| `startup-registry` | Profiles; founder claims recorded as founder-reported evidence |
| `document-ingestion` | Type/extension/signature checks, private storage, pdfjs parsing with page coordinates, honest statuses |
| `claim-extraction` | Deterministic rules: claims, metrics (forward-looking statements excluded), topics |
| `evidence-registry` | Provenance, derived corroboration and contradiction, per-criterion projection, gaps, reviewer-verified evidence |
| `evaluation-questions` | The bounded Jev question; untrusted text only in `context`, never in `instructions` |
| `evaluation-orchestrator` | Frozen manifest, retries and deadline, atomic completion, reruns, crash recovery, independent verification |
| `investment-policy` | Thresholds, evidence sufficiency, hard gates, review routing, overrides overlay, summary, decision rules |
| `decision-records` | Reviews, overrides, diligence requests, decisions (append-only) |
| `audit` | Read side of the audit trail written inside every transaction |

### What is real and what is adapted

The specification's package list did not match this repository; PR 1
([`docs/invest/PR1_ARCHITECTURE_BASELINE.md`](docs/invest/PR1_ARCHITECTURE_BASELINE.md)) records what was verified. In short: FeltDB 0.11.7 and
AppPort SDK 1.1.19 are used as installed; there is no `@authboundry/core`, so the repository's
`AuthBoundryAuthority` adapter interface (from Attn's `appport/authboundry.ts`) is implemented over a principal registry; there is no Jev
package, so the adapter speaks the existing Jev HTTP decision contract. The only added runtime
dependency is `pdfjs-dist` (exact pin), for page-located text.

### Evaluation semantics

- Every evaluation names one approved thesis version and freezes a manifest: criteria, evidence
  snapshot with source hashes, per-criterion projections, question digests, Jev identity, policy,
  parser and extractor versions. Its digest identifies the inputs; changed inputs, new digest.
- **Deterministic** criteria compare a metric to a threshold in code. Among equally credible sources
  the least favourable figure is used; disagreement is flagged and routed to review.
- **Semantic** criteria ask Jev to choose one of five outcomes. The raw response and distribution are
  kept. Policy then applies the evidence standard (a founder's own statement is not independent), the
  confidence threshold, and contradiction routing. `evaluation_failed` is never Jev's to choose.
- **Human-review** criteria are recorded with their evidence and always require a reviewer.
- No evidence: no question is sent; the finding is `insufficient_evidence` with what is missing.
- Invest requires every review gate resolved and no failed or unresolved hard gate. Decline, hold and
  more diligence are always open. Overrides are new records; findings are never edited.
- `evaluation.verify` recomputes digests, projections, questions and every outcome from the stored
  record and reports any mismatch.

### Security

Bearer identity via the AuthBoundry adapter; workspace from the session only (no capability accepts
one); foreign ids return `NOT_FOUND`; same-origin writes only; no CORS. Originals are stored 0600,
served only through five-minute HMAC links with a sandboxing CSP. PDFs are parsed with evaluation,
fonts, XFA and fetching disabled, and never executed. Only the projected excerpts for one criterion,
sanitised and size-limited, are sent to Jev, and nothing else leaves the server: FeltDB's anonymous
adoption telemetry is switched off unless `FELTDB_TELEMETRY=1`. Credentials stay in the environment and are redacted from
logs; a test scans every collection for the Jev key. `document.purge` deletes originals and page text
while keeping hashes and quoted claims for audit.

### Configuration

See [`invest/.env.example`](invest/.env.example) and `invest/auth.example.json`. Production refuses to start without
`AUTHBOUNDRY_CONFIG_PATH` and `DOCUMENT_STORAGE_LINK_SECRET`, and requires https for a remote Jev.

### Known limits

- Text PDFs only; scanned pages are reported as unread (no OCR).
- Metric extraction is rule-based and English-centric; unusual phrasing is missed rather than guessed.
- Evaluation runs in the server process; a restart marks in-flight runs failed so they can be rerun.
- The Jev HTTP contract reports no usage, so cost per evaluation is recorded as unknown.
- The quality report uses synthetic cases. A pilot needs real deals labelled blind (specification §10).

See [`docs/invest/ACCEPTANCE.md`](docs/invest/ACCEPTANCE.md) for the pilot-readiness checklist with evidence for each item.
