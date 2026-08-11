import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import type pg from "pg";
import * as schema from "./schema.ts";

export type Db = NodePgDatabase<typeof schema> & { readonly $client: pg.Pool };

/**
 * A live database or an in-progress transaction. Helpers typed with this can run
 * standalone or inside a caller's `db.transaction(...)` — derived from Db so it
 * needs no drizzle internals.
 */
export type DbOrTx = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

export function createDb(pool: pg.Pool): Db {
  return drizzle(pool, { schema }) as unknown as Db;
}

export { schema };
