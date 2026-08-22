## High

No high-severity findings.

## Medium

### Blocking

1. Item edits can still race with acceptance.

[cart-drafts.ts](/work/personal/compass/apps/api/src/modules/shopping/routes/cart-drafts.ts:101) reads the draft status, then [updates the item separately](/work/personal/compass/apps/api/src/modules/shopping/routes/cart-drafts.ts:113). Under PostgreSQL’s default isolation, `POST /accept` can commit between those operations, after which the edit still changes an already ordered cart and recalculates its total at lines 136–143.

F3 correctly makes accept and abandon atomic, but residual P1’s “status guard on edit” is not concurrency-safe. This is a data-integrity regression risk.

2. The F3 tests do not prove that the status predicate exists.

The fake Drizzle chain in [cart-drafts.hermetic.test.ts](/work/personal/compass/apps/api/src/modules/shopping/routes/cart-drafts.hermetic.test.ts:91) ignores the actual `where(...)` expression and returns a row solely from `draftStatus`. Removing `eq(cartDrafts.status, "draft")` from production would leave all eight tests green.

This also violates the repository rule not to mock Drizzle/database chains. The verification report’s claim that these tests comprehensively verify F3 is therefore incorrect. A real-Postgres integration test, or at minimum a test seam that observes affected rows from the real predicate, is still required.

3. Quantity editing can visibly diverge from persisted data.

[CartPage.tsx](/work/personal/compass/apps/web/src/routes/shopping/CartPage.tsx:454) uses `parseInt` and falls back silently:

- Clearing the field leaves it visibly blank but sends nothing.
- Entering `1.5` persists `1` while the input continues showing `1.5`.
- Local `qty`/`unit` state at lines 444–445 is never synchronized when refreshed item props arrive.

That makes AC1’s editable quantity behavior unreliable. There is no test for invalid, fractional, rejected, or server-normalized input.

4. AC11/P7 is not complete.

Current runs passed typecheck, lint, all 342 web tests, the 8 hermetic route tests, and the web build. However, the supplied verification evidence records `npm run test -w apps/api` exiting 1 with 33 failures. Lack of a configured database may explain the failures, but it does not satisfy the required full verification gate—especially because repository policy expects real-database integration tests.

### Non-blocking

5. Most Review-4 UI fixes have no behavioral regression test.

[cart-view.test.ts](/work/personal/compass/apps/web/src/routes/shopping/cart-view.test.ts:125) directly covers F5. There is no component-level or extracted-decision test for:

- F1: all active items unpriced and `totalPaise === 0`
- F2: loading/error/success source-status rendering
- F4: one error toast only
- F6: null quantity initialization and disabled demo behavior
- Accept disabled for zero/all-removed items
- Demo mode disabling every mutation
- Loading/error/empty rendering
- Abandon-dialog keyboard behavior

The pure summary test at [cart-view.test.ts](/work/personal/compass/apps/web/src/routes/shopping/cart-view.test.ts:182) only covers “some unpriced,” not the condition that originally caused F1.

## Low

1. The abandon dialog does not meet the planned accessibility behavior.

Escape closes it by directly calling `setShowAbandonDialog(false)` at [CartPage.tsx](/work/personal/compass/apps/web/src/routes/shopping/CartPage.tsx:196), bypassing the focus-restoring cancel handler at lines 338–341. The dialog at lines 624–655 also does not trap focus. This was explicitly deferred in the task, so it is non-blocking, but remains a UI convention violation.

2. Several original P4 details remain omitted or intentionally simplified.

- Catalog loading shows “Unknown item,” not a skeleton: [CartPage.tsx](/work/personal/compass/apps/web/src/routes/shopping/CartPage.tsx:448).
- Catalog brands are never rendered.
- Multiple active drafts are all rendered rather than presented through a selector: lines 121–136. The task explicitly accepts this as a valid deferred UX choice.
- The UI identifies substitutions but does not state that reverting to the original is unavailable: lines 512–522.
- No explicit serviceability or EMI limitation is shown. These are documented task gaps, not blocking AC failures.

3. `useShoppingUnits()` is instantiated once per source group.

[CartPage.tsx](/work/personal/compass/apps/web/src/routes/shopping/CartPage.tsx:369) creates one query observer per group. TanStack Query deduplicates the request, so this is not a correctness problem, but fetching once in `CartPage` and threading the units down would be simpler.

4. Generate-button mutation markup is duplicated.

The same mutation and success callback occur at [CartPage.tsx](/work/personal/compass/apps/web/src/routes/shopping/CartPage.tsx:80) and lines 106–117. A shared handler would reduce drift risk, though the current behavior is correct.

## Iteration-3 F1–F6 status

| Item | Status | Evidence |
|---|---|---|
| F1 | Implemented | The banner is gated by total **or** unpriced count, and the disclosure is independently rendered at [CartPage.tsx:224](/work/personal/compass/apps/web/src/routes/shopping/CartPage.tsx:224). Missing direct regression test. |
| F2 | Implemented | “Inactive” requires `sourcesStatus.isSuccess`; loading and error labels are handled at [CartPage.tsx:378](/work/personal/compass/apps/web/src/routes/shopping/CartPage.tsx:378). |
| F3 | Implemented in accept/abandon code | Both writes include ID, user, and `status="draft"` plus `RETURNING` at [cart-drafts.ts:70](/work/personal/compass/apps/api/src/modules/shopping/routes/cart-drafts.ts:70) and [cart-drafts.ts:155](/work/personal/compass/apps/api/src/modules/shopping/routes/cart-drafts.ts:155). Tests do not actually guard the predicate. |
| F4 | Implemented | Generate, accept, and abandon have success-only local callbacks at [CartPage.tsx:81](/work/personal/compass/apps/web/src/routes/shopping/CartPage.tsx:81), lines 183–194. Global mutation errors remain centralized. |
| F5 | Implemented and tested | Missing/nonexistent IDs resolve to the null group at [cart-view.ts:71](/work/personal/compass/apps/web/src/routes/shopping/cart-view.ts:71), covered at [cart-view.test.ts:125](/work/personal/compass/apps/web/src/routes/shopping/cart-view.test.ts:125). |
| F6 | Implemented | Null quantity hides the paired editor; “Edit” writes `1` and `"piece"` together at [CartPage.tsx:490](/work/personal/compass/apps/web/src/routes/shopping/CartPage.tsx:490) and lines 545–592. Missing direct test. |

## Plan P1–P7 status

| Plan item | Status |
|---|---|
| P1 backend endpoint/status guards | Partial: accept and abandon are atomic; edit has a status check but remains raceable. Route registration/snapshot exists. |
| P2 query hooks | Implemented at [shopping-queries.ts:357](/work/personal/compass/apps/web/src/lib/shopping-queries.ts:357). Invalidation and 204 handling are correct. |
| P3 pure view-model helpers | Implemented and broadly unit-tested. |
| P4 full Cart page | Substantially implemented; quantity validation/synchronization is defective, with the accepted/deferred UX and accessibility gaps listed above. |
| P5 sidebar badge | Implemented at [AppLayout.tsx:157](/work/personal/compass/apps/web/src/layouts/AppLayout.tsx:157) using the shared cart-draft cache. |
| P6 tests | Partial: pure helpers and route outcomes exist, but F3’s test seam cannot detect predicate removal and most UI ACs are untested. |
| P7 verification | Partial: typecheck, lint, web tests, focused API tests, and web build pass; the required full API suite has not passed. |

## Original AC1–AC11 status

| AC | Status |
|---|---|
| AC1 editable quantity/unit and provenance | Partial: provenance and paired null initialization work; normal quantity input has stale/invalid-state bugs. Brand is omitted. |
| AC2 source grouping/logistics | Implemented when source data is available; unknown/error degradation is honest. |
| AC3 guards before accept/unpriced disclosure | Implemented within documented endpoint limitations. F1 is resolved. |
| AC4 source-labelled, formatted prices/staleness | Implemented for item prices using `formatINR` and the draft-generation caveat. |
| AC5 advisory-only language | Implemented; no buy/order affordance. |
| AC6 remove/undo, abandon, generate | Implemented. Substitution reversion remains unavailable and is not explained in the UI. |
| AC7 sidebar count | Implemented. |
| AC8 loading/error/empty states | Implemented for the draft list; secondary queries degrade inline. Catalog-loading skeleton remains deferred. |
| AC9 demo mode | Implemented in the rendered mutation controls, but untested. |
| AC10 accept transitions to ordered | Implemented with user/status-scoped conditional update. |
| AC11 complete verification | Not met: the full API suite has not passed. |

Overall, F1–F6 are present in the current source, but the task is not ready to merge under the repository’s completion rules. The blocking work is an atomic edit-status guard, trustworthy persistence testing, quantity-editor correction, and a passing full API gate.