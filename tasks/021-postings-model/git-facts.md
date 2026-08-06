# git-facts — tasks/021-postings-model

Generated: 2026-08-06

---

## 1. `git branch --show-current`

```
main
```

---

## 2. `git log --oneline -6`

```
4e0182a Merge pull request #165 from udai-kiran/refactor/module-migration-phase1-close
e58dbe1 refactor(api): physical per-module schema ownership + flat-services cleanup (roadmap 1.9)
cfc36b5 refactor(api): migrate ingest and system modules into modules/ (roadmap 1.7, 1.8)
825705d test(api): add Storage backend contract tests (roadmap 1.10)
5031b88 Merge pull request #164 from udai-kiran/refactor/module-migration-phase1-automation
a219cbc refactor(api): migrate automation/AI module into modules/automation (roadmap 1.6)
```

---

## 3. `git status --short` (full output)

```
 M packages/shared/src/money.ts
 M tasks/01.07-migrate-ingest.md
 M tasks/01.08-migrate-system.md
 M tasks/01.10-storage-backend-contract-tests.md
 M tasks/02.02-retire-transfer-links.md
 M tasks/02.03-splits-into-postings.md
 M tasks/02.04-service-conversion.md
 M tasks/02.05-api-compatibility.md
 M tasks/README.md
?? apps/api/src/modules/ledger/services/postings.test.ts
?? apps/api/src/modules/ledger/services/postings.ts
?? tasks/013-release-v1.97.0/commit-pr-final.md
?? tasks/015-statusline/
?? tasks/018-migrate-system/commit-log.md
?? tasks/020-cross-module-ports/release-log.md
?? tasks/021-postings-model/
?? tasks/BATCH-phase1-close.md
```

---

## 4. `git status --short | wc -l`

```
17
```

---

## 5. `git remote -v`

```
origin	https://github.com/udai-kiran/PennyPilot.git (fetch)
origin	https://github.com/udai-kiran/PennyPilot.git (push)
```

---

## 6. `gh auth status`

```
github.com
  ✓ Logged in to github.com account udai-kiran (/home/udai/.config/gh/hosts.yml)
  - Active account: true
  - Git operations protocol: https
  - Token: gho_************************************ (token not shown)
  - Token scopes: 'gist', 'read:org', 'repo', 'workflow'
```

Authenticated as udai-kiran. Token has `repo` and `workflow` scopes; does NOT have `write:packages` (consistent with known CI/GHCR constraint in memory).

---

## 7. SP0 code files tracked/untracked state

Command: `git status --short -- packages/shared/src/money.ts apps/api/src/modules/ledger/services/postings.ts apps/api/src/modules/ledger/services/postings.test.ts`

```
 M packages/shared/src/money.ts
?? apps/api/src/modules/ledger/services/postings.test.ts
?? apps/api/src/modules/ledger/services/postings.ts
```

- `packages/shared/src/money.ts` — tracked, **modified** (index clean, worktree dirty)
- `apps/api/src/modules/ledger/services/postings.ts` — **untracked** (new file, not staged)
- `apps/api/src/modules/ledger/services/postings.test.ts` — **untracked** (new file, not staged)

---

## 8. 1.9 refactor files — committed or dirty?

### Last commit touching `apps/api/src/db/core-schema.ts`

```
e58dbe1 refactor(api): physical per-module schema ownership + flat-services cleanup (roadmap 1.9)
```

That commit is HEAD~1, i.e. it is in the history and merged (PR #165 merged it).

### `git status --short -- apps/api/src/db/ apps/api/src/modules/ apps/api/src/lib/ CLAUDE.md`

```
?? apps/api/src/modules/ledger/services/postings.test.ts
?? apps/api/src/modules/ledger/services/postings.ts
```

Only the two new SP0 postings files appear. All other 1.9 refactor files under `apps/api/src/db/`, `apps/api/src/modules/`, `apps/api/src/lib/`, and `CLAUDE.md` are **clean** (committed). The big 1.9 refactor is fully committed and merged.

---

## 9. `git ls-files --others --exclude-standard | head -50`

```
apps/api/src/modules/ledger/services/postings.test.ts
apps/api/src/modules/ledger/services/postings.ts
tasks/013-release-v1.97.0/commit-pr-final.md
tasks/015-statusline/DELEGATION.md
tasks/015-statusline/TASK.md
tasks/015-statusline/backend-1.md
tasks/015-statusline/investigation-1.md
tasks/015-statusline/investigation-2.md
tasks/015-statusline/review-1.md
tasks/015-statusline/verification-1.md
tasks/018-migrate-system/commit-log.md
tasks/020-cross-module-ports/release-log.md
tasks/021-postings-model/DELEGATION.md
tasks/021-postings-model/TASK.md
tasks/021-postings-model/backend-1.md
tasks/021-postings-model/investigation-1.md
tasks/021-postings-model/review-1.md
tasks/021-postings-model/review-2.md
tasks/021-postings-model/review-3.md
tasks/021-postings-model/review-4.md
tasks/021-postings-model/verification-1.md
tasks/BATCH-phase1-close.md
```

**No private artifacts** (*.pdf at root, `Pasted image*`, `data/`) appear in the untracked list. All untracked files are either the two SP0 source files or task-tracking markdown files inside `tasks/`.
