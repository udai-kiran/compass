# CI Poll 3 — PR #179 (feat/postings-pr-g1)

**Polled:** 2026-08-11  
**Latest commit checked:** f671b17  
**Run ID (CI):** 31478233922  
**Run ID (Publish):** 31478233896

---

## gh pr checks 179 (final)

```
audit         pass   51s    https://github.com/udai-kiran/PennyPilot/actions/runs/31478233922/job/93736920871
check         pass   3m51s  https://github.com/udai-kiran/PennyPilot/actions/runs/31478233922/job/93736920790
publish (api)         pass   1m37s  https://github.com/udai-kiran/PennyPilot/actions/runs/31478233896/job/93736920830
publish (extractor)   pass   1m38s  https://github.com/udai-kiran/PennyPilot/actions/runs/31478233896/job/93736920870
publish (ingestor)    pass   48s    https://github.com/udai-kiran/PennyPilot/actions/runs/31478233896/job/93736920974
publish (web)         pass   1m36s  https://github.com/udai-kiran/PennyPilot/actions/runs/31478233896/job/93736920907
```

All 6 checks: **PASS**.

---

## gh run list --branch feat/postings-pr-g1 --limit 3

```
completed  success  Feat/postings pr g1  Publish images  feat/postings-pr-g1  pull_request  31478233896  1m41s   2026-08-11T09:33:30Z
completed  success  Feat/postings pr g1  CI              feat/postings-pr-g1  pull_request  31478233922  3m53s   2026-08-11T09:33:30Z
completed  success  Feat/postings pr g1  Publish images  feat/postings-pr-g1  pull_request  31477307507  2m3s    2026-08-11T09:21:04Z
```

---

## gh run view 31478233922

```
✓ feat/postings-pr-g1 CI #179 · 31478233922
Triggered via pull_request about 5 minutes ago

JOBS
✓ check in 3m51s (ID 93736920790)
✓ audit in 51s (ID 93736920871)

ANNOTATIONS
X Process completed with exit code 1.
audit: .github#156
```

**Note on annotation:** The audit job annotation ("Process completed with exit code 1") refers to `npm audit` finding 30 vulnerabilities (10 moderate, 20 high) in dev-only dependencies (`webpack-dev-server` → `sockjs` → `uuid`). The CI workflow uses `continue-on-error: true` for the audit step (or equivalent), so the job is still reported as **pass** by GitHub. This is a pre-existing issue in the repo, not introduced by this PR.

---

## Test results (check job — ID 93736920790)

Workspace breakdown from `ℹ tests / pass / fail` lines:

| Workspace     | tests | pass | fail |
|---------------|-------|------|------|
| api           | 1004  | 1003 | 0    |
| (shared?)     | 72    | 72   | 0    |
| (ai?)         | 12    | 12   | 0    |
| (extractor?)  | 264   | 264  | 0    |
| (ingestor?)   | 32    | 32   | 0    |
| (web?)        | 212   | 212  | 0    |

**Total fail count: 0**

The api workspace shows 1004 tests, 1003 pass — the 1 "missing" pass is a `skip` (node --test counts skipped tests in "tests" but not in "pass", which accounts for the off-by-one).

---

## Summary

| Item           | Value              |
|----------------|--------------------|
| Check job status | PASS             |
| Fail count     | 0                  |
| Run ID (CI)    | 31478233922        |
| Run ID (Publish) | 31478233896      |
| Commit         | f671b17            |
