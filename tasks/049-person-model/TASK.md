# Task: Person model (task board 4.1)

## Status
COMPLETE

## Progress
- P1-P6: Schema layer changes complete (persons.ts, hubs.ts, spines.ts, foundation.ts)
- P7: Migration generation in progress
- P8: Zod schemas updated (family.ts, ledger.ts, goals.ts, insurance.ts)
- P9: Services updated (accounts.ts, goals.ts, insurance.ts mappers)
- P10: Self-person guards in profile.ts (reject create/delete self)
- P11: Auto-create self person on registration (auth.ts)
- P12: Backup tables updated (ALL_TABLES, USER_TABLES, LINKED_TABLES)
- P13: Decomposition test updated (53 tables, 40 enums)
- P14: All test fixtures updated (holderId: null in 9 files)
- Typecheck: exit 0
- Lint: exit 0
- Tests: 1234 pass, 26 DB-gated, 0 logic failures

## Objective
Extend `family_members` into a stable person model that accounts,
policies, goals and nominees reference by ID — so a rename never breaks a
relationship. Every existing user gets an implicit "self" person.

## Root Cause
`accounts.holderName`, `insurancePolicies.nominee` and
`insurancePolicies.coveredMembers` are free-text strings. A name change
or duplicate silently breaks every cross-reference.

## Critical Architecture Decision
**`familyMembers` must move to a new `db/shared/persons.ts` shared layer.**
The schema DAG forbids shared layers from importing module schemas.
`accounts` (hubs.ts), `goals` (foundation.ts) and `insurancePolicies`
(spines.ts) all need FK columns pointing to `familyMembers`. These are
shared-layer tables that cannot import from `modules/system/schema.ts`.

New DAG: `core-schema → persons → foundation → hubs → recurring → spines → ledger`

`modules/system/schema.ts` loses the `familyMembers` table definition
and its 2 enums; it imports and re-exports them from `db/shared/persons.ts`
for backward compatibility. `db/schema.ts` barrel re-exports from
`db/shared/persons.ts` directly.

## Scope

### Schema layer move
- **NEW** `db/shared/persons.ts` — physically defines `familyRelationship`
  enum (with `"self"` added), `educationStage` enum, `familyMembers`
  table (with new `linkedUserId` column). Imports only `core-schema.ts`.
- `modules/system/schema.ts` — remove `familyMembers`, `familyRelationship`,
  `educationStage` definitions; import and re-export from
  `db/shared/persons.ts`
- `db/schema.ts` barrel — add `export * from "./shared/persons.ts"`;
  remove named re-exports of `familyMembers`/`familyRelationship`/
  `educationStage` from `modules/system/schema.ts`

### New FK columns on shared tables
- `db/shared/foundation.ts` — import `familyMembers` from `./persons.ts`;
  add `beneficiaryId` (nullable uuid FK → familyMembers, SET NULL)
  to `goals`
- `db/shared/hubs.ts` — import `familyMembers` from `./persons.ts`;
  add `holderId` (nullable uuid FK → familyMembers, SET NULL) to
  `accounts`
- `db/shared/spines.ts` — import `familyMembers` from `./persons.ts`;
  add `nomineePersonId` (nullable uuid FK → familyMembers, SET NULL) to
  `insurancePolicies`; add `policyCoveredPersons` junction table
  `(policyId FK, personId FK)` with composite PK

### Migration
- Drizzle-generated DDL for enum change, layer move, new columns, new table
- Data migration SQL: INSERT "self" `family_members` row for every existing
  user (name = display_name, relationship = 'self', linked_user_id = users.id)

### Backup
- `modules/system/services/backup.ts` — add `policy_covered_persons` to
  `ALL_TABLES` + `LINKED_TABLES`

### Shared Zod schemas (`packages/shared/src/schemas/`)
- `family.ts` — add `"self"` to `FamilyRelationshipSchema`; add
  `linkedUserId: z.uuid().nullable()` to `FamilyMemberSchema`
- `ledger.ts` — add `holderId: z.uuid().nullable()` to `AccountSchema`;
  add to `CreateAccountSchema` and `UpdateAccountSchema`
- `insurance.ts` — add `nomineePersonId: z.uuid().nullable()` and
  `coveredPersonIds: z.array(z.uuid())` to `InsurancePolicySchema`;
  add to create/update schemas
- `goals.ts` — add `beneficiaryId: z.uuid().nullable()` to `GoalSchema`;
  add to create/update schemas

### Services
- `modules/system/services/profile.ts` — `toFamilyMember` maps
  `linkedUserId`; `createFamilyMember` rejects `relationship: "self"`;
  `deleteFamilyMember` rejects deleting the self record
- `modules/system/services/auth.ts` or registration flow — auto-create
  "self" person on user registration
- `modules/ledger/services/accounts.ts` — map `holderId` in reads;
  accept `holderId` in create/update
- `modules/protection/services/insurance.ts` — map `nomineePersonId` and
  `coveredPersonIds` in reads; accept in create/update; keep populating
  text `nominee`/`coveredMembers` from person names for backward compat
- `modules/planning/` — map `beneficiaryId` on goals

### Frontend
- Types update automatically from shared schemas
- No new UI components (deferred to 4.6/4.7)

## Dependencies
- 1.9 (COMPLETE)

## Plan
- P1: Create `db/shared/persons.ts` — move familyMembers + enums from
  modules/system/schema.ts; add `"self"` to enum; add `linkedUserId`
- P2: Update `modules/system/schema.ts` to import/re-export from persons.ts
- P3: Update `db/schema.ts` barrel — re-export from persons.ts
- P4: Add `holderId` to accounts in `db/shared/hubs.ts`
- P5: Add `nomineePersonId` + `policyCoveredPersons` junction in
  `db/shared/spines.ts`
- P6: Add `beneficiaryId` to goals in `db/shared/foundation.ts`
- P7: Generate Drizzle migration; add data-migration SQL for self persons
- P8: Update shared Zod schemas (family.ts, ledger.ts, insurance.ts, goals.ts)
- P9: Update services to map new fields
- P10: Guard self-person: reject delete, reject creating relationship=self
- P11: Auto-create self person on user registration
- P12: Update backup.ts (ALL_TABLES + LINKED_TABLES)
- P13: Update db/schema.decomposition.test.ts if counts change
- P14: Fix any shared schema deepEqual tests that break

## Acceptance Criteria
- AC1: Every existing user has a "self" family_members row after migration
- AC2: `accounts.holderId`, `goals.beneficiaryId`,
  `insurancePolicies.nomineePersonId` exist and FK to `family_members.id`
- AC3: `policy_covered_persons` junction table exists
- AC4: Renaming a person never breaks any account/policy/goal reference
- AC5: Deleting the self person is rejected (400)
- AC6: Creating a member with `relationship: "self"` is rejected (400)
- AC7: Schema DAG preserved: persons.ts imports only core-schema;
  modules/system/schema.ts imports from persons.ts, not the reverse
- AC8: `backup.test.ts` passes (new table registered)
- AC9: `npm run typecheck`, `npm run lint`, `npm run test` exit 0

## Verification
- T1: npm run db:generate produces expected migration
- T2: npm run typecheck (exit 0)
- T3: npm run lint (exit 0)
- T4: npm run test (no new failures)
- T5: Manual review of migration SQL

## Non-Goals
- Full person-picker UI components (deferred to 4.6/4.7)
- Populating holderId from holderName for existing data (manual/optional)
- Removing text nominee/coveredMembers columns (kept for backward compat)
- Adding holderId to holdings (inherits from account's holder)
