import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  BankPresetSchema,
  CommitResultSchema,
  ImportBatchSchema,
  ImportMappingSchema,
  ImportRowsPageSchema,
  ImportRowSchema,
  UpdateImportRowSchema,
} from "@compass/shared";
import { HttpError } from "../lib/errors.ts";
import {
  applyMapping,
  BANK_PRESETS,
  commitImport,
  createImport,
  deleteImport,
  getImport,
  listImportRows,
  listImports,
  MAX_IMPORT_BYTES,
  rollbackImport,
  updateImportRow,
} from "../services/imports.ts";

const IdParams = z.object({ id: z.uuid() });
const RowParams = z.object({ id: z.uuid(), rowId: z.uuid() });
const OkResponse = z.object({ ok: z.boolean() });

export async function importRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    "/api/imports/presets",
    { schema: { response: { 200: z.array(BankPresetSchema) } } },
    async () => BANK_PRESETS,
  );

  // multipart upload — schema validation not applicable to the body
  app.post("/api/imports", async (req, reply) => {
    const { accountId } = z.object({ accountId: z.uuid() }).parse(req.query);
    const file = await req.file({ limits: { fileSize: MAX_IMPORT_BYTES, files: 1 } });
    if (!file) throw new HttpError(400, "Expected a multipart CSV file field");
    const csv = (await file.toBuffer()).toString("utf8");
    const batch = await createImport(app.db, req.session!.userId, {
      accountId,
      fileName: file.filename,
      csv,
    });
    return reply.code(201).send(batch);
  });

  r.get(
    "/api/imports",
    { schema: { response: { 200: z.array(ImportBatchSchema) } } },
    async (req) => listImports(app.db, req.session!.userId),
  );

  r.get(
    "/api/imports/:id",
    { schema: { params: IdParams, response: { 200: ImportBatchSchema } } },
    async (req) => getImport(app.db, req.session!.userId, req.params.id),
  );

  r.get(
    "/api/imports/:id/rows",
    {
      schema: {
        params: IdParams,
        querystring: z.object({
          offset: z.coerce.number().int().min(0).default(0),
          limit: z.coerce.number().int().min(1).max(200).default(50),
          onlyProblems: z.coerce.boolean().default(false),
        }),
        response: { 200: ImportRowsPageSchema },
      },
    },
    async (req) => listImportRows(app.db, req.session!.userId, req.params.id, req.query),
  );

  r.put(
    "/api/imports/:id/mapping",
    {
      schema: {
        params: IdParams,
        body: z.object({ mapping: ImportMappingSchema, saveAsPreset: z.boolean().default(false) }),
        response: { 200: ImportBatchSchema },
      },
    },
    async (req) =>
      applyMapping(app.db, req.session!.userId, req.params.id, req.body.mapping, {
        saveAsPreset: req.body.saveAsPreset,
      }),
  );

  r.patch(
    "/api/imports/:id/rows/:rowId",
    {
      schema: { params: RowParams, body: UpdateImportRowSchema, response: { 200: ImportRowSchema } },
    },
    async (req) =>
      updateImportRow(app.db, req.session!.userId, req.params.id, req.params.rowId, req.body),
  );

  r.post(
    "/api/imports/:id/commit",
    { schema: { params: IdParams, response: { 200: CommitResultSchema } } },
    async (req) => {
      const result = await commitImport(app.db, req.session!.userId, req.params.id);
      app.eventBus.emit("ledger.mutated", { userId: req.session!.userId });
      return result;
    },
  );

  r.post(
    "/api/imports/:id/rollback",
    { schema: { params: IdParams, response: { 200: z.object({ removed: z.number().int() }) } } },
    async (req) => {
      const result = await rollbackImport(app.db, req.session!.userId, req.params.id);
      app.eventBus.emit("ledger.mutated", { userId: req.session!.userId });
      return result;
    },
  );

  r.delete(
    "/api/imports/:id",
    { schema: { params: IdParams, response: { 200: OkResponse } } },
    async (req) => {
      await deleteImport(app.db, req.session!.userId, req.params.id);
      return { ok: true };
    },
  );
}
