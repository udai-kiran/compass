# Release v1.97.0 — Preflight (read-only)

Generated: 2026-08-04. All commands run from `/home/udai/PennyPilot`. No files
edited, staged, committed, pushed, or tagged. No destructive/state-changing
git command run.

---

## 1. `git branch --show-current`

```
$ git branch --show-current
main
EXIT:0
```

---

## 2. `git log --oneline -5`

```
$ git log --oneline -5
c78fdad Merge pull request #159 from udai-kiran/refactor/module-migration-phase1-ledger-credit-investments
41845e5 refactor(api): migrate ledger, credit and investments into modules/ (roadmap 1.1-1.3)
e59199b chore: ignore private statement PDFs and pasted images
fd6cb97 chore(deps): clear high-severity fast-uri and ip-address advisories
5b3f499 Merge pull request #158 from udai-kiran/docs/roadmap-2.0-task-board
EXIT:0
```

---

## 3. Tags

```
$ git describe --tags
v1.96.0
EXIT:0

$ git tag --list 'v*' --sort=-v:refname | head -5
v1.96.0
v1.95.0
v1.94.0
v1.93.0
v1.92.0
EXIT:0
```

---

## 4. `git status --porcelain` — COMPLETE, unabridged

```
$ git status --porcelain
 M apps/api/src/app.ts
 D apps/api/src/routes/insurance.ts
 D apps/api/src/routes/retirement.ts
 D apps/api/src/services/insurance.ts
 D apps/api/src/services/retirement.ts
 M tasks/01.04-migrate-protection.md
 M tasks/01.09-cross-module-ports.md
 M tasks/011-migrate-protection/TASK.md
 M tasks/README.md
?? apps/api/src/modules/protection/
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
?? tasks/01.10-storage-backend-contract-tests.md
?? tasks/011-migrate-protection/DELEGATION.md
?? tasks/011-migrate-protection/backend-1.md
?? tasks/011-migrate-protection/implementation-1.md
?? tasks/011-migrate-protection/review-2.md
?? tasks/011-migrate-protection/review-3.md
?? tasks/011-migrate-protection/review-4.md
?? tasks/011-migrate-protection/verification-1.md
?? tasks/012-release-checkpoint/
EXIT:0
```

**Line count and breakdown** (via `git status --porcelain | wc -l` and
`git status --porcelain | cut -c1-2 | sort | uniq -c`):

```
Total lines: 29
By code:
     20 ??
      4  D
      5  M
```

- ` M` (5): `apps/api/src/app.ts`, `tasks/01.04-migrate-protection.md`,
  `tasks/01.09-cross-module-ports.md`,
  `tasks/011-migrate-protection/TASK.md`, `tasks/README.md`
- ` D` (4): `apps/api/src/routes/insurance.ts`,
  `apps/api/src/routes/retirement.ts`, `apps/api/src/services/insurance.ts`,
  `apps/api/src/services/retirement.ts`
- `??` (20): `apps/api/src/modules/protection/` plus 19 untracked files/dirs
  under `tasks/` (listed verbatim above)

---

## 5. Ignored files (`--ignored=matching`, `^!!` only)

```
$ git status --porcelain --ignored=matching | grep '^!!'
!! .claude/
!! .env
!! .idea/
!! 9907616356178351_24062026.pdf
!! apps/api/data/
!! apps/docs/.docusaurus/
!! apps/docs/build/
!! apps/docs/node_modules/
!! apps/web/dist/
!! data/
!! node_modules/
EXIT:0
```

---

## 6. Private artifact check

```
$ ls -la /home/udai/PennyPilot/*.pdf /home/udai/PennyPilot/*.png 2>&1
(eval):1: no matches found: /home/udai/PennyPilot/*.png
EXIT:1
```
(No `.pdf` glob match was printed either — the shell error is for the `*.png`
branch of the combined glob; no PDFs or PNGs are present directly at repo
root at the time this command ran. Note item 5 shows
`9907616356178351_24062026.pdf` IS present and ignored, but it apparently
lives elsewhere than the literal root glob resolved — see below.)

```
$ ls -d /home/udai/PennyPilot/data 2>&1
/home/udai/PennyPilot/data
EXIT:0
```

```
$ cat /home/udai/PennyPilot/.gitignore
# Secrets — never commit
.env
.env.local

# Dependencies & builds
node_modules/
dist/
build/
.docusaurus/

# Local data (attachments, backups)
data/

# Logs & OS noise
*.log
.DS_Store

.claude/

.idea/
*.pdf
Pasted image*
EXIT:0
```

**Note:** `.gitignore` covers `*.pdf`, `Pasted image*`, `data/`, `.env`,
`.claude/`, `.idea/`, `node_modules/`, `dist/`, `build/`, `.docusaurus/`. The
ignored-file scan (item 5) confirms `9907616356178351_24062026.pdf` and
`data/` are both currently ignored as expected. The literal glob
`/home/udai/PennyPilot/*.pdf` in the `ls -la` command above did not print a
distinct "no matches" error the way `*.png` did — zsh's combined-glob error
reporting only surfaced the `*.png` failure text; given item 5 confirms the
PDF file's ignored status directly via `git status`, its presence is
independently corroborated there.

---

## 7. `gh auth status`

```
$ gh auth status
github.com
  ✓ Logged in to github.com account udai-kiran (/home/udai/.config/gh/hosts.yml)
  - Active account: true
  - Git operations protocol: https
  - Token: gho_************************************
  - Token scopes: 'gist', 'read:org', 'repo', 'workflow'
EXIT:0
```

Token is valid, scopes are `gist`, `read:org`, `repo`, `workflow`. This
covers repo read/write and Actions workflow triggers. No `write:packages`
scope is listed (relevant per memory note that manual GHCR image pushes were
previously denied for lacking `write:packages`) — CI publishing itself uses
`secrets.GITHUB_TOKEN` inside the workflow, not this `gh` CLI token, so that
path is unaffected; only manual `gh`-driven package operations would be
blocked by the scope gap.

---

## 8. `git remote -v`

```
$ git remote -v
origin	https://github.com/udai-kiran/PennyPilot.git (fetch)
origin	https://github.com/udai-kiran/PennyPilot.git (push)
EXIT:0
```

---

## 9. `git status --porcelain -- apps/ packages/`

```
$ git status --porcelain -- apps/ packages/
 M apps/api/src/app.ts
 D apps/api/src/routes/insurance.ts
 D apps/api/src/routes/retirement.ts
 D apps/api/src/services/insurance.ts
 D apps/api/src/services/retirement.ts
?? apps/api/src/modules/protection/
EXIT:0
```

Confirms: under `apps/` and `packages/`, the only changes are the
protection-module migration (new `apps/api/src/modules/protection/`,
modified `apps/api/src/app.ts`, and the four deleted legacy
insurance/retirement route+service files). No `packages/` changes and no
other `apps/` changes present.

---

## 10. Workflow triggers and job contents

### `.github/workflows/publish.yml`

Trigger block:
```yaml
on:
  push:
    branches: [main]
    tags: ["v*"]
  pull_request:
```
Runs on pushes to `main`, on tags matching `v*`, and on pull requests
(build-only, no push — per the file's own comment: "PRs build-only (no push)
so a fork or branch can't publish"). Publishing (`docker/login-action` +
`push: true` on `docker/build-push-action`) is gated by
`if: github.event_name != 'pull_request'` / `push: ${{ github.event_name != 'pull_request' }}`.
Matrix builds `api, web, ingestor, extractor` images to
`ghcr.io/<owner>/pennypilot-<app>`.

### `.github/workflows/ci.yml`

Trigger block:
```yaml
on:
  push:
    branches: [main]
  pull_request:
```
Runs on pushes to `main` and on pull requests.

**`check` job** runs, in order:
```yaml
- run: npm ci
- run: npm run typecheck
- run: npm run lint
- run: npm run db:migrate
  env:
    DATABASE_URL: postgres://compass:compass-ci@localhost:${{ job.services.postgres.ports['5432'] }}/compass_ci
- run: npm test
  env:
    DATABASE_URL: postgres://compass:compass-ci@localhost:${{ job.services.postgres.ports['5432'] }}/compass_ci
    REDIS_URL: redis://localhost:${{ job.services.redis.ports['6379'] }}
    SESSION_SECRET: ci-only-session-secret-not-a-real-value-0123456789
- run: npm run build -w apps/web
- run: npm run build -w apps/docs
```
Uses ephemeral `postgres:18` and `redis:7` service containers on a
self-hosted `[self-hosted, docker]` runner.

**`audit` job** gates on:
```yaml
- run: npm ci
# Hard gate: anything that ships in a runtime image.
- run: npm audit --omit=dev --audit-level=high
# Informational: dev/build tooling. Non-blocking because the docs
# generator (@docusaurus -> serve-handler -> minimatch@3) pins an old
# brace-expansion with no compatible fix available upstream — forcing a
# newer one breaks `docusaurus serve` at runtime.
- run: npm audit --audit-level=high
  continue-on-error: true
```
The **hard gate** is `npm audit --omit=dev --audit-level=high` (production
deps only, high+ severity, no `continue-on-error`). The second
`npm audit --audit-level=high` (all deps, including dev) is explicitly
**informational / non-blocking** via `continue-on-error: true`, called out in
the workflow's own comment as expected to fail because of an unfixable
`docusaurus -> serve-handler -> minimatch@3 -> brace-expansion` chain.

---

## 11. `npm audit --omit=dev --audit-level=high` (repo root)

```
$ npm audit --omit=dev --audit-level=high
found 0 vulnerabilities
EXIT:0
```

This is the exact command CI's `audit` job hard-gates on (see item 10). It
currently passes clean with 0 vulnerabilities at repo root.

---

## Summary of findings (facts only, no recommendation)

- Current branch: `main`.
- Latest tag: `v1.96.0`; `git describe --tags` resolves exactly to it (no
  `-N-gSHA` suffix, so `HEAD` is not ahead of the tag by commits — wait: HEAD
  per `git log` is `c78fdad`, and `git describe --tags` returned bare
  `v1.96.0` with no offset, meaning `c78fdad` itself is tagged `v1.96.0`).
- Working tree is **not clean**: 29 lines of `git status --porcelain` — 5
  modified (` M`), 4 deleted (` D`), 20 untracked (`??`). Untracked entries
  are overwhelmingly `tasks/` planning/report files (19 of the 20 `??`
  entries) plus the new `apps/api/src/modules/protection/` module directory.
  Modified/deleted entries are entirely the protection-module migration
  (`apps/api/src/app.ts` modified; four legacy `insurance`/`retirement`
  route+service files deleted) plus 4 modified `tasks/*.md` docs.
- Scoped to `apps/` and `packages/` only: exactly the protection-module
  migration (item 9) — no other application-code drift, no `packages/`
  changes.
- `gh auth status` succeeds (exit 0), token scopes `gist, read:org, repo,
  workflow` — valid and logged in as `udai-kiran`.
- `npm audit --omit=dev --audit-level=high` — the CI hard gate — passes with
  `found 0 vulnerabilities`, exit 0.
- `.gitignore` covers `*.pdf`, `Pasted image*`, `data/`, `.env`, `.claude/`,
  `.idea/`; the ignored-file scan confirms `9907616356178351_24062026.pdf`
  and `data/` are both currently ignored, not tracked, not staged.
