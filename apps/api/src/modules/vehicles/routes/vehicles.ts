import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  CreateOdometerReadingSchema,
  MarkServiceDoneSchema,
  OdometerReadingSchema,
  UpdateVehicleServiceConfigSchema,
  VehicleOverviewSchema,
  VehicleServiceConfigSchema,
  VehicleSummarySchema,
  VehicleTransactionCandidateSchema,
} from "@compass/shared";
import {
  addOdometerReading,
  deleteOdometerReading,
  getVehicleSummary,
  listVehicleOverviews,
  listVehicleTransactionCandidates,
  markServiceDone,
  updateVehicleServiceConfig,
} from "../services/vehicles.ts";

const ResourceParams = z.object({ resourceId: z.uuid() });
const ReadingParams = z.object({ resourceId: z.uuid(), id: z.uuid() });
const CandidateQuery = z.object({ near: z.iso.date() });

/** Registered with { prefix: "/api/vehicles" } in app.ts — paths below are relative to that. */
export async function vehicleRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    "/",
    { schema: { response: { 200: z.array(VehicleOverviewSchema) } } },
    (req) => listVehicleOverviews(app.db, req.session!.userId),
  );

  r.get(
    "/:resourceId",
    { schema: { params: ResourceParams, response: { 200: VehicleSummarySchema } } },
    (req) => getVehicleSummary(app.db, req.session!.userId, req.params.resourceId),
  );

  r.patch(
    "/:resourceId/service-config",
    {
      schema: {
        params: ResourceParams,
        body: UpdateVehicleServiceConfigSchema,
        response: { 200: VehicleServiceConfigSchema },
      },
    },
    (req) => updateVehicleServiceConfig(app.db, req.session!.userId, req.params.resourceId, req.body),
  );

  r.post(
    "/:resourceId/service-done",
    {
      schema: {
        params: ResourceParams,
        body: MarkServiceDoneSchema,
        response: { 200: VehicleServiceConfigSchema },
      },
    },
    (req) => markServiceDone(app.db, req.session!.userId, req.params.resourceId, req.body),
  );

  r.get(
    "/:resourceId/transactions",
    {
      schema: {
        params: ResourceParams,
        querystring: CandidateQuery,
        response: { 200: z.array(VehicleTransactionCandidateSchema) },
      },
    },
    (req) =>
      listVehicleTransactionCandidates(app.db, req.session!.userId, req.params.resourceId, req.query.near),
  );

  r.post(
    "/:resourceId/readings",
    {
      schema: {
        params: ResourceParams,
        body: CreateOdometerReadingSchema,
        response: { 200: OdometerReadingSchema },
      },
    },
    (req) => addOdometerReading(app.db, req.session!.userId, req.params.resourceId, req.body),
  );

  r.delete(
    "/:resourceId/readings/:id",
    {
      schema: {
        params: ReadingParams,
        response: { 200: z.object({ ok: z.boolean() }) },
      },
    },
    async (req) => {
      await deleteOdometerReading(app.db, req.session!.userId, req.params.resourceId, req.params.id);
      return { ok: true };
    },
  );
}
