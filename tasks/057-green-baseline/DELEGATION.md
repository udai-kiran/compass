# Sonnet Worker Delegation

## Task
057 — Green the baseline (typecheck + lint)

## Approved Plan

- **P0 (cross-cutting)**: `tsconfig.base.json:9` sets `verbatimModuleSyntax: true`.
  Every type-only import you add MUST use `import type { ... }`, or you get TS1484.
  Drizzle tables are values (used in `typeof` position) — import them normally.
- **P1**: Run `npm install` from the repo root to repair the stale `node_modules`
  tree so `fast-check@4.9.0` resolves. Do NOT edit `package.json`. Do NOT pass any
  flag that rewrites the lockfile. `package.json` and `package-lock.json` are
  already correct — only the installed tree is missing the package.
- **P2**: `apps/api/src/modules/household/routes/splits.ts` — type `toSplitResponse`.
- **P3**: `apps/api/src/modules/household/routes/settlements.ts` — type `toSettlement`.
- **P4**: `apps/api/src/modules/household/services/grants.ts` — narrow `listGrants`
  `resourceType` to the enum union, delete the `as any`.
- **P5**: Remove three unused imports.

## Files and Symbols

1. `apps/api/src/modules/household/routes/splits.ts` — `toSplitResponse` (line 25, and the inner `(s: any)` at line 35)
2. `apps/api/src/modules/household/routes/settlements.ts` — `toSettlement` (line 21)
3. `apps/api/src/modules/household/services/grants.ts` — `listGrants` signature (line ~55) + `as any` (line 59)
4. `apps/api/src/modules/household/services/membership.ts` — unused `gt` in the import on line 1
5. `apps/api/src/modules/planning/services/income-surplus.test.ts` — unused `IncomeSurplusComputation` on line 6
6. `apps/web/src/lib/household-queries.ts` — unused `AcceptInviteSchema` on line 4

Types you need already exist — do not invent any:
- Drizzle tables `splits`, `splitShares`, `settlements`, `sharingGrants` are all
  exported from `apps/api/src/modules/household/schema.ts`.
- `HouseholdSplit`, `HouseholdSplitShare`, `Settlement`, `SharingResourceType`
  are all exported from `@compass/shared`
  (`packages/shared/src/schemas/household.ts`).

## Required Changes

### P1 — install repair
Run `npm install` from `/home/udai/common/compass`. Capture full output and exit
code. Then confirm `node_modules/fast-check` and `node_modules/pure-rand` exist
and `npm ls fast-check` shows 4.9.0. Report whether `package-lock.json` changed
(expected: unchanged — if it changed, STOP and report rather than proceeding).

### P2 — `routes/splits.ts`
Change the mapper signature to:
```ts
function toSplitResponse(
  split: typeof splits.$inferSelect,
  shares: (typeof splitShares.$inferSelect)[],
): HouseholdSplit {
```
- Add `splits, splitShares` to the existing value import from `../schema.ts`
  (which already imports `householdMembers`).
- Add `import type { HouseholdSplit } from "@compass/shared";` — **type-only**.
  (The file already value-imports schemas from `@compass/shared`; keep those.)
- **Delete the `: any` annotation on the inner `.map((s: any) => ...)` at line 35** —
  it now infers from `shares`. Leave the callback body untouched.
- Do NOT change which fields are returned, their order, or any expression.

Verified compatible (do not "fix" these): Drizzle timestamps infer as `Date` and
`z.coerce.date()` outputs `Date`; `sharePaise` is `bigint(..., {mode:"number"})`
so it infers as `number`, matching the schema's `z.number().int()`.

### P3 — `routes/settlements.ts`
```ts
function toSettlement(row: typeof settlements.$inferSelect): Settlement {
```
- Add `settlements` to the existing value import from `../schema.ts`.
- Add `import type { Settlement } from "@compass/shared";` — **type-only**.
- **Preserve the `?? null` normalisations** for `transferTransactionId` and `note`
  exactly as they are. They are required to satisfy the nullable schema fields.
- `amountPaise` is `{mode:"number"}` → `number`; `.int().positive()` in Zod does
  not brand the type. No conflict. Do not add casts.

### P4 — `services/grants.ts`
Change the `filters` parameter type from
`{ resourceType?: string; resourceId?: string }` to
`{ resourceType?: SharingResourceType; resourceId?: string }`, and delete the
`as any` on line 59 so it reads `eq(sharingGrants.resourceType, filters.resourceType)`.
Add `SharingResourceType` to the file's **type-only** import from `@compass/shared`.
The sole caller is `routes/sharing.ts:52` and already passes an enum-validated
value — verify it still typechecks; do not modify it unless it genuinely breaks.

### P5 — unused imports
Remove `gt`, `IncomeSurplusComputation`, and `AcceptInviteSchema` from their
import lines. Before removing each, grep the file to confirm the symbol is truly
unreferenced. If the import line becomes empty, remove the whole line.

## Must Not Change
- Any `package.json`. Any dependency version. `package-lock.json`.
- Any runtime expression, statement, control flow, or returned field set. This
  task is annotation-only plus import removal.
- The `?? null` normalisations in `toSettlement`.
- `apps/api/src/modules/ledger/services/postings.test.ts` — do NOT add annotations,
  delete tests, or skip anything there. Its 18 errors must be fixed purely by P1.
- Any other file, including `routes/sharing.ts` (unless P4 genuinely breaks it).
- Do NOT introduce `eslint-disable`, `@ts-ignore`, or `@ts-expect-error` anywhere.
  If something will not compile without one, STOP and report it as a blocker.
- Do NOT stage, commit, or delete anything. Do NOT touch `screen-shots/`.
- Do NOT attempt to fix the `DATABASE_URL`-gated test failures.

## Acceptance Criteria
- AC1: `npm run typecheck` exits 0 across all 7 workspaces; the 18 `postings.test.ts` errors are gone.
- AC2: `npm run lint` exits 0, 0 errors, 0 warnings.
- AC3: No `\bany\b` remains in the four touched household files; no suppression directives added.
- AC4: `postings.test.ts` executes its `fast-check` property tests and passes.
- AC5: 1312 total tests; failure count drops by exactly `postings.test.ts`; every remaining failure is `DATABASE_URL`-gated.
- AC6: Diff is annotation-only — no runtime expression changed.
- AC7: No `package.json` modified; `package-lock.json` unchanged.

## Commands
1. `npm install`
2. `ls node_modules/fast-check node_modules/pure-rand`
3. `npm ls fast-check`
4. `git status --short` and `git diff --stat` (confirm lockfile state after install)
5. `npm run typecheck`
6. `npm run lint`
7. `npm run test`
8. `grep -nE "\bany\b" ` on the four touched household files
9. `grep -nE "ts-ignore|ts-expect-error|eslint-disable"` on the four touched files

## Required Evidence
- files changed (exact list)
- complete diff (`git diff`)
- every command run, with its literal output and exit code
- for `npm run test`: per-workspace pass/fail totals, the literal aggregate split,
  explicit confirmation that `postings.test.ts` passed, and an enumeration of
  every remaining failing file with why it is DB-gated
- explicit statement of whether `package-lock.json` changed
- any plan deviations or blockers, stated rather than worked around

Write full details to `tasks/057-green-baseline/implementation-1.md` and return a
digest of at most 20 lines plus that path.
