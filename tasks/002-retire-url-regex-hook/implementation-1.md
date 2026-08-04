# Implementation report — 002-retire-url-regex-hook (iteration 1)

## Files inspected
- `tasks/002-retire-url-regex-hook/TASK.md`
- `tasks/002-retire-url-regex-hook/DELEGATION.md`
- `apps/api/src/app.ts`
- `apps/api/src/lib/event-bus.ts`
- `apps/api/src/routes/transactions.ts`
- `apps/api/src/routes/transfers.ts`
- `apps/api/src/routes/imports.ts`
- `apps/api/src/routes/inbox.ts`
- `apps/api/src/routes/recurring.ts`
- `apps/api/src/jobs/index.ts`
- `apps/api/src/services/cache.ts`
- `apps/api/src/routes/user-tasks.route.test.ts` (test convention reference)
- `apps/api/src/config.ts`
- `apps/api/src/infra/redis.ts`
- `apps/api/src/db/schema.ts` (accounts/account_type enum, for test fixtures)
- `packages/shared/src/schemas/ledger.ts` (`CreateTransactionSchema`, for test fixtures)
- `apps/api/.env` / root `.env` (DATABASE_URL/REDIS_URL/SESSION_SECRET, for env-gated tests)
- `apps/api/package.json`, root `package.json` (test script wiring)
- `node_modules/bullmq/dist/esm/classes/queue-getters.d.ts` (`Queue.getJob`/`getJobs` signatures)

## Files changed
1. `apps/api/src/app.ts` — deleted the `onResponse` regex hook; added exported `registerLedgerCacheSubscriber(app)`, called right after `app.decorate("eventBus", eventBus)` and before `await startJobs(app)`.
2. `apps/api/src/routes/transactions.ts` — added `ledger.mutated` emits after `POST /api/transactions`, `PATCH /api/transactions/:id`, `DELETE /api/transactions/:id`, `PUT /api/transactions/:id/splits`, `POST /api/transactions/bulk`.
3. `apps/api/src/routes/transfers.ts` — added emits after `POST /api/transfers`, `POST /api/transfers/record`, `DELETE /api/transfers/:id`.
4. `apps/api/src/routes/imports.ts` — added emits after `POST /api/imports/:id/commit` and `POST /api/imports/:id/rollback` only.
5. `apps/api/src/routes/inbox.ts` — added emits after `POST /api/inbox/:id/accept`, `POST /api/inbox/:id/repayment`, `POST /api/inbox/transfer` only.
6. `apps/api/src/routes/recurring.ts` — converted `materializeNow`'s direct `invalidateUserCache`/`enqueueBudgetEvaluation` calls (both branches) to `app.eventBus.emit("ledger.mutated", ...)`; added an emit to `DELETE /api/recurring/:id`; removed the now-unused direct imports of `invalidateUserCache`/`enqueueBudgetEvaluation`.
7. `apps/api/src/jobs/index.ts` — converted the two direct-call sites (`recurring.materialize` worker handler, boot-catchup) to `app.eventBus.emit("ledger.mutated", { userId })`; removed the now-unused `invalidateUserCache` import. `enqueueBudgetEvaluation`'s own definition is untouched.

## Files created
1. `apps/api/src/app.test.ts` — P8a: unit test of the exported `registerLedgerCacheSubscriber` against a real, minimally-decorated Fastify instance (real `redis`, a real BullMQ `Queue("alerts", ...)`, a real `EventBus`), asserting both subscriber effects via bounded polling.
2. `apps/api/src/routes/ledger-events.route.test.ts` — P8b/P8c: a `buildTestApp()`-style route-injection test (real Postgres/Redis, `setupAuth`/`setupSecurity`, `transactionRoutes` only, no `startJobs`) proving `POST /api/transactions` emits `ledger.mutated` on success (P8b) and emits nothing on a 400 (P8c), via a real `EventBus.on()` observer and bounded polling/quiet-period waits.

## Implementation details
- **P1** (`app.ts`): `registerLedgerCacheSubscriber(app: FastifyInstance): void` does `app.eventBus.on("ledger.mutated", async ({ userId }) => { await invalidateUserCache(app.redis, userId); await enqueueBudgetEvaluation(app, userId); })` — same functions, same order as the old hook. Called immediately after `app.decorate("eventBus", eventBus)`, before `await startJobs(app)`. The old `onResponse` hook block (URL regex + method/status/session guards) was deleted entirely. One deviation worth flagging: my first draft's doc comment on `registerLedgerCacheSubscriber` used the literal word `` `onResponse` `` inside a comment, which made T4's `rg -n "onResponse" apps/api/src/app.ts"` produce a (harmless, comment-only) match. I reworded the comment to say "the old URL-regex request hook" instead, re-ran T4, and confirmed zero output. No functional code was affected by this correction — see Deviations below.
- **P2–P5** (transactions/transfers/imports/inbox routes): each targeted handler now stores the awaited service result in a local variable, calls `app.eventBus.emit("ledger.mutated", { userId: req.session!.userId })`, then returns/sends the stored result — emission happens only after success, never on a thrown error (an exception from the service call skips the emit line entirely since it's a normal `await` that would throw before reaching the `emit` line). Untouched, per the deliberate narrowing: `imports.ts`'s staging upload/mapping/row-edit/delete-uncommitted handlers, and `inbox.ts`'s reject/restore/unmatch handlers.
- **P6** (`recurring.ts`): `materializeNow`'s loop-over-`res.userIds` branch and its `else` (single-user) branch both now call `app.eventBus.emit("ledger.mutated", { userId })` instead of directly awaiting `invalidateUserCache`/`enqueueBudgetEvaluation`. `DELETE /api/recurring/:id` (`deleteTemplate` handler) gained a new emit after the delete succeeds — this was the Codex-review correction (template deletion changes `getForecast()`'s `cached()` output via `cashflow.ts`'s direct read of `recurringTemplates`). The now-unused `invalidateUserCache`/`enqueueBudgetEvaluation` imports were removed from this file.
- **P7** (`jobs/index.ts`): the `recurring.materialize` BullMQ worker handler and the boot-catchup block both iterate their respective `userIds` array and call `app.eventBus.emit("ledger.mutated", { userId })` per user, replacing the direct `invalidateUserCache`/`enqueueBudgetEvaluation` await pairs. `enqueueBudgetEvaluation`'s own exported function definition (debounce logic, jobId scheme) is untouched — confirmed by diff and by grep (only the definition line remains in the file).
- **P8a** (`apps/api/src/app.test.ts`): builds `Fastify({ logger: false })`, decorates real `redis` (`createRedis(config.REDIS_URL)`), a real `Queue("alerts", { connection })` mirroring `jobs/index.ts`'s exact connection construction (assigned to all three fields of the `Queues` interface since only `.alerts` is exercised), and a real `EventBus`. Calls `registerLedgerCacheSubscriber(app)`, emits `ledger.mutated`, then bounded-polls (up to 500ms, 10ms interval) `cachever:<userId>` in Redis for a change from baseline, and separately bounded-polls the alerts queue for a job whose id matches the expected `eval-${userId}-${bucket}` scheme — checking every 5-second bucket the emit could have landed in between the `emit()` call and the observed cache-version change (to avoid a bucket-boundary false negative), via `queue.getJob(jobId)`. Both effects are asserted, plus the job's `data.userId`.
- **P8b/P8c** (`apps/api/src/routes/ledger-events.route.test.ts`): follows `user-tasks.route.test.ts`'s `buildTestApp()` convention exactly (real Postgres/Redis, `setupAuth`/`setupSecurity`, no `startJobs`/`buildApp`), registering only `transactionRoutes` and a real `EventBus`. P8b subscribes via the public `app.eventBus.on(...)` API, `POST`s a valid transaction, asserts 201, then bounded-polls the observer's array for an entry with the expected `userId`. P8c posts a malformed body (missing `accountId`, `amountPaise: 0` which fails the `CreateTransactionSchema` refine), asserts 400, waits out the same 500ms quiet period, and asserts the observer recorded nothing **and** that `cachever:<userId>` was never set.
- **P8d**: confirmed by direct read of `apps/api/src/app.ts` (reproduced in full below) and by the `rg -n "onResponse" apps/api/src/app.ts` command — no output.

## Commands run (from `/home/udai/PennyPilot`)

### 1. `npm run typecheck`
Exit code: `0`
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
(Run twice — once before and once after the T4 comment-wording fix; both runs exit 0 with identical output.)

### 2. `npm run lint`
Exit code: `1`
```
> compass@0.1.0 lint
> eslint .


/home/udai/PennyPilot/scripts/tasks-to-issues.mjs
   24:14  error  'process' is not defined  no-undef
  110:15  error  'console' is not defined  no-undef
  110:58  error  'process' is not defined  no-undef
  111:5   error  'console' is not defined  no-undef
  112:5   error  'console' is not defined  no-undef
  113:5   error  'console' is not defined  no-undef
  114:5   error  'console' is not defined  no-undef
  116:5   error  'console' is not defined  no-undef
  117:5   error  'console' is not defined  no-undef
  118:5   error  'console' is not defined  no-undef
  119:5   error  'console' is not defined  no-undef
  120:28  error  'console' is not defined  no-undef
  122:3   error  'process' is not defined  no-undef
  149:61  error  'console' is not defined  no-undef
  154:3   error  'console' is not defined  no-undef
  164:1   error  'console' is not defined  no-undef

✖ 16 problems (16 errors, 0 warnings)
```
**This failure is pre-existing and unrelated to this task**: `scripts/tasks-to-issues.mjs` is an **untracked** file (`git status --porcelain scripts/tasks-to-issues.mjs` → `?? scripts/tasks-to-issues.mjs`), not created or touched by this change, and outside every file named in the delegation's scope. To isolate my own changes I additionally ran:
```
npx eslint apps/api/src/app.ts apps/api/src/app.test.ts apps/api/src/jobs/index.ts apps/api/src/routes/imports.ts apps/api/src/routes/inbox.ts apps/api/src/routes/recurring.ts apps/api/src/routes/transactions.ts apps/api/src/routes/transfers.ts apps/api/src/routes/ledger-events.route.test.ts
```
Exit code: `0`, no output — every file this task touched/created is lint-clean. AC6 ("zero new failures") is satisfied; the one lint failure that exists is not new and not in scope.

### 3. `npm run test -w apps/api`
Ran with `DATABASE_URL`/`REDIS_URL`/`SESSION_SECRET` exported from the repo's own `.env` (both Postgres and Redis at `192.168.2.196` were reachable — verified with a raw TCP check before running: `postgres reachable`, `redis reachable`).

Command:
```
set -a && source .env && set +a && npm run test -w apps/api
```
Exit code: `0`
Tail of output (full 793-test run; head/earlier lines omitted here only because the full log exceeds a reasonable paste length — the run was not truncated, this is just an excerpt showing the final tally and the three new tests, all passing):
```
✔ registerLedgerCacheSubscriber: ledger.mutated invalidates the user's cache version and enqueues a debounced budget-eval job (187.477659ms)
...
✔ P8b: POST /api/transactions emits ledger.mutated with the requesting user's id (178.792701ms)
✔ P8c: POST /api/transactions with a malformed body (400) emits no ledger.mutated event (527.992241ms)
...
ℹ tests 793
ℹ suites 1
ℹ pass 793
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 5557.485077
```
Ran twice total (once immediately after the initial implementation, once again after the T4 comment-wording fix) — both runs: `793 pass, 0 fail, 0 cancelled, 0 skipped`, exit code `0`.

I **could** run this command (unlike the delegation's contingency for no live DB/Redis) — both were reachable, so no test coverage here is unverified.

### 4. `rg -n "onResponse" apps/api/src/app.ts`
Exit code: `1` (ripgrep's normal "no matches" exit code), no output — matches the expectation.

(Note: my first pass of this command, before the comment wording fix, returned one match — line 78, inside a doc comment that said `` `onResponse` hook `` — a comment-only false match, not the deleted hook code. I reworded the comment to remove the literal string and re-ran; the second run above is the corrected, final result.)

### 5. `rg -n 'invalidateUserCache\(|enqueueBudgetEvaluation\(' apps/api/src/routes/transactions.ts apps/api/src/routes/transfers.ts apps/api/src/routes/imports.ts apps/api/src/routes/inbox.ts apps/api/src/routes/recurring.ts`
Exit code: `1`, no output — matches the expectation.

### Additional manual verification of `jobs/index.ts` (per DELEGATION.md's note that a name-only grep on this file would always match its own `enqueueBudgetEvaluation` export)
```
grep -n "recurring.materialize\|boot.created\|invalidateUserCache\|enqueueBudgetEvaluation\|ledger.mutated" apps/api/src/jobs/index.ts
```
```
54:export async function enqueueBudgetEvaluation(app: FastifyInstance, userId: string): Promise<void> {
142:  "recurring.materialize",
172:    "recurring.materialize",
174:    { name: "recurring.materialize" },
244:        case "recurring.materialize": {
249:              app.eventBus.emit("ledger.mutated", { userId });
250:        }
372:  if (boot.created > 0) {
375:      app.eventBus.emit("ledger.mutated", { userId });
```
Confirms: the only remaining `enqueueBudgetEvaluation` reference in this file is its own `export async function` definition (line 54); both former call sites (`recurring.materialize` worker at line 249, boot-catchup at line 375) now emit `ledger.mutated` instead of calling `invalidateUserCache`/`enqueueBudgetEvaluation` directly.

### Confirmation that out-of-scope files were not touched
```
git status --porcelain apps/api/src/routes/budgets.ts apps/api/src/routes/sips.ts apps/api/src/routes/emis.ts apps/api/src/lib/event-bus.ts
```
Output: *(empty)* — none of these four files appear as modified/staged/untracked.
```
git diff --stat -- apps/api/
```
```
 apps/api/src/app.ts                 | 30 ++++++++++++++++++++----------
 apps/api/src/jobs/index.ts          |  7 ++-----
 apps/api/src/routes/imports.ts      | 12 ++++++++++--
 apps/api/src/routes/inbox.ts        | 18 +++++++++++++++---
 apps/api/src/routes/recurring.ts    | 10 +++++-----
 apps/api/src/routes/transactions.ts | 26 +++++++++++++++++++++-----
 apps/api/src/routes/transfers.ts    | 29 ++++++++++++++++-------------
 7 files changed, 89 insertions(+), 43 deletions(-)
```
Confirms exactly the 7 modified `apps/api` files named in the plan — `budgets.ts`, `sips.ts`, `emis.ts`, and `event-bus.ts` are absent from this list, i.e. **not modified**.

## Complete diffs

### `apps/api/src/app.ts`
```diff
diff --git a/apps/api/src/app.ts b/apps/api/src/app.ts
index 9959b80..f3c8532 100644
--- a/apps/api/src/app.ts
+++ b/apps/api/src/app.ts
@@ -72,6 +72,22 @@ declare module "fastify" {
   }
 }
 
+/**
+ * Write-through invalidation: any successful ledger mutation refreshes cached
+ * aggregates and queues a (debounced) budget evaluation. Replaces the old
+ * URL-regex request hook — callers now emit `ledger.mutated` explicitly from
+ * the route/job layer instead of this being inferred from `req.url`.
+ *
+ * Must be registered before `startJobs(app)` — boot-catchup emits during
+ * `startJobs`, and a subscriber registered after that would silently miss them.
+ */
+export function registerLedgerCacheSubscriber(app: FastifyInstance): void {
+  app.eventBus.on("ledger.mutated", async ({ userId }) => {
+    await invalidateUserCache(app.redis, userId);
+    await enqueueBudgetEvaluation(app, userId);
+  });
+}
+
 export async function buildApp(config: Config): Promise<FastifyInstance> {
   const app = Fastify({
     logger: {
@@ -98,6 +114,10 @@ export async function buildApp(config: Config): Promise<FastifyInstance> {
     error: (msg, ctx) => app.log.error(ctx ?? {}, msg),
   });
   app.decorate("eventBus", eventBus);
+  // Every ledger-writing route/job emits "ledger.mutated" explicitly now that
+  // there's no URL-based catch-all — new ledger-writing call sites must emit
+  // it themselves (see EventMap in lib/event-bus.ts).
+  registerLedgerCacheSubscriber(app);
 
   await startJobs(app);
   await setupAuth(app);
@@ -192,16 +212,6 @@ export async function buildApp(config: Config): Promise<FastifyInstance> {
   await app.register(resourceRoutes);
   await app.register(userTaskRoutes);
 
-  // write-through invalidation: any successful ledger write refreshes cached
-  // aggregates and queues a (debounced) budget evaluation
-  app.addHook("onResponse", async (req, reply) => {
-    if (req.method === "GET" || reply.statusCode >= 400 || !req.session) return;
-    if (/^\/api\/(transactions|transfers|imports|recurring|inbox)/.test(req.url)) {
-      await invalidateUserCache(app.redis, req.session.userId);
-      await enqueueBudgetEvaluation(app, req.session.userId);
-    }
-  });
-
   // Best-effort cleanup; in-flight microtask handlers may still reference closed resources.
   app.addHook("onClose", () => {
     app.eventBus.removeAll();
```

### `apps/api/src/jobs/index.ts`
```diff
diff --git a/apps/api/src/jobs/index.ts b/apps/api/src/jobs/index.ts
index d851318..a7d7cdc 100644
--- a/apps/api/src/jobs/index.ts
+++ b/apps/api/src/jobs/index.ts
@@ -16,7 +16,6 @@ import {
 import { createEncryptedBackup } from "../services/backup.ts";
 import { evaluateLargeTransactions, evaluateLowBalance, prefEnabled } from "../services/prefs.ts";
 import { materializeDue } from "../services/recurring.ts";
-import { invalidateUserCache } from "../services/cache.ts";
 
 export interface Queues {
   system: Queue;
@@ -247,8 +246,7 @@ export async function startJobs(app: FastifyInstance): Promise<void> {
           if (res.created > 0) {
             app.log.info(res, "materialized recurring transactions");
             for (const userId of res.userIds) {
-              await invalidateUserCache(app.redis, userId);
-              await enqueueBudgetEvaluation(app, userId);
+              app.eventBus.emit("ledger.mutated", { userId });
             }
           }
           return;
@@ -374,8 +372,7 @@ export async function startJobs(app: FastifyInstance): Promise<void> {
   if (boot.created > 0) {
     app.log.info(boot, "boot: materialized recurring transactions");
     for (const userId of boot.userIds) {
-      await invalidateUserCache(app.redis, userId);
-      await enqueueBudgetEvaluation(app, userId);
+      app.eventBus.emit("ledger.mutated", { userId });
     }
   }
   // catch up on bill reminders too (server may have been down at 00:20)
```

### `apps/api/src/routes/imports.ts`
```diff
diff --git a/apps/api/src/routes/imports.ts b/apps/api/src/routes/imports.ts
index e0c9b0e..e04ce54 100644
--- a/apps/api/src/routes/imports.ts
+++ b/apps/api/src/routes/imports.ts
@@ -107,13 +107,21 @@ export async function importRoutes(app: FastifyInstance) {
   r.post(
     "/api/imports/:id/commit",
     { schema: { params: IdParams, response: { 200: CommitResultSchema } } },
-    async (req) => commitImport(app.db, req.session!.userId, req.params.id),
+    async (req) => {
+      const result = await commitImport(app.db, req.session!.userId, req.params.id);
+      app.eventBus.emit("ledger.mutated", { userId: req.session!.userId });
+      return result;
+    },
   );
 
   r.post(
     "/api/imports/:id/rollback",
     { schema: { params: IdParams, response: { 200: z.object({ removed: z.number().int() }) } } },
-    async (req) => rollbackImport(app.db, req.session!.userId, req.params.id),
+    async (req) => {
+      const result = await rollbackImport(app.db, req.session!.userId, req.params.id);
+      app.eventBus.emit("ledger.mutated", { userId: req.session!.userId });
+      return result;
+    },
   );
 
   r.delete(
```

### `apps/api/src/routes/inbox.ts`
```diff
diff --git a/apps/api/src/routes/inbox.ts b/apps/api/src/routes/inbox.ts
index 13b02ae..7e268b0 100644
--- a/apps/api/src/routes/inbox.ts
+++ b/apps/api/src/routes/inbox.ts
@@ -59,7 +59,11 @@ export async function inboxRoutes(app: FastifyInstance) {
         response: { 200: ExtractedTransactionSchema },
       },
     },
-    async (req) => acceptExtracted(app.db, req.session!.userId, req.params.id, req.body),
+    async (req) => {
+      const result = await acceptExtracted(app.db, req.session!.userId, req.params.id, req.body);
+      app.eventBus.emit("ledger.mutated", { userId: req.session!.userId });
+      return result;
+    },
   );
 
   r.post(
@@ -71,7 +75,11 @@ export async function inboxRoutes(app: FastifyInstance) {
         response: { 200: ExtractedTransactionSchema },
       },
     },
-    async (req) => acceptRepayment(app.db, req.session!.userId, req.params.id, req.body),
+    async (req) => {
+      const result = await acceptRepayment(app.db, req.session!.userId, req.params.id, req.body);
+      app.eventBus.emit("ledger.mutated", { userId: req.session!.userId });
+      return result;
+    },
   );
 
   r.post(
@@ -82,7 +90,11 @@ export async function inboxRoutes(app: FastifyInstance) {
         response: { 200: z.array(ExtractedTransactionSchema) },
       },
     },
-    async (req) => acceptTransfer(app.db, req.session!.userId, req.body),
+    async (req) => {
+      const result = await acceptTransfer(app.db, req.session!.userId, req.body);
+      app.eventBus.emit("ledger.mutated", { userId: req.session!.userId });
+      return result;
+    },
   );
 
   r.post(
```

### `apps/api/src/routes/recurring.ts`
```diff
diff --git a/apps/api/src/routes/recurring.ts b/apps/api/src/routes/recurring.ts
index 3e8fd15..4b2e832 100644
--- a/apps/api/src/routes/recurring.ts
+++ b/apps/api/src/routes/recurring.ts
@@ -13,8 +13,6 @@ import {
   materializeDue,
   updateTemplate,
 } from "../services/recurring.ts";
-import { invalidateUserCache } from "../services/cache.ts";
-import { enqueueBudgetEvaluation } from "../jobs/index.ts";
 
 const IdParams = z.object({ id: z.uuid() });
 
@@ -26,11 +24,10 @@ export async function recurringRoutes(app: FastifyInstance) {
     const res = await materializeDue(app.db);
     if (res.userIds.length > 0) {
       for (const uid of res.userIds) {
-        await invalidateUserCache(app.redis, uid);
-        await enqueueBudgetEvaluation(app, uid);
+        app.eventBus.emit("ledger.mutated", { userId: uid });
       }
     } else {
-      await invalidateUserCache(app.redis, userId);
+      app.eventBus.emit("ledger.mutated", { userId });
     }
   };
 
@@ -71,6 +68,9 @@ export async function recurringRoutes(app: FastifyInstance) {
     { schema: { params: IdParams, response: { 200: z.object({ ok: z.boolean() }) } } },
     async (req) => {
       await deleteTemplate(app.db, req.session!.userId, req.params.id);
+      // template deletion changes getForecast()'s cached() output (cashflow.ts
+      // reads recurringTemplates directly), so this must still invalidate.
+      app.eventBus.emit("ledger.mutated", { userId: req.session!.userId });
       return { ok: true };
     },
   );
```

### `apps/api/src/routes/transactions.ts`
```diff
diff --git a/apps/api/src/routes/transactions.ts b/apps/api/src/routes/transactions.ts
index 38ce104..f1c1683 100644
--- a/apps/api/src/routes/transactions.ts
+++ b/apps/api/src/routes/transactions.ts
@@ -44,8 +44,11 @@ export async function transactionRoutes(app: FastifyInstance) {
   r.post(
     "/api/transactions",
     { schema: { body: CreateTransactionSchema, response: { 201: TransactionSchema } } },
-    async (req, reply) =>
-      reply.code(201).send(await createTransaction(app.db, req.session!.userId, req.body)),
+    async (req, reply) => {
+      const txn = await createTransaction(app.db, req.session!.userId, req.body);
+      app.eventBus.emit("ledger.mutated", { userId: req.session!.userId });
+      return reply.code(201).send(txn);
+    },
   );
 
   // Records one plain income transaction directly on the chosen retirement
@@ -62,7 +65,11 @@ export async function transactionRoutes(app: FastifyInstance) {
     {
       schema: { params: IdParams, body: UpdateTransactionSchema, response: { 200: TransactionSchema } },
     },
-    async (req) => updateTransaction(app.db, req.session!.userId, req.params.id, req.body),
+    async (req) => {
+      const txn = await updateTransaction(app.db, req.session!.userId, req.params.id, req.body);
+      app.eventBus.emit("ledger.mutated", { userId: req.session!.userId });
+      return txn;
+    },
   );
 
   r.delete(
@@ -70,6 +77,7 @@ export async function transactionRoutes(app: FastifyInstance) {
     { schema: { params: IdParams, response: { 200: z.object({ ok: z.boolean() }) } } },
     async (req) => {
       await softDeleteTransaction(app.db, req.session!.userId, req.params.id);
+      app.eventBus.emit("ledger.mutated", { userId: req.session!.userId });
       return { ok: true };
     },
   );
@@ -77,12 +85,20 @@ export async function transactionRoutes(app: FastifyInstance) {
   r.put(
     "/api/transactions/:id/splits",
     { schema: { params: IdParams, body: SetSplitsSchema, response: { 200: TransactionSchema } } },
-    async (req) => setSplits(app.db, req.session!.userId, req.params.id, req.body.splits),
+    async (req) => {
+      const txn = await setSplits(app.db, req.session!.userId, req.params.id, req.body.splits);
+      app.eventBus.emit("ledger.mutated", { userId: req.session!.userId });
+      return txn;
+    },
   );
 
   r.post(
     "/api/transactions/bulk",
     { schema: { body: BulkActionSchema, response: { 200: BulkResultSchema } } },
-    async (req) => bulkAction(app.db, req.session!.userId, req.body),
+    async (req) => {
+      const result = await bulkAction(app.db, req.session!.userId, req.body);
+      app.eventBus.emit("ledger.mutated", { userId: req.session!.userId });
+      return result;
+    },
   );
 }
```

### `apps/api/src/routes/transfers.ts`
```diff
diff --git a/apps/api/src/routes/transfers.ts b/apps/api/src/routes/transfers.ts
index b4ea96e..0d5dfa9 100644
--- a/apps/api/src/routes/transfers.ts
+++ b/apps/api/src/routes/transfers.ts
@@ -21,17 +21,16 @@ export async function transferRoutes(app: FastifyInstance) {
   r.post(
     "/api/transfers",
     { schema: { body: CreateTransferLinkSchema, response: { 201: z.object({ id: z.uuid() }) } } },
-    async (req, reply) =>
-      reply
-        .code(201)
-        .send(
-          await linkTransfer(
-            app.db,
-            req.session!.userId,
-            req.body.outTransactionId,
-            req.body.inTransactionId,
-          ),
-        ),
+    async (req, reply) => {
+      const result = await linkTransfer(
+        app.db,
+        req.session!.userId,
+        req.body.outTransactionId,
+        req.body.inTransactionId,
+      );
+      app.eventBus.emit("ledger.mutated", { userId: req.session!.userId });
+      return reply.code(201).send(result);
+    },
   );
 
   // Distinct from POST /api/transfers, which links two transactions that already
@@ -39,8 +38,11 @@ export async function transferRoutes(app: FastifyInstance) {
   r.post(
     "/api/transfers/record",
     { schema: { body: CreateTransferSchema, response: { 201: TransferResultSchema } } },
-    async (req, reply) =>
-      reply.code(201).send(await createTransfer(app.db, req.session!.userId, req.body)),
+    async (req, reply) => {
+      const result = await createTransfer(app.db, req.session!.userId, req.body);
+      app.eventBus.emit("ledger.mutated", { userId: req.session!.userId });
+      return reply.code(201).send(result);
+    },
   );
 
   r.delete(
@@ -53,6 +55,7 @@ export async function transferRoutes(app: FastifyInstance) {
     },
     async (req) => {
       await unlinkTransfer(app.db, req.session!.userId, req.params.id);
+      app.eventBus.emit("ledger.mutated", { userId: req.session!.userId });
       return { ok: true };
     },
   );
```

## New file: `apps/api/src/app.test.ts` (full contents)
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import { Queue } from "bullmq";
import { loadConfig } from "./config.ts";
import { createRedis } from "./infra/redis.ts";
import { EventBus } from "./lib/event-bus.ts";
import { registerLedgerCacheSubscriber } from "./app.ts";

// Unit test of the exported `registerLedgerCacheSubscriber` wiring (task
// 002-retire-url-regex-hook, P8a) against a real, minimally-decorated Fastify
// instance — not a duck-typed fake object. `EventBus.emit()` is
// queueMicrotask-dispatched (see lib/event-bus.ts), so every assertion below
// is a bounded poll rather than an immediate check after `emit()`.
//
// Needs a real Redis connection (REDIS_URL) — plus DATABASE_URL/SESSION_SECRET
// so `loadConfig()` doesn't refuse to boot. Export them (see apps/api/.env)
// before running `npm run test -w apps/api`.

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `app.test.ts needs ${name} set (a real Redis-backed subscriber test) — ` +
        "export it (see apps/api/.env) before running `npm run test -w apps/api`.",
    );
  }
  return value;
}
requireEnv("DATABASE_URL");
requireEnv("REDIS_URL");
requireEnv("SESSION_SECRET");

/** Poll `check()` every `intervalMs` until it returns a truthy value, or give up after `timeoutMs`. */
async function pollUntil<T>(
  check: () => Promise<T>,
  isDone: (value: T) => boolean,
  timeoutMs = 500,
  intervalMs = 10,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: T;
  for (;;) {
    last = await check();
    if (isDone(last)) return last;
    if (Date.now() >= deadline) return last;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

test("registerLedgerCacheSubscriber: ledger.mutated invalidates the user's cache version and enqueues a debounced budget-eval job", async (t) => {
  const config = loadConfig();
  const app = Fastify({ logger: false });
  const redis = createRedis(config.REDIS_URL);
  // Mirror jobs/index.ts's exact BullMQ connection construction.
  const connection = { url: config.REDIS_URL, maxRetriesPerRequest: null };
  const alerts = new Queue("alerts", { connection });
  const eventBus = new EventBus({ error: () => {} });

  app.decorate("redis", redis);
  app.decorate("queues", { system: alerts, alerts, ingestor: alerts });
  app.decorate("eventBus", eventBus);

  t.after(async () => {
    await app.close();
    await alerts.close();
    redis.disconnect();
  });

  registerLedgerCacheSubscriber(app);

  const userId = randomUUID();
  const cacheKey = `cachever:${userId}`;
  const baseline = await redis.get(cacheKey);

  const beforeEmit = Date.now();
  app.eventBus.emit("ledger.mutated", { userId });

  // (a) cache-version bump — bounded poll, never assert immediately after emit().
  const afterVersion = await pollUntil(
    () => redis.get(cacheKey),
    (v) => v !== baseline,
  );
  assert.notEqual(
    afterVersion,
    baseline,
    `expected cachever:${userId} to change from its baseline (${String(baseline)}) after ledger.mutated`,
  );
  const afterEmit = Date.now();

  // (b) debounced budget-eval job actually enqueued — same 5s-bucket jobId
  // enqueueBudgetEvaluation computes. Check every bucket the emit could have
  // landed in between the emit call and the observed cache-version bump, so a
  // bucket boundary crossed mid-poll can't produce a false negative.
  const firstBucket = Math.floor(beforeEmit / 5000);
  const lastBucket = Math.floor(afterEmit / 5000);
  const candidateJobIds = Array.from(
    { length: lastBucket - firstBucket + 1 },
    (_, i) => `eval-${userId}-${firstBucket + i}`,
  );

  const foundJob = await pollUntil(
    async () => {
      for (const jobId of candidateJobIds) {
        const job = await alerts.getJob(jobId);
        if (job) return job;
      }
      return undefined;
    },
    (job) => job !== undefined,
  );
  assert.ok(
    foundJob,
    `expected the alerts queue to contain a debounced budget-eval job among ${candidateJobIds.join(", ")}`,
  );
  assert.equal((foundJob!.data as { userId: string }).userId, userId);
});
```

## New file: `apps/api/src/routes/ledger-events.route.test.ts` (full contents)
```ts
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import Fastify, { type FastifyInstance } from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { loadConfig } from "../config.ts";
import { createPool } from "../infra/db.ts";
import { createRedis } from "../infra/redis.ts";
import { createDb } from "../db/index.ts";
import { setupAuth, SESSION_COOKIE } from "../plugins/auth.ts";
import { setupSecurity } from "../plugins/security.ts";
import { transactionRoutes } from "./transactions.ts";
import { createSession, destroySession } from "../services/session.ts";
import { accounts, transactions, users } from "../db/schema.ts";
import { EventBus, type EventMap } from "../lib/event-bus.ts";

// Route-injection proof that transactionRoutes emits "ledger.mutated" itself
// (task 002-retire-url-regex-hook, P8b/P8c) — the replacement for the old
// URL-regex `onResponse` hook. This does NOT need `registerLedgerCacheSubscriber`
// or BullMQ: app.test.ts's subscriber-isolation test already proves the
// subscriber's own effects; this test's job is only to prove the route emits.
//
// Built the same way as user-tasks.route.test.ts — real Postgres/Redis,
// setupAuth/setupSecurity, no buildApp()/startJobs() (see that file's own
// comment for why: startJobs does unscoped global boot work and leaks an
// ingestor queue connection that keeps `node --test` alive).
//
// EventBus.emit() is queueMicrotask-dispatched (lib/event-bus.ts), so every
// assertion below is a bounded poll of the observer's recorded list, never an
// immediate check after the HTTP response returns.
//
// Needs a real Postgres + Redis connection (DATABASE_URL, REDIS_URL,
// SESSION_SECRET) — export them (see apps/api/.env) before running
// `npm run test -w apps/api`.

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `ledger-events.route.test.ts needs ${name} set (a real Postgres/Redis-backed app boot) — ` +
        "export it (see apps/api/.env) before running `npm run test -w apps/api`.",
    );
  }
  return value;
}
requireEnv("DATABASE_URL");
requireEnv("REDIS_URL");
requireEnv("SESSION_SECRET");

async function buildTestApp(): Promise<FastifyInstance> {
  const config = loadConfig();
  const app = Fastify({ logger: false, trustProxy: true });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate("config", config);
  app.decorate("pg", createPool(config.DATABASE_URL));
  app.decorate("db", createDb(app.pg));
  app.decorate("redis", createRedis(config.REDIS_URL));
  app.decorate("eventBus", new EventBus({ error: () => {} }));
  await setupAuth(app);
  await setupSecurity(app);
  await app.register(transactionRoutes);
  app.addHook("onClose", async () => {
    await app.pg.end();
    app.redis.disconnect();
  });
  return app;
}

const app = await buildTestApp();
after(async () => {
  await app.close();
});

async function createUser(): Promise<string> {
  const [u] = await app.db
    .insert(users)
    .values({
      email: `ledger-events-route-test-${randomUUID()}@example.invalid`,
      passwordHash: "x",
      displayName: "ledger-events.route.test.ts user",
    })
    .returning({ id: users.id });
  return u!.id;
}

async function cleanupUser(userId: string): Promise<void> {
  await app.db.delete(transactions).where(eq(transactions.userId, userId));
  await app.db.delete(accounts).where(eq(accounts.userId, userId));
  await app.db.delete(users).where(eq(users.id, userId));
}

async function createAccount(userId: string): Promise<string> {
  const [a] = await app.db
    .insert(accounts)
    .values({ userId, name: "Test account", type: "bank" })
    .returning({ id: accounts.id });
  return a!.id;
}

/** A `cookies` map for `app.inject()`, carrying a signed session cookie. */
function sessionCookie(sessionId: string): Record<string, string> {
  return { [SESSION_COOKIE]: app.signCookie(sessionId) };
}

type LedgerMutatedEntry = EventMap["ledger.mutated"];

/** Poll `observed` until it gains an entry, or give up after `timeoutMs`. */
async function pollForEntry(
  observed: LedgerMutatedEntry[],
  timeoutMs = 500,
  intervalMs = 10,
): Promise<LedgerMutatedEntry | undefined> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (observed.length > 0) return observed[0];
    if (Date.now() >= deadline) return undefined;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

/** Wait out a quiet period with no expectation of an entry appearing. */
async function waitQuietPeriod(ms = 500): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------- P8b: POST /api/transactions emits ledger.mutated ----------

test("P8b: POST /api/transactions emits ledger.mutated with the requesting user's id", async (t) => {
  const userId = await createUser();
  const sessionId = await createSession(app.redis, userId);
  const accountId = await createAccount(userId);
  const observed: LedgerMutatedEntry[] = [];
  const unsubscribe = app.eventBus.on("ledger.mutated", (payload) => {
    observed.push(payload);
  });
  t.after(async () => {
    unsubscribe();
    await destroySession(app.redis, sessionId);
    await cleanupUser(userId);
  });

  const res = await app.inject({
    method: "POST",
    url: "/api/transactions",
    cookies: sessionCookie(sessionId),
    payload: {
      accountId,
      date: "2026-01-05",
      amountPaise: -1500,
      merchant: "Test merchant",
    },
  });
  assert.equal(res.statusCode, 201);

  const entry = await pollForEntry(observed);
  assert.ok(entry, "expected a ledger.mutated event to have been observed");
  assert.equal(entry!.userId, userId);
});

// ---------- P8c: a failed (400) request emits nothing ----------

test("P8c: POST /api/transactions with a malformed body (400) emits no ledger.mutated event", async (t) => {
  const userId = await createUser();
  const sessionId = await createSession(app.redis, userId);
  const observed: LedgerMutatedEntry[] = [];
  const unsubscribe = app.eventBus.on("ledger.mutated", (payload) => {
    observed.push(payload);
  });
  t.after(async () => {
    unsubscribe();
    await destroySession(app.redis, sessionId);
    await cleanupUser(userId);
  });

  const res = await app.inject({
    method: "POST",
    url: "/api/transactions",
    cookies: sessionCookie(sessionId),
    // accountId missing, amountPaise zero — fails CreateTransactionSchema validation.
    payload: { date: "2026-01-05", amountPaise: 0, merchant: "Malformed" },
  });
  assert.equal(res.statusCode, 400);

  // Long enough to rule out "not yet delivered" rather than "never emitted" —
  // the same bounded window used by the positive case above.
  await waitQuietPeriod();
  assert.equal(observed.length, 0, "a 400 response must not have emitted ledger.mutated");

  const cacheVersion = await app.redis.get(`cachever:${userId}`);
  assert.equal(cacheVersion, null, "a failed request must not bump the user's cache version either");
});
```

## Assumptions
- Both the repo's dev Postgres (`192.168.2.196:5432`) and Redis (`192.168.2.196:6379/1`) were reachable in this environment (verified with a raw `/dev/tcp` check), so both new colocated test files' env-gated live-service requirements were satisfiable and actually executed (not skipped).
- The pre-existing `npm run lint` failure in `scripts/tasks-to-issues.mjs` is out of scope for this task (untracked file, not among the files/symbols named in the delegation) and is not a "new failure" per AC6 — I did not touch it.
- For P8a, decorating `app.queues` with the same real `Queue("alerts", ...)` instance for all three `Queues` interface fields (`system`/`alerts`/`ingestor`) was chosen over constructing three separate `Queue` objects, since only `.alerts` is exercised by `registerLedgerCacheSubscriber`/`enqueueBudgetEvaluation`, and the delegation only asked for "a real BullMQ `Queue("alerts", ...)` for `app.queues.alerts`" — not full parity with `jobs/index.ts`'s three distinct queues.
- Test cleanup (`t.after`) deletes the transactions/accounts/users rows and destroys sessions created by both new test files; I did not separately re-verify the database is byte-for-byte identical to its pre-test state beyond what the passing test run's own cleanup logic performs (same convention `user-tasks.route.test.ts` already uses).

## Deviations from the plan
- **One self-corrected deviation**: my first draft of `registerLedgerCacheSubscriber`'s doc comment in `app.ts` used the literal word `` `onResponse` `` when describing what it replaces. This caused T4's `rg -n "onResponse" apps/api/src/app.ts` to return a match (a comment, not the deleted hook). I reworded the comment (see the diff above — final text says "the old URL-regex request hook") and re-ran T4, `npm run typecheck`, `npx eslint apps/api/src/app.ts`, and the full `npm run test -w apps/api` suite again; all passed identically to before the wording change. No functional/architectural deviation from the approved plan — this was purely a doc-comment wording fix caught by the verification command itself, not a silent scope change.
- No other deviations. P1–P8 were implemented exactly as specified in DELEGATION.md, including the Codex-review correction (P6's `DELETE /api/recurring/:id` emit) and the explicit narrowing (imports staging/mapping/row-edit/delete-uncommitted and inbox reject/restore/unmatch emit nothing).

## Explicit confirmations
- `apps/api/src/routes/budgets.ts` — **not modified** (absent from `git status --porcelain` and `git diff --stat` output above).
- `apps/api/src/routes/sips.ts` — **not modified** (same evidence).
- `apps/api/src/routes/emis.ts` — **not modified** (same evidence).
- `apps/api/src/lib/event-bus.ts` — **not modified** (same evidence).
- No `EventMap` types beyond the existing `ledger.mutated` were added.
- No `services/*.ts` function signatures were changed; every emit call was added at the route (`routes/transactions.ts`, `transfers.ts`, `imports.ts`, `inbox.ts`, `recurring.ts`) or job (`jobs/index.ts`) layer only.
- `/api/epf-contributions` (`recordEpfContribution`) and the insurance premium-logging route were left untouched, per the Non-Goals section (pre-existing gap, not this task's problem).

## Unresolved risks
- The fire-and-forget behavior change (AC7) is architecturally accepted per TASK.md and was not additionally re-reviewed by Codex as part of this delegation run — DELEGATION.md's "Commands" section did not include a `codex-reviewer` invocation, so none was run. If a separate Codex review pass of this diff is wanted, it hasn't happened yet in this iteration.
- P8a's bucket-boundary handling (checking multiple candidate `jobId`s) reduces but does not entirely eliminate a theoretical, very-low-probability flake if the subscriber's `enqueueBudgetEvaluation` call happens to straddle a 5-second bucket boundary in a way not covered by the `[firstBucket, lastBucket]` range computed from `emit()`-time to observed-cache-bump-time; in two live runs against a real Redis this did not occur.
