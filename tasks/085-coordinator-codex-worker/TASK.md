# Task: Update coordinator agent to use codex-worker

## Status
COMPLETE

## Objective
Replace all `sonnet-worker` references in `.claude/agents/coordinator.md` with `codex-worker`, and update the delegation format to match `codex-worker`'s interface (report-path + task prompt).

## Root Cause
Not applicable — feature change.

## Scope
- `.claude/agents/coordinator.md` — sole file

## Dependencies
- none

## Plan
- P1: Replace every `sonnet-worker` occurrence with `codex-worker` throughout the file
- P2: Update frontmatter description to reference Codex workers
- P3: Update DELEGATION.md template header from "Sonnet Worker Delegation" to "Codex Worker Delegation"
- P4: Update the implementation section (### 3) to note that `codex-worker` receives a **report-path** and **task prompt**, and the report-path should follow `tasks/<task>/implementation-<n>.md`
- P5: Keep the rest of the workflow (plan review, verify, codex review gates) unchanged

## Acceptance Criteria
- AC1: Zero occurrences of `sonnet-worker` or `Sonnet` remain in the file
- AC2: Every previous `sonnet-worker` reference now says `codex-worker`
- AC3: DELEGATION.md template header says "Codex Worker Delegation"
- AC4: Implementation section (### 3) explains that `codex-worker` is invoked with report-path + task prompt
- AC5: Frontmatter description updated
- AC6: No other behavioural changes to the workflow (plan review, verification, codex review, hard rules structure all preserved)

## Verification
- T1: Grep for `sonnet-worker` — expect 0 hits
- T2: Grep for `codex-worker` — expect multiple hits
- T3: Grep for `Sonnet` — expect 0 hits
- T4: Read full file to confirm workflow integrity

## Non-Goals
- Changing the codex-reviewer workflow
- Changing task structure or TASK.md format
- Modifying any other agent definition
