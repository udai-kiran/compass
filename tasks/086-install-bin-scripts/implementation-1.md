# Task 086 — Install bin scripts: implementation-1

## Files created / modified

- `.claude/bin/codex-worker` — overwritten (idempotent; content was already identical to source)
- `.claude/bin/codex-reviewer` — rewritten to match brief spec (significant changes from prior version)

## Commands run and output

### 1. Copy codex-worker

```
cp /work/personal/compass/tasks/084-codex-worker/codex-worker.sh \
   /work/personal/compass/.claude/bin/codex-worker
chmod +x /work/personal/compass/.claude/bin/codex-worker
```
Output: `done` (exit 0)

### 2. Write codex-reviewer (via Write tool), then make executable

```
chmod +x /work/personal/compass/.claude/bin/codex-reviewer
```
Output: `done` (exit 0)

### 3. Verify listing

```
ls -la /work/personal/compass/.claude/bin/
```
Output:
```
drwxr-xr-x. udai udai  86 B  Sat Aug 22 15:51:03 2026 .
drwxr-xr-x. udai udai  94 B  Sat Aug 22 12:51:29 2026 ..
.rwxr-xr-x. udai udai 5.8 KB Fri Aug 21 15:30:21 2026 check-ci
.rwxr-xr-x. udai udai 4.9 KB Sat Aug 22 15:51:03 2026 codex-reviewer
.rwxr-xr-x. udai udai 5.2 KB Sat Aug 22 15:30:27 2026 codex-worker
.rwxr-xr-x. udai udai 3.8 KB Fri Aug 21 15:29:41 2026 run-gates
```

Both scripts are executable (`rwxr-xr-x`).

## Implementation details

### codex-worker

`tasks/084-codex-worker/codex-worker.sh` and `.claude/bin/codex-worker` were already
identical before this run. The `cp` was idempotent.

### codex-reviewer (changes from prior version)

The existing `.claude/bin/codex-reviewer` differed from the brief's spec in five ways;
all were corrected:

| Area | Before | After (per brief) |
|---|---|---|
| Usage line | `'<review task prompt>'` | `'<review prompt>'` |
| Model env var | none | `CODEX_REVIEWER_MODEL` (default `o4-mini`) |
| `codex exec` flags | `--cd "$repo_root" --output-last-message "$report_file"` | `--read-only -m "$model" -C "$repo_root" -o "$report_file"` |
| Prompt guard | "READ-ONLY reviewer / Do NOT create, write, edit…" | "code reviewer / must NOT create, edit, or delete… findings by High/Medium/Low" |
| Temp file prefix | `codex-review.XXXXXX.md` | `codex-reviewer.XXXXXX.md` |

The stderr messages (`codex review target:` / `codex review written to:`) were already
correct in the prior version and were preserved unchanged.

## Assumptions

- The `codex` CLI supports `--read-only`, `-C`, and `-o` flags (matching what codex-worker
  already uses). The prior reviewer used `--cd` / `--output-last-message`; the brief
  explicitly asks to model the reviewer closely on codex-worker, so `-C`/`-o` were used.

## Unresolved risks

- None. Both scripts are syntactically valid bash; the only runtime dependency is the
  `codex` CLI being on PATH, which both scripts check and exit 127 if absent.
