## Review outcome

The plan is directionally sound and would satisfy AC1–AC4 when explicitly enabled. It does not fully satisfy the literal AC5 as written because the normal test command deliberately skips the contract, and there is no CI or other required invocation that ever exercises the loud-failure guards.

I would approve it only after tightening test orchestration, deletion verification, configuration construction, and the AC5/CI language.

## Findings

### 1. High: AC5 is not met by an opt-in test that no automated workflow runs

The objective requires a test that “FAILS LOUDLY if either backend is skipped” ([TASK.md](/home/udai/PennyPilot/tasks/019-storage-contract-tests/TASK.md:12)), and AC5 repeats that requirement ([TASK.md](/home/udai/PennyPilot/tasks/019-storage-contract-tests/TASK.md:87)). But P1 intentionally makes an unset flag a successful skip ([TASK.md](/home/udai/PennyPilot/tasks/019-storage-contract-tests/TASK.md:45)), while the API’s standard test script runs every `src/**/*.test.ts` without setting that flag ([apps/api/package.json](/home/udai/PennyPilot/apps/api/package.json:14)). CI only invokes existing repository scripts and has no proposed live-test invocation ([TASK.md](/home/udai/PennyPilot/tasks/019-storage-contract-tests/TASK.md:27)).

Consequences:

- A developer can merge a broken S3 implementation while default tests and CI remain green.
- Removing or accidentally disabling the enabled branch still leaves the default suite green with one skip.
- The tally and constructor checks only protect an invocation where `RUN_STORAGE_CONTRACT_TEST=1` was already supplied. They do not make skipping the contract loud globally.

The gate is operationally reasonable for a Docker-dependent integration test, but the acceptance criterion must say “when the contract-test command is invoked.” If AC5 is intended to apply to CI/regression enforcement, this plan has a gap.

Recommended resolution:

- Either wire the enabled command into a dedicated CI job, satisfying both enforcement and the existing default-suite requirement; or
- explicitly revise AC5 to “When `RUN_STORAGE_CONTRACT_TEST=1`, failure to exercise either backend fails the process,” and document that this is a manual opt-in test with no continuous regression guarantee.

AC4 itself does not require CI. Exact setup, teardown, and commands satisfy its literal documentation requirement ([TASK.md](/home/udai/PennyPilot/tasks/019-storage-contract-tests/TASK.md:86)). CI is an AC5/enforcement issue, not an AC4 issue.

### 2. High: a separately registered “FINAL test” is an unnecessarily fragile ordering guard

P5 proposes separate backend tests followed by a final top-level test reading a module-level `Set` ([TASK.md](/home/udai/PennyPilot/tasks/019-storage-contract-tests/TASK.md:72)). It relies on execution ordering rather than expressing a structural dependency.

This can become unreliable if:

- someone later enables per-test concurrency;
- the backend cases are generated or moved into suites with different scheduling;
- a test is marked skipped but independently mutates the tally;
- tally mutation is inadvertently moved before all resource assertions complete.

Today the repository command does not pass a concurrency option ([apps/api/package.json](/home/udai/PennyPilot/apps/api/package.json:14)), and Node ordinarily isolates test files and runs ordinary tests within a file predictably. Nevertheless, “FINAL” is only a naming/comment convention, not a test-runner primitive.

A stronger and simpler shape is one enabled parent test:

1. provision resources;
2. run the disk contract;
3. run the S3 contract;
4. assert the tally;
5. clean up in `finally`.

Nested subtests may be used, but they should be explicitly awaited. This makes it impossible for the parent to pass before both contracts complete and removes reliance on registration order. If separate top-level tests are retained, explicitly disable concurrency and only add a backend to the set after both PDF and PNG cases—including deletion assertions—have passed.

The present wording says the set is updated after “a successful byte-identical round-trip” ([TASK.md](/home/udai/PennyPilot/tasks/019-storage-contract-tests/TASK.md:73)). That is too early: a backend could be tallied before its second resource or delete checks pass. Although that backend test should itself still fail, the tally no longer truthfully means “full backend contract completed.”

### 3. Medium: deletion is only proven as absence from `list()`, not as inability to retrieve the object

The plan calls `delete`, then only asserts that `list()` omits the key ([TASK.md](/home/udai/PennyPilot/tasks/019-storage-contract-tests/TASK.md:69)). This exactly matches the parenthetical wording in AC3 ([TASK.md](/home/udai/PennyPilot/tasks/019-storage-contract-tests/TASK.md:84)), so it technically satisfies that criterion.

It does not prove true deletion. An implementation could:

- stop returning the key from `list()` while retaining it;
- cache or otherwise continue serving `get(key)`;
- delete only listing metadata.

For the current implementations, disk deletion is `unlink` ([storage.ts](/home/udai/PennyPilot/apps/api/src/lib/storage.ts:53)) and S3 deletion sends `DeleteObjectCommand` ([storage.ts](/home/udai/PennyPilot/apps/api/src/lib/storage.ts:85)), but the purpose of a contract test is to detect regressions in those behaviors.

After deletion, assert both:

- `list()` does not contain the key; and
- `get(key)` rejects.

That proves externally observable removal much more directly. It also covers the deliberately idempotent disk delete behavior, which currently swallows `unlink` errors ([storage.ts](/home/udai/PennyPilot/apps/api/src/lib/storage.ts:54)).

### 4. Medium: byte identity is proven, but MIME-type preservation is not

`Buffer.isBuffer(got)` plus `got.equals(data)` is a valid byte-for-byte assertion. Distinct nonempty PDF and PNG payloads prevent a constant empty result or simple cross-wiring from passing. This properly exercises the `put`/`get` behavior defined by the interface ([storage.ts](/home/udai/PennyPilot/apps/api/src/lib/storage.ts:22)).

However, merely passing `application/pdf` and `image/png` does not verify that S3 stores those content types. S3 explicitly maps the argument to `ContentType` ([storage.ts](/home/udai/PennyPilot/apps/api/src/lib/storage.ts:74)), while disk deliberately ignores it ([storage.ts](/home/udai/PennyPilot/apps/api/src/lib/storage.ts:43)). The insurance service passes MIME types on policy upload ([insurance.ts](/home/udai/PennyPilot/apps/api/src/modules/protection/services/insurance.ts:169)) and health-card upload ([insurance.ts](/home/udai/PennyPilot/apps/api/src/modules/protection/services/insurance.ts:233)), but reads MIME metadata from the database rather than storage ([insurance.ts](/home/udai/PennyPilot/apps/api/src/modules/protection/services/insurance.ts:192), [insurance.ts](/home/udai/PennyPilot/apps/api/src/modules/protection/services/insurance.ts:256)).

Therefore:

- AC2 is satisfied as “two representative payloads.”
- The plan should not claim it validates MIME preservation.
- Testing S3 object metadata would require an extra S3 API call outside the `Storage` interface and is unnecessary unless MIME persistence is explicitly in scope.

Likewise, byte sequences beginning with PDF/PNG signatures need not be fully valid documents. Calling them “representative payloads” is more accurate than “realistic” unless valid fixtures are supplied.

### 5. Medium: `loadConfig` can terminate the entire test process

`loadConfig` does not throw on invalid input; it calls `process.exit(1)` ([config.ts](/home/udai/PennyPilot/apps/api/src/config.ts:75)). The plan correctly observes that importing the module is safe, because parsing happens only inside `loadConfig`, but the proposed calls remain process-terminating operations.

The synthetic environment must include all required fields, not only storage fields:

- valid `DATABASE_URL` ([config.ts](/home/udai/PennyPilot/apps/api/src/config.ts:10));
- valid `REDIS_URL` ([config.ts](/home/udai/PennyPilot/apps/api/src/config.ts:11));
- a `SESSION_SECRET` of at least 32 characters ([config.ts](/home/udai/PennyPilot/apps/api/src/config.ts:13)).

Use fixed, obviously synthetic, schema-valid values. Do not spread all of `process.env` into the synthetic object: unrelated invalid values such as `PORT`, `NODE_ENV`, or string-boolean fields could terminate the runner, and propagating ambient production configuration makes the test less hermetic. Only read the explicitly supported `S3_TEST_*` controls.

If validating configuration parsing is not itself part of this task, constructing a typed `Config` literal would avoid `process.exit`; however, the plan explicitly wants `loadConfig`, so the complete controlled environment should be documented.

### 6. Medium: existing-MinIO mode needs an isolated bucket and explicit cleanup semantics

`S3_TEST_ENDPOINT` points the test at an external live service ([TASK.md](/home/udai/PennyPilot/tasks/019-storage-contract-tests/TASK.md:52)). A caller could accidentally provide a shared or production-compatible endpoint.

The test should:

- generate a unique lowercase test bucket by default;
- require any bucket override to be explicitly test-scoped;
- never delete the bucket or unrelated objects;
- delete every key it creates in `finally`, even when an assertion fails;
- avoid logging credentials;
- prominently warn that the endpoint must be disposable/test-only.

A fixed default such as `compass-files` would share the application’s normal default bucket ([config.ts](/home/udai/PennyPilot/apps/api/src/config.ts:21)), which is inappropriate for a destructive contract test. Although generated object keys contain UUIDs ([storage.ts](/home/udai/PennyPilot/apps/api/src/lib/storage.ts:32)), isolation should be at bucket level as well.

If cleanup is limited to the normal success path, a failed assertion leaves test objects in an existing server. Track created keys immediately after each successful `put` and remove them best-effort during teardown.

### 7. Medium: teardown should be guaranteed without masking the primary failure

P3 says teardown will be in an `after`/`finally` and will be “best-effort” ([TASK.md](/home/udai/PennyPilot/tasks/019-storage-contract-tests/TASK.md:60)). `finally` around provisioning and contract execution is the safer choice because setup may fail after the container starts but before hooks are registered.

Track the returned container ID as soon as `docker run` succeeds, and always invoke `docker rm -f <exact-id>` in `finally`. Cleanup failure should:

- fail an otherwise successful test, because leaked containers are material;
- be reported without replacing an earlier contract/provisioning error.

Using `--rm` is fine, but it means `docker rm -f` can report “no such container” if MinIO exited and auto-removed itself. Treat that particular state as already cleaned; do not blanket-swallow all teardown failures.

### 8. Low: Docker port parsing must handle actual CLI output robustly

Random host-port publication avoids fixed-port collision, but `docker port <id> 9000/tcp` may return multiple bindings, including IPv4 and IPv6 forms. Splitting the first line on `:` is brittle for `[::]:port`.

Prefer a machine-readable `docker inspect --format` query for the `9000/tcp` host port, or parse all returned bindings and deliberately construct `http://127.0.0.1:<port>`. Validate that the result is one numeric port before starting health checks.

The proposed UUID container name makes name collisions negligible ([TASK.md](/home/udai/PennyPilot/tasks/019-storage-contract-tests/TASK.md:56)), and Docker’s `-p 0:9000` avoids host-port races. Separate Node test files execute in isolated processes, so the module-level set is not shared across files. Multiple simultaneous invocations should remain safe if each also uses:

- a unique container name;
- a random port;
- unique credentials;
- a unique bucket;
- a unique disk directory.

### 9. Low: constructor-name checking is useful but neither unforgeable nor especially stable

The concrete classes are private to the module ([storage.ts](/home/udai/PennyPilot/apps/api/src/lib/storage.ts:38), [storage.ts](/home/udai/PennyPilot/apps/api/src/lib/storage.ts:67)), so `instanceof` cannot be used externally. Checking `storage.constructor.name` confirms the current factory branches selected the expected named classes ([storage.ts](/home/udai/PennyPilot/apps/api/src/lib/storage.ts:111)).

Limitations:

- a stub class can deliberately be named `DiskStorage` or `S3Storage`;
- constructor names can change during harmless refactoring or bundling/minification;
- the test only proves what `createStorage` returned in this module graph, not metaphysical absence of all substitutions.

In this repository’s direct native-Node execution, importing the real `createStorage` and exercising actual filesystem/S3 side effects is stronger evidence than the name assertion itself. Retain the check as a regression tripwire, but do not describe it as undefeatable proof. The observable side effects—real temp files and real MinIO objects—are the substantive anti-stub guard.

For disk, an additional assertion that the returned key resolves to an actual regular file below the temporary root would strengthen the proof without exposing the private class. For S3, successful list/get/delete against the independently provisioned MinIO is already strong.

### 10. Low: TypeScript/native-strip imports need to follow repository conventions exactly

The repository is intentionally running `.ts` tests directly under Node ([apps/api/package.json](/home/udai/PennyPilot/apps/api/package.json:14)), and production source already uses `.ts` extensions, including the type-only Config import ([storage.ts](/home/udai/PennyPilot/apps/api/src/lib/storage.ts:13)). The new test should therefore import runtime modules with explicit `.ts` extensions:

```ts
import { loadConfig } from "../config.ts";
import { createStorage } from "./storage.ts";
import type { Config } from "../config.ts";
```

Potential pitfalls:

- importing `Storage` or `Config` as runtime values even though they are types;
- omitting `.ts`, which may fail native ESM resolution;
- using TypeScript features Node’s strip-only execution cannot erase safely, such as enums, namespaces, parameter properties, or runtime-dependent type syntax;
- relying on a loader such as `tsx` that the actual command does not use.

Ordinary type annotations, interfaces, and `import type` are appropriate. T4’s typecheck is necessary but does not replace running the exact native-Node command.

### 11. Low: `ensureReady()` should be once per backend, not once per payload

P4 places `ensureReady()` inside the loop for each resource ([TASK.md](/home/udai/PennyPilot/tasks/019-storage-contract-tests/TASK.md:66)). The contract only requires the backend to be made ready before use. Calling it twice adds noise and exercises idempotence unintentionally.

Call it once before the PDF/PNG cases. If idempotence is considered important, make that a named assertion rather than an incidental repeated setup operation.

Note that S3’s implementation catches every `HeadBucket` failure, then also suppresses every `CreateBucket` failure ([storage.ts](/home/udai/PennyPilot/apps/api/src/lib/storage.ts:100)). The subsequent `put` will normally expose an unreachable server or invalid credentials, so the proposed dead-endpoint test still fails. But the contract test will not isolate or clearly diagnose erroneous `ensureReady` behavior. A post-`ensureReady` bucket operation naturally provides that practical verification.

### 12. Low: the backup stub is context, not a target or reusable pattern

The stated assumption about the backup test is correct. It contains a deliberate stub whose `put` and `get` throw and whose remaining methods are inert ([backup.test.ts](/home/udai/PennyPilot/apps/api/src/services/backup.test.ts:272)). It demonstrates that existing tests do not exercise storage, but it should not be imported, modified, or used by the new test.

The new contract test remaining colocated with `storage.ts`, DB-free, and service-free is consistent with the requested scope.

## Acceptance-criteria assessment

- **AC1 — conditionally satisfied.** When enabled, `createStorage` with empty `S3_ENDPOINT` selects the real private `DiskStorage`, while a nonempty endpoint selects the real private `S3Storage` ([storage.ts](/home/udai/PennyPilot/apps/api/src/lib/storage.ts:111)). Temp disk plus live MinIO meets the backend requirement. Strengthen isolation and side-effect assertions as noted above.

- **AC2 — satisfied.** Two distinct PDF/image byte payloads and MIME arguments represent the two insurance resource categories. The service indeed passes policy MIME/data to storage ([insurance.ts](/home/udai/PennyPilot/apps/api/src/modules/protection/services/insurance.ts:165)) and does the same for health cards ([insurance.ts](/home/udai/PennyPilot/apps/api/src/modules/protection/services/insurance.ts:228)). This tests representative storage behavior, not the service or upload-validation layer.

- **AC3 — mostly satisfied, but deletion proof should be stronger.** `Buffer.equals` genuinely proves byte identity. Upload, list visibility, and list absence after delete meet the literal criterion. Add a rejecting post-delete `get` to prove retrieval is impossible.

- **AC4 — satisfied if the header is complete and accurate.** Document both the self-provisioned command and the existing-endpoint command, all required optional/default environment variables, health timeout, container teardown, bucket/object cleanup, and the warning that an external endpoint must be test-only. No CI change is required by AC4’s wording.

- **AC5 — not satisfied literally under the current plan.** Enabled runs can fail loudly, including the dead-endpoint negative control. Default and CI runs intentionally skip and succeed, so neither backend can be exercised indefinitely without causing a failure. Either add CI enforcement or narrow the criterion to enabled invocations.

## Missing useful cases

The required core can still remain compact, but these additions materially improve it:

- Assert the two returned keys are distinct. `makeKey` is intended to be collision-free even for content-derived sharding ([storage.ts](/home/udai/PennyPilot/apps/api/src/lib/storage.ts:32)).
- Upload both objects before reading/deleting either one. This better detects cross-wired keys and demonstrates coexistence in `list()`.
- Assert `list()` contains both exact keys before deletion.
- Delete one object and assert the other remains readable and listed; then delete the second. This proves deletion is correctly scoped.
- Assert `get(deletedKey)` rejects.
- On disk, optionally assert each key corresponds to a regular file inside the temporary root.
- Clean the temporary disk directory recursively in `finally`; `mkdtemp` alone otherwise leaks directories.
- Use a unique S3 bucket and clean every created object after failure.

Not necessary for this task:

- route, database, insurance-service, or upload-validation tests;
- multipart upload or large-object coverage;
- MIME metadata inspection unless the scope is expanded;
- installing a MinIO client dependency;
- deleting the test bucket, which adds complexity and risks interfering with an externally supplied backend.

## Complexity assessment

Self-provisioning MinIO through the Docker CLI is justified for a live, hermetic backend and avoids a new package. The plan becomes unnecessarily complex if it combines many independent top-level tests, a mutable global tally, lifecycle hooks, and duplicated setup. A single gated parent test with small helpers—`provisionMinio`, `buildConfig`, `runContract`, and `cleanup`—would be easier to reason about and make the “both backends or fail” property structural.

The existing-MinIO override is useful, but it is also the largest security and isolation risk. Keep it only with unique bucket naming, exact opt-in documentation, and a test-only endpoint warning.

Overall: revise AC5 or add CI enforcement; make both backend executions part of one awaited control flow; verify post-delete `get` failure; construct a complete controlled config; and guarantee isolated cleanup. With those changes, the plan would be robust and proportionate.