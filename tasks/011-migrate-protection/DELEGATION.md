# Sonnet Worker Delegation

## Task
011-migrate-protection (roadmap 1.4) — move the protection domain into `modules/protection/`.

Read `tasks/011-migrate-protection/TASK.md` in full before starting. It is authoritative; this file is
the execution brief, not a replacement for it. Where the two ever disagree, TASK.md wins and you stop
and report the conflict.

**This is a relocation, not a rewrite.** The only new behaviour permitted is the new test files.

## Approved Plan
- P1: Baseline — capture `printRoutes()` and the canonical `(method, url)` list from the **unmodified**
  `registerRoutes()`; confirm the canonical list already equals the committed `route-surface.snapshot.txt`
  byte-for-byte before touching anything. Also re-measure the `apps/api` test count (expected 837).
- P2: Create `modules/protection/schema.ts` (7 bindings) + `schema.smoke.test.ts` (2 `test()` cases —
  one for the 3 tables, one for the 4 enums, mirroring `modules/credit/schema.smoke.test.ts`).
- P3: Move the 2 service files into `modules/protection/services/`, applying the 2 split-imports and the
  depth adjustments. No logic change.
- P4: Move the 2 route files into `modules/protection/routes/`, same discipline.
- P5: Create `plugin.ts` (retirement first, then insurance) + `plugin.test.ts`. Update `app.ts`.
- P6: Confirm the 4 original flat paths no longer exist.
- P7: Compare (do not regenerate) the canonical surface; regenerate `route-table.snapshot.txt` expecting
  an **empty diff**.
- P8: Add `protection.route.test.ts` — 2 demo-403 tests.
- P9: `npm run db:generate` — zero diff, proven by content-hash manifest before/after.
- P10: `backup.test.ts` passes unmodified.
- P11: Full gate — typecheck, lint, test. Read the complete `git diff`.
- P12: Roadmap work (Scope-decision-1 and -2) — see Required Changes item 8.

## Files and Symbols

**Create:**
- `apps/api/src/modules/protection/schema.ts` — thin named re-export of `retirementDetails`,
  `insuranceKind`, `vehicleKind`, `healthType`, `premiumFrequency`, `insurancePolicies`,
  `insuranceHealthCards` from `../../db/schema.ts`
- `apps/api/src/modules/protection/schema.smoke.test.ts`
- `apps/api/src/modules/protection/plugin.ts` — exports `protectionRoutes`
- `apps/api/src/modules/protection/plugin.test.ts`
- `apps/api/src/modules/protection/services/insurance.ts`, `services/retirement.ts` (moved)
- `apps/api/src/modules/protection/routes/insurance.ts`, `routes/retirement.ts` (moved)
- `apps/api/src/modules/protection/routes/protection.route.test.ts`
- `tasks/01.10-storage-backend-contract-tests.md`

**Modify:** `apps/api/src/app.ts`, `apps/api/src/route-table.snapshot.txt` (regenerate; expect no
change), `tasks/01.04-migrate-protection.md`, `tasks/01.09-cross-module-ports.md`, `tasks/README.md`

**Delete:** `apps/api/src/routes/insurance.ts`, `apps/api/src/routes/retirement.ts`,
`apps/api/src/services/insurance.ts`, `apps/api/src/services/retirement.ts`

## Required Changes

1. **`schema.ts`** — named re-export only. `db/schema.ts` must NOT gain an `export *` back.
2. **The 2 split-imports** (a module's own tables come from `../schema.ts`; every other table from
   `../../../db/schema.ts` — never from a peer module's `schema.ts`):
   - `services/insurance.ts:16` → `import { insuranceHealthCards, insurancePolicies } from "../schema.ts";`
     plus `import { transactions } from "../../../db/schema.ts";`
   - `services/retirement.ts:5` → `import { retirementDetails } from "../schema.ts";`
     plus `import { accounts } from "../../../db/schema.ts";`
3. **Depth adjustments** (target unchanged, specifier depth changes):
   - `../lib/errors.ts` → `../../../lib/errors.ts` (routes/insurance.ts:11, services/insurance.ts:17,
     services/retirement.ts:6)
   - `../db/index.ts` → `../../../db/index.ts` (services/insurance.ts:15, services/retirement.ts:4)
   - `../lib/storage.ts` → `../../../lib/storage.ts` (services/insurance.ts:18)
   - `../modules/ledger/services/X.ts` → `../../ledger/services/X.ts` (routes/insurance.ts:12 attachments;
     services/insurance.ts:19 attachments, :20 transactions, :21 resources)
   - **Unchanged:** both route files' `../services/<name>.ts` imports, and all bare specifiers.
4. **`plugin.ts`** — registers `retirementRoutes` then `insuranceRoutes`, in that order, no prefix.
   Follow the header-comment style of `modules/credit/plugin.ts`.
5. **`app.ts`** — replace the 2 imports (lines 31, 32) with one
   `import { protectionRoutes } from "./modules/protection/plugin.ts";` and the 2 registrations
   (lines 123, 124) with one `await app.register(protectionRoutes);` **at line 123's position**
   (after `creditRoutes`, before `insightRoutes`). Extend the header comment with a 1.4 paragraph in the
   established style.
6. **`plugin.test.ts`** — hermetic, `hasRoute()` introspection only, never `app.inject()`. Assert
   `GET /api/retirement/:accountId/details` and `GET /api/insurance/policies`. Mirror
   `modules/credit/plugin.test.ts`.
7. **`protection.route.test.ts`** — registers `protectionRoutes` (the whole plugin, not one route file).
   Two tests: demo session gets 403 on `POST /api/insurance/policies` and on
   `PUT /api/retirement/:accountId/details`, **and** the underlying mutation did not occur (no
   `insurance_policies` row; no `retirement_details` row). The PUT test creates one `accounts` row of
   type `ppf` as a fixture. Model the harness on
   `modules/investments/routes/networth.route.test.ts`.
8. **Roadmap (P12)** — (a) amend `tasks/01.04-migrate-protection.md` line 16 to the structural wording
   (the `Storage` seam is unchanged by the move; live disk-vs-S3 verification is task 1.10);
   (b) create `tasks/01.10-storage-backend-contract-tests.md` with frontmatter `id: "1.10"`,
   `title: Storage backend contract tests`, `phase: "1 — Module migration"`, `release: "2.0.0"`,
   `status: todo`, `depends: [1.4]` **and the 5 acceptance criteria verbatim from TASK.md
   Scope-decision-1** — not a placeholder; (c) add a 1.10 row to `tasks/README.md` in numeric position
   after the 1.9 row; (d) add `1.10` to `tasks/01.09-cross-module-ports.md`'s `depends:` list;
   (e) **last step only, after every gate passes**, flip 1.4 `status: todo` → `done` in
   `tasks/01.04-migrate-protection.md` and its `tasks/README.md` row.

## Must Not Change
- `apps/api/src/route-surface.snapshot.txt` — **byte-frozen.** If it changes, stop and report.
- Any `pgTable(...)`/`pgEnum(...)` definition in `db/schema.ts` — this task only re-exports.
- `services/demo.ts`, `services/goals.ts`, `modules/ledger/services/accounts.ts` — they keep importing
  protection tables from the `db/schema.ts` barrel. Task 1.9 owns that. Do not "tidy" them.
- `services/backup.ts`, `services/restore-user.ts`, `jobs/index.ts` — no change required.
- The 2 stale prose-only doc-comments at `db/schema.ts:332` and
  `modules/investments/services/holding-details.ts:3`.
- Any route URL, handler body, service logic, status code, or Zod schema.
- `apps/extractor` — do not fix its `DATABASE_URL` packaging gap.
- **Do not decorate a stub `storage` on the test app** in `protection.route.test.ts`. This is
  deliberate: a 403 at the auth hook never reaches a handler body, so `app.storage` is never touched.
  If the 403 ever regressed, the missing decoration makes the test fail loudly — which is the point.
- Do not add a Fastify route prefix.

## Acceptance Criteria
AC1–AC10 as written in `TASK.md`. The ones most likely to be got wrong:
- **AC5:** `npm run test -w apps/api` green, **837 → 842 (+5)**: 2 smoke + 1 plugin + 2 demo-403.
  Re-measure the baseline yourself first; report literal before/after numbers. If the delta is not
  exactly +5, explain it — do not round it away.
- **AC9:** the 4 moved files' diffs must consist **exclusively** of import-line changes.
- **AC2:** satisfied only if the roadmap amendment, the concretely-specified 1.10 file, its README row,
  **and** the `1.10` entry in 1.9's `depends:` all exist.
- **AC1:** `route-surface.snapshot.txt` byte-identical; `route-table.snapshot.txt` expected byte-identical
  too (empty diff is the correct result — a non-empty diff is a deviation to report, not to accept).

## Routing (who writes what)
This task is scoped entirely to backend code, so the **`apps/api/src/**` edits go to `backend-engineer`**,
invoked by you as a CLI wrapper (not a Task agent):

```
/home/udai/.claude/bin/backend-engineer tasks/011-migrate-protection/backend-1.md "<full prompt>"
```

Split of ownership:
- **`backend-engineer`** — every change under `apps/api/src/` (items 1–7 in Required Changes).
- **You (`sonnet-worker`)** — the `tasks/*.md` roadmap edits in item 8 (documentation, not backend code),
  plus running the gate commands and capturing evidence.

Do not write `apps/api/src/**` yourself. If `backend-engineer` returns something that violates the
Must-Not-Change list, report it — do not hand-patch it into shape.

## Commands
Run from repo root unless noted. Quote the literal output and exit code of each.
1. `npm run typecheck`
2. `npm run lint`
3. `npm run test -w apps/api`
4. `npm run test`
5. From `apps/api`: `node --test src/app.route-snapshot.test.ts`
6. From `apps/api`: `node --test src/modules/protection/schema.smoke.test.ts`
7. From `apps/api`: `node --test src/modules/protection/plugin.test.ts`
8. From `apps/api`: `node --env-file-if-exists=../../.env --test src/modules/protection/routes/protection.route.test.ts`
9. From `apps/api`: `node --env-file-if-exists=../../.env --test src/services/backup.test.ts`
10. `npm run db:generate` — with a content-hash manifest of `apps/api/drizzle/` captured before and after
11. `git status --porcelain` and the full `git diff`

**Do not run any git command that stages, commits, pushes, or tags.** Read-only git only.

## Required Evidence
- files changed (created / modified / deleted, explicitly)
- complete diff
- commands and literal output
- exit codes
- the before/after `apps/api` test counts, and the +5 arithmetic reconciled
- the `route-table.snapshot.txt` diff (expected empty)
- the drizzle content-hash manifest before and after
- both 403 assertions and both no-mutation assertions from `protection.route.test.ts`
- the literal `depends:` line from `tasks/01.09-cross-module-ports.md` after the edit
- plan deviations or blockers — state them, never silently absorb them

Write full findings to `tasks/011-migrate-protection/implementation-1.md` and reply with a digest of at
most 20 lines plus that path.
