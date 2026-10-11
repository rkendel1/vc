# Production readiness (VC-7)

**Verdict: not production-ready.** It can be run as a **limited, supervised pilot** under the conditions in §6. Nothing here is a penetration test, a compliance claim or a statement about real-world investor accuracy.

Evidence classes used below, kept separate on purpose:

| Class | Meaning |
|---|---|
| **Local automated** | `bun test` against the real store, real HTTP server and AppPort boundary, with fixtures |
| **Browser E2E** | `bun run e2e:browser`: real Chromium against the local application and fixtures |
| **Fixture ingestion** | Source fetching and parsing driven by injected fetchers and resolvers; proves the policy code, not real networks |
| **Live smoke** | Opt-in, explicitly authorised run against named public sources (§5). **Not run for this milestone** |
| **External CI** | GitHub Actions. **Not run** |
| **Security review** | A code and design review by the author. **Not** an independent review or penetration test |

## 1. Risk register — as found at the start of VC-7 (before any change)

Severity = impact if it happens; likelihood = in a deployment as documented before VC-7.

| # | Risk | Found in code | Sev | Likelihood | Planned response |
|---|---|---|---|---|---|
| R1 | **Development identity mistaken for production.** `APP_ENV` defaults to `development`; with no `AUTHBOUNDRY_CONFIG_PATH` the server accepts the well-known token `dev-partner-token` as a partner and listens on all interfaces | `bootstrap.ts` (`developmentRegistry`), `start-server.ts` (`listen(port)`) | Critical | Medium | Dev mode binds loopback only and refuses a non-loopback host; production requires explicit data directories, auth registry, link secret; reject the well-known dev token in any registry |
| R2 | **No credential revocation or expiry.** The registry is read once at start; removing a principal needs a restart; no `expiresAt`/`disabled`; tokens are unsalted SHA-256 with no entropy rule | `authboundry-adapter.ts`, `bootstrap.ts` | High | Medium | Re-read the registry when it changes; `disabled` and `expiresAt` per principal; fail **closed** if the file becomes invalid; token generator with 256-bit entropy; documented limits |
| R3 | **No limit on credential guessing** | `http.ts` | High | Medium | Per-address failure limiter on `/appport` |
| R4 | **Moderator decisions not atomic.** The claim event (claimant workspace) and the moderator's own audit record were two transactions; a crash between them leaves a decision with no moderator-side record | `participation.reviewClaim` | High | Low | One FeltDB transaction spanning both workspaces; deterministic decision identity; stale-decision fence |
| R5 | **Duplicate or stale decisions.** Event ids were random, so two concurrent moderators could both "verify"; a decision made on a stale view could overwrite a newer one | `participation.reviewClaim` | High | Low–Medium | Deterministic decision id fenced with `requireAbsent`; `expectedStatus`; re-verification needs fresh proof |
| R6 | **Moderators could not list or revoke verified representatives** in the product; revoked claims never reached the queue | UI, `pendingClaims` | High | Certain | Moderator directory of decided claims, revoke and re-verify with stated effects |
| R7 | **DNS rebinding.** The destination is resolved and validated, then the platform resolves again to connect (documented in `fetcher.ts` as a known limit) | `fetcher.ts`, `net-guard.ts` | High | Low | Connect through a `lookup` that resolves **and validates** the very answer used to connect (pinned connection) |
| R8 | **No backup or restore procedure**; copying a live FeltDB directory is unsafe | none | High | Certain | Detect-and-abort backup, manifest with hashes, isolated restore, data verification command |
| R9 | **Scheduler absence is invisible.** Monitoring needs an external `bun run monitor`; nothing says when it is not running | `monitor.ts`, UI | Medium | Medium | Derived "overdue" signal in CLI, API and Operations; documented limits |
| R10 | **Signed file link written to error logs** (`/files/<token>` is part of the logged path) | `http.ts` | Medium | Low | Never log the link token |
| R11 | **Production config under-validated.** Jev endpoint without key only warns; data directories default under the home directory; auth file permissions unchecked | `config.ts` | Medium | Medium | Production refuses these |
| R12 | **No transport-security header** | `http.ts` | Low | Medium | HSTS when behind TLS in production |
| R13 | Live providers never exercised | n/a | Medium | Certain | Opt-in smoke procedure; reported as not run |
| R14 | Two processes (server + `monitor` CLI) share one FeltDB directory — assumed unsafe | docs | Medium | Medium | Measured: commits are serialised by a lock file and re-read state (tested with two writer processes); documented with its limits |


## 2. Status by area

Status words: **Implemented and tested** (code exists and an automated test exercises the claim), **Partially verified** (tested against fixtures or in-process only; a real-world condition is untested), **Not implemented**, **Not tested**.

| Area | Status | What exists | Evidence (class) | Not covered |
|---|---|---|---|---|
| Sign-in credentials | Implemented and tested | 256-bit tokens from `bun run token`; only SHA-256 stored; constant-time compare; known dev token refused in a production registry | `security.test.ts` (local automated) | Tokens are bearer secrets: anyone holding one is that person. No rotation workflow beyond editing the registry; no MFA; no SSO (out of scope) |
| Expiry, disabling, revocation | Implemented and tested | `disabled`, `expiresAt`; registry re-read on change; **fails closed** if the file is unreadable or invalid; `/healthz` returns 503 then | `security.test.ts` | Registry is re-read by file size+mtime; a same-size edit within one mtime tick could be missed (sub-millisecond on ext4/APFS; not measured on network filesystems) |
| Guess limiting | Partially verified | Per-address failure limiter, 429 | `security.test.ts` | In memory, per process, per address; behind a proxy the address is the proxy's unless `INVEST_TRUST_PROXY=1`. It slows guessing; token entropy is what protects |
| Authorization and isolation | Implemented and tested | Permissions checked on every call; workspace from the session; forged workspace input rejected; cross-workspace reads return not-found | `security.test.ts`, `appport-boundary`, `founder-boundary`, `collab-boundary`, `privacy` | Review is by the author, not independent (see §5) |
| Startup policy | Implemented and tested | Production requires explicit data dirs, registry, link secret, https Jev, key; no dev token; dev identity loopback-only; permission check on registry and data dirs; `bun run preflight` | `security.test.ts`, `preflight.test.ts`, `server-process.test.ts` | Preflight checks owner-permission bits only (POSIX) and does not check disk space, backups, TLS or the proxy |
| Moderator decisions | Implemented and tested | Decision, claim state and **both** audit records in one FeltDB transaction (`mirrorAudit`); `ifVersion` fence on the claim; `expectedStatus` stale check; idempotent retry; fresh proof to re-verify | `integrity.test.ts` (injected transaction failure leaves nothing; concurrent decisions produce exactly one outcome) | True atomicity is FeltDB's single-transaction guarantee within one directory; nothing is claimed across directories or machines |
| Representative revocation | Implemented and tested | Moderator directory (`claim.directory`), revoke with reason, re-verify, effects returned and shown; authority checked per call, so revocation takes effect on the next request | `integrity.test.ts`, `collab-boundary.test.ts`, browser E2E | See "Effects of revocation" below |
| Source fetching (SSRF) | Implemented and tested against fixtures | Every hop validated; connection pinned to the validated address (closes DNS rebinding for the connection); ports, schemes, redirects, size, time, content type, `identity` encoding only | `ssrf.test.ts`, `research-unit.test.ts` (fixture ingestion with injected resolvers and fetchers) | **Not tested against a real hostile network.** Run behind an egress filter that blocks private ranges as defence in depth |
| Hostile content | Implemented and tested | Linear HTML and feed parsers (ReDoS found and fixed in VC-7); page text is data, never instructions; credential-like query keys refused at source registration | `ssrf.test.ts`, `monitoring-unit.test.ts`, `collab-sources.test.ts` | Parser bounds are tested on constructed inputs, not a fuzzing corpus |
| Monitoring operations | Partially verified | Persisted schedule; `ifVersion`-fenced leases with tokens; backoff; restart recovery; graceful stop; derived overdue/failing signal (CLI exit code, Operations banner) | `monitoring*.test.ts` (deterministic, injected clock), `server-process.test.ts` | Alerting is a banner and a CLI exit code: **nothing pages anyone**. "Overdue" cannot tell a missing scheduler from a stalled one |
| Backup / restore | Implemented and tested | Detect-and-abort backup with manifest hashes; isolated restore into an empty directory; `verify-data`; unreadable snapshot detected | `data-safety.test.ts` incl. real two-process writers and SIGKILL | Backups are not encrypted or off-host; retention and scheduling are the operator's. Not tested at production data volumes or on network filesystems |
| Audit trail | Implemented and tested | Actor, action, target, timestamp (reason in payload for decisions); failed or refused actions write no success event; readable only with `audit.read` in own workspace; no secrets or submitted text in payloads | `audit-review.test.ts`, `integrity.test.ts` | Not tamper-proof: anyone with write access to the data directory can alter it. There is no hash chain or external anchor |
| Browser bundle | Implemented and tested | No server-only names or secrets in `dist` | `security.test.ts`, browser E2E (scan) | |
| Live providers | **Not run** | Opt-in `smoke:live`, refuses without `INVEST_LIVE_SMOKE=1` | refusal logic tested (`ssrf.test.ts`) | No live source, Jev or provider has been exercised for this milestone |
| External CI | **Not run** | | | GitHub Actions has not run on this commit |
| Penetration test | **Not performed** | | | |
| TLS | Not implemented here | HSTS is sent only when the request was HTTPS (production) | `security.test.ts` (absent over HTTP) | The app speaks plain HTTP; a TLS-terminating proxy is required |

## 3. Decisions, protocols and failure modes

**Moderator decisions (R4, R5).** FeltDB supports multi-record, multi-collection transactions with preconditions inside one data directory, and has no workspace concept, so one transaction can write the claimant's event, the claim record and both audit trails. `InvestStore.commit` still refuses any *write* outside the actor's workspace; only audit events can be mirrored. Failure modes: the transaction fails (nothing changes, retry is safe); two moderators race (the `ifVersion` fence and `requireAbsent` on the deterministic decision id let exactly one win; the other gets a conflict); a moderator decides on a stale view (`expectedStatus` mismatch is refused); the same decision is retried after a lost response (returns the existing decision, writes nothing).

**Effects of revocation.** Immediately, on the next request: the person loses representative authority (checked from stored events on every call, not cached in a session) — they can no longer publish, approve for the firm, or read contributions shared with the firm. *Other* verified representatives of that firm are unaffected. What the revoked person published is withdrawn by writing a **new** profile version (history is kept; nothing is deleted) unless the moderator chooses "keep published". Firm approvals already recorded stay as history. Re-verification needs fresh proof. A revoked person's session token stays valid for their workspace role; revocation removes *authority over a firm*, not sign-in (disable the principal in the registry for that).

**Source fetching.** Failure modes: a hostname that resolves to a private address (refused at connect time, using the same answer that is connected to); a name that answers publicly once and privately next (the second answer is never used for the connection; tested: zero connections reach the local server); redirects to private, off-domain or non-https-downgrade targets (refused); oversized, slow, compressed or wrong-type bodies (refused or truncated within bounds); hostile markup (parsed in linear time). Not covered: a resolver that lies to the whole host (the host's DNS is trusted), and egress to public hosts that are themselves malicious.

**Monitoring.** Supported pattern: **one server process** with `MONITORING_ENABLED=1` runs the scheduler in-process (the only pattern the preflight reports as complete). Alternative: `MONITORING_ENABLED=0` and one supervised `bun run monitor -- run --workspace <id> --daemon` per workspace, under systemd (`Restart=on-failure`, `KillSignal=SIGTERM`, `TimeoutStopSec=60`) or `cron` calling `monitor run` (one cycle per call). The CLI is a *second process* on the same data directory; the FeltDB lock serialises commits (tested with two writer processes) and the per-target lease prevents two workers checking one firm (tested). Guarantees: a check is run by at most one live holder; a holder whose lease was taken over cannot record its result (fencing token); a crash leaves a lease that expires or is cleared at next start; failures back off up to the interval; blocked sites wait a full interval. Not guaranteed: exactly-once *network* effects (a check interrupted after fetching is repeated), clock agreement across machines (single host assumed), and any alert delivery.

**Backup and restore.** FeltDB is a snapshot plus journal that a running server rewrites, so a file copy is only consistent if nothing wrote during it. Backup records size+mtime of every file before and after and **aborts** if anything changed (bounded retries); it then opens a scratch copy and verifies it, and writes a manifest with SHA-256 per file and record counts. The only guaranteed-consistent backup is one taken with the server stopped. Restore verifies the manifest, refuses any non-empty target or the configured live directories, copies, re-opens, compares counts, and removes only what it created if anything fails. Found in VC-7: FeltDB silently reinitialises an *empty* database when `state.json` and its backup are both unreadable, so `InvestStore.openDir` now refuses to open such a directory, and `preflight` and `verify-data` inspect the snapshot without opening it. A killed (SIGKILL) writer leaves a lock file that FeltDB clears after 5 s if the process is gone; the database reopens with committed records intact (tested).

**Shutdown and restart.** `SIGTERM`/`SIGINT` stop accepting connections, let in-flight checks and evaluations settle, close the store and exit 0; a hung shutdown is forced out after 30 s with exit 1. At start, interrupted evaluations are marked failed and interrupted research/leases are recovered. Tested with a real server process.

## 4. Required configuration (production)

| Variable | Requirement |
|---|---|
| `APP_ENV=production` | Enables the checks below |
| `FELTDB_DIR`, `DOCUMENT_STORAGE_DIR` | Explicit; not readable by other accounts (mode `0700`) |
| `AUTHBOUNDRY_CONFIG_PATH` | Registry file (mode `0600`), tokens issued with `bun run token`; the known dev token is refused |
| `DOCUMENT_STORAGE_LINK_SECRET` | At least 16 characters; keep out of backups and logs |
| `INVEST_DEV_TOKEN` | Must be unset |
| `JEV_ENDPOINT` / `JEV_API_KEY` | https endpoint and key required together |
| `INVEST_HOST` | Default loopback. Bind elsewhere only behind a TLS-terminating proxy |
| `INVEST_TRUST_PROXY=1` | Only if the proxy overwrites `X-Forwarded-For`/`-Proto` |
| `MONITORING_ENABLED=1` | Or run the monitor CLI under a supervisor |

Run `bun run preflight` before every start. It makes no network call and changes nothing.

**Owner actions (not done by this repository):** terminate TLS; restrict egress of the host to public addresses; schedule `bun run backup` and keep copies off-host and encrypted; periodically restore one into a scratch directory with `bun run restore` and `bun run verify-data`; arrange a way to be told when `bun run monitor -- status` exits non-zero; rotate tokens by issuing new ones and disabling old entries; decide retention for originals and audit.

## 5. Evidence classes: what was and was not run for this milestone

| Class | Run for VC-7? | Notes |
|---|---|---|
| Local automated | Yes | Results are in the final report for the commit |
| Browser E2E | Yes (re-run after the last code change) | Chromium against the local app, fixtures, and a bundle secret scan |
| Fixture ingestion | Yes | Injected resolvers/fetchers; proves policy code, not the internet |
| Live smoke | **No — not run** | Procedure: `INVEST_LIVE_SMOKE=1 bun run smoke:live -- <1–5 https URLs you are entitled to read>`. Fetches those pages only, through the production fetcher, opens no database, writes nothing, cannot create an approval; output is per-URL outcome. It shows the fetch path worked from that host that day; it says nothing about coverage or accuracy |
| External CI | **No — not run** | |
| Security review | Author's own review only | **Not** an independent review and **not** a penetration test |
| Penetration test | **No** | |

## 6. Conditions for a limited pilot

A limited, supervised pilot (named users, one host, data you can afford to lose and re-create) is reasonable **only if all of these hold**:

1. `bun run ci`, `generate:check`, `doctor` and `e2e:browser` pass on the exact commit deployed, and GitHub Actions has run green on it.
2. `bun run preflight` reports no blocking problem in the real environment.
3. TLS is terminated in front of the app, the host cannot reach private networks or cloud metadata addresses, and only the proxy can reach the app port.
4. Every user has an individually issued token, with an expiry, in a registry readable only by the service account.
5. A backup runs on a schedule, a restore into a scratch directory has been done and `verify-data` passed **before** the pilot starts, and the restore time is known.
6. Someone is named to watch `monitor status` (or the Operations page) and the process supervisor, and to act on an alert.
7. The live smoke has been run once, by the owner, against the specific sources to be used, and its result recorded; or the pilot uses no live sources.
8. Participants are told the limits: no SSO, a bearer-token login, a single process, fixtures-only validation of matching, and that investor data is as accurate as the public pages it was read from.

**Not acceptable for:** unsupervised or public internet use, regulated or highly sensitive data, any claim of compliance, or reliance on audit records as tamper-proof evidence.

## 7. Risk register — after VC-7

Residual = what remains after the mitigation, with the reason.

| # | Mitigation delivered | Evidence | Residual |
|---|---|---|---|
| R1 | Loopback-only dev identity; production config validation; dev token refused; `preflight` | `security.test.ts`, `preflight.test.ts` | **Low.** An operator can still choose weak infrastructure around it (§6.3) |
| R2 | `disabled`/`expiresAt`, hot reload, fail-closed, token generator | `security.test.ts` | **Medium.** Bearer tokens, no MFA/SSO; a leaked token works until disabled |
| R3 | Failure limiter, 429 | `security.test.ts` | **Low–Medium.** Per process and per address; distributed guessing is bounded by token entropy only |
| R4 | One-transaction decision with audit mirrors | `integrity.test.ts` | **Low.** Single data directory only |
| R5 | Deterministic id, version fence, `expectedStatus`, idempotent retry | `integrity.test.ts` | **Low** |
| R6 | Directory, revoke, re-verify with effects (API + UI) | `integrity.test.ts`, browser E2E | **Low.** Revocation does not end the person's sign-in (§3) |
| R7 | Pinned connection; rebinding tests show zero connections | `ssrf.test.ts` | **Medium.** Fixtures only; no egress filter is shipped; trusted host resolver |
| R8 | Backup, restore, verify, snapshot guard | `data-safety.test.ts` | **Medium.** Operator must schedule, encrypt and store off-host; not tested at scale |
| R9 | Overdue/failing signal; documented pattern | `monitoring-unit.test.ts`, `monitoring-cli.test.ts` | **Medium.** Nobody is paged; cannot distinguish stalled from absent |
| R10 | Link token never logged | `security.test.ts` | **Low** |
| R11 | Production refuses unsafe config | `security.test.ts` | **Low** |
| R12 | HSTS behind TLS | `security.test.ts` | **Low** (TLS itself is external) |
| R13 | Opt-in smoke procedure | refusal tested | **High until run.** Live sources and Jev unexercised |
| R14 | Measured: two writers serialise; leases fence workers | `data-safety.test.ts`, `monitoring.test.ts` | **Low–Medium.** One host only; filesystems without correct `O_EXCL`/rename semantics (some network mounts) are unsupported and untested |
| R15 (new) | Hostile HTML made the reader quadratic (31 s on a 3 MB page); replaced with linear, bounded scans | `ssrf.test.ts` | **Low.** Constructed inputs, no fuzz corpus |
| R16 (new) | FeltDB silently starts empty when its snapshot is unreadable; the store now refuses to open it, and `preflight`/`verify-data` report it | `data-safety.test.ts`, `preflight.test.ts` | **Low–Medium.** Detects an unreadable snapshot; it cannot detect a readable-but-wrong one or a damaged journal beyond what FeltDB itself reports |
| R17 (new) | Audit is append-only by interface but not tamper-evident | `audit-review.test.ts` | **Medium** for any use that needs tamper evidence |
