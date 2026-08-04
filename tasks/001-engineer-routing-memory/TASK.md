# Task: Make engineer routing durable in project memory

## Status
COMPLETE

## Objective
Stop future sessions from drifting back to `sonnet-worker` for app-code
implementation, and correct a stale `codex-reviewer` invocation signature.

## Root Cause
Two stale artifacts in `~/.claude/projects/-home-udai-PennyPilot/memory/`:

1. `worker-codex-review-flow.md` recorded the standing default as "delegate
   implementation to sonnet-worker". Correct at the time; now superseded for
   application code.
2. The same note documented `codex-reviewer "<prompt>"` as a **one**-argument
   script. Verified against `/home/udai/.claude/bin/codex-reviewer` lines 6-19:
   it takes **two** (`<report-path> '<prompt>'`) and refuses to overwrite an
   existing report. A session following the note would have failed with the
   usage message and exit 2.

## Scope
- `memory/worker-codex-review-flow.md` (in-place content replacement)
- `memory/MEMORY.md` (one index line)

## Dependencies
- 000-agent-harness (COMPLETE) — the wrappers had to actually work first

## Plan
- P1: Replace the note body with coordinator-authored content.
- P2: Update the note's index summary.

## Acceptance Criteria
- AC1: note matches the authored source except the `modified:` timestamp — PASS
- AC2: no `__MODIFIED__` token left in the memory dir — PASS
- AC3: exactly one MEMORY.md line changed — PASS
- AC4: repo working tree undisturbed — PASS (116 porcelain lines before & after)

## Verification
Evidence: `verification-1.md`. Coordinator independently re-read both targets;
`diff` showed a single differing line pair (the timestamp), and the index bullet
now reads "app code goes to the backend-engineer/frontend-engineer scripts".

## Decisions
- Updated the existing note **in place** rather than adding a new one. A second
  note would fragment the knowledge and leave the wrong default still sitting in
  memory to be read later. In-place also preserves the filename and its
  `[[revert-drill-verification]]` backlink.
- Kept the note's still-valid core (Codex review is a default not an opt-in;
  findings are untrusted until verified). Only the routing and the script
  signature were wrong.
- Delegated to `sonnet-worker`, not `backend-engineer`: this is harness config
  outside the repo, not application code.
- My brief asserted 12→13 index bullets; the worker reported the true count is
  12 and did not silently bend the file to match. Brief error, not a defect.

## Non-Goals
- Editing repo `CLAUDE.md`. The routing is a property of my local agent harness,
  not of the codebase, and would be noise for other contributors.
