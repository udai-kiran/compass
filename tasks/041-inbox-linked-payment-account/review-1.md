## Review findings

### High severity

1. Backup restore will break unless the new self-reference is deferred.

Full and per-user restores insert `accounts` one row at a time. If an account references another account that has not yet been inserted, the immediate FK fails. Add `linked_account_id` to `DEFERRED_RESTORE_COLUMNS.accounts` in [restore.ts](/home/udai/common/compass/apps/api/src/db/restore.ts:9), alongside `goal_id`.

This also requires updating the restore tests in `apps/api/src/modules/system/services/backup.test.ts`. `ALL_TABLES` itself needs no change because no table is being added.

2. The invariant can become invalid after creation.

The proposed validation checks the relationship only when `linkedAccountId` is set. Later, the linked paying account can be:

- archived;
- changed to `credit_card`;
- potentially changed into another unsuitable account type.

Likewise, the card can be changed away from `credit_card` while retaining the link. The plan must define whether `updateAccount` blocks those edits or automatically clears affected links. Without this, Inbox preselects a value that `acceptRepayment` later rejects.

This should be handled transactionally under the existing account lock pattern in [accounts.ts](/home/udai/common/compass/apps/api/src/modules/ledger/services/accounts.ts:371).

### Medium severity

3. The proposed Inbox effect can retain or overwrite the wrong selection.

The plan says to set state “when `selectedAccount.linkedAccountId` is present.” It must also reset to `""` when the selected account has no link; otherwise switching from a linked card to an unlinked card preserves the old payer.

The effect should depend on stable values such as `accountId` and `selectedAccount?.linkedAccountId`, not the entire account object. Otherwise query-cache refreshes can overwrite a user’s manual dropdown change.

4. `listAccounts` does not need an explicit SELECT-column change.

It selects the complete account row through:

```ts
.select({ account: accounts, ... })
```

in [accounts.ts](/home/udai/common/compass/apps/api/src/modules/ledger/services/accounts.ts:190). Adding the Drizzle column automatically places it in `account`.

What does need changing is `toAccount`, which explicitly maps the public DTO and currently omits the new field.

5. The planned HTTP status conflicts with existing conventions.

The plan says invalid account types should return 422. Existing account/domain validation consistently uses 400, including the repayment validation in [transfer-classification.ts](/home/udai/common/compass/apps/api/src/modules/ingest/services/transfer-classification.ts:202). Unless the API intentionally introduces a new convention, these failures should be 400. Foreign or nonexistent linked accounts should remain indistinguishable as 404.

6. “Bank account” and “non-credit-card account” are not equivalent.

The objective and UI copy describe a bank account, but the proposed validation and the existing repayment endpoint permit every non-credit-card type—including cash, investments, loans, PPF, and so on.

Choose one invariant:

- If it truly means bank account, use the shared `isBankAccount` predicate in API validation and UI filtering.
- If compatibility with `acceptRepayment` is intended, call it a “paying account” and acknowledge that all open non-card accounts are valid.

The settings dropdown and Inbox dropdown should follow the same rule as the server.

7. System accounts must be excluded during validation.

Ownership alone is insufficient because internal Expenses/Income/Opening/Clearing rows share the user ID. Public account operations conventionally require `systemKind IS NULL`; `updateAccount` itself enforces this for the edited account. The linked-account lookup should do the same.

### Missing test scope

The plan’s “no existing tests broken” criterion is insufficient. New behavior needs direct tests for:

- schema parsing of nullable and optional `linkedAccountId`;
- API response mapping from `toAccount`;
- setting and clearing the link;
- foreign-user and nonexistent account rejection;
- linked credit-card rejection;
- archived linked-account rejection;
- internal system-account rejection;
- attempting to set a link on a non-card;
- changing a linked card away from `credit_card`;
- archiving or changing the type of an account used by cards;
- deletion producing `NULL`;
- restore where a card precedes its linked account in backup row order;
- Inbox initialization, switching linked → unlinked cards, and manual override behavior;
- settings candidate filtering and clearing the selection.

There are no `packages/shared/src/**/*.test.ts` deep-equality tests over `AccountSchema`, `AccountWithBalanceSchema`, or `UpdateAccountSchema` that currently require fixture updates. The cited deep-equality concern does not materialize in that directory. Other API/web fixtures typed as `Account` may still fail compilation once `AccountSchema` gains a required output field, so typecheck remains important.

### Confirmed implementation assumptions

- The table is `accounts`, with snake-case SQL columns such as `user_id`, `account_last4`, `goal_id`, `archived_at`, and `system_kind`.
- Existing direct FKs include `user_id → users.id` and nullable `goal_id → goals.id ON DELETE SET NULL`.
- A nullable self-referential FK is plausible. Drizzle may require an `AnyPgColumn` return annotation, as already used for cyclic references in [hubs.ts](/home/udai/common/compass/apps/api/src/db/shared/hubs.ts:107).
- `AccountSchema` uses camel-case DTO fields. `AccountWithBalanceSchema` extends it, so the new field propagates automatically.
- `UpdateAccountSchema` has partial-patch semantics through individually optional fields.
- PATCH `/api/accounts/:id` does use `UpdateAccountSchema` and returns `AccountSchema`.
- `updateAccount` spreads remaining schema fields into `.set()`, so after destructuring, the new field does not need bespoke assignment; it needs validation and lifecycle-invariant handling.
- The credit-card-specific guard in Account Detail is exactly `account.type === "credit_card"`.
- `DraftCard` currently initializes `payingAccountId` to `""`; eligibility is credit draft plus currently selected credit-card account.
- Inbox already receives only open accounts, so archived choices are absent there.

### Regression and compatibility risks

- Adding a required `linkedAccountId` to `AccountSchema` makes all serialized accounts require the property. Every account-producing mapper must be checked, not just `listAccounts`.
- Older backups remain compatible because a missing nullable column defaults to null. New backups require deferred restoration.
- A database FK prevents dangling IDs but does not enforce same-user ownership or account type. The service validation is therefore security-critical.
- A user can PATCH arbitrary UUIDs, so validation must occur server-side even though the settings select only displays owned accounts.
- Clearing should be explicitly supported with `{ linkedAccountId: null }`, including after the card’s type changes if that transition is otherwise blocked.
- The settings component should synchronize its local state after successful mutations, following existing Account Detail section conventions.

### Unnecessary complexity

An explicit `listAccounts` SELECT addition is unnecessary because the whole `accounts` row is already selected. A new table or changes to `card_details` are also unnecessary. The core-column design is reasonable, provided restore handling and reverse lifecycle invariants are added.