Here's a concise summary of what was changed:

## Changes made

### 1. NEW: `apps/api/src/modules/ledger/services/post-entry.ts` (183 lines)
Five exported functions implementing the transactional posting writer + system-account helpers:
- **`postEntry`** — wraps header+postings insert in `db.transaction`, calls `assertZeroSum` before writes, omits undefined header fields
- **`replacePostings`** — wraps delete+insert in `db.transaction`, calls `assertZeroSum` before writes
- **`updateTransactionHeader`** — header-only update (sets `updatedAt` + patched fields), never touches postings
- **`seedSystemAccounts`** — idempotent insert of three system accounts via `onConflictDoNothing` against the partial unique index
- **`resolveSystemAccounts`** — selects the three system-account IDs by kind, throws `HttpError(500)` if any missing

### 2. EDIT: `apps/api/src/modules/system/services/backup.ts`
- Added `"postings"` to `ALL_TABLES` immediately after `"transactions"` (FK-safe restore order)
- Added `postings: { fk: "transaction_id", parent: "transactions" }` to `LINKED_TABLES`
- Did NOT add to `USER_TABLES` (postings has no `user_id`)

### 3. EDIT: `apps/api/src/modules/system/services/auth.ts`
- Added `import { seedSystemAccounts }` from the new post-entry module
- Added `await seedSystemAccounts(tx, created.id)` in the registration transaction, after `seedDefaultCategories`

### Verification
- Did **not** run typecheck/lint/test per spec (tree is intentionally broken until B4)
- Did **not** run `db:generate` (B1a schema changes already applied; migration `0067_slim_blizzard.sql` already exists; no new schema changes in this slice)
- All three files verified by reading back and confirming correctness against the spec

### Deviations
- Used `isNotNull` (drizzle-orm) instead of the spec's listed `isNull` — `isNotNull` is needed for the `WHERE system_kind IS NOT NULL` query in `resolveSystemAccounts`; `isNull` was unused
- Renamed `replacePostings` second parameter to `replacements` to avoid shadowing the `postings` table import
