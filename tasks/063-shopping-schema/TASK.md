# Task 9.1 — Shopping schema + shared contracts

Board task: [`tasks/09.01-shopping-schema.md`](../09.01-shopping-schema.md) · release 2.3.0 · depends 1.9, 4.3 (both `done`)

**Outcome: delivered with one acceptance criterion deliberately unmet (AC3).** Everything else is
implemented, tested and externally reviewed twice. AC3 is blocked on a missing prerequisite, not on
effort — see "AC3" below. Status left `in-progress` rather than `done` so the board does not claim
something untrue.

## What shipped

New `shopping` module — the first domain built natively on the Phase-1 module pattern rather than
migrated onto it, and the first module registered with a Fastify `prefix`.

- **8 tables, 5 enums** in `apps/api/src/modules/shopping/schema.ts`: `catalog_items`,
  `price_sources`, `shopping_lists`, `shopping_list_items`, `price_observations`, `pantry_items`,
  `cart_drafts`, `habit_profiles`.
- **Shared contracts** in `packages/shared/src/schemas/shopping.ts`, consumed by the API route and by
  `apps/web/src/lib/shopping-queries.ts`.
- **`GET /api/shopping/units`** publishes the normalized-unit vocabulary — one route, registered via
  `app.register(shoppingRoutes, { prefix: "/api/shopping" })`.
- **Migration** `apps/api/drizzle/0005_late_centennial.sql`.

## Design decisions

**Every table is user-scoped or parent-linked.** `backup.test.ts` asserts `exportGaps()` is `[]`, so a
global reference table (a curated catalog, a shared platform list) would fail the suite outright — and
CLAUDE.md rules out an admin data path anyway. `catalog_items` and `price_sources` therefore carry
`user_id`; `shopping_list_items` scopes through `list_id` (`LINKED_TABLES`), and never both.

**Quantities are integers in one base unit per kind** — g / ml / piece — mirroring the integer-paise
rule so unit-price comparison across pack sizes ("1kg pack vs 2x500g") is exact integer arithmetic.
The pairing of quantity and unit is enforced twice: a Postgres CHECK per table
(`*_quantity_unit_paired`) and a Zod `.refine()` on the matching contract.

**Non-negativity is enforced at the database, not just in Zod.** 15 CHECK constraints cover every
`*_paise` column, every quantity, `position` and `observation_count`.

## AC3 — pantry/habit through `withSharing()`: not done, deliberately

The AC asks for pantry and habit rows to resolve through `withSharing()` (`lib/sharing.ts`) rather
than raw `user_id`. They do not. The reason only became visible during implementation:

**`withSharing()` is dead code.** It has zero importers and zero tests. Every mention of it in the
repo is a comment explaining that it is deliberately unused — see
`modules/credit/services/revolving-debt.ts:88-104`, `modules/planning/services/income-surplus.ts:121`,
`modules/planning/services/data-completeness.ts:164`, `modules/credit/routes/revolving-debt.ts:10`:

> `withSharing` (lib/sharing.ts) is deliberately NOT used because it currently has zero production
> call sites anywhere in the codebase. Making this function sharing-aware would be inconsistent with
> every other user-facing query. […] tracked for a future sharing-rollout task (task 061).

Two consequences. First, **the referenced follow-up does not exist** — `tasks/061-*` is
`061-migration-from-scratch`; the sharing rollout was deferred to a number that was then used for
something else, so four modules point at a tracked owner that isn't there.

Second, **implementing AC3 literally would have changed no behaviour.** `POST /api/sharing-grants`
accepts only the 5 contract resource types, so no pantry or habit grant can ever be created. A
`withSharing()` read would return exactly the owner's rows — identical to `eq(userId)` — while adding
an unexercisable SQL branch, an enum cast, and the first production use of a guard that has never run
against a database. An earlier iteration of this task did extend the Postgres enum with
`pantry_item`/`habit_profile`; that was reverted, which also removed an `ALTER TYPE … ADD VALUE` from
the migration.

So `services/pantry.ts` scopes owner-only, consistent with all 9 existing domains, with the switch
point documented as a single `SHARING SEAM` and pinned by a test asserting the generated SQL does not
reference `sharing_grants` — so flipping it is a deliberate act that breaks a test.

**Consequence for users, stated plainly: a household member cannot see another member's pantry.**

## Follow-ups this task surfaced (none actioned here)

1. **`POST /api/sharing-grants` does not verify resource ownership.** `routes/sharing.ts:32` checks
   only that caller and grantee are household members; `services/grants.ts:19` inserts whatever
   `resourceId` was supplied with `ownerUserId: <caller>`. A user can create their own household and
   grant themselves another user's resource. `lib/sharing.ts` compounds it by never referencing
   `owner_user_id` at all. Exploitation needs the victim's row UUID (v4, unguessable), so this is
   horizontal escalation gated on a leaked identifier — but it blocks any safe sharing rollout. The
   handler already carries a comment admitting the gap is "deferred to a future phase".
2. **Cross-owner foreign keys are unenforced.** All 8 FKs in this module are enumerated in the
   schema header. Unreachable today (9.1 adds no write paths), but a per-user backup exports children
   by `user_id` and would omit a cross-owner parent, so the parent-first restore would fail its FK
   insert. Task 9.2 must route every client-supplied FK through `lib/ownership.ts`, whose own header
   states the principle: *"A foreign key proves a row exists, not that the caller owns it."*
3. **Task-board index was stale.** All 15 rows for 5.1–7.4 read `todo` while every task file said
   `done` — release 2.2.0 was complete but unrecorded. Corrected.
4. **`db/schema.ts`'s inventory comment was wrong before this task.** Measured and corrected to 66
   tables (65 + `users`) and 47 enums; the per-source figures (15 shared, 50 resident) never summed.
5. **Zod `.safe()` vs unbounded Postgres `bigint`** — flagged by Codex, dismissed as repo-wide
   convention rather than a shopping-local issue. `paiseField()` in `credit.ts` is
   `z.number().int().safe()` and every money column across the schema is `bigint(mode: "number")`.
   Worth a repo-wide decision; the threshold is ~₹90 trillion.

## Review trail

Two Codex passes. Round 1 found 6 items: `habit_profiles` had no `unit` column; a header comment
claimed a quantity/unit pairing nothing enforced; negative prices and totals parsed cleanly; the web
test never imported the hook it named; the route test could not catch the route being marked public;
the barrel's inventory comment was wrong. All fixed.

Round 2 found 5. Three were real test defects, fixed: the "every quantity-bearing table has a unit
column" test used `/_quantity_base$/`, which does not match the bare column `quantity_base`, so two
tables were silently skipped and deleting their `unit` would still have passed; the web test treated
any non-`ApiError` as a validation error; the `.extend` probe only checked the property existed. One
was a real omission — the cross-owner FK warning listed 5 of 8 FKs, missing `list_id`, the one that
would let a write path put a line into another user's list. Two were dismissed with reasons (AC3, and
the `.safe()` bound above).

**Lesson worth keeping: a comment asserting an invariant is not an invariant.** Two separate rounds
found claims in prose — "nullable together", the FK enumeration — that nothing enforced and nothing
tested. Both are now backed by a constraint and a test that fails when violated.

## Verification

Run and read directly, not relayed. Node **22.19.0** locally (`engines.node` is `>=24`; only CI runs
24, and only CI has Postgres/Redis, so the full `apps/api` suite and the migration are CI-gated).

| Check | Result |
|---|---|
| `npm run typecheck` | exit 0, zero `error TS` |
| `npm run lint` | exit 0 |
| `apps/api/src/modules/shopping/**/*.test.ts` | 28/28 |
| `packages/shared` | 230/230 |
| `apps/web` | 301/301 |
| `app.route-snapshot.test.ts` | 7/7 |
| `schema.decomposition.test.ts` | 3/3 (65 tables + 47 enums) |
| backup coverage + new FK ordering | 5/5 named tests pass |

`backup.test.ts` retains one pre-existing failure — its DB-backed group needs `DATABASE_URL`,
confirmed by its own literal error text.

Both snapshots were regenerated by script, never hand-edited; the surface diff is exactly
`GET /api/shopping/units` plus the `HEAD` Fastify auto-registers.

Two "does the test bite" drills were run, each with matching before/after `sha256sum`: removing
`CatalogItemSchema`'s `.refine()` failed the pairing test, and commenting out `pantry_items.unit`
failed the corrected unit-coverage test with `pantry_items has a quantity column but is missing a
paired unit column`.
