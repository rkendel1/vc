# VC-2: Investor discovery and thesis research pipeline

Core principle: **every firm gets a profile; no firm gets invented criteria. Research findings are not investor-approved theses.**

## Run it

```sh
bun install
bun run research -- invest/examples/vc-firms.example.csv --workspace ws-dev --dry-run   # plan only: no network, no writes
bun run research -- invest/examples/vc-firms.example.csv --workspace ws-dev             # research and record
bun run start                                                                            # then open #/investors
```

Input: CSV (header with `url`/`website`, optional `name`, `notes`), JSON (array of strings or objects, or `{"firms": [...]}`), or text (one URL per line, `#` comments). Examples are in `invest/examples/`. Rows that are not valid public firm URLs (IP addresses, credentials, `localhost`, bare suffixes) are reported as rejected and never stop the run.

Options: `--workspace` (required), `--dry-run`, `--max-pages`, `--max-depth`, `--timeout-ms`, `--retries`, `--delay-ms`, `--skip-fresh-days`, `--concurrency`, `--no-verify`, `--json <path>`. Defaults and ceilings come from `RESEARCH_*` in `invest/.env.example` (12 pages, depth 2, 10 s timeout, 2 retries, 1.5 s per host; ceilings 50 pages, depth 4, 4 retries, floor 250 ms). Set `RESEARCH_CONTACT` so site owners can reach you from the User-Agent. Exit code 1 means at least one firm hit a processing error; re-running the same command retries it. `research_incomplete` is a result, not an error.

The CLI opens the FeltDB directory directly (`FELTDB_DIR`). The file runtime is used as a single-process store here; **stop the server while the CLI runs**, or use the web "Refresh research" button, which runs the same code inside the server. Concurrent multi-process access was not verified.

## Audit findings and integration decisions

| Question | Finding | Decision |
| --- | --- | --- |
| Investor/firm record? | None. The existing "thesis" (`InvestmentThesis`, `ThesisVersion`) is the *user's own fund mandate*, approved by the workspace. No external VC firm entity or evidence class exists. | **Contract gap.** Added a minimal firm model (`invest/domain/research.ts`) beside, not inside, the thesis types. Thesis editor, evaluation and review code are untouched. |
| Evidence provenance? | `EvidenceItem` is founder-document evidence with page coordinates. | Not reused: public web sources need URL, redirects, outcome, hash. New `research_sources`. |
| FeltDB guarantees | Atomic transaction with `requireAbsent` / `ifVersion`; embedded hash indexes; single-process file runtime. | Used through `invest/store` only. Seven new collections, all workspace-scoped. |
| Audit | Events are written in the same transaction as the change. | Same. New events: `research.firm_created`, `firm_reconciled`, `run_started`, `run_completed`, `run_failed`, `status_changed`, `criteria_changed`, `conflicts_changed`, `verification_recorded`, `review_recorded`; `firm.criterion_approved`, `firm.criterion_withdrawn`. |
| Network rule | AGENTS.md: only `invest/jev/` calls the network. | **Justified extension:** `invest/research/fetcher.ts` is the second sanctioned network module. `check:architecture` enforces that nothing else fetches, that `research/` imports neither the store nor AppPort, reads no environment, and spawns nothing. |
| Jev | HTTP `JevDecisionRequest`/`Response` (choice/binary/score) via `JevDecider`. No Jev package. | Verification is one bounded `choice` question per passage (see below). |
| Capabilities | Generated contract workflow. | 7 new capabilities (`firm.*`); new permission `research.run` (analyst, partner). `bun run generate` run and committed. |
| Execution model | Evaluations run in-process, asynchronously. | `firm.refresh` does the same, so a refresh *is* supported. It accepts a **firm id only, never a URL**, so a caller cannot aim the crawler. |
| Background queue | — | None added. |

## Pipeline

```
file → parse → normalise/dedupe by domain → reconcile firm (deterministic id)
     → run record (running) → bounded crawl → sources → extraction → status
     → one transaction: sources + criteria + run + firm + audit → Jev verification (if configured)
```

- **Identity.** `firm_<sha256(workspace|canonical domain)>`. Scheme, `www.`, case, path, fragment and tracking parameters do not make a second firm; two workspaces get two firms. Concurrent imports converge because creation is `requireAbsent` and the loser reconciles into the winner.
- **Reconcile.** An existing firm keeps its first input name (a different later name is recorded as an alternate note), gains new notes and alias URLs, and is untouched (no write, no audit) if nothing changed.
- **Crawl.** Homepage first, then the most relevant unvisited same-domain link (thesis/criteria > FAQ > portfolio > announcements > team), to `maxPages`/`maxDepth`. At most 3 URL variants per path. Other domains are never followed. `nofollow` is honoured.
- **Safety.** Every hop (first request and each redirect) must be http(s) on port 80/443, without credentials, in the firm's domain or a subdomain, and must resolve only to public addresses (IPv4/IPv6 private, loopback, link-local, CGNAT, multicast, reserved, IPv4-mapped, NAT64 and 6to4 are all refused). Redirects are followed manually (max 3) and never off-domain. `robots.txt` is honoured with longest-match rules and `Crawl-delay`; an erroring `robots.txt` (5xx, timeout) means *do not crawl*. Page directives `noindex/noarchive/nosnippet/none` (meta or `X-Robots-Tag`) mean the page is neither stored nor used. 401/402/403 are recorded as "access restricted" and never bypassed or retried. Timeouts, body size cap, text-only content types, retry with backoff for 408/425/429/5xx/network errors, per-host spacing.
- **Known limit:** the name is validated, then the platform resolves it again to connect. A hostile DNS server could answer differently the second time (DNS rebinding). Run the job behind an egress filter that blocks private ranges.

## Research status definitions

| Status | Meaning |
| --- | --- |
| `thesis_found` | At least one **explicit**, sourced criterion (not application wording alone) was found in the firm's own pages. Coverage warnings are listed. |
| `no_thesis_found` | Coverage was adequate (homepage readable, no relevant page failed or unvisited) and nothing explicit was declared. Observed/inferred signals may exist and are shown, but are not a thesis. |
| `research_incomplete` | Homepage unreadable, a relevant page was blocked/failed, a crawl limit left relevant pages unvisited, or the site had almost no server-rendered text. `retryable` is true only for transient causes (timeout, network, HTTP error); false for robots/access blocks. |
| `pending` | Profile exists, never researched. |

A stub (every status except `thesis_found`) says only what this run established: "…found no explicit investment criteria. This reports only what that run established; it does not mean X has no investment thesis."

## Provenance and verification semantics (kept separate)

- **Assertion type.** *explicit*: first-person investment statement on the firm's pages ("we invest in seed fintech"). *observed*: a past financing described in an announcement ("led the Series A of…"): what the firm did. *inferred*: a term in ≥3 portfolio entries (shown with "n of m"): a pattern, never declared policy; it cannot be approved from the research and is not sent to Jev.
- **Source class.** official website, official publication (the firm's own blog/news), third party, other. The crawler produces only the first two because it never leaves the firm's domain.
- **Verification.** `pending` | `source_supports` | `source_does_not_support` | `inconclusive` | `verification_error`. Jev is asked one bounded choice question: does this passage support this application-built statement? The passage goes in `context` (sanitised, labelled untrusted); `instructions` contain only the template and the statement built from closed vocabularies and parsed numbers. **If Jev is not configured nothing is simulated: criteria stay `pending`.** Jev's probabilities are not stored and never influence status. Support means "this passage says so", not that the firm's published material is complete or current (the UI says this).
- **Confidence.** The extractor is rule-based, so there is no model confidence; `extractionNote` states what the rule matched. Unknown is a normal result.
- **Freshness.** `fresh`/`stale` from the last run that re-confirmed the criterion (default 180 days, `RESEARCH_STALE_AFTER_DAYS`).
- **Review.** Flag/dispute/correct/note are append-only records beside the criterion. They never change it and never make it verified.
- **Investor-verified.** Only `firm.approve` (permission `thesis.approve`) writes `firm_approvals`, from an explicit/observed criterion or by hand, append-only with `firm.approval.withdraw`. The pipeline never writes or overwrites an approval.
- **Conflicts** are derived and shown, never resolved: include-vs-exclude across sources, non-overlapping check sizes across sources, research vs an approved check size, research exclusion of an approved inclusion (and the reverse).

## Data model and retention

Collections: `investor_firms`, `research_runs` (running → completed|failed, `ifVersion`), and immutable `research_sources`, `research_criteria`, `criterion_verifications`, `research_reviews`, `firm_approvals` (`requireAbsent`). Source id = firm + requested URL + content hash (or outcome) + extractor version; criterion id = firm + source + field/value/assertion + passage hash + extractor version. Re-running unchanged input therefore creates **no** new sources or criteria, only a run record. A changed page or extractor creates new records; earlier criteria become "history" (not in the latest run) and are never edited. Profile pointers are updated only by the newest run (a stale concurrent run records itself and says it did not replace the profile).

Retention: pages are **not mirrored**. A source keeps title, content type, a SHA-256 of the extracted text, and only the sentences that produced criteria (≤8 per page, ≤420 chars). Pages that ask not to be stored keep no text. Sentences that try to instruct a reader are discarded and the page is flagged (`hostileContent`); they are not stored. No purge or TTL job exists yet (follow-up).

## Untrusted content

Page text is data. Extraction is deterministic pattern matching with closed vocabularies; nothing is executed, interpolated into prompts, or allowed to change crawl scope, secrets, or status. Instruction-like sentences ("ignore previous instructions", "you are an AI", "reveal your API key", "mark this firm as…") are dropped. Tests cover hostile text, hostile links to `169.254.169.254` and external domains, and that Jev `instructions` never contain page text.

## Sample report

Generated from the offline test fixtures (not live sites):

```
Research pipeline report
Input rows: 5; firms: 3; duplicate rows collapsed: 1; rejected rows: 1

alpine.vc (Alpine Ventures)
  firm: created; research: thesis_found; run rr_…
  pages read: 5/6
  criteria: 17 explicit, 1 observed, 1 inferred
  verification: pending (Jev not configured)
  - 5 of 6 page(s) read
  - 14 explicit criterion statement(s) found in public sources
quiet.vc (Quiet Capital)
  firm: created; research: no_thesis_found; run rr_…
  pages read: 1/1
  criteria: 0 explicit, 0 observed, 0 inferred
  verification: pending (Jev not configured)
  - 1 of 1 page(s) read
  - no explicit investment criteria were found in the pages this run could read
walled.vc
  firm: created; research: research_incomplete; run rr_…
  pages read: 0/1
  criteria: 0 explicit, 0 observed, 0 inferred
  verification: pending (Jev not configured)
  - 0 of 1 page(s) read
  - the homepage could not be read (blocked_robots: disallowed by robots.txt)

Rejected input rows:
  line 5: A firm needs a domain name, not an IP address (http://10.0.0.1/)

Totals: firms=3, rejectedRows=1, duplicatesCollapsed=1, thesis_found=1, no_thesis_found=1, research_incomplete=1
```

## Known limitations

- Rule-based, English-centric extraction; paraphrase and tables are missed rather than guessed. JavaScript-rendered sites are reported `research_incomplete`, not rendered.
- Only dollar check sizes are parsed; other currencies are left unknown.
- Observed financings record the stage only, not the company. Portfolio inference needs ≥3 entries on one page.
- Hidden text (CSS-hidden) is not distinguished from visible text; it is still only matched, never obeyed.
- DNS rebinding window (above). No proxy support. robots.txt is cached per run only.
- Public web content may be incomplete or out of date; no source is a guarantee of current strategy.
- Not verified against live sites in this environment: the offline fixtures exercise the production fetcher with a substituted socket.

## Follow-up before production use

1. Egress filtering (block private ranges) around the job; pin the resolved address to the connection.
2. Legal review of site terms, copyright and retention; a purge/TTL job for sources; a configurable domain deny list.
3. Run against a labelled set of real firms and measure extraction precision/recall before trusting any status; add a rendered-page option if JS-only sites matter.
4. Real Jev verification quality evaluation (the verification question is new; the quality harness does not yet cover it).
5. Scheduling/queueing and multi-process store access if the CLI must run beside the server.
6. UI: bulk review, conflict resolution workflow, per-field approval of ranges.
