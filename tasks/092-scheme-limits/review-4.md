Not implementation-ready yet.

## High

- [TASK.md:28](/work/personal/compass/tasks/092-scheme-limits/TASK.md:28) still requires `transaction.type = 'opening_balance'`, directly contradicting the corrected section at line 108 and AC8. The `transactions` table has no `type` column ([ledger.ts:22](/work/personal/compass/apps/api/src/db/shared/ledger.ts:22)); opening balances are structurally identified through an `opening` system-account posting, matching [accounts.ts:199](/work/personal/compass/apps/api/src/modules/ledger/services/accounts.ts:199). Remove or rewrite the stale bullet.

## Medium

- The NPS response contract remains contradictory. [TASK.md:80](/work/personal/compass/tasks/092-scheme-limits/TASK.md:80) says NPS has no `eligible80CPaise` field, while the declared result and AC4 require the field to exist with `null` ([TASK.md:96](/work/personal/compass/tasks/092-scheme-limits/TASK.md:96), [TASK.md:159](/work/personal/compass/tasks/092-scheme-limits/TASK.md:159)). The requested review-3 contract is the latter; stale “no field” wording should say “present and null.”

- `SchemeRules.deductionSection` still requires choosing one of `80CCD1` or `80CCD1B` for NPS ([TASK.md:72](/work/personal/compass/tasks/092-scheme-limits/TASK.md:72)), despite CCD allocation being explicitly deferred. No valid NPS value is specified. Remove this property for this task, make it neutral/nullable, or define a non-allocation value.

- P8’s “cross-user transaction excluded” test does not verify the new `accountNpsDetails.userId` join predicate. Add a distinct test where a user-owned NPS account has a mismatched-user detail row and assert `data_missing`. The database permits this mismatch because `accountId` and `userId` are independent columns ([schema.ts:44](/work/personal/compass/apps/api/src/modules/investments/schema.ts:44)).

## Low

- [TASK.md:35](/work/personal/compass/tasks/092-scheme-limits/TASK.md:35) still says to “join … and filter `tier='tier_i'`,” which can be read as a `WHERE` filter that drops missing details. Align it explicitly with the later `LEFT JOIN` instructions: join with user scoping, then classify null/Tier II/Tier I after retrieval.

Confirmed correct:

- `accountNpsDetails` has `accountId`, its own `userId`, and `tier` columns as assumed.
- P2 correctly targets `packages/shared/src/schemas/ledger.ts`.
- `fyRange()` returns `[string, string]` inclusive ISO dates.
- AC4 otherwise has the requested equality and no CCD allocation fields.
- AC8 and the corrected query describe structural opening-balance exclusion.
- P8 includes missing scheme date, Tier II, missing detail, soft-deleted transaction, cross-user transaction, and opening-balance cases.