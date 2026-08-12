## Finding

- **High — EPF EPS can still be clobbered when retirement-details loading fails.** In [AccountDetailPage.tsx:927](/home/udai/common/compass/apps/web/src/routes/settings/AccountDetailPage.tsx:927), `data?.epsBalancePaise ?? null` preserves EPS only after a successful query. On an initial query error, `isPending` becomes false while `data` remains `undefined`; the form becomes editable, and saving a rate/UAN sends `null`, potentially erasing an existing EPS balance. Gate submission/Save on `data !== undefined`, treating `null` as the valid “no row exists” result.

## Review notes

1. `retResolved = retData !== undefined` correctly distinguishes pending/error (`undefined`) from a resolved absent row (`null`).

2. The `retData === null` dirty check is correct: absent EPS is normalized to `0`, matching blank EPS input.

3. `sequencePending` covers the full chain. Both the first mutation’s `onError` and both outcomes of the second mutation clear it.

4. `retData?.annualRateBps ?? 0` and the reference fallback are safe in `EpfOpeningSection` because submission is guarded by `retResolved`; for a resolved `null`, defaults are appropriate when creating the row.

5. Defining `parseEpsInput` inside the component only recreates a small function per render. This has no practical correctness or performance concern.

6. P1–P3 are implemented as specified, apart from the unresolved-query preservation gap above.

7. No PPF/SSY regression found. They retain the generic opening-balance flow, maturity editing, and continue sending `epsBalancePaise: null` as required.

8. `npm run typecheck` and `npm run lint` both pass.