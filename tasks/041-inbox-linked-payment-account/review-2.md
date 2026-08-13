## Review findings

### Medium — `AccountSchema.linkedAccountId` is incorrectly optional

[ledger.ts:196](/home/udai/common/compass/packages/shared/src/schemas/ledger.ts:196) defines:

```ts
linkedAccountId: z.uuid().nullable().optional()
```

TASK.md explicitly requires `z.uuid().nullable()` for response objects. Since `toAccount` always emits either a UUID or `null`, there is no compatibility need for optionality.

Making it optional weakens both the runtime API contract and inferred `Account` type: a response accidentally omitting the field would pass validation, undermining AC1 and allowing `undefined` throughout consumers. This should be required in `AccountSchema`; it should remain optional only in `UpdateAccountSchema`.

## Everything else reviewed as correct

- P1: Self-referential FK uses `AnyPgColumn` correctly with `ON DELETE SET NULL`.
- P2: Migration and generated metadata correctly add the nullable column and FK.
- P3: Restore defers both `goal_id` and `linked_account_id`.
- P4: Update schema is correct; response schema has the optionality issue above.
- P5: `toAccount` explicitly emits `linkedAccountId`, normalized to `null`.
- P6:
  - Non-credit-card resulting type rejected with 400.
  - Linked credit cards, archived accounts, and system accounts rejected with 400.
  - Lookup is constrained by `userId`, enforcing ownership.
  - Missing or other-user targets produce 404 without disclosing ownership.
  - Link writes and lifecycle clearing occur inside the transaction.
  - Type changes away from `credit_card` clear the account’s own link.
  - Archiving/type-change clears same-user dependent links.
- P7: Settings section is credit-card-only, supports save and clear, and filters open non-credit-card accounts. System accounts cannot appear because `useAccounts()` is backed by `listAccounts()`, which excludes them.
- P8: Inbox effect has exactly the requested stable dependencies:
  `[accountId, selectedAccount?.linkedAccountId]`.
  It pre-fills, resets on account changes, and preserves manual changes during unrelated renders.
- AC7 is satisfied by the migration’s `ON DELETE SET NULL`.
- `git diff --check` reports no whitespace errors.

There is a wording conflict inside TASK.md: AC3 groups missing/different-user targets under 400, while the detailed API requirements explicitly require missing targets to return 404. The implementation follows the more specific 404 requirement and preserves secure non-enumerating ownership behavior.

I did not execute typecheck or tests because the review harness requires strictly read-only operation and those commands may create caches or build artifacts. Static inspection found no other regression.