Implemented F7 and F8.

Files modified:

- `apps/api/src/modules/shopping/routes/cart-drafts.ts`
  - Replaced the edit route’s status `findFirst` check with an atomic `UPDATE cartDrafts … WHERE id/userId/status='draft' RETURNING`.
  - The update occurs at the start of the existing transaction, holding the row lock through item loading and updates. A missing returned row still yields the existing `400` response.

- `apps/api/src/modules/shopping/routes/cart-drafts.hermetic.test.ts`
  - Strengthened edit-route coverage: any status read now fails the test, and added a successful atomic-claim edit test.
  - Confirmed ordered and abandoned drafts remain rejected.

- `apps/web/src/routes/shopping/CartPage.tsx`
  - Added an effect to resync local quantity and unit state whenever persisted item props change.
  - Blur validation now rejects blank, non-numeric, non-integer, zero, and negative quantities; invalid input restores the persisted quantity/unit pair without mutation.
  - Unit changes also avoid persisting if the current quantity is invalid.
  - Preserved the existing null-quantity “Edit” button behavior.

Commands run:

- `node --experimental-test-module-mocks --test src/modules/shopping/routes/cart-drafts.hermetic.test.ts`
  - Passed: 9 tests, 0 failures.
- `npm run typecheck -w apps/api`
  - Passed.
- `npm run typecheck -w apps/web`
  - Passed.
- `npm run test -w apps/web`
  - Passed: 342 tests, 0 failures.
- `npm run lint`
  - Passed.
- `npm run build -w apps/web`
  - Passed.
- `git diff --check -- …`
  - Passed with no whitespace errors.

Issues, risks, or deviations:

- No component-level interaction test was added for the quantity editor because the current web test setup covers pure TypeScript helpers rather than rendered React interactions; the requested behavior is implemented and web typecheck, tests, lint, and build pass.
- The hermetic API test verifies that the old status-read path is not used, but—as documented in the task—it cannot validate the exact SQL predicate without a real PostgreSQL integration environment.