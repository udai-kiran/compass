# backend-engineer Delegation — SP1 (behavioral port: ledger account-balance contributor)

## Task
020-cross-module-ports (roadmap 1.9), sub-phase SP1. Replace the ONE genuine raw cross-domain read — the
bare-SQL `accounts`⋈`transactions` balance-at-date join that lives in the INVESTMENTS module
(`modules/investments/services/networth.ts` `computeNetWorth`, lines ~57-67) yet reads LEDGER-owned tables —
with a declared contributor function owned by the ledger module. Net-worth numbers MUST be unchanged. This
is the only AC1 deliverable; nothing else in SP1.

## Vehicle
Backend service + test code → `backend-engineer`:
`/home/udai/.claude/bin/backend-engineer tasks/020-cross-module-ports/backend-sp1-1.md "<full prompt>"`
(increment filename for repeat runs).

## Approved plan (Codex-reviewed, review-5, no blocking findings)

### P1 — add the contributor to ledger (`apps/api/src/modules/ledger/services/accounts.ts`)
Add, exported:
```ts
export interface AccountBalanceAtDate {
  type: AccountType;
  balancePaise: number;
}

export async function accountBalancesAtDate(
  db: Db,
  userId: string,
  asOf: string,
): Promise<AccountBalanceAtDate[]> {
  const res = await db.execute(sql`
    select a.type, coalesce(a.opening_balance_paise + coalesce(t.total, 0), 0)::bigint as balance
    from accounts a
    left join (
      select account_id, sum(amount_paise) as total
      from transactions
      where user_id = ${userId} and deleted_at is null and date <= ${asOf}
      group by account_id
    ) t on t.account_id = a.id
    where a.user_id = ${userId} and a.archived_at is null
  `);
  return (res.rows as Array<{ type: string; balance: string }>).map((r) => ({
    type: r.type as AccountType,
    balancePaise: Number(r.balance),
  }));
}
```
- The SQL template text must be copied BYTE-IDENTICAL from networth.ts:57-67 (whitespace and all). It contains
  THREE interpolations in this order: `${userId}` (transactions-subquery user filter), `${asOf}`, `${userId}`
  (outer accounts user filter) → bound params `[userId, asOf, userId]`. Copy all three verbatim.
- `accounts.ts` already imports `sql` from "drizzle-orm" (line 1) and `AccountType` from "@compass/shared"
  (line 8) and `Db` (line 9) and `accounts, transactions` from "../schema.ts" (line 10) — no new imports
  needed for P1. Do NOT rewrite the query with the Drizzle query builder — it MUST stay `db.execute(sql\`…\`)`
  (a builder rewrite breaks the networth.test.ts stub contract).
- Place the new export near `listAccounts` (the sibling balance-computing service) — do not disturb other code.

### P2 — consume the port in investments (`apps/api/src/modules/investments/services/networth.ts`)
In `computeNetWorth`, replace ONLY the raw query + its row-iteration source:
- DELETE the `const res = await db.execute(sql\`…\`);` block (lines ~57-67).
- Change the loop source from `for (const r of res.rows as Array<{ type: string; balance: string }>)` to:
  ```ts
  const entries = await accountBalancesAtDate(db, userId, asOf);
  ...
  for (const r of entries) {
    const bucket = ACCOUNT_BUCKET[r.type];
    if (bucket === undefined) throw new Error(`Unclassified account type in net worth: ${r.type}`);
    if (bucket === null) continue;
    const balance = r.balancePaise;
    buckets[bucket] += balance;
    accountAssets += Math.max(0, balance);
    accountLiabilities += Math.max(0, -balance);
  }
  ```
  Keep the `bucket === undefined` runtime guard EXACTLY (defensive against an unknown DB enum value). Keep
  `buckets`, `accountAssets`, `accountLiabilities`, `holdingsValue = await portfolioValue(...)`, `breakdown`,
  and the return shape all UNCHANGED.
- Add import: `import { accountBalancesAtDate } from "../../ledger/services/accounts.ts";`
- REMOVE the now-unused `sql` from the drizzle-orm import on line 2:
  `import { and, asc, eq, gte, lt, lte, sql } from "drizzle-orm";` → `import { and, asc, eq, gte, lt, lte } from "drizzle-orm";`
  (`sql` is used ONLY by the moved query — Codex confirmed no other use in the file.)

### P3 — focused unit test for accountBalancesAtDate
Add a colocated node:test (in `apps/api/src/modules/ledger/services/accounts.test.ts` if it can host it, else a
new `apps/api/src/modules/ledger/services/account-balances.test.ts`) using a STUB db (do NOT require a real DB):
- Stub `db.execute` to (a) capture the bound params and (b) return `{ rows: [ {type:"bank", balance:"150000"},
  {type:"loan", balance:"-2500000"}, {type:"investment", balance:"9007199254740993"} ] }`.
- Assert `accountBalancesAtDate(stub, "user-1", "2026-07-25")` returns
  `[{type:"bank",balancePaise:150000},{type:"loan",balancePaise:-2500000},{type:"investment",balancePaise:Number("9007199254740993")}]`
  — i.e. proves the `Number(r.balance)` conversion (including a negative and a large > MAX_SAFE_INTEGER string,
  documenting the pre-existing precision behavior) and the `r.type as AccountType` passthrough.
- Assert the bound params are EXACTLY `["user-1", "2026-07-25", "user-1"]` in that order (extract via the same
  `PgDialect().sqlToQuery(...)` params approach used in networth.test.ts, filtered to strings), proving the
  duplicate userId binding and order are preserved.
- Do NOT modify `networth.test.ts` or `networth.route.test.ts` — they must stay green as-is.

## Must NOT change
- The SQL query text, its parameters, or their order (byte-identical move — no "cleanup", no builder rewrite).
- ACCOUNT_BUCKET, bucket sums, asset/liability math, portfolioValue call, computeNetWorth return shape.
- Any other service/route, any schema, any migration (there is NO schema change in SP1).
- networth.test.ts / networth.route.test.ts contents.

## Acceptance criteria
- AC1: ledger owns `accountBalancesAtDate` (the account balance-at-date contributor); investments/networth
  consumes it instead of inlining ledger-table SQL. Net-worth numbers unchanged.
- AC6: `npm run typecheck`, `npm run lint`, `npm run test` all green; new test green; networth suites green.
- No schema/migration diff. Route snapshot unchanged (`networth.route.test.ts` green).

## Commands (capture literal invocation, output, exit code for each)
1. `npm run typecheck`
2. `npm run lint`
3. `npm run test -w apps/api` (report total pass/fail/skip; CONFIRM networth.test.ts + networth.route.test.ts
   + the new accountBalancesAtDate test all ran and passed — quote their result lines)
4. `node --test apps/api/src/modules/investments/services/networth.test.ts` (quote pass/fail counts + exit)
5. `git status --porcelain` (only accounts.ts + networth.ts + the test file should be changed/added)

## Required evidence (report back)
- Files changed/created (paths); complete diff.
- Each command's exact invocation, literal output (incl. counts), exit code.
- The new test's literal pass output + the networth suite result lines.
- Any deviation or blocker — do NOT silently change scope.
