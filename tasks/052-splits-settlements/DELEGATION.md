# Sonnet Worker Delegation — Task 052: Splits, shares & settle-up

## Task
052 — Add split tables, pure math functions, and split/settlement services to the household module.

## Approved Plan
- P1: Add `splitRule` enum + 3 tables (`splits`, `splitShares`, `settlements`) to `apps/api/src/modules/household/schema.ts` (at the end, after `sharingGrants`)
- P2: Re-export new symbols from `apps/api/src/db/schema.ts`; update barrel comment to 57 tables, 42 enums
- P3: Update `apps/api/src/modules/system/services/backup.ts`: add `splits`, `split_shares`, `settlements` to ALL_TABLES; add `splits: "created_by_user_id"` to USER_TABLES; add `split_shares: { fk: "split_id", parent: "splits" }` and `settlements: { fk: "household_id", parent: "households" }` to LINKED_TABLES
- P4: Update `apps/api/src/db/schema.decomposition.test.ts`: add `splitRule`, `splits`, `splitShares`, `settlements` to `householdResidents`; update the count assertion from 54→57 tables and 41→42 enums
- P5: Create `apps/api/src/modules/household/services/split-math.ts` with pure functions: `computeEqualShares`, `computeProportionalShares`, `validateExactShares`
- P6: Create `apps/api/src/modules/household/services/split-math.test.ts` covering: equal splits (remainder determinism), proportional splits (largest-remainder), exact validation (correct/incorrect sums)
- P7: Create `apps/api/src/modules/household/services/splits.ts` (createSplit, deleteSplit)
- P8: Create `apps/api/src/modules/household/services/settlements.ts` (createSettlement, listSettlements, getHouseholdBalances)

## Files and Symbols

### Modify
- `apps/api/src/modules/household/schema.ts` — add at end: `splitRule` pgEnum, `splits` table, `splitShares` table, `settlements` table
- `apps/api/src/db/schema.ts` — add named exports: `splitRule`, `splits`, `splitShares`, `settlements`; update comment: 57 tables, 42 enums
- `apps/api/src/modules/system/services/backup.ts` — ALL_TABLES, USER_TABLES, LINKED_TABLES updates
- `apps/api/src/db/schema.decomposition.test.ts` — householdResidents set + count assertions

### Create
- `apps/api/src/modules/household/services/split-math.ts`
- `apps/api/src/modules/household/services/split-math.test.ts`
- `apps/api/src/modules/household/services/splits.ts`
- `apps/api/src/modules/household/services/settlements.ts`

## Required Changes

### 1. household/schema.ts — add at the END (after sharingGrants)

Import additions needed at the top:
- `bigint` from drizzle-orm/pg-core (already imported in schema: check and add if missing)
- `familyMembers` from `../../db/shared/persons.ts`
- from shared/ledger or spines: `transactions` — check what the transaction table is called and where. Look at existing service files to find the import path for `transactions`.

New enum:
```ts
export const splitRule = pgEnum("split_rule", ["equal", "shares", "exact"]);
```

New tables:
```ts
export const splits = pgTable("splits", {
  id: uuid("id").primaryKey().defaultRandom(),
  transactionId: uuid("transaction_id")
    .notNull()
    .unique()
    .references(() => transactions.id, { onDelete: "cascade" }),
  householdId: uuid("household_id")
    .notNull()
    .references(() => households.id, { onDelete: "cascade" }),
  rule: splitRule("rule").notNull(),
  createdByUserId: uuid("created_by_user_id")
    .notNull()
    .references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const splitShares = pgTable(
  "split_shares",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    splitId: uuid("split_id")
      .notNull()
      .references(() => splits.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => familyMembers.id, { onDelete: "cascade" }),
    sharePaise: bigint("share_paise", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("split_shares_split_idx").on(t.splitId)],
);

export const settlements = pgTable(
  "settlements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    fromPersonId: uuid("from_person_id")
      .notNull()
      .references(() => familyMembers.id, { onDelete: "cascade" }),
    toPersonId: uuid("to_person_id")
      .notNull()
      .references(() => familyMembers.id, { onDelete: "cascade" }),
    amountPaise: bigint("amount_paise", { mode: "number" }).notNull(),
    transferTransactionId: uuid("transfer_transaction_id")
      .references(() => transactions.id, { onDelete: "set null" }),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("settlements_household_idx").on(t.householdId)],
);
```

IMPORTANT: Find the correct import for `transactions`. Look at `apps/api/src/db/shared/ledger.ts` or `apps/api/src/db/shared/hubs.ts` to find where `transactions` is defined. It's likely in `db/shared/ledger.ts`. Import it from the correct shared layer file — NOT from db/schema.ts (no barrel imports in schema files).

### 2. db/schema.ts — add to the household block

```ts
export {
  households,
  householdMembers,
  householdInvites,
  householdRole,
  sharingGrants,
  sharingResourceType,
  splitRule,
  splits,
  splitShares,
  settlements,
} from "../modules/household/schema.ts";
```

Update the comment: `57 tables (56 domain + users) and 42 enums`.

### 3. backup.ts — three edits

ALL_TABLES: Add `"splits"`, `"split_shares"`, `"settlements"` to the array (place after `"sharing_grants"`).

USER_TABLES: Add `splits: "created_by_user_id"` after `sharing_grants: "owner_user_id"`.

LINKED_TABLES: Add:
```ts
split_shares: { fk: "split_id", parent: "splits" },
settlements: { fk: "household_id", parent: "households" },
```

### 4. schema.decomposition.test.ts

Update `householdResidents`:
```ts
const householdResidents = new Set([
  "households", "householdMembers", "householdInvites",
  "householdRole", "sharingGrants", "sharingResourceType",
  "splits", "splitShares", "settlements", "splitRule",
]);
```

Update the count assertion:
```ts
assert.equal(tables.length, 57, `expected 57 tables, got ${tables.length}: ${tables.join(", ")}`);
assert.equal(enums.length, 42, `expected 42 enums, got ${enums.length}: ${enums.join(", ")}`);
```

Also update the comment above the test: `// T3c: barrel exports exactly 57 tables + 42 enums + users, no duplicates`.

### 5. split-math.ts

Pure functions, no DB, no imports from Drizzle:

```ts
/**
 * Pure split-math functions. No DB access, no side effects.
 * All amounts are integer paise.
 */

/**
 * Split totalPaise equally among memberCount people.
 * Remainder (totalPaise % memberCount) paise go to the FIRST N members.
 * Returns an array of length memberCount that sums to totalPaise.
 */
export function computeEqualShares(totalPaise: number, memberCount: number): number[] {
  if (memberCount <= 0) throw new Error("memberCount must be > 0");
  const base = Math.floor(totalPaise / memberCount);
  const remainder = totalPaise % memberCount;
  return Array.from({ length: memberCount }, (_, i) => base + (i < remainder ? 1 : 0));
}

/**
 * Split totalPaise proportionally by ratios (positive integers).
 * Uses the largest-remainder method to ensure the output sums exactly to totalPaise.
 */
export function computeProportionalShares(totalPaise: number, ratios: number[]): number[] {
  if (ratios.length === 0) throw new Error("ratios must be non-empty");
  if (ratios.some((r) => r <= 0)) throw new Error("all ratios must be > 0");
  const total = ratios.reduce((a, b) => a + b, 0);
  const exact = ratios.map((r) => (r / total) * totalPaise);
  const floors = exact.map(Math.floor);
  const remainder = totalPaise - floors.reduce((a, b) => a + b, 0);
  // Distribute remainder paise to the members with largest fractional parts
  const fractionals = exact.map((e, i) => ({ i, frac: e - floors[i]! }));
  fractionals.sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; k < remainder; k++) {
    floors[fractionals[k]!.i]! += 1;
  }
  return floors;
}

/**
 * Validate that shares sum exactly to totalPaise.
 * Returns the shortfall (negative means overshoot).
 * Returns 0 if valid.
 */
export function validateExactShares(shares: number[], totalPaise: number): number {
  const sum = shares.reduce((a, b) => a + b, 0);
  return totalPaise - sum;
}
```

### 6. split-math.test.ts

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeEqualShares, computeProportionalShares, validateExactShares } from "./split-math.ts";

describe("computeEqualShares", () => {
  it("splits evenly when divisible", () => {
    const shares = computeEqualShares(300, 3);
    assert.deepEqual(shares, [100, 100, 100]);
  });

  it("gives remainder to first N members deterministically", () => {
    // 100 paise / 3 = 33, 33, 34 — remainder 1 paise to first member
    const shares = computeEqualShares(100, 3);
    assert.equal(shares.reduce((a, b) => a + b, 0), 100);
    assert.deepEqual(shares, [34, 33, 33]);
  });

  it("two members, odd amount", () => {
    const shares = computeEqualShares(101, 2);
    assert.equal(shares.reduce((a, b) => a + b, 0), 101);
    assert.deepEqual(shares, [51, 50]);
  });

  it("single member gets everything", () => {
    assert.deepEqual(computeEqualShares(999, 1), [999]);
  });

  it("always sums to totalPaise (property)", () => {
    for (const [total, count] of [[1, 7], [997, 3], [10000, 6], [1, 1]] as [number, number][]) {
      const shares = computeEqualShares(total, count);
      assert.equal(shares.reduce((a, b) => a + b, 0), total);
    }
  });

  it("throws on zero member count", () => {
    assert.throws(() => computeEqualShares(100, 0));
  });
});

describe("computeProportionalShares", () => {
  it("equal ratios same as equal split", () => {
    const shares = computeProportionalShares(100, [1, 1, 1]);
    assert.equal(shares.reduce((a, b) => a + b, 0), 100);
  });

  it("2:1 split", () => {
    const shares = computeProportionalShares(300, [2, 1]);
    assert.deepEqual(shares, [200, 100]);
  });

  it("always sums to totalPaise (property)", () => {
    const cases: [number, number[]][] = [
      [1000, [3, 1]],
      [997,  [1, 2, 3]],
      [1,    [1, 1, 1]],
      [100,  [7, 3]],
    ];
    for (const [total, ratios] of cases) {
      const shares = computeProportionalShares(total, ratios);
      assert.equal(shares.reduce((a, b) => a + b, 0), total, `failed for ${total}, [${ratios}]`);
    }
  });

  it("throws on empty ratios", () => {
    assert.throws(() => computeProportionalShares(100, []));
  });

  it("throws on non-positive ratio", () => {
    assert.throws(() => computeProportionalShares(100, [1, 0]));
  });
});

describe("validateExactShares", () => {
  it("returns 0 for valid shares", () => {
    assert.equal(validateExactShares([100, 200, 300], 600), 0);
  });

  it("returns positive shortfall when shares under-count", () => {
    assert.equal(validateExactShares([100, 100], 300), 100);
  });

  it("returns negative when shares overshoot", () => {
    assert.equal(validateExactShares([200, 200], 300), -100);
  });
});
```

### 7. splits.ts

```ts
import { eq } from "drizzle-orm";
import type { Db, Tx } from "../../../db/index.ts";
import { splits, splitShares } from "../schema.ts";
import { computeEqualShares, computeProportionalShares, validateExactShares } from "./split-math.ts";
import { transactions } from "../../../db/shared/ledger.ts";
import { familyMembers } from "../../../db/shared/persons.ts";

// ... (types + implementation — see below)
```

For the implementation of `createSplit`: 
- Accept: db, userId, input: { transactionId, householdId, rule, memberPersonIds (for equal/proportional), sharePaise? (for exact), ratios? (for proportional) }
- Fetch the transaction to get its `amountPaise` (use `amountAbsPaise` or whatever the correct column is — check the transactions table schema in db/shared/ledger.ts)
- Compute shares using the appropriate function
- Validate shares sum
- In a transaction: insert `splits` row, then insert one `splitShares` row per person
- Return the created split

For `deleteSplit`:
- Verify the userId is the creator (createdByUserId)
- Delete the split (cascades to splitShares)

IMPORTANT: Check the actual column name for transaction amount in db/shared/ledger.ts before writing. It may be `amountPaise` or `amountAbsPaise`.

### 8. settlements.ts

```ts
// createSettlement(db, userId, input: { householdId, fromPersonId, toPersonId, amountPaise, note? })
// listSettlements(db, userId, householdId) — returns all settlements for the household
// getHouseholdBalances(db, userId, householdId) — computes net per-person balance
//   Balance model: for each split in the household, the payer (transaction owner) is "owed back"
//   their share by everyone else. For each splitShare row, the person owes sharePaise to the payer.
//   Settlements reduce balances. Net balance per person-pair is the sum of what they owe minus
//   what they've been paid back. Return: Record<personId, number> net paise (positive = owed money,
//   negative = owes money).
```

Keep the balance computation simple: sum all splitShares (person owes their share amount), then subtract settlements. The exact algorithm is not critical for this phase — correctness of the data structures matters more.

## Must Not Change
- Any existing service files in the household module (households.ts, membership.ts) — do not modify
- Any files in other modules
- `apps/api/src/lib/sharing.ts` — do not modify
- Any test files other than `split-math.test.ts` (new) and `schema.decomposition.test.ts` (count update)

## Acceptance Criteria
- AC1: `splitRule`, `splits`, `splitShares`, `settlements` exported from barrel
- AC2: backup.ts ALL_TABLES, USER_TABLES, LINKED_TABLES updated correctly
- AC3: schema.decomposition.test.ts updated to 57 tables, 42 enums
- AC4: split-math.ts exports `computeEqualShares`, `computeProportionalShares`, `validateExactShares`
- AC5: split-math.test.ts covers all 3 functions with edge cases
- AC6: splits.ts exports `createSplit`, `deleteSplit`
- AC7: settlements.ts exports `createSettlement`, `listSettlements`, `getHouseholdBalances`
- AC8: `npm run typecheck` exits 0

## Commands
1. Find where `transactions` is exported from: `grep -r "export.*transactions" apps/api/src/db/shared/`
2. Find the amount column name: `grep -n "amountPaise\|amountAbsPaise\|amount_paise\|amount_abs" apps/api/src/db/shared/ledger.ts`
3. After all files created: `cd /work/personal/compass && npm run typecheck 2>&1 | tail -30`
4. Run split-math tests: `cd /work/personal/compass && node --test apps/api/src/modules/household/services/split-math.test.ts 2>&1`
5. Run decomposition test: `cd /work/personal/compass && node --test apps/api/src/db/schema.decomposition.test.ts 2>&1`
6. Run backup test: `cd /work/personal/compass && node --test apps/api/src/modules/system/services/backup.test.ts 2>&1`

## Required Evidence
- Exact content of all 4 created files
- Complete diff of all modified files
- Output of `npm run typecheck` (literal, with exit code)
- Output of `node --test split-math.test.ts` (literal, with pass/fail counts)
- Output of `node --test schema.decomposition.test.ts` (literal)
- Output of `node --test backup.test.ts` (literal)
