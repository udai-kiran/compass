## Review findings

1. **High — Quick-fill mixes rupees and paise, so the EPS cap is implemented incorrectly.**  
   The proposed calculations operate on the basic-salary input in rupees, but cap EPS at `125000`, which is paise. In that calculation, `125000` means ₹125,000, so the intended ₹1,250 cap will not apply. Either calculate entirely in paise:

   ```ts
   const basicPaise = parseRupees(basic);
   const ee = Math.round(basicPaise * 0.12);
   const eps = Math.min(Math.round(basicPaise * 0.0833), 125_000);
   const er = Math.round(basicPaise * 0.12) - eps;
   ```

   or calculate in rupees and cap at `1250` before converting.

2. **High — Employer quick-fill is wrong above the EPS wage ceiling.**  
   Employer EPF is not always 3.67% of the entered basic. It is the employer’s 12% contribution minus EPS. Once EPS is capped, the remaining employer EPF share increases. For example, with ₹30,000 contributory wages, the plan produces ₹1,101 ER + ₹1,250 EPS = ₹2,351, rather than the employer’s ₹3,600 total contribution. Compute employer share as `employerTotal - pensionShare`, subject to the product decision about whether contributions are limited to the statutory wage ceiling.

   The plan must explicitly decide whether quick-fill assumes:

   - contributions on actual Basic+DA; or
   - contributions restricted to the ₹15,000 statutory wage ceiling.

   Those policies yield different EE and ER values above ₹15,000.

3. **High — Individually safe fields can produce an unsafe total.**  
   Three fields can each be safe integers while their sum exceeds `Number.MAX_SAFE_INTEGER`. The proposed numeric addition can then lose paise precision before `createTransaction` rejects it. The schema should validate the aggregate with a precision-safe check, or the service should use the existing `sumPaise` helper. Add a test where all three inputs are individually safe but their aggregate is unsafe.

4. **Medium — The proposed schema violates the project’s money-schema convention.**  
   The repository provides `SafePaiseSchema` specifically to reject floats, non-finite values, and unsafe integers. The three fields should use:

   ```ts
   SafePaiseSchema.refine((n) => n >= 0, "Amount cannot be negative")
   ```

   rather than duplicating `z.number().int().min(0)`. This also makes the intended safe-integer guarantee explicit instead of relying on Zod’s current `.int()` behavior.

5. **Medium — The test plan contradicts the new zero semantics.**  
   It says to add zero tests “for each of the three new fields,” parallel to the old rejection tests. But zero is valid for each individual component. A zero field should be accepted when at least one other field is positive; only the all-zero tuple should fail.

   Tests should cover:

   - each field zero while another is positive: accepted;
   - all three zero: rejected;
   - missing field: rejected;
   - negative, fractional, NaN, Infinity, and unsafe value for each field: rejected;
   - unsafe aggregate: rejected;
   - valid combinations where only EE, ER, or EPS is nonzero.

   All seven existing schema tests referencing `amountPaise` in `epf-contributions.test.ts` were identified by the plan, but their replacements need these corrected semantics.

6. **Medium — Auto-generated notes are not durable structured data.**  
   Storing the breakdown only in notes loses reliable machine-readable data:

   - callers supplying nonblank notes get no breakdown at all;
   - users can edit or delete the generated text;
   - transaction amount and notes can later be edited independently;
   - parsing formatted INR text is locale- and presentation-dependent;
   - future EPS/EPF reporting, passbook reconciliation, contribution-history charts, tax calculations, or correction workflows cannot reliably recover the components;
   - the original contribution policy, wage base, and whether EPS was capped are not retained.

   If the breakdown is strictly display-only and no future computation is expected, notes are an acceptable shortcut. Otherwise, separate typed columns or a dedicated EPF-contribution detail record linked to the transaction is preferable. At minimum, the plan should acknowledge that this is intentionally lossy and should always preserve the breakdown even when the caller supplies custom notes—for example, append custom notes rather than replacing the structured breakdown.

7. **Medium — This is a breaking request API change, not a backward-compatible replacement.**  
   Existing clients sending `amountPaise` will fail because the three required fields are absent. It is safe only as a coordinated deployment where all clients are controlled by this monorepo and API/web versions cannot be skewed. If old web bundles, mobile clients, integrations, or external consumers may remain active, use a transition period accepting either the old amount or the three-field shape, or version the endpoint.

   Exact live callers/consumers found:

   - Fastify route body validation in `apps/api/src/modules/ledger/routes/transactions.ts`
   - `recordEpfContribution` service signature
   - `useRecordEpfMutation` in `apps/web/src/lib/queries.ts`
   - `RecordEpfModal`
   - direct service and schema calls in `epf-contributions.test.ts`

   No other live callers of the exact schema/types were found. Historical task documents also mention the schema but are not runtime callers.

8. **Medium — Blank/invalid UI values are silently converted to zero.**  
   The proposed `parseRupees(value) ?? 0` treats an invalid entry, including a negative value, the same as an intentionally blank/zero component. The current parser also rejects literal zero and uses `parseFloat`, which accepts trailing garbage such as `"100abc"`.

   Introduce a component parser that distinguishes:

   - blank or explicit zero → zero;
   - valid nonnegative currency → integer paise;
   - malformed or negative input → validation error.

   Also verify the aggregate is a safe positive integer before mutation.

9. **Low — Service notes behavior needs explicit tests.**  
   P2 changes persistence behavior, but P3 does not explicitly require tests for it. Add tests proving:

   - blank notes generate the exact EE/ER/EPS breakdown;
   - whitespace-only notes are treated as blank if that is intended;
   - custom notes follow the chosen append/preserve policy;
   - zero-valued components appear consistently;
   - stored transaction amount equals the exact component sum.

10. **Low — Verification T4 is impossible as written.**  
    `amountPaise` must remain in the EPF service and tests because the service passes the aggregate to `createTransaction`, the result schema returns it, and tests assert the persisted transaction amount. T4 should instead verify that `input.amountPaise` and request-body `amountPaise` are gone, while aggregate transaction/result uses remain.

11. **Low — The route does not emit the normal ledger mutation event.**  
    The generic transaction create/update routes emit `ledger.mutated`; the EPF route currently does not. The web query invalidation covers the initiating browser, but other event-driven consumers may not be notified. The revamp is a good point to align this endpoint with the ledger mutation convention and add coverage if the event bus is expected for all ledger writes.

## Zod v4 refine placement

Placing `.refine(...)` directly after `z.object({...})` is correct in Zod v4, including in a project using `z.iso.date()`:

```ts
z.object({ ... }).refine(predicate, {
  message: "Total must be greater than zero",
  path: ["employeeSharePaise"],
});
```

A `path` is advisable so form/API errors have a useful location. For aggregate safety plus total-positive validation, `.superRefine()` may be clearer because it can emit separate issues. The placement itself is not a problem.

## Overall assessment

The three-field API can work as a coordinated breaking change, and all exact live symbol consumers appear scoped. The plan should not be approved unchanged because the quick-fill cap has a rupee/paise unit bug, the employer formula is incorrect above the EPS ceiling, aggregate safe-integer validation is missing, zero-field test semantics are misstated, and notes do not preserve a dependable contribution breakdown.