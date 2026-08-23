# Codex Worker Delegation

## Task
086 — Install codex-worker and codex-reviewer bin scripts

## Approved Plan
- P1: Copy tasks/084-codex-worker/codex-worker.sh → .claude/bin/codex-worker, chmod +x
- P2: Create .claude/bin/codex-reviewer (review-only variant)
- P3: Verify both scripts are executable
- P4: No agent .md changes needed

## Files and Symbols
- `.claude/bin/codex-worker` — install from existing script
- `.claude/bin/codex-reviewer` — create new

## Required Changes

### P1: Install codex-worker
```bash
cp tasks/084-codex-worker/codex-worker.sh .claude/bin/codex-worker
chmod +x .claude/bin/codex-worker
```

### P2: Create codex-reviewer
Create `.claude/bin/codex-reviewer` as a bash script modeled on codex-worker.sh but adapted for read-only review:

Key differences from codex-worker:
1. The `codex exec` call MUST include `--read-only` flag (prevents file modifications)
2. The prompt guard tells Codex it is a REVIEWER, must NOT modify files, only read and analyze
3. stderr messages use "codex review target:" and "codex review written to:" (not "codex worker")
4. Usage message says "codex-reviewer" not "codex-worker"
5. Environment variable is `CODEX_REVIEWER_MODEL` (default: `o4-mini`)

The script structure should be nearly identical to codex-worker.sh:
- Same argument parsing (2 args: report-path and review prompt)
- Same path canonicalization and repo root detection
- Same temp file strategy (write outside repo, copy to dest)
- Same overwrite protection
- Uses `codex exec --ephemeral --dangerously-bypass-approvals-and-sandbox --read-only -m "$model" -C "$repo_root" -o "$report_file" -- "${prompt}${prompt_guard}"`

The prompt guard for the reviewer should be:
```
--- OUTPUT REQUIREMENTS (from the reviewer harness, not the requester) ---
You are a code reviewer. You must NOT create, edit, or delete any files.
Read the codebase to answer the review prompt. Your review is captured from
your FINAL MESSAGE only. Emit the complete review, in full, as that final message.

Your final message MUST include all findings organized by severity (High/Medium/Low).
Do not truncate the review. The full review must appear as your final message.
```

### P3: Verify
```bash
ls -la .claude/bin/codex-worker .claude/bin/codex-reviewer
file .claude/bin/codex-worker .claude/bin/codex-reviewer
```

## Must Not Change
- `.claude/agents/coordinator.md`
- `.claude/agents/codex-worker.md`
- Any source code files
- Any tasks/ files other than this task

## Acceptance Criteria
- AC1: `.claude/bin/codex-worker` exists, is executable, content matches tasks/084-codex-worker/codex-worker.sh
- AC2: `.claude/bin/codex-reviewer` exists, is executable, uses `--read-only` flag
- AC3: codex-reviewer prints `codex review target:` and `codex review written to:` on stderr
- AC4: Both scripts refuse to overwrite existing files
- AC5: Both scripts check for `codex` CLI availability

## Commands
1. `cp tasks/084-codex-worker/codex-worker.sh .claude/bin/codex-worker`
2. `chmod +x .claude/bin/codex-worker`
3. Create .claude/bin/codex-reviewer (content per spec above)
4. `chmod +x .claude/bin/codex-reviewer`
5. `ls -la .claude/bin/`

## Required Evidence
- files changed
- complete diff
- commands and literal output
- exit codes
