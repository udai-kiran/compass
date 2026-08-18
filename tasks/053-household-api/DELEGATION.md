# Sonnet Worker Delegation — Task 053: Household API routes

## Task
053 — Full REST API for households, membership, sharing grants, splits, and settlements.

## Approved Plan (reviewed by Codex in review-1.md)
- P0: Add missing Zod schemas to packages/shared/src/schemas/household.ts: SplitRuleSchema, SplitSchema, SplitShareSchema, CreateSplitSchema, UpdateSplitSchema, SettlementSchema, CreateSettlementSchema, HouseholdBalancesSchema
- P1: Create services/grants.ts — createGrant, revokeGrant, listGrants (all throw HttpError, not plain Error)
- P2: Add getSplit, updateSplit to services/splits.ts; change plain Error throws to HttpError(400) in createSplit/deleteSplit
- P3: Create routes/households.ts — POST/GET /api/households, GET/PATCH/DELETE /api/households/:id
- P4: Create routes/membership.ts — POST /api/households/:id/invite, GET /api/households/:id/members, DELETE /api/households/:id/members/:memberId, POST /api/households/:id/leave, POST /api/households/accept
- P5: Create routes/sharing.ts — POST /api/sharing-grants, GET /api/sharing-grants, DELETE /api/sharing-grants/:id
- P6: Create routes/splits.ts — POST /api/transactions/:txId/split, GET/PATCH/DELETE /api/splits/:id, GET /api/households/:id/balances
- P7: Create routes/settlements.ts — POST /api/households/:id/settlements, GET /api/households/:id/settlements
- P8: Create plugin.ts — export householdRoutes, register all 5 route files
- P9: Register householdRoutes in app.ts
- P10: Update route-surface.snapshot.txt (add all new routes alphabetically)
- P11: Update route-table.snapshot.txt (regenerate by running the snapshot test and capturing output, or updating manually)
- P12: npm run typecheck, npm run lint; fix any errors

## Files and Symbols

### Create
- `packages/shared/src/schemas/household.ts` — add to existing file
- `apps/api/src/modules/household/services/grants.ts`
- `apps/api/src/modules/household/routes/households.ts`
- `apps/api/src/modules/household/routes/membership.ts`
- `apps/api/src/modules/household/routes/sharing.ts`
- `apps/api/src/modules/household/routes/splits.ts`
- `apps/api/src/modules/household/routes/settlements.ts`
- `apps/api/src/modules/household/plugin.ts`

### Modify
- `apps/api/src/modules/household/services/splits.ts` — add getSplit, updateSplit; convert plain Error → HttpError(400)
- `apps/api/src/app.ts` — add householdRoutes import + register
- `apps/api/src/route-surface.snapshot.txt` — add new routes alphabetically
- `apps/api/src/route-table.snapshot.txt` — update for new routes

## Required Changes

### 1. packages/shared/src/schemas/household.ts — ADD at end

```ts
export const SplitRuleSchema = z.enum(["equal", "shares", "exact"]);
export type SplitRule = z.infer<typeof SplitRuleSchema>;

export const SplitShareSchema = z.object({
  id: z.uuid(),
  splitId: z.uuid(),
  personId: z.uuid(),
  sharePaise: z.number().int(),
  createdAt: z.coerce.date(),
});
export type SplitShare = z.infer<typeof SplitShareSchema>;

export const SplitSchema = z.object({
  id: z.uuid(),
  transactionId: z.uuid(),
  householdId: z.uuid(),
  rule: SplitRuleSchema,
  payerPersonId: z.uuid(),
  createdByUserId: z.uuid(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  shares: z.array(SplitShareSchema),
});
export type Split = z.infer<typeof SplitSchema>;

export const CreateSplitSchema = z.object({
  householdId: z.uuid(),
  rule: SplitRuleSchema,
  totalPaise: z.number().int().positive(),
  payerPersonId: z.uuid(),
  memberPersonIds: z.array(z.uuid()).min(2),
  sharePaise: z.array(z.number().int().nonnegative()).optional(),
  ratios: z.array(z.number().int().positive()).optional(),
});
export type CreateSplit = z.infer<typeof CreateSplitSchema>;

export const UpdateSplitSchema = z.object({
  rule: SplitRuleSchema.optional(),
  payerPersonId: z.uuid().optional(),
  memberPersonIds: z.array(z.uuid()).min(2).optional(),
  sharePaise: z.array(z.number().int().nonnegative()).optional(),
  ratios: z.array(z.number().int().positive()).optional(),
});
export type UpdateSplit = z.infer<typeof UpdateSplitSchema>;

export const SettlementSchema = z.object({
  id: z.uuid(),
  householdId: z.uuid(),
  fromPersonId: z.uuid(),
  toPersonId: z.uuid(),
  amountPaise: z.number().int().positive(),
  transferTransactionId: z.uuid().nullable(),
  note: z.string().nullable(),
  createdAt: z.coerce.date(),
});
export type Settlement = z.infer<typeof SettlementSchema>;

export const CreateSettlementSchema = z.object({
  fromPersonId: z.uuid(),
  toPersonId: z.uuid(),
  amountPaise: z.number().int().positive(),
  note: z.string().optional(),
}).refine(d => d.fromPersonId !== d.toPersonId, { message: "fromPersonId and toPersonId must be different" });
export type CreateSettlement = z.infer<typeof CreateSettlementSchema>;

export const HouseholdBalancesSchema = z.record(z.string(), z.number().int());
export type HouseholdBalances = z.infer<typeof HouseholdBalancesSchema>;
```

### 2. services/grants.ts

```ts
import { and, eq } from "drizzle-orm";
import type { DbOrTx } from "../../../db/index.ts";
import { sharingGrants } from "../schema.ts";
import { HttpError } from "../../../lib/errors.ts";
import type { CreateSharingGrant, SharingGrant } from "@compass/shared";

function toGrant(row: typeof sharingGrants.$inferSelect): SharingGrant {
  return {
    id: row.id,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    ownerUserId: row.ownerUserId,
    grantedToUserId: row.grantedToUserId,
    householdId: row.householdId,
    createdAt: row.createdAt,
  };
}

export async function createGrant(
  db: DbOrTx,
  userId: string,
  input: CreateSharingGrant,
): Promise<SharingGrant> {
  const [row] = await db
    .insert(sharingGrants)
    .values({
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      ownerUserId: userId,
      grantedToUserId: input.grantedToUserId,
      householdId: input.householdId,
    })
    .returning();
  if (!row) throw new HttpError(500, "Failed to create sharing grant");
  return toGrant(row);
}

export async function revokeGrant(
  db: DbOrTx,
  userId: string,
  grantId: string,
): Promise<void> {
  const [row] = await db
    .select({ ownerUserId: sharingGrants.ownerUserId })
    .from(sharingGrants)
    .where(eq(sharingGrants.id, grantId));
  if (!row) throw new HttpError(404, "Sharing grant not found");
  if (row.ownerUserId !== userId) throw new HttpError(403, "Not authorized to revoke this grant");
  await db.delete(sharingGrants).where(eq(sharingGrants.id, grantId));
}

export async function listGrants(
  db: DbOrTx,
  userId: string,
  filters?: { resourceType?: string; resourceId?: string },
): Promise<SharingGrant[]> {
  let q = db.select().from(sharingGrants).where(eq(sharingGrants.ownerUserId, userId));
  // Apply optional filters using a separate query approach if needed
  const rows = await db.select().from(sharingGrants).where(
    and(
      eq(sharingGrants.ownerUserId, userId),
      filters?.resourceType ? eq(sharingGrants.resourceType, filters.resourceType as any) : undefined,
      filters?.resourceId ? eq(sharingGrants.resourceId, filters.resourceId) : undefined,
    )
  );
  return rows.map(toGrant);
}
```

### 3. services/splits.ts — additions + fix

Add `import { HttpError } from "../../../lib/errors.ts";`

Replace all `throw new Error(...)` with `throw new HttpError(400, ...)` in createSplit and deleteSplit.

Add getSplit:
```ts
export async function getSplit(
  db: DbOrTx,
  userId: string,
  splitId: string,
): Promise<{ split: typeof splits.$inferSelect; shares: (typeof splitShares.$inferSelect)[] }> {
  const [split] = await db.select().from(splits).where(eq(splits.id, splitId));
  if (!split) throw new HttpError(404, "Split not found");
  const shares = await db.select().from(splitShares).where(eq(splitShares.splitId, splitId));
  return { split, shares };
}
```

Add updateSplit (delete old shares, recompute and reinsert — simplest correct approach):
```ts
export async function updateSplit(
  db: Db,
  userId: string,
  splitId: string,
  input: { rule?: SplitRule; payerPersonId?: string; totalPaise?: number; memberPersonIds?: string[]; sharePaise?: number[]; ratios?: number[] },
): Promise<{ split: typeof splits.$inferSelect; shares: (typeof splitShares.$inferSelect)[] }> {
  const [existing] = await db.select().from(splits).where(eq(splits.id, splitId));
  if (!existing) throw new HttpError(404, "Split not found");
  if (existing.createdByUserId !== userId) throw new HttpError(403, "Only the creator can update this split");
  
  // Rebuild from new input or fallback to existing
  // For simplicity: delete all split_shares and recreate them
  // Update the splits row first
  const rule = input.rule ?? existing.rule;
  const payerPersonId = input.payerPersonId ?? existing.payerPersonId;
  
  return await db.transaction(async (tx) => {
    const [updated] = await tx.update(splits)
      .set({ rule, payerPersonId, updatedAt: new Date() })
      .where(eq(splits.id, splitId))
      .returning();
    if (!updated) throw new HttpError(500, "Failed to update split");
    
    // Re-create shares if memberPersonIds + totalPaise provided
    if (input.memberPersonIds && input.totalPaise) {
      await tx.delete(splitShares).where(eq(splitShares.splitId, splitId));
      let computed: number[];
      if (rule === "equal") {
        computed = computeEqualShares(input.totalPaise, input.memberPersonIds.length);
      } else if (rule === "shares") {
        if (!input.ratios) throw new HttpError(400, "ratios required for rule=shares");
        computed = computeProportionalShares(input.totalPaise, input.ratios);
      } else {
        if (!input.sharePaise) throw new HttpError(400, "sharePaise required for rule=exact");
        const shortfall = validateExactShares(input.sharePaise, input.totalPaise);
        if (shortfall !== 0) throw new HttpError(400, `sharePaise do not sum to totalPaise: shortfall=${shortfall}`);
        computed = input.sharePaise;
      }
      await tx.insert(splitShares).values(
        input.memberPersonIds.map((personId, i) => ({
          splitId: splitId,
          personId,
          sharePaise: computed[i]!,
        }))
      );
    }
    
    const shares = await tx.select().from(splitShares).where(eq(splitShares.splitId, splitId));
    return { split: updated, shares };
  });
}
```

### 4. routes/households.ts pattern
```ts
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { CreateHouseholdSchema, HouseholdSchema, UpdateHouseholdSchema } from "@compass/shared";
import { createHousehold, deleteHousehold, getHousehold, listHouseholds, updateHousehold } from "../services/households.ts";
import { HttpError } from "../../../lib/errors.ts";

const IdParams = z.object({ id: z.uuid() });

export async function householdCrudRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get("/api/households", { schema: { response: { 200: z.array(HouseholdSchema) } } },
    async (req) => listHouseholds(app.db, req.session!.userId));

  r.post("/api/households", { schema: { body: CreateHouseholdSchema, response: { 201: HouseholdSchema } } },
    async (req, reply) => reply.code(201).send(await createHousehold(app.db, req.session!.userId, req.body)));

  r.get("/api/households/:id", { schema: { params: IdParams, response: { 200: HouseholdSchema } } },
    async (req) => getHousehold(app.db, req.session!.userId, req.params.id));

  r.patch("/api/households/:id", { schema: { params: IdParams, body: UpdateHouseholdSchema, response: { 200: HouseholdSchema } } },
    async (req) => updateHousehold(app.db, req.session!.userId, req.params.id, req.body));

  r.delete("/api/households/:id", { schema: { params: IdParams, response: { 200: z.object({ ok: z.boolean() }) } } },
    async (req) => { await deleteHousehold(app.db, req.session!.userId, req.params.id); return { ok: true }; });
}
```

### 5. routes/membership.ts
Routes:
- POST /api/households/:id/invite → createInvite(db, userId, params.id) → 201 with HouseholdInviteSchema
- GET /api/households/:id/members → listMembers(db, userId, params.id) → z.array(HouseholdMemberSchema)
- POST /api/households/accept → acceptInvite(db, userId, body.token) → 200 with HouseholdMemberSchema
- POST /api/households/:id/leave → leaveHousehold(db, userId, params.id) → { ok: true }
- DELETE /api/households/:id/members/:memberId → removeMember(db, userId, params.id, params.memberId) → { ok: true }

Note: POST /api/households/accept must be registered BEFORE GET /api/households/:id to avoid route conflict. But since methods differ (POST vs GET), register `POST /api/households/accept` in membership.ts before the `:id` CRUD routes in households.ts — OR use a different path like `/api/households/invites/accept`.

IMPORTANT: Use `/api/households/invites/accept` (not `/api/households/accept`) to avoid any route ordering issues. This is cleaner.

### 6. routes/sharing.ts
- POST /api/sharing-grants → createGrant with route-level check that userId is member of input.householdId AND grantedToUserId is also a member
- GET /api/sharing-grants (with optional query params resourceType, resourceId) → listGrants
- DELETE /api/sharing-grants/:id → revokeGrant

Zod query schema for GET: `z.object({ resourceType: SharingResourceTypeSchema.optional(), resourceId: z.uuid().optional() })`

Route-level household membership check helper (inline or local function):
```ts
async function assertMember(db: Db, userId: string, householdId: string) {
  const rows = await db.select({ id: householdMembers.id })
    .from(householdMembers)
    .where(and(eq(householdMembers.householdId, householdId), eq(householdMembers.userId, userId)));
  if (rows.length === 0) throw new HttpError(403, "Not a member of this household");
}
```

### 7. routes/splits.ts
- POST /api/transactions/:txId/split — body: CreateSplitSchema; call assertMember for householdId; pass transactionId from params.txId
- GET /api/splits/:id — getSplit; verify creator or household member owns it (for Phase 4: just return it if userId == createdByUserId OR is member of split's household)
- PATCH /api/splits/:id — updateSplit
- DELETE /api/splits/:id — deleteSplit
- GET /api/households/:id/balances — assertMember; getHouseholdBalances

Params schemas:
- TxIdParams = z.object({ txId: z.uuid() })
- IdParams = z.object({ id: z.uuid() })
- HouseholdIdParams = z.object({ id: z.uuid() })

### 8. routes/settlements.ts
- POST /api/households/:id/settlements — assertMember(db, userId, params.id); createSettlement with householdId from params
- GET /api/households/:id/settlements — assertMember; listSettlements

### 9. plugin.ts
```ts
import type { FastifyInstance } from "fastify";
import { householdCrudRoutes } from "./routes/households.ts";
import { membershipRoutes } from "./routes/membership.ts";
import { sharingRoutes } from "./routes/sharing.ts";
import { splitRoutes } from "./routes/splits.ts";
import { settlementRoutes } from "./routes/settlements.ts";

export async function householdRoutes(app: FastifyInstance): Promise<void> {
  await app.register(householdCrudRoutes);
  await app.register(membershipRoutes);
  await app.register(sharingRoutes);
  await app.register(splitRoutes);
  await app.register(settlementRoutes);
}
```

### 10. app.ts — add to registerRoutes
```ts
import { householdRoutes } from "./modules/household/plugin.ts";
// ... in registerRoutes():
await app.register(householdRoutes);
```
Add AFTER automationRoutes.

### 11. Route snapshot updates

For route-surface.snapshot.txt, add these lines in alphabetical order (by METHOD then URL):

```
DELETE /api/households/:id
DELETE /api/households/:id/members/:memberId
DELETE /api/sharing-grants/:id
DELETE /api/splits/:id
GET /api/households
GET /api/households/:id
GET /api/households/:id/balances
GET /api/households/:id/members
GET /api/households/:id/settlements
GET /api/sharing-grants
GET /api/splits/:id
PATCH /api/households/:id
PATCH /api/splits/:id
POST /api/households
POST /api/households/:id/invite
POST /api/households/:id/leave
POST /api/households/:id/settlements
POST /api/households/invites/accept
POST /api/sharing-grants
POST /api/transactions/:txId/split
```

For route-table.snapshot.txt: after adding all routes, run this command to regenerate it:
```bash
cd /work/personal/compass/apps/api && node --import ./src/instrument.ts src/scripts/print-routes.ts 2>/dev/null || true
```

Actually, the better approach is to run the route snapshot test with the UPDATE flag, or look at how other tasks updated it. Check if there's a script:
```bash
grep -r "route-table" apps/api/src --include="*.ts" -l | head -5
grep -r "printRoutes\|route-surface\|route-table" apps/api/src --include="*.ts" -l | head -10
```

Then look at the route snapshot test to understand how to regenerate. Likely you need to:
1. Run the snapshot test
2. If it fails with "snapshot mismatch", copy the actual output to the snapshot file
OR
3. Build a minimal Fastify app and call printRoutes

Look at apps/api/src/app.route-snapshot.test.ts or similar file to understand.

## Must Not Change
- Any existing services in the household module (except additions to splits.ts noted above)
- Any files in other modules
- The split-math functions
- db/schema.ts or decomposition test (no new tables)

## Acceptance Criteria
- AC1: All 20 routes registered and typechecked
- AC2: Services/routes import from @compass/shared for all request/response types
- AC3: Route snapshots updated and tests pass
- AC4: assertMember helper used before any household-scoped mutation
- AC5: createSplit and deleteSplit throw HttpError(400/403) not plain Error
- AC6: npm run typecheck exits 0

## Commands
1. Find snapshot test file: `find apps/api/src -name "*.snapshot*" -o -name "*route*snapshot*" | grep -v ".txt" | head -10`
2. After all routes: `cd /work/personal/compass && npm run typecheck 2>&1 | tail -30`
3. Run route snapshot test: `cd /work/personal/compass && node --test apps/api/src/app.route-snapshot.test.ts 2>&1 | head -50`
4. If snapshot test fails, capture actual and update snapshot files accordingly

## Required Evidence
- List of all files created/modified
- Literal diff of route-surface.snapshot.txt (first and last 20 lines)
- typecheck output + exit code
- Route snapshot test output
- Any plan deviations or blockers

Write findings to `/work/personal/compass/tasks/053-household-api/verification-1.md`
