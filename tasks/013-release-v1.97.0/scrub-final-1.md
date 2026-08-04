# Scrub final evidence — credential-quote cleanup + engineer-routing-memory landing

THE STRINGS = the dev credential pair and the internal MinIO IP; the literal regexes for
both now live only in the gitignored `.secret-patterns` (one per line), used below via
`grep -f .secret-patterns` so this record never quotes them.

## STEP 1 — scrub `tasks/013-release-v1.97.0/release-2.md`

Before scrub, `grep -n -f .secret-patterns tasks/013-release-v1.97.0/release-2.md`
showed 20 matching lines (line numbers 9, 64, 72–87, 93, 95, 138, 175):
- Lines 9, 64, 93, 95, 138, 175 were literal `grep '...'` / `git log -S'...'`-style quoted
  patterns reproducing THE STRINGS — each rewritten to the `grep -f .secret-patterns` form,
  which contains no secret literal.
- Lines 72–87 were quoted diff/prose content reproducing the strings inline — each literal
  occurrence of the credential pair replaced with `<REDACTED-CREDENTIAL-PAIR>` and each
  literal occurrence of the internal IP replaced with `<REDACTED-INTERNAL-IP>`, leaving all
  surrounding text (including the already-permitted `192.168.2.196`, `pluto`,
  `compass-files`) untouched.

After scrub:
```
$ grep -n -f .secret-patterns tasks/013-release-v1.97.0/release-2.md; echo "EXIT:$?"
EXIT:1
```

## STEP 2 — repo-wide sweep

Initial sweep (before any STEP-2-specific fixes, after STEP 1's release-2.md scrub):
```
$ grep -rn -f .secret-patterns . --exclude-dir=.git --exclude-dir=node_modules ; echo "EXIT:$?"
```
Found one additional file with matches: `tasks/013-release-v1.97.0/exposure-audit-1.md` (the
read-only audit report, itself an untracked new file, quoting release-2.md/TASK.md's prior
content and running its own `grep`/`git log -S`/`git grep` commands against THE STRINGS).
`tasks/001-engineer-routing-memory/` had zero matches at this point (already scrubbed in an
earlier session, per that file's B4 verification, independently re-confirmed here).

Fixed `tasks/013-release-v1.97.0/exposure-audit-1.md`:
- All quoted `grep '...'`/`git grep -n '...'` occurrences of the OR-pattern reproducing
  THE STRINGS → rewritten to the `grep -f .secret-patterns` form.
- Quoted `git log --all --oneline -S'...'` pinpoint-searches for each of THE STRINGS →
  rewritten to describe the search target by placeholder instead of the literal `-S` pattern.
- All remaining literal prose/quoted-diff occurrences → `<REDACTED-CREDENTIAL-PAIR>` /
  `<REDACTED-INTERNAL-IP>` inline (title line, A1 output block, A3/A4 command+output blocks,
  B1/B2/B3 narrative).
- Manually re-fixed two "before → after" mapping lines (B2/B3, originally describing the
  literal-string substitution) that the blanket string replace had degenerated into
  `X → X` (both sides became the same placeholder, losing meaning): rewrote to describe the
  transformation without reproducing either the original or a duplicated placeholder
  (`"the literal credential pair (see A1/A4 above) was replaced with `<REDACTED-CREDENTIAL-PAIR>`"`,
  similarly for the internal-IP line).

Repeated sweep after fixing `exposure-audit-1.md`:
```
$ grep -rn -f .secret-patterns . --exclude-dir=.git --exclude-dir=node_modules ; echo "EXIT:$?"
EXIT:1
```
Clean — no matches anywhere in the working tree (excluding `.git`). Only one sweep-fix
iteration was needed (`exposure-audit-1.md`); the sweep returned exit 1 on the second run.

## STEP 3 — verify `tasks/001-engineer-routing-memory/` is safe

```
$ grep -rn -f .secret-patterns tasks/001-engineer-routing-memory/ ; echo "EXIT:$?"
EXIT:1
```

```
$ ls -la tasks/001-engineer-routing-memory/
drwxrwxr-x udai udai 4.0 KB Tue Aug  4 15:07:56 2026 .
drwxrwxr-x udai udai  12 KB Tue Aug  4 11:35:38 2026 ..
.rw-rw-r-- udai udai 3.8 KB Tue Aug  4 07:48:30 2026 DELEGATION.md
.rw-rw-r-- udai udai 4.4 KB Tue Aug  4 15:07:56 2026 new-memory-content.md
.rw-rw-r-- udai udai 2.6 KB Tue Aug  4 07:50:19 2026 TASK.md
.rw-rw-r-- udai udai 8.5 KB Tue Aug  4 15:07:47 2026 verification-1.md
```

## STEP 4 — stage explicitly

Wrote `tasks/013-release-v1.97.0/commit4-filelist.txt`:
```
tasks/001-engineer-routing-memory/TASK.md
tasks/001-engineer-routing-memory/DELEGATION.md
tasks/001-engineer-routing-memory/verification-1.md
tasks/001-engineer-routing-memory/new-memory-content.md
tasks/013-release-v1.97.0/TASK.md
tasks/013-release-v1.97.0/release-2.md
tasks/013-release-v1.97.0/exposure-audit-1.md
tasks/013-release-v1.97.0/commit4-filelist.txt
```
No additional files needed scrubbing beyond `release-2.md` and `exposure-audit-1.md`, both
already in the brief's required list — so the filelist above matches the brief exactly, with
no extras appended.

```
$ git add --pathspec-from-file=tasks/013-release-v1.97.0/commit4-filelist.txt
$ git add tasks/013-release-v1.97.0/commit4-filelist.txt
```
(both ran with no output/errors)

## STEP 5 — gates

```
$ git diff --cached --name-only | grep -Ei '\.pdf|data/|\.env|Pasted image' ; echo "EXIT:$?"
EXIT:1
```
PASSED — no forbidden paths staged.

```
$ git diff --cached | grep '^+' | grep -f .secret-patterns ; echo "EXIT:$?"
EXIT:1
```
PASSED — no ADDED line contains THE STRINGS.

Staged file list confirmed before commit:
```
$ git diff --cached --name-status
A	tasks/001-engineer-routing-memory/DELEGATION.md
A	tasks/001-engineer-routing-memory/TASK.md
A	tasks/001-engineer-routing-memory/new-memory-content.md
A	tasks/001-engineer-routing-memory/verification-1.md
M	tasks/013-release-v1.97.0/TASK.md
A	tasks/013-release-v1.97.0/commit4-filelist.txt
A	tasks/013-release-v1.97.0/exposure-audit-1.md
A	tasks/013-release-v1.97.0/release-2.md
```
Exactly the 8 files from `commit4-filelist.txt` (`TASK.md` under `tasks/013-release-v1.97.0/`
was already modified from a prior session — that modification is exactly the earlier-round
redaction of that file, unrelated to this commit's edits).

## STEP 6 — commit

```
$ git commit -F -
[main 6fa2e2f] chore(tasks): scrub remaining credential quotes, land routing-memory record
 8 files changed, 1100 insertions(+)
 create mode 100644 tasks/001-engineer-routing-memory/DELEGATION.md
 create mode 100644 tasks/001-engineer-routing-memory/TASK.md
 create mode 100644 tasks/001-engineer-routing-memory/new-memory-content.md
 create mode 100644 tasks/001-engineer-routing-memory/verification-1.md
 create mode 100644 tasks/013-release-v1.97.0/commit4-filelist.txt
 create mode 100644 tasks/013-release-v1.97.0/exposure-audit-1.md
 create mode 100644 tasks/013-release-v1.97.0/release-2.md
```
Commit message used exactly as specified in the brief, with the `Co-Authored-By: Claude`
trailer.

## STEP 7 — verify HEAD clean

```
$ git status --porcelain
(no output)
```

```
$ git grep -n -f .secret-patterns HEAD -- . ; echo "EXIT:$?"
EXIT:1
```
HEAD is clean.

## STEP 8 — prune stale merged branches

```
$ git branch --merged main | grep refactor/module-migration-phase1-protection
  refactor/module-migration-phase1-protection
EXIT:0

$ git branch --merged main | grep chore/release-records-v1.98.0
  chore/release-records-v1.98.0
EXIT:0
```
Both confirmed fully merged into `main` before deletion.

```
$ git branch -d refactor/module-migration-phase1-protection
Deleted branch refactor/module-migration-phase1-protection (was b4cc143).

$ git push origin --delete refactor/module-migration-phase1-protection
To https://github.com/udai-kiran/PennyPilot.git
 - [deleted]         refactor/module-migration-phase1-protection

$ git branch -d chore/release-records-v1.98.0
Deleted branch chore/release-records-v1.98.0 (was 7ac03c1).

$ git push origin --delete chore/release-records-v1.98.0
To https://github.com/udai-kiran/PennyPilot.git
 - [deleted]         chore/release-records-v1.98.0
```

**Note:** this removes one reachability path only — it does NOT remove `b4cc143` or `7ac03c1`
from git history. Both commits remain reachable via `main` itself and via the tags `v1.97.0`
(contains `b4cc143`) and `v1.98.0` (contains both `b4cc143` and `7ac03c1`).

## STEP 9 — push main

```
$ git push origin main
   77fa613..6fa2e2f  main -> main
```

```
$ git log --oneline -3
6fa2e2f chore(tasks): scrub remaining credential quotes, land routing-memory record
77fa613 Merge pull request #161 from udai-kiran/chore/release-records-v1.98.0
7ac03c1 chore(tasks): redact credentials from secret-scan report, add release records
```

## Files changed (this session)
- `tasks/013-release-v1.97.0/release-2.md` — scrubbed THE STRINGS (grep-pattern rewrites +
  inline placeholders), then committed (new file at commit time).
- `tasks/013-release-v1.97.0/exposure-audit-1.md` — scrubbed THE STRINGS (grep/git-log-S
  pattern rewrites + inline placeholders + two manually-repaired before/after mapping lines),
  then committed (new file at commit time).
- `tasks/013-release-v1.97.0/commit4-filelist.txt` — new file, written per STEP 4.
- Staged and committed without further edits: `tasks/001-engineer-routing-memory/TASK.md`,
  `DELEGATION.md`, `verification-1.md`, `new-memory-content.md` (already clean from a prior
  session), and `tasks/013-release-v1.97.0/TASK.md` (already redacted from a prior session).

## No tag, no PR
Per the brief: no tag was created, no PR was opened — commits went straight to `main`.

## Assumptions
- Treated `192.168.2.196`, `pluto`, and `compass-files` as explicitly out of scope for this
  brief (THE STRINGS is only the dev credential pair and the internal MinIO IP — see
  `.secret-patterns`); left them untouched everywhere, consistent with the prior session's
  exposure-audit decision.
- The two "before → after" mapping lines in `exposure-audit-1.md` (B2/B3) needed a manual
  fix beyond the mechanical string-substitution script, since a naive find/replace turned a
  meaningful `old → new` description into a degenerate `X → X`. Fixed by hand to preserve the
  original meaning without reproducing THE STRINGS.

## Unresolved risks
- THE STRINGS remain permanently in git history at commit `b4cc143` and inside the published,
  immutable tags `v1.97.0` and `v1.98.0` — this scrub only cleans the current working tree and
  `HEAD`; it cannot and does not rewrite history (explicitly out of scope per the brief and
  per commit `7ac03c1`'s own message). Credential rotation remains the intended mitigation
  (operator action, outside this repo).
- Branch deletion in STEP 8 removed a redundant reachability path only; it has no effect on
  the exposure already documented above.
