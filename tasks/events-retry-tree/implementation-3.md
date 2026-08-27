# Implementation 3 — events retry tree (fix round 3)

Repo: `/work/personal/compass`. Round 3 of fixes on already-implemented, already-verified work (retry button + JSON tree on `/events`). No existing behavior was redone or reverted; exactly the four fixes below were applied.

## Changes made

### Files created

1. **`apps/web/src/routes/events/retry-eligibility.ts`** (new) — Fix A1. Pure, React-free decision module extracted from `EventLogPage.tsx`, following the repo pattern in `apps/web/src/routes/inbox/repayment-eligibility.ts`. Exports `isRetryableEvent(event: Pick<AiEventSummary, "status" | "ingestionId" | "kind">): boolean`. `RETRYABLE_KINDS` now contains only `email_extract` and `statement_parse` — `statement_summary` is deliberately excluded because the extractor treats it as best-effort (`extractStatementSummary(...).catch(() => null)` in `apps/extractor/src/index.ts`), so a failed statement_summary event's ingestion very often finishes as `"extracted"`, not `"failed"`, and the retry endpoint 409s on anything but a failed ingestion. `email_extract`/`statement_parse` failures propagate and genuinely fail the ingestion, so only those two kinds are retryable.
2. **`apps/web/src/routes/events/retry-eligibility.test.ts`** (new) — Fix A2. Six `node:test` cases covering: true for failed `email_extract` with ingestionId; true for failed `statement_parse` with ingestionId; false for `statement_summary`; false for non-replayable kinds (`shopping_parse`); false when status is `ok`; false when ingestionId is `null`.

### Files modified

3. **`apps/web/src/routes/events/EventLogPage.tsx`** — Fix A3. Removed the inline `RETRYABLE_KINDS` constant (which previously included `statement_summary`), added `import { isRetryableEvent } from "./retry-eligibility.ts";` alongside the other local imports, and replaced the inline `canRetry` computation with `const canRetry = isRetryableEvent(event);`.
4. **`apps/web/src/lib/ai-event-queries.ts`** — Fix B. `useRetryIngestion`'s `onSuccess` now refreshes the `["ai-events"]` query on a spread of delays (`[5000, 15000, 40000]`) instead of a single 8 s shot, because extraction duration isn't known upfront (one or more model calls) unlike `useMailboxes()`'s `sync` mutation which has a caller-chosen window. Comment updated accordingly.
5. **`apps/api/src/modules/ingest/services/ingestions.test.ts`** — Fix C. `FakeQueue` gained a `getJobCalls = 0;` field declaration (on its own line alongside the other field declarations) and `getJob` increments it. The 409 test ("an ingestion that is not currently failed is rejected (409) and never reaches the queue") gained one assertion after `assert.equal(fake.calls.length, 0);`: `assert.equal(fake.getJobCalls, 0, "the 409 guard must reject before any queue interaction, not just before add()");` — proving the guard rejects before *any* queue interaction, not just before `add()`.
6. **Prettier formatting (Fix D)** — `npx prettier --write` was run on exactly the 12 listed files. It reformatted:
   - `apps/api/src/jobs/index.ts` (rewrapped long lines)
   - `apps/api/src/modules/ingest/routes/mailboxes.ts` (reformatted two route-option blocks)
   - `apps/api/src/modules/ingest/services/ingestions.test.ts` (the new `getJobCalls` line / surrounding)
   - `apps/web/src/lib/ai-event-queries.ts` (comment rewrap)
   - `apps/web/src/routes/events/EventLogPage.tsx` (line rewraps)
   - `apps/web/src/routes/events/retry-eligibility.ts` (function signature wrapped to 100-col print width)
   - `apps/api/src/app.test.ts`, `apps/web/src/components/json-tree.ts`, `apps/web/src/components/json-tree.test.ts`, `apps/web/src/components/JsonTree.tsx`, `apps/web/src/routes/events/retry-eligibility.test.ts` were reported **unchanged**.

### Files deleted

- None.

## Commands run and literal output

### Fix D — `npx prettier --write` (from repo root)

```
$ npx prettier --write \
  apps/api/src/app.test.ts \
  apps/api/src/jobs/index.ts \
  apps/api/src/modules/ingest/routes/mailboxes.ts \
  apps/api/src/modules/ingest/services/ingestions.ts \
  apps/api/src/modules/ingest/services/ingestions.test.ts \
  apps/web/src/lib/ai-event-queries.ts \
  apps/web/src/components/json-tree.ts \
  apps/web/src/components/json-tree.test.ts \
  apps/web/src/components/JsonTree.tsx \
  apps/web/src/routes/events/EventLogPage.tsx \
  apps/web/src/routes/events/retry-eligibility.ts \
  apps/web/src/routes/events/retry-eligibility.test.ts

apps/api/src/app.test.ts 55ms (unchanged)
apps/api/src/jobs/index.ts 35ms
apps/api/src/modules/ingest/routes/mailboxes.ts 5ms
apps/api/src/modules/ingest/services/ingestions.ts 3ms (unchanged)
apps/api/src/modules/ingest/services/ingestions.test.ts 11ms
apps/web/src/lib/ai-event-queries.ts 3ms
apps/web/src/components/json-tree.ts 2ms (unchanged)
apps/web/src/components/json-tree.test.ts 4ms (unchanged)
apps/web/src/components/JsonTree.tsx 7ms (unchanged)
apps/web/src/routes/events/EventLogPage.tsx 12ms
apps/web/src/routes/events/retry-eligibility.ts 1ms
apps/web/src/routes/events/retry-eligibility.test.ts 3ms (unchanged)
```

Note: `apps/api/src/route-surface.snapshot.txt` and `apps/api/src/route-table.snapshot.txt` were NOT run through prettier, and no other file outside the list was touched.

## Acceptance checks — literal output

### 1. `npm run typecheck` — 0 errors

```
> compass@0.1.0 typecheck
> npm run typecheck --workspaces --if-present


> @compass/api@0.1.0 typecheck
> tsc --noEmit


> @compass/docs@0.1.0 typecheck
> tsc --noEmit


> @compass/extractor@0.1.0 typecheck
> tsc --noEmit


> @compass/ingestor@0.1.0 typecheck
> tsc --noEmit


> @compass/web@0.1.0 typecheck
> tsc --noEmit


> @compass/ai@0.1.0 typecheck
> tsc --noEmit


> @compass/shared@0.1.0 typecheck
> tsc --noEmit
```

### 2. `npm run lint` — 0 errors

```
> compass@0.1.0 lint
> eslint .

```

### 3. `npx prettier --check` on the Fix D file list — all clean

```
$ npx prettier --check \
  apps/api/src/app.test.ts \
  apps/api/src/jobs/index.ts \
  apps/api/src/modules/ingest/routes/mailboxes.ts \
  apps/api/src/modules/ingest/services/ingestions.ts \
  apps/api/src/modules/ingest/services/ingestions.test.ts \
  apps/web/src/lib/ai-event-queries.ts \
  apps/web/src/components/json-tree.ts \
  apps/web/src/components/json-tree.test.ts \
  apps/web/src/components/JsonTree.tsx \
  apps/web/src/routes/events/EventLogPage.tsx \
  apps/web/src/routes/events/retry-eligibility.ts \
  apps/web/src/routes/events/retry-eligibility.test.ts

Checking formatting...
All matched files use Prettier code style!
```

### 4. `node --test apps/api/src/app.route-snapshot.test.ts` — 7/7 pass (unaffected)

```
✔ canonical route surface ((method, path) pairs) matches the committed snapshot byte-for-byte — the real 'unchanged API surface' gate (101.985671ms)
✔ raw printRoutes() tree matches the committed snapshot byte-for-byte (45.856593ms)
✔ assertRouteTableMatches rejects an added route (0.183319ms)
✔ assertRouteTableMatches rejects a removed route (0.073299ms)
✔ assertRouteTableMatches rejects a renamed route (0.065124ms)
✔ assertRouteTableMatches rejects a method change (GET -> POST) (0.057099ms)
✔ assertRouteTableMatches accepts identical tables (0.103738ms)
ℹ tests 7
ℹ suites 0
ℹ pass 7
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1013.035164
```

### 5. `node --test apps/web/src/components/json-tree.test.ts` — 10/10 pass (unaffected)

```
✔ tryParseJson: a valid object parses to its value (0.737396ms)
✔ tryParseJson: a valid array parses to its value (0.087176ms)
✔ tryParseJson: a valid bare primitive parses (ok true, value 42) (0.069011ms)
✔ tryParseJson: an empty string is not parseable (0.071553ms)
✔ tryParseJson: invalid text is not parseable (0.078951ms)
✔ tryParseJson: malformed JSON with a trailing comma is not parseable (0.07886ms)
✔ isTreeable: true for objects and arrays (0.066767ms)
✔ isTreeable: false for null, primitives, and booleans (0.059944ms)
✔ isExpandedByDefault: depths below DEFAULT_EXPAND_DEPTH start expanded (0.12602ms)
✔ isExpandedByDefault: depths at or beyond DEFAULT_EXPAND_DEPTH start collapsed (0.114048ms)
ℹ tests 10
ℹ suites 0
ℹ pass 10
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 55.118661
```

### 6. `node --test apps/web/src/routes/events/retry-eligibility.test.ts` — new file, 6/6 pass

```
✔ isRetryableEvent: true for a failed email_extract event with an ingestionId (0.41941ms)
✔ isRetryableEvent: true for a failed statement_parse event with an ingestionId (0.073109ms)
✔ isRetryableEvent: false for statement_summary — best-effort failures don't fail the ingestion (0.062639ms)
✔ isRetryableEvent: false for a kind with no replayable ingestion (e.g. shopping_parse), even with status error (0.061127ms)
✔ isRetryableEvent: false when status is ok (0.071146ms)
✔ isRetryableEvent: false when ingestionId is null (0.058802ms)
ℹ tests 6
ℹ suites 0
ℹ pass 6
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 54.992049
```

### 7. `node --test apps/api/src/modules/ingest/services/ingestions.test.ts` against a real Postgres (throwaway Docker container)

```
$ docker run -d --name compass-fix3-pg -e POSTGRES_USER=compass -e POSTGRES_PASSWORD=compass-ci -e POSTGRES_DB=compass_ci -p 55435:5432 postgres:18
90f71dcc8ac03735290000197e38c59e988133e2ad25e0c05a20d81e41c5f31b

$ for i in $(seq 1 60); do if docker exec compass-fix3-pg pg_isready -U compass -d compass_ci >/dev/null 2>&1; then echo "pg ready after ${i}s"; break; fi; sleep 1; done; docker exec compass-fix3-pg pg_isready -U compass -d compass_ci
pg ready after 1s
/var/run/postgresql:5432 - accepting connections

$ DATABASE_URL=postgres://compass:compass-ci@localhost:55435/compass_ci npm run db:migrate -w apps/api
> @compass/api@0.1.0 db:migrate
> node --env-file-if-exists=../../.env ../../node_modules/drizzle-kit/bin.cjs migrate

../../.env not found. Continuing without it.
No config path provided, using default 'drizzle.config.ts'
Reading config file '/work/personal/compass/apps/api/drizzle.config.ts'
Using 'pg' driver for database querying
[⣷] applying migrations...[2K[1G[⣯] applying migrations...[2K[1G[✓] migrations applied successfully!

$ DATABASE_URL=postgres://compass:compass-ci@localhost:55435/compass_ci node --test apps/api/src/modules/ingest/services/ingestions.test.ts
✔ retryIngestion: an ingestion owned by the calling user is enqueued with jobId = ingestionId and data = { ingestionId } (30.87903ms)
✔ retryIngestion: an ingestion belonging to a different user 404s and never reaches the queue (9.301954ms)
✔ retryIngestion: a nonexistent ingestion id 404s (3.737245ms)
✔ retryIngestion: an ingestion that is not currently failed is rejected (409) and never reaches the queue (5.37627ms)
✔ retryIngestion: a retained failed job is removed before a fresh job is added (jobId-dedupe guard) (5.735465ms)
ℹ tests 5
ℹ suites 0
ℹ pass 5
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 451.250979

$ docker rm -f compass-fix3-pg
compass-fix3-pg
```

All 5 tests pass, including the strengthened 409 one (which now asserts `fake.getJobCalls === 0`).

### 8. `git status` and `git diff --stat`

```
$ git status
On branch main
Your branch is up to date with 'origin/main'.

Changes not staged for commit:
  (use "git add <file>..." to update what will be committed)
  (use "git restore <file>..." to discard changes in working directory)
	modified:   .claude/agents/dsh-worker.md
	modified:   apps/api/src/app.test.ts
	modified:   apps/api/src/jobs/index.ts
	modified:   apps/api/src/modules/ingest/routes/mailboxes.ts
	modified:   apps/api/src/route-surface.snapshot.txt
	modified:   apps/api/src/route-table.snapshot.txt
	modified:   apps/web/src/lib/ai-event-queries.ts
	modified:   apps/web/src/routes/events/EventLogPage.tsx

Untracked files:
  (use "git add <file>..." to include in what will be committed)
	AGENTS.md
	apps/api/src/modules/ingest/services/ingestions.test.ts
	apps/api/src/modules/ingest/services/ingestions.ts
	apps/web/src/components/JsonTree.tsx
	apps/web/src/components/json-tree.test.ts
	apps/web/src/components/json-tree.ts
	apps/web/src/routes/events/retry-eligibility.test.ts
	apps/web/src/routes/events/retry-eligibility.ts
	tasks/events-retry-tree/

no changes added to commit (use "git add" and/or "git commit -a")

$ git diff --stat
 .claude/agents/dsh-worker.md                    | 29 ++++++++--
 apps/api/src/app.test.ts                        |  2 +-
 apps/api/src/jobs/index.ts                      | 56 ++++++++++++++++----
 apps/api/src/modules/ingest/routes/mailboxes.ts | 32 ++++++++++-
 apps/api/src/route-surface.snapshot.txt         |  1 +
 apps/api/src/route-table.snapshot.txt           |  1 +
 apps/web/src/lib/ai-event-queries.ts            | 29 +++++++---
 apps/web/src/routes/events/EventLogPage.tsx     | 70 ++++++++++++++++++++-----
 8 files changed, 183 insertions(+), 37 deletions(-)
```

## Working-tree baseline note (pre-existing, not from this round)

The working tree was **already dirty before this round** with the uncommitted output of fix rounds 1–2 (this repo stage-files-explicitly; previous rounds left their work unstaged). The following tracked modifications and untracked files were present before Fix A/B/C/D and were **not created or modified by me**:

- `.claude/agents/dsh-worker.md` (modified — harness tooling, unrelated)
- `apps/api/src/app.test.ts` (the `extract: alerts` line in the queues decorate — prettier reported this file "unchanged", so the modification predates my prettier run)
- `apps/api/src/jobs/index.ts` (the `extract` queue producer — round 1/2 content; prettier rewrapped long lines)
- `apps/api/src/modules/ingest/routes/mailboxes.ts` (the `POST /api/mailboxes/ingestions/:id/retry` route — round 1/2 content; prettier reformatted two route-option blocks)
- `apps/api/src/route-surface.snapshot.txt` and `apps/api/src/route-table.snapshot.txt` (contain the retry route from earlier rounds' snapshot regeneration — I did NOT touch these, did not run prettier on them, and did not re-run snapshot regeneration; the route snapshot test passes byte-for-byte, confirming Fix A/B/C/D add/change no routes)
- Untracked: `AGENTS.md`, `apps/api/src/modules/ingest/services/ingestions.ts`, `apps/web/src/components/json-tree.ts`, `apps/web/src/components/json-tree.test.ts`, `apps/web/src/components/JsonTree.tsx`, `tasks/events-retry-tree/` (rounds 1–2 reports)

My changes for this round are confined to exactly: `apps/web/src/routes/events/EventLogPage.tsx` (modified), `apps/web/src/lib/ai-event-queries.ts` (modified), `apps/api/src/modules/ingest/services/ingestions.test.ts` (modified, itself an untracked round-1/2 file), plus new files `apps/web/src/routes/events/retry-eligibility.ts` and `apps/web/src/routes/events/retry-eligibility.test.ts`, plus the prettier whitespace/formatting Fix D applied to the listed files. Nothing was committed (`git add`/`git commit` were not run).

## Issues / risks / deviations

- No deviations from the requested changes. Fix A/B/C/D were applied exactly as specified (Fix A's `retry-eligibility.ts` function signature was rewrapped by prettier to the 100-column print width — same code, different line breaks — which is what Fix D's compliance pass is for).
- Pre-existing uncommitted work from rounds 1–2 in the working tree means `git status`/`git diff --stat` show more than just this round's delta; the round-3 delta itself matches the expected file list. No attempt was made to commit, revert, or alter those pre-existing changes.
- No route was added, removed, or renamed by this round, so route snapshot regeneration was intentionally not re-run; the snapshot test passes against the existing (already-regenerated) snapshots.
