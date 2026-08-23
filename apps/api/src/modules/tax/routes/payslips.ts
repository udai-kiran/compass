/**
 * payslips.ts — Payslip upload/parse/review routes (task 13.2).
 *
 * Registered under the /api/tax prefix; paths here are RELATIVE:
 *   POST   /payslips           → POST   /api/tax/payslips    (upload + parse)
 *   GET    /payslips           → GET    /api/tax/payslips    (list for FY)
 *   GET    /payslips/:id       → GET    /api/tax/payslips/:id
 *   POST   /payslips/:id/accept → POST  /api/tax/payslips/:id/accept
 *   POST   /payslips/:id/reject → POST  /api/tax/payslips/:id/reject
 *   POST   /payslips/manual    → POST   /api/tax/payslips/manual
 *
 * Session-authenticated. Demo sessions are automatically rejected on all
 * mutating methods by the single chokepoint in `plugins/auth.ts`.
 *
 * Privacy (D1): POST /payslips runs PII redaction before model call.
 * Vision path requires explicit visionConsent=true multipart field.
 * D2: AI disabled → POST /payslips returns 503 with pointer to /manual.
 * D3: accept/reject are guarded atomic UPDATE WHERE status='pending'.
 * D4: GET /payslips includes fyTdsPaise aggregate in response.
 */

import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { effectiveModel, type AiObserver } from "@compass/ai";
import {
  PayslipSchema,
  PayslipListSchema,
  GetPayslipsQuerySchema,
  CreateManualPayslipBodySchema,
  AcceptPayslipBodySchema,
  ParsePayslipResponseSchema,
  FySchema,
} from "@compass/shared";
import { HttpError } from "../../../lib/errors.ts";
import { getAiSettings } from "../../automation/services/ai-settings.ts";
import { recordAiEvent } from "../../automation/services/events.ts";
import {
  getPayslip,
  listPayslips,
  acceptPayslip,
  rejectPayslip,
  createManualPayslip,
} from "../services/payslip-review.ts";
import { parsePayslip } from "../services/payslip-parse.ts";

// ─── Allowed upload types ────────────────────────────────────────────────────

/** PDF magic bytes: %PDF */
function isPdf(data: Buffer): boolean {
  return data.length >= 4 && data.toString("ascii", 0, 4) === "%PDF";
}

/** JPEG magic bytes */
function isJpeg(data: Buffer): boolean {
  return data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
}

/** PNG magic bytes */
function isPng(data: Buffer): boolean {
  return (
    data.length >= 8 &&
    data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  );
}

const ALLOWED_CONTENT_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

/** Maximum upload size: 20 MB (PDFs can be larger than images). */
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

function validateMagicBytes(mimeType: string, data: Buffer): boolean {
  if (mimeType === "application/pdf") return isPdf(data);
  if (mimeType === "image/jpeg") return isJpeg(data);
  if (mimeType === "image/png") return isPng(data);
  // webp: RIFF....WEBP
  if (mimeType === "image/webp") {
    return (
      data.length >= 12 &&
      data.toString("latin1", 0, 4) === "RIFF" &&
      data.toString("latin1", 8, 12) === "WEBP"
    );
  }
  return false;
}

// ─── Params schemas ───────────────────────────────────────────────────────────

const PayslipParams = z.object({ id: z.uuid() });

// ─── Routes ──────────────────────────────────────────────────────────────────

export async function payslipRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  /**
   * POST /payslips — Upload and AI-parse a payslip document.
   *
   * Multipart fields:
   *   - file (required): PDF or image of the payslip
   *   - fy (required): financial year, e.g. "2025-26"
   *   - extractedText (optional): pre-extracted PDF text (avoids vision)
   *   - visionConsent (optional): "true" to consent to vision path
   *
   * Returns ParsePayslipResponse: { available, message?, payslip? }
   * When AI is disabled, available=false with pointer to /payslips/manual (D2).
   */
  r.post(
    "/payslips",
    {
      schema: {
        response: { 200: ParsePayslipResponseSchema },
      },
    },
    async (req) => {
      const userId = req.session!.userId;

      const file = await req.file({ limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } });
      if (!file) throw new HttpError(400, "Expected a multipart file field named 'file'");

      const buffer = await file.toBuffer();

      if (file.file.truncated) {
        throw new HttpError(413, `File exceeds the ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))} MB limit`);
      }

      const mimeType = file.mimetype;
      if (!ALLOWED_CONTENT_TYPES.has(mimeType)) {
        throw new HttpError(
          415,
          `Unsupported file type ${mimeType} — allowed: application/pdf, image/jpeg, image/png, image/webp`,
        );
      }

      if (!validateMagicBytes(mimeType, buffer)) {
        throw new HttpError(415, "File content does not match its declared type");
      }

      // Extract form fields from multipart.
      const rawFy = file.fields.fy;
      const fyValue = rawFy && "value" in rawFy ? String(rawFy.value) : undefined;
      if (!fyValue) throw new HttpError(400, "Missing required field: fy");
      const fyResult = FySchema.safeParse(fyValue);
      if (!fyResult.success) throw new HttpError(400, fyResult.error.issues[0]?.message ?? "Invalid fy");

      const rawExtractedText = file.fields.extractedText;
      const extractedText =
        rawExtractedText && "value" in rawExtractedText
          ? String(rawExtractedText.value) || undefined
          : undefined;

      const rawVisionConsent = file.fields.visionConsent;
      const visionConsent =
        rawVisionConsent && "value" in rawVisionConsent
          ? String(rawVisionConsent.value) === "true"
          : false;

      // Resolve AI settings for the event log.
      const meta = await getAiSettings(app.db, userId);
      const model = effectiveModel(meta.provider, meta.model);

      // Observer: logs the redacted request context + response, never raw content (D1).
      const observe: AiObserver = (obs) =>
        void recordAiEvent(app.db, userId, {
          kind: "payslip_parse",
          status: obs.ok ? "ok" : "error",
          provider: meta.provider,
          model,
          title: `payslip ${fyValue}`,
          requestContext: obs.request,
          responseRaw: obs.response,
          latencyMs: obs.latencyMs,
          error: obs.error ?? null,
        });

      // Load user identity for redaction — best-effort (empty if profile missing).
      const identity = await loadUserIdentity(app.db, userId);

      const result = await parsePayslip(
        {
          db: app.db,
          storage: app.storage,
          secret: app.config.MAILBOX_SECRET || app.config.SESSION_SECRET,
          allowedBaseUrls: app.config.AI_ALLOWED_BASE_URLS,
        },
        userId,
        fyValue,
        {
          buffer,
          contentType: mimeType,
          extractedText,
          identity,
          visionConsent,
        },
        observe,
      );

      if (!result.available) {
        return { available: false, message: result.message };
      }

      if (!result.payslipId) {
        return { available: true, message: result.message };
      }

      const payslip = await getPayslip(app.db, userId, result.payslipId);
      return { available: true, payslip };
    },
  );

  /**
   * GET /payslips?fy=2025-26
   *
   * Lists all payslips for the authenticated user and the given FY.
   * Includes fyTdsPaise = SUM(tds_current_paise) over accepted payslips (D4).
   */
  r.get(
    "/payslips",
    {
      schema: {
        querystring: GetPayslipsQuerySchema,
        response: { 200: PayslipListSchema },
      },
    },
    async (req) => {
      const { fy } = req.query;
      const userId = req.session!.userId;
      return listPayslips(app.db, userId, fy);
    },
  );

  /**
   * GET /payslips/:id
   *
   * Returns a single payslip with its components.
   */
  r.get(
    "/payslips/:id",
    {
      schema: {
        params: PayslipParams,
        response: { 200: PayslipSchema },
      },
    },
    async (req) => {
      const { id } = req.params;
      const userId = req.session!.userId;
      return getPayslip(app.db, userId, id);
    },
  );

  /**
   * POST /payslips/:id/accept
   *
   * Accept a pending payslip, applying optional reviewer corrections atomically.
   * Guarded state transition: pending → accepted (D3).
   */
  r.post(
    "/payslips/:id/accept",
    {
      schema: {
        params: PayslipParams,
        body: AcceptPayslipBodySchema,
        response: { 200: PayslipSchema },
      },
    },
    async (req) => {
      const { id } = req.params;
      const userId = req.session!.userId;
      return acceptPayslip(app.db, userId, id, req.body);
    },
  );

  /**
   * POST /payslips/:id/reject
   *
   * Reject a pending payslip.
   * Guarded state transition: pending → rejected (D3).
   */
  r.post(
    "/payslips/:id/reject",
    {
      schema: {
        params: PayslipParams,
        response: { 200: PayslipSchema },
      },
    },
    async (req) => {
      const { id } = req.params;
      const userId = req.session!.userId;
      return rejectPayslip(app.db, userId, id);
    },
  );

  /**
   * POST /payslips/manual
   *
   * Manual payslip entry — no AI involved (D2).
   * Creates the payslip directly in accepted state (user is the source of truth).
   */
  r.post(
    "/payslips/manual",
    {
      schema: {
        body: CreateManualPayslipBodySchema,
        response: { 200: PayslipSchema },
      },
    },
    async (req) => {
      const userId = req.session!.userId;
      const { fy, payMonth, employerName, grossPaise, netPaise, tdsCurrentPaise, tdsYtdPaise, components } = req.body;
      return createManualPayslip(app.db, userId, {
        fy,
        payMonth,
        employerName,
        grossPaise,
        netPaise,
        tdsCurrentPaise,
        tdsYtdPaise,
        components,
      });
    },
  );
}

// ─── Identity loader ──────────────────────────────────────────────────────────

/**
 * Load user identity for PII redaction. Best-effort: returns empty identity
 * (structural-only redaction) if the user profile does not exist or fails.
 */
async function loadUserIdentity(
  db: import("../../../db/index.ts").Db,
  userId: string,
): Promise<import("@compass/shared").RedactionIdentity> {
  try {
    const { users } = await import("../../../db/core-schema.ts");
    const { eq } = await import("drizzle-orm");
    const [user] = await db
      .select({ displayName: users.displayName, email: users.email })
      .from(users)
      .where(eq(users.id, userId));
    return {
      names: user?.displayName ? [user.displayName] : [],
      emails: user?.email ? [user.email] : [],
      upiIds: [],
    };
  } catch {
    return { names: [], emails: [], upiIds: [] };
  }
}
