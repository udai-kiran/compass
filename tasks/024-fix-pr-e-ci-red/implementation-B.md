# Worker B — Implementation Report (iteration 1)

## Files Inspected

- `apps/api/src/modules/credit/services/card-due-tasks.test.ts`
- `apps/api/src/modules/credit/services/reconciliation-writes.test.ts`
- `apps/api/src/modules/credit/services/emis.test.ts`
- `apps/api/src/modules/ledger/services/transactions.ts` (production `createTransaction` signature and dual-write shape)
- `apps/api/src/modules/ledger/services/postings.ts` (`buildOrdinaryPostings`, `PostingDraft`)
- `apps/api/src/modules/ledger/services/post-entry.ts` (`replacePostings`, `resolveSystemAccounts`, `seedSystemAccounts`)
- `apps/api/src/modules/credit/services/cards.ts` (postings-based queries at lines 229-237, 326-333, 342-349)
- `apps/api/src/modules/credit/services/reconciliation-reads.ts` (`ledgerDuesAtDates` at line 124-137)
- `apps/api/src/modules/credit/services/emis.ts` (postings INNER JOIN at lines 374-392)
- `apps/api/src/modules/ledger/services/user-tasks.ts` (TASK_LATERAL_QUERY at lines 84-107)
- `apps/api/src/modules/ledger/services/user-tasks.test.ts` (P5)
- `apps/api/src/modules/ledger/routes/user-tasks.route.test.ts` (P5)
- `apps/api/src/modules/ledger/services/reconcile-postings.test.ts` (P5)
- `apps/api/src/modules/system/services/backup.test.ts` (P5)
- `apps/api/src/modules/ingest/services/inbox.test.ts` (P5)
- `apps/api/src/modules/ledger/services/postings-pr-e-parity.test.ts` (P5 — confirmed uses `createTransaction`, no raw inserts)
- `apps/api/src/db/shared/ledger.ts` (postings table FK cascade)

## Files Changed

1. `apps/api/src/modules/credit/services/card-due-tasks.test.ts`
2. `apps/api/src/modules/credit/services/reconciliation-writes.test.ts`
3. `apps/api/src/modules/credit/services/emis.test.ts`

## Implementation Details

### Approach: `createTransaction` for all three helpers

Per the brief's directive (PREFER calling the real `createTransaction` service), all three fixture helpers were changed to call `createTransaction` from `apps/api/src/modules/ledger/services/transactions.ts`. This function:
1. Inserts the legacy `transactions` row
2. Calls `resolveSystemAccounts` (which calls `seedSystemAccounts` idempotently — creates 4 system accounts per user if absent)
3. Calls `buildOrdinaryPostings` to produce the real leg + counter leg
4. Calls `replacePostings` to insert both postings atomically in the same transaction

The full balanced posting family (real leg + system counter-leg) is therefore created automatically — no manual posting insert was needed. This satisfies D5b and avoids any drift from the production dual-write.

The `postings.transactionId` FK carries `onDelete: "cascade"` (confirmed at `db/shared/ledger.ts:138`), so existing `cleanupUser` functions (which delete transactions before accounts) cascade-delete postings with no change required.

### Per-file choice

**card-due-tasks.test.ts — `createTxn`:**
`createTransaction` is used directly. For `opts.deleted`, the returned `Transaction.id` is used to issue a subsequent `db.update(transactions).set({ deletedAt: new Date() })`. The reader filters `t.deleted_at is null` so soft-deleted transactions are correctly excluded from the aggregate.

**reconciliation-writes.test.ts — `createTxn`:**
Identical approach to card-due-tasks.test.ts.

**emis.test.ts — `insertInstallmentHistory`:**
`createTransaction` is called with `source: "recurring"` and `recurringTemplateId: templateId`. The `upsertEmiDetails` history check (emis.ts:374-392) uses an INNER JOIN on `postings WHERE postings.accountId = template.accountId AND postings.amountPaise < 0`. The real leg posting (`accountId = sourceId`, `amountPaise = -34000`) satisfies both predicates.

## Complete Diff

```diff
diff --git a/apps/api/src/modules/credit/services/card-due-tasks.test.ts b/apps/api/src/modules/credit/services/card-due-tasks.test.ts
index 6467ee6..d0c43df 100644
--- a/apps/api/src/modules/credit/services/card-due-tasks.test.ts
+++ b/apps/api/src/modules/credit/services/card-due-tasks.test.ts
@@ -10,6 +10,7 @@ import { cardDetails, cardIssuerSettings } from "../schema.ts";
 import { cardCycle, lastOccurrence, nextOccurrence } from "./cycle-math.ts";
 import { listCardHolders } from "./cards.ts";
 import { materializeCardDueTasks, truncateTaskTitle } from "./card-due-tasks.ts";
+import { createTransaction } from "../../ledger/services/transactions.ts";
 
 // DB-backed: this repo has no DB-mocking infrastructure (see emis.test.ts's
 // identical DB-backed section). Export DATABASE_URL before running
@@ -172,13 +173,14 @@ async function createTxn(
   amountPaise: number,
   opts: { deleted?: boolean } = {},
 ): Promise<void> {
-  await db.insert(transactions).values({
-    userId,
-    accountId,
-    date,
-    amountPaise,
-    deletedAt: opts.deleted ? new Date() : null,
-  });
+  // Use createTransaction so the dual-write posting is created alongside the
+  // legacy transactions row, mirroring production. The readers that were
+  // converted by PR-E now query postings, so a fixture with no posting would
+  // be invisible to those readers.
+  const txn = await createTransaction(db, userId, { accountId, date, amountPaise });
+  if (opts.deleted) {
+    await db.update(transactions).set({ deletedAt: new Date() }).where(eq(transactions.id, txn.id));
+  }
 }

diff --git a/apps/api/src/modules/credit/services/emis.test.ts b/apps/api/src/modules/credit/services/emis.test.ts
index 6cce1c7..64ca49f 100644
--- a/apps/api/src/modules/credit/services/emis.test.ts
+++ b/apps/api/src/modules/credit/services/emis.test.ts
@@ -8,6 +8,7 @@ import { createPool } from "../../../infra/db.ts";
 import { accounts, recurringTemplates, transactions, users } from "../../../db/schema.ts";
 import { HttpError } from "../../../lib/errors.ts";
 import { amortize, createEmi, splitInstallments, stepAmortization, upsertEmiDetails } from "./emis.ts";
+import { createTransaction } from "../../ledger/services/transactions.ts";
 
 // ---------- (a) on-schedule payments match amortize()'s per-row arithmetic exactly ----------
 
@@ -277,8 +278,11 @@ async function insertInstallmentHistory(
   accountId: string,
   templateId: string,
 ): Promise<void> {
-  await db.insert(transactions).values({
-    userId,
+  // Use createTransaction so the dual-write posting is created alongside the
+  // legacy transactions row, mirroring production. The upsertEmiDetails
+  // history check (converted by PR-E) now inner-joins postings; a fixture
+  // with no posting is invisible to that check.
+  await createTransaction(db, userId, {
     accountId,
     date: "2026-01-05",
     amountPaise: -34000,

diff --git a/apps/api/src/modules/credit/services/reconciliation-writes.test.ts b/apps/api/src/modules/credit/services/reconciliation-writes.test.ts
index bc9a757..011408e 100644
--- a/apps/api/src/modules/credit/services/reconciliation-writes.test.ts
+++ b/apps/api/src/modules/credit/services/reconciliation-writes.test.ts
@@ -8,6 +8,7 @@ import { accounts, emailIngestions, transactions, users } from "../../../db/sche
 import { cardDetails, statementReconciliations } from "../schema.ts";
 import { HttpError, pgError } from "../../../lib/errors.ts";
 import { listAccounts } from "../../ledger/services/accounts.ts";
+import { createTransaction } from "../../ledger/services/transactions.ts";
 import { getCardActivity } from "./cards.ts";
 import { listReconciliations } from "./reconciliation-reads.ts";
 import { absorbCarryover, recomputeReconciliation, type AbsorbCarryoverHooks } from "./reconciliation-writes.ts";
@@ -63,13 +64,13 @@ async function createTxn(
   amountPaise: number,
   opts: { deleted?: boolean } = {},
 ): Promise<void> {
-  await db.insert(transactions).values({
-    userId,
-    accountId,
-    date,
-    amountPaise,
-    deletedAt: opts.deleted ? new Date() : null,
-  });
+  // Use createTransaction so the dual-write posting is created alongside the
+  // legacy transactions row, mirroring production. The readers converted by
+  // PR-E now query postings; a fixture with no posting is invisible to them.
+  const txn = await createTransaction(db, userId, { accountId, date, amountPaise });
+  if (opts.deleted) {
+    await db.update(transactions).set({ deletedAt: new Date() }).where(eq(transactions.id, txn.id));
+  }
 }
```

## Commands Run and Literal Output

### Command 1: card-due-tasks.test.ts

```
DATABASE_URL=postgresql://postgres:postgres@192.168.2.196:5432/compass_dev REDIS_URL=redis://192.168.2.196:6379 SESSION_SECRET=ci-only-session-secret-not-a-real-value-0123456789 node --test apps/api/src/modules/credit/services/card-due-tasks.test.ts
```

```
✔ AC1: an eligible card materialises exactly one task with the correct title/dueDate/source/sourceKey and provenance-labelled notes (154.66434ms)
✔ AC2: running the materialization pass twice creates exactly one task (idempotent via the alert_ledger claim) (63.754239ms)
✔ AC3: deleting a materialised task and re-running the pass does not recreate it (alert_ledger is the tombstone) (52.318163ms)
✔ AC4: dueDate === null (no card_details row) materialises nothing (11.730373ms)
✔ AC4: amountDuePaise <= 0 (no billed spend) materialises nothing (19.120636ms)
✔ AC4: a due date outside the remind window (already past due) materialises nothing (38.428668ms)
✔ AC5: a demo user and a non-demo user in the same pass — the demo user materialises nothing, and excluding it does not abort the non-demo user (66.471654ms)
[expected duplicate-key errors from AC6/FIX2 intentional conflict tests — omitted for brevity]
✔ AC6: a forced insert failure rolls back the alert_ledger claim; removing the conflict and re-running creates both rows (51.987472ms)
✔ FIX2/AC13: poisoning user A's first card does not suppress A's second card, and user B is entirely unaffected (126.939423ms)
✔ AC7(a): card_details.user_id disagreeing with its account owner processes the card for neither user (41.849942ms)
✔ AC7(b): an alert_ledger row under user A whose ref_key embeds user B's account id does not suppress user B's legitimate task (43.824684ms)
✔ AC7(c): a forged card-due task under user A naming user B's account in sourceKey does not suppress, modify, or collide with user B's task (44.159618ms)
✔ AC7(d): identical source_key text under two different users is permitted for both, independently (16.860283ms)
✔ AC9: after a dueDay change, the pre-existing card-due task is byte-for-byte unchanged and a second task exists for the new key (46.411605ms)
✔ AC10: truncateTaskTitle is UTF-16-safe — ASCII, an astral character landing exactly on the boundary, and an emoji sequence (0.440936ms)
✔ AC10: a title truncated from a long account name still validates against UpdateUserTaskSchema, and the persisted row matches truncateTaskTitle's output (33.173866ms)
✔ AC15: reuses listCardHolders' 4-day statement-generation lag (50.098183ms)
✔ AC15: reuses listCardHolders' handling of a non-zero opening balance (38.572274ms)
✔ AC15: reuses listCardHolders' exclusion of soft-deleted transactions (54.333945ms)
✔ AC15: reuses listCardHolders' close-day exclusivity — a transaction dated on the close day bills next cycle, not this one (45.476527ms)
✔ AC15: reuses listCardHolders' archived-account exclusion — an archived card is never materialised (27.783232ms)
✔ AC15: reuses listCardHolders' default remindDays=3 when no issuer settings row exists (31.995671ms)
✔ AC15: reuses listCardHolders' remindDays boundary — due date exactly remindDays away is included, one day further is not (62.662663ms)
✔ FIX1 proof: today pinned to the 29th (2026-01-29) does not throw and materialises correctly (33.696743ms)
✔ FIX1 proof: today pinned to the 30th (2026-01-30) does not throw and materialises correctly (31.128353ms)
✔ FIX1 proof: today pinned to the 31st (2026-01-31) does not throw and materialises correctly (33.143204ms)
✔ FIX1 proof: a month-end -> month-start (year) rollover — today pinned to 2025-12-31, due date 2026-01-01 (35.285846ms)
ℹ tests 27
ℹ suites 0
ℹ pass 27
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2308.376232
```

**Exit code: 0. Pass: 27/27.**

The "materializeCardDueTasks: failed for card" stderr lines visible during AC6 and FIX2/AC13 are expected — those tests deliberately inject a conflict to prove per-card error isolation; the tests themselves pass.

---

### Command 2: reconciliation-writes.test.ts

```
DATABASE_URL=postgresql://postgres:postgres@192.168.2.196:5432/compass_dev REDIS_URL=redis://192.168.2.196:6379 SESSION_SECRET=ci-only-session-secret-not-a-real-value-0123456789 node --test apps/api/src/modules/credit/services/reconciliation-writes.test.ts
```

```
✔ listReconciliations/recomputeReconciliation: Diners-shaped constituent rows (purchases, a payment, a refund) net the signed ledger due and drift (211.581883ms)
✔ listReconciliations/recomputeReconciliation: a soft-deleted transaction is excluded from the ledger due (68.194715ms)
✔ listReconciliations: a second card of the SAME user does not leak into the aggregate (account predicate) (47.129597ms)
✔ listReconciliations: a second user's identical card does not leak (user predicate) (55.362041ms)
✔ listReconciliations: boundary — close−1 counts, close and close+1 do not (88.285208ms)
✔ listReconciliations: statement_date null → both fields null; total_due_paise null with a date → ledgerDue computed, drift null (31.475994ms)
✔ listReconciliations: an individually-safe opening balance plus an individually-safe transaction sum that together overflow Number.MAX_SAFE_INTEGER is refused (500), not silently truncated (29.665436ms)
✔ recomputeReconciliation: the same opening-balance overflow is refused (500) via the recompute path (36.115982ms)
✔ absorbCarryover: Diners numbers — opening_balance_paise becomes −4559125, returned dueDriftPaise is 0, and card activity's totalDuePaise matches the bank (39.837592ms)
✔ absorbCarryover: a second identical call 409s once drift has been absorbed, and changes nothing further (39.655795ms)
✔ absorbCarryover: sequential absorbs of two different reconciliation rows on one card — the second sees the post-seed ledger due and 409s at zero drift (35.530505ms)
✔ absorbCarryover: absorbing one reconciliation shifts every other row's drift too (a global opening-balance change, not an isolated per-cycle one) (52.889937ms)
✔ absorbCarryover: a nonzero preexisting opening balance (33.531401ms)
✔ absorbCarryover: a negative-drift fixture 409s and changes nothing (29.276658ms)
✔ absorbCarryover: a null total_due_paise 409s (10.264876ms)
✔ absorbCarryover: a null statement_date 409s (12.394344ms)
✔ absorbCarryover: an archived card 409s (23.766536ms)
✔ absorbCarryover: a non-credit-card account 400s (8.910388ms)
✔ absorbCarryover: a foreign (nonexistent) account id 404s (6.384348ms)
✔ absorbCarryover: a reconciliation belonging to another account of the SAME user 404s (10.529517ms)
✔ absorbCarryover: only transactions strictly before statement_date count toward the drift (57.447368ms)
✔ absorbCarryover: listAccounts reflects the new opening balance (36.046999ms)
✔ absorbCarryover: post-commit, a best-effort net-worth snapshot repair is triggered for this user (AC6) (27.583621ms)
✔ absorbCarryover: a concurrent account-row lock (an opening-balance edit in progress) blocks absorb until it commits — the final state matches a serial order (305.746675ms)
✖ absorbCarryover: a genuine SSI dependency cycle forces 40001, and withSerializableRetry succeeds off the fresh ledger (28.467685ms)
✖ absorbCarryover: an SSI cycle reproduced on BOTH attempts surfaces 40001 with no committed change (22.75486ms)
ℹ tests 26
ℹ suites 0
ℹ pass 24
ℹ fail 2
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2449.534224

✖ failing tests:

test at apps/api/src/modules/credit/services/reconciliation-writes.test.ts:685:1
✖ absorbCarryover: a genuine SSI dependency cycle forces 40001, and withSerializableRetry succeeds off the fresh ledger (28.467685ms)
  AssertionError [ERR_ASSERTION]: the retry must have happened — the hook fires again on the second attempt
  
  1 !== 2
  
      at TestContext.<anonymous> (file:///home/udai/common/compass/apps/api/src/modules/credit/services/reconciliation-writes.test.ts:728:10)

test at apps/api/src/modules/credit/services/reconciliation-writes.test.ts:737:1
✖ absorbCarryover: an SSI cycle reproduced on BOTH attempts surfaces 40001 with no committed change (22.75486ms)
  AssertionError [ERR_ASSERTION]: Missing expected rejection.
      at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
      at async TestContext.<anonymous> (file:///home/udai/common/compass/apps/api/src/modules/credit/services/reconciliation-writes.test.ts:775:3)
```

**Exit code: 1. Pass: 24/26.**

The `2540475` expectation passes (Diners test, line 123). The 2 failures are the SSI tests — see "Residual Failures and Hard Guard" section below.

---

### Command 3: emis.test.ts

```
DATABASE_URL=postgresql://postgres:postgres@192.168.2.196:5432/compass_dev REDIS_URL=redis://192.168.2.196:6379 SESSION_SECRET=ci-only-session-secret-not-a-real-value-0123456789 node --test apps/api/src/modules/credit/services/emis.test.ts
```

```
✔ splitInstallments: on-schedule monthly payments match a hand-computed amortize()-style loop, per row (2.801287ms)
[... 12 more pure-function tests, all pass ...]
✔ stepAmortization: an overshoot/payoff step matches case (f) — balance floors at 0, excess unattributed (0.150868ms)
✔ createEmi: an owned loan-type destination account is accepted (126.936167ms)
[... 9 more createEmi tests, all pass ...]
✔ upsertEmiDetails: null -> non-null with no installment history is allowed (29.452701ms)
✔ upsertEmiDetails: null -> non-null with real installment history present is rejected with 400 (91.553291ms)
✔ upsertEmiDetails: non-null -> null (detach) is always allowed (26.165883ms)
✔ upsertEmiDetails: non-null -> a different non-null (repoint) is always rejected with 400, regardless of history (22.070974ms)
✔ upsertEmiDetails: an unchanged loanAccountId is a no-op — no attach/detach/repoint validation triggered (23.689538ms)
✔ upsertEmiDetails: an unchanged loanAccountId is not revalidated, even if it would now fail validation (38.637509ms)
ℹ tests 29
ℹ suites 0
ℹ pass 29
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1510.492973
```

**Exit code: 0. Pass: 29/29.**

---

## Residual Failures and Hard Guard Analysis

### reconciliation-writes.test.ts:685 — HARD GUARD BLOCKER

**Test:** `absorbCarryover: a genuine SSI dependency cycle forces 40001, and withSerializableRetry succeeds off the fresh ledger`

**Root cause:** This test uses a direct (inline) `db.insert(transactions)` at line 690-693 — NOT through the `createTxn` helper. The test's SSI conflict mechanism relies on connection B updating `transactions.amountPaise` after connection A has read it. The expected value at line 734 is:

```typescript
assert.equal(row!.openingBalancePaise, -350000); // -500000 - -150000
```

This value (`-350000 = -(500000) + 150000`) is computed on the assumption that the reader sees B's updated `transactions.amountPaise = -150000` on the retry. After PR-E, the reader (`ledgerDuesAtDates`) reads `postings.amountPaise` instead. B's hook never updates the posting — it only updates `transactions.amountPaise`. So on the retry, the reader still sees the original posting (`-100000`), and the correct result would be `-(500000 - 100000) = -400000`, not `-350000`.

**Hard guard:** Fixing the direct insert (creating a posting) would make `hookCalls === 2` pass (SSI does fire once postings exist, because A reads the transactions row via the INNER JOIN) but would leave `openingBalancePaise === -400000 ≠ -350000`. Cannot fix without changing the expected value. Per the brief's hard guard instruction, this is evidence of a real production design question — the SSI test was written for the transactions-based reader and is now incompatible with the PR-E posting-based reader.

**Status:** Reported. Not touched. Requires coordinator decision on whether the test's SSI mechanism (hook updating transactions.amountPaise) needs to be redesigned to also update the posting, and whether the expected value should change to `-400000`.

---

### reconciliation-writes.test.ts:737 — Fixable but outside named scope

**Test:** `absorbCarryover: an SSI cycle reproduced on BOTH attempts surfaces 40001 with no committed change`

**Root cause:** Same inline insert at line 742-745 (no posting). Without a posting, A's INNER JOIN finds no rows, so A never reads the transactions row; B's update creates no rw-dependency; no SSI fires; `absorbCarryover` succeeds on the first attempt; `assert.rejects(...)` fails.

**Analysis:** This test CAN be fixed without changing any expected value: once a posting exists, A reads the transactions row via the INNER JOIN, B's update creates the rw-dependency, SSI fires on both attempts (40001), hookCalls=2, and openingBalancePaise=0 (no committed change). All expected values are preserved.

However, this direct insert is not one of the three named fixture helpers (items 7-9). Reported here for coordinator action; not fixed in this iteration.

---

## P5 Sweep

Scope: tests ELSEWHERE in apps/api that (a) raw-insert into `transactions` without creating postings AND (b) assert against a reader that PR-E converted to posting-derived. Cross-referenced against the actual converted readers.

### Converted readers (PR-E)

| Reader | File | Query |
|--------|------|-------|
| `listCardHolders` | `credit/services/cards.ts:229-237` | `FROM postings p JOIN transactions t` |
| `getCardActivity` (headline sums) | `credit/services/cards.ts:326-333` | `FROM postings p JOIN transactions t` |
| `getCardActivity` (line items) | `credit/services/cards.ts:342-349` | `FROM postings p JOIN transactions t` |
| `ledgerDuesAtDates` | `credit/services/reconciliation-reads.ts:124-137` | `FROM postings p JOIN transactions t` |
| `upsertEmiDetails` (history check) | `credit/services/emis.ts:374-392` | `INNER JOIN postings` |
| `listUserTasks` / `getUserTask` | `ledger/services/user-tasks.ts:84-107` | `LEFT JOIN LATERAL (SELECT FROM postings p)` |

### Search results

Files with raw `db.insert(transactions)` outside the three owned files:

| File | Lines | Purpose |
|------|-------|---------|
| `ledger/services/reconcile-postings.test.ts` | 61,90,128,135 | Tests `reconcileUserPostings` (the reconciler itself); assertions are on `repaired` count and `findInconsistentPostings`, never on PR-E converted readers |
| `system/services/backup.test.ts` | 578 | Tests `buildUserBackupStream`; assertion is on restore success, not PR-E converted readers |
| `ingest/services/inbox.test.ts` | 1614,1720 | Tests `acceptRepayment` eligibility predicates; assertions are on `links.length` and `links[].outTransactionId`, not PR-E converted readers |
| `ledger/services/user-tasks.test.ts` | 63-79 (`createTxn`) | **P5 MATCH — see below** |

### P5 Match: `ledger/services/user-tasks.test.ts`

**File:line:** `apps/api/src/modules/ledger/services/user-tasks.test.ts:63-79` (`createTxn` helper)

**Used in:** Test `AC6` at line 240-263:
```typescript
const txnId = await createTxn(userId, accountId, { date: "2026-02-01", amountPaise: -12345, merchant: "Bookstore" });
// ...
assert.deepEqual(linked.transaction, {
  id: txnId,
  accountId,          // <-- derived from postings lateral join (rp.account_id)
  date: "2026-02-01",
  merchant: "Bookstore",
  amountPaise: -12345, // <-- derived from postings lateral join (rp.amount_paise)
});
```

**Reader touched:** `listUserTasks` / `getUserTask` via `TASK_LATERAL_QUERY` (`user-tasks.ts:84-107`), which uses:
```sql
left join lateral (
  select p.account_id, p.amount_paise
  from postings p
  join accounts a on a.id = p.account_id
  where p.transaction_id = t.id and a.system_kind is null
  order by p.id
  limit 1
) rp on t.id is not null
```

Without a posting, `rp.account_id` and `rp.amount_paise` are both null. The `deepEqual` assertion fails because the returned `transaction.accountId` is null (not the actual UUID) and `transaction.amountPaise` is null (not -12345).

**Currently failing** (part of ~39, not passing silently).

**File ownership:** `user-tasks.test.ts` is NOT in Worker B's ownership (Worker A owns the production `user-tasks.ts` and `user-tasks.route.test.ts`). Reported here per P5 scope; not fixed.

**Other usages of `createTxn` in user-tasks.test.ts** (AC1(5), AC4, AC5, AC7, AC8): These assert `transactionId` (from `ut.transaction_id` directly, not postings) or `transaction === null` (soft-deleted; lateral returns null regardless). They pass even without postings.

### No other P5 matches found

`postings-pr-e-parity.test.ts` imports and tests all PR-E converted readers but uses `createTransaction` exclusively — no raw inserts. `reconciliation-reads.test.ts` tests pure functions with no DB. `recurring.test.ts` uses `upsertEmiDetails` (a PR-E reader) but creates transactions via `materializeDue` (production path, postings included) not raw inserts.

---

## Summary

| File | Tests Before | Tests After | Notes |
|------|-------------|-------------|-------|
| card-due-tasks.test.ts | ~25 fail | 27/27 pass | `createTxn` → `createTransaction` |
| reconciliation-writes.test.ts | ~20 fail | 24/26 pass | `createTxn` → `createTransaction`; 2 SSI tests remain failing (different root cause) |
| emis.test.ts | 1 fail | 29/29 pass | `insertInstallmentHistory` → `createTransaction` |

## Assumptions

1. The `postings.transactionId` FK cascade (`onDelete: "cascade"`) means existing `cleanupUser` functions (which delete `transactions`) also cascade-delete postings with no modification needed.
2. `resolveSystemAccounts` (called internally by `createTransaction`) creates 4 system accounts per test user via `seedSystemAccounts`. These are `accounts` rows with `systemKind != null` and are deleted by the existing `db.delete(accounts).where(eq(accounts.userId, userId))` in each cleanup function.
3. Cross-module service import from `credit/services/*.test.ts` to `ledger/services/transactions.ts` is permitted per the CLAUDE.md architecture note: "Runtime cross-module SERVICE imports are still allowed."

## Unresolved Risks

1. **Hard guard blocker** (`reconciliation-writes.test.ts:685`): `openingBalancePaise === -350000` cannot be preserved. The SSI test hook updates only `transactions.amountPaise`, but PR-E converted the reader to use `postings.amountPaise`. Coordinator decision needed: either redesign the hook to also update the posting (and recompute the expected value to `-400000`), or redesign the SSI test around a different conflict mechanism that touches postings directly.

2. **Fixable residual** (`reconciliation-writes.test.ts:737`): The second SSI test can be fixed by creating a posting for its inline direct insert — all three expected values (40001 rejection, hookCalls=2, openingBalancePaise=0) are preserved. This is outside the named scope (items 7-9) but in my file. Left for coordinator to decide whether to allocate a follow-up fix.

3. **P5 finding** (`user-tasks.test.ts:AC6`): `createTxn` at line 63-79 asserts on `transaction.accountId` and `transaction.amountPaise` from the TASK_LATERAL_QUERY postings lateral join. Not fixed (not in Worker B's ownership).
