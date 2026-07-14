import cookie from "@fastify/cookie";
import type { FastifyInstance, FastifyReply } from "fastify";
import { getSession, SESSION_TTL_SECONDS } from "../services/session.ts";

export const SESSION_COOKIE = "compass_sid";

declare module "fastify" {
  interface FastifyRequest {
    session: { id: string; userId: string } | null;
  }
  interface FastifyContextConfig {
    public?: boolean;
  }
}

export function setSessionCookie(reply: FastifyReply, sessionId: string): void {
  reply.setCookie(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    sameSite: "lax",
    signed: true,
    path: "/",
    secure: reply.server.config.NODE_ENV === "production",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: "/" });
}

/**
 * Global auth guard: every route requires a valid Redis-backed session unless
 * it opts out with `config: { public: true }` (health, login, bootstrap).
 */
export async function setupAuth(app: FastifyInstance): Promise<void> {
  await app.register(cookie, { secret: app.config.SESSION_SECRET });
  app.decorateRequest("session", null);

  app.addHook("onRequest", async (req, reply) => {
    req.session = null;

    const raw = req.cookies[SESSION_COOKIE];
    if (raw) {
      const unsigned = req.unsignCookie(raw);
      if (unsigned.valid && unsigned.value) {
        const data = await getSession(app.redis, unsigned.value);
        if (data) req.session = { id: unsigned.value, userId: data.userId };
      }
    }

    // Unmatched routes fall through to the 404 handler.
    if (req.routeOptions.url === undefined) return;

    if (req.routeOptions.config.public !== true && req.session === null) {
      return reply
        .code(401)
        .send({ error: "Unauthorized", message: "Authentication required" });
    }
  });
}
