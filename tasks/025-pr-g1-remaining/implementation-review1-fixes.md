# Review-1 Fixes — Implementation Evidence

## Files Changed

1. `apps/api/src/modules/ledger/services/reconcile-postings.test.ts` — B1 and B2
2. `apps/api/src/modules/credit/services/cards.ts` — B3

---

## B1 — Add `postings` import + non-zero-sum test

### Change 1: import line (line 5)

Before:
```
import { accounts, categories, transactions, users } from "../../../db/schema.ts";
```
After:
```
import { accounts, categories, postings, transactions, users } from "../../../db/schema.ts";
```

### Change 2: new test inserted between test #2 and test #3

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

**Note:** The delegation snippet included `userId` in the `postings` insert. The `postings` table has no `userId` column (verified from `apps/api/src/db/shared/ledger.ts` lines 132–153). `userId` was removed from the insert to fix the typecheck error.

---

## B2 — Strengthen idempotence test count assertions

Added after the two `assert.equal(*.failures.length, 0)` lines in the last test:

```typescript
  assert.ok(first.checked >= 1, "must have checked at least one transaction");
  assert.equal(second.checked, first.checked, "second call must check the same number of transactions (idempotent)");
```

---

## B3 — Fix cards.ts getCardActivity counter-posting lateral

### SQL replaced in `getCardActivity` (~line 342)

Before:
```sql
select t.id, t.date, t.merchant, t.reconciled_statement_id, t.category_id, p.amount_paise
from postings p
join transactions t on t.id = p.transaction_id
where p.account_id = ${accountId}
  and t.user_id = ${userId} and t.deleted_at is null
  and t.date >= ${fromInclusive} and t.date <= ${ref}
order by t.date desc, t.id desc
```

After:
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

No new imports added. The `accounts` table was already imported.

---

## Commands Run

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

EXIT: 0
```

### `npm run lint`

```
> compass@0.1.0 lint
> eslint .

EXIT: 0
```

---

## Assumptions

- The `postings` table genuinely has no `userId` column (confirmed from schema source at `apps/api/src/db/shared/ledger.ts:132–153`). The delegation snippet's `userId` field was an error in the brief; removing it is the correct fix.

## Unresolved Risks

- None. The test logic is sound: the non-zero-sum posting will still be detected because `findInconsistentPostings` checks the sum of postings per transaction, and a single posting of -2000 does not sum to zero.
