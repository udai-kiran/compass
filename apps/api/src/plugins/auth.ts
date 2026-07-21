import cookie from "@fastify/cookie";
import type { FastifyInstance, FastifyReply } from "fastify";
import { getSession, SESSION_TTL_SECONDS } from "../services/session.ts";

export const SESSION_COOKIE = "compass_sid";

declare module "fastify" {
  interface FastifyRequest {
    session: { id: string; userId: string; demo: boolean } | null;
  }
  interface FastifyContextConfig {
    public?: boolean;
  }
}

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
/** The only write a demo session may perform — ending its own session. */
const DEMO_WRITE_ALLOWLIST = new Set(["/api/auth/logout"]);

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
        if (data) req.session = { id: unsigned.value, userId: data.userId, demo: data.demo === true };
      }
    }

    // Unmatched routes fall through to the 404 handler.
    if (req.routeOptions.url === undefined) return;

    if (req.routeOptions.config.public !== true && req.session === null) {
      return reply
        .code(401)
        .send({ error: "Unauthorized", message: "Authentication required" });
    }

    // Read-only demo: reject every state-changing request from a demo session at
    // this single chokepoint, so the seeded demo data can never be altered.
    if (
      req.session?.demo &&
      MUTATING_METHODS.has(req.method) &&
      !DEMO_WRITE_ALLOWLIST.has(req.routeOptions.url ?? "")
    ) {
      return reply
        .code(403)
        .send({ error: "DemoReadOnly", message: "This is a read-only demo — sign up to make changes." });
    }
  });
}
