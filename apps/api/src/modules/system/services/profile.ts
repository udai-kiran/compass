import { and, asc, eq, sql } from "drizzle-orm";
import type {
  CreateFamilyMember,
  FamilyMember,
  UpdateFamilyMember,
  UpdateUserProfile,
  UserProfile,
} from "@compass/shared";
import {
  CreateFamilyMemberSchema,
  UpdateFamilyMemberSchema,
  UpdateUserProfileSchema,
} from "@compass/shared";
import type { Db } from "../../../db/index.ts";
import { familyMembers, userProfiles } from "../schema.ts";
import { HttpError } from "../../../lib/errors.ts";

type FamilyMemberRow = typeof familyMembers.$inferSelect;

export function toFamilyMember(row: FamilyMemberRow): FamilyMember {
  return {
    id: row.id,
    name: row.name,
    relationship: row.relationship,
    dateOfBirth: row.dateOfBirth,
    educationStage: row.educationStage,
    institution: row.institution,
    courseOrStream: row.courseOrStream,
    expectedCompletionYear: row.expectedCompletionYear,
    notes: row.notes,
    sortOrder: row.sortOrder,
    linkedUserId: row.linkedUserId,
  };
}

export async function getUserProfile(db: Db, userId: string): Promise<UserProfile> {
  const row = await db.query.userProfiles.findFirst({
    where: eq(userProfiles.userId, userId),
  });
  return { dateOfBirth: row?.dateOfBirth ?? null };
}

export async function updateUserProfile(
  db: Db,
  userId: string,
  input: UpdateUserProfile,
): Promise<UserProfile> {
  const parsed = UpdateUserProfileSchema.parse(input);
  const [row] = await db
    .insert(userProfiles)
    .values({ userId, ...parsed })
    .onConflictDoUpdate({
      target: userProfiles.userId,
      set: { ...parsed, updatedAt: new Date() },
    })
    .returning();
  return { dateOfBirth: row!.dateOfBirth };
}

export async function listFamilyMembers(db: Db, userId: string): Promise<FamilyMember[]> {
  const rows = await db.query.familyMembers.findMany({
    where: eq(familyMembers.userId, userId),
    orderBy: [asc(familyMembers.sortOrder), asc(familyMembers.createdAt)],
  });
  return rows.map(toFamilyMember);
}

export async function createFamilyMember(
  db: Db,
  userId: string,
  input: CreateFamilyMember,
): Promise<FamilyMember> {
  const parsed = CreateFamilyMemberSchema.parse(input);
  if (parsed.relationship === "self") {
    throw new HttpError(400, "Cannot create a self person manually");
  }
  const [last] = await db
    .select({ sortOrder: familyMembers.sortOrder })
    .from(familyMembers)
    .where(eq(familyMembers.userId, userId))
    .orderBy(sql`${familyMembers.sortOrder} desc`)
    .limit(1);
  const rows = await db
    .insert(familyMembers)
    .values({ ...parsed, userId, sortOrder: (last?.sortOrder ?? -1) + 1 })
    .returning();
  return toFamilyMember(rows[0]!);
}

export async function updateFamilyMember(
  db: Db,
  userId: string,
  id: string,
  input: UpdateFamilyMember,
): Promise<FamilyMember> {
  const parsed = UpdateFamilyMemberSchema.parse(input);
  const rows = await db
    .update(familyMembers)
    .set({ ...parsed, updatedAt: new Date() })
    .where(and(eq(familyMembers.id, id), eq(familyMembers.userId, userId)))
    .returning();
  if (rows.length === 0) throw new HttpError(404, "Family member not found");
  return toFamilyMember(rows[0]!);
}

export async function deleteFamilyMember(db: Db, userId: string, id: string): Promise<void> {
  const existing = await db.query.familyMembers.findFirst({
    where: and(eq(familyMembers.id, id), eq(familyMembers.userId, userId)),
  });
  if (!existing) throw new HttpError(404, "Family member not found");
  if (existing.relationship === "self") {
    throw new HttpError(400, "Cannot delete the self person");
  }
  const rows = await db
    .delete(familyMembers)
    .where(and(eq(familyMembers.id, id), eq(familyMembers.userId, userId)))
    .returning({ id: familyMembers.id });
  if (rows.length === 0) throw new HttpError(404, "Family member not found");
}
