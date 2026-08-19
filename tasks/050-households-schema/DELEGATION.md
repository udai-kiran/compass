# Sonnet Worker Delegation — Iteration 1

## Task
050 — Households schema + membership (task board 4.2)

## Approved Plan
Implement P1–P2 (schema + shared Zod schemas only).

- P1: Create `modules/household/schema.ts` with 3 tables + 1 enum
- P2: Create shared Zod schemas in `packages/shared`

## Files and Symbols

### Create
- `apps/api/src/modules/household/schema.ts`
- `packages/shared/src/schemas/household.ts`

### Modify
- `apps/api/src/db/schema.ts` — re-export household tables + enum
- `packages/shared/src/index.ts` — re-export household schemas

## Required Changes

### 1. Create `apps/api/src/modules/household/schema.ts`

Import from `../../db/core-schema.ts` for `users`.

**Enum:**
```ts
export const householdRole = pgEnum("household_role", ["owner", "member"]);
```

**Table: `households`**
```ts
export const households = pgTable("households", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdByUserId: uuid("created_by_user_id")
    .notNull()
    .references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
```

**Table: `householdMembers`**
```ts
export const householdMembers = pgTable(
  "household_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: householdRole("role").notNull().default("member"),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("household_members_unique_idx").on(t.householdId, t.userId),
    index("household_members_user_idx").on(t.userId),
  ],
);
```

**Table: `householdInvites`**
```ts
export const householdInvites = pgTable(
  "household_invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    invitedByUserId: uuid("invited_by_user_id")
      .notNull()
      .references(() => users.id),
    token: text("token").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedByUserId: uuid("accepted_by_user_id")
      .references(() => users.id),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("household_invites_token_idx").on(t.token)],
);
```

### 2. Update `db/schema.ts`
Add re-exports:
```ts
export {
  households,
  householdMembers,
  householdInvites,
  householdRole,
} from "../modules/household/schema.ts";
```

### 3. Create `packages/shared/src/schemas/household.ts`

```ts
import { z } from "zod";

export const HouseholdRoleSchema = z.enum(["owner", "member"]);
export type HouseholdRole = z.infer<typeof HouseholdRoleSchema>;

export const HouseholdSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  createdByUserId: z.uuid(),
  createdAt: z.coerce.date(),
});
export type Household = z.infer<typeof HouseholdSchema>;

export const CreateHouseholdSchema = z.object({
  name: z.string().min(1).max(100),
});
export type CreateHousehold = z.infer<typeof CreateHouseholdSchema>;

export const UpdateHouseholdSchema = z.object({
  name: z.string().min(1).max(100).optional(),
});
export type UpdateHousehold = z.infer<typeof UpdateHouseholdSchema>;

export const HouseholdMemberSchema = z.object({
  id: z.uuid(),
  householdId: z.uuid(),
  userId: z.uuid(),
  displayName: z.string(),
  role: HouseholdRoleSchema,
  joinedAt: z.coerce.date(),
});
export type HouseholdMember = z.infer<typeof HouseholdMemberSchema>;

export const HouseholdInviteSchema = z.object({
  id: z.uuid(),
  householdId: z.uuid(),
  token: z.string(),
  expiresAt: z.coerce.date(),
  accepted: z.boolean(),
  createdAt: z.coerce.date(),
});
export type HouseholdInvite = z.infer<typeof HouseholdInviteSchema>;

export const AcceptInviteSchema = z.object({
  token: z.string().min(1),
});
export type AcceptInvite = z.infer<typeof AcceptInviteSchema>;
```

### 4. Update `packages/shared/src/index.ts`
Add: `export * from "./schemas/household.ts";`

## Must Not Change
- No service or route files (iteration 2)
- No app.ts registration (iteration 2)
- No backup.ts changes (iteration 2)
- No migration generation yet

## Acceptance Criteria
- Schema file exists with all 3 tables + 1 enum
- Shared Zod schemas exist and are re-exported
- `db/schema.ts` re-exports household tables
- `npm run typecheck` passes (exit 0)

## Commands
1. `npm run typecheck` — must exit 0

## Required Evidence
- Files changed (list)
- `npm run typecheck` exit code
- Any blockers or deviations
