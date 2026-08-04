# CI watch — PR #160

## `gh pr checks 160 --watch` (exit 0) — final table
audit	pass	48s	https://github.com/udai-kiran/PennyPilot/actions/runs/30905019597/job/91977993090
check	pass	3m16s	https://github.com/udai-kiran/PennyPilot/actions/runs/30905019597/job/91977993096
publish (api)	pass	1m34s	https://github.com/udai-kiran/PennyPilot/actions/runs/30905019554/job/91977993226
publish (extractor)	pass	41s	https://github.com/udai-kiran/PennyPilot/actions/runs/30905019554/job/91977993332
publish (ingestor)	pass	35s	https://github.com/udai-kiran/PennyPilot/actions/runs/30905019554/job/91977993257
publish (web)	pass	1m39s	https://github.com/udai-kiran/PennyPilot/actions/runs/30905019554/job/91977993140

## `gh pr checks 160` (post-watch confirmation, exit 0)
audit	pass	48s	https://github.com/udai-kiran/PennyPilot/actions/runs/30905019597/job/91977993090
check	pass	3m16s	https://github.com/udai-kiran/PennyPilot/actions/runs/30905019597/job/91977993096
publish (api)	pass	1m34s	https://github.com/udai-kiran/PennyPilot/actions/runs/30905019554/job/91977993226
publish (extractor)	pass	41s	https://github.com/udai-kiran/PennyPilot/actions/runs/30905019554/job/91977993332
publish (ingestor)	pass	35s	https://github.com/udai-kiran/PennyPilot/actions/runs/30905019554/job/91977993257
publish (web)	pass	1m39s	https://github.com/udai-kiran/PennyPilot/actions/runs/30905019554/job/91977993140

## No failures — step 3 (gh run view --log-failed) skipped, nothing to fetch.

## `gh pr view 160 --json mergeable,mergeStateStatus,state` (exit 0)
{"mergeStateStatus":"CLEAN","mergeable":"MERGEABLE","state":"OPEN"}
