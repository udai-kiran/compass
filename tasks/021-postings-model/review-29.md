NOTE: No BLOCKING findings.

NOTE: In `apps/api/src/modules/system/services/prefs.ts`, `Number(t.amount_paise)` and `Number.isSafeInteger(amount)` now run before `db.insert(alertLedger)` in `evaluateLargeTransactions`, so unsafe amounts throw before the dedupe ledger write and will not suppress future notifications.

NOTE: The remaining function flow is correct: only newly inserted ledger rows create notifications, duplicate ledger rows continue to skip, and `fired` is incremented only after notification creation.

NOTE: No other issues found in this file from this targeted review.