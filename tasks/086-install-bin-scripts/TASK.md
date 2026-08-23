# Task: 086 — Install codex-worker and codex-reviewer bin scripts

## Status
COMPLETE

## Objective
Install the `codex-worker` wrapper (already written in tasks/084-codex-worker/codex-worker.sh) and create + install a new `codex-reviewer` wrapper into `.claude/bin/`, making both executable. Update agent definitions to reference the correct paths.

## Root Cause
The wrapper scripts were written but never installed to `.claude/bin/`. The `codex-reviewer` script was never created at all.

## Scope
- `.claude/bin/codex-worker` — copy from tasks/084-codex-worker/codex-worker.sh, make executable
- `.claude/bin/codex-reviewer` — new script, review-only variant
- `.claude/agents/codex-worker.md` — update path references if needed
- `.claude/agents/coordinator.md` — update path references if needed

## Dependencies
- none

## Plan
- P1: Copy tasks/084-codex-worker/codex-worker.sh → .claude/bin/codex-worker, chmod +x
- P2: Create .claude/bin/codex-reviewer — similar structure to codex-worker but:
  - Uses `codex exec --ephemeral --dangerously-bypass-approvals-and-sandbox --read-only` (or equivalent read-only flags)
  - The prompt guard instructs Codex it is a REVIEWER that must NOT modify files, only read and report
  - Writes review output to the specified path
  - Prints `codex review target: <path>` and `codex review written to: <path>` to stderr
  - Refuses to overwrite existing review files
- P3: Verify both scripts are executable and runnable (`codex` CLI exists at /home/udai/.local/bin/codex)
- P4: No changes to agent .md files needed since they already reference `/home/udai/.claude/bin/codex-worker` and `/home/udai/.claude/bin/codex-reviewer`

## Acceptance Criteria
- AC1: `.claude/bin/codex-worker` exists, is executable, content matches tasks/084-codex-worker/codex-worker.sh
- AC2: `.claude/bin/codex-reviewer` exists, is executable, runs codex in review/read-only mode
- AC3: codex-reviewer prints `codex review target:` and `codex review written to:` on stderr
- AC4: codex-reviewer refuses to overwrite existing files
- AC5: Both scripts check for `codex` CLI availability

## Verification
- T1: `/home/udai/.claude/bin/codex-worker --help` or similar shows usage
- T2: `/home/udai/.claude/bin/codex-reviewer` with no args shows usage/error
- T3: Both files have executable permission

## Non-Goals
- Changing agent definitions (paths already correct)
- Running actual codex tasks
