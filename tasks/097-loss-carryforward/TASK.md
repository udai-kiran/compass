# Task: 13.11 — Capital Loss Set-off & Carry-forward

## Status
PLAN_REVIEW

## Objective
Model capital loss set-off ordering, track brought-forward losses with 8-year expiry and a timely-filing gate, expose expiring losses, and feed 13.10 (advance tax) and 13.12 (harvesting).

## Root Cause
`capital-gains.ts` returns signed gain/loss totals per FY but there is no set-off computation, no carry-forward tracking, no expiry, and no filing-eligibility gate. Advance tax without set-off overstates tax.

## Codex Review-2 Findings (addressed)

**H1 (allocation availability)**: Availability computed per type across ALL prior allocations, never just the target FY. Per-type conservation enforced separately. Insert path: transaction locks the record row (`FOR UPDATE`), validates remaining balances, inserts allocation atomically.

**H2 (advisory BFLA is pure simulation)**: Estimates NEVER persist allocations. Allocations are persisted ONLY via explicit user confirmation.

**H3 (materialization guards)**: `materializeCurrentFy()` refuses when the record has `loss_declared_in_itr=true` OR any confirmed allocations exist.

**H4 (dated set-off for §234C)**: `simulateSetOffAsOf(db, userId, fy, cutoffDate)` used by 13.10.

**M1–M7, L1–L3**: superseded by later revisions — see git history for this file. The "Service: capital-loss.ts + capital-loss-math.ts — CANONICAL SPEC" section below is the sole source of truth.

## Codex Review-3 Findings (addressed)

Required: `declareFiledLoss` as the only path to BFLA eligibility, an atomic `FOR UPDATE` guard inside `materializeCurrentFy` itself, three explicitly-scoped availability definitions, real-DB concurrency/race tests, `isEstimate`/`source` on every read response, cutoff-date validation. All present in the canonical spec below.

## Codex Review-4 Findings (addressed)

**H1 (timely filing)**: Added `filed_within_due_date BOOLEAN NOT NULL DEFAULT false`, set only via `declareFiledLoss`. BFLA eligibility requires all three: `source='user_filed' AND loss_declared_in_itr AND filed_within_due_date`.

**H2/H3 (exact-vs-advisory ordering; cross-record target-gain conservation)**: `confirmSetOff` takes a `pg_advisory_xact_lock` keyed by `(userId, setoffFy)` before validating; the annual simulation applies confirmed (exact) allocations for the target FY first, in canonical BF order, then simulates the remaining advisory records. (Review-5 found this needed a precise pool definition — see below.)

**H4 (absent-row races)**: `materializeCurrentFy` and `declareFiledLoss` both take a `pg_advisory_xact_lock` keyed by `(userId, originFy)` before their SELECT-or-upsert logic.

**M4 (arbitrary FY)**: `materializeCurrentFy` returns 400 unless `fy === currentFy()`.

**M7 (TDD checkboxes)**: Every AC below is an unchecked `- [ ] ACn:` item.

**L1 (zero-loss records)**: Both mutation paths delete/omit a row that would have both `stclPaise` and `ltclPaise` at zero.

**L2 (FY boundaries)**: Every stored/accepted FY validated via `parseFy`; origin start years ≥ 9991 rejected.

## Codex Review-5 Findings (addressed — this revision)

Review-5 confirmed H1/H4/M4/M7/L1/L2 fully resolved, H2/H3 partially resolved (the mechanism was right but the target pool was undefined and the plan contradicted itself about clamping), and found the following, now fixed:

**H1 (target pool undefined after CYLA)**: `confirmSetOff`'s cross-record validation cannot use the capital-gains statement's raw `shortTermGainPaise`/`longTermGainPaise` directly — those are pre-set-off totals. If current-year STCL has already consumed the year's LTCG via CYLA, the true confirmable BFLA capacity for that FY is the CYLA **residual**, not the raw signed total. Fixed: `confirmSetOff` now explicitly runs `getCurrentFyLossInputs` → `computeSetOff` on the target FY's own statement first, and validates against `netStcg`/`netLtcg` (the CYLA residual), never the raw statement.

**H2 (clamp contradiction) + M6 (Compass's portfolio may be incomplete)**: The previous draft said both "never silently clamp" and "apply what the pool can cover" (which IS clamping) — and separately, hard-rejecting a confirmation because Compass's own recorded gains can't substantiate it is unsound because Compass's portfolio data is not necessarily ITR-complete (external brokers, unmodeled gains). Both are fixed by ONE coherent policy, now specified precisely below: `confirmSetOff` **never rejects for insufficient target-FY gain pool** — a confirmation is the user's real filed fact, and Compass cannot authoritatively contradict it. Instead every read response (annual summary, dated simulation, list) reports three figures per confirmed record: **claimed** (the stored, immutable, filed amount), **supported** (what Compass's own current data can substantiate, i.e. the CYLA-residual-pool-clamped amount), and **discrepancy** (claimed − supported, ≥ 0). The only thing that remains a hard rejection is the existing PER-RECORD source-side headroom check (a record's own STCL/LTCL balance is a real data-integrity invariant Compass DOES own and enforce) — that is unchanged.

**M1 (dated simulation self-contradiction)**: "Never reads `capital_loss_allocations`" and "warn when one exists for this FY" cannot both be literally true. Fixed wording: `simulateSetOffAsOf` reads only WHETHER a confirmed allocation exists for `setoff_fy = fy` (a cheap existence/count check) for the purpose of the warning note — it never reads or applies the allocation's stored destination amounts.

**M2 (one-directional lifecycle constraint)**: Added the reverse invariant — `source='user_filed'` now implies `loss_declared_in_itr=true` (since `declareFiledLoss` is the only writer of `source='user_filed'` and always sets the flag together with it).

**M3 (functional core)**: The exact-then-advisory partitioning, the CYLA-residual pool derivation, and the claimed/supported/discrepancy computation all move into `capital-loss-math.ts` as pure functions; `capital-loss.ts` only loads rows/statements, acquires locks, calls the pure functions, and persists.

**M4 (wrong SafePaiseSchema path + signed-field mislabeling)**: `SafePaiseSchema` is at `packages/shared/src/money.ts` (corrected below — the prior draft cited a nonexistent `schemas/money.ts` path). `netStcgPaise`/`netLtcgPaise` are NOT signed — `computeSetOff`'s `consume()` chain can only reduce a gain toward zero, never past it, so these are always ≥ 0; they now use `SafePaiseSchema` like every other paise field, with the "(signed)" mislabeling removed.

**M5 (`getCapitalGains` signature)**: `confirmSetOff` must read the target FY's capital-gains statement from INSIDE its own transaction (under the advisory lock, for a consistent read). `apps/api/src/modules/investments/services/capital-gains.ts`'s `getCapitalGains` currently accepts `Db` only; this task widens its parameter type to `DbOrTx` (backward-compatible — every existing caller passing a `Db` still satisfies `DbOrTx`). This is now an explicit Plan item (P0) rather than an implicit assumption.

**M7 (duplicate confirmation)**: `confirmSetOff` now explicitly pre-checks for an existing `(loss_record_id, setoff_fy)` row inside the same transaction and returns a controlled 409 ("already confirmed for this financial year") rather than letting the `UNIQUE` constraint surface as a raw database error.

**M8 (response contract ambiguities)**: Resolved below in "Response contracts": `broughtForwardSummary`/`expiringLosses` are explicitly the PRE-application (opening) availability for the requested FY, not post-simulation remainders; every confirmed-record figure is now claimed/supported/discrepancy, never a single ambiguous "applied" number; `materializeCurrentFy`/`declareFiledLoss`/`confirmSetOff` each get an explicit response schema; `isEstimate` on `CapitalLossRecordSchema` is now PER-RECORD (`true` iff `source='derived_from_portfolio'`, `false` iff `source='user_filed'` — a filed record's own stored balance is a stated fact, not an estimate) rather than a blanket `true`.

**M9 (lock-key pseudocode)**: `hash(userId, fy)` was not a real function. Fixed: ONE canonical helper, `capitalLossLockKey(userId: string, fyLabel: string): string`, used identically by all three lock sites (`materializeCurrentFy`, `declareFiledLoss` — keyed by `(userId, originFy)` — and `confirmSetOff` — keyed by `(userId, setoffFy)`), calling Postgres's `pg_advisory_xact_lock(hashtextextended(key, 0))` exactly as the existing `apps/api/src/lib/account-lock.ts` already does for a different lock (session-level there, transaction-level here — this task's locks are released automatically at transaction end and do not need `account-lock.ts`'s session-level machinery or its SERIALIZABLE snapshot handling).

## Scope

### New tables (in tax module)
```sql
capital_loss_records (
  id UUID PK,
  user_id UUID FK→users ON DELETE CASCADE,
  origin_fy TEXT NOT NULL,              -- "2023-24"; expires_fy derived server-side via parseFy math
  expires_fy TEXT NOT NULL,             -- INCLUSIVE last usable FY: origin start-year +8 → "2031-32"
  stcl_paise BIGINT NOT NULL DEFAULT 0 CHECK (stcl_paise >= 0),
  ltcl_paise BIGINT NOT NULL DEFAULT 0 CHECK (ltcl_paise >= 0),
  source TEXT NOT NULL DEFAULT 'derived_from_portfolio' CHECK (source IN ('derived_from_portfolio','user_filed')),
  loss_declared_in_itr BOOLEAN NOT NULL DEFAULT false,
  filed_within_due_date BOOLEAN NOT NULL DEFAULT false,
    -- BFLA eligibility requires source='user_filed' AND loss_declared_in_itr AND filed_within_due_date, all true
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, origin_fy),
  CHECK (NOT loss_declared_in_itr OR source = 'user_filed'),
  CHECK ((source = 'user_filed') = loss_declared_in_itr),  -- (review-5 M2) filed source <=> declared, both directions
  CHECK (loss_declared_in_itr OR NOT filed_within_due_date)  -- can't be "timely filed" without being "filed"
)

capital_loss_allocations (
  id UUID PK,
  loss_record_id UUID NOT NULL FK→capital_loss_records(id) ON DELETE CASCADE,
  -- NO user_id column: scoped through parent record
  setoff_fy TEXT NOT NULL,
  stcl_to_stcg_paise BIGINT NOT NULL DEFAULT 0 CHECK (>= 0),
  stcl_to_ltcg_paise BIGINT NOT NULL DEFAULT 0 CHECK (>= 0),
  ltcl_to_ltcg_paise BIGINT NOT NULL DEFAULT 0 CHECK (>= 0),
  confirmed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (loss_record_id, setoff_fy),
  CHECK (stcl_to_stcg_paise + stcl_to_ltcg_paise + ltcl_to_ltcg_paise > 0)  -- no all-zero confirmations
)
-- Per-type conservation (record's OWN stcl/ltcl balance — a hard invariant Compass owns):
-- enforced in service inside a SELECT ... FOR UPDATE transaction:
-- SUM(stcl_to_stcg + stcl_to_ltcg over confirmed allocations) <= record.stcl_paise
-- SUM(ltcl_to_ltcg) <= record.ltcl_paise
-- Cross-record target-FY gain-pool check (review-5 H2/M6): NEVER a hard rejection — see
-- "claimed/supported/discrepancy" in the canonical service spec below.
```

### Service: capital-loss.ts + capital-loss-math.ts — CANONICAL SPEC

`capital-loss-math.ts` (pure, DB-free — M3/M5 from review-2/4, expanded per review-5 M3):
```typescript
consume(loss, gain): { lossUsed, gainRemaining, lossRemaining }  // rejects negative/non-integer/unsafe
computeSetOff(stcg, stcl, ltcg, ltcl): {
  r1 = consume(ltcl, ltcg); r2 = consume(stcl, r1.gainRemaining); r3 = consume(r2.lossRemaining, stcg)
  → { netLtcg: r2.gainRemaining, netStcg: r3.gainRemaining, carryForwardLtcl: r1.lossRemaining, carryForwardStcl: r3.lossRemaining }
}  // PURE DETERMINISTIC ALLOCATION POLICY (LTCL→LTCG, STCL→remaining LTCG, STCL→STCG) — not statutory
   // netLtcg/netStcg are ALWAYS >= 0 (consume() can only reduce a gain toward zero) — never signed/negative.
getCurrentFyLossInputs(statement): { stcg=max(0,st), stcl=max(0,−st), ltcg=max(0,lg), ltcl=max(0,−lg) }
// Availability — three distinct scopes, given plain (record, allocations[]) inputs, never touch the DB:
stclUsed(allocations) = SUM(stcl_to_stcg_paise + stcl_to_ltcg_paise)
ltclUsed(allocations) = SUM(ltcl_to_ltcg_paise)
advisoryOpening(record, allocations, targetFy): availableSTCL = record.stcl − stclUsed(allocations.filter(a => a.setoffFy < targetFy)); availableLTCL likewise
confirmationHeadroom(record, allocations): availableSTCL = record.stcl − stclUsed(allocations); availableLTCL likewise (ALL allocations count)
listAvailability = confirmationHeadroom  // GET list view
// Out-of-order confirmations allowed; advisoryOpening ignores a later-FY confirmation until targetFy reaches it.
bfOrderCompare(a, b): sort key (expires_fy, origin_fy, id) — oldest-expiring-first
deriveExpiresFy(originFy): parseFy(originFy) math, +8 years inclusive; throws if origin start year >= 9991
// (review-5 additions — the exact/advisory algorithm itself, moved out of the orchestration shell:)
deriveCylaTargetPools(targetFyStatement): { targetStcgPool: SafePaise, targetLtcgPool: SafePaise }
  // = computeSetOff(getCurrentFyLossInputs(targetFyStatement)).{netStcg, netLtcg} — the CYLA RESIDUAL,
  // never the statement's raw signed totals (review-5 H1).
reconcileConfirmedAllocation(allocation, otherConfirmedAllocationsForSameFy, targetPools):
  // → { claimedStclToStcgPaise, claimedStclToLtcgPaise, claimedLtclToLtcgPaise,   // = the stored row, verbatim
  //     supportedStcgPaise, supportedLtcgPaise,     // = min(claimed contribution, remaining pool after
  //                                                  //   OTHER confirmed allocations for this FY are subtracted first)
  //     discrepancyStcgPaise, discrepancyLtcgPaise }  // = claimed − supported, always >= 0, never negative
  // NEVER throws — a stored confirmation is never rejected retroactively; this only REPORTS the gap.
applyExactThenAdvisory(cylaResidual, exactRecords[], advisoryRecordsInBfOrder[], targetFy):
  // exact records (each already reconciled via reconcileConfirmedAllocation) subtract their SUPPORTED
  // amount from the running pool, in canonical BF order among themselves; then advisory records simulate
  // via advisoryOpening + computeSetOff's BFLA half on whatever pool remains.
capitalLossLockKey(userId, fyLabel): string  // canonical lock-key text, shared by all three DB lock sites
```

`capital-loss.ts` (thin orchestration shell — loads rows/statements, acquires locks, calls capital-loss-math.ts, persists in transactions):

**`getNetGainsAfterSetOff(db, userId, fy)`**: read-only (does I/O; not pure).
1. Load the `fy` capital-gains statement; compute `{targetStcgPool, targetLtcgPool}` via `deriveCylaTargetPools` — this is also the CYLA step for the annual result itself.
2. BF records: `origin_fy < fy AND expires_fy >= fy AND source='user_filed' AND loss_declared_in_itr AND filed_within_due_date`, ordered via `bfOrderCompare`.
3. Partition into records with a CONFIRMED allocation where `setoff_fy = fy` ("exact") and those without ("advisory").
4. For each exact record, call `reconcileConfirmedAllocation` (passing every OTHER exact record's confirmed allocation for this same `fy` so the pool is shared correctly across records) to get its claimed/supported/discrepancy figures.
5. Call `applyExactThenAdvisory` with the CYLA pool, the reconciled exact records, and the advisory records in BF order to get the final `netStcgPaise`/`netLtcgPaise` and each advisory record's applied amount.
6. Returns `{ isEstimate: true, perRecordSource, netStcgPaise, netLtcgPaise, broughtForwardSummary, expiringLosses, notes }` — see Response contracts. Any nonzero discrepancy from step 4 becomes a `notes[]` entry naming the record and the shortfall.

**`simulateSetOffAsOf(db, userId, fy, cutoffDate)`**: read-only, for 13.10.
- 400 unless `cutoffDate` is a real ISO date INSIDE `fy`.
- Only capital-gain slices with `sellDate <= cutoffDate` (positive and negative), through CYLA+BFLA using the same eligible BF records as above, always simulated via `advisoryOpening` — it reads only WHETHER a confirmed allocation exists for `setoff_fy = fy` (a cheap existence check, e.g. `EXISTS(...)` or a row count) to decide whether to emit the divergence-warning note; it never reads or applies that allocation's stored destination amounts.
- If a confirmed allocation exists for `setoff_fy = fy` on any eligible record, add an explicit `notes[]` entry: this dated estimate may diverge from the annual filed figure for that record.

**`materializeCurrentFy(db, userId, fy)`**: ATOMIC guard + write in ONE transaction.
1. 400 unless `fy === currentFy()`.
2. BEGIN; `pg_advisory_xact_lock(hashtextextended(capitalLossLockKey(userId, fy), 0))`.
3. SELECT existing row for `(userId, originFy=fy)` FOR UPDATE.
4. In-lock refusal (409): `loss_declared_in_itr` OR any confirmed allocation exists.
5. Compute CYLA residual (`carryForwardStcl`, `carryForwardLtcl`) from the current statement via `computeSetOff`.
6. If both are zero: delete the existing row if present; do nothing otherwise. Else upsert `.onConflictDoUpdate({target:[userId,originFy], set:{stcl,ltcl,source:'derived_from_portfolio',updatedAt}})`.
7. COMMIT. Response: `MaterializeResultSchema` (see Response contracts).

**`declareFiledLoss(db, userId, {originFy, stclPaise, ltclPaise, filedWithinDueDate})`**: User asserts ITR-filed balances.
1. BEGIN; `pg_advisory_xact_lock(hashtextextended(capitalLossLockKey(userId, originFy), 0))`.
2. SELECT existing row FOR UPDATE if present.
3. Refused (409) if any confirmed allocation exists.
4. If both `stclPaise` and `ltclPaise` are zero: delete the existing row if present; do nothing otherwise. Else upsert `source='user_filed', loss_declared_in_itr=true, filed_within_due_date=filedWithinDueDate, expires_fy=deriveExpiresFy(originFy)`.
5. COMMIT. Response: `CapitalLossRecordSchema` (see Response contracts), noting `filedWithinDueDate` is a user assertion Compass cannot independently verify.

**`confirmSetOff(db, userId, id, {setoffFy, stclToStcgPaise, stclToLtcgPaise, ltclToLtcgPaise})`**:
1. Reject 400 if all three destination amounts are zero.
2. BEGIN; `pg_advisory_xact_lock(hashtextextended(capitalLossLockKey(userId, setoffFy), 0))` — serializes ALL of this user's confirmations for this target FY across every loss record.
3. SELECT the target `capital_loss_records` row `(id, userId)` FOR UPDATE.
4. Require `source='user_filed' AND loss_declared_in_itr AND filed_within_due_date`, all true; 409 otherwise.
5. Validate `origin_fy < setoffFy <= expires_fy` (parseFy-checked).
6. **Duplicate check (review-5 M7)**: if a `(loss_record_id, setoffFy)` row already exists, return a controlled 409 ("already confirmed for this financial year") rather than letting the `UNIQUE` constraint raise a raw DB error.
7. `confirmationHeadroom(record, record's existing confirmed allocations)` — validate `stclToStcgPaise + stclToLtcgPaise <= availableSTCL` and `ltclToLtcgPaise <= availableLTCL`; 409 on violation. This per-record source-side check is the ONLY hard rejection related to amounts.
8. Load the `setoffFy` capital-gains statement via `getCapitalGains(tx, userId, setoffFy)` — **inside this same transaction**, using the now-`DbOrTx`-typed function (review-5 M5) so the read is consistent under the advisory lock from step 2.
9. INSERT the allocation row (the claimed amounts, verbatim — never adjusted or rejected based on the target pool).
10. Touch `record.updatedAt`.
11. COMMIT. Response: `ConfirmSetOffResultSchema` (see Response contracts), which includes the newly reconciled claimed/supported/discrepancy figures for the just-inserted allocation (computed via `reconcileConfirmedAllocation` against the pool derived in step 8, read-only — this does not affect steps 6-10's outcome).

### Response contracts (shared Zod, packages/shared/src/schemas/tax.ts)

`SafePaiseSchema` is imported from `packages/shared/src/money.ts` (NOT `schemas/money.ts`). Every paise field below uses it; every one of these values is non-negative (review-5 M4 — `computeSetOff`'s outputs cannot go negative).

```typescript
// GET /capital-loss-records?fy=
CapitalLossRecordSchema = {
  id, originFy, expiresFy, stclPaise: SafePaise, ltclPaise: SafePaise,
  source: 'derived_from_portfolio'|'user_filed', lossDeclaredInItr: boolean,
  filedWithinDueDate: boolean, notes: string|null,
  availableStclPaise: SafePaise, availableLtclPaise: SafePaise,  // listAvailability = confirmationHeadroom
  isEstimate: boolean,  // PER-RECORD: true iff source='derived_from_portfolio'; false iff 'user_filed'
}
CapitalLossRecordListSchema = { records: CapitalLossRecordSchema[] }

// GET /capital-loss-records/set-off-summary?fy=
ReconciledAllocationSchema = {
  lossRecordId,
  claimedStclToStcgPaise: SafePaise, claimedStclToLtcgPaise: SafePaise, claimedLtclToLtcgPaise: SafePaise,
  supportedStcgPaise: SafePaise, supportedLtcgPaise: SafePaise,
  discrepancyStcgPaise: SafePaise, discrepancyLtcgPaise: SafePaise,  // 0 when fully supported
}
PerRecordSetOffSourceSchema = { lossRecordId, kind: 'confirmed'|'advisory', stclAppliedPaise: SafePaise, ltclAppliedPaise: SafePaise }
NetGainsAfterSetOffSchema = {
  fy, isEstimate: true, netStcgPaise: SafePaise, netLtcgPaise: SafePaise,
  perRecordSource: PerRecordSetOffSourceSchema[],
  reconciledConfirmedAllocations: ReconciledAllocationSchema[],  // one entry per 'confirmed' record in perRecordSource
  broughtForwardSummary: { totalAvailableStclPaise: SafePaise, totalAvailableLtclPaise: SafePaise },  // OPENING (pre-this-FY-application) availability
  expiringLosses: Array<{ lossRecordId, expiresFy, remainingStclPaise: SafePaise, remainingLtclPaise: SafePaise }>,  // OPENING remaining, before this simulation
  notes: string[],
}

// GET /capital-loss-records/simulation-as-of?fy=&cutoff=
DatedSetOffSimulationSchema = {
  fy, cutoffDate, isEstimate: true, netStcgPaise: SafePaise, netLtcgPaise: SafePaise,
  perRecordSource: PerRecordSetOffSourceSchema[], notes: string[],
}

// POST /capital-loss-records/materialize?fy=  (response)
MaterializeResultSchema = { record: CapitalLossRecordSchema.nullable() }  // null when the zero-result deleted the row

// POST /capital-loss-records/declare-filed  (request + response)
DeclareFiledLossBodySchema = { originFy: FySchema, stclPaise: SafePaise (>=0), ltclPaise: SafePaise (>=0), filedWithinDueDate: z.boolean() }
// response: CapitalLossRecordSchema.nullable()  (null when a zero-balance declaration deleted the row)

// POST /capital-loss-records/:id/confirm-set-off  (request + response)
ConfirmSetOffBodySchema = { setoffFy: FySchema, stclToStcgPaise: SafePaise (>=0), stclToLtcgPaise: SafePaise (>=0), ltclToLtcgPaise: SafePaise (>=0) }
ConfirmSetOffResultSchema = { allocationId, reconciled: ReconciledAllocationSchema }
```

### Routes (relative paths in tax plugin)
- `GET /capital-loss-records?fy=` — list + listAvailability + per-record isEstimate/source
- `POST /capital-loss-records/materialize?fy=` — derive current-FY CYLA residual (guarded, atomic; 400 if fy is not the current FY)
- `POST /capital-loss-records/declare-filed` — declareFiledLoss {originFy, stclPaise, ltclPaise, filedWithinDueDate}
- `POST /capital-loss-records/:id/confirm-set-off` — confirmed allocation (requires declared + timely-filed record; never rejected for insufficient target-FY pool, only for insufficient own-record headroom or a duplicate)
- `GET /capital-loss-records/set-off-summary?fy=` — annual advisory simulation (exact allocations reconciled and applied first, then advisory)
- `GET /capital-loss-records/simulation-as-of?fy=&cutoff=` — dated slice simulation (cutoff validated within FY; reads only whether a confirmed allocation exists, never its amounts)

## Dependencies
- 13.1 (FY helpers, financial-year.ts)
- 13.4 (income events, for advance tax integration context)

## Plan
- P0 (review-5 M5): Widen `apps/api/src/modules/investments/services/capital-gains.ts`'s `getCapitalGains` parameter type from `Db` to `DbOrTx` (backward-compatible). Confirm no existing caller breaks.
- P1: Add capital_loss_records + capital_loss_allocations tables to tax/schema.ts (per-type allocation breakdown columns; no child user_id; all three CHECK constraints, including the review-5 M2 reverse lifecycle invariant)
- P2: Add shared Zod schemas exactly per "Response contracts" above, using `SafePaiseSchema` from `packages/shared/src/money.ts` for every paise field
- P3a: Create `capital-loss-math.ts` — pure functions only: consume, computeSetOff, getCurrentFyLossInputs, the three availability formulas, bfOrderCompare, deriveExpiresFy, deriveCylaTargetPools, reconcileConfirmedAllocation, applyExactThenAdvisory, capitalLossLockKey — no Db, no I/O, no clock
- P3b: Create `capital-loss.ts` — orchestration shell calling P3a exclusively for decision logic: getNetGainsAfterSetOff, simulateSetOffAsOf, materializeCurrentFy (advisory lock + FOR UPDATE + current-FY-only + zero-record deletion), declareFiledLoss (advisory lock + filedWithinDueDate), confirmSetOff (per-record FOR UPDATE + per-target-FY advisory lock + duplicate pre-check + in-transaction getCapitalGains call + never rejects on target-pool insufficiency)
- P4: Create routes (6 endpoints in tax plugin)
- P5: Wire tax plugin, backup (records → ALL_TABLES+USER_TABLES; allocations → ALL_TABLES+LINKED_TABLES via parent scope), barrel, decomposition (+2 tables)
- P6: Generate migration; update route snapshots
- P7: Tests (real-Postgres integration tests per tasks/TDD.md — no mocked Drizzle):
  - `capital-loss-math.ts`: pure unit tests — consume() conservation per type incl. negative/non-integer/unsafe rejection; LTCL-before-STCL policy; expiry boundary (usable in 2031-32, not 2032-33, origin-year-9991 rejection); bfOrderCompare order-independence; `deriveCylaTargetPools` correctly reduces a raw LTCG when current-year STCL has consumed it (the exact review-5 H1 counterexample: STCG=-100, LTCG=+100 → target LTCG pool = 0); `reconcileConfirmedAllocation` produces zero discrepancy when fully supported and a positive discrepancy when the pool shrank after filing, across generated safe-integer inputs (property coverage: supported ≤ claimed always, discrepancy = claimed − supported always ≥ 0); `applyExactThenAdvisory` never produces a negative pool
  - Real-DB: BF oldest-expiring-first consumption; availability across MULTIPLE prior confirmed allocations; concurrent confirm-set-off inserts on the SAME record (parent lock prevents over-allocation); concurrent confirm-set-off inserts on DIFFERENT records for the SAME target FY (advisory lock serializes correctly); materialize-vs-declare race on an absent row (both orderings); materialize-vs-materialize and declare-vs-declare absent-row races; materialize-vs-confirm race; advisory endpoints leave allocation row counts unchanged; confirmed target-FY applied via reconciliation (not a second simulation); out-of-order confirmation handling; materialization 409 after declaration/confirmation; materialization 400 when fy is not the current FY; declare-filed refused when allocations exist; declare-filed with filedWithinDueDate=false stored but never BFLA-eligible; confirm-set-off rejects undeclared source, non-timely-filed source, over-allocation (own-record headroom), all-zero amounts, cross-user record; confirm-set-off does NOT reject when the target-FY pool is smaller than claimed — instead the response shows the discrepancy; duplicate confirm-set-off on the same (record, setoffFy) → controlled 409, not a raw constraint error; cutoff outside FY → 400; dated simulation excludes post-cutoff slices/losses and never applies a confirmed allocation's amounts even when one exists (only its existence gates a note); zero-loss materialize/declare deletes rather than upserting a zero row; response isEstimate/source/notes fields present on all read shapes, with per-record isEstimate matching source; cross-user isolation on every route; database rejects every invalid lifecycle combination (both CHECK directions); malformed FY labels rejected on all six routes; leap-day and FY-boundary cutoff dates; no-gain/no-loss/only-STCL/only-LTCL/both-pool cases; lock-key equivalence between materialize and declare (same helper, same result) and isolation between different users

## Acceptance Criteria
- [ ] AC1: Both tables in tax module; records in ALL_TABLES+USER_TABLES, allocations in ALL_TABLES+LINKED_TABLES; decomposition +2; both CHECK-constraint directions on the lifecycle columns enforced at the DB level
- [ ] AC2: Deterministic allocation policy (LTCL→LTCG, STCL→remaining LTCG, STCL→STCG), explicitly labeled non-statutory, implemented in a DB-free `capital-loss-math.ts` — including the exact/advisory partitioning and pool-reconciliation logic, not just the base consume()/computeSetOff()
- [ ] AC3: CYLA before BFLA; BFLA only from records with `source='user_filed' AND loss_declared_in_itr AND filed_within_due_date`, all true; order (expires_fy, origin_fy, id)
- [ ] AC4: expires_fy derived server-side (parseFy math), inclusive; origin "2023-24" usable through "2031-32"; origin-year-9991-or-later rejected
- [ ] AC5: Advisory endpoints (list, summary, dated simulation) are read-only — never persist; persisted allocations come ONLY from confirm-set-off; dated simulation never reads or applies a confirmed allocation's amounts, only whether one exists
- [ ] AC6: Non-reuse: availability subtracts ALL confirmed allocations from prior FYs (advisoryOpening) or all allocations (confirmationHeadroom); per-record source-side conservation enforced atomically under a per-record FOR UPDATE lock; cross-record target-FY validation is a CYLA-residual-pool reconciliation (claimed/supported/discrepancy), never a hard rejection
- [ ] AC7: Dated simulation available for 13.10 (slices ≤ cutoff only), always advisory
- [ ] AC8: Materialization guarded (409 once declared/confirmed; 400 if fy is not the current FY); serialized against declare-filed via a shared canonical per-(userId,originFy) advisory-lock helper; upsert updates updatedAt; zero-result deletes rather than upserting a zero row
- [ ] AC9: Confirmations are immutable, reject all-zero amounts, reject a duplicate (record, setoffFy) with a controlled 409, and are NEVER rejected for exceeding the target FY's recorded gains — the discrepancy is reported, not blocked
- [ ] AC10: `getCapitalGains` accepts `DbOrTx` and `confirmSetOff` reads it inside its own transaction under the advisory lock
- [ ] AC11: typecheck + lint + test green; every AC above has a corresponding test per tasks/TDD.md

## Non-Goals
- Rate-bucket-aware set-off optimization (policy is fixed deterministic order)
- Business/house-property loss set-off
- Automatic ITR filing status / timely-filing detection (user-asserted only)
- Correcting or amending a confirmed allocation (immutable in this task; a future amendment flow is a separate task)
- Modeling the pre-2025 vs Income-tax Act 2025 statutory text differences beyond the general 8-year/timely-filing shape
- Treating Compass's own portfolio data as an authoritative, ITR-complete gain statement — it is explicitly advisory, and a confirmed allocation is trusted even when Compass's data can't fully substantiate it (see H2/M6 above)
