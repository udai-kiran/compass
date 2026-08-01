import assert from "node:assert/strict";
import test from "node:test";
import { CreateUserTaskSchema, UpdateUserTaskSchema, UserTaskSchema } from "./user-tasks.ts";

// ---------- AC2: title validation (empty / whitespace-only / boundary length) ----------

test("create: an empty title is rejected", () => {
  assert.throws(() => CreateUserTaskSchema.parse({ title: "" }));
});

test("create: a whitespace-only title is rejected (trimmed to empty)", () => {
  assert.throws(() => CreateUserTaskSchema.parse({ title: "   " }));
});

test("create: a title of exactly 200 chars is accepted", () => {
  const title = "a".repeat(200);
  assert.equal(CreateUserTaskSchema.parse({ title }).title, title);
});

test("create: a title of 201 chars is rejected", () => {
  assert.throws(() => CreateUserTaskSchema.parse({ title: "a".repeat(201) }));
});

test("update: an empty, whitespace-only, or 201-char title is rejected", () => {
  assert.throws(() => UpdateUserTaskSchema.parse({ title: "" }));
  assert.throws(() => UpdateUserTaskSchema.parse({ title: "   " }));
  assert.throws(() => UpdateUserTaskSchema.parse({ title: "a".repeat(201) }));
});

test("update: a title of exactly 200 chars is accepted", () => {
  const title = "b".repeat(200);
  assert.equal(UpdateUserTaskSchema.parse({ title }).title, title);
});

// ---------- create defaults/trim ----------

test("create: notes defaults to empty string and dueDate/transactionId default to unset", () => {
  assert.deepEqual(CreateUserTaskSchema.parse({ title: "Pay rent" }), {
    title: "Pay rent",
    notes: "",
  });
});

test("create: title and notes are trimmed", () => {
  const parsed = CreateUserTaskSchema.parse({ title: "  Pay rent  ", notes: "  urgent  " });
  assert.equal(parsed.title, "Pay rent");
  assert.equal(parsed.notes, "urgent");
});

test("create: notes over 4000 chars is rejected", () => {
  assert.throws(() => CreateUserTaskSchema.parse({ title: "Task", notes: "a".repeat(4001) }));
});

test("create: dueDate/transactionId accept null or a value", () => {
  assert.equal(CreateUserTaskSchema.parse({ title: "Task", dueDate: null }).dueDate, null);
  assert.equal(
    CreateUserTaskSchema.parse({ title: "Task", dueDate: "2026-05-01" }).dueDate,
    "2026-05-01",
  );
  const uuid = "3f6b1e2a-0000-4000-8000-000000000000";
  assert.equal(CreateUserTaskSchema.parse({ title: "Task", transactionId: null }).transactionId, null);
  assert.equal(
    CreateUserTaskSchema.parse({ title: "Task", transactionId: uuid }).transactionId,
    uuid,
  );
});

// ---------- update partial semantics: three-state fields, no completedAt input ----------

test("update: an empty partial update is accepted and returns an empty object", () => {
  assert.deepEqual(UpdateUserTaskSchema.parse({}), {});
});

test("update: a single-field partial update returns only that field", () => {
  assert.deepEqual(UpdateUserTaskSchema.parse({ notes: "updated" }), { notes: "updated" });
});

test("update: dueDate distinguishes absent, null, and a date (three states)", () => {
  assert.deepEqual(UpdateUserTaskSchema.parse({}), {});
  assert.deepEqual(UpdateUserTaskSchema.parse({ dueDate: null }), { dueDate: null });
  assert.deepEqual(UpdateUserTaskSchema.parse({ dueDate: "2026-06-01" }), { dueDate: "2026-06-01" });
});

test("update: transactionId distinguishes absent, null, and a uuid (three states)", () => {
  const uuid = "3f6b1e2a-0000-4000-8000-000000000001";
  assert.deepEqual(UpdateUserTaskSchema.parse({}), {});
  assert.deepEqual(UpdateUserTaskSchema.parse({ transactionId: null }), { transactionId: null });
  assert.deepEqual(UpdateUserTaskSchema.parse({ transactionId: uuid }), { transactionId: uuid });
});

test("update: accepts `completed` as a boolean command, not a raw `completedAt` timestamp", () => {
  assert.deepEqual(UpdateUserTaskSchema.parse({ completed: true }), { completed: true });
  assert.deepEqual(UpdateUserTaskSchema.parse({ completed: false }), { completed: false });
  // completedAt is not part of the update schema's shape at all — the server
  // is the only writer of that column.
  assert.ok(!("completedAt" in UpdateUserTaskSchema.shape));
});

test("update: notes has no default-refill behavior (unlike create) — omitted stays omitted", () => {
  assert.deepEqual(UpdateUserTaskSchema.parse({ title: "Renamed" }), { title: "Renamed" });
});

// ---------- response schema shape ----------

test("UserTaskSchema embeds a nullable transaction projection alongside transactionId", () => {
  const parsed = UserTaskSchema.parse({
    id: "3f6b1e2a-0000-4000-8000-000000000002",
    title: "Follow up",
    notes: "",
    dueDate: null,
    completedAt: null,
    transactionId: "3f6b1e2a-0000-4000-8000-000000000003",
    transaction: {
      id: "3f6b1e2a-0000-4000-8000-000000000003",
      accountId: "3f6b1e2a-0000-4000-8000-000000000004",
      date: "2026-01-05",
      merchant: "Cafe",
      amountPaise: -50000,
    },
    source: "user",
    sourceKey: null,
    createdAt: "2026-01-05T10:00:00.000Z",
    updatedAt: "2026-01-05T10:00:00.000Z",
  });
  assert.equal(parsed.transactionId, "3f6b1e2a-0000-4000-8000-000000000003");
  assert.equal(parsed.transaction?.merchant, "Cafe");
});

test("UserTaskSchema accepts source='card-due' with a sourceKey", () => {
  const parsed = UserTaskSchema.parse({
    id: "3f6b1e2a-0000-4000-8000-000000000007",
    title: "Pay Test Bank Card bill",
    notes: "",
    dueDate: "2026-01-10",
    completedAt: null,
    transactionId: null,
    transaction: null,
    source: "card-due",
    sourceKey: "3f6b1e2a-0000-4000-8000-000000000008:2026-01-10",
    createdAt: "2026-01-05T10:00:00.000Z",
    updatedAt: "2026-01-05T10:00:00.000Z",
  });
  assert.equal(parsed.source, "card-due");
  assert.equal(parsed.sourceKey, "3f6b1e2a-0000-4000-8000-000000000008:2026-01-10");
});

test("UserTaskSchema rejects a source value outside the enum", () => {
  assert.throws(() =>
    UserTaskSchema.parse({
      id: "3f6b1e2a-0000-4000-8000-000000000009",
      title: "Follow up",
      notes: "",
      dueDate: null,
      completedAt: null,
      transactionId: null,
      transaction: null,
      source: "bogus",
      sourceKey: null,
      createdAt: "2026-01-05T10:00:00.000Z",
      updatedAt: "2026-01-05T10:00:00.000Z",
    }),
  );
});

test("UserTaskSchema: a retained transactionId with a null transaction (soft-deleted link) parses fine", () => {
  const parsed = UserTaskSchema.parse({
    id: "3f6b1e2a-0000-4000-8000-000000000005",
    title: "Follow up",
    notes: "",
    dueDate: null,
    completedAt: null,
    transactionId: "3f6b1e2a-0000-4000-8000-000000000006",
    transaction: null,
    source: "user",
    sourceKey: null,
    createdAt: "2026-01-05T10:00:00.000Z",
    updatedAt: "2026-01-05T10:00:00.000Z",
  });
  assert.equal(parsed.transactionId, "3f6b1e2a-0000-4000-8000-000000000006");
  assert.equal(parsed.transaction, null);
});
