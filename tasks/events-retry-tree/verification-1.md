# Verification Report: events-retry-tree feature

**Date:** 2026-08-26  
**Branch:** main  
**Verifier:** independent worker (no stake in implementation)  
**Brief type:** Verify (no edits made, nothing staged or committed)

---

## Step 1 — Repo state

### `git status --porcelain=v1`
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
```

### `git diff --stat`
```
.claude/agents/dsh-worker.md                    |  4 +--
 apps/api/src/app.test.ts                        |  2 +-
 apps/api/src/jobs/index.ts                      | 11 +++++--
 apps/api/src/modules/ingest/routes/mailboxes.ts | 13 +++++++++
 apps/api/src/route-surface.snapshot.txt         |  1 +
 apps/api/src/route-table.snapshot.txt           |  1 +
 apps/web/src/lib/ai-event-queries.ts            | 19 ++++++++++--
 apps/web/src/routes/events/EventLogPage.tsx     | 39 +++++++++++++++++++++----
 8 files changed, 78 insertions(+), 12 deletions(-)
```

### `git diff -- apps/api/src/app.test.ts` (lead's collateral fix)
```diff
diff --git a/apps/api/src/app.test.ts b/apps/api/src/app.test.ts
index 9d30176..bb5a558 100644
--- a/apps/api/src/app.test.ts
+++ b/apps/api/src/app.test.ts
@@ -59,7 +59,7 @@ test("registerLedgerCacheSubscriber: ledger.mutated invalidates the user's cache
   const eventBus = new EventBus({ error: () => {} });
 
   app.decorate("redis", redis);
-  app.decorate("queues", { system: alerts, alerts, ingestor: alerts });
+  app.decorate("queues", { system: alerts, alerts, ingestor: alerts, extract: alerts });
   app.decorate("eventBus", eventBus);
 
   t.after(async () => {
```

The lead's claimed single-line collateral fix is confirmed exactly as described.

---

## Step 2 — Files read

### `apps/api/src/jobs/index.ts` (diff)
```diff
-import { INGESTOR_QUEUE } from "@compass/shared";
+import { EXTRACT_QUEUE, INGESTOR_QUEUE } from "@compass/shared";

+  /** producer for the extractor "reprocess this ingestion" retry; consumed by apps/extractor */
+  extract: Queue;

+  const extract = new Queue(EXTRACT_QUEUE, { connection });
+  extract.on("error", (err) => app.log.error({ err }, "bullmq extract queue error"));

-  app.decorate("queues", { system, alerts, ingestor });
+  app.decorate("queues", { system, alerts, ingestor, extract });
```

Checked: `EXTRACT_QUEUE` is imported from `@compass/shared`. The `extract` queue is producer-only (no worker created in this process, consistent with comment "the extractor container runs the worker for this queue"). The `Queues` interface updated, `app.decorate` call updated. Consistent with app.test.ts fix.

### `apps/api/src/modules/ingest/services/ingestions.ts` (new)
Full file reviewed. Key observations:
- Ownership check via `and(eq(emailIngestions.id, ingestionId), eq(emailIngestions.userId, userId))` — correct user-scoping.
- `HttpError(404, ...)` on missing row — consistent with repo convention.
- Deduplication guard: calls `queue.getJob(ingestionId)`, removes if state === "failed", then adds. Exactly mirrors ingestor's own `enqueue()`.
- BullMQ options: `jobId: ingestionId, removeOnComplete: true, removeOnFail: 500, attempts: 3, backoff: { type: "exponential", delay: 5000 }` — identical to ingestor (see Step 6).
- Job name: `"extract"` — matches ingestor.
- No issues found.

### `apps/api/src/modules/ingest/services/ingestions.test.ts` (new)
Full file reviewed. Key observations:
- Uses real Postgres (requires DATABASE_URL), no DB mocking — consistent with repo convention noted in comments.
- `FakeQueue` covers only the two Queue methods the service calls (`getJob`, `add`) — minimal fake, appropriate.
- 4 tests: ownership success path, cross-user 404, nonexistent-id 404, dedup-guard ordering (remove before add). Covers all key semantics.
- Cleanup via `t.after()` with explicit user+ingestion deletion — proper resource management.
- No issues found.

### `apps/api/src/modules/ingest/routes/mailboxes.ts` (diff)
```diff
+import { retryIngestion } from "../services/ingestions.ts";
+
+  r.post(
+    "/api/mailboxes/ingestions/:id/retry",
+    { schema: { params: z.object({ id: z.uuid() }), response: { 200: z.object({ ok: z.literal(true) }) } } },
+    async (req) => {
+      await retryIngestion(app.db, app.queues.extract, req.session!.userId, req.params.id);
+      return { ok: true as const };
+    },
+  );
```

Checked: uses `app.queues.extract` (new field), `req.session!.userId` (correct user-scoping), `z.uuid()` validation on `:id`. Auth is handled at the plugin level (not per-route), consistent with other routes in this file. No response schema mismatch.

### `apps/api/src/route-surface.snapshot.txt` (diff)
```diff
+POST /api/mailboxes/ingestions/:id/retry
```
Added between `/api/mailboxes/:id/reset-watermark` and `/api/mailboxes/sync` (alphabetical order maintained). Consistent with the new route.

### `apps/api/src/route-table.snapshot.txt` (diff)
```diff
+│   ├── /ingestions/:id/retry (POST)
```
Added under `/api/mailboxes`. Consistent.

### `apps/web/src/lib/ai-event-queries.ts` (diff)
```diff
+import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
+import { z } from "zod";
+import { apiGet, apiPost } from "./api.ts";

+export function useRetryIngestion() {
+  const qc = useQueryClient();
+  return useMutation({
+    mutationFn: (ingestionId: string) =>
+      apiPost(`/api/mailboxes/ingestions/${ingestionId}/retry`, z.object({ ok: z.literal(true) })),
+    onSuccess: () => {
+      setTimeout(() => void qc.invalidateQueries({ queryKey: ["ai-events"] }), 8000);
+    },
+  });
+}
```

Checked: URL matches the new API route. 8-second delayed invalidation is consistent with comment and mailbox-queries.ts pattern. `z.object({ ok: z.literal(true) })` matches the route's response schema. No issues found.

### `apps/web/src/components/json-tree.ts` (new)
Full file reviewed. Pure logic, no React imports. `tryParseJson`, `isTreeable`, `isExpandedByDefault`, `DEFAULT_EXPAND_DEPTH = 3`. All functions are exported and tested. No issues.

### `apps/web/src/components/json-tree.test.ts` (new)
Full file reviewed. 10 tests covering all 4 exported symbols. Checks edge cases: empty string, malformed JSON, trailing comma, null vs object, depth boundary at 3. No issues.

### `apps/web/src/components/JsonTree.tsx` (new)
Full file reviewed. Uses `useState`, `isExpandedByDefault` from `./json-tree.ts`. Recursive `TreeNode` component handles objects/arrays (expandable) and primitives (inline). String truncation at 200 chars with title tooltip. Color coding by type. `JsonTree` wraps `TreeNode` at depth 0 with no label. No issues.

### `apps/web/src/routes/events/EventLogPage.tsx` (diff)
```diff
+import { useRetryIngestion } from "../../lib/ai-event-queries.ts";
+import { toast } from "../../lib/toast.tsx";
+import { tryParseJson, isTreeable } from "../../components/json-tree.ts";
+import { JsonTree } from "../../components/JsonTree.tsx";
```

Key changes:
- `EventRow` gets `useRetryIngestion()` hook; retry button only shown when `event.status === "error" && event.ingestionId !== null`.
- `<li>` restructured to flex row with the main button taking `min-w-0 flex-1` and retry button as `shrink-0` sibling.
- `Block` component now renders `JsonTree` when `tryParseJson` + `isTreeable` succeed, else falls back to `<pre>`.
- Toast feedback on retry success/error.
- No issues found. The `canRetry` guard is conservative (only "error" status, not "pending" or "ok"), appropriate.

---

## Step 3 — Static checks

### `npm run typecheck`
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
Exit code: **0**

**RESULT: PASS**

### `npm run lint`
```
> compass@0.1.0 lint
> eslint .
```
Exit code: **0**

**RESULT: PASS**

---

## Step 4 — Hermetic tests (no DB)

### `node --test apps/api/src/app.route-snapshot.test.ts`
```
✔ canonical route surface ((method, path) pairs) matches the committed snapshot byte-for-byte — the real 'unchanged API surface' gate (101.777295ms)
✔ raw printRoutes() tree matches the committed snapshot byte-for-byte (46.776132ms)
✔ assertRouteTableMatches rejects an added route (0.185003ms)
✔ assertRouteTableMatches rejects a removed route (0.08948ms)
✔ assertRouteTableMatches rejects a renamed route (0.074822ms)
✔ assertRouteTableMatches rejects a method change (GET -> POST) (0.063721ms)
✔ assertRouteTableMatches accepts identical tables (0.125729ms)
ℹ tests 7
ℹ suites 0
ℹ pass 7
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1004.659605
```
Exit code: **0**

**RESULT: PASS**

### `node --test apps/web/src/components/json-tree.test.ts`
```
✔ tryParseJson: a valid object parses to its value (0.74528ms)
✔ tryParseJson: a valid array parses to its value (0.089361ms)
✔ tryParseJson: a valid bare primitive parses (ok true, value 42) (0.066868ms)
✔ tryParseJson: an empty string is not parseable (0.076846ms)
✔ tryParseJson: invalid text is not parseable (0.076696ms)
✔ tryParseJson: malformed JSON with a trailing comma is not parseable (0.079983ms)
✔ isTreeable: true for objects and arrays (0.06305ms)
✔ isTreeable: false for null, primitives, and booleans (0.05764ms)
✔ isExpandedByDefault: depths below DEFAULT_EXPAND_DEPTH start expanded (0.080283ms)
✔ isExpandedByDefault: depths at or beyond DEFAULT_EXPAND_DEPTH start collapsed (0.109829ms)
ℹ tests 10
ℹ suites 0
ℹ pass 10
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 64.563121
```
Exit code: **0**

**RESULT: PASS**

---

## Step 5 — Full suite with real Postgres + Redis

### Container setup
```
docker run -d --name compass-verify-pg -e POSTGRES_USER=compass -e POSTGRES_PASSWORD=compass-ci -e POSTGRES_DB=compass_ci -p 55432:5432 postgres:18
# EXIT:0

docker run -d --name compass-verify-redis -p 56379:6379 redis:7
# EXIT:0

# Health poll: Postgres ready after 1s; Redis ready after 1s
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
```
Exit code: **0**

**RESULT: PASS**

### `npm test` — workspace tallies
```
@compass/api:    pass 2150, fail 0, cancelled 0, skipped 1, duration_ms 16217.630668
@compass/extractor: pass 87, fail 0, cancelled 0, skipped 0, duration_ms 367.114397
@compass/ingestor:  pass 12, fail 0, cancelled 0, skipped 0, duration_ms 182.149354
@compass/web:    pass 372, fail 0, cancelled 0, skipped 0, duration_ms 787.147546
@compass/ai:     pass 120, fail 0, cancelled 0, skipped 0, duration_ms 901.52895
@compass/shared: pass 413, fail 0, cancelled 0, skipped 0, duration_ms 320.81866
```
Overall exit code: **0**

**RESULT: PASS**

### ingestions.test.ts specific output (within @compass/api run)
```
✔ retryIngestion: an ingestion owned by the calling user is enqueued with jobId = ingestionId and data = { ingestionId } (62.094124ms)
✔ retryIngestion: an ingestion belonging to a different user 404s and never reaches the queue (36.895046ms)
✔ retryIngestion: a nonexistent ingestion id 404s (20.894783ms)
✔ retryIngestion: a retained failed job is removed before a fresh job is added (jobId-dedupe guard) (24.805738ms)
```

All 4 new tests: **PASS**

### Container teardown
```
docker rm -f compass-verify-pg compass-verify-redis
# compass-verify-pg
# compass-verify-redis
# EXIT:0
```

---

## Step 6 — Enqueue options comparison

### `apps/ingestor/src/index.ts` `enqueue()` snippet
```typescript
async function enqueue(ingestionId: string): Promise<void> {
  const existing = await queue.getJob(ingestionId);
  if (existing !== undefined) {
    const state = await existing.getState();
    if (state === "failed") await existing.remove();
  }
  await queue.add(
    "extract",
    { ingestionId },
    {
      jobId: ingestionId,
      removeOnComplete: true,
      removeOnFail: 500,
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
    },
  );
}
```

### `apps/api/src/modules/ingest/services/ingestions.ts` `retryIngestion()` relevant snippet
```typescript
  const existing = await queue.getJob(ingestionId);
  if (existing !== undefined) {
    const state = await existing.getState();
    if (state === "failed") await existing.remove();
  }
  await queue.add(
    "extract",
    { ingestionId },
    {
      jobId: ingestionId,
      removeOnComplete: true,
      removeOnFail: 500,
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
    },
  );
```

**Match assessment: IDENTICAL.** Every BullMQ option matches exactly:
- `jobId`: `ingestionId` ✓
- `removeOnComplete`: `true` ✓
- `removeOnFail`: `500` ✓
- `attempts`: `3` ✓
- `backoff`: `{ type: "exponential", delay: 5000 }` ✓
- Job name: `"extract"` ✓
- Data payload: `{ ingestionId }` ✓
- Dedup guard logic (getJob → getState === "failed" → remove first): identical pattern ✓

---

## Summary

| Check | Result |
|---|---|
| typecheck | PASS (exit 0, all 7 workspaces clean) |
| lint | PASS (exit 0, no violations) |
| route-snapshot test | PASS (7/7, exit 0) |
| json-tree test | PASS (10/10, exit 0) |
| db:migrate | PASS (exit 0) |
| full `npm test` | PASS (exit 0; 2150+87+12+372+120+413 = 3254 tests, 0 failures, 1 skip unrelated to this feature) |
| ingestions.test.ts specifically | PASS (4/4 new tests) |
| enqueue options comparison | MATCH — all BullMQ job options are byte-for-byte identical between ingestor's enqueue() and retryIngestion() |

No issues found. No unresolved risks observed. The lead's collateral fix (adding `extract: alerts` to the app.test.ts queues test double) is confirmed accurate and necessary — without it, the Queues interface would not typecheck with the test double missing the new `extract` field.
