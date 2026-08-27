# Verification 3 — Events Retry Tree (fix-round-3)

Verifier: independent re-run (did NOT write the code under test).
Date: 2026-08-26

---

## Step 1 — Repo State

```
git status --porcelain=v1
```

```
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
?? apps/web/src/routes/events/retry-eligibility.test.ts
?? apps/web/src/routes/events/retry-eligibility.ts
?? tasks/events-retry-tree/
```

```
git diff --stat
```

```
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

---

## Step 2 — Fix-Round-3 Changes: Confirmed/Not Confirmed

### Item 1 — retry-eligibility.ts: CONFIRMED

File exists at `apps/web/src/routes/events/retry-eligibility.ts`. Full content:

```typescript
import type { AiEventKind, AiEventSummary } from "@compass/shared";

/**
 * Only these kinds carry a replayable ingestion (the extractor re-reads the
 * retained raw email). `statement_summary` is deliberately excluded even
 * though it does carry an `ingestionId`: the extractor treats it as
 * best-effort (`extractStatementSummary(...).catch(() => null)` in
 * apps/extractor/src/index.ts) precisely so its failure never fails the
 * ingestion as a whole — so a failed statement_summary event's ingestion has
 * very often already finished as "extracted", not "failed", and the retry
 * endpoint enforces that same invariant server-side (409s on anything but a
 * failed ingestion). Offering Retry there would routinely show a button that
 * 409s. `email_extract`/`statement_parse` failures are NOT swallowed this
 * way — they propagate and fail the ingestion — so for those two kinds an
 * "error" event and a "failed" ingestion do reliably go together.
 */
const RETRYABLE_KINDS: ReadonlySet<AiEventKind> = new Set(["email_extract", "statement_parse"]);

export function isRetryableEvent(
  event: Pick<AiEventSummary, "status" | "ingestionId" | "kind">,
): boolean {
  return event.status === "error" && event.ingestionId !== null && RETRYABLE_KINDS.has(event.kind);
}
```

`RETRYABLE_KINDS` contains exactly `"email_extract"` and `"statement_parse"`. `"statement_summary"` is NOT present.

---

### Item 2 — retry-eligibility.test.ts: 6 tests — CONFIRMED

File exists at `apps/web/src/routes/events/retry-eligibility.test.ts`. Test names (6):

1. `isRetryableEvent: true for a failed email_extract event with an ingestionId`
2. `isRetryableEvent: true for a failed statement_parse event with an ingestionId`
3. `isRetryableEvent: false for statement_summary — best-effort failures don't fail the ingestion`
4. `isRetryableEvent: false for a kind with no replayable ingestion (e.g. shopping_parse), even with status error`
5. `isRetryableEvent: false when status is ok`
6. `isRetryableEvent: false when ingestionId is null`

---

### Item 3 — EventLogPage.tsx canRetry calls isRetryableEvent — CONFIRMED

From `apps/web/src/routes/events/EventLogPage.tsx`:

```
Line 8:  import { isRetryableEvent } from "./retry-eligibility.ts";
Line 112: const canRetry = isRetryableEvent(event);
Line 135: {canRetry && (
```

`canRetry` is assigned from `isRetryableEvent(event)` — not an inline kind-set check.

---

### Item 4 — useRetryIngestion schedules 3 invalidations at 5000/15000/40000ms — CONFIRMED

From `apps/web/src/lib/ai-event-queries.ts` (lines 35–47):

```typescript
// which has a caller-chosen window to wait out. Refresh a few times on a
// spread of delays instead of once, so a slower run still surfaces its
// outcome without the user having to reload the page.
onSuccess: () => {
  for (const delayMs of [5000, 15000, 40000]) {
    setTimeout(() => void qc.invalidateQueries({ queryKey: ["ai-events"] }), delayMs);
  }
},
```

Three delays: 5000, 15000, 40000 ms. No single 8000ms timer.

---

### Item 5 — ingestions.test.ts FakeQueue has getJobCalls and 409 test asserts it — CONFIRMED

From `apps/api/src/modules/ingest/services/ingestions.test.ts`:

```typescript
class FakeQueue {
  existing: { getState: () => Promise<string>; remove: () => Promise<void> } | undefined;
  calls: Array<{ jobId: string; data: { ingestionId: string }; opts: Record<string, unknown> }> =
    [];
  order: string[] = [];
  getJobCalls = 0;

  async getJob(_id: string) {
    this.getJobCalls += 1;
    return this.existing;
  }
  // ...
}
```

409 test (lines 152–167):

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
  assert.equal(
    fake.getJobCalls,
    0,
    "the 409 guard must reject before any queue interaction, not just before add()",
  );
});
```

Both `fake.calls.length === 0` AND `fake.getJobCalls === 0` are asserted in the 409 test.

---

### Item 6 — Snapshot files unchanged from fix-round-2 — CONFIRMED

`git diff` on the two snapshot files shows exactly one line added to each — the retry route added in fix-round-2 — and no additional changes from fix-round-3:

```diff
--- a/apps/api/src/route-surface.snapshot.txt
+++ b/apps/api/src/route-surface.snapshot.txt
@@ -409,6 +409,7 @@ POST /api/insurance/policies/:id/health-cards
 POST /api/mailboxes
 POST /api/mailboxes/:id/reset-watermark
+POST /api/mailboxes/ingestions/:id/retry
 POST /api/mailboxes/sync

--- a/apps/api/src/route-table.snapshot.txt
+++ b/apps/api/src/route-table.snapshot.txt
@@ -144,6 +144,7 @@
 ├── /api/mailboxes (GET, HEAD, POST)
 │   ├── /credentials (GET, HEAD)
 │   ├── /sync (POST)
+│   ├── /ingestions/:id/retry (POST)
 │   └── /:id (DELETE)
```

The diff is purely the fix-round-2 retry route addition. Fix-round-3 added no routes and did not touch the snapshot files further.

---

## Step 3 — Static + Hermetic Checks

### npm run typecheck

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

EXIT_CODE: 0
```

### npm run lint

```
> compass@0.1.0 lint
> eslint .

EXIT_CODE: 0
```

### npx prettier --check (12 files)

```
Checking formatting...
All matched files use Prettier code style!
EXIT_CODE: 0
```

### node --test apps/api/src/app.route-snapshot.test.ts

```
✔ canonical route surface ((method, path) pairs) matches the committed snapshot byte-for-byte — the real 'unchanged API surface' gate (103.548945ms)
✔ raw printRoutes() tree matches the committed snapshot byte-for-byte (47.054259ms)
✔ assertRouteTableMatches rejects an added route (0.187016ms)
✔ assertRouteTableMatches rejects a removed route (0.069843ms)
✔ assertRouteTableMatches rejects a renamed route (0.071857ms)
✔ assertRouteTableMatches rejects a method change (GET -> POST) (0.065475ms)
✔ assertRouteTableMatches accepts identical tables (0.099449ms)
ℹ tests 7
ℹ suites 0
ℹ pass 7
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1013.351234
EXIT_CODE: 0
```

### node --test apps/web/src/components/json-tree.test.ts

```
✔ tryParseJson: a valid object parses to its value (0.841884ms)
✔ tryParseJson: a valid array parses to its value (0.096233ms)
✔ tryParseJson: a valid bare primitive parses (ok true, value 42) (0.076336ms)
✔ tryParseJson: an empty string is not parseable (0.081465ms)
✔ tryParseJson: invalid text is not parseable (0.094009ms)
✔ tryParseJson: malformed JSON with a trailing comma is not parseable (0.084692ms)
✔ isTreeable: true for objects and arrays (0.075735ms)
✔ isTreeable: false for null, primitives, and booleans (0.070785ms)
✔ isExpandedByDefault: depths below DEFAULT_EXPAND_DEPTH start expanded (0.090182ms)
✔ isExpandedByDefault: depths at or beyond DEFAULT_EXPAND_DEPTH start collapsed (0.116272ms)
ℹ tests 10
ℹ suites 0
ℹ pass 10
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 65.513458
EXIT_CODE: 0
```

### node --test apps/web/src/routes/events/retry-eligibility.test.ts

```
✔ isRetryableEvent: true for a failed email_extract event with an ingestionId (0.465367ms)
✔ isRetryableEvent: true for a failed statement_parse event with an ingestionId (0.087507ms)
✔ isRetryableEvent: false for statement_summary — best-effort failures don't fail the ingestion (0.070344ms)
✔ isRetryableEvent: false for a kind with no replayable ingestion (e.g. shopping_parse), even with status error (0.07336ms)
✔ isRetryableEvent: false when status is ok (0.083109ms)
✔ isRetryableEvent: false when ingestionId is null (0.072809ms)
ℹ tests 6
ℹ suites 0
ℹ pass 6
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 65.413528
EXIT_CODE: 0
```

---

## Step 4 — Full Suite (Postgres + Redis)

### db:migrate output

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
DB_MIGRATE_EXIT: 0
```

### npm test — workspace tallies

| Workspace | tests | pass | fail | skipped |
|-----------|-------|------|------|---------|
| @compass/api | 2152 | 2151 | 0 | 1 |
| @compass/extractor | 87 | 87 | 0 | 0 |
| @compass/ingestor | 12 | 12 | 0 | 0 |
| @compass/ai | 378 | 378 | 0 | 0 |
| @compass/web | 120 | 120 | 0 | 0 |
| @compass/shared | 413 | 413 | 0 | 0 |

The 1 skipped test in @compass/api is the MinIO contract test in `lib/storage.test.ts` — intentionally skipped unless `RUN_STORAGE_CONTRACT_TEST=1` is set (this skip is pre-existing in the baseline, not introduced by fix-round-3).

### ingestions.test.ts — 5/5 tests (including strengthened 409 test)

```
✔ retryIngestion: an ingestion owned by the calling user is enqueued with jobId = ingestionId and data = { ingestionId } (56.594446ms)
✔ retryIngestion: an ingestion belonging to a different user 404s and never reaches the queue (27.085353ms)
✔ retryIngestion: a nonexistent ingestion id 404s (7.429533ms)
✔ retryIngestion: an ingestion that is not currently failed is rejected (409) and never reaches the queue (15.385609ms)
✔ retryIngestion: a retained failed job is removed before a fresh job is added (jobId-dedupe guard) (11.040236ms)
```

### retry-eligibility.test.ts — 6/6 tests

```
✔ isRetryableEvent: true for a failed email_extract event with an ingestionId (0.637956ms)
✔ isRetryableEvent: true for a failed statement_parse event with an ingestionId (0.104599ms)
✔ isRetryableEvent: false for statement_summary — best-effort failures don't fail the ingestion (0.087056ms)
✔ isRetryableEvent: false for a kind with no replayable ingestion (e.g. shopping_parse), even with status error (0.090011ms)
✔ isRetryableEvent: false when status is ok (0.108727ms)
✔ isRetryableEvent: false when ingestionId is null (0.082968ms)
```

### Overall exit code

```
NPM_TEST_EXIT: 0
```

---

## Final Verdict

| Check | Result |
|-------|--------|
| Item 1: retry-eligibility.ts exists, exports isRetryableEvent, RETRYABLE_KINDS = {email_extract, statement_parse} | CONFIRMED |
| Item 2: retry-eligibility.test.ts exists with 6 named tests | CONFIRMED |
| Item 3: EventLogPage.tsx canRetry calls isRetryableEvent(event) | CONFIRMED |
| Item 4: useRetryIngestion schedules invalidation at 5000/15000/40000ms | CONFIRMED |
| Item 5: FakeQueue.getJobCalls counter present; 409 test asserts getJobCalls === 0 | CONFIRMED |
| Item 6: Snapshot files unchanged from fix-round-2 (no fix-round-3 additions) | CONFIRMED |
| npm run typecheck | PASS (exit 0) |
| npm run lint | PASS (exit 0) |
| npx prettier --check (12 files) | PASS (exit 0) |
| node --test route-snapshot | PASS 7/7 (exit 0) |
| node --test json-tree.test.ts | PASS 10/10 (exit 0) |
| node --test retry-eligibility.test.ts | PASS 6/6 (exit 0) |
| npm run db:migrate | PASS (exit 0) |
| npm test (full suite) | PASS 0 fail, 1 expected skip (exit 0) |
| ingestions.test.ts 5/5 including strengthened 409 | PASS |
| retry-eligibility.test.ts 6/6 | PASS |

**Overall: PASS**
