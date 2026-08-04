# Secret scan — tasks/ agent-orchestration files (candidates for commit)

## Redaction note

This report was itself committed in `b4cc143` while quoting the below-redacted strings (credential pair, internal IP, hostname, bucket name) verbatim. Those quotes have since been redacted in the working copy of this file. The original values remain recoverable from git history at commit `b4cc143`, at `d3155a6`, and inside tag `v1.97.0` — redacting the working copy does not remove them from history. The repository is private. The durable mitigation is rotating the dev Postgres credential referenced below, not rewriting history to scrub these commits.

Scope scanned (all files, recursively, under):
- tasks/00.01-00.02-verification-1.md
- tasks/000-agent-harness/
- tasks/001-domain-event-bus/
- tasks/001-engineer-routing-memory/
- tasks/002-resume-refactor/
- tasks/002-retire-url-regex-hook/
- tasks/003-demo-monthday-utc-fix/
- tasks/004-fix-eslint-no-undef/
- tasks/005-fix-api-test-env-loading/
- tasks/006-module-scaffold-and-route-gate/
- tasks/011-migrate-protection/
- tasks/012-release-checkpoint/
- tasks/013-release-v1.97.0/
- tasks/01.10-storage-backend-contract-tests.md

**Total files scanned: 66**
**Total size: 800,582 bytes (~782 KB)**

(`find <paths> -type f | wc -l` → 66; `du -cb` on the same file list → `800582 total`)

Tool used: `ripgrep` (`rg -n --no-heading ...`), run from `/home/udai/PennyPilot`.

---

## 1. Connection strings (`postgres://`, `postgresql://`, `redis://`, `mysql://`, `amqp://`)

```
tasks/012-release-checkpoint/preflight-1.md:91:npm run db:migrate          (DATABASE_URL=postgres://compass:compass-ci@localhost:<pg-port>/compass_ci)
tasks/012-release-checkpoint/preflight-1.md:92:npm test                    (DATABASE_URL=..., REDIS_URL=redis://localhost:<redis-port>, SESSION_SECRET=ci-only-session-secret-not-a-real-value-0123456789)
tasks/005-fix-api-test-env-loading/review-2.md:24:  DATABASE_URL: postgres://compass:compass-ci@localhost:${{ job.services.postgres.ports['5432'] }}/compass_ci
tasks/005-fix-api-test-env-loading/review-2.md:25:  REDIS_URL: redis://localhost:${{ job.services.redis.ports['6379'] }}
tasks/013-release-v1.97.0/preflight-1.md:280:    DATABASE_URL: postgres://compass:compass-ci@localhost:${{ job.services.postgres.ports['5432'] }}/compass_ci
tasks/013-release-v1.97.0/preflight-1.md:283:    DATABASE_URL: postgres://compass:compass-ci@localhost:${{ job.services.postgres.ports['5432'] }}/compass_ci
tasks/013-release-v1.97.0/preflight-1.md:284:    REDIS_URL: redis://localhost:${{ job.services.redis.ports['6379'] }}
tasks/004-fix-eslint-no-undef/TASK.md:38:   (`postgresql://compass:...@192.168.2.196:5432/compass_dev`) to query
```

Classification:
- `postgres://compass:compass-ci@localhost:...` (preflight-1.md, review-2.md ×2 files) — **HARMLESS**. `compass-ci` is the GitHub-Actions-ephemeral-service password (literally `.github/workflows/ci.yml`'s CI-only service credential, `localhost`+dynamic port inside a throwaway Actions container), not a reachable/reusable secret outside that job's lifetime.
- `SESSION_SECRET=ci-only-session-secret-not-a-real-value-0123456789` — **HARMLESS**, self-documented as fake.
- `tasks/004-fix-eslint-no-undef/TASK.md:38` — `postgresql://compass:...@192.168.2.196:5432/compass_dev` — password itself is redacted (`...`) in this report, but it **does** disclose the real dev-DB username (`compass`), the real private dev-server IP (`192.168.2.196`), port, and DB name (`compass_dev`). **INTERNAL-BUT-SENSITIVE** (infrastructure topology + username; no live password value).

## 2. Env assignments (`DATABASE_URL=`, `REDIS_URL=`, `SESSION_SECRET=`, `AWS_`, `S3_`, `MINIO_`, `SMTP_`, `API_KEY`, `SECRET`, `TOKEN`, `PASSWORD`, `PASSWD`, `CLIENT_SECRET`, `REFRESH_TOKEN`)

Direct `NAME=value` assignment hits (superset of section 1's connection-string lines already shown above): only the `preflight-1.md:91-92` / `review-2.md:24-25` / `013.../preflight-1.md:280-284` lines above match `KEY=value`. No `AWS_`, `S3_`, `MINIO_`, `SMTP_`, `API_KEY`, `CLIENT_SECRET`, or `REFRESH_TOKEN` assignment (with `=`) exists anywhere in scope.

Broader (non-`=`-anchored) mentions of `SESSION_SECRET`/`DATABASE_URL`/`REDIS_URL` are all **bare variable names** in prose/instructions (e.g. "export `DATABASE_URL`/`REDIS_URL`/`SESSION_SECRET` from the repo root `.env` first") — no values attached. Representative lines:
```
tasks/005-fix-api-test-env-loading/DELEGATION.md:11,38,46
tasks/005-fix-api-test-env-loading/TASK.md:44,48,72,92,98
tasks/003-demo-monthday-utc-fix/DELEGATION.md:61
tasks/002-retire-url-regex-hook/DELEGATION.md:34,88
tasks/002-retire-url-regex-hook/implementation-1.md:20,118,549,565,688,703
tasks/006-module-scaffold-and-route-gate/implementation-1.md:1149,1164
tasks/006-module-scaffold-and-route-gate/review-1.md:388
tasks/006-module-scaffold-and-route-gate/verification-1.md:220
tasks/002-retire-url-regex-hook/review-3.md:38
tasks/002-retire-url-regex-hook/verification-1.md:296
```
Classification: **HARMLESS** — variable names only, no values, and (per `tasks/005-fix-api-test-env-loading/TASK.md:48`, `tasks/003-demo-monthday-utc-fix/DELEGATION.md:61`, `tasks/002-retire-url-regex-hook/implementation-1.md:118`, `tasks/002-retire-url-regex-hook/DELEGATION.md:34`, `tasks/006-module-scaffold-and-route-gate/verification-1.md:220`) they co-occur with the private IP `192.168.2.196` — that IP is separately flagged in section 3.

No `AWS_`, `S3_`, `MINIO_`, `SMTP_`, `API_KEY`, `CLIENT_SECRET`, `REFRESH_TOKEN` matches at all (checked separately, zero hits): `tasks/012-release-checkpoint`, `tasks/011-migrate-protection`, etc. contain "MinIO" only in prose (see section 6 below), never as an env-var name/value.

`<REDACTED-BUCKET>` bucket name mention (not an env assignment, but S3/MinIO-adjacent):
```
tasks/001-engineer-routing-memory/verification-1.md:92:11	- [Object storage (MinIO)](object-storage-minio.md) — uploads go to self-hosted MinIO (<REDACTED-HOSTNAME> <REDACTED-INTERNAL-IP>, bucket <REDACTED-BUCKET>) via Storage abstraction; disk fallback; live since v1.36.0
```
Classification: **INTERNAL-BUT-SENSITIVE** (see section 3/6 — this is the whole `MEMORY.md` pasted verbatim into a task report).

## 3. Private IP addresses / internal hostnames (`192.168.`, `10.`, `172.16.`–`172.31.`, `.local`, `pluto`)

```
tasks/005-fix-api-test-env-loading/TASK.md:48:  `SESSION_SECRET` for the shared dev Postgres/Redis at 192.168.2.196.
tasks/003-demo-monthday-utc-fix/DELEGATION.md:61:3. `npm run test -w apps/api` — export ... Postgres/Redis at `192.168.2.196` are reachable. ...
tasks/004-fix-eslint-no-undef/TASK.md:38:   (`postgresql://compass:...@192.168.2.196:5432/compass_dev`) to query
tasks/002-retire-url-regex-hook/implementation-1.md:118:Ran with `DATABASE_URL`/`REDIS_URL`/`SESSION_SECRET` exported from the repo's own `.env` (both Postgres and Redis at `192.168.2.196` were reachable — verified with a raw TCP check before running: `postgres reachable`, `redis reachable`).
tasks/002-retire-url-regex-hook/implementation-1.md:851:- Both the repo's dev Postgres (`192.168.2.196:5432`) and Redis (`192.168.2.196:6379/1`) were reachable in this environment (verified with a raw `/dev/tcp` check), so both new colocated test files' env-gated live-service requirements were satisfiable and actually executed (not skipped).
tasks/006-module-scaffold-and-route-gate/verification-1.md:135:**Leftover-test-user check (independent DB query, not trusting the `t.after()` claim):** connected directly to the dev Postgres (`compass_dev` at 192.168.2.196, via `pg` in a one-off Node script, credentials from repo-root `.env`) and ran:
tasks/006-module-scaffold-and-route-gate/verification-1.md:220:- Used the repo-root `.env`'s `DATABASE_URL`/`REDIS_URL`/`SESSION_SECRET` for all DB/Redis-backed commands, per the project's documented dev-server convention (192.168.2.196, `compass_dev`).
tasks/002-retire-url-regex-hook/DELEGATION.md:34:- `npm run test -w apps/api` passes in full (793+ tests, 0 failures) — export ... both Postgres and Redis at `192.168.2.196` are reachable (confirmed independently twice already in this task). ...
tasks/001-engineer-routing-memory/verification-1.md:84:3	- [Compass infra](compass-infra.md) — Postgres 18.3 + Redis at 192.168.2.196 (<REDACTED-CREDENTIAL-PAIR> dev), BullMQ chosen over host's RabbitMQ
tasks/001-engineer-routing-memory/verification-1.md:92:11	- [Object storage (MinIO)](object-storage-minio.md) — uploads go to self-hosted MinIO (<REDACTED-HOSTNAME> <REDACTED-INTERNAL-IP>, bucket <REDACTED-BUCKET>) via Storage abstraction; disk fallback; live since v1.36.0
tasks/002-retire-url-regex-hook/verification-1.md:221:$ timeout 3 bash -c 'cat < /dev/null > /dev/tcp/192.168.2.196/5432' && echo "postgres reachable" || echo "postgres NOT reachable"
tasks/002-retire-url-regex-hook/verification-1.md:223:$ timeout 3 bash -c 'cat < /dev/null > /dev/tcp/192.168.2.196/6379' && echo "redis reachable" || echo "redis NOT reachable"
tasks/002-retire-url-regex-hook/verification-1.md:296:- Ran `npm run test -w apps/api` with `DATABASE_URL`/`REDIS_URL`/`SESSION_SECRET` sourced from the repo root `.env` (per DELEGATION.md's instruction); both Postgres and Redis at `192.168.2.196` were independently confirmed reachable via raw `/dev/tcp` checks before running, so this was a live run, not a skip.
```
Also matched (but not infra-sensitive): `.env.local` filename references in `tasks/013-release-v1.97.0/preflight-1.md:152`, `tasks/012-release-checkpoint/preflight-1.md:438`, `tasks/012-release-checkpoint/staging-1.md:41` — these are the literal string `.env.local` (a filename in `.gitignore` output), not a `*.local` hostname. **HARMLESS**.

Classification: every `192.168.2.196` occurrence above is **INTERNAL-BUT-SENSITIVE** — it is the real private-network IP of the shared dev Postgres/Redis host, repeated 13 times across 8 files, several times paired with the DB name `compass_dev`/`compass_ci` and, at `tasks/001-engineer-routing-memory/verification-1.md:84`, with the literal credential pair `<REDACTED-CREDENTIAL-PAIR>` (see section 4 — this one is worse than IP disclosure alone).

`tasks/001-engineer-routing-memory/verification-1.md:92` additionally discloses the MinIO host's private IP `<REDACTED-INTERNAL-IP>` and its hostname `pluto` and bucket name `<REDACTED-BUCKET>` — **INTERNAL-BUT-SENSITIVE**. This line is part of a **verbatim paste of the user's entire `MEMORY.md` index** (lines 80–91 of that file reproduce all 14 memory-index bullet lines, including infra/db-ownership/CI-runner details) — see full quote below in section 4.

## 4. Credential pairs (`postgres:postgres`, `user:password@host`, etc.)

```
tasks/005-fix-api-test-env-loading/review-2.md:24:  DATABASE_URL: postgres://compass:compass-ci@localhost:${{ job.services.postgres.ports['5432'] }}/compass_ci
tasks/013-release-v1.97.0/preflight-1.md:280:    DATABASE_URL: postgres://compass:compass-ci@localhost:${{ job.services.postgres.ports['5432'] }}/compass_ci
tasks/013-release-v1.97.0/preflight-1.md:283:    DATABASE_URL: postgres://compass:compass-ci@localhost:${{ job.services.postgres.ports['5432'] }}/compass_ci
tasks/004-fix-eslint-no-undef/TASK.md:38:   (`postgresql://compass:...@192.168.2.196:5432/compass_dev`) to query
tasks/012-release-checkpoint/preflight-1.md:91:npm run db:migrate          (DATABASE_URL=postgres://compass:compass-ci@localhost:<pg-port>/compass_ci)
tasks/001-engineer-routing-memory/verification-1.md:84:3	- [Compass infra](compass-infra.md) — Postgres 18.3 + Redis at 192.168.2.196 (<REDACTED-CREDENTIAL-PAIR> dev), BullMQ chosen over host's RabbitMQ
```

Classification:
- `compass:compass-ci` (CI service creds, `localhost`, ephemeral Actions container) — **HARMLESS**, per section 1.
- `compass:...@192.168.2.196` — password redacted, but real username+host — **INTERNAL-BUT-SENSITIVE**.
- **`<REDACTED-CREDENTIAL-PAIR>` at `192.168.2.196` (`tasks/001-engineer-routing-memory/verification-1.md:84`) — REAL SECRET.** This is a literal, reachable dev-database credential pair (username `postgres`, password `postgres`) for a real, currently-online private-network host, pasted verbatim as part of a full `MEMORY.md` dump. Unlike the CI creds (ephemeral/localhost-only) or the redacted TASK.md line, this line gives both username and password with nothing redacted, for a host proven reachable elsewhere in this same file set (`002-retire-url-regex-hook/verification-1.md:221-223` independently confirms `192.168.2.196:5432` accepts TCP connections). This is the single strongest finding in this scan.

Full context of that line (verbatim `MEMORY.md` paste inside the report — `tasks/001-engineer-routing-memory/verification-1.md:80-91`):
```
1	# Memory index
2	
3	- [Compass infra](compass-infra.md) — Postgres 18.3 + Redis at 192.168.2.196 (<REDACTED-CREDENTIAL-PAIR> dev), BullMQ chosen over host's RabbitMQ
4	- [Compass task board](compass-task-board.md) — one file per task in tasks/, status frontmatter is source of truth, update README index too
5	- [No auto-categorization](no-auto-categorization.md) — never auto-classify transactions; manual category now, AI-assisted in Phase 7; rules engine removed
6	- [Dev server workflow](dev-server-workflow.md) — run API on 3002 (not 3001), Vite 5173, demo creds, restart/port hazards, CSRF+rate-limit curl notes
7	- [cat alias](cat-alias.md) — cat is batcat in the user's shell; use \cat, Read/Write, printf, or pipe heredocs straight to the consumer
8	- [MF position identity](mf-position-identity.md) — a mutual-fund position is keyed by scheme + folio, not scheme alone; units are per house+folio
9	- [Email ingest pipeline](email-ingest-pipeline.md) — ingestor+extractor containers, OAuth2 IMAP → DeepSeek → review inbox; Phases A/B/C done, D+E left
10	- [DB app-role ownership](db-app-role-ownership.md) — app connects as `compass` role; migrate as compass not postgres or tables get "permission denied"; repair script + fix branch
11	- [Object storage (MinIO)](object-storage-minio.md) — uploads go to self-hosted MinIO (<REDACTED-HOSTNAME> <REDACTED-INTERNAL-IP>, bucket <REDACTED-BUCKET>) via Storage abstraction; disk fallback; live since v1.36.0
12	- [Statement dedup by period](statement-dedup-by-period.md) — mailbox holds duplicate statement emails; reward capture / Phase-2 reconcile must key on (card, period), not ingestion_id
13	- [Worker + Codex review flow](worker-codex-review-flow.md) — app code goes to the backend-engineer/frontend-engineer scripts (2 args, not agents), sonnet-worker keeps verification; codex-reviewer before shipping
14	- [CI runners & GHCR](ci-runners-and-ghcr.md) — CI on 4 self-hosted runners; a tag cut before the runner switch can't build; `gh` token lacks write:packages so manual image pushes are denied
```
This entire block is **REAL SECRET** (line 3, `<REDACTED-CREDENTIAL-PAIR>`) plus **INTERNAL-BUT-SENSITIVE** (lines 3/11: IPs, hostname `pluto`, bucket name, port `3002`, self-hosted-runner count, and the fact a `gh` token lacks `write:packages`).

## 5. Bearer tokens, `ghp_`, `gho_`, `sk-`, `Bearer `, long base64/hex blobs (32+ chars)

- `ghp_`, `gho_`, `ghs_`, `sk-`, `Bearer <token>` patterns: **zero genuine matches**. The only `sk-`-adjacent hit was a false positive inside the English word "queueMicrotask-dispatched" (`tasks/002-retire-url-regex-hook/implementation-1.md:546,683`) — **HARMLESS** (not a token).
- 32+ char hex strings: all 28 occurrences (deduplicated to distinct values) are either **git commit SHAs** (`5b3f4990d92ff6852b7c5adc9e05694dee5f58a6`, `c78fdadb6ff0b0243461b81359831fac61d90baa`) or **sha256 checksums of committed test-fixture snapshot files** (`route-surface.snapshot.txt`, `route-table.snapshot.txt`, `/tmp/route-baseline.txt`, `drizzle-manifest-before.txt`), e.g.:
```
tasks/000-agent-harness/verification-1.md:24:cb4a6814a6ba576c81dcc661c8496f269c7fdcb913f9af2b9a141b49f3bc192f  /home/udai/.claude/agents/backend-engineer-agent.md
tasks/012-release-checkpoint/preflight-1.md:3:Run at: 2026-08-04, HEAD = 5b3f4990d92ff6852b7c5adc9e05694dee5f58a6 (5b3f499), branch `main`.
tasks/011-migrate-protection/review-4.md:148:- `route-surface.snapshot.txt`: `a368d4ebfcb6bd9638ae24a3334e5b7fe61798e3cb82bdec12a06e93becc4122`
tasks/006-module-scaffold-and-route-gate/implementation-1.md:304:3af08d40249d049b3a410844910c082d6615c791e376eae719c8ac1b4a4dd6eb  drizzle-manifest-before.txt
```
Classification: all **HARMLESS** — content-integrity hashes / public git object IDs, not secrets.
- Broader 40+ char base64-alphabet scan (350 raw hits): every hit, on manual filtering, is a source file path, `apps/.../*.ts` reference, task-file name, or GitHub Actions URL — no isolated credential-shaped blob found. **HARMLESS**.

## 6. Email addresses (other than obvious test/example ones)

```
tasks/006-module-scaffold-and-route-gate/DELEGATION.md:107:%projection-settings%test%@example.invalid
tasks/006-module-scaffold-and-route-gate/verification-1.md:137:%projection-settings%test%@example.invalid
tasks/006-module-scaffold-and-route-gate/verification-1.md:217:%projection-settings%test%@example.invalid
```
Classification: **HARMLESS** — `example.invalid` is the reserved-for-documentation TLD, used as a SQL `ILIKE` pattern for a test-user email prefix, not a real address. No other email addresses (including no `demo@compass.local` or `udai.kiran@...`) appear anywhere in scope.

## 7. Absolute paths containing a home directory that might leak usernames beyond `udai`

Checked every `/home/<user>` occurrence in scope (274 matches across the file set): **100% are `/home/udai`**. Zero occurrences of any other username. **HARMLESS** (already-public per the task brief).

---

## Summary — direct answer

**Yes — this scan found hits classified REAL SECRET and INTERNAL-BUT-SENSITIVE. They must not be committed as-is.**

- **REAL SECRET:**
  - `tasks/001-engineer-routing-memory/verification-1.md:84` — literal dev-Postgres credential pair `<REDACTED-CREDENTIAL-PAIR>` at private IP `192.168.2.196`, inside a verbatim `MEMORY.md` paste.

- **INTERNAL-BUT-SENSITIVE** (private infra topology — repeated private IP `192.168.2.196` for dev Postgres/Redis, `<REDACTED-INTERNAL-IP>`/hostname `pluto`/bucket `<REDACTED-BUCKET>` for MinIO, DB names `compass_dev`/`compass_ci`, redacted-but-real DB username `compass`):
  - `tasks/001-engineer-routing-memory/verification-1.md:84,92` (full `MEMORY.md` dump, lines 80–91)
  - `tasks/004-fix-eslint-no-undef/TASK.md:38`
  - `tasks/005-fix-api-test-env-loading/TASK.md:48`
  - `tasks/003-demo-monthday-utc-fix/DELEGATION.md:61`
  - `tasks/002-retire-url-regex-hook/implementation-1.md:118,851`
  - `tasks/002-retire-url-regex-hook/DELEGATION.md:34`
  - `tasks/002-retire-url-regex-hook/verification-1.md:221,223,296`
  - `tasks/006-module-scaffold-and-route-gate/verification-1.md:135,220`

Everything else found (CI-ephemeral `compass:compass-ci@localhost` creds, git/sha256 hashes, `example.invalid` test emails, `/home/udai` paths, bare env-var names with no value) is **HARMLESS**.

## Assumptions
- "Real-looking values" for category 2 was interpreted as an actual `NAME=value` assignment; bare mentions of the variable name (the overwhelming majority of hits) were treated as non-hits for that category and instead evaluated under whatever other category their attached content (an IP, a credential) falls into.
- The CI-only `compass-ci` service password and the `ci-only-session-secret-not-a-real-value-...` string were treated as harmless because they are explicitly scoped to ephemeral GitHub-Actions service containers on `localhost`, per the surrounding text in each file, not the persistent shared dev host.

## Unresolved risks
- I did not check file contents outside the 14 listed paths (e.g., `tasks/README.md`, other numbered task dirs not listed in the brief) — if those are also being committed, they were out of scope for this scan and should be scanned separately before publishing.
- I did not verify whether `192.168.2.196` or `<REDACTED-INTERNAL-IP>` are reachable from the public internet (only reachability from this sandboxed environment was demonstrated inside the scanned files themselves, at `002-retire-url-regex-hook/verification-1.md:221-223`) — the severity of the IP disclosure depends on that, which this read-only scan cannot determine.
