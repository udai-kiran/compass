# Implementation review — task 021 A6 test-only follow-up

Verdict: **APPROVED / NON-BLOCKING.**

B1–B5 are genuinely closed. The decisive B5 coverage is non-vacuous with one archived posting row. I found no weakened or deleted assertion, no common-mode expected-leg calculation, no incorrect literal amount, no non-integer money fixture, and no remaining test-acceptance gap for AC1–AC7.

## B1 — CLOSED and non-vacuous

The new OLD-style test exists at [backup.test.ts:870](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.test.ts:870).

It genuinely constructs the required archive:

- Only two real accounts are included; neither has `system_kind`: [backup.test.ts:886](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.test.ts:886), [backup.test.ts:897](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.test.ts:897).
- The archive explicitly has `postings = []`: [backup.test.ts:951](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.test.ts:951).
- Ordinary, split, transfer-out, transfer-in, opening, and soft-deleted transactions are hand-built: [backup.test.ts:905](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.test.ts:905), [backup.test.ts:912](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.test.ts:912), [backup.test.ts:918](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.test.ts:918), [backup.test.ts:924](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.test.ts:924), [backup.test.ts:930](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.test.ts:930), [backup.test.ts:936](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.test.ts:936).
- Split rows and the transfer link are explicitly present: [backup.test.ts:944](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.test.ts:944), [backup.test.ts:948](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.test.ts:948).
- The restore summary requires `repaired > 0` and `failed === 0`: [backup.test.ts:974](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.test.ts:974).
- Every restored transaction is checked for a zero paise sum: [backup.test.ts:979](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.test.ts:979).
- `findInconsistentPostings` must return exactly `[]`: [backup.test.ts:993](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.test.ts:993).

The test seeds the destination’s pre-existing registration accounts before restore at [backup.test.ts:969](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.test.ts:969), but the archive itself contains no system-account rows. Thus successful post-restore resolution proves that the restore/reconcile path synthesizes the required system accounts rather than relying on archived system rows.

## B2 — CLOSED; common-mode removed

Both required tests assert exact leg multisets:

- NEW-style AC3+AC4 helper and assertions: [backup.test.ts:797](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.test.ts:797).
- OLD-style helper and assertions: [backup.test.ts:997](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.test.ts:997).

The tests resolve destination system-account IDs solely by `system_kind`: [backup.test.ts:798](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.test.ts:798), [backup.test.ts:998](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.test.ts:998). The actual and expected multisets are compared as sorted `(accountId, amountPaise)` pairs: [backup.test.ts:806](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.test.ts:806), [backup.test.ts:1006](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.test.ts:1006).

No `computePostingDraftsForTransaction` or `build*Postings` function is imported or used to calculate expectations; the relevant imports contain only reconcile/checker functions: [backup.test.ts:31](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.test.ts:31). This breaks the previously identified common mode with `findInconsistentPostings`.

All hardcoded literals are correct double-entry amounts in both tests:

- Ordinary expense: real account `-5000`, Expenses `+5000`: [backup.test.ts:816](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.test.ts:816), [backup.test.ts:1016](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.test.ts:1016).
- Split: real account `-10000`, Expenses `+6000` and `+4000`: [backup.test.ts:822](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.test.ts:822), [backup.test.ts:1022](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.test.ts:1022).
- Transfer-out: real account `-20000`, Clearing `+20000`: [backup.test.ts:829](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.test.ts:829), [backup.test.ts:1029](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.test.ts:1029).
- Transfer-in: real account `+20000`, Clearing `-20000`: [backup.test.ts:835](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.test.ts:835), [backup.test.ts:1035](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.test.ts:1035).
- Opening balance: real account `+100000`, Opening `-100000`: [backup.test.ts:841](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.test.ts:841), [backup.test.ts:1041](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.test.ts:1041).
- Soft-deleted expense: real account `-7000`, Expenses `+7000`: [backup.test.ts:847](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.test.ts:847), [backup.test.ts:1047](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.test.ts:1047).

The multiset comparison also preserves duplicate system-account legs, so the two split counterlegs cannot collapse into a set accidentally.

## B3 — CLOSED

The mocked whole-database restore fixture defines all eight posting columns, including nullable `category_id`, nullable `necessity`, and `created_at`: [backup.test.ts:213](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.test.ts:213).

The test:

- Parses the actual INSERT column order from SQL: [backup.test.ts:244](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.test.ts:244).
- Deep-equals the complete ordered list of all eight columns: [backup.test.ts:247](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.test.ts:247).
- Constructs a column-to-positional-parameter map: [backup.test.ts:251](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.test.ts:251).
- Deep-equals that map against all eight fixture values, including both nulls and `created_at`: [backup.test.ts:256](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.test.ts:256).

This is materially stronger than `.includes()` checks and detects omission, reordering, or column/value misalignment.

## B4 — CLOSED

The AC5 archive now assigns both:

- A foreign account ID: [backup.test.ts:1111](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.test.ts:1111).
- A distinct foreign, non-null category ID: [backup.test.ts:1112](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.test.ts:1112).

Both are placed in the archived posting row at [backup.test.ts:1113](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.test.ts:1113). Every destination posting is then asserted not to reference either foreign ID: [backup.test.ts:1157](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.test.ts:1157).

The test additionally requires exactly two derived postings, zero sum, and exactly one restored-real-account leg: [backup.test.ts:1152](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.test.ts:1152), [backup.test.ts:1154](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.test.ts:1154), [backup.test.ts:1162](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.test.ts:1162). The negative trust-boundary assertion is therefore not satisfied merely by producing no postings.

## B5 — CLOSED and non-vacuous

There are two B5 assertion sites:

1. The OLD-style test’s assertion remains vacuous for posting-row exclusion because `postings=[]`: [backup.test.ts:951](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.test.ts:951), [backup.test.ts:1053](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.test.ts:1053). It is harmless but cannot independently prove B5.

2. The foreign AC5 test provides the decisive non-vacuous coverage. Its archive has exactly one posting row: [backup.test.ts:1113](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.test.ts:1113). Its only non-posting rows are one account and one transaction: [backup.test.ts:1083](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.test.ts:1083), [backup.test.ts:1093](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.test.ts:1093).

Expected counts are computed while explicitly excluding `postings`: [backup.test.ts:1126](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.test.ts:1126). The captured restore summary must equal those counts for both rows and tables: [backup.test.ts:1167](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.test.ts:1167).

For the current fixture, those computed expectations are exactly:

- `summary.rows === 2`, excluding the one archived posting from `1 account + 1 transaction + 1 posting`.
- `summary.tables === 2`, counting only non-empty `accounts` and `transactions`, not `postings`.

Because `P=1`, including the archived posting in either summary count would fail the assertion. B5 is therefore genuinely non-vacuous.

## Existing assertions and scope

No existing assertion or test was weakened or deleted. The test-file diff contains two removed lines, both caused by import reformatting; it contains no removed `assert` or `test` statement. Existing NEW-style guarantees remain intact:

- Reconcile succeeds and source postings exist: [backup.test.ts:725](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.test.ts:725).
- Restore reports repairs with zero failures: [backup.test.ts:757](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.test.ts:757).
- Archived posting IDs are not reused: [backup.test.ts:765](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.test.ts:765).
- Every destination transaction remains zero-sum: [backup.test.ts:779](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.test.ts:779).
- `findInconsistentPostings` remains exactly empty: [backup.test.ts:793](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.test.ts:793).
- Soft-deleted posting synthesis remains explicitly asserted: [backup.test.ts:853](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.test.ts:853).

The follow-up is test-only: all reviewed B1–B5 changes are confined to [backup.test.ts](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.test.ts). No production behavior is introduced by these assertions or fixtures.

All money values remain integer paise. The representative fixtures and literal expectations use signed integer values such as `-5000`, `-10000`, `-6000`, `-4000`, `±20000`, `100000`, and `-7000`: [backup.test.ts:640](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.test.ts:640), [backup.test.ts:654](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.test.ts:654), [backup.test.ts:665](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.test.ts:665), [backup.test.ts:670](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.test.ts:670), [backup.test.ts:698](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.test.ts:698), [backup.test.ts:711](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.test.ts:711).

## Final disposition

**B1, B2, B3, B4, and B5 are all genuinely closed.** The only P=0 B5 assertion is the retained OLD-style check; it is supplemented by the required decisive P=1 assertion and does not leave a gap. There is no remaining vacuous/common-mode acceptance assertion affecting the disposition, no incorrect expected literal, and no remaining BLOCKING test-acceptance gap for AC1–AC7.

Runtime note: an attempted direct execution of `backup.test.ts` in this review environment stopped at the file’s explicit `DATABASE_URL` prerequisite at [backup.test.ts:336](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.test.ts:336); it did not reach the tests. That is an environment limitation, not a source or acceptance-coverage defect.