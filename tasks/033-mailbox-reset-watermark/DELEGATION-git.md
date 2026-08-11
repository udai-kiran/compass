# Sonnet Worker Delegation — Git / PR / Release

## Task
033-mailbox-reset-watermark — branch + commit + PR + release + delete source branch

## Context
All implementation is already done and sitting as uncommitted working-tree changes
on branch `fix/032-dashboard-500`. We need a clean new branch off `main` for this
feature, an explicit commit of only the task-033 files, a PR, a merge, a semver
release tag, and branch cleanup.

## Files to stage (ONLY these — nothing else)
```
apps/api/src/modules/ingest/services/mailboxes.ts
apps/api/src/modules/ingest/routes/mailboxes.ts
apps/api/src/route-surface.snapshot.txt
apps/api/src/route-table.snapshot.txt
tasks/033-mailbox-reset-watermark/TASK.md
tasks/033-mailbox-reset-watermark/DELEGATION.md
tasks/033-mailbox-reset-watermark/DELEGATION-git.md
tasks/033-mailbox-reset-watermark/review-1.md
tasks/033-mailbox-reset-watermark/review-2.md
tasks/033-mailbox-reset-watermark/implementation-1.md
```

## Must NOT stage
- `CLAUDE.md` (unrelated modification)
- `INFRA.md` (untracked, unrelated)
- `tasks/031-infra-docs/` (untracked, unrelated)
- `tasks/032-dashboard-fix/` (untracked, unrelated)

## Steps

### 1. Stash only the task-033 files
```bash
git stash push -u \
  apps/api/src/modules/ingest/services/mailboxes.ts \
  apps/api/src/modules/ingest/routes/mailboxes.ts \
  apps/api/src/route-surface.snapshot.txt \
  apps/api/src/route-table.snapshot.txt \
  tasks/033-mailbox-reset-watermark/
```

### 2. Create branch from main
```bash
git checkout main
git pull origin main
git checkout -b feat/033-mailbox-reset-watermark
```

### 3. Pop stash
```bash
git stash pop
```

### 4. Stage only the listed files
```bash
git add \
  apps/api/src/modules/ingest/services/mailboxes.ts \
  apps/api/src/modules/ingest/routes/mailboxes.ts \
  apps/api/src/route-surface.snapshot.txt \
  apps/api/src/route-table.snapshot.txt \
  tasks/033-mailbox-reset-watermark/TASK.md \
  tasks/033-mailbox-reset-watermark/DELEGATION.md \
  tasks/033-mailbox-reset-watermark/DELEGATION-git.md \
  tasks/033-mailbox-reset-watermark/review-1.md \
  tasks/033-mailbox-reset-watermark/review-2.md \
  tasks/033-mailbox-reset-watermark/implementation-1.md
```
Verify with `git status` — nothing unexpected should be staged.

### 5. Commit
```
feat(ingest): add POST /api/mailboxes/:id/reset-watermark

Resets the IMAP resume watermark (last_uid → 0) so the ingestor
re-fetches the entire mailbox from UID 1 on the next sync pass.
uid_validity is preserved so planSync() returns fromUid=1 rather
than baselining to "now". A never-synced mailbox (uid_validity=null)
is a semantic no-op — behaviour is identical with or without the reset.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
```

### 6. Push branch
```bash
git push -u origin feat/033-mailbox-reset-watermark
```

### 7. Create PR
```bash
gh pr create \
  --title "feat(ingest): add POST /api/mailboxes/:id/reset-watermark" \
  --body "## Summary

Adds \`POST /api/mailboxes/:id/reset-watermark\` — sets \`last_uid = 0\`
while preserving \`uid_validity\` so the ingestor re-fetches all messages
from UID 1 on the next sync pass.

**Why \`last_uid = 0\` and not \`null\`?** Setting both columns to \`null\`
causes \`planSync()\` to baseline to "now" — silently skipping all history.
With \`last_uid = 0\` and a matching \`uid_validity\`, \`planSync\` returns
\`fromUid = 1\` and re-fetches the full mailbox.

**Edge cases:**
- Never-synced mailbox (\`uid_validity = null\`): no-op — same baseline
  behaviour with or without the reset.
- Concurrent in-flight sync: acknowledged known limitation, acceptable
  for this personal-finance context (BullMQ jobs are short).

## Changes
- \`services/mailboxes.ts\` — \`resetMailboxWatermark(db, userId, id)\`
- \`routes/mailboxes.ts\` — \`POST /api/mailboxes/:id/reset-watermark\`
- Route snapshots updated

## Verification
- \`npm run typecheck\` → exit 0 (all 7 workspaces)
- Route snapshot gate tests pass
- 646 hermetic tests pass; 26 DB-gated tests skipped (pre-existing)

🤖 Generated with [Claude Code](https://claude.com/claude-code)" \
  --base main \
  --head feat/033-mailbox-reset-watermark
```

### 8. Merge PR
```bash
gh pr merge --squash --delete-branch
```
(--delete-branch deletes the remote branch automatically)

### 9. Determine next version tag
```bash
git fetch --tags
git tag --sort=-v:refname | head -5
```
Find the latest `vX.Y.Z` tag. Bump the **patch** component by 1 for this feature
(it's a non-breaking addition). E.g. if latest is `v0.14.3`, next is `v0.14.4`.

### 10. Tag the release on main
```bash
git checkout main
git pull origin main
git tag vX.Y.Z   # use the computed next version
git push origin vX.Y.Z
```

### 11. Delete local source branch
```bash
git branch -d feat/033-mailbox-reset-watermark
```
(Remote branch was already deleted by --delete-branch in step 8)

## Required Evidence
- `git status` before and after stash
- staged file list (`git status` after `git add`)
- commit hash
- PR URL
- PR merge output with exit code
- tags list (before + chosen next tag)
- `git push origin vX.Y.Z` output
- final `git log --oneline -5` on main

## Must Not Do
- `git add -A` or `git add .`
- Stage any file not in the explicit list above
- Force-push to main
- Skip verifying `git status` before the commit
