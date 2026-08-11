# CI Poll #2 — PR #179 (feat/postings-pr-g1)

Polled: 2026-08-11. Latest commit: f57d7d5.

---

## `gh pr checks 179` output (literal)

```
publish (ingestor)	pass	1m13s	https://github.com/udai-kiran/PennyPilot/actions/runs/31477307507/job/93733882715
publish (web)	pass	1m59s	https://github.com/udai-kiran/PennyPilot/actions/runs/31477307507/job/93733882750
check	pass	4m8s	https://github.com/udai-kiran/PennyPilot/actions/runs/31477307551/job/93733882324
audit	pass	49s	https://github.com/udai-kiran/PennyPilot/actions/runs/31477307551/job/93733882354
publish (api)	pass	1m18s	https://github.com/udai-kiran/PennyPilot/actions/runs/31477307507/job/93733882647
publish (extractor)	pass	1m41s	https://github.com/udai-kiran/PennyPilot/actions/runs/31477307507/job/93733882681
```

(Exit code 8 from `gh pr checks` is normal when any check was ever in a non-success state during polling; all checks are now `pass`.)

---

## Run ID

CI run ID: **31477307551** (the `CI` workflow run)

---

## `gh run view 31477307551` summary

```
✓ feat/postings-pr-g1 CI #179 · 31477307551
Triggered via pull_request about 4 minutes ago

JOBS
✓ check in 4m8s (ID 93733882324)
✓ audit in 49s (ID 93733882354)

ANNOTATIONS
X Process completed with exit code 1.
audit: .github#156
```

Note: the audit annotation is expected — the workflow has `continue-on-error: true` for the `npm audit --audit-level=high` step (line 70 in `.github/workflows/ci.yml`). The audit job still reports `pass` overall. The audit found 30 vulnerabilities (10 moderate, 20 high) but none block the job.

---

## Literal `ℹ tests / pass / fail` lines (all workspaces, in run order)

```
ℹ tests 1004
ℹ pass  1003
ℹ fail  0
ℹ skipped 1
ℹ duration_ms 96789.992917

ℹ tests 72
ℹ pass  72
ℹ fail  0
ℹ skipped 0
ℹ duration_ms 4801.271286

ℹ tests 12
ℹ pass  12
ℹ fail  0
ℹ skipped 0

ℹ tests 264
ℹ pass  264
ℹ fail  0
ℹ skipped 0

ℹ tests 32
ℹ pass  32
ℹ fail  0
ℹ skipped 0
ℹ duration_ms 2115.258882

ℹ tests 212
ℹ pass  212
ℹ fail  0
ℹ skipped 0
ℹ duration_ms 2995.94417
```

**Aggregate: tests 1596, pass 1595, fail 0, skipped 1**

---

## Failures

**None.** Zero test failures across all workspaces.

The 1 skipped test is not a failure; no assertion text was emitted.

---

## Conclusion

All CI checks green. PR #179 on feat/postings-pr-g1 at commit f57d7d5 passes typecheck, lint, migration, all tests (0 fail), and web/docs build.
