# Sonnet Worker Delegation

## Task
001-engineer-routing-memory — make the engineer routing durable in project memory

## Why sonnet-worker and not backend-engineer
This is agent-harness memory config outside the repo, not application code.
The backend/frontend engineers are scoped to `apps/` and `packages/` source.

## Approved Plan
- P1: Replace the body of the stale memory note with coordinator-authored content.
- P2: Update the one-line summary for that note in the memory index.

## Files and Symbols
- SOURCE (read, do not edit):
  `/home/udai/PennyPilot/tasks/001-engineer-routing-memory/new-memory-content.md`
- TARGET (overwrite):
  `/home/udai/.claude/projects/-home-udai-PennyPilot/memory/worker-codex-review-flow.md`
- TARGET (single-line edit):
  `/home/udai/.claude/projects/-home-udai-PennyPilot/memory/MEMORY.md`

## Required Changes
1. Copy SOURCE over the memory note, byte for byte, with exactly one
   substitution: replace the literal token `__MODIFIED__` with the current UTC
   timestamp in the same format the file already used, produced by:
   `date -u +%Y-%m-%dT%H:%M:%S.000Z`
   Do not reformat, rewrap, reorder, or "improve" any other character. Note the
   frontmatter line `metadata: ` has a trailing space in the original — preserve
   it exactly as it appears in SOURCE.
2. In `MEMORY.md`, replace this exact line:
   `- [Worker + Codex review flow](worker-codex-review-flow.md) — default to sonnet-worker + the `codex-reviewer` script (not an agent) before shipping; don't wait to be asked`
   with:
   `- [Worker + Codex review flow](worker-codex-review-flow.md) — app code goes to the backend-engineer/frontend-engineer scripts (2 args, not agents), sonnet-worker keeps verification; codex-reviewer before shipping`
   Change nothing else in MEMORY.md — every other index line stays untouched.
3. Confirm no `__MODIFIED__` token remains anywhere in the memory directory.

## Must Not Change
- Do NOT edit any file inside `/home/udai/PennyPilot` (including the SOURCE file).
- Do NOT touch any other memory note.
- Do NOT run git add/commit/stash/checkout/restore.
- Do NOT delete the memory note or create a new differently-named one — this is
  an in-place content replacement, preserving the existing filename and its
  `[[revert-drill-verification]]` backlink.

## Acceptance Criteria
- AC1: The memory note's content matches SOURCE exactly except `__MODIFIED__`
  is now a real timestamp. Prove with a `diff` between SOURCE and the target.
- AC2: `grep -rn "__MODIFIED__"` across the memory directory returns nothing.
- AC3: MEMORY.md has exactly one changed line; all 12 other bullets identical.
- AC4: `git status --porcelain` in the repo is unchanged apart from the
  already-untracked `tasks/` directory.

## Commands
Run each with `; echo "EXIT:$?"` immediately after, and capture literal output.
1. `git -C /home/udai/PennyPilot status --porcelain | wc -l`
2. `date -u +%Y-%m-%dT%H:%M:%S.000Z`
3. `wc -l /home/udai/.claude/projects/-home-udai-PennyPilot/memory/MEMORY.md`
4. (apply the changes)
5. `diff /home/udai/PennyPilot/tasks/001-engineer-routing-memory/new-memory-content.md /home/udai/.claude/projects/-home-udai-PennyPilot/memory/worker-codex-review-flow.md`
   — expect exactly one differing line pair, the `modified:` field.
6. `grep -rn "__MODIFIED__" /home/udai/.claude/projects/-home-udai-PennyPilot/memory/`
   — expect no matches (exit 1 is the pass here).
7. `grep -c "^- \[" /home/udai/.claude/projects/-home-udai-PennyPilot/memory/MEMORY.md`
   — expect 13, same as before.
8. `git -C /home/udai/PennyPilot status --porcelain | wc -l`

## Required Evidence
Write full evidence to `tasks/001-engineer-routing-memory/verification-1.md`;
reply with at most 15 lines plus that path. Include every command, literal
output, exit codes, the step-5 diff in full, and any deviation or blocker.
