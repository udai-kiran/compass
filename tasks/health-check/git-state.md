# Git State Health Check

Date: 2026-08-14

---

## 1. `git status`

```
On branch main
Your branch is up to date with 'origin/main'.

Untracked files:
  (use "git add <file>..." to include in what will be committed)
	.bash_profile
	.bashrc
	.gitconfig
	.gitmodules
	.idea
	.mcp.json
	.profile
	.ripgreprc
	.vscode
	.zprofile
	.zshrc

nothing added to commit but untracked files present (use "git add" to track)
```

Exit code: 0

---

## 2. `git log --oneline -20`

```
9181a23 chore: mark 2.6, 3.2 done — 2.0.0 foundation complete
559fa2e feat: ledger invariants — property tests + integrity endpoint (2.6)
bef728f chore: mark tasks 2.7, 3.1 done; update board statuses
aa93906 fix: postings UI split-save + docs refresh
fddb20c feat!: PR-G2 legacy ledger drop + migration collapse (v3.0.0)
647246e Merge pull request #195 from udai-kiran/feat/credit-card-improvements
54bb640 fix(extractor): rank credit cards by subject before password-matching statements
9afc6a1 feat(accounts): linked payment account for credit card inbox repayments
80941b2 Fix/reprocess all ingestion status (#194)
be585ed fix(ingest): reset email_ingestions status on reprocess-all (#193)
3ed5c5e fix(web): remove duplicate EpfOpeningSection and read opening balance from the ledger (#192)
38ae9a2 Fix/epf save in accounts page (#191)
3e5bb2c fix epf save in accounts page (#190)
f19b152 epf opening balance fix (#189)
caa5f2d revamped the EPF (#188)
42bb176 fixed recent transactions
bb93985 fix(web): UI polish — stat tile font, date formatting across all pages (#187)
847f8c2 feat(web): add "Reprocess all" button to MailboxesPanel (#186)
3a37636 feat(ingest): add POST /api/mailboxes/:id/reset-watermark (#185)
d1bd222 fix(ledger): remove transactions alias in listTransactions totals CTE (#184)
```

Exit code: 0

---

## 3. `git log --oneline origin/main..HEAD`

```
(no output — no commits ahead of origin/main)
```

Exit code: 0

---

## 4. `git tag -l 'v3*'`

```
v3.0.0
```

Exit code: 0

---

## 5. `git branch -vv`

```
  feat/postings-model-pr-e bab59d8 [origin/feat/postings-model-pr-e] feat(api): postings model PR-E — convert remaining readers to postings (roadmap 2.1)
* main                     9181a23 [origin/main] chore: mark 2.6, 3.2 done — 2.0.0 foundation complete
  pr-d-fullchanges         39dd99a [origin/main: ahead 2, behind 30] docs(tasks): record user decision — old backups need not restore to new system
```

Exit code: 0

---

## Summary

- **Current branch:** `main`, tip commit `9181a23`
- **Remote sync:** `main` is exactly in sync with `origin/main` (0 commits ahead, 0 behind)
- **Uncommitted changes:** none staged; 11 untracked dotfiles/IDE files (`.bashrc`, `.gitconfig`, `.vscode`, etc.) — not repo source files
- **v3 tags:** one tag exists: `v3.0.0` (applied at commit `fddb20c`)
- **Local branches:** 3 branches total — `main` (current, synced), `feat/postings-model-pr-e` (synced with its remote), `pr-d-fullchanges` (ahead 2, behind 30 relative to `origin/main` — stale local branch)
