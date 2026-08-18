# Dead Code / Health-Check Findings
Generated: 2026-08-14

---

## 1. Deprecated function with no production callers

**File:** `apps/api/src/modules/ledger/services/reconcile-postings.ts:106–110`

```ts
/**
 * @deprecated Remove all call sites; function will be deleted in a follow-up.
 */
export async function reprojectAllLegacyColumns(
  _db: Db,
): Promise<{ users: number; checked: number; repaired: number; failures: PostingProblem[] }> {
  return { users: 0, checked: 0, repaired: 0, failures: [] };
}
```

Command run:
```
grep -rn "reprojectAllLegacyColumns" apps/api/src/ --include='*.ts'
```

Results:
- `reconcile-postings.ts:106` — function definition (no-op stub)
- `reconcile-postings.test.ts:8,175,186,187,188,189,192` — test file only

**Finding:** Zero non-test callers. The function is a dead no-op stub. The test block at
`reconcile-postings.test.ts:175` ("idempotent — second call succeeds without error") tests
only a stub that always returns `{ failures: [] }` and is therefore vacuous. Both the function
and that test block are safe to delete.

---

## 2. Legacy column references — runtime vs. comment audit

Command run:
```
grep -rn 'is_opening|isOpening|transaction_splits|transfer_links|transactionSplits|transferLinks' \
  apps/api/src/ --include='*.ts' | grep -v '\.test\.' | grep -v '//' | grep -v 'OMITTED_RESTORE' | grep -v 'schema.decomposition'
```

### 2a. `postings.ts` — doc comments only, no runtime references

Lines 230, 267, 268, 281, 361 in `apps/api/src/modules/ledger/services/postings.ts` all fall
inside JSDoc `/** ... */` blocks (lines start with ` * `). They are explanatory history, not
executable code. No action needed.

Similarly, doc-comment-only mentions appear in:
- `apps/api/src/modules/ledger/services/average-balance.ts:158`
- `apps/api/src/modules/ledger/services/post-entry.ts:89–90`
- `apps/api/src/modules/ledger/services/accounts.ts:34,70`
- `apps/api/src/modules/ledger/services/transfers.ts:55,232`
- `apps/api/src/modules/ledger/services/reconcile-postings.ts:100,117`

All in JSDoc. No runtime references to dropped columns in these files.

### 2b. `sip-installments.ts` — active, correct usage

`apps/api/src/modules/investments/services/sip-installments.ts:296` computes `is_opening`
via a SQL subquery against `postings` + `system_kind = 'opening'`; it does NOT read a
dropped DB column. The `isOpening` property in the TS interface (lines 84, 91, 311, 322)
reflects this derived value. This is correct code, not dead or stale.

### 2c. `restore.ts` — intentional tombstone

`apps/api/src/db/restore.ts:23`:
```ts
export const OMITTED_RESTORE_COLUMNS = {
  transactions: ["search", "is_opening"],
}
```
This entry silently drops the legacy `is_opening` column when restoring old per-user
archives that pre-date the PR-G2 drop. It is intentional and must be kept.

---

## 3. Unused imports of legacy symbols

Command run:
```
grep -rn 'import.*transactionSplits|import.*transferLinks|import.*legacyProjection' \
  apps/api/src/ --include='*.ts'
```

Result: **no matches**. No stale imports of any of these symbols anywhere in the codebase.

---

## 4. TODO / FIXME / HACK / XXX audit

Command run:
```
grep -rn 'TODO|FIXME|HACK|XXX' apps/api/src/ --include='*.ts'
```

Result: **0 matches** (confirmed by `wc -l` → `0`). The codebase is clean of these markers.

---

## 5. Empty and stub files

Commands run:
```
find apps/api/src/ -name '*.ts' -size 0
find apps/api/src/ -name '*.ts' -exec grep -l '^// stub$|^// placeholder$|^// TODO$' {} \;
```

Result: **no output from either command**. No zero-byte files and no stub-marker files exist.

---

## 6. Schema barrel consistency

File read: `apps/api/src/db/schema.ts`

The barrel claims: 49 tables (48 domain + `users`) and 38 enums, each exported exactly once.

Exports are structured as:
- `users` from `./core-schema.ts`
- `export *` from 5 shared-layer files (`foundation`, `hubs`, `recurring`, `spines`, `ledger`)
- Named exports from 7 module schemas: `system`, `ledger`, `credit`, `investments`, `protection`, `planning`, `ingest`, `automation`

No suspicious or duplicate exports are visible in the barrel. The comment header states the
count explicitly (49 tables, 38 enums) which serves as a self-documenting invariant. Actual
consistency of counts against source files was not verified (would require enumerating every
`pgTable()` call across all source files), but the structure appears well-maintained.

---

## Summary table

| # | Check | Result |
|---|-------|--------|
| 1 | `reprojectAllLegacyColumns` callers | **Dead stub** — definition + test block, zero production callers |
| 2 | Runtime legacy column refs (`is_opening` etc.) | **Clean** — all non-test matches are doc comments or correct new-schema derivations |
| 3 | Unused legacy imports | **None found** |
| 4 | TODO/FIXME/HACK/XXX | **0 occurrences** |
| 5 | Empty / stub files | **None found** |
| 6 | Schema barrel | **Appears consistent** — named exports, no obvious duplicates or missing modules |

---

## Recommended action

The only actionable dead-code item is `reprojectAllLegacyColumns`:

1. Delete the function body (lines 106–110 of `reconcile-postings.ts`).
2. Delete the corresponding test block in `reconcile-postings.test.ts` (the
   "idempotent" test starting at line 175, plus the import on line 8 if no other
   symbol from that import is used).

Everything else is either correct code, intentional tombstone data, or historical
documentation in comments.
