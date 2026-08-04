# Third-pass narrow plan review — revision 3

## Verdict

No. Five of review-2’s six required changes are resolved. The runtime schema smoke test is only partially resolved because the plan still describes `db.query.users` and `db.query.projectionSettings` as being checked against a TypeScript type, not explicitly on a runtime Drizzle instance.

No other changes are required by this narrow review.

## 1. Explicitly import and re-export `users`

**Status: Resolved.**

`TASK.md` now specifies the required import-plus-export arrangement rather than a bare re-export.

Line 39 says:

> “`db/schema.ts` now does `import { users } from "./core-schema.ts"; export { users } from "./core-schema.ts"; export * from "../modules/planning/schema.ts";` — an explicit import (for `db/schema.ts`'s own use) plus an explicit re-export…”

The concrete Scope repeats this at line 58:

> “add, at the top: `import { users } from "./core-schema.ts"; export { users } from "./core-schema.ts"; export * from "../modules/planning/schema.ts";` — the explicit `import` gives `db/schema.ts` its own local `users` binding…”

P2 and AC5 reinforce the same requirement:

> “Update `db/schema.ts` to `import { users } from "./core-schema.ts"; export { users } from "./core-schema.ts";`…” — line 79

> “`db/schema.ts` explicitly imports and re-exports `users` (not a bare `export *`, which cannot bind the name locally)” — line 95

This fully resolves review-2’s blocking binding defect.

## 2. Restore a concrete hermetic runtime schema smoke test

**Status: Partially resolved.**

The plan restores a named hermetic smoke test and concretely covers the aggregate exports and table metadata.

Line 40 says:

> “a new hermetic test (`apps/api/src/db/schema.smoke.test.ts` or colocated with `schema.ts`) imports the aggregate `schema` object and `createDb()`'s type, and asserts: `users`/`projectionSettings` are each present exactly once; their Postgres table names are `users`/`projection_settings`; `projectionSettings` retains its four columns (`user_id`, `equity_return_bps`, `created_at`, `updated_at`); `db.query.users`/`db.query.projectionSettings` both resolve on a constructed `Db` type.”

The Scope similarly says:

> “hermetic runtime test (no DB connection) importing the aggregate `schema` object and asserting: `users`/`projectionSettings` each present exactly once; SQL table names `users`/`projection_settings`; `projectionSettings`'s four columns (`user_id`, `equity_return_bps`, `created_at`, `updated_at`) intact…” — line 59

Those provisions genuinely restore the aggregate-export, SQL-name, and column checks requested by review-2.

The remaining defect is the query check:

> “both resolve against a constructed `Db` type (`NodePgDatabase<typeof schema>`)” — line 59

A TypeScript type does not exist at runtime, so resolving properties against `NodePgDatabase<typeof schema>` is a compile-time check rather than the requested runtime verification. This conflicts with AC5’s stronger wording:

> “`db.query.projectionSettings` and `db.query.users` both resolve correctly at runtime, proven by `schema.smoke.test.ts`, not inferred from `tsc` alone” — line 95

The plan must explicitly require constructing an actual Drizzle database object—using `createDb()` with a nonconnecting stub/fake pool or an equivalent hermetic construction—and asserting at runtime that `db.query.users` and `db.query.projectionSettings` exist. No query or live database connection is needed.

## 3. Document `core-schema.ts` narrowly

**Status: Resolved.**

The plan repeatedly limits `core-schema.ts` to shared identity/core ownership and rejects its use as a general cross-module-FK bucket.

Line 22 says:

> “`core-schema.ts` is deliberately narrow: it holds only the shared identity table(s) that genuinely need a cycle-free home, starting with `users`. It is **not** a general destination for every cross-module foreign key…”

The Scope says:

> “This is a deliberately narrow shared-identity leaf — **not** a general destination for every cross-module foreign key…” — line 57

The planned `CLAUDE.md` documentation is equally explicit:

> “`db/core-schema.ts` holds a small, deliberately narrow set of shared identity tables (starting with `users`) — not a general cross-module-FK bucket.” — line 70

The Non-Goals section also preserves the ownership-decision requirement:

> “future cross-module FK targets get their own explicit ownership decision… not an automatic move into ‘core’” — line 115

This fully resolves review-2’s architectural-documentation concern.

## 4. Replace git-status-only Drizzle verification with content manifests

**Status: Resolved.**

Revision 3 now requires a real before/after content-hash manifest.

Line 41 says:

> “P8/T6 now capture a hash manifest (relative path + content hash) of every file under `apps/api/drizzle/` before running `npm run db:generate`, then recompute and diff the manifest afterward — byte-identity proof, not state-only.”

P8 makes the implementation procedure concrete:

> “capture a content manifest (relative path + content hash, e.g. `sha256sum`) of every file under `apps/api/drizzle/`… Recompute the manifest and diff against the pre-generate one — must be byte-identical…” — line 85

AC2 and T6 repeat that the result must be demonstrated through content hashes rather than Git status:

> “proven by a content-hash manifest comparison” — line 92

> “Content-hash manifest… captured before and after… manifests diffed and shown identical” — line 103

This fully resolves review-2’s verification defect.

## 5. Safeguard the hand-copied P1 baseline

**Status: Resolved.**

The plan now requires both exact sequence verification and an exact recorded output count.

Line 42 says:

> “the throwaway harness's plugin/import list [must] be mechanically diffed against `app.ts`'s actual 39 `app.register(...)` lines… compared line-by-line against the harness's own registration calls…”

It also requires:

> “the exact route/line count of the captured `printRoutes()` output recorded verbatim (not `~155`)” — line 42

P1 carries those requirements into the implementation sequence:

> “mechanically diff the throwaway harness's plugin/import list against `apps/api/src/app.ts`'s actual `app.register(...)` lines… compared entry-by-entry against the harness, and record the exact line/route count of the captured output (not `~155`).” — line 78

T5 requires that exact count in the final evidence:

> “the exact captured route/line count from P1 is quoted, not approximated” — line 102

Although the Objective still uses “`~155 URL patterns`” at line 11 as a descriptive estimate, the baseline procedure and verification evidence now explicitly require the exact measured count. This satisfies review-2’s requested safeguard.

## 6. Correct the “all required changes addressed” framing

**Status: Resolved.**

Revision 3 now explicitly labels review-1 items 8 and 9 as partial rather than closed.

Line 44 says:

> “items 8… and 9… from review-1 are **partially** addressed, not fully”

It accurately identifies the remaining public-route gap:

> “adds **no** public-route (`config.public: true`) characterization anywhere in the app. That gap is accepted as residual, documented risk… not claimed as closed.” — line 45

It also accurately identifies the deferred goals check:

> “The goals-integration check… remains explicitly out of scope… so this is accepted scope debt, not a blocker…” — line 46

The plan further acknowledges that documentation alone does not enforce the future work:

> “`tasks/README.md`'s Known-traps entry is documentation, not an enforcement mechanism” — line 47

The accepted gaps are then restated in lines 49–51 and in Non-Goals:

> “there is still no public-route (`config.public`) characterization anywhere in the app after this task” — line 116

> “Not adding test coverage for `services/goals.ts`'s existing… dependency on `getProjectionSettings`” — line 117

This honestly describes both items as partially resolved or deferred and fully corrects the misleading closure framing.

## Overall implementation-readiness

**No, not yet implementation-ready.**

Exactly one clarification remains: revise the schema smoke-test specification so that it explicitly constructs a runtime Drizzle instance without opening a live database connection and asserts that both `db.query.users` and `db.query.projectionSettings` exist on that instance. Checking those properties only against `NodePgDatabase<typeof schema>` is compile-time verification and does not satisfy review-2’s requested runtime smoke test or the plan’s own AC5.

Once that runtime-instance requirement is made explicit, all six required changes from review-2 will be resolved and the plan will be implementation-ready.