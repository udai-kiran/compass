import { Redis } from "ioredis";

export function createRedis(redisUrl: string): Redis {
  const redis = new Redis(redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    connectTimeout: 3000,
  });
  // Health checks report connectivity; don't let ioredis crash the process on ECONNREFUSED.
  redis.on("error", () => {});
  return redis;
}

export async function pingRedis(redis: Redis): Promise<boolean> {
  try {
    if (redis.status === "wait" || redis.status === "end") {
      await redis.connect();
    }
    return (await redis.ping()) === "PONG";
  } catch {
    return false;
  }
}
