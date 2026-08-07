# Investigation: Claude Code statusLine stdin schema

Date: 2026-08-05
Source: https://code.claude.com/docs/en/statusline.md (fetched live)

---

## URLs tried

1. `https://code.claude.com/docs/en/statusline` — returned Next.js HTML (SPA, no inline content)
2. `https://docs.claude.com/en/docs/claude-code/statusline` — same SPA shell
3. `https://docs.anthropic.com/en/docs/claude-code/statusline` — same SPA shell
4. `https://code.claude.com/docs/en/statusline.md` — **SUCCESS** — returned full Markdown source

---

## a. Complete JSON structure passed on stdin (verbatim from doc)

Quoted verbatim from the "Full JSON schema" accordion (doc lines 213–296):

```json
{
  "cwd": "/current/working/directory",
  "session_id": "abc123...",
  "session_name": "my-session",
  "prompt_id": "550e8400-e29b-41d4-a716-446655440000",
  "transcript_path": "/path/to/transcript.jsonl",
  "model": {
    "id": "claude-opus-5",
    "display_name": "Opus"
  },
  "workspace": {
    "current_dir": "/current/working/directory",
    "project_dir": "/original/project/directory",
    "added_dirs": [],
    "git_worktree": "feature-xyz",
    "repo": {
      "host": "github.com",
      "owner": "anthropics",
      "name": "claude-code"
    }
  },
  "version": "2.1.90",
  "output_style": {
    "name": "default"
  },
  "cost": {
    "total_cost_usd": 0.01234,
    "total_duration_ms": 45000,
    "total_api_duration_ms": 2300,
    "total_lines_added": 156,
    "total_lines_removed": 23
  },
  "context_window": {
    "total_input_tokens": 15500,
    "total_output_tokens": 1200,
    "context_window_size": 200000,
    "used_percentage": 8,
    "remaining_percentage": 92,
    "current_usage": {
      "input_tokens": 8500,
      "output_tokens": 1200,
      "cache_creation_input_tokens": 5000,
      "cache_read_input_tokens": 2000
    }
  },
  "exceeds_200k_tokens": false,
  "fast_mode": false,
  "effort": {
    "level": "high"
  },
  "thinking": {
    "enabled": true
  },
  "rate_limits": {
    "five_hour": {
      "used_percentage": 23.5,
      "resets_at": 1738425600
    },
    "seven_day": {
      "used_percentage": 41.2,
      "resets_at": 1738857600
    }
  },
  "vim": {
    "mode": "NORMAL"
  },
  "agent": {
    "name": "security-reviewer"
  },
  "pr": {
    "number": 1234,
    "url": "https://github.com/anthropics/claude-code/pull/1234",
    "review_state": "pending"
  },
  "worktree": {
    "name": "my-feature",
    "path": "/path/to/.claude/worktrees/my-feature",
    "branch": "worktree-my-feature",
    "original_cwd": "/path/to/project",
    "original_branch": "main"
  }
}
```

### Fields that may be absent (quoted verbatim):

> * `session_name`: appears when a custom name has been set with `--name` or `/rename`, or once an AI-generated session title exists. The default display name, such as `my-app-3f`, doesn't populate it
> * `prompt_id`: appears only after the first user input
> * `workspace.git_worktree`: appears only when the current directory is inside a linked git worktree
> * `workspace.repo`: appears only inside a git repository with an `origin` remote configured
> * `effort`: appears only when the current model supports the reasoning effort parameter
> * `vim`: appears only when vim mode is enabled
> * `agent`: appears only when running with the `--agent` flag or agent settings configured
> * `pr`: appears only while an open PR is found for the current branch, and is removed once the PR merges or closes. `pr.review_state` may be independently absent
> * `worktree`: appears only during `--worktree` sessions. When present, `branch` and `original_branch` may also be absent for hook-based worktrees
> * `rate_limits`: appears only for Claude.ai subscribers (Pro/Max) after the first API response in the session. Each window (`five_hour`, `seven_day`) may be independently absent.

### Fields that may be `null` (quoted verbatim):

> * `context_window.current_usage`: `null` before the first API call in a session, and again after `/compact` until the next API call repopulates it
> * `context_window.used_percentage`, `context_window.remaining_percentage`: may be `null` early in the session

---

## b. Does the payload contain a field for the model of a *subagent* currently running?

**No.** The main `statusLine` stdin payload contains only `model.id` and `model.display_name` for the *main session* model. There is no field in the main payload that reports the model of a currently-running subagent or Task-tool agent.

However, the doc describes a *separate* setting called `subagentStatusLine` (distinct from `statusLine`) that does expose per-task model information. Quoted verbatim from the doc:

> The `subagentStatusLine` setting renders a custom row body for each subagent shown in the agent panel below the prompt. [...] The command runs once per refresh tick and receives all visible subagent rows as a single JSON object on stdin. The input includes the base hook fields, a `columns` field with the usable row width, and a `tasks` array. Each task has `id`, `name`, `type`, `status`, `description`, `label`, `startTime`, `model`, `effort`, `contextWindowSize`, `tokenCount`, `tokenSamples`, and `cwd`.
>
> The per-task `model` field is the resolved model ID the task runs on. `contextWindowSize` is that model's context window in tokens, computed the same way as the main status line's `context_window.context_window_size`, so you can render a per-row percentage from `tokenCount`. Both fields require Claude Code v2.1.205 or later and are omitted for a task whose model isn't resolved yet.

So: the main `statusLine` payload has **no subagent model field**. Subagent model information is only available via `subagentStatusLine`, which receives a different payload (a `tasks` array), not the schema shown above.

---

## c. settings.json `statusLine` config block shape (verbatim from doc)

From the "Manually configure a status line" section:

```json
{
  "statusLine": {
    "type": "command",
    "command": "~/.claude/statusline.sh",
    "padding": 2
  }
}
```

Fields:
- `type` (required): must be `"command"`
- `command` (required): shell command or path to script
- `padding` (optional, int): extra horizontal spacing in characters, defaults to `0`
- `refreshInterval` (optional, int, min 1): re-run command every N seconds in addition to event-driven updates
- `hideVimModeIndicator` (optional, bool): suppress built-in `-- INSERT --` text when your script renders `vim.mode` itself

Quoted verbatim from doc:

> The optional `padding` field adds extra horizontal spacing (in characters) to the status line content. Defaults to `0`. This padding is in addition to the interface's built-in spacing, so it controls relative indentation rather than absolute distance from the terminal edge.
>
> The optional `refreshInterval` field re-runs your command every N seconds in addition to the event-driven updates. The minimum is `1`. Set this when your status line shows time-based data such as a clock, or when background subagents change git state while the main session is idle. Leave it unset to run only on events.
>
> The optional `hideVimModeIndicator` field suppresses the built-in `-- INSERT --` text below the prompt. Set this to `true` when your script renders `vim.mode` itself, so the mode is not shown twice.

Inline command example (also from doc):

```json
{
  "statusLine": {
    "type": "command",
    "command": "jq -r '\"[\\(.model.display_name)] \\(.context_window.used_percentage // 0)% context\"'"
  }
}
```

`subagentStatusLine` uses the same shape:

```json
{
  "subagentStatusLine": {
    "type": "command",
    "command": "~/.claude/subagent-statusline.sh"
  }
}
```

---

## d. Example scripts from the doc

The doc provides examples in Bash, Python, and Node.js for these patterns:

1. **Context window usage with progress bar** (Bash/Python/Node.js)
2. **Git status with ANSI colors** (Bash/Python/Node.js)
3. **Cost and duration tracking** (Bash/Python/Node.js)
4. **Multi-line status** combining git + progress bar + cost (Bash/Python/Node.js)
5. **Clickable OSC 8 links** to GitHub repo (Bash/Python/Node.js)
6. **Rate limit usage** for Pro/Max subscribers (Bash/Python/Node.js)
7. **Caching slow git operations** using `session_id` as cache key (Bash/Python/Node.js)
8. **Windows configuration** (PowerShell + Git Bash)

Quick-test tip quoted verbatim from doc:

> **Test with mock input**: `echo '{"model":{"display_name":"Opus"},"workspace":{"current_dir":"/home/user/project"},"context_window":{"used_percentage":25},"session_id":"test-session-abc"}' | ./statusline.sh`

---

## e. User settings file findings

**File:** `/home/udai/.claude/settings.json`

**Exists:** Yes

**Current contents:**

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

The `statusLine` key is **already present**. It points to `~/.claude/statusline.sh` with `padding: 0`.

The referenced script `~/.claude/statusline.sh` was not checked for existence in this investigation (read-only scope was the settings file itself).

---

## Update triggers (verbatim from doc)

> Your script runs once when a session starts, including when you resume one. After that, it runs again when:
> * A new assistant message arrives
> * `/compact` finishes
> * The permission mode changes
> * Vim mode toggles
> * A `refreshInterval` timer elapses, if you set one

> Claude Code debounces updates at 300ms, so rapid changes batch together and your script runs once after the changes stop. If a new update triggers while your script is still running, Claude Code cancels the in-flight script.

---

## Terminal dimensions

> Claude Code captures your script's output instead of connecting it directly to the terminal, so `tput cols` and language-level width detection cannot read the terminal size from inside the script. Read the `COLUMNS` and `LINES` environment variables instead. Claude Code sets these to the current terminal dimensions before running your script. Requires Claude Code v2.1.153 or later.
