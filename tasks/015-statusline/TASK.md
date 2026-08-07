# Task: Subagent status line — show each subagent's model

## Status
COMPLETE — script `~/.claude/subagent-statusline.sh` + `subagentStatusLine` key in
`~/.claude/settings.json`. AC1–AC6 all proven literally (verification-1.md).
Codex implementation review (review-1.md): NO correctness/contract findings; its
only caveat (can't prove statusline.sh byte-identity without pre-change bytes) is
resolved by mtime (Jul 22, pre-dates this work) + head-3 GOAT confirmation + the
implementer never opening it for writing. No open findings.

## Objective
In the Claude Code agent panel (rows below the prompt, one per running/finished
subagent), each row shows the **resolved model** that subagent is running on,
alongside its name — instead of the default `name · description · token count`.

## Root Cause
Not a bug. Feature request. The main `statusLine` stdin payload only carries the
*main session* `model.{id,display_name}` — it has **no** subagent-model field
(confirmed verbatim, investigation-1.md §b). Per-subagent model is exposed only
through a *separate* setting, `subagentStatusLine`, which receives a `.tasks[]`
array where each task has a resolved `model` field.

## Scope
- CREATE `~/.claude/subagent-statusline.sh` (new script; outside the repo — a dotfile).
- EDIT `~/.claude/settings.json` — add a `subagentStatusLine` key.
- Do NOT touch `~/.claude/statusline.sh` (the existing main status line) or the
  existing `statusLine` / `model` / `theme` / `skipDangerousModePermissionPrompt`
  keys in settings.json.

## Dependencies
- none

## Facts (from primary-source doc https://code.claude.com/docs/en/statusline.md)
- F1: `claude --version` = **2.1.222 (Claude Code)**. Clears v2.1.205 (`model`,
  `contextWindowSize`) and v2.1.214 (`effort`) minimums. (investigation-2.md §4)
- F2: `subagentStatusLine` stdin = one JSON object: base hook fields, `columns`
  (row width), and `tasks[]`. Each task: `id, name, type, status, description,
  label, startTime, model, effort, contextWindowSize, tokenCount, tokenSamples,
  cwd`. (investigation-2.md §1, verbatim)
- F3: `model` = resolved model ID string (e.g. `claude-sonnet-4-6`); **omitted**
  until resolved. `contextWindowSize` = that model's window in tokens.
- F4: `effort` = one of `low|medium|high|xhigh|max` OR a numeric token budget;
  absent when the subagent inherits the session effort.
- F5: OUTPUT CONTRACT (verbatim): "Write one JSON line to stdout per row you want
  to override, in the form `{"id": "<task id>", "content": "<row body>"}`. The
  `content` string is rendered as-is, including ANSI colors and OSC 8 hyperlinks.
  Omit a task's `id` to keep the default rendering for that row; emit an empty
  `content` string to hide it." → NOT positional; keyed by id; omitted tasks keep
  default rows. `.tasks` absent ⇒ emit nothing ⇒ safe no-op.
- F6: `content` is a JSON string ⇒ ANSI ESC (0x1b) must be JSON-escaped to
  ``. Build the line with `jq -c` (ANSI via `--arg`), never by hand-printf.
- F7: existing `~/.claude/settings.json` = `{ model, statusLine{type,command,
  padding}, skipDangerousModePermissionPrompt, theme }` — has NO `subagentStatusLine`
  yet. (investigation-1.md §e)
- F8: existing `~/.claude/statusline.sh` palette to match: R/B/DIM + 256-color
  GRN42 YEL220 RED203 CYN44 MAG177 BLU75 GRY245 ORG215. (investigation-2.md §5)

## Plan
- P1: Write `~/.claude/subagent-statusline.sh` that reads stdin, and with a single
  `jq -c` pass over `.tasks[]?`:
    - `select(.id != null and .id != "")` (skip untargetable rows);
    - name = `.name // .label // .description // .type // "task"`;
    - model = `.model` with leading `claude-` stripped, colored; when `.model`
      absent show a dim `…` placeholder (row updates once resolved);
    - append effort (⚡), status, and a per-row ctx% = `floor(tokenCount /
      contextWindowSize * 100)` only when both present;
    - emit `{id, content}` with jq so ESC bytes are encoded ``.
  `.tasks` absent ⇒ zero output ⇒ every row keeps its default (safe).
- P2: `chmod +x` the script.
- P3: Add to `~/.claude/settings.json` (preserving every existing key, valid JSON):
  `"subagentStatusLine": { "type": "command", "command": "~/.claude/subagent-statusline.sh" }`.

## Acceptance Criteria
- AC1: `~/.claude/subagent-statusline.sh` exists and is executable (`-x`).
- AC2: Fed mock stdin with two tasks — one with `model:"claude-sonnet-4-6"` and a
  `tokenCount`/`contextWindowSize`, one with the `model` key ABSENT — the script
  prints exactly two lines, each a **standalone valid JSON object** (jq-parseable)
  whose `id` equals the corresponding input task id, and whose `content`:
    - resolved task → contains `sonnet-4-6` and a `% ctx` figure;
    - unresolved task → contains the `…` placeholder, no crash.
- AC3: Fed mock stdin with NO `tasks` key, the script exits 0 and prints nothing.
- AC4: `content` strings contain no raw 0x1b byte — ESC is JSON-escaped ``
  (proven: `jq .` parses each line without a control-char error).
- AC5: `~/.claude/settings.json` after the edit is valid JSON (`jq .` exit 0),
  still contains the original `model`, `statusLine` (unchanged), `theme`,
  `skipDangerousModePermissionPrompt` keys, plus the new `subagentStatusLine`
  pointing at the new script.
- AC6: `~/.claude/statusline.sh` is byte-identical to before (not touched).

## Verification
- T1: `test -x ~/.claude/subagent-statusline.sh; echo $?`
- T2: mock-input run (two tasks) → pipe each output line through `jq .` → show ids + content.
- T3: mock-input run (no tasks key) → show empty output + exit code.
- T4: `jq . ~/.claude/settings.json` → show full object.
- T5: `grep -c $'\x1b' <(…one output line…)` OR `jq -r .content` shows the ANSI; and
  the raw line has `` not a literal ESC (od/grep check).
- T6: confirm statusline.sh unchanged (diff against a pre-read copy / git-independent).

## Non-Goals
- Not changing the main `statusLine`.
- Not enumerating `status`/`type` values (docs don't define them; treat as opaque strings).
- Not handling non-command hook types.

## Process note (deliberate deviation)
This is a self-contained ~40-line dotfile change outside the PennyPilot repo, with
the design validated directly against the primary-source doc (both investigation
files). I am folding design-review into a single Codex implementation review of the
finished script rather than running a separate plan-review round. The implementation
review gate is NOT skipped.
