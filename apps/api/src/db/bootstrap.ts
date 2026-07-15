/**
 * Deploy-time bootstrap: applies migrations, then ensures the owner account
 * exists. Run by the compose `migrate` service before the API starts.
 *
 * Uses drizzle-orm's programmatic migrator rather than drizzle-kit, which is a
 * devDependency and absent from the production image.
 *
 * Idempotent: safe to re-run on every deploy.
 */
import path from "node:path";
import argon2 from "argon2";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { loadConfig } from "../config.ts";
import { createPool } from "../infra/db.ts";
import { createUser, findUserByEmail } from "../repositories/users.ts";
import { seedDefaultCategories } from "../services/categories.ts";
import { createDb, type Db } from "./index.ts";

const MIN_PASSWORD_LENGTH = 8;

async function ensureOwner(db: Db, email: string, password: string) {
  // The unique index on users.email is the real guard; this check keeps the
  // re-run path quiet instead of relying on a constraint violation.
  const existing = await findUserByEmail(db, email);
  if (existing) {
    console.log(`owner already present: ${email} — leaving password untouched`);
    return;
  }

  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  const row = await createUser(db, { email, passwordHash, displayName: "Owner" });
  await seedDefaultCategories(db, row.id);
  console.log(`created owner: ${email}`);
}

const config = loadConfig();
const email = config.OWNER_EMAIL.toLowerCase();

if (config.OWNER_PASSWORD.length < MIN_PASSWORD_LENGTH) {
  console.error(
    config.OWNER_PASSWORD === ""
      ? "OWNER_PASSWORD is not set — add it to .env so compose can pass it through."
      : `OWNER_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters.`,
  );
  process.exit(1);
}

const pool = createPool(config.DATABASE_URL);
const db = createDb(pool);

try {
  // Resolved from this file, so the script works regardless of cwd.
  await migrate(db, { migrationsFolder: path.join(import.meta.dirname, "../../drizzle") });
  console.log("migrations applied");
  await ensureOwner(db, email, config.OWNER_PASSWORD);
} finally {
  await pool.end();
}
