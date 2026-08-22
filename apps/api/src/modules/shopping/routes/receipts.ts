/**
 * receipts.ts — Receipt OCR → Cart Reconcile → Ledger routes (task 11.4).
 * Registered under the `/api/shopping` prefix; paths here are RELATIVE:
 *   POST /receipts/parse     → POST /api/shopping/receipts/parse
 *   POST /receipts/:id/reconcile → POST /api/shopping/receipts/:id/reconcile
 *   POST /receipts/:id/confirm   → POST /api/shopping/receipts/:id/confirm
 *   GET  /receipts           → GET  /api/shopping/receipts
 *   GET  /receipts/:id       → GET  /api/shopping/receipts/:id
 *   DELETE /receipts/:id     → DELETE /api/shopping/receipts/:id
 *   POST /receipts/:id/lines       → POST /api/shopping/receipts/:id/lines
 *   PUT  /receipts/:id/lines/:lineId → PUT /api/shopping/receipts/:id/lines/:lineId
 *   DELETE /receipts/:id/lines/:lineId → DELETE /api/shopping/receipts/:id/lines/:lineId
 *
 * Session-authenticated. Demo sessions are automatically rejected on all
 * mutating methods by the single chokepoint in `plugins/auth.ts`.
 */

import { z } from "zod";
import { and, eq, ne, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type { DbOrTx } from "../../../db/index.ts";
import { MAX_IMAGE_BYTES, effectiveModel, type AiObserver } from "@compass/ai";
import {
  ParseReceiptResponseSchema,
  ReconciliationReportSchema,
  ConfirmReceiptBodySchema,
  ReceiptWithLinesSchema,
  ReceiptListResponseSchema,
  CreateReceiptLineSchema,
  UpdateReceiptLineSchema,
} from "@compass/shared";
import { HttpError } from "../../../lib/errors.ts";
import { getAiSettings } from "../../automation/services/ai-settings.ts";
import { recordAiEvent } from "../../automation/services/events.ts";
import { mailboxSecret } from "../../ingest/services/mailboxes.ts";
import { receipts, receiptLines } from "../schema.ts";
import { assertOwnedDraft, assertOwnedCatalogItem } from "../services/ownership.ts";
import { createReceiptFromImage } from "../services/receipt-parse.ts";
import { reconcileReceipt } from "../services/receipt-reconcile.ts";
import { confirmReceipt } from "../services/receipt-confirm.ts";

// ─── Allowed content types ────────────────────────────────────────────────────

const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

/** Magic-byte check for the three allowed image types. */
function matchesImageMagicBytes(mimeType: string, data: Buffer): boolean {
  switch (mimeType) {
    case "image/jpeg":
      return data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
    case "image/png":
      return data.subarray(0, 8).equals(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      );
    case "image/webp":
      return (
        data.length >= 12 &&
        data.toString("latin1", 0, 4) === "RIFF" &&
        data.toString("latin1", 8, 12) === "WEBP"
      );
    default:
      return false;
  }
}

// ─── Params schemas ───────────────────────────────────────────────────────────

const ReceiptParams = z.object({ id: z.uuid() });
const ReceiptLineParams = ReceiptParams.extend({ lineId: z.uuid() });

const ConfirmResultSchema = z.object({
  receiptId: z.uuid(),
  transactionId: z.uuid(),
  totalPaise: z.number().int().positive(),
});

// ─── Helper: load receipt with lines (ownership-scoped) ───────────────────────

async function loadReceiptWithLines(
  db: DbOrTx,
  userId: string,
  receiptId: string,
) {
  const receipt = await db.query.receipts.findFirst({
    where: and(eq(receipts.id, receiptId), eq(receipts.userId, userId)),
  });
  if (!receipt) throw new HttpError(404, "Receipt not found");

  const lines = await db.query.receiptLines.findMany({
    where: eq(receiptLines.receiptId, receiptId),
    orderBy: (l, { asc }) => [asc(l.position)],
  });

  return {
    id: receipt.id,
    cartDraftId: receipt.cartDraftId ?? null,
    shoppingListId: receipt.shoppingListId ?? null,
    status: receipt.status,
    merchantName: receipt.merchantName ?? null,
    purchaseDate: receipt.purchaseDate ?? null,
    totalPaise: receipt.totalPaise ?? null,
    storedPath: receipt.storedPath,
    mimeType: receipt.mimeType,
    parsedAt: receipt.parsedAt ?? null,
    reconciledAt: receipt.reconciledAt ?? null,
    confirmedAt: receipt.confirmedAt ?? null,
    createdAt: receipt.createdAt,
    lines: lines.map((l) => ({
      id: l.id,
      receiptId: l.receiptId,
      position: l.position,
      rawText: l.rawText,
      normalizedName: l.normalizedName ?? null,
      catalogItemId: l.catalogItemId ?? null,
      quantityBase: l.quantityBase ?? null,
      unit: l.unit ?? null,
      pricePaise: l.pricePaise ?? null,
      matchedDraftItemId: l.matchedDraftItemId ?? null,
      matchStatus: l.matchStatus,
      createdAt: l.createdAt,
    })),
  };
}

/**
 * Recompute receipt.totalPaise from all current lines.
 * Must be called inside a transaction — uses the tx handle, not app.db.
 * Includes a status guard: throws 409 if the receipt was confirmed concurrently.
 */
async function recomputeTotal(db: DbOrTx, receiptId: string): Promise<void> {
  const lines = await db.query.receiptLines.findMany({
    where: eq(receiptLines.receiptId, receiptId),
    columns: { pricePaise: true },
  });
  const totalPaise = lines.reduce((sum, l) => sum + (l.pricePaise ?? 0), 0);
  const updated = await db
    .update(receipts)
    .set({ totalPaise })
    .where(and(eq(receipts.id, receiptId), ne(receipts.status, "confirmed")))
    .returning({ id: receipts.id });
  if (updated.length === 0) {
    throw new HttpError(409, "Cannot modify a confirmed receipt");
  }
}

// ─── Routes ───────────────────────────────────────────────────────────────────

export async function receiptRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // POST /receipts/parse — upload a receipt image and OCR it.
  r.post(
    "/receipts/parse",
    {
      schema: {
        response: { 200: ParseReceiptResponseSchema },
      },
    },
    async (req) => {
      const userId = req.session!.userId;

      const file = await req.file({ limits: { fileSize: MAX_IMAGE_BYTES, files: 1 } });
      if (!file) throw new HttpError(400, "Expected a multipart file field");

      const buffer = await file.toBuffer();

      if (file.file.truncated) {
        throw new HttpError(413, `Image exceeds the ${Math.round(MAX_IMAGE_BYTES / (1024 * 1024))} MB limit`);
      }

      const mimeType = file.mimetype;

      if (!ALLOWED_IMAGE_TYPES.has(mimeType)) {
        throw new HttpError(415, `Unsupported file type ${mimeType} — allowed: image/jpeg, image/png, image/webp`);
      }

      if (!matchesImageMagicBytes(mimeType, buffer)) {
        throw new HttpError(415, "File content does not match its declared type");
      }

      // Resolve AI settings for the event log.
      const meta = await getAiSettings(app.db, userId);
      const model = effectiveModel(meta.provider, meta.model);

      const observe: AiObserver = (obs) =>
        void recordAiEvent(app.db, userId, {
          kind: "shopping_parse",
          status: obs.ok ? "ok" : "error",
          provider: meta.provider,
          model,
          title: "receipt ocr",
          requestContext: obs.request,
          responseRaw: obs.response,
          latencyMs: obs.latencyMs,
          error: obs.error ?? null,
        });

      // cartDraftId is optional — passed as a multipart form field (not req.body).
      const rawCartDraftIdField = file.fields.cartDraftId;
      const rawCartDraftIdValue =
        rawCartDraftIdField && "value" in rawCartDraftIdField
          ? rawCartDraftIdField.value
          : undefined;
      const cartDraftIdParsed = z.uuid().safeParse(rawCartDraftIdValue);
      if (rawCartDraftIdValue !== undefined && !cartDraftIdParsed.success) {
        throw new HttpError(400, "cartDraftId must be a valid UUID");
      }
      const cartDraftId = cartDraftIdParsed.success ? cartDraftIdParsed.data : undefined;
      if (cartDraftId !== undefined) {
        await assertOwnedDraft(app.db, userId, cartDraftId);
      }

      return createReceiptFromImage(
        {
          db: app.db,
          storage: app.storage,
          secret: mailboxSecret(app.config),
          allowedBaseUrls: app.config.AI_ALLOWED_BASE_URLS,
        },
        userId,
        { buffer, contentType: mimeType },
        cartDraftId,
        observe,
      );
    },
  );

  // POST /receipts/:id/reconcile — reconcile against the receipt's linked cart draft.
  r.post(
    "/receipts/:id/reconcile",
    {
      schema: {
        params: ReceiptParams,
        response: { 200: ReconciliationReportSchema },
      },
    },
    async (req) => {
      const userId = req.session!.userId;
      return reconcileReceipt(app.db, userId, req.params.id);
    },
  );

  // POST /receipts/:id/confirm — confirm a reconciled receipt.
  r.post(
    "/receipts/:id/confirm",
    {
      schema: {
        params: ReceiptParams,
        body: ConfirmReceiptBodySchema,
        response: { 200: ConfirmResultSchema },
      },
    },
    async (req) => {
      const userId = req.session!.userId;
      const result = await app.db.transaction(async (tx) => {
        return confirmReceipt(tx, userId, req.params.id, req.body);
      });
      app.eventBus.emit("ledger.mutated", { userId });
      return result;
    },
  );

  // GET /receipts — list user's receipts with lines.
  r.get(
    "/receipts",
    {
      schema: {
        response: { 200: ReceiptListResponseSchema },
      },
    },
    async (req) => {
      const userId = req.session!.userId;
      const rows = await app.db.query.receipts.findMany({
        where: eq(receipts.userId, userId),
        orderBy: (r, { desc }) => [desc(r.createdAt)],
      });
      const receiptList = await Promise.all(
        rows.map((r) => loadReceiptWithLines(app.db, userId, r.id)),
      );
      return { receipts: receiptList };
    },
  );

  // GET /receipts/:id — single receipt with lines.
  r.get(
    "/receipts/:id",
    {
      schema: {
        params: ReceiptParams,
        response: { 200: ReceiptWithLinesSchema },
      },
    },
    async (req) => {
      const userId = req.session!.userId;
      return loadReceiptWithLines(app.db, userId, req.params.id);
    },
  );

  // DELETE /receipts/:id — delete receipt + storage.delete(storedPath).
  r.delete(
    "/receipts/:id",
    {
      schema: {
        params: ReceiptParams,
        response: { 204: z.void() },
      },
    },
    async (req, reply) => {
      const userId = req.session!.userId;

      // Verify existence and ownership first (for a clean 404 vs 409 distinction).
      const existing = await app.db.query.receipts.findFirst({
        where: and(eq(receipts.id, req.params.id), eq(receipts.userId, userId)),
        columns: { id: true, storedPath: true },
      });
      if (!existing) throw new HttpError(404, "Receipt not found");

      // Atomic delete: only succeeds when status is not 'confirmed'.
      // This prevents a race where confirm commits between the existence read and DELETE.
      const deleted = await app.db
        .delete(receipts)
        .where(
          and(
            eq(receipts.id, req.params.id),
            eq(receipts.userId, userId),
            ne(receipts.status, "confirmed"),
          ),
        )
        .returning({ id: receipts.id, storedPath: receipts.storedPath });

      if (deleted.length === 0) {
        // Row existed when we read it but was not deletable → confirmed between read and DELETE.
        throw new HttpError(409, "Cannot delete a confirmed receipt");
      }

      // Clean up stored image (best-effort — don't fail if storage delete fails).
      await app.storage.delete(deleted[0]!.storedPath).catch(() => {});

      return reply.code(204).send();
    },
  );

  // POST /receipts/:id/lines — manual line add.
  r.post(
    "/receipts/:id/lines",
    {
      schema: {
        params: ReceiptParams,
        body: CreateReceiptLineSchema,
        response: { 200: ReceiptWithLinesSchema },
      },
    },
    async (req) => {
      const userId = req.session!.userId;

      return app.db.transaction(async (tx) => {
        // F9: Claim the non-confirmed receipt row with a locking UPDATE.
        // Using sql`"parsed_at"` is a no-op self-reference that takes an exclusive row lock
        // without changing any business value.
        const claimed = await tx
          .update(receipts)
          .set({ parsedAt: sql`"parsed_at"` })
          .where(
            and(
              eq(receipts.id, req.params.id),
              eq(receipts.userId, userId),
              ne(receipts.status, "confirmed"),
            ),
          )
          .returning({ id: receipts.id });

        if (claimed.length === 0) {
          const existing = await tx.query.receipts.findFirst({
            where: and(eq(receipts.id, req.params.id), eq(receipts.userId, userId)),
            columns: { status: true },
          });
          if (!existing) throw new HttpError(404, "Receipt not found");
          throw new HttpError(409, "Cannot modify a confirmed receipt");
        }

        // Get the next position.
        const existingLines = await tx.query.receiptLines.findMany({
          where: eq(receiptLines.receiptId, req.params.id),
          columns: { position: true },
        });
        const maxPosition = existingLines.reduce((max, l) => Math.max(max, l.position), -1);

        const body = req.body;

        // Validate catalogItemId ownership before linking (F3).
        if (body.catalogItemId != null) {
          await assertOwnedCatalogItem(tx, userId, body.catalogItemId);
        }

        const normalizedName = body.normalizedName ?? (body.rawText ? body.rawText.toLowerCase().trim().replace(/\s+/g, " ") : null);

        await tx.insert(receiptLines).values({
          receiptId: req.params.id,
          position: maxPosition + 1,
          rawText: body.rawText,
          normalizedName,
          catalogItemId: body.catalogItemId ?? null,
          quantityBase: body.quantityBase ?? null,
          unit: body.unit ?? null,
          pricePaise: body.pricePaise ?? null,
        });

        await recomputeTotal(tx, req.params.id);
        return loadReceiptWithLines(tx, userId, req.params.id);
      });
    },
  );

  // PUT /receipts/:id/lines/:lineId — manual line edit.
  r.put(
    "/receipts/:id/lines/:lineId",
    {
      schema: {
        params: ReceiptLineParams,
        body: UpdateReceiptLineSchema,
        response: { 200: ReceiptWithLinesSchema },
      },
    },
    async (req) => {
      const userId = req.session!.userId;

      return app.db.transaction(async (tx) => {
        // F9: Claim the non-confirmed receipt row with a locking UPDATE.
        const claimed = await tx
          .update(receipts)
          .set({ parsedAt: sql`"parsed_at"` })
          .where(
            and(
              eq(receipts.id, req.params.id),
              eq(receipts.userId, userId),
              ne(receipts.status, "confirmed"),
            ),
          )
          .returning({ id: receipts.id });

        if (claimed.length === 0) {
          const existing = await tx.query.receipts.findFirst({
            where: and(eq(receipts.id, req.params.id), eq(receipts.userId, userId)),
            columns: { status: true },
          });
          if (!existing) throw new HttpError(404, "Receipt not found");
          throw new HttpError(409, "Cannot modify a confirmed receipt");
        }

        const line = await tx.query.receiptLines.findFirst({
          where: and(
            eq(receiptLines.id, req.params.lineId),
            eq(receiptLines.receiptId, req.params.id),
          ),
          columns: { id: true },
        });
        if (!line) throw new HttpError(404, "Receipt line not found");

        const body = req.body;

        // Validate catalogItemId ownership before linking (F3).
        if (body.catalogItemId != null) {
          await assertOwnedCatalogItem(tx, userId, body.catalogItemId);
        }

        const updates: Partial<typeof receiptLines.$inferInsert> = {};
        if (body.rawText !== undefined) {
          updates.rawText = body.rawText;
          // Auto-recompute normalizedName if rawText changed and normalizedName not explicitly set.
          if (body.normalizedName === undefined) {
            updates.normalizedName = body.rawText.toLowerCase().trim().replace(/\s+/g, " ");
          }
        }
        if (body.normalizedName !== undefined) updates.normalizedName = body.normalizedName;
        if (body.catalogItemId !== undefined) updates.catalogItemId = body.catalogItemId;
        if (body.quantityBase !== undefined) updates.quantityBase = body.quantityBase;
        if (body.unit !== undefined) updates.unit = body.unit;
        if (body.pricePaise !== undefined) updates.pricePaise = body.pricePaise;

        if (Object.keys(updates).length > 0) {
          await tx
            .update(receiptLines)
            .set(updates)
            .where(and(eq(receiptLines.id, req.params.lineId), eq(receiptLines.receiptId, req.params.id)));
        }

        await recomputeTotal(tx, req.params.id);
        return loadReceiptWithLines(tx, userId, req.params.id);
      });
    },
  );

  // DELETE /receipts/:id/lines/:lineId — manual line delete.
  r.delete(
    "/receipts/:id/lines/:lineId",
    {
      schema: {
        params: ReceiptLineParams,
        response: { 204: z.void() },
      },
    },
    async (req, reply) => {
      const userId = req.session!.userId;

      await app.db.transaction(async (tx) => {
        // F9: Claim the non-confirmed receipt row with a locking UPDATE.
        const claimed = await tx
          .update(receipts)
          .set({ parsedAt: sql`"parsed_at"` })
          .where(
            and(
              eq(receipts.id, req.params.id),
              eq(receipts.userId, userId),
              ne(receipts.status, "confirmed"),
            ),
          )
          .returning({ id: receipts.id });

        if (claimed.length === 0) {
          const existing = await tx.query.receipts.findFirst({
            where: and(eq(receipts.id, req.params.id), eq(receipts.userId, userId)),
            columns: { status: true },
          });
          if (!existing) throw new HttpError(404, "Receipt not found");
          throw new HttpError(409, "Cannot modify a confirmed receipt");
        }

        const line = await tx.query.receiptLines.findFirst({
          where: and(
            eq(receiptLines.id, req.params.lineId),
            eq(receiptLines.receiptId, req.params.id),
          ),
          columns: { id: true },
        });
        if (!line) throw new HttpError(404, "Receipt line not found");

        await tx
          .delete(receiptLines)
          .where(and(eq(receiptLines.id, req.params.lineId), eq(receiptLines.receiptId, req.params.id)));

        await recomputeTotal(tx, req.params.id);
      });

      return reply.code(204).send();
    },
  );
}
