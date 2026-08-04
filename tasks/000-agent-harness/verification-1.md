# 000-agent-harness — Verification 1

All commands run from `/home/udai/PennyPilot` unless noted.

## Step 1 — pre-snapshot

```
$ git status --porcelain > /tmp/harness-before.txt; wc -l /tmp/harness-before.txt
115 /tmp/harness-before.txt
```

## Step 2 — pi on PATH

```
$ command -v pi; echo "exit=$?"
/home/udai/.nvm/versions/node/v24.18.0/bin/pi
exit=0
```

## Step 3 — move + hash

```
$ sha256sum /home/udai/.claude/agents/backend-engineer-agent.md
cb4a6814a6ba576c81dcc661c8496f269c7fdcb913f9af2b9a141b49f3bc192f  /home/udai/.claude/agents/backend-engineer-agent.md

$ mv /home/udai/.claude/agents/backend-engineer-agent.md /home/udai/.claude/bin/backend-engineer-agent.md
exit=0

$ sha256sum /home/udai/.claude/bin/backend-engineer-agent.md
cb4a6814a6ba576c81dcc661c8496f269c7fdcb913f9af2b9a141b49f3bc192f  /home/udai/.claude/bin/backend-engineer-agent.md
```

Hashes match: `cb4a6814a6ba576c81dcc661c8496f269c7fdcb913f9af2b9a141b49f3bc192f` (before move) ==
`cb4a6814a6ba576c81dcc661c8496f269c7fdcb913f9af2b9a141b49f3bc192f` (after move). PASS.

```
$ ls -l /home/udai/.claude/agents/ /home/udai/.claude/bin/
/home/udai/.claude/agents/:
.rw-rw-r-- udai udai 10 KB Tue Aug  4 05:06:22 2026 coordinator.md
.rw-rw-r-- udai udai 10 KB Thu Jul 30 15:56:29 2026 sonnet-worker.md

/home/udai/.claude/bin/:
.rwxrwxr-x udai udai 3.9 KB Tue Aug  4 05:06:28 2026 backend-engineer
.rw-rw-r-- udai udai 725 B  Tue Aug  4 04:40:37 2026 backend-engineer-agent.md
.rwxr-xr-x udai udai 4.9 KB Sat Aug  1 10:39:50 2026 codex-reviewer
.rwxrwxr-x udai udai 292 B  Thu Jul 23 04:38:30 2026 codex-worker
.rwxrwxr-x udai udai 3.9 KB Tue Aug  4 03:58:01 2026 frontend-engineer
.rw-rw-r-- udai udai 729 B  Fri Jul 31 15:49:36 2026 frontend-engineer-agent.md
.rwxrwxr-x udai udai 5.1 KB Fri Jul 31 15:49:16 2026 frontend-engineer.claude-backup
```

`backend-engineer-agent.md` is now present in `bin/` and absent from `agents/`
(the `agents/` listing above no longer contains it). AC1: PASS.

(Note: `agents/` also has a hidden `.backups/` subdirectory, unaffected by
this move — visible only with `ls -la`, not shown by the plain `ls -l` the
plan specifies.)

## Step 4 — backend smoke test

```
$ /home/udai/.claude/bin/backend-engineer tasks/000-agent-harness/backend-smoke-1.md 'Smoke test only. Reply with the single word OK and nothing else. Do not read, create, edit, or delete any file. Do not run any command. Do not use any tool.'
backend-engineer target: /home/udai/PennyPilot/tasks/000-agent-harness/backend-smoke-1.md
backend-engineer report written to: /home/udai/PennyPilot/tasks/000-agent-harness/backend-smoke-1.md
$ echo "exit=$?"
exit=0
```

Report file contents (`tasks/000-agent-harness/backend-smoke-1.md`):
```
OK
```

AC2: PASS (exit 0, report file exists and is non-empty — 3 bytes, see Step 7).

## Step 5 — frontend smoke test

```
$ /home/udai/.claude/bin/frontend-engineer tasks/000-agent-harness/frontend-smoke-1.md 'Smoke test only. Reply with the single word OK and nothing else. Do not read, create, edit, or delete any file. Do not run any command. Do not use any tool.'
frontend-engineer target: /home/udai/PennyPilot/tasks/000-agent-harness/frontend-smoke-1.md
frontend-engineer report written to: /home/udai/PennyPilot/tasks/000-agent-harness/frontend-smoke-1.md
$ echo "exit=$?"
exit=0
```

Report file contents (`tasks/000-agent-harness/frontend-smoke-1.md`):
```
OK
```

AC3: PASS (exit 0, report file exists and is non-empty — 3 bytes, see Step 7).

## Step 6 — post-snapshot diff

```
$ git status --porcelain > /tmp/harness-after.txt; diff /tmp/harness-before.txt /tmp/harness-after.txt; echo "exit=$?"
exit=0
```

`diff` produced no output (files identical) and exited 0. Both snapshots are
115 lines. `tasks/000-agent-harness/` was already reported by git as a single
untracked directory line (`?? tasks/000-agent-harness/`) in the pre-snapshot
(it already contained `DELEGATION.md` and `TASK.md`), so the two new
smoke-test report files created inside it do not add or change any porcelain
line — the directory was, and remains, entirely untracked. Verified no
tracked file changed:

```
$ grep -n "tasks" /tmp/harness-before.txt
...
104:?? tasks/000-agent-harness/
...
```
(full pre-snapshot line list available at /tmp/harness-before.txt / /tmp/harness-after.txt,
both identical, 115 lines each)

AC4: PASS — no tracked-file change in the repo caused by the smoke tests.

## Step 7 — byte counts

```
$ wc -c tasks/000-agent-harness/backend-smoke-1.md tasks/000-agent-harness/frontend-smoke-1.md
3 tasks/000-agent-harness/backend-smoke-1.md
3 tasks/000-agent-harness/frontend-smoke-1.md
6 total
```

Both report files are 3 bytes (`OK\n`) — non-empty.

## Deviations / blockers

None. No git add/commit/stash/checkout/restore was run. No wrapper script or
agent profile content was edited — the move was a pure `mv`, contents
unchanged (hash match proves this). `backend-engineer` was invoked only via
the shell wrapper at `/home/udai/.claude/bin/backend-engineer`, never as a
Task-tool subagent.

## Summary

| AC | Result |
|----|--------|
| AC1 — profile moved, hash unchanged | PASS |
| AC2 — backend wrapper exit 0, report non-empty | PASS |
| AC3 — frontend wrapper exit 0, report non-empty | PASS |
| AC4 — no tracked-file change from smoke tests | PASS |
