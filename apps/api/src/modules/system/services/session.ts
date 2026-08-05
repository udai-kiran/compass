import { randomBytes } from "node:crypto";
import type { Redis } from "ioredis";

const PREFIX = "sess:";
const USER_PREFIX = "sess-user:";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days, sliding

export interface SessionData {
  userId: string;
  createdAt: string;
  /** a read-only demo session — every write is rejected by the auth guard */
  demo?: boolean;
}

export async function createSession(
  redis: Redis,
  userId: string,
  opts: { demo?: boolean } = {},
): Promise<string> {
  const id = randomBytes(32).toString("hex");
  const data: SessionData = { userId, createdAt: new Date().toISOString() };
  if (opts.demo) data.demo = true;
  await redis.set(PREFIX + id, JSON.stringify(data), "EX", SESSION_TTL_SECONDS);
  await redis.sadd(USER_PREFIX + userId, id);
  return id;
}

export async function getSession(redis: Redis, id: string): Promise<SessionData | null> {
  const raw = await redis.get(PREFIX + id);
  if (raw === null) return null;
  await redis.expire(PREFIX + id, SESSION_TTL_SECONDS);
  return JSON.parse(raw) as SessionData;
}

export async function destroySession(redis: Redis, id: string): Promise<void> {
  const raw = await redis.get(PREFIX + id);
  if (raw !== null) {
    const { userId } = JSON.parse(raw) as SessionData;
    await redis.srem(USER_PREFIX + userId, id);
  }
  await redis.del(PREFIX + id);
}

/** Active sessions for a user; prunes ids whose session key has expired. */
export async function listSessions(
  redis: Redis,
  userId: string,
): Promise<Array<{ id: string; createdAt: string }>> {
  const ids = await redis.smembers(USER_PREFIX + userId);
  const out: Array<{ id: string; createdAt: string }> = [];
  for (const id of ids) {
    const raw = await redis.get(PREFIX + id);
    if (raw === null) {
      await redis.srem(USER_PREFIX + userId, id);
      continue;
    }
    const data = JSON.parse(raw) as SessionData;
    out.push({ id, createdAt: data.createdAt });
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
