# Attn Invest — product experience (VC-6)

This document is the customer-experience reference for the three people the product serves — **founders**, **investor
representatives** and **moderators** (the curators) — plus the **fund team** and **operators** who keep the data flowing. It
records what the application was before VC-6, what was wrong with it, what it is now, and the conventions every screen follows.

> Honest scope: everything here runs against fixtures and the local stack. Nothing has been validated against live investor
> sources or real investor outcomes, and the match results never predict investment.

## 1. Audit of the application as it stood (VC-5)

### 1.1 Inventory

| Surface (route) | What it was | Class | Fate |
|---|---|---|---|
| `#/` Workspace | Fund evaluation overview, with a line naming the Jev endpoint | Primary (fund) | Kept as **Overview**; Jev line moved to Operations → System |
| `#/theses`, `#/theses/:id` | Thesis editor/versions | Primary (fund) | Kept, fund roles only |
| `#/startups`, `#/startups/:id` | Fund-side startup evidence + evaluation launcher | Primary (fund) | Kept, fund roles only; the document panel is shared with the founder Evidence tab |
| `#/evaluations/:id` | Evaluation report | Primary (fund) | Kept |
| `#/investors` (5 tabs) | **Directory / Inbox / Sources / Claims & published profiles / Contributions** for every role | Mixed | **Split** (see below) |
| `#/investors/:firmId` | Firm research page (criteria, reconciliation, runs, monitoring, timeline, authority, contribute) | Supporting | Kept for fund and representatives; reorganised; sections renamed |
| `#/founder`, tabs in component state | Founder journey (profile, evidence, investors, shortlist) | Primary (founder) | **Routed** (`#/founder/:id/:step`) so refresh, back and links work |
| `#/audit` | Audit trail | Operational | Renamed **History** (`#/history`; `#/audit` still redirects); shown to roles that may read it |
| Investors → Sources tab | Source registry, run/pause, register | Operational | Moved to **Operations → Research sources** |
| Investors → Inbox tab | Match candidates, conflicts, claims, moderation | Primary (moderator) | Became **Review queue** (moderators) |
| Investors → Claims tab | Directory of published profiles + the representative's claims | Primary (representative) | Became **My firm** (representatives) |
| Investors → Contributions tab | Private notes, sharing, shared-with-firm | Supporting | Became **Your notes** (founders) and **Shared with {firm}** on **My firm** (representatives); fund users add notes from a firm's research page |
| Monitoring controls, attention panel | Per-firm and directory-level | Operational | **Operations → Monitoring**; per-firm controls stay on the firm page for people who may run research |
| Capability inventory, manifest, store terms | Not in the UI | Developer | Stay in `doctor`, `generate` and docs only |

### 1.2 Largest UX problems found (priority order)

1. **One "Investors" page for everyone.** Founders saw Sources and Claims; moderators had to open an "Inbox" tab inside a research directory to find their work; representatives found their own firm under "Claims & published profiles". The navigation reflected modules, not jobs.
2. **Navigation showed everything to everyone.** Founders saw Theses and Audit trail; a viewer saw buttons it could not use. Actions it could not perform were visible, and a restricted route rendered a bare error.
3. **Two "startup" concepts.** *Startups* (fund-side evaluation) and *Founder* (private profile) used the same noun for different journeys.
4. **Founder journey state lived in component state.** Refresh, back and direct links lost the step; discovery filters were lost on every navigation.
5. **Jargon and raw values.** "Mandate fit", "Research coverage", "Founder assertion", "unverified_reports", lower-cased enum values, `check_size`, evaluation hashes and identifiers in default views.
6. **Dead end for representatives.** A representative could request a claim but had no way to register the firm they were claiming; the firm only existed if someone ran a CLI.
7. **No landing queue for moderators**, and consequential decisions (verify, revoke, reject, confirm a match) were single clicks with no confirmation.
8. **Misleading status.** An approved value that already settled a conflict still raised "conflicted/disputed" flags and a "Limited research" warning (fixed in VC-5 for matching; the research page still listed settled items among active conflicts).
9. **Evidence was a separate hop.** The founder's Evidence tab only linked to the fund-side Startups screen; there was no way to see what a document supports, replace it, or understand duplicates and failures in place.
10. **Everything at once.** Match explanations and action lists put every item at the same level; long action lists and unlimited detail overwhelmed the main conclusion.
11. **Layout.** Fixed-width rail on narrow screens, tables overflowing, inconsistent spacing between pages, hard-to-see focus.

## 2. Information architecture

Navigation is built from the session's **permissions** (the role label only chooses the landing page). A route a person may not use shows an
explanation and a way home, never a blank page or a raw error. Servers still enforce every permission; hiding is a courtesy, not security.

| Audience | Shown when | Navigation | Lands on |
|---|---|---|---|
| **Founder** | role `founder` | **Startup**, **Find investors**, **Shortlist**, **Your notes** | the startup (or the list if several) |
| **Investor representative** | `profile.claim` | **My firm** (claim → proof → verification → criteria → publication), **Your notes**, **History** | My firm |
| **Moderator** | `moderation.review` | **Review queue**, **History**; **Operations** | Review queue |
| **Fund team** | `thesis.write` or `evaluation.run` (not founder) | **Overview**, **Theses**, **Startups**, **Investor research**, **History** | Overview |
| **Viewer** | `invest.read` only | **Overview**, **Investor research**, **History** | Overview |
| **Operations** (secondary, with an *Operations* label) | `source.manage` | **Research sources**, **Monitoring**, **System health** | — |

One rule per concept: a startup profile lives under *Startup*; an investor's research page lives under *Investor research* (fund) or *My firm* (representative) and is the same page; a decision queue lives in *Review queue* only.

## 3. The journeys

### Founder — one startup page, four steps (each a real URL)

1. **Profile** `#/founder/:id/profile` — what the founders provide. Every field is *provided*, *unknown* or *not applicable*; unknown is fine. A short "why we ask" under each field; a checklist of what is still needed to compare with investors; inline validation that keeps what was typed; a note after saving naming any saved evaluations that used the previous version.
2. **Evidence** `…/evidence` — upload, replace (supersede), or remove the original file; each document shows what claims it supports, whether it is only provided by the founders or independently corroborated, and plain-language feedback for unsupported, empty, failed or duplicate files. Removing a file never removes the evidence or hashes past evaluations cite.
3. **Find investors** `…/investors` — filters survive back and refresh; every candidate says why it appears; the page says plainly that the list is limited to published profiles plus research done in this workspace and is **not** the market. *No investors available* and *none match the filters* are different states with different next steps.
4. **Shortlist** `…/shortlist` — private shortlist with the top few next steps, each with its reason; completed steps and evaluation history persist; re-running shows what changed.

An **explanation** leads with four short verdicts — *Investor fit*, *Readiness*, *Evidence quality*, *Research completeness* — then the reasons, then sources and exact provenance on demand.

### Investor representative — My firm

Claim status, verification status and publication status are three separate, labelled states with a "what happens next" line:
**Claim submitted → Domain proof checked → Verified by a moderator → Criteria approved → Published**. Adding the firm is part of claiming it (the firm's research record is created, and research starts, as part of the request). The firm page shows **Approved by the firm** separately from **Suggestions awaiting your review** and **External observations**. Only a verified representative sees approve/publish controls; withdrawing or unpublishing asks for confirmation and states the consequence.

### Moderator — Review queue

One ordered list, most consequential first: **Representative claims** (proof and evidence shown, never the challenge), **Entity matches** (candidates, signals, passage), **Shared contributions**, **Conflicts and proposed claims**. Every decision needs a reason and a confirmation, names the actor, and appears under **Recent decisions** and in **History**. Accepting a claim, resolving a match, verifying a representative and approving criteria are different decisions with different words and different buttons.

### Fund team and operators

Unchanged capabilities, regrouped. Operations is a quiet secondary area for source registration, monitoring and system health (Jev configuration, what the stack is connected to).

## 4. Product language

One vocabulary (`apps/invest-web/src/vocab.ts`), used everywhere:

| Concept | Product wording |
|---|---|
| Mandate fit | **Investor fit** |
| Research coverage | **Research completeness** |
| Founder assertion | **Provided by you** (founder view) / **Provided by the founders** (others) |
| `investor_approved` | **Approved by the firm** |
| `workspace_approved` | **Adopted by your team** |
| `official_stated` | **Stated on the firm's own site** |
| `third_party` | **External source** |
| `contributed` | **Contributed by a participant** |
| `observed` / `inferred` | **Seen in past activity** / **Inferred pattern** — never a stated policy |
| Evaluation manifest | **Evaluation details** |
| Reconciliation record | **Conflicting information** while open, **Resolved** when settled |

Distinct states stay distinct and each explains itself: *unknown* (nothing known), *missing* (not yet provided), *stale* (older than the freshness window), *disputed* (someone challenged it), *rejected* (a person set it aside), *incompatible* (a criterion rules the startup out, and how strongly).
*Research incomplete* (could not read enough) is never shown as *completed without a thesis* (read the pages, none stated).

## 5. Visual and interaction conventions

* Page: title, one-line purpose, primary action on the right; content max-width ~72rem; sections separated by space and a heading, not by nested boxes.
* Status badges are **text first** (never colour alone) with a shape/weight cue; semantic colour: supported/approved green, caution amber, conflict/ruled-out red, unknown dashed grey.
* Tables are wrapped (`.table-wrap`) and scroll within themselves; core lists reflow to cards on narrow screens.
* Money is always `$1.5M`/`$500K`/`$2.4B`, ranges `$500K–$2M` or `up to $5M`; dates are local and short; missing is "not stated", never `null`, `undefined`, `—` alone or an enum.
* Every destructive or consequential action opens a modal `<dialog>` with a plain statement of the consequence, keyboard focus inside, **Esc** to cancel, focus returned to the trigger.
* Status messages use `role="status"`; errors `role="alert"`; both persist until the next action.
* Focus is always visible (2px outline offset); controls have text labels.

## 6. What this release does not claim

* No live-provider validation; fixtures and the local stack only.
* Matching remains deterministic and rule-based: no model, no score, no prediction.
* Authentication is the local registry (`AUTHBOUNDRY_CONFIG_PATH`); there is no sign-up, password reset or external identity provider.
* Remote CI was not run for this work.

## 7. What VC-6 changed

**Navigation and routes.** The five-tab Investors page was split by job. Navigation is derived from permissions (`apps/invest-web/src/nav.ts`) and unit-tested for every role: every item leads to a page that role may open, no item is duplicated, restricted routes show an explanation and a way home. Founder steps are real routes (`#/founder/:id/profile|evidence|investors|shortlist`), so refresh, Back and links resume the journey; signing out clears the route so the next person lands on their own start page.

**Screens consolidated, moved, kept, removed**

| Disposition | Screens |
|---|---|
| Consolidated | Directory, Inbox, Claims, Contributions tabs → *Investor research*, *Review queue*, *My firm*, *Your notes*; founder tabs → routed steps; the founder Evidence step and the fund Startups screen share one *Documents* component |
| Moved to Operations | Sources registry, monitoring status, Jev connection and counts (*System health*) |
| Hidden from ordinary users | Jev endpoint line, capability and contract detail, research runs and pages-read (collapsed under "Research details" on a firm page), raw enum values, hashes and identifiers (evaluation details, collapsed) |
| Removed as duplicate or misleading | Old "Conflicts to review" list on the firm page (reconciliation shows open and resolved conflicts); publish controls for fund teams that were never theirs; `window.prompt` for deleting a file |
| Kept as they were, fund roles only | Theses, Startups, evaluation report, Overview |

**Small additions needed to finish existing journeys** (no new product capability): claiming a firm now also registers the firm in the representative's workspace and starts its research (previously a representative had no way to add their own firm without a command-line step); `fit.discover` reports how many investors are published versus researched, so the page can say the list is not the market; a moderator's claim decision is also written to the moderator's own history (the claimant's workspace already had it) so "who decided what" is visible to both; `reconciliation` marks a disagreement with an approved value as `resolution: approved_value_stands`, so it is listed as *Resolved* and no longer counts as an open conflict (a genuine disagreement among external sources stays open); the founder role no longer holds `evidence.write`, so a founder cannot attach "reviewer-verified" evidence about themselves; `MATCH_POLICY_VERSION` is `match-policy/2` because explanation wording changed (rules unchanged).

**Visual system.** `vocab.ts` (every recurring status: words, explanation, tone), `format.ts` (currency, ranges, dates, missing), and shared components: `Badge` (text and glyph, never colour alone), `Notice`, `EmptyState`, `Steps`, `ConfirmButton` (native `<dialog>`: focus moves in, Esc cancels, focus returns), `NotAvailable`. Focus rings, skip link, `main` focus on navigation, labelled landmarks, table captions and header scopes, tables that reflow to labelled blocks under 720 px, filters that collapse on narrow screens.

**Founder polish.** Required vs optional stated once (only the company name); each field says why it is asked and whether it is used for matching or readiness; inline validation that keeps what was typed and names every problem; unsaved changes survive moving between steps and refresh; revenue fields hidden for pre-revenue companies; a note after saving that names the saved evaluations now behind the profile; evidence step shows what each statement supports, where it comes from, and how well supported it is, with plain-language feedback for unreadable, empty, partly read and duplicate uploads; "Delete original" asks first and states that statements and hashes stay; filters persist and are shown as removable chips; "no investor data available" and "no investor matches" are different states; explanations lead with four verdicts, then reasons, then sources, with everything else collapsed.

## 8. Verification

Local only; no GitHub Actions run. Browser journeys in `invest/e2e/browser.e2e.ts` (real Chromium, real server, FeltDB, AppPort): representative claims, proves, is verified and publishes (with validation, confirmation and refresh); moderator decides a claim and an entity match behind confirmations (Esc cancels, focus returns) and sees decisions with their actor; founder creates a profile (validation, draft survives navigation and refresh), uploads evidence (invalid, valid, duplicate), filters and explains investors, shortlists, completes a step (survives refresh), changes the profile, re-runs, compares, deletes an original file; restricted routes for every role; cross-workspace isolation; 390 px layouts checked for sideways scrolling; accessible-name, landmark and focus-ring audits. Server-boundary authorisation and isolation: `founder-boundary`, `collab-boundary`, `product-surface` tests.

## 9. Gaps that remain (product and deployment)

* **No live validation:** fixtures only; no live investor source, Jev deployment or real investor behaviour. Remote CI not run.
* **Accessibility is checked by script and by hand-written assertions**, not with assistive technology or an automated engine such as axe; colour contrast was not measured.
* *(Fixed in VC-7)* Moderators now list decided representatives and revoke or re-verify them in Review → "Representatives you have decided", with the effects stated.
* *(Fixed in VC-7)* A moderator's decision and both audit records are now one FeltDB transaction.
* **Fund screens (Theses, Startups, report)** received navigation and vocabulary changes only; they were not redesigned. The firm research page is still long.
* Adding firms for fund research still needs the command line (`bun run research`); only representatives add their firm through the UI.
* Authentication is a local token registry: no sign-up, SSO or audit of token issue. VC-7 added expiry, disabling, hot reload and a token generator; see `PRODUCTION_READINESS.md`.
* Single-process FeltDB file runtime; no horizontal scaling or migrations. Backup, restore and verification commands exist (VC-7).
* Monitoring runs in the server only with `MONITORING_ENABLED=1`; otherwise it needs `bun run monitor -- run --daemon` or cron. VC-7 reports when nothing is running it (`monitor status`, Operations → Monitoring).
* The investor list a founder sees is limited to published profiles and the workspace's own research. There is no global investor search.
* Heuristics: staleness windows (180 days) and evidence disagreement (10%) are conventions, not calibrated.
