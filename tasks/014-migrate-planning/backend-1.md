Here is the complete summary of Slice 0 implementation.

---

## Files changed

| Action | File |
|--------|------|
| **Modified** | `apps/api/src/db/schema.ts` |
| **Modified** | `apps/api/src/modules/planning/schema.ts` |
| **Modified** | `apps/api/src/modules/ledger/schema.ts` |
| **Created** | `apps/api/src/modules/planning/schema.smoke.test.ts` |

**Not touched**: `db/schema.smoke.test.ts`, `app.ts`, any route/service file, `backup.ts`, `projection-settings.ts`, `plugin.ts`, snapshot files, `CLAUDE.md`, `tasks/*.md`.

## What changed

1. **`db/schema.ts`** — deleted `export * from "../modules/planning/schema.ts"` (the old line 22); updated the doc comment (lines 32-35) to remove the `projectionSettings`-in-planning-module reference and state the new convention; inserted the `projectionSettings` `pgTable()` definition (doc comment + 4 columns) character-for-character identical after `subscriptionDismissals`' closing `);` at line 747. No new imports added. `pgTable` count rose from 49 to 50 (+1); `pgEnum` count unchanged at 38.

2. **`modules/planning/schema.ts`** — rewritten from a physical `pgTable()` definition to a thin named re-export of all 6 tables + 2 enums from `../../db/schema.ts`, with a doc comment explaining planning is now uniform with the other four modules, the FK constraints (`goals.id` inbound from `accounts`/`holdings`/`sips`; `budget_lines`/`budget_alerts` outbound to `categories`), and that `db/schema.ts` does not `export *` back. Zero `pgTable()` / `pgEnum()` calls.

3. **`modules/ledger/schema.ts`** — removed the `projection_settings` exception from both doc comment blocks (lines 9-12 and 21-25). All five modules are now treated uniformly.

4. **`modules/planning/schema.smoke.test.ts`** — created with exactly 3 `test()` cases: (1) 6 tables resolve with correct SQL table names + object identity; (2) 2 enums (`budgetPeriod`, `goalType`) with object identity; (3) constructed-Drizzle runtime assertion (`db.query.<name>` exists for all 6) using a non-connecting stub `pg.Pool`.

## Verification results

| Check | Exit code | Result |
|-------|-----------|--------|
| `npm run typecheck` | 0 | ✅ |
| `npm run lint` | 0 | ✅ |
| `db/schema.smoke.test.ts` **unmodified** | 0 | ✅ 2/2 pass |
| `modules/planning/schema.smoke.test.ts` | 0 | ✅ 3/3 pass |
| `backup.test.ts` | 0 | ✅ 13/13 pass |
| `npm run test -w apps/api` | 0 | ✅ **845** pass (842 + 3), 0 fail |
| `npm run db:generate` | 0 | ✅ **No schema changes, nothing to migrate** |
| `route-surface.snapshot.txt` sha256 | `a368d4eb…4122` | ✅ Unchanged |
| `route-table.snapshot.txt` sha256 | `7800feb9…55c8` | ✅ Unchanged |
| Drizzle manifest sha256 | idempotent | ✅ Unchanged |
| T17 (pre: 223 files, 685 specifiers, 0 unresolvable) | 0 | ✅ |
| T17 (post: 224 files, 688 specifiers, 0 unresolvable) | 0 | ✅ |
| T18 extract-diff (old vs new block) | 0 | ✅ **Identical** |
| `pgTable` count in `modules/planning/schema.ts` | 0 | ✅ Zero actual calls |
| AC3: only local schema import is `./core-schema.ts` | — | ✅ |

**Deviations**: None. All changes match the specification exactly.
