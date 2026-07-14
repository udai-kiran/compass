import argon2 from "argon2";
import { eq } from "drizzle-orm";
import { loadConfig } from "../config.ts";
import { seedDefaultCategories } from "../services/categories.ts";
import { createPool } from "../infra/db.ts";
import { createDb } from "./index.ts";
import { users } from "./schema.ts";

const config = loadConfig();
const pool = createPool(config.DATABASE_URL);
const db = createDb(pool);

const demoUser = {
  email: "demo@compass.local",
  displayName: "Demo User",
  passwordHash: await argon2.hash("demo1234", { type: argon2.argon2id }),
};

const inserted = await db.insert(users).values(demoUser).onConflictDoNothing().returning();
console.log(
  inserted.length > 0
    ? `seeded demo user: ${demoUser.email} (password: demo1234)`
    : `demo user already present: ${demoUser.email}`,
);

const owner =
  inserted[0] ?? (await db.query.users.findFirst({ where: eq(users.email, demoUser.email) }))!;
await seedDefaultCategories(db, owner.id);
console.log("default categories ensured");

await pool.end();
