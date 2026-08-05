# Investigation 1 — Automation/AI module migration

Date: 2026-08-05  
Scope: 7 files being moved into `apps/api/src/modules/automation/`

---

## 1. External importers of each of the 7 moved files

All results from `rg`; only real `import` statements, not comments.

| Importer file:line | Import specifier | Notes |
|---|---|---|
| `apps/api/src/app.ts:28` | `"./routes/ai.ts"` | registers `aiRoutes` |
| `apps/api/src/app.ts:29` | `"./routes/ai-events.ts"` | registers `aiEventRoutes` |
| `apps/api/src/routes/ai.ts:15` | `"../services/ai/categorize.ts"` | in-scope route importing service |
| `apps/api/src/routes/ai.ts:16` | `"../services/ai/summary.ts"` | in-scope route importing service |
| `apps/api/src/routes/ai.ts:17` | `"../services/ai/assistant.ts"` | in-scope route importing service |
| `apps/api/src/routes/ai.ts:18` | `"../services/ai/events.ts"` | in-scope route importing service |
| `apps/api/src/routes/ai-events.ts:9` | `"../services/ai/events.ts"` | in-scope route importing service |
| `apps/api/src/services/ai/assistant.ts:4` | `"./tools.ts"` | intra-module (services/ai → services/ai) |

**Zero importers in apps/extractor, apps/ingestor, packages/*, apps/web** for any of the 7 files.
The references in `apps/extractor/src/extract.ts:61`, `modules/planning/services/goals.ts:19`, and
`modules/planning/services/reports.ts:27` are **comments only**, not import statements.

After moving, only `app.ts` lines 28–29 and 130–131 need repointing.

---

## 2. Relative imports inside each moved file — classification and depth change

### `routes/ai.ts` → `modules/automation/routes/ai.ts`

| file:line | current specifier | target | class | new specifier (after move) |
|---|---|---|---|---|
| routes/ai.ts:14 | `"../lib/errors.ts"` | `src/lib/errors.ts` | (e) lib | `"../../../lib/errors.ts"` |
| routes/ai.ts:15 | `"../services/ai/categorize.ts"` | categorize.ts (being moved) | (a) intra | `"../services/categorize.ts"` |
| routes/ai.ts:16 | `"../services/ai/summary.ts"` | summary.ts (being moved) | (a) intra | `"../services/summary.ts"` |
| routes/ai.ts:17 | `"../services/ai/assistant.ts"` | assistant.ts (being moved) | (a) intra | `"../services/assistant.ts"` |
| routes/ai.ts:18 | `"../services/ai/events.ts"` | events.ts (being moved) | (a) intra | `"../services/events.ts"` |
| routes/ai.ts:19 | `"../services/ai-settings.ts"` | `src/services/ai-settings.ts` | (b) flat service | `"../../../services/ai-settings.ts"` (or module-local if moved) |
| routes/ai.ts:20 | `"../services/mailboxes.ts"` | `src/services/mailboxes.ts` | (b) flat service | `"../../../services/mailboxes.ts"` |

### `routes/ai-events.ts` → `modules/automation/routes/ai-events.ts`

| file:line | current specifier | target | class | new specifier |
|---|---|---|---|---|
| routes/ai-events.ts:9 | `"../services/ai/events.ts"` | events.ts (being moved) | (a) intra | `"../services/events.ts"` |

### `services/ai/assistant.ts` → `modules/automation/services/assistant.ts`

| file:line | current specifier | target | class | new specifier |
|---|---|---|---|---|
| services/ai/assistant.ts:4 | `"./tools.ts"` | tools.ts (being moved) | (a) intra | `"./tools.ts"` — **unchanged** |

### `services/ai/categorize.ts` → `modules/automation/services/categorize.ts`

| file:line | current specifier | target | class | new specifier |
|---|---|---|---|---|
| services/ai/categorize.ts:4 | `"../../db/index.ts"` | `src/db/index.ts` | (d) db | `"../../db/index.ts"` — **unchanged** |

Note: depth from `services/ai/` to `src/` is 2 (`../../`). Depth from `modules/automation/services/` to `src/` is also 2 (`../../` goes to `modules/`, then `../../` is `src/`). Wait — let me be precise:
- `src/services/ai/categorize.ts` → `../../` → `src/`
- `src/modules/automation/services/categorize.ts` → `../../` → `src/modules/` (NOT `src/`!)
- Correct new path: `"../../../db/index.ts"`

**All specifiers starting with `../../` in the current `services/ai/` files need to become `../../../` after moving to `modules/automation/services/`.**

Revised table for all 5 service files:

| file:line | current specifier | target | class | depth change |
|---|---|---|---|---|
| services/ai/assistant.ts:4 | `"./tools.ts"` | tools.ts | (a) intra | none — same dir |
| services/ai/categorize.ts:4 | `"../../db/index.ts"` | `src/db/index.ts` | (d) db | `../../` → `../../../` |
| services/ai/events.ts:9 | `"../../db/index.ts"` | `src/db/index.ts` | (d) db | `../../` → `../../../` |
| services/ai/events.ts:10 | `"../../db/schema.ts"` | `src/db/schema.ts` | (d) db | `../../` → `../../../` |
| services/ai/events.ts:11 | `"../../lib/errors.ts"` | `src/lib/errors.ts` | (e) lib | `../../` → `../../../` |
| services/ai/summary.ts:4 | `"../../db/index.ts"` | `src/db/index.ts` | (d) db | `../../` → `../../../` |
| services/ai/summary.ts:5 | `"../../modules/planning/services/reports.ts"` | planning module | (c) migrated module | `../../modules/` → `../../../modules/` → but becomes `"../../planning/services/reports.ts"` from inside `modules/automation/` |
| services/ai/summary.ts:6 | `"../../modules/planning/services/insights.ts"` | planning module | (c) migrated module | same as above → `"../../planning/services/insights.ts"` |
| services/ai/tools.ts:5 | `"../../db/index.ts"` | `src/db/index.ts` | (d) db | `../../` → `../../../` |
| services/ai/tools.ts:6 | `"../../modules/planning/services/reports.ts"` | planning module | (c) migrated module | `"../../planning/services/reports.ts"` |
| services/ai/tools.ts:7 | `"../../modules/planning/services/budgets.ts"` | planning module | (c) migrated module | `"../../planning/services/budgets.ts"` |
| services/ai/tools.ts:8 | `"../../modules/planning/services/insights.ts"` | planning module | (c) migrated module | `"../../planning/services/insights.ts"` |
| services/ai/tools.ts:9 | `"../../modules/ledger/services/search.ts"` | ledger module | (c) migrated module | `"../../ledger/services/search.ts"` |
| services/ai/tools.ts:10 | `"../../modules/planning/services/goals.ts"` | planning module | (c) migrated module | `"../../planning/services/goals.ts"` |
| services/ai/tools.ts:11 | `"../periods.ts"` | `src/services/periods.ts` | (b) flat service | `"../../../services/periods.ts"` |

**Path adjustment rule summary:**
- `../../db/X` → `../../../db/X`
- `../../lib/X` → `../../../lib/X`
- `../../modules/planning/services/X` → `../../planning/services/X` (sibling module, only 2 levels from `modules/automation/services/`)
- `../../modules/ledger/services/X` → `../../ledger/services/X`
- `../periods.ts` → `../../../services/periods.ts`
- `"./tools.ts"` — unchanged (assistant.ts and tools.ts land in same directory)
- Routes: `../lib/X` → `../../../lib/X`; `../services/X` → `../../../services/X` for flat services

---

## 3. `services/ai-settings.ts` — importers and symbols used

Whole-monorepo search (`grep -rn getAiSettings|getUserAiProvider|upsertAiSettings|assertAllowedBaseUrl`):

| Importer file:line | Import specifier | Symbols used |
|---|---|---|
| `apps/api/src/routes/ai.ts:19` | `"../services/ai-settings.ts"` | `getAiSettings`, `getUserAiProvider`, `upsertAiSettings` |
| `apps/api/src/routes/auth.ts:20` | `"../services/ai-settings.ts"` | `getAiSettings`, `getUserAiProvider` |
| `apps/api/src/services/ai-settings.test.ts:3` | `"./ai-settings.ts"` | `assertAllowedBaseUrl` |

**apps/extractor**: does NOT import `ai-settings.ts`. It has its own `loadAiSettings` in
`apps/extractor/src/db.ts:50` that reads the `ai_settings` table directly via raw SQL
(`pg.Pool` query). Confirmed by searching extractor/ingestor src — zero matches.

**apps/ingestor, packages/*, apps/web**: no imports of `ai-settings.ts` at all.

Key finding: `routes/auth.ts` (a flat route not being migrated in this task) imports
`getAiSettings` and `getUserAiProvider` from `ai-settings.ts`. This is the only cross-
domain dependency outside the automation files. If `ai-settings.ts` moves into the
module, `auth.ts` import must be repointed (`"../../../services/ai-settings.ts"` →
`"../modules/automation/services/ai-settings.ts"` or a module re-export).

---

## 4. `services/mailboxes.ts` — confirm it stays flat

File lives at: `apps/api/src/services/mailboxes.ts`

Importers found by `grep -rn "from.*services/mailboxes"`:

| Importer file:line | Import specifier | Symbol | Notes |
|---|---|---|---|
| `apps/api/src/routes/mailboxes.ts:17` | `"../services/mailboxes.ts"` | `listMailboxes`, `mailboxSecret` etc. | flat mailbox route |
| `apps/api/src/routes/auth.ts:21` | `"../services/mailboxes.ts"` | `mailboxSecret` | flat auth route |
| `apps/api/src/routes/ai.ts:20` | `"../services/mailboxes.ts"` | `mailboxSecret` | in-scope automation route |
| `apps/api/src/modules/credit/routes/cards.ts:34` | `"../../../services/mailboxes.ts"` | `mailboxSecret` | already-migrated credit module |

Used by the credit module AND flat auth routes — clearly out of scope for this migration.
`mailboxes.ts` must stay flat. After automation migration, `routes/ai.ts` (→ `modules/automation/routes/ai.ts`) will import it via `"../../../services/mailboxes.ts"`.

---

## 5. Colocated tests

**Under `apps/api/src/services/ai/`**: NO `*.test.ts` files exist.

**`apps/api/src/services/ai-settings.test.ts`**: EXISTS at `apps/api/src/services/ai-settings.test.ts`.
Tests only `assertAllowedBaseUrl` (2 `test()` blocks). If `ai-settings.ts` moves into the module,
this file must move with it and its import specifier updated from `"./ai-settings.ts"` to match.

**Under `apps/api/src/routes/ai*.test.ts`**: NO `*.test.ts` files (`routes/ai.test.ts` and
`routes/ai-events.test.ts` do not exist).

---

## 6. Dynamic imports and string-based path references

| File:line | Type | Content |
|---|---|---|
| `apps/extractor/src/extract.ts:61` | comment | `// convention in apps/api/src/services/ai/tools.ts` — **not an import** |
| `apps/api/src/modules/planning/services/goals.ts:19` | comment | `* - \`services/ai/tools.ts\`` — **not an import** |
| `apps/api/src/modules/planning/services/reports.ts:27` | comment | `* called directly from \`services/ai/tools.ts\`` — **not an import** |
| `apps/api/src/app.ts:157` | comment | `// there is no global provider. See services/ai-settings.ts.` — **not an import** |
| `apps/web/src/lib/ai-queries.ts:15,33` | query keys | `["ai-settings"]` — React Query cache key strings, not file paths |

No dynamic `import(...)` calls referencing these files anywhere. No string-based requires.
After migration, the comments in `goals.ts` and `reports.ts` should be updated to reflect
the new path, but they have no functional impact.

---

## Scope implications

**Clearly in-scope to move (all 7 files):**
- `routes/ai.ts`, `routes/ai-events.ts` — imported only by `app.ts`; no external non-automation consumers.
- `services/ai/assistant.ts`, `services/ai/categorize.ts`, `services/ai/events.ts`, `services/ai/summary.ts`, `services/ai/tools.ts` — imported only by `routes/ai.ts` and `routes/ai-events.ts` (both also being moved); zero external consumers.

**`services/ai-settings.ts` — movable but requires 1 extra repoint:**
- Only 3 consumers: `routes/ai.ts` (moving), `routes/auth.ts` (flat, NOT moving), `ai-settings.test.ts` (colocated, would move with the file).
- Decision: move it into the module (`modules/automation/services/ai-settings.ts`) and repoint `auth.ts:20` from `"../services/ai-settings.ts"` to `"../modules/automation/services/ai-settings.ts"`. No extractor/ingestor risk.
- The colocated `services/ai-settings.test.ts` must move to `modules/automation/services/ai-settings.test.ts` and update its import specifier from `"./ai-settings.ts"` to `"./ai-settings.ts"` (same-dir, unchanged).

**Must stay flat:**
- `services/mailboxes.ts` — used by `modules/credit` (already migrated), `routes/auth.ts`, `routes/mailboxes.ts`; clearly cross-domain.
- `services/periods.ts` — used by `tools.ts` (moving) but is a generic date/period utility; other flat services likely use it too (not fully audited here, but it is out of scope per task 1.7 pattern).
