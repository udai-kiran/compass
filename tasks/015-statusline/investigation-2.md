# Statusline investigation-2

Source: https://code.claude.com/docs/en/statusline.md (fetched 2026-08-05)
`claude --version`: **2.1.222 (Claude Code)**

---

## 1. Full `subagentStatusLine` section — verbatim

```
## Subagent status lines

The `subagentStatusLine` setting renders a custom row body for each [subagent](/docs/en/sub-agents) shown in the agent panel below the prompt. Use it to replace the default `name · description · token count` row with your own formatting.

{
  "subagentStatusLine": {
    "type": "command",
    "command": "~/.claude/subagent-statusline.sh"
  }
}

The command runs once per refresh tick and receives all visible subagent rows as a single JSON object on stdin. The input includes the [base hook fields](/docs/en/hooks#common-input-fields), a `columns` field with the usable row width, and a `tasks` array. Each task has `id`, `name`, `type`, `status`, `description`, `label`, `startTime`, `model`, `effort`, `contextWindowSize`, `tokenCount`, `tokenSamples`, and `cwd`.

The per-task `model` field is the resolved model ID the task runs on. `contextWindowSize` is that model's context window in tokens, computed the same way as the main status line's `context_window.context_window_size`, so you can render a per-row percentage from `tokenCount`. Both fields require Claude Code v2.1.205 or later and are omitted for a task whose model isn't resolved yet.

The per-task `effort` field is the reasoning effort set for that subagent, in its [definition frontmatter](/docs/en/sub-agents#supported-frontmatter-fields) or on the individual invocation. The value is either one of the effort level strings `low`, `medium`, `high`, `xhigh`, or `max`, or a numeric token budget. The field reports the configured value as written: if the model doesn't support that level, the effort Claude Code actually applies may differ. The field requires Claude Code v2.1.214 or later and is absent when the subagent inherits the session's effort level.

Write one JSON line to stdout per row you want to override, in the form `{"id": "<task id>", "content": "<row body>"}`. The `content` string is rendered as-is, including ANSI colors and OSC 8 hyperlinks. Omit a task's `id` to keep the default rendering for that row; emit an empty `content` string to hide it.

The same trust and `disableAllHooks` gates that apply to `statusLine` apply here. Plugins can ship a default `subagentStatusLine` in their [`settings.json`](/docs/en/plugins-reference#standard-plugin-layout).
```

### OUTPUT contract — key excerpt (verbatim)

> Write one JSON line to stdout per row you want to override, in the form `{"id": "<task id>", "content": "<row body>"}`. The `content` string is rendered as-is, including ANSI colors and OSC 8 hyperlinks. Omit a task's `id` to keep the default rendering for that row; emit an empty `content` string to hide it.

**Mapping**: one JSON line per subagent task you want to override (not "one line per task in order"); tasks you omit from stdout keep their default rendering. The command receives ALL tasks in the `tasks` array, outputs only those it wants to override.

---

## 2. Complete example subagent-statusline script

The docs do NOT include a complete standalone example script for `subagentStatusLine`. The section only gives the configuration snippet above and the output contract. No `subagent-statusline.sh` example appears anywhere in the page.

The closest analogous complete script from the main `statusLine` examples (bash, multi-line variant) is:

```bash
#!/bin/bash
input=$(cat)

MODEL=$(echo "$input" | jq -r '.model.display_name')
DIR=$(echo "$input" | jq -r '.workspace.current_dir')
COST=$(echo "$input" | jq -r '.cost.total_cost_usd // 0')
PCT=$(echo "$input" | jq -r '.context_window.used_percentage // 0' | cut -d. -f1)
DURATION_MS=$(echo "$input" | jq -r '.cost.total_duration_ms // 0')

CYAN='\033[36m'; GREEN='\033[32m'; YELLOW='\033[33m'; RED='\033[31m'; RESET='\033[0m'

if [ "$PCT" -ge 90 ]; then BAR_COLOR="$RED"
elif [ "$PCT" -ge 70 ]; then BAR_COLOR="$YELLOW"
else BAR_COLOR="$GREEN"; fi

FILLED=$((PCT / 10)); EMPTY=$((10 - FILLED))
printf -v FILL "%${FILLED}s"; printf -v PAD "%${EMPTY}s"
BAR="${FILL// /█}${PAD// /░}"

MINS=$((DURATION_MS / 60000)); SECS=$(((DURATION_MS % 60000) / 1000))

BRANCH=""
git rev-parse --git-dir > /dev/null 2>&1 && BRANCH=" | 🌿 $(git branch --show-current 2>/dev/null)"

echo -e "${CYAN}[$MODEL]${RESET} 📁 ${DIR##*/}$BRANCH"
COST_FMT=$(printf '$%.2f' "$COST")
echo -e "${BAR_COLOR}${BAR}${RESET} ${PCT}% | ${YELLOW}${COST_FMT}${RESET} | ⏱️ ${MINS}m ${SECS}s"
```

(This is a `statusLine` example, not `subagentStatusLine`. No subagent-specific example exists in the docs.)

---

## 3. Per-task field list and possible values

From the docs, each task in the `tasks` array has:

| Field              | Description / Possible values                                                                                          |
|--------------------|-----------------------------------------------------------------------------------------------------------------------|
| `id`               | Task identifier (used as the key in stdout JSON lines)                                                                |
| `name`             | Task name                                                                                                             |
| `type`             | Task type — **not defined further in the docs**                                                                        |
| `status`           | Task status — **not defined further in the docs**                                                                      |
| `description`      | Task description                                                                                                      |
| `label`            | Task label                                                                                                            |
| `startTime`        | Task start time                                                                                                       |
| `model`            | Resolved model ID the task runs on (e.g. `"claude-opus-5"`). Omitted if model not yet resolved. Requires v2.1.205+   |
| `effort`           | Reasoning effort: `"low"`, `"medium"`, `"high"`, `"xhigh"`, `"max"`, or a numeric token budget. Absent when the subagent inherits the session's effort. Requires v2.1.214+ |
| `contextWindowSize`| Model's context window size in tokens. Requires v2.1.205+, omitted if model not yet resolved                          |
| `tokenCount`       | Token count for the task (use with `contextWindowSize` to compute per-row percentage)                                  |
| `tokenSamples`     | Token samples (not described further)                                                                                  |
| `cwd`              | Current working directory for the task                                                                                |

Possible values for `effort` (verbatim from docs): `low`, `medium`, `high`, `xhigh`, `max`, or a numeric token budget.
Possible values for `model`: the resolved model ID string (same namespace as `model.id` in the main status line JSON).
Possible values for `status` and `type`: **not specified in the docs**.

---

## 4. `claude --version` literal output

```
2.1.222 (Claude Code)
```

---

## 5. `~/.claude/statusline.sh` literal contents

File exists. Full contents:

```bash
#!/usr/bin/env bash
# GOAT status line for Claude Code.
# Reads one JSON session blob on stdin and prints two colored rows.
# Dependency-light: jq + git only. Runs on every render, so keep it fast.

input=$(cat)

# --- ANSI palette ---------------------------------------------------------
R=$'\033[0m'; B=$'\033[1m'; DIM=$'\033[2m'
GRN=$'\033[38;5;42m'; YEL=$'\033[38;5;220m'; RED=$'\033[38;5;203m'
CYN=$'\033[38;5;44m'; MAG=$'\033[38;5;177m'; BLU=$'\033[38;5;75m'
GRY=$'\033[38;5;245m'; ORG=$'\033[38;5;215m'

# --- one jq pass: newline-delimited scalars (empty lines preserved) -------
# NOTE: newline-delimited into mapfile, NOT tab into read: tab is IFS
# whitespace so read collapses adjacent tabs and drops empty fields,
# shifting every later column. mapfile -t keeps empty lines positional.
mapfile -t F < <(printf '%s' "$input" | jq -r '
  [ .model.display_name // "?",
    .workspace.current_dir // .cwd // ".",
    (.context_window.used_percentage // "" | tostring),
    (.cost.total_cost_usd // 0 | tostring),
    (.cost.total_duration_ms // 0 | tostring),
    (.rate_limits.five_hour.used_percentage // "" | tostring),
    (.effort.level // ""),
    (.thinking.enabled // false | tostring),
    (.pr.number // "" | tostring),
    (.pr.review_state // "")
  ] | .[]')
model=${F[0]}; cur_dir=${F[1]}; ctx=${F[2]}; cost=${F[3]}; dur_ms=${F[4]}
rl5=${F[5]}; effort=${F[6]}; thinking=${F[7]}; pr_num=${F[8]}; pr_state=${F[9]}

dir_name=$(basename "$cur_dir")

# --- account identity (from ~/.claude.json, NOT the session blob) ---------
# The stdin session JSON carries no account info, so read the logged-in
# account out-of-band. Same value for every session on this machine.
acct=""; org=""
acct_file="$HOME/.claude.json"
if [ -f "$acct_file" ]; then
  mapfile -t A < <(jq -r '.oauthAccount // {} | [ .emailAddress // "", .organizationName // "" ] | .[]' "$acct_file" 2>/dev/null)
  acct=${A[0]}; org=${A[1]}
fi

# --- git branch + dirty count --------------------------------------------
branch=""; dirty=""
if git -C "$cur_dir" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  branch=$(git -C "$cur_dir" rev-parse --abbrev-ref HEAD 2>/dev/null)
  n=$(git -C "$cur_dir" status --porcelain 2>/dev/null | wc -l | tr -d ' ')
  [ "$n" -gt 0 ] 2>/dev/null && dirty="±${n}"
fi

# --- LINE 1: identity -----------------------------------------------------
line1="${MAG}🐐 ${B}${model}${R}   ${CYN}📁 ${dir_name}${R}"
if [ -n "$branch" ]; then
  line1+="   ${GRN} ${branch}${R}"
  [ -n "$dirty" ] && line1+="${YEL}${dirty}${R}"
fi
if [ -n "$pr_num" ]; then
  case "$pr_state" in
    approved)          ps="${GRN}✔${R}";;
    changes_requested) ps="${RED}✗${R}";;
    pending)           ps="${YEL}◌${R}";;
    draft)             ps="${GRY}◑${R}";;
    *)                 ps="";;
  esac
  line1+="   ${BLU}PR#${pr_num}${R} ${ps}"
fi
[ -n "$acct" ] && line1+="   ${GRY}👤 ${acct}${R}"
[ -n "$org" ]  && line1+="   ${DIM}🏢 ${org}${R}"

# --- LINE 2: telemetry ----------------------------------------------------
# context-usage bar (8 cells), colored by fill level
bar=""; pct_str=""
if [ -n "$ctx" ] && [ "$ctx" != "null" ]; then
  pct=${ctx%.*}; [ -z "$pct" ] && pct=0
  filled=$(( (pct * 8 + 50) / 100 )); [ "$filled" -gt 8 ] && filled=8
  if   [ "$pct" -ge 85 ]; then c=$RED
  elif [ "$pct" -ge 60 ]; then c=$YEL
  else c=$GRN; fi
  cells=""
  for i in $(seq 1 8); do
    [ "$i" -le "$filled" ] && cells+="█" || cells+="░"
  done
  bar="${c}${cells}${R}"
  pct_str="${c}${pct}%${R} ${DIM}ctx${R}"
fi

# cost
cost_fmt=$(printf '$%.2f' "$cost" 2>/dev/null)
# duration ms -> Xm Ys
secs=$(( ${dur_ms%.*} / 1000 )); mins=$(( secs / 60 )); rem=$(( secs % 60 ))
if [ "$mins" -gt 0 ]; then dur_fmt="${mins}m ${rem}s"; else dur_fmt="${rem}s"; fi

line2="$bar"
[ -n "$pct_str" ] && line2+="  $pct_str"
# separator only when something precedes it (avoids a dangling leading "·")
sep() { [ -n "$line2" ] && printf '  %s·%s ' "$GRY" "$R"; }
line2+="$(sep)${GRN}${cost_fmt}${R}"
line2+="$(sep)${GRY}${dur_fmt}${R}"
if [ -n "$rl5" ] && [ "$rl5" != "null" ]; then
  r=${rl5%.*}
  if   [ "$r" -ge 85 ]; then rc=$RED
  elif [ "$r" -ge 60 ]; then rc=$YEL
  else rc=$GRY; fi
  line2+="  ${GRY}·${R} ${DIM}5h${R} ${rc}${r}%${R}"
fi
if [ -n "$effort" ]; then
  line2+="  ${GRY}·${R} ${ORG}⚡${effort}${R}"
fi
[ "$thinking" = "true" ] && line2+=" ${MAG}✦${R}"

printf '%s\n%s\n' "$line1" "$line2"
```

---

## Notes / gaps

- `type` and `status` field possible values are **not enumerated** anywhere in the docs page.
- No complete `subagentStatusLine` example script exists in the docs; only the config snippet and output contract are given.
- `effort` values for `subagentStatusLine` tasks can be a **numeric token budget** (not just the named levels), unlike the main `effort.level` field which is always a named string.
- The input to `subagentStatusLine` also includes "base hook fields" (referenced as `/docs/en/hooks#common-input-fields`) — those are not reproduced here.
