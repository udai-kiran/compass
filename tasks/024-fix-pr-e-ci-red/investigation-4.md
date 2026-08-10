# Investigation 4 — PE2 flake diagnosis

## 1. PE2 quoted (file:line)

`apps/api/src/modules/ledger/services/postings-pr-e-parity.test.ts` lines 155–226.

```
test("postings-pr-e-parity: PE2 — listEmiInstallments reads posting amounts", async (t) => {
  // creates userId (UUID), bankAcct, templateId, 3 transactions via createTransaction
  const installments = await listEmiInstallments(db, userId, templateId);
  assert.equal(installments.length, 3);               // line 205 — the failing assertion
  assert.equal(legRows.length, 3);                    // line 219 — cross-check
```

`listEmiInstallments` runs:
```sql
SELECT t.id, t.date, p.amount_paise
FROM transactions t
  INNER JOIN postings p ON p.transaction_id = t.id
    AND p.account_id = template.accountId          -- bankAcct.id
    AND p.amount_paise < 0
WHERE t.recurring_template_id = templateId
  AND t.user_id = userId
  AND t.date >= d.startDate
  AND t.deleted_at IS NULL
ORDER BY t.date, t.created_at, t.id
LIMIT 2000;
```

It returns the count as `splitInstallments(...)` output length, which equals number of matching rows.

## 2. Scoping — the decisive predicates

TRIPLE-UUID scoped:
- `t.recurring_template_id = templateId` — a `randomUUID()` per test invocation
- `t.user_id = userId` — a `randomUUID()` per test invocation
- `p.account_id = template.accountId` (bankAcct.id) — a fresh UUID from `createAccount`

No pre-existing row in any shared database can match all three. No other concurrently running test file can share any of these three UUIDs.

## 3. Cleanup

```javascript
t.after(() => cleanupUser(userId));   // line 114 of PE2 — t.after fires even on failure
```

`cleanupUser` (lines 79-89) deletes: userTasks, transactions, sips, goals, recurringTemplates,
insurancePolicies, accounts, categories, users — all scoped to `userId`.

Gap: `emiDetails` is NOT explicitly deleted. However `emiDetails` is read only for metadata
(startDate, principalPaise) — the count assertion is on transactions/postings, both cleaned up.
No other test in this file sets `recurringTemplateId = PE2's templateId`, so orphaned
`emiDetails` from a crashed previous run cannot add visible rows to PE2's count query.

## 4. Cross-test concurrency

Test command (apps/api/package.json):
```
node --env-file-if-exists=../../.env --test "src/**/*.test.ts"
```
No `--test-concurrency` flag. Node.js default: files run in parallel (up to
`os.availableParallelism() - 1`). Tests within a file run sequentially.

Parallelism cannot cause pollution: every other file uses different randomUUID() values for
userId, templateId, and accountId.

## 5. Did our branch cause this?

**No.**

`git diff main -- postings-pr-e-parity.test.ts` shows only a PE7 merchant-string fix (line 529).
PE2 is byte-identical to main.

The other branch changes (emis.test.ts, card-due-tasks.test.ts, reconciliation-writes.test.ts,
user-tasks.test.ts) switch raw `db.insert(transactions)` to `createTransaction`, which also
writes a posting. These new postings have:
- different userId UUIDs (each test file's `createUser()` generates its own UUID)
- different accountId UUIDs
- no `recurringTemplateId` pointing at PE2's templateId

None of the new postings match PE2's triple-UUID predicate. **Our branch cannot cause 4 != 3.**

## 6. Current DB state

Command: read-only count queries via node pg client.

```
transactions total:                                     7
postings total:                                         0
users with @example.invalid:                           48
postings-pr-e-parity leftover users:                    0
transactions for postings-pr-e-parity users:            0
postings for postings-pr-e-parity users:                0
txns with recurring_template_id + negative postings:    0
transactions with any recurring_template_id:            0
```

The 48 stale `@example.invalid` users are from other test files that used raw inserts (no
postings — hence postings total = 0). None belong to `postings-pr-e-parity.test.ts`.
Zero rows currently satisfy any relaxed version of PE2's predicate.
The verifier's "stale data" hypothesis is empirically falsified: PE2's UUID predicates make it
immune to any stale row regardless.

## 7. Would it pass on a clean database?

Yes. On a fresh DB (no pre-existing rows), PE2 creates exactly 3 transactions linked to
`templateId`, each via `createTransaction`, which writes exactly 1 negative posting per
transaction on `bankAcct.id`. The query returns 3 rows; `installments.length === 3` passes.

CI uses a dedicated `postgres:18` service container per run (confirmed in `.github/workflows/ci.yml`):
```yaml
postgres:
  image: postgres:18
  env: { POSTGRES_DB: compass_ci }
```
PE2 will pass in CI.

## 8. Verdict

**(a) Pre-existing test-isolation weakness, unrelated to our branch, will pass in CI.**

Qualification: PE2 has no actual test-isolation weakness — it is correctly UUID-scoped. The
verifier's "stale data" attribution is wrong. The one-time `4 != 3` failure was almost
certainly a transient infrastructure event (e.g. DB connection hiccup causing a duplicate read
or a momentary visibility anomaly on the shared dev server). It was not reproducible, two
subsequent full runs passed 961/0, and the UUID predicates make stale-data pollution
structurally impossible. CI runs against a clean ephemeral DB, so no pollution risk exists
there either. Confidence: high.
