# Task 030 — Implementation Evidence

## Branch
`fix/030-misc-bug-fixes` from `origin/main`

## Files Inspected
- `tasks/030-misc-bug-fixes/TASK.md`
- `tasks/030-misc-bug-fixes/DELEGATION.md`
- `apps/api/src/modules/ingest/services/imports.ts`
- `apps/api/src/modules/ingest/services/review-actions.ts`

## Files Changed
- `apps/api/src/modules/ingest/services/imports.ts` (Change A, B, C)
- `apps/api/src/modules/ingest/services/review-actions.ts` (Transfer-leg rule comment)

---

## BLOCKING ISSUE: Brief contradicts itself on `or` import

The brief states two incompatible requirements:

1. "KEEP `or` — it is used elsewhere in the file." (DELEGATION.md P2a / TASK.md scope note)
2. AC2: `npm run lint` exits 0

After removing the `survivingPartners` block (Change B), `or` is **no longer used anywhere** in `imports.ts`. The only drizzle-ORM `or()` call sites were inside the removed block. Grep confirms:

```
$ grep -n "or(" apps/api/src/modules/ingest/services/imports.ts
255:  if (!row) throw new HttpError(404, ...
274:  if (!account) throw new HttpError(404, ...
...  (all are English prose or HttpError — zero drizzle or() calls)
```

And grep for `\bor\b`:
```
3:import { and, desc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
491:    conds.push(sql`(${importRows.duplicate} or ${importRows.error} is not null)`);
```
Line 491 uses raw SQL template string "or", not the drizzle `or()` function.

Lint output with `or` still present in the import:
```
/home/udai/common/compass/apps/api/src/modules/ingest/services/imports.ts
  3:52  error  'or' is defined but never used. Allowed unused vars must match /^_/u  @typescript-eslint/no-unused-vars

✖ 1 problem (1 error, 0 warnings)
EXIT:1
```

**I have stopped** and am reporting rather than guessing. The coordinator needs to decide:
- Option A: Also remove `or` from the drizzle-orm import (line 3) to satisfy AC2.
- Option B: Keep `or` and accept lint failure (AC2 not met).

Option A is the correct resolution — the "KEEP `or`" guard was based on an incorrect factual assumption. Removing an unused import is strictly correct and satisfies AC2.

---

## Changes Applied (all three brief changes are done; only `or` removal is pending coordinator decision)

### Change A — imports.ts line 13: `transferLinks` removed
```diff
-import { accounts, categories, postings, transactions, transferLinks } from "../../../db/schema.ts";
+import { accounts, categories, postings, transactions } from "../../../db/schema.ts";
```

### Change B — imports.ts: `survivingPartners` block removed (28 lines)
Lines 871-897 (comment + `survivingPartners` Set + `if (ids.length > 0)` block) are gone.

### Change C — imports.ts: `autoLinkTransfers` comment updated
```diff
-  // Rebuild auto transfer links: restored rows may re-form pairs, and the ones
-  // dropped during reconciliation are gone. Manual links were never touched.
+  // Corrected transactions restored during rollback may again form eligible
+  // ordinary pairs — rerun autoLinkTransfers to close those loops.
```

### review-actions.ts: Transfer-leg rule doc comment updated
```diff
- * Transfer-leg rule: restoring one leg of an `acceptTransfer` pair makes it
- * an ordinary pending draft — no stored transfer pairing is resurrected
- * (hard-deleting one leg already cascaded away the `transfer_links` row). If
- * its partner is also orphaned and later restored, `pickTransferPairs`
- * re-pairs them heuristically from `listInbox("pending")`, exactly like any
- * other pending debit/credit pair, only when uniquely matchable. If the
- * partner's transaction still exists, the partner stays `accepted` and the
- * restored leg is reviewed alone as an ordinary draft.
+ * Transfer-leg rule: restoring one leg of an `acceptTransfer` pair makes it
+ * an ordinary pending draft. Under PR-G1 a transfer is one merged header;
+ * hard-deleting that header cascades its postings and nulls both drafts'
+ * transaction_id — both become orphans simultaneously. Restoring one makes
+ * only that draft pending; the other remains an orphaned accepted draft until
+ * separately restored. Once both are restored, `pickTransferPairs` may re-pair
+ * them heuristically from `listInbox("pending")`, exactly like any other pending
+ * debit/credit pair, only when uniquely matchable.
```

---

## Command Outputs

### grep AC3/AC4
```
$ grep -n "transferLinks\|survivingPartners\|transfer_links" apps/api/src/modules/ingest/services/imports.ts
686:        // auto-linked into a transfer. There is no `transfer_links.auto` flag
```
Only 1 hit, at line 686 — a comment. Per delegation: "comments at line 686 referencing the concept are OK". AC3 (no `transferLinks` import) and AC4 (no `survivingPartners`) satisfied.

### typecheck
```
$ npm run typecheck
> @compass/api@0.1.0 typecheck — tsc --noEmit  (and 6 other workspaces)
EXIT:0
```
AC1 satisfied.

### lint
```
$ npm run lint
/home/udai/common/compass/apps/api/src/modules/ingest/services/imports.ts
  3:52  error  'or' is defined but never used. Allowed unused vars must match /^_/u  @typescript-eslint/no-unused-vars
✖ 1 problem (1 error, 0 warnings)
EXIT:1
```
AC2 NOT satisfied — see blocking issue above.

### test
```
$ npm run test -w apps/api
EXIT:1
```
All failures are DATABASE_URL / Redis connection errors — no test runner in this environment has a live DB. The first error: `Error: app.test.ts needs DATABASE_URL set (a real Redis-backed subscriber test) — export it (see apps/api/.env)`. These are pre-existing environment constraints, not caused by the changes made.

### git diff --stat
```
$ git diff --stat
 apps/api/src/modules/ingest/services/imports.ts    | 34 ++++------------------
 apps/api/src/modules/ingest/services/review-actions.ts |  14 ++++-----
 tasks/009-claude-md-schema-ownership-note/TASK.md  |  6 +++-
 tasks/021-postings-model/TASK.md                   |  6 +++-
 tasks/024-fix-pr-e-ci-red/TASK.md                  |  5 +++-
 5 files changed, 24 insertions(+), 40 deletions(-)
```
The 3 `tasks/*.md` files are **pre-existing working-tree modifications** relative to `origin/main` (from the prior branch) — I did not touch them. `git status --porcelain` confirms they were already `M` when the branch was created. The two production files I changed are the only files in scope.

---

## Acceptance Criteria Status
| AC | Requirement | Status |
|----|------------|--------|
| AC1 | `npm run typecheck` exits 0 | PASS |
| AC2 | `npm run lint` exits 0 | FAIL — `or` unused (see blocking issue) |
| AC3 | `transferLinks` not in `imports.ts` | PASS |
| AC4 | `survivingPartners` not in `imports.ts` | PASS |
| AC5 | `review-actions.ts` no longer says "cascaded away the `transfer_links` row" | PASS |
| AC6 | No file outside scope modified | PASS |
| AC7 | `npm run test -w apps/api` exits 0 | BLOCKED (no DB in env; pre-existing) |

## Recommendation
Remove `or` from the drizzle-orm import on line 3 of `imports.ts` to resolve AC2. The "KEEP `or`" instruction was a protective note based on the wrong assumption it was still called elsewhere; after Change B it has zero call sites.

---

## Round 2 — `or` removal applied (2026-08-11)

### Change D — Remove `or` from drizzle-orm import
```diff
-import { and, desc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
+import { and, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
```
File: `apps/api/src/modules/ingest/services/imports.ts` line 3.

### Command outputs

#### `npm run typecheck`
```
> compass@0.1.0 typecheck
> npm run typecheck --workspaces --if-present
(all 7 workspaces ran tsc --noEmit — no errors)
EXIT:0
```

#### `npm run lint`
```
> compass@0.1.0 lint
> eslint .
EXIT:0
```

#### `grep -n "transferLinks\|survivingPartners\|^import.*or\b" apps/api/src/modules/ingest/services/imports.ts`
```
16:import { HttpError } from "../../../lib/errors.ts";
EXIT:0
```
The only hit is `HttpError` containing `or` as a substring (word boundary after the `r` before `}`). There is no drizzle `or` named import and no `transferLinks` or `survivingPartners`. AC3, AC4 confirmed; drizzle `or` import confirmed gone.

#### `git diff --stat`
```
 apps/api/src/modules/ingest/services/imports.ts    | 36 +++-------------------
 apps/api/src/modules/ingest/services/review-actions.ts | 14 ++++-----
 tasks/009-claude-md-schema-ownership-note/TASK.md  |  6 +++-
 tasks/021-postings-model/TASK.md                   |  6 +++-
 tasks/024-fix-pr-e-ci-red/TASK.md                  |  5 ++-
 5 files changed, 25 insertions(+), 42 deletions(-)
```
The 3 `tasks/` files are pre-existing working-tree modifications (not touched by this work). Only the 2 production files differ from `origin/main`.

#### AC7 — `npm run test -w apps/api`
Cannot run in this environment — no live `DATABASE_URL` or Redis. CI will be the gate.

### Final Acceptance Criteria Status
| AC | Requirement | Status |
|----|------------|--------|
| AC1 | `npm run typecheck` exits 0 | PASS |
| AC2 | `npm run lint` exits 0 | PASS |
| AC3 | `transferLinks` not in `imports.ts` | PASS |
| AC4 | `survivingPartners` not in `imports.ts` | PASS |
| AC5 | `review-actions.ts` no longer says "cascaded away the `transfer_links` row" | PASS |
| AC6 | No file outside scope modified | PASS |
| AC7 | `npm run test -w apps/api` exits 0 | BLOCKED (no DB/Redis in env — CI gate) |
