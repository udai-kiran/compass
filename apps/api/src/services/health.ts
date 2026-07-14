import type pg from "pg";
import type { Redis } from "ioredis";
import type { HealthStatus } from "@compass/shared";
import { pingPostgres } from "../infra/db.ts";
import { pingRedis } from "../infra/redis.ts";

export async function getHealth(pool: pg.Pool, redis: Redis): Promise<HealthStatus> {
  const [postgres, redisOk] = await Promise.all([pingPostgres(pool), pingRedis(redis)]);
  return { ok: postgres && redisOk, postgres, redis: redisOk };
}
