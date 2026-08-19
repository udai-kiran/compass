# EPF EPS Double-Edit Bug — Investigation 1

## Files Inspected

- `apps/web/src/routes/settings/AccountDetailPage.tsx` (full file, 1117 lines)
- `apps/web/src/lib/account-detail-queries.ts` (full file, 94 lines)
- `apps/api/src/modules/protection/routes/retirement.ts` (31 lines)
- `apps/api/src/modules/protection/services/retirement.ts` (77 lines)
- `packages/shared/src/schemas/wealth.ts` (lines 64–86)

---

## 1. Component Rendering Order for an EPF Account

`AccountDetail` (line 87) renders, in sequence:

```tsx
// line 109–113
{account.type === "epf" ? (
  <EpfOpeningSection account={account} />
) : (
  <OpeningBalanceSection account={account} />
)}
// line 119
{isRetirementAccount(account.type) && <RetirementSection key={account.type} account={account} />}
```

EPF is a retirement account (`isRetirementAccount("epf") === true`), so **both**
`EpfOpeningSection` AND `RetirementSection` are rendered simultaneously on the
EPF account detail page.

---

## 2. EpfOpeningSection — epsBalancePaise surface #1

**Location:** lines 435–602  
**EPS input field:** line 565–578 — "Of which, EPS" label  
**Mutation invocation:** lines 511–529

```tsx
saveRetirement.mutate(
  {
    annualRateBps: retData?.annualRateBps ?? 0,
    maturityDate: null,           // EPF never has a maturity date
    referenceNumber: retData?.referenceNumber ?? "",
    epsBalancePaise: epsPaise,    // ← USER-ENTERED value
  },
  { ... }
);
```

`epsPaise` is derived from the user's input in `epsText` state via `parseEpsInput()`
(lines 466–475). This component owns the EPS editing UI.

The save is a two-step sequence (lines 506–534): first `update.mutate()` saves the
account opening balance, then on success `saveRetirement.mutate()` saves retirement
details including the EPS value.

---

## 3. RetirementSection — epsBalancePaise surface #2

**Location:** lines 953–1041  
**EPS input field:** NONE — no EPS input is rendered  
**Mutation invocation:** lines 983–992

```tsx
save.mutate(
  {
    annualRateBps: rateBps,
    maturityDate: isEpf ? null : maturity || null,
    referenceNumber: reference.trim(),
    epsBalancePaise: isEpf ? (data?.epsBalancePaise ?? null) : null,  // ← PASS-THROUGH
  },
  { onSuccess: () => toast("Details saved", "success") },
);
```

`data` is the result of `useRetirementDetails(account.id, true)` — the React Query
cache. When `RetirementSection` saves (for any reason: rate change, UAN edit), it
re-sends the EPS value it loaded from cache.

The guard at lines 981–983 prevents submitting when `data === undefined` (fetch
errored) specifically to avoid wiping EPS:

```tsx
// If the EPF retirement-details query errored, data is undefined; submitting
// would send epsBalancePaise: null and silently erase the stored EPS value.
if (isEpf && data === undefined) return;
```

---

## 4. The Race / Stale-Cache Risk

**Scenario that produces data loss:**

1. User opens EPF account detail page. Both sections load. `data.epsBalancePaise`
   in `RetirementSection` is, say, 5000000 (₹50,000).

2. User goes to `EpfOpeningSection`, types a new EPS value of 6000000 (₹60,000),
   and clicks Save.
   - `EpfOpeningSection.saveRetirement.mutate()` fires with `epsBalancePaise: 6000000`.
   - `useRetirementDetailsMutation.onSuccess` invalidates the
     `["retirement-details", accountId]` query.
   - React Query refetches. If the refetch completes, `RetirementSection`'s `data`
     updates to `epsBalancePaise: 6000000`.

3. If `RetirementSection`'s query has NOT yet re-fetched (network latency, or user
   acts quickly), `data.epsBalancePaise` is still 5000000.

4. User then edits the interest rate in `RetirementSection` and clicks Save.
   `RetirementSection.save.mutate()` fires with `epsBalancePaise: 5000000` — the
   stale value — and overwrites the new ₹60,000 EPS value with ₹50,000.

Even without a race, the issue is structural: **two components independently write
the same field** via the same API endpoint (`PUT /api/retirement/:accountId/details`).

---

## 5. useRetirementDetailsMutation Hook

**Location:** `apps/web/src/lib/account-detail-queries.ts` lines 50–57

```ts
export function useRetirementDetailsMutation(accountId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpsertRetirementDetails) =>
      apiPut(`/api/retirement/${accountId}/details`, RetirementDetailsSchema, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["retirement-details", accountId] }),
  });
}
```

Both `EpfOpeningSection` (line 438) and `RetirementSection` (line 955) call
`useRetirementDetailsMutation(account.id)` — they get independent mutation
instances that both target `PUT /api/retirement/:accountId/details`.

---

## 6. API Endpoint

**Route:** `PUT /api/retirement/:accountId/details`  
**File:** `apps/api/src/modules/protection/routes/retirement.ts` lines 18–29  
**Body schema:** `UpsertRetirementDetailsSchema` (from `@compass/shared`)

```ts
UpsertRetirementDetailsSchema = z.object({
  annualRateBps: z.number().int().min(0).max(10000).default(0),
  maturityDate: z.iso.date().nullable().default(null),
  referenceNumber: z.string().default(""),
  epsBalancePaise: z.number().int().min(0).nullable().default(null),
})
```

The service (`upsertRetirementDetails`, lines 54–77) does a single upsert on the
`retirement_details` table. **All four fields are written atomically in one SQL
statement** — there is no partial-update path. Whichever caller fires last wins.

The service does enforce `epsBalancePaise: null` for non-EPF types (line 67), but
it makes no distinction between callers for EPF — both writes are accepted as-is.

---

## 7. Exact Lines Where epsBalancePaise Is Written

| Component | Line | Value |
|---|---|---|
| `EpfOpeningSection` | 515 | `epsBalancePaise: epsPaise` (user-entered, parsed from `epsText`) |
| `RetirementSection` | 989 | `epsBalancePaise: isEpf ? (data?.epsBalancePaise ?? null) : null` (cache pass-through) |

---

## 8. Recommendation for P1 — Which Component Should Own EPS

**`EpfOpeningSection` should be the sole owner of `epsBalancePaise`.**

Rationale:
- `EpfOpeningSection` is EPF-specific and already has the EPS input field with
  validation logic (`parseEpsInput`, corpus-exceeds-total check). This is the
  correct conceptual home for the EPS figure — it is part of the opening balance
  decomposition (Total = EPF corpus + EPS).
- `RetirementSection` handles scheme metadata (rate, UAN, maturity). EPS is not
  scheme metadata; it is a balance component. Its pass-through of `epsBalancePaise`
  is a workaround to avoid wiping the value, not a real ownership claim.

**Fix:** In `RetirementSection.submit()` (line 983), remove `epsBalancePaise`
from the mutation payload entirely — do not send it. The API endpoint should then
be modified (or a separate partial-update endpoint created) so that
`RetirementSection` only writes `{annualRateBps, maturityDate, referenceNumber}`.

Alternatively, as a minimal patch without an API change: change `RetirementSection`
to always omit `epsBalancePaise` from the EPF path and require the API service to
preserve the existing DB value rather than overwrite it with the payload's null.
The cleanest long-term fix is a partial-update API (PATCH semantics or separate
fields), but the immediate P1 is: **stop `RetirementSection` from sending
`epsBalancePaise` at all for EPF accounts**.
