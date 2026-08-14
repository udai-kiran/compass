# Task: Docs Update (3.1)

## Status
COMPLETE

## Objective
Update ROADMAP.md to reflect the completed module migration and double-entry ledger. CLAUDE.md and PRD.md are already accurate.

## Scope
- `ROADMAP.md` — 4 stale items:
  - Line 6: version "v1.94.0" → "v3.0.0", update release count
  - Line 29: "51 tables" → "49 tables"
  - Line 36: reword "split transactions" and "transfer detection and linking" to reflect postings model
  - Line 95: rewrite architecture paragraph — the restructuring is complete, not future

## Plan
- P1: Update ROADMAP.md line 6 version + release count
- P2: Update ROADMAP.md line 29 table count
- P3: Reword ROADMAP.md line 36 feature list
- P4: Rewrite ROADMAP.md line 95 architecture paragraph as completed work
- P5: Verify: typecheck + lint pass

## Acceptance Criteria
- AC1: No references to "51 tables" or "v1.94.0" in ROADMAP.md
- AC2: Architecture paragraph describes current state, not planned future
- AC3: typecheck + lint pass
