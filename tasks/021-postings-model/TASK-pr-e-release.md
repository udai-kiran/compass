# Task: PR-E branch + commit + PR + merge + release

## Status
IMPLEMENTING

## Objective
Create branch `feat/postings-model-pr-e`, commit only the 10 PR-E files, push, open PR against `main`, merge it, and tag the release.

## Root Cause
PR-E work is complete (9 source files + parity test) but uncommitted on `pr-d-fullchanges`.

## Scope
Exactly these files (and nothing else):
- apps/api/src/modules/credit/services/cards.ts
- apps/api/src/modules/credit/services/emis.ts
- apps/api/src/modules/credit/services/reconciliation-reads.ts
- apps/api/src/modules/investments/services/sip-installments.ts
- apps/api/src/modules/automation/services/categorize.ts
- apps/api/src/modules/ledger/services/user-tasks.ts
- apps/api/src/modules/ledger/services/search.ts
- apps/api/src/modules/ingest/services/imports.ts
- apps/api/src/modules/protection/services/insurance.ts
- apps/api/src/modules/ledger/services/postings-pr-e-parity.test.ts

## Dependencies
PR-E COMPLETE per TASK.md

## Branch strategy
- If `main` and `pr-d-fullchanges` diverge (PR-D not merged): create `feat/postings-model-pr-e` from `main`, then cherry-pick / re-stage only the PR-E diff
- If `pr-d-fullchanges` is merged into main already: create branch from `main`, stage and commit only the 10 files

## Commit message
```
feat(api): postings model PR-E — convert remaining readers to postings (roadmap 2.1)

Converts 9 reader functions that read transactions.amount_paise,
transactions.account_id, or transactions.is_opening directly, replacing
them with postings-based queries. Adds 10-case DB-backed parity test.

- cards.ts: balance = opening_balance_paise + SUM(postings) (Pattern A + addend)
- emis.ts: EMI installment amounts from real postings (Pattern B)
- reconciliation-reads.ts: ledger dues from postings aggregation
- sip-installments.ts: unlinked candidates via Pattern B + LATERAL
- categorize.ts: uncategorized transactions via Pattern C NOT EXISTS
- user-tasks.ts: large-transaction tasks via raw SQL LATERAL
- search.ts: transfer exclusion via Pattern C NOT EXISTS
- imports.ts: import matching queries via postings joins
- insurance.ts: policy premiums from real postings (Pattern B)

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
```

## PR body template
```
## PR-E: Convert remaining readers to postings (roadmap 2.1)

Converts the 9 remaining reader functions that still read
`transactions.amount_paise`, `transactions.account_id`, or
`transactions.is_opening` directly to postings-based queries.
Adds `postings-pr-e-parity.test.ts` (10 DB-backed parity tests, PE1–PE9 + PE8b).

### Changed files
- `modules/credit/services/cards.ts` (PE1 — card balance + activity)
- `modules/credit/services/emis.ts` (PE2 — EMI installment list)
- `modules/credit/services/reconciliation-reads.ts` (PE3 — ledger dues)
- `modules/investments/services/sip-installments.ts` (PE4 — SIP installment candidates)
- `modules/automation/services/categorize.ts` (PE5 — uncategorized txn query)
- `modules/ledger/services/user-tasks.ts` (PE6 — large-txn tasks via LATERAL)
- `modules/ledger/services/search.ts` (PE7 — full-text search transfer exclusion)
- `modules/ingest/services/imports.ts` (PE8 — import matching)
- `modules/protection/services/insurance.ts` (PE9 — policy premiums)
- `modules/ledger/services/postings-pr-e-parity.test.ts` (new — 10 parity tests)

### Verification
- typecheck: exit 0
- lint: exit 0  
- 643 existing tests pass; 10 new DB-backed tests skip without DATABASE_URL (matches existing parity test pattern)
- Codex review: no blocking findings (review-33 source files, review-34 parity test)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

## Release
Tag version to be determined after checking latest existing tag on main.
Format: `vX.Y.Z` — bump minor from last postings-model release.

## Acceptance Criteria
- AC1: Branch `feat/postings-model-pr-e` created from `main`
- AC2: Commit contains exactly the 10 PR-E files, nothing else
- AC3: PR opened against `main`, merged
- AC4: `main` updated with the PR-E commit
- AC5: Release tag pushed (e.g. `vX.Y.Z`)

## Non-Goals
- Do not stage tasks/ files, TASK.md, DELEGATION.md, or any review .md
- Do not stage apps/web, packages/shared, or any other unrelated changes
- Do not amend prior commits
