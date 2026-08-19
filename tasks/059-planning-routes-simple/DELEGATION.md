# Sonnet Worker Delegation

## Task
059 — wire the 3 pass-through v2.2.0 endpoints.

## Approved Plan
Expose three existing DB-backed services as thin GET routes using the contract from 058:
- `GET /api/planning/income-surplus` → `getIncomeSurplus(app.db, userId, lookbackMonths)`
- `GET /api/planning/data-completeness` → `getDataCompletenessReport(app.db, userId)`
- `GET /api/credit/revolving-debt` → `getHouseholdRevolvingDebt(app.db, userId)`

Each handler is **one service call plus a return**. No DB access, no business logic in
routes (CLAUDE.md layering). No new Zod schema — 058 authored them all.

## Files and Symbols

**Create:**
- `apps/api/src/modules/planning/routes/planning-analysis.ts` — exports
  `planningAnalysisRoutes(app: FastifyInstance)`; declares income-surplus **then**
  data-completeness.
- `apps/api/src/modules/credit/routes/revolving-debt.ts` — exports `revolvingDebtRoutes`.
- Hermetic serializer tests (AC4a) + house-style integration tests (AC4b).

**Modify:**
- `apps/api/src/modules/planning/plugin.ts` — register `planningAnalysisRoutes`
  **after** `projectionSettingsRoutes` (lines 29-37). Do not reorder anything existing.
- `apps/api/src/modules/credit/plugin.ts` — register `revolvingDebtRoutes` **after**
  `overdraftDetailsRoutes` (lines 23-27).
- `apps/api/src/modules/planning/plugin.test.ts` — asserts exactly **8** route files at
  lines 19-40 → make it **9** and include a representative `planning-analysis.ts` route.
- `apps/api/src/modules/credit/plugin.test.ts` — asserts exactly **4** at lines 18-34 →
  make it **5** and include revolving-debt.
- `apps/api/src/route-surface.snapshot.txt`, `apps/api/src/route-table.snapshot.txt` —
  regenerate both.

**Schemas to use (already exist — import, do not author):**
`IncomeSurplusResultSchema`, `DataCompletenessReportSchema`,
`HouseholdRevolvingDebtSchema` from `@compass/shared`.

## Required Changes

**1. Route shape.** Follow `apps/api/src/modules/planning/routes/goals.ts` exactly:
`const r = app.withTypeProvider<ZodTypeProvider>();` then
`r.get(path, { schema: { response: { 200: XSchema } } }, async (req) => service(app.db, req.session!.userId))`.

**2. Query param — key is `querystring`, NOT `query`.** Only on income-surplus:
`z.object({ lookbackMonths: z.coerce.number().int().min(1).max(120).default(12) })`.
Follow the exemplars `cashflow.ts:7`, `dashboard.ts:17-24`, `imports.ts:67-80`.
Do **not** expose `today` on data-completeness — the service defaults it internally
(`data-completeness.ts:162-165`) and a client-movable reference date is a correctness
hazard. Zod strips unknown keys, so `?today=` is silently ignored; assert that.

**3. Document the owner-only scoping limitation** in the doc comment of each route and
in the service doc comments. State plainly that results are **owner-only** and omit
household-shared accounts/cards, that `withSharing` (`lib/sharing.ts`) is deliberately
not used because it currently has no production call sites anywhere, and that this is
tracked for a future sharing-rollout decision. This matters most for
`getHouseholdRevolvingDebt`, whose name promises household scope it does not deliver.

**4. Document the two residual real-DB 500 risks** (AC12) in the route doc comments:
(a) `Number(bigintString)` / Drizzle `mode:"number"` can exceed `Number.MAX_SAFE_INTEGER`,
which the contract's `.safe()` then correctly rejects → 500;
(b) `statement_reconciliations.period` is unconstrained `text` (`spines.ts:204-207`)
while the contract demands strict `YYYY-MM`, so malformed legacy data → 500.
Record them; do not "fix" them in this task.

**5. Snapshot regeneration.** `app.route-snapshot.test.ts` only *compares* — it has no
generator, so capture the exact expressions yourself: surface = flattened uppercase
methods, sorted, newline-joined, exactly one trailing newline (lines 75-108); table =
exact `app.printRoutes({ commonPrefix: false })` output (lines 120-131). Byte-exact.
**Fastify auto-registers HEAD per GET, so expect +6 lines: 313 → 319.**

**6. Tests.**
- **AC4a hermetic (must pass here):** real `serializerCompiler`, real route plugin,
  stubbed session + stubbed service, inject request, assert 200 and schema-valid JSON.
- **AC4b integration (will NOT pass here):** house style per
  `planning.route.test.ts:32-44`. These `requireEnv` `DATABASE_URL`, `REDIS_URL` and
  `SESSION_SECRET` and **throw at module load** when absent — they do not skip. Write
  them, run them, and report them as **written but unrun**. Do NOT claim they pass and
  do NOT weaken them to make them pass.
- Query validation: omitted (→12), valid coerced string, `0`, `121`, fractional,
  non-numeric; plus `?today=` silently stripped.

## Must Not Change
- Any service implementation. Any shared schema. Any existing route file.
- Registration order of existing routes; do not register in `app.ts`.
- Do not author a new Zod schema.
- Do not add sharing (`withSharing`) — that is the deferred decision.
- No `as any`, `@ts-ignore`, `@ts-expect-error`, `eslint-disable`.
- Do not stage, commit, or delete anything. Do not touch `screen-shots/`.

## ⚠ The tree is already dirty — 14 files are NOT yours
Tasks 057 and 058 are COMPLETE but uncommitted, and several of their files are
**untracked**, so `git diff` will not show them — use `git status --short`. Do not
revert, clean up, or count any of them as your work. This includes
`planning/services/income-surplus.test.ts`, `planning/services/goal-plan.ts`,
`goal-plan.test.ts`, `rebalancing-plan.test.ts`, `planning-schemas.test.ts`,
`packages/shared/src/schemas/planning.ts` and `credit.ts`.

## Acceptance Criteria
`TASK.md` AC1-AC12. Headlines: typecheck 0; lint 0; snapshot 313→319 (+6) and byte-exact;
both plugin tests updated and passing; hermetic 200 tests passing; integration tests
written but honestly reported unrun; handlers contain zero DB access; owner-only
limitation and both 500 risks documented.

## Commands
1. `git status --short` (BEFORE — baseline)
2. `npm run test 2>&1 | tail -40 ; echo "EXIT=$?"` (BEFORE — baseline totals)
3. `wc -l apps/api/src/route-surface.snapshot.txt` (BEFORE — expect 313)
4. (implement)
5. `npm run typecheck ; echo "EXIT=$?"`
6. `npm run lint ; echo "EXIT=$?"`
7. `node --test apps/api/src/app.route-snapshot.test.ts 2>&1 | tail -20`
8. `node --test apps/api/src/modules/planning/plugin.test.ts apps/api/src/modules/credit/plugin.test.ts 2>&1 | tail -20`
9. `wc -l apps/api/src/route-surface.snapshot.txt` (AFTER — expect 319)
10. `git diff -- apps/api/src/route-surface.snapshot.txt`
11. `npm run test 2>&1 | tail -50 ; echo "EXIT=$?"`
12. `grep -rnE "as any|ts-expect-error|ts-ignore|eslint-disable" <your new files>`

## Required Evidence
- files created/changed; complete `git diff` for tracked files + explicit list of new
  untracked files (they will not appear in `git diff`)
- every command with literal output and **exit code**
- the 6 added snapshot lines, verbatim
- literal hermetic-test output showing 200 + body per endpoint
- literal integration-test output showing the `requireEnv` failure, explicitly labelled
  "written but unrun — cannot be verified without DB/Redis"
- before/after test totals across all six workspaces and the failing-file sets
- confirmation each handler is one service call + return
- any deviation or blocker, stated rather than worked around

Write full details to `tasks/059-planning-routes-simple/implementation-1.md` and return
a digest of at most 20 lines plus that path.

---

## Iteration 2 — FIX PASS (review-2 findings)

Iteration 1 got the production code right: routes are thin and correct, snapshots are
exactly right (319 lines, 6 additions), plugin enumeration tests were genuinely updated,
docs on the routes are good. **Do not touch any of that.** Six test/documentation defects
must be fixed.

### FIX 1 (blocking) — the hermetic tests do not test the routes. Rewrite them.
`planning-analysis.hermetic.test.ts:88` and `revolving-debt.hermetic.test.ts:62`
**abandon the real route plugin** and declare substitute routes returning already
schema-valid fixtures. Their comments claim "real route plugin" — that is **false**.
As written they only prove Fastify's serializer accepts a clean fixture, which merely
re-proves task 058. They cannot catch wrong route wiring, a wrong service call, an
over-strict schema rejecting real output, or any handler regression.

**Required:** the REAL `planningAnalysisRoutes` / `revolvingDebtRoutes` plugin must be
registered and the REAL handler must execute. Substitute only the *service* dependency.
Suggested approach: use `mock.module` from `node:test` (Node 24) to stub
`../services/income-surplus.ts`, `../services/data-completeness.ts` and
`../services/revolving-debt.ts`, then build a minimal Fastify instance with the real
`serializerCompiler`/`validatorCompiler`, decorate a fake `db` and a stub session hook
setting `req.session = { userId: ... }`, register the real plugin, and `app.inject(...)`.
If `mock.module` proves unworkable, pick another mechanism — but the real plugin must be
registered. **If you cannot make the real handler execute, STOP and report it as a
blocker; do NOT fall back to a substitute route.**

**Prove non-vacuity:** temporarily change a route path (or a response field) in the real
route file, show the rewritten hermetic test FAILS, then revert and show it passes. Put
that literal evidence in your report. Also move the `lookbackMonths` validation tests
onto the real route so they cannot drift from it.

Delete the false "real route plugin" comments.

### FIX 2 (blocking) — add the missing service doc comments
Add the owner-only limitation to the doc comments of `getIncomeSurplus`
(`income-surplus.ts:117`), `getDataCompletenessReport` (`data-completeness.ts:159`) and
`getHouseholdRevolvingDebt` (`revolving-debt.ts:87`): results are owner-only, omit
household-shared accounts/cards, `withSharing` deliberately unused (zero production call
sites), tracked for a future sharing-rollout task. **Comments only — change no logic.**
Note especially that `getHouseholdRevolvingDebt`'s name overpromises household scope.

### FIX 3 (blocking) — make the AC4b fixtures actually exercise the documented risks
They currently create fresh empty users, so even with a database they would not close
either risk. Insert real rows: a `statement_reconciliations` row with a valid `YYYY-MM`
`period` and non-null `totalDuePaise`/`minDuePaise`, plus card/statement data so
revolving-debt returns a **non-empty** `cards` array; and a monetary value large enough
to be meaningful (stay within `Number.MAX_SAFE_INTEGER` so the test asserts success).
These will still fail here at module load — that is expected and correct.

### FIX 4 — make the cross-user isolation tests meaningful
Give user A real data and assert user B's response contains **none of it**. Right now
both users are empty, so the tests would pass even if ownership filtering were broken.

### FIX 5 — correct the inaccurate `today` explanation
The data-completeness route defines **no `querystring` schema**, so Zod strips nothing;
the handler ignores query params by omitting the third service argument. Fix the comment
at `planning-analysis.ts:51-55` to say that plainly, and strengthen the test: asserting
"200 with `?today=`" proves nothing — assert the returned `asOf` is **unaffected** by
the supplied value.

### FIX 6 — remove the false plugin comments
`planning/plugin.ts:18` and `credit/plugin.ts:14` now claim "same URLs", "pure
relocation", and no canonical surface change. Task 059 **adds** URLs, so these are
false. Correct or remove them; do not change any registration or its order.

### Must Not Change
- The three route handlers' logic, the `querystring` validator, registration order.
- Both snapshot files (already correct — must stay 319 lines, byte-exact).
- The plugin enumeration test counts (9 and 5) or their assertions.
- Any service **logic** — FIX 2 is comments only.
- No `as any`/`@ts-ignore`/`@ts-expect-error`/`eslint-disable`. Do not weaken or skip a
  test to get green. Do not stage/commit/delete. Do not touch `screen-shots/`.

### Required Evidence (iteration 2)
- literal proof of FIX 1's non-vacuity (break → FAIL → revert → PASS)
- explicit confirmation the real route plugin is registered, and by what mechanism the
  service is substituted
- `npm run typecheck`, `npm run lint` with exit codes
- **root `npm run test` with its LITERAL exit code and full six-workspace summary.**
  ⚠ **Use this exact form — do NOT pipe into `tail` before capturing `$?`:**
  ```
  npm run test > /tmp/059-test.txt 2>&1 ; echo "EXIT=$?" ; tail -70 /tmp/059-test.txt
  ```
  Piping into `tail` makes `$?` report **`tail`'s** status, not npm's. That flaw in my
  earlier command list is the confirmed cause of three successive false "exit 0"
  reports. The truth is **exit 1**, totals ~1399/1370/28/1. Report all six workspace
  lines; `packages/shared`'s 212 is NOT the root total.
- `node --test apps/api/src/app.route-snapshot.test.ts` still passing, and
  `wc -l apps/api/src/route-surface.snapshot.txt` still **319**
- confirmation no genuine regression, with the failing-file set classified

Write to `tasks/059-planning-routes-simple/implementation-2.md`; return ≤20 lines + path.
