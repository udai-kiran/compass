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
  const conditions = [eq(sharingGrants.ownerUserId, userId)];
  if (filters?.resourceType) {
    conditions.push(eq(sharingGrants.resourceType, filters.resourceType as any));
  }
  if (filters?.resourceId) {
    conditions.push(eq(sharingGrants.resourceId, filters.resourceId));
  }
  const rows = await db.select().from(sharingGrants).where(and(...conditions));
  return rows.map(toGrant);
}
