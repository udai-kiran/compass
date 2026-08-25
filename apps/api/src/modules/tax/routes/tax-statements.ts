/**
 * tax-statements.ts — staged AIS / 26AS / Form-16 import routes (task 13.13).
 *
 * Registered under the /api/tax prefix; paths here are RELATIVE:
 *   POST   /statements            → typed/pasted import (deterministic path)
 *   POST   /statements/:id/document → attach the raw PDF/image file (Storage)
 *   GET    /statements            → list for an FY
 *   GET    /statements/:id        → full statement with lines + verdicts
 *   POST   /statements/:id/reconcile → re-run matching
 *   POST   /statements/:id/accept → pending → accepted (reconciles first)
 *   POST   /statements/:id/reject → pending → rejected
 *   DELETE /statements/:id        → remove a staged import
 *
 * Privacy: no model call exists in this path (matching is deterministic), so
 * nothing is redacted-before-model or logged raw. The assessee's PAN is only
 * ever accepted/echoed as its last 4 digits.
 */

import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import {
  CreateTaxStatementBodySchema,
  GetTaxStatementsQuerySchema,
  TaxStatementDetailSchema,
  TaxStatementListSchema,
} from "@compass/shared";
import { HttpError } from "../../../lib/errors.ts";
import {
  acceptTaxStatement,
  attachTaxStatementDocument,
  createTaxStatement,
  deleteTaxStatement,
  getTaxStatement,
  listTaxStatements,
  reconcileTaxStatement,
  rejectTaxStatement,
} from "../services/tax-statements.ts";

const IdParams = z.object({ id: z.uuid() });

/** Maximum raw-document size: 20 MB (AIS JSON exports can be large). */
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export async function taxStatementRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.post(
    "/statements",
    {
      schema: {
        body: CreateTaxStatementBodySchema,
        response: { 200: TaxStatementDetailSchema },
      },
    },
    async (req) => createTaxStatement(app.db, req.session!.userId, req.body),
  );

  r.get(
    "/statements",
    {
      schema: {
        querystring: GetTaxStatementsQuerySchema,
        response: { 200: TaxStatementListSchema },
      },
    },
    async (req) => listTaxStatements(app.db, req.session!.userId, req.query.fy),
  );

  r.get(
    "/statements/:id",
    {
      schema: { params: IdParams, response: { 200: TaxStatementDetailSchema } },
    },
    async (req) => getTaxStatement(app.db, req.session!.userId, req.params.id),
  );

  r.post(
    "/statements/:id/reconcile",
    {
      schema: { params: IdParams, response: { 200: TaxStatementDetailSchema } },
    },
    async (req) => reconcileTaxStatement(app.db, req.session!.userId, req.params.id),
  );

  r.post(
    "/statements/:id/accept",
    {
      schema: { params: IdParams, response: { 200: TaxStatementDetailSchema } },
    },
    async (req) => acceptTaxStatement(app.db, req.session!.userId, req.params.id),
  );

  r.post(
    "/statements/:id/reject",
    {
      schema: { params: IdParams, response: { 200: TaxStatementDetailSchema } },
    },
    async (req) => rejectTaxStatement(app.db, req.session!.userId, req.params.id),
  );

  r.delete(
    "/statements/:id",
    {
      schema: { params: IdParams, response: { 200: z.object({ ok: z.literal(true) }) } },
    },
    async (req) => {
      await deleteTaxStatement(app.db, app.storage, req.session!.userId, req.params.id);
      return { ok: true as const };
    },
  );

  /**
   * Attach the raw document (PDF/image/JSON export) to a staged statement.
   * Magic bytes are checked for the binary types so a mislabeled upload fails
   * fast; text formats are size-capped only. The SERVICE owns storage
   * lifecycle (upload/replace/delete compensation) and never records the raw
   * filename — it labels the upload by content type instead.
   */
  r.post(
    "/statements/:id/document",
    {
      schema: {
        params: IdParams,
        response: { 200: z.object({ hasDocument: z.boolean() }) },
      },
    },
    async (req) => {
      const userId = req.session!.userId;
      const file = await req.file({ limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } });
      if (!file) throw new HttpError(400, "Expected a multipart file field named 'file'");
      if (file.file.truncated) throw new HttpError(413, "File exceeds the 20 MB limit");
      const buffer = await file.toBuffer();

      const mime = file.mimetype;
      const binary = mime === "application/pdf" || mime.startsWith("image/");
      if (binary) {
        const head = buffer.subarray(0, 8);
        const ok =
          (mime === "application/pdf" && head.toString("ascii", 0, 4) === "%PDF") ||
          (mime === "image/jpeg" && head[0] === 0xff && head[1] === 0xd8) ||
          (mime === "image/png" && head.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) ||
          mime === "image/webp";
        if (!ok) throw new HttpError(415, "File content does not match its declared type");
      } else if (
        !["application/json", "text/csv", "text/plain"].includes(mime) &&
        !mime.includes("excel") &&
        !mime.includes("spreadsheet")
      ) {
        throw new HttpError(415, `Unsupported document type ${mime}`);
      }

      await attachTaxStatementDocument(app.db, app.storage, userId, req.params.id, {
        buffer,
        contentType: mime,
      });
      return { hasDocument: true as const };
    },
  );
}
