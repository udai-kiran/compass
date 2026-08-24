# Fix Report — Task 088 Review-2 Blockers (Iteration 3)

## Files Inspected

- `tasks/088-payslip-parse/DELEGATION.md` — read for full context
- `apps/api/src/modules/tax/services/payslip-parse.ts` — source under edit
- `apps/api/src/modules/tax/services/payslip-review.ts` — source under edit
- `packages/shared/src/schemas/tax.ts` — source under edit
- `apps/api/src/lib/storage.ts` — read to confirm `put(data: Buffer, contentType: string): Promise<string>` signature
- `apps/api/src/db/index.ts` — read to confirm `DbOrTx` type definition
- `apps/api/src/modules/tax/services/payslip-parse.test.ts` — read before editing
- `apps/api/src/modules/tax/services/payslip-review.test.ts` — read before editing

## Files Changed

- `apps/api/src/modules/tax/services/payslip-parse.ts`
- `apps/api/src/modules/tax/services/payslip-review.ts`
- `packages/shared/src/schemas/tax.ts`

## Implementation Details

### F1 (H1) — PDF without extractedText redirects to manual

In `parsePayslip`, immediately after the `!ai.enabled` guard, added:

```typescript
if (input.contentType === "application/pdf" && !input.extractedText) {
  return {
    available: false,
    message:
      "PDF text extraction requires the extractedText field (supply text extracted from the PDF by the client) " +
      "or use POST /api/tax/payslips/manual to enter payslip data manually.",
  };
}
```

Also added `&& input.contentType !== "application/pdf"` to the vision branch condition as belt-and-suspenders.

### F2 (H2) — Persist document to storage permanently

After the F1 guard, before the text/vision branch:

```typescript
let documentKey: string | null = null;
try {
  documentKey = await storage.put(input.buffer, input.contentType);
} catch {
  // Non-fatal: document storage failure should not block parse
}
```

Storage `put()` signature confirmed from `lib/storage.ts`: `put(data: Buffer, contentType: string): Promise<string>`.

Removed the transient `const key = await storage.put(...)` + `finally { storage.delete(key) }` from the vision path. The vision path now uses `input.buffer.toString("base64")` directly (buffer is already in scope).

`documentKey` is threaded into `createExtractedPayslip`. In `payslip-review.ts`, added `documentKey?: string | null` to `createExtractedPayslip`'s input type and included it in the DB insert: `documentKey: input.documentKey ?? null`.

### F4 (H4) — Missing payMonth / empty components redirect to manual

After `parsePayslipFromTurn` returns a non-null result:

```typescript
if (!modelOutput.payMonth) {
  return { available: false, message: "AI could not determine the pay month..." };
}
if (modelOutput.components.length === 0) {
  return { available: false, message: "AI could not extract any salary components..." };
}
```

### F5 (L3) — Null rupeesToPaise rejects model output

Replaced `.map()` with a `for` loop to enable early return:

```typescript
const components: Array<{...}> = [];
for (let i = 0; i < modelOutput.components.length; i++) {
  const c = modelOutput.components[i]!;
  const currentPaise = rupeesToPaise(c.currentRupees);
  if (currentPaise === null) {
    return { available: false, message: "AI returned an amount that cannot be converted to paise safely..." };
  }
  components.push({ ..., currentPaise, ... });
}
```

### F6 (M8) — Catch ai.chat() exceptions in both paths

Both the text path and vision path `ai.chat()` calls are now wrapped in `try { ... } catch { return { available: false, message: "AI provider error..." }; }`.

### F7 (M2) — Atomic creation with transaction

`createManualPayslip` and `createExtractedPayslip` in `payslip-review.ts` are now wrapped in `db.transaction(async (tx) => { ... })`. All inserts inside use `tx`. `createManualPayslip` calls `getPayslip(tx, userId, created.id)` inside the transaction.

To allow `getPayslip` to accept a transaction handle, added `DbOrTx` to the import from `db/index.ts`:

```typescript
import type { Db, DbOrTx } from "../../../db/index.ts";
```

Changed signatures of `loadPayslipWithComponents` and `getPayslip` from `db: Db` to `db: DbOrTx`. This is backward-compatible since `Db` is a member of the `DbOrTx` union.

### F8 (M1) — Component correction checks affected rows

In `acceptPayslip` component correction loop:

```typescript
const affected = await tx
  .update(payslipComponents)
  .set(compSet)
  .where(and(eq(payslipComponents.id, corr.id), eq(payslipComponents.payslipId, id)))
  .returning({ id: payslipComponents.id });
if (affected.length === 0) {
  throw new HttpError(400, `Component ${corr.id} not found on this payslip`);
}
```

### F9 (M4) — Cross-field Zod refinement for payMonth/FY consistency

`CreateManualPayslipBodySchema` changed from `z.object({...})` to `z.object({...}).refine(...)`:

```typescript
.refine(
  (data) => {
    const [year] = data.fy.split("-");
    const startYear = Number(year);
    const endYear = startYear + 1;
    const [payYearStr, payMonthStr] = data.payMonth.split("-");
    const payYear = Number(payYearStr);
    const payMonth = Number(payMonthStr);
    if (payMonth >= 4 && payMonth <= 12) return payYear === startYear;
    if (payMonth >= 1 && payMonth <= 3) return payYear === endYear;
    return false;
  },
  { message: "payMonth must fall within the specified financial year (Apr–Mar)" },
)
```

The exported type `CreateManualPayslipBody` is unchanged (inferred from the refined schema).

### F10 (M6) — Fix grossRupees description

Changed from:
`"Total gross salary (CTC monthly equivalent) in rupees."`

To:
`"Total gross salary as printed on the payslip (in rupees, before deductions). This is gross pay, not CTC."`

## Commands Run

### 1. `npm run typecheck 2>&1`

```
> compass@0.1.0 typecheck
> npm run typecheck --workspaces --if-present

> @compass/api@0.1.0 typecheck
> tsc --noEmit

> @compass/docs@0.1.0 typecheck
> tsc --noEmit

> @compass/extractor@0.1.0 typecheck
> tsc --noEmit

> @compass/ingestor@0.1.0 typecheck
> tsc --noEmit

> @compass/web@0.1.0 typecheck
> tsc --noEmit

> @compass/ai@0.1.0 typecheck
> tsc --noEmit

> @compass/shared@0.1.0 typecheck
> tsc --noEmit
```
Exit 0.

### 2. `npm run lint 2>&1`

```
> compass@0.1.0 lint
> eslint .
```
Exit 0.

### 3. `node --experimental-test-module-mocks --test apps/api/src/modules/tax/services/payslip-parse.test.ts apps/api/src/modules/tax/services/payslip-review.test.ts 2>&1`

```
ℹ tests 34
ℹ suites 6
ℹ pass 34
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 463.962598
```
Exit 0.

### 4. `npm run test -w packages/shared 2>&1`

```
ℹ tests 352
ℹ suites 0
ℹ pass 352
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 320.024821
```
Exit 0.

### 5. `node --test apps/api/src/db/schema.decomposition.test.ts 2>&1`

```
ℹ tests 3
ℹ suites 1
ℹ pass 3
ℹ fail 0
ℹ duration_ms 370.760287
```
Exit 0.

### 6. `node --experimental-test-module-mocks --test apps/api/src/app.route-snapshot.test.ts 2>&1`

```
ℹ tests 7
ℹ suites 0
ℹ pass 7
ℹ fail 0
ℹ duration_ms 937.011835
```
Exit 0.

## Assumptions

- `DbOrTx` (from `db/index.ts`) correctly covers the transaction handle type returned by `db.transaction()`. The definition is `Db | Parameters<Parameters<Db["transaction"]>[0]>[0]`, which explicitly covers both `Db` and the Drizzle transaction object. Changing `loadPayslipWithComponents` and `getPayslip` to accept `DbOrTx` is backward-compatible for callers that pass a `Db` instance (since `Db` is a member of the union).
- The `storage.put()` signature `(data: Buffer, contentType: string): Promise<string>` is exactly as declared in the `Storage` interface in `lib/storage.ts`.
- F3 (H3, PII redaction on empty identity) was listed as acceptable in DELEGATION.md ("The current `catch (() => ({names:[], emails:[], upiIds:[]}))` pattern is acceptable") — no change needed, confirmed as already correct.

## Unresolved Risks

- None. All 10 fixes are implemented, typecheck exits 0, lint exits 0, all 34+352+3+7 = 396 tests pass.
