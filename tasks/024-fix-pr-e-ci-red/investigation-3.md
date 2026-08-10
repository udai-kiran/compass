# Investigation 3 — PR-E CI red: two failing SSI tests

**Branch:** fix/pr-e-ci-red  
**Files inspected:** reconciliation-writes.test.ts (lines 660–786), reconciliation-reads.ts (lines 110–150), reconciliation-writes.ts (lines 232–342), transactions.ts (lines 376–426), post-entry.ts (replacePostings / resolveSystemAccounts), postings.ts (buildOrdinaryPostings), db/shared/ledger.ts (postings table schema), lib/serializable.ts  
**Files changed:** none  
**Commands run:**
```
node --test apps/api/src/modules/credit/services/reconciliation-writes.test.ts
PGPASSWORD=... psql -h 192.168.2.196 -U postgres -d compass_dev -c "SELECT trigger_name, ..."
node scratchpad/verify-seed-postings.mjs   (throwaway; rolled back; zero rows committed)
```

---

## Literal test output (exit 1)

```
✖ absorbCarryover: a genuine SSI dependency cycle forces 40001, and withSerializableRetry succeeds off the fresh ledger (18.942449ms)
  AssertionError [ERR_ASSERTION]: the retry must have happened — the hook fires again on the second attempt
  1 !== 2
      at reconciliation-writes.test.ts:728:10
  actual: 1, expected: 2, operator: 'strictEqual'

✖ absorbCarryover: an SSI cycle reproduced on BOTH attempts surfaces 40001 with no committed change (19.648902ms)
  AssertionError [ERR_ASSERTION]: Missing expected rejection.
      at reconciliation-writes.test.ts:775:3
  operator: 'rejects'

ℹ pass 24 / fail 2
```

---

## Question 1 — Does the seed at line 690 have postings rows?

**Answer: No. Zero rows.**

The seed is:
```ts
// reconciliation-writes.test.ts:690-693
const [seed] = await db
  .insert(transactions)
  .values({ userId, accountId, date: "2029-05-05", amountPaise: -100000 })
  .returning({ id: transactions.id });
```

This is a raw Drizzle insert, bypassing `createTransaction`. The throwaway script at
`/tmp/…/scratchpad/verify-seed-postings.mjs` reproduced this setup verbatim inside a
rolled-back transaction and queried:

```sql
SELECT p.id, p.account_id, a.system_kind, p.amount_paise
FROM postings p
LEFT JOIN accounts a ON a.id = p.account_id
WHERE p.transaction_id = $1
```

Literal output:
```
=== postings rows for seed transaction ===
row count: 0
rows: []

=== ledgerDuesAtDates aggregate (what absorbCarryover reads) ===
rows: [{"stmt_date":"2029-05-20","sum_paise":"0"}]
sum_paise=0, ledgerDuePaise=0, drift=500000, nextOpeningBalancePaise=-500000

Rolled back — no rows committed.
```

---

## Question 2 — What creates postings? Is there a DB trigger?

There is no DB trigger that creates postings on transaction insert. The only triggers in the
`public` schema are:

```
transaction_splits_sum_check     | transaction_splits | AFTER INSERT/DELETE/UPDATE
transactions_amount_split_check  | transactions       | AFTER UPDATE (amount_paise only)
```

(Confirmed by `SELECT trigger_name, event_object_table, action_timing, event_manipulation
FROM information_schema.triggers WHERE trigger_schema = 'public'`.)

Both triggers enforce split-sum invariants; neither inserts postings. The only production path
that creates postings for a transaction is:

```ts
// transactions.ts:407-423
const rows = await db.transaction(async (t) => {
  const inserted = await t.insert(transactions).values({ ...input, merchant, userId }).returning();
  const newRow = inserted[0]!;
  const systemAccounts = await resolveSystemAccounts(t, userId);  // seeds system accounts
  const drafts = buildOrdinaryPostings({ accountId: newRow.accountId, amountPaise: newRow.amountPaise, ... });
  await replacePostings(t, newRow.id, userId, drafts);
  return inserted;
});
```

This dual-write is inside `createTransaction` (transactions.ts:376). The seed bypasses it.
Neither `createCardAccount`, `createReconciliation`, nor `cleanupUser` in the test file
creates postings. `absorbCarryover` itself does not backfill postings.

---

## Question 3 — Exact query in `ledgerDuesAtDates`

**File:** `apps/api/src/modules/credit/services/reconciliation-reads.ts:124-137`

```ts
const agg = await db.execute(sql`
  select ds.stmt_date::text as stmt_date,
    coalesce(sum(sub.amount_paise), 0)::bigint as sum_paise
  from unnest(array[${dateList}]) as ds(stmt_date)
  left join (
    select p.amount_paise, t.date
    from postings p
    join transactions t on t.id = p.transaction_id
    where p.account_id = ${accountId}
      and t.user_id = ${userId}
      and t.deleted_at is null
  ) sub on sub.date < ds.stmt_date
  group by ds.stmt_date
`);
```

**It reads `postings.amount_paise`, not `transactions.amount_paise`.** This is the PR-E
conversion. The filter is `p.account_id = ${accountId}` (the card account id), so it returns
only the real leg of each posting (not the system expenses/income leg). It excludes
soft-deleted transactions via `t.deleted_at is null`. It does NOT separately filter by
`system_kind` because the `p.account_id` predicate already isolates the card account's leg.

---

## Question 4 — Arithmetic for the observed behaviour

With the seed having zero postings, `ledgerDuesAtDates` returns `sum_paise = 0` for any
statement date after 2029-05-05:

```
ledgerDuePaise  = -(openingBalancePaise + sum_paise)
               = -(0 + 0) = 0

drift           = totalDuePaise − ledgerDuePaise
               = 500000 − 0 = 500000

nextOpening     = openingBalancePaise − drift
               = 0 − 500000 = −500000
```

The hook (hookCalls = 1) fires AFTER A's aggregate read and BEFORE A's account update.
Connection B updates `transactions.amountPaise = −150000`. But since there are no postings
for the seed transaction, this update touches no row that A's aggregate query ever read
(A read `postings`, B wrote `transactions`). Postgres SSI has no rw-anti-dependency to record
between A and B. No SSI cycle → no 40001 → A commits immediately with
`openingBalancePaise = −500000`.

The previous worker's observation of `−400000` was based on the pre-PR-E query path (reading
`transactions.amount_paise` directly, where the seed's `−100000` row IS visible). That path is
no longer active. The current failure is at line 728 (`hookCalls = 1 ≠ 2`), which aborts before
line 734 is reached.

---

## Question 5 — Root cause verdict

**(a) The coordinator's hypothesis is exactly right.** The failure is entirely in the test-side
hook: it updates `transactions.amountPaise` but does NOT update the corresponding
`postings.amount_paise`. Because `ledgerDuesAtDates` now reads `postings`, B's write to
`transactions` is invisible to A's aggregate read. No rw-anti-dependency → no SSI cycle →
no 40001.

There is no production dual-write bug. The production writer (`createTransaction`,
transactions.ts:376-426) correctly dual-writes both the `transactions` row and its postings in
the same `db.transaction()`. The hook is a test-only seam (marked `// Test seam only` at
reconciliation-writes.ts:286); it was written against the pre-PR-E query and was never updated
to match the new postings-based reader.

**What the hook must additionally do:**

1. The seed at line 690 (and line 743 in the second test) must be created via `createTransaction`
   instead of `db.insert(transactions)`. This gives the seed a real posting:
   - real leg: `account_id = cardAccountId, amount_paise = −100000`
   - system leg: `account_id = expensesAccountId, amount_paise = +100000`

2. Inside `txB`, after `txB.update(transactions).set({ amountPaise: −150000 })…`, the hook
   must also update the matching posting's `amount_paise` for the real leg:
   ```ts
   await txB
     .update(postings)
     .set({ amountPaise: -150000 })
     .where(
       and(eq(postings.transactionId, seed!.id), eq(postings.accountId, accountId))
     );
   ```
   (For test 2 the amount is `−100000 − hookCalls * 1000` on each attempt; the same posting
   update applies analogously.)

**Why this cannot reintroduce the FK/FOR KEY SHARE deadlock (lines 660-684):**

The deadlock described in that comment is specific to **inserting** a new `transactions` row
inside the hook. A new transactions row holds a FK reference to `accounts.id`, which Postgres
enforces with a `FOR KEY SHARE` lock on the referenced account row. That conflicts with
connection A's `FOR UPDATE` lock on the same row → deadlock.

An **UPDATE to `postings.amount_paise`** on an existing row changes neither `account_id` nor
`transaction_id`. Postgres only re-checks FK constraints when the referencing column itself
changes. Updating `amount_paise` on an existing posting row triggers zero FK re-checks and
acquires zero `FOR KEY SHARE` locks on `accounts`. The update path through `postings` is
entirely safe.

**How the SSI cycle is restored:**

```
A's serializable transaction:
  reads postings row (real leg, amount_paise = −100000)  ← SIREAD lock recorded
  [hook fires]
  B's serializable transaction:
    reads accounts row (plain SELECT, SIREAD lock recorded on that row)
    writes postings row (amount_paise = −150000)   ← A rw→ B anti-dependency
    commits
  A writes accounts row (openingBalancePaise = −350000)  ← B rw→ A anti-dependency
  Postgres detects cycle A→B→A → aborts A with SQLSTATE 40001
```

`withSerializableRetry` catches 40001 and retries once:

```
A's retry:
  reads accounts (FOR UPDATE): openingBalancePaise = 0  (A's first attempt rolled back)
  reads postings (fresh snapshot): amount_paise = −150000  (B's committed write)
  sum_paise = −150000
  ledgerDuePaise = −(0 + −150000) = 150000
  drift = 500000 − 150000 = 350000
  nextOpening = 0 − 350000 = −350000
  hook fires (hookCalls = 2) → no-op (hookCalls > 1)
  A commits openingBalancePaise = −350000
```

Result: `hookCalls = 2` ✓, `dueDriftPaise = 0` ✓, `openingBalancePaise = −350000` ✓.

**The expected value `−350000` is fully preserved. It must NOT be changed.**

---

## Question 6 — Second failing test (line 737) with same fix

Test at line 737 has the same seed (raw insert, no postings) and a hook that fires on EVERY
attempt, each time overwriting `transactions.amountPaise` by an additional −1000.

With the current broken state: no postings → no SSI cycle → no 40001 → `absorbCarryover`
succeeds and never rejects → `assert.rejects` fails with "Missing expected rejection".

**After the fix** (seed via `createTransaction`, hook also updates `postings.amount_paise`):

- Attempt 1 (hookCalls = 1):  
  A reads posting: sum = −100000  
  B reads accounts; B updates posting to `−100000 − 1×1000 = −101000`; B commits  
  SSI cycle → 40001 → rollback

- Retry (hookCalls = 2):  
  A reads fresh posting: sum = −101000  
  B reads accounts; B updates posting to `−100000 − 2×1000 = −102000`; B commits  
  SSI cycle → 40001

  `withSerializableRetry` has exhausted its one retry (lib/serializable.ts:21-28: try once,
  catch 40001, run once more; second 40001 is rethrown). The second 40001 surfaces → `assert.rejects` ✓

- `hookCalls = 2` ✓ (exact — no third attempt)

- Neither attempt committed → `accounts.openingBalancePaise` remains 0 ✓

All three assertions are satisfied by the same fix as test 1.

---

## Summary of the fix (diagnosis only — not implemented)

| Location | Current | Must become |
|---|---|---|
| test line 690 | `db.insert(transactions).values(…)` | `createTransaction(db, userId, { accountId, date: "2029-05-05", amountPaise: -100000 })` |
| test line 716-718 (hook, test 1) | `txB.update(transactions).set({ amountPaise: -150000 })` | same PLUS `txB.update(postings).set({ amountPaise: -150000 }).where(…accountId…)` |
| test line 743 | `db.insert(transactions).values(…)` | `createTransaction(db, userId, { accountId, date: "2029-06-05", amountPaise: -100000 })` |
| test line 766-768 (hook, test 2) | `txB.update(transactions).set({ amountPaise: … })` | same PLUS `txB.update(postings).set({ amountPaise: … }).where(…accountId…)` |

`cleanupUser` already deletes `transactions` by userId; the `postings` table has
`onDelete: "cascade"` on its `transaction_id` FK (db/shared/ledger.ts:138), so postings
are automatically cleaned up when transactions are deleted. No change to `cleanupUser` is
needed.

No production code has a bug. No expected value needs changing.
