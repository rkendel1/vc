# VC-3: continuous investor monitoring and investment event discovery

A registered firm URL is a **persistent monitoring target**, not a one-time crawl. Builds on VC-2 ([VC2_RESEARCH_PIPELINE.md](VC2_RESEARCH_PIPELINE.md)); nothing in the thesis, evaluation, review or approval workflows was rebuilt.

## Baseline audit

- VC-2 was **not on `origin/main`**: it existed only as a local commit. It is now on the feature branch `claude/eager-tesla-zj8vmm`, and VC-3 builds on that branch. Merging VC-3 requires merging VC-2 with it.
- Reused: `InvestorFirm`, runs, immutable sources/criteria/verifications/reviews/approvals, the crawler, SafeHttpFetcher (network guard, robots, redirects), `planRun` extension points, the audit transaction pattern, `firm.refresh` (in-process execution), the Jev adapter.
- **FeltDB declaration gap (fixed here, affects VC-1..3):** FeltDB 0.11.7 treats `feltdb.flow` as the authoritative declaration of application state (its invariant FELTDB-007: no independent representation). The repository had none; collections and indexes were hard-coded in `store.ts`. `feltdb.flow` now declares every collection and index (parsed with the installed `parseFlowSpec`/`validateFlowSpec`); `store.ts` compiles it, refuses to start if it and the code's collection names disagree, and `check:architecture` enforces workspace scoping and that indexes come only from the flow. It declares collections, filtered fields and indexes; record shapes are still validated in TypeScript. Authorization, workflows and schedules are **not** moved into `.flow`.
- **Concurrency guarantees used** (the same ones the thesis and decision code already rely on; exercised again by the tests here): `ifVersion` writes succeed for exactly one of several writers reading the same version; `requireAbsent` creates once. FeltDB has no lease primitive, so a lease is a field taken with that conditional write (below). Cross-process access to one FeltDB directory was not verified; the design assumes one process per directory.

## Enable, schedule, run

| What | How |
| --- | --- |
| Register + initial research | `bun run research -- firms.csv --workspace ws-dev` registers each firm as a target (default; `--no-monitor` to skip), runs the initial research, then schedules the next check. A failed initial crawl never discards the firm: it stays a target, with backoff. |
| Run one cycle now | `bun run monitor -- run --workspace ws-dev` (every due firm once). `--now 2026-10-13T09:00:00Z` freezes the clock to test without waiting; `--dry-run` lists what is due; `--limit n`. |
| Keep running | `bun run monitor -- run --daemon --workspace ws-dev` (SIGINT/SIGTERM finish checks in flight, then exit), or set `MONITORING_ENABLED=1` for the server's in-process runner (off by default). |
| Status | `bun run monitor -- status --workspace ws-dev` |
| Pause / resume | `bun run monitor -- pause alpine.vc --workspace ws-dev` / `resume … [--interval-minutes n]`, or the Investors page, or capability `firm.monitoring.set` (permission `research.run`). Pausing stops scheduling only; profile, sources, findings and history are kept. |

Configuration (all in `invest/.env.example`, validated at startup, with ceilings): `MONITORING_ENABLED`, `MONITORING_INTERVAL_MINUTES` (default 1440, 15–43200), `MONITORING_MAX_CONCURRENT_FIRMS` (2, ≤8), `MONITORING_LEASE_MINUTES` (15; must exceed 2× timeout × (retries+1) or startup fails), `MONITORING_RETRY_BASE_MINUTES` (30), plus the VC-2 `RESEARCH_*` keys (pages, depth, timeout, retries, per-domain delay), `RESEARCH_STALE_SOURCE_DAYS` (14) and `RESEARCH_ANNOUNCEMENT_LOOKBACK_DAYS` (730). The runner's 60 s wake-up is a constant, not configuration: the schedule itself is persisted.

### How scheduling survives restarts

- The target (`monitoring_targets`, id = firm id) stores `enabled`, `intervalMinutes`, `nextCheckAt`, `lastAttemptAt`, `lastSuccessAt`, `consecutiveFailures`, `lastError`, per-firm crawl limits and the lease. Nothing is held only in memory; a restart loses no due work.
- **Lease and fencing.** A worker takes a lease with an `ifVersion` write; the loser skips the firm. Completion re-reads the target and applies only if the lease token is still its own, so a worker whose lease expired and was taken over cannot overwrite the schedule (`fenced`). Leases expire after `MONITORING_LEASE_MINUTES`. At server/daemon boot the process releases any leases and marks "running" runs failed (retryable), because no other process can legitimately hold them. Leases are **not** renewed: a check that outlives its lease can be taken over (the config check above bounds this).
- **No overlap with manual refresh.** `beginRun` refuses a second running run per firm. A scheduled check that meets a manual refresh releases its lease and looks again in 5 minutes; it is not a failure.
- **Backoff.** Success: next check after the interval plus up to 10% jitter. Transient failure (timeout, network, HTTP error): `base × 2^(n-1)`, capped at the interval, ±20% jitter. Blocked or restricted (robots, access, network policy): the full interval, never a hammering retry. There is no auto-disable; after 3 consecutive failures the firm is reported as *failing* (research health).
- **Concurrency.** At most `MONITORING_MAX_CONCURRENT_FIRMS` firms at once; one firm is one domain, and the per-domain delay, timeouts and retries are VC-2's.
- **Graceful shutdown.** `stop()` starts no new checks and waits for those in flight; unstarted work stays due.

## Source discovery

The crawler (same-domain, robots, network guard, limits unchanged) now also: reads `<link rel="alternate">` RSS/Atom feeds and feed-looking links (at most 3 per run), reads feed items, and follows item links **only on the firm's own domain** as announcement pages. Feed and item links elsewhere are never fetched. Navigation, footer and aside content are ignored. Feeds are parsed without an XML parser: no DOCTYPE, entity or external-entity interpretation; items capped at 50. A malformed feed is recorded as a source with outcome `unsupported_content` and does not fail the firm. It is not a search engine: there is no query, discovery across domains or third-party aggregation. Residual DNS-rebinding risk is unchanged and documented in VC-2 (validate-then-connect resolves twice; run behind an egress filter).

## Change detection

Per URL a `source_state` keeps: status (present | missing | inaccessible), `lastSuccessAt` and `lastSuccessSourceId` (**preserved when later checks fail**), the normalised-content hash, the claim keys and short block hashes of the last successful snapshot (no content), and portfolio entries. Source records stay immutable; identity is the **normalised** hash.

- Normalisation removes navigation/footer/aside, boilerplate and short labels, dates and timestamps ("updated…", "3 days ago"), counters, case, punctuation and whitespace. Raw-hash-only changes therefore create **no** new source, finding or event (tested).
- A normalised change is compared at the level of **extracted claims**. Claims changed → a thesis finding. Claims same but ≥15% of substantive content changed → informational `source_changed` ("material page change") with the new passages. Anything less → nothing.
- A page returning 404/410 that was present → informational `source_missing` ("does not show that the policy or a past announcement was withdrawn"). Timeouts, blocks and restricted pages → research health only.
- **Evidence is carried forward.** Criteria from pages not re-read (failed, missing, over the limit) stay current and age (`carriedForward`, freshness) instead of vanishing. A page that now asks not to be indexed/quoted is the exception: it is dropped. The firm's status is computed on the union, so a transient outage does not flip `thesis_found`.

## Investment events

`investment_events` (immutable) with `event_evidence` (one immutable record per source passage): firm, company name and key, company link (recorded from the firm's own page, **never fetched**), type (new investment, seed, venture, follow-on, acquisition, portfolio addition, other), round, amounts, dates, extraction status, review state. Rules:

- **Amounts.** A round amount is the *round's*, verbatim. A firm amount is recorded only when the passage says "we invested $X". A round size is never turned into the firm's cheque. Unknown stays unknown.
- **Involvement.** `stated` only when the passage ties the firm (by name or "we/our") to an investing verb; "led by Someone Else" and a firm's own post that merely reports a raise are `implied_by_source` and routed for review.
- **Three dates.** *Announced* (written in the passage), *published* (page metadata or feed date), *discovered* (this system, with the run). Classification: **new** (effective date within 30 days of discovery), **historical** (older: backfilled, not news), **undated**, or skipped as out of the lookback window. `baseline` marks everything found by a firm's first successful run: context, not news. A portfolio-page addition is a `portfolio_addition` (undated, needs review), never an announcement.
- **Deduplication.** Same company key + compatible round + dates within 120 days ⇒ the **same event** with another evidence record (corroboration, kept, shown as "reported by more than one source"). Evidence ids are deterministic, so re-crawls add nothing. A different but similar name (token subset, or one edit apart) is **not merged**: it becomes its own event with `companyMatch: uncertain` and links to the candidates, for review. Different rounds of one company are separate events. The event record never changes; the view fills gaps (round, amounts, dates) from its evidence.
- **Jev.** Events are verified through the same bounded question as criteria. The extracted company name travels in the *context*, labelled untrusted, never in `instructions`. If Jev is not configured or fails, the event stays `pending`/`verification_error`.

## Thesis change findings

`research_findings` (immutable, versioned per subject: a later change to the same subject is version n+1 superseding n; same evidence signature ⇒ no new record). Kinds: **thesis_addition, thesis_modification** (check size), **thesis_contradiction** (include vs exclude flips), **thesis_retraction** (a statement no longer on a page that was read again; never when the page could not be read), **thesis_conflict** (new unresolved conflict, including with an approved value), **inferred_pattern** (informational, labelled inferred), `source_changed`, `source_missing`. Each carries previous and new criterion ids, supporting passages with URLs and source ids, the run and the prior run. Material findings require review (`needs_review`). **No finding, event or run ever edits or creates an investor-approved criterion;** findings merely list the approval ids they touch. New investment activity produces events (and, with enough repetition, a labelled *inference*), never a change to an approved or explicit criterion. Four layers stay distinct: investor-verified (`firm_approvals`), explicit public statements, observed investment activity, inferred patterns.

## Timeline, review and attention

The **Investors** page shows an attention panel and, per firm, monitoring state and an **Intelligence timeline** (`firm.timeline`): investment announcements, portfolio additions, new sources, material page changes, missing sources, proposed thesis changes, conflicts, failed research and reviews, each expandable to its evidence passage and URL with published / announced / discovered / reviewed dates apart; filters for type, time found and review state. "Last successful research" is shown beside "last attempt". To inspect and review: open an item, read the passage and source link, then Confirm / Dispute / Dismiss / Flag with a note (`firm.review` with `eventId` or `findingId`; permission `review.write`). A review is a new record beside the finding; it changes nothing else. Adopting a criterion as investor-verified remains a separate, explicit `firm.approve` (`thesis.approve`).

**Attention** (`attention.list`) derives from persisted records with deterministic ids, in four non-overlapping categories, each item once: *new investment activity* (new, non-baseline, unreviewed events), *potential strategy changes* (material thesis findings), *findings requiring review*, and *research failing/stale* (health, never worded as activity). Reviewed items leave the list. No email, Slack or push integration exists in this repository, so none was added; "do not notify twice" holds because the list is derived from persisted state and repeated runs create no new records.

## Sample timeline (fixture data, not live research)

```
FIXTURE DATA, not live research. Clock: 2026-10-11 (initial) and 2026-10-13 (monitoring cycle).

Meridian Ventures  status=thesis_found  last successful research=2026-10-13  next check=2026-10-14

date found  published   announced   category             type                review        item
2026-10-13  2026-10-12  —           investment_activity  investment_event    unreviewed    Freshco: Venture round (series a)
2026-10-13  —           —           strategy             thesis_finding      needs_review  Published check size changed from $500K–$2M to $1M–$3M.
2026-10-11  2026-10-01  2026-10-01  investment_activity  investment_event    unreviewed    [baseline] Gridcell: Seed round
2026-10-11  2025-01-15  —           investment_activity  investment_event    unreviewed    [baseline] Oldco: Venture round (series a)

Attention:
  strategy_change  Published check size changed from $500K–$2M to $1M–$3M.
  new_investment   Freshco: venture round
```

## Operational limitations and risks

- One process per FeltDB directory (cross-process access unverified). The CLI and the server must not run against the same directory at once; run `monitor` while the server is stopped, or enable the in-server runner instead.
- Leases are not renewed; a check longer than `MONITORING_LEASE_MINUTES` can be duplicated by another worker (fenced, but the crawl repeats). Boot-time release assumes a single server process.
- The default is **off** (`MONITORING_ENABLED=0`): nothing crawls until you opt in.
- No conditional requests (ETag/If-Modified-Since); every check refetches up to `RESEARCH_MAX_PAGES` pages. Politeness relies on the per-domain delay and one daily check per firm.
- Extraction is rule-based and English-centric. Company names are heuristics (capitalised sequences); similar names are linked, not merged, so some duplicates need a human. Events from a firm's own news that do not name the firm are `implied_by_source`.
- A feed or page can lie; the system records what was published, with its source, and never validates facts against third parties (none are crawled).
- The attention list reads every firm's profile; fine for hundreds of firms, not tens of thousands.
- DNS rebinding window, retention (no purge job) and the Jev-quality gaps listed in VC-2 remain.
- Verified locally only. The GitHub Actions workflow has not run for this work.
