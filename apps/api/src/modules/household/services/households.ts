import { and, eq, inArray } from "drizzle-orm";
import type { Household, CreateHousehold, UpdateHousehold } from "@compass/shared";
import { CreateHouseholdSchema, UpdateHouseholdSchema } from "@compass/shared";
import type { Db } from "../../../db/index.ts";
import { households, householdMembers } from "../schema.ts";
import { HttpError } from "../../../lib/errors.ts";

type HouseholdRow = typeof households.$inferSelect;

function toHousehold(row: HouseholdRow): Household {
  return {
    id: row.id,
    name: row.name,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt,
  };
}

export async function listHouseholds(db: Db, userId: string): Promise<Household[]> {
  const memberRows = await db.query.householdMembers.findMany({
    where: eq(householdMembers.userId, userId),
  });
  if (memberRows.length === 0) return [];
  const householdIds = memberRows.map((m) => m.householdId);
  const rows = await db.query.households.findMany({
    where: inArray(households.id, householdIds),
  });
  return rows.map(toHousehold);
}

export async function getHousehold(
  db: Db,
  userId: string,
  householdId: string,
): Promise<Household> {
  const member = await db.query.householdMembers.findFirst({
    where: and(
      eq(householdMembers.householdId, householdId),
      eq(householdMembers.userId, userId),
    ),
  });
  if (!member) throw new HttpError(404, "Household not found");
  const row = await db.query.households.findFirst({
    where: eq(households.id, householdId),
  });
  if (!row) throw new HttpError(404, "Household not found");
  return toHousehold(row);
}

export async function createHousehold(
  db: Db,
  userId: string,
  input: CreateHousehold,
): Promise<Household> {
  const parsed = CreateHouseholdSchema.parse(input);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(households)
      .values({
        name: parsed.name,
        createdByUserId: userId,
      })
      .returning();
    await tx.insert(householdMembers).values({
      householdId: row!.id,
      userId,
      role: "owner",
    });
    return toHousehold(row!);
  });
}

export async function updateHousehold(
  db: Db,
  userId: string,
  householdId: string,
  input: UpdateHousehold,
): Promise<Household> {
  const parsed = UpdateHouseholdSchema.parse(input);
  const member = await db.query.householdMembers.findFirst({
    where: and(
      eq(householdMembers.householdId, householdId),
      eq(householdMembers.userId, userId),
    ),
  });
  if (!member) throw new HttpError(404, "Household not found");
  if (member.role !== "owner") throw new HttpError(403, "Only the owner can update the household");
  const rows = await db
    .update(households)
    .set({ ...parsed, updatedAt: new Date() })
    .where(eq(households.id, householdId))
    .returning();
  if (rows.length === 0) throw new HttpError(404, "Household not found");
  return toHousehold(rows[0]!);
}

export async function deleteHousehold(
  db: Db,
  userId: string,
  householdId: string,
): Promise<void> {
  const member = await db.query.householdMembers.findFirst({
    where: and(
      eq(householdMembers.householdId, householdId),
      eq(householdMembers.userId, userId),
    ),
  });
  if (!member) throw new HttpError(404, "Household not found");
  if (member.role !== "owner") throw new HttpError(403, "Only the owner can delete the household");
  await db.delete(households).where(eq(households.id, householdId));
}
