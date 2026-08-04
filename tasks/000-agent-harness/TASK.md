# Task: Repair and smoke-test the backend/frontend engineer harness

## Status
COMPLETE

## Objective
`backend-engineer` and `frontend-engineer` are the required implementation paths
for backend and frontend work (per user instruction, replacing direct
`sonnet-worker` code edits). Both wrappers must actually execute end to end
before any real task is routed through them.

## Root Cause
Confirmed by reading the wrappers and globbing the profile locations:

- `/home/udai/.claude/bin/backend-engineer` line 108-114 resolves its system
  prompt from `$script_dir/backend-engineer-agent.md`, i.e.
  `/home/udai/.claude/bin/backend-engineer-agent.md`.
- That file does **not** exist. The profile is at
  `/home/udai/.claude/agents/backend-engineer-agent.md` instead.
- Therefore the backend wrapper aborts with
  `error: agent profile not found: ...` and exit 1. It has never run.

Two consequences of the misplacement:
1. The wrapper is non-functional.
2. Because the file sits in `~/.claude/agents/` with frontmatter
   `name: backend-engineer`, it is also registered as a **Task-tool subagent**.
   Invoking it that way bypasses the wrapper entirely: it would run on the
   default Claude model rather than `openrouter/deepseek/deepseek-v4-flash`,
   and would skip the append-only report file. That is the wrong path and must
   not be used.

`frontend-engineer` is correctly configured: profile present at
`/home/udai/.claude/bin/frontend-engineer-agent.md`, and it is correctly absent
from the Task-tool agent list. Its profile body is identical to the backend one
apart from the frontend/backend wording.

## Scope
- `/home/udai/.claude/agents/backend-engineer-agent.md` (move source)
- `/home/udai/.claude/bin/backend-engineer-agent.md` (move destination)
- Smoke-test report artifacts under `tasks/000-agent-harness/`

## Dependencies
- none

## Plan
- P1: Move `~/.claude/agents/backend-engineer-agent.md` to
  `~/.claude/bin/backend-engineer-agent.md`. This simultaneously repairs the
  wrapper and de-registers the accidental Task-tool subagent.
- P2: Smoke-test `backend-engineer` with a strictly read-only prompt.
- P3: Smoke-test `frontend-engineer` with a strictly read-only prompt (its
  `pi` + OpenRouter path is equally unverified in this session).

## Acceptance Criteria
- AC1: `/home/udai/.claude/bin/backend-engineer-agent.md` exists with byte-identical
  content to the previous `agents/` copy; the `agents/` copy no longer exists.
- AC2: `backend-engineer` exits 0 and writes its report file.
- AC3: `frontend-engineer` exits 0 and writes its report file.
- AC4: `git status` in `/home/udai/PennyPilot` shows **no** change to any
  tracked file caused by the smoke tests. The repo has a large uncommitted
  refactor in flight; the harness must not touch it.

## Verification
- T1: `ls -l` both profile paths + `sha256sum` before/after the move.
- T2: Literal exit codes from both wrapper invocations.
- T3: `git status --porcelain` diffed against the pre-test snapshot.

## Non-Goals
- Any change to the in-flight repo refactor.
- Rewriting the wrapper scripts or the agent profile prose.

## Outcome
All four ACs PASS — evidence in `verification-1.md`, independently confirmed by
the coordinator: profile hash `cb4a6814...bc192f` identical before/after the
move, and a direct glob shows the file present in `bin/` and gone from
`agents/`. Both wrappers exit 0 and returned `OK` (3 bytes), proving `pi`
(`~/.nvm/.../bin/pi`), the OpenRouter provider, `deepseek/deepseek-v4-flash`
and `moonshotai/kimi-k3` are all live. Repo `git status --porcelain` byte-identical
before and after (115 lines both).

No Codex review was run on this task. Deliberate call, stated openly rather
than skipped silently: the change is a zero-line-of-code `mv` of harness config
outside the repo, proven by hash equality plus a live end-to-end execution, so
a review would be ceremony. Codex review remains mandatory for every task that
touches repo code.

## Standing routing rule (applies to all later tasks)
- Backend app code (`apps/api`, `apps/ingestor`, `apps/extractor`, server-side
  `packages/*`, DB schema/migrations, jobs, config) → `backend-engineer` wrapper.
- Frontend app code (`apps/web`, components, client state, styling, Vite config)
  → `frontend-engineer` wrapper.
- `sonnet-worker` is NOT retired. It remains the only path for: invoking the two
  wrappers (they are CLI scripts, not Task agents), independent verification
  (which must never be done by the implementer), read-only investigation, and
  work belonging to neither domain (CI, docs, repo tooling).
- Never invoke `backend-engineer` via the Task tool. The stale subagent
  registration may linger in the agent list until reload; using it would run the
  wrong model and skip the report file.

## Decisions
- The fix is delegated to `sonnet-worker`, not `backend-engineer`, because a
  wrapper that aborts before loading its own profile cannot repair itself, and
  because `~/.claude` harness config is not repo backend code. The user's
  "use backend/frontend-engineer instead of sonnet-worker" instruction governs
  application code in `apps/`/`packages/`, not the agent harness itself.
