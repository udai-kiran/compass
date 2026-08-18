# Commit Inventory — feat/misc-features (2026-08-18)

## Raw git output

### `git status --short`
```
 M CLAUDE.md
 M apps/api/package.json
 M apps/api/src/modules/credit/plugin.test.ts
 M apps/api/src/modules/credit/plugin.ts
 M apps/api/src/modules/credit/services/revolving-debt.ts
 M apps/api/src/modules/household/routes/settlements.ts
 M apps/api/src/modules/household/routes/splits.ts
 M apps/api/src/modules/household/services/grants.ts
 M apps/api/src/modules/household/services/membership.ts
 M apps/api/src/modules/planning/plugin.test.ts
 M apps/api/src/modules/planning/plugin.ts
 M apps/api/src/modules/planning/services/data-completeness.ts
 M apps/api/src/modules/planning/services/goal-plan.test.ts
 M apps/api/src/modules/planning/services/goal-plan.ts
 M apps/api/src/modules/planning/services/income-surplus.test.ts
 M apps/api/src/modules/planning/services/income-surplus.ts
 M apps/api/src/modules/planning/services/rebalancing-plan.test.ts
 M apps/api/src/route-surface.snapshot.txt
 M apps/api/src/route-table.snapshot.txt
 M apps/web/src/lib/household-queries.ts
 M packages/shared/src/index.ts
?? apps/api/src/modules/credit/routes/revolving-debt.hermetic.test.ts
?? apps/api/src/modules/credit/routes/revolving-debt.route.test.ts
?? apps/api/src/modules/credit/routes/revolving-debt.ts
?? apps/api/src/modules/credit/services/credit-schemas.test.ts
?? apps/api/src/modules/planning/routes/planning-analysis.hermetic.test.ts
?? apps/api/src/modules/planning/routes/planning-analysis.route.test.ts
?? apps/api/src/modules/planning/routes/planning-analysis.ts
?? apps/api/src/modules/planning/services/planning-schemas.test.ts
?? packages/shared/src/schemas/credit.ts
?? packages/shared/src/schemas/planning.ts
?? screen-shots/1.png
?? tasks/057-green-baseline/DELEGATION.md
?? tasks/057-green-baseline/TASK.md
?? tasks/057-green-baseline/implementation-1.md
?? tasks/057-green-baseline/investigation-1.md
?? tasks/057-green-baseline/review-1.md
?? tasks/057-green-baseline/review-2.md
?? tasks/057-green-baseline/verification-1.md
?? tasks/058-planning-api/DELEGATION.md
?? tasks/058-planning-api/TASK.md
?? tasks/058-planning-api/implementation-1.md
?? tasks/058-planning-api/implementation-2.md
?? tasks/058-planning-api/investigation-1.md
?? tasks/058-planning-api/review-1.md
?? tasks/058-planning-api/review-2.md
?? tasks/058-planning-api/review-3.md
?? tasks/058-planning-api/review-4.md
?? tasks/058-planning-api/verification-1.md
?? tasks/058-planning-api/verification-2.md
?? tasks/059-planning-routes-simple/DELEGATION.md
?? tasks/059-planning-routes-simple/TASK.md
?? tasks/059-planning-routes-simple/implementation-1.md
?? tasks/059-planning-routes-simple/implementation-2.md
?? tasks/059-planning-routes-simple/implementation-3.md
?? tasks/059-planning-routes-simple/implementation-4.md
?? tasks/059-planning-routes-simple/review-1.md
?? tasks/059-planning-routes-simple/review-2.md
?? tasks/059-planning-routes-simple/review-3.md
?? tasks/059-planning-routes-simple/review-4.md
?? tasks/059-planning-routes-simple/review-5.md
?? tasks/059-planning-routes-simple/verification-1.md
?? tasks/060-integration-verification/TASK.md
?? tasks/060-integration-verification/implementation-1.md
?? tasks/060-integration-verification/investigation-1.md
?? tasks/060-integration-verification/investigation-2.md
?? tasks/060-integration-verification/review-1.md
?? tasks/060-integration-verification/review-2.md
```

### `git branch --show-current`
```
feat/misc-features
```

### `git log --oneline -3`
```
b829d87 added some changes
e098d11 pending work
2cadca2 test(ledger): opening-transaction test coverage + invariant decision
```

### `git diff --stat` (tracked modifications)
```
 CLAUDE.md                                          |  6 +++++
 apps/api/package.json                              |  2 +-
 apps/api/src/modules/credit/plugin.test.ts         |  5 ++--
 apps/api/src/modules/credit/plugin.ts              | 23 ++++++++++--------
 apps/api/src/modules/credit/services/revolving-debt.ts  | 17 ++++++++++++++
 apps/api/src/modules/household/routes/settlements.ts    |  5 ++--
 apps/api/src/modules/household/routes/splits.ts    | 10 +++++---
 apps/api/src/modules/household/services/grants.ts  |  6 ++---
 apps/api/src/modules/household/services/membership.ts   |  2 +-
 apps/api/src/modules/planning/plugin.test.ts       |  5 ++--
 apps/api/src/modules/planning/plugin.ts            | 27 +++++++++++++---------
 apps/api/src/modules/planning/services/data-completeness.ts | 16 +++++++++++++
 apps/api/src/modules/planning/services/goal-plan.test.ts    | 24 +++++++++++++++++++
 apps/api/src/modules/planning/services/goal-plan.ts  |  2 +-
 apps/api/src/modules/planning/services/income-surplus.test.ts |  1 -
 apps/api/src/modules/planning/services/income-surplus.ts    |  9 ++++++++
 apps/api/src/modules/planning/services/rebalancing-plan.test.ts |  6 +++--
 apps/api/src/route-surface.snapshot.txt            |  6 +++++
 apps/api/src/route-table.snapshot.txt              |  3 +++
 apps/web/src/lib/household-queries.ts              |  1 -
 packages/shared/src/index.ts                       |  2 ++
 21 files changed, 139 insertions(+), 39 deletions(-)
```

### `git diff --cached --stat`
(empty — nothing staged)

---

## Categorised Inventory

### GROUP A — task 057 (baseline fix) — all Modified(M)

| Status | Path |
|--------|------|
| M | apps/api/src/modules/household/routes/splits.ts |
| M | apps/api/src/modules/household/routes/settlements.ts |
| M | apps/api/src/modules/household/services/grants.ts |
| M | apps/api/src/modules/household/services/membership.ts |
| M | apps/api/src/modules/planning/services/income-surplus.test.ts |
| M | apps/web/src/lib/household-queries.ts |

### GROUP B — task 058 (glide-path paise fix + shared contract)

| Status | Path |
|--------|------|
| M  | apps/api/src/modules/planning/services/goal-plan.ts |
| M  | apps/api/src/modules/planning/services/goal-plan.test.ts |
| M  | apps/api/src/modules/planning/services/rebalancing-plan.test.ts |
| ?? | packages/shared/src/schemas/planning.ts |
| ?? | packages/shared/src/schemas/credit.ts |
| M  | packages/shared/src/index.ts |
| ?? | apps/api/src/modules/planning/services/planning-schemas.test.ts |
| ?? | apps/api/src/modules/credit/services/credit-schemas.test.ts |

### GROUP C — task 059 (3 endpoints)

| Status | Path |
|--------|------|
| ?? | apps/api/src/modules/planning/routes/planning-analysis.ts |
| ?? | apps/api/src/modules/planning/routes/planning-analysis.hermetic.test.ts |
| ?? | apps/api/src/modules/planning/routes/planning-analysis.route.test.ts |
| ?? | apps/api/src/modules/credit/routes/revolving-debt.ts |
| ?? | apps/api/src/modules/credit/routes/revolving-debt.hermetic.test.ts |
| ?? | apps/api/src/modules/credit/routes/revolving-debt.route.test.ts |
| M  | apps/api/src/modules/planning/plugin.ts |
| M  | apps/api/src/modules/planning/plugin.test.ts |
| M  | apps/api/src/modules/credit/plugin.ts |
| M  | apps/api/src/modules/credit/plugin.test.ts |
| M  | apps/api/src/route-surface.snapshot.txt |
| M  | apps/api/src/route-table.snapshot.txt |
| M  | apps/api/package.json |
| M  | CLAUDE.md |

### GROUP D — task docs (tasks/ directories 057–060)

All untracked (??):

**tasks/057-green-baseline/**
- DELEGATION.md, TASK.md, implementation-1.md, investigation-1.md, review-1.md, review-2.md, verification-1.md

**tasks/058-planning-api/**
- DELEGATION.md, TASK.md, implementation-1.md, implementation-2.md, investigation-1.md, review-1.md, review-2.md, review-3.md, review-4.md, verification-1.md, verification-2.md

**tasks/059-planning-routes-simple/**
- DELEGATION.md, TASK.md, implementation-1.md, implementation-2.md, implementation-3.md, implementation-4.md, review-1.md, review-2.md, review-3.md, review-4.md, review-5.md, verification-1.md

**tasks/060-integration-verification/**
- TASK.md, implementation-1.md, investigation-1.md, investigation-2.md, review-1.md, review-2.md

### GROUP E — MUST NEVER BE COMMITTED

| Status | Path | Reason |
|--------|------|--------|
| ?? | screen-shots/1.png | Screenshot artifact |

---

## Critical Checks

### a) screen-shots/ contents
`screen-shots/` is untracked. It contains EXACTLY ONE file: `1.png`. Nothing else.

### b) .env existence
`.env` does NOT exist at the repo root.

### c) Other untracked private artifacts at repo root / data/ / *.pdf / *.png / *.sql
- No `*.pdf` files found at repo root.
- No `*.png` files at repo root (the PNG is inside `screen-shots/`).
- No `data/` directory found.
- No `.sql` dump or backup files found.
- No other surprising untracked files. All untracked paths are accounted for above.

### d) Credential string search (Groups A–D)
Searched all files in Groups A–C for the literal string `afiifwqc5uW7fZnZkVVPTxz9QpDSDPlF` (and any 8+ character fragment) and for any `postgresql://` URI. **Result: NO HITS.** The new task docs (Group D, tasks/057–060) were also searched. Findings from 060:

- `tasks/060-integration-verification/investigation-2.md:17` — `postgresql://compass:<redacted>@192.168.2.183:5432/compass-staging` (password is already redacted with `<redacted>` placeholder — not a real credential)
- `tasks/060-integration-verification/investigation-2.md:175` — same redacted URI in explanation text
- `tasks/060-integration-verification/review-1.md:265` — `DATABASE_URL='postgresql://compass:password@...'` (placeholder example, not real)

None of these are real credentials.

### e) tasks/ private data
The new task directories (057–060) contain only task delegation, investigation, implementation, and review notes. The only postgresql:// URIs are already redacted or are placeholder examples (see (d) above). No IP-plus-real-password combinations, no private keys, no OAuth tokens.

### f) apps/api/package.json diff
The diff contains ONLY one change: the `"test"` script line, adding `--experimental-test-module-mocks` flag. Nothing else was modified.

```diff
-    "test": "node --env-file-if-exists=../../.env --test \"src/**/*.test.ts\"",
+    "test": "node --env-file-if-exists=../../.env --experimental-test-module-mocks --test \"src/**/*.test.ts\"",
```

### g) CLAUDE.md diff
The diff contains ONLY one added block of 6 lines — a new paragraph after the test command examples explaining the `--experimental-test-module-mocks` flag, which two hermetic route tests require, and notes about Node stability and CI behaviour. No other lines were modified.

---

## SURPRISE FILES — not listed in any group in the brief

Three existing tracked files were modified that do not appear in Groups A, B, or C:

| Status | Path | Note |
|--------|------|------|
| M | apps/api/src/modules/planning/services/data-completeness.ts | +16 lines, not in brief |
| M | apps/api/src/modules/planning/services/income-surplus.ts | +9 lines, not in brief |
| M | apps/api/src/modules/credit/services/revolving-debt.ts | +17 lines, not in brief |

Note: The brief's Group C lists `credit/routes/revolving-debt.ts` (a NEW untracked file) — that is different from `credit/services/revolving-debt.ts` (an existing file that was modified). These three files need an explicit group assignment or disposition decision before committing.
