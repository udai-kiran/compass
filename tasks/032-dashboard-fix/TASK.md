# Task: 032-dashboard-fix

## Status
COMPLETE

## Objective
Fix HTTP 500 on GET /api/dashboard — every dashboard load returns 500 and the
page never renders.

## Root Cause
`listTransactions` builds a totals CTE with a raw `db.execute(sql\`...\`)`.
Inside that CTE the `transactions` table is aliased as `t`. The Drizzle-generated
`${where}` expression (from `filterWhere`) references columns by their full table
name — `"transactions"."user_id"`, `"transactions"."deleted_at"` — not the alias.
PostgreSQL rejects this with:
```
invalid reference to FROM-clause entry for table "transactions"
```
Stack: `listTransactions` → `getDashboard` (Promise.all index 3).

## Scope
- `apps/api/src/modules/ledger/services/transactions.ts` — totals CTE only
  (lines ~342–368)

## Dependencies
None

## Plan
- P1: Remove the `t` alias from `from transactions t` in the totals CTE.
       Replace every `t.id` reference in the correlated subqueries with
       `transactions.id`. The `${where}` clause then correctly resolves against
       the unaliased table name that Drizzle generates.

## Acceptance Criteria
- AC1: `GET /api/dashboard` returns 200, not 500.
- AC2: The totals CTE has no `t` alias — `from transactions` only.
- AC3: All `t.id` references in the subqueries replaced with `transactions.id`.
- AC4: `npm run typecheck` exits 0.
- AC5: `npm run lint` exits 0.
- AC6: No other files changed.

## Verification
- T1: Read the changed hunk — confirm alias removed, `transactions.id` used.
- T2: typecheck + lint literal output + exit code.

## Non-Goals
- Any other change to `listTransactions` (cursor logic, ordering, hydrate, etc.)
