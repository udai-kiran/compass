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
