import type { Redis } from "ioredis";

/**
 * Version-stamped per-user cache: invalidation just bumps the version, old
 * keys age out via TTL. Write-through invalidation without key bookkeeping.
 */
export async function cached<T>(
  redis: Redis,
  userId: string,
  name: string,
  ttlSeconds: number,
  compute: () => Promise<T>,
): Promise<T> {
  const ver = (await redis.get(`cachever:${userId}`)) ?? "0";
  const key = `cache:${userId}:${ver}:${name}`;
  const hit = await redis.get(key);
  if (hit !== null) return JSON.parse(hit) as T;
  const value = await compute();
  await redis.set(key, JSON.stringify(value), "EX", ttlSeconds);
  return value;
}

export async function invalidateUserCache(redis: Redis, userId: string): Promise<void> {
  await redis.incr(`cachever:${userId}`);
}
