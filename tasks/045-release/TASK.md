# Task: Board Reconciliation + Release

## Status
COMPLETE

## Objective
Update the task board to reflect reality, reconcile the version numbering, and tag a clean release.

## Root Cause
README says "currently at v1.94.0" while git is at v2.8.17. Phase-file statuses for 2.1-2.5 are stale (still say "todo" despite being substantially shipped). The roadmap's themed release numbers (2.1.0=Household ... 2.8.0=Portfolio) collided with the incremental tags v2.1.0-v2.8.17 burned during the postings work.

## Scope
- Update phase-file frontmatter for tasks 2.1-2.5 (mark done/rescoped)
- Update README.md "Currently at" line
- Adopt new version scheme: v3.0.0 for the clean foundation release (post-PR-G2 + collapsed migrations)
- Tag v3.0.0

## Dependencies
- task 043 (legacy ledger drop)
- task 044 (migration collapse)

## Plan
- P1: Update `02.01-postings-model.md` frontmatter: `status: done`
- P2: Update `02.02`, `02.03`, `02.04`, `02.05` frontmatter: `status: done` with note "absorbed into 2.1 / PR-G2"
- P3: Update `02.06-double-entry-invariants.md`: remains `todo` (genuine remaining work)
- P4: Update `02.07-transaction-postings-ui.md`: remains `todo`
- P5: Update README.md: "Currently at `v3.0.0`" and note that v2.x tags are legacy incremental
- P6: Commit all changes
- P7: Tag v3.0.0

## Acceptance Criteria
- AC1: Phase files 2.1-2.5 reflect actual status
- AC2: README.md version line is accurate
- AC3: `npm run typecheck && npm run test` pass
- AC4: Git tag v3.0.0 exists on the commit

## Verification
- T1: `grep 'status:' tasks/02.0*.md` shows correct statuses
- T2: `grep 'Currently at' tasks/README.md` shows v3.0.0
- T3: `git tag -l v3.0.0` returns the tag

## Non-Goals
- Updating all 90+ future task statuses
- Deploying to production
- Completing tasks 2.6 (invariants) or 2.7 (postings UI)
