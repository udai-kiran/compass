## Blocking findings

1. **The actual working tree is not schema-clean relative to `HEAD`.** Although this appears to be concurrent work from another sub-phase, the current tree cannot satisfy a literal SP3-only “no schema change” assertion:

   - `apps/api/src/db/schema.ts:1` is substantially rewritten.
   - `apps/api/src/modules/automation/schema.ts:1`
   - `apps/api/src/modules/credit/schema.ts:1`
   - `apps/api/src/modules/ingest/schema.ts:1`
   - `apps/api/src/modules/investments/schema.ts:1`
   - `apps/api/src/modules/ledger/schema.ts:1`
   - `apps/api/src/modules/planning/schema.ts:1`
   - `apps/api/src/modules/protection/schema.ts:1`
   - `apps/api/src/modules/system/schema.ts:1`
   - New `apps/api/src/db/schema.decomposition.test.ts`
   - New files under `apps/api/src/db/shared/`

   There are also unrelated logic changes in importer files, notably `apps/api/src/modules/ledger/services/accounts.ts:152`, which adds `AccountBalanceAtDate` and `accountBalancesAtDate()` with new SQL. These are not changes to a moved file, but mean the overall worktree does not meet T6’s “only SP3 moves/import-path edits” state.

   **Migration content is clean:** `git diff --quiet -- apps/api/drizzle` exited 0. No Drizzle migration or metadata file differs from `HEAD`.

   **Route definitions are unchanged:** the route files touched by SP3 only change import paths:

   - `apps/api/src/modules/credit/routes/emis.ts:7`
   - `apps/api/src/modules/investments/routes/sips.ts:27`
   - `apps/api/src/modules/planning/routes/budgets.ts:23`
   - `apps/api/src/modules/planning/routes/insights.ts:6`
   - `apps/api/src/modules/system/routes/auth.ts:18`

   The canonical route-surface and raw route-tree snapshot tests both passed.

## Moved-file mechanical comparison

Each destination was compared directly with its old path from `HEAD`.

| Moved file | Result |
|---|---|
| `services/cache.ts` → `lib/cache.ts` | Byte-identical. No internal import change required. |
| `services/balances.ts` → `modules/ledger/services/balances.ts` | Only `../db/index.ts` → `../../../db/index.ts` at line 2. |
| `services/ownership.ts` → `lib/ownership.ts` | Only `../lib/errors.ts` → `./errors.ts` at line 4. |
| `services/periods.ts` → `lib/periods.ts` | Byte-identical. |
| `services/periods.test.ts` → `lib/periods.test.ts` | Byte-identical. |
| `services/autopilot.ts` → `modules/automation/services/autopilot.ts` | Only the planned relative-import specifiers changed at lines 4–10. |
| `services/autopilot.test.ts` → `modules/automation/services/autopilot.test.ts` | Byte-identical. |
| `services/anomaly.ts` → `modules/automation/services/anomaly.ts` | Only the planned relative-import specifiers changed at lines 4–8. |
| `services/anomaly.test.ts` → `modules/automation/services/anomaly.test.ts` | Byte-identical. |
| `repositories/users.ts` → `modules/system/services/users.ts` | Only the two database import specifiers changed at lines 2–3. |

No moved file contains a logic, SQL, signature, export, formatting, or other non-import change.

## Internal relative imports

All moved-file internal relative specifiers are correct for their destinations:

- `apps/api/src/lib/ownership.ts:2-4` retains `../db/index.ts` and `../db/schema.ts`, and correctly uses sibling `./errors.ts`.
- `apps/api/src/lib/periods.ts:8` retains `../db/index.ts`.
- `apps/api/src/lib/periods.test.ts:3-4` correctly retains `./periods.ts` and `../modules/ledger/services/recurring.ts`.
- `apps/api/src/modules/ledger/services/balances.ts:2` correctly uses `../../../db/index.ts`.
- `apps/api/src/modules/automation/services/autopilot.ts:4-10` correctly uses `../../../db/...`, `../../planning/...`, and `../../system/...`.
- `apps/api/src/modules/automation/services/anomaly.ts:4-8` correctly uses `../../../db/...`, `../../system/...`, and `../../../lib/periods.ts`.
- Both automation tests retain correct sibling imports at line 3.
- `apps/api/src/modules/system/services/users.ts:2-3` correctly uses `../../../db/...`.

## Importer completeness

No executable import under `apps/**` or `packages/**` survives for any of these old destinations:

- `services/cache.ts`
- `services/balances.ts`
- `services/ownership.ts`
- `services/periods.ts`
- `services/periods.test.ts`
- `services/autopilot.ts`
- `services/anomaly.ts`
- `repositories/users.ts`

The planned importer diffs are present, including the easy-to-miss `apps/api/src/db/bootstrap.ts:15` users import.

`apps/api/src/modules/system/services/auth.ts:7` is correct:

```ts
import { findUserByEmail, findUserById, type UserRow } from "./users.ts";
```

There is one consolidated import, with no duplicate or dangling old repository import.

## Folder removal

Both old flat folders are absent from the filesystem:

- `apps/api/src/services/`
- `apps/api/src/repositories/`

## Cycle safety

No new cycle returning to either moved automation implementation was found.

Production inbound imports are exactly:

- `apps/api/src/jobs/index.ts:8` → `anomaly.ts`
- `apps/api/src/jobs/index.ts:9` → `autopilot.ts`

No module production file imports either implementation. Their colocated tests naturally import their corresponding sibling:

- `apps/api/src/modules/automation/services/anomaly.test.ts:3`
- `apps/api/src/modules/automation/services/autopilot.test.ts:3`

Typecheck and the complete runtime suite loaded successfully, with no ESM cycle or TDZ failure.

## Non-blocking cleanliness findings

Two live source comments still describe old flat paths:

- `apps/api/src/modules/planning/services/goals.ts:16` references `services/autopilot.ts`; it should reference `modules/automation/services/autopilot.ts` or describe the automation service without a stale path.
- `apps/api/src/modules/investments/services/sip-lifecycle.ts:89` references `services/balances.ts`; it should reference `modules/ledger/services/balances.ts`.

There are also numerous historical/task/review references. Most are archival evidence rather than active code, but these current-facing documentation references are stale:

- `docs/PRD-wow-features.md:178` — `services/anomaly.ts`
- `tasks/README.md:77` — `services/autopilot.ts`
- `tasks/README.md:256` — `services/cache.ts`
- `tasks/01.09-cross-module-ports.md:14` describes the pre-move layout.
- `reviews/roadmap-feature-review-1.md:263` and `:534` reference old anomaly/cache locations.

Older investigation, delegation, verification, and commit-log files contain many additional old paths as historical records; changing those is optional and potentially undesirable if they are intended to preserve contemporaneous evidence.

## Verification results

- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm run test -w apps/api`: passed.
  - Tests: 886
  - Passed: 885
  - Failed: 0
  - Skipped: 1
  - Cancelled/todo: 0
- Moved tests ran and passed:
  - `lib/periods.test.ts`
  - `modules/automation/services/autopilot.test.ts`
  - `modules/automation/services/anomaly.test.ts`
- Canonical route-surface snapshot: passed.
- Raw `printRoutes()` tree snapshot: passed.
- Migration diff: none.

**Verdict:** the SP3 move and importer updates themselves are mechanically correct. Approval is blocked only if the review requires the entire current worktree to be SP3-only or schema-clean relative to `HEAD`; the tree contains substantial concurrent schema and unrelated logic changes that must be separated or explicitly attributed before that claim can be made.