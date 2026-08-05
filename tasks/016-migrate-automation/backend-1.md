All verification commands pass. Here is the complete report.

## Summary

Implemented **ITERATION 1 (P2–P7)** of task `016-migrate-automation`, a pure relocation + module wiring of the automation/AI domain with no runtime behavior change.

### Files CREATED (11 new files)

**`apps/api/src/modules/automation/`**
- `schema.ts` — thin named re-export of `aiSettings`, `aiEvents`, `aiProvider`, `aiEventKind`, `aiEventStatus` from `../../db/schema.ts`
- `schema.smoke.test.ts` — 2 `test()` cases, object-identity via `assert.strictEqual` (2 tables, 3 enums)
- `plugin.ts` — `automationRoutes(app)` registering `aiRoutes` + `aiEventRoutes`, with header comment noting this is the sixth of 8 Phase-1 migrations (task 1.6) and that wrapping two already-adjacent/in-order registrations does NOT change `printRoutes()`
- `services/assistant.ts`, `services/categorize.ts`, `services/events.ts`, `services/summary.ts`, `services/tools.ts`, `services/ai-settings.ts`, `services/ai-settings.test.ts` (moved)
- `routes/ai.ts`, `routes/ai-events.ts` (moved)

### Files MOVED (old → new, old path deleted)
| Old path | New path | Import rewrite applied |
|---|---|---|
| `services/ai/assistant.ts` | `modules/automation/services/assistant.ts` | none (`./tools.ts` same-folder) |
| `services/ai/categorize.ts` | `.../categorize.ts` | `../../db/index.ts` → `../../../db/index.ts` |
| `services/ai/events.ts` | `.../events.ts` | `../../db/index.ts`→`../../../db/index.ts`; `aiEvents` from `../schema.ts`; `../../lib/errors.ts`→`../../../lib/errors.ts` |
| `services/ai/summary.ts` | `.../summary.ts` | `../../db/index.ts`→`../../../db/index.ts`; planning imports → `../../planning/...` |
| `services/ai/tools.ts` | `.../tools.ts` | db + planning/ledger module imports → `../../../db` / `../../<mod>`, `../periods.ts`→`../../../services/periods.ts` |
| `services/ai-settings.ts` | `.../services/ai-settings.ts` | `../db/index.ts`→`../../../db/index.ts`; `aiSettings` from `../schema.ts`; lib imports → `../../../lib/...` |
| `services/ai-settings.test.ts` | `.../services/ai-settings.test.ts` | `./ai-settings.ts` unchanged |
| `routes/ai.ts` | `modules/automation/routes/ai.ts` | lib→`../../../lib/errors.ts`; `../services/ai/*`→`../services/*`; `mailboxes`→`../../../services/mailboxes.ts` |
| `routes/ai-events.ts` | `modules/automation/routes/ai-events.ts` | `../services/ai/events.ts`→`../services/events.ts` |

Verified every moved production file is **byte-identical to its original except import specifiers** (via `diff --ignore-matching-lines="^import "` against `git show HEAD:`), including the `observe` arrow in `routes/ai.ts` (confirmed byte-identical).

### Files DELETED (moved-from paths, all gone)
`src/services/ai/` directory was emptied and **removed** (`rmdir`). Deleted: `routes/ai.ts`, `routes/ai-events.ts`, `services/ai-settings.ts`, `services/ai-settings.test.ts`, and all 5 files in `services/ai/`.

### Files EDITED (5)
- `apps/api/src/app.ts` — collapsed the 2 AI imports → single `automationRoutes` import; collapsed 2 registrations → single `await app.register(automationRoutes)` in same position; fixed line-157 comment to new path; added task-1.6 paragraph to `registerRoutes` migration-history comment block.
- `apps/api/src/routes/auth.ts` (line 20) — repointed `getAiSettings`/`getUserAiProvider` import to `../modules/automation/services/ai-settings.ts`; `/api/capabilities` handler untouched.
- `apps/api/src/modules/planning/services/goals.ts:19` — doc path `services/ai/tools.ts` → `modules/automation/services/tools.ts`
- `apps/api/src/modules/planning/services/reports.ts:27` — doc path updated (both `tools.ts` and `summary.ts`)
- `apps/extractor/src/extract.ts:61` — doc path `apps/api/src/services/ai/tools.ts` → `apps/api/src/modules/automation/services/tools.ts`

### NOT changed (per rules)
`db/schema.ts`, `services/backup.ts`, `packages/ai/**`, `packages/shared/**`, no snapshot `.txt` regenerated, no `void` added anywhere. No `plugin.test.ts`/route test (iteration 2). Handler bodies/URLs/methods/Zod schemas/SQL/cache keys/provider resolution/observer semantics all untouched.

### Command results (all exit code 0)
1. **`cd apps/api && npx tsc --noEmit`** → `EXIT CODE: 0`
2. **`npm run lint`** → `EXIT CODE: 0`
3. **`node --test apps/api/src/modules/automation/schema.smoke.test.ts`** → `tests 2 / pass 2 / fail 0`, `EXIT CODE: 0`
4. **`npm run db:generate`** → `No schema changes, nothing to migrate 😴`, `EXIT CODE: 0` (zero diff)

### git status / git diff --stat
Full `git status` and `git diff --stat` shown above. Note two out-of-scope, **pre-existing** working-tree items that I did not create or touch: `tasks/014-migrate-planning/TASK.md` (modified before my session; documents the prior task's shipping) and untracked `tasks/013-release-v1.97.0/commit-pr-final.md`, `tasks/015-statusline/`, `tasks/016-migrate-automation/`. My untracked contribution is solely `apps/api/src/modules/automation/`.

**No blockers or deviations from the brief.**
