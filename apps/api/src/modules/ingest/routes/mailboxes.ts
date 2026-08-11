import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  AddMailboxSchema,
  MailboxAccountSchema,
  MailboxCredentialsStatusSchema,
  QueueSyncResultSchema,
  QueueSyncSchema,
} from "@compass/shared";
import {
  addMailboxFromBundle,
  getCredentialsStatus,
  listMailboxes,
  mailboxSecret,
  removeMailbox,
  resetMailboxWatermark,
} from "../services/mailboxes.ts";
import { enqueueIngestorRun } from "../../../jobs/index.ts";

/**
 * Per-user mailbox management for the email→transaction pipeline. Users onboard
 * a mailbox by pasting the bundle the local `connect` CLI printed; the client
 * secret and refresh token are encrypted at rest and never returned.
 */
export async function mailboxRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    "/api/mailboxes",
    { schema: { response: { 200: z.array(MailboxAccountSchema) } } },
    async (req) => listMailboxes(app.db, req.session!.userId),
  );

  r.get(
    "/api/mailboxes/credentials",
    { schema: { response: { 200: MailboxCredentialsStatusSchema } } },
    async (req) => getCredentialsStatus(app.db, req.session!.userId),
  );

  r.post(
    "/api/mailboxes",
    { schema: { body: AddMailboxSchema, response: { 200: MailboxAccountSchema } } },
    async (req) =>
      addMailboxFromBundle(app.db, req.session!.userId, req.body.bundle, mailboxSecret(app.config)),
  );

  r.delete(
    "/api/mailboxes/:id",
    { schema: { params: z.object({ id: z.uuid() }), response: { 200: z.object({ ok: z.literal(true) }) } } },
    async (req) => {
      await removeMailbox(app.db, req.session!.userId, req.params.id);
      return { ok: true as const };
    },
  );

  // Queue an ingestor sync pass. It runs after the chosen window (a rolling
  // delay); repeated requests within the window coalesce into a single run.
  r.post(
    "/api/mailboxes/sync",
    { schema: { body: QueueSyncSchema, response: { 200: QueueSyncResultSchema } } },
    async (req) => {
      const windowMinutes = req.body.windowMinutes;
      await enqueueIngestorRun(app, req.session!.userId, windowMinutes);
      return { ok: true as const, runsInMinutes: windowMinutes };
    },
  );

  r.post(
    "/api/mailboxes/:id/reset-watermark",
    { schema: { params: z.object({ id: z.uuid() }), response: { 200: z.object({ ok: z.literal(true) }) } } },
    async (req) => {
      await resetMailboxWatermark(app.db, req.session!.userId, req.params.id);
      return { ok: true as const };
    },
  );
}
