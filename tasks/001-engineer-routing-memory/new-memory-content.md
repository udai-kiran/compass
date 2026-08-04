> **Note:** This file is a task-record copy of an agent-memory note about
> engineer routing conventions; it contains no infra credentials, IPs, or
> hostnames. It reproduces the memory-note structure (frontmatter + body) for
> the task record rather than any secret value — added here only for
> consistency with the redaction note in `verification-1.md` in this same
> directory.

---
name: worker-codex-review-flow
description: "Standing preference — app-code implementation goes to the backend-engineer/frontend-engineer wrappers (not sonnet-worker), and every non-trivial change gets a codex-reviewer pass before shipping; don't wait to be asked"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 6d9dcf33-bcd9-4990-be82-16edf5763aab
  modified: __MODIFIED__
---

Udai expects the delegate + Codex-review loop as the **default** for any
non-trivial change, not a per-request opt-in. Asked "Why are not using worker and
reviewer" after I built three features inline, having treated an earlier "use
worker to commit + PR + merge + release" as scoped to that one message.

## Who implements (updated 2026-08-04 — supersedes the old sonnet-worker default)

Implementation of **application code** no longer goes to `sonnet-worker`:

- Backend (`apps/api`, `apps/ingestor`, `apps/extractor`, server-side
  `packages/*`, DB schema/migrations, jobs, config) →
  `/home/udai/.claude/bin/backend-engineer` (`deepseek/deepseek-v4-flash`).
- Frontend (`apps/web`, components, client state, styling, Vite config) →
  `/home/udai/.claude/bin/frontend-engineer` (`moonshotai/kimi-k3`).

Both take **two** args, same contract as `codex-reviewer`:

```
/home/udai/.claude/bin/backend-engineer tasks/<task>/backend-1.md '<full scope brief>'
```

They are **scripts, not agents** — a `sonnet-worker` must invoke them via Bash.
They have no context beyond the prompt, so fold the entire brief (files, symbols,
required changes, must-not-change list, acceptance criteria) into the prompt text.
The report file holds only their summary; **the real deliverable is the diff they
leave in the working tree** — always inspect `git status` / `git diff` yourself.
They run with `--approve` (auto-approved tools), so a vague prompt is dangerous.

`sonnet-worker` is **not** retired. It remains the only path for: invoking these
wrappers, independent verification (never by the agent that implemented),
read-only investigation, and work in neither domain (CI, docs, repo tooling).

Both engineers are newer/less-proven than Codex or Sonnet — treat a first pass as
unverified until independent verification *and* Codex review have both run.

## Codex review

`codex-reviewer` is a **script, not an agent**, and takes **two** args (an
earlier version of this note wrongly documented one):

```
/home/udai/.claude/bin/codex-reviewer tasks/<task>/review-1.md '<complete review task>'
```

It runs Codex non-interactively read-only and writes the review **verbatim to the
path you pass**. It refuses to overwrite an existing file — reviews are
append-only, so increment the iteration number. Parallel reviewers each need
their own filename. Read that file yourself in full — never accept a worker's
summary of the findings. The worker reports only the path and the exit code
(append `; echo "EXIT:$?"` — a worker forgot this once and I had no exit code).

## Harness hazard (fixed 2026-08-04, don't reintroduce)

Each wrapper loads its system prompt from `<script_dir>/<name>-agent.md`, i.e. the
profile must live in `~/.claude/bin/`, **not** `~/.claude/agents/`. The backend
profile was misfiled into `agents/`, which both (a) made the wrapper abort with
`agent profile not found` and (b) registered it as a Task-tool subagent — so
"using backend-engineer" via the Task tool would silently run the default Claude
model and skip the report file. Never invoke these via the Task tool; only the
Bash wrappers.

**Why:** he treats worker reports and Codex findings alike as untrusted evidence
to be verified against the code — the value is in the independent second pass, and
skipping it on tax/money logic is where a real defect would slip through.

**How to apply:** run the review before offering to commit, not after he asks.
Verify each finding against the code before acting; dismissing a wrong finding is
fine, but say which ones were confirmed vs. dismissed and why. See
[[revert-drill-verification]] for the testing discipline that pairs with this.
