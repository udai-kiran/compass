# Sonnet Worker Delegation — Iteration 1

## Task
038-epf-opening-balance-save

## Approved Plan
- P1: Add `openingTransactionPaise: z.number().int()` to `AccountWithBalanceSchema`
  in `packages/shared/src/schemas/ledger.ts` (no `.default(0)` — it must be present in every API response).
- P2: In `listAccounts` in `apps/api/src/modules/ledger/services/accounts.ts`:
  - Add a second aggregate expression alongside the existing `postingSum`:
    ```ts
    openingTxnPaise: sql<number>`coalesce(sum(${postings.amountPaise}) filter (
      where ${transactions.isOpening} = true
        and ${transactions.deletedAt} is null
        and ${transactions.userId} = ${userId}
    ), 0)::bigint`,
    ```
  - Destructure it in the `.map(({ account, postingSum, openingTxnPaise, subtype }) => ...)`.
  - Add a `Number.isSafeInteger` guard on `openingTxnPaise` (identical pattern to the existing guard on `sum`).
  - Include it in the returned shape as `openingTransactionPaise: Number(openingTxnPaise)`.
- P3: In `apps/web/src/routes/settings/AccountDetailPage.tsx`, update `OpeningBalanceSection`:
  - Change the `useState` initialiser: `openingBalanceToInput(account.openingTransactionPaise, account.type)`
  - Change the `useEffect` to update `text` from `account.openingTransactionPaise`
    (deps: `[account.openingTransactionPaise, account.type]`)
  - Change the `dirty` check: `parsed !== account.openingTransactionPaise`
  - Update the section hint to:
    "What this account held before your first recorded transaction. Set it
    once — it becomes a dated ledger entry so your running balance is right."
  - The mutation body (`update.mutate({ id, openingBalancePaise: parsed })`) is
    unchanged — the API still receives `openingBalancePaise` in the PATCH body.
- P4 (test fixture): In `apps/web/src/routes/accounts/account-groups.test.ts`,
  add `openingTransactionPaise: 0` to the `account()` factory default object
  (line ~15, alongside `openingBalancePaise: 0`).

## Files and Symbols
- `packages/shared/src/schemas/ledger.ts` — `AccountWithBalanceSchema` (lines ~200-205)
- `apps/api/src/modules/ledger/services/accounts.ts` — `listAccounts` (lines ~190-224)
- `apps/web/src/routes/settings/AccountDetailPage.tsx` — `OpeningBalanceSection` (lines ~297-369)
- `apps/web/src/routes/accounts/account-groups.test.ts` — `account()` factory (line ~6-22)

## Required Changes

### `packages/shared/src/schemas/ledger.ts`
```ts
export const AccountWithBalanceSchema = AccountSchema.extend({
  balancePaise: z.number().int(),
  openingTransactionPaise: z.number().int(),  // ← ADD THIS
  /** Bank subtype (savings/current/…) when the account carries bank details; else null. */
  subtype: BankAccountSubtypeSchema.nullable().default(null),
});
```

### `apps/api/src/modules/ledger/services/accounts.ts`
In `listAccounts`, the `.select({ ... })` block becomes:
```ts
{
  account: accounts,
  postingSum: sql<number>`coalesce(sum(${postings.amountPaise}) filter (where ${transactions.deletedAt} is null and ${transactions.date} <= current_date and ${transactions.userId} = ${userId}), 0)::bigint`,
  openingTxnPaise: sql<number>`coalesce(sum(${postings.amountPaise}) filter (where ${transactions.isOpening} = true and ${transactions.deletedAt} is null and ${transactions.userId} = ${userId}), 0)::bigint`,
  subtype: bankDetails.subtype,
}
```

In the `.map(...)`:
```ts
return rows.map(({ account, postingSum, openingTxnPaise, subtype }) => {
  const sum = Number(postingSum);
  if (!Number.isSafeInteger(sum)) {
    throw new HttpError(500, "Balance aggregate exceeded a safe integer — refusing to lose paise");
  }
  const balancePaise = sum;
  if (!Number.isSafeInteger(balancePaise)) {
    throw new HttpError(500, "Balance aggregate exceeded a safe integer — refusing to lose paise");
  }
  const openingTransactionPaise = Number(openingTxnPaise);
  if (!Number.isSafeInteger(openingTransactionPaise)) {
    throw new HttpError(500, "Opening aggregate exceeded a safe integer — refusing to lose paise");
  }
  return {
    ...toAccount(account),
    balancePaise,
    openingTransactionPaise,
    subtype: subtype ?? null,
  };
});
```

### `apps/web/src/routes/settings/AccountDetailPage.tsx` — OpeningBalanceSection
Change the seeding:
```tsx
// BEFORE:
const [text, setText] = useState(() => openingBalanceToInput(account.openingBalancePaise, account.type));
useEffect(() => {
  setText(openingBalanceToInput(account.openingBalancePaise, account.type));
}, [account.openingBalancePaise, account.type]);
const parsed = openingBalanceFromInput(text, account.type);
const error = parsed === null ? "must be an amount in rupees" : null;
const dirty = parsed !== null && parsed !== account.openingBalancePaise;

// AFTER:
const [text, setText] = useState(() => openingBalanceToInput(account.openingTransactionPaise, account.type));
useEffect(() => {
  setText(openingBalanceToInput(account.openingTransactionPaise, account.type));
}, [account.openingTransactionPaise, account.type]);
const parsed = openingBalanceFromInput(text, account.type);
const error = parsed === null ? "must be an amount in rupees" : null;
const dirty = parsed !== null && parsed !== account.openingTransactionPaise;
```

The `Section` hint:
```tsx
// BEFORE:
hint="What this account held before your first recorded transaction. Set it when the ledger starts mid-life, so balances aren't short by the amount carried in."

// AFTER:
hint="What this account held before your first recorded transaction. Set it once — it becomes a dated ledger entry so your running balance is right."
```

### `apps/web/src/routes/accounts/account-groups.test.ts`
```ts
const account = (overrides: Partial<AccountWithBalance> = {}): AccountWithBalance => ({
  // ... existing fields ...
  openingBalancePaise: 0,
  openingTransactionPaise: 0,   // ← ADD THIS
  goalId: null,
  // ...
});
```

## Must Not Change
- The PATCH mutation body: it must still send `openingBalancePaise` (not `openingTransactionPaise`) — the API field name is unchanged
- `RetirementSection`, `EpfOpeningSection` (doesn't exist yet), `RecordEpfModal`
- Any migration files or DB schema

## Acceptance Criteria
- AC1: `openingTransactionPaise` is in the API response for every account
- AC2: After saving EPF opening balance, the field shows the saved value on reload
- AC3: `npm run typecheck` exits 0
- AC4: `npm run lint` exits 0
- AC5: `npm run test -w apps/api` exits 0
- AC6: `npm run test -w packages/shared` exits 0
- AC7: `npm run test -w apps/web` exits 0

## Commands to run
1. `npm run typecheck` from repo root
2. `npm run lint` from repo root
3. `npm run test -w apps/api`
4. `npm run test -w packages/shared`
5. `npm run test -w apps/web`

## Required Evidence
- List of files changed
- Complete `git diff`
- Literal output + exit code of all 5 commands
- Any deviations from the plan or blockers
