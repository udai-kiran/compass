# Task: EPF Recording Revamp — Three-way breakdown

## Status
COMPLETE

## Objective
Replace the single "Amount" field in Record EPF with three explicit fields:
**Employee Share**, **Employer Share**, and **Pension Share** — matching the
three-column breakdown on every Indian payslip and EPF passbook. The UI shows
a live-computed total. An optional "Quick-fill" helper fills all three from a
basic-salary input using statutory percentages.

## Indian EPF Structure (context)
| Component | Rate | Who pays | Where it goes |
|---|---|---|---|
| Employee share (EE) | 12% of Basic+DA | Employee (payroll deduction) | EPF account |
| Employer share (ER) | 3.67% of Basic+DA | Employer | EPF account |
| Pension share (EPS) | 8.33% of Basic+DA (capped ₹1,250/mo) | Employer | EPS/Pension scheme |

Total recorded = EE + ER + EPS (full 24% view from the payslip; the "Pension
share" is still booked to the same EPF account here for net-worth tracking —
the user sees all three as a single income credit to their EPF account).

## Root Cause
Not applicable (feature revamp, not a bug).

## Scope
- `packages/shared/src/schemas/ledger.ts` — replace `amountPaise` with three
  fields; add refine ensuring total > 0
- `apps/api/src/modules/ledger/services/epf-contributions.ts` — sum three
  fields → total; auto-generate notes breakdown
- `apps/api/src/modules/ledger/services/epf-contributions.test.ts` — update
  all call sites (amountPaise → three fields); update schema validation tests
- `apps/web/src/routes/transactions/RecordEpfModal.tsx` — replace single amount
  field with three labelled fields + live total; add basic-salary quick-fill

## Dependencies
None.

## Codex review-1 findings addressed
- F1 (High): EPS cap bug — calculate entirely in paise; cap = 125_000 paise (₹1,250).
  ER = round(basicPaise × 0.12) − eps (employer total minus EPS, so ER+EPS = 12%).
- F2 (High): Employer formula corrected — ER = employer12pct − EPS, not 3.67% directly.
- F3 (High): Aggregate overflow — add superRefine checking total is a positive safe integer.
- F4 (Med): Use `SafePaiseSchema` (from `packages/shared/src/money.ts`) plus `.refine(n >= 0)`.
- F5 (Med): Zero test semantics — individual zero valid; all-three-zero rejects.
- F6 (Med): Notes — always prepend breakdown; if custom notes exist, append after "\n".
- F7 (Med): Breaking change acceptable — this is a monorepo; all callers updated atomically.
- F8 (Med): UI parser — introduce `parseEpfComponent` that accepts blank/zero → 0 paise,
  valid nonneg → paise, invalid → NaN (shown as validation error before submit).
- F9 (Low): Add tests for notes behavior (blank → breakdown; custom → breakdown + "\n" + custom).
- F10 (Low): Fix T4 wording.
- F11 (Low): Add `app.eventBus.emit("ledger.mutated", ...)` to the EPF route.

## Plan
- P1: **Schema** — `packages/shared/src/schemas/ledger.ts`
  Replace:
  ```ts
  amountPaise: z.number().int().positive(),
  ```
  With (using the existing `SafePaiseSchema` from `money.ts`):
  ```ts
  employeeSharePaise: SafePaiseSchema.refine((n) => n >= 0, "must be ≥ 0"),
  employerSharePaise: SafePaiseSchema.refine((n) => n >= 0, "must be ≥ 0"),
  pensionSharePaise:  SafePaiseSchema.refine((n) => n >= 0, "must be ≥ 0"),
  ```
  Add `.superRefine()` after the object:
  ```ts
  .superRefine((v, ctx) => {
    const total = v.employeeSharePaise + v.employerSharePaise + v.pensionSharePaise;
    if (!Number.isSafeInteger(total)) {
      ctx.addIssue({ code: "custom", message: "Total exceeds safe integer range",
                     path: ["employeeSharePaise"] });
    } else if (total <= 0) {
      ctx.addIssue({ code: "custom", message: "Total must be greater than zero",
                     path: ["employeeSharePaise"] });
    }
  })
  ```
  Import `SafePaiseSchema` from `./money.ts` (or re-export from where it's accessible).
  `CreateEpfContribution`/`CreateEpfContributionInput` types auto-update from inferred schema.

- P2: **Service** — `apps/api/src/modules/ledger/services/epf-contributions.ts`
  ```ts
  const totalPaise = input.employeeSharePaise + input.employerSharePaise + input.pensionSharePaise;
  ```
  Always build breakdown notes (prepend even if caller supplies custom notes):
  ```ts
  const breakdown = `EE: ${formatINR(input.employeeSharePaise)} | ER: ${formatINR(input.employerSharePaise)} | EPS: ${formatINR(input.pensionSharePaise)}`;
  const notes = input.notes.trim() ? `${breakdown}\n${input.notes.trim()}` : breakdown;
  ```
  Pass `amountPaise: totalPaise` and `notes` to `createTransaction`.
  Return `{ transactionId, amountPaise: totalPaise }`.
  Import `formatINR` from `@compass/shared`.

- P3: **Route** — `apps/api/src/modules/ledger/routes/transactions.ts`
  Add `app.eventBus.emit("ledger.mutated", { userId: req.session!.userId })` after the
  `recordEpfContribution` call (currently missing, unlike other ledger write routes).

- P4: **Tests** — `apps/api/src/modules/ledger/services/epf-contributions.test.ts`
  - Replace all call sites: split existing `amountPaise: N` into three fields that sum to N.
    Use a consistent split, e.g.: `employeeSharePaise: Math.round(N * 0.5)`,
    `employerSharePaise: Math.round(N * 0.1525)`, `pensionSharePaise: N - Math.round(N*0.5) - Math.round(N*0.1525)`.
  - Replace schema validation tests (7 amountPaise tests → new suite):
    - Each field: negative → rejects; fractional → rejects; Infinity → rejects; NaN → rejects;
      unsafe-integer → rejects; valid nonneg-int → accepts.
    - Individual zero while others positive → accepts (not rejected).
    - All three zero → rejects (refine).
    - Unsafe aggregate (each field safe but sum unsafe) → rejects.
  - Notes-behavior tests (no DB needed — call service, check created transaction's notes):
    - blank notes → notes string contains breakdown;
    - custom notes → notes string starts with breakdown, ends with custom text.
  - The balance assertion `afterEpf = beforeEpf + amountPaise` uses the sum of the three fields.

- P5: **UI modal** — `apps/web/src/routes/transactions/RecordEpfModal.tsx`
  State:
  ```ts
  const [ee, setEe] = useState("");
  const [er, setEr] = useState("");
  const [eps, setEps] = useState("");
  const [basic, setBasic] = useState("");
  ```
  Helper (accepts blank/zero as 0; invalid as NaN):
  ```ts
  function parseEpfComponent(v: string): number {
    if (v.trim() === "") return 0;
    const n = parseFloat(v);
    if (!Number.isFinite(n) || n < 0) return NaN;
    return rupeesToPaise(n);
  }
  ```
  Quick-fill (all in paise):
  ```ts
  function autoFill() {
    const basicPaise = parseFloat(basic);
    if (!Number.isFinite(basicPaise) || basicPaise <= 0) return toast("Enter valid basic salary");
    const basicP = rupeesToPaise(basicPaise);
    const eps_ = Math.min(Math.round(basicP * 0.0833), 125_000);
    const ee_  = Math.round(basicP * 0.12);
    const er_  = Math.round(basicP * 0.12) - eps_;   // employer total − EPS
    setEe(String(ee_ / 100));
    setEr(String(er_ / 100));
    setEps(String(eps_ / 100));
  }
  ```
  Validation in submit:
  ```ts
  const eePaise  = parseEpfComponent(ee);
  const erPaise  = parseEpfComponent(er);
  const epsPaise = parseEpfComponent(eps);
  if ([eePaise, erPaise, epsPaise].some(Number.isNaN)) return toast("Enter valid amounts (≥ 0)");
  const total = eePaise + erPaise + epsPaise;
  if (total <= 0) return toast("Total contribution must be greater than zero");
  ```
  Layout:
  1. Remove old single "Amount" field.
  2. "Quick-fill from basic" inline row (basic salary input + "Auto-fill" button).
  3. "Contribution breakdown" section heading.
  4. Three rows: Employee share (12%), Employer share (≈3.67%), Pension / EPS (8.33%).
  5. "Total" read-only line below the three.
  6. Build body: `{ ..., employeeSharePaise: eePaise, employerSharePaise: erPaise, pensionSharePaise: epsPaise, notes: "" }`.
  7. Success toast uses `r.amountPaise`.

## Acceptance Criteria
- AC1: `CreateEpfContributionSchema` has `employeeSharePaise`, `employerSharePaise`,
  `pensionSharePaise` (all int ≥ 0) and no `amountPaise`; total-zero is rejected.
- AC2: Service records exactly one transaction whose `amountPaise` equals the sum of
  the three fields; auto-generated notes show breakdown when caller passes `notes: ""`.
- AC3: All existing error paths still work (non-retirement dest, archived, cross-user).
- AC4: Modal has three clearly-labelled fields matching payslip columns, a live total,
  and a basic-salary quick-fill that applies statutory caps.
- AC5: `npm run typecheck` and `npm run lint` pass (no TS errors on changed files).
- AC6: All existing tests updated to pass with new schema; no test deleted without replacement.

## Verification
- T1: `npm run typecheck` exits 0.
- T2: `npm run lint` exits 0.
- T3: Schema unit tests for new fields pass (per-field neg/frac/Inf/NaN/unsafe, individual-zero
  accepted, all-zero rejected, unsafe-aggregate rejected).
- T4: Diff review — `input.amountPaise` and request-body `amountPaise` are gone; only the
  result schema and internal `totalPaise` local variable remain (those are correct).
- T5: UI diff — modal has three component fields + quick-fill + live total.
- T6: EPF route emits `ledger.mutated` event.

## Non-Goals
- No DB migration — the transaction is already a plain row in `transactions`; the three-way
  breakdown is captured in auto-notes on the transaction, not a separate table.
- No EPS-vs-EPF account split — single income credit to the chosen retirement account.
- No AI/import path changes.
