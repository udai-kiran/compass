# Codex Worker Delegation — Iteration 1

## Task
085 — Update coordinator agent to use codex-worker

## Approved Plan
- P1: Replace every `sonnet-worker` occurrence with `codex-worker`
- P2: Update frontmatter description
- P3: Update DELEGATION.md template header
- P4: Update implementation section (### 3) to describe codex-worker interface
- P5: Keep all other workflow unchanged

## Files and Symbols
- `.claude/agents/coordinator.md` — sole file to edit

## Required Changes

### P1 — global replacement
Replace every occurrence of `sonnet-worker` with `codex-worker` (case-sensitive).

### P2 — frontmatter description (line 3)
Change:
```
description: Decomposes work into tracked tasks, reviews plans with Codex, delegates implementation to Sonnet workers, and validates every change against the approved plan.
```
To:
```
description: Decomposes work into tracked tasks, reviews plans with Codex, delegates implementation to Codex workers via codex-worker, and validates every change against the approved plan.
```

### P3 — DELEGATION.md template header (line 77)
Change `# Sonnet Worker Delegation` to `# Codex Worker Delegation`

### P4 — Implementation section (### 3. Implement)
Replace the current implementation section content (lines 159–169) with updated text that explains:
- Write `DELEGATION.md`, then delegate implementation to one or more `codex-worker` agents.
- Each `codex-worker` invocation needs two things from the coordinator: a **report-path** (e.g. `tasks/<task>/implementation-<n>.md`) and a **task prompt** containing the full implementation brief (the DELEGATION.md content is ideal).
- `codex-worker` delegates all implementation to OpenAI Codex CLI (terra model). It writes a structured report to the report-path.
- Parallel implementation is allowed only when workers own non-overlapping files or clearly separated components.
- Workers must not silently change scope or architecture. A material plan change returns to plan review.

### P5 — no other changes
Do NOT modify codex-reviewer workflow, task structure, verification steps, context discipline, or hard rules structure — only replace agent name references.

## Must Not Change
- Codex reviewer workflow (sections 2 and 5)
- Task structure and TASK.md format
- Verification workflow (section 4) — except agent name
- Context discipline section — except agent name
- Any file other than `.claude/agents/coordinator.md`

## Acceptance Criteria
- AC1: Zero occurrences of `sonnet-worker` or `Sonnet` remain
- AC2: Every previous `sonnet-worker` reference now says `codex-worker`
- AC3: DELEGATION.md template header says "Codex Worker Delegation"
- AC4: Implementation section explains report-path + task prompt interface
- AC5: Frontmatter description updated
- AC6: No other behavioural changes

## Commands
1. Edit `.claude/agents/coordinator.md` per the changes above
2. `grep -c 'sonnet-worker' .claude/agents/coordinator.md` — expect 0
3. `grep -c 'Sonnet' .claude/agents/coordinator.md` — expect 0  
4. `grep -c 'codex-worker' .claude/agents/coordinator.md` — expect multiple

## Required Evidence
- files changed (only `.claude/agents/coordinator.md`)
- complete diff
- grep counts for sonnet-worker (0), Sonnet (0), codex-worker (>0)
- exit codes
- any plan deviations or blockers
