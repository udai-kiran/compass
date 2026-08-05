import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  NotificationPrefSchema,
  NotificationsPageSchema,
  UpsertNotificationPrefSchema,
} from "@compass/shared";
import {
  archiveNotification,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "../services/notifications.ts";
import { listPrefs, upsertPref } from "../services/prefs.ts";

const OkResponse = z.object({ ok: z.boolean() });

export async function notificationRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    "/api/notifications",
    { schema: { response: { 200: NotificationsPageSchema } } },
    async (req) => listNotifications(app.db, req.session!.userId),
  );

  r.post(
    "/api/notifications/:id/read",
    { schema: { params: z.object({ id: z.uuid() }), response: { 200: OkResponse } } },
    async (req) => {
      await markNotificationRead(app.db, req.session!.userId, req.params.id);
      return { ok: true };
    },
  );

  r.post(
    "/api/notifications/read-all",
    { schema: { response: { 200: OkResponse } } },
    async (req) => {
      await markAllNotificationsRead(app.db, req.session!.userId);
      return { ok: true };
    },
  );

  r.post(
    "/api/notifications/:id/archive",
    { schema: { params: z.object({ id: z.uuid() }), response: { 200: OkResponse } } },
    async (req) => {
      await archiveNotification(app.db, req.session!.userId, req.params.id);
      return { ok: true };
    },
  );

  r.get(
    "/api/notification-prefs",
    { schema: { response: { 200: z.array(NotificationPrefSchema) } } },
    async (req) => listPrefs(app.db, req.session!.userId),
  );

  r.put(
    "/api/notification-prefs",
    { schema: { body: UpsertNotificationPrefSchema, response: { 200: NotificationPrefSchema } } },
    async (req) => upsertPref(app.db, req.session!.userId, req.body),
  );
}
