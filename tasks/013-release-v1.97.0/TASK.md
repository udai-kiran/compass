# Task: v1.97.0 release — commit, PR, merge, tag

## Status
COMPLETE — v1.97.0 shipped

## Outcome
- Commits `02964b5` (protection migration, 22 files, +2529/-51) and `b4cc143` (task records, 55 files,
  +11013) on branch `refactor/module-migration-phase1-protection`.
- PR #160 merged as merge commit **`d3155a6`**, matching repo history style. All 6 checks green:
  `audit` 48s, `check` 3m16s, `publish` api/web/ingestor/extractor.
- The `check` job passing again confirms the `apps/extractor` `DATABASE_URL` failure is **local-only** —
  CI provisions a DB — exactly as task 012 predicted.
- Tag `v1.97.0` created after merge and pushed; `git describe --tags` reports `v1.97.0` clean, no
  `-N-g` suffix. Duplicate-tag guard checked local and remote first, both empty.
- Publish run `30905463054` succeeded: api 50s, web 1m50s, ingestor 50s, extractor 55s.
- **AC2 held:** `tasks/001-engineer-routing-memory/` was never staged and remains untracked. Both
  pre-commit greps for `.pdf|data/|.env|Pasted image|001-engineer-routing-memory` returned no matches.

### Loose end (cosmetic, not a defect)
`ci-1.md`, `commit-pr-1.md` and `release-1.md` under this directory are untracked: commit 2 staged
`tasks/013-release-v1.97.0` *before* those files existed. The release record is therefore on disk but
not in git. Harmless — committing them now would put `main` one commit ahead of the `v1.97.0` tag.

### Contrast with task 012
Both blockers that stopped the previous release were gone this time: `gh auth` valid (exit 0), and the
`npm audit --omit=dev --audit-level=high` hard gate clean at 0 vulnerabilities. No `audit fix` needed.

## Follow-up release: v1.98.0 (the redaction)
- Commit `7ac03c1`, PR #161, merged as **`77fa613`**. All 6 checks green.
- Tag `v1.98.0` cut after merge; `git describe --tags` exactly `v1.98.0`. Publish run `30918779561`
  built all four images (web 2m23s, ingestor 49s, api 57s, extractor 1m4s).
- No application code changed — `apps/` and `packages/` untouched.

## Second coordinator error, recorded — an unsatisfiable gate
The first attempt at the redaction commit specified a gate of the form
`git diff --cached | grep '<the redacted strings>'` must return **no matches**. That is impossible for
a redaction: a unified diff always shows the removed text on `-` lines, so the gate can never pass for
any genuine textual redaction. The worker **correctly STOPPED** rather than reinterpreting it, and said
so precisely. The staging was right; the gate was wrong.

Corrected to inspect added lines only: `git diff --cached | grep '^+' | grep '<strings>'` → exit 1.

This is the **same failure mode as task 012's `--numstat` gate**: gating on a metric that does not
measure the property being asserted. Verify the gate matches the claim before blocking on it — and
note that both times the worker stopping was the behaviour that saved it.

## Coordinator error, recorded
Excluding `tasks/001-engineer-routing-memory/` did **not** keep the credential out of history. Two
files that *documented* the finding quoted the offending strings verbatim, and both were committed in
`b4cc143` (merged `d3155a6`, inside tag `v1.97.0`):
- `tasks/013-release-v1.97.0/secret-scan-1.md` — the scan report quoted every matching line.
- `tasks/013-release-v1.97.0/TASK.md` — this file's own secret-scan section did the same.

Both are now redacted, but **the strings remain in git history and in the `v1.97.0` tag.**

Lesson: a secret-scan report is itself a secret-bearing artefact. Redact at the point of writing, cite
`file:line` and classification without reproducing the value, and scan the *report* before committing
it. Excluding the source file is not sufficient when the finding is documented elsewhere.

**The string propagated four times before this was under control**, every time through *discussing* the
incident rather than through the original source: (1) the scan report quoting its own findings, (2) this
task record's summary of that report, (3) a "recommended mitigation" sentence naming the weak default,
and (4) a quoted `grep` **pattern** in the post-mortem above. Writing about a secret reproduces it.
Anything describing this incident must refer to the values by placeholder only — which is now the rule
for this file.

Corrected assessment of what was actually newly disclosed:
- credential pair + MinIO host IP — genuinely new to history
- `192.168.2.196` — already in committed `.env.example:18,20`
- bucket name — already in committed `apps/api/src/config.ts:21` as the `S3_BUCKET` default

History rewrite was **not** chosen: the repo is private, and rewriting would break the published
`v1.97.0` tag and the merged PR. The durable mitigation is credential rotation, which is the user's
call and is host-side.

## Remaining (operator, outside this repo)
- Bump `COMPASS_VERSION` on the host and run `make update`.
- **Recommended:** rotate the dev Postgres password. The exposed pair is a weak default regardless of
  this incident, and rotation neutralises the history exposure without a rewrite.

## Objective
Bank the completed roadmap 1.4 (protection module migration) plus the accumulated task records as
commits on a branch, open a PR, get CI green, merge, then tag `v1.97.0`.

## Decisive facts (preflight-1.md, coordinator-verified)
- Branch `main`, HEAD `c78fdad`, exactly on tag `v1.96.0` (no offset). **Next tag: `v1.97.0`.**
- **NOT 2.0.0** — roadmap `03.02` reserves that for the end of Phase 3 (`depends: [3.1]`). We are at
  task 1.4 of Phase 1. Same reasoning task 012 recorded; unchanged.
- `gh auth status` exit 0, user `udai-kiran`, scopes `gist, read:org, repo, workflow`. **The blocker
  that stopped the last release is gone** — but note the scopes still lack `write:packages`, which
  only matters for manual image pushes, not CI.
- `npm audit --omit=dev --audit-level=high` → **0 vulnerabilities, exit 0.** The hard gate that broke
  the last release currently passes; no `audit fix` needed.
- `git status --porcelain` = 29 lines: 5 ` M`, 4 ` D`, 20 `??`. Scoped to `apps/`+`packages/` it is
  exactly the protection migration and nothing else.
- Private artifacts confirmed **ignored, not tracked**: `*.pdf`, `Pasted image*`, `data/`, `.env`.
- Repo is **PRIVATE** (`udai-kiran/PennyPilot`, `isPrivate: true`).

## Root Cause
Not applicable — a release, not a fix.

### Secret-scan finding (secret-scan-1.md; coordinator-verified by direct read)
Scanning the 66 candidate task files (800 KB) before staging found one genuinely new disclosure:

**`tasks/001-engineer-routing-memory/` reproduces the user's private agent `MEMORY.md` verbatim** —
`verification-1.md:84` carries a literal dev Postgres/Redis `<REDACTED-CREDENTIAL-PAIR>` at
`192.168.2.196`, plus the MinIO host `<REDACTED-HOSTNAME>` / `<REDACTED-INTERNAL-IP>` and its bucket,
the CI runner count, and a note about the `gh` token's missing scope. `new-memory-content.md` is memory
content by its very purpose.

Verified against committed history: `192.168.2.196` **already** appears in `.env.example:18,20` (with a
`CHANGE_ME` placeholder credential) and in `tasks/010-migrate-investments/implementation-1.md:227`, so
the bare IP is not a new disclosure. But the credential pair and the MinIO host IP had **zero** matches
in history — they would be new. (The bucket name turned out to be already public via
`apps/api/src/config.ts:21`'s `S3_BUCKET` default.)

**Decision: exclude `tasks/001-engineer-routing-memory/` from the commit entirely** (all 4 files). It is
agent-harness scratch about memory management, not project history, and the repo being private today is
not a reason to bank a credential dump that a future visibility flip would expose. It stays untracked
locally. The remaining INTERNAL-BUT-SENSITIVE hits are all the already-committed `192.168.2.196`, so
they add nothing new and are accepted.

## Scope
Two focused commits on branch `refactor/module-migration-phase1-protection`.

**Commit 1** — `refactor(api): migrate protection into modules/ (roadmap 1.4)`
- `apps/api/src/app.ts` (M)
- `apps/api/src/routes/insurance.ts`, `apps/api/src/routes/retirement.ts`,
  `apps/api/src/services/insurance.ts`, `apps/api/src/services/retirement.ts` (D — 4 deletions)
- `apps/api/src/modules/protection/` (9 new files: `schema.ts`, `schema.smoke.test.ts`, `plugin.ts`,
  `plugin.test.ts`, `routes/{insurance,retirement,protection.route.test}.ts`,
  `services/{insurance,retirement}.ts`)
- `tasks/01.04-migrate-protection.md` (M), `tasks/01.09-cross-module-ports.md` (M),
  `tasks/README.md` (M), `tasks/01.10-storage-backend-contract-tests.md` (new)
- `tasks/011-migrate-protection/` (TASK.md M + 7 new artefacts)

**Commit 2** — `docs(tasks): add phase-0/1 task records and release checkpoints`
- `tasks/00.01-00.02-verification-1.md`, `tasks/000-agent-harness/`, `tasks/001-domain-event-bus/`,
  `tasks/002-resume-refactor/`, `tasks/002-retire-url-regex-hook/`, `tasks/003-demo-monthday-utc-fix/`,
  `tasks/004-fix-eslint-no-undef/`, `tasks/005-fix-api-test-env-loading/`,
  `tasks/006-module-scaffold-and-route-gate/`, `tasks/012-release-checkpoint/`,
  `tasks/013-release-v1.97.0/`

**Excluded:** `tasks/001-engineer-routing-memory/` (see secret-scan finding).

## Dependencies
- 011-migrate-protection — COMPLETE, verified, Codex-reviewed (`review-4.md`: SHIP)

## Plan
- P1: Create branch `refactor/module-migration-phase1-protection` off `main`.
- P2: Stage commit 1 from an explicit coordinator-authored pathspec file. Never `git add -A`.
- P3: Review `git diff --cached --stat` and a full `git status --porcelain` before committing. Confirm
  zero matches for `.pdf`, `data/`, `.env`, `Pasted image`, `001-engineer-routing-memory`.
- P4: Commit 1 with the `Co-Authored-By: Claude` trailer.
- P5: Stage + review + commit 2, same discipline.
- P6: Confirm the working tree afterwards contains only `tasks/001-engineer-routing-memory/` as
  untracked, and nothing under `apps/` or `packages/`.
- P7: Push the branch; `gh pr create`.
- P8: Watch CI to green (`audit` + `check` + 4 `publish` build jobs).
- P9: Merge the PR.
- P10: `git checkout main && git pull`, then tag `v1.97.0` **only after merge**, and push the tag.
- P11: Confirm the publish workflow builds all four images.

## Acceptance Criteria
- AC1: No private artifact is staged at any point — zero matches for `*.pdf`, `data/`, `.env`,
  `Pasted image*` in `git diff --cached --name-only` for both commits
- AC2: `tasks/001-engineer-routing-memory/` is **not** committed and remains untracked
- AC3: Both commits carry the `Co-Authored-By: Claude` trailer; the PR body carries the Claude Code trailer
- AC4: All CI checks green on the PR before merge — no merge over a red or pending check
- AC5: Tag `v1.97.0` points at the **merged** commit, not a pre-merge one; `git describe --tags` on
  updated `main` reports `v1.97.0` with no `-N-g` suffix
- AC6: Nothing under `apps/` or `packages/` is left uncommitted afterwards
- AC7: The publish workflow succeeds for all four images (api, web, ingestor, extractor)

## Verification
- T1: `git diff --cached --name-only` reviewed in full before each commit
- T2: `git status --porcelain` after both commits
- T3: `gh pr checks` output showing every check green
- T4: `git describe --tags` on merged `main`
- T5: `gh run list`/`gh run view` for the tag-triggered publish run

## Non-Goals
- Tagging before merge — the tag must point at the merged commit (task 012's rule, kept).
- `npm audit fix --force` — not needed, the gate passes.
- Committing `tasks/001-engineer-routing-memory/`.
- Host-side deploy (`COMPASS_VERSION` bump + `make update`) — operator action, outside this repo.
