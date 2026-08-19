# Sonnet Worker Delegation — Iteration 1

## Task
049 — Person model (task board 4.1)

## Approved Plan
Implement P1–P6 (schema layer changes only, no service/Zod changes yet).

- P1: Create `db/shared/persons.ts`
- P2: Update `modules/system/schema.ts`
- P3: Update `db/schema.ts` barrel
- P4: Add `holderId` to accounts in hubs.ts
- P5: Add `nomineePersonId` + `policyCoveredPersons` in spines.ts
- P6: Add `beneficiaryId` to goals in foundation.ts

## Files and Symbols

### Create
- `apps/api/src/db/shared/persons.ts`

### Modify
- `apps/api/src/modules/system/schema.ts`
- `apps/api/src/db/schema.ts`
- `apps/api/src/db/shared/hubs.ts`
- `apps/api/src/db/shared/spines.ts`
- `apps/api/src/db/shared/foundation.ts`

## Required Changes

### 1. Create `apps/api/src/db/shared/persons.ts`
Move from `modules/system/schema.ts` to here:
- `familyRelationship` pgEnum — ADD `"self"` as first value
- `educationStage` pgEnum — unchanged
- `familyMembers` pgTable — ADD new column:
  ```ts
  linkedUserId: uuid("linked_user_id")
    .references(() => users.id, { onDelete: "set null" }),
  ```
  Add a unique index on `linkedUserId` (one-to-one: a user links to at most one person).

Import only from `../core-schema.ts`.

### 2. Update `modules/system/schema.ts`
Remove the definitions of `familyRelationship`, `educationStage`, `familyMembers`.
Replace with:
```ts
export { familyRelationship, educationStage, familyMembers } from "../../db/shared/persons.ts";
```
Keep all other tables (userProfiles, notifications, alertLedger, notificationPrefs).
The import of `users` from `../../db/core-schema.ts` stays (userProfiles needs it).
The import of `accounts` from `../../db/shared/hubs.ts` stays (notificationPrefs needs it).

### 3. Update `db/schema.ts`
Add: `export * from "./shared/persons.ts";`
Remove from the system module re-exports: `familyMembers`, `familyRelationship`, `educationStage` (they're now re-exported via persons.ts star export).

### 4. Add `holderId` to accounts in `db/shared/hubs.ts`
Add import: `import { familyMembers } from "./persons.ts";`
Add column to `accounts` after `holderName`:
```ts
holderId: uuid("holder_id").references(() => familyMembers.id, { onDelete: "set null" }),
```

### 5. Add `nomineePersonId` + junction in `db/shared/spines.ts`
Add import: `import { familyMembers } from "./persons.ts";`
Add column to `insurancePolicies` after `nominee`:
```ts
nomineePersonId: uuid("nominee_person_id").references(() => familyMembers.id, { onDelete: "set null" }),
```
Add new junction table after `insurancePolicies`:
```ts
export const policyCoveredPersons = pgTable(
  "policy_covered_persons",
  {
    policyId: uuid("policy_id")
      .notNull()
      .references(() => insurancePolicies.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => familyMembers.id, { onDelete: "cascade" }),
  },
  (t) => [
    // composite PK via unique index (Drizzle pgTable doesn't have compositePK directly, use primaryKey)
  ],
);
```
Use `primaryKey({ columns: [t.policyId, t.personId] })` if Drizzle supports it, otherwise a unique index.

### 6. Add `beneficiaryId` to goals in `db/shared/foundation.ts`
Add import: `import { familyMembers } from "./persons.ts";`
Add column to `goals` after `type`:
```ts
beneficiaryId: uuid("beneficiary_id").references(() => familyMembers.id, { onDelete: "set null" }),
```

## Must Not Change
- No service logic changes in this iteration
- No Zod schema changes in this iteration
- No migration generation yet (will be done after all schema changes)
- Do not modify any test files
- Do not modify backup.ts yet

## Acceptance Criteria
- The `db/shared/persons.ts` file exists with familyMembers + enums + linkedUserId
- `modules/system/schema.ts` imports and re-exports from persons.ts
- `db/schema.ts` barrel re-exports from persons.ts; no duplicate exports
- `accounts`, `goals`, `insurancePolicies` have the new FK columns
- `policyCoveredPersons` junction table exists
- `npm run typecheck` passes (exit 0)

## Commands
1. `npm run typecheck` — must exit 0

## Required Evidence
- Files changed (list)
- `npm run typecheck` exit code
- Any blockers or deviations from plan
