# Sonnet Worker Delegation

## Task
000-agent-harness — repair and smoke-test the backend/frontend engineer harness

## Approved Plan
- P1: Move the misplaced backend agent profile into `bin/`.
- P2: Smoke-test `backend-engineer` (read-only prompt).
- P3: Smoke-test `frontend-engineer` (read-only prompt).

## Files and Symbols
- `/home/udai/.claude/agents/backend-engineer-agent.md` — move source
- `/home/udai/.claude/bin/backend-engineer-agent.md` — move destination
- `/home/udai/.claude/bin/backend-engineer` — read only, do not edit
- `/home/udai/.claude/bin/frontend-engineer` — read only, do not edit

## Required Changes
1. `sha256sum /home/udai/.claude/agents/backend-engineer-agent.md` and record it.
2. `mv /home/udai/.claude/agents/backend-engineer-agent.md /home/udai/.claude/bin/backend-engineer-agent.md`
3. `sha256sum /home/udai/.claude/bin/backend-engineer-agent.md` — must match step 1.
4. `ls -l /home/udai/.claude/agents/ /home/udai/.claude/bin/`

## Must Not Change
- Do NOT edit either wrapper script.
- Do NOT edit the agent profile contents — this is a pure move.
- Do NOT touch anything in the PennyPilot working tree other than creating the
  two smoke-test report files named below. The repo has a large uncommitted
  refactor in flight; leaving it untouched is a hard requirement.
- Do NOT run `git add`, `git commit`, `git stash`, `git checkout`, or `git restore`.
- Do NOT invoke `backend-engineer` via the Task tool as a subagent. Only the
  `/home/udai/.claude/bin/backend-engineer` shell wrapper is permitted.

## Acceptance Criteria
- AC1: profile present in `bin/`, absent from `agents/`, hash unchanged.
- AC2: backend wrapper exits 0 and its report file exists and is non-empty.
- AC3: frontend wrapper exits 0 and its report file exists and is non-empty.
- AC4: no tracked-file change in the repo caused by the smoke tests.

## Commands
Run from `/home/udai/PennyPilot`. Capture the literal exit code of every command
with `echo "exit=$?"` immediately after it.

1. `git status --porcelain > /tmp/harness-before.txt; wc -l /tmp/harness-before.txt`
2. `command -v pi; echo "exit=$?"`
3. The three move/hash commands above.
4. Backend smoke test — run exactly:
   `/home/udai/.claude/bin/backend-engineer tasks/000-agent-harness/backend-smoke-1.md 'Smoke test only. Reply with the single word OK and nothing else. Do not read, create, edit, or delete any file. Do not run any command. Do not use any tool.'`
   then `echo "exit=$?"`
5. Frontend smoke test — run exactly:
   `/home/udai/.claude/bin/frontend-engineer tasks/000-agent-harness/frontend-smoke-1.md 'Smoke test only. Reply with the single word OK and nothing else. Do not read, create, edit, or delete any file. Do not run any command. Do not use any tool.'`
   then `echo "exit=$?"`
6. `git status --porcelain > /tmp/harness-after.txt; diff /tmp/harness-before.txt /tmp/harness-after.txt; echo "exit=$?"`
7. `wc -c tasks/000-agent-harness/backend-smoke-1.md tasks/000-agent-harness/frontend-smoke-1.md`

If step 4 or 5 fails, do NOT retry with a different path or prompt and do NOT
attempt a fix. Report the literal stderr and exit code and stop.

## Required Evidence
Write full evidence to `tasks/000-agent-harness/verification-1.md`, and return
at most 20 lines plus that path. Evidence must include:
- every command exactly as run, with its literal stdout/stderr and exit code
- both sha256 hashes
- the `diff` output for the git status snapshots (empty means pass)
- the byte counts of both report files
- any deviation or blocker
