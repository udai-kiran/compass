# Release v1.97.0 — Stage 2 execution evidence

## STEP 1 — Re-confirm safe to merge

Command: `gh pr checks 160`
```
audit	pass	48s	https://github.com/udai-kiran/PennyPilot/actions/runs/30905019597/job/91977993090	
check	pass	3m16s	https://github.com/udai-kiran/PennyPilot/actions/runs/30905019597/job/91977993096	
publish (api)	pass	1m34s	https://github.com/udai-kiran/PennyPilot/actions/runs/30905019554/job/91977993226	
publish (extractor)	pass	41s	https://github.com/udai-kiran/PennyPilot/actions/runs/30905019554/job/91977993332	
publish (ingestor)	pass	35s	https://github.com/udai-kiran/PennyPilot/actions/runs/30905019554/job/91977993257	
publish (web)	pass	1m39s	https://github.com/udai-kiran/PennyPilot/actions/runs/30905019554/job/91977993140	
```

Command: `gh pr view 160 --json mergeable,mergeStateStatus,state`
```
{"mergeable":"MERGEABLE","mergeStateStatus":"CLEAN","state":"OPEN"}
```

All 6 checks green, mergeStateStatus CLEAN, state OPEN. Safe to proceed.

## STEP 2 — Merge

Command: `gh pr merge 160 --merge`
```
(no stdout output)
```

Confirmed merge via `gh pr view 160 --json state,mergeCommit,mergedAt,mergedBy`:
```
{"mergeCommit":{"oid":"d3155a62ce22051e7c00c08024eae3adc2ac4ec7"},"mergedAt":"2026-08-04T11:35:28Z","mergedBy":{"id":"U_kgDOB7lW1w","is_bot":false,"login":"udai-kiran","name":"Udai Kiran"},"state":"MERGED"}
```

Merge commit SHA: `d3155a62ce22051e7c00c08024eae3adc2ac4ec7` (short: `d3155a6`)

## STEP 3 — checkout main and pull

Command: `git checkout main && git pull`
```
Switched to branch 'main'
Your branch is up to date with 'origin/main'.
From https://github.com/udai-kiran/PennyPilot
   c78fdad..d3155a6  main       -> origin/main
Updating c78fdad..d3155a6
Fast-forward
 apps/api/src/app.ts                                |   15 +-
 ... (77 files changed, 13542 insertions(+), 51 deletions(-))
```

Command: `git log --oneline -3`
```
d3155a6 Merge pull request #160 from udai-kiran/refactor/module-migration-phase1-protection
b4cc143 docs(tasks): add phase-0/1 task records and release checkpoints
02964b5 refactor(api): migrate protection module into modules/ (roadmap 1.4)
```

## STEP 4 — Guard against duplicate tag

Command: `git tag --list 'v1.97.0'`
```
(empty)
```

Command: `git ls-remote --tags origin 'refs/tags/v1.97.0'`
```
(empty)
```

Both empty — safe to create the tag.

## STEP 5 — Create and push tag

Command: `git tag v1.97.0`
```
(exit 0, no output)
```

Command: `git push origin v1.97.0`
```
To https://github.com/udai-kiran/PennyPilot.git
 * [new tag]         v1.97.0 -> v1.97.0
```

## STEP 6 — Verify tag lands on merged commit

Command: `git describe --tags`
```
v1.97.0
```

Exactly `v1.97.0`, no `-N-g<sha>` suffix — tag is on the merged commit `d3155a6`.

## STEP 7 — Publish workflow

Command: `gh run list --limit 5`
```
queued		Merge pull request #160 from udai-kiran/refactor/module-migration-pha…	Publish images	v1.97.0	push	30905463054	4s	2026-08-04T11:35:52Z
queued		Merge pull request #160 from udai-kiran/refactor/module-migration-pha…	CI	main	push	30905439325	25s	2026-08-04T11:35:31Z
queued		Merge pull request #160 from udai-kiran/refactor/module-migration-pha…	Publish images	main	push	30905439318	25s	2026-08-04T11:35:31Z
completed	success	refactor(api): migrate protection module into modules/ (roadmap 1.4)	CI	refactor/module-migration-phase1-protection	pull_request	30905019597	4m58s	2026-08-04T11:29:35Z
completed	success	refactor(api): migrate protection module into modules/ (roadmap 1.4)	Publish images	refactor/module-migration-phase1-protection	pull_request	30905019554	3m56s	2026-08-04T11:29:35Z
```

The tag-triggered publish run is `30905463054` (ref `v1.97.0`, event `push`).

Command: `gh run watch 30905463054 --exit-status`
(full raw output persisted at /home/udai/.claude/projects/-home-udai-PennyPilot/ad09ead0-26c7-444d-9b89-3b727c4e538e/tool-results/b5cui6qd1.txt; final tail below)
```
✓ v1.97.0 Publish images · 30905463054
Triggered via push about 6 minutes ago

JOBS
✓ publish (extractor) in 55s (ID 91979391343)
  ✓ Set up job
  ✓ Run actions/checkout@v5
  ✓ Run echo "version=$(git describe --tags --always --dirty 2>/dev/null || echo dev)" >> "$GITHUB_OUTPUT"
  ✓ Run docker/setup-buildx-action@v3
  ✓ Run docker/login-action@v3
  ✓ Run docker/metadata-action@v5
  ✓ Run docker/build-push-action@v6
  ✓ Post Run docker/build-push-action@v6
  ✓ Post Run docker/login-action@v3
  ✓ Post Run docker/setup-buildx-action@v3
  ✓ Post Run actions/checkout@v5
  ✓ Complete job
✓ publish (web) in 1m50s (ID 91979391373)
  ✓ Set up job
  ✓ Run actions/checkout@v5
  ✓ Run echo "version=$(git describe --tags --always --dirty 2>/dev/null || echo dev)" >> "$GITHUB_OUTPUT"
  ✓ Run docker/setup-buildx-action@v3
  ✓ Run docker/login-action@v3
  ✓ Run docker/metadata-action@v5
  ✓ Run docker/build-push-action@v6
  ✓ Post Run docker/build-push-action@v6
  ✓ Post Run docker/login-action@v3
  ✓ Post Run docker/setup-buildx-action@v3
  ✓ Post Run actions/checkout@v5
  ✓ Complete job
✓ publish (ingestor) in 50s (ID 91979391394)
  ✓ Set up job
  ✓ Run actions/checkout@v5
  ✓ Run echo "version=$(git describe --tags --always --dirty 2>/dev/null || echo dev)" >> "$GITHUB_OUTPUT"
  ✓ Run docker/setup-buildx-action@v3
  ✓ Run docker/login-action@v3
  ✓ Run docker/metadata-action@v5
  ✓ Run docker/build-push-action@v6
  ✓ Post Run docker/build-push-action@v6
  ✓ Post Run docker/login-action@v3
  ✓ Post Run docker/setup-buildx-action@v3
  ✓ Post Run actions/checkout@v5
  ✓ Complete job
✓ publish (api) in 50s (ID 91979391414)
  ✓ Set up job
  ✓ Run actions/checkout@v5
  ✓ Run echo "version=$(git describe --tags --always --dirty 2>/dev/null || echo dev)" >> "$GITHUB_OUTPUT"
  ✓ Run docker/setup-buildx-action@v3
  ✓ Run docker/login-action@v3
  ✓ Run docker/metadata-action@v5
  ✓ Run docker/build-push-action@v6
  ✓ Post Run docker/build-push-action@v6
  ✓ Post Run docker/login-action@v3
  ✓ Post Run docker/setup-buildx-action@v3
  ✓ Post Run actions/checkout@v5
  ✓ Complete job
```

Final status — all four images built successfully:
- api: success, 50s
- web: success, 1m50s
- ingestor: success, 50s
- extractor: success, 55s

Overall run `30905463054`: success.

## STEP 8 — Final state

Command: `git status --porcelain`
```
?? tasks/001-engineer-routing-memory/
?? tasks/013-release-v1.97.0/ci-1.md
?? tasks/013-release-v1.97.0/commit-pr-1.md
```

Note: `tasks/013-release-v1.97.0/ci-1.md` and `tasks/013-release-v1.97.0/commit-pr-1.md` were present before this session started (filesystem timestamps 2026-08-04 11:30:34 and 11:34:56, both prior to when this release-execution session began work) — they were not created during this task and were not written by this worker. Only `tasks/001-engineer-routing-memory/` was expected per the brief; the two extra files are pre-existing untracked artifacts from an earlier stage of the release workflow, flagged here for visibility. No files were staged or committed.

Command: `git log --oneline -3`
```
d3155a6 Merge pull request #160 from udai-kiran/refactor/module-migration-phase1-protection
b4cc143 docs(tasks): add phase-0/1 task records and release checkpoints
02964b5 refactor(api): migrate protection module into modules/ (roadmap 1.4)
```

Command: `git describe --tags`
```
v1.97.0
```

## Summary

- Merge commit: `d3155a62ce22051e7c00c08024eae3adc2ac4ec7` (`d3155a6`)
- Tag `v1.97.0` created and pushed, points exactly at the merged commit (verified via clean `git describe --tags` with no suffix)
- Publish workflow run `30905463054` completed successfully: api (50s), web (1m50s), ingestor (50s), extractor (55s)
- No files staged or committed by this worker beyond writing this evidence file
- Unresolved item: two untracked files (`ci-1.md`, `commit-pr-1.md`) in `tasks/013-release-v1.97.0/` existed before this session and were not part of the brief's expected untracked-file list — flagged, not acted on
