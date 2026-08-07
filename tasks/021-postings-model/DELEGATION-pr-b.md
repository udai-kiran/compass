# Sonnet Worker Delegation — PR-B (balance readers → postings)

## Task
2.1 postings-model, dual-write PR-B. Plan: `PLAN-pr-b.md` (APPROVED, Codex
review-19). Strategy: `PLAN-dualwrite.md`. PR-A merged (v2.2.0).

## Ground rules
- Branch/commit/push/PR/tag are the LEAD's gate — do NOT run any of them. Leave
  changes in the working tree on `main`. Never `git add -A`.
- This is a converge-to-GREEN PR (unlike PR-A's intentionally-broken slices):
  typecheck, lint, and apps/api tests must pass when you finish.
- Legacy columns and dual-write STAY. You are only changing how these 3 readers
  COMPUTE balance. No schema, no migration, no shared-schema, no web changes.

## Approved plan (P-items)
- PB1 replace `sum(transactions.amount_paise)` on a real account with
  `sum(postings.amount_paise)` where `postings.account_id = <that account>`,
  JOINed to the parent transaction for predicates.
- PB2 keep `accounts.opening_balance_paise` as an explicit addend (both sides).
- PB3 sum postings over REAL accounts only (`system_kind is null` / already-
  filtered bank/cash) so no Clearing/Expenses/Income/Opening posting can enter.
- PB4 apply `deleted_at is null` + date cut on the PARENT transaction; keep
  `current_date` in listAccounts, bound `asOf` elsewhere; add a parent
  `transactions.user_id = <userId>` predicate everywhere (defense in depth).
- PB6 500-class overflow guard on aggregates AND derived arithmetic (see below).
- PB7 do NOT touch insights.ts / cards.ts / reconciliation-reads.ts (deferred).

## Files and required changes

### 1. `apps/api/src/modules/ledger/services/balances.ts` — `bankCashBalances`
Rewrite the raw SQL so the per-account total comes from postings:
```sql
select a.id, a.name,
       a.opening_balance_paise as opening,
       coalesce(p.total, 0) as posting_total
from accounts a
left join (
  select po.account_id, sum(po.amount_paise) as total
  from postings po
  join transactions t on t.id = po.transaction_id
  where t.user_id = ${userId} and t.deleted_at is null and t.date <= ${asOf}
  group by po.account_id
) p on p.account_id = a.id
where a.user_id = ${userId} and a.archived_at is null and a.type in ('bank', 'cash')
```
In JS, per row: `const postingTotal = Number(r.posting_total);` guard it (PB6);
`const balancePaise = Number(r.opening) + postingTotal;` guard it (PB6). Keep the
`AccountBalance` shape unchanged. `bankCashTotal` keeps summing `bankCashBalances`
but MUST guard its reduction result (PB6).

### 2. `apps/api/src/modules/ledger/services/accounts.ts` — `accountBalancesAtDate`
Rewrite raw SQL to postings, returning opening and posting_total separately:
```sql
select a.type,
       a.opening_balance_paise as opening,
       coalesce(p.total, 0) as posting_total
from accounts a
left join (
  select po.account_id, sum(po.amount_paise) as total
  from postings po
  join transactions t on t.id = po.transaction_id
  where t.user_id = ${userId} and t.deleted_at is null and t.date <= ${asOf}
  group by po.account_id
) p on p.account_id = a.id
where a.user_id = ${userId} and a.archived_at is null and a.system_kind is null
```
JS: `const postingTotal = Number(r.posting_total);` guard; `const balancePaise =
Number(r.opening) + postingTotal;` guard; keep `assertPublicAccountType(r.type)`.

### 3. `apps/api/src/modules/ledger/services/accounts.ts` — `listAccounts` (drizzle)
Import `postings` (from `../schema.ts`, same place `transactions` comes from).
Change the aggregation from transactions to postings, joined via the parent:
```ts
.select({
  account: accounts,
  postingSum: sql<number>`coalesce(sum(${postings.amountPaise}) filter (where ${transactions.deletedAt} is null and ${transactions.date} <= current_date and ${transactions.userId} = ${userId}), 0)::bigint`,
  subtype: bankDetails.subtype,
})
.from(accounts)
.leftJoin(postings, eq(postings.accountId, accounts.id))
.leftJoin(transactions, eq(transactions.id, postings.transactionId))
.leftJoin(bankDetails, eq(bankDetails.accountId, accounts.id))
.where(and(eq(accounts.userId, userId), isNull(accounts.systemKind)))
.groupBy(accounts.id, bankDetails.subtype)
.orderBy(accounts.sortOrder, accounts.createdAt);
```
CRITICAL: the `deleted_at`/`date`/`user_id` predicates go INSIDE the aggregate
`filter (...)` — NOT the outer `.where(...)` — or the left join collapses and
zero-activity accounts vanish. Do NOT add an `archived_at` filter: listAccounts
currently INCLUDES archived accounts; preserve that. JS: `const postingSum =
Number(txSum-equivalent);` guard (PB6); `balancePaise = account.openingBalancePaise
+ postingSum;` guard (PB6). Keep `subtype` handling unchanged.

### 4. `apps/api/src/modules/ledger/services/average-balance.ts` — `accountAverageBalances`
Convert the 3 SQL reads to postings joined to the parent transaction:
- `first_activity`: `min(t.date)` from `postings po join transactions t on
  t.id = po.transaction_id` where `po.account_id = a.id and t.user_id = ${userId}
  and t.deleted_at is null and t.date <= ${today}`.
- `carried_in_delta`: `coalesce(sum(po.amount_paise),0)` from the same join where
  `po.account_id = a.id and t.user_id = ${userId} and t.deleted_at is null and
  t.date < ${monthStart}`.
- deltas query: `select po.account_id, t.date, sum(po.amount_paise) as delta
  from postings po join transactions t on t.id = po.transaction_id
  where t.user_id = ${userId} and t.deleted_at is null and t.date >= ${monthStart}
  and t.date <= ${today} and po.account_id in (select id from accounts where
  user_id = ${userId} and archived_at is null and type = 'bank')
  group by po.account_id, t.date`.
PB6: guard `Number(row.opening_balance_paise)`, `Number(row.carried_in_delta)`,
their sum (`carriedInPaise`), and each `Number(row.delta)` before use; also guard
the final `averagePaise` for each built result. Do NOT rewrite the pure helpers
(`ambWindow`/`sumDailyClosingPaise`/`buildAverageBalance`/etc.) internals —
guard the SQL-derived inputs and the final result only.

## PB6 — the overflow guard (use the EXISTING pattern, do not invent)
Mirror `apps/api/src/modules/credit/services/reconciliation-reads.ts:137-143`:
```ts
if (!Number.isSafeInteger(x)) {
  throw new HttpError(500, "Balance aggregate exceeded a safe integer — refusing to lose paise");
}
```
Do NOT use `assertSafePaise` from postings.ts (it throws `HttpError(400)`, wrong
class for a data/server overflow). `HttpError` is already imported in accounts.ts;
import it into balances.ts and average-balance.ts as needed (`../../../lib/errors.ts`).
Check BOTH the raw aggregate AND every derived combination (opening+sum,
carried-in+opening, cross-account reduction) — two safe values can combine unsafe.

## Tests

### Update `apps/api/src/modules/ledger/services/account-balances.test.ts`
Its stub asserts the bound params and row mapping. The new SQL binds a different
set/order of params — update the param assertions to match your new query. Per
Codex: KEEP a SEPARATE safe-result fixture case whose assertions verify the
rewritten query params (they must run), AND add a case where the
`9007199254740993` aggregate now causes a THROW (overflow refusal) — do not put
the throwing row in the same case as the param assertions, or the assertions
after the call never execute.

### Update `apps/api/src/modules/ledger/services/average-balance.test.ts`
Adjust whatever the SQL change breaks so it passes; keep coverage of the pure
helpers intact.

### NEW `apps/api/src/modules/ledger/services/postings-balance-parity.test.ts` (DB-backed)
Model the infra on `reconcile-postings.test.ts` (live Postgres, migration 0067
applied; skip/guard when `DATABASE_URL` is unset exactly as the other DB-backed
tests do). Requirements:
- Seed ONE fixture user via the real writers (createAccount / createTransaction /
  setSplits / transfer link / etc.) so postings are dual-written — do NOT hand-
  insert postings.
- Compute EXPECTED legacy values DIRECTLY from legacy tables inside the test
  (`opening_balance_paise + Σ transactions.amount_paise` under the same
  predicates) — NEVER by calling another balance helper (no tautology).
- Assert the converted readers (`bankCashBalances`, `bankCashTotal`,
  `accountBalancesAtDate`, `listAccounts` balance, `accountAverageBalances`)
  equal the legacy expected values, per account and in total.
- Assert exact posting shape: `findInconsistentPostings(db, userId)` returns `[]`
  for the fixture user (so a coincidentally-equal aggregate cannot hide drift).
- Cover (see PLAN-pr-b.md T4 for the full list): bank w/ is_opening row +
  ordinary +/−; card w/ opening column + charges; mixed-sign split summing to
  parent; zero-amount ordinary; linked transfer pair (assert NO Clearing
  leakage into any real balance); soft-deleted txn that WOULD be earliest
  (excluded, does not set AMB window); future-only account (excluded);
  zero-activity bank (zero column) and zero-activity column-opening account
  (balance == column); column-opening bank with NO txn → `firstActivity = null`,
  no AMB (must NOT substitute account-creation date); column-opening bank whose
  first real activity is inside the current month; opening txn predating the
  month (carried-in AMB); multiple same-day postings (daily grouping); archived
  account behavior per reader (listAccounts includes archived); a SECOND user
  whose data must not leak into user 1's numbers.
- For AMB, compare the COMPLETE `AccountAverageBalance` (from/to/days/daysInMonth/
  averagePaise/partialHistory), not just averagePaise.

## Must NOT change
- Any writer, the opening-balance plan/guards in accounts.ts, the pure AMB math
  helpers' internals, shared schemas, web, db schema, migrations.
- insights.ts, cards.ts, reconciliation-reads.ts, networth.ts, cashflow.ts,
  dashboard.ts, prefs.ts (they inherit postings numbers via the converted readers
  under parity; PR-C/D/E convert their own direct SQL).
- Do NOT add an archived-account filter to listAccounts.

## Acceptance Criteria (prove all)
- AC1–AC5 of PLAN-pr-b.md.

## Commands (run to converge to green; report literal output + exit codes)
1. `npm run typecheck` (root — all workspaces)
2. `npm run lint`
3. `npm run test -w apps/api`
   - and specifically: `node --test apps/api/src/modules/ledger/services/account-balances.test.ts`
     `average-balance.test.ts` `postings-balance-parity.test.ts`
     and `apps/api/src/modules/investments/services/networth.test.ts`

## Required evidence to return
- Files changed + the COMPLETE diff of balances.ts, accounts.ts, average-balance.ts,
  the two updated tests, and the new parity test.
- The literal output + exit code of each command above (full test summary lines:
  tests/pass/fail/skipped).
- `git status --porcelain` proving ONLY the scoped files changed (plus the new
  test file as untracked).
- Any deviation from this brief or blocker, called out explicitly.

---

# Iteration 2 — resolve Codex review-20 BLOCKING findings

Codex review-20 confirmed the SQL conversions correct (PB1–PB4, PB7 PASS) but
found 6 gaps in PB6 (overflow guarding) and PB5/AC3/AC4 (parity-test rigor). The
lead validated all 6 against the code. Apply EXACTLY these fixes; change nothing
else. Same ground rules as iteration 1 (converge to green, no git ops, only the
already-scoped files). This is a follow-up on the SAME working-tree changes.

## Fix 1 — `bankCashTotal`: guard every intermediate addition (balances.ts)
Replace the single-`reduce`-then-check with a loop that checks after EACH add:
```ts
let total = 0;
for (const r of rows) {
  total += r.balancePaise;
  if (!Number.isSafeInteger(total)) {
    throw new HttpError(500, "Balance aggregate exceeded a safe integer — refusing to lose paise");
  }
}
return total;
```

## Fix 2 — AMB accumulated arithmetic: guard each step (average-balance.ts)
In the pure helper `sumDailyClosingPaise` (average-balance.ts:82-97), guard both
running-balance and daily-closing-sum additions as they happen (HttpError is
already imported in this file):
```ts
running += deltas.get(dateStr) ?? 0;
if (!Number.isSafeInteger(running)) {
  throw new HttpError(500, "Balance aggregate exceeded a safe integer — refusing to lose paise");
}
sum += running;
if (!Number.isSafeInteger(sum)) {
  throw new HttpError(500, "Balance aggregate exceeded a safe integer — refusing to lose paise");
}
```
Keep the existing input guards and the final `averagePaise` guard. Do NOT change
the numeric result for safe inputs (existing average-balance.test.ts must still
pass 21/21). This is the one sanctioned change to a pure helper — the approved
plan's PB6 explicitly requires guarding the accumulated daily-closing arithmetic;
it supersedes iteration 1's "don't touch pure helpers" wording for THIS guard only.

## Fix 3 — parity test: genuine NONZERO column-opening bank with no txn
In postings-balance-parity.test.ts, add a bank account that has a NONZERO
`opening_balance_paise` column and NO transactions/postings. `createAccount(bank,
nonzero)` seeds an is_opening txn and zeroes the column, so construct the target
state directly: create the bank with opening 0, then
`await db.update(accounts).set({ openingBalancePaise: 77_777 }).where(and(eq(accounts.id, id), eq(accounts.userId, userId)))`
(import `accounts` is already available in the test). Assert: `legacyBalance` ==
77_777; all three balance readers (bankCashBalances, accountBalancesAtDate,
listAccounts) report 77_777 for it; `accountAverageBalances` has NO entry for it
(firstActivity null → no AMB, no account-creation-date substitution); and
`findInconsistentPostings` for the user is still `[]`.

## Fix 4 — parity test: assert archived bank excluded from accountAverageBalances
In the archived-account test, also call `accountAverageBalances(db, userId, dbToday)`
and assert the archived account id is absent from the result.

## Fix 5 — parity test: compute expected bank/cash total from LEGACY, not the reader
Replace `const expectedTotal = bcb.reduce(...)` with a total summed from
independently-queried legacy balances:
```ts
let expectedTotal = 0;
for (const a of bankCashAccounts) expectedTotal += await legacyBalance(a.id, userId, dbToday);
```
then keep `assert.equal(await bankCashTotal(db, userId, dbToday), expectedTotal)`.

## Fix 6 — overflow regression tests for unsafe-INTERMEDIATE / safe-or-any final
- AMB running-balance intermediate (DETERMINISTIC — single account): seed ONE
  bank account whose per-day running balance exceeds `Number.MAX_SAFE_INTEGER`
  on an intermediate in-month day (e.g. a carried-in or day-1 delta of ~5e15
  followed by another ~5e15 delta on a later in-month day so `running` hits
  ~1e16), and assert `accountAverageBalances` throws `HttpError(500)` with
  `/safe integer/`. This proves the Fix-2 running/sum guard fires before the
  final average check. Keep amounts individually safe integers.
- `bankCashTotal` intermediate: add a test that makes a reduction step exceed the
  safe range (e.g. 3 bank accounts of +5e15, +5e15, and a negative) and assert
  `bankCashTotal` throws `HttpError(500)`. NOTE the ordering caveat: bankCashBalances
  row order is DB-scan order, so a strictly "safe-final" case may not be
  deterministically reproducible; it is acceptable for this test to prove the
  per-addition guard fires (the partial sum overflows) rather than guarantee a
  safe final — state this in a test comment. The substantive fix is the Fix-1
  per-addition guard itself.

## Iteration-2 verification (report literal output + exit codes)
1. `npm run typecheck`  2. `npm run lint`  3. `npm run test -w apps/api`
4. `node --env-file-if-exists=../../.env --test` (from apps/api) on
   postings-balance-parity.test.ts, account-balances.test.ts,
   average-balance.test.ts, and networth.test.ts.
Return the full diff of every file touched in this iteration, the literal command
outputs with pass/fail/skip counts + exit codes, and `git status --porcelain`
showing still ONLY the 5 scoped files.
