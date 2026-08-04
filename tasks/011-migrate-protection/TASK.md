# Task: Migrate protection module

Corresponds to `tasks/01.04-migrate-protection.md` (roadmap id `1.4`, phase 1 — module migration,
release 2.0.0, `depends: [1.1]`). Tasks 1.1 (`tasks/007-migrate-ledger/`), 1.2
(`tasks/008-migrate-credit/`) and 1.3 (`tasks/010-migrate-investments/`) are all `COMPLETE`, and
establish the reusable template this task follows without re-deriving any of it:
`modules/<domain>/{schema.ts, schema.smoke.test.ts, services/, routes/, plugin.ts, plugin.test.ts}`;
`schema.ts` is a **thin, named re-export** (table definitions stay physically in `db/schema.ts` until
task 1.9); the two-part route-identity gate (`route-surface.snapshot.txt` byte-frozen, must never
change; `route-table.snapshot.txt` regenerated with a reviewed diff); the `schema.smoke.test.ts`
object-identity pattern; the `plugin.test.ts` route-lookup-only registration-completeness pattern; and
the standing Known-traps obligation that each 1.1–1.8 task separately proves demo-write protection
survives its own plugin encapsulation.

One dedicated read-only investigation was run first (`investigation-1.md` — routes, services, tables,
enums, FK graph, cross-import inventory, tests, `Storage` usage, jobs, other consumers, roadmap
accuracy, size check, snapshot gate). Every claim below is either cited to it **or** to the
coordinator's own direct re-verification, which is noted explicitly where it corrects or extends the
investigation.

## Status
PLAN_REVIEW

## Objective
Move the protection domain — `services/insurance.ts`, `services/retirement.ts`,
`routes/insurance.ts`, `routes/retirement.ts` — into
`modules/protection/{schema.ts, services/, routes/, plugin.ts}`, replacing the 2 flat
`app.register(...)` calls in `app.ts` with one `app.register(protectionRoutes)`. Behaviour and URLs
stay identical (this is a relocation, not a rewrite; no file is large enough to warrant a split) with
one narrow, explicitly-scoped exception: adding demo-mode-403 characterization tests, since this
domain has **zero tests of any kind** today.

## Root Cause
Not applicable — a planned refactor, not a bug fix. Facts and decisions below.

### This is the smallest and cleanest domain of the four migrated so far
Verified directly by the coordinator (full file reads, not relayed):

| File | Lines | Contents |
|---|---|---|
| `apps/api/src/routes/insurance.ts` | 166 | 12 endpoints |
| `apps/api/src/routes/retirement.ts` | 30 | 2 endpoints |
| `apps/api/src/services/insurance.ts` | 334 | 12 exported functions + 4 private helpers |
| `apps/api/src/services/retirement.ts` | 73 | 2 exported functions + 2 private helpers |

**14 endpoints total.** Coordinator-verified line-by-line against both route files:

- `GET|POST /api/insurance/policies` (33, 39)
- `PUT|DELETE /api/insurance/policies/:id` (45, 57)
- `POST|GET|DELETE /api/insurance/policies/:id/document` (69, 82, 96)
- `POST /api/insurance/policies/:id/health-cards` (106)
- `GET /api/insurance/health-cards/:cardId` (123)
- `DELETE /api/insurance/policies/:id/health-cards/:cardId` (137)
- `GET|POST /api/insurance/policies/:id/premiums` (149, 155)
- `GET|PUT /api/retirement/:accountId/details` (12, 18)

`tasks/01.04-migrate-protection.md` claims **no** endpoint count, so unlike 1.3 there is no
roadmap-count discrepancy to correct (`investigation-1.md` §1).

**No file exceeds 500 lines, so nothing is split along seams** (`investigation-1.md` §11) — unlike
`cards.ts` (1.2) or `sips.ts` (1.3). `services/insurance.ts`'s 3 internal comment-delimited sections
stay exactly where they are. This is a pure move.

### Schema definitions do NOT physically move (same as 1.1/1.2/1.3)
`modules/protection/schema.ts` is a thin, named re-export of **7 bindings** — 3 tables + 4 enums
(`investigation-1.md` §3, identifier names and lines coordinator-verified against `db/schema.ts`):

| Identifier | Line | Kind |
|---|---|---|
| `retirementDetails` | 951 | table `retirement_details` |
| `insuranceKind` | 997 | enum `insurance_kind` |
| `vehicleKind` | 998 | enum `vehicle_kind` |
| `healthType` | 999 | enum `health_type` |
| `premiumFrequency` | 1007 | enum `premium_frequency` |
| `insurancePolicies` | 1023 | table `insurance_policies` |
| `insuranceHealthCards` | 1083 | table `insurance_health_cards` |

`db/schema.ts` does **not** `export *` back. FK situation (`investigation-1.md` §4) is the simplest of
any domain so far: every cross-module edge in either direction points at **already-migrated
`modules/ledger`** — outbound `insurancePolicies.resourceId → resources` (set null) and
`retirementDetails.accountId → accounts` (cascade); inbound `transactions.policyId →
insurancePolicies.id` (set null, `AnyPgColumn` lazy ref at `db/schema.ts:334`); plus one in-domain
inbound `insuranceHealthCards.policyId → insurancePolicies.id` (cascade). Both tables' `userId` FKs
target core `users`. **Zero still-flat table dependencies.** The definitions still stay put — 1.9 owns
physical relocation, and moving them now would recreate the same `db/schema.ts` cycle 1.1 documented.

### Established cross-module table-import convention (coordinator-verified, not in the investigation)
A direct grep of all 4 existing modules shows one unambiguous, universally-followed rule: a module's
**own** tables are imported from `../schema.ts`; **every other** table — including tables owned by an
already-migrated peer module — is imported from `../../../db/schema.ts`, never from the peer's
`schema.ts`. Confirmed examples: `modules/credit/services/bank-details.ts:5-6` (`accounts` from
`db/schema.ts`, `bankDetails` from `../schema.ts`), `modules/investments/services/account-nps.ts:5-6`,
`modules/ledger/services/recurring.ts:9-10`. **This task follows that rule exactly** — it is what makes
the two split-imports below mechanical rather than a judgement call.

### The complete import work — only 2 split-imports and a set of depth adjustments
`investigation-1.md` §5, every line coordinator-verified by direct file read.

**(a) External production imports FROM a protection file — exactly 2, both in `app.ts`:**
- `app.ts:31` — `import { retirementRoutes } from "./routes/retirement.ts";`
- `app.ts:32` — `import { insuranceRoutes } from "./routes/insurance.ts";`

Both are replaced by a single `import { protectionRoutes } from "./modules/protection/plugin.ts";`.
**No other file anywhere** in `apps/api/src`, `apps/ingestor`, `apps/extractor` or `packages/*` imports
anything from any of the 4 protection files. This is the smallest external footprint of any migration
so far — 1.1/1.2/1.3 each needed 4–7 cross-module import fixes, and each had a *blocking* review
finding in exactly this area. Two stale prose-only doc-comments mention the old paths
(`db/schema.ts:332`, `modules/investments/services/holding-details.ts:3`); they are not imports, have
no compile or runtime effect, and are the same drift class 1.3 explicitly declined to chase — **not
fixed here** (see Non-Goals).

**(b) The 2 split-imports required** (each currently mixes an in-domain table with a ledger-owned one
in a single `db/schema.ts` import):
- `services/insurance.ts:16` — `import { insuranceHealthCards, insurancePolicies, transactions } from "../db/schema.ts";`
  → `import { insuranceHealthCards, insurancePolicies } from "../schema.ts";` +
  `import { transactions } from "../../../db/schema.ts";`
- `services/retirement.ts:5` — `import { accounts, retirementDetails } from "../db/schema.ts";`
  → `import { retirementDetails } from "../schema.ts";` +
  `import { accounts } from "../../../db/schema.ts";`

**(c) Depth adjustments only** (target unchanged, specifier depth changes because the file moves two
levels deeper):
- `routes/insurance.ts:11` and `services/insurance.ts:17` and `services/retirement.ts:6` — `../lib/errors.ts` → `../../../lib/errors.ts`
- `services/insurance.ts:15`, `services/retirement.ts:4` — `../db/index.ts` → `../../../db/index.ts`
- `services/insurance.ts:18` — `../lib/storage.ts` → `../../../lib/storage.ts`
- `routes/insurance.ts:12` — `../modules/ledger/services/attachments.ts` → `../../ledger/services/attachments.ts`
- `services/insurance.ts:19` — `../modules/ledger/services/attachments.ts` → `../../ledger/services/attachments.ts`
- `services/insurance.ts:20` — `../modules/ledger/services/transactions.ts` → `../../ledger/services/transactions.ts`
- `services/insurance.ts:21` — `../modules/ledger/services/resources.ts` → `../../ledger/services/resources.ts`
- **Unchanged**: both route files' `../services/<name>.ts` imports — the `routes/` → `../services/`
  relative shape is identical in the flat and module layouts. `drizzle-orm`, `zod`, `fastify`,
  `fastify-type-provider-zod` and `@compass/shared` are bare specifiers, unaffected.

**Zero imports to a still-flat sibling service exist in either protection file** — unlike investments
(`goal-allocation.ts`, `ownership.ts`) or credit. Three imports already point at
`modules/ledger/services/*` (task 1.1 repointed them) and need only the depth adjustment above.

### Cross-module consumers of protection TABLES — a gap in `investigation-1.md`, found by the coordinator
`investigation-1.md` §5 scoped its search to imports of protection *files* and therefore missed
consumers of protection *tables*. A direct grep for the 3 table identifiers across `apps/` returns
**54 occurrences in exactly 6 files** — proof of exhaustiveness by count, not by sampling:

| File | Occurrences | Nature |
|---|---|---|
| `apps/api/src/db/schema.ts` | 5 | the definitions themselves + the `transactions.policyId` lazy ref |
| `apps/api/src/services/insurance.ts` | 31 | in-domain |
| `apps/api/src/services/retirement.ts` | 7 | in-domain |
| `apps/api/src/services/demo.ts` | 4 | **external** — imports both tables from `db/schema.ts` (19, 22), seeds rows (139, 225) |
| `apps/api/src/services/goals.ts` | 4 | **external** — imports `retirementDetails` (12), reads `annualRateBps` (263-265) |
| `apps/api/src/modules/ledger/services/accounts.ts` | 3 | **external** — imports `retirementDetails` (11) and **writes** it (455-457) inside `updateAccount` |

The third is the notable one: an **already-migrated module writes a protection-owned table directly**,
clearing `maturityDate`/`epsBalancePaise` when an account's type changes. All three keep compiling
untouched, because `db/schema.ts` continues to export the raw tables and this task adds a re-export
rather than moving anything. **Decision: inventory, do not fix** — identical to how 1.1/1.2/1.3 each
handled direct cross-module table access, which `tasks/01.09-cross-module-ports.md` owns. Recorded
here so 1.9 inherits a complete list rather than rediscovering it.

`services/restore-user.ts:14,19` references `"insurance_policies"` as a **string** table name (not an
import) in `MUST_BE_EMPTY` and a MIME-type branch — unaffected by any import change, but listed so the
verifier does not treat it as a missed edit.

### `Storage` is exercised, and is distinct from ledger's `attachments`
`investigation-1.md` §7, coordinator-verified: `routes/insurance.ts` passes `app.storage` at 7 call
sites (61, 74, 86, 100, 114, 127, 146); `services/insurance.ts` threads a `Storage` parameter through
7 functions. Uploads write `insurancePolicies.documentPath` / `insuranceHealthCards.storedPath`
**directly** — they do not use the `attachments` table. From ledger's already-migrated
`services/attachments.ts` this domain imports only two things: the `MAX_ATTACHMENT_BYTES` constant and
the `assertUploadable` validator. `services/retirement.ts` and `routes/retirement.ts` have zero
storage usage. Nothing about the storage path changes in this task beyond the two import depths.

### No jobs, no schedulers, no `backup.ts` change
`investigation-1.md` §8: `jobs/index.ts` imports no protection service and registers no
protection scheduler; no policy-renewal-reminder feature exists anywhere. `jobs/index.ts` therefore
needs **no edit at all** in this task — the first migration for which that is true.
`investigation-1.md` §9: `services/backup.ts` already lists all 3 tables in `ALL_TABLES` (35-36) and
`USER_TABLES` (51-52), and both file-bearing columns in `FILE_COLUMNS` (150-151). **`backup.ts` needs
no change**; `backup.test.ts` must simply stay green.

### Demo-mode 403 — a real gap, and this domain has no tests at all
`investigation-1.md` §6: **zero test files exist for protection** — no `insurance.test.ts`,
`retirement.test.ts`, or any `*.route.test.ts`. So unlike 1.1/1.2 (which discharged the standing
Known-traps obligation by proving an existing route test still passed), and like 1.3, this task must
**add** the characterization test itself.

**Two decisions, both deliberate and both stated here rather than left to implementation time:**

1. **The test registers the module plugin `protectionRoutes`, not a single route file.** The precedent
   harness (`modules/investments/routes/networth.route.test.ts:54`) registers just `netWorthRoutes`.
   Registering the plugin is strictly stronger and is precisely what the Known-traps obligation asks
   for — it tests that demo-write protection survives *plugin encapsulation*, which is the only thing
   this task actually changes structurally.
2. **Both endpoints are covered, one per internal route registration**, because the plugin contains
   two independent registrations and covering one would leave the other's hook inheritance unproven:
   - `POST /api/insurance/policies` — plain JSON body, unambiguously mutating; a fresh user has zero
     policies, so the no-mutation assertion is a trivial row count on `insurance_policies`.
   - `PUT /api/retirement/:accountId/details` — needs one `accounts` row of type `ppf` as a fixture;
     the no-mutation assertion is that no `retirement_details` row exists afterwards.

   Each test asserts **both** the 403 and the absence of the underlying mutation, matching the strength
   of task 1.1's `user-tasks.route.test.ts` and 1.3's `networth.route.test.ts` precedent — never the
   status code alone.

**Known property of the harness, stated so it is not mistaken for a defect:** the test app decorates
`config`/`pg`/`db`/`redis` and installs `setupAuth`/`setupSecurity`, but **not** `storage`. That is
correct and intentional — `app.storage` is referenced only inside handler bodies, which a 403 at the
auth hook never reaches. The implementer must **not** decorate a stub storage to "be safe": if the 403
ever regressed, the handler would run and the test would still fail loudly, which is the desired
behaviour.

### Registration order and the two snapshots
`app.ts:123-124` registers `retirementRoutes` then `insuranceRoutes`, adjacently, positioned after
`creditRoutes` (122) and before `insightRoutes` (125). **`plugin.ts` must register them in that same
order** (retirement first, then insurance), and `app.ts` must place the single
`await app.register(protectionRoutes);` at line 123's position. Because the two calls are already
adjacent and already in order, this is the least disruptive registration change of any migration so
far: the canonical `(method, path)` surface cannot change, and the raw `printRoutes()` tree should
differ only by plugin nesting.

`investigation-1.md` §12 records the current protection lines: 19 in `route-surface.snapshot.txt`
(14 real + 5 Fastify auto-`HEAD`, one per distinct `GET` path) and 3 in `route-table.snapshot.txt`
(`printRoutes()` collapses shared prefixes). `route-surface.snapshot.txt` is **byte-frozen and must
not change**; `route-table.snapshot.txt` is regenerated with the diff reviewed in evidence, never
silently accepted.

### Roadmap text is already accurate — nothing to correct
`investigation-1.md` §10: `tasks/01.04-migrate-protection.md`'s route list and table list are both
exhaustively correct, and the stale `account-nps` mention that `tasks/010-migrate-investments/TASK.md`
Scope-decision-1 promised to remove **is confirmed actually removed** (zero matches in the current
text; `account-nps.ts` exists only under `modules/investments/`). No other roadmap file 01.05–01.09
claims a protection route/service/table; `01.09`'s single mention is a forward-looking reference to
the protection module existing. **Unlike 1.1/1.2/1.3, this task makes no roadmap-prose correction** —
only the `status:` flip at the end.

### Baseline gate state (measured before any change)
`typecheck` exit 0 and `lint` exit 0 across all 7 workspaces. `npm run test` exits **1**, solely
because `apps/extractor/src/statement-duplicate.test.ts` throws its own `requireDatabaseUrl` guard —
the identical pre-existing, unrelated packaging gap that `tasks/010-migrate-investments/TASK.md`
documented and waived with evidence (`apps/extractor`'s `test` script lacks the
`--env-file-if-exists=../../.env` flag every other workspace has). `@compass/api` is **837/837 green**;
web 264/264, shared 212/212, ai 32/32, ingestor 12/12. **AC5 is therefore written against
`apps/api` + the per-workspace summaries, with the extractor failure waived by evidence rather than
silently absorbed** — see AC5.

Separately noted, not this task's business: tasks 1.1–1.3 are complete but **uncommitted** in the
working tree. All "before" comparisons in this task baseline against the **working tree**, not `HEAD`
(`routes/insurance.ts` and `services/insurance.ts` already carry 1.1's import-path edits and show as
`M`).

## Scope

**New files:**
- `apps/api/src/modules/protection/schema.ts` — thin named re-export of the 3 tables + 4 enums
- `apps/api/src/modules/protection/schema.smoke.test.ts` — object-identity assertions for all **7**
  bindings, mirroring `modules/credit/schema.smoke.test.ts`
- `apps/api/src/modules/protection/plugin.ts` — `protectionRoutes(app)` registering
  `retirementRoutes` then `insuranceRoutes`, in that order, no prefix
- `apps/api/src/modules/protection/plugin.test.ts` — hermetic registration-completeness test, one
  uniquely-attributable `(method, path)` per internal registration
  (`GET /api/retirement/:accountId/details`, `GET /api/insurance/policies`), via route-lookup
  introspection only, never `app.inject()`
- `apps/api/src/modules/protection/services/insurance.ts`, `.../services/retirement.ts` — moved, imports
  reclassified per Root Cause (b)/(c)
- `apps/api/src/modules/protection/routes/insurance.ts`, `.../routes/retirement.ts` — moved, same URLs,
  same handler bodies, same status codes
- `apps/api/src/modules/protection/routes/protection.route.test.ts` — new demo-mode-403 test, 2 tests,
  registering `protectionRoutes`

**Modified files:**
- `apps/api/src/app.ts` — 2 imports → 1; 2 registrations → 1 `await app.register(protectionRoutes);`
  at line 123's position; header comment extended with a 1.4 paragraph in the established style
- `apps/api/src/route-table.snapshot.txt` — regenerated, diff reviewed in evidence
- `tasks/01.04-migrate-protection.md`, `tasks/README.md` — `status: todo` → `done` (last step only)

**Deleted files:** `apps/api/src/routes/insurance.ts`, `apps/api/src/routes/retirement.ts`,
`apps/api/src/services/insurance.ts`, `apps/api/src/services/retirement.ts` — **4 old production
paths**, moved not duplicated. There are no old test-file locations, because no test existed.

**Explicitly not moved / not changed** (documented technical debt, same category as 1.1/1.2/1.3):
- `apps/api/src/route-surface.snapshot.txt` — byte-frozen, must not change
- `services/demo.ts`, `services/goals.ts`, `modules/ledger/services/accounts.ts` — keep importing the
  3 tables from the `db/schema.ts` barrel; task 1.9 owns cross-module table access
- `services/backup.ts`, `services/restore-user.ts`, `jobs/index.ts` — no change required
- The 2 stale prose-only doc-comments naming old flat paths

## Dependencies
- 1.1 (`tasks/007-migrate-ledger/`) — COMPLETE (the roadmap dependency; also supplies the
  `attachments`/`transactions`/`resources` imports this domain consumes)
- 1.2, 1.3 — COMPLETE; not roadmap dependencies, but they establish the template and the
  cross-module table-import convention this task follows

## Plan
- P1: Baseline — capture `printRoutes()` and the canonical `(method, url)` list from the **unmodified**
  `registerRoutes()`; confirm the canonical list already equals the committed
  `route-surface.snapshot.txt` byte-for-byte before touching anything.
- P2: Create `modules/protection/schema.ts` (7 bindings) + `schema.smoke.test.ts`. Typecheck and the
  smoke test pass with zero other changes.
- P3: Move the 2 service files into `modules/protection/services/`, applying the 2 split-imports and
  the depth adjustments from Root Cause (b)/(c). No logic change.
- P4: Move the 2 route files into `modules/protection/routes/`, same discipline. Same URLs, same
  handler bodies.
- P5: Create `plugin.ts` (retirement first, then insurance) + `plugin.test.ts`. Update `app.ts`:
  2 imports → 1, 2 registrations → 1 at line 123's position, header comment extended.
- P6: Confirm the 4 original flat paths no longer exist (nonexistence confirmation and cleanup — the
  moves in P3/P4 are where deletion actually happens).
- P7: Compare (do **not** regenerate) the canonical surface against P1's baseline and the committed
  file; separately regenerate `route-table.snapshot.txt` and paste the diff in evidence with the
  3-part reviewer checklist (leaf content matches the canonical set; only ordering/grouping/glyphs/
  nesting differ; no unexpected constraint or duplicate branch).
- P8: Add `protection.route.test.ts` — the 2 demo-403 tests per Root Cause. May run before or after
  P7 with no consequence.
- P9: `npm run db:generate` — zero diff, proven by a content-hash manifest of `apps/api/drizzle/`
  before and after.
- P10: `backup.test.ts` passes unmodified — no `backup.ts` edit.
- P11: Full gate — `npm run typecheck`, `npm run lint`, `npm run test`. Read the complete `git diff`
  directly to confirm no handler body or service logic changed beyond import specifiers (AC9).

## Acceptance Criteria
- AC1 (roadmap): `route-surface.snapshot.txt` byte-identical before and after; `route-table.snapshot.txt`
  regenerated with its diff reviewed in evidence; `npm run db:generate` produces a zero diff (content-hash
  manifest before/after); `backup.test.ts` green with no `backup.ts` edit
- AC2 (roadmap): policy-document and health-card upload/download still work — the `Storage` seam is
  unchanged. Proven by: `assertUploadable`/`MAX_ATTACHMENT_BYTES` still imported from ledger (at the new
  depth), the 4 storage endpoints still present in the unchanged canonical surface, all 7 `app.storage`
  call sites and all 7 `Storage`-taking service signatures intact, and clean `typecheck`. **Explicitly
  not claimed:** this task performs no live S3/MinIO-vs-disk upload run — no such test exists today and
  creating one is out of scope. State this as a documented limitation in the evidence; do not assert
  "verified against both backends" without a run
- AC3 (roadmap): `npm run typecheck` and `npm run lint` green across all workspaces
- AC4 (this task, schema safety): no circular import — `modules/protection/schema.ts` only re-exports
  named bindings from `db/schema.ts`, and `db/schema.ts` does not `export *` back; proven at runtime by
  `schema.smoke.test.ts`'s object-identity assertions for all **7** bindings
- AC5 (roadmap, scoped to what this task can prove): `npm run test -w apps/api` is fully green with **no
  regression against the 837/837 baseline** and a **net +3 test count** (1 smoke + 1 plugin + 2 demo-403
  = 4 new `test(...)` cases across 3 new files — the implementer reports the exact delta, and any
  divergence from the arithmetic is explained, not rounded away). The root `npm run test` still exits 1
  **only** because of the pre-existing `apps/extractor` `DATABASE_URL` packaging gap documented in Root
  Cause; the implementer must re-confirm that is still the *sole* failure, quoting the per-workspace
  summary lines — a second failure anywhere invalidates this waiver
- AC6 (this task, completeness): every import in Root Cause (b)/(c) is updated; proven by clean
  `typecheck` **plus** a source-aware import-resolution check (not a basename grep) confirming zero
  remaining relative imports resolve to any of the 4 deleted flat paths
- AC7 (this task, plugin completeness): `plugin.test.ts` asserts one uniquely-attributable route from
  **each** of the 2 internal registrations via route-lookup introspection, not handler execution
- AC8 (this task, demo-mode — standing Known-traps obligation, never before satisfied for this domain):
  a new test file registering `protectionRoutes` proves a demo session receives 403 on **both**
  `POST /api/insurance/policies` and `PUT /api/retirement/:accountId/details`, and that neither
  underlying mutation occurred (no `insurance_policies` row; no `retirement_details` row)
- AC9 (this task, "move not rewrite"): a full-diff review confirms no route-handler body and no service
  logic changed beyond import specifiers — pasted in evidence, not merely asserted. The 4 moved files'
  diffs must consist exclusively of import-line changes
- AC10 (this task, boundary convention): the moved files import protection-owned tables from
  `../schema.ts` and every non-protection table from `../../../db/schema.ts`, never from a peer module's
  `schema.ts` — matching the convention verified across all 4 existing modules

## Verification
- T1: `npm run typecheck` — zero errors, all workspaces, exit code quoted
- T2: `npm run lint` — zero errors, exit code quoted
- T3: `npm run test -w apps/api` — full pass, literal summary line and exit code; test count compared
  against the 837 baseline
- T4: `npm run test` (root) — literal per-workspace summary lines and exit code; confirm the extractor
  `DATABASE_URL` failure is the sole failure
- T5: `node --test src/app.route-snapshot.test.ts` (from `apps/api`) — passes; separately, the
  regenerated `route-table.snapshot.txt` is diff-reviewed against its pre-move capture and pasted in
  evidence with the 3-part checklist
- T6: `node --test src/modules/protection/schema.smoke.test.ts` — passes, all 7 bindings
- T7: `node --test src/modules/protection/plugin.test.ts` — passes, both registrations resolve
- T8: `node --env-file-if-exists=../../.env --test src/modules/protection/routes/protection.route.test.ts`
  — passes; both 403s and both no-mutation assertions pasted in evidence
- T9: Content-hash manifest of `apps/api/drizzle/` before and after `npm run db:generate` — identical
- T10: `node --env-file-if-exists=../../.env --test src/services/backup.test.ts` — passes
- T11: Source-aware import-resolution check (script, not grep) — zero remaining references to the 4
  deleted flat production paths
- T12: Direct confirmation the 4 old files no longer exist on disk
- T13: Full `git diff` reviewed: no table definition in `db/schema.ts` changed (only re-exported); the 4
  moved files show import-line changes only; `app.ts` shows only the import/registration collapse plus
  its header-comment paragraph; `services/demo.ts`, `services/goals.ts`,
  `modules/ledger/services/accounts.ts`, `services/backup.ts`, `services/restore-user.ts` and
  `jobs/index.ts` are **untouched**

## Non-Goals
- Not adding a Fastify route prefix — the standing deferral from 1.1/1.2/1.3.
- Not physically relocating the 3 tables' `pgTable(...)`/`pgEnum(...)` definitions — task 1.9's job.
- Not splitting any protection file along seams — none reaches the size that justified it in 1.2/1.3.
- Not repointing `services/demo.ts`, `services/goals.ts` or `modules/ledger/services/accounts.ts` off
  the `db/schema.ts` barrel, and not resolving ledger's direct write to `retirement_details` — both are
  inventoried above for task 1.9, matching how 1.1/1.2/1.3 handled the same class of finding.
- Not fixing the 2 stale prose-only doc-comments naming old flat paths — cosmetic, and the same drift
  class 1.3 explicitly declined to chase.
- Not fixing the `apps/extractor` `DATABASE_URL` packaging gap — pre-existing, unrelated, and worth its
  own one-line task.
- Not adding functional test coverage for insurance/retirement business logic beyond the AC8 demo-403
  characterization. This domain has zero tests, but "preserve existing coverage exactly, do not close
  pre-existing gaps" is the rule 1.1 set and 1.3 followed; closing this gap properly is its own task.
- Not performing a live S3-vs-disk storage upload verification (see AC2's explicit limitation).
