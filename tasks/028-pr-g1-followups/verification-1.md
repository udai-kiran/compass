# Verification-1 — fix/pr-g1-followups

## 1. git status

Branch: `fix/pr-g1-followups` — confirmed.

Modified files (7, exactly the expected set):

```
modified:   apps/api/src/lib/account-lock.ts
modified:   apps/api/src/lib/postings-periods-parity.test.ts
modified:   apps/api/src/modules/credit/services/card-due-tasks.test.ts
modified:   apps/api/src/modules/credit/services/reconciliation-writes.test.ts
modified:   apps/api/src/modules/ledger/services/accounts.ts
modified:   apps/api/src/modules/ledger/services/postings-balance-parity.test.ts
modified:   apps/api/src/modules/planning/services/postings-planning-parity.test.ts
```

Untracked: pnpm-lock.yaml, tasks/021-*, tasks/025-*, tasks/026-*, tasks/027-*, tasks/028-* (not part of this change set).

## 2. git diff --stat HEAD

```
 apps/api/src/lib/account-lock.ts                   |   2 +-
 apps/api/src/lib/postings-periods-parity.test.ts   |  35 +++++--
 .../modules/credit/services/card-due-tasks.test.ts |  12 +--
 .../credit/services/reconciliation-writes.test.ts  | 106 ++++++++++++++++++---
 apps/api/src/modules/ledger/services/accounts.ts   |   3 +-
 .../services/postings-balance-parity.test.ts       |  10 +-
 .../services/postings-planning-parity.test.ts      |  42 +++++---
 7 files changed, 159 insertions(+), 51 deletions(-)
```

## 3. npm run typecheck

```
> compass@0.1.0 typecheck
> npm run typecheck --workspaces --if-present
[... all 7 workspaces ran tsc --noEmit with no output ...]
EXIT:0
```

## 4. npm run lint

```
> compass@0.1.0 lint
> eslint .
EXIT:0
```

## 5. .only( / .skip( in changed test files

Command: `grep -Fn ".only(" <all 5 test files>`
Result: **none**

Command: `grep -Fn ".skip(" <all 5 test files>`
Result: **none**

## 6. console.log / TODO / FIXME / debugger in changed files

Command: `grep -Fn "console.log" <all 7 changed files>`
Result: **none**

Command: `grep -Fn "TODO\|FIXME\|debugger" <all 7 changed files>`
Result: **none**

## 7. transfer_links in parity test files

```
apps/api/src/modules/planning/services/postings-planning-parity.test.ts:33: * rather than a `transfer_links` lookup; `transfer_links` is never populated
apps/api/src/modules/planning/services/postings-planning-parity.test.ts:81:  // Deleting transactions cascades to: postings, transaction_splits, transfer_links.
apps/api/src/lib/postings-periods-parity.test.ts:29: * a `transfer_links` lookup, because `transfer_links` is never populated under
apps/api/src/lib/postings-periods-parity.test.ts:65:  // Deleting transactions cascades to: postings, transaction_splits, transfer_links.
apps/api/src/lib/postings-periods-parity.test.ts:700:  // Assert no transfer_links rows for either EMI transaction
apps/api/src/lib/postings-periods-parity.test.ts:703:    from transfer_links tl
apps/api/src/lib/postings-periods-parity.test.ts:707:  assert.equal((tlRes.rows[0] as { cnt: number }).cnt, 0, "no transfer_links for EMI ordinary transactions");
```

Analysis: hits on lines 33, 81, 29, 65 are **comments only**. The hit at lines 700-707 in
`postings-periods-parity.test.ts` is a **negative-assertion query** — it runs
`SELECT count(*) FROM transfer_links ...` and asserts the count equals 0. This is NOT a
live computation query that uses transfer_links to derive results; it proves transfer_links
is deliberately empty under the EMI path.

The diff confirms that the **live computation queries** in both files (`legacySpentByCategory`,
`legacySpendByNecessity` in periods-parity; `legNonSplit`/`legMerchant`/`buildReport` leg in
planning-parity) had their
`and not exists (select 1 from transfer_links tl where ...)` clauses replaced with a
postings-based equivalent:

```sql
and not (
  (select count(*) from postings pr join accounts ar on ar.id = pr.account_id
   where pr.transaction_id = t.id and ar.system_kind is null) = 2
  and
  (select count(*) from postings ps join accounts asys on asys.id = ps.account_id
   where ps.transaction_id = t.id and asys.system_kind is not null) = 0
)
```

## 8. Raw SQL UPDATE transactions SET date

Command: `grep -Fn "UPDATE transactions SET date" reconciliation-writes.test.ts card-due-tasks.test.ts`
Result: **none**

The diff confirms both hacks were removed:
- `reconciliation-writes.test.ts` lines 117-126: raw UPDATE removed; replaced by
  `createCardAccount(userId, -2000000, "2020-01-01")`.
- `card-due-tasks.test.ts` lines 787-794: raw UPDATE removed; replaced by
  `createCardAccount(userId, "Opening balance card", -300000, undefined, "2020-01-01")`.

## 9. updateAccount import in reconciliation-writes.test.ts

```
10: import { createAccount, listAccounts, updateAccount } from "../../ledger/services/accounts.ts";
646: test("absorbCarryover: a concurrent advisory lock (an opening-balance edit in progress via updateAccount's new protocol) blocks absorb until it commits — the final state matches a serial order", async (t) => {
755: test("absorbCarryover advisory lock blocks concurrent updateAccount — integration proof with real callers", async (t) => {
775:   // read, before the account-row UPDATE). We pause there to ensure updateAccount
```

Import present and used in new test at line 755.

## 10. account-lock.ts fn type

```
17:  * `fn` should start a transaction via `lockedDb.transaction(...)`. The lock
28:   fn: (lockedDb: Omit<Db, '$client'>) => Promise<T>,
34:   const lockedDb = drizzle(client, { schema }) as unknown as Db;
52:     return await fn(lockedDb);
```

The diff shows the change from `fn: (lockedDb: Db) => Promise<T>` to
`fn: (lockedDb: Omit<Db, '$client'>) => Promise<T>`. Implementation still passes
`lockedDb` (the PoolClient-backed Drizzle instance) unchanged; the type now reflects
that the inner Drizzle instance lacks `$client` (which belongs only to the pool-level `Db`).

---

## accounts.ts: openingDate parameter

The diff adds `openingDate?: string` to `createAccount` and passes it as:

```ts
date: openingDate ?? new Date().toISOString().slice(0, 10),
```

This eliminates the wall-clock date bomb: callers that need a deterministic opening date
now pass it explicitly; the default remains "today" for production paths.

---

## Acceptance Criteria Summary

| # | Criterion | Result |
|---|-----------|--------|
| AC1 | Branch is fix/pr-g1-followups; exactly 7 expected files modified | PASS |
| AC2 | `npm run typecheck` exits 0 | PASS |
| AC3 | `npm run lint` exits 0 | PASS |
| AC4 | No `.only(` or `.skip(` in any changed test file | PASS |
| AC5 | No `console.log` / `TODO` / `FIXME` / `debugger` in changed files | PASS |
| AC6 | `transfer_links` removed from all live computation queries (replaced with postings-based equivalent); only comments and one zero-count assertion remain | PASS |
| AC7 | No raw `UPDATE transactions SET date` SQL in credit test files | PASS |
| AC8 | `updateAccount` imported in `reconciliation-writes.test.ts` and used in new integration test | PASS |
| AC9 | `account-lock.ts` fn type narrowed to `Omit<Db, '$client'>` | PASS |

All 9 acceptance criteria PASS. No failing issues found.
