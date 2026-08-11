# Sonnet Worker Delegation — iteration 1 (implementation, P1-P5 ONLY)

## Task
026-pr-179-merge — resolve PR #179 merge conflicts (local merge + resolution only).

## Approved Plan (this iteration covers P1-P5; P6-P8 are NOT yours)
- P1: `git merge origin/main` on `feat/postings-pr-g1`; capture unmerged paths
  BEFORE resolving; abort if anything other than `categorize.ts` is unmerged.
- P2: `git checkout a00064e -- apps/api/src/modules/automation/services/categorize.ts`;
  `git add` that single path; confirm staged blob is `2776fb1a`.
- P3: Index-level proof before committing.
- P4: Commit the merge with an explanatory message + full Co-Authored-By trailer.
- P5: Post-commit tree-equality, ancestry, and parent-order proof.

## Files and Symbols
- `apps/api/src/modules/automation/services/categorize.ts` — the ONLY file to be
  resolved. Function `suggestCategoriesFor`, its SQL WHERE clause.
- Reference only, do not modify: `apps/api/src/lib/ledger-sql.ts`
  (`hasCategoryDimension`).

## Key SHAs (verified, use verbatim)
- `origin/main` tip: `a38ab24` — tree `ad137c6052e1896efc8d1f9303bf5df64bc15415`
- branch head: `a00064e` — tree `8e164fe07cf3c9843992ddc0144906d2f15099d3`
- `a00064e`'s parent `1a2f4bc` — tree `ad137c60…` (IDENTICAL to main's tree)
- desired `categorize.ts` blob: `2776fb1a35fdc823226812a11f4f10328252be5e` (108 lines)

## Required Changes
Execute exactly this sequence in `/home/udai/common/compass`, reporting the exact
command and literal output + exit code for EVERY step:

1. `git status --porcelain=v1` and `git rev-parse --abbrev-ref HEAD` (must be
   `feat/postings-pr-g1`). Record the untracked set — it must be unchanged at the end.
2. `git merge origin/main` — expected exit 1 with a conflict in `categorize.ts`.
3. `git diff --name-only --diff-filter=U` and `git ls-files -u`.
   **STOP AND REPORT WITHOUT RESOLVING if any path other than
   `apps/api/src/modules/automation/services/categorize.ts` appears.**
4. `git checkout a00064e -- apps/api/src/modules/automation/services/categorize.ts`
5. `git add apps/api/src/modules/automation/services/categorize.ts`
6. `git ls-files -s apps/api/src/modules/automation/services/categorize.ts` —
   must show stage 0 with blob `2776fb1a35fdc823226812a11f4f10328252be5e`.
7. `git ls-files -u` — must be EMPTY.
8. `git diff --cached --exit-code a00064e` — must exit 0 (report the exit code).
9. `git write-tree` — must print `8e164fe07cf3c9843992ddc0144906d2f15099d3`.
10. `git diff --exit-code` — must exit 0 (no unstaged tracked differences).
11. `git grep -n -e '^<<<<<<< ' -e '^=======$' -e '^>>>>>>> ' --cached -- apps packages`
    — must produce no hits (exit 1 from git grep means "no match", which is the
    PASS case here; report the exit code plainly).
12. **If and only if steps 6-11 all pass**, commit the merge. Use a heredoc-free
    approach with `git commit -F <file>`? NO — instead use repeated `-m` flags so
    nothing extra is written to the repo:

```
git commit -m "Merge origin/main into feat/postings-pr-g1" \
  -m "PR #178 squash-merged this same branch, so main's tree (ad137c60) is
byte-for-byte the tree of a00064e's parent 1a2f4bc. Git's merge-base is the
pre-squash 4f4e964, which makes both sides look like they independently rewrote
the same lines of categorize.ts — a merge-base artifact, not a real divergence." \
  -m "Resolved apps/api/src/modules/automation/services/categorize.ts to the
branch version. main kept the legacy 'and t.category_id is null'; the branch
replaces it with 'not exists (posting on a system account carrying a
category_id)', which is the postings-authoritative expression of
'uncategorized' under PR-G1 — category now lives on the Expenses/Income counter
posting, not on transactions.category_id." \
  -m "The merged tree equals a00064e's tree (8e164fe0) exactly, which proves no
content from main was dropped and nothing from the branch was mangled." \
  -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

13. `git diff --exit-code 'HEAD^{tree}' 'a00064e^{tree}'` — must exit 0.
14. `git merge-base --is-ancestor a38ab24 HEAD` — must exit 0.
15. `git show -s --format='%P' HEAD` — must print `a00064e…` then `a38ab24…`
    (branch parent first, main second).
16. `git show --stat --format='%H %P%n%s' -s HEAD` and `git log --oneline -3`.
17. `git status --porcelain=v1` — untracked set must be unchanged from step 1.

## Must Not Change
- Do NOT modify ANY file's content by hand — not `categorize.ts`, not tests, not
  comments, not `tasks/`. The whole safety argument is exact tree equality with
  `a00064e`. Any hand edit breaks it.
- Do NOT `git add -A`, `git add .`, or any glob. Stage ONLY the one path given.
- Do NOT commit or stage `pnpm-lock.yaml`, `tasks/021-postings-model/*`,
  `tasks/025-pr-g1-remaining/`, `tasks/026-pr-179-merge/`, or any `*.pdf` /
  `data/` / image artifact.
- Do NOT push. Do NOT touch the GitHub PR. Do NOT rebase, reset, cherry-pick,
  amend, or force anything.
- Do NOT run `npm run typecheck/lint/test` — a separate worker verifies.
- Do NOT fix the stale PE5 test or the stale doc comment (tracked as F1/F2).
- If ANY check in steps 6-11 or 13-15 fails, STOP, leave the merge in progress,
  and report. Do NOT improvise a fix and do NOT `git merge --abort` without
  saying so.

## Acceptance Criteria
- AC1: step 13 exits 0 (merged tree == `8e164fe0`).
- AC2: step 14 exits 0.
- AC3: step 11 finds no conflict markers.
- AC4: step 6 shows blob `2776fb1a`, stage 0.
- AC8: step 3 named only `categorize.ts`; step 15 shows `a38ab24` as second
  parent; step 17's untracked set matches step 1.

## Commands
As numbered 1-17 above, in order.

## Required Evidence
- files changed (exact paths)
- the complete `git show` diff of the merge commit relative to `a38ab24`
  (`git show --stat` plus `git diff --stat a38ab24 HEAD`)
- every command above with its literal output and exit code — including the
  exit codes of the `--exit-code` / `--is-ancestor` / `git grep` checks, which
  ARE the proof
- the `git write-tree` SHA verbatim
- any plan deviation or blocker, stated plainly
- final `git status --porcelain=v1`

## Outcome of iteration 1
COMPLETE. Merge commit `ec7177e`, tree `8e164fe0` == `a00064e^{tree}`. All
proofs passed; independently re-verified by a second worker and by Codex
(review-2.md). typecheck 0, lint 0, test exit 1 (26 environment-only failures,
`DATABASE_URL`/`REDIS_URL` unset, 1250 pass, 0 assertion failures).

---

# Sonnet Worker Delegation — iteration 2 (PUSH ONLY — P7/AC9)

## Task
026-pr-179-merge — publish the resolved merge so PR #179 stops being
`CONFLICTING`. **This iteration does NOT merge the PR.** P8/AC10 are withheld
pending a user decision on three CONFIRMED defects in PR #179's own content
(see TASK.md "Post-merge blocking findings" — D6).

## Approved Plan
- P7 only: non-force push of `feat/postings-pr-g1`, then confirm PR #179 becomes
  `MERGEABLE`.

## Files and Symbols
None — no file is edited in this iteration.

## Required Changes
Run in `/home/udai/common/compass`, reporting exact command, literal output and
exit code for each:
1. `git status --porcelain=v1` (must show only the 5 known untracked entries;
   nothing staged, nothing modified) and `git rev-parse HEAD` (must be
   `ec7177e634da8470daa98ff0e90c0a5e077fb3c0`).
2. `git rev-parse 'HEAD^{tree}'` — must still be
   `8e164fe07cf3c9843992ddc0144906d2f15099d3`. If it is not, STOP.
3. `git fetch origin` then `git rev-parse origin/main` — if this is NOT
   `a38ab240508b494c6a92e27cbc309868bd792efa`, main has advanced: STOP and
   report, do not push.
4. `git push origin feat/postings-pr-g1` — plain, NON-FORCE. If git refuses or
   suggests `--force`, STOP and report. Never add `--force`/`--force-with-lease`.
5. `git rev-parse origin/feat/postings-pr-g1` — must equal `ec7177e…`.
6. `gh pr view 179 --repo udai-kiran/PennyPilot --json number,state,mergeable,mergeStateStatus,headRefOid,baseRefName`
   — poll up to 6 times, ~10s apart, until `mergeable` is no longer `UNKNOWN`.
   Report every poll's literal output. Expect `mergeable: MERGEABLE` and
   `headRefOid: ec7177e…`.
7. `gh pr checks 179 --repo udai-kiran/PennyPilot` — report literal output and
   exit code (expected: no checks reported).
8. `git status --porcelain=v1` again — untracked set unchanged.

## Must Not Change
- Do NOT merge PR #179. Do NOT run `gh pr merge` in any form.
- Do NOT force-push, rebase, reset, amend, cherry-pick, or retag.
- Do NOT edit, stage, or commit any file. Nothing is staged in this iteration.
- Do NOT commit/stage `pnpm-lock.yaml` or anything under `tasks/`.
- Do NOT push any branch other than `feat/postings-pr-g1`.
- If `origin/main` has moved past `a38ab24`, STOP — the AC10 tree-equality proof
  and the conflict analysis are both pinned to that base.

## Acceptance Criteria
- AC9: PR #179 reports `mergeable: MERGEABLE` with `headRefOid` = `ec7177e…`.
- Push was non-force and a fast-forward of the remote branch.
- `state` remains `OPEN` (NOT merged).

## Commands
As numbered 1-8 above.

## Required Evidence
- every command with literal output and exit code
- the full literal output of each `gh pr view` poll
- confirmation that no `gh pr merge` was run and no force flag was used
- final `git status --porcelain=v1`
