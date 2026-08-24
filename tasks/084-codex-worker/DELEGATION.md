# Sonnet Worker Delegation

## Task
084 — codex-worker tooling

## Approved Plan

### P1: Create `/home/udai/.claude/bin/codex-worker` shell script

Model on the existing `/home/udai/.claude/bin/codex-reviewer` but with these differences:

1. **Model selection**: Pass `-m "${CODEX_WORKER_MODEL:-terra}"` to `codex exec`
2. **NOT read-only**: Remove the READ-ONLY prompt guard. This worker edits files.
3. **Prompt guard**: Replace the reviewer's output-requirements guard with one that tells Codex:
   - It IS allowed to create, edit, and delete files as needed to implement the task
   - Its FINAL MESSAGE must be a complete report of what it changed, including file paths, a summary of each change, any commands it ran, and any issues encountered
   - Do not truncate, summarize, or say "see file X" — emit the full report as the final message
4. **Flags**: Use `codex exec --ephemeral --dangerously-bypass-approvals-and-sandbox -m "${CODEX_WORKER_MODEL:-terra}" -C "$repo_root" -o "$report_file" -- "${prompt}${prompt_guard}"`
5. **Stderr progress**: Print `codex worker target: $dest` before running, and `codex worker report written to: $dest` after success
6. **Same safety patterns as reviewer**:
   - Refuse to overwrite existing report files
   - Use temp staging file outside repo for capture, then copy
   - `set -euo pipefail`, usage function, arg validation
   - Trap to clean up temp file
   - Handle case where codex creates the dest itself
   - Make executable: `chmod +x`
7. **Stdin**: Feed `< /dev/null` to prevent interactive prompts

### P2: Create `/home/udai/.claude/agents/codex-worker.md` agent definition

Create a Claude Code agent definition with this structure:

```yaml
---
name: codex-worker
description: Delegates implementation tasks to the OpenAI Codex CLI (terra model) via the codex-worker bin script. Captures a structured report of all changes made.
model: haiku
tools: Bash, Read
---
```

System prompt should say:
- You are a thin wrapper that invokes `/home/udai/.claude/bin/codex-worker` to delegate implementation work to the Codex CLI
- You receive a report-path and a task prompt from the coordinator
- Run: `/home/udai/.claude/bin/codex-worker <report-path> '<task prompt>'`
- After the script completes, read the report file and return a summary
- If the script fails (non-zero exit), report the error verbatim — do not retry
- You do not implement anything yourself — Codex does all the work

### P3: Verify existing agents
Just confirm coordinator.md and sonnet-worker.md exist at `/home/udai/.claude/agents/` (they do, per investigation).

## Files and Symbols
- NEW: `/home/udai/.claude/bin/codex-worker`
- NEW: `/home/udai/.claude/agents/codex-worker.md`
- REFERENCE (read-only): `/home/udai/.claude/bin/codex-reviewer`

## Required Changes
- Create the two new files listed above

## Must Not Change
- `/home/udai/.claude/bin/codex-reviewer`
- `/home/udai/.claude/agents/coordinator.md`
- `/home/udai/.claude/agents/sonnet-worker.md`

## Acceptance Criteria
- AC1: codex-worker script is executable, syntax-valid bash
- AC2: Script uses `-m "${CODEX_WORKER_MODEL:-terra}"` for model
- AC3: Script does NOT contain "READ-ONLY" or "read-only reviewer" in its prompt guard
- AC4: Script includes implementation-appropriate prompt guard
- AC5: Agent definition has correct frontmatter and system prompt
- AC6: Both files exist at their target paths

## Commands
1. Read `/home/udai/.claude/bin/codex-reviewer` for reference
2. Create `/home/udai/.claude/bin/codex-worker` with the specified content
3. `chmod +x /home/udai/.claude/bin/codex-worker`
4. Create `/home/udai/.claude/agents/codex-worker.md`
5. `bash -n /home/udai/.claude/bin/codex-worker` (syntax check)
6. `/home/udai/.claude/bin/codex-worker` (no args, expect exit 2 + usage)
7. `ls -la /home/udai/.claude/bin/codex-worker /home/udai/.claude/agents/codex-worker.md`

## Required Evidence
- files changed (list of created files)
- complete diff (full content of both files)
- commands and literal output for steps 3-7
- exit codes for all commands
- plan deviations or blockers
