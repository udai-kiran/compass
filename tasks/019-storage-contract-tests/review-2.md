## Findings

1. **High — AC5’s anti-stub guarantee is not met for S3.**  
   [storage.test.ts:254](/home/udai/PennyPilot/apps/api/src/lib/storage.test.ts:254) checks the constructor name, but all subsequent S3 observations at [storage.test.ts:256](/home/udai/PennyPilot/apps/api/src/lib/storage.test.ts:256) go through that same `Storage` instance. An in-memory implementation whose constructor is named `S3Storage` and which implements `put/get/list/delete` consistently would pass without touching MinIO. Unlike disk’s independent `stat()` probe at [storage.test.ts:163](/home/udai/PennyPilot/apps/api/src/lib/storage.test.ts:163), there is no independent S3-side observation. This conflicts with AC5’s requirement that replacing either backend with a stub fail and with TASK.md’s claim that “real MinIO objects” are the substantive anti-stub guard. Add an independent MinIO/S3 client assertion against the generated bucket and keys while they exist.

2. **Medium — cleanup is not guaranteed, and a disk cleanup error can mask the primary failure and prevent later cleanup.**  
   The first awaited operation in `finally` is `rm()` at [storage.test.ts:265](/home/udai/PennyPilot/apps/api/src/lib/storage.test.ts:265). If it rejects, JavaScript exits the `finally` immediately: tracked S3 cleanup and `docker rm -f` are never attempted, and the `rm()` rejection replaces any original contract failure. Each cleanup operation needs its own guarded attempt, with errors recorded while preserving the primary error.

3. **Medium — container teardown failures are not actually “surfaced” when a primary failure exists.**  
   [storage.test.ts:278](/home/udai/PennyPilot/apps/api/src/lib/storage.test.ts:278) records a non-`No such container` failure in `teardownError`, but [storage.test.ts:284](/home/udai/PennyPilot/apps/api/src/lib/storage.test.ts:284) is unreachable when the `try` already threw: after `finally`, the original exception resumes immediately. This preserves the primary failure, but silently discards the teardown failure instead of surfacing it as required by review disposition B7. Preserve the primary error explicitly and attach/aggregate or report cleanup failures without replacing it.

4. **Medium — the nominally bounded health poll can hang indefinitely.**  
   The deadline at [storage.test.ts:225](/home/udai/PennyPilot/apps/api/src/lib/storage.test.ts:225) is checked only between requests. The `fetch()` at [storage.test.ts:229](/home/udai/PennyPilot/apps/api/src/lib/storage.test.ts:229) has no abort timeout. An endpoint that accepts the connection but never returns headers can keep the single request pending forever, so the 30-second timeout never throws. Use an `AbortSignal` bounded by the remaining deadline.

5. **Low — Docker port validation accepts malformed or invalid ports.**  
   [storage.test.ts:216](/home/udai/PennyPilot/apps/api/src/lib/storage.test.ts:216) uses `Number.parseInt`, so output such as `9000junk` is accepted. The assertion at [storage.test.ts:217](/home/udai/PennyPilot/apps/api/src/lib/storage.test.ts:217) also does not enforce the TCP port maximum of 65535. This does not satisfy “one numeric port.” Validate the complete trimmed string with digits-only syntax and then require `1 <= port <= 65535`.

6. **Low — P2/P3/P5’s optional S3 test-region control is missing.**  
   External mode reads endpoint, access key, and secret at [storage.test.ts:170](/home/udai/PennyPilot/apps/api/src/lib/storage.test.ts:170), but never reads `S3_TEST_REGION` or passes it as `S3_REGION`. The header’s existing-MinIO command at [storage.test.ts:31](/home/udai/PennyPilot/apps/api/src/lib/storage.test.ts:31) omits it too. TASK.md explicitly includes an optional region among the supported `S3_TEST_*` controls.

7. **Low — the header falsely says the unique bucket is deleted/cleaned.**  
   [storage.test.ts:43](/home/udai/PennyPilot/apps/api/src/lib/storage.test.ts:43) says the test “creates and deletes its own unique bucket … and objects,” and [storage.test.ts:38](/home/udai/PennyPilot/apps/api/src/lib/storage.test.ts:38) says its unique bucket/objects are cleaned up. The implementation correctly never deletes the bucket; it only deletes tracked keys at [storage.test.ts:268](/home/udai/PennyPilot/apps/api/src/lib/storage.test.ts:268). The documentation contradicts both the code and the explicit “never delete the bucket” requirement. It should say the bucket is unique and retained empty while only tracked objects are deleted.

8. **Low — the disk side-effect assertion does not itself establish “under the temp root.”**  
   [storage.test.ts:163](/home/udai/PennyPilot/apps/api/src/lib/storage.test.ts:163) uses `join(dir, key)` but does not reject absolute keys or `..` traversal. A forged disk backend could return a key resolving outside the temporary root and still satisfy `stat().isFile()`. The current real `makeKey()` is safe, but the assertion is specifically described as an anti-stub observation. Resolve both paths and verify the probed path is contained beneath the temp directory.

## Plan and acceptance assessment

- **P1:** Pass. The exact flag gates execution, and the unset path registers one visible skipped test at [storage.test.ts:134](/home/udai/PennyPilot/apps/api/src/lib/storage.test.ts:134). The observed unset run reported one skip and exited 0.
- **P2:** Mostly pass. `buildConfig` supplies all three non-default schema requirements and does not spread `process.env` at [storage.test.ts:73](/home/udai/PennyPilot/apps/api/src/lib/storage.test.ts:73). Optional `S3_TEST_REGION` support is missing.
- **P3:** Partial. Both backends are sequentially awaited in one parent test, the tally is added only after each full contract, unique bucket naming is correct, and the health timeout explicitly throws. Cleanup/error preservation and strict port validation have the defects above.
- **P4:** Pass. `ensureReady()` runs once per backend; PDF and PNG payloads are distinct; both are uploaded before reads; keys are distinct; downloads are byte-identical; scoped deletion is proved; and both deleted keys must reject on `get()`.
- **P5:** Partial. The header is extensive and includes both commands, isolation, warning, health polling, and cleanup. It omits the optional region and incorrectly claims the bucket is deleted/cleaned.

- **AC1:** Functionally pass for the current implementation: the real factories select disk and S3, with no imported mock/stub. The stronger AC5 anti-stub guarantee remains unmet for S3.
- **AC2:** Pass. Distinct representative PDF and PNG bytes are used, and no MIME-preservation assertion is made.
- **AC3:** Pass. Both backends execute upload, byte-identical download, scoped deletion, list absence, and rejecting post-delete reads for both keys.
- **AC4:** Partial because the bucket lifecycle documentation is inaccurate and the optional region override is undocumented.
- **AC5:** Fail as written. The single parent test and exercised tally are correctly inside one awaited control flow at [storage.test.ts:139](/home/udai/PennyPilot/apps/api/src/lib/storage.test.ts:139), so it cannot pass early or silently skip the present disk/S3 branches. Provisioning and backend failures propagate non-zero. However, S3 can be replaced by a coherent in-memory implementation with the expected constructor name and still pass because there is no independent MinIO observation.

The import conventions are correct: runtime imports use `.ts`, `Config` and `Storage` use `import type`, and the file contains no strip-unsafe TypeScript constructs. The default gated run passed with one visible skip. API typecheck currently exits 2 due to unrelated missing mailbox-module imports in the concurrently modified ingest migration; no type error from `storage.test.ts` was reported.