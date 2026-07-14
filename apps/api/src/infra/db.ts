import pg from "pg";

export function createPool(databaseUrl: string): pg.Pool {
  return new pg.Pool({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 3000,
    max: 10,
    idleTimeoutMillis: 30_000,
  });
}

export async function pingPostgres(pool: pg.Pool): Promise<boolean> {
  try {
    await pool.query("select 1");
    return true;
  } catch {
    return false;
  }
}
