# Verification-1: Roadmap 2.1 SP0 — Postings model

Date: 2026-08-06

## (a) Are the ONLY non-tasks/ changes exactly the three expected files?

**YES.** The three files that changed outside `tasks/` are:

| File | Git state |
|---|---|
| `packages/shared/src/money.ts` | `M` (modified tracked file) |
| `apps/api/src/modules/ledger/services/postings.ts` | `??` (new untracked file) |
| `apps/api/src/modules/ledger/services/postings.test.ts` | `??` (new untracked file) |

No other non-tasks/ files appear in `git status --short` or `git diff --stat`.
The remaining entries are all under `tasks/` (tracked modified and untracked).

---

## (b) Exit codes

| Command | Exit code |
|---|---|
| `git status --short` | 0 |
| `git diff --stat` | 0 |
| `git diff -- <three files>` | 0 |
| `npm run typecheck` | 0 |
| `npm run lint` | 0 |
| `node --test apps/api/src/modules/ledger/services/postings.test.ts` | 0 |
| `npm run test -w apps/api` | 0 |

---

## (c) Pass/fail/skip counts

### Command 5 — `node --test apps/api/src/modules/ledger/services/postings.test.ts`
```
ℹ tests 17
ℹ suites 0
ℹ pass 17
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 220.18004
EXIT:0
```

### Command 6 — `npm run test -w apps/api`
```
ℹ tests 903
ℹ suites 2
ℹ pass 902
ℹ fail 0
ℹ cancelled 0
ℹ skipped 1
ℹ todo 0
ℹ duration_ms 7348.18688
EXIT:0
```

---

## (d) Failures, warnings, and unexpected files

**Failures:** None. All tests pass.

**Warnings in test output:** One non-fatal Redis eviction-policy notice (pre-existing, not from this change):
```
IMPORTANT! Eviction policy is allkeys-lru. It should be "noeviction"
```
This appears in every api test run and is unrelated to the postings model.

**Lint warnings/errors:** None. `eslint .` exited 0 with no output.

**Typecheck:** All 7 workspaces pass (`@compass/api`, `@compass/docs`, `@compass/extractor`,
`@compass/ingestor`, `@compass/web`, `@compass/ai`, `@compass/shared`) — exit 0, no errors.

**Unexpected modified/untracked non-tasks/ files:** None.

---

## Command outputs (literal)

### `git status --short`
```
M packages/shared/src/money.ts
 M tasks/01.07-migrate-ingest.md
 M tasks/01.08-migrate-system.md
 M tasks/01.10-storage-backend-contract-tests.md
 M tasks/02.02-retire-transfer-links.md
 M tasks/02.03-splits-into-postings.md
 M tasks/02.04-service-conversion.md
 M tasks/02.05-api-compatibility.md
 M tasks/README.md
?? apps/api/src/modules/ledger/services/postings.test.ts
?? apps/api/src/modules/ledger/services/postings.ts
?? tasks/013-release-v1.97.0/commit-pr-final.md
?? tasks/015-statusline/
?? tasks/018-migrate-system/commit-log.md
?? tasks/020-cross-module-ports/release-log.md
?? tasks/021-postings-model/
?? tasks/BATCH-phase1-close.md
EXIT:0
```

### `git diff --stat`
```
 packages/shared/src/money.ts                  | 8 ++++++++
 tasks/01.07-migrate-ingest.md                 | 2 +-
 tasks/01.08-migrate-system.md                 | 2 +-
 tasks/01.10-storage-backend-contract-tests.md | 2 +-
 tasks/02.02-retire-transfer-links.md          | 2 ++
 tasks/02.03-splits-into-postings.md           | 2 ++
 tasks/02.04-service-conversion.md             | 2 ++
 tasks/02.05-api-compatibility.md              | 2 ++
 tasks/README.md                               | 6 +++---
 9 files changed, 22 insertions(+), 6 deletions(-)
EXIT:0
```

### `git diff -- packages/shared/src/money.ts apps/api/src/modules/ledger/services/postings.ts apps/api/src/modules/ledger/services/postings.test.ts`

Note: `postings.ts` and `postings.test.ts` are **untracked** new files; they do not appear in `git diff`
(which only shows tracked-file changes). Only `money.ts` appears:

```diff
diff --git a/packages/shared/src/money.ts b/packages/shared/src/money.ts
index 6b9db9c..19a4efa 100644
--- a/packages/shared/src/money.ts
+++ b/packages/shared/src/money.ts
@@ -1,8 +1,16 @@
+import { z } from "zod";
+
 /**
  * Money is always handled as an integer number of minor units (paise).
  * Never store or compute money as floating-point rupees.
  */
 
+/**
+ * Zod schema for a safe integer paise amount.
+ * Rejects floats, NaN, Infinity, and values outside the safe integer range.
+ */
+export const SafePaiseSchema = z.number().int().refine(Number.isSafeInteger, "amount exceeds safe integer range");
+
 export function rupeesToPaise(rupees: number): number {
   return Math.round(rupees * 100);
 }
EXIT:0
```

### `npm run typecheck` (all workspaces)
```
> compass@0.1.0 typecheck
> npm run typecheck --workspaces --if-present

> @compass/api@0.1.0 typecheck
> tsc --noEmit

> @compass/docs@0.1.0 typecheck
> tsc --noEmit

> @compass/extractor@0.1.0 typecheck
> tsc --noEmit

> @compass/ingestor@0.1.0 typecheck
> tsc --noEmit

> @compass/web@0.1.0 typecheck
> tsc --noEmit

> @compass/ai@0.1.0 typecheck
> tsc --noEmit

> @compass/shared@0.1.0 typecheck
> tsc --noEmit

EXIT:0
```

### `npm run lint`
```
> compass@0.1.0 lint
> eslint .

EXIT:0
```
(No output — zero warnings, zero errors.)

### `node --test apps/api/src/modules/ledger/services/postings.test.ts`
```
✔ assertSafePaise rejects non-safe integers (3.576053ms)
✔ sumPaise sums exactly via BigInt and rejects unsafe results (0.533576ms)
✔ assertZeroSum: random balanced sets pass, perturbed sets throw (seeded PRNG) (10.542418ms)
✔ assertZeroSum: boundary legs near ±MAX_SAFE_INTEGER (0.4342ms)
✔ buildOrdinaryPostings: -200000 expense → asset -200000 + Expenses +200000 (1.299749ms)
✔ buildOrdinaryPostings: +300000 income → asset +300000 + Income -300000 (0.299773ms)
✔ buildSplitPostings: -200000 into -150000/-50000 → asset -200000 + Expenses +150000 + Expenses +50000 (0.44041ms)
✔ buildSplitPostings: mixed-sign splits pick the correct system accounts (0.467699ms)
✔ buildTransferPostings: 200000 → from -200000 / to +200000 (0.449319ms)
✔ buildTransferPostings: rejects non-positive amounts (0.480617ms)
✔ buildOpeningPostings: 500000 → asset +500000 / opening -500000 (0.296029ms)
✔ classifyShape + projections round-trip: ordinary (0.536205ms)
✔ classifyShape + projections round-trip: split (0.363822ms)
✔ classifyShape + projections round-trip: mixed-sign split (0.215001ms)
✔ classifyShape + projections round-trip: opening (0.270584ms)
✔ classifyShape: transfer classifies as 'transfer' (0.403727ms)
✔ classifyShape: degenerate shapes throw (0.405932ms)
ℹ tests 17
ℹ suites 0
ℹ pass 17
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 220.18004
EXIT:0
```

### `npm run test -w apps/api` (tail)
```
✔ monthDay produces a valid YYYY-MM-DD for the requested day (1.110045ms)
✔ monthDay steps whole months back without day overflow (0.348881ms)
✔ monthKey is the YYYY-MM prefix and negative args go to the future (0.554422ms)
✔ toFamilyMember maps all fields correctly (3.482172ms)
✔ toFamilyMember does not leak userId/createdAt/updatedAt (0.446529ms)
✔ toFamilyMember passes through null fields (0.346656ms)
✔ UserProfileSchema accepts null dateOfBirth (1.82331ms)
✔ UserProfileSchema accepts ISO date string (1.05319ms)
✔ UserProfileSchema rejects non-ISO date (1.837636ms)
✔ UpdateUserProfileSchema is same as UserProfileSchema (0.346265ms)
✔ CreateFamilyMemberSchema applies null defaults (1.625391ms)
✔ UpdateFamilyMemberSchema rejects expectedCompletionYear out of range (2.172177ms)
✔ UpdateFamilyMemberSchema accepts expectedCompletionYear in range (0.701926ms)
✔ UpdateUserProfileSchema round-trips a dateOfBirth (0.363581ms)
✔ UpdateUserProfileSchema rejects an empty string for dateOfBirth (0.444295ms)
✔ UpdateUserProfileSchema accepts null to clear dateOfBirth (0.271341ms)
✔ User profile DOB save/reload flow: round-trip through service layer (1.35945ms)
✔ bucketFor: auth endpoints get the tight brute-force bucket (2.447889ms)
✔ bucketFor: mutations use the write bucket, reads the read bucket (0.371345ms)
✔ auth bucket is the strictest of the three (0.390626ms)
✔ hostOf: extracts hostname without port, null on garbage (0.411879ms)
ℹ tests 903
ℹ suites 2
ℹ pass 902
ℹ fail 0
ℹ cancelled 0
ℹ skipped 1
ℹ todo 0
ℹ duration_ms 7348.18688
EXIT:0
```

---

## Summary

The SP0 change is clean. Exactly three non-tasks/ files changed. All checks pass with no errors or
unexpected modifications. The 1 skipped test in the full api suite is pre-existing (unrelated to postings).
