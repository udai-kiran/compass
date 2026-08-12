# git-log-1.md — task 034 release steps

All commands run from `/home/udai/common/compass` on branch `fix/032-dashboard-500` (starting state).

---

## Step 0 — pre-flight status

```
$ git status --porcelain
 M CLAUDE.md
 M apps/web/src/lib/mailbox-queries.ts
 M apps/web/src/routes/settings/MailboxesPanel.tsx
?? INFRA.md
?? tasks/031-infra-docs/
?? tasks/032-dashboard-fix/logs-1.md
?? tasks/033-mailbox-reset-watermark/git-log-1.md
?? tasks/034-mailbox-reset-ui/
EXIT: 0
```

---

## Step 1 — stash task-034 files

```
$ git stash push -u \
  apps/web/src/lib/mailbox-queries.ts \
  apps/web/src/routes/settings/MailboxesPanel.tsx \
  tasks/034-mailbox-reset-ui/
Saved working directory and index state WIP on feat/033-mailbox-reset-watermark: 0f71f0b feat(ingest): add POST /api/mailboxes/:id/reset-watermark
EXIT: 0
```

---

## Step 2 — create branch from main

```
$ git checkout main
Switched to branch 'main'
M	CLAUDE.md
Your branch is up to date with 'origin/main'.
EXIT: 0

$ git pull origin main
From https://github.com/udai-kiran/PennyPilot
 * branch            main       -> FETCH_HEAD
   d1bd222..3a37636  main       -> origin/main
Updating d1bd222..3a37636
Fast-forward
 apps/api/src/modules/ingest/routes/mailboxes.ts    |  10 +
 apps/api/src/modules/ingest/services/mailboxes.ts  |  18 ++
 apps/api/src/route-surface.snapshot.txt            |   1 +
 apps/api/src/route-table.snapshot.txt              |   1 +
 tasks/033-mailbox-reset-watermark/DELEGATION-git.md  | 168 +++++++++++++++
 tasks/033-mailbox-reset-watermark/DELEGATION.md    |  75 +++++++
 tasks/033-mailbox-reset-watermark/TASK.md          |  74 +++++++
 tasks/033-mailbox-reset-watermark/implementation-1.md | 235 +++++++++++++++++++++
 tasks/033-mailbox-reset-watermark/review-1.md      |  74 +++++++
 tasks/033-mailbox-reset-watermark/review-2.md      |  10 +
 10 files changed, 666 insertions(+)
 create mode 100644 tasks/033-mailbox-reset-watermark/DELEGATION-git.md
 create mode 100644 tasks/033-mailbox-reset-watermark/DELEGATION.md
 create mode 100644 tasks/033-mailbox-reset-watermark/TASK.md
 create mode 100644 tasks/033-mailbox-reset-watermark/implementation-1.md
 create mode 100644 tasks/033-mailbox-reset-watermark/review-1.md
 create mode 100644 tasks/033-mailbox-reset-watermark/review-2.md
EXIT: 0

$ git checkout -b feat/034-mailbox-reset-ui
Switched to a new branch 'feat/034-mailbox-reset-ui'
EXIT: 0
```

---

## Step 3 — pop stash

```
$ git stash pop
On branch feat/034-mailbox-reset-ui
Changes not staged for commit:
  (use "git add <file>..." to update what will be committed)
  (use "git restore <file>..." to discard changes in working directory)
	modified:   CLAUDE.md
	modified:   apps/web/src/lib/mailbox-queries.ts
	modified:   apps/web/src/routes/settings/MailboxesPanel.tsx

Untracked files:
  (use "git add <file>..." to include in what will be committed)
	INFRA.md
	tasks/031-infra-docs/
	tasks/032-dashboard-fix/logs-1.md
	tasks/033-mailbox-reset-watermark/git-log-1.md
	tasks/034-mailbox-reset-ui/

no changes added to commit (use "git add" and/or "git commit -a")
Dropped refs/stash@{0} (07612b9dc2b1892b147cd006afc1c9cf8495b32b)
EXIT: 0
```

---

## Step 4 — stage explicitly

```
$ git add \
  apps/web/src/lib/mailbox-queries.ts \
  apps/web/src/routes/settings/MailboxesPanel.tsx \
  tasks/034-mailbox-reset-ui/TASK.md \
  tasks/034-mailbox-reset-ui/DELEGATION.md \
  tasks/034-mailbox-reset-ui/review-1.md \
  tasks/034-mailbox-reset-ui/review-2.md \
  tasks/034-mailbox-reset-ui/implementation-1.md
EXIT: 0
```

---

## Step 5 — verify staged files

```
$ git status
On branch feat/034-mailbox-reset-ui
Changes to be committed:
  (use "git restore --staged <file>..." to unstage)
	modified:   apps/web/src/lib/mailbox-queries.ts
	modified:   apps/web/src/routes/settings/MailboxesPanel.tsx
	new file:   tasks/034-mailbox-reset-ui/DELEGATION.md
	new file:   tasks/034-mailbox-reset-ui/TASK.md
	new file:   tasks/034-mailbox-reset-ui/implementation-1.md
	new file:   tasks/034-mailbox-reset-ui/review-1.md
	new file:   tasks/034-mailbox-reset-ui/review-2.md

Changes not staged for commit:
  (use "git add <file>..." to update what will be committed)
  (use "git restore <file>..." to discard changes in working directory)
	modified:   CLAUDE.md

Untracked files:
  (use "git add <file>..." to include in what will be committed)
	INFRA.md
	tasks/031-infra-docs/
	tasks/032-dashboard-fix/logs-1.md
	tasks/033-mailbox-reset-watermark/git-log-1.md
EXIT: 0

$ git diff --cached --name-only
apps/web/src/lib/mailbox-queries.ts
apps/web/src/routes/settings/MailboxesPanel.tsx
tasks/034-mailbox-reset-ui/DELEGATION.md
tasks/034-mailbox-reset-ui/TASK.md
tasks/034-mailbox-reset-ui/implementation-1.md
tasks/034-mailbox-reset-ui/review-1.md
tasks/034-mailbox-reset-ui/review-2.md
EXIT: 0

$ git diff --cached --stat
 apps/web/src/lib/mailbox-queries.ts             |   7 +-
 apps/web/src/routes/settings/MailboxesPanel.tsx |  37 +++++-
 tasks/034-mailbox-reset-ui/DELEGATION.md        |  99 ++++++++++++++
 tasks/034-mailbox-reset-ui/TASK.md              |  70 ++++++++++
 tasks/034-mailbox-reset-ui/implementation-1.md  | 170 ++++++++++++++++++++++++
 tasks/034-mailbox-reset-ui/review-1.md          |  33 +++++
 tasks/034-mailbox-reset-ui/review-2.md          |  12 ++
 7 files changed, 425 insertions(+), 3 deletions(-)
EXIT: 0
```

Staged set matches spec exactly. CLAUDE.md, INFRA.md, tasks/031-*, tasks/032-*, tasks/033-* are NOT staged.

---

## Step 6 — commit

```
$ git commit -m 'feat(web): add "Reprocess all" button to MailboxesPanel

Wires the POST /api/mailboxes/:id/reset-watermark endpoint into the
Settings → Mailboxes UI. Each mailbox row now has a "Reprocess all"
button (amber, confirm-gated) that resets the IMAP watermark then
immediately queues a sync (SYNC_WINDOW_MINUTES[0] = 5 min).

Three toast outcomes:
- Full success: "Watermark reset — sync queued (within N min)"
- Reset ok, sync fails: instructs user to use Queue sync button
- Reset fails: server error message

Button is disabled and relabelled "Resetting…" while in flight.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>'
[feat/034-mailbox-reset-ui d220ddf] feat(web): add "Reprocess all" button to MailboxesPanel
 7 files changed, 425 insertions(+), 3 deletions(-)
 create mode 100644 tasks/034-mailbox-reset-ui/DELEGATION.md
 create mode 100644 tasks/034-mailbox-reset-ui/TASK.md
 create mode 100644 tasks/034-mailbox-reset-ui/implementation-1.md
 create mode 100644 tasks/034-mailbox-reset-ui/review-1.md
 create mode 100644 tasks/034-mailbox-reset-ui/review-2.md
EXIT: 0

Commit hash: d220ddfb861b0b7d64f35945abc95faf420666c9
```

---

## Step 7 — push

```
$ git push -u origin feat/034-mailbox-reset-ui
remote: 
remote: Create a pull request for 'feat/034-mailbox-reset-ui' on GitHub by visiting:
remote:      https://github.com/udai-kiran/PennyPilot/pull/new/feat/034-mailbox-reset-ui
remote: 
To https://github.com/udai-kiran/PennyPilot.git
 * [new branch]      feat/034-mailbox-reset-ui -> feat/034-mailbox-reset-ui
branch 'feat/034-mailbox-reset-ui' set up to track 'origin/feat/034-mailbox-reset-ui'.
EXIT: 0
```

---

## Step 8 — create PR

```
$ gh pr create \
  --title 'feat(web): add "Reprocess all" button to MailboxesPanel' \
  --body '...' \
  --base main \
  --head feat/034-mailbox-reset-ui
Warning: 5 uncommitted changes
https://github.com/udai-kiran/PennyPilot/pull/186
EXIT: 0
```

---

## Summary

| Item | Value |
|------|-------|
| Commit hash | `d220ddfb861b0b7d64f35945abc95faf420666c9` |
| Branch | `feat/034-mailbox-reset-ui` |
| Push exit code | 0 |
| PR URL | https://github.com/udai-kiran/PennyPilot/pull/186 |
| Errors | None (gh warning about 5 uncommitted changes is expected — CLAUDE.md, INFRA.md, tasks/031-*/032-*/033-* are intentionally unstaged) |
