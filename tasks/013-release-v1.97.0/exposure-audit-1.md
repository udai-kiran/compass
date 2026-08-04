# Exposure audit — <REDACTED-CREDENTIAL-PAIR> and <REDACTED-INTERNAL-IP> (read-only) + scrub of tasks/001-engineer-routing-memory/

All git commands used below were read-only (grep, log, tag, branch, ls-remote,
show --stat). No git command staged, committed, pushed, tagged, rebased,
reset, or rewrote history.

## JOB A — Exposure audit

### A1. Current working tree (HEAD checkout + untracked)

Command:
```
grep -rn '<the redacted strings>' . --exclude-dir=.git --exclude-dir=node_modules ; echo "EXIT:$?"
```

Output (verbatim, before the Job B scrub was applied):
```
tasks/013-release-v1.97.0/TASK.md:36:`git diff --cached | grep '<REDACTED-CREDENTIAL-PAIR>\|...'` must return **no matches**. That is impossible for
tasks/013-release-v1.97.0/release-2.md:9:$ grep -rn '<the redacted strings>' tasks/013-release-v1.97.0/ ; echo "EXIT:$?"
tasks/013-release-v1.97.0/release-2.md:64:$ git diff --cached | grep -n '<the redacted strings>' ; echo "EXIT:$?"
tasks/013-release-v1.97.0/release-2.md:72:67:-`verification-1.md:84` carries the dev Postgres/Redis credential pair `<REDACTED-CREDENTIAL-PAIR>` at
tasks/013-release-v1.97.0/release-2.md:73:68:-`192.168.2.196`, plus the MinIO host `pluto` / `<REDACTED-INTERNAL-IP>` / bucket `compass-files`, the CI runner
tasks/013-release-v1.97.0/release-2.md:74:78:-the bare IP is not a new disclosure. But `<REDACTED-CREDENTIAL-PAIR>` and `<REDACTED-INTERNAL-IP>` have **zero** matches in
tasks/013-release-v1.97.0/release-2.md:75:706:-tasks/001-engineer-routing-memory/verification-1.md:92:11	- [Object storage (MinIO)](object-storage-minio.md) — uploads go to self-hosted MinIO (pluto <REDACTED-INTERNAL-IP>, bucket compass-files) via Storage abstraction; disk fallback; live since v1.36.0
tasks/013-release-v1.97.0/release-2.md:76:715:-tasks/001-engineer-routing-memory/verification-1.md:84:3	- [Compass infra](compass-infra.md) — Postgres 18.3 + Redis at 192.168.2.196 (<REDACTED-CREDENTIAL-PAIR> dev), BullMQ chosen over host's RabbitMQ
tasks/013-release-v1.97.0/release-2.md:77:716:-tasks/001-engineer-routing-memory/verification-1.md:92:11	- [Object storage (MinIO)](object-storage-minio.md) — uploads go to self-hosted MinIO (pluto <REDACTED-INTERNAL-IP>, bucket compass-files) via Storage abstraction; disk fallback; live since v1.36.0
tasks/013-release-v1.97.0/release-2.md:78:725:-Classification: every `192.168.2.196` occurrence above is **INTERNAL-BUT-SENSITIVE** — it is the real private-network IP of the shared dev Postgres/Redis host, repeated 13 times across 8 files, several times paired with the DB name `compass_dev`/`compass_ci` and, at `tasks/001-engineer-routing-memory/verification-1.md:84`, with the literal credential pair `<REDACTED-CREDENTIAL-PAIR>` (see section 4 — this one is worse than IP disclosure alone).
tasks/013-release-v1.97.0/release-2.md:79:728:-`tasks/001-engineer-routing-memory/verification-1.md:92` additionally discloses the MinIO host's private IP `<REDACTED-INTERNAL-IP>` and its hostname `pluto` and bucket name `compass-files` — **INTERNAL-BUT-SENSITIVE**. This line is part of a **verbatim paste of the user's entire `MEMORY.md` index** (lines 80–91 of that file reproduce all 14 memory-index bullet lines, including infra/db-ownership/CI-runner details) — see full quote below in section 4.
tasks/013-release-v1.97.0/release-2.md:80:737:-tasks/001-engineer-routing-memory/verification-1.md:84:3	- [Compass infra](compass-infra.md) — Postgres 18.3 + Redis at 192.168.2.196 (<REDACTED-CREDENTIAL-PAIR> dev), BullMQ chosen over host's RabbitMQ
tasks/013-release-v1.97.0/release-2.md:81:744:-- **`<REDACTED-CREDENTIAL-PAIR>` at `192.168.2.196` (`tasks/001-engineer-routing-memory/verification-1.md:84`) — REAL SECRET.** This is a literal, reachable dev-database credential pair (username `postgres`, password `postgres`) for a real, currently-online private-network host, pasted verbatim as part of a full `MEMORY.md` dump. Unlike the CI creds (ephemeral/localhost-only) or the redacted TASK.md line, this line gives both username and password with nothing redacted, for a host proven reachable elsewhere in this same file set (`002-retire-url-regex-hook/verification-1.md:221-223` independently confirms `192.168.2.196:5432` accepts TCP connections). This is the single strongest finding in this scan.
tasks/013-release-v1.97.0/release-2.md:82:751:-3	- [Compass infra](compass-infra.md) — Postgres 18.3 + Redis at 192.168.2.196 (<REDACTED-CREDENTIAL-PAIR> dev), BullMQ chosen over host's RabbitMQ
tasks/013-release-v1.97.0/release-2.md:83:760:-11	- [Object storage (MinIO)](object-storage-minio.md) — uploads go to self-hosted MinIO (pluto <REDACTED-INTERNAL-IP>, bucket compass-files) via Storage abstraction; disk fallback; live since v1.36.0
tasks/013-release-v1.97.0/release-2.md:84:766:-This entire block is **REAL SECRET** (line 3, `<REDACTED-CREDENTIAL-PAIR>`) plus **INTERNAL-BUT-SENSITIVE** (lines 3/11: IPs, hostname `pluto`, bucket name, port `3002`, self-hosted-runner count, and the fact a `gh` token lacks `write:packages`).
tasks/013-release-v1.97.0/release-2.md:85:775:-  - `tasks/001-engineer-routing-memory/verification-1.md:84` — literal dev-Postgres credential pair `<REDACTED-CREDENTIAL-PAIR>` at private IP `192.168.2.196`, inside a verbatim `MEMORY.md` paste.
tasks/013-release-v1.97.0/release-2.md:86:778:-- **INTERNAL-BUT-SENSITIVE** (private infra topology — repeated private IP `192.168.2.196` for dev Postgres/Redis, `<REDACTED-INTERNAL-IP>`/hostname `pluto`/bucket `compass-files` for MinIO, DB names `compass_dev`/`compass_ci`, redacted-but-real DB username `compass`):
tasks/013-release-v1.97.0/release-2.md:87:787:-I did not verify whether `192.168.2.196` or `<REDACTED-INTERNAL-IP>` are reachable from the public internet (only reachability from this sandboxed environment was demonstrated inside the scanned files themselves, at `002-retire-url-regex-hook/verification-1.md:221-223`) — the severity of the IP disclosure depends on that, which this read-only scan cannot determine.
tasks/013-release-v1.97.0/release-2.md:93:$ git diff --cached | grep '<the redacted strings>' | grep -c '^-'
tasks/013-release-v1.97.0/release-2.md:95:$ git diff --cached | grep '<the redacted strings>' | grep -c '^+'
tasks/013-release-v1.97.0/release-2.md:138:mis-specified: `git diff --cached | grep '<the redacted strings>'`
tasks/013-release-v1.97.0/release-2.md:175:$ git diff --cached | grep '^+' | grep '<the redacted strings>' ; echo "EXIT:$?"
tasks/001-engineer-routing-memory/verification-1.md:84:3	- [Compass infra](compass-infra.md) — Postgres 18.3 + Redis at 192.168.2.196 (<REDACTED-CREDENTIAL-PAIR> dev), BullMQ chosen over host's RabbitMQ
tasks/001-engineer-routing-memory/verification-1.md:92:11	- [Object storage (MinIO)](object-storage-minio.md) — uploads go to self-hosted MinIO (pluto <REDACTED-INTERNAL-IP>, bucket compass-files) via Storage abstraction; disk fallback; live since v1.36.0
EXIT:0
```

Notes on this output:
- Most hits are `tasks/013-release-v1.97.0/release-2.md` and `TASK.md` **quoting the search pattern itself or quoting prior findings** — these are self-referential (the pattern string, or excerpts describing an earlier finding), not fresh disclosures.
- The two hits that are an actual live disclosure at the time A1 was run: `tasks/001-engineer-routing-memory/verification-1.md:84` and `:92` — the untracked "verbatim MEMORY.md paste" this job's Job B was scoped to fix. These two lines were redacted in Job B (see below); after the scrub, A1 was re-run in the B4 step and returned no matches for this directory.
- No hits appear in `apps/`, `packages/`, `.env`, `.env.example`, `docker-compose*.yml`, or any other application/config file — every hit is confined to `tasks/` markdown records.

### A2. Current committed tree (HEAD)

Command:
```
git grep -n '<the redacted strings>' HEAD -- . ; echo "EXIT:$?"
```
Output:
```
EXIT:1
```
No matches in the current HEAD commit — the committed tree is clean.

### A3. Which commits introduced/contain the strings (all of history)

Command:
```
git log --all --oneline -S'<the redacted credential pair>' ; echo "EXIT:$?"
```
Output:
```
7ac03c1 chore(tasks): redact credentials from secret-scan report, add release records
b4cc143 docs(tasks): add phase-0/1 task records and release checkpoints
EXIT:0
```

Command:
```
git log --all --oneline -S'<the redacted internal ip>' ; echo "EXIT:$?"
```
Output:
```
7ac03c1 chore(tasks): redact credentials from secret-scan report, add release records
b4cc143 docs(tasks): add phase-0/1 task records and release checkpoints
EXIT:0
```

`git show --stat` on both:
- `b4cc143dad7803e7c08ecde5158a70d861210e47` — "docs(tasks): add phase-0/1 task records and release checkpoints" — this is the commit that **introduced** the strings (adds `tasks/000-agent-harness/...`, `tasks/001-domain-event-bus/...`, and the rest of the phase-0/1 task tree in one large commit).
- `7ac03c14c1ff6dd1a2ebff2eaf3ab17dee09b0a4` — "chore(tasks): redact credentials from secret-scan report, add release records" — its own message states plainly: *"The strings remain in history at b4cc143 and in tag v1.97.0. The repo is private and the durable mitigation is credential rotation rather than a history rewrite that would break the published tag."* This commit redacted the strings going forward in `secret-scan-1.md`/`TASK.md` but (per `-S` semantics) still shows up because it changed lines containing the string (removing it), which is exactly what `-S` picks up.

### A4. Are the strings inside the published tags?

Command:
```
git grep -n '<the redacted strings>' v1.97.0 -- . | head -20 ; echo "EXIT:$?"
```
Output — **yes, present**, 17 hits (head -20 shown in full below), all in `tasks/013-release-v1.97.0/TASK.md` and `tasks/013-release-v1.97.0/secret-scan-1.md`:
```
v1.97.0:tasks/013-release-v1.97.0/TASK.md:31:`verification-1.md:84` carries the dev Postgres/Redis credential pair `<REDACTED-CREDENTIAL-PAIR>` at
v1.97.0:tasks/013-release-v1.97.0/TASK.md:32:`192.168.2.196`, plus the MinIO host `pluto` / `<REDACTED-INTERNAL-IP>` / bucket `compass-files`, the CI runner
v1.97.0:tasks/013-release-v1.97.0/TASK.md:38:the bare IP is not a new disclosure. But `<REDACTED-CREDENTIAL-PAIR>` and `<REDACTED-INTERNAL-IP>` have **zero** matches in
v1.97.0:tasks/013-release-v1.97.0/secret-scan-1.md:69:tasks/001-engineer-routing-memory/verification-1.md:92:11	- [Object storage (MinIO)](object-storage-minio.md) — uploads go to self-hosted MinIO (pluto <REDACTED-INTERNAL-IP>, bucket compass-files) via Storage abstraction; disk fallback; live since v1.36.0
v1.97.0:tasks/013-release-v1.97.0/secret-scan-1.md:84:tasks/001-engineer-routing-memory/verification-1.md:84:3	- [Compass infra](compass-infra.md) — Postgres 18.3 + Redis at 192.168.2.196 (<REDACTED-CREDENTIAL-PAIR> dev), BullMQ chosen over host's RabbitMQ
v1.97.0:tasks/013-release-v1.97.0/secret-scan-1.md:85:tasks/001-engineer-routing-memory/verification-1.md:92:11	- [Object storage (MinIO)](object-storage-minio.md) — uploads go to self-hosted MinIO (pluto <REDACTED-INTERNAL-IP>, bucket compass-files) via Storage abstraction; disk fallback; live since v1.36.0
v1.97.0:tasks/013-release-v1.97.0/secret-scan-1.md:92:Classification: every `192.168.2.196` occurrence above is **INTERNAL-BUT-SENSITIVE** — it is the real private-network IP of the shared dev Postgres/Redis host, repeated 13 times across 8 files, several times paired with the DB name `compass_dev`/`compass_ci` and, at `tasks/001-engineer-routing-memory/verification-1.md:84`, with the literal credential pair `<REDACTED-CREDENTIAL-PAIR>` (see section 4 — this one is worse than IP disclosure alone).
v1.97.0:tasks/013-release-v1.97.0/secret-scan-1.md:94:`tasks/001-engineer-routing-memory/verification-1.md:92` additionally discloses the MinIO host's private IP `<REDACTED-INTERNAL-IP>` and its hostname `pluto` and bucket name `compass-files` — **INTERNAL-BUT-SENSITIVE**. This line is part of a **verbatim paste of the user's entire `MEMORY.md` index** (lines 80–91 of that file reproduce all 14 memory-index bullet lines, including infra/db-ownership/CI-runner details) — see full quote below in section 4.
v1.97.0:tasks/013-release-v1.97.0/secret-scan-1.md:104:tasks/001-engineer-routing-memory/verification-1.md:84:3	- [Compass infra](compass-infra.md) — Postgres 18.3 + Redis at 192.168.2.196 (<REDACTED-CREDENTIAL-PAIR> dev), BullMQ chosen over host's RabbitMQ
v1.97.0:tasks/013-release-v1.97.0/secret-scan-1.md:110:- **`<REDACTED-CREDENTIAL-PAIR>` at `192.168.2.196` (`tasks/001-engineer-routing-memory/verification-1.md:84`) — REAL SECRET.** This is a literal, reachable dev-database credential pair (username `postgres`, password `postgres`) for a real, currently-online private-network host, pasted verbatim as part of a full `MEMORY.md` dump. Unlike the CI creds (ephemeral/localhost-only) or the redacted TASK.md line, this line gives both username and password with nothing redacted, for a host proven reachable elsewhere in this same file set (`002-retire-url-regex-hook/verification-1.md:221-223` independently confirms `192.168.2.196:5432` accepts TCP connections). This is the single strongest finding in this scan.
v1.97.0:tasks/013-release-v1.97.0/secret-scan-1.md:116:3	- [Compass infra](compass-infra.md) — Postgres 18.3 + Redis at 192.168.2.196 (<REDACTED-CREDENTIAL-PAIR> dev), BullMQ chosen over host's RabbitMQ
v1.97.0:tasks/013-release-v1.97.0/secret-scan-1.md:124:11	- [Object storage (MinIO)](object-storage-minio.md) — uploads go to self-hosted MinIO (pluto <REDACTED-INTERNAL-IP>, bucket compass-files) via Storage abstraction; disk fallback; live since v1.36.0
v1.97.0:tasks/013-release-v1.97.0/secret-scan-1.md:129:This entire block is **REAL SECRET** (line 3, `<REDACTED-CREDENTIAL-PAIR>`) plus **INTERNAL-BUT-SENSITIVE** (lines 3/11: IPs, hostname `pluto`, bucket name, port `3002`, self-hosted-runner count, and the fact a `gh` token lacks `write:packages`).
v1.97.0:tasks/013-release-v1.97.0/secret-scan-1.md:164:  - `tasks/001-engineer-routing-memory/verification-1.md:84` — literal dev-Postgres credential pair `<REDACTED-CREDENTIAL-PAIR>` at private IP `192.168.2.196`, inside a verbatim `MEMORY.md` paste.
v1.97.0:tasks/013-release-v1.97.0/secret-scan-1.md:166:- **INTERNAL-BUT-SENSITIVE** (private infra topology — repeated private IP `192.168.2.196` for dev Postgres/Redis, `<REDACTED-INTERNAL-IP>`/hostname `pluto`/bucket `compass-files` for MinIO, DB names `compass_dev`/`compass_ci`, redacted-but-real DB username `compass`):
v1.97.0:tasks/013-release-v1.97.0/secret-scan-1.md:184:- I did not verify whether `192.168.2.196` or `<REDACTED-INTERNAL-IP>` are reachable from the public internet (only reachability from this sandboxed environment was demonstrated inside the scanned files themselves, at `002-retire-url-regex-hook/verification-1.md:221-223`) — the severity of the IP disclosure depends on that, which this read-only scan cannot determine.
EXIT:0
```
(Note: `head -20` truncated to fewer lines because fewer than 20 matches exist; all matches shown above are the complete set piped through `head`.)

Command:
```
git grep -n '<the redacted strings>' v1.98.0 -- . | head -20 ; echo "EXIT:$?"
```
Output (re-run without the `head` pipe to get git grep's real exit code, since piping to `head` masks it):
```
(no output)
EXIT:1
```
**v1.98.0 has zero matches** — the strings do not appear in this later tag.

### A5. Commits on main after the first offending commit (`b4cc143`)

Command:
```
git log --oneline b4cc143..HEAD | wc -l
```
Output:
```
3
```

Command:
```
git log --oneline | head -6
```
Output:
```
77fa613 Merge pull request #161 from udai-kiran/chore/release-records-v1.98.0
7ac03c1 chore(tasks): redact credentials from secret-scan report, add release records
d3155a6 Merge pull request #160 from udai-kiran/refactor/module-migration-phase1-protection
b4cc143 docs(tasks): add phase-0/1 task records and release checkpoints
02964b5 refactor(api): migrate protection module into modules/ (roadmap 1.4)
c78fdad Merge pull request #159 from udai-kiran/refactor/module-migration-phase1-ledger-credit-investments
```

Cross-check — which tags contain each commit:
```
$ git tag --contains b4cc143
v1.97.0
v1.98.0

$ git tag --contains 7ac03c1
v1.98.0
```
So `b4cc143` (introduces the strings) is an ancestor of both `v1.97.0` and `v1.98.0`; `7ac03c1` (redacts the two report files going forward) landed after `v1.97.0` was already cut and is only in `v1.98.0`. This is consistent with A4: the strings are present in `v1.97.0` and absent in `v1.98.0`.

### A6. Other branches that could also carry the strings

Command:
```
git branch -a
```
Output:
```
  chore/release-records-v1.98.0
  docs/docusaurus-site
  emi-account-link
  feat/assets-and-connections
  feat/emi-loan-destination-account
  feat/family-profile
  feat/goal-assets-grouped-by-class
  feat/goal-progress-asset-colors
  feat/goal-tooltips-and-reordering
  feat/group-insurance-payment-accounts
  feat/serve-docs-from-web-container
  feat/sip-nav-and-bulk-record
  feat/tasks-page
  feat/transaction-date-display
  feat/xirr-ui-surface
  fix/correctable-opening-balance
  fix/debt-holding-projection-rate
  fix/demo-seed-date-utc-rollover
  fix/edit-assets-and-connections
  fix/extractor-day-first-dates
  fix/insurance-premium-account-picker
  fix/job-schedules-utc-and-targeted-recompute
  fix/misc-improvements
  fix/profile-dob-not-saved
  fix/recurring-resource-update-schema-defaults
* main
  refactor/module-migration-phase1-protection
  remotes/origin/chore/hide-import-from-sidebar
  remotes/origin/chore/release-records-v1.98.0
  remotes/origin/ci/self-hosted-cache-speedup
  remotes/origin/ci/self-hosted-runner
  remotes/origin/docs/docusaurus-site
  remotes/origin/docs/roadmap-2.0-task-board
  remotes/origin/emi-account-link
  remotes/origin/feat/accounts-savings-and-loans-tiles
  remotes/origin/feat/average-monthly-balance
  remotes/origin/feat/category-necessity-flag
  remotes/origin/feat/domain-event-bus
  remotes/origin/feat/emi-loan-destination-account
  remotes/origin/feat/epf-only-recording
  remotes/origin/feat/exempt-capital-gains-class
  remotes/origin/feat/extractor-structured-output
  remotes/origin/feat/family-profile
  remotes/origin/feat/goal-assets-grouped-by-class
  remotes/origin/feat/module-scaffold-route-gate
  remotes/origin/feat/real-estate-silver-holding-units
  remotes/origin/feat/record-transfer-between-accounts
  remotes/origin/feat/reports-custom-date-range
  remotes/origin/feat/retire-url-regex-hook
  remotes/origin/feat/serve-docs-from-web-container
  remotes/origin/feat/sip-nav-and-bulk-record
  remotes/origin/feat/sip-record-installment
  remotes/origin/feat/tasks-page
  remotes/origin/feat/transaction-date-display
  remotes/origin/feat/transaction-necessity-override
  remotes/origin/feat/xirr-money-weighted-returns
  remotes/origin/feat/xirr-ui-surface
  remotes/origin/fix/card-statement-cycle-and-recheck
  remotes/origin/fix/cards-red-outline-missing-statement-password
  remotes/origin/fix/cc-statement-reconciliation
  remotes/origin/fix/correctable-opening-balance
  remotes/origin/fix/datefield-flex-overflow
  remotes/origin/fix/debt-holding-projection-rate
  remotes/origin/fix/demo-seed-date-utc-rollover
  remotes/origin/fix/edit-assets-and-connections
  remotes/origin/fix/extractor-day-first-dates
  remotes/origin/fix/job-schedules-utc-and-targeted-recompute
  remotes/origin/fix/misc-improvements
  remotes/origin/fix/networth-sawtooth-snapshot-selfheal
  remotes/origin/fix/profile-dob-not-saved
  remotes/origin/fix/recurring-resource-update-schema-defaults
  remotes/origin/main
  remotes/origin/refactor/module-migration-phase1-ledger-credit-investments
  remotes/origin/refactor/module-migration-phase1-protection
  remotes/origin/transaction-links
```

Command:
```
git ls-remote --heads origin
```
Output:
```
7ac03c14c1ff6dd1a2ebff2eaf3ab17dee09b0a4	refs/heads/chore/release-records-v1.98.0
a8166139b9915e755b753859c83850bf253d2d33	refs/heads/ci/self-hosted-runner
bbb00bd69e2ec1603e5e0e58659f633d058a99c8	refs/heads/docs/docusaurus-site
26a207f5c60528a9e391ae2ab0d9240502f9029f	refs/heads/emi-account-link
b7900686f49b4747f3d8d33195bcf1eaa218fc59	refs/heads/feat/emi-loan-destination-account
4f44b0d06c2449e310bcc81b8ded5b7d3f3a9a04	refs/heads/feat/family-profile
a918d049a793f3edbb83d06e96bf0a6062681dba	refs/heads/feat/goal-assets-grouped-by-class
37683a0ccb040846b9de8a4ba5aea28aff00d49d	refs/heads/feat/module-scaffold-route-gate
3e2f3fd0254c6d45b2917e72cb27b92f9836fca5	refs/heads/feat/serve-docs-from-web-container
8e50b361da95aab7378d38f93c86d1dbc367a7e0	refs/heads/feat/sip-nav-and-bulk-record
75d491ac33edf8180210c3f8093b6d5b7f71e18a	refs/heads/feat/tasks-page
5ffb07d4cfc03e071a11a7558b9c3b624b521c1d	refs/heads/feat/transaction-date-display
473a85fd8c38a7c8f61a88c21c1f2aa74777bd84	refs/heads/feat/xirr-ui-surface
dc4f0a59b0b47071f38bfaa58b9c1c88c678c1bf	refs/heads/fix/correctable-opening-balance
8c5f1f06d2599bcf91b84fb0f7a3e69177a00d1d	refs/heads/fix/debt-holding-projection-rate
d51d347f5b9289571c487fc4d53b3360c7ed7ea2	refs/heads/fix/edit-assets-and-connections
3ad0bc7fa98c24e4fc89027171d2f1c2d731c531	refs/heads/fix/extractor-day-first-dates
2e4c5f2f001c369ff48248475fe71caedf4d5c06	refs/heads/fix/job-schedules-utc-and-targeted-recompute
1da3b48c753bdd9034ec19b4ff0c98910c1096b6	refs/heads/fix/misc-improvements
a056a3c48ba8d9181030c24b5ec8feba59e128f9	refs/heads/fix/profile-dob-not-saved
b3760cfbf5897ef8db78e1174f42eb6eae08c2b2	refs/heads/fix/recurring-resource-update-schema-defaults
77fa6130cf22493a513f9fb736c29ccf467dc876	refs/heads/main
b4cc143dad7803e7c08ecde5158a70d861210e47	refs/heads/refactor/module-migration-phase1-protection
```
Note: `remotes/origin/chore/release-records-v1.98.0` (local branch name `chore/release-records-v1.98.0`) is at the same commit as `7ac03c1` (confirmed by matching hash `7ac03c14c1ff6dd1a2ebff2eaf3ab17dee09b0a4`), i.e. it carries the already-redacted state, not the original disclosure. `refactor/module-migration-phase1-protection` is at `b4cc143dad7803e7c08ecde5158a70d861210e47` — exactly the commit that introduced the strings — so that branch (both local and, per ls-remote, its remote counterpart) does carry the disclosure in its history, same as `main` does before `7ac03c1`. No branch was found containing the strings that main/its tags don't already cover; the exposure surface is `b4cc143` and everything built on top of it prior to `7ac03c1`, which is `v1.97.0` and the pre-redaction state of `main`/`refactor/module-migration-phase1-protection`.

---

## JOB B — Scrub of `tasks/001-engineer-routing-memory/`

### B1. What each of the 4 files contains, and where memory content is reproduced

- **`TASK.md`** (59 lines) — the task record for "Make engineer routing durable in project memory": status COMPLETE, objective, root cause (two stale facts in the user's `worker-codex-review-flow.md` memory note), scope, plan, acceptance criteria (AC1–AC4, all PASS), verification pointer, decisions, non-goals. **No memory content (index bullets or secrets) is reproduced here** — confirmed by `grep -n 'pluto\|192\.168\.2\.196\|compass-files'` on this file returning nothing.

- **`DELEGATION.md`** (70 lines) — the sonnet-worker delegation brief: task/why, approved plan, files/symbols (source = `new-memory-content.md`, targets = the real memory note file and `MEMORY.md`), required changes (verbatim substitution instructions, the exact MEMORY.md line to replace — quoting only the "Worker + Codex review flow" bullet text, not the infra bullet), must-not-change list, acceptance criteria, commands, required evidence. **No memory content with secrets is reproduced here** — confirmed the same way (no `pluto`/IP/bucket-name matches).

- **`new-memory-content.md`** (79 lines, now 85 after the added note) — the full authored content of the `worker-codex-review-flow` memory note (YAML frontmatter + body describing the engineer-routing convention, Codex-review convention, and a "harness hazard" section). This is a memory note about **routing conventions**, not infra — it contains no credentials, IPs, or hostnames anywhere in it (confirmed by the same three greps returning nothing).

- **`verification-1.md`** (154 lines, now 160 after the added note) — the worker's evidence file for the 8 required commands, including a "Full current MEMORY.md content for the record" block. **This is the one file where memory content — including the two sensitive lines — was reproduced verbatim**, at (pre-redaction line numbers):
  - **Line 84**: `3	- [Compass infra](compass-infra.md) — Postgres 18.3 + Redis at 192.168.2.196 (<REDACTED-CREDENTIAL-PAIR> dev), BullMQ chosen over host's RabbitMQ` — contained the literal credential pair `<REDACTED-CREDENTIAL-PAIR>`.
  - **Line 92**: `11	- [Object storage (MinIO)](object-storage-minio.md) — uploads go to self-hosted MinIO (pluto <REDACTED-INTERNAL-IP>, bucket compass-files) via Storage abstraction; disk fallback; live since v1.36.0` — contained the MinIO hostname `pluto` and internal IP `<REDACTED-INTERNAL-IP>`.
  These two lines sit inside the full-MEMORY.md-dump block spanning (pre-redaction) lines 80–96, which reproduces all 12 memory-index bullet lines verbatim as evidence that only one line (the Worker + Codex review flow bullet, line 13/94) changed.

### B2/B3. Changes made

- **`tasks/001-engineer-routing-memory/verification-1.md`**:
  - Line 84: the literal credential pair (see A1/A4 above) was replaced with `<REDACTED-CREDENTIAL-PAIR>` (the `192.168.2.196` IP was left untouched per the brief's explicit exception).
  - Line 92: `pluto` → `<REDACTED-HOSTNAME>`, and the literal internal IP (see A1/A4 above) → `<REDACTED-INTERNAL-IP>` (the `compass-files` bucket name was left untouched per the brief's explicit exception).
  - Added a note block immediately under the H1 title stating that sensitive values were redacted before commit and that the file reproduces the memory-index *structure* (titles, purpose, file:line citations), not the literal secrets present at the time the task ran.
  - No other line, title, citation, or acceptance-criteria text was touched — every other memory-index bullet in the reproduced block (titles/purposes for compass-infra, compass-task-board, no-auto-categorization, dev-server-workflow, cat-alias, MF-position-identity, email-ingest-pipeline, db-app-role-ownership, statement-dedup-by-period, worker-codex-review-flow, ci-runners-and-ghcr) is unchanged, so a reader can still see what each memory entry is about.

- **`tasks/001-engineer-routing-memory/new-memory-content.md`**: added a note block above the YAML frontmatter stating this file contains no infra credentials/IPs/hostnames and is included for consistency with the redaction note added to `verification-1.md` in the same directory. No other content changed (confirmed no secrets existed in this file to begin with).

- **`tasks/001-engineer-routing-memory/TASK.md`** and **`tasks/001-engineer-routing-memory/DELEGATION.md`**: **not modified** — neither file contained the sensitive strings (verified by grep before editing), so no redaction was needed in either.

### B4. Verification

Command:
```
grep -rn '<the redacted strings>' tasks/001-engineer-routing-memory/ ; echo "EXIT:$?"
```
Output:
```
EXIT:1
```
No matches — pass, as required.

---

## Files inspected (Job A + Job B, read-only unless noted in Job B)
- `.` (working tree, via grep) — Job A1
- `HEAD` (via git grep) — Job A2
- git history via `git log --all -S`, `git tag --contains`, `git show --stat` — Job A3, A5
- `v1.97.0`, `v1.98.0` tag trees via `git grep` — Job A4
- `git branch -a`, `git ls-remote --heads origin` — Job A6
- `tasks/001-engineer-routing-memory/TASK.md`
- `tasks/001-engineer-routing-memory/DELEGATION.md`
- `tasks/001-engineer-routing-memory/verification-1.md`
- `tasks/001-engineer-routing-memory/new-memory-content.md`

## Files changed
- `tasks/001-engineer-routing-memory/verification-1.md` — redacted 2 lines (84, 92) + added a top-of-file redaction note
- `tasks/001-engineer-routing-memory/new-memory-content.md` — added a top-of-file note only (no secrets were present to redact)
- No other files were changed. `tasks/001-engineer-routing-memory/TASK.md` and `DELEGATION.md` were read but not modified (they contained no sensitive strings).
- This report file itself: `tasks/013-release-v1.97.0/exposure-audit-1.md` (new file).

## Assumptions
- "Real secret value" for B2's open-ended clause was interpreted narrowly: I did not redact the `originSessionId` UUID in `new-memory-content.md` frontmatter (line 7) since it is a session identifier, not a credential/IP/hostname, and the brief's explicit examples were all infra values.
- Per the brief, `192.168.2.196` and the `compass-files` bucket name were deliberately left unredacted in `verification-1.md` even though they sit on the same lines as the redacted values.

## Unresolved risks
- **The strings remain permanently in git history** at commit `b4cc143` and inside the published, immutable tag `v1.97.0` (confirmed present by A4). Job B only scrubbed the untracked working-tree copy in `tasks/001-engineer-routing-memory/`; it does not and cannot remove the historical disclosure. This matches what commit `7ac03c1`'s own message already states: the durable mitigation for `v1.97.0`'s exposure is credential rotation, not a history rewrite (which this brief also explicitly forbade).
- The `refactor/module-migration-phase1-protection` branch (local and remote) sits at `b4cc143` itself, so it too carries the original disclosure in its history, same as `main` did before `7ac03c1` — flagged in A6 above for the coordinator's awareness; no action taken (out of scope, read-only audit).
- I did not attempt to determine whether `<REDACTED-INTERNAL-IP>` (or `192.168.2.196`) is reachable from outside the private network; that assessment was already flagged as unresolved in the prior `secret-scan-1.md` finding and this audit did not re-test it (out of scope for a read-only grep/git-log audit).
