# Verification Report — Task 015 subagent-statusline.sh

Date: 2026-08-05  
Verifier: implementation worker (read-only; no files changed)

---

## T1 (AC1) — script exists and is executable

```
$ test -x ~/.claude/subagent-statusline.sh; echo "exit=$?"
exit=0
```
PASS. File exists and has execute bit.

---

## T2 (AC2, AC4) — two-task mock run

### Raw output
```
$ MOCK='{"columns":80,"tasks":[
 {"id":"t-resolved","name":"backend-worker","type":"task","status":"running","model":"claude-sonnet-4-6","effort":"high","contextWindowSize":200000,"tokenCount":50000},
 {"id":"t-unresolved","name":"cold-agent","type":"task","status":"pending"}
]}'
$ printf '%s' "$MOCK" | ~/.claude/subagent-statusline.sh
{"id":"t-resolved","content":"[38;5;177m◆[0m [1mbackend-worker[0m  [2m·[0m [38;5;75msonnet-4-6[0m  [2m·[0m [38;5;215m⚡high[0m  [2mrunning[0m  [38;5;245m25% ctx[0m"}
{"id":"t-unresolved","content":"[38;5;177m◆[0m [1mcold-agent[0m  [2m·[0m [38;5;245m…[0m  [2mpending[0m"}
```

### Line count
```
$ printf '%s' "$MOCK" | ~/.claude/subagent-statusline.sh | wc -l
2
```

### Each line parses as standalone JSON (jq -c .)
```
$ printf '%s' "$MOCK" | ~/.claude/subagent-statusline.sh | jq -c .; echo "exit=$?"
{"id":"t-resolved","content":"[38;5;177m◆[0m [1mbackend-worker[0m  [2m·[0m [38;5;75msonnet-4-6[0m  [2m·[0m [38;5;215m⚡high[0m  [2mrunning[0m  [38;5;245m25% ctx[0m"}
{"id":"t-unresolved","content":"[38;5;177m◆[0m [1mcold-agent[0m  [2m·[0m [38;5;245m…[0m  [2mpending[0m"}
exit=0
```

### jq -r '.id'
```
$ printf '%s' "$MOCK" | ~/.claude/subagent-statusline.sh | jq -r '.id'
t-resolved
t-unresolved
```

### jq -r '.content' (decoded ANSI visible; terminal strips escapes)
```
$ printf '%s' "$MOCK" | ~/.claude/subagent-statusline.sh | jq -r '.content'
[38;5;177m◆[0m [1mbackend-worker[0m  [2m·[0m [38;5;75msonnet-4-6[0m  [2m·[0m [38;5;215m⚡high[0m  [2mrunning[0m  [38;5;245m25% ctx[0m
[38;5;177m◆[0m [1mcold-agent[0m  [2m·[0m [38;5;245m…[0m  [2mpending[0m
```

Line 1: .id == "t-resolved", .content contains "sonnet-4-6" ✓, contains "25% ctx" ✓ (50000/200000=25%)  
Line 2: .id == "t-unresolved", .content contains "…" placeholder ✓, no crash ✓  
PASS.

---

## T3 (AC3) — no tasks key / empty tasks array → zero output, exit 0

```
$ printf '%s' '{"columns":80}' | ~/.claude/subagent-statusline.sh; echo "exit=$?"
exit=0
```
(zero output lines)

```
$ printf '%s' '{"tasks":[]}' | ~/.claude/subagent-statusline.sh; echo "exit=$?"
exit=0
```
(zero output lines)

PASS. Both cases: no output, exit 0.

---

## T4 (AC4) — raw output has no literal 0x1b; decoded content does

### Raw line — count of literal ESC (033) bytes
```
$ printf '%s' "$MOCK" | ~/.claude/subagent-statusline.sh | head -1 | od -An -c | grep -c '033'
0
```
Result: **0** raw ESC bytes in the JSON line.

### Decoded content — count of ESC bytes after jq -r
```
$ printf '%s' "$MOCK" | ~/.claude/subagent-statusline.sh | head -1 | jq -r '.content' | od -An -c | grep -c '033'
10
```
Result: **10** ESC bytes present once decoded — ANSI sequences are properly JSON-escaped as  in the emitted JSON.

PASS.

---

## T5 (AC5) — settings.json valid JSON, all keys present

```
$ jq . ~/.claude/settings.json; echo "exit=$?"
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
exit=0
```

Keys present: model ✓, statusLine ✓ (unchanged, still points to ~/.claude/statusline.sh), subagentStatusLine ✓ (new, points to ~/.claude/subagent-statusline.sh), skipDangerousModePermissionPrompt ✓, theme ✓  
PASS.

---

## T6 (AC6) — statusline.sh unchanged; mtime / head-3 check

```
$ stat -c "%A %h %U %G %s %Y %n" ~/.claude/statusline.sh ~/.claude/subagent-statusline.sh
-rwxrwxr-x 1 udai udai 4416 1784694670 /home/udai/.claude/statusline.sh
-rwxrwxr-x 1 udai udai 2456 1785924181 /home/udai/.claude/subagent-statusline.sh
```

statusline.sh mtime epoch: 1784694670 (Jul 22 04:31)  
subagent-statusline.sh mtime epoch: 1785924181 (Aug 5 10:03)  
statusline.sh is older — it was not modified as part of this work.

```
$ head -3 /home/udai/.claude/statusline.sh
#!/usr/bin/env bash
# GOAT status line for Claude Code.
# Reads one JSON session blob on stdin and prints two colored rows.
```

Confirms the main statusline.sh is the original GOAT script, untouched.  
PASS.

---

## Robustness probe — numeric effort, no status field

```
$ printf '%s' '{"tasks":[{"id":"x","name":"n","model":"claude-opus-4-1-20250805","effort":32000,"tokenCount":10,"contextWindowSize":100000}]}' | ~/.claude/subagent-statusline.sh | jq -c .
{"id":"x","content":"[38;5;177m◆[0m [1mn[0m  [2m·[0m [38;5;75mopus-4-1-20250805[0m  [2m·[0m [38;5;215m⚡32000[0m  [38;5;245m0% ctx[0m"}
```

One valid JSON line ✓  
.content contains "32000" ✓ (as ⚡32000)  
.content contains "opus-4-1-20250805" ✓ (claude- prefix stripped)  
ctx% = floor(10/100000*100) = 0% ctx ✓ (correct floor behavior)  
PASS.

---

## Summary

| Test | Criterion | Result |
|------|-----------|--------|
| T1   | AC1: script exists and executable | PASS |
| T2   | AC2/AC4: two-task mock, 2 lines, valid JSON, ids correct, content correct | PASS |
| T3   | AC3: no tasks key → zero output, exit 0 | PASS |
| T4   | AC4: no raw ESC in JSON (count=0); decoded content has ESC (count=10) | PASS |
| T5   | AC5: settings.json valid, all 5 keys present, statusLine unchanged | PASS |
| T6   | AC6: statusline.sh mtime is Jul 22 (pre-dates this work), head-3 confirms GOAT script | PASS |
| Probe | numeric effort + no status: one valid JSON line, contains 32000 and opus-4-1-20250805 | PASS |

All acceptance criteria AC1–AC6 verified. No failures observed.
