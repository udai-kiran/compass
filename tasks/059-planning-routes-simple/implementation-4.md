# Implementation 4 — Task 059 final targeted fix

## Files inspected
- `apps/api/src/modules/planning/services/income-surplus.ts` (full)
- `apps/api/src/modules/planning/routes/planning-analysis.route.test.ts` (full)
- `apps/api/src/modules/credit/routes/revolving-debt.route.test.ts` (full)
- `apps/api/src/modules/planning/routes/planning.route.test.ts` (cleanupUser pattern reference)
- `apps/api/drizzle/0000_nosy_lizard.sql` (FK constraint lines ~701–797)

## Files changed
- `apps/api/src/modules/planning/routes/planning-analysis.route.test.ts`
- `apps/api/src/modules/credit/routes/revolving-debt.route.test.ts`

---

## DEFECT 1: historyMonths assertions

### What income-surplus.ts actually does

Line 69: `const historyMonths = months.length;`
Lines 170–175: The service fills ALL lookbackMonths (default 12) slots, including zero-income months:
```
for (let i = 0; i < lookbackMonths; i++) {
  const key = addMonths(startMonth, i);
  rawMonths.push({ month: key, incomePaise: incomeByMonth.get(key) ?? 0 });
}
```
Therefore historyMonths === 12 for EVERY user (empty or not) when the default lookbackMonths=12 is used.
The previous `assert.equal(bodyB.historyMonths, 0, ...)` would always fail against Postgres.
The previous `assert.ok(bodyA.historyMonths > 0, ...)` was vacuously true (12 > 0) and uninformative.

### Fix applied

Replaced the two incorrect assertions with correct `assert.equal(_, 12, ...)` calls that document
the service contract (historyMonths == requested window size, not data volume). The genuinely
meaningful isolation assertions (`bodyA.months.find(incomePaise===amount)` and
`bodyB.months.find(incomePaise>0)===undefined`) were left untouched.

Corrected two comments at the same site that repeated the false "historyMonths>0" / "zero history" claim.

Specific changes to planning-analysis.route.test.ts:
1. Comment at ~line 210: "historyMonths > 0" → "historyMonths is always 12 (the full requested window)"
2. Line ~239: `assert.ok(bodyA.historyMonths > 0, ...)` → `assert.equal(bodyA.historyMonths, 12, ...)`
3. Comment at ~line 254: "historyMonths is still 12 (the requested window size, not data volume)"
4. Line ~257: `assert.equal(bodyB.historyMonths, 0, ...)` → `assert.equal(bodyB.historyMonths, 12, ...)`

---

## DEFECT 2: FK teardown violations

### FK constraints verified from migration SQL

Tables that insert in these tests, with their `user_id` FK:
- `accounts.user_id → users ON DELETE no action` (line 768)
- `transactions.user_id → users ON DELETE no action` (line 792)
- `card_details.user_id → users ON DELETE no action` (line 717)
- `statement_reconciliations.user_id → users ON DELETE no action` (line 786)

Cascade relations that matter for ordering:
- `postings.transaction_id → transactions ON DELETE cascade` (line 789) — deleting a transaction cascades its postings
- `postings.account_id → accounts ON DELETE no action` (line 790) — cannot delete account while postings exist
- `card_details.account_id → accounts ON DELETE cascade` (line 716) — deleting account cascades card_details
- `statement_reconciliations.account_id → accounts ON DELETE cascade` (line 787)

### Reference pattern

`planning.route.test.ts` (existing test) explicitly deletes child tables before user:
```typescript
async function cleanupUser(userId: string): Promise<void> {
  await app.db.delete(goals).where(eq(goals.userId, userId));
  await app.db.delete(budgets).where(eq(budgets.userId, userId));
  await app.db.delete(users).where(eq(users.id, userId));
}
```

### Fix applied to planning-analysis.route.test.ts

Correct delete order:
1. transactions (where userId) → postings cascade via FK (postings.account_id no-action is satisfied because postings are gone)
2. statementReconciliations (where userId) — user_id is no action; account_id cascade would also handle them if accounts were deleted first, but explicit is safer
3. accounts (where userId) — now safe: no postings remain
4. users (where id)

```typescript
async function cleanupUser(userId: string): Promise<void> {
  const { eq } = await import("drizzle-orm");
  // FK-safe teardown. accounts.user_id and transactions.user_id are ON DELETE no action —
  // child rows must be removed before the user row. Postings cascade automatically from
  // transactions (postings.transaction_id → transactions ON DELETE cascade), so deleting
  // transactions is sufficient to clear postings.
  await app.db.delete(transactions).where(eq(transactions.userId, userId));
  await app.db.delete(statementReconciliations).where(eq(statementReconciliations.userId, userId));
  await app.db.delete(accounts).where(eq(accounts.userId, userId));
  await app.db.delete(users).where(eq(users.id, userId));
}
```

### Fix applied to revolving-debt.route.test.ts

Correct delete order:
1. statementReconciliations (where userId) — user_id is no action
2. cardDetails (where userId) — user_id is no action
3. accounts (where userId) — now safe
4. users (where id)

```typescript
async function cleanupUser(userId: string): Promise<void> {
  const { eq } = await import("drizzle-orm");
  // FK-safe teardown. accounts.user_id, card_details.user_id, and
  // statement_reconciliations.user_id are all ON DELETE no action — child rows
  // must be removed before the user row.
  await app.db.delete(statementReconciliations).where(eq(statementReconciliations.userId, userId));
  await app.db.delete(cardDetails).where(eq(cardDetails.userId, userId));
  await app.db.delete(accounts).where(eq(accounts.userId, userId));
  await app.db.delete(users).where(eq(users.id, userId));
}
```

---

## Commands run

### 1. typecheck
```
npm run typecheck ; echo "EXIT=$?"
EXIT=0
```
All 7 workspaces pass.

### 2. lint
```
npm run lint ; echo "EXIT=$?"
EXIT=0
```

### 3. route-snapshot test
```
node --test apps/api/src/app.route-snapshot.test.ts 2>&1 | tail -10
```
Output: 7 tests, 7 pass, 0 fail. EXIT 0.

### 4. snapshot line count
```
wc -l apps/api/src/route-surface.snapshot.txt
319 apps/api/src/route-surface.snapshot.txt
```
Exactly 319 lines. ✓

### 5. full test suite
```
npm run test > /tmp/059g-test.txt 2>&1 ; echo "EXIT=$?" ; tail -70 /tmp/059g-test.txt
EXIT=1
```
Counts across workspaces:
- apps/api: 799 tests, 771 pass, 27 fail, 1 skipped
- extractor: 74 tests, 73 pass, 1 fail
- ingestor: 12 tests, 12 pass, 0 fail
- web: 270 tests, 270 pass, 0 fail
- ai: 32 tests, 32 pass, 0 fail
- shared: 212 tests, 212 pass, 0 fail
- **Total: 1399 tests, 1370 pass, 28 fail, 1 skipped**

The 28 failures break down as:
- 26 pre-existing DATABASE_URL-gated tests (app.test.ts, automation, card-due-tasks, emis, reconciliation-writes, rewards, ingest route, inbox, networth, sip-installments, ledger-events, user-tasks route, epf-contributions, postings-balance-parity, postings-pr-e-parity, reconcile-postings, recurring, user-tasks service, planning, projection-settings route, postings-planning-parity, projection-settings service, protection, system route, backup, extractor DB test)
- 2 new AC4b DATABASE_URL-gated files: planning-analysis.route.test.ts and revolving-debt.route.test.ts

This matches the brief's expectation of ~1399/1370/28/1.

### 6. Literal diff

Both files are untracked (new, not previously committed). `git diff` shows nothing. Verified final state by reading lines 77–90 of each file and lines 211–262 of planning-analysis.route.test.ts above.

---

## Assumptions

- `historyMonths` is always equal to `lookbackMonths` (12) because the service fills all months unconditionally (lines 170–175 of income-surplus.ts confirmed). This was verified by direct source reading, not test execution.
- The FK constraints in `0000_nosy_lizard.sql` are the authoritative schema. No later migration overrides these ON DELETE behaviors for the affected tables (confirmed by checking the migration file).

## Unresolved risks

- The DATABASE_URL-gated tests (planning-analysis.route.test.ts, revolving-debt.route.test.ts) cannot be run in this environment. The FK teardown order is correct per the schema, but actual execution against Postgres is needed to confirm no additional FK dependencies were missed. All other tables inserted in the test fixtures (accounts, transactions, postings, cardDetails, statementReconciliations) have been accounted for.
- The `postings` table has no `user_id` column — it can only be cleaned via transaction cascade or a JOIN. The chosen approach (delete transactions first, letting postings cascade) is correct per the `ON DELETE cascade` constraint on `postings.transaction_id`.
