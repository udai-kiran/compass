All 7 workspaces pass typecheck with zero errors.

---

## Summary of changes

**Three files changed, exactly as scoped in SP1:**

### P1: `apps/api/src/modules/ledger/services/accounts.ts`
- Added `AccountBalanceAtDate` interface and `accountBalancesAtDate()` function (placed before `listAccounts`). The function runs the identical SQL — `db.execute(sql`…`)` with the same three interpolations `[userId, asOf, userId]` — that was previously inlined in `networth.ts`, and maps the raw rows to typed `AccountBalanceAtDate[]`. No new imports were needed.

### P2: `apps/api/src/modules/investments/services/networth.ts`
- Removed `sql` from the `drizzle-orm` import (now unused).
- Added `import { accountBalancesAtDate } from "../../ledger/services/accounts.ts"`.
- Deleted the `const res = await db.execute(sql`…`)` block (was lines 57–67) and replaced the loop body to source from `const entries = await accountBalancesAtDate(db, userId, asOf)`, consuming `r.balancePaise` (already a number) instead of `Number(r.balance)`. The `buckets` initialization, `ACCOUNT_BUCKET` lookup, `bucket === undefined` guard, asset/liability math, and return shape are all unchanged.

### P3: `apps/api/src/modules/ledger/services/account-balances.test.ts`
- New colocated `node:test` file using a stub `db.execute` that captures the SQL clause. Verifies:
  - The returned balances (including negative values and a value > `Number.MAX_SAFE_INTEGER`) match expected typed output.
  - `PgDialect().sqlToQuery(clause)` extracts bound string params in the order `['user-1', '2026-07-25', 'user-1']`, proving the duplicate `userId` interpolation and param order are preserved.

**Verification:** All 885 tests pass (0 failures), and all 7 workspaces pass `tsc --noEmit` with zero errors.
