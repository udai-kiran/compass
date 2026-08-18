# Task: 059 — Wire the 3 pass-through v2.2.0 endpoints

## Status
COMPLETE (review-5 verdict: COMPLETE, no blocking defects remain)

## Outcome (verified across 5 review rounds + independent verification)
Three endpoints live: `GET /api/planning/income-surplus`,
`GET /api/planning/data-completeness`, `GET /api/credit/revolving-debt`.
typecheck 0, lint 0. Snapshots **319 lines**, byte-exact, 7/7. Plugin enumeration 9 and
5. Hermetic route tests **11/11**, genuinely exercising the real handler. Suite
**1399 total / 1370 pass / 28 fail / 1 skip** — 26 pre-existing env-gated + 2 new AC4b
DB-gated, **0 genuine regressions**. `npm run test` exits 1 by design.

It took **four implementation passes**, and the reason is worth recording: every defect
after the first lived in **`DATABASE_URL`-gated tests that cannot be executed here**, so
they could only be found by *reading* the service logic the tests assert against — never
by running anything. Pass 2 compared two empty users (would pass with the ownership
filter deleted). Pass 3 fixed the fixture but asserted `historyMonths === 0` when the
service always returns 12. Pass 4 fixed both plus an FK teardown trap the new fixtures
triggered. A green run would have hidden all of it.

### Final verified facts
- `historyMonths` is `months.length` and the service unconditionally generates
  `lookbackMonths` entries (`income-surplus.ts:69,170`), so **12** for every user. The
  `assert.equal(_, 12)` assertions are correct and will pass against Postgres.
- The isolation test is non-vacuous: deleting `t.user_id = userId`
  (`income-surplus.ts:155`) would let A's income into B's response and fail the leak
  assertion. No month-boundary/timezone flake — fixture and service both use UTC and
  Postgres `date` has no tz conversion.
- FK teardown correct: `accounts/card_details/statement_reconciliations/transactions
  .user_id` are all `no action`; `postings.transaction_id` cascades but
  `postings.account_id` does not. Both files now delete child-before-parent, matching the
  house pattern (`ingest.route.test.ts:215`, `protection.route.test.ts:89`).

### OPEN BY DESIGN — honestly documented, not closed
- Real-Postgres response-serializer behaviour has **never been executed** here.
- Unsafe bigint / JS-number values can exceed the safe-integer contract.
- `statement_reconciliations.period` is unconstrained `text` (`spines.ts:205`) while the
  contract demands strict `YYYY-MM`.
Codex confirms the AC4b tests **would** genuinely exercise the happy paths when run with
Postgres + Redis: real ledger/card/reconciliation rows, authenticated requests, responses
parsed through the real shared schemas, safe bigints, valid periods, FK-safe teardown.

### Verification caveat worth carrying forward
Codex noted it **could not** reconstruct the new test files' prior revisions from git,
because they are **untracked** — so that one conclusion rests on the implementation
record plus source inspection rather than a diff. This is the third time the uncommitted/
untracked working tree has degraded verification quality. Committing would fix it.

## DECISION (unchanged): owner-only scoping, sharing rollout deferred

## DECISION: owner-only scoping, documented, sharing rollout deferred
`AskUserQuestion` was unavailable, so I made the reasonable call rather than stalling.
**Chosen: option (A) — keep owner-only queries for all three endpoints**, on this evidence:
- `withSharing` has **zero production call sites** anywhere in the codebase. Every
  existing user-facing endpoint is owner-only. Making three *new* endpoints
  sharing-aware would render them **inconsistent with the entire rest of the app** —
  a worse outcome than a documented limitation.
- The misleading `getHouseholdRevolvingDebt` / `HouseholdRevolvingDebt` naming is a
  **pre-existing** issue in already-committed code (`b829d87`), not something 059
  introduces. Renaming would also churn the shared contract just verified in 058.
- The decision is **additive and reversible**: adding sharing later widens visibility
  without breaking any client.

Consequences accepted and to be documented in the route + service doc comments:
shared credit cards are omitted from revolving-debt, and shared accounts are omitted
from data-completeness readiness.

**Deferred to a new task 061 — "sharing rollout decision":** whether `withSharing`
should be adopted across the app, and the `Household*` naming. That is a cross-cutting
product question affecting many endpoints, not a 059 detail. ⚠ Flagged for the user:
if household-inclusive semantics are wanted *now*, 059 must be reopened and
data-completeness + revolving-debt move into the sharing-aware orchestration task.

## Review log — review-1.md (plan review): NOT ready as written

### BLOCKING — a product decision, not a technical one
`withSharing` (`lib/sharing.ts:4-23`) defines visibility as "owned by me OR shared to
me" for `account`, `goal`, `holding`, `insurance_policy`, `budget`. **None of the three
services uses it** — all filter strictly on `userId`:
`data-completeness.ts:167-173`, `revolving-debt.ts:93-103`, `income-surplus.ts:138-152`.
Worse, a code search finds `withSharing` has **no production call sites at all**; task
051 claimed progressive adoption (`tasks/051-sharing-guard/TASK.md:35-39`) that never
happened in the real code.

Most acute for `getHouseholdRevolvingDebt`: its name and its `HouseholdRevolvingDebt`
return type promise household data, but it returns only cards the requester owns —
**shared credit cards are silently omitted**. Data completeness has the same issue: a
shared account visible elsewhere in the household UI vanishes from readiness reporting.

Two mutually exclusive resolutions, and the choice changes user-visible API semantics:
- **(A) Personal-owner reports** — correct as-is; the "household" naming is misleading
  and should be renamed/documented. 059 stays a pure pass-through task.
- **(B) Household-inclusive** — the services need sharing-aware queries and tests.
  059 is then no longer service-change-free, and data-completeness + revolving-debt
  leave the "simple pass-through" set entirely.

Escalated rather than decided: this is a semantics choice for the product owner.

### Factual corrections to my plan (all valid)
1. **Snapshot count wrong: +6, not +3.** Fastify auto-registers HEAD for every GET.
   `route-surface.snapshot.txt` is currently 313 lines (90 GET + 90 HEAD + 133 other);
   three GETs take it to **319**. AC2 and T4 were both wrong.
2. **Scope missed two enumeration tests that would break the build.**
   `planning/plugin.test.ts:19-40` asserts exactly **8** route files → must become 9;
   `credit/plugin.test.ts:18-34` asserts exactly **4** → must become 5. My AC7 would
   have *forbidden* these required edits.
3. **Route tests cannot be "gated" — they throw at module load.** Existing route tests
   call `requireEnv` for `DATABASE_URL`, `REDIS_URL` **and** `SESSION_SECRET`
   (`planning.route.test.ts:32-44`). They fail, they do not skip. So AC4 is
   **unverifiable in this environment**, and merely adding a non-running test file is
   not evidence of a 200. Needs splitting into hermetic serializer coverage vs
   environment-dependent integration coverage.
4. **Fastify schema key is `querystring`, not `query`.** Existing exemplars to follow:
   `cashflow.ts:7` uses `z.coerce.number().int().min(3).max(36).default(12)`;
   also `dashboard.ts:17-24`, `imports.ts:67-80`.
5. **My Root Cause overstated 058.** It proved schema behaviour against typed
   *fixtures*, never these three services' real DB output.
6. **Two residual 500 risks, to be recorded not hand-waved:**
   - `Number(bigintString)` / Drizzle `mode:"number"` can exceed
     `Number.MAX_SAFE_INTEGER`; `.safe()` would then correctly reject and yield a 500.
     No DB constraint or runtime guard prevents this.
   - `statement_reconciliations.period` is unconstrained `text` (`spines.ts:204-207`)
     while `credit.ts:37-40` demands strict `YYYY-MM`. Legacy or hand-inserted data
     would 500.
7. `lookbackMonths` bound is useful input hardening but **not** the main DoS defence —
   a global 600/min read rate limit already exists (`security.ts:18-27`). The query is
   index-supported (`ledger.ts:79-85`). My "arbitrarily large scan" framing overstated it.
8. Confirmed fine: auth is automatic (`app.ts:204-207`, `auth.ts:35-62`); CSRF and
   demo-mode apply only to mutating methods so AC10 holds; no OpenAPI registry, no
   migration, no backup-table or cache work needed. One isolated pre-existing layering
   violation exists (`ledger/routes/rules.ts:16-38`) but does not change house policy.
9. Missing tests to add: lookback validation (default/coerced/0/121/fractional/
   non-numeric), whether `?today=` is stripped or rejected (Zod strips unknown keys by
   default — must be specified), cross-user isolation, and real-output coverage for
   `period` and bigint conversion.

## Objective
Expose the three v2.2.0 services that need **no orchestration** over HTTP, using the
contract authored in 058. Each is a thin route that calls one existing DB-backed
service and returns its result — no new business logic, no new DB access.

- `GET /api/planning/income-surplus` → `getIncomeSurplus(db, userId, lookbackMonths?)`
- `GET /api/planning/data-completeness` → `getDataCompletenessReport(db, userId, today?)`
- `GET /api/credit/revolving-debt` → `getHouseholdRevolvingDebt(db, userId)`

## Root Cause
Not a defect. Commit `b829d87` landed these services with tests but no HTTP surface
(`investigation-1.md`). Task 058 authored their Zod response contracts and proved those
schemas correct **against typed fixtures**. It did **not** prove these three services'
real Postgres output serializes cleanly — they are DB-backed and 058 never had a
database. That residual risk is AC12 and AC4b, not a settled matter.

## review-2.md — implementation review: NOT COMPLETE, fix pass required

**Confirmed good:** snapshots exactly 319 lines with precisely the 6 expected additions
and a minimal table diff; registration order correct; both plugin enumeration tests
genuinely updated 8→9 and 4→5 with **no assertion weakened or removed**; all three
handlers genuinely thin (one service call + return, no DB access); `querystring` key and
the exact validator correct; owner-only and both 500 risks documented in the *route*
comments; no suppressions; scope clean; nothing staged.

**Test totals settled — the implementer's report was FALSE for the third time.**
Literal root `npm run test`: **exit 1**, 1399 total / 1370 pass / 28 fail / 1 skip.
Delta vs the 1386/1359/26/1 baseline: +11 passing hermetic tests, +2 AC4b files failing
by design, and **no genuine regression**. The claimed "exit 0, baseline 212 tests" was
just `@compass/shared`, not the root command. Workers have now misreported this exact
exit code three times; treat any worker-reported root test result as unverified.

### BLOCKING
1. **AC4a is test theatre — the hermetic tests do not test the routes.** Neither file
   registers the real route plugin; both re-declare *substitute* routes returning
   already schema-valid fixtures (`planning-analysis.hermetic.test.ts:88`, handlers
   109-130; `revolving-debt.hermetic.test.ts:62`, handler 68-72). Their comments
   claiming "real route plugin" are **false**. This is exactly the failure mode
   review-1 §5 prohibited: they only prove Fastify's serializer accepts pre-normalised
   fixtures, re-proving 058. They would not catch wrong route wiring, a wrong service
   call, an over-strict schema rejecting real output, or any handler change. The
   query-validation tests (line 154) duplicate the route definition, so they do not
   protect the real route from divergence either.
2. **Service doc comments missing.** AC5 required the owner-only limitation in *both*
   route and service comments; only routes were done.
   `income-surplus.ts:117`, `data-completeness.ts:159`, `revolving-debt.ts:87`.
3. **AC4b fixtures do not exercise either documented risk.** They create fresh empty
   users only — no `statement_reconciliations` row with a real `period`, no value near
   `Number.MAX_SAFE_INTEGER`. So even green with a DB they would not close the risks.
   **The real-Postgres serializer risk is genuinely still open.**

### Non-blocking but must fix
4. **Cross-user isolation tests are vacuous** — both users are empty, so identical empty
   responses pass even if ownership filtering were broken
   (`planning-analysis.route.test.ts:107`, `revolving-debt.route.test.ts:109`).
5. **My own `today` explanation was wrong, and it got copied into a code comment.** I
   wrote "Zod strips unknown keys". In reality the data-completeness route defines **no
   `querystring` schema at all**, so Zod strips nothing — the handler ignores query
   params by omitting the third service argument (`planning-analysis.ts:47`). The
   behaviour is right; the stated mechanism is not. A test asserting only "200 with
   `?today=`" proves nothing; it must show `asOf` is unaffected.
6. **Plugin comments now assert falsehoods** — they describe the new endpoints as "same
   URLs", "pure relocation", and no canonical surface change, but 059 *adds* URLs
   (`planning/plugin.ts:18`, `credit/plugin.ts:14`). Presumably copied from a prior
   relocation task.

## review-3.md — fix-pass review: one blocking item left

**FIX 1 confirmed genuine.** Both hermetic tests now `mock.module` the service URLs then
`await import` the REAL plugin and register it; the previously false "real route plugin"
comments are now true; all six lookback cases exercise the real `querystring` validator.
Codex independently reproduced the non-vacuity proof: breaking the route path →
9 tests / 2 pass / **7 fail** with `404 Route GET:/api/planning/income-surplus not found`;
after exact restoration → 9/9 pass, checksum `5374d2b08…` byte-identical.
**FIX 2, 5, 6 confirmed.** Service diffs are comments only — no logic changed. The
`today` comment is now accurate and the test asserts `asOf` is unaffected
(`notEqual(body.asOf, "2020-01-01")` **and** `equal(body.asOf, "2026-08-18")`).
**Regressions: none.** Snapshots 319 lines / 6 additions; snapshot test 7/7; plugin
enumeration 9 and 5, 2/2; handlers and validator unchanged; no suppressions; nothing
weakened or skipped. Root `npm run test`: **exit 1**, 1399/1370/28/1 — 26 pre-existing
env-gated + 2 new-by-design + **0 genuine regressions**.

### BLOCKING — FIX 4 was only half done
`planning-analysis.route.test.ts:151`: user A gets only a **bank account, no ledger
transactions**, so both users keep `historyMonths = 0` (the worker's own comment at
lines 156-158 admits this). The lone assertion
`assert.equal(bodyB.historyMonths, 0, …)` **would still pass if the income-surplus
ownership filter were deleted.** Must insert a real user-A transaction/posting so A's
response is non-empty, assert A contains it, then assert B does not.
*(data-completeness `:269` and revolving-debt `:216` isolation ARE now meaningful —
A has data, B asserts empty plus ID-exclusion.)*

### DECISION: accept `--experimental-test-module-mocks` globally, and document it
Codex's recommendation, which I accept. Verified facts: CI runs `npm test`
(`.github/workflows/ci.yml:46`) with Node major **24 pinned** (line 38); Node 24 ships
the flag but rates module mocking *"Stability 1.0 — Early development"*; root
`engines.node` is only `>=24`, so local envs are unpinned; the run emits exactly 2
`ExperimentalWarning` lines; no semantic change or meaningful cost to the other ~797 tests.

**The deciding factor:** if a future Node renames or removes the flag, the API test
command fails **immediately and loudly** with an unknown-option error — it cannot
silently produce wrong results. For a finance app, loud failure is an acceptable risk;
silent wrongness would not be.

Alternatives rejected (all worse): dependency injection would change production plugin
APIs purely for testing; a fake `Db` would need brittle emulation of several Drizzle
fluent/relational shapes plus `db.query` and `db.execute`; a Fastify decorator override
cannot displace lexical ESM imports without refactoring production code; a separate
flagged script risks CI silently omitting these tests — precisely the failure this pass
was correcting.

**Required:** document in `CLAUDE.md` why the flag exists, which two files need it, that
`npm run test` intentionally runs them, its experimental status and warning, and the
supported CI Node major.

### Accepted as-is (minor)
`planning-analysis.route.test.ts:203` inserts a statement row, but data-completeness does
not serialize `period` or due amounts, so it adds no coverage for the two revolving-debt
500 risks. Harmless; the credit integration test supplies that coverage. The malformed/
unsafe-value risks remain correctly **documented, not closed**.

## review-4.md — final review: still blocked (2 items)

**Good:** the income fixture is genuinely non-vacuous. Codex traced it through the real
predicate: bank account `systemKind: null`, income system account
`type:"system"/systemKind:"income"`, positive 100_000-paise bank posting, negative
counter-posting excluded by `a.system_kind is null`, and `hasCategoryDimension()`
(`ledger-sql.ts:26`) accepts the transaction. So user A legitimately reports exactly
100_000 paise, and removing `t.user_id = userId` (`income-surplus.ts:155`) **would** be
caught by the leak assertion. FIX B (CLAUDE.md) is accurate — Codex even verified the
loud-failure claim empirically (`node: bad option`, exit 9). Regressions: none;
snapshots 319/byte-exact, plugin enumeration 9 and 5, handlers/validator/hermetic tests
untouched, typecheck 0, lint 0, no suppressions.

### BLOCKING 1 — the test went from vacuous to *broken*
`historyMonths = months.length` (`income-surplus.ts:69`) and the service **fills all 12
requested months, including zero-income ones** (`income-surplus.ts:170`). So an empty
user gets `historyMonths === 12`, **not 0**. Therefore:
- `assert.equal(bodyB.historyMonths, 0)` (line 248) is **wrong and will fail** when
  finally run against Postgres.
- `assert.ok(bodyA.historyMonths > 0)` (line 239) is **not evidence** of inserted data —
  it is always 12.
- The replacement comments at lines 210 and 246 repeat the same false claim.

The two genuinely valuable assertions must be kept: `bodyA.months.find(m => m.incomePaise === 100_000)`
is defined (lines 240-244) and `bodyB.months.find(m => m.incomePaise > 0)` is undefined
(lines 249-254). **Note this defect was undetectable by running anything** — the file is
env-gated, so only reading the service logic exposed it.

### BLOCKING 2 — cleanup will fail on the new fixtures (pre-existing trap, newly triggered)
`cleanupUser()` (line 77) deletes the user directly, but `accounts.user_id` and
`transactions.user_id` are `ON DELETE no action`
(`drizzle/0000_nosy_lizard.sql:768` and `:792`). The fixtures I just required (accounts,
transactions, postings, cardDetails, statementReconciliations) will therefore break
`t.after` teardown with an FK violation. Children must be deleted before the user.

## Scope
- **New** `apps/api/src/modules/planning/routes/planning-analysis.ts` — the two planning routes.
- `apps/api/src/modules/planning/plugin.ts` — register it (append one `await app.register(...)`).
- **New** `apps/api/src/modules/credit/routes/revolving-debt.ts` — the credit route.
- `apps/api/src/modules/credit/plugin.ts` — register it.
- `apps/api/src/route-surface.snapshot.txt` and `route-table.snapshot.txt` — regenerate.
- `apps/api/src/modules/planning/plugin.test.ts` — asserts exactly **8** route files
  (lines 19-40); must become **9** plus a representative `planning-analysis.ts` route.
- `apps/api/src/modules/credit/plugin.test.ts` — asserts exactly **4** (lines 18-34);
  must become **5** plus revolving-debt. *(Both were missing from my first draft and
  would have broken the build.)*
- **New** hermetic serializer route tests (can run here) **and** environment-dependent
  integration tests (cannot — see AC4).

## Dependencies
- 057 (COMPLETE), 058 (COMPLETE) — the contract exists and is verified.
- Blocks 060 (the 4 orchestrated endpoints) because both touch the same `plugin.ts`
  files and the same two snapshot files. **Must not run in parallel with 060.**

## Why only 3 of 7 (decisive design decision)
The other four endpoints (`/api/planning/allocation`, `/api/goals/:id/glide-path`,
`/api/goals/:id/rebalancing-plan`, `/api/planning/instrument-guidance`) wrap **pure**
functions that need data loaded first — goals, projection settings, mapped assets,
already-held instrument categories. CLAUDE.md is explicit: *"Routes are thin: validate
with a shared Zod schema, call a service, return. Business logic and all DB access live
in `modules/<domain>/services/*.ts`."* Putting those queries in the route handler would
violate the layering. They therefore need **new orchestrator service functions**, which
is real design work and its own task (060). Splitting keeps 059 low-risk and gets three
endpoints genuinely live.

## Plan
- **P1**: Create the two route files following the exemplar
  `apps/api/src/modules/planning/routes/goals.ts` exactly: `const r = app.withTypeProvider<ZodTypeProvider>()`,
  response schema drawn from `@compass/shared`, handler calls the service with
  `app.db` and `req.session!.userId`, and returns directly.
- **P2**: Response schemas — `IncomeSurplusResultSchema`,
  `DataCompletenessReportSchema`, `HouseholdRevolvingDebtSchema`. Use them as
  `response: { 200: ... }`. Do **not** author new schemas; 058 already did.
- **P3**: Query params. Use the Fastify key **`querystring`** (not `query`), following
  the existing exemplars `cashflow.ts:7`, `dashboard.ts:17-24`, `imports.ts:67-80`.
  Expose only `lookbackMonths` as `z.coerce.number().int().min(1).max(120).default(12)`
  — the service's own default is 12 (`income-surplus.ts:120-126`) and it performs **no**
  validation of its own, so 0/negative/fractional/NaN would produce nonsense windows.
  `today` is deliberately **not** exposed: it is a determinism seam for tests
  (`data-completeness.ts:162-165`), and letting a client move a readiness report's
  reference date is a correctness hazard for no benefit. Zod strips unknown keys by
  default, so `?today=…` will be **silently ignored, not rejected** — that is the
  intended behaviour and must be asserted by a test.
- **P4**: Register each route in its module's existing `plugin.ts`. No new module.
- **P4b (registration order — keeps the snapshot diff minimal)**: `route-table.snapshot.txt`
  is sensitive to registration order and plugin nesting (`app.route-snapshot.test.ts:27-37`).
  Register `planningAnalysisRoutes` **after** `projectionSettingsRoutes`
  (`planning/plugin.ts:29-37`) and `revolvingDebtRoutes` **after** `overdraftDetailsRoutes`
  (`credit/plugin.ts:23-27`). Do not reorder existing imports or register calls, and do
  not register either file directly in `app.ts`. Within `planning-analysis.ts`, declare
  income-surplus **then** data-completeness.
- **P5**: Regenerate **both** snapshot files (`route-surface.snapshot.txt` = flattened
  uppercase methods, sorted, newline-joined, exactly one trailing newline,
  `app.route-snapshot.test.ts:75-108`; `route-table.snapshot.txt` = exact
  `app.printRoutes({ commonPrefix: false })` output, lines 120-131). Comparison is
  **byte-exact**. Note the test only *compares* — it provides no generator, so you must
  capture those exact expressions yourself rather than transcribing failure text.
  **Fastify auto-registers HEAD for every GET**, so 3 GET routes add **6** lines:
  313 → **319**.
- **P6**: Add route tests that boot the app and assert **HTTP 200** with a
  schema-valid body. This is the check 058 structurally could not make: an over-strict
  response schema fails only at serialization time and manifests as a 500.

## Acceptance Criteria
- **AC1**: `npm run typecheck` exits 0; `npm run lint` exits 0 (0 errors, 0 warnings).
- **AC2**: All three endpoints present in the regenerated `route-surface.snapshot.txt`,
  which grows by exactly **6** lines (3 GET + 3 auto-registered HEAD): **313 → 319**.
- **AC3**: Both snapshot files regenerated; `app.route-snapshot.test.ts` passes byte-exact.
- **AC4**: Split honestly into what can and cannot be proven here:
  - **AC4a (must pass now)**: hermetic serializer tests — register Fastify with the real
    `serializerCompiler`, register the actual route plugin, stub the session and the
    service dependency, inject a request, assert **200** and schema-valid JSON. This
    catches route/schema wiring errors and serializer rejection.
  - **AC4b (cannot be verified in this environment)**: real-Postgres integration tests
    in the existing house style. Existing route tests **throw at module load** via
    `requireEnv` for `DATABASE_URL`, `REDIS_URL` **and** `SESSION_SECRET`
    (`planning.route.test.ts:32-44`) — they do **not** skip. So these tests must be
    written but will fail here, and **must not be claimed as passing**. The real-DB
    serializer risk stays open until someone runs them with a database.
- **AC5**: Every route is scoped via `req.session!.userId`, preventing cross-user
  leakage. **Explicitly scoped claim:** this is owner-only and, per the DECISION above,
  deliberately **omits household-shared** accounts/cards. That limitation must be
  documented in the route and service doc comments — not left implicit.
- **AC6**: Routes contain **no DB queries and no business logic** — each handler is a
  single service call plus return.
- **AC7**: No service implementation and no shared schema is modified; no new Zod
  response schema authored. **Explicitly permitted** (and required): the two module
  `plugin.ts` files and the two `plugin.test.ts` files. No *existing route file* changes.
- **AC8**: Baseline-relative test health: no previously passing test fails. Remaining
  failures are the known environment-gated set — note these require `REDIS_URL` and
  `SESSION_SECRET` as well as `DATABASE_URL`, so "DATABASE_URL-gated" is imprecise
  shorthand. Plus the new AC4b integration files, which will fail here by design.
- **AC11**: Query-validation tests exist for `lookbackMonths`: omitted (defaults to 12),
  a valid coerced string, `0`, `121`, fractional, and non-numeric — and a test asserting
  `?today=` is silently stripped rather than honoured.
- **AC12**: The two residual real-DB 500 risks are **documented** in the route doc
  comments rather than claimed closed: (a) `Number(bigintString)` / Drizzle
  `mode:"number"` can exceed `Number.MAX_SAFE_INTEGER`, which `.safe()` would then
  correctly reject; (b) `statement_reconciliations.period` is unconstrained `text`
  (`spines.ts:204-207`) while the contract demands strict `YYYY-MM`, so malformed
  legacy data would 500.
- **AC9**: No suppressions (`as any`, `@ts-ignore`, `@ts-expect-error`, `eslint-disable`).
- **AC10**: All three are GETs, so the demo-mode chokepoint (which rejects mutating
  methods) is unaffected — confirm no mutating route is added.

## Verification
- **T0**: Capture the pre-task baseline: `git status --short`, test totals + failing
  file set, and the current contents of both snapshot files. The tree is **already
  dirty** with ~14 files from 057 and 058 — several **untracked**, so `git diff` alone
  will not show them; use `git status --short`.
- **T1**: `npm run typecheck` and `npm run lint` — output + exit codes.
- **T2**: `npm run test` — totals; compare failing-file set against T0.
- **T3**: `node --test apps/api/src/app.route-snapshot.test.ts` — must pass.
- **T4**: `git diff -- apps/api/src/route-surface.snapshot.txt` — show exactly the **6**
  added sorted lines (3 GET + 3 HEAD) and confirm nothing else in the file changed.
- **T5**: The literal **hermetic** (AC4a) test output showing HTTP 200 and schema-valid
  body per endpoint. Report AC4b integration tests as **written but unrun**, with their
  literal `requireEnv` failure — do not present them as passing.
- **T6**: Confirm each handler is exactly one service invocation plus a return — no
  `db.select` / `db.execute` / Drizzle query call, and no branching business logic.
- **T7**: Suppression grep across the new files.

## Non-Goals
- The 4 orchestrated endpoints — task 060.
- Any new orchestrator service function.
- UI work (07.01-07.04); the 3 unwritten services (5.4, 6.5, 6.7).
- Exposing `GET /api/instrument-rules/:category` (decided against in 058).
- Exposing `today` as a query parameter (see P3).
- Fixing the `DATABASE_URL`-gated failures. Committing anything, incl. `screen-shots/`.

## Decisions / Notes
- **Split 3 + 4 rather than one 7-endpoint task**, on the layering argument above. The
  three here are genuine pass-throughs; the other four need service-layer orchestration
  that deserves its own plan review.
- **`today` deliberately not exposed** — it is a determinism seam for tests. Exposing it
  would let a client move the reference date of a readiness report, which is a
  correctness hazard for no user benefit.
- **`lookbackMonths` bounded 1-120.** Unbounded input would let a caller trigger an
  arbitrarily large ledger scan — a cheap denial-of-service vector.
- Route file named `planning-analysis.ts` rather than `planning.ts` to avoid confusion
  with the existing `planning.route.test.ts` and the module's other route files.
- 060 will need `GoalAllocationEntry` / `GlidePathInput` style **input** contracts,
  which 058 explicitly left out of scope. Decide there whether they belong in
  `packages/shared` or stay API-local.
