import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { AttachmentSchema } from "@compass/shared";
import { HttpError } from "../../../lib/errors.ts";
import {
  deleteAttachment,
  listAttachments,
  MAX_ATTACHMENT_BYTES,
  readAttachment,
  saveAttachment,
} from "../services/attachments.ts";

export async function attachmentRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const IdParams = z.object({ id: z.uuid() });

  r.get(
    "/api/transactions/:id/attachments",
    { schema: { params: IdParams, response: { 200: z.array(AttachmentSchema) } } },
    async (req) => listAttachments(app.db, req.session!.userId, req.params.id),
  );

  // multipart body — schema validation not applicable
  app.post("/api/transactions/:id/attachments", async (req, reply) => {
    const { id } = IdParams.parse(req.params);
    const file = await req.file({ limits: { fileSize: MAX_ATTACHMENT_BYTES, files: 1 } });
    if (!file) throw new HttpError(400, "Expected a multipart file field");
    const data = await file.toBuffer();
    const attachment = await saveAttachment(app.db, app.storage, req.session!.userId, id, {
      fileName: file.filename,
      mimeType: file.mimetype,
      data,
    });
    return reply.code(201).send(attachment);
  });

  app.get("/api/attachments/:id", async (req, reply) => {
    const { id } = IdParams.parse(req.params);
    const { meta, data } = await readAttachment(
      app.db,
      app.storage,
      req.session!.userId,
      id,
    );
    return reply
      .header("content-type", meta.mimeType)
      .header("content-disposition", `inline; filename="${encodeURIComponent(meta.fileName)}"`)
      .send(data);
  });

  r.delete(
    "/api/attachments/:id",
    { schema: { params: IdParams, response: { 200: z.object({ ok: z.boolean() }) } } },
    async (req) => {
      await deleteAttachment(app.db, app.storage, req.session!.userId, req.params.id);
      return { ok: true };
    },
  );
}
