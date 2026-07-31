import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, or } from "drizzle-orm";
import type { AccountType, ExtractedTransaction } from "@compass/shared";
import { createDb } from "../db/index.ts";
import { createPool } from "../infra/db.ts";
import {
  accounts,
  emailIngestions,
  extractedTransactions,
  transactions,
  transferLinks,
  users,
} from "../db/schema.ts";
import { HttpError } from "../lib/errors.ts";
import { createTransaction } from "./transactions.ts";
import {
  acceptExtracted,
  acceptTransfer,
  historyKey,
  listInbox,
  listOrphanedAccepts,
  pickHistoryCategories,
  pickTransferPairs,
  rejectExtracted,
  restoreOrphan,
} from "./inbox.ts";

type Row = { merchant: string; categoryId: string; kind: "income" | "expense"; date: string };

type Draft = {
  id: string;
  direction: "debit" | "credit";
  amountPaise: number;
  occurredAt: string | null;
  suggestedAccountId: string | null;
};
const draft = (id: string, direction: "debit" | "credit", over: Partial<Draft> = {}): Draft => ({
  id,
  direction,
  amountPaise: 500000,
  occurredAt: "2026-07-10",
  suggestedAccountId: null,
  ...over,
});

test("pickHistoryCategories: the most-used category per merchant wins", () => {
  const rows: Row[] = [
    { merchant: "Swiggy", categoryId: "food", kind: "expense", date: "2026-07-01" },
    { merchant: "Swiggy", categoryId: "food", kind: "expense", date: "2026-07-05" },
    { merchant: "Swiggy", categoryId: "misc", kind: "expense", date: "2026-07-10" }, // one-off slip
  ];
  const best = pickHistoryCategories(rows);
  assert.equal(best.get(historyKey("Swiggy", "expense")), "food"); // count beats a lone recent outlier
});

test("pickHistoryCategories: spend vs refund split by kind, independently", () => {
  const rows: Row[] = [
    { merchant: "Amazon", categoryId: "shopping", kind: "expense", date: "2026-07-02" },
    { merchant: "Amazon", categoryId: "refunds", kind: "income", date: "2026-07-03" },
  ];
  const best = pickHistoryCategories(rows);
  assert.equal(best.get(historyKey("Amazon", "expense")), "shopping");
  assert.equal(best.get(historyKey("Amazon", "income")), "refunds");
});

test("pickHistoryCategories: a tie is broken by the most recent use", () => {
  const rows: Row[] = [
    { merchant: "Uber", categoryId: "transport", kind: "expense", date: "2026-07-01" },
    { merchant: "Uber", categoryId: "travel", kind: "expense", date: "2026-07-09" },
  ];
  const best = pickHistoryCategories(rows);
  assert.equal(best.get(historyKey("Uber", "expense")), "travel"); // 1–1, newer wins
});

test("pickHistoryCategories: no history yields no suggestion", () => {
  assert.equal(pickHistoryCategories([]).size, 0);
});

test("pickTransferPairs: a debit + matching credit within the window pairs both ways", () => {
  const pairs = pickTransferPairs([
    draft("out", "debit", { suggestedAccountId: "hdfc", occurredAt: "2026-07-10" }),
    draft("in", "credit", { suggestedAccountId: "icici", occurredAt: "2026-07-11" }),
  ]);
  assert.equal(pairs.get("out"), "in");
  assert.equal(pairs.get("in"), "out");
});

test("pickTransferPairs: unequal amounts, out-of-window, or same account don't pair", () => {
  // different amount
  assert.equal(pickTransferPairs([draft("o", "debit"), draft("i", "credit", { amountPaise: 400000 })]).size, 0);
  // beyond the 3-day window
  assert.equal(
    pickTransferPairs([
      draft("o", "debit", { occurredAt: "2026-07-01" }),
      draft("i", "credit", { occurredAt: "2026-07-10" }),
    ]).size,
    0,
  );
  // same known account — a reversal, not a transfer
  assert.equal(
    pickTransferPairs([
      draft("o", "debit", { suggestedAccountId: "hdfc" }),
      draft("i", "credit", { suggestedAccountId: "hdfc" }),
    ]).size,
    0,
  );
  // a leg with no date can't be placed in the window
  assert.equal(pickTransferPairs([draft("o", "debit", { occurredAt: null }), draft("i", "credit")]).size, 0);
});

test("pickTransferPairs: an ambiguous match is left unpaired", () => {
  // one debit, two equal same-day credits → can't tell which; pair nothing
  const pairs = pickTransferPairs([
    draft("out", "debit"),
    draft("in1", "credit"),
    draft("in2", "credit"),
  ]);
  assert.equal(pairs.size, 0);
});

// ---------- DB-backed regression coverage for cc-recon-03-orphaned-accepts:
// listOrphanedAccepts, restoreOrphan, and rejectExtracted's atomic-guard
// rewrite. ----------
//
// Needs a real Postgres connection (DATABASE_URL) — this repo has no
// DB-mocking infrastructure (same harness convention as recurring.test.ts):
// real Postgres, a throwaway user (or two) per test, fixture-scoped
// assertions, cleanup in t.after(). No claim of isolated/ephemeral test
// infrastructure beyond what CI actually configures (a service Postgres for
// CI only — see commit ce5030a); locally this points at the shared dev DB.

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "inbox.test.ts's DB-backed tests need DATABASE_URL set (a real Postgres connection) — " +
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

const BASE_DATE = "2026-01-05";

async function createUser(): Promise<string> {
  const [u] = await db
    .insert(users)
    .values({
      email: `inbox-test-${randomUUID()}@example.invalid`,
      passwordHash: "x",
      displayName: "inbox.test.ts user",
    })
    .returning({ id: users.id });
  return u!.id;
}

async function createAccount(userId: string, type: AccountType = "bank"): Promise<string> {
  const [a] = await db
    .insert(accounts)
    .values({ userId, name: `Test ${type}`, type, openingBalancePaise: 0 })
    .returning({ id: accounts.id });
  return a!.id;
}

async function createIngestion(userId: string): Promise<string> {
  const [i] = await db
    .insert(emailIngestions)
    .values({
      userId,
      messageId: `inbox-test-${randomUUID()}`,
      fromAddr: "alerts@bank.example",
      subject: "Transaction alert",
      raw: "raw",
      status: "extracted",
    })
    .returning({ id: emailIngestions.id });
  return i!.id;
}

type DraftOverrides = Partial<{
  amountPaise: number;
  direction: "debit" | "credit";
  occurredAt: string | null;
  suggestedAccountId: string | null;
  status: "pending" | "accepted" | "rejected" | "duplicate";
  transactionId: string | null;
  matchedTransactionId: string | null;
  dedupeHash: string | null;
}>;

async function createDraft(userId: string, ingestionId: string, over: DraftOverrides = {}): Promise<string> {
  const [d] = await db
    .insert(extractedTransactions)
    .values({
      userId,
      ingestionId,
      amountPaise: over.amountPaise ?? 500000,
      direction: over.direction ?? "debit",
      occurredAt: over.occurredAt === undefined ? BASE_DATE : over.occurredAt,
      counterparty: "Test Merchant",
      suggestedAccountId: over.suggestedAccountId ?? null,
      sourceQuote: "",
      confidence: 0.9,
      dedupeHash: over.dedupeHash === undefined ? `inbox-test-${randomUUID()}` : over.dedupeHash,
      status: over.status ?? "pending",
      transactionId: over.transactionId ?? null,
      matchedTransactionId: over.matchedTransactionId ?? null,
    })
    .returning({ id: extractedTransactions.id });
  return d!.id;
}

async function draftRow(id: string) {
  const [row] = await db.select().from(extractedTransactions).where(eq(extractedTransactions.id, id));
  return row;
}

/** Accept a pending draft the normal way, returning the resulting DTO (transactionId set). */
async function acceptDraft(
  userId: string,
  draftId: string,
  accountId: string,
  amountPaise = 500000,
  direction: "debit" | "credit" = "debit",
) {
  return acceptExtracted(db, userId, draftId, {
    accountId,
    occurredAt: BASE_DATE,
    amountPaise,
    direction,
    merchant: "Test Merchant",
    categoryId: null,
  });
}

/** `acceptTransfer` returns a general array; this pins it to the fixed 2-tuple every call site expects. */
async function acceptTransferPair(
  userId: string,
  input: { outId: string; inId: string; fromAccountId: string; toAccountId: string; occurredAt: string },
): Promise<[ExtractedTransaction, ExtractedTransaction]> {
  const result = await acceptTransfer(db, userId, input);
  return [result[0]!, result[1]!];
}

async function hardDeleteTransaction(transactionId: string): Promise<void> {
  await db.delete(transactions).where(eq(transactions.id, transactionId));
}

async function softDeleteTransaction(transactionId: string): Promise<void> {
  await db.update(transactions).set({ deletedAt: new Date() }).where(eq(transactions.id, transactionId));
}

async function cleanupUser(userId: string): Promise<void> {
  await db.delete(extractedTransactions).where(eq(extractedTransactions.userId, userId));
  await db.delete(emailIngestions).where(eq(emailIngestions.userId, userId));
  await db.delete(transactions).where(eq(transactions.userId, userId));
  await db.delete(accounts).where(eq(accounts.userId, userId));
  await db.delete(users).where(eq(users.id, userId));
}

/**
 * Fixture for a "healthy" orphan: accept a pending draft into the ledger,
 * then hard-delete its transaction (the FK is ON DELETE SET NULL) — this is
 * exactly how a real orphan comes to exist, not a hand-written row.
 */
async function makeOrphan(userId: string, accountId: string, ingestionId: string): Promise<string> {
  const draftId = await createDraft(userId, ingestionId);
  const accepted = await acceptDraft(userId, draftId, accountId);
  await hardDeleteTransaction(accepted.transactionId!);
  return draftId;
}

/** A resolvable gate: `opened` resolves once `release()` is called. */
function makeGate(): { opened: Promise<void>; release: () => void } {
  let release!: () => void;
  const opened = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { opened, release };
}

// ---------- listOrphanedAccepts (AC1) ----------

test("listOrphanedAccepts: only accepted+transactionId-null rows are listed; pending/rejected/duplicate/healthy-accepted are not", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const accountId = await createAccount(userId);
  const ingestionId = await createIngestion(userId);

  const orphanId = await makeOrphan(userId, accountId, ingestionId);

  const pendingId = await createDraft(userId, ingestionId);

  const rejectedDraftId = await createDraft(userId, ingestionId);
  await rejectExtracted(db, userId, rejectedDraftId);

  const duplicateId = await createDraft(userId, ingestionId, { status: "duplicate" });

  const healthyDraftId = await createDraft(userId, ingestionId);
  const healthyAccepted = await acceptDraft(userId, healthyDraftId, accountId);
  assert.ok(healthyAccepted.transactionId);

  const orphans = await listOrphanedAccepts(db, userId);
  const orphanIds = orphans.map((o) => o.id);
  assert.ok(orphanIds.includes(orphanId));
  assert.ok(!orphanIds.includes(pendingId));
  assert.ok(!orphanIds.includes(rejectedDraftId));
  assert.ok(!orphanIds.includes(duplicateId));
  assert.ok(!orphanIds.includes(healthyDraftId));
});

// ---------- restoreOrphan (AC2) ----------

test("restoreOrphan: an orphan becomes pending and leaves the orphaned list", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const accountId = await createAccount(userId);
  const ingestionId = await createIngestion(userId);
  const orphanId = await makeOrphan(userId, accountId, ingestionId);

  const restored = await restoreOrphan(db, userId, orphanId);
  assert.equal(restored.status, "pending");
  assert.equal(restored.transactionId, null);

  const orphans = await listOrphanedAccepts(db, userId);
  assert.ok(!orphans.map((o) => o.id).includes(orphanId));

  const pending = await listInbox(db, userId, "pending");
  assert.ok(pending.map((p) => p.id).includes(orphanId));
});

test("restoreOrphan: a healthy accepted row (transaction still exists) 409s", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const accountId = await createAccount(userId);
  const ingestionId = await createIngestion(userId);
  const draftId = await createDraft(userId, ingestionId);
  await acceptDraft(userId, draftId, accountId);

  await assert.rejects(
    restoreOrphan(db, userId, draftId),
    (e: unknown) => e instanceof HttpError && e.statusCode === 409,
  );
});

test("restoreOrphan: pending, rejected, and duplicate rows all 409 — none is an orphaned accept", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const ingestionId = await createIngestion(userId);

  const pendingId = await createDraft(userId, ingestionId);
  await assert.rejects(
    restoreOrphan(db, userId, pendingId),
    (e: unknown) => e instanceof HttpError && e.statusCode === 409,
  );

  const rejectedId = await createDraft(userId, ingestionId);
  await rejectExtracted(db, userId, rejectedId);
  await assert.rejects(
    restoreOrphan(db, userId, rejectedId),
    (e: unknown) => e instanceof HttpError && e.statusCode === 409,
  );

  const duplicateId = await createDraft(userId, ingestionId, { status: "duplicate" });
  await assert.rejects(
    restoreOrphan(db, userId, duplicateId),
    (e: unknown) => e instanceof HttpError && e.statusCode === 409,
  );
});

test("restoreOrphan: a missing id and a cross-user id both 404", async (t) => {
  const userA = await createUser();
  const userB = await createUser();
  t.after(async () => {
    await cleanupUser(userA);
    await cleanupUser(userB);
  });
  const accountId = await createAccount(userA);
  const ingestionId = await createIngestion(userA);
  const orphanId = await makeOrphan(userA, accountId, ingestionId);

  await assert.rejects(
    restoreOrphan(db, userA, randomUUID()),
    (e: unknown) => e instanceof HttpError && e.statusCode === 404,
  );
  await assert.rejects(
    restoreOrphan(db, userB, orphanId),
    (e: unknown) => e instanceof HttpError && e.statusCode === 404,
  );
});

test("restoreOrphan: an orphan whose ingestion belongs to another user does not leak that user's subject/from (falls back to empty string)", async (t) => {
  const userA = await createUser();
  const userB = await createUser();
  t.after(async () => {
    await cleanupUser(userA);
    await cleanupUser(userB);
  });
  const accountId = await createAccount(userA);
  const foreignIngestionId = await createIngestion(userB);
  const orphanId = await makeOrphan(userA, accountId, foreignIngestionId);

  const dto = await restoreOrphan(db, userA, orphanId);
  assert.equal(dto.subject, "");
  assert.equal(dto.fromAddr, "");
});

test("restoreOrphan: a second restore on the same id 409s", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const accountId = await createAccount(userId);
  const ingestionId = await createIngestion(userId);
  const orphanId = await makeOrphan(userId, accountId, ingestionId);

  await restoreOrphan(db, userId, orphanId);
  await assert.rejects(
    restoreOrphan(db, userId, orphanId),
    (e: unknown) => e instanceof HttpError && e.statusCode === 409,
  );
});

// ---------- rejectExtracted's atomic-guard rewrite (AC3) ----------

test("rejectExtracted: an orphan is dismissed to rejected", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const accountId = await createAccount(userId);
  const ingestionId = await createIngestion(userId);
  const orphanId = await makeOrphan(userId, accountId, ingestionId);

  const rejected = await rejectExtracted(db, userId, orphanId);
  assert.equal(rejected.status, "rejected");
  const row = await draftRow(orphanId);
  assert.equal(row?.status, "rejected");
});

test("rejectExtracted: a healthy accepted row 409s", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const accountId = await createAccount(userId);
  const ingestionId = await createIngestion(userId);
  const draftId = await createDraft(userId, ingestionId);
  await acceptDraft(userId, draftId, accountId);

  await assert.rejects(
    rejectExtracted(db, userId, draftId),
    (e: unknown) => e instanceof HttpError && e.statusCode === 409,
  );
  const row = await draftRow(draftId);
  assert.equal(row?.status, "accepted");
});

test("rejectExtracted: pending and duplicate rows still reject (guarded, unchanged semantics)", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const ingestionId = await createIngestion(userId);

  const pendingId = await createDraft(userId, ingestionId);
  const rejectedPending = await rejectExtracted(db, userId, pendingId);
  assert.equal(rejectedPending.status, "rejected");

  const duplicateId = await createDraft(userId, ingestionId, { status: "duplicate" });
  const rejectedDuplicate = await rejectExtracted(db, userId, duplicateId);
  assert.equal(rejectedDuplicate.status, "rejected");
});

test("rejectExtracted: a cross-user id 404s", async (t) => {
  const userA = await createUser();
  const userB = await createUser();
  t.after(async () => {
    await cleanupUser(userA);
    await cleanupUser(userB);
  });
  const ingestionId = await createIngestion(userA);
  const draftId = await createDraft(userA, ingestionId);

  await assert.rejects(
    rejectExtracted(db, userB, draftId),
    (e: unknown) => e instanceof HttpError && e.statusCode === 404,
  );
});

// ---------- guard atomicity: serial (the predicate, not a stale read, decides) ----------

test("guard atomicity (serial): after an orphan is restored and re-accepted, reject 409s", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const accountId = await createAccount(userId);
  const ingestionId = await createIngestion(userId);
  const orphanId = await makeOrphan(userId, accountId, ingestionId);

  await restoreOrphan(db, userId, orphanId);
  const reaccepted = await acceptDraft(userId, orphanId, accountId);
  assert.ok(reaccepted.transactionId);

  await assert.rejects(
    rejectExtracted(db, userId, orphanId),
    (e: unknown) => e instanceof HttpError && e.statusCode === 409,
  );
  const row = await draftRow(orphanId);
  assert.equal(row?.status, "accepted");
});

// ---------- guard atomicity: real contention (two connections) ----------
//
// Connection A opens an explicit db.transaction() and performs its guarded
// UPDATE inside it (row-locked, uncommitted) — held open via a gate promise.
// Connection B (the shared `db`, a separate pool connection) concurrently
// issues its own guarded operation, which must block on A's row lock. A
// short real-time window is used to positively assert B is still pending
// (blocked) before A commits, then A's gate is released and B's outcome —
// decided by Postgres re-evaluating B's WHERE predicate against the
// post-commit row (EvalPlanQual), not a stale read — is asserted.

test("guard atomicity under real contention: restore holds the row lock; a concurrent reject blocks, then succeeds against the now-pending row once restore commits", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const accountId = await createAccount(userId);
  const ingestionId = await createIngestion(userId);
  const orphanId = await makeOrphan(userId, accountId, ingestionId);

  const started = makeGate();
  const release = makeGate();
  let restoreStatus: string | undefined;

  const aTxPromise = db.transaction(async (tx) => {
    const restored = await restoreOrphan(tx, userId, orphanId);
    restoreStatus = restored.status;
    started.release();
    await release.opened;
  });
  await started.opened;

  const bPromise = rejectExtracted(db, userId, orphanId);
  let bSettled = false;
  void bPromise.then(
    () => {
      bSettled = true;
    },
    () => {
      bSettled = true;
    },
  );
  await new Promise((r) => setTimeout(r, 250));
  assert.equal(bSettled, false, "B (reject) should still be blocked on A's held row lock");

  release.release();
  await aTxPromise;
  assert.equal(restoreStatus, "pending");

  const bResult = await bPromise;
  assert.equal(bResult.status, "rejected");

  const row = await draftRow(orphanId);
  assert.equal(row?.status, "rejected");
});

test("guard atomicity under real contention: when the held transaction's committed path is restore→accept, a concurrent reject 409s and the healthy accepted row is never rejected", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const accountId = await createAccount(userId);
  const ingestionId = await createIngestion(userId);
  const orphanId = await makeOrphan(userId, accountId, ingestionId);

  const started = makeGate();
  const release = makeGate();
  let newTransactionId: string | undefined;

  const aTxPromise = db.transaction(async (tx) => {
    await restoreOrphan(tx, userId, orphanId);
    const txn = await createTransaction(tx, userId, {
      accountId,
      date: BASE_DATE,
      amountPaise: -500000,
      merchant: "Re-accepted inline",
      categoryId: null,
      notes: "",
      tags: [],
      source: "import",
    });
    newTransactionId = txn.id;
    await tx
      .update(extractedTransactions)
      .set({ status: "accepted", transactionId: txn.id, updatedAt: new Date() })
      .where(and(eq(extractedTransactions.id, orphanId), eq(extractedTransactions.userId, userId)));
    started.release();
    await release.opened;
  });
  await started.opened;

  const bPromise = rejectExtracted(db, userId, orphanId);
  let bSettled = false;
  void bPromise.then(
    () => {
      bSettled = true;
    },
    () => {
      bSettled = true;
    },
  );
  await new Promise((r) => setTimeout(r, 250));
  assert.equal(bSettled, false, "B (reject) should still be blocked on A's held row lock");

  release.release();
  await aTxPromise;

  await assert.rejects(
    bPromise,
    (e: unknown) => e instanceof HttpError && e.statusCode === 409,
  );

  const row = await draftRow(orphanId);
  assert.equal(row?.status, "accepted");
  assert.equal(row?.transactionId, newTransactionId);
});

test("guard atomicity under real contention: two concurrent restores — exactly one wins, the loser 409s", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const accountId = await createAccount(userId);
  const ingestionId = await createIngestion(userId);
  const orphanId = await makeOrphan(userId, accountId, ingestionId);

  const started = makeGate();
  const release = makeGate();

  const aTxPromise = db.transaction(async (tx) => {
    await restoreOrphan(tx, userId, orphanId);
    started.release();
    await release.opened;
  });
  await started.opened;

  const bPromise = restoreOrphan(db, userId, orphanId);
  let bSettled = false;
  void bPromise.then(
    () => {
      bSettled = true;
    },
    () => {
      bSettled = true;
    },
  );
  await new Promise((r) => setTimeout(r, 250));
  assert.equal(bSettled, false, "B (restore) should still be blocked on A's held row lock");

  release.release();
  await aTxPromise;

  await assert.rejects(
    bPromise,
    (e: unknown) => e instanceof HttpError && e.statusCode === 409,
  );

  const row = await draftRow(orphanId);
  assert.equal(row?.status, "pending");
});

// ---------- soft-deleted transactions are NOT orphans ----------

test("listOrphanedAccepts / restoreOrphan: a soft-deleted (not hard-deleted) referenced transaction is NOT an orphan", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const accountId = await createAccount(userId);
  const ingestionId = await createIngestion(userId);
  const draftId = await createDraft(userId, ingestionId);
  const accepted = await acceptDraft(userId, draftId, accountId);
  await softDeleteTransaction(accepted.transactionId!);

  const orphans = await listOrphanedAccepts(db, userId);
  assert.ok(!orphans.map((o) => o.id).includes(draftId));

  await assert.rejects(
    restoreOrphan(db, userId, draftId),
    (e: unknown) => e instanceof HttpError && e.statusCode === 409,
  );
});

// ---------- transfer reconstruction, through re-acceptance (P3b) ----------

test("transfer reconstruction: one leg hard-deleted, restored, and re-accepted relinks to the surviving leg when uniquely matchable", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const accountA = await createAccount(userId, "bank");
  const accountB = await createAccount(userId, "bank");
  const ingestionId = await createIngestion(userId);

  const outDraftId = await createDraft(userId, ingestionId, {
    direction: "debit",
    amountPaise: 400000,
    suggestedAccountId: accountA,
  });
  const inDraftId = await createDraft(userId, ingestionId, {
    direction: "credit",
    amountPaise: 400000,
    suggestedAccountId: accountB,
  });

  const [outResult, inResult] = await acceptTransferPair(userId, {
    outId: outDraftId,
    inId: inDraftId,
    fromAccountId: accountA,
    toAccountId: accountB,
    occurredAt: BASE_DATE,
  });
  assert.ok(outResult.transactionId);
  assert.ok(inResult.transactionId);

  // Hard-deleting one leg cascades away the transfer_links row (the out/in
  // transaction FKs are ON DELETE CASCADE), leaving the surviving leg
  // unlinked but still a healthy accepted draft.
  await hardDeleteTransaction(outResult.transactionId!);
  const linksAfterDelete = await db
    .select()
    .from(transferLinks)
    .where(
      or(
        eq(transferLinks.outTransactionId, inResult.transactionId!),
        eq(transferLinks.inTransactionId, inResult.transactionId!),
      ),
    );
  assert.equal(linksAfterDelete.length, 0);

  const orphans = await listOrphanedAccepts(db, userId);
  assert.ok(orphans.map((o) => o.id).includes(outDraftId));

  await restoreOrphan(db, userId, outDraftId);
  const reaccepted = await acceptDraft(userId, outDraftId, accountA, 400000, "debit");
  assert.ok(reaccepted.transactionId);

  const newLinks = await db
    .select()
    .from(transferLinks)
    .where(
      or(
        eq(transferLinks.outTransactionId, reaccepted.transactionId!),
        eq(transferLinks.inTransactionId, reaccepted.transactionId!),
      ),
    );
  assert.equal(newLinks.length, 1);
  assert.equal(newLinks[0]!.inTransactionId, inResult.transactionId);
});

test("transfer reconstruction: restoring and re-accepting with a non-matching amount leaves an ordinary unlinked transaction (no-match case)", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const accountA = await createAccount(userId, "bank");
  const accountB = await createAccount(userId, "bank");
  const ingestionId = await createIngestion(userId);

  const outDraftId = await createDraft(userId, ingestionId, {
    direction: "debit",
    amountPaise: 400000,
    suggestedAccountId: accountA,
  });
  const inDraftId = await createDraft(userId, ingestionId, {
    direction: "credit",
    amountPaise: 400000,
    suggestedAccountId: accountB,
  });

  const [outResult, inResult] = await acceptTransferPair(userId, {
    outId: outDraftId,
    inId: inDraftId,
    fromAccountId: accountA,
    toAccountId: accountB,
    occurredAt: BASE_DATE,
  });

  await hardDeleteTransaction(outResult.transactionId!);
  await restoreOrphan(db, userId, outDraftId);
  // The reviewer corrects the amount before accepting — no candidate matches it anymore.
  const reaccepted = await acceptDraft(userId, outDraftId, accountA, 450000, "debit");
  assert.ok(reaccepted.transactionId);

  const links = await db
    .select()
    .from(transferLinks)
    .where(
      or(
        eq(transferLinks.outTransactionId, reaccepted.transactionId!),
        eq(transferLinks.inTransactionId, reaccepted.transactionId!),
      ),
    );
  assert.equal(links.length, 0);
  // the surviving leg also remains unlinked
  const survivorLinks = await db
    .select()
    .from(transferLinks)
    .where(
      or(
        eq(transferLinks.outTransactionId, inResult.transactionId!),
        eq(transferLinks.inTransactionId, inResult.transactionId!),
      ),
    );
  assert.equal(survivorLinks.length, 0);
});

test("transfer reconstruction: both legs hard-deleted, both restored, re-paired by pickTransferPairs, and acceptTransfer recreates two transactions plus a link", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const accountA = await createAccount(userId, "bank");
  const accountB = await createAccount(userId, "bank");
  const ingestionId = await createIngestion(userId);

  const outDraftId = await createDraft(userId, ingestionId, {
    direction: "debit",
    amountPaise: 400000,
    suggestedAccountId: accountA,
  });
  const inDraftId = await createDraft(userId, ingestionId, {
    direction: "credit",
    amountPaise: 400000,
    suggestedAccountId: accountB,
  });

  const [outResult, inResult] = await acceptTransferPair(userId, {
    outId: outDraftId,
    inId: inDraftId,
    fromAccountId: accountA,
    toAccountId: accountB,
    occurredAt: BASE_DATE,
  });

  await hardDeleteTransaction(outResult.transactionId!);
  await hardDeleteTransaction(inResult.transactionId!);

  const orphans = await listOrphanedAccepts(db, userId);
  const orphanIds = orphans.map((o) => o.id);
  assert.ok(orphanIds.includes(outDraftId));
  assert.ok(orphanIds.includes(inDraftId));

  await restoreOrphan(db, userId, outDraftId);
  await restoreOrphan(db, userId, inDraftId);

  const pending = await listInbox(db, userId, "pending");
  const outRow = pending.find((p) => p.id === outDraftId);
  const inRow = pending.find((p) => p.id === inDraftId);
  assert.ok(outRow);
  assert.ok(inRow);
  assert.equal(outRow!.transferPartnerId, inDraftId);
  assert.equal(inRow!.transferPartnerId, outDraftId);

  const [newOut, newIn] = await acceptTransferPair(userId, {
    outId: outDraftId,
    inId: inDraftId,
    fromAccountId: accountA,
    toAccountId: accountB,
    occurredAt: BASE_DATE,
  });
  assert.ok(newOut.transactionId);
  assert.ok(newIn.transactionId);
  assert.notEqual(newOut.transactionId, outResult.transactionId);
  assert.notEqual(newIn.transactionId, inResult.transactionId);

  const links = await db
    .select()
    .from(transferLinks)
    .where(
      and(
        eq(transferLinks.outTransactionId, newOut.transactionId!),
        eq(transferLinks.inTransactionId, newIn.transactionId!),
      ),
    );
  assert.equal(links.length, 1);
});

// ---------- re-accept after restore: exactly-once + dedupe_hash stability ----------

test("re-accept after restore: succeeds exactly once (second accept 409s) and dedupe_hash is unchanged", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const accountId = await createAccount(userId);
  const ingestionId = await createIngestion(userId);
  const dedupeHash = `inbox-test-${randomUUID()}`;
  const draftId = await createDraft(userId, ingestionId, { dedupeHash });
  const accepted = await acceptDraft(userId, draftId, accountId);
  await hardDeleteTransaction(accepted.transactionId!);

  await restoreOrphan(db, userId, draftId);
  const reaccepted = await acceptDraft(userId, draftId, accountId);
  assert.ok(reaccepted.transactionId);

  await assert.rejects(
    acceptDraft(userId, draftId, accountId),
    (e: unknown) => e instanceof HttpError && e.statusCode === 409,
  );

  const row = await draftRow(draftId);
  assert.equal(row?.dedupeHash, dedupeHash);
});
