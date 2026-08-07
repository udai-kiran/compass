# Sonnet Worker Delegation — Iteration 1 (implement)

## Task
015-statusline — add a `subagentStatusLine` that surfaces each subagent's model.

## Approved Plan
- P1: create `~/.claude/subagent-statusline.sh` (exact content below — write it VERBATIM).
- P2: `chmod +x ~/.claude/subagent-statusline.sh`.
- P3: add the `subagentStatusLine` key to `~/.claude/settings.json`.

## Files and Symbols
- CREATE `~/.claude/subagent-statusline.sh`
- EDIT   `~/.claude/settings.json`

## Required Changes

### 1. Write `~/.claude/subagent-statusline.sh` with EXACTLY this content:

```bash
#!/usr/bin/env bash
# Subagent status line for Claude Code.
# Overrides each agent-panel row (one per subagent, below the prompt) to surface
# the RESOLVED MODEL that subagent runs on, plus its name, effort, status and a
# per-row context-usage %.
#
# Input : one JSON object on stdin with a .tasks[] array. Each task has id, name,
#         type, status, description, label, startTime, model, effort,
#         contextWindowSize, tokenCount, tokenSamples, cwd.
#         (https://code.claude.com/docs/en/statusline -> "Subagent status lines")
# Output: one compact JSON line per row to override -> {"id":..,"content":..}.
#         Rows whose id we omit keep their default rendering; no .tasks => no
#         output => every row keeps its default (safe no-op).
#
# The content is a JSON string, so ANSI ESC bytes must be encoded (). We
# therefore build every line with `jq -c` (ANSI passed via --arg) rather than by
# hand, so the emitted JSON is always valid.

input=$(cat)

# ANSI palette (matches ~/.claude/statusline.sh)
R=$'\033[0m'; B=$'\033[1m'; DIM=$'\033[2m'
MAG=$'\033[38;5;177m'; BLU=$'\033[38;5;75m'; ORG=$'\033[38;5;215m'
GRY=$'\033[38;5;245m'

printf '%s' "$input" | jq -c \
  --arg R "$R" --arg B "$B" --arg DIM "$DIM" \
  --arg MAG "$MAG" --arg BLU "$BLU" --arg ORG "$ORG" --arg GRY "$GRY" '
  .tasks[]?
  | select(.id != null and .id != "")
  | ( .name // .label // .description // .type // "task" )                    as $nm
  | ( .model // "" )                                                          as $m
  | ( if $m == "" then "\($GRY)…\($R)"
      else "\($BLU)\($m | sub("^claude-"; "") | sub("-latest$"; ""))\($R)"
      end )                                                                   as $model
  | ( if (.effort == null) then "" else (.effort | tostring) end )           as $ef
  | ( .status // "" )                                                         as $st
  | ( if (.tokenCount != null and (.contextWindowSize // 0) > 0)
        then (.tokenCount / .contextWindowSize * 100 | floor)
        else null end )                                                      as $pct
  | { id: .id,
      content: (
        "\($MAG)◆\($R) \($B)\($nm)\($R)  \($DIM)·\($R) \($model)"
        + (if $ef  != "" then "  \($DIM)·\($R) \($ORG)⚡\($ef)\($R)" else "" end)
        + (if $st  != "" then "  \($DIM)\($st)\($R)" else "" end)
        + (if $pct != null then "  \($GRY)\($pct)% ctx\($R)" else "" end)
      )
    }
'
```

### 2. `chmod +x ~/.claude/subagent-statusline.sh`

### 3. Edit `~/.claude/settings.json`

The current file is EXACTLY:
```json
{
  "model": "sonnet",
  "statusLine": {
    "type": "command",
    "command": "~/.claude/statusline.sh",
    "padding": 0
  },
  "skipDangerousModePermissionPrompt": true,
  "theme": "auto"
}
```
Add a `subagentStatusLine` key so the file becomes EXACTLY:
```json
{
  "model": "sonnet",
  "statusLine": {
    "type": "command",
    "command": "~/.claude/statusline.sh",
    "padding": 0
  },
  "subagentStatusLine": {
    "type": "command",
    "command": "~/.claude/subagent-statusline.sh"
  },
  "skipDangerousModePermissionPrompt": true,
  "theme": "auto"
}
```
If the on-disk settings.json differs from the "current file" shown above, STOP and
report the real contents — do not guess an edit.

## Must Not Change
- `~/.claude/statusline.sh` — do not open for writing, do not touch.
- The existing `model`, `statusLine`, `skipDangerousModePermissionPrompt`, `theme`
  keys and their values.

## Acceptance Criteria
See TASK.md AC1–AC6. Do NOT run verification yourself beyond confirming the writes
landed — a separate verification worker owns T1–T6.

## Commands
1. Write the script file (Write tool) with the exact content above.
2. `chmod +x ~/.claude/subagent-statusline.sh`
3. Read `~/.claude/settings.json`, confirm it matches the "current file" block, then
   apply the Edit adding the `subagentStatusLine` key.

## Required Evidence
- files changed (absolute paths)
- the literal `chmod` command + exit code
- literal `jq . ~/.claude/settings.json` output (proves valid JSON post-edit)
- literal `test -x ~/.claude/subagent-statusline.sh; echo $?`
- any deviation or blocker
Write full evidence to tasks/015-statusline/backend-1.md; reply with a <=20-line
digest + that path.
