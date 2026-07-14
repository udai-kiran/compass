import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  CategorySchema,
  CategoryTreeNodeSchema,
  CreateCategorySchema,
  MergeCategorySchema,
  UpdateCategorySchema,
} from "@compass/shared";
import {
  categoryTree,
  createCategory,
  listCategories,
  mergeCategory,
  updateCategory,
} from "../services/categories.ts";

const IdParams = z.object({ id: z.uuid() });

export async function categoryRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    "/api/categories",
    { schema: { response: { 200: z.array(CategorySchema) } } },
    async (req) => listCategories(app.db, req.session!.userId),
  );

  r.get(
    "/api/categories/tree",
    { schema: { response: { 200: z.array(CategoryTreeNodeSchema) } } },
    async (req) => categoryTree(app.db, req.session!.userId),
  );

  r.post(
    "/api/categories",
    { schema: { body: CreateCategorySchema, response: { 201: CategorySchema } } },
    async (req, reply) =>
      reply.code(201).send(await createCategory(app.db, req.session!.userId, req.body)),
  );

  r.patch(
    "/api/categories/:id",
    { schema: { params: IdParams, body: UpdateCategorySchema, response: { 200: CategorySchema } } },
    async (req) => updateCategory(app.db, req.session!.userId, req.params.id, req.body),
  );

  r.post(
    "/api/categories/:id/merge",
    {
      schema: {
        params: IdParams,
        body: MergeCategorySchema,
        response: { 200: z.object({ ok: z.boolean() }) },
      },
    },
    async (req) => {
      await mergeCategory(app.db, req.session!.userId, req.params.id, req.body.intoCategoryId);
      return { ok: true };
    },
  );
}
