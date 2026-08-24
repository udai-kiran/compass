import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  AccrualScheduleResponseSchema,
  DepositDetailsSchema,
  UpsertDepositDetailsSchema,
} from "@compass/shared";
import {
  getDepositDetails,
  upsertDepositDetails,
  getDepositSchedule,
} from "../services/deposit-details.ts";

const IdParams = z.object({ id: z.uuid() });

export async function depositDetailRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    "/api/holdings/:id/deposit",
    { schema: { params: IdParams, response: { 200: DepositDetailsSchema.nullable() } } },
    async (req) => getDepositDetails(app.db, req.session!.userId, req.params.id),
  );

  r.put(
    "/api/holdings/:id/deposit",
    {
      schema: {
        params: IdParams,
        body: UpsertDepositDetailsSchema,
        response: { 200: DepositDetailsSchema },
      },
    },
    async (req) => upsertDepositDetails(app.db, req.session!.userId, req.params.id, req.body),
  );

  r.get(
    "/api/holdings/:id/deposit/schedule",
    { schema: { params: IdParams, response: { 200: AccrualScheduleResponseSchema } } },
    async (req) => getDepositSchedule(app.db, req.session!.userId, req.params.id),
  );
}
