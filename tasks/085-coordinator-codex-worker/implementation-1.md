# Implementation Report — Task 085 Iteration 1

## Files Inspected
- `tasks/085-coordinator-codex-worker/DELEGATION.md`
- `.claude/agents/coordinator.md`

## Files Changed
- `.claude/agents/coordinator.md`

## Changes Made

### P2 — Frontmatter description (line 3)
"delegates implementation to Sonnet workers" → "delegates implementation to Codex workers via codex-worker"

### P3 — DELEGATION.md template header (line 77)
`# Sonnet Worker Delegation` → `# Codex Worker Delegation`

### P1 — Global replacement of `sonnet-worker` → `codex-worker`
Locations updated:
1. Line 11 (×2): investigation-brief sentence + trailing delegation sentence
2. Line 30: parallel-agent spawning sentence
3. Line 161: "delegate implementation to one or more `sonnet-worker` agents"
4. Line 162: "`sonnet-worker` writes all implementation code…"
5. Line 259: hard rule — sole implementer
6. Line 260: hard rule — performs every non-`tasks/` edit
7. Line 263: hard rule — spawn parallel agents
8. Line 270: hard rule — applies Codex findings

### P4 — Implementation section (### 3. Implement) rewritten
Added explanation of codex-worker's interface:
- report-path parameter (e.g. `tasks/<task>/implementation-<n>.md`)
- task prompt parameter (DELEGATION.md content is ideal)
- Delegates to OpenAI Codex CLI (terra model); writes structured report at report-path

## Commands Run and Literal Output

```
$ grep -cn 'sonnet-worker' .claude/agents/coordinator.md; echo "exit:$?"
0
exit:1

$ grep -cn 'Sonnet' .claude/agents/coordinator.md; echo "exit:$?"
0
exit:1

$ grep -c 'codex-worker' .claude/agents/coordinator.md; echo "exit:$?"
10
exit:0
```

(grep exit 1 on the first two is correct — exit 1 means no lines matched, which is the desired result.)

## Acceptance Criteria

- AC1: Zero occurrences of `sonnet-worker` — PASS (count: 0)
- AC2: Zero occurrences of `Sonnet` — PASS (count: 0)
- AC3: DELEGATION.md template header says "Codex Worker Delegation" — PASS
- AC4: Implementation section explains report-path + task prompt interface — PASS
- AC5: Frontmatter description updated — PASS
- AC6: No other behavioural changes (codex-reviewer workflow, task structure, verification, hard rules structure all intact) — PASS

## Assumptions
- `grep -c` exit code 1 on zero-match queries is standard grep behaviour; it does not indicate a command failure.

## Unresolved Risks
- None.
