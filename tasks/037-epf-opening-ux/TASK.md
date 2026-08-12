# Task: EPF opening-balance UX — two-field section

## Status
COMPLETE

## Codex review-1 findings addressed
- **Critical**: `RetirementSection` submit must preserve EPS even after removing the
  editing UI. Pass `epsBalancePaise: isEpf ? (data?.epsBalancePaise ?? null) : null`
  through — never omit it or default to null destructively.
- **High (load race)**: Gate the whole `EpfOpeningSection` on retirement details having
  resolved. While `retIsPending`, render a loading placeholder. While `retData` is
  `undefined` (error or not yet arrived), disable Save. Build the retirement payload
  only from resolved `retData`; never fall back to `?? 0`/`?? ""` on an unresolved query.
- **High (atomicity)**: Add a `sequencePending` local boolean flag. Set it true on
  submit, clear it in both `onSuccess` and `onError` of the second mutation. Disable
  Save while `sequencePending` is true. Show "Saved balance but EPS failed" on second-
  mutation error. This prevents double-submit and surfaces partial failure.
- **Medium (EPS parser)**: Use a strict parser matching `openingBalanceFromInput`'s
  precision checks — decimal notation only, at most two decimal places, safe integer.
- **Medium (server sync)**: Follow the existing `RetirementSection` pattern — seed
  epsText in a `useEffect` on `retData` change; totalText follows `account.openingBalancePaise`.
  This matches what the existing forms already do.

## Objective
For EPF accounts, replace the generic single "Opening balance" field with a
dedicated two-field section that matches how the EPFO passbook presents the
opening corpus:

```
Opening balance
─────────────────────────────────────────
 Total PF balance   ₹ ___________   ← openingBalancePaise (EPF + EPS combined)
 Of which, EPS      ₹ ___________   ← epsBalancePaise (informational sub-figure)
 EPF corpus         ₹ X,XX,XXX      ← derived read-only (total − EPS)

Hint: Enter figures from your EPFO passbook.
      Total = Member PF account + Pension (EPS) account.
```

The "EPS corpus" field is removed from the "Scheme details" section for EPF
accounts (it moves to this opening section).

## Root Cause
Two UX problems:
1. **Discoverability**: the EPS corpus field lives in "Scheme details", separate
   from opening balance. Users setting up an EPF account miss it entirely, so the
   opening EPS corpus is never entered, understating net worth.
2. **Inconsistency**: ongoing "Record EPF" contributions correctly include EPS in
   the account balance (totalPaise = EE + ER + EPS). The opening balance does not
   guide users to include EPS, so pre-Compass EPS history is silently missing
   from net worth.

## Scope
Single file: `apps/web/src/routes/settings/AccountDetailPage.tsx`

- Add `EpfOpeningSection` component (replaces `OpeningBalanceSection` for EPF)
- Modify `AccountDetail` render: for `type === "epf"` render `EpfOpeningSection`,
  else render `OpeningBalanceSection`
- Modify `RetirementSection`: remove the EPS field block for EPF accounts
  (the `{isEpf && <Field label="EPS balance">…</Field>}` block)

## Dependencies
Task 036 (EPF revamp) — complete.

## Plan

### P1 — New `EpfOpeningSection` component

State:
- `totalText` — string for `openingBalancePaise` input (₹)
- `epsText`   — string for `epsBalancePaise` input (₹)

Data loading:
- Use existing `useRetirementDetails(account.id, true)` to read current EPS value
- Use existing `useRetirementDetailsMutation(account.id)` to save EPS
- Use existing `useAccountMutations().update` to save opening balance

Seed from server:
- `totalText` ← `openingBalanceToInput(account.openingBalancePaise, account.type)` (same as current)
- `epsText` ← `(retDetails.epsBalancePaise / 100).toFixed(2).replace(/\.00$/, "")` or `""`

Derived values (computed on every render):
- `totalPaise` ← `openingBalanceFromInput(totalText, account.type)` (null = invalid)
- `epsPaise`   ← blank → 0; else `Math.round(Number(epsText) * 100)` (NaN if invalid)
- `epfCorpusPaise` ← `totalPaise − epsPaise` (shown only when both valid)

Validation:
- `totalError`: `totalPaise === null ? "must be an amount in rupees" : null`
- `epsError`:   `!Number.isFinite(epsPaise) || epsPaise < 0 ? "must be ≥ 0" : null`
- `corpusError`: `epfCorpusPaise !== null && epfCorpusPaise < 0 ? "EPS cannot exceed total" : null`
- Submit disabled when any error or neither field changed

`dirty`:
- `(totalPaise !== null && totalPaise !== account.openingBalancePaise) ||`
- `(epsValid && epsPaise !== (retDetails?.epsBalancePaise ?? 0))`

Save (chained mutations — not Promise.all to preserve react-query state):
```ts
update.mutate(
  { id: account.id, openingBalancePaise: totalPaise },
  {
    onSuccess: () =>
      saveRetirement.mutate(
        {
          annualRateBps:    retDetails?.annualRateBps    ?? 0,
          maturityDate:     null,          // EPF never has maturity
          referenceNumber:  retDetails?.referenceNumber  ?? "",
          epsBalancePaise:  epsPaise,
        },
        { onSuccess: () => toast("Opening balance saved", "success") },
      ),
  },
);
```

`isPending`: `update.isPending || saveRetirement.isPending`

Layout:
```
Section title="Opening balance"
  hint="Enter figures from your EPFO passbook.
        Total = Member PF account + Pension (EPS) combined."

  Field label="Total PF balance" error={totalError}
    ₹ <input totalText>

  Field label="Of which, EPS" error={epsError || corpusError}
    ₹ <input epsText>
    hint below: "Pension (EPS) corpus — informational; not double-counted"

  DerivedRow label="EPF corpus"
    value = epfCorpusPaise != null && epfCorpusPaise >= 0
              ? formatINR(epfCorpusPaise)
              : "—"
    hint="total minus EPS — EE + ER share"

  DerivedRow label="Current balance"
    value={formatINR(account.balancePaise)}
    hint="opening balance plus every contribution"

  SaveButton dirty={dirty} disabled={hasError} pending={isPending}
```

### P2 — Wire into `AccountDetail`

In `AccountDetail`:
```tsx
{account.type === "epf"
  ? <EpfOpeningSection account={account} />
  : <OpeningBalanceSection account={account} />}
```

### P3 — Remove EPS editing from `RetirementSection`, preserve value on save

Remove: `eps` state, `setEps`, the `epsText` effect assignment, the `epsPaise`
derived var, `epsError`, the dirty clause `(isEpf && epsPaise !== ...)`, the
`<Field label="EPS balance">` JSX block, and the `epsError` disabled condition.

Keep `isEpf` — it still controls maturity field, label copy, placeholder text,
and the submit payload.

In the submit body, change the retirement payload to preserve the loaded EPS value
instead of sending a new one:
```ts
epsBalancePaise: isEpf ? (data?.epsBalancePaise ?? null) : null,
```
This way saving the interest rate or UAN from Scheme Details never clobbers the
EPS balance that is now maintained from `EpfOpeningSection`.

## Acceptance Criteria
- AC1: EPF account detail page shows the two-field opening section (Total + EPS),
  not the old single field.
- AC2: "Scheme details" section for EPF no longer shows an EPS balance field.
- AC3: All other account types (PPF, SSY, bank, etc.) still show the original
  single-field `OpeningBalanceSection`.
- AC4: Saving updates both `openingBalancePaise` (account) and `epsBalancePaise`
  (retirement details) — chained, not parallel.
- AC5: EPF corpus derived row = total − EPS, shown only when both are valid and
  non-negative.
- AC6: `npm run typecheck` and `npm run lint` exit 0.

## Verification
- T1: `npm run typecheck` exits 0
- T2: `npm run lint` exits 0
- T3: Diff confirms EPS field removed from `RetirementSection` for EPF
- T4: Diff confirms `EpfOpeningSection` rendered for `type === "epf"` in `AccountDetail`
- T5: No changes outside `AccountDetailPage.tsx`

## Non-Goals
- No backend schema changes
- No change to `SettingsPage.tsx` quick-create form
- No change to net worth computation (opening balance column already drives it;
  telling users to enter the total correctly is the fix)
- No change to PPF or SSY account handling
