# Implementation 2 — Events Retry Tree Fix-Round

## Files Inspected
- `apps/api/src/modules/ingest/services/ingestions.ts`
- `apps/api/src/modules/ingest/services/ingestions.test.ts`
- `apps/web/src/components/JsonTree.tsx`
- `apps/api/src/jobs/index.ts`
- `apps/web/src/routes/events/EventLogPage.tsx`

## Files Changed
- `apps/api/src/modules/ingest/services/ingestions.ts` (Fix 1)
- `apps/api/src/modules/ingest/services/ingestions.test.ts` (Fix 1)
- `apps/web/src/components/JsonTree.tsx` (Fix 2, full replacement)
- `apps/api/src/jobs/index.ts` (Fix 3)
- `apps/web/src/routes/events/EventLogPage.tsx` (Fix 4a, 4b, 4c)

## Implementation Details

### Fix 1 — server-side status guard on retry
`ingestions.ts`: Changed the SELECT to also fetch `status`. Added a 409 guard: `if (row.status !== "failed") throw new HttpError(409, "Only a failed ingestion can be retried")`.

`ingestions.test.ts`: Changed `createIngestion` signature to accept an optional `status` parameter (default `"failed"`, keeping all existing tests unchanged). Replaced the hardcoded `status: "failed"` in the insert values with the parameter. Added the new 409 test case verifying an `"extracted"` ingestion rejects with 409 and zero queue calls.

### Fix 2 — JsonTree fidelity + accessibility
Replaced the entire `JsonTree.tsx` with the new version that:
- Uses `JSON.stringify(value)` for all primitives (correct quote/escape, no truncation)
- Applies `whitespace-pre-wrap break-words` so long strings wrap instead of truncating
- Adds `aria-expanded={open}` to the toggle button
- Drops `formatPrimitive`, `MAX_INLINE_STRING`, `primitiveTitle`, and the `title` tooltip entirely

### Fix 3 — close ingestor and extract queues on shutdown
`jobs/index.ts`: Added `await ingestor.close()` and `await extract.close()` to the `onClose` hook, alongside the existing worker/system/alerts closes.

### Fix 4 — retry-button eligibility tightening + duplicate toast removal
`EventLogPage.tsx`:
- Added `RETRYABLE_KINDS: ReadonlySet<AiEventKind>` constant with the three replayable kinds (`email_extract`, `statement_parse`, `statement_summary`).
- Changed `canRetry` to also require `RETRYABLE_KINDS.has(event.kind)`.
- Removed `onError` from `retry.mutate(...)` call (the global `MutationCache` already toasts errors).

## Commands Run and Literal Output

### 1. `npm run typecheck`
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
Exit code: 0 (0 errors).

### 2. `npm run lint`
```
> compass@0.1.0 lint
> eslint .
```
Exit code: 0 (0 errors).

### 3. `node --test apps/api/src/app.route-snapshot.test.ts`
```
✔ canonical route surface ((method, path) pairs) matches the committed snapshot byte-for-byte — the real 'unchanged API surface' gate (107.584486ms)
✔ raw printRoutes() tree matches the committed snapshot byte-for-byte (48.050442ms)
✔ assertRouteTableMatches rejects an added route (0.191035ms)
✔ assertRouteTableMatches rejects a removed route (0.074342ms)
✔ assertRouteTableMatches rejects a renamed route (0.074372ms)
✔ assertRouteTableMatches rejects a method change (GET -> POST) (0.055896ms)
✔ assertRouteTableMatches accepts identical tables (0.103878ms)
ℹ tests 7
ℹ suites 0
ℹ pass 7
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1030.985251
```

### 4. `node --test apps/web/src/components/json-tree.test.ts`
```
✔ tryParseJson: a valid object parses to its value (0.838969ms)
✔ tryParseJson: a valid array parses to its value (0.098077ms)
✔ tryParseJson: a valid bare primitive parses (ok true, value 42) (0.074081ms)
✔ tryParseJson: an empty string is not parseable (0.081084ms)
✔ tryParseJson: invalid text is not parseable (0.08396ms)
✔ tryParseJson: malformed JSON with a trailing comma is not parseable (0.074171ms)
✔ isTreeable: true for objects and arrays (0.081966ms)
✔ isTreeable: false for null, primitives, and booleans (0.066106ms)
✔ isExpandedByDefault: depths below DEFAULT_EXPAND_DEPTH start expanded (0.092877ms)
✔ isExpandedByDefault: depths at or beyond DEFAULT_EXPAND_DEPTH start collapsed (0.128074ms)
ℹ tests 10
ℹ suites 0
ℹ pass 10
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 65.020604
```

### 5. Ingestions service test (Docker Postgres)

```bash
docker run -d --name compass-fix2-pg -e POSTGRES_USER=compass -e POSTGRES_PASSWORD=compass-ci -e POSTGRES_DB=compass_ci -p 55433:5432 postgres:18
```
Output: `c08dfc95030eac973d563d67fbd5f80da9142cccc9f600476208227c6ff35db9`

Polling `pg_isready`: ready within 1 iteration.

```bash
DATABASE_URL=postgres://compass:compass-ci@localhost:55433/compass_ci npm run db:migrate -w apps/api
```
```
> @compass/api@0.1.0 db:migrate
> node --env-file-if-exists=../../.env ../../node_modules/drizzle-kit/bin.cjs migrate

../../.env not found. Continuing without it.
No config path provided, using default 'drizzle.config.ts'
Reading config file '/work/personal/compass/apps/api/drizzle.config.ts'
Using 'pg' driver for database querying
[✓] migrations applied successfully!
```

```bash
DATABASE_URL=postgres://compass:compass-ci@localhost:55433/compass_ci node --test apps/api/src/modules/ingest/services/ingestions.test.ts
```
```
✔ retryIngestion: an ingestion owned by the calling user is enqueued with jobId = ingestionId and data = { ingestionId } (31.447411ms)
✔ retryIngestion: an ingestion belonging to a different user 404s and never reaches the queue (9.28979ms)
✔ retryIngestion: a nonexistent ingestion id 404s (4.265782ms)
✔ retryIngestion: an ingestion that is not currently failed is rejected (409) and never reaches the queue (5.779638ms)
✔ retryIngestion: a retained failed job is removed before a fresh job is added (jobId-dedupe guard) (6.010378ms)
ℹ tests 5
ℹ suites 0
ℹ pass 5
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 459.193063
```

```bash
docker rm -f compass-fix2-pg
```
Output: `compass-fix2-pg`

### 6. `git status` and `git diff --stat`
```
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
	tasks/events-retry-tree/

no changes added to commit (use "git add" and/or "git commit -a")
 .claude/agents/dsh-worker.md                    |  4 +--
 apps/api/src/app.test.ts                        |  2 +-
 apps/api/src/jobs/index.ts                      | 13 ++++++--
 apps/api/src/modules/ingest/routes/mailboxes.ts | 13 ++++++++
 apps/api/src/route-surface.snapshot.txt         |  1 +
 apps/api/src/route-table.snapshot.txt           |  1 +
 apps/web/src/lib/ai-event-queries.ts            | 19 +++++++++--
 apps/web/src/routes/events/EventLogPage.tsx     | 43 ++++++++++++++++++++++---
 8 files changed, 84 insertions(+), 12 deletions(-)
```

Note on git status: The five fix-round files that appear as "Untracked" (`ingestions.ts`, `ingestions.test.ts`, `JsonTree.tsx`, `json-tree.ts`, `json-tree.test.ts`) were created by the prior feature implementation and have not yet been staged/committed. The other already-modified files (`.claude/agents/dsh-worker.md`, `apps/api/src/app.test.ts`, `apps/api/src/modules/ingest/routes/mailboxes.ts`, `apps/api/src/route-surface.snapshot.txt`, `apps/api/src/route-table.snapshot.txt`, `apps/web/src/lib/ai-event-queries.ts`) are pre-existing changes from the prior implementation and were not touched by this fix-round. This is consistent with the gitStatus snapshot at the top of the conversation which already showed `M .claude/agents/dsh-worker.md` as pre-existing.

## Assumptions
None beyond what the brief specifies.

## Unresolved Risks
None.
