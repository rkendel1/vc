# VC-4: collaborative investor intelligence and multi-source reconciliation

Builds on VC-2 (research) and VC-3 (monitoring). Nothing in evaluations, monitoring history, audit or the workspace approval workflow was replaced.

## Baseline audit and decisions

- **Baseline.** VC-2 and VC-3 are on `main` (PR #2, merge `2e4f87c`, identical tree to `193fbd7`). The working branch was fast-forwarded to it before VC-4 began.
- **Reused:** firms, immutable sources/criteria/events/findings/reviews/approvals, `SafeHttpFetcher` (network guard, robots, redirects, limits), the monitoring targets, leases, backoff and runner, `feltdb.flow`, the audit-in-transaction pattern, AppPort capability generation and `permissionAuthorizer`, the existing authentication adapter (no new auth system).
- **FeltDB guarantees used** (unchanged from VC-3): `ifVersion` writes and `requireAbsent` creates are atomic and fence concurrent writers. Verified again by the concurrency tests here (concurrent publication, concurrent edits, concurrent source runs).
- **Contract gap 1 — who is "investor-verified".** In VC-2, "investor-verified" meant *this workspace's partner adopted a value*. That is not the firm speaking. VC-4 keeps that record, relabels it **"Approved by this workspace"**, and adds a second, stronger authority, `firm_representative`, that only a moderator-verified representative of the firm can create. Both authorities are protected from override; they are never merged and neither can withdraw the other's approvals.
- **Contract gap 2 — one workspace owns every record.** Sharing between workspaces did not exist. VC-4 adds exactly three cross-workspace paths, all explicit and tested: (a) the **published profile** a verified representative chose to publish (readable by every workspace); (b) **contributions the author shared** with a firm or with moderators (readable by that audience only); (c) **moderation** of representative claims. Each reads through `store.scanAll`, which `check:architecture` restricts to the scheduler, participation and reconciliation modules. Moderator writes land in the subject's workspace with the moderator's principal preserved.
- **Contract gap 3 — roles.** Added `founder`, `investor_rep` and `moderator` and seven permissions (below). A fund `partner` can administer their own workspace but **cannot** moderate: verifying who may speak for a firm is a platform duty.
- **Ordering.** Decisions, consent and reviews are ordered by time then a creation-ordered id (`newSortableId`), so two events in the same millisecond still have a defined order.

## Source categories (kept apart from assertion, verification and freshness)

| Category | Meaning |
| --- | --- |
| `investor_verified` | Published by a verified representative of the firm |
| `official_public_source` | The firm's own site, publications, portfolio, announcements (VC-2/3 crawl) |
| `third_party_source` | A registered, curated directory, dataset or funding-news feed |
| `founder_contribution` / `community_contribution` | A founder's, or another authorised participant's, submission (by role) |

Every claim also carries: **assertion type** (explicit | observed | inferred), **directness** (stated by the firm | reported by a third party | a participant's account | observed activity | inferred pattern), source passage and URL, publication and capture dates, freshness, and a **lifecycle state**. An official site can be outdated; a directory can be right; a founder can supply useful evidence without any authority over an approved criterion. None of those facts is inferred from the category.

## Curated third-party sources

### What I researched, and what is implemented

I searched for open or feed-based VC data sources before choosing adapters. Honest findings:

- No clearly open-licensed, reusable VC investor directory turned up. Directories and databases found were commercial, scraper-based or paid CSV lists with unstated or restrictive reuse terms ([example listings](https://apify.com/crawlr/venture-firms), [paid CSV list](https://vchub.gumroad.com/l/20000_investor_database)); one bulk JSON/CSV offering requires a licence ([parsers.vc](https://parsers.vc/faq/)). UK Open Government Licence CSVs exist but are 2014 and narrow.
- Funding-news feeds exist, but terms are publisher-specific and I could not confirm automated-use terms for any named outlet; regulators' RSS terms show how restrictive they can be ([example](https://lautorite.qc.ca/en/general-public/terms-of-use/rss)).
- SEC Form D data sets are public domain and structured ([SEC](https://www.sec.gov/dera/data/form-d)), and the SEC restricts unclassified bots and asks for a descriptive User-Agent ([SEC developer resources](https://www.sec.gov/developer)). They are quarterly ZIP/TSV files of *issuers raising money*, not an investor directory, so **no Form D adapter was built**.

**Therefore no named provider is supported.** What is implemented are three **format adapters**, usable only for a source whose registrant attests that its terms permit automated access:

| Adapter | Input | Produces |
| --- | --- | --- |
| `funding_news_feed` | RSS/Atom | Funding announcements: company, round, amount (the round's), lead/participating investor names, dates |
| `csv_dataset` | CSV + declarative column mapping | Investor records with stage, sector, geography, check range, external id, update date |
| `json_dataset` | JSON + dotted-path mapping | The same |

Not implemented (so not claimed): HTML directory scraping, API adapters, people and fund records (the model has `person` and `fund` entity kinds; no adapter produces them), any named provider. Datasets can also describe `portfolio_company` records (an investor field is required).

### Registering a source

```sh
bun run sources -- register invest/examples/source.csv-directory.example.json --workspace ws-dev
bun run sources -- list --workspace ws-dev
bun run sources -- run "Example Investor Directory (placeholder)" --workspace ws-dev
bun run sources -- matches --workspace ws-dev          # candidate matches awaiting review
bun run monitor -- run --workspace ws-dev                # firms and sources, on schedule
```

Or **Investors → Sources** in the web app, or capability `source.register` (permission `source.manage`). A source records name, URL, publisher, type, adapter, **access basis** (published terms permit | public feed | licensed dataset | owner permission; there is no "unknown"), **terms note** (where the terms say automated access is allowed; required), known limitations, optional extra download hosts (max 3), the mapping, and an interval. The example specs under `invest/examples/` are placeholders: their terms notes say so and must be replaced.

Retrieval reuses everything: the **same safe fetcher** (public addresses, ports 80/443, robots.txt, same-host redirects only, size and time limits; only the source's registered hosts are in scope), the **same targets, leases, backoff, jitter, pause/resume and runner** as firms (target `kind: "source"`), and the VC-2 run lifecycle (`source_runs`: running → completed|failed, recovered after a restart). A source that fails records its own failed run and never blocks another. Unchanged documents (same normalised content, adapter version and mapping) are skipped; a parsed document with bad rows persists the good rows plus per-record errors (capped at 200); a document with nothing parseable is a failed run (not retryable) and earlier records are untouched. Limits: `SOURCES_MAX_BYTES` (5 MB), `SOURCES_MAX_RECORDS` (5000). Only snapshot hashes and ≤420-character passages per record are retained, not documents.

Records are **versioned**: identity is the external id (or a content key); a changed record is a new immutable version that supersedes the old, and the old version's claims become *superseded* in reconciliation.

## Entity resolution

Pure and deterministic (`invest/research/resolve.ts`). A record is **matched** to an existing entity only on a *strong* signal: a known **external identifier** from that source, the same **canonical website domain**, or a **name a reviewer already confirmed** as an alias. A **name alone** (exact, alias, or similar) yields **candidate_match**, never a match; so does more than one strong candidate. With nothing plausible the record is **unmatched** and gets its own canonical entity (kind firm or company), so later sightings accumulate. Investors and companies are never matched to each other.

Review is required for every candidate match (Investors → Inbox, or `match.decide`, permission `review.write`): confirm or reject with a rationale and the record considered. A confirmation applies the record's claims/events and teaches the firm the alias (so the next occurrence matches by itself). A **rejection is remembered** and that pairing is never proposed again. Nothing is merged, deleted or rewritten; decisions are immutable records and audited. Re-importing is idempotent (ids derive from the record version and resolver version).

Known matching errors: a funding headline's investor list is parsed by pattern (capitalised names after "led by", "with participation from"…), so unusual phrasing is missed and some non-investor phrases may become candidates; two directories listing the same unmatched firm by name only each create a candidate against the other's entity. All of these cost a reviewer a click, never a silent wrong merge.

## Provenance and reconciliation

`firm.reconciliation` computes, per field, one explained view from four stores that are never merged on disk: the firm's own crawled criteria, third-party claims, the viewer's own contributions, and the firm's published profile.

- **No opaque score and no majority vote.** Each claim shows its signals (category, assertion, directness, age, freshness, how many **independent speakers** state the same value; the firm's site and its own representative count as one speaker) and the reasons in words. There is no confidence field anywhere (tested).
- **Conflicts** (shown, never auto-resolved): include-vs-exclude of one value; non-overlapping check sizes from different speakers; disjoint stage/sector/geography/model lists from different speakers; and **conflicts with an approved value**. Observed and inferred claims are context and never conflict with a stated policy on their own.
- **Approved values are never overridden.** Any number of sources disagreeing with a workspace-approved or representative-approved value yields `conflicts_with_approved` and the approved value stands, until an authorised correction or a new approved version. Another workspace's reconciliation treats a published criterion the same way: read, not copied, never overridden.
- **Lifecycle** (existing review states under their lifecycle names): *proposed* = unreviewed, *needs review* = flagged, *accepted* = confirmed, *rejected* = dismissed, *disputed*, and *superseded* (derived: a newer version from the same source replaced it). **Accepting a third-party claim records that a person judged the evidence. It never makes it investor-verified**; only `profile.approve` by a verified representative does. A rejected claim drops out of conflict detection; accepting both sides of a conflict records that the difference was seen.
- Unknown is a valid result ("No current claims: unknown").

## Investors: claim, verify, approve, publish

1. **Request** (`profile.claim.request`; role `investor_rep`): domain, firm name, relationship. Signing up is not authority. A challenge token is issued.
2. **Prove control** (optional evidence): publish the token at `https://<domain>/.well-known/attn-invest-claim.txt`; `profile.claim.check` fetches it through the safe fetcher. Control of a domain is **evidence, not authority**.
3. **Moderator decision** (`claim.review`, permission `moderation.review`, role `moderator` only): verify | reject | revoke, with a rationale of 10+ characters. **Verification requires evidence**: a successful proof or documented evidence the moderator reviewed. Decisions are audited in the claimant's workspace under the moderator's name and can be revoked at any time.
4. **Approve** (`profile.approve`): with a verified claim for the firm's domain, from a research criterion, a third-party claim, or by hand. Recorded with authority `firm_representative`. Without it: FORBIDDEN, always re-checked from stored events.
5. **Publish** (`profile.publish`): exactly the approvals the representative selects, as a new immutable version (concurrent publishers get distinct versions); `profile.unpublish` appends a withdrawal. Published profiles are readable by every workspace (`directory.list`, `directory.get`) and nothing else of the firm's workspace is.
6. **History**: `profile.history` and the audit trail show approvals, withdrawals, publications and claim decisions, newest first.

## Founders and other participants

`contribution.create` records a correction, firsthand note, outdated flag, suggested relationship or interaction note: **private to the author's workspace** (an edit is a new version). Free text is untrusted: instruction-like text is flagged, never executed, never sent to Jev, and withheld from receivers (the author keeps it). Evidence links are https only and are stored, never fetched.

Sharing is **consent as events**: `contribution.share` to *the firm it is about* or *moderators*, separately; `contribution.revoke` ends it for that audience. Aggregate-analysis consent is a separate, explicit, off-by-default flag given at share time and withdrawn by sharing again without it or by revoking; `aggregateEligible()` is the only gate, and no analysis consumes it yet. Sharing is not publishing: a shared contribution is visible only to that audience, with the author unidentified, and only a verified representative of that firm (or a moderator) can read or respond. Responses (`contribution.respond`: confirm | dispute | dismiss | flag | note) are records in the responder's workspace; a dispute is shown to the author with its reason and **never deletes the contribution or its evidence**. After revocation the receiver can no longer read or respond; earlier responses remain. A contribution counts as a labelled, non-authoritative claim in its **author's own** reconciliation only.

## Permissions

| Permission | Roles | Gate |
| --- | --- | --- |
| `invest.read` (view public-source and published information) | all | — |
| `contribution.write` (edit private notes, submit a correction) | founder, analyst, partner | author only |
| `contribution.share` (share with an investor or moderators) | founder, analyst, partner | author only, per audience |
| `contribution.read_shared` (access submitted material) | investor_rep, partner | plus a verified claim for that firm |
| `profile.claim` | investor_rep, partner | — |
| `profile.publish` (approve and publish as the firm) | investor_rep, partner | **plus a verified claim for that firm** |
| `moderation.review` | moderator only | not partner |
| `source.manage` | analyst, partner, moderator | workspace-scoped sources |

Workspace boundaries are enforced server-side for everything except the three explicit paths above; a foreign id is indistinguishable from a missing one. No capability accepts a workspace id, a URL (except `source.register`'s registered URL and https evidence links, which are never fetched) or a path; `source.refresh` takes a source id only.

## Retention and publication behaviour

Pages and datasets are **not mirrored**: hashes, snapshots' metadata and short passages only. Contributions, shares and responses are retained as history (there is no delete, by design: revocation ends access, not the record). No purge job exists yet. Nothing is published unless a verified representative selects it; nothing a founder writes is published by anyone. Audit events cover: source registration/update/runs, entity creation, match proposed/confirmed/rejected/applied, claim requested/proof/verified/rejected/revoked, representative approvals and withdrawals, publication and withdrawal, contribution created/edited/shared/revoked/responded.

## Sample (fixture data, not live research)

```
FIXTURE DATA, not live research.

Directory run: 4 records, 1 matched by domain, 3 unmatched, 6 claims, 1 record error(s): row 5 has no name
Funding feed run: 2 announcements, 2 candidate matches (name only), 2 item(s) dropped: not a funding announcement; instruction-like text discarded

Inbox candidate matches:
  "Northwind Capital" (participant) -> Northwind Capital [exact_name] :: only names resemble an existing entity; a name alone never merges two entities
  "Meridian Ventures" (lead) -> Meridian Ventures [exact_name] :: only names resemble an existing entity; a name alone never merges two entities

Reconciliation for Meridian Ventures (workspace A view):

check_size: single_source
  - Approved by a verified firm representative: $750K–$3M. Other sources do not override it.
  - 2 publisher(s); not independently corroborated.
  [third_party_source] $250K–$1.5M (explicit; reported by third party; proposed) by Example Directory
  [official_public_source] $500K–$2M (explicit; subject stated; proposed) by meridian.vc
  [investor_verified] $750K–$3M (explicit; subject stated; accepted) by firm:meridian.vc

geography: agreed
  - Independent publishers agree on at least one value.
  [third_party_source] europe (explicit; reported by third party; proposed) by Example Directory
  [official_public_source] europe (explicit; subject stated; proposed) by meridian.vc

sector: agreed
  - Independent publishers agree on at least one value.
  [third_party_source] climate (explicit; reported by third party; proposed) by Example Directory
  [third_party_source] fintech (explicit; reported by third party; proposed) by Example Directory
  [official_public_source] fintech (explicit; subject stated; proposed) by meridian.vc
  [official_public_source] fintech (portfolio pattern) (inferred; inferred pattern; proposed) by meridian.vc

stage: agreed
  - Independent publishers agree on at least one value.
  [third_party_source] seed (explicit; reported by third party; proposed) by Example Directory
  [official_public_source] seed (explicit; subject stated; proposed) by meridian.vc
  [official_public_source] Took part in a seed financing (observed; observed activity; proposed) by meridian.vc
  [official_public_source] Took part in a seed financing (observed; observed activity; proposed) by meridian.vc
```

## Limitations and follow-up before production use

- Verified locally only; GitHub Actions has not run. No live source has been fetched. Every adapter is exercised with offline fixtures through the production fetcher.
- No provider is supported. Registering a source is an attestation by a person; the system cannot read terms. Review the terms of each source and respect robots rules; do not register sources whose terms forbid automated retrieval.
- One process per FeltDB directory (unchanged). `scanAll` reads whole collections: fine for hundreds of firms and thousands of records, not millions.
- A moderator is a platform role with cross-workspace reach for claims and moderator-shared contributions; staffing, SLAs, appeals and abuse handling are operational matters not built here.
- Domain proof shows control of a website, not employment. Verification therefore rests on moderator judgement and documented evidence.
- Matching is conservative by design: expect many candidates. There is no bulk review or auto-confirm.
- No notification channel exists (VC-3 limitation); the inbox is pull-based.
- Retention/purge, a data-processing agreement for founder material, and the aggregate-analysis consent semantics need legal review before any analysis is built.
