# Worker Delegation

## Task
087 — 13.1 FY Tax-Rule Data & Regime Preference

## Worker
`sonnet-worker`

## Routing Reason
High-thinking: Creating a new module with effective-dated tax rule data requires understanding Indian tax law, designing multi-dimensional lookup APIs, integrating with existing codebase patterns (module registration, schema barrel, backup arrays), and extracting `fyOf`/`fyRange` without breaking existing consumers. Multiple components with non-local interactions.

## Approved Plan
- P1: Extract `fyOf`/`fyRange` to `lib/financial-year.ts` with strict validation. Write tests first. Update capital-gains.ts import.
- P2: Create `lib/tax-rules.ts` with effective-dated data — slabs, caps, rates, advance-tax for FY 2023-24 through 2026-27, both regimes. Tests first.
- P3: Create `modules/tax/schema.ts` with `tax_regime_preferences` table, composite PK on `(user_id, fy)`, regime enum
- P4: Create `modules/tax/services/regime-preference.ts` — get/upsert. PUT writes only `chosen`.
- P5: Create `modules/tax/routes/regime-preference.ts` — GET/PUT
- P6: Create `modules/tax/plugin.ts`, wire into `app.ts` with `{ prefix: "/api/tax" }`
- P7: Wire `db/schema.ts`, `backup.ts`
- P8: Create `packages/shared/src/schemas/tax.ts`, export from `index.ts`
- P9: Generate Drizzle migration
- P10: Update route snapshots

## Files and Symbols
### New
- `apps/api/src/lib/financial-year.ts` — `fyOf`, `fyRange`, `parseFy`, `fyLabel`
- `apps/api/src/lib/financial-year.test.ts`
- `apps/api/src/lib/tax-rules.ts` — `getTaxSlabs`, `getDeductionCap`, `getAdvanceTaxSchedule`, `getRegimeRules`
- `apps/api/src/lib/tax-rules.test.ts`
- `apps/api/src/modules/tax/schema.ts`
- `apps/api/src/modules/tax/plugin.ts`
- `apps/api/src/modules/tax/routes/regime-preference.ts`
- `apps/api/src/modules/tax/services/regime-preference.ts`
- `packages/shared/src/schemas/tax.ts`

### Modified
- `apps/api/src/modules/investments/services/capital-gains.ts` — change import to `../../lib/financial-year.ts`
- `apps/api/src/db/schema.ts` — add tax module re-exports
- `apps/api/src/app.ts` — add `import { taxRoutes }` + `await app.register(taxRoutes, { prefix: "/api/tax" })`
- `apps/api/src/modules/system/services/backup.ts` — add `tax_regime_preferences` to ALL_TABLES and USER_TABLES
- `packages/shared/src/index.ts` — add `export * from "./schemas/tax.ts"`

## Required Changes
See Plan above

## Must Not Change
- `apps/api/src/lib/instrument-rules.ts` — tax rules are complementary, not replacing
- `apps/api/src/modules/investments/services/tax-lots.ts` — constants there encode per-lot logic
- Any existing test behavior (characterization tests first for fyOf/fyRange extraction)

## Acceptance Criteria
- AC1-AC7 from TASK.md

## Commands
1. Write tests: `node --test apps/api/src/lib/financial-year.test.ts`
2. Write tests: `node --test apps/api/src/lib/tax-rules.test.ts`
3. Full suite: `npm run typecheck && npm run lint && npm run test`
4. Generate migration: `npm run db:generate`

## Required Evidence
- files changed
- complete diff
- all commands and literal output
- exit codes
- plan deviations or blockers

---

## Iteration 2 — Independent Verification

## Worker
`codex-worker`

## Routing Reason
Low-thinking: deterministic gate runs and evidence collection against already-defined pass/fail criteria (T1-T10). Read-only apart from the verification report file.

## Approved Plan
Verify the uncommitted working tree implementing 087 (+ co-resident 089 deposit work): repo status, diff inventory, typecheck/lint gates, targeted new-test files, snapshot/schema-decomposition/backup-static tests, migration-vs-journal consistency, then full api suite with failures classified DB-dependent vs genuine.

## Required Evidence
- repository status, modified + untracked file lists
- exact commands, literal outputs, pass/fail counts, exit codes
- per-check verdict mapped to T1-T10 of TASK.md
- skipped commands and why

---

## Iteration 3 — Fix round 2 (review-2 blockers)

## Worker
`sonnet-worker`

## Routing Reason
High-thinking: tax-law data modelling choices (taxpayer-type variants, employer-rate restructure), boundary-convention flip with test-value updates, atomic upsert SQL design in Drizzle, and migration regeneration. Not mechanical.

## Approved Plan
TASK.md "Fix round 2" G1–G10 exactly, driven by review-2 findings H1/H2/M1-M7/L1-L3. Tests written before code per TDD where behaviour changes (G1/G2/G5/G6/G7/G10). Read tasks/087-tax-rule-data/review-2.md for full evidence.

## Files and Symbols
- `apps/api/src/lib/tax-rules.ts` + `.test.ts` — G1 G2 G4 G7 (+data)
- `apps/api/src/lib/financial-year.ts` + `.test.ts` — G10 (fyOf validation, fyLabel)
- `packages/shared/src/schemas/tax.ts` — G3? no: G5 (FySchema refinement)
- `apps/api/src/modules/tax/schema.ts` — G8 (enum-typed columns; new regime_source enum)
- `apps/api/src/modules/tax/services/regime-preference.ts` — G3 G6 (atomic upserts, uncovered-FY 400)
- `apps/api/src/modules/tax/routes/regime-preference.ts` — only if error mapping requires
- NEW `apps/api/src/modules/tax/services/regime-preference.test.ts` — G9 DB-backed tests
- `apps/api/drizzle/` — generated migration 0013 via db:generate (never hand-edit)

## Must Not Change
- `apps/api/drizzle/0012_simple_nightshade.sql`, `drizzle/meta/*` history (0012 stays as generated)
- instrument-rules.ts, tax-lots.ts, capital-gains.ts
- Route snapshots unless a route contract visibly changes (it should not)
- Anything under modules/investments/** EXCEPT nothing — full stop (co-resident task 089 owns that subtree this round)

## Acceptance Criteria
AC1-AC7 from TASK.md now fully satisfied incl. senior variants, complete caps matrix, loud uncovered-FY failures, enum-typed persistence, service/route tests.

## Commands
1. `npm run typecheck`
2. `npm run lint`
3. `node --test apps/api/src/lib/financial-year.test.ts apps/api/src/lib/tax-rules.test.ts`
4. `DATABASE_URL="postgresql://localhost/dummy" node --test apps/api/src/modules/system/services/backup.test.ts` (static)
5. `npm run db:generate` (after schema change; expect new 0013 migration)
6. `npm run test -w apps/api` — report counts; classify DB-dependent failures

## Required Evidence
- files changed + complete diff
- literal command output + exit codes
- explicit note of any plan deviation or ambiguity encountered

---

## Iteration 4 — Independent Verification (round 2)

## Worker
`codex-worker`

## Routing Reason
Low-thinking: deterministic gates and evidence collection against fixed criteria, covering fix rounds G1-G10 plus co-resident 089 changes.

## Approved Plan
Full-tree gate run post-fix-rounds: status/diff inventory, typecheck, lint, all targeted suites (financial-year, tax-rules, regime-preference pure tests, deposit suites, route-snapshot, schema-decomposition incl. new 58-enum count, backup static), shared workspace suite, FULL api suite with DB-vs-genuine classification, migration journal consistency (0012 + 0013).

## Required Evidence
- literal outputs, pass/fail counts, exit codes, per-T verdicts (T1-T10), two report files (verification-2.md here)

---

## Iteration 5 — Fix round 3 (review-3 M7 residue)

## Worker
`sonnet-worker`

## Routing Reason
High-thinking-lite: replicating the repo's mock.module hermetic route-test pattern correctly requires care; the concurrency test must assert a genuine invariant rather than flake. Coordinator decided K4 (demo-route test) is satisfied by documented rationale.

## Approved Plan
TASK.md "Fix round 3" K1–K5 exactly. K4 is a DECISION already made — do not write a demo route test; TASK.md carries the rationale.

## Files and Symbols
- `apps/api/src/db/schema.decomposition.test.ts` — K1 (add regimeSourceEnum to taxResidents + identity map)
- `apps/api/src/modules/tax/services/regime-preference.test.ts` — K2 (concurrency consistency test, DB-backed/guarded)
- NEW `apps/api/src/modules/tax/routes/regime-preference.hermetic.test.ts` — K3 (invalid-FY "2025-27" → HTTP 400 on GET and PUT via mock.module service stub pattern)
- `apps/api/src/lib/tax-rules.ts` — K5 comment-only edit (Finance Act 2026 assent 30 March 2026)

## Must Not Change
- Any production logic (services/lib/routes/schema) — test + comment edits ONLY
- modules/investments/**, shared schemas, migrations, snapshots

## Acceptance Criteria
Review-3 M7 fully resolved (K1-K3 implemented, K4 rationale documented in TASK.md); decomposition invariant covers regimeSourceEnum; hermetic route tests pass in this environment.

## Commands
1. node --test apps/api/src/db/schema.decomposition.test.ts apps/api/src/modules/tax/routes/regime-preference.hermetic.test.ts apps/api/src/modules/tax/services/regime-preference.test.ts
2. npm run typecheck
3. npm run lint

## Required Evidence
- files changed + complete diff, literal outputs, exit codes, deviations

---

## Iteration 6 — Independent Verification (round 3, final)

## Worker
`codex-worker`

## Routing Reason
Low-thinking: deterministic gates over the post-round-3 tree (K1-K5 landed) incl. the new hermetic route tests under --experimental-test-module-mocks.

## Required Evidence
- literal outputs, counts, exit codes, T1-T10 verdicts, report file verification-3.md

---

## Iteration 7 — Fix round 4 (review-4 K2 residue)

## Worker
`codex-worker`

## Routing Reason
Low-thinking: coordinator-specified test-assertion tightening in one existing test file; no production code changes.

## Approved Plan
In apps/api/src/modules/tax/services/regime-preference.test.ts concurrency test (K2): (1) replace the loss-tolerant assertions with EXACT postconditions — after Promise.all settles, row.chosen MUST equal its submitted value and row.inferredRegime MUST equal its submitted value (both atomic upserts preserve the other field under ANY interleaving), then keep the effective/source resolution assertions; (2) raise iterations from 10 to 25; (3) add a brief comment stating the residual probabilistic detection tradeoff (sound test — no false pass on lost update — but catching a reverted read-modify-write race remains probabilistic because deterministic mid-statement interleaving would require production test hooks, which the coordinator declined).

## Files and Symbols
- `apps/api/src/modules/tax/services/regime-preference.test.ts` — K2 test only

## Must Not Change
- Anything else

## Commands
1. node --experimental-test-module-mocks --test apps/api/src/modules/tax/services/regime-preference.test.ts apps/api/src/modules/tax/routes/regime-preference.hermetic.test.ts
2. npm run typecheck

## Required Evidence
- complete diff, literal outputs, exit codes

---

## Iteration 8 — Independent Verification (round 4, FINAL)

## Worker
`codex-worker`

## Routing Reason
Low-thinking: final combined gates over the completed tree (K-fix landed).

## Required Evidence
- literal outputs, counts, exit codes, T1-T10 verdicts, report file verification-4.md

---

## Iteration 9 — Commit & release (user-requested, joint for 087+089)

## Worker
`codex-worker`

## Routing Reason
Low-thinking: mechanical git operations with a coordinator-chosen explicit file list; no code changes.

## Approved Plan
Stage ONLY the explicit file list (both tasks' code + migrations + task artifacts), commit with the prescribed message + Co-Authored-By trailer, then cut release v3.3.0 (or next minor if v3.3.* exists): bump version per repo convention if any, tag, push branch + tag. Never `git add -A`/`git add .`; never stage AGENTS.md, tasks/065-086 dirs, or any private artifact.

## Required Evidence
- git status before/after staging (porcelain), commit hash + message, tag name, push output, exit codes — in release-1.md
