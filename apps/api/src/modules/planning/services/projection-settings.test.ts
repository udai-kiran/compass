import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createDb } from "../../../db/index.ts";
import { createPool } from "../../../infra/db.ts";
import { users } from "../../../db/core-schema.ts";
import { getProjectionSettings, updateProjectionSettings } from "./projection-settings.ts";

// These need a real Postgres connection (DATABASE_URL) — this repo has no
// DB-mocking infrastructure (see services/user-tasks.test.ts's identical
// DB-backed section). Each test creates its own throwaway user(s) and cleans
// them up via t.after(); deleting the user cascades to its projection_settings
// row (see modules/planning/schema.ts's `onDelete: "cascade"`).

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "projection-settings.test.ts's DB-backed tests need DATABASE_URL set (a real Postgres " +
        "connection) — this repo has no DB-mocking infrastructure. Export it (see apps/api/.env) " +
        "before running `npm run test -w apps/api`.",
    );
  }
  return url;
}

const pool = createPool(requireDatabaseUrl());
const db = createDb(pool);
after(async () => {
  await pool.end();
});

async function createUser(): Promise<string> {
  const [u] = await db
    .insert(users)
    .values({
      email: `projection-settings-test-${randomUUID()}@example.invalid`,
      passwordHash: "x",
      displayName: "projection-settings.test.ts user",
    })
    .returning({ id: users.id });
  return u!.id;
}

async function cleanupUser(userId: string): Promise<void> {
  await db.delete(users).where(eq(users.id, userId));
}

test("getProjectionSettings returns the default equityReturnBps (1200) when no row exists", async (t) => {
  const userId = await createUser();
  t.after(async () => {
    await cleanupUser(userId);
  });

  const settings = await getProjectionSettings(db, userId);
  assert.equal(settings.equityReturnBps, 1200);
});

test("updateProjectionSettings validates and upserts a new row", async (t) => {
  const userId = await createUser();
  t.after(async () => {
    await cleanupUser(userId);
  });

  const result = await updateProjectionSettings(db, userId, { equityReturnBps: 900 });
  assert.equal(result.equityReturnBps, 900);

  const fetched = await getProjectionSettings(db, userId);
  assert.equal(fetched.equityReturnBps, 900);
});

test("updateProjectionSettings rejects an out-of-range equityReturnBps and leaves the row unchanged", async (t) => {
  const userId = await createUser();
  t.after(async () => {
    await cleanupUser(userId);
  });

  await assert.rejects(() => updateProjectionSettings(db, userId, { equityReturnBps: 10_001 }));

  const fetched = await getProjectionSettings(db, userId);
  assert.equal(fetched.equityReturnBps, 1200);
});

test("a second updateProjectionSettings call updates the existing row rather than inserting a duplicate", async (t) => {
  const userId = await createUser();
  t.after(async () => {
    await cleanupUser(userId);
  });

  await updateProjectionSettings(db, userId, { equityReturnBps: 900 });
  const second = await updateProjectionSettings(db, userId, { equityReturnBps: 1500 });
  assert.equal(second.equityReturnBps, 1500);

  const fetched = await getProjectionSettings(db, userId);
  assert.equal(fetched.equityReturnBps, 1500);
});

test("two different users' projection settings do not affect each other", async (t) => {
  const userA = await createUser();
  const userB = await createUser();
  t.after(async () => {
    await cleanupUser(userA);
    await cleanupUser(userB);
  });

  await updateProjectionSettings(db, userA, { equityReturnBps: 800 });
  await updateProjectionSettings(db, userB, { equityReturnBps: 1400 });

  const a = await getProjectionSettings(db, userA);
  const b = await getProjectionSettings(db, userB);
  assert.equal(a.equityReturnBps, 800);
  assert.equal(b.equityReturnBps, 1400);
});
