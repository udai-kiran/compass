# Implementation 3 — Task 13.4 Structured Taxable-Income Ledger (Review-4 fix round)

## Summary

Implemented all P1–P6 steps from DELEGATION-3.md, addressing the two confirmed high-severity Codex findings plus missing test coverage, minor cleanup, and verification.

---

## Files Inspected

- `tasks/090-taxable-income-ledger/TASK.md`
- `tasks/090-taxable-income-ledger/DELEGATION-3.md`
- `packages/shared/src/schemas/tax.ts`
- `apps/api/src/modules/tax/services/income-events.ts`
- `apps/api/src/modules/tax/routes/income-events.ts`
- `apps/api/src/modules/tax/services/income-events.test.ts`
- `apps/api/src/modules/tax/schema.ts`
- `apps/api/src/app.ts`
- `apps/api/src/modules/ledger/services/epf-contributions.test.ts` (read as pattern reference)
- `apps/api/src/db/schema.decomposition.test.ts`
- `node_modules/drizzle-orm/errors.js`
- `packages/shared/src/schemas/ledger.test.ts` (read as pattern reference)

---

## Files Changed

### P1 — Expose `section`/`sourcePriority` end-to-end

**`packages/shared/src/schemas/tax.ts`**

- Added `section: z.string().nullable()` to `IncomeEventSchema` (with JSDoc)
- Added `sourcePriority: z.number().int()` to `IncomeEventSchema` (with JSDoc)
- Added `section: z.string().min(1).nullable().optional()` to `CreateIncomeEventBodySchema` (with JSDoc explaining that `sourcePriority` is server-controlled and not accepted from the client)

**`apps/api/src/modules/tax/services/income-events.ts`**

- `buildIncomeEventDto`: added `section: row.section ?? null` and `sourcePriority: row.sourcePriority`
- `createIncomeEvent`: added `section: input.section ?? null` and `sourcePriority: 0` to the DB insert
- `deriveFromPayslip`: added `sourcePriority: 0` explicitly (section `"192"` was already present)
- `deriveFromHoldingEvent`: added `section: "194K"` (with a code comment: "TDS on income from mutual-fund units (IDCW/dividend) is deducted under section 194K") and `sourcePriority: 0`

### P2 — PAN/TAN-in-logs fix

**`apps/api/src/lib/error-logging.ts`** (new file)

Created `sanitizeErrorForLog(err: unknown): Record<string, unknown>` that:
- Duck-types on the presence of BOTH `.query` (string) AND `.params` (any property) — NOT on `err.name === "DrizzleQueryError"` because `DrizzleQueryError` does not set `this.name` in its constructor (instances inherit `"Error"` from `Error.prototype.name`), making the name check unreliable
- For DrizzleQueryError-shaped errors: omits `.message` (which bakes bound params into the string), omits `.query` and `.params`, replaces `.message` with a static placeholder, preserves `.cause` (the underlying pg driver error does not carry bound params)
- For all other errors: preserves `.message` and all own enumerable properties (no regression)

**`apps/api/src/lib/error-logging.test.ts`** (new file)

11 tests covering:
- DrizzleQueryError-shaped error: fake PAN not present anywhere in serialized output
- Placeholder message contains "omitted" and does not contain "Failed query"
- name and stack still present; query and params omitted; cause preserved
- Plain `Error`: message preserved
- Custom error with statusCode/code: all properties pass through
- Edge cases: string, null, error with only .query (not treated as Drizzle)

**`apps/api/src/app.ts`**

- Added `import { sanitizeErrorForLog } from "./lib/error-logging.ts";`
- Changed `req.log.error(err)` → `req.log.error(sanitizeErrorForLog(err))` in the unexpected-5xx handler branch (line 244-250, the `status >= 500 && err.name !== "HttpError"` branch). This is the single call site approved by the coordinator.

### P3 — Shared-schema tests

**`packages/shared/src/schemas/tax.test.ts`** (new file)

35 tests covering `IncomeEventSchema`, `CreateIncomeEventBodySchema`, `AcceptIncomeEventBodySchema`, `IncomeEventSummarySchema`:
- `IncomeEventSchema`: parses valid DTO; `afterTdsPaise` present; `section` present and nullable; `sourcePriority` present and must be integer; rejects missing `afterTdsPaise`
- `CreateIncomeEventBodySchema`: parses valid body; impossible date `2025-02-30` rejected; `2023-02-29` rejected (non-leap); `2024-02-29` accepted (leap); PAN trim+uppercase; PAN with digit at position 1 rejected; short PAN rejected; null PAN accepted; TAN trim+uppercase; TAN with letter at position 5 rejected; null TAN accepted; `fy`/`sourceKind`/`sourceId`/`sourcePriority` not present in output; `section` accepted; `section` null accepted; `tdsPaise > grossPaise` rejected
- `AcceptIncomeEventBodySchema`: empty body; PAN trim+uppercase; PAN digit/letter transposed rejected; TAN trim+uppercase; TAN letter at position 5 rejected; null PAN/TAN accepted
- `IncomeEventSummarySchema`: all five kinds present; missing kind rejected; `acceptedCount`/`pendingCount` required; `notes` required

### P4 — Real-Postgres integration tests

**`apps/api/src/modules/tax/services/income-events.integration.test.ts`** (new file)

Follows `apps/api/src/modules/ledger/services/epf-contributions.test.ts` pattern exactly:
- `requireDatabaseUrl()` throws loudly when `DATABASE_URL` is unset (does NOT skip silently)
- Each test creates throwaway user(s) and cleans up via `t.after()`

Tests:
1. **Guarded accept-vs-reject race**: fires both concurrently via `Promise.allSettled`, asserts exactly one succeeds and the loser gets HTTP 409
2. **Cross-user 404**: `getIncomeEvent`, `acceptIncomeEvent`, `rejectIncomeEvent` all return 404 when the row belongs to a different user
3. **Source dedup via real partial unique index**: two `deriveFromPayslip` calls on the same payslip return the same row id; confirms exactly one row exists in DB for `(user, source_kind='payslip', source_id)`
4. **section/sourcePriority round-trip**: `createIncomeEvent` with `section='194A'` persists and returns correctly; `deriveFromPayslip` sets `section='192'` correctly; omitted section is null

### P5 — Minor cleanup

**`apps/api/src/modules/tax/routes/income-events.ts`**

- Removed the unreachable `if (!event)` fallback in the holding-event route handler (the service always throws or returns a non-null `IncomeEvent`; the fallback could never execute)
- Removed the now-unused `import { HttpError }` import
- Fixed the misleading comment on the `derive/payslip` route that claimed "Must be registered before /:id routes" — the actual registration order has `/:id/accept` and `/:id/reject` before the derive routes. Fixed comment now accurately describes that the `derive` static segment is distinct from `:id` and Fastify's specificity rules prevent any conflict regardless of registration order

**Prettier**: The repo has a `prettier --write` script. Ran prettier on all 7 changed files. Route file was already correctly formatted (unchanged).

---

## Commands Run with Literal Output

### Typecheck (non-EPF errors only)
```
$ npm run typecheck -w apps/api 2>&1 | grep "\.ts(" | grep -v "epf-contributions.test.ts"
(no output — no errors in my files)
```

All typecheck errors are exclusively in `apps/api/src/modules/tax/services/epf-contributions.test.ts` (concurrent task 13.5 EPF worker). Exit code: 2 (due to EPF errors only). My files: 0 errors.

### Lint
```
$ npm run lint 2>&1; echo "EXIT CODE: $?"
> compass@0.1.0 lint
> eslint .

EXIT CODE: 0
```

Exit 0 — lint clean. (Earlier in the session, `epf-contributions.test.ts` had 2 lint errors from the concurrent 13.5 worker; these were subsequently fixed by the concurrent worker.)

### error-logging.test.ts
```
$ node --test apps/api/src/lib/error-logging.test.ts
▶ sanitizeErrorForLog — DrizzleQueryError-shaped errors
  ✔ does NOT include the PAN anywhere in the sanitized output (0.475307ms)
  ✔ replaces .message with a static placeholder (does not preserve original) (0.098558ms)
  ✔ still includes name and stack in the sanitized output (0.078139ms)
  ✔ omits .query and .params from the sanitized output (0.078339ms)
  ✔ preserves .cause from a DrizzleQueryError (pg driver error has no bound params) (0.216242ms)
✔ sanitizeErrorForLog — DrizzleQueryError-shaped errors (1.53141ms)
▶ sanitizeErrorForLog — plain Error (non-Drizzle)
  ✔ preserves .message for a plain Error (0.260486ms)
  ✔ preserves .name and .stack for a plain Error (0.111573ms)
  ✔ preserves additional own properties on a custom error (0.590406ms)
✔ sanitizeErrorForLog — plain Error (non-Drizzle) (1.107772ms)
▶ sanitizeErrorForLog — edge cases
  ✔ handles a non-object (string) (0.110941ms)
  ✔ handles null (0.094941ms)
  ✔ an error with only .query (no .params) is NOT treated as DrizzleQueryError (0.075484ms)
✔ sanitizeErrorForLog — edge cases (0.379804ms)
ℹ tests 11
ℹ suites 3
ℹ pass 11
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 68.047146
```

### income-events.test.ts (unit, all pass)
```
$ node --env-file-if-exists=.env --experimental-test-module-mocks --test apps/api/src/modules/tax/services/income-events.test.ts
ℹ tests 56
ℹ suites 8
ℹ pass 56
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 477.66779
```

### packages/shared tests (all pass including 35 new tax schema tests)
```
$ npm run test -w packages/shared
ℹ tests 387
ℹ suites 4
ℹ pass 387
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 345.007964
```

### schema.decomposition.test.ts
```
$ node --test apps/api/src/db/schema.decomposition.test.ts
✔ exports exactly 78 tables + 61 enums + users with no duplicates (0.710264ms)
ℹ tests 3
ℹ pass 3
ℹ fail 0
```
(78 tables already counts income_events and epf_contributions — correct, no change needed)

### income-events.integration.test.ts (no DATABASE_URL available)
```
$ node --test apps/api/src/modules/tax/services/income-events.integration.test.ts
Error: income-events.integration.test.ts needs DATABASE_URL set (a real Postgres
connection) — this repo has no DB-mocking infrastructure. Export it (see
apps/api/.env) before running `npm run test -w apps/api`.
ℹ tests 1
ℹ fail 1
```
Throws loudly as required by `tasks/TDD.md`. Tests are structurally complete and typecheck clean. DB not available in this environment; this matches the brief's explicit guidance ("If this worker's environment genuinely has no reachable Postgres, write the tests anyway...and say so explicitly in the report — do not fake DB access with a mock").

### Full API test suite
```
$ node --env-file-if-exists=.env --experimental-test-module-mocks --test "apps/api/src/**/*.test.ts"
ℹ tests 1391
ℹ suites 57
ℹ pass 1356
ℹ fail 34
ℹ cancelled 0
ℹ skipped 1
ℹ todo 0
ℹ duration_ms 10691.12954
```
All 34 failures are DB/Redis-backed tests that throw loudly when `DATABASE_URL`/`REDIS_URL` is unset. This includes `epf-contributions.test.ts`, `backup.test.ts`, `app.test.ts`, and the new `income-events.integration.test.ts`. All these require a real Postgres/Redis connection. This matches the pre-existing state — not caused by my changes.

---

## Assumptions

1. The decomposition test already shows 78 tables (not 76 → 77 as the TASK.md stated). This was incremented by previous implementation rounds (13.4 added income_events → 77, 13.5 added epf_contributions → 78). No change needed.

2. The `DrizzleQueryError` duck-type uses `.query` (string) + `.params` (any property) presence rather than `name === "DrizzleQueryError"` because the constructor does NOT set `this.name` — instances inherit `"Error"` from `Error.prototype.name`. This design choice is documented in both `error-logging.ts` and `error-logging.test.ts`.

3. The concurrent task 13.5 (EPF passbook) worker was editing `packages/shared/src/schemas/tax.ts` and `apps/api/src/modules/tax/services/epf-contributions.test.ts` concurrently. The tax.ts income-events region was not disturbed by concurrent edits. All edits were confirmed by re-reading the file immediately before each Edit call.

4. Prettier was run only on the 7 files I created or modified (not on EPF files or any other files).

---

## Deviations from Brief

None material. The brief said "fix the comment or the order" for the route-ordering issue — I fixed the comment (describing actual registration order) rather than reordering routes, because reordering is unnecessary (Fastify's specificity rules handle it correctly regardless).

---

## Unresolved Risks

1. **Pre-existing typecheck failures in `epf-contributions.test.ts`** (concurrent task 13.5): `actualVpfPaise` type mismatch (`number | null | undefined` vs `number | null`). This is outside my scope (`Must Not Change: EPF files`). The coordinator should ensure the 13.5 worker resolves this before merge.

2. **Integration tests cannot run in this environment** (no `DATABASE_URL`). The tests are structurally correct and typecheck clean, but actual DB-level behavior (race condition, partial unique index dedup) cannot be verified here. CI will need to run them.

3. **Lint was initially red (`epf-contributions.test.ts` unused imports)** but was fixed by the concurrent 13.5 worker during this session. At the end of this implementation, lint exits 0 cleanly.
