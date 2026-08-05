import { eq } from "drizzle-orm";
import type { ProjectionSettings, UpdateProjectionSettings } from "@compass/shared";
import { UpdateProjectionSettingsSchema } from "@compass/shared";
import type { Db } from "../../../db/index.ts";
import { projectionSettings } from "../schema.ts";
import { DEFAULT_EQUITY_RETURN_BPS } from "./goal-returns.ts";

export async function getProjectionSettings(db: Db, userId: string): Promise<ProjectionSettings> {
  const row = await db.query.projectionSettings.findFirst({
    where: eq(projectionSettings.userId, userId),
  });
  return { equityReturnBps: row?.equityReturnBps ?? DEFAULT_EQUITY_RETURN_BPS };
}

export async function updateProjectionSettings(
  db: Db,
  userId: string,
  input: UpdateProjectionSettings,
): Promise<ProjectionSettings> {
  const parsed = UpdateProjectionSettingsSchema.parse(input);
  const [row] = await db
    .insert(projectionSettings)
    .values({ userId, ...parsed })
    .onConflictDoUpdate({
      target: projectionSettings.userId,
      set: { ...parsed, updatedAt: new Date() },
    })
    .returning();
  return { equityReturnBps: row!.equityReturnBps };
}
