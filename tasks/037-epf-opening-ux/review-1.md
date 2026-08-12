## Review findings

### Critical — `RetirementSection` would erase the moved EPS value

The retirement-details endpoint is a full upsert. If the proposed submit branch is simply removed, omitting `epsBalancePaise` applies the schema default `null`; explicitly sending `null` does the same. Consequently, saving EPF interest rate or UAN after entering EPS in the new section will erase EPS.

Remove `eps`, `setEps`, `epsPaise`, `epsError`, their effect assignment, dirty clause, field block, and validation clause—but preserve the loaded value when submitting:

```ts
epsBalancePaise: isEpf ? (data?.epsBalancePaise ?? null) : null,
```

`isEpf` must remain because it still controls maturity, labels, placeholders, hints, and this preservation behavior. PPF/SSY remain correct with `epsBalancePaise: null`.

### High — Saving before retirement details load can clobber existing fields

The new section’s dirty comparison treats unresolved data as EPS `0`, and its payload defaults unresolved rate/reference to `0`/`""`. If the user changes the total before the query finishes, Save becomes enabled and can overwrite a saved interest rate, UAN, and EPS.

The section should distinguish:

- `undefined`: query unresolved; do not seed, compare, or save.
- `null`: query resolved and no details row exists; defaults are safe.
- object: preserve its values.

Disable Save while the query is pending/fetching or errored. Build the payload only from resolved data. A query error must not be treated as “no details.”

Also ensure the seeding effect does not overwrite an EPS edit made while a background refetch completes. Gating editing until initial load is the simplest solution.

### High — The two saves are ordered but not atomic

Calling `saveRetirement.mutate` from `update.mutate`’s per-call `onSuccess` is supported by TanStack Query and correctly ensures the second request starts only after the first succeeds. There is no React state-closure problem for an ordinary single submission.

However:

- If the account update succeeds and retirement save fails, the result is partially saved.
- Retrying writes the account again, which is generally harmless.
- The account mutation invalidates retirement details before starting the retirement mutation, creating an unnecessary intermediate refetch. The retirement mutation invalidates it again afterward.
- `RetirementSection` has a separate mutation instance, so its Save button remains enabled. Concurrent saves from the two sections can race, and because each PUT replaces all retirement fields, last writer wins.

The UI should prevent concurrent detail writes, or preferably avoid two independently writable forms targeting the same full-replacement resource. True all-or-nothing saving requires a backend transactional endpoint; chaining cannot provide atomicity.

### Medium — EPS parsing is weaker than opening-balance parsing

This expression:

```ts
Math.round(Number(epsText) * 100)
```

accepts inputs such as scientific notation, whitespace as zero, and more than two decimal places, silently rounding them. It also lacks a safe-integer check. That differs from `openingBalanceFromInput`, which deliberately enforces currency precision and safe values.

Use the same strict amount parser or equivalent validation: trimmed blank → zero, decimal notation only, at most two decimal places, finite non-negative paise, and `Number.isSafeInteger`.

### Medium — “Both fields filled” does not match blank-as-zero behavior

With blank inputs mapped to zero, `epfCorpusPaise` is immediately valid and can display:

- `₹0` when both are blank;
- the total when EPS is blank.

It cannot display a negative value because the proposed `>= 0` display guard hides one, and `corpusError` disables saving. Thus the negative guard itself is sufficient.

But it does not satisfy the literal requirement “shown only when both are valid and filled,” because blank EPS is considered valid zero. Decide explicitly whether blank means zero:

- If yes, revise the acceptance wording to “both valid,” and displaying total minus zero is correct.
- If no, track parsed blank as `null` for display completeness while translating it to zero only for persistence.

Also consider rejecting a negative total explicitly. The generic asset parser accepts negative balances; the corpus check catches it indirectly, but “Total PF balance must be ≥ 0” would be clearer.

### Medium — Server synchronization must cover both inputs

Like the existing opening-balance form, `totalText` needs an effect following `account.openingBalancePaise` after invalidation/refetch. `epsText` similarly needs to follow resolved retirement data after save.

A naïve data effect can erase active edits during background refetches. Seed on initial resolution and resynchronize after successful saves, or only apply server changes while the corresponding field is not dirty.

### Other regressions and accessibility concerns

- Handle retirement query errors visibly; otherwise Save can remain misleadingly available or defaults may be persisted.
- Prevent repeated submissions across the gap between the first mutation completing and React reflecting the second mutation’s pending state. A local “save sequence pending” flag or one async mutation representing the whole sequence is more robust.
- Only show the success toast after both saves, as planned. Ensure the second failure is surfaced clearly because the first write has already succeeded.
- The hint says EPS is “informational,” but it contributes to total/net worth. Better wording would clarify that EPS is a breakdown of the entered total and is not added again.
- The existing wrapped `<label>` gives each input a label, but error text should ideally have an ID referenced by `aria-describedby`; `aria-invalid` alone does not associate the message. The hint should also be associated with the EPS input.
- Add `aria-live="polite"` or an equivalent status treatment for “Saving…”/“Saved” and mutation errors.
- The fixed-width label layout may become cramped on narrow screens. Consider stacking labels and controls on small viewports.
- Focus should move to, or clearly announce, the EPS field when “EPS cannot exceed total” occurs.
- Tests should cover existing nonzero EPS plus saving Scheme details, saving before/after query resolution, failure of the second mutation, concurrent section saves, blank EPS semantics, decimal precision, and EPS greater than total.

Overall, the proposed layout and derived-value guard are sound, and mutation chaining is valid for ordering. The plan should not be implemented unchanged because the load-state defaults and `RetirementSection` submit change can both destroy existing retirement data.