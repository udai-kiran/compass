import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  CardActivitySchema,
  CardDetailsSchema,
  CardHolderSummarySchema,
  CardIssuerSettingsSchema,
  CardStatementSchema,
  CreateRewardEntrySchema,
  RewardEntrySchema,
  StatementReconciliationSchema,
  UpsertCardDetailsSchema,
  UpsertCardIssuerSettingsSchema,
} from "@compass/shared";
import { HttpError } from "../../../lib/errors.ts";
import {
  getCardActivity,
  listCardHolders,
  setCardStatementPassword,
  upsertCardDetails,
  upsertIssuerSettings,
} from "../services/cards.ts";
import { addRewardEntry, deleteRewardEntry, listRewards } from "../services/rewards.ts";
import { listReconciliations } from "../services/reconciliation-reads.ts";
import { absorbCarryover, recomputeReconciliation } from "../services/reconciliation-writes.ts";
import {
  deleteCardStatement,
  listCardStatements,
  readCardStatement,
  saveCardStatement,
} from "../services/card-statements.ts";
import { MAX_ATTACHMENT_BYTES } from "../../ledger/services/attachments.ts";
import { mailboxSecret } from "../../ingest/services/mailboxes.ts";

const AccountParams = z.object({ accountId: z.uuid() });
const RewardParams = z.object({ accountId: z.uuid(), id: z.uuid() });

export async function cardRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    "/api/cards",
    { schema: { response: { 200: z.array(CardHolderSummarySchema) } } },
    async (req) => listCardHolders(app.db, req.session!.userId),
  );

  r.put(
    "/api/cards/:accountId/details",
    {
      schema: {
        params: AccountParams,
        body: UpsertCardDetailsSchema,
        response: { 200: CardDetailsSchema },
      },
    },
    async (req) => upsertCardDetails(app.db, req.session!.userId, req.params.accountId, req.body),
  );

  r.put(
    "/api/card-issuers/settings",
    {
      schema: {
        body: UpsertCardIssuerSettingsSchema,
        response: { 200: CardIssuerSettingsSchema },
      },
    },
    async (req) => upsertIssuerSettings(app.db, req.session!.userId, req.body),
  );

  r.put(
    "/api/cards/:accountId/statement-password",
    {
      schema: {
        params: AccountParams,
        body: z.object({ password: z.string().max(200) }),
        response: { 200: z.object({ hasStatementPassword: z.boolean() }) },
      },
    },
    async (req) =>
      setCardStatementPassword(
        app.db,
        req.session!.userId,
        req.params.accountId,
        req.body.password,
        mailboxSecret(app.config),
      ),
  );

  r.get(
    "/api/cards/:accountId/activity",
    { schema: { params: AccountParams, response: { 200: CardActivitySchema } } },
    async (req) => getCardActivity(app.db, req.session!.userId, req.params.accountId),
  );

  r.get(
    "/api/cards/:accountId/rewards",
    { schema: { params: AccountParams, response: { 200: z.array(RewardEntrySchema) } } },
    async (req) => listRewards(app.db, req.session!.userId, req.params.accountId),
  );

  r.get(
    "/api/cards/:accountId/reconciliations",
    { schema: { params: AccountParams, response: { 200: z.array(StatementReconciliationSchema) } } },
    async (req) => listReconciliations(app.db, req.session!.userId, req.params.accountId),
  );

  // Re-derive a cycle's match stats from the current ledger. The extractor's
  // snapshot is point-in-time, so accepting the statement's lines afterwards
  // leaves it stale; this is the repair path.
  r.post(
    "/api/cards/:accountId/reconciliations/:id/recompute",
    { schema: { params: RewardParams, response: { 200: StatementReconciliationSchema } } },
    async (req) =>
      recomputeReconciliation(app.db, req.session!.userId, req.params.accountId, req.params.id),
  );

  // Absorb a statement's carried-forward balance into the card's opening
  // balance (see tasks/cc-recon-02-carryover-seed). No request body — the
  // server recomputes drift itself; no client-supplied amount is ever
  // trusted. Reuses the recompute route's combined accountId/id params
  // schema rather than duplicating it. Demo-mode blocked automatically
  // (mutating method).
  r.post(
    "/api/cards/:accountId/reconciliations/:id/absorb-carryover",
    { schema: { params: RewardParams, response: { 200: StatementReconciliationSchema } } },
    async (req) =>
      absorbCarryover(
        app.db,
        app.redis,
        req.session!.userId,
        req.params.accountId,
        req.params.id,
      ),
  );

  r.post(
    "/api/cards/:accountId/rewards",
    {
      schema: {
        params: AccountParams,
        body: CreateRewardEntrySchema,
        response: { 201: RewardEntrySchema },
      },
    },
    async (req, reply) =>
      reply
        .code(201)
        .send(await addRewardEntry(app.db, req.session!.userId, req.params.accountId, req.body)),
  );

  r.delete(
    "/api/cards/:accountId/rewards/:id",
    { schema: { params: RewardParams, response: { 200: z.object({ ok: z.boolean() }) } } },
    async (req) => {
      await deleteRewardEntry(app.db, req.session!.userId, req.params.accountId, req.params.id);
      return { ok: true };
    },
  );

  // ---- statements (PDF/image uploads stored in MinIO, per card) ----

  r.get(
    "/api/cards/:accountId/statements",
    { schema: { params: AccountParams, response: { 200: z.array(CardStatementSchema) } } },
    async (req) => listCardStatements(app.db, req.session!.userId, req.params.accountId),
  );

  // multipart body — schema validation not applicable; period rides as ?period=
  app.post("/api/cards/:accountId/statements", async (req, reply) => {
    const { accountId } = AccountParams.parse(req.params);
    const period = z
      .object({ period: z.iso.date().nullable().default(null) })
      .parse(req.query).period;
    const file = await req.file({ limits: { fileSize: MAX_ATTACHMENT_BYTES, files: 1 } });
    if (!file) throw new HttpError(400, "Expected a multipart file field");
    const data = await file.toBuffer();
    const statement = await saveCardStatement(
      app.db,
      app.storage,
      req.session!.userId,
      accountId,
      { fileName: file.filename, mimeType: file.mimetype, data },
      period,
    );
    return reply.code(201).send(statement);
  });

  app.get("/api/card-statements/:id", async (req, reply) => {
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const { meta, data } = await readCardStatement(app.db, app.storage, req.session!.userId, id);
    return reply
      .header("content-type", meta.mimeType)
      .header("content-disposition", `inline; filename="${encodeURIComponent(meta.fileName)}"`)
      .send(data);
  });

  r.delete(
    "/api/cards/:accountId/statements/:id",
    { schema: { params: RewardParams, response: { 200: z.object({ ok: z.boolean() }) } } },
    async (req) => {
      await deleteCardStatement(
        app.db,
        app.storage,
        req.session!.userId,
        req.params.accountId,
        req.params.id,
      );
      return { ok: true };
    },
  );
}
