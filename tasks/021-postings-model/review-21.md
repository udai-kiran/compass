# Verdict: APPROVED

All six BLOCKING findings from review-20 are resolved. PB1–PB4 and PB7 remain correct, the out-of-scope readers are unchanged, and AC1–AC5 now hold.

## Required-fix verification

1. **`bankCashTotal` intermediate additions — RESOLVED**

   `bankCashTotal` now uses an explicit loop. Every `total += r.balancePaise` is immediately followed by `Number.isSafeInteger(total)`, throwing `HttpError(500)` on failure. It no longer checks only the completed reduction.

2. **AMB accumulated arithmetic — RESOLVED**

   `sumDailyClosingPaise` now checks both additions on every day:

   - `running += dailyDelta`
   - `sum += running`

   Each unsafe result throws `HttpError(500)` with the required safe-integer message. Safe-input behavior remains unchanged; the existing average-balance tests and full API suite pass.

3. **Nonzero column-opening bank with no transaction — RESOLVED**

   The parity fixture now creates a bank with opening zero and directly updates `accounts.opening_balance_paise` to `77_777`, without creating any transaction or posting.

   Coverage confirms:

   - the independent legacy formula returns `77_777`;
   - `bankCashBalances` returns `77_777`;
   - `accountBalancesAtDate` includes the correct result through the complete legacy-versus-postings multiset comparison;
   - `listAccounts` returns `77_777`;
   - `accountAverageBalances` contains no entry;
   - `findInconsistentPostings` remains empty.

4. **Archived-account AMB exclusion — RESOLVED**

   The archived-account test now calls `accountAverageBalances` and explicitly asserts that the archived account ID is absent.

5. **Independent bank/cash total expectation — RESOLVED**

   `expectedTotal` is now accumulated from calls to the test-local `legacyBalance`, which directly queries the legacy `accounts` and `transactions` tables. It is no longer derived from `bankCashBalances`.

6. **Unsafe-intermediate regression coverage — RESOLVED**

   Regression tests now exist for both paths:

   - `bankCashTotal` rejects a cross-account partial sum that exceeds the safe-integer range.
   - AMB rejects unsafe arithmetic during the daily-closing walk.

   The AMB fixture’s carried balance can make the accumulated daily-closing `sum` unsafe before the later transaction makes `running` unsafe. Thus the test definitively exercises the new per-addition AMB protection, though it does not isolate the `running` guard specifically. Both guards are directly present in the implementation, so this is not a blocking coverage gap.

## Bank/cash row-order caveat

The documented caveat is an acceptable resolution.

Because `bankCashBalances` has no deterministic row ordering, a mixed-sign safe-final fixture could avoid overflow depending on scan order. Using two `+5e15` balances and a small negative keeps the mathematical total unsafe under every ordering and deterministically proves that the per-addition reduction guard throws.

This does not independently demonstrate unsafe-intermediate/safe-final cancellation, but the implementation itself unambiguously checks every addition. Given the nondeterministic input order and the iteration-2 instructions explicitly permitting this form of test, there is no residual BLOCKING gap.

## PB-item re-verification

- **PB1 — PASS:** Converted real-account components continue to sum `postings.amount_paise` keyed to the real account.
- **PB2 — PASS:** `opening_balance_paise` remains an explicit addend in every applicable balance path.
- **PB3 — PASS:** System-account postings cannot enter the converted balances.
- **PB4 — PASS:** Posting aggregates join their parent transactions and retain the parent user, deletion, and date predicates.
- **PB5 — PASS:** Parity coverage now includes the genuine nonzero column-opening bank, archived AMB behavior, and an independently computed legacy total.
- **PB6 — PASS:** Direct combinations, reduction partial sums, AMB running balances, and AMB daily-closing sums are guarded with `HttpError(500)`.
- **PB7 — PASS:** No changes exist in:
  - `planning/services/insights.ts`
  - `credit/services/cards.ts`
  - `credit/services/reconciliation-reads.ts`
  - `investments/services/networth.ts`

No regression was found in the previously approved query conversions or `listAccounts` left-join behavior.

## Acceptance criteria

- **AC1: PASS**
- **AC2: PASS**
- **AC3: PASS**
- **AC4: PASS**
- **AC5: PASS**

Verification performed:

- `npm run typecheck` — exit 0
- `npm run lint` — exit 0
- Focused four-file test run — 67 passed, 0 failed, 0 skipped; exit 0
- `npm run test -w apps/api` — 925 tests, 924 passed, 0 failed, 1 skipped; exit 0

No remaining BLOCKING findings.