/**
 * Serviceability routes (task 10.2). Registered under the `/api/shopping`
 * prefix (set at the `app.ts` registration site), so paths here are RELATIVE:
 *   GET /sources/:sourceId/serviceability        → GET  /api/shopping/sources/:sourceId/serviceability
 *   PUT /sources/:sourceId/serviceability/:pincode → PUT /api/shopping/sources/:sourceId/serviceability/:pincode
 *
 * GET lists all serviceability checks for a source owned by the caller.
 * PUT upserts a check for a specific source × pincode pair. Ownership of the
 * source is verified before writing.
 *
 * PRIVACY: pincode is stored locally only — never passed to AI providers or
 * external APIs. The PUT route accepts pincode as a URL param (path segment)
 * so it is naturally excluded from request bodies and logs.
 *
 * All routes are session-authenticated. No route has `config: { public: true }`.
 * Demo sessions are automatically rejected on all mutating methods by the
 * chokepoint in `plugins/auth.ts`.
 */

import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import {
  CreateServiceabilityCheckSchema,
  ServiceabilityCheckSchema,
} from "@compass/shared";
import {
  listServiceabilityForSource,
  upsertServiceabilityCheck,
} from "../services/serviceability.ts";

const SourceParams = z.object({ sourceId: z.uuid() });
const PincodeParams = z.object({ sourceId: z.uuid(), pincode: z.string().regex(/^\d{6}$/, "pincode must be 6 digits") });

export async function shoppingServiceabilityRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // GET /sources/:sourceId/serviceability — list all serviceability checks for a source.
  r.get(
    "/sources/:sourceId/serviceability",
    {
      schema: {
        params: SourceParams,
        response: { 200: z.array(ServiceabilityCheckSchema) },
      },
    },
    async (req) => {
      const userId = req.session!.userId;
      return listServiceabilityForSource(app.db, userId, req.params.sourceId);
    },
  );

  // PUT /sources/:sourceId/serviceability/:pincode — upsert a serviceability check.
  r.put(
    "/sources/:sourceId/serviceability/:pincode",
    {
      schema: {
        params: PincodeParams,
        body: CreateServiceabilityCheckSchema,
        response: { 200: ServiceabilityCheckSchema },
      },
    },
    async (req) => {
      const userId = req.session!.userId;
      return upsertServiceabilityCheck(
        app.db,
        userId,
        req.params.sourceId,
        req.params.pincode,
        req.body.isServiceable,
      );
    },
  );
}
