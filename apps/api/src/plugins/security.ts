import type { FastifyInstance, FastifyRequest } from "fastify";

/**
 * Security hardening: response headers, CSRF origin checks, and Redis-backed
 * rate limiting. All three are plain hooks so the API keeps a minimal
 * dependency footprint (no @fastify/helmet / rate-limit / csrf).
 */

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Fixed-window rate-limit buckets, chosen per request category. */
interface Bucket {
  name: string;
  limit: number;
  windowSeconds: number;
}

const AUTH_BUCKET: Bucket = { name: "auth", limit: 15, windowSeconds: 300 };
const WRITE_BUCKET: Bucket = { name: "write", limit: 120, windowSeconds: 60 };
const READ_BUCKET: Bucket = { name: "read", limit: 600, windowSeconds: 60 };

/** Auth endpoints are the brute-force surface and get the tightest bucket. */
function bucketFor(req: FastifyRequest): Bucket {
  const url = req.url.split("?")[0] ?? "";
  if (/^\/api\/auth\/(login|register|password)/.test(url)) return AUTH_BUCKET;
  if (MUTATING.has(req.method)) return WRITE_BUCKET;
  return READ_BUCKET;
}

/** Hostname without port — matches Fastify's `req.hostname`, so same-host
 * origins on any port (e.g. the dev SPA on :5173 → API on :3002) are treated
 * as same-site. */
function hostOf(value: string): string | null {
  try {
    return new URL(value).hostname;
  } catch {
    return null;
  }
}

export async function setupSecurity(app: FastifyInstance): Promise<void> {
  const trusted = new Set(
    app.config.TRUSTED_ORIGINS.split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => hostOf(s) ?? s),
  );
  const rateLimitOn = !app.config.RATE_LIMIT_DISABLED && app.config.NODE_ENV !== "test";

  // --- security headers on every response ---
  app.addHook("onSend", async (req, reply) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("Cross-Origin-Opener-Policy", "same-origin");
    reply.header("X-DNS-Prefetch-Control", "off");
    // API only ever returns data/files — lock the resource policy right down.
    reply.header("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
    // HSTS only over a real TLS connection (respects X-Forwarded-Proto via trustProxy).
    if (req.protocol === "https") {
      reply.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
  });

  app.addHook("onRequest", async (req, reply) => {
    // --- CSRF: verify the browser Origin on state-changing requests ---
    // The session cookie is httpOnly + SameSite=Lax + signed; verifying Origin
    // closes the residual gap. Non-browser clients (no Origin) are unaffected.
    if (MUTATING.has(req.method)) {
      const origin = req.headers.origin;
      if (origin) {
        const oh = hostOf(origin);
        // req.hostname respects X-Forwarded-Host under trustProxy.
        if (oh !== req.hostname && !(oh && trusted.has(oh))) {
          return reply
            .code(403)
            .send({ error: "Forbidden", message: "Cross-origin request rejected" });
        }
      }
    }

    // --- rate limiting (fixed window in Redis) ---
    if (rateLimitOn) {
      const bucket = bucketFor(req);
      const key = `rl:${bucket.name}:${req.ip}`;
      const count = await app.redis.incr(key);
      if (count === 1) await app.redis.expire(key, bucket.windowSeconds);
      if (count > bucket.limit) {
        const ttl = await app.redis.ttl(key);
        reply.header("Retry-After", String(ttl > 0 ? ttl : bucket.windowSeconds));
        return reply
          .code(429)
          .send({ error: "Too Many Requests", message: "Rate limit exceeded, please slow down" });
      }
    }
  });
}

export const _test = { bucketFor, hostOf, AUTH_BUCKET, WRITE_BUCKET, READ_BUCKET };
