# Release checkpoint — merge PR #159, cut v1.96.0

## Step 1 — merge PR #159

Command: `gh pr view 159 --json state,mergeable,mergeStateStatus`
```
{"mergeStateStatus":"CLEAN","mergeable":"MERGEABLE","state":"OPEN"}
```
Confirmed OPEN and MERGEABLE. Proceeded.

Command: `gh pr merge 159 --merge --delete-branch`
```
From https://github.com/udai-kiran/PennyPilot
 * branch            main       -> FETCH_HEAD
   5b3f499..c78fdad  main       -> origin/main
Updating 5b3f499..c78fdad
Fast-forward
 .gitignore                                         |    2 +
 apps/api/src/app.route-snapshot.test.ts            |  106 +-
 ... (163 files changed, 16841 insertions(+), 4144 deletions(-))
```
Exit code: 0

Command: `gh pr view 159 --json state,mergedAt,mergeCommit,baseRefName,headRefName`
```
{"baseRefName":"main","headRefName":"refactor/module-migration-phase1-ledger-credit-investments","mergeCommit":{"oid":"c78fdadb6ff0b0243461b81359831fac61d90baa"},"mergedAt":"2026-08-04T09:52:23Z","state":"MERGED"}
```

**Merge commit SHA: `c78fdadb6ff0b0243461b81359831fac61d90baa`** — created as a merge commit (not squash/rebase), matching repo history style.

## Step 2 — sync main

```
$ git checkout main
Already on 'main'
Your branch is up to date with 'origin/main'.

$ git pull origin main
From https://github.com/udai-kiran/PennyPilot
 * branch            main       -> FETCH_HEAD
Already up to date.

$ git log --oneline -4
c78fdad Merge pull request #159 from udai-kiran/refactor/module-migration-phase1-ledger-credit-investments
41845e5 refactor(api): migrate ledger, credit and investments into modules/ (roadmap 1.1-1.3)
e59199b chore: ignore private statement PDFs and pasted images
fd6cb97 chore(deps): clear high-severity fast-uri and ip-address advisories

$ git status --porcelain
?? tasks/00.01-00.02-verification-1.md
?? tasks/000-agent-harness/
?? tasks/001-domain-event-bus/
?? tasks/001-engineer-routing-memory/
?? tasks/002-resume-refactor/
?? tasks/002-retire-url-regex-hook/
?? tasks/003-demo-monthday-utc-fix/
?? tasks/004-fix-eslint-no-undef/
?? tasks/005-fix-api-test-env-loading/
?? tasks/006-module-scaffold-and-route-gate/
?? tasks/012-release-checkpoint/
```
Merge commit `c78fdad` is at the top of `git log`. Only untracked `tasks/` scratch directories remain — no tracked file is modified. Confirmed OK to proceed.

## Step 3 — guard against a duplicate tag

```
$ git tag -l "v1.96.0"
(empty)

$ git ls-remote --tags origin "refs/tags/v1.96.0"
(empty)
```
Both empty — no existing `v1.96.0` tag locally or on remote. Safe to proceed.

## Step 4 — tag and push

```
$ git tag -a v1.96.0 -m "v1.96.0 — module migration phase 1: ledger, credit, investments"
(exit 0)

$ git push origin v1.96.0
To https://github.com/udai-kiran/PennyPilot.git
 * [new tag]         v1.96.0 -> v1.96.0
(exit 0)

$ git describe --tags
v1.96.0
```
Reports exactly `v1.96.0` with no `-N-g` suffix.

## Step 5 — confirm the release build

Command: `gh run list --workflow=publish.yml --limit 5`
```
queued		Merge pull request #159 from udai-kiran/refactor/module-migration-pha…	Publish images	v1.96.0	push	30898241125	1s	2026-08-04T09:52:50Z
queued		Merge pull request #159 from udai-kiran/refactor/module-migration-pha…	Publish images	main	push	30898213578	24s	2026-08-04T09:52:27Z
completed	success	refactor(api): migrate ledger, credit and investments into modules/ (roadmap 1.1-1.3)	Publish images	refactor/module-migration-phase1-ledger-credit-investments	pull_request	30897468867	9m1s	2026-08-04T09:42:12Z
completed	success	Merge pull request #158 from udai-kiran/docs/roadmap-2.0-task-board	Publish images	v1.95.0	push	30817167683	4m31s	2026-08-03T13:16:12Z
completed	success	Merge pull request #158 from udai-kiran/docs/roadmap-2.0-task-board	Publish images	main	push	30816784176	4m30s	2026-08-03T13:11:16Z
```

**Run triggered by the `v1.96.0` tag: run ID `30898241125`** (headBranch `v1.96.0`, event `push`).

Watched via `gh run watch 30898241125 --exit-status` (ran in background; also polled `gh run view 30898241125` directly). Note: this run and the `main`-push run (`30898213578`) were both queued initially, and only 2 self-hosted runners (`dkube`, `dkube-2`) were online — both busy running the `main` push's jobs first. Once `30898213578` completed (success), runners picked up `30898241125`'s jobs.

Final state — `gh run view 30898241125`:
```
✓ v1.96.0 Publish images · 30898241125
Triggered via push about 9 minutes ago

JOBS
✓ publish (ingestor) in 59s (ID 91956175203)
✓ publish (api) in 1m8s (ID 91956175206)
✓ publish (web) in 2m41s (ID 91956175211)
✓ publish (extractor) in 1m9s (ID 91956175292)

ANNOTATIONS
! Node.js 20 is deprecated. The following actions target Node.js 20 but are being forced to run on Node.js 24: docker/build-push-action@v6, docker/login-action@v3, docker/metadata-action@v5, docker/setup-buildx-action@v3. For more information see: https://github.blog/changelog/2025-09-19-deprecation-of-node-20-on-github-actions-runners/
publish (ingestor): .github#2
publish (api): .github#2
publish (web): .github#2
publish (extractor): .github#2

ARTIFACTS
udai-kiran~PennyPilot~HCAGPY.dockerbuild
udai-kiran~PennyPilot~OEJ4A9.dockerbuild
udai-kiran~PennyPilot~MCX2T6.dockerbuild
udai-kiran~PennyPilot~LMDT5B.dockerbuild
```

**Every job in run `30898241125` concluded `success`:** `publish (ingestor)`, `publish (api)`, `publish (web)`, `publish (extractor)`. No failed jobs — no failure-log capture needed.

## Summary

- PR #159 merged via merge commit `c78fdadb6ff0b0243461b81359831fac61d90baa` (topic branch deleted by `--delete-branch`).
- `main` synced locally; merge commit confirmed at HEAD; no tracked-file modifications.
- No pre-existing `v1.96.0` tag locally or on remote.
- Tag `v1.96.0` created (annotated) and pushed; `git describe --tags` reports exactly `v1.96.0`.
- Publish workflow run `30898241125` (triggered by the `v1.96.0` tag push) completed with all 4 jobs (`ingestor`, `api`, `web`, `extractor`) concluding `success`.

## Assumptions
- The Node.js 20 deprecation annotations on each job are pre-existing workflow warnings unrelated to this release; not investigated further per brief scope.

## Unresolved risks
- None identified for this release-checkpoint action. The queueing delay was due to only 2 self-hosted runners being online and both busy with the concurrent `main`-push publish run; it resolved once that run finished and did not require intervention.
