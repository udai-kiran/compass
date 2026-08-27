import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Queue } from "bullmq";
import { createDb } from "../../../db/index.ts";
import { createPool } from "../../../infra/db.ts";
import { users } from "../../../db/schema.ts";
import { emailIngestions } from "../schema.ts";
import { HttpError } from "../../../lib/errors.ts";
import { retryIngestion } from "./ingestions.ts";

// DB-backed service test: needs a real Postgres connection (DATABASE_URL) —
// this repo has no DB-mocking infrastructure (same harness convention as
// inbox.test.ts): real Postgres, a throwaway user per test, fixture-scoped
// assertions, cleanup in t.after(). The BullMQ queue side needs no real Redis
// though: retryIngestion only calls getJob()/add(), which this file fakes.
function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "ingestions.test.ts's DB-backed tests need DATABASE_URL set (a real Postgres connection) — " +
        "this repo has no DB-mocking infrastructure. Export it (see apps/api/.env) before " +
        "running `npm run test -w apps/api`.",
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
      email: `ingestions-test-${randomUUID()}@example.invalid`,
      passwordHash: "x",
      displayName: "ingestions.test.ts user",
    })
    .returning({ id: users.id });
  return u!.id;
}

async function createIngestion(
  userId: string,
  status: "pending" | "processing" | "extracted" | "deferred" | "ignored" | "failed" = "failed",
): Promise<string> {
  const [i] = await db
    .insert(emailIngestions)
    .values({
      userId,
      messageId: `ingestions-test-${randomUUID()}`,
      fromAddr: "alerts@bank.example",
      subject: "Transaction alert",
      raw: "raw",
      status,
    })
    .returning({ id: emailIngestions.id });
  return i!.id;
}

async function cleanupUser(userId: string): Promise<void> {
  await db.delete(emailIngestions).where(eq(emailIngestions.userId, userId));
  await db.delete(users).where(eq(users.id, userId));
}

/** Hand-written fake for the two Queue methods retryIngestion uses — no Redis. */
class FakeQueue {
  existing: { getState: () => Promise<string>; remove: () => Promise<void> } | undefined;
  calls: Array<{ jobId: string; data: { ingestionId: string }; opts: Record<string, unknown> }> =
    [];
  order: string[] = [];
  getJobCalls = 0;

  async getJob(_id: string) {
    this.getJobCalls += 1;
    return this.existing;
  }

  async add(
    name: string,
    data: { ingestionId: string },
    opts: Record<string, unknown>,
  ): Promise<void> {
    this.order.push("add");
    this.calls.push({ jobId: String(opts.jobId), data, opts });
    void name;
  }

  /** A retained job whose getState() resolves to `state`; remove() records into `order`. */
  setExisting(state: string) {
    this.existing = {
      getState: async () => state,
      remove: async () => {
        this.order.push("remove");
      },
    };
  }
}

function asQueue(fake: FakeQueue): Queue {
  return fake as unknown as Queue;
}

test("retryIngestion: an ingestion owned by the calling user is enqueued with jobId = ingestionId and data = { ingestionId }", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const ingestionId = await createIngestion(userId);

  const fake = new FakeQueue();
  await retryIngestion(db, asQueue(fake), userId, ingestionId);

  assert.equal(fake.calls.length, 1);
  assert.equal(fake.calls[0]!.jobId, ingestionId);
  assert.deepEqual(fake.calls[0]!.data, { ingestionId });
  assert.equal(fake.calls[0]!.opts.removeOnFail, 500);
});

test("retryIngestion: an ingestion belonging to a different user 404s and never reaches the queue", async (t) => {
  const userA = await createUser();
  const userB = await createUser();
  t.after(async () => {
    await cleanupUser(userA);
    await cleanupUser(userB);
  });
  const ingestionId = await createIngestion(userA);

  const fake = new FakeQueue();
  await assert.rejects(
    retryIngestion(db, asQueue(fake), userB, ingestionId),
    (e: unknown) => e instanceof HttpError && e.statusCode === 404,
  );
  assert.equal(fake.calls.length, 0);
});

test("retryIngestion: a nonexistent ingestion id 404s", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));

  const fake = new FakeQueue();
  await assert.rejects(
    retryIngestion(db, asQueue(fake), userId, randomUUID()),
    (e: unknown) => e instanceof HttpError && e.statusCode === 404,
  );
  assert.equal(fake.calls.length, 0);
});

test("retryIngestion: an ingestion that is not currently failed is rejected (409) and never reaches the queue", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const ingestionId = await createIngestion(userId, "extracted");

  const fake = new FakeQueue();
  await assert.rejects(
    retryIngestion(db, asQueue(fake), userId, ingestionId),
    (e: unknown) => e instanceof HttpError && e.statusCode === 409,
  );
  assert.equal(fake.calls.length, 0);
  assert.equal(
    fake.getJobCalls,
    0,
    "the 409 guard must reject before any queue interaction, not just before add()",
  );
});

test("retryIngestion: a retained failed job is removed before a fresh job is added (jobId-dedupe guard)", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const ingestionId = await createIngestion(userId);

  const fake = new FakeQueue();
  fake.setExisting("failed");
  await retryIngestion(db, asQueue(fake), userId, ingestionId);

  assert.deepEqual(
    fake.order,
    ["remove", "add"],
    "remove() must run before add() so BullMQ's jobId dedupe can't no-op the retry",
  );
});
