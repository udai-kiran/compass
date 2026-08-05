# Task: 1.10 Storage backend contract tests

## Status
COMPLETE (not committed). Final combined independent verification (uninvolved worker, coherent tree) passed
every item: `npm run lint` exit 0 (whole tree), typecheck 0, storage.test.ts flag-unset → 1 skip exit 0,
`RUN_STORAGE_CONTRACT_TEST=1` self-provision → PASS exit 0 (container b7af4acc… port 32822), dead-endpoint →
FAIL exit 1 with the primary ECONNREFUSED un-masked, no leftover container. All AC1-AC5 proven; plan-reviewed
(review-1), implemented, independently verified (iter 1), Codex-reviewed twice (review-2 8 findings all fixed,
review-3 confirmed closure), lint regression fixed (iter 3) and independently re-verified. No unapproved
changes; storage.test.ts is the sole file. Commit awaits an explicit user request + a coordinator-chosen
file list.
History — CODE-COMPLETE: Iteration 3 lint fix applied and coordinator-confirmed
by direct read: `contractSucceeded` removed; `catch(err){ primaryError = err }` + post-`finally`
`if (primaryError) throw; if (teardownError) throw` — exact F3 semantics preserved, lint-clean. Fix worker's
runs: `npm run lint` (whole tree) exit 0; flag-unset skip exit 0; self-provision PASS exit 0; dead-endpoint
FAIL exit 1 with the primary ECONNREFUSED un-masked; typecheck exit 0. All F1-F8 assertions untouched.
History: iteration 3 fixed a `no-useless-assignment` ESLint error the iteration-2 F3 flag introduced at
`storage.test.ts:157` —
`storage.test.ts:157` — the `let contractSucceeded = false;` flag's `false` initializer is never read
(on success it's overwritten to `true` before the post-`finally` `if`; on throw the `if` is never
reached). REAL error, blocks `npm run lint` (exit 1), so it blocks BOTH 1.10's own lint gate AND 1.7's
AC6. Neither the iteration-2 implementer (told to skip lint while 1.7 was mid-flight) nor Codex review-3
(ran the 3 test modes, not lint) caught it — the coherent-tree gate did, as designed. Fix = iteration 3,
storage.test.ts only. Everything else about iteration 2 stands: Codex review-3 (review-3.md) confirmed all
8 review-2 findings resolved, AC5 symmetric, no assertion weakened; coordinator re-read and confirmed.
Prior: CODE_REVIEW (fix verified) — pending only a final independent behavioral re-verify (different
worker) + the coherent-tree workspace typecheck/lint (folded into the concurrent 1.7 verification).
Codex re-review (review-3.md) confirms ALL EIGHT review-2 findings cleanly resolved, no assertion
weakened, no new defect, and AC5's loud-failure guarantee now holds symmetrically for BOTH backends
(disk resolved-path stat probe + S3 independent-client HeadObject probe). Coordinator independently
re-read the file and confirmed F1-F4/F8 against the code; review-3's load-bearing claims verified, not
taken on faith.
Iteration 1 implemented + independently verified
(verification: skip/exit-0, self-provisioned-MinIO pass/exit-0 on a separate container, dead-endpoint
fail/non-zero, clean teardown — all reproduced by an uninvolved worker). Codex implementation review
(review-2.md) returned 1 High + 3 Medium + 4 Low, ALL validated against the code by coordinator and ALL
genuine; dispositions in "Review dispositions — review-2" below; fix delegated per DELEGATION.md iteration 2.
Plan APPROVED after review-1 dispositions below.
Codex plan review (review-1.md) returned 2 High + 5 Medium + 5 Low findings; all validated
against source by coordinator (storage.ts, config.ts read directly). Every finding is genuine and every
Codex-prescribed resolution is folded into the plan/ACs below; the one AC-scope decision (AC5, opt-in vs
CI) is the coordinator's and is recorded in the dispositions. No residual design disagreement ⇒ no second
plan-review round.

## Objective
A fresh, live-backend contract test for the `Storage` abstraction
(`apps/api/src/lib/storage.ts`) that exercises BOTH real backends (a temporary
disk-backed store AND an S3-compatible MinIO backend), for BOTH protection
resource types (policy documents = PDF payload, health cards = image payload),
doing upload -> download (byte-identical assertion) -> delete for each
resource x backend, and that — WHEN INVOKED with `RUN_STORAGE_CONTRACT_TEST=1` —
FAILS LOUDLY (non-zero exit) if either backend is skipped or replaced by a stub.
No mock/stub for either backend.

## Root Cause
Not applicable (net-new test harness). Context: `services/backup.test.ts:272`
uses a deliberately-throwing `Storage` stub (put/get throw, rest inert); nothing
anywhere exercises a real disk or S3 backend. That stub is CONTEXT only — never
imported, modified, or reused by this test (review NB12). Task 1.4 proved the
Storage seam is structurally unchanged by the module move but explicitly declined
live upload/download verification — 1.10 owns that.

## Scope
- NEW file: `apps/api/src/lib/storage.test.ts` (colocated, `node --test`).
- Reads: `apps/api/src/lib/storage.ts` (`createStorage`, `Storage`,
  `DiskStorage`, `S3Storage`), `apps/api/src/config.ts` (`Config`, `loadConfig`).
- Touches NO routes, NO `db/schema.ts`, NO `app.ts`, NO service code, NO DB.
- Does NOT edit `.github/workflows/ci.yml` — this is a deliberate manual opt-in
  live contract test (like a heavier `backup.test.ts`); AC5 is scoped to the
  enabled invocation, not continuous CI (see disposition B1).

## Dependencies
- 1.4 (done). Independent of 1.7/1.8/1.9 — no shared files, safe to run in
  parallel with 1.7.

## Environment facts (from investigation-1.md, verified)
- Docker 29.1.3 available; `minio/minio:latest` image already local.
- Infra MinIO 172.31.0.7:9000 NOT reachable (timeout) -> cannot use it.
- Ephemeral `docker run ... minio server /data` starts healthy in <4s, works.
- A `services-minio-1` is already running on host-net `127.0.0.1:9000`
  (creds minioadmin/minioadmin) — usable via env override for a fast green run.
- `config.ts` parses env only inside `loadConfig()`, NOT at import — safe to
  import; but `loadConfig` calls `process.exit(1)` on any invalid env
  (`config.ts:85`), so the synthetic env MUST be schema-complete (below).
- Required-no-default env fields (verified against `EnvSchema`): `DATABASE_URL`
  (url), `REDIS_URL` (url), `SESSION_SECRET` (≥32 chars). All storage/S3 fields
  have defaults. `S3_ENDPOINT` default is `""` (⇒ disk); `S3_BUCKET` default is
  `compass-files` (the app's real bucket — MUST NOT be reused, review B6).
- disk `delete` is `unlink(...).catch(()=>{})` — idempotent, swallows errors
  (`storage.ts:53-54`); disk `put` ignores `contentType` (`storage.ts:43`);
  S3 `put` sets `ContentType` (`storage.ts:74`); S3 `ensureReady` swallows both
  HeadBucket and CreateBucket failures (`storage.ts:100-108`), so a dead endpoint
  surfaces at `put`, not `ensureReady`.
- Node 24.18; native TS strip; repo already runs single `.ts` test files. Import
  runtime modules with explicit `.ts`; `Config` is type-only ⇒ `import type`.

## Plan
- P1: New `apps/api/src/lib/storage.test.ts`, gated by
  `process.env.RUN_STORAGE_CONTRACT_TEST === "1"`. When unset: register ONE
  visible skipped test whose message gives the exact run command — keeps default
  `npm test` green and docker-free. When set: run the single gated parent test
  (P4).
- P2: `buildConfig(overrides)` helper — construct a complete, obviously-synthetic,
  schema-valid env object (fixed `DATABASE_URL=postgresql://x:x@127.0.0.1:5432/x`,
  `REDIS_URL=redis://127.0.0.1:6379`, `SESSION_SECRET` = 32+ fixed chars) merged
  with the caller's storage overrides, then `loadConfig(env)`. Do NOT spread
  `process.env` (avoids ambient/invalid values terminating the runner and keeps
  the test hermetic). Read ONLY the explicitly supported `S3_TEST_*` controls
  from the environment.
- P3: ONE gated parent test `test("storage contract: disk + s3", async () => {…})`
  that runs the whole flow in an awaited control flow with `finally` cleanup, so
  the parent CANNOT pass unless both backends completed. It:
  1. Disk backend — `mkdtemp` temp dir; `buildConfig({ S3_ENDPOINT: "", STORAGE_DIR })`
     -> `createStorage`. Assert `storage.constructor.name === "DiskStorage"`
     (regression tripwire, not proof — review B9). Run the shared contract (P5).
     After the contract, additionally assert that at least one produced key
     resolved to a real regular file under the temp root during the run
     (captured mid-contract). Add `"disk"` to the exercised set ONLY after the
     full contract (both payloads + scoped-delete + get-rejects) passed.
  2. S3 backend — resolve MinIO: if `S3_TEST_ENDPOINT` set, use it (+
     `S3_TEST_ACCESS_KEY`/`S3_TEST_SECRET_KEY`/optional region); DO NOT
     self-provision, and require an explicitly test-scoped unique bucket. Else
     self-provision ephemeral MinIO:
     `docker run -d --rm -p 0:9000 -e MINIO_ROOT_USER=<uuid> -e
     MINIO_ROOT_PASSWORD=<uuid32> --name compass-storage-contract-<uuid>
     minio/minio server /data`; capture the container id immediately; resolve the
     mapped host port via `docker inspect --format '{{(index (index
     .NetworkSettings.Ports "9000/tcp") 0).HostPort}}' <id>` (robust vs `[::]`
     IPv6 forms — review B8); validate it is one numeric port; poll
     `http://127.0.0.1:<port>/minio/health/live` until 200 (bounded timeout,
     THROW on timeout — never skip/swallow). In BOTH modes use a unique lowercase
     bucket `compass-contract-<uuid>` (never `compass-files`, never delete the
     bucket). `buildConfig({ S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY,
     S3_FORCE_PATH_STYLE: "true" })` -> `createStorage`. Assert
     `storage.constructor.name === "S3Storage"`. Run the shared contract (P5).
     Add `"s3"` to the exercised set ONLY after the full contract passed.
     Provisioning failure (docker/MinIO unreachable) MUST throw and fail the run.
  3. Assert `exercised.size === 2 && exercised.has("disk") && exercised.has("s3")`.
  4. `finally`: recursively `rm` the temp disk dir; best-effort delete every
     tracked S3 key created (tracked immediately after each `put`, so a failed
     assertion still cleans up); `docker rm -f <exact-id>` when self-provisioned,
     treating "no such container" (auto-removed via `--rm`) as already-clean but
     NOT blanket-swallowing other teardown failures. Never delete the bucket or
     unrelated objects.
- P4: Shared contract body `runContract(storage, track)` per backend, two
  distinct representative payloads:
  - policyDoc = representative PDF bytes (`%PDF-1.4…`), contentType application/pdf
  - healthCard = representative PNG bytes (PNG magic), contentType image/png
  Sequence (proves coexistence + scoped deletion + true removal):
  1. `ensureReady()` ONCE for the backend (not per payload — review B11).
  2. `kPdf = put(pdf, "application/pdf")`; track kPdf. `kPng = put(png, "image/png")`;
     track kPng. Assert both are non-empty strings and `kPdf !== kPng`.
  3. `list()` includes BOTH kPdf and kPng.
  4. `get(kPdf)` -> Buffer, `.equals(pdf)`; `get(kPng)` -> Buffer, `.equals(png)`
     (byte-identical; distinct payloads defeat a constant-empty or cross-wired
     stub).
  5. `delete(kPdf)`; assert `list()` no longer contains kPdf but STILL contains
     kPng, and `get(kPng)` still equals png (deletion is correctly scoped).
  6. `delete(kPng)`; assert `list()` contains neither; assert `get(kPdf)` and
     `get(kPng)` both REJECT (true removal, not just list omission — review B3).
     (Disk `get` is `readFile` on a missing path ⇒ ENOENT reject; S3 `get` ⇒
     NoSuchKey reject.)
  Do NOT claim MIME-type preservation is verified — disk ignores it and reading it
  back is outside the `Storage` interface (review B4). Payloads are
  "representative", not asserted-valid documents.
- P5: File-header doc block: what it tests, both backends, both resource types,
  setup/teardown, the unique-bucket isolation, and the EXACT commands — the
  self-provision command and the existing-MinIO override
  (`S3_TEST_ENDPOINT`/`S3_TEST_ACCESS_KEY`/`S3_TEST_SECRET_KEY`), the health
  timeout, container teardown, object cleanup, and a prominent warning that any
  externally supplied endpoint must be disposable/test-only and must not be a
  shared/production bucket. Never log credentials. Satisfies AC4.

## Acceptance Criteria
- AC1: Exercises BOTH real backends (temp disk store + MinIO S3), no stub/mock.
- AC2: Covers BOTH resource types: policy document (PDF) and health card (image),
  as two distinct representative payloads (not a MIME-preservation claim).
- AC3: For each resource x backend: upload -> download byte-identical assert ->
  delete. Deletion proven by BOTH (a) key absent from `list()` AND (b) post-delete
  `get(key)` REJECTS; and deletion is scope-verified (deleting one object leaves
  the other readable and listed).
- AC4: Documents backend setup/teardown, bucket isolation + object cleanup, and
  the exact command / environment to run it (self-provision + existing-MinIO
  override), plus the test-only-endpoint warning.
- AC5: When invoked with `RUN_STORAGE_CONTRACT_TEST=1`, failure to exercise EITHER
  backend fails the process (non-zero exit). This is a manual opt-in test with no
  continuous CI regression guarantee (deliberate — see disposition B1). Proven by
  (a) constructor-name tripwires PLUS real observable side effects (temp files on
  disk, real MinIO objects) as the substantive anti-stub guard; (b) the
  both-backends `exercised` assertion INSIDE the single awaited parent test, which
  cannot pass before both full contracts complete; (c) provisioning failure
  throwing; and (d) a demonstrated non-zero exit when S3 is pointed at a dead
  endpoint (T2).

## Verification (must see literal output + exit codes; different worker)
- T1: `RUN_STORAGE_CONTRACT_TEST=1 node --test apps/api/src/lib/storage.test.ts`
  self-provisioning ephemeral MinIO -> PASS, the single parent test passes, exit 0.
  Show evidence it spun a container (docker id / port) and that both disk+s3 ran
  (the exercised assertion held).
- T2: `RUN_STORAGE_CONTRACT_TEST=1 S3_TEST_ENDPOINT=http://127.0.0.1:1
  S3_TEST_ACCESS_KEY=x S3_TEST_SECRET_KEY=xxxxxxxx node --test ...` (dead
  endpoint, no self-provision) -> FAILS loudly, NON-ZERO exit. Proves AC5(d).
- T3: `node --test apps/api/src/lib/storage.test.ts` with the flag UNSET -> the
  contract test is a visible SKIP, exit 0 (default suite unaffected, docker-free).
- T4: `npm run typecheck -w apps/api` and `npm run lint` (root) pass for the new
  file. (Necessary but NOT a substitute for the exact native-Node run above.)
- T5 (confidence): T1 variant with `S3_TEST_ENDPOINT=http://127.0.0.1:9000`
  minioadmin creds against the already-running MinIO -> PASS. Confirm the unique
  test bucket was created and its objects cleaned up, and `compass-files` was NOT
  touched.
- T6: confirm the `finally` cleanup actually ran — after T1, no
  `compass-storage-contract-*` container remains (`docker ps -a`), and the temp
  disk dir is gone.

## Non-Goals
- No CI (`ci.yml`) wiring, no route/schema/app.ts/service/DB changes.
- Not testing `assertUploadable` (service-layer gate, not the Storage seam).
- Not asserting S3 object MIME metadata (outside the `Storage` interface).
- No new npm dependency (use `node:child_process` + docker CLI).
- Not deleting the S3 bucket (only the objects the test created).

## Review dispositions — review-1
- **B1 (High: AC5 not met by an opt-in test no workflow runs) — VALID; resolved by
  narrowing AC5, coordinator's scope call.** Verified: `apps/api` test script runs
  every `src/**/*.test.ts` with no flag, and no CI job would set it. The original
  scope deliberately excludes `ci.yml`. Decision: keep it a manual opt-in test and
  rewrite AC5 to "when `RUN_STORAGE_CONTRACT_TEST=1`, failing to exercise either
  backend fails the process", explicitly noting no continuous CI guarantee. AC4 was
  never a CI issue and is unchanged.
- **B2 (High: separate FINAL-test tally is a fragile ordering guard) — VALID,
  ACCEPTED.** Restructured to ONE gated parent test with an awaited disk-then-s3
  control flow; the `exercised` assertion lives inside it, so the parent cannot
  pass before both contracts complete. Tally entries are added only AFTER the full
  contract (both payloads + scoped delete + get-rejects), not after a single
  round-trip.
- **B3 (Medium: deletion only proven by list absence) — VALID, ACCEPTED.** AC3 and
  P4 now require post-delete `get(key)` to REJECT, plus scoped-deletion (delete one,
  the other stays readable/listed). Confirmed disk `get`=readFile ⇒ ENOENT and S3
  `get` ⇒ NoSuchKey both reject.
- **B4 (Medium: MIME preservation not proven) — VALID, ACCEPTED.** Verified disk
  ignores contentType, S3 sets it, and services read MIME from the DB not storage.
  Plan no longer claims MIME validation; payloads reworded "representative".
- **B5 (Medium: loadConfig can process.exit the runner) — VALID, ACCEPTED.**
  Verified `config.ts:85`. `buildConfig` now supplies schema-valid
  DATABASE_URL/REDIS_URL/SESSION_SECRET and does NOT spread `process.env`.
- **B6 (Medium: existing-MinIO mode needs isolated bucket + cleanup) — VALID,
  ACCEPTED.** Unique lowercase `compass-contract-<uuid>` bucket in both modes;
  never `compass-files`; track keys immediately after `put`; delete each in
  `finally`; never delete the bucket; test-only-endpoint warning in the header.
- **B7 (Medium: guaranteed teardown without masking primary failure) — VALID,
  ACCEPTED.** Container id captured right after `docker run`; `docker rm -f <id>` in
  `finally`; "no such container" treated as already-clean; other teardown failures
  surfaced without replacing an earlier error.
- **B8 (Low: docker port parsing brittle) — VALID, ACCEPTED.** Switched to
  `docker inspect --format` for the `9000/tcp` HostPort and numeric validation.
- **B9 (Low: constructor-name not unforgeable) — VALID, ACCEPTED.** Kept as a
  regression tripwire; AC5 now leans on real observable side effects as the
  substantive guard; added a disk regular-file-under-temp-root assertion.
- **B10 (Low: .ts import conventions) — VALID, ACCEPTED.** Runtime imports use
  explicit `.ts`; `Config` is `import type`; no enums/namespaces/param-properties.
- **B11 (Low: ensureReady once per backend) — VALID, ACCEPTED.** Moved out of the
  payload loop.
- **B12 (Low: backup stub is context, not a target) — VALID, ACCEPTED.** Recorded
  in Root Cause; the stub is never imported or reused.
- **Missing-useful-cases — all folded into P4:** distinct keys asserted, both
  objects uploaded before any read/delete, both listed before deletion, scoped
  deletion, `get(deletedKey)` rejects, disk regular-file check, recursive temp-dir
  cleanup, unique S3 bucket.

## Review dispositions — review-2 (implementation review of iteration 1)
All validated by coordinator by reading `storage.test.ts` directly. Iteration 1 was independently verified
green; these harden it. Fix = iteration 2, storage.test.ts only, no other file.
- **F1 (High: S3 anti-stub asymmetric with disk) — VALID, ACCEPTED.** Disk has an independent `stat()`
  probe outside the Storage instance (line 163); S3 has none, so a coherent in-memory `S3Storage` stub
  would pass — defeating AC5's "real MinIO objects" guarantee. review-1's B9 called S3's round-trip
  "already strong" and only hardened disk; that asymmetry is the gap. FIX: add an INDEPENDENT S3
  observation using a SEPARATE `@aws-sdk/client-s3` client constructed in the test (NOT via the Storage
  instance) — `HeadObjectCommand(bucket, kPdf)` succeeds while the object exists (in the S3 track
  callback, mirroring disk), and (optional strengthening) `HeadObjectCommand` on a deleted key rejects.
  `@aws-sdk/client-s3` is already an `apps/api` dependency, so this adds NO new npm dependency.
- **F2 (Medium: unguarded `rm()` first in `finally` can skip later cleanup and mask the primary error) —
  VALID, ACCEPTED.** Guard EACH cleanup step independently (temp-dir rm, tracked-key deletes, docker
  rm -f) so one failure neither aborts the others nor replaces a real contract failure.
- **F3 (Medium: teardown failure not surfaced when a primary error exists) — VALID, ACCEPTED.** Always
  `console.error` a teardown failure (so it is surfaced) AND still throw it only when there was no primary
  error — never mask the primary. B7's "surfaced without replacing an earlier error" then holds in both
  paths.
- **F4 (Medium: health-poll `fetch` has no abort timeout ⇒ can hang past the 30s deadline) — VALID,
  ACCEPTED.** Give each `fetch` an `AbortSignal` bounded by the remaining deadline
  (`AbortSignal.timeout(Math.max(0, deadline - Date.now()))` or per-request cap), so a stalled connection
  cannot defeat the bounded-throw guarantee.
- **F5 (Low: `parseInt` accepts `9000junk`, no 65535 max) — VALID, ACCEPTED.** Validate the full trimmed
  string is digits-only and `1 <= port <= 65535`.
- **F6 (Low: `S3_TEST_REGION` control missing) — VALID, ACCEPTED.** Read `S3_TEST_REGION` in external
  mode and pass it as `S3_REGION`; document it in the header's existing-MinIO command.
- **F7 (Low: header falsely says the unique bucket is deleted/cleaned) — VALID, ACCEPTED.** The code
  correctly never deletes the bucket. Reword the header: the bucket is unique and RETAINED (empty); only
  the tracked objects are deleted.
- **F8 (Low: disk probe doesn't establish "under the temp root") — VALID, ACCEPTED.** Resolve both the
  temp dir and `join(dir, key)` and assert the probed path is contained beneath the temp root (rejects a
  forged absolute/`..` key), making it a true anti-stub observation.
- Codex's confirmations recorded as corroboration (checked against code, not taken on faith): P1 gate and
  visible skip, `buildConfig` schema-completeness with no `process.env` spread, P4 (ensureReady-once,
  distinct payloads, both-uploaded-before-read, scoped delete, both post-delete `get` reject), `.ts`/
  `import type` conventions, and that the parent-test tally sits in one awaited control flow so it cannot
  pass early. Codex's note that `apps/api` typecheck currently exits 2 is the concurrent 1.7 migration
  mid-flight, NOT this file — which is exactly why the workspace typecheck/lint gate is deferred to a
  coherent post-1.7 tree.
