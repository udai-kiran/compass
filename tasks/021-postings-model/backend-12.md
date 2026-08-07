All changes are confirmed correct. Here's the summary:

---

## Summary

### Fix 1 — `restore-user.ts` (narrow guard)

**Problem:** Both the fast-fail pre-check and the in-transaction re-check iterated `restorableTables()` filtered to `USER_TABLES`, which includes `categories`. A freshly registered user has seeded category rows, so every real user got a `409 "This account already has data"` — blocking all restores.

**Fix:** Introduced a `MUST_BE_EMPTY` constant (`["accounts", "transactions", "insurance_policies", "goals", "holdings"]`) that only checks genuine user-data tables. Both guard loops now iterate `MUST_BE_EMPTY` instead of the over-broad `restorableTables()/USER_TABLES` filter. The `countBlockingRows` helper (which already excludes `system_kind is not null` for `accounts`) is reused and unchanged.

### Fix 2 — `backup.test.ts` (test gap)

**Problem:** The A6 AC2 test only seeded `systemAccounts` on the fresh dest user, missing the `categories` rows that real registration also seeds. So the test never exercised the buggy code path.

**Fix:** Added `import { seedDefaultCategories } from "../../ledger/services/categories.ts"` and called `await seedDefaultCategories(db, destFresh)` alongside `seedSystemAccounts(db, destFresh)` on the fresh dest user. The restore still succeeds (proving the narrow guard works), and the separate non-system-account → 409 assertion is unchanged. Updated the test title to `"A6 AC2: a dest user with seeded categories + system accounts restores..."`.

### Verification

```
npm run typecheck -w apps/api   → exit 0 (clean)
npm run lint                    → exit 0 (clean)
node --test apps/api/.../backup.test.ts → 18/18 pass, 0 fail, 0 skip
```

The AC2 test with seeded categories now passes, confirming the guard correctly allows restores for users with seeded data while still blocking real non-system accounts.
