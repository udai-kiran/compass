import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { SearchResultsSchema } from "@compass/shared";
import { search } from "../services/search.ts";

const RECENT_MAX = 8;

export async function searchRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    "/api/search",
    {
      schema: {
        querystring: z.object({ q: z.string().default("") }),
        response: { 200: SearchResultsSchema },
      },
    },
    async (req) => {
      const q = req.query.q.trim();
      if (q.length >= 2) {
        // recent searches persisted per user in Redis (dedup, capped, newest-first)
        const key = `recent-search:${req.session!.userId}`;
        await app.redis.lrem(key, 0, q);
        await app.redis.lpush(key, q);
        await app.redis.ltrim(key, 0, RECENT_MAX - 1);
      }
      return search(app.db, req.session!.userId, q);
    },
  );

  r.get(
    "/api/search/recent",
    { schema: { response: { 200: z.array(z.string()) } } },
    async (req) => app.redis.lrange(`recent-search:${req.session!.userId}`, 0, RECENT_MAX - 1),
  );
}
