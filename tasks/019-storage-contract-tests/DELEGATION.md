# Sonnet Worker Delegation — 019 / roadmap 1.10 (storage contract tests)

## Iteration 3 (lint fix — regression from iteration 2's F3)
The coherent-tree `npm run lint` fails with exactly one error, introduced by iteration 2's F3
`contractSucceeded` flag:

```
apps/api/src/lib/storage.test.ts:157:9  error  The value assigned to 'contractSucceeded' is not used in
subsequent statements  no-useless-assignment
```

It is correct: `let contractSucceeded = false;` — the `false` value is never read (on the success path it's
overwritten to `true` before the post-`finally` `if (teardownError && contractSucceeded)`; on the throw
path that `if` is never reached, since the try's exception propagates out through `finally`).

### Required change (storage.test.ts ONLY)
Restructure the primary-error / teardown-error handling so it is lint-clean while PRESERVING the exact F3
semantics Codex review-3 approved: a teardown failure must be surfaced (`console.error`) but must NEVER
mask a primary contract failure. Recommended shape (you may use any lint-clean equivalent that preserves
these semantics):

```ts
let teardownError: unknown;
let primaryError: unknown;
try {
  // ...the whole disk + s3 contract, ending with the exercised-tally asserts...
} catch (err) {
  primaryError = err;
} finally {
  // ...the three independently-guarded cleanup steps (temp dir, tracked s3 keys, docker rm -f);
  //    a non-"No such container" docker failure is console.error'd and stored in teardownError...
}
if (primaryError) throw primaryError;
if (teardownError) throw teardownError;
```

This removes the `contractSucceeded` boolean entirely: `primaryError` is assigned-then-read (no useless
assignment), the primary error is rethrown first (takes precedence), and a teardown error is thrown only
when there was no primary error — identical behaviour to the approved F3, minus the lint error.

## Must NOT change
- Edit ONLY `apps/api/src/lib/storage.test.ts`.
- Do NOT weaken, remove, or reorder any assertion (F1 independent HeadObject probe, distinct keys, list
  membership, byte-identical get, scoped delete, both post-delete get-reject, both-backends tally,
  buildConfig no-`process.env`-spread, `.ts`/`import type` conventions, single visible SKIP when unset).
- Keep all cleanup independently guarded (F2) and the AbortSignal-bounded health poll (F4).
- Do NOT delete the S3 bucket; do not touch `compass-files`; never log credentials.

## Commands (capture literal output + exit codes)
1. `npm run lint` (root) — MUST now be exit 0. If any other lint error remains, quote it and its file.
2. `node --test apps/api/src/lib/storage.test.ts` (flag UNSET) — 1 skipped, exit 0.
3. `RUN_STORAGE_CONTRACT_TEST=1 node --test apps/api/src/lib/storage.test.ts` — self-provision, PASS,
   exit 0 (confirms the restructure didn't break the contract or the independent HeadObject probe).
4. `RUN_STORAGE_CONTRACT_TEST=1 S3_TEST_ENDPOINT=http://127.0.0.1:1 S3_TEST_ACCESS_KEY=x
   S3_TEST_SECRET_KEY=xxxxxxxx node --test apps/api/src/lib/storage.test.ts` — FAIL, non-zero exit, and
   confirm the primary `ECONNREFUSED` error still propagates (not masked by teardown).
5. `npm run typecheck -w apps/api` — exit 0.

Note: another task (1.7) may also be editing test files in this workspace concurrently; if `npm run lint`
shows an error in a file OTHER than `storage.test.ts`, report it but do not touch it — it is not yours.

## Required Evidence
- `git status --short` (only `apps/api/src/lib/storage.test.ts` is your change).
- the complete diff of your change (should be a small local restructure of the try/finally error handling).
- each command's exact invocation, literal output, counts, exit code.
- explicit confirmation lint is exit 0 and the dead-endpoint run still fails with the primary error.
- any blocker reported literally. Do NOT commit.
