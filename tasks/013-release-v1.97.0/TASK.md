# Task: v1.97.0 release — commit, PR, merge, tag

## Status
IMPLEMENTING

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
`verification-1.md:84` carries the dev Postgres/Redis credential pair `postgres/postgres` at
`192.168.2.196`, plus the MinIO host `pluto` / `172.31.0.7` / bucket `compass-files`, the CI runner
count, and a note about the `gh` token's missing scope. `new-memory-content.md` is memory content by
its very purpose.

Verified against committed history: `192.168.2.196` **already** appears in `.env.example:18,20` (with a
`CHANGE_ME` placeholder credential) and in `tasks/010-migrate-investments/implementation-1.md:227`, so
the bare IP is not a new disclosure. But `postgres/postgres` and `172.31.0.7` have **zero** matches in
history — they would be new.

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
