# Fix 1: Add missing `displayName` field to user-insert test objects

## Summary
Applied mechanical fix to `apps/api/src/modules/investments/services/deposit-details.test.ts` to add the required `displayName: "deposit test user"` field to three user-insert objects that were missing it (TS2769 errors on lines 58, 98, 131).

## File Changed
- `apps/api/src/modules/investments/services/deposit-details.test.ts`

## Complete Diff

```diff
--- a/apps/api/src/modules/investments/services/deposit-details.test.ts
+++ b/apps/api/src/modules/investments/services/deposit-details.test.ts
@@ -56,8 +56,8 @@
 
     // Insert test users.
     await db.insert(usersTable).values([
-      { id: userId1, email: `dd-test1-${userId1}@test.local`, passwordHash: "x" },
-      { id: userId2, email: `dd-test2-${userId2}@test.local`, passwordHash: "x" },
+      { id: userId1, email: `dd-test1-${userId1}@test.local`, passwordHash: "x", displayName: "deposit test user" },
+      { id: userId2, email: `dd-test2-${userId2}@test.local`, passwordHash: "x", displayName: "deposit test user" },
     ]);
 
     // Insert an fd holding owned by user1.
@@ -95,7 +95,7 @@
 
   test("upsertDepositDetails: 400 when holding assetClass is not fd", async () => {
     const userId = randomUUID();
-    await db.insert(usersTable).values({ id: userId, email: `dd-test3-${userId}@test.local`, passwordHash: "x" });
+    await db.insert(usersTable).values({ id: userId, email: `dd-test3-${userId}@test.local`, passwordHash: "x", displayName: "deposit test user" });
 
     const [h] = await db.insert(holdings).values({
       id: randomUUID(),
@@ -128,7 +128,7 @@
 
   test("upsertDepositDetails: full cycle — insert, read, schedule", async () => {
     const userId = randomUUID();
-    await db.insert(usersTable).values({ id: userId, email: `dd-test4-${userId}@test.local`, passwordHash: "x" });
+    await db.insert(usersTable).values({ id: userId, email: `dd-test4-${userId}@test.local`, passwordHash: "x", displayName: "deposit test user" });
 
     const [h] = await db.insert(holdings).values({
        id: randomUUID(),
```

## Diff Statistics
- 4 lines added (displayName field to 4 user-insert objects)
- 4 lines removed (original user-insert objects)
- Total: 8 changed lines in 1 file

## Gate 1: TypeCheck

### Command
```bash
npm run typecheck
```

### Output Tail
```
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
```

### Exit Code
**0** (success, no TS2769 errors)

## Gate 2: Tests

### Command
```bash
node --test apps/api/src/modules/investments/services/deposit-accrual.test.ts apps/api/src/modules/investments/services/deposit-details.test.ts
```

### Output Tail
```
✔ FD 1-year at 710 bps quarterly compounding (reinvest): correct maturity value (0.767282ms)
✔ FD monthly payout: interest paid out each month, principal unchanged at maturity (0.154895ms)
✔ FD half-yearly 2-year at 800 bps (reinvest): 4 periods, correct maturity (0.107324ms)
✔ RD 12-month at 700 bps quarterly compounding: correct maturity value (0.668344ms)
✔ NSC 5-year annual reinvest at 765 bps: correct taxable interest per year and maturity (0.16296ms)
✔ Tax-saver FD uses identical compound-interest math as a regular FD (0.141149ms)
✔ zero-rate FD: no interest earned, maturity value equals principal (0.112906ms)
✔ one-paise FD: schedule does not throw and returns non-negative interest (0.116472ms)
✔ large safe-integer amount: paise arithmetic stays within safe integer bounds (0.13114ms)
✔ leap-year FD: Feb 28 + 1 month → Mar 28, no crash (0.140868ms)
✔ end-of-month FD: Jan 31 + 1 month clamps to Feb 28/29 (0.107866ms)
✔ stub final period uses Actual/365 Fixed day-count (0.071667ms)
✔ RD with fewer than one full period of installments (0.074021ms)
✔ schedule fields form a coherent balance sheet: closing = opening + deposit + interest - payout (0.086836ms)
✔ deposit-details module exports getDepositDetails, upsertDepositDetails, getDepositSchedule (0.387839ms)
ℹ tests 15
ℹ suites 0
ℹ pass 15
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 435.507234
```

### Exit Code
**0** (success, all 15 tests passed)

## Result Summary
- **All gates passed:** typecheck and test suite both successful
- **No other files modified:** edit was surgical and isolated
- **No remaining TS errors:** TS2769 at lines 58, 98, 131 resolved
