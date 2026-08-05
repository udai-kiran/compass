import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  BootstrapStatusSchema,
  CapabilitiesSchema,
  ChangePasswordSchema,
  LoginRequestSchema,
  RegisterRequestSchema,
  SessionInfoSchema,
  UpdateProfileSchema,
  UserSchema,
} from "@compass/shared";
import { HttpError } from "../../../lib/errors.ts";
import { changePassword, registerUser, updateProfile, verifyLogin } from "../services/auth.ts";
import { createSession, destroySession, listSessions } from "../services/session.ts";
import { ensureDemoData } from "../services/demo.ts";
import { countUsers, findUserById } from "../services/users.ts";
import { clearSessionCookie, setSessionCookie } from "../../../plugins/auth.ts";
import { getAiSettings, getUserAiProvider } from "../../automation/services/ai-settings.ts";
import { mailboxSecret } from "../../ingest/services/mailboxes.ts";

export async function authRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    "/api/auth/bootstrap",
    {
      config: { public: true },
      schema: { response: { 200: BootstrapStatusSchema } },
    },
    async () => ({
      needsBootstrap: (await countUsers(app.db)) === 0,
      demoAvailable: app.config.DEMO_ENABLED,
      signupEnabled: app.config.SIGNUP_ENABLED,
    }),
  );

  // Public: start a read-only demo session (data seeded on first use). Every
  // write from the resulting session is rejected by the auth guard.
  r.post(
    "/api/auth/demo",
    { config: { public: true }, schema: { response: { 200: UserSchema } } },
    async (req, reply) => {
      if (!app.config.DEMO_ENABLED) throw new HttpError(404, "Demo is not enabled");
      const demoUserId = await ensureDemoData(app.db, app.config);
      const row = await findUserById(app.db, demoUserId);
      if (!row) throw new HttpError(500, "Demo account could not be prepared");
      setSessionCookie(reply, await createSession(app.redis, row.id, { demo: true }));
      return { id: row.id, email: row.email, displayName: row.displayName, isDemo: true };
    },
  );

  r.post(
    "/api/auth/register",
    {
      config: { public: true },
      schema: { body: RegisterRequestSchema, response: { 201: UserSchema } },
    },
    async (req, reply) => {
      if (!app.config.SIGNUP_ENABLED) {
        throw new HttpError(403, "Registration is closed on this instance");
      }
      const user = await registerUser(app.db, req.body);
      setSessionCookie(reply, await createSession(app.redis, user.id));
      return reply.code(201).send(user);
    },
  );

  r.post(
    "/api/auth/login",
    {
      config: { public: true },
      schema: { body: LoginRequestSchema, response: { 200: UserSchema } },
    },
    async (req, reply) => {
      const user = await verifyLogin(app.db, req.body.email, req.body.password);
      if (!user) throw new HttpError(401, "Invalid email or password");
      setSessionCookie(reply, await createSession(app.redis, user.id));
      return user;
    },
  );

  r.post(
    "/api/auth/logout",
    { schema: { response: { 200: z.object({ ok: z.boolean() }) } } },
    async (req, reply) => {
      if (req.session) await destroySession(app.redis, req.session.id);
      clearSessionCookie(reply);
      return { ok: true };
    },
  );

  r.get("/api/auth/me", { schema: { response: { 200: UserSchema } } }, async (req) => {
    const row = await findUserById(app.db, req.session!.userId);
    if (!row) throw new HttpError(401, "Session user no longer exists");
    return { id: row.id, email: row.email, displayName: row.displayName, isDemo: row.isDemo };
  });

  r.patch(
    "/api/auth/profile",
    { schema: { body: UpdateProfileSchema, response: { 200: UserSchema } } },
    async (req) => updateProfile(app.db, req.session!.userId, req.body.displayName),
  );

  r.post(
    "/api/auth/password",
    { schema: { body: ChangePasswordSchema, response: { 200: z.object({ ok: z.boolean() }) } } },
    async (req) => {
      await changePassword(
        app.db,
        req.session!.userId,
        req.body.currentPassword,
        req.body.newPassword,
      );
      return { ok: true };
    },
  );

  r.get(
    "/api/auth/sessions",
    { schema: { response: { 200: z.array(SessionInfoSchema) } } },
    async (req) => {
      const sessions = await listSessions(app.redis, req.session!.userId);
      return sessions.map((s) => ({ ...s, current: s.id === req.session!.id }));
    },
  );

  r.delete(
    "/api/auth/sessions/:id",
    {
      schema: {
        params: z.object({ id: z.string() }),
        response: { 200: z.object({ ok: z.boolean() }) },
      },
    },
    async (req) => {
      // only revoke sessions that belong to this user
      const own = await listSessions(app.redis, req.session!.userId);
      if (!own.some((s) => s.id === req.params.id)) throw new HttpError(404, "Session not found");
      await destroySession(app.redis, req.params.id);
      return { ok: true };
    },
  );

  r.get("/api/capabilities", { schema: { response: { 200: CapabilitiesSchema } } }, async (req) => {
    // Resolved from the caller's stored config: the factory downgrades to the
    // NullProvider when a provider is selected but its key/URL is missing.
    const settings = await getAiSettings(app.db, req.session!.userId);
    const provider = await getUserAiProvider(
      app.db,
      req.session!.userId,
      mailboxSecret(app.config),
      app.config.AI_ALLOWED_BASE_URLS,
    );
    const aiEnabled = provider.enabled;
    return {
      aiProvider: aiEnabled ? settings.provider : "none",
      aiEnabled,
      features: { categorization: aiEnabled, assistant: aiEnabled, summaries: aiEnabled },
      currency: "INR",
      locale: "en-IN",
    };
  });
}
