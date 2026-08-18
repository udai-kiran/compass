import { and, eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import type { Household, HouseholdMember, HouseholdInvite } from "@compass/shared";
import type { Db } from "../../../db/index.ts";
import { householdMembers, householdInvites, households } from "../schema.ts";
import { users } from "../../../db/core-schema.ts";
import { HttpError } from "../../../lib/errors.ts";

function toInvite(row: typeof householdInvites.$inferSelect): HouseholdInvite {
  return {
    id: row.id,
    householdId: row.householdId,
    token: row.token,
    expiresAt: row.expiresAt,
    accepted: row.acceptedAt !== null,
    createdAt: row.createdAt,
  };
}

export async function listMembers(
  db: Db,
  userId: string,
  householdId: string,
): Promise<HouseholdMember[]> {
  const callerMember = await db.query.householdMembers.findFirst({
    where: and(
      eq(householdMembers.householdId, householdId),
      eq(householdMembers.userId, userId),
    ),
  });
  if (!callerMember) throw new HttpError(404, "Household not found");

  const rows = await db
    .select({
      id: householdMembers.id,
      householdId: householdMembers.householdId,
      userId: householdMembers.userId,
      displayName: users.displayName,
      role: householdMembers.role,
      joinedAt: householdMembers.joinedAt,
    })
    .from(householdMembers)
    .innerJoin(users, eq(householdMembers.userId, users.id))
    .where(eq(householdMembers.householdId, householdId));

  return rows;
}

export async function createInvite(
  db: Db,
  userId: string,
  householdId: string,
): Promise<HouseholdInvite> {
  const member = await db.query.householdMembers.findFirst({
    where: and(
      eq(householdMembers.householdId, householdId),
      eq(householdMembers.userId, userId),
    ),
  });
  if (!member) throw new HttpError(404, "Household not found");

  const token = randomBytes(24).toString("hex");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  const [row] = await db
    .insert(householdInvites)
    .values({
      householdId,
      invitedByUserId: userId,
      token,
      expiresAt,
    })
    .returning();

  return toInvite(row!);
}

export async function acceptInvite(
  db: Db,
  userId: string,
  token: string,
): Promise<Household> {
  return db.transaction(async (tx) => {
    const invite = await tx.query.householdInvites.findFirst({
      where: eq(householdInvites.token, token),
    });
    if (!invite) throw new HttpError(404, "Invite not found");
    if (invite.acceptedAt !== null) throw new HttpError(409, "Invite already accepted");
    if (invite.expiresAt < new Date()) throw new HttpError(410, "Invite has expired");

    const existing = await tx.query.householdMembers.findFirst({
      where: and(
        eq(householdMembers.householdId, invite.householdId),
        eq(householdMembers.userId, userId),
      ),
    });
    if (existing) throw new HttpError(409, "Already a member of this household");

    await tx.insert(householdMembers).values({
      householdId: invite.householdId,
      userId,
      role: "member",
    });

    await tx
      .update(householdInvites)
      .set({ acceptedByUserId: userId, acceptedAt: new Date() })
      .where(eq(householdInvites.id, invite.id));

    const household = await tx.query.households.findFirst({
      where: eq(households.id, invite.householdId),
    });
    if (!household) throw new HttpError(404, "Household not found");

    return {
      id: household.id,
      name: household.name,
      createdByUserId: household.createdByUserId,
      createdAt: household.createdAt,
    };
  });
}

export async function leaveHousehold(
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

  if (member.role === "owner") {
    // Check if this is the sole owner
    const allMembers = await db.query.householdMembers.findMany({
      where: eq(householdMembers.householdId, householdId),
    });
    const ownerCount = allMembers.filter((m) => m.role === "owner").length;
    if (ownerCount <= 1) {
      throw new HttpError(
        400,
        "Cannot leave as the sole owner. Transfer ownership first.",
      );
    }
  }

  await db
    .delete(householdMembers)
    .where(
      and(
        eq(householdMembers.householdId, householdId),
        eq(householdMembers.userId, userId),
      ),
    );
}

export async function removeMember(
  db: Db,
  userId: string,
  householdId: string,
  targetUserId: string,
): Promise<void> {
  if (userId === targetUserId) {
    throw new HttpError(400, "Cannot remove yourself. Use leave instead.");
  }

  const callerMember = await db.query.householdMembers.findFirst({
    where: and(
      eq(householdMembers.householdId, householdId),
      eq(householdMembers.userId, userId),
    ),
  });
  if (!callerMember) throw new HttpError(404, "Household not found");
  if (callerMember.role !== "owner") {
    throw new HttpError(403, "Only the owner can remove members");
  }

  const targetMember = await db.query.householdMembers.findFirst({
    where: and(
      eq(householdMembers.householdId, householdId),
      eq(householdMembers.userId, targetUserId),
    ),
  });
  if (!targetMember) throw new HttpError(404, "Member not found");
  if (targetMember.role === "owner") {
    throw new HttpError(403, "Cannot remove another owner");
  }

  await db
    .delete(householdMembers)
    .where(
      and(
        eq(householdMembers.householdId, householdId),
        eq(householdMembers.userId, targetUserId),
      ),
    );
}
