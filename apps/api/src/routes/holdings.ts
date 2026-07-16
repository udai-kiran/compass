import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  CreateHoldingEventSchema,
  CreateHoldingSchema,
  GoldDetailsSchema,
  HoldingEventSchema,
  HoldingSchema,
  MfImportInputSchema,
  MfImportPreviewSchema,
  MfImportResultSchema,
  NpsDetailsSchema,
  PortfolioSchema,
  RefreshNavResultSchema,
  SetValuationSchema,
  UpdateHoldingSchema,
  UpsertGoldDetailsSchema,
  UpsertNpsDetailsSchema,
} from "@compass/shared";
import {
  getGoldDetails,
  getNpsDetails,
  upsertGoldDetails,
  upsertNpsDetails,
} from "../services/holding-details.ts";
import {
  addEvent,
  createHolding,
  deleteEvent,
  deleteHolding,
  getPortfolio,
  refreshNav,
  setValuation,
  updateHolding,
} from "../services/holdings.ts";
import { commitMfImport, previewMfImport } from "../services/mf-import.ts";

const IdParams = z.object({ id: z.uuid() });
const EventParams = z.object({ id: z.uuid(), eventId: z.uuid() });

export async function holdingRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    "/api/portfolio",
    { schema: { response: { 200: PortfolioSchema } } },
    async (req) => getPortfolio(app.db, req.session!.userId),
  );

  r.post(
    "/api/holdings/refresh-nav",
    { schema: { response: { 200: RefreshNavResultSchema } } },
    async (req) => refreshNav(app.db, req.session!.userId),
  );

  r.post(
    "/api/holdings/import-mf/preview",
    { schema: { body: MfImportInputSchema, response: { 200: MfImportPreviewSchema } } },
    async (req) => previewMfImport(req.body.csv),
  );

  r.post(
    "/api/holdings/import-mf/commit",
    { schema: { body: MfImportInputSchema, response: { 200: MfImportResultSchema } } },
    async (req) => commitMfImport(app.db, req.session!.userId, req.body.csv),
  );

  r.post(
    "/api/holdings",
    { schema: { body: CreateHoldingSchema, response: { 201: HoldingSchema } } },
    async (req, reply) =>
      reply.code(201).send(await createHolding(app.db, req.session!.userId, req.body)),
  );

  r.patch(
    "/api/holdings/:id",
    { schema: { params: IdParams, body: UpdateHoldingSchema, response: { 200: HoldingSchema } } },
    async (req) => updateHolding(app.db, req.session!.userId, req.params.id, req.body),
  );

  r.delete(
    "/api/holdings/:id",
    { schema: { params: IdParams, response: { 200: z.object({ ok: z.boolean() }) } } },
    async (req) => {
      await deleteHolding(app.db, req.session!.userId, req.params.id);
      return { ok: true };
    },
  );

  r.put(
    "/api/holdings/:id/valuation",
    { schema: { params: IdParams, body: SetValuationSchema, response: { 200: z.object({ ok: z.boolean() }) } } },
    async (req) => {
      await setValuation(app.db, req.session!.userId, req.params.id, req.body);
      return { ok: true };
    },
  );

  r.post(
    "/api/holdings/:id/events",
    { schema: { params: IdParams, body: CreateHoldingEventSchema, response: { 201: HoldingEventSchema } } },
    async (req, reply) =>
      reply.code(201).send(await addEvent(app.db, req.session!.userId, req.params.id, req.body)),
  );

  r.delete(
    "/api/holdings/:id/events/:eventId",
    { schema: { params: EventParams, response: { 200: z.object({ ok: z.boolean() }) } } },
    async (req) => {
      await deleteEvent(app.db, req.session!.userId, req.params.id, req.params.eventId);
      return { ok: true };
    },
  );

  r.get(
    "/api/holdings/:id/nps",
    { schema: { params: IdParams, response: { 200: NpsDetailsSchema.nullable() } } },
    async (req) => getNpsDetails(app.db, req.session!.userId, req.params.id),
  );

  r.put(
    "/api/holdings/:id/nps",
    {
      schema: { params: IdParams, body: UpsertNpsDetailsSchema, response: { 200: NpsDetailsSchema } },
    },
    async (req) => upsertNpsDetails(app.db, req.session!.userId, req.params.id, req.body),
  );

  r.get(
    "/api/holdings/:id/gold",
    { schema: { params: IdParams, response: { 200: GoldDetailsSchema.nullable() } } },
    async (req) => getGoldDetails(app.db, req.session!.userId, req.params.id),
  );

  r.put(
    "/api/holdings/:id/gold",
    {
      schema: {
        params: IdParams,
        body: UpsertGoldDetailsSchema,
        response: { 200: GoldDetailsSchema },
      },
    },
    async (req) => upsertGoldDetails(app.db, req.session!.userId, req.params.id, req.body),
  );
}
