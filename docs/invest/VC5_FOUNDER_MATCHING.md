# VC-5 — Founder matching and investment readiness

A founder keeps a **private** startup profile, supplies evidence, discovers investors, sees **why** each is or is not a fit, finds
evidence gaps, and gets a prioritised action plan. Every conclusion cites a versioned input. Nothing here predicts investment,
treats an unverified criterion as fact, or treats missing evidence as unsuitability.

## Audit that shaped the design

| Question | Finding | Consequence |
|---|---|---|
| Branch state | `claude/eager-tesla-zj8vmm` equals `origin/…` at `f5d517e`; VC-4 commits `c524cab`, `97000d4`, `f5d517e` are present; `main` is at the VC-3 merge. | Built on top; nothing rewritten. |
| Startup records | `Startup` plus evidence/documents already exist and are workspace-scoped (`startup.write`, `document.write`). | Reused for identity, uploads and evidence. The profile is a new versioned record that points at them. |
| Investor criteria | Sourced criteria, approvals, published profiles and reconciliation exist (VC-2/VC-4). | No second thesis store: the matcher reads `ReconciliationModule.forFirm`, the research profile, approvals, and the published directory. |
| Jev | `invest/jev/` is a decision contract used for *verifying a passage supports a statement* and for thesis evaluation. It is not a matching or semantic-ranking interface and no tested structured, evidence-linked matching path exists. | **Matching is deterministic. No model is used** (`modelUse: null` is recorded on every evaluation). |
| Founder permissions | The `founder` role could only read and contribute. | It now also holds `startup.write`, `document.write`, `evaluation.run` (existing permissions; `evidence.write` is deliberately withheld so a founder cannot attach reviewer-verified evidence about themselves, VC-6). No new permission, no consent or sharing change. |
| FeltDB | `requireAbsent`, `ifVersion`, atomic transactions with audit in the same transaction (verified in `store.ts`). No native lease or CAS is assumed. | Versions and evaluations are create-fenced; the profile head and shortlist are version-fenced. |

## The four dimensions

They are computed separately, stored separately and shown separately. There is **no combined score**, no probability and no
star rating; a test asserts the result contains none. The only ordering used (`MANDATE_ORDER`, then coverage, then name) is a sort
key and is documented as saying nothing about likelihood of investment.

### A. Mandate fit — `compatible` / `incompatible` / `unknown` per constraint

Constraints: stage, sector, geography, business model, check size. Startup values come from the profile (stage = the round being
raised, else the current stage; geography = headquarters ∪ target markets).

Each investor criterion (a *fact*) carries an **authority**:

| Authority | Meaning | Can eliminate? |
|---|---|---|
| `investor_approved` | Published by a moderator-verified representative | yes |
| `workspace_approved` | Adopted by this workspace | yes |
| `official_stated` | The firm's own explicit statement | only if fresh, not disputed, not contradicted by its source, and in no open conflict |
| `third_party`, `contributed` | Reported by someone else | never |
| `observed`, `inferred` | Patterns from past activity | never; they cannot even make a mismatch |

Rules, in order, per constraint:

1. **No startup value** → `unknown (startup_field_missing)`. Never a mismatch.
2. **Exclusions first.** A live exclusion that covers the startup value → `incompatible`; **hard** if authoritative, otherwise **soft** ("confirm before ruling out").
3. **No criterion** → `unknown (no_criterion)`.
4. **Open conflict among non-approved sources, nothing approved** → `unknown (sources_conflict)`. The conflict is shown, never settled. If a field has an approved value, that value stands (as in reconciliation) and the disagreement stays visible.
5. **Include lists, strongest tier first** (authoritative, then other explicit, then observed/inferred): a match → `compatible` (weak support noted for inferred). A tier of explicit statements that omits the startup → `incompatible`; **hard only for an authoritative stage list**, otherwise **soft** ("a stated focus is not always an exclusion"). Only observed/inferred criteria → `unknown (only_inferred)`.
6. **Check size:** the investor's minimum above the whole round is incompatible (hard if authoritative). A single cheque smaller than the round is `compatible` with a note that other investors would be needed; it is not a mismatch.
7. Hierarchies: early-stage covers pre-seed/seed/Series A, growth covers B/C+, late-stage covers C+; North America covers US/Canada; Europe covers UK; Asia covers India/China/South-East Asia; global covers all.

Roll-up (`MandateSummary`): `eliminated` (any hard) → `possible_mismatch` (any soft) → `compatible_on_known` (≥2 supported compatible, no incompatible) → `partially_assessed` (≥1 compatible) → `unknown`. The statement always states how many constraints are unknown. The founder's own investor exclusions are shown as `founderExcluded`, kept apart from what the investor says.

### B. Investment readiness

Items come from two clearly labelled places:

* **Investor-sourced:** the investor's `traction` criteria. `paying_customers`, `recurring_revenue`, `revenue_generating` and `working_prototype` are checked against the profile; `product_market_fit` is `not_assessable` (no measurable threshold is stated); `pre_revenue` is informational. Observed/inferred ones are described as patterns, not requirements.
* **General checklist** (`readiness-framework/1`): team experience, product maturity, customer validation, revenue metrics, runway. It contains **no thresholds** and is never attributed to an investor.

Statuses: `met`, `not_met` (only against an explicit investor-sourced item), `evidence_not_provided`, `not_applicable`, `not_assessable`. Missing evidence is never `not_met`. Revenue metrics are `not_applicable` at pre-seed, when the startup states it is pre-revenue, or when marked not applicable; net retention and recurring revenue are skipped for non-recurring business models.

### C. Evidence quality (of the startup's own claims)

Per material claim: `reviewer_verified`, `corroborated` (an independent source from another document), `conflicting` (evidence contradicts other evidence, or differs from the stated value by more than 10%), `supplied_by_founder` (a founder document; **presence is not proof**), `source_cited` (the founder cites a public/third-party source; the system has not fetched or checked it), `founder_assertion`. Evidence older than 180 days is flagged `stale`; superseded evidence no longer counts. Corroboration and contradiction reuse the existing evidence registry.

### D. Research coverage and uncertainty

Per core field: `approved`, `stated`, `reported`, `inferred`, `unknown`. Level: `verified` (≥3 approved), `partially_verified`, `unverified_reports`, `inferred`, `unknown`. Flags: `disputed`, `stale`, `conflicted`, `stub` (a conflict already settled by an approved value does not raise `conflicted`). `limitsPrecision` is true for unknown/inferred/unverified investors, fewer than two assessable constraints, or unsettled conflicts; the UI then says "read this as a partial view". A sparsely researched investor therefore cannot look like a clean match.

## Recommended actions

Generated deterministically from findings, ordered by rank (1 first, a rank only): confirm a mismatch before excluding (hard 1, soft 2), clarify a profile field, review a stale/disputed/inferred/conflicting criterion, add or refresh evidence, re-evaluate after a change. Each carries `why`, the `finding` it came from, and the disclaimer "a recommendation about your materials, not a promise that doing it leads to investment". Ids are deterministic, so "done"/"dismissed" survives re-evaluation. Nothing is sent to anyone.

## Evidence, versions and reproducibility

* `startup_profiles` (mutable head, `ifVersion`) → `startup_profile_versions` (immutable, `requireAbsent`, content hash, changed fields, note). Identical content saves nothing. Stale `expectedVersion` is refused.
* Every profile field is `provided` (with a declared basis: founder assertion, uploaded document, official public source, third-party source; evidence links; source URL), `unknown`, or `not_applicable`. "Independently corroborated" is never declared: it is derived from evidence.
* `match_evaluations` (immutable): profile version + hash; evidence refs (id, document id, class, verification, stale) + set hash; investor snapshot (domain, firm id or published version, research run, snapshot hash, fact refs with authority/lifecycle/freshness); policy and checklist versions; timestamp; the full dimension result; `modelUse: null`. Passages are short excerpts; whole documents and source records are never copied.
* Identity of an evaluation = hash of policy, framework, profile hash, evidence set (including verification and staleness), investor snapshot hash. **Identical inputs return the existing evaluation** (also under concurrency); **any change writes a new one** with `previousEvaluationId` and a plain-language `changes` list, and never touches the old one. `fit.compare` diffs two.
* Staleness is derived on read: `fit.get`/`shortlist.list` say whether an evaluation still matches today's inputs and why not.
* Audit events (same transaction): `startup.profile_versioned`, `match.evaluated`, `shortlist.saved/updated/removed/restored`.

## Privacy

Profiles, versions, evidence, evaluations and shortlists are scoped by the session's workspace on every read and write; another workspace gets the same `not found` for everything (tests probe 13 doors, including via HTTP). Investor side: the founder sees only the public directory of representative-published profiles plus research run in their own workspace. No capability accepts a workspace id. Audit payloads omit profile text. Founders cannot read the audit trail. **There is no public profile, investor access, sharing, export, outreach or consent change in this release**, and no code path sends founder data anywhere.

Uploaded documents and retrieved text are untrusted: matching reads only controlled-vocabulary fields and numbers. Free text (description, team, constraints) and passages are displayed and never interpreted; tests confirm that instructions in them change no result and no permission.

## Capabilities (87 total; 11 new)

`startup.profile.get/save`, `fit.discover/evaluate/get/history/compare`, `shortlist.save/update/list/plan`. Reads need `invest.read`; profile save and shortlist writes `startup.write`; evaluation `evaluation.run`.

## Founder workflow (browser)

`Founder` (default for the founder role): create a startup → **Profile** (unknown/not-applicable allowed, basis and evidence links per field, version history) → **Evidence** (reuses the document pipeline; each item shows its support) → **Investors** (filters over stage, sector, geography, business model, check size, approved-only, current-research-only, unknown handling, founder exclusions; four separate dimensions per card; **Explain** opens sources, passages, readiness, evidence quality, coverage, actions and exact provenance) → **Save to shortlist** → **Shortlist & plan** (status, private note, prioritised actions, stale warning, re-run) → change the profile → re-run → *what changed* and compare. Loading, empty directory, filtered-out, partial-research, error and stale states are explicit; nothing is fabricated.

## Local setup

`bun install`, then `bun run dev` or `bun start` as in the README. Sign in with a founder token (see `invest/auth.example.json`; role `founder`). Investors appear once a representative publishes (VC-4 workflow) or the workspace researches them (`bun run research`, partner/analyst).

## Tests

`invest/tests/match-policy.test.ts` (fixture-based policy: every rule above), `founder-flow.test.ts` (profile versioning, discovery filters, evaluations, reproducibility, change, evidence, hostile text, shortlist, isolation, record size), `founder-boundary.test.ts` (AppPort permissions, whole workflow, cross-workspace), and the founder section of `invest/e2e/browser.e2e.ts`.

## Limitations (honest)

* **Fixtures only.** No validation against real investor outcomes or live providers exists; nothing here says a match leads to investment. The thresholds in the rules (10% evidence disagreement, 180 days) are conventions, not calibrated values.
* Only criteria the extractor and adapters produce can be matched; free-text theses are not understood. Business-model matching is exact apart from B2B⊇SaaS. Currency: USD only.
* Directory candidates exist only for investors who published or whose research this workspace ran; there is no global investor search.
* `source_cited` is not fetched or checked. Document text is extracted by the existing rules, not understood.
* No semantic model path: Jev is not used for matching because its contract does not support it. Adding one would need a structured, evidence-linked response contract and its own tests.
* Evaluating is on demand per investor; `fit.discover` recomputes in memory and stores nothing.
* Single-process FeltDB file runtime, as elsewhere.
* Remote CI has not been run for this work.
