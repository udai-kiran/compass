# Task: 13.1 — FY Tax-Rule Data & Regime Preference

## Status
COMPLETE (2026-08-23)

## Completion record
- Plan P1-P10 + fix rounds G1-G10, K1-K5 all implemented; review-5 delta confirmation verdict: **COMPLETE-ready** (K2 exact postconditions; loss-tolerant escapes eliminated).
- Verification: verification-4.md — typecheck/lint exit 0; financial-year+tax-rules 63/63; regime-preference pure 4/4 + hermetic routes 3/3 (invalid-FY GET/PUT → 400, valid → 200); decomposition 74 tables / 58 enums incl. regimeSourceEnum identity; backup static 12/12; shared 352/352; full api suite 1140 pass / 33 ECONNREFUSED-only / 0 genuine failures.
- DB-backed service tests (incl. 25-round concurrency consistency) are written and guarded — they will execute in any environment with a live Postgres.
- Evidence chain: implementation-{1,2,3}.md, fix-{1..3}.md (fix-1 is 089's co-resident typecheck repair), verification-{1..4}.md, review-{2..5}.md. K4 rationale (no demo-route test) documented under "Fix round 3".

## Objective
All Indian tax rates, slabs, caps and thresholds as effective-dated data — no inline constants. User regime preference stored. A missing rule for a date fails loudly.

## Root Cause
Tax-related code (capital gains in `tax-lots.ts`, instrument rules in `lib/instrument-rules.ts`) hardcodes rates per-epoch. Phase 13 needs income-tax slabs, deduction caps, advance-tax schedules, and regime logic — all versioned by date, not by inline constants.

## Codex Review Findings (review-1)
- **H1 (parallel registry)**: Keep instrument-rules.ts for instrument-level rules (lock-in, liquidity, horizon, CG rates). Create tax-rules.ts for income-tax domain (slabs, deduction caps, advance-tax). These are genuinely different domains — instrument rules key on instrument-category+date, tax rules key on regime+FY+taxpayer-type. Not parallel — complementary. Tax-lots.ts constants stay as-is for now (they encode per-lot holding-period logic, not rate data).
- **H2 (multi-dimensional lookups)**: Accepted. Tax rule lookups take `{ fy, regime, taxpayerType? }` not a single date. CG rates stay in instrument-rules keyed by instrument+date.
- **H3 (regime table constraints)**: Accepted. Composite PK on `(userId, fy)`, proper FKs, enums.
- **H4 (PUT boundary)**: Accepted. PUT accepts only `chosen`. `inferredRegime` is write-only by payslip service. Response returns `{ chosen, inferredRegime, effective, source }`.
- **M1 (fyOf/fyRange)**: Accepted. Extract to `lib/financial-year.ts` with strict validation.
- **M2 (FY validation)**: Accepted. Validate ISO date and canonical YYYY-YY format.
- **M3 (timezone)**: Accepted. Tax rules use string FY labels, not Date objects.
- **M4 (overlap validation)**: Accepted. Boot-time or test-time validation of non-overlapping epochs.
- **M9 (basis points)**: Income-tax rates stored as basis points (e.g. 3000 = 30%). Cess stored as basis points. Interest rates already in bps.
- **M11 (TDD)**: Tests written before implementation for each AC.

## Scope

### New files
- `apps/api/src/lib/financial-year.ts` — extracted `fyOf`, `fyRange`, `fyLabel`, `parseFy` with strict validation
- `apps/api/src/lib/financial-year.test.ts` — tests including century rollover, invalid inputs
- `apps/api/src/lib/tax-rules.ts` — income-tax domain rules: slabs, deduction caps, advance-tax, rebate, surcharge, cess
- `apps/api/src/lib/tax-rules.test.ts` — comprehensive tests
- `apps/api/src/modules/tax/schema.ts` — `tax_regime_preferences` table + enums
- `apps/api/src/modules/tax/plugin.ts` — module plugin
- `apps/api/src/modules/tax/routes/regime-preference.ts` — GET/PUT
- `apps/api/src/modules/tax/services/regime-preference.ts` — CRUD
- `packages/shared/src/schemas/tax.ts` — Zod schemas

### Modified files
- `apps/api/src/modules/investments/services/capital-gains.ts` — import `fyOf`/`fyRange` from `lib/financial-year.ts`
- `apps/api/src/db/schema.ts` — add tax module re-exports
- `apps/api/src/app.ts` — register `taxRoutes` with `{ prefix: "/api/tax" }`
- `apps/api/src/modules/system/services/backup.ts` — add `tax_regime_preferences`
- `packages/shared/src/index.ts` — export `schemas/tax.ts`

### Tax rule data structure
```typescript
interface TaxSlabEntry {
  lowerPaise: number;    // inclusive
  upperPaise: number | null;  // null = no upper bound
  rateBps: number;       // basis points (3000 = 30%)
}

interface RegimeRules {
  regime: 'old' | 'new';
  fy: string;            // "2025-26"
  slabs: TaxSlabEntry[];
  standardDeductionPaise: number;
  rebate87A: { thresholdPaise: number; maxReliefPaise: number } | null;
  surchargeSlabs: Array<{ lowerPaise: number; upperPaise: number | null; rateBps: number }>;
  cessBps: number;       // 400 = 4%
  marginalRelief: boolean;
}

interface DeductionCap {
  section: string;       // "80C", "80CCD(1B)", "80CCD(2)", "80D_self", "80D_parents"
  fy: string;
  regime: 'old' | 'both' | 'new';
  capPaise: number;      // 0 for new-regime deductions that don't apply
  conditions?: string;   // human-readable applicability notes
}

interface AdvanceTaxSchedule {
  fy: string;
  instalments: Array<{
    dueDate: string;     // ISO date
    cumulativePct: number; // 15, 45, 75, 100
  }>;
  interestRateBpsPerMonth: number; // 100 = 1%
  seniorCitizenExempt: boolean;
}
```

### Regime preference table
```
tax_regime_preferences (
  user_id UUID NOT NULL FK → users(id) ON DELETE CASCADE,
  fy TEXT NOT NULL,
  chosen TEXT ('old' | 'new') NULL,  -- user's explicit choice, null = not yet chosen
  inferred_regime TEXT ('old' | 'new') NULL,  -- computed from payslip TDS
  inferred_at TIMESTAMPTZ NULL,
  effective TEXT NOT NULL,  -- resolved: chosen ?? inferredRegime ?? 'new' (statutory default)
  source TEXT NOT NULL,     -- 'chosen' | 'inferred' | 'default'
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, fy)
)
```

## Dependencies
- 5.2 (instrument rules registry) — done

## Plan
- P1: Extract `fyOf`/`fyRange` to `lib/financial-year.ts` with strict validation, tests first. Update capital-gains.ts to import from new location. Characterization tests first.
- P2: Create `lib/tax-rules.ts` with all effective-dated data (slabs, caps, rates, advance-tax schedule) — tests first per TDD.
  - FY 2023-24 through 2026-27 for both regimes
  - Overlap validation at module load time
  - Lookup by `{ fy, regime }` — throws on missing FY
  - Senior citizen slab variants for old regime
  - 80CCD(2) with employer-type condition
- P3: Create `modules/tax/schema.ts` with `tax_regime_preferences` table, composite PK on `(user_id, fy)`, regime enum
- P4: Create `modules/tax/services/regime-preference.ts` — get/upsert. PUT writes only `chosen`, computes `effective`+`source`. `inferredRegime` writable only by internal service call.
- P5: Create `modules/tax/routes/regime-preference.ts` — `GET /regime-preference?fy=2025-26`, `PUT /regime-preference` with `{ fy, chosen }`
- P6: Create `modules/tax/plugin.ts`, wire into `app.ts` with `{ prefix: "/api/tax" }`
- P7: Wire `db/schema.ts` (re-export), `backup.ts` (USER_TABLES)
- P8: Create `packages/shared/src/schemas/tax.ts`, export from `index.ts`
- P9: Generate Drizzle migration
- P10: Update route snapshots

## Acceptance Criteria
- AC1: All rates, caps and thresholds as effective-dated data — no inline constants anywhere in services
- AC2: Tax rule lookups keyed by `{ fy, regime }` (not single date), with taxpayer-type variant where needed
- AC3: User regime preference with composite PK `(userId, fy)`, PUT writes only `chosen`, response includes `effective` and `source`
- AC4: A missing rule for an FY fails loudly; overlapping epochs detected at load time
- AC5: Historical FYs representable (2023-24 onward), future FYs fail loudly
- AC6: `fyOf`/`fyRange` extracted to shared `lib/financial-year.ts` with strict validation
- AC7: typecheck + lint + test green

## Verification
- T1: `npm run typecheck` passes
- T2: `npm run lint` passes
- T3: `npm run test` passes (all workspaces)
- T4: Tax slab lookup for FY 2025-26 old/new regime returns correct values
- T5: Lookup for unknown FY throws descriptive error
- T6: `fyOf("2025-06-15")` → `"2025-26"`, `fyOf("2026-03-31")` → `"2025-26"`
- T7: Invalid FY strings rejected by `parseFy`
- T8: Migration SQL generated
- T9: `backup.test.ts` passes with new table
- T10: Route snapshots updated

## Non-Goals
- Computing actual tax liability (13.8)
- Payslip parsing / TDS inference (13.2)
- Tax surface UI (13.14)
- Refactoring tax-lots.ts constants (those encode per-lot logic, not rate data)

## Coordinator findings (own read, 2026-08-23, pre-review)
- C1 (M4 gap, MEDIUM): `addRegimeRules` uses `REGIME_RULES_MAP.set()` — a duplicate `fy|regime` epoch silently overwrites instead of failing at load time. review-1 M4 accepted "overlap validation at load time"; duplicate-key rejection is the same guard. Fix: throw in addRegimeRules/addDeductionCap on duplicate key.
- C2 (API class, MEDIUM): well-formed but inconsistent FY (e.g. "2025-27") passes Zod FySchema regex, then `parseFy` throws a plain Error inside the service → route returns 500, not 400. Wrap parse failures as HttpError(400) at the tax service boundary.
- C3 (low): `taxRegimeEnum` is defined and emitted in migration 0012 but NO column uses it — chosen/inferred_regime/effective/source are all text; no DB-level domain constraint. Either type chosen/inferred_regime with the enum or drop the unused enum. Migration churn either way; decide after Codex review.
- C4 (low): `fyOf` regex-validates shape only — "2025-13-40" accepted (month≥4 path). M2 said strict ISO validation; tighten via Date.UTC round-trip.
- Verified good: slab data FY23-24→26-27 matches Finance Acts (2025-26 new 7-slab + ₹60k rebate correct; new-regime surcharge cap 25% correct); advance-tax dates/statutory percentages correct; slab-contiguity validation runs at load; ownership/demo-safe patterns fine; regime resolution chosen>inferred>default matches H4.

## Codex review findings (review-2) — verdict BLOCKING
- **H1 BLOCKING**: P2's "senior citizen slab variants for old regime" NOT implemented — no taxpayer-type dimension in RegimeRules/getRegimeRules. Residents: senior ≥60 → ₹3L exemption; super-senior ≥80 → ₹5L (old regime only). 87A residency/special-rate eligibility caveats noted for the future computation phase (13.8).
- **H2 BLOCKING**: 80CCD(2) single "both" record is wrong from FY 2024-25 — Finance Act 2024 sets 14% for ALL employers under new regime (115BAC(1A)); old regime stays 10% private / 14% government. 80D matrix incomplete: missing self+family-senior ₹50k and parents-non-senior ₹25k variants.
- **M1 BLOCKING**: read-modify-write race between PUT(chosen) and internal inference — interleaving can persist chosen=new with effective=old; concurrent first-writes can violate composite PK.
- **M2 BLOCKING (=C1)**: duplicate epochs silently overwrite in ALL THREE registries (regime rules, deduction caps, advance tax) — M4 guard only partially implemented.
- **M3 BLOCKING (=C2)**: "2025-27" passes FySchema regex, parseFy throws plain Error → 500 instead of 400. Preferred fix: validate suffix consistency in shared FySchema (+ service translates residual invalid input to HttpError(400)).
- **M4 BLOCKING**: uncovered-FY lookups don't fail loudly: getDeductionCap returns [] for any well-formed FY; regime-preference GET/PUT accept unsupported future FYs. All FY-keyed lookups must assert coverage.
- **M5 BLOCKING**: slab/surcharge boundaries off-by-one vs statute ("up to ₹4L nil" / surcharge when income EXCEEDS threshold): current data puts exact-threshold income in the HIGHER bracket. Convention must become inclusive upper (=threshold), next lower = upper+1 paise.
- **M6 BLOCKING (=C3)**: taxRegimeEnum unused; all four domain columns unrestricted text + unchecked casts on read. Fix: type chosen/inferred_regime/effective with tax_regime enum, add regime_source enum for source, regenerate migration (0013 ALTERs — 0012 stays as generated).
- **M7 BLOCKING**: NO tests for service/route behavior (composite-PK upsert, resolution order, inference preservation, user isolation, invalid-FY status, demo rejection). AC3 effectively unverified.
- L1 (=C4): fyOf accepts impossible dates → calendar round-trip validation. L2: fyLabel helper omitted vs plan (add it). L3: FY26-27 placeholder comment stale (Aug 2026) — reword, keep carried-forward data.
- Confirmed good: base slabs/std-deduction/rebate headline/cess/surcharge rates FY23-24→25-26; advance-tax dates+pcts; resolution order; userId+fy scoping everywhere; demo PUT safety via auth chokepoint; backup coverage; module wiring/snapshots/conventions.

## Fix round 2 (approved plan addition)
- G1 (H1): add `taxpayerType: 'ordinary' | 'senior' | 'super_senior'` (default 'ordinary') to `getRegimeRules(fy, regime, taxpayerType?)`. Old-regime entries gain senior (₹3L first slab) and super_senior (₹5L) variants for FY23-24→26-27; new regime maps all taxpayer types to the same slabs. Tests for both variants at boundary incomes.
- G2 (H2): restructure 80CCD(2) as per-(fy, regime) entries with `employerRatesBps: [{employerType:'private'|'government', rateBpsOfBasic}]` — old: private 1000/govt 1400 all FYs; new: FY23-24 1000/1400, FY24-25 onward 1400/1400. Complete 80D matrix: `80D_self`(25k), `80D_self_senior`(50k), `80D_parents`(25k), `80D_parents_senior`(50k), old-regime only, all covered FYs.
- G3 (M1): make both service writes atomic single-statement upserts: `INSERT … ON CONFLICT (user_id,fy) DO UPDATE` computing effective/source in SQL from the merged row (`COALESCE(excluded.chosen, existing.inferred_regime, 'new')` + matching CASE), never read-then-write. PUT touches only chosen(+effective/source); inference path touches only inferred fields(+effective/source).
- G4 (M2): throw on duplicate keys in addRegimeRules/addDeductionCap/addAdvanceTaxSchedule at load time (dedup key for caps: section+fy+regime).
- G5 (M3): FySchema gains suffix-consistency refinement (reject "2025-27" with Zod 400); services additionally translate parseFy failures to HttpError(400).
- G6 (M4): getDeductionCap throws descriptive error for uncovered FY (returns [] only within covered FYs); regime-preference GET/PUT reject FYs outside coveredFys() with HttpError(400).
- G7 (M5): switch slab+surcharge convention to inclusive upper = threshold, next lower = threshold+1 paise (statute-faithful); update contiguity validator expectations and affected test values.
- G8 (M6): columns typed with enums per M6; run db:generate → migration 0013; keep 0012 untouched.
- G9 (M7): real-Postgres service tests (guarded skip without DATABASE_URL): upsert idempotency, resolution order, inference preservation across PUT, user isolation, uncovered-FY 400; plus hermetic route test for invalid-FY/demo paths if the established mock.module pattern is cheap to replicate — otherwise document skip rationale.
- G10 (L1/L2/L3): fyOf calendar validation + tests; add fyLabel(fy); refresh FY26-27 comment wording.

## Codex re-review (review-3) — verdict BLOCKED on M7 residue only
H1/H2/M1-M5 RESOLVED with evidence. M6 PARTIAL (persistence fixed; `regimeSourceEnum` counted in 58 but missing from taxResidents + enum identity map in schema.decomposition.test.ts:84/:270). M7 PARTIAL-BLOCKING: DB service tests exist (skipped w/o DB) but NO concurrent chosen/inferred consistency test, NO route-level invalid-FY→400 hermetic test, NO demo-PUT-403 route test or documented skip rationale. L1/L2 resolved; L3 partial (Finance Act 2026 assented 30 Mar 2026, not "enacted in February" — doc-only). Regression scan clean incl. capital-gains consumers; 77 targeted tests pass. Redundant `as Regime` casts noted harmless — keep.

## Fix round 3 (approved)
- K1: add `regimeSourceEnum` to taxResidents + enum identity map in apps/api/src/db/schema.decomposition.test.ts.
- K2: DB-backed concurrency test in modules/tax/services/regime-preference.test.ts: N iterations of Promise.all([upsertRegimePreference, updateInferredRegime]) on fresh user+fy; after settle, assert persisted row satisfies the resolution invariant (chosen→effective=chosen/source=chosen; else inferred→effective=inferred/source=inferred; else default/new).
- K3: hermetic route test replicating the established mock.module pattern (see planning-analysis.hermetic.test.ts): invalid-but-well-formed FY ("2025-27") on GET and PUT returns HTTP 400.
- K4 (decision, no code): demo-PUT-403 route test deliberately omitted — demo rejection is enforced once globally in plugins/auth.ts MUTATING_METHODS chokepoint and covered there; per-route duplication would test the chokepoint again, not this route. Rationale recorded here per G9.
- K5: correct FY26-27 comment to cite Finance Act 2026 presidential assent 30 March 2026 (rates confirmed unchanged).
