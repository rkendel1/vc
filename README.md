# Attn Invest

A web application where **founders** find investors that fit them, **investor representatives** control how their firm appears, and **moderators** keep that information trustworthy. Every investor criterion keeps its source, and every match explains itself. A fund team can also evaluate startups against its own versioned criteria with Jev.

It is not a deal-sourcing tool, an investment adviser or a company score. A match is **not** a prediction that anyone will invest.

## What each person can do

| Role | Start page | Can do |
| --- | --- | --- |
| **Founder** | Startup | Keep a private, versioned profile (unknown and not-applicable are valid answers); upload, replace or remove evidence; find investors; see why each fits or does not, with sources; save a private shortlist; work through prioritised next steps; re-run after changing anything and see what changed |
| **Investor representative** | My firm | Claim a firm, prove control of its website, wait for a moderator to verify them, review the firm's criteria, approve and publish the ones that are right; see what every workspace currently sees; respond to what founders choose to share |
| **Moderator** | Review queue | Verify or reject representative claims, resolve ambiguous entity matches, respond to shared contributions, see conflicts; every decision needs a reason and a confirmation and is recorded with their name |
| **Fund team** (partner, analyst, viewer) | Overview | Maintain investment theses, evaluate startups against them, review findings and record decisions; read investor research |
| **Operations** (anyone with `source.manage`) | Operations | Register research sources, watch monitoring, check system health |

Navigation shows only what the signed-in person's role includes. The server enforces every permission regardless.

## Run it

Requires Bun 1.3.13. This repository was extracted from [rkendel1/attn](https://github.com/rkendel1/attn); FeltDB and AppPort are published npm dependencies.

```sh
bun install
bun run jev:standin        # optional, development only: a lexical stand-in that speaks the Jev contract
JEV_ENDPOINT=http://127.0.0.1:4500/decide JEV_API_KEY=dev-jev-key JEV_PROVIDER=standin \
  bun run start            # builds apps/invest-web and serves everything on http://localhost:3100
```

For UI work: `bun run dev` (server, restarts on change) plus `bun run dev:web` (Vite on 5174).

### Signing in, and who is what

Identity is a local registry, not an account system. A person signs in with a bearer **access token**; `AUTHBOUNDRY_CONFIG_PATH` points at a JSON file mapping each token's SHA-256 to a principal, a workspace and a **role** (`founder`, `investor_rep`, `moderator`, `partner`, `analyst`, `viewer`); see [`invest/auth.example.json`](invest/auth.example.json). A role is a fixed set of permissions (`invest/auth/authboundry-adapter.ts`); the application never grants more than the role. For development, `dev-partner-token` signs in as a fund partner (refused in production). There is no sign-up, password reset or external identity provider: an administrator edits the registry. Production refuses to start without `AUTHBOUNDRY_CONFIG_PATH` and `DOCUMENT_STORAGE_LINK_SECRET`.

### Where investor data comes from

* **Published by the firm:** criteria a moderator-verified representative approved and published. The only data shown as *Approved by the firm*.
* **Researched in a workspace:** the firm's own public pages, read within bounds (`bun run research`, or automatically when a representative claims a firm), then re-read on a schedule (`bun run monitor`). Shown as *Stated on the firm's own site*; pages can be out of date.
* **External sources:** curated datasets and funding-news feeds registered under Operations or `bun run sources`, normalised through format adapters (CSV, JSON, RSS/Atom). No provider is built in, and none is claimed to be supported: register only sources whose terms allow automated access.
* **Contributions:** founders' notes, private by default, shared only by consent.

The investor list a founder sees is therefore **not the market**: only investors who published, or whom the founder's workspace researched.

### What a match does and does not mean

Four separate questions, never combined into a score: **Investor fit** (do the investor's sourced criteria allow this startup; unknown is not a mismatch; only approved or current, undisputed statements from the firm can rule an investor out), **Readiness** (what is not provided yet is not a failed requirement), **Evidence quality** (a document is not proof; independent support is shown separately) and **Research completeness** (how much is actually known about the investor). The rules are deterministic, versioned and listed in [`docs/invest/VC5_FOUNDER_MATCHING.md`](docs/invest/VC5_FOUNDER_MATCHING.md). No AI model is used for matching. Nothing has been validated against real investor outcomes.

### What has and has not been validated

Everything is exercised against fixtures and the local stack: unit and integration tests, the real HTTP boundary, and a real Chromium end-to-end run. **No live investor source, live Jev deployment or real investor behaviour has been tested**, and remote CI has not been run. Do not read passing tests as production readiness: see *Operational gaps* in [`docs/invest/PRODUCT_EXPERIENCE.md`](docs/invest/PRODUCT_EXPERIENCE.md).

### Operating a deployment

| Task | Command |
| --- | --- |
| Start the server and web app | `bun run start` |
| Add firms for research (fund or operator) | `bun run research -- <file.csv> --workspace <id>` |
| Refresh monitored firms on demand; run on a schedule in production | `bun run monitor -- run --workspace <id>` |
| Register or run a curated source | `bun run sources -- …` (or Operations → Research sources) |
| Seed a demo workspace | `bun run seed` |

Configuration is in [`invest/.env.example`](invest/.env.example). Durable state is declared in [`feltdb.flow`](feltdb.flow).

## Documentation

| Document | Contents |
| --- | --- |
| [`docs/invest/PRODUCT_EXPERIENCE.md`](docs/invest/PRODUCT_EXPERIENCE.md) | The customer experience for founders, representatives and moderators; navigation; vocabulary; what was fixed in VC-6; operational gaps |
| [`docs/invest/VC5_FOUNDER_MATCHING.md`](docs/invest/VC5_FOUNDER_MATCHING.md) | Matching rules, evidence and versioning model, privacy |
| [`docs/invest/VC4_COLLABORATION.md`](docs/invest/VC4_COLLABORATION.md) | Sources, entity resolution, reconciliation, representative workflow, contributions |
| [`docs/invest/VC3_MONITORING.md`](docs/invest/VC3_MONITORING.md), [`VC2_RESEARCH_PIPELINE.md`](docs/invest/VC2_RESEARCH_PIPELINE.md) | Monitoring and research pipeline |
| [`docs/invest/PR1_ARCHITECTURE_BASELINE.md`](docs/invest/PR1_ARCHITECTURE_BASELINE.md) | What was verified about FeltDB, AppPort and Jev; architecture invariants |

## Check it

| Command | What it proves |
| --- | --- |
| `bun run test` | 292 tests (47 original, 55 VC-2 research, 51 VC-3 monitoring, 53 VC-4 collaboration, 65 VC-5 founder matching, 21 VC-6 product surface):  thesis versioning and races, ingestion (good, malformed, truncated, text-less, partial, adversarial PDFs), evaluation (positive, negative, ambiguous, adversarial, missing, Jev failures, deadlines, idempotency, reruns, tamper detection, crash recovery, credential leakage), decisions, telemetry off, and the AppPort boundary over real HTTP including cross-workspace isolation |
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
                                              invest/appport/capabilities.ts  (87 capabilities)
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
