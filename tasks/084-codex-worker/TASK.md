# Task: codex-worker tooling

## Status
APPROVED

## Objective
Create a `codex-worker` shell script and agent definition that lets the coordinator
delegate implementation work to the OpenAI Codex CLI (using the `terra` model),
analogous to how `codex-reviewer` delegates review work.

## Root Cause
Not applicable — new tooling.

## Scope
- `/home/udai/.claude/bin/codex-worker` — shell script (modeled on codex-reviewer)
- `/home/udai/.claude/agents/codex-worker.md` — agent definition

## Dependencies
- none

## Plan
- P1: Create `/home/udai/.claude/bin/codex-worker` shell script
  - Accept `<report-path> '<task prompt>'`
  - Use `--model terra` (overridable via `CODEX_WORKER_MODEL` env var)
  - Allow file modifications (NOT read-only — no READ-ONLY guard prompt)
  - Use `codex exec` with `--dangerously-bypass-approvals-and-sandbox`
  - Capture last message as report via `--output-last-message`
  - Refuse to overwrite existing report files (append-only, same as reviewer)
  - Include output-requirements guard telling Codex to emit a complete report as its final message
  - Make executable (chmod +x)
- P2: Create `/home/udai/.claude/agents/codex-worker.md` agent definition
  - Frontmatter: name, description, reference to the bin script
  - System prompt describing its role as an implementation worker using Codex/terra
- P3: Verify coordinator.md and sonnet-worker.md already exist at `/home/udai/.claude/agents/`

## Acceptance Criteria
- AC1: `/home/udai/.claude/bin/codex-worker` is executable and follows the same safety patterns as codex-reviewer (no overwrite, temp staging, stderr progress)
- AC2: Script passes `--model terra` to codex (configurable via env)
- AC3: Script does NOT include READ-ONLY guard (it's a worker, not reviewer)
- AC4: Script includes a report-quality guard in the prompt suffix
- AC5: `/home/udai/.claude/agents/codex-worker.md` exists with correct frontmatter
- AC6: coordinator.md and sonnet-worker.md already present (verified, no action needed)

## Verification
- T1: `bash -n /home/udai/.claude/bin/codex-worker` (syntax check)
- T2: `/home/udai/.claude/bin/codex-worker` with no args exits 2 with usage
- T3: `ls -la /home/udai/.claude/agents/` shows all three agent files

## Non-Goals
- Updating coordinator.md to reference codex-worker (separate decision)
- Actually running a codex-worker task end-to-end (requires real API key / model access)
