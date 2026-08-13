# Implementation 1 — 041-inbox-linked-payment-account

## Files Changed

| File | Change |
|------|--------|
| `apps/api/src/db/shared/hubs.ts` | Added `linkedAccountId` self-referential FK column to `accounts` table |
| `apps/api/src/db/restore.ts` | Added `"linked_account_id"` to `DEFERRED_RESTORE_COLUMNS.accounts` |
| `packages/shared/src/schemas/ledger.ts` | Added `linkedAccountId` to `AccountSchema` and `UpdateAccountSchema` |
| `apps/api/src/modules/ledger/services/accounts.ts` | Updated `toAccount`, added validation + lifecycle clearing to `updateAccount` |
| `apps/web/src/routes/settings/AccountDetailPage.tsx` | Added `LinkedPaymentAccountSection` component for credit card accounts |
| `apps/web/src/routes/inbox/InboxPage.tsx` | Added `useEffect` import and hook in `DraftCard` to sync `payingAccountId` |
| `apps/api/drizzle/0068_mean_sentinel.sql` | Generated migration (new file) |

## Implementation Details

### P1 — `apps/api/src/db/shared/hubs.ts`

Added after `goalId`:
```ts
/** For credit_card accounts: the bank account normally used to pay this card's bill. */
linkedAccountId: uuid("linked_account_id")
  .references((): AnyPgColumn => accounts.id, { onDelete: "set null" }),
```
`AnyPgColumn` was already imported. The column is nullable (no `.notNull()`). The self-referential FK is handled via the `(): AnyPgColumn =>` thunk pattern matching the existing `goalId` style.

### P2 — Migration SQL content (`apps/api/drizzle/0068_mean_sentinel.sql`)

```sql
ALTER TABLE "accounts" ADD COLUMN "linked_account_id" uuid;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_linked_account_id_accounts_id_fk" FOREIGN KEY ("linked_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;
```

The `accounts` table now shows 17 columns and 3 FKs (up from 2 FKs).

### P3 — `apps/api/src/db/restore.ts`

Changed:
```ts
accounts: ["goal_id"],
```
to:
```ts
accounts: ["goal_id", "linked_account_id"],
```

### P4 — `packages/shared/src/schemas/ledger.ts`

`AccountSchema` — added:
```ts
/** For credit_card accounts: the bank account normally used to pay this card's bill. */
linkedAccountId: z.uuid().nullable().optional(),
```

`UpdateAccountSchema` — added:
```ts
linkedAccountId: z.uuid().nullable().optional(),
```

**Deviation from plan:** The DELEGATION specified `z.uuid().nullable()` (required field) in `AccountSchema`. Changed to `.optional()` because two existing web test files (`account-groups.test.ts` and `repayment-eligibility.test.ts`) create object literals of type `AccountWithBalance`/`Account` via `({ ..., ...overrides })` spreads where `overrides: Partial<Account>`. Without `.optional()`, TypeScript infers `linkedAccountId` as `string | null | undefined` from the `Partial` spread and rejects the assignment to `string | null`. Adding `.optional()` makes the field `string | null | undefined` in the type, satisfying both the existing tests and AC8 (typecheck passes). The wire format is unaffected — `toAccount` always returns `linkedAccountId: row.linkedAccountId ?? null` so the JSON response always carries the field as `null` or a UUID string.

### P5 — `toAccount` in `apps/api/src/modules/ledger/services/accounts.ts`

Added `linkedAccountId: row.linkedAccountId ?? null` after `goalId`:
```ts
goalId: row.goalId,
linkedAccountId: row.linkedAccountId ?? null,
sortOrder: row.sortOrder,
```

### P6 — `updateAccount` in `apps/api/src/modules/ledger/services/accounts.ts`

**`typeChangingAwayFromCreditCard` variable** — added right after `archiving`:
```ts
const typeChangingAwayFromCreditCard = typeChanged && current.type === "credit_card" && nextType !== "credit_card";
```

**`linkedAccountId` validation block** — inserted after the `accountLast4` check, before the opening balance section:
```ts
if (input.linkedAccountId !== undefined && input.linkedAccountId !== null) {
  if (nextType !== "credit_card") {
    throw new HttpError(400, "Only credit card accounts can have a linked payment account");
  }
  const [linkedAcct] = await tx
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, input.linkedAccountId), eq(accounts.userId, userId)));
  if (!linkedAcct) throw new HttpError(404, "Linked account not found");
  if (linkedAcct.systemKind !== null) throw new HttpError(400, "Cannot link to a system account");
  if (linkedAcct.type === "credit_card") throw new HttpError(400, "Linked account cannot be a credit card");
  if (linkedAcct.archivedAt !== null) throw new HttpError(400, "Linked account is archived");
}
```

Used `tx.select().from(accounts)` instead of `tx.query.accounts.findFirst()` to match the existing patterns in the function.

**Main `set()` call** — added lifecycle override spread (after `...fields`):
```ts
...(typeChangingAwayFromCreditCard ? { linkedAccountId: null } : {}),
```

The `linkedAccountId` from `fields` (if provided in the patch) passes through automatically via `...fields`. The override only fires when the type is changing away from `credit_card`, in which case the card's own link must be cleared regardless of any patch value.

**Lifecycle clearing** — added after the main `update...returning()` block:
```ts
if (archiving || typeChangingAwayFromCreditCard) {
  await tx
    .update(accounts)
    .set({ linkedAccountId: null })
    .where(and(eq(accounts.linkedAccountId, id), eq(accounts.userId, userId)));
}
```

### P7 — `apps/web/src/routes/settings/AccountDetailPage.tsx`

Added `LinkedPaymentAccountSection` component before the existing `Section` function:
```tsx
function LinkedPaymentAccountSection({ account }: { account: AccountWithBalance }) {
  const { data: allAccounts } = useAccounts();
  const { update } = useAccountMutations();
  const [linkedAccountId, setLinkedAccountId] = useState(account.linkedAccountId ?? "");

  useEffect(() => {
    setLinkedAccountId(account.linkedAccountId ?? "");
  }, [account.linkedAccountId]);

  const candidates = (allAccounts ?? []).filter(
    (a) => a.archivedAt === null && a.type !== "credit_card" && a.id !== account.id,
  );
  const dirty = linkedAccountId !== (account.linkedAccountId ?? "");

  function save(e: FormEvent) {
    e.preventDefault();
    update.mutate(
      { id: account.id, linkedAccountId: linkedAccountId || null },
      { onSuccess: () => toast(linkedAccountId ? "Default paying account saved" : "Default paying account cleared", "success") },
    );
  }

  return (
    <form onSubmit={save}>
      <Section title="Default paying account" hint="Pre-fills the paying account in the inbox when this card's bill payment arrives.">
        <Field label="Paying account">
          <select value={linkedAccountId} onChange={(e) => setLinkedAccountId(e.target.value)} className={inputClass}>
            <option value="">No default</option>
            {candidates.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </Field>
        <div className="pt-1">
          <SaveButton dirty={dirty} disabled={false} pending={update.isPending} />
        </div>
      </Section>
    </form>
  );
}
```

Called `useAccounts()` inside the section component (not passing it as a prop from `AccountDetail`) since `AccountDetail` already has access to it from `AccountDetailPage` but doesn't expose it. This avoids prop drilling.

In `AccountDetail`, added:
```tsx
{account.type === "credit_card" && <LinkedPaymentAccountSection account={account} />}
```
after `StatementPasswordSection`.

### P8 — `apps/web/src/routes/inbox/InboxPage.tsx`

Changed import:
```tsx
import { useEffect, useState } from "react";
```

Added in `DraftCard` after the existing state/derived variables:
```tsx
useEffect(() => {
  setPayingAccountId(selectedAccount?.linkedAccountId ?? "");
}, [accountId, selectedAccount?.linkedAccountId]);
```

## Commands Run

### db:generate
```
DATABASE_URL=postgresql://compass:dummy@localhost:5432/compass npm run db:generate
```

Output:
```
> compass@0.1.0 db:generate
> npm run db:generate -w apps/api

> @compass/api@0.1.0 db:generate
> node --env-file-if-exists=../../.env ../../node_modules/drizzle-kit/bin.cjs generate

../../.env not found. Continuing without it.
No config path provided, using default 'drizzle.config.ts'
Reading config file '/home/udai/common/compass/apps/api/drizzle.config.ts'
52 tables
...
accounts 17 columns 2 indexes 3 fks
...
[✓] Your SQL migration file ➜ drizzle/0068_mean_sentinel.sql 🚀
```

Exit code: 0

### typecheck
```
npm run typecheck
```

Output:
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
```

Exit code: **0** — all workspaces pass.

### test
```
npm run test
```

Exit code: **1** (due to DB-backed tests requiring `DATABASE_URL`)

Test counts per workspace:

| Workspace | Tests | Pass | Fail | Skip |
|-----------|-------|------|------|------|
| `@compass/api` | 673 | 646 | 26 | 1 |
| `@compass/extractor` | 63 | 62 | 1 | 0 |
| `@compass/ingestor` | 12 | 12 | 0 | 0 |
| `@compass/shared` | 264 | 264 | 0 | 0 |
| `@compass/web` | 32 | 32 | 0 | 0 |
| `@compass/ai` | 212 | 212 | 0 | 0 |

All 27 failing tests (26 in `@compass/api` + 1 in `@compass/extractor`) are **pre-existing database-backed tests** that early-exit with:
```
Error: <test>.ts needs DATABASE_URL set (a real Postgres/Redis-backed ...) — export it (see apps/api/.env) before running
```

No new test failures introduced. Non-DB tests: 1214 passing across all workspaces.

## Assumptions

- The self-referential FK `references((): AnyPgColumn => accounts.id, { onDelete: "set null" })` is correct for Drizzle — confirmed by the `goalId` pattern (same file, same syntax using `AnyPgColumn`).
- `db:generate` with a dummy `DATABASE_URL` is valid per CLAUDE.md: "offline schema diff — no DB connection needed to generate".
- The 27 DB-backed test failures are pre-existing and unrelated to this implementation.
- Using `.optional()` on `AccountSchema.linkedAccountId` is the correct deviation — the alternative (leaving it `.nullable()` without `.optional()`) breaks existing test files that cannot be modified, violating AC8.

## Unresolved Risks

- The `backup.test.ts` has a non-DB check for `ALL_TABLES` / `USER_TABLES` coverage. This check could only run here if `DATABASE_URL` were set (the test early-exits before reaching it). The `accounts` table is already listed in `ALL_TABLES` in `backup.ts` — I only added a column, not a new table — so the check should pass when a DB is available.
- `linkedAccountId` is typed `string | null | undefined` in `Account`/`AccountWithBalance` due to the `.optional()` deviation. Web callers that check for truthiness (`account.linkedAccountId ?? ""`) handle all three states correctly, but strict equality checks against `null` (e.g., `linkedAccountId === null`) would miss the `undefined` case. No such strict checks exist in this implementation.
