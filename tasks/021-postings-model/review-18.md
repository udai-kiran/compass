## Blocking findings

1. **P3 introduces a 404 → 400 behavior regression when exactly one transaction is missing or out of tenant scope.**  
   In `transfers.ts`, the role remapping uses:

   ```ts
   const outRows = firstRows[0]?.id === outTransactionId ? firstRows : secondRows;
   const innRows = firstRows[0]?.id === inTransactionId ? firstRows : secondRows;
   ```

   If `firstRows` is empty but `secondRows` contains the other transaction, both `outRows` and `innRows` resolve to `secondRows`. Consequently, both `out` and `inn` are defined, the intended `404 "Transaction not found"` check is bypassed, and amount validation returns 400 instead.

   This violates the requirement that subsequent validation remain unchanged and causes an observable API regression. Resolve each role by matching across both query results, for example by finding the matching ID in `[firstRows[0], secondRows[0]]`.

2. **The NB1 regression test is vacuous with respect to the repaired-counter bug.**  
   The test at `reconcile-postings.test.ts` forces `replacePostings()` to throw from `assertOwnedCategory()` before it returns. In the previous buggy implementation, `repaired++` occurred only after:

   ```ts
   await replacePostings(...)
   ```

   Therefore this test would also report `repaired === 0` against the old implementation. It cannot detect moving `repaired++` outside the transaction callback and does not cover the actual failure window: callback succeeds, then transaction commit rejects.

   A valid regression test must make the transaction callback return successfully after performing a repair and then make the transaction promise reject at commit. This likely requires a controlled DB wrapper/mock around transaction completion; a callback-time shape or ownership error is not equivalent.

## Acceptance-criteria assessment

- **AC1:** Met by code inspection. `repaired` increments only after the awaited transaction promise resolves, so commit rejection cannot inflate it.
- **AC2:** Met. The comment explicitly disclaims source-row locking and snapshot stability.
- **AC3:** Partially met. Locks are acquired in deterministic lexicographic order, eliminating the reversed-role lock-order deadlock, but the role-remapping regression above is blocking.
- **AC4:** Not met. The five DB-backed tests are generally substantive, but the mandatory NB1 regression does not distinguish fixed from buggy behavior.
- **AC5:** Reported typecheck and lint runs passed, but this does not resolve the behavioral findings.
- **AC6:** Reported existing suites passed: postings 20/20 and backup 19/19.

Other reviewed constraints are satisfied within the A7 files: signatures are unchanged, money remains integer paise, and relative TypeScript imports include `.ts`. No reader/DTO/shared/web/schema edits are part of the stated A7 file set.

**Result: blocking; A7 is not clean and AC1–AC6 cannot yet be confirmed collectively.**