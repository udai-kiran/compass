# Verification-2 Report — events-retry-tree feature

Verified independently from scratch. No prior report consulted. All findings are
from direct source inspection and live command runs in this session.

Date: 2026-08-26

---

## Step 1 — Repo state

```
$ git status --porcelain=v1
 M .claude/agents/dsh-worker.md
 M apps/api/src/app.test.ts
 M apps/api/src/jobs/index.ts
 M apps/api/src/modules/ingest/routes/mailboxes.ts
 M apps/api/src/route-surface.snapshot.txt
 M apps/api/src/route-table.snapshot.txt
 M apps/web/src/lib/ai-event-queries.ts
 M apps/web/src/routes/events/EventLogPage.tsx
?? AGENTS.md
?? apps/api/src/modules/ingest/services/ingestions.test.ts
?? apps/api/src/modules/ingest/services/ingestions.ts
?? apps/web/src/components/JsonTree.tsx
?? apps/web/src/components/json-tree.test.ts
?? apps/web/src/components/json-tree.ts
?? tasks/events-retry-tree/

$ git diff --stat
 .claude/agents/dsh-worker.md                    |  4 +--
 apps/api/src/app.test.ts                        |  2 +-
 apps/api/src/jobs/index.ts                      | 13 ++++++--
 apps/api/src/modules/ingest/routes/mailboxes.ts | 13 ++++++++
 apps/api/src/route-surface.snapshot.txt         |  1 +
 apps/api/src/route-table.snapshot.txt           |  1 +
 apps/web/src/lib/ai-event-queries.ts            | 19 ++++++--
 apps/web/src/routes/events/EventLogPage.tsx     | 43 ++++++++++++++++++++++---
 8 files changed, 84 insertions(+), 12 deletions(-)
```

All new files (`ingestions.ts`, `ingestions.test.ts`, `JsonTree.tsx`, `json-tree.test.ts`,
`json-tree.ts`) are untracked (`??`) — correct since they are new files uncommitted in
this branch.

---

## Step 2 — Five specific fixes

### Fix 1 — `apps/api/src/modules/ingest/services/ingestions.ts`: `retryIngestion` selects `status`, 409-guards before queue

**CONFIRMED**

Exact lines from `ingestions.ts`:

```
  20   const [row] = await db
  21     .select({ id: emailIngestions.id, status: emailIngestions.status })
  22     .from(emailIngestions)
  23     .where(and(eq(emailIngestions.id, ingestionId), eq(emailIngestions.userId, userId)));
  24   if (!row) throw new HttpError(404, "Ingestion not found");
  25   if (row.status !== "failed") throw new HttpError(409, "Only a failed ingestion can be retried");
  26
  27   // A failed job retained under this jobId (removeOnFail: 500) would otherwise
  28   // make queue.add() a silent no-op via BullMQ's jobId dedupe — same guard as
  29   // the ingestor's own enqueue().
  30   const existing = await queue.getJob(ingestionId);
```

`status` is selected at line 21. The 409 is thrown at line 25, before `queue.getJob()` is
called at line 30. Guard is correctly placed before any queue interaction.

---

### Fix 2 — `apps/api/src/modules/ingest/services/ingestions.test.ts`: 409 test present, asserts `fake.calls.length === 0`

**CONFIRMED**

Exact test (lines 142–153):

```typescript
test("retryIngestion: an ingestion that is not currently failed is rejected (409) and never reaches the queue", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const ingestionId = await createIngestion(userId, "extracted");

  const fake = new FakeQueue();
  await assert.rejects(
    retryIngestion(db, asQueue(fake), userId, ingestionId),
    (e: unknown) => e instanceof HttpError && e.statusCode === 409,
  );
  assert.equal(fake.calls.length, 0);
});
```

The test creates an `"extracted"` ingestion (not `"failed"`), calls `retryIngestion`,
asserts it rejects with `HttpError 409`, and then asserts `fake.calls.length === 0`
(queue was never reached).

The file has 5 tests total (lines 99–165), all passing (confirmed in Step 4).

---

### Fix 3 — `apps/web/src/components/JsonTree.tsx`: primitives via `JSON.stringify`, `aria-expanded` on toggle button, no truncation, no `title`

**CONFIRMED**

Primitive rendering (lines 26–28):
```tsx
        <span className={`whitespace-pre-wrap break-words ${primitiveColor(value)}`}>
          {JSON.stringify(value)}
        </span>
```

Uses `JSON.stringify(value)` — correct quote/escape handling. No length-based truncation.
No `title` attribute on the `<span>`. Long strings wrap via `whitespace-pre-wrap break-words`.

Toggle button with `aria-expanded` (lines 50–54):
```tsx
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex items-center gap-1 py-0.5 pl-4 text-left hover:bg-slate-100"
      >
```

`aria-expanded={open}` is present on the toggle button.

---

### Fix 4 — `apps/api/src/jobs/index.ts`: `onClose` calls `.close()` on both `ingestor` and `extract` queues

**CONFIRMED**

Exact lines (436–443):
```typescript
  app.addHook("onClose", async () => {
    await systemWorker.close();
    await alertsWorker.close();
    await system.close();
    await alerts.close();
    await ingestor.close();
    await extract.close();
  });
```

Both `ingestor.close()` (line 441) and `extract.close()` (line 442) are called, in
addition to `systemWorker`, `alertsWorker`, `system`, and `alerts`.

---

### Fix 5 — `apps/web/src/routes/events/EventLogPage.tsx`: `canRetry` checks `kind`, retry mutation has no `onError`; `main.tsx` global `MutationCache` handler confirmed

**CONFIRMED**

`canRetry` definition (line 116):
```typescript
  const canRetry = event.status === "error" && event.ingestionId !== null && RETRYABLE_KINDS.has(event.kind);
```

`RETRYABLE_KINDS` is defined at lines 39:
```typescript
const RETRYABLE_KINDS: ReadonlySet<AiEventKind> = new Set(["email_extract", "statement_parse", "statement_summary"]);
```

So `canRetry` checks all three: `status === "error"`, `ingestionId !== null`, AND
`RETRYABLE_KINDS.has(event.kind)` — not just `ingestionId !== null`.

Retry mutation call (lines 139–143):
```tsx
          retry.mutate(event.ingestionId!, {
            onSuccess: () => toast("Retry queued — re-checking shortly", "success"),
          })
```

Only `onSuccess` callback is present — NO `onError` callback. This is deliberate.

Global `MutationCache` error handler in `apps/web/src/main.tsx` (confirmed via grep):
```
3:import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
6:import { toast, ToastProvider } from "./lib/toast.tsx";
137:  // 401s are handled by redirecting to /login — don't toast them.
139:  toast(err instanceof Error ? err.message : "Something went wrong");
144:  queryCache: new QueryCache({ onError: onApiError }),
145:  mutationCache: new MutationCache({ onError: onApiError }),
```

The global `MutationCache({ onError: onApiError })` at line 145 toasts every mutation
failure automatically, so the omission of `onError` in the per-call `retry.mutate()`
is deliberate and correct.

---

## Step 3 — Static + hermetic checks

### `npm run typecheck`

```
$ npm run typecheck
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

EXIT:0
```

All 7 workspaces: 0 errors. Exit code 0.

### `npm run lint`

```
$ npm run lint
> compass@0.1.0 lint
> eslint .

EXIT:0
```

No ESLint errors. Exit code 0.

### `node --test apps/api/src/app.route-snapshot.test.ts`

```
✔ canonical route surface ((method, path) pairs) matches the committed snapshot byte-for-byte — the real 'unchanged API surface' gate (108.351628ms)
✔ raw printRoutes() tree matches the committed snapshot byte-for-byte (49.590572ms)
✔ assertRouteTableMatches rejects an added route (0.193428ms)
✔ assertRouteTableMatches rejects a removed route (0.073169ms)
✔ assertRouteTableMatches rejects a renamed route (0.071817ms)
✔ assertRouteTableMatches rejects a method change (GET -> POST) (0.057419ms)
✔ assertRouteTableMatches accepts identical tables (0.103658ms)
ℹ tests 7
ℹ suites 0
ℹ pass 7
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1037.742257
EXIT:0
```

7/7 pass. Exit code 0.

### `node --test apps/web/src/components/json-tree.test.ts`

```
✔ tryParseJson: a valid object parses to its value (0.825083ms)
✔ tryParseJson: a valid array parses to its value (0.097366ms)
✔ tryParseJson: a valid bare primitive parses (ok true, value 42) (0.072107ms)
✔ tryParseJson: an empty string is not parseable (0.080834ms)
✔ tryParseJson: invalid text is not parseable (0.093368ms)
✔ tryParseJson: malformed JSON with a trailing comma is not parseable (0.073971ms)
✔ isTreeable: true for objects and arrays (0.090823ms)
✔ isTreeable: false for null, primitives, and booleans (0.074051ms)
✔ isExpandedByDefault: depths below DEFAULT_EXPAND_DEPTH start expanded (0.089401ms)
✔ isExpandedByDefault: depths at or beyond DEFAULT_EXPAND_DEPTH start collapsed (0.124146ms)
ℹ tests 10
ℹ suites 0
ℹ pass 10
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 68.330418
EXIT:0
```

10/10 pass. Exit code 0.

---

## Step 4 — Full suite with real Postgres + Redis

### Container start

```
docker run -d --name compass-final-pg -e POSTGRES_USER=compass -e POSTGRES_PASSWORD=compass-ci \
  -e POSTGRES_DB=compass_ci -p 55434:5432 postgres:18  → ec64fa66e6db483...
docker run -d --name compass-final-redis -p 56381:6379 redis:7  → b021f914d369cd...
# Both containers ready within 1 second (pg_isready and redis-cli PONG confirmed).
```

### `npm run db:migrate`

```
> compass@0.1.0 db:migrate
> npm run db:migrate -w apps/api

> @compass/api@0.1.0 db:migrate
> node --env-file-if-exists=../../.env ../../node_modules/drizzle-kit/bin.cjs migrate

../../.env not found. Continuing without it.
No config path provided, using default 'drizzle.config.ts'
Reading config file '/work/personal/compass/apps/api/drizzle.config.ts'
Using 'pg' driver for database querying
[✓] migrations applied successfully!
EXIT:0
```

### `npm test` — workspace tallies

```
@compass/api       — tests 2152 | pass 2151 | fail 0 | skipped 1 | duration_ms 15153
@compass/extractor — tests 87   | pass 87   | fail 0 | skipped 0 | duration_ms ~600
@compass/ingestor  — tests 12   | pass 12   | fail 0 | skipped 0
@compass/web       — tests 372  | pass 372  | fail 0 | skipped 0
@compass/ai        — tests 120  | pass 120  | fail 0 | skipped 0
@compass/shared    — tests 413  | pass 413  | fail 0 | skipped 0
EXIT:0
```

The 1 skipped test in `@compass/api` is pre-existing:
`apps/api/src/modules/ledger/services/reconcile-postings.test.ts:128`
→ `t.skip("requires a superuser DB role (session_replication_role) to forge an orphan posting")`
This is unrelated to the events-retry-tree feature.

### `apps/api/src/modules/ingest/services/ingestions.test.ts` — full block

```
../../.env not found. Continuing without it.
✔ retryIngestion: an ingestion owned by the calling user is enqueued with jobId = ingestionId and data = { ingestionId } (70.340251ms)
✔ retryIngestion: an ingestion belonging to a different user 404s and never reaches the queue (24.733203ms)
✔ retryIngestion: a nonexistent ingestion id 404s (7.062684ms)
✔ retryIngestion: an ingestion that is not currently failed is rejected (409) and never reaches the queue (19.347445ms)
✔ retryIngestion: a retained failed job is removed before a fresh job is added (jobId-dedupe guard) (14.357823ms)
```

5 tests, 5 passing, 0 failing. The new 409 test is present and green.

### Container cleanup

```
docker rm -f compass-final-pg compass-final-redis
compass-final-pg
compass-final-redis
```

---

## Step 5 — Happy-path regression check

The first test in `ingestions.test.ts` (lines 99–111):

```typescript
test("retryIngestion: an ingestion owned by the calling user is enqueued with jobId = ingestionId and data = { ingestionId }", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const ingestionId = await createIngestion(userId);   // default status = "failed"

  const fake = new FakeQueue();
  await retryIngestion(db, asQueue(fake), userId, ingestionId);

  assert.equal(fake.calls.length, 1);
  assert.equal(fake.calls[0]!.jobId, ingestionId);
  assert.deepEqual(fake.calls[0]!.data, { ingestionId });
  assert.equal(fake.calls[0]!.opts.removeOnFail, 500);
});
```

`createIngestion(userId)` defaults to `status: "failed"` (line 48), so this test exercises
the 409-safe legitimate path. It asserts `fake.calls.length === 1` (queue WAS reached),
`jobId === ingestionId`, `data === { ingestionId }`, and `removeOnFail === 500`.
It passes (confirmed in Step 4 output). The new 409 guard did not block the legitimate case.

---

## Verdict

| Check | Result |
|-------|--------|
| Fix 1: `ingestions.ts` selects `status`, 409 before queue | CONFIRMED |
| Fix 2: `ingestions.test.ts` 409 test + `fake.calls.length === 0` | CONFIRMED |
| Fix 3: `JsonTree.tsx` `JSON.stringify`, `aria-expanded`, no truncation/title | CONFIRMED |
| Fix 4: `jobs/index.ts` `onClose` closes both `ingestor` and `extract` | CONFIRMED |
| Fix 5: `EventLogPage.tsx` `canRetry` checks kind + no per-call `onError`; global `MutationCache` handler in `main.tsx` | CONFIRMED |
| `npm run typecheck` | PASS (exit 0) |
| `npm run lint` | PASS (exit 0) |
| `app.route-snapshot.test.ts` | PASS 7/7 (exit 0) |
| `json-tree.test.ts` | PASS 10/10 (exit 0) |
| `npm run db:migrate` | PASS (exit 0) |
| `npm test` (full suite, all workspaces) | PASS — 3156 pass, 0 fail, 1 pre-existing skip (exit 0) |
| Happy-path regression: "failed" ingestion still reaches queue | CONFIRMED |

**OVERALL VERDICT: PASS**

All 5 fixes are present and correct. All static checks and the full CI-equivalent test
suite pass cleanly. The pre-existing 1 skip in `@compass/api` is unrelated to this
feature. No regressions detected.
