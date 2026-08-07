All checks pass. Here's a summary of what was changed:

**NEW file: `apps/api/src/modules/ledger/services/reconcile-postings.ts`**
- `postingsMultisetEqual(drafts, stored)` — private helper that compares two posting lists as multisets via `JSON.stringify` keyed on `[accountId, amountPaise, categoryId, necessity, note]`, returning `true` iff both sides have identical count maps.
- `reconcileUserPostings(db, userId)` — seeds system accounts, resolves them, then iterates ALL transactions (including soft-deleted) in a per-row `db.transaction` that compares computed drafts vs stored postings and calls `replacePostings` only on drift. Returns `{ checked, repaired, failures }` with per-row failure isolation.
- `reconcileAllPostings(db)` — iterates all users, aggregates per-user results, wraps each user in a try/catch so a single user's failure doesn't abort the rest.
- `findInconsistentPostings(db, userId?)` — **read-only** diagnostic: never seeds, never writes. Reports every user/transaction whose stored postings drift from the computed shape, or where system accounts are missing.

**Modified: `apps/api/src/app.ts`**
- Added import of `reconcileAllPostings` from the new module.
- Inserted the boot hook (`.catch()`-guarded, non-blocking) between `registerLedgerCacheSubscriber(app)` and `await startJobs(app)` — the quiescent window before any worker or HTTP traffic. Logs errors loudly if failures exist, logs info if repairs were made, and is silent (no log) when everything is already consistent.

**Verification:**
- `npm run typecheck -w apps/api` → exit 0
- `npm run lint` → exit 0 (no warnings)
- `node --test apps/api/src/modules/ledger/services/postings.test.ts` → 20/20 pass
- `node --test apps/api/src/db/schema.decomposition.test.ts` → 3/3 pass
