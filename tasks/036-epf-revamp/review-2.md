## Finding

- **Medium — invalid numeric text is accepted.** [RecordEpfModal.tsx](/home/udai/common/compass/apps/web/src/routes/transactions/RecordEpfModal.tsx:12) uses `parseFloat`, which accepts numeric prefixes. Inputs such as `100abc` or `1.2.3` become valid contributions instead of `NaN`. `autoFill` has the same problem at line 45. Validate the complete trimmed string, e.g. with `Number(s)` plus `Number.isFinite`.

## Review results

- P1–P4 are correctly implemented.
- P5 is complete except for the parser correctness issue above.
- `SafePaiseSchema` is correctly imported from `../money.ts`, applied to all three fields, and refined to nonnegative values.
- `superRefine` rejects both all-zero and unsafe aggregate totals.
- Service sums all three components and correctly prepends formatted breakdown notes for blank and custom-note cases.
- Route emits `ledger.mutated` after successful recording.
- Tests cover every field’s negative, fractional, Infinity, NaN, and unsafe values; individual zeros; all-zero; unsafe aggregate; valid values; balance sum; and both notes cases.
- UI uses the correct EPS cap of `125_000` paise and computes ER as employer 12% minus EPS. Live total is present.
- `npm run typecheck` and `npm run lint` both pass.
- DB-backed tests were inspected but not executed because they require the configured PostgreSQL test database.

No other correctness or regression issues found.