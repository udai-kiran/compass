# Plan review — Task 059

The 3-vs-4 implementation split is mechanically correct, but the plan is not ready as written. The main blockers are:

1. Household-sharing semantics are ignored by all three services, most seriously by a function explicitly named `getHouseholdRevolvingDebt`.
2. The snapshot-count expectations are wrong: three GET routes add six canonical `(method,path)` lines because Fastify also registers HEAD.
3. The existing module plugin-registration tests must be updated; they are missing from scope.
4. DB-free fixture tests cannot establish that real PostgreSQL output serializes successfully. The bigint conversion paths are explicit, but safe-integer overflow remains possible, and `statement_reconciliations.period` is unconstrained text.
5. Existing route tests are not gracefully “gated”; they throw at module load when environment variables are absent.

## 1. Three pass-through services versus four orchestrated services

### The three selected services really are direct calls

Their exported signatures require only the stated arguments:

- `getIncomeSurplus(db, userId, lookbackMonths = 12)` at [income-surplus.ts:122](/home/udai/common/compass/apps/api/src/modules/planning/services/income-surplus.ts:122).
- `getDataCompletenessReport(db, userId, today?)` at [data-completeness.ts:159](/home/udai/common/compass/apps/api/src/modules/planning/services/data-completeness.ts:159).
- `getHouseholdRevolvingDebt(db, userId)` at [revolving-debt.ts:89](/home/udai/common/compass/apps/api/src/modules/credit/services/revolving-debt.ts:89).

They load their own inputs. None requires the route to preload goals, holdings, accounts, statements, projection settings, or caller context. Omitting `today` is safe because the service defaults it internally at [data-completeness.ts:164](/home/udai/common/compass/apps/api/src/modules/planning/services/data-completeness.ts:164).

Subject to the sharing issue below, they are valid thin-route candidates.

### The deferred four do require assembled inputs

The four pure functions do not accept a database or user ID:

- `allocateAcrossGoals(entries, availableSurplusPaise)` at [multi-goal-allocation.ts:155](/home/udai/common/compass/apps/api/src/modules/planning/services/multi-goal-allocation.ts:155). The caller must obtain and assemble goal entries and available surplus.
- `buildGlidePathSchedule(input)` at [goal-plan.ts:97](/home/udai/common/compass/apps/api/src/modules/planning/services/goal-plan.ts:97). Its input includes goal type, horizon, target, funded corpus, inflows, and return assumptions; see [goal-plan.ts:32](/home/udai/common/compass/apps/api/src/modules/planning/services/goal-plan.ts:32).
- `buildRebalancingPlan(input)` at [rebalancing-plan.ts:109](/home/udai/common/compass/apps/api/src/modules/planning/services/rebalancing-plan.ts:109). It needs current funded allocation, SIP amounts, target allocation, and a prebuilt glide path; see [rebalancing-plan.ts:57](/home/udai/common/compass/apps/api/src/modules/planning/services/rebalancing-plan.ts:57).
- `buildInstrumentGuidance(leg, horizonMonths, alreadyHeldCategories, onDate?)` at [instrument-guidance.ts:187](/home/udai/common/compass/apps/api/src/modules/planning/services/instrument-guidance.ts:187). The held categories are explicitly caller-supplied and affect ordering/conflict reporting at [instrument-guidance.ts:179](/home/udai/common/compass/apps/api/src/modules/planning/services/instrument-guidance.ts:179).

For the intended resource-derived GET endpoints, task 060 should introduce service-layer orchestration. Allowing clients to supply all these authoritative inputs would instead create materially different endpoints.

### Layering argument: correct policy, imperfect existing compliance

The repository rule is explicit: routes validate, call services, and return; business logic and DB access belong in services at [CLAUDE.md:41](/home/udai/common/compass/CLAUDE.md:41)-[45](/home/udai/common/compass/CLAUDE.md:45).

There is an existing violation. `routes/rules.ts` performs both a Drizzle read and delete directly:

- Direct `app.db.query...findMany()` at [rules.ts:16](/home/udai/common/compass/apps/api/src/modules/ledger/routes/rules.ts:16)-[23](/home/udai/common/compass/apps/api/src/modules/ledger/routes/rules.ts:23).
- Direct delete/ownership/error logic at [rules.ts:26](/home/udai/common/compass/apps/api/src/modules/ledger/routes/rules.ts:26)-[38](/home/udai/common/compass/apps/api/src/modules/ledger/routes/rules.ts:38).

That is isolated legacy inconsistency, not evidence of a different house pattern. The rest of the architecture and the route exemplars support the plan’s thin-route approach.

## 2. Real-output response serialization

Fastify installs the Zod serializer compiler globally at [app.ts:163](/home/udai/common/compass/apps/api/src/app.ts:163)-[164](/home/udai/common/compass/apps/api/src/app.ts:164). A schema mismatch can therefore become a 500.

### Income surplus

Date/period formatting is safe:

- SQL emits `to_char(t.date, 'YYYY-MM')` at [income-surplus.ts:139](/home/udai/common/compass/apps/api/src/modules/planning/services/income-surplus.ts:139)-[142](/home/udai/common/compass/apps/api/src/modules/planning/services/income-surplus.ts:142).
- Missing months are generated by `addMonths`, which zero-pads the month at [income-surplus.ts:103](/home/udai/common/compass/apps/api/src/modules/planning/services/income-surplus.ts:103)-[108](/home/udai/common/compass/apps/api/src/modules/planning/services/income-surplus.ts:108).

Money handling deliberately converts the raw PostgreSQL bigint aggregate:

- SQL casts the sum to bigint at [income-surplus.ts:141](/home/udai/common/compass/apps/api/src/modules/planning/services/income-surplus.ts:141)-[142](/home/udai/common/compass/apps/api/src/modules/planning/services/income-surplus.ts:142).
- The service declares that raw result as `income: string` and calls `Number(row.income)` at [income-surplus.ts:154](/home/udai/common/compass/apps/api/src/modules/planning/services/income-surplus.ts:154)-[159](/home/udai/common/compass/apps/api/src/modules/planning/services/income-surplus.ts:159).

Thus no string reaches the response, and normal values remain integers. Recurring and SIP amounts use Drizzle `bigint(..., { mode: "number" })`, for example [recurring.ts:43](/home/udai/common/compass/apps/api/src/db/shared/recurring.ts:43), and divisions use `Math.floor` at [income-surplus.ts:196](/home/udai/common/compass/apps/api/src/modules/planning/services/income-surplus.ts:196)-[213](/home/udai/common/compass/apps/api/src/modules/planning/services/income-surplus.ts:213) and [income-surplus.ts:234](/home/udai/common/compass/apps/api/src/modules/planning/services/income-surplus.ts:234)-[249](/home/udai/common/compass/apps/api/src/modules/planning/services/income-surplus.ts:249). Percentile-derived surplus is rounded at [income-surplus.ts:91](/home/udai/common/compass/apps/api/src/modules/planning/services/income-surplus.ts:91)-[99](/home/udai/common/compass/apps/api/src/modules/planning/services/income-surplus.ts:99).

Residual risk: `Number(bigintString)` can lose precision or exceed `Number.MAX_SAFE_INTEGER`; `mode: "number"` has the same limitation. The schema’s `.safe()` correctly rejects an unsafe response, but there is no DB constraint or runtime guard guaranteeing safe range. Normal financial data will not approach this limit, but the plan overstates “proved safe.” A corrupt/extreme row could still produce a serializer 500.

### Data completeness

Its dates are well controlled:

- `asOf` is produced with `toISOString().slice(0, 10)` at [data-completeness.ts:164](/home/udai/common/compass/apps/api/src/modules/planning/services/data-completeness.ts:164)-[165](/home/udai/common/compass/apps/api/src/modules/planning/services/data-completeness.ts:165).
- Import timestamps are explicitly converted using `to_char(..., 'YYYY-MM-DD')` at [data-completeness.ts:175](/home/udai/common/compass/apps/api/src/modules/planning/services/data-completeness.ts:175)-[180](/home/udai/common/compass/apps/api/src/modules/planning/services/data-completeness.ts:180).
- Valuation and snapshot maxima come from PostgreSQL `date` columns at [data-completeness.ts:210](/home/udai/common/compass/apps/api/src/modules/planning/services/data-completeness.ts:210)-[219](/home/udai/common/compass/apps/api/src/modules/planning/services/data-completeness.ts:219) and [data-completeness.ts:233](/home/udai/common/compass/apps/api/src/modules/planning/services/data-completeness.ts:233)-[241](/home/udai/common/compass/apps/api/src/modules/planning/services/data-completeness.ts:241). The valuation column is a Drizzle `date` at [investments/schema.ts:97](/home/udai/common/compass/apps/api/src/modules/investments/schema.ts:97)-[105](/home/udai/common/compass/apps/api/src/modules/investments/schema.ts:105).

PostgreSQL date values cannot contain invalid dates such as `2026-02-29`. None of these paths returns a JS `Date` or full timestamp to the response.

Counts are safe from the string issue:

- Draft count is explicitly `count(*)::int` at [data-completeness.ts:221](/home/udai/common/compass/apps/api/src/modules/planning/services/data-completeness.ts:221)-[231](/home/udai/common/compass/apps/api/src/modules/planning/services/data-completeness.ts:231).
- Reconciliation unmatched count is an integer column at [spines.ts:229](/home/udai/common/compass/apps/api/src/db/shared/spines.ts:229).
- Day ages use `Math.floor` at [data-completeness.ts:244](/home/udai/common/compass/apps/api/src/modules/planning/services/data-completeness.ts:244)-[255](/home/udai/common/compass/apps/api/src/modules/planning/services/data-completeness.ts:255) and [data-completeness.ts:287](/home/udai/common/compass/apps/api/src/modules/planning/services/data-completeness.ts:287)-[291](/home/udai/common/compass/apps/api/src/modules/planning/services/data-completeness.ts:291).

I see no realistic serializer mismatch in this service’s current output.

### Revolving debt

Money types are mostly handled correctly:

- Statement totals are Drizzle bigint columns with `{ mode: "number" }` at [spines.ts:213](/home/udai/common/compass/apps/api/src/db/shared/spines.ts:213)-[214](/home/udai/common/compass/apps/api/src/db/shared/spines.ts:214).
- Raw payment aggregation is cast to bigint but explicitly converted with `Number(row.paid)` at [revolving-debt.ts:144](/home/udai/common/compass/apps/api/src/modules/credit/services/revolving-debt.ts:144)-[156](/home/udai/common/compass/apps/api/src/modules/credit/services/revolving-debt.ts:156).
- Revolving balance is subtraction plus `Math.max`, and finance charge uses `Math.ceil`, at [revolving-debt.ts:159](/home/udai/common/compass/apps/api/src/modules/credit/services/revolving-debt.ts:159)-[168](/home/udai/common/compass/apps/api/src/modules/credit/services/revolving-debt.ts:168) and [revolving-debt.ts:79](/home/udai/common/compass/apps/api/src/modules/credit/services/revolving-debt.ts:79)-[85](/home/udai/common/compass/apps/api/src/modules/credit/services/revolving-debt.ts:85).

Again, strings do not escape, and ordinary values are integers. Unsafe-integer overflow remains possible because both raw conversions and Drizzle number-mode bigints can exceed the safe range.

The larger concrete serialization risk is `period`. The response schema requires a valid `YYYY-MM` at [credit.ts:37](/home/udai/common/compass/packages/shared/src/schemas/credit.ts:37)-[40](/home/udai/common/compass/packages/shared/src/schemas/credit.ts:40), but the database column is unconstrained `text` at [spines.ts:204](/home/udai/common/compass/apps/api/src/db/shared/spines.ts:204)-[207](/home/udai/common/compass/apps/api/src/db/shared/spines.ts:207). The comment promises `YYYY-MM`, but neither the DB nor this service validates it before returning it at [revolving-debt.ts:170](/home/udai/common/compass/apps/api/src/modules/credit/services/revolving-debt.ts:170)-[179](/home/udai/common/compass/apps/api/src/modules/credit/services/revolving-debt.ts:179). Legacy, malformed, or directly inserted data can cause a serializer 500.

Recommendation: explicitly acknowledge these two residual DB-output risks in task 059. Ideally add DB-backed route coverage with valid production-like rows plus service-level negative/guard coverage for malformed period and unsafe money. If the intended policy is to reject corrupt DB state as a 500, document that rather than claiming unconditional serialization safety.

## 3. Query parameter design

Not exposing `today` is correct. It is an internal determinism seam, and the service already supplies the current date at [data-completeness.ts:162](/home/udai/common/compass/apps/api/src/modules/planning/services/data-completeness.ts:162)-[165](/home/udai/common/compass/apps/api/src/modules/planning/services/data-completeness.ts:165).

`lookbackMonths` is a genuine service parameter with a sensible default of 12 at [income-surplus.ts:120](/home/udai/common/compass/apps/api/src/modules/planning/services/income-surplus.ts:120)-[126](/home/udai/common/compass/apps/api/src/modules/planning/services/income-surplus.ts:126). The service itself does not validate it. Zero, negative, fractional, `NaN`, or enormous inputs produce nonsensical date/window or loop behavior, so route validation is necessary.

`z.coerce.number()` is correct for query strings and matches existing patterns:

- Planning cashflow uses `z.coerce.number().int().min(3).max(36).default(12)` at [cashflow.ts:7](/home/udai/common/compass/apps/api/src/modules/planning/routes/cashflow.ts:7).
- Dashboard trends does the same at [dashboard.ts:17](/home/udai/common/compass/apps/api/src/modules/planning/routes/dashboard.ts:17)-[24](/home/udai/common/compass/apps/api/src/modules/planning/routes/dashboard.ts:24).
- Import pagination uses coerced, bounded integers at [imports.ts:67](/home/udai/common/compass/apps/api/src/modules/ingest/routes/imports.ts:67)-[80](/home/udai/common/compass/apps/api/src/modules/ingest/routes/imports.ts:80).

The correct Fastify schema key is `querystring`, not `query`; the planned route should follow these exemplars.

The 120-month maximum is defensible but “arbitrarily large ledger scan” overstates the risk:

- The SQL window genuinely expands with the requested range at [income-surplus.ts:133](/home/udai/common/compass/apps/api/src/modules/planning/services/income-surplus.ts:133)-[152](/home/udai/common/compass/apps/api/src/modules/planning/services/income-surplus.ts:152).
- It is supported by the `(user_id, date, ...)` transaction index at [ledger.ts:79](/home/udai/common/compass/apps/api/src/db/shared/ledger.ts:79)-[85](/home/udai/common/compass/apps/api/src/db/shared/ledger.ts:85).
- SQL aggregates to at most one row per month, and the JS work is roughly linear in the number of requested months at [income-surplus.ts:161](/home/udai/common/compass/apps/api/src/modules/planning/services/income-surplus.ts:161)-[175](/home/udai/common/compass/apps/api/src/modules/planning/services/income-surplus.ts:175).

An unbounded range could still scan a user’s entire ledger and allocate/compute over arbitrarily many generated months. The bound is useful input hardening, but not the principal DoS defense. The global read rate limit is 600/minute at [security.ts:18](/home/udai/common/compass/apps/api/src/plugins/security.ts:18)-[27](/home/udai/common/compass/apps/api/src/plugins/security.ts:27).

## 4. Snapshot regeneration

The task’s rendering descriptions are accurate:

- Surface: flattened uppercase methods, sorted, joined with newlines, plus exactly one trailing newline at [app.route-snapshot.test.ts:75](/home/udai/common/compass/apps/api/src/app.route-snapshot.test.ts:75)-[108](/home/udai/common/compass/apps/api/src/app.route-snapshot.test.ts:108).
- Raw table: exact output of `app.printRoutes({ commonPrefix: false })` at [app.route-snapshot.test.ts:120](/home/udai/common/compass/apps/api/src/app.route-snapshot.test.ts:120)-[131](/home/udai/common/compass/apps/api/src/app.route-snapshot.test.ts:131).
- Both comparisons are byte-exact; trailing-newline policy is described at [app.route-snapshot.test.ts:39](/home/udai/common/compass/apps/api/src/app.route-snapshot.test.ts:39)-[46](/home/udai/common/compass/apps/api/src/app.route-snapshot.test.ts:46).

However, the test does not itself provide or execute a regeneration procedure. It only computes actual values and compares them. The implementation must use a temporary/read-only generator or otherwise capture those exact expressions; it cannot infer the raw file from the failure text alone.

### Current and future counts

Current `route-surface.snapshot.txt` contains:

- 313 `(method,path)` lines total.
- 90 GET lines.
- 90 automatically generated HEAD lines.
- Therefore 223 non-HEAD explicit method/path entries.

Adding three Fastify GET routes adds both GET and HEAD for each route:

- Explicit route declarations: 223 → 226.
- GET endpoints: 90 → 93.
- Canonical snapshot pairs/lines: 313 → 319, an increase of **6**, not 3.

Therefore these statements are wrong:

- AC2’s implication that the route-surface line count rises by 3.
- T4’s requirement to show “exactly the 3 added lines.”

T4 must expect six sorted lines: three GET and three HEAD.

### Registration ordering

`route-table.snapshot.txt` is explicitly sensitive to registration and plugin nesting at [app.route-snapshot.test.ts:27](/home/udai/common/compass/apps/api/src/app.route-snapshot.test.ts:27)-[37](/home/udai/common/compass/apps/api/src/app.route-snapshot.test.ts:37).

For the minimal diff:

- Register `planningAnalysisRoutes` after `projectionSettingsRoutes`, preserving all eight existing calls at [planning/plugin.ts:29](/home/udai/common/compass/apps/api/src/modules/planning/plugin.ts:29)-[37](/home/udai/common/compass/apps/api/src/modules/planning/plugin.ts:37).
- Register `revolvingDebtRoutes` after `overdraftDetailsRoutes`, preserving all four existing calls at [credit/plugin.ts:23](/home/udai/common/compass/apps/api/src/modules/credit/plugin.ts:23)-[27](/home/udai/common/compass/apps/api/src/modules/credit/plugin.ts:27).
- Do not reorder existing imports/register calls or register either new route file directly in `app.ts`.

The two routes within `planning-analysis.ts` should also be registered in the task’s declared order—income surplus, then data completeness—to avoid gratuitous raw-tree reordering.

## 5. Route tests and the serializer risk

The existing integration route tests are not optional DB gates. They fail immediately when required variables are absent:

- `requireEnv("DATABASE_URL")`, `REDIS_URL`, and `SESSION_SECRET` at [planning.route.test.ts:32](/home/udai/common/compass/apps/api/src/modules/planning/routes/planning.route.test.ts:32)-[44](/home/udai/common/compass/apps/api/src/modules/planning/routes/planning.route.test.ts:44).
- The harness then boots real Postgres, Redis, auth, and security at [planning.route.test.ts:46](/home/udai/common/compass/apps/api/src/modules/planning/routes/planning.route.test.ts:46)-[62](/home/udai/common/compass/apps/api/src/modules/planning/routes/planning.route.test.ts:62).

Thus “gate it like existing route tests” means “make the file fail at load without the environment,” not skip it. The wording should say that plainly.

If this environment lacks Postgres/Redis, AC4 cannot be verified here. Merely adding a test file that does not run successfully is not evidence that the endpoints return 200.

A lighter-weight serializer test can provide partial value:

- Register Fastify with the real serializer compiler.
- Register the actual route plugin.
- Supply a test session decoration/hook.
- Replace the service dependency or DB with a controlled test double.
- Inject a request and assert 200 and schema-valid JSON.

That will catch route/schema wiring mistakes and serializer rejection of the controlled result. It will **not** catch the key concern in item 2 unless it exercises the real service’s conversions from realistic raw DB values. A hand-built already-normalized response merely repeats task 058.

Concrete recommendation:

1. Add hermetic route serialization tests using dependency injection or module mocking, with deliberately DB-shaped values such as bigint aggregate strings where applicable.
2. Also add the existing-style real Postgres integration tests, marked/documented as environment-dependent.
3. Do not claim the DB-output serializer risk is closed until the real integration test runs successfully.

Avoid a duplicate mini-route that only returns a fixture: it tests Fastify/Zod, not the actual task 059 handler.

## 6. Authentication, user scoping, and household sharing

### Authentication

Production auth is automatic:

- `setupAuth(app)` is installed before route registration at [app.ts:204](/home/udai/common/compass/apps/api/src/app.ts:204)-[207](/home/udai/common/compass/apps/api/src/app.ts:207).
- The auth hook protects every non-public route at [auth.ts:35](/home/udai/common/compass/apps/api/src/plugins/auth.ts:35)-[62](/home/udai/common/compass/apps/api/src/plugins/auth.ts:62).
- These routes will not set `config.public`, so `req.session!.userId` is valid after the hook.

Passing `req.session!.userId` prevents cross-user leakage under the current owner-only services.

### Sharing is a real unresolved semantic bug

The repository has explicit per-record sharing for `account`, `goal`, `holding`, `insurance_policy`, and `budget` at [household/schema.ts:71](/home/udai/common/compass/apps/api/src/modules/household/schema.ts:71)-[77](/home/udai/common/compass/apps/api/src/modules/household/schema.ts:77). `withSharing` defines visibility as “owned by me OR shared to me” at [sharing.ts:4](/home/udai/common/compass/apps/api/src/lib/sharing.ts:4)-[23](/home/udai/common/compass/apps/api/src/lib/sharing.ts:23).

None of the three services uses it:

- Data completeness selects only `accounts.userId = userId` at [data-completeness.ts:167](/home/udai/common/compass/apps/api/src/modules/planning/services/data-completeness.ts:167)-[173](/home/udai/common/compass/apps/api/src/modules/planning/services/data-completeness.ts:173).
- Revolving debt selects only `accounts.userId = userId` at [revolving-debt.ts:93](/home/udai/common/compass/apps/api/src/modules/credit/services/revolving-debt.ts:93)-[103](/home/udai/common/compass/apps/api/src/modules/credit/services/revolving-debt.ts:103), then additionally requires statement rows and transactions to carry the requesting user’s ID at [revolving-debt.ts:114](/home/udai/common/compass/apps/api/src/modules/credit/services/revolving-debt.ts:114)-[119](/home/udai/common/compass/apps/api/src/modules/credit/services/revolving-debt.ts:119) and [revolving-debt.ts:144](/home/udai/common/compass/apps/api/src/modules/credit/services/revolving-debt.ts:144)-[153](/home/udai/common/compass/apps/api/src/modules/credit/services/revolving-debt.ts:153).
- Income surplus similarly filters ledger transactions, recurring templates, and SIPs by owner ID at [income-surplus.ts:138](/home/udai/common/compass/apps/api/src/modules/planning/services/income-surplus.ts:138)-[152](/home/udai/common/compass/apps/api/src/modules/planning/services/income-surplus.ts:152), [income-surplus.ts:177](/home/udai/common/compass/apps/api/src/modules/planning/services/income-surplus.ts:177)-[192](/home/udai/common/compass/apps/api/src/modules/planning/services/income-surplus.ts:192), and [income-surplus.ts:217](/home/udai/common/compass/apps/api/src/modules/planning/services/income-surplus.ts:217)-[232](/home/udai/common/compass/apps/api/src/modules/planning/services/income-surplus.ts:232).

This is especially suspect for `getHouseholdRevolvingDebt`: its name and return type promise household data, but it returns only cards owned by the requesting user. Shared credit-card accounts are silently omitted.

Data completeness also enumerates accounts, so a shared account that appears elsewhere in the household UI would disappear from readiness reporting.

The repository’s sharing rollout is itself incomplete: a code search finds `withSharing` defined but no production service call sites. Task 051 claimed progressive adoption at [tasks/051-sharing-guard/TASK.md:35](/home/udai/common/compass/tasks/051-sharing-guard/TASK.md:35)-[39](/home/udai/common/compass/tasks/051-sharing-guard/TASK.md:39), but the real code has not done so.

This requires a product decision before implementation:

- If these endpoints are intentionally personal-owner reports, rename/document that and avoid “household” claims.
- If shared accounts/cards must be included, task 059 is no longer a pure no-service-change task. The services need sharing-aware orchestration and tests, likely moving at least data completeness and revolving debt out of the “simple pass-through” set.

AC5’s plain `user_id` wording is therefore insufficient and potentially contradictory with household sharing.

## 7. Acceptance criteria and verification review

### Incorrect or contradictory items

- **AC2/T4:** wrong count. Three GETs add six canonical snapshot lines.
- **AC4:** cannot be satisfied by a test that is merely present but fails to start without DB/Redis. Split it into hermetic serializer coverage and environment-dependent integration coverage.
- **AC5:** overstates correctness because owner scoping prevents leakage but may incorrectly omit explicitly shared resources.
- **AC7:** “no existing route is modified” is fine if it means existing route files, but it should explicitly allow the required existing `plugin.ts` and plugin-test modifications.
- **AC8:** “only failures remain the known DATABASE_URL-gated set” is imprecise because some route files also require `REDIS_URL` and `SESSION_SECRET`, as shown at [planning.route.test.ts:42](/home/udai/common/compass/apps/api/src/modules/planning/routes/planning.route.test.ts:42)-[44](/home/udai/common/compass/apps/api/src/modules/planning/routes/planning.route.test.ts:44).
- **T5:** “literal route-test output showing ... parsed body” is only checkable when the environment-dependent tests actually run. It should not be marked passed otherwise.
- **T6:** searching only new handlers for direct DB calls is useful but weak. The meaningful assertion is that each handler directly returns exactly one service invocation.
- **Root Cause:** saying task 058 “proved them safe for Fastify’s response serializer” is too broad. It proved schema behavior against typed fixtures, not these three services’ real DB output.

### Missing criteria/tests

Add:

- Query validation tests: omitted/default lookback, valid coerced string, `0`, `121`, fractional, and nonnumeric values.
- An assertion that `today` is not accepted/used as a client-controlled input. Note that Zod objects normally strip unknown keys, so `?today=...` may be ignored rather than rejected; specify which behavior is intended.
- Auth 401 coverage, or explicitly rely on the global auth test suite.
- Cross-user isolation fixtures for all three routes.
- A sharing-semantics decision and corresponding tests.
- Real-output coverage for statement `period` and bigint conversion.
- Updates to both module plugin tests.

AC1–AC10 and T0–T7 are therefore not currently sufficient.

## 8. Missed repository scope

### Required plugin-test updates

The plan misses two existing enumeration tests:

- Planning’s test asserts exactly eight route files at [planning/plugin.test.ts:19](/home/udai/common/compass/apps/api/src/modules/planning/plugin.test.ts:19)-[40](/home/udai/common/compass/apps/api/src/modules/planning/plugin.test.ts:40). It must become nine and include one representative route from `planning-analysis.ts`.
- Credit’s test asserts exactly four route files at [credit/plugin.test.ts:18](/home/udai/common/compass/apps/api/src/modules/credit/plugin.test.ts:18)-[34](/home/udai/common/compass/apps/api/src/modules/credit/plugin.test.ts:34). It must become five and include revolving debt.

These modifications currently conflict with the task’s stated scope and AC7 unless added explicitly.

I found no other test that snapshots the complete global route table, but these two local plugin tests enumerate route files and will fail or become stale.

### Security and operational concerns

- Rate limiting is already global. GETs enter the read bucket through [security.ts:22](/home/udai/common/compass/apps/api/src/plugins/security.ts:22)-[27](/home/udai/common/compass/apps/api/src/plugins/security.ts:27).
- CSRF applies only to mutating methods, so no new work is needed for GETs; see [security.ts:65](/home/udai/common/compass/apps/api/src/plugins/security.ts:65)-[79](/home/udai/common/compass/apps/api/src/plugins/security.ts:79).
- Demo mode blocks only mutating methods, so AC10 is correct; see [auth.ts:64](/home/udai/common/compass/apps/api/src/plugins/auth.ts:64)-[74](/home/udai/common/compass/apps/api/src/plugins/auth.ts:74).
- No OpenAPI/Swagger route registry exists.
- The Docusaurus workspace is operator/user documentation, not a generated API reference. No mandatory API-doc update pattern was found.
- Caching is selective, not mandatory. These services currently do not use `cached`, and no route-addition rule requires it. The cache helper is opt-in at [cache.ts:3](/home/udai/common/compass/apps/api/src/lib/cache.ts:3)-[20](/home/udai/common/compass/apps/api/src/lib/cache.ts:20). Given the aggregation cost, caching income surplus might eventually be useful, but adding it would violate the claimed pass-through scope and needs invalidation/sharing design.
- No database migration, backup-table update, event emission, or cache invalidation is needed for read-only routes.

## Recommended plan corrections

Before implementation, revise task 059 to:

1. Resolve whether shared accounts/cards belong in these reports. If yes, move the affected service work into scope or defer those endpoints.
2. Change snapshot expectations from +3 lines to +6 canonical pairs, with total 313 → 319.
3. Add `planning/plugin.test.ts` and `credit/plugin.test.ts` to scope.
4. Distinguish hermetic serializer tests from real DB-backed integration tests.
5. State that missing DB/Redis environment prevents AC4 integration verification; do not call current `requireEnv` behavior a skip.
6. Add lookback validation/default tests.
7. Record the residual unsafe-bigint and unconstrained statement-period risks rather than claiming task 058 already proved real DB serialization safe.