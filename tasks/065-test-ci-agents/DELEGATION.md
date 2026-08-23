# Sonnet Worker Delegation — test/CI tooling (2 bins + 2 haiku agents)

## Task
Install two bin wrappers and two haiku sub-agents the coordinator will use to
execute the test gates and validate PR/CI runs. User created the target dirs
(`.claude/agents/`, `.claude/bin/`) and authorized these files.

## Files to create (verbatim from the fenced blocks below)
1. `/work/personal/compass/.claude/bin/run-gates`            (chmod +x)
2. `/work/personal/compass/.claude/bin/check-ci`             (chmod +x)
3. `/work/personal/compass/.claude/agents/test-runner.md`
4. `/work/personal/compass/.claude/agents/ci-validator.md`

Reproduce each block's content EXACTLY (byte-for-byte, no reflow, keep the
shebangs on line 1). After writing the two bins, run
`chmod +x .claude/bin/run-gates .claude/bin/check-ci`.

## Must not change
- Do not stage/commit anything (`.claude/` is a private artifact per CLAUDE.md).
- Do not edit any other file.

## Smoke tests (run, paste literal output + exit codes)
1. `bash -n .claude/bin/run-gates` and `bash -n .claude/bin/check-ci` (syntax check).
2. `.claude/bin/run-gates -h`  → prints usage, exit 0.
3. `.claude/bin/check-ci -h`   → prints usage, exit 0.
4. `.claude/bin/run-gates tasks/065-test-ci-agents/smoke-gates.txt -w packages/shared`
   → runs typecheck+lint+test scoped to packages/shared; report the per-gate
   exit codes, the final `gates report written to:` stderr line, the bin's exit
   code, and paste the tail of the produced report showing the test counts.
5. `ls -l .claude/bin/run-gates .claude/bin/check-ci` → confirm executable bit.

Do NOT run check-ci against live CI in the smoke test (only `-h`). Report the
literal output of every command and its exit code. Leave `smoke-gates.txt` in
place (it is our evidence); do not delete it.

---

### FILE 1 — `.claude/bin/run-gates`

````bash
#!/usr/bin/env bash
# run-gates — run the repo's typecheck/lint/test gates and capture literal output.
# Read-only w.r.t. source; writes only the named report file. Non-zero exit if any gate failed.
set -uo pipefail

usage() {
    cat >&2 <<'EOF'
Usage: run-gates <report-path> [-w <workspace>] [-t <test-target>]

  <report-path>   file the literal gate output is written to (repo-root-relative
                  unless absolute), e.g. tasks/<task>/gates-1.txt.
                  Append-only: an existing file is never overwritten.
  -w <workspace>  narrow typecheck+test to one npm workspace (e.g. apps/api).
  -t <target>     run `node --test <target>` for the test gate instead of the
                  npm script (a single file or dir). Note: bare `node --test`
                  does not pass apps/api's --experimental-test-module-mocks flag.

Runs, from the repo root, in order:
  1. typecheck   (npm run typecheck [-w WS])
  2. lint        (npm run lint)                # root eslint, always full
  3. test        (npm run test [-w WS] | node --test TARGET)

Each gate's exact command line, combined stdout+stderr, and exit code are
written verbatim to the report. Overall exit is non-zero if ANY gate failed.
EOF
}

if [[ $# -lt 1 || -z "${1:-}" ]]; then usage; exit 2; fi
case "$1" in -h|--help) usage; exit 0 ;; esac
dest="$1"; shift
ws=""; target=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        -w) ws="${2:-}"; shift 2 ;;
        -t) target="${2:-}"; shift 2 ;;
        -h|--help) usage; exit 0 ;;
        *) echo "error: unknown argument: $1" >&2; usage; exit 2 ;;
    esac
done

command -v git >/dev/null 2>&1 || { echo "error: git not found on PATH" >&2; exit 127; }
command -v npm >/dev/null 2>&1 || { echo "error: npm not found on PATH" >&2; exit 127; }
repo_root="$(git rev-parse --show-toplevel 2>/dev/null)" || { echo "error: not inside a git repository" >&2; exit 1; }

[[ "$dest" == /* ]] || dest="$repo_root/$dest"
if [[ -e "$dest" ]]; then
    echo "error: report path already exists: $dest" >&2
    echo "       gate reports are append-only; use the next iteration number" >&2
    exit 1
fi
mkdir -p "$(dirname "$dest")" || { echo "error: cannot create report directory: $(dirname "$dest")" >&2; exit 1; }

tmp="$(mktemp "${TMPDIR:-/tmp}/run-gates.XXXXXX")" || { echo "error: mktemp failed" >&2; exit 1; }
trap 'rm -f "$tmp"' EXIT

echo "gates report target: $dest" >&2

{
    echo "run-gates report"
    echo "repo:      $repo_root"
    echo "commit:    $(cd "$repo_root" && git rev-parse HEAD 2>/dev/null)"
    echo "branch:    $(cd "$repo_root" && git rev-parse --abbrev-ref HEAD 2>/dev/null)"
    echo "date:      $(date -u +%FT%TZ)"
    echo "workspace: ${ws:-<all>}"
    echo "test-tgt:  ${target:-<npm run test>}"
    echo
} >>"$tmp"

overall=0
run_gate() {
    local name="$1"; shift
    echo "running gate: $name -> $*" >&2
    {
        echo "=== gate: $name ==="
        echo "\$ $*"
        echo "--- output ---"
    } >>"$tmp"
    local status=0
    ( cd "$repo_root" && "$@" ) >>"$tmp" 2>&1 || status=$?
    {
        echo "--- exit code: $status ---"
        echo
    } >>"$tmp"
    [[ $status -ne 0 ]] && overall=1
    echo "gate $name exit: $status" >&2
    return 0
}

if [[ -n "$ws" ]]; then
    run_gate typecheck npm run typecheck -w "$ws"
else
    run_gate typecheck npm run typecheck
fi

run_gate lint npm run lint

if [[ -n "$target" ]]; then
    run_gate test node --test "$target"
elif [[ -n "$ws" ]]; then
    run_gate test npm run test -w "$ws"
else
    run_gate test npm run test
fi

if ! cp "$tmp" "$dest"; then
    echo "error: cannot write report to $dest; report kept at $tmp" >&2
    trap - EXIT
    exit 1
fi
echo "gates report written to: $dest" >&2
if [[ $overall -eq 0 ]]; then
    echo "all gates passed" >&2
else
    echo "one or more gates FAILED" >&2
fi
exit "$overall"
````

---

### FILE 2 — `.claude/bin/check-ci`

````bash
#!/usr/bin/env bash
# check-ci — resolve a GitHub Actions run for a commit, record its conclusion,
# and extract the test-job summary lines from the run log. Read-only. Non-zero
# exit if the run's conclusion is not success (or cannot be determined).
set -uo pipefail

usage() {
    cat >&2 <<'EOF'
Usage: check-ci <report-path> [-c <commit>] [-r <run-id>] [-w <workflow>]
                [-b <branch>] [-g <grep-pattern>]

  <report-path>  file the literal CI evidence is written to (repo-root-relative
                 unless absolute). Append-only: an existing file is never overwritten.
  -c <commit>    commit SHA to find the CI run for (default: HEAD).
  -r <run-id>    use this workflow run id directly (overrides -c resolution).
  -w <workflow>  workflow name to match (default: CI).
  -b <branch>    branch to list runs from (default: current branch).
  -g <pattern>   extra ERE; matching run-log lines are extracted into the report
                 (e.g. 'lists.route'). node:test summary lines are always extracted.

Records the run's conclusion and extracts the test summary (# / U+2139 tests,
pass, fail, skipped; check/cross marks; 'not ok') plus any -g matches from
`gh run view <id> --log`. Exit codes: 0 success; 3 gh unauthenticated;
4 no run found; 5 conclusion unknown/incomplete; 6 conclusion not success.
EOF
}

if [[ $# -lt 1 || -z "${1:-}" ]]; then usage; exit 2; fi
case "$1" in -h|--help) usage; exit 0 ;; esac
dest="$1"; shift
commit=""; runid=""; workflow="CI"; branch=""; pattern=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        -c) commit="${2:-}"; shift 2 ;;
        -r) runid="${2:-}"; shift 2 ;;
        -w) workflow="${2:-}"; shift 2 ;;
        -b) branch="${2:-}"; shift 2 ;;
        -g) pattern="${2:-}"; shift 2 ;;
        -h|--help) usage; exit 0 ;;
        *) echo "error: unknown argument: $1" >&2; usage; exit 2 ;;
    esac
done

command -v git >/dev/null 2>&1 || { echo "error: git not found on PATH" >&2; exit 127; }
command -v gh  >/dev/null 2>&1 || { echo "error: gh CLI not found on PATH" >&2; exit 127; }
gh auth status >/dev/null 2>&1 || { echo "error: gh is not authenticated (run: gh auth login)" >&2; exit 3; }
repo_root="$(git rev-parse --show-toplevel 2>/dev/null)" || { echo "error: not inside a git repository" >&2; exit 1; }
cd "$repo_root"

[[ "$dest" == /* ]] || dest="$repo_root/$dest"
if [[ -e "$dest" ]]; then
    echo "error: report path already exists: $dest" >&2
    echo "       CI reports are append-only; use the next iteration number" >&2
    exit 1
fi
mkdir -p "$(dirname "$dest")" || { echo "error: cannot create report directory: $(dirname "$dest")" >&2; exit 1; }

[[ -z "$branch" ]] && branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null)"
[[ -z "$commit" ]] && commit="$(git rev-parse HEAD 2>/dev/null)"

tmp="$(mktemp "${TMPDIR:-/tmp}/check-ci.XXXXXX")" || { echo "error: mktemp failed" >&2; exit 1; }
logtmp="$(mktemp "${TMPDIR:-/tmp}/check-ci-log.XXXXXX")" || { echo "error: mktemp failed" >&2; exit 1; }
trap 'rm -f "$tmp" "$logtmp"' EXIT

echo "ci report target: $dest" >&2

if [[ -z "$runid" ]]; then
    echo "resolving run: workflow=$workflow branch=$branch commit=${commit:0:12}" >&2
    runid="$(gh run list --workflow "$workflow" --branch "$branch" --limit 40 \
        --json databaseId,headSha,status,conclusion \
        --jq "map(select(.headSha==\"$commit\")) | .[0].databaseId" 2>/dev/null)"
fi
if [[ -z "$runid" || "$runid" == "null" ]]; then
    echo "error: no '$workflow' run found for commit $commit on branch $branch" >&2
    echo "       (try -r <run-id>, -b <branch>, or a different -w <workflow>)" >&2
    exit 4
fi
echo "using run id: $runid" >&2

gv() { gh run view "$runid" --json "$1" --jq ".$1" 2>/dev/null; }
conclusion="$(gv conclusion)"
status="$(gv status)"
title="$(gv displayTitle)"
headsha="$(gv headSha)"
url="$(gv url)"
event="$(gv event)"
created="$(gv createdAt)"

{
    echo "check-ci report"
    echo "repo:           $repo_root"
    echo "workflow:       $workflow"
    echo "branch:         $branch"
    echo "target commit:  $commit"
    echo "run id:         $runid"
    echo "run title:      $title"
    echo "run head sha:   $headsha"
    echo "run event:      $event"
    echo "run created:    $created"
    echo "run url:        $url"
    echo "run status:     $status"
    echo "run conclusion: $conclusion"
    echo "date checked:   $(date -u +%FT%TZ)"
    echo
} >>"$tmp"

if [[ -n "$headsha" && -n "$commit" && "$headsha" != "$commit" ]]; then
    echo "WARNING: resolved run head sha ($headsha) != target commit ($commit)" | tee -a "$tmp" >&2
fi

echo "fetching run log (this can be large)..." >&2
if gh run view "$runid" --log >"$logtmp" 2>/dev/null; then
    {
        echo "=== node:test summary lines ==="
        grep -nE '(#|'$'ℹ'')[[:space:]]+(tests|pass|fail|skipped|todo|cancelled|duration)|^(not ok|ok)[[:space:]]|'$'✔''|'$'✖''|'$'✗' "$logtmp" || echo "(no summary lines matched)"
        echo
        if [[ -n "$pattern" ]]; then
            echo "=== lines matching -g pattern: $pattern ==="
            grep -nE "$pattern" "$logtmp" || echo "(no lines matched pattern)"
            echo
        fi
        echo "=== failure markers ==="
        grep -nE 'Process completed with exit code [1-9]|##\[error\]|AssertionError|not ok [0-9]' "$logtmp" || echo "(no failure markers matched)"
    } >>"$tmp"
else
    echo "NOTE: could not fetch full run log (run may be in progress); metadata only." | tee -a "$tmp" >&2
fi

if ! cp "$tmp" "$dest"; then
    echo "error: cannot write report to $dest; report kept at $tmp" >&2
    trap - EXIT
    exit 1
fi
echo "ci report written to: $dest" >&2

case "$conclusion" in
    success)   echo "run conclusion: success" >&2; exit 0 ;;
    ""|null)   echo "run conclusion: UNKNOWN/incomplete (status=$status)" >&2; exit 5 ;;
    *)         echo "run conclusion: $conclusion (NOT success)" >&2; exit 6 ;;
esac
````

---

### FILE 3 — `.claude/agents/test-runner.md`

````markdown
---
name: test-runner
description: Runs the repo's typecheck/lint/test gates via the run-gates bin and reports literal pass/fail/skip counts and exit codes. Read-only; never edits code.
model: haiku
tools: Bash, Read, Grep, Glob
---

You are a read-only test-execution worker. You run the project's quality gates
and report their literal output. You never edit source, stage, or commit.

## Your only command
For running gates, invoke the bin wrapper and nothing else:

    /work/personal/compass/.claude/bin/run-gates <report-path> [-w <workspace>] [-t <test-target>]

- `<report-path>` is given to you by the caller (repo-root-relative, e.g.
  `tasks/<task>/gates-1.txt`). It must not already exist — if the bin says it
  exists, use the next iteration number the caller specifies; never overwrite.
- The bin runs typecheck, lint, and test from the repo root and writes every
  command line, its combined stdout+stderr, and exit code verbatim to the report.
- Progress on stderr: `gates report target: <path>`, per-gate
  `gate <name> exit: <n>`, and finally `gates report written to: <path>`. The
  bin's own exit code is non-zero if ANY gate failed.

## What to do
1. Run the bin exactly as the caller specified (full / `-w <workspace>` / `-t <target>`).
2. Read the bin's stderr and exit code. If stderr is missing
   `gates report written to:`, treat the run as having produced no report and
   say so — do NOT claim gates passed.
3. Read the report file yourself and extract literal results: for each gate its
   exact command, exit code, and (for tests) the tests/pass/fail/skipped counts.
4. Report back concisely (<= 20 lines): per-gate exit codes, test counts, the
   overall pass/fail verdict, and the report path. Quote any failure's literal
   assertion text. Never say "tests pass" without the counts and exit code.

## Rules
- Read-only. Do NOT use Edit/Write. Run no command other than the `run-gates`
  bin (you may Read/Grep the report it produced).
- Do not retry a failing gate with different flags to force green. A failure is
  a finding — report it verbatim.
- If a gate errors, a tool is missing, or the bin fails, report that literally.
  Never fabricate or predict output.
````

---

### FILE 4 — `.claude/agents/ci-validator.md`

````markdown
---
name: ci-validator
description: Validates a PR / GitHub Actions CI run via the check-ci bin — resolves the run for a commit, records its conclusion, and extracts the test-job summary lines. Read-only.
model: haiku
tools: Bash, Read, Grep, Glob
---

You are a read-only CI-validation worker. You confirm whether a GitHub Actions
run passed and whether specific tests actually executed. You never edit files,
push, merge, or tag.

## Your only command
For CI validation, invoke the bin wrapper and nothing else:

    /work/personal/compass/.claude/bin/check-ci <report-path> [-c <commit>] [-r <run-id>] [-w <workflow>] [-b <branch>] [-g <grep-pattern>]

- `<report-path>` is given by the caller (repo-root-relative, e.g.
  `tasks/<task>/ci-1.txt`); it must not already exist.
- The bin resolves the CI run for the commit (default HEAD), records its
  conclusion, and extracts the node:test summary lines plus any `-g` pattern
  matches from the run log, verbatim, into the report.
- Progress on stderr: `ci report target: <path>`, `using run id: <id>`, then
  `ci report written to: <path>`. Exit is non-zero if the conclusion is not
  `success`, no run was found, or gh is unauthenticated.

## What to do
1. Run the bin as the caller specified. To prove a particular test executed (not
   skipped), pass `-g` with that test's file/name (e.g. `-g lists.route`).
2. Read the bin's stderr and exit code. If stderr lacks `ci report written to:`,
   or the bin reported gh unauthenticated / no run found, say so plainly — do
   NOT claim CI passed.
3. Read the report file yourself. Confirm three SEPARATE claims: (a) the run
   conclusion, (b) that the run head sha matches the intended commit — the bin
   emits a WARNING line if not, (c) the test counts and, if asked, that the `-g`
   lines show the target tests RAN (not skipped, not a requireEnv skip).
4. Report back concisely (<= 20 lines): run id, conclusion, head-sha-vs-target
   match, tests/pass/fail/skip counts, whether the targeted tests executed
   (yes/no + the evidence line), and the report path.

## Rules
- Read-only. No Edit/Write, no git/gh writes. Run only the `check-ci` bin (you
  may Read/Grep the report it produced).
- A green conclusion does NOT prove a specific test was not skipped — check the
  actual log lines for that separately.
- If the run is in progress, unavailable, or gh is unauthenticated, report that
  literally. Never fabricate a conclusion or predict a pending run.
````
