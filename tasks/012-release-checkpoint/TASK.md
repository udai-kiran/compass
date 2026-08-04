# Task: v1.96.0 release checkpoint — commit, PR, tag

## Status
COMPLETE — v1.96.0 shipped

## Outcome
- PR #159 merged as `c78fdad` (merge commit, matching repo history style).
- All 6 PR checks green: `audit`, `check`, `publish (api/web/ingestor/extractor)`.
  The `check` job passing confirms the `apps/extractor` `DATABASE_URL` failure is
  local-only — CI provisions a DB — exactly as predicted in pre-flight.
- Tag `v1.96.0` created and pushed; `git describe --tags` reports `v1.96.0` clean
  (no `-N-g` suffix). Duplicate-tag guard checked local and remote first.
- Publish run `30898241125` succeeded: all four images built
  (ingestor 59s, api 1m8s, web 2m41s, extractor 1m9s).

## Observation for future sessions
Only **2** self-hosted runners were online during this release, not the 4 the
project memory records. The tag run queued behind the concurrent main-push run
before completing. Not a failure, but release throughput is currently halved.

## Objective
Bank the completed roadmap 1.1-1.3 module migration as a commit + PR, get CI
green, then cut `v1.96.0`.

## Decisive facts
- Current tag `v1.95.0`; HEAD was exactly on it. Next is **v1.96.0**, user-confirmed.
- **NOT 2.0.0** — roadmap `03.02` reserves that for the end of Phase 3
  (`depends: [3.1]`), after the double-entry ledger, with a from-scratch prod DB
  and no 1.x upgrade path. We are at task 1.4 of Phase 1. The roadmap explicitly
  says to ship continuously through 1.9x as phases land.
- `publish.yml` triggers on `push` to main, `tags: ["v*"]`, and PRs (build-only).
  Version derives from `git describe --tags --always --dirty`. Root
  `package.json` stays `0.1.0` and is not part of the flow.
- `ci.yml` `check`: npm ci → typecheck → lint → db:migrate → test → build web →
  build docs. `audit` job: `npm audit --omit=dev --audit-level=high` is a
  **hard gate**; the non-`--omit=dev` run is continue-on-error.

## Root Cause (of the CI blocker found in pre-flight)
`npm audit --omit=dev --audit-level=high` exited 1 on two high-severity
transitive advisories (`fast-uri`, `ip-address`). Not caused by the migration —
audit results drift as new advisories are published, so main went red with no
code change. Cleared by `npm audit fix` (no `--force`).

## Completed
- `fd6cb97` chore(deps): audit fix. Only `package-lock.json` moved
  (22+/22-). Gate after bump: typecheck 0, lint 0, web build 0, docs build 0,
  audit 0, api 837/837, web 264/264, shared 212/212, ai 32/32, ingestor 12/12.
- `e59199b` chore: `*.pdf` + `Pasted image*` added to `.gitignore`. Previously
  guarded only by machine-local `.git/info/exclude`, which does not travel.
  Verified no such path was already tracked before adding the patterns.
- `41845e5` refactor(api): the 1.1-1.3 migration, 230 paths.
- Branch: `refactor/module-migration-phase1-ledger-credit-investments`.
- Working tree: nothing under `apps/` or `packages/` remains uncommitted.

## Staging discipline
Staged exclusively via an explicit coordinator-authored pathspec file
(`commit-filelist.txt`, 107 entries). Never `git add -A`. Full dry-run captured
to `dryrun-full.txt` and reviewed by the coordinator before commit: 120 adds
under `apps/api/src/`, 38 under `tasks/`, 72 removes, zero matches for `.pdf`,
`data/`, `.env` or pasted images.

**Deliberately excluded and still untracked:** `tasks/000-agent-harness/`,
`001-engineer-routing-memory/`, `002-resume-refactor/`, `012-release-checkpoint/`
(agent-harness and session scratch, not project history), plus the older
`00.01-00.02-verification-1.md` and `001-domain-event-bus/`…`006-*` dirs, left
alone to keep this commit focused.

## Coordinator error, recorded
The first commit attempt gated on `git diff --cached --numstat | wc -l == 230`
and the worker correctly STOPPED at 161. The gate was wrong, not the staging:
`git add --dry-run` counts paths, while `--numstat` counts diff entries, and git
collapses a delete+add pair into one rename. Reconciled exactly:
A=63, M=26, D=3, R=69 → 63+26+3+(2x69) = **230**. Verify the metric matches the
thing being counted before gating on it.

## BLOCKER
`git push` failed: `remote: Invalid username or token. Password authentication
is not supported for Git operations` (exit 128). `gh auth status` reports the
token in `~/.config/gh/hosts.yml` is invalid. No workaround was attempted — this
is a credential operation that belongs to the user.

Also relevant from prior sessions: that token previously lacked `write:packages`,
which blocks manual image pushes to GHCR (CI's own token is separate).

**Unblock with:** `gh auth login` (or `gh auth refresh -h github.com`).

## Remaining
- R1: push the branch
- R2: `gh pr create` (title/body already drafted in the delegation)
- R3: watch CI green
- R4: merge
- R5: `git tag v1.96.0 && git push --tags` — only after merge, so the tag lands
  on the right commit. CI then publishes api/web/ingestor/extractor to GHCR.
- R6: operator bumps `COMPASS_VERSION` on the host and runs `make update`
  (host-side, outside this repo)

## Non-Goals
- Tagging before merge — the tag must point at the merged commit.
- `npm audit fix --force`: 25 dev-only vulns remain (drizzle-kit's esbuild,
  docusaurus/webpack-dev-server). They need breaking major bumps, are dev-only,
  and are not gated by CI. Own task if ever wanted.
