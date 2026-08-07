# state-1.md — Postings Model Pre-cutover Baseline

Generated: 2026-08-06 (investigation only, no files changed)

---

## Step 1 — git status

Command: `git status --porcelain=v1 | head -100`

```
?? tasks/013-release-v1.97.0/commit-pr-final.md
?? tasks/015-statusline/
?? tasks/018-migrate-system/commit-log.md
?? tasks/020-cross-module-ports/release-log.md
?? tasks/021-postings-model/COMMIT_MSG.txt
?? tasks/021-postings-model/PR_BODY.md
?? tasks/BATCH-phase1-close.md
```

Command: `git status`

```
On branch main
Your branch is up to date with 'origin/main'.

Untracked files:
  (use "git add <file>..." to include in what while be committed)
	tasks/013-release-v1.97.0/commit-pr-final.md
	tasks/015-statusline/
	tasks/018-migrate-system/commit-log.md
	tasks/020-cross-module-ports/release-log.md
	tasks/021-postings-model/COMMIT_MSG.txt
	tasks/021-postings-model/PR_BODY.md
	tasks/BATCH-phase1-close.md

nothing added to commit but untracked files present (use "git add" to track)
```

**Verdict: Working tree is CLEAN (only untracked task/scratch files, no modified tracked files).**

---

## Step 2 — Branch and recent commits

Command: `git branch --show-current`

```
main
```

Command: `git log --oneline -8`

```
e939100 Merge pull request #166 from udai-kiran/feat/postings-model-sp0
9130b85 feat(api): postings model SP0 — pure zero-sum builders + projection helpers (roadmap 2.1)
4e0182a Merge pull request #165 from udai-kiran/refactor/module-migration-phase1-close
e58dbe1 refactor(api): physical per-module schema ownership + flat-services cleanup (roadmap 1.9)
cfc36b5 refactor(api): migrate ingest and system modules into modules/ (roadmap 1.7, 1.8)
825705d test(api): add Storage backend contract tests (roadmap 1.10)
5031b88 Merge pull request #164 from udai-kiran/refactor/module-migration-phase1-automation
a219cbc refactor(api): migrate automation/AI module into modules/automation (roadmap 1.6)
```

---

## Step 3 — Commit 9130b85 existence

Command: `git cat-file -t 9130b85`
```
commit
```
Exit code: 0

Command: `git log --oneline | grep 9130b85`
```
9130b85 feat(api): postings model SP0 — pure zero-sum builders + projection helpers (roadmap 2.1)
```

**Verdict: Commit 9130b85 EXISTS on main, merged via PR #166 (e939100).**

---

## Step 4 — SP0 files tracked

Command: `git ls-files apps/api/src/modules/ledger/services/postings.ts apps/api/src/modules/ledger/services/postings.test.ts packages/shared/src/money.ts`

```
apps/api/src/modules/ledger/services/postings.test.ts
apps/api/src/modules/ledger/services/postings.ts
packages/shared/src/money.ts
```

All three SP0 files are tracked (committed to the index).

Command: `git log --oneline -3 -- apps/api/src/modules/ledger/services/postings.ts`

```
9130b85 feat(api): postings model SP0 — pure zero-sum builders + projection helpers (roadmap 2.1)
```

Command: `git log --oneline -3 -- apps/api/src/modules/ledger/services/postings.test.ts`

```
9130b85 feat(api): postings model SP0 — pure zero-sum builders + projection helpers (roadmap 2.1)
```

Both files were introduced in SP0 commit 9130b85 only. No prior history.

---

## Step 5 — Uncommitted changes

Command: `git stash list`

```
stash@{0}: On fix/db-app-role-table-ownership: wip: insurance feature (settings)
```

One stash exists on a different branch (not main), unrelated.

Command: `git diff --stat HEAD | tail -5`

(No output — empty)

**Verdict: Zero uncommitted changes to tracked files. Working tree perfectly matches HEAD (e939100).**
The only "changes" in `git status` from the brief's initial snapshot were already committed before this investigation started (PRs #165, #166 are both merged on main). The `gitStatus` snapshot in the system prompt showed modified files that have since been committed.

---

## Step 6 — Baseline test numbers

### apps/api tests

Command: `npm run test -w apps/api 2>&1 | tail -25`

```
✔ toFamilyMember does not leak userId/createdAt/updatedAt (0.349506ms)
✔ toFamilyMember passes through null fields (0.239201ms)
✔ UserProfileSchema accepts null dateOfBirth (1.292941ms)
✔ UserProfileSchema accepts ISO date string (0.75189ms)
✔ UserProfileSchema rejects non-ISO date (1.297137ms)
✔ UpdateUserProfileSchema is same as UserProfileSchema (0.627603ms)
✔ CreateFamilyMemberSchema applies null defaults (1.965622ms)
✔ UpdateFamilyMemberSchema rejects expectedCompletionYear out of range (3.249245ms)
✔ UpdateFamilyMemberSchema accepts expectedCompletionYear in range (1.155236ms)
✔ UpdateUserProfileSchema round-trips a dateOfBirth (0.564168ms)
✔ UpdateUserProfileSchema rejects an empty string for dateOfBirth (0.802765ms)
✔ UpdateUserProfileSchema accepts null to clear dateOfBirth (0.494154ms)
✔ User profile DOB save/reload flow: round-trip through service layer (2.569677ms)
✔ bucketFor: auth endpoints get the tight brute-force bucket (2.467963ms)
✔ bucketFor: mutations use the write bucket, reads the read bucket (0.432391ms)
✔ auth bucket is the strictest of the three (0.423993ms)
✔ hostOf: extracts hostname without port, null on garbage (0.614611ms)
ℹ tests 903
ℹ suites 2
ℹ pass 902
ℹ fail 0
ℹ cancelled 0
ℹ skipped 1
ℹ todo 0
ℹ duration_ms 7614.488889
```

Exit code: 0

**apps/api: 903 tests, 902 pass, 0 fail, 1 skipped. PASSING.**

### apps/extractor tests

Command: `npm run test -w apps/extractor 2>&1 | tail -25`

```
    at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:101:5)

Node.js v24.18.0
✖ src/statement-duplicate.test.ts (447.880191ms)
ℹ tests 63
ℹ suites 0
ℹ pass 62
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 512.047045

✖ failing tests:

test at src/statement-duplicate.test.ts:1:1
✖ src/statement-duplicate.test.ts (447.880191ms)
  'test failed'
npm error Lifecycle script `test` failed with error:
npm error code 1
npm error path /home/udai/PennyPilot/apps/extractor
npm error workspace @compass/extractor@0.1.0
npm error location /home/udai/PennyPilot/apps/extractor
npm error command failed
npm error command sh -c node --test "src/**/*.test.ts"
```

Exit code: 1

Failure detail from `npm run test -w apps/extractor 2>&1 | grep -A 20 "statement-duplicate"`:

```
file:///home/udai/PennyPilot/apps/extractor/src/statement-duplicate.test.ts:30
    throw new Error(
          ^

Error: statement-duplicate.test.ts needs DATABASE_URL set (a real Postgres connection) — this repo has no DB-mocking infrastructure. Export it (see apps/extractor/.env) before running `npm run test -w apps/extractor`.
    at requireDatabaseUrl (file:///home/udai/PennyPilot/apps/extractor/src/statement-duplicate.test.ts:30:11)
    at file:///home/udai/PennyPilot/apps/extractor/src/statement-duplicate.test.ts:39:25
    at ModuleJob.run (node:internal/modules/esm/module_job:439:25)
    at async node:internal/modules/esm/loader:643:26
    at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:101:5)
```

**apps/extractor: 63 tests, 62 pass, 1 fail, 0 skipped. FAILING — but it's a pre-existing infrastructure failure in `statement-duplicate.test.ts` that requires a live DATABASE_URL (not available in this dev environment). This failure is unrelated to the postings model work.**

---

## Step 7 — Latest migration

Command: `ls apps/api/drizzle/ | tail -5`

```
0063_cheerful_switch.sql
0064_happy_zzzax.sql
0065_smiling_tana_nile.sql
0066_eager_spectrum.sql
meta
```

**Latest migration: 0066_eager_spectrum.sql. Confirmed — 0066 is the newest.**

---

## Summary

| Item | Finding |
|---|---|
| Branch | main |
| HEAD | e939100 (Merge PR #166) |
| Commit 9130b85 | EXISTS — SP0 merged on main via PR #166 |
| SP0 files tracked | All 3: postings.ts, postings.test.ts, money.ts |
| Uncommitted tracked changes | NONE (working tree clean) |
| apps/api tests | 903 total, 902 pass, 0 fail, 1 skip — PASSING |
| apps/extractor tests | 63 total, 62 pass, 1 fail — FAILING (pre-existing: needs live DB) |
| Latest migration | 0066_eager_spectrum.sql |
