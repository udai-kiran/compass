# Sonnet Worker Delegation — EPF Revamp

## Task
036-epf-revamp — Replace single amountPaise with Employee/Employer/Pension three-way breakdown

## Approved Plan
- P1: Expand schema in `packages/shared/src/schemas/ledger.ts`
- P2: Update service in `apps/api/src/modules/ledger/services/epf-contributions.ts`
- P3: Add `ledger.mutated` event to EPF route in `apps/api/src/modules/ledger/routes/transactions.ts`
- P4: Update tests in `apps/api/src/modules/ledger/services/epf-contributions.test.ts`
- P5: Revamp UI modal in `apps/web/src/routes/transactions/RecordEpfModal.tsx`

## Files and Symbols
- `packages/shared/src/schemas/ledger.ts` — `CreateEpfContributionSchema`, types
- `packages/shared/src/money.ts` — `SafePaiseSchema` (read-only; import it)
- `apps/api/src/modules/ledger/services/epf-contributions.ts` — `recordEpfContribution`
- `apps/api/src/modules/ledger/routes/transactions.ts` — EPF POST route (add eventBus call only)
- `apps/api/src/modules/ledger/services/epf-contributions.test.ts` — all tests
- `apps/web/src/routes/transactions/RecordEpfModal.tsx` — whole modal
- `apps/web/src/lib/queries.ts` — `useRecordEpfMutation` (type reference; may need no change if types infer through)

## Required Changes

### P1 — packages/shared/src/schemas/ledger.ts (lines ~615-629)

Replace:
```ts
export const CreateEpfContributionSchema = z.object({
  toAccountId: z.uuid(),
  date: z.iso.date(),
  employer: z.string().default(""),
  amountPaise: z.number().int().positive(),
  notes: z.string().default(""),
});
```

With (import SafePaiseSchema — check how it's imported in the file; it's in money.ts which is likely imported already or add the import):
```ts
export const CreateEpfContributionSchema = z
  .object({
    toAccountId: z.uuid(),
    date: z.iso.date(),
    employer: z.string().default(""),
    employeeSharePaise: SafePaiseSchema.refine((n) => n >= 0, "must be ≥ 0"),
    employerSharePaise: SafePaiseSchema.refine((n) => n >= 0, "must be ≥ 0"),
    pensionSharePaise: SafePaiseSchema.refine((n) => n >= 0, "must be ≥ 0"),
    notes: z.string().default(""),
  })
  .superRefine((v, ctx) => {
    const total = v.employeeSharePaise + v.employerSharePaise + v.pensionSharePaise;
    if (!Number.isSafeInteger(total)) {
      ctx.addIssue({
        code: "custom",
        message: "Total exceeds safe integer range",
        path: ["employeeSharePaise"],
      });
    } else if (total <= 0) {
      ctx.addIssue({
        code: "custom",
        message: "Total must be greater than zero",
        path: ["employeeSharePaise"],
      });
    }
  });
```

Check whether `SafePaiseSchema` is already imported in `ledger.ts`. If not, add the import from `./money.ts` (or wherever it's defined relative to this file — check the file's existing imports).

`CreateEpfContribution` and `CreateEpfContributionInput` types are inferred — no manual change needed.

### P2 — apps/api/src/modules/ledger/services/epf-contributions.ts

Add `formatINR` to the import from `@compass/shared` if not already there. Update `recordEpfContribution`:

```ts
export async function recordEpfContribution(
  db: Db,
  userId: string,
  input: CreateEpfContribution,
): Promise<EpfContributionResult> {
  const destAccount = await ownedAccountType(db, userId, input.toAccountId);
  if (!isRetirementAccount(destAccount.type)) {
    throw new HttpError(400, "EPF must go to a PPF, EPF or SSY account");
  }
  if (destAccount.archivedAt !== null) {
    throw new HttpError(400, "Account is archived");
  }

  const totalPaise =
    input.employeeSharePaise + input.employerSharePaise + input.pensionSharePaise;

  const breakdown = `EE: ${formatINR(input.employeeSharePaise)} | ER: ${formatINR(input.employerSharePaise)} | EPS: ${formatINR(input.pensionSharePaise)}`;
  const notes = input.notes.trim() ? `${breakdown}\n${input.notes.trim()}` : breakdown;

  const txn = await db.transaction(async (tx) => {
    const category = await findOrCreateCategory(tx, userId, "EPF Contribution", "income", "🏦");

    return createTransaction(tx, userId, {
      accountId: input.toAccountId,
      date: input.date,
      amountPaise: totalPaise,
      merchant: input.employer,
      categoryId: category.id,
      notes,
      tags: [PAYSLIP_TAG],
    });
  });

  return { transactionId: txn.id, amountPaise: txn.amountPaise };
}
```

### P3 — apps/api/src/modules/ledger/routes/transactions.ts

In the EPF POST route handler, add the eventBus emission. Currently:
```ts
async (req, reply) =>
  reply.code(201).send(await recordEpfContribution(app.db, req.session!.userId, req.body)),
```

Change to:
```ts
async (req, reply) => {
  const result = await recordEpfContribution(app.db, req.session!.userId, req.body);
  app.eventBus.emit("ledger.mutated", { userId: req.session!.userId });
  return reply.code(201).send(result);
},
```

### P4 — apps/api/src/modules/ledger/services/epf-contributions.test.ts

**All service call sites:** Replace `amountPaise: N` with three fields. Use a consistent helper for each N:
- If original `N = 12_345_00`: use `employeeSharePaise: 6_000_00, employerSharePaise: 2_345_00, pensionSharePaise: 4_000_00` (must sum to 12_345_00)
- If original `N = 9_876_00`: use `employeeSharePaise: 5_000_00, employerSharePaise: 1_376_00, pensionSharePaise: 3_500_00` (must sum to 9_876_00)
- If original `N = 1000_00`: use `employeeSharePaise: 1000_00, employerSharePaise: 0, pensionSharePaise: 0`
- If original `N = 2000_00`: use `employeeSharePaise: 2000_00, employerSharePaise: 0, pensionSharePaise: 0`

For test 2 (balance), the variable `amountPaise = 9_876_00` is still declared for assertion purposes — keep that local variable, just replace the call-site input with the three fields that sum to it.

**Update `validBase`** (around line 330):
```ts
const validBase = {
  toAccountId: "00000000-0000-4000-8000-000000000001",
  date: "2026-07-01",
  employer: "Acme",
  notes: "",
};
```
(Remove `amountPaise` from validBase since it's gone from schema.)

**Replace all 7 schema validation tests** (lines ~337-373 in the original) with a new suite:

```
// Per-field rejection tests
test("CreateEpfContributionSchema: rejects negative employeeSharePaise", ...)
test("CreateEpfContributionSchema: rejects fractional employeeSharePaise", ...)
test("CreateEpfContributionSchema: rejects Infinity for employeeSharePaise", ...)
test("CreateEpfContributionSchema: rejects NaN for employeeSharePaise", ...)
test("CreateEpfContributionSchema: rejects unsafe-integer employeeSharePaise", ...)
// (same 5 tests for employerSharePaise and pensionSharePaise)
// Acceptance tests
test("CreateEpfContributionSchema: accepts zero employeeSharePaise when others are positive", ...)
test("CreateEpfContributionSchema: accepts zero employerSharePaise when others are positive", ...)
test("CreateEpfContributionSchema: accepts zero pensionSharePaise when others are positive", ...)
// Refine tests
test("CreateEpfContributionSchema: rejects all-zero fields", ...)
test("CreateEpfContributionSchema: rejects unsafe aggregate total", ...)
test("CreateEpfContributionSchema: accepts valid three-field combination", ...)
```

For unsafe aggregate: use `Number.MAX_SAFE_INTEGER - 1` for each field (each is individually safe but sum of three exceeds MAX_SAFE_INTEGER).

**Add notes-behavior tests** (DB-backed, after test 6):
```ts
test("recordEpfContribution: blank notes → transaction notes contain EE/ER/EPS breakdown", async (t) => {
  // call with notes: ""
  // fetch transaction from DB
  // assert notes includes "EE:" and "ER:" and "EPS:"
});

test("recordEpfContribution: custom notes → notes starts with breakdown then custom text", async (t) => {
  // call with notes: "my custom note"
  // fetch transaction
  // assert notes.startsWith("EE:") && notes.includes("\nmy custom note")
});
```

### P5 — apps/web/src/routes/transactions/RecordEpfModal.tsx

Full rewrite of the component. Key design:

```tsx
import { useMemo, useState, type FormEvent } from "react";
import {
  formatINR,
  isRetirementAccount,
  rupeesToPaise,
  type CreateEpfContributionInput,
} from "@compass/shared";
import { useAccounts, useRecordEpfMutation } from "../../lib/queries.ts";
import { toast } from "../../lib/toast.tsx";
import { DateField } from "../../components/DateField.tsx";

/** Parse a component field: blank/0 → 0, valid nonneg → paise, invalid → NaN */
function parseEpfComponent(v: string): number {
  const s = v.trim();
  if (s === "" || s === "0") return 0;
  const n = parseFloat(s);
  if (!Number.isFinite(n) || n < 0) return NaN;
  return rupeesToPaise(n);
}

export function RecordEpfModal({ onClose }: { onClose: () => void }) {
  const { data: accounts } = useAccounts();
  const epf = useRecordEpfMutation();

  const epfAccounts = useMemo(
    () => (accounts ?? []).filter((a) => !a.archivedAt && isRetirementAccount(a.type)),
    [accounts],
  );

  const [toAccountId, setToAccountId] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [employer, setEmployer] = useState("");
  const [ee, setEe] = useState("");    // Employee share (₹ text)
  const [er, setEr] = useState("");    // Employer share (₹ text)
  const [eps, setEps] = useState("");  // Pension / EPS (₹ text)
  const [basic, setBasic] = useState(""); // Quick-fill basic salary

  // Live total in paise (NaN if any field is invalid)
  const eePaise  = parseEpfComponent(ee);
  const erPaise  = parseEpfComponent(er);
  const epsPaise = parseEpfComponent(eps);
  const totalPaise = eePaise + erPaise + epsPaise;
  const totalValid = !Number.isNaN(totalPaise) && Number.isSafeInteger(totalPaise);

  function autoFill() {
    const basicRupees = parseFloat(basic);
    if (!Number.isFinite(basicRupees) || basicRupees <= 0) {
      return toast("Enter valid basic salary for quick-fill");
    }
    const basicPaise = rupeesToPaise(basicRupees);
    const eps_ = Math.min(Math.round(basicPaise * 0.0833), 125_000); // capped at ₹1,250
    const ee_  = Math.round(basicPaise * 0.12);
    const er_  = Math.round(basicPaise * 0.12) - eps_;              // employer 12% − EPS
    // Display as rupees with up to 2 decimal places
    const toDisplay = (paise: number) => (paise / 100).toFixed(2).replace(/\.00$/, "");
    setEe(toDisplay(ee_));
    setEr(toDisplay(er_));
    setEps(toDisplay(eps_));
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const accountId = toAccountId || (epfAccounts.length === 1 ? epfAccounts[0]!.id : "");
    if (!accountId) return toast("Pick a retirement account");
    if ([eePaise, erPaise, epsPaise].some(Number.isNaN)) {
      return toast("Enter valid amounts (0 or positive)");
    }
    if (!totalValid || totalPaise <= 0) {
      return toast("Total contribution must be greater than zero");
    }

    const body: CreateEpfContributionInput = {
      toAccountId: accountId,
      date,
      employer,
      employeeSharePaise: eePaise,
      employerSharePaise: erPaise,
      pensionSharePaise: epsPaise,
      notes: "",
    };
    epf.mutate(body, {
      onSuccess: (r) => {
        toast(`EPF contribution recorded — ${formatINR(r.amountPaise)}`, "success");
        onClose();
      },
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="Record EPF contribution"
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="my-8 w-full max-w-lg rounded-xl border border-slate-200 bg-white shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h2 className="text-base font-semibold text-slate-800">Record EPF contribution</h2>
          <button type="button" onClick={onClose} aria-label="Close"
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100">✕</button>
        </div>

        <div className="space-y-4 px-5 py-4">
          {/* Account */}
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Destination account</span>
            <select value={toAccountId} onChange={(e) => setToAccountId(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm">
              <option value="">Select an account…</option>
              {epfAccounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
            {epfAccounts.length === 0 && (
              <p className="mt-1 text-xs text-slate-500">
                No retirement account yet — create an EPF/PPF account to earmark EPF.
              </p>
            )}
          </label>

          {/* Date */}
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Pay date</span>
            <DateField value={date} onChange={(iso) => setDate(iso)} className="w-full" aria-label="Pay date" />
          </label>

          {/* Employer */}
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Employer (source)</span>
            <input type="text" value={employer} onChange={(e) => setEmployer(e.target.value)}
              placeholder="e.g. Acme Corp"
              className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
          </label>

          {/* Quick-fill */}
          <div className="rounded-md bg-slate-50 px-3 py-2.5">
            <p className="mb-1.5 text-xs font-medium text-slate-500">Quick-fill from basic salary</p>
            <div className="flex gap-2">
              <input type="text" inputMode="decimal" value={basic}
                onChange={(e) => setBasic(e.target.value)}
                placeholder="₹ basic salary"
                className="min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
              <button type="button" onClick={autoFill}
                className="shrink-0 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
                Auto-fill
              </button>
            </div>
          </div>

          {/* Breakdown */}
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Contribution breakdown
            </p>
            <div className="space-y-2.5">
              <label className="flex items-center gap-3">
                <span className="w-44 text-xs text-slate-600">Employee share <span className="text-slate-400">(12%)</span></span>
                <input type="text" inputMode="decimal" value={ee} onChange={(e) => setEe(e.target.value)}
                  placeholder="₹"
                  className="min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-right text-sm" />
              </label>
              <label className="flex items-center gap-3">
                <span className="w-44 text-xs text-slate-600">Employer share <span className="text-slate-400">(≈3.67%)</span></span>
                <input type="text" inputMode="decimal" value={er} onChange={(e) => setEr(e.target.value)}
                  placeholder="₹"
                  className="min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-right text-sm" />
              </label>
              <label className="flex items-center gap-3">
                <span className="w-44 text-xs text-slate-600">Pension / EPS <span className="text-slate-400">(8.33%, max ₹1,250)</span></span>
                <input type="text" inputMode="decimal" value={eps} onChange={(e) => setEps(e.target.value)}
                  placeholder="₹"
                  className="min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-right text-sm" />
              </label>
              <div className="flex items-center gap-3 border-t border-slate-100 pt-2">
                <span className="w-44 text-xs font-semibold text-slate-700">Total credited</span>
                <span className={`flex-1 text-right text-sm font-semibold tabular-nums ${
                  totalValid && totalPaise > 0 ? "text-slate-800" : "text-slate-400"
                }`}>
                  {totalValid && totalPaise > 0 ? formatINR(totalPaise) : "—"}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <button type="button" onClick={onClose}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">
            Cancel
          </button>
          <button type="submit"
            disabled={epf.isPending || epfAccounts.length === 0}
            className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
            {epf.isPending ? "Saving…" : "Record EPF"}
          </button>
        </div>
      </form>
    </div>
  );
}
```

## Must Not Change
- `EpfContributionResultSchema` shape (still `{ transactionId, amountPaise }`) — unchanged
- `apps/web/src/lib/queries.ts` mutation function — type inference handles the new input type automatically, no manual change needed (but confirm this after P1)
- Any other modal or route unrelated to EPF
- DB schema / migrations — no new table needed

## Acceptance Criteria
- AC1: Schema has three fields + superRefine; no `amountPaise` in input
- AC2: Service sums three → totalPaise; notes always contain breakdown prefix
- AC3: Route emits `ledger.mutated` after EPF contribution
- AC4: Tests pass; individual-zero accepted; all-zero rejected; unsafe-aggregate rejected
- AC5: Modal has quick-fill, three fields, live total
- AC6: `npm run typecheck` exits 0; `npm run lint` exits 0

## Commands
1. `npm run typecheck` from repo root
2. `npm run lint` from repo root

## Required Evidence
- List of changed files with line counts
- Complete diff (or per-file diffs)
- Output of `npm run typecheck` (literal, with exit code)
- Output of `npm run lint` (literal, with exit code)
- Confirmation that `amountPaise` no longer appears in EPF service input/schema/modal
- Any plan deviations
