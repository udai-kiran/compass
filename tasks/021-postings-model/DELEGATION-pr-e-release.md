# Sonnet Worker Delegation — PR-E Release

## Task
PR-E: branch + commit + PR + merge + release

## Approved Plan
1. Check git state: `git log --oneline origin/main..HEAD` and `git log --oneline HEAD..origin/main`
   to understand the relationship between this branch and main.
2. Check latest existing tag: `git tag --sort=-version:refname | head -5`
3. Create branch `feat/postings-model-pr-e` from `main` (not from current branch):
   `git checkout main && git pull origin main && git checkout -b feat/postings-model-pr-e`
4. Stage ONLY the 10 PR-E files (explicit paths, no globs):
   ```
   git add apps/api/src/modules/credit/services/cards.ts
   git add apps/api/src/modules/credit/services/emis.ts
   git add apps/api/src/modules/credit/services/reconciliation-reads.ts
   git add apps/api/src/modules/investments/services/sip-installments.ts
   git add apps/api/src/modules/automation/services/categorize.ts
   git add apps/api/src/modules/ledger/services/user-tasks.ts
   git add apps/api/src/modules/ledger/services/search.ts
   git add apps/api/src/modules/ingest/services/imports.ts
   git add apps/api/src/modules/protection/services/insurance.ts
   git add apps/api/src/modules/ledger/services/postings-pr-e-parity.test.ts
   ```
   IMPORTANT: The files exist on the working tree of the current branch (`pr-d-fullchanges`).
   After `git checkout main` then `git checkout -b feat/postings-model-pr-e`, the modified files
   from `pr-d-fullchanges` may no longer appear because checkout will switch the worktree.
   
   CORRECT APPROACH: Do NOT checkout main first. Instead:
   a. Stay on `pr-d-fullchanges` (or wherever the files are)
   b. Run `git stash` to save the uncommitted changes + untracked parity test:
      `git stash push --include-untracked -m "PR-E changes" -- apps/api/src/modules/credit/services/cards.ts apps/api/src/modules/credit/services/emis.ts apps/api/src/modules/credit/services/reconciliation-reads.ts apps/api/src/modules/investments/services/sip-installments.ts apps/api/src/modules/automation/services/categorize.ts apps/api/src/modules/ledger/services/user-tasks.ts apps/api/src/modules/ledger/services/search.ts apps/api/src/modules/ingest/services/imports.ts apps/api/src/modules/protection/services/insurance.ts apps/api/src/modules/ledger/services/postings-pr-e-parity.test.ts`
   c. `git checkout main && git pull origin main`
   d. `git checkout -b feat/postings-model-pr-e`
   e. `git stash pop`
   f. Stage and commit only the 10 files explicitly

5. Commit with the exact message below.
6. Push: `git push -u origin feat/postings-model-pr-e`
7. Create PR with `gh pr create` pointing at `main`.
8. Merge: `gh pr merge --merge --auto` or wait for checks if needed. If checks don't complete quickly, use `gh pr merge --merge` (no squash, preserve the commit).
9. After merge: `git checkout main && git pull origin main`
10. Determine next version tag: latest tag + 1 minor (e.g. if latest is v2.5.0, use v2.6.0).
11. Tag: `git tag vX.Y.Z` then `git push origin vX.Y.Z`

## Files and Symbols
Exactly 10 files (all in apps/api/src/modules/):
- credit/services/cards.ts
- credit/services/emis.ts
- credit/services/reconciliation-reads.ts
- investments/services/sip-installments.ts
- automation/services/categorize.ts
- ledger/services/user-tasks.ts
- ledger/services/search.ts
- ingest/services/imports.ts
- protection/services/insurance.ts
- ledger/services/postings-pr-e-parity.test.ts (new untracked file)

## Must Not Change
- tasks/ files (TASK.md, DELEGATION.md, *.md review files)
- packages/shared/
- apps/web/
- Any other file not in the list above
- Do NOT use `git add -A` or `git add .`
- Do NOT amend previous commits

## Commit Message (exact)
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

## PR Body (exact)
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
- 643 existing tests pass; 10 new DB-backed tests skip without DATABASE_URL
- Codex review: no blocking findings (review-33 + review-34)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

## Commands (in order)
1. `cd /work/personal/compass`
2. `git log --oneline origin/main..HEAD`  — check commits ahead of main
3. `git tag --sort=-version:refname | head -5`  — find latest tag
4. Stash PR-E files (see above for exact command with explicit path list)
5. `git fetch origin && git checkout main && git pull origin main`
6. `git checkout -b feat/postings-model-pr-e`
7. `git stash pop`
8. `git add` each of the 10 files explicitly
9. `git status --short`  — verify exactly 10 staged, nothing else
10. `git commit -m "..."` (exact message above)
11. `git log --oneline -3`  — verify commit
12. `git push -u origin feat/postings-model-pr-e`
13. `gh pr create --base main --head feat/postings-model-pr-e --title "feat(api): postings model PR-E — convert remaining readers to postings (roadmap 2.1)" --body "..."` (exact body above)
14. `gh pr merge --merge <PR-number>`
15. `git checkout main && git pull origin main`
16. Determine tag version from step 3 output (+1 minor)
17. `git tag vX.Y.Z && git push origin vX.Y.Z`

## Required Evidence
- Output of `git log --oneline origin/main..HEAD` (how many commits ahead)
- Output of `git tag --sort=-version:refname | head -5` (determine version)
- Output of `git status --short` after staging (must show exactly 10 A/M files, nothing else)
- Exact commit hash from `git log --oneline -3`
- PR URL from `gh pr create`
- PR merge output
- Tag pushed confirmation
- Final `git log --oneline -5` on main showing the PR-E commit
