# Git State — Pre-PR-E Investigation

**Date:** 2026-08-10  
**Branch:** `pr-d-fullchanges`  
**Latest commit:** `39dd99a docs(tasks): record user decision — old backups need not restore to new system`

---

## Commands run and exact output

### 1. `git status --short`
```
 M apps/api/src/modules/automation/services/categorize.ts
 M apps/api/src/modules/credit/services/cards.ts
 M apps/api/src/modules/credit/services/emis.ts
 M apps/api/src/modules/credit/services/reconciliation-reads.ts
 M apps/api/src/modules/ingest/services/imports.ts
 M apps/api/src/modules/investments/services/sip-installments.ts
 M apps/api/src/modules/ledger/services/search.ts
 M apps/api/src/modules/ledger/services/user-tasks.ts
 M apps/api/src/modules/protection/services/insurance.ts
 M tasks/021-postings-model/TASK.md
?? apps/api/src/modules/ledger/services/postings-pr-e-parity.test.ts
?? tasks/021-postings-model/DELEGATION-pr-e.md
?? tasks/021-postings-model/PLAN-pr-e.md
?? tasks/021-postings-model/implementation-pr-e.md
?? tasks/021-postings-model/investigation-pr-e-2.md
?? tasks/021-postings-model/investigation-pr-e.md
?? tasks/021-postings-model/review-30.md
?? tasks/021-postings-model/review-31.md
?? tasks/021-postings-model/review-32.md
?? tasks/021-postings-model/review-33.md
?? tasks/021-postings-model/review-34.md
```

### 2. `git log --oneline -8`
```
39dd99a docs(tasks): record user decision — old backups need not restore to new system
e8b232c fix(test): correct heuristicNormalize title-case in parity test merchant lookup
54033b9 PR-D full changes (#171)
34c8e0e Feat/postings model pr b (#170)
c9a6174 Feat/postings model pr b (#169)
0441751 feat(api): postings model PR-B — balance readers read from postings (roadmap 2.1) (#168)
a77f1ce feat(api): postings model PR-A — dual-write shadow layer (roadmap 2.1) (#167)
e939100 Merge pull request #166 from udai-kiran/feat/postings-model-sp0
```

### 3. `git diff --name-only HEAD`
```
apps/api/src/modules/automation/services/categorize.ts
apps/api/src/modules/credit/services/cards.ts
apps/api/src/modules/credit/services/emis.ts
apps/api/src/modules/credit/services/reconciliation-reads.ts
apps/api/src/modules/ingest/services/imports.ts
apps/api/src/modules/investments/services/sip-installments.ts
apps/api/src/modules/ledger/services/search.ts
apps/api/src/modules/ledger/services/user-tasks.ts
apps/api/src/modules/protection/services/insurance.ts
tasks/021-postings-model/TASK.md
```

### 4. `git diff --name-only --cached`
```
(empty — nothing staged)
```

### 5. `git ls-files --others --exclude-standard apps/ packages/`
```
apps/api/src/modules/ledger/services/postings-pr-e-parity.test.ts
```

---

## Summary

- **Current branch:** `pr-d-fullchanges`
- **Nothing is staged** (index is clean)
- **All 9 PR-E source files are present as unstaged modifications** (` M` in working tree):
  - `apps/api/src/modules/credit/services/cards.ts`
  - `apps/api/src/modules/credit/services/emis.ts`
  - `apps/api/src/modules/credit/services/reconciliation-reads.ts`
  - `apps/api/src/modules/investments/services/sip-installments.ts`
  - `apps/api/src/modules/automation/services/categorize.ts`
  - `apps/api/src/modules/ledger/services/user-tasks.ts`
  - `apps/api/src/modules/ledger/services/search.ts`
  - `apps/api/src/modules/ingest/services/imports.ts`
  - `apps/api/src/modules/protection/services/insurance.ts`
- **Parity test is present as an untracked file** (`??`):
  - `apps/api/src/modules/ledger/services/postings-pr-e-parity.test.ts`
- `tasks/021-postings-model/TASK.md` is also modified (` M`)
- Several `tasks/021-postings-model/*.md` files are untracked (planning/review docs from prior work)
