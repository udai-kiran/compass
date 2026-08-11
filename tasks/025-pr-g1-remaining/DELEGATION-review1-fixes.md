# Delegation: Review-1 BLOCKING fixes (B1, B2, B3)

## Task
025 — PR-G1 remaining (review-1 blocking fixes)

## Context
Codex review-1.md found 3 BLOCKING issues in the already-applied batch 1 + test changes.
All three must be fixed before the task can be COMPLETE.

## Files to change
1. `apps/api/src/modules/ledger/services/reconcile-postings.test.ts` — B1 and B2
2. `apps/api/src/modules/credit/services/cards.ts` — B3

## Required changes

### B1 — Add the missing non-zero-sum test to reconcile-postings.test.ts

Read the full file. The file currently has 4 tests but the plan requires a test for
`findInconsistentPostings` reporting a non-zero-sum error. Add this test BETWEEN the
"reports 'no postings'" test (test #2) and the "tenant-scope" test (test #3).

First, add `postings` to the db/schema import on line 5:
- Change: `import { accounts, categories, transactions, users } from "../../../db/schema.ts";`
- To: `import { accounts, categories, postings, transactions, users } from "../../../db/schema.ts";`

Then add this test between test #2 and test #3:
```typescript
test("findInconsistentPostings: reports non-zero-sum for postings that don't balance", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  await seedSystemAccounts(db, userId);
  const acct = await createAccount(db, userId, { name: "Bank", type: "bank", institution: null, accountLast4: null, holderName: null, currency: "INR", openingBalancePaise: 0 });
  // Raw-insert a transaction and a single posting with no counterpart — sum is non-zero
  const [txn] = await db
    .insert(transactions)
    .values({ userId, accountId: acct.id, date: "2026-01-02", amountPaise: -2000, merchant: "Unbalanced" })
    .returning({ id: transactions.id });
  await db.insert(postings).values({
    transactionId: txn!.id,
    accountId: acct.id,
    userId,
    amountPaise: -2000,
  });
  const problems = await findInconsistentPostings(db, userId);
  const problem = problems.find((p) => p.transactionId === txn!.id);
  assert.ok(problem, "findInconsistentPostings must report the non-zero-sum transaction");
  assert.ok(
    problem!.reason.includes("not zero"),
    `expected 'not zero' in reason, got: ${problem!.reason}`,
  );
});
```

### B2 — Strengthen the idempotence test to verify counts

In the last test ("reprojectAllLegacyColumns: idempotent..."), after the two `assert.equal(*.failures.length, 0)` lines, add:
```typescript
  assert.ok(first.checked >= 1, "must have checked at least one transaction");
  assert.equal(second.checked, first.checked, "second call must check the same number of transactions (idempotent)");
```

### B3 — Fix cards.ts getCardActivity to use counter-posting lateral

Read `apps/api/src/modules/credit/services/cards.ts`. Find the `getCardActivity` function
and the raw SQL query around line 342. The query currently selects `t.category_id` from
transactions, which violates AC5 (legacy column read).

Replace the SQL query:
```sql
select t.id, t.date, t.merchant, t.reconciled_statement_id, t.category_id, p.amount_paise
from postings p
join transactions t on t.id = p.transaction_id
where p.account_id = ${accountId}
  and t.user_id = ${userId} and t.deleted_at is null
  and t.date >= ${fromInclusive} and t.date <= ${ref}
order by t.date desc, t.id desc
```

With (adding a counter-posting lateral for the category):
```sql
select t.id, t.date, t.merchant, t.reconciled_statement_id, cat.category_id, p.amount_paise
from postings p
join transactions t on t.id = p.transaction_id
left join lateral (
  select cp.category_id
  from postings cp
  join accounts ca on ca.id = cp.account_id and ca.system_kind is not null and ca.user_id = t.user_id
  where cp.transaction_id = t.id and cp.category_id is not null
  limit 1
) cat on true
where p.account_id = ${accountId}
  and t.user_id = ${userId} and t.deleted_at is null
  and t.date >= ${fromInclusive} and t.date <= ${ref}
order by t.date desc, t.id desc
```

The raw row type at lines ~351-358 already declares `category_id: string | null` — that field stays the same. No other change needed in cards.ts beyond this SQL substitution.

**IMPORTANT:** Do NOT add any new imports to cards.ts — the `accounts` table is already imported.

## Must not change
- Any file not listed above
- Any other part of cards.ts besides the SQL query described
- Any other test in reconcile-postings.test.ts besides what is described

## Acceptance criteria
- `npm run typecheck` exits 0
- `npm run lint` exits 0
- reconcile-postings.test.ts has 5 tests (was 4): the non-zero-sum test is present
- `t.category_id` no longer appears in the `getCardActivity` SQL in cards.ts

## Commands
1. Read each file before editing
2. Make the changes described
3. Run `npm run typecheck` and capture output + exit code
4. Run `npm run lint` and capture output + exit code

## Required evidence
Write findings to `/home/udai/common/compass/tasks/025-pr-g1-remaining/implementation-review1-fixes.md`.
Include:
- Files changed
- Complete diff for each file
- Exact typecheck output + exit code
- Exact lint output + exit code
