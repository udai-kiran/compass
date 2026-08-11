import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, or } from "drizzle-orm";
import type { AccountType, ExtractedTransaction } from "@compass/shared";
import { ExtractedTransactionSchema } from "@compass/shared";
import { createDb } from "../../../db/index.ts";
import { createPool } from "../../../infra/db.ts";
import { accounts, categories, transactions, transferLinks, users } from "../../../db/schema.ts";
import { emailIngestions, extractedTransactions } from "../schema.ts";
import { HttpError } from "../../../lib/errors.ts";
import { incomeExpense } from "../../../lib/periods.ts";
import { createTransaction } from "../../ledger/services/transactions.ts";
import { linkTransfer, TRANSFER_WINDOW_DAYS } from "../../ledger/services/transfers.ts";
import { acceptExtracted, restoreOrphan, rejectExtracted } from "./review-actions.ts";
import {
  historyKey,
  listInbox,
  listOrphanedAccepts,
  pickHistoryCategories,
  pickTransferPairs,
} from "./review-queue.ts";
import { acceptRepayment, acceptTransfer, selectRepaymentCandidate } from "./transfer-classification.ts";

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

// ---------- selectRepaymentCandidate (T5): pure 0/1/many selection ----------

test("selectRepaymentCandidate: zero candidates selects create", () => {
  assert.deepEqual(selectRepaymentCandidate([]), { kind: "create" });
});

test("selectRepaymentCandidate: exactly one candidate selects reuse with its id", () => {
  assert.deepEqual(selectRepaymentCandidate([{ id: "tx-1" }]), { kind: "reuse", id: "tx-1" });
});

test("selectRepaymentCandidate: two or more candidates selects ambiguous, naming the count", () => {
  assert.deepEqual(selectRepaymentCandidate([{ id: "tx-1" }, { id: "tx-2" }]), {
    kind: "ambiguous",
    count: 2,
  });
  assert.deepEqual(
    selectRepaymentCandidate([{ id: "tx-1" }, { id: "tx-2" }, { id: "tx-3" }]),
    { kind: "ambiguous", count: 3 },
  );
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
  occurredAtTs: Date | null;
  suggestedAccountId: string | null;
  status: "pending" | "accepted" | "rejected" | "duplicate";
  transactionId: string | null;
  matchedTransactionId: string | null;
  dedupeHash: string | null;
  intent: "repayment" | "refund" | "cashback" | null;
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
      occurredAtTs: over.occurredAtTs ?? null,
      counterparty: "Test Merchant",
      suggestedAccountId: over.suggestedAccountId ?? null,
      sourceQuote: "",
      confidence: 0.9,
      dedupeHash: over.dedupeHash === undefined ? `inbox-test-${randomUUID()}` : over.dedupeHash,
      status: over.status ?? "pending",
      transactionId: over.transactionId ?? null,
      matchedTransactionId: over.matchedTransactionId ?? null,
      intent: over.intent ?? null,
    })
    .returning({ id: extractedTransactions.id });
  return d!.id;
}

async function createCategory(userId: string, kind: "income" | "expense", name = "Test Category"): Promise<string> {
  const [c] = await db.insert(categories).values({ userId, name, kind }).returning({ id: categories.id });
  return c!.id;
}

/** A ledger transaction filed under `categoryId`, for `applyHistoryCategory` to tally against. */
async function createHistoryTxn(
  userId: string,
  accountId: string,
  categoryId: string,
  amountPaise: number,
): Promise<void> {
  await createTransaction(db, userId, {
    accountId,
    date: BASE_DATE,
    amountPaise,
    merchant: "Test Merchant",
    categoryId,
    notes: "",
    tags: [],
    source: "manual",
  });
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

// ---------- intent round-trips onto the DTO (AC5b), and is purely informational (AC1) ----------
//
// misc-01 adds a captured `intent` marker to the review-inbox DTO but changes
// no suggestion/history behaviour. This asserts both halves through the real
// `listInbox` path: intent survives the DB round trip and validates against
// the wire schema, and `applyHistoryCategory`'s unconditional override still
// fires identically for every intent value, including `repayment`.

test("listInbox: intent round-trips onto the DTO for every value and validates against ExtractedTransactionSchema", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const ingestionId = await createIngestion(userId);

  const repaymentId = await createDraft(userId, ingestionId, { direction: "credit", intent: "repayment" });
  const refundId = await createDraft(userId, ingestionId, { direction: "credit", intent: "refund" });
  const cashbackId = await createDraft(userId, ingestionId, { direction: "credit", intent: "cashback" });
  const plainId = await createDraft(userId, ingestionId, { direction: "debit", intent: null });

  const pending = await listInbox(db, userId, "pending");
  const byId = new Map(pending.map((d) => [d.id, d]));

  assert.equal(byId.get(repaymentId)?.intent, "repayment");
  assert.equal(byId.get(refundId)?.intent, "refund");
  assert.equal(byId.get(cashbackId)?.intent, "cashback");
  assert.equal(byId.get(plainId)?.intent, null);

  for (const id of [repaymentId, refundId, cashbackId, plainId]) {
    const dto = byId.get(id);
    assert.ok(dto);
    ExtractedTransactionSchema.parse(dto); // throws on any mismatch with the response schema
  }
});

test("listInbox: applyHistoryCategory still unconditionally overrides suggestedCategoryId for every intent value, including repayment — byte-for-byte unchanged history behaviour", async (t) => {
  const userId = await createUser();
  // This test also creates a category, which cleanupUser doesn't know about and
  // which carries a plain (non-cascading) FK from transactions — it must be
  // deleted after transactions but before accounts/users, so it gets its own
  // ordered cleanup rather than a bare cleanupUser(userId) call.
  t.after(async () => {
    await db.delete(extractedTransactions).where(eq(extractedTransactions.userId, userId));
    await db.delete(emailIngestions).where(eq(emailIngestions.userId, userId));
    await db.delete(transactions).where(eq(transactions.userId, userId));
    await db.delete(categories).where(eq(categories.userId, userId));
    await db.delete(accounts).where(eq(accounts.userId, userId));
    await db.delete(users).where(eq(users.id, userId));
  });
  const accountId = await createAccount(userId);
  const ingestionId = await createIngestion(userId);

  // The user has previously filed "Test Merchant" credits under this income category.
  const historyCategoryId = await createCategory(userId, "income", "Refunds");
  await createHistoryTxn(userId, accountId, historyCategoryId, 100000);

  const repaymentId = await createDraft(userId, ingestionId, { direction: "credit", intent: "repayment" });
  const refundId = await createDraft(userId, ingestionId, { direction: "credit", intent: "refund" });
  const cashbackId = await createDraft(userId, ingestionId, { direction: "credit", intent: "cashback" });
  const noIntentId = await createDraft(userId, ingestionId, { direction: "credit", intent: null });

  const pending = await listInbox(db, userId, "pending");
  const byId = new Map(pending.map((d) => [d.id, d]));

  // History wins unconditionally, exactly as before this change, regardless of intent.
  for (const id of [repaymentId, refundId, cashbackId, noIntentId]) {
    assert.equal(byId.get(id)?.suggestedCategoryId, historyCategoryId);
  }
});

// ---------- acceptRepayment (misc-02): accept a single card-repayment credit
// draft as a transfer, naming the paying account. ----------

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function ledgerRowsFor(userId: string) {
  return db.select().from(transactions).where(eq(transactions.userId, userId));
}

async function linksFor(userId: string) {
  return db.select().from(transferLinks).where(eq(transferLinks.userId, userId));
}

async function repaymentDraft(
  userId: string,
  ingestionId: string,
  over: DraftOverrides = {},
): Promise<string> {
  return createDraft(userId, ingestionId, {
    direction: "credit",
    amountPaise: 500000,
    occurredAt: BASE_DATE,
    ...over,
  });
}

// ---------- AC1: zero candidates creates both legs ----------

test("acceptRepayment AC1: no existing candidate creates exactly two ledger rows, equal and opposite, both uncategorized, and one transfer_links row", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const fromAccountId = await createAccount(userId, "bank");
  const cardAccountId = await createAccount(userId, "credit_card");
  const ingestionId = await createIngestion(userId);
  const draftId = await repaymentDraft(userId, ingestionId);

  const dto = await acceptRepayment(db, userId, draftId, {
    cardAccountId,
    fromAccountId,
    occurredAt: BASE_DATE,
  });

  const rows = await ledgerRowsFor(userId);
  assert.equal(rows.length, 2);
  const outRow = rows.find((r) => r.accountId === fromAccountId)!;
  const inRow = rows.find((r) => r.accountId === cardAccountId)!;
  assert.ok(outRow);
  assert.ok(inRow);
  assert.equal(outRow.amountPaise, -500000);
  assert.equal(inRow.amountPaise, 500000);
  assert.equal(outRow.categoryId, null);
  assert.equal(inRow.categoryId, null);
  assert.equal(dto.transactionId, inRow.id);

  const links = await linksFor(userId);
  assert.equal(links.length, 1);
  assert.equal(links[0]!.outTransactionId, outRow.id);
  assert.equal(links[0]!.inTransactionId, inRow.id);

  const row = await draftRow(draftId);
  assert.equal(row?.status, "accepted");
  assert.equal(row?.transactionId, inRow.id);
});

// ---------- AC2 / AC4: exactly one candidate is reused untouched ----------

test("acceptRepayment AC2/AC4: exactly one eligible candidate is reused — only the card leg is created, and the reused row's amount/date/occurredAt/merchant/categoryId are unchanged", async (t) => {
  const userId = await createUser();
  // A category is created below; cleanupUser doesn't know about it (same
  // ordering note as the applyHistoryCategory test above) — it must be
  // deleted after transactions but before accounts/users.
  t.after(async () => {
    await db.delete(extractedTransactions).where(eq(extractedTransactions.userId, userId));
    await db.delete(emailIngestions).where(eq(emailIngestions.userId, userId));
    await db.delete(transactions).where(eq(transactions.userId, userId));
    await db.delete(categories).where(eq(categories.userId, userId));
    await db.delete(accounts).where(eq(accounts.userId, userId));
    await db.delete(users).where(eq(users.id, userId));
  });
  const fromAccountId = await createAccount(userId, "bank");
  const cardAccountId = await createAccount(userId, "credit_card");
  const categoryId = await createCategory(userId, "expense", "Existing category");
  const ingestionId = await createIngestion(userId);

  const existingDebit = await createTransaction(db, userId, {
    accountId: fromAccountId,
    date: BASE_DATE,
    amountPaise: -500000,
    merchant: "HDFC autopay",
    categoryId,
    notes: "hand-entered",
    tags: ["autopay"],
    source: "manual",
  });
  const before = (await ledgerRowsFor(userId)).find((r) => r.id === existingDebit.id)!;

  const draftId = await repaymentDraft(userId, ingestionId);

  const dto = await acceptRepayment(db, userId, draftId, {
    cardAccountId,
    fromAccountId,
    occurredAt: BASE_DATE,
  });

  const rows = await ledgerRowsFor(userId);
  assert.equal(rows.length, 2); // the reused debit + the new card leg — no new debit
  const after = rows.find((r) => r.id === existingDebit.id)!;
  assert.ok(after);
  assert.equal(after.amountPaise, before.amountPaise);
  assert.equal(after.date, before.date);
  assert.equal(after.occurredAt?.getTime() ?? null, before.occurredAt?.getTime() ?? null);
  assert.equal(after.merchant, before.merchant);
  assert.equal(after.categoryId, before.categoryId);

  const links = await linksFor(userId);
  assert.equal(links.length, 1);
  assert.equal(links[0]!.outTransactionId, existingDebit.id);
  assert.equal(links[0]!.inTransactionId, dto.transactionId);
});

// ---------- AC3: two or more candidates refuses ----------

test("acceptRepayment AC3: two or more eligible candidates 409s, naming the count, creates no ledger row, and leaves the draft pending", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const fromAccountId = await createAccount(userId, "bank");
  const cardAccountId = await createAccount(userId, "credit_card");
  const ingestionId = await createIngestion(userId);

  await createTransaction(db, userId, {
    accountId: fromAccountId,
    date: BASE_DATE,
    amountPaise: -500000,
    merchant: "Candidate A",
    categoryId: null,
    notes: "",
    tags: [],
    source: "manual",
  });
  await createTransaction(db, userId, {
    accountId: fromAccountId,
    date: BASE_DATE,
    amountPaise: -500000,
    merchant: "Candidate B",
    categoryId: null,
    notes: "",
    tags: [],
    source: "manual",
  });

  const draftId = await repaymentDraft(userId, ingestionId);

  await assert.rejects(
    acceptRepayment(db, userId, draftId, { cardAccountId, fromAccountId, occurredAt: BASE_DATE }),
    (e: unknown) => e instanceof HttpError && e.statusCode === 409 && e.message.includes("2"),
  );

  const rows = await ledgerRowsFor(userId);
  assert.equal(rows.length, 2); // only the two pre-existing candidates — nothing created

  const row = await draftRow(draftId);
  assert.equal(row?.status, "pending");
});

// ---------- AC4: timestamp/date provenance on newly created legs ----------

test("acceptRepayment AC4: the synthetic out leg has occurredAt = null; the in leg carries the draft's occurredAtTs and the reviewer's date", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const fromAccountId = await createAccount(userId, "bank");
  const cardAccountId = await createAccount(userId, "credit_card");
  const ingestionId = await createIngestion(userId);
  const draftOccurredAtTs = new Date("2026-01-05T12:34:56.000Z");
  const reviewerDate = addDays(BASE_DATE, 1);

  const draftId = await repaymentDraft(userId, ingestionId, { occurredAtTs: draftOccurredAtTs });

  await acceptRepayment(db, userId, draftId, {
    cardAccountId,
    fromAccountId,
    occurredAt: reviewerDate,
  });

  const rows = await ledgerRowsFor(userId);
  const outRow = rows.find((r) => r.accountId === fromAccountId)!;
  const inRow = rows.find((r) => r.accountId === cardAccountId)!;

  assert.equal(outRow.occurredAt, null);
  assert.equal(outRow.date, reviewerDate);
  assert.equal(inRow.date, reviewerDate);
  assert.equal(inRow.occurredAt?.toISOString(), draftOccurredAtTs.toISOString());
});

// ---------- AC4b: a candidate linked concurrently between detection and linking ----------

test("acceptRepayment AC4b: a candidate linked by a concurrent request between detection and linking returns a defined 409 (not a raw unique-violation), creates no ledger row, and leaves the draft pending", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const fromAccountId = await createAccount(userId, "bank");
  const cardAccountId = await createAccount(userId, "credit_card");
  const otherAccountId = await createAccount(userId, "bank");
  const ingestionId = await createIngestion(userId);

  // The single existing debit both `acceptRepayment` and a concurrent manual
  // link race to claim.
  const candidate = await createTransaction(db, userId, {
    accountId: fromAccountId,
    date: BASE_DATE,
    amountPaise: -500000,
    merchant: "Existing debit",
    categoryId: null,
    notes: "",
    tags: [],
    source: "manual",
  });
  // A spurious credit for the concurrent request to pair the candidate with —
  // standing in for some other transfer accepted at the same instant.
  const spuriousCredit = await createTransaction(db, userId, {
    accountId: otherAccountId,
    date: BASE_DATE,
    amountPaise: 500000,
    merchant: "Spurious credit",
    categoryId: null,
    notes: "",
    tags: [],
    source: "manual",
  });

  const draftId = await repaymentDraft(userId, ingestionId);

  const started = makeGate();
  const release = makeGate();

  // Connection A: opens an explicit transaction, links the candidate to the
  // spurious credit, and holds the transaction open (uncommitted) via the gate.
  const aTxPromise = db.transaction(async (tx) => {
    await linkTransfer(tx, userId, candidate.id, spuriousCredit.id);
    started.release();
    await release.opened;
  });
  await started.opened;

  // Connection B: the real call under test. Its candidate SELECT (read-committed,
  // A uncommitted) still sees the debit as unlinked, so it proceeds to
  // `linkTransfer`'s insert — which blocks on A's held row lock.
  const bPromise = acceptRepayment(db, userId, draftId, {
    cardAccountId,
    fromAccountId,
    occurredAt: BASE_DATE,
  });
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
  assert.equal(bSettled, false, "B (acceptRepayment) should still be blocked on A's held row lock");

  release.release();
  await aTxPromise;

  await assert.rejects(
    bPromise,
    (e: unknown) =>
      e instanceof HttpError && e.statusCode === 409 && (e.message.includes("already part of a transfer") || e.message.includes("linked to another transfer")),
  );

  const row = await draftRow(draftId);
  assert.equal(row?.status, "pending");

  // A's link committed (one row); B's attempted in-leg insert rolled back with
  // the rest of its transaction — no ledger row was left behind by B.
  const rows = await ledgerRowsFor(userId);
  assert.equal(rows.length, 2); // candidate + spuriousCredit only
  const links = await linksFor(userId);
  assert.equal(links.length, 1);
  assert.equal(links[0]!.outTransactionId, candidate.id);
  assert.equal(links[0]!.inTransactionId, spuriousCredit.id);
});

// ---------- AC5: neither leg counts as income or expense ----------

test("acceptRepayment AC5: neither leg appears in income or expense — unrelated positive/negative controls in the same window prove exclusion, not just a zero total", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const fromAccountId = await createAccount(userId, "bank");
  const cardAccountId = await createAccount(userId, "credit_card");
  const ingestionId = await createIngestion(userId);

  await createTransaction(db, userId, {
    accountId: fromAccountId,
    date: BASE_DATE,
    amountPaise: 200000,
    merchant: "Salary",
    categoryId: null,
    notes: "",
    tags: [],
    source: "manual",
  });
  await createTransaction(db, userId, {
    accountId: fromAccountId,
    date: BASE_DATE,
    amountPaise: -75000,
    merchant: "Groceries",
    categoryId: null,
    notes: "",
    tags: [],
    source: "manual",
  });

  const draftId = await repaymentDraft(userId, ingestionId);
  await acceptRepayment(db, userId, draftId, { cardAccountId, fromAccountId, occurredAt: BASE_DATE });

  const totals = await incomeExpense(db, userId, BASE_DATE, BASE_DATE);
  assert.equal(totals.incomePaise, 200000);
  assert.equal(totals.expensePaise, 75000);
});

// ---------- AC6: a genuine concurrent double-accept of the same draft ----------

test("acceptRepayment AC6: a genuine concurrent double-accept of the same draft yields exactly one success and one 409, exactly two ledger rows, and exactly one link", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const fromAccountId = await createAccount(userId, "bank");
  const cardAccountId = await createAccount(userId, "credit_card");
  const ingestionId = await createIngestion(userId);
  const draftId = await repaymentDraft(userId, ingestionId);
  const input = { cardAccountId, fromAccountId, occurredAt: BASE_DATE };

  const results = await Promise.allSettled([
    acceptRepayment(db, userId, draftId, input),
    acceptRepayment(db, userId, draftId, input),
  ]);

  const fulfilled = results.filter((r): r is PromiseFulfilledResult<ExtractedTransaction> => r.status === "fulfilled");
  const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.ok(rejected[0]!.reason instanceof HttpError);
  assert.equal((rejected[0]!.reason as HttpError).statusCode, 409);

  const rows = await ledgerRowsFor(userId);
  assert.equal(rows.length, 2);
  const links = await linksFor(userId);
  assert.equal(links.length, 1);
});

// ---------- AC8: rejected 400s, and a foreign account 404s (not grouped with 400) ----------

test("acceptRepayment AC8: fromAccountId === cardAccountId is rejected 400 and leaves the draft pending", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const cardAccountId = await createAccount(userId, "credit_card");
  const ingestionId = await createIngestion(userId);
  const draftId = await repaymentDraft(userId, ingestionId);

  await assert.rejects(
    acceptRepayment(db, userId, draftId, {
      cardAccountId,
      fromAccountId: cardAccountId,
      occurredAt: BASE_DATE,
    }),
    (e: unknown) => e instanceof HttpError && e.statusCode === 400,
  );
  const row = await draftRow(draftId);
  assert.equal(row?.status, "pending");
  assert.equal((await ledgerRowsFor(userId)).length, 0);
});

test("acceptRepayment AC8: a cardAccountId that is not a credit card is rejected 400", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const cardAccountId = await createAccount(userId, "bank"); // not a credit card
  const fromAccountId = await createAccount(userId, "bank");
  const ingestionId = await createIngestion(userId);
  const draftId = await repaymentDraft(userId, ingestionId);

  await assert.rejects(
    acceptRepayment(db, userId, draftId, { cardAccountId, fromAccountId, occurredAt: BASE_DATE }),
    (e: unknown) => e instanceof HttpError && e.statusCode === 400,
  );
  const row = await draftRow(draftId);
  assert.equal(row?.status, "pending");
});

test("acceptRepayment AC8: a fromAccountId that is itself a credit card is rejected 400", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const cardAccountId = await createAccount(userId, "credit_card");
  const fromAccountId = await createAccount(userId, "credit_card"); // a second card
  const ingestionId = await createIngestion(userId);
  const draftId = await repaymentDraft(userId, ingestionId);

  await assert.rejects(
    acceptRepayment(db, userId, draftId, { cardAccountId, fromAccountId, occurredAt: BASE_DATE }),
    (e: unknown) => e instanceof HttpError && e.statusCode === 400,
  );
  const row = await draftRow(draftId);
  assert.equal(row?.status, "pending");
});

test("acceptRepayment AC8: an archived fromAccountId is rejected 400", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const cardAccountId = await createAccount(userId, "credit_card");
  const fromAccountId = await createAccount(userId, "bank");
  await db.update(accounts).set({ archivedAt: new Date() }).where(eq(accounts.id, fromAccountId));
  const ingestionId = await createIngestion(userId);
  const draftId = await repaymentDraft(userId, ingestionId);

  await assert.rejects(
    acceptRepayment(db, userId, draftId, { cardAccountId, fromAccountId, occurredAt: BASE_DATE }),
    (e: unknown) => e instanceof HttpError && e.statusCode === 400,
  );
  const row = await draftRow(draftId);
  assert.equal(row?.status, "pending");
});

test("acceptRepayment AC8: a debit draft is rejected 400 and leaves the draft pending", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const cardAccountId = await createAccount(userId, "credit_card");
  const fromAccountId = await createAccount(userId, "bank");
  const ingestionId = await createIngestion(userId);
  const draftId = await createDraft(userId, ingestionId, { direction: "debit", amountPaise: 500000 });

  await assert.rejects(
    acceptRepayment(db, userId, draftId, { cardAccountId, fromAccountId, occurredAt: BASE_DATE }),
    (e: unknown) => e instanceof HttpError && e.statusCode === 400,
  );
  const row = await draftRow(draftId);
  assert.equal(row?.status, "pending");
});

test("acceptRepayment AC8: an account owned by another user 404s (not grouped with the 400 cases) and is never written to", async (t) => {
  const userA = await createUser();
  const userB = await createUser();
  t.after(async () => {
    await cleanupUser(userA);
    await cleanupUser(userB);
  });
  const cardAccountId = await createAccount(userA, "credit_card");
  const fromAccountIdOtherUser = await createAccount(userB, "bank");
  const ingestionId = await createIngestion(userA);
  const draftId = await repaymentDraft(userA, ingestionId);

  await assert.rejects(
    acceptRepayment(db, userA, draftId, {
      cardAccountId,
      fromAccountId: fromAccountIdOtherUser,
      occurredAt: BASE_DATE,
    }),
    (e: unknown) => e instanceof HttpError && e.statusCode === 404,
  );
  const row = await draftRow(draftId);
  assert.equal(row?.status, "pending");
  assert.equal((await ledgerRowsFor(userA)).length, 0);
});

// ---------- T5b: DB-backed coverage of the SQL eligibility predicate itself.
// Each case sets up a single existing debit that would match a naive query,
// excluded for exactly one of the predicate's clauses, and asserts
// `acceptRepayment` falls through to the "create" branch (proving the
// existing row was NOT selected as a candidate) rather than reusing it. ----------

test("SQL eligibility predicate: a debit with the wrong amount is excluded — the create branch runs instead", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const fromAccountId = await createAccount(userId, "bank");
  const cardAccountId = await createAccount(userId, "credit_card");
  const ingestionId = await createIngestion(userId);

  const wrongAmount = await createTransaction(db, userId, {
    accountId: fromAccountId,
    date: BASE_DATE,
    amountPaise: -400000, // draft is 500000, so -500000 would match; this doesn't
    merchant: "Wrong amount",
    categoryId: null,
    notes: "",
    tags: [],
    source: "manual",
  });

  const draftId = await repaymentDraft(userId, ingestionId);
  await acceptRepayment(db, userId, draftId, { cardAccountId, fromAccountId, occurredAt: BASE_DATE });

  const rows = await ledgerRowsFor(userId);
  assert.equal(rows.length, 3); // the wrong-amount debit, untouched, plus a new out+in pair
  const untouched = rows.find((r) => r.id === wrongAmount.id)!;
  assert.equal(untouched.amountPaise, -400000);
  const links = await linksFor(userId);
  assert.equal(links.length, 1);
  assert.notEqual(links[0]!.outTransactionId, wrongAmount.id);
});

test("SQL eligibility predicate: a debit exactly TRANSFER_WINDOW_DAYS away is included (reused)", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const fromAccountId = await createAccount(userId, "bank");
  const cardAccountId = await createAccount(userId, "credit_card");
  const ingestionId = await createIngestion(userId);
  const reviewerDate = BASE_DATE;
  const debitDate = addDays(BASE_DATE, -TRANSFER_WINDOW_DAYS);

  const boundary = await createTransaction(db, userId, {
    accountId: fromAccountId,
    date: debitDate,
    amountPaise: -500000,
    merchant: "At the window boundary",
    categoryId: null,
    notes: "",
    tags: [],
    source: "manual",
  });

  const draftId = await repaymentDraft(userId, ingestionId, { occurredAt: BASE_DATE });
  await acceptRepayment(db, userId, draftId, { cardAccountId, fromAccountId, occurredAt: reviewerDate });

  const rows = await ledgerRowsFor(userId);
  assert.equal(rows.length, 2); // reused, no new debit
  const links = await linksFor(userId);
  assert.equal(links.length, 1);
  assert.equal(links[0]!.outTransactionId, boundary.id);
});

test("SQL eligibility predicate: a debit one day beyond TRANSFER_WINDOW_DAYS is excluded — the create branch runs instead", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const fromAccountId = await createAccount(userId, "bank");
  const cardAccountId = await createAccount(userId, "credit_card");
  const ingestionId = await createIngestion(userId);
  const reviewerDate = BASE_DATE;
  const debitDate = addDays(BASE_DATE, -(TRANSFER_WINDOW_DAYS + 1));

  const tooFar = await createTransaction(db, userId, {
    accountId: fromAccountId,
    date: debitDate,
    amountPaise: -500000,
    merchant: "Beyond the window",
    categoryId: null,
    notes: "",
    tags: [],
    source: "manual",
  });

  const draftId = await repaymentDraft(userId, ingestionId, { occurredAt: BASE_DATE });
  await acceptRepayment(db, userId, draftId, { cardAccountId, fromAccountId, occurredAt: reviewerDate });

  const rows = await ledgerRowsFor(userId);
  assert.equal(rows.length, 3);
  const links = await linksFor(userId);
  assert.equal(links.length, 1);
  assert.notEqual(links[0]!.outTransactionId, tooFar.id);
});

test("SQL eligibility predicate: a soft-deleted debit is excluded — the create branch runs instead", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const fromAccountId = await createAccount(userId, "bank");
  const cardAccountId = await createAccount(userId, "credit_card");
  const ingestionId = await createIngestion(userId);

  const deleted = await createTransaction(db, userId, {
    accountId: fromAccountId,
    date: BASE_DATE,
    amountPaise: -500000,
    merchant: "Soft deleted",
    categoryId: null,
    notes: "",
    tags: [],
    source: "manual",
  });
  await db.update(transactions).set({ deletedAt: new Date() }).where(eq(transactions.id, deleted.id));

  const draftId = await repaymentDraft(userId, ingestionId);
  await acceptRepayment(db, userId, draftId, { cardAccountId, fromAccountId, occurredAt: BASE_DATE });

  const rows = await ledgerRowsFor(userId);
  assert.equal(rows.length, 3); // the soft-deleted row plus the new out+in pair
  const links = await linksFor(userId);
  assert.equal(links.length, 1);
  assert.notEqual(links[0]!.outTransactionId, deleted.id);
});

test("SQL eligibility predicate: an isOpening debit is excluded — the create branch runs instead", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const fromAccountId = await createAccount(userId, "bank");
  const cardAccountId = await createAccount(userId, "credit_card");
  const ingestionId = await createIngestion(userId);

  const [opening] = await db
    .insert(transactions)
    .values({
      userId,
      accountId: fromAccountId,
      date: BASE_DATE,
      amountPaise: -500000,
      merchant: "Opening balance",
      categoryId: null,
      notes: "",
      tags: [],
      source: "manual",
      isOpening: true,
    })
    .returning({ id: transactions.id });

  const draftId = await repaymentDraft(userId, ingestionId);
  await acceptRepayment(db, userId, draftId, { cardAccountId, fromAccountId, occurredAt: BASE_DATE });

  const rows = await ledgerRowsFor(userId);
  assert.equal(rows.length, 3);
  const links = await linksFor(userId);
  assert.equal(links.length, 1);
  assert.notEqual(links[0]!.outTransactionId, opening!.id);
});

test("SQL eligibility predicate: a debit already referenced by transfer_links is excluded — the create branch runs instead", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const fromAccountId = await createAccount(userId, "bank");
  const cardAccountId = await createAccount(userId, "credit_card");
  const otherAccountId = await createAccount(userId, "bank");
  const ingestionId = await createIngestion(userId);

  const alreadyLinked = await createTransaction(db, userId, {
    accountId: fromAccountId,
    date: BASE_DATE,
    amountPaise: -500000,
    merchant: "Already linked",
    categoryId: null,
    notes: "",
    tags: [],
    source: "manual",
  });
  const otherCredit = await createTransaction(db, userId, {
    accountId: otherAccountId,
    date: BASE_DATE,
    amountPaise: 500000,
    merchant: "Other credit",
    categoryId: null,
    notes: "",
    tags: [],
    source: "manual",
  });
  await linkTransfer(db, userId, alreadyLinked.id, otherCredit.id);

  const draftId = await repaymentDraft(userId, ingestionId);
  await acceptRepayment(db, userId, draftId, { cardAccountId, fromAccountId, occurredAt: BASE_DATE });

  const rows = await ledgerRowsFor(userId);
  assert.equal(rows.length, 4); // alreadyLinked + otherCredit + new out+in pair
  const links = await linksFor(userId);
  assert.equal(links.length, 2);
  assert.ok(links.every((l) => l.outTransactionId !== alreadyLinked.id || l.inTransactionId === otherCredit.id));
});

test("SQL eligibility predicate: a debit on a different account is excluded — the create branch runs instead", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const fromAccountId = await createAccount(userId, "bank");
  const otherAccountId = await createAccount(userId, "bank");
  const cardAccountId = await createAccount(userId, "credit_card");
  const ingestionId = await createIngestion(userId);

  const wrongAccount = await createTransaction(db, userId, {
    accountId: otherAccountId,
    date: BASE_DATE,
    amountPaise: -500000,
    merchant: "Wrong account",
    categoryId: null,
    notes: "",
    tags: [],
    source: "manual",
  });

  const draftId = await repaymentDraft(userId, ingestionId);
  await acceptRepayment(db, userId, draftId, { cardAccountId, fromAccountId, occurredAt: BASE_DATE });

  const rows = await ledgerRowsFor(userId);
  assert.equal(rows.length, 3);
  const links = await linksFor(userId);
  assert.equal(links.length, 1);
  assert.notEqual(links[0]!.outTransactionId, wrongAccount.id);
});

test("SQL eligibility predicate: a row-level userId mismatch is excluded — the create branch runs instead", async (t) => {
  const userA = await createUser();
  const userB = await createUser();
  const fromAccountId = await createAccount(userA, "bank");
  const cardAccountId = await createAccount(userA, "credit_card");
  const ingestionId = await createIngestion(userA);

  // Deliberately mismatched: a transaction row that sits on userA's own
  // account (so the account-ownership check in acceptRepayment isn't what
  // excludes it) but is stamped with userB's userId — isolating the
  // predicate's own `user_id` filter from account ownership.
  const [mismatched] = await db
    .insert(transactions)
    .values({
      userId: userB,
      accountId: fromAccountId,
      date: BASE_DATE,
      amountPaise: -500000,
      merchant: "Mismatched user",
      categoryId: null,
      notes: "",
      tags: [],
      source: "manual",
    })
    .returning({ id: transactions.id });

  t.after(async () => {
    // The mismatched row sits on userA's account but carries userB's userId,
    // so it must be removed before either account is deleted (the account_id
    // FK has no cascade) — cleanupUser's own userId-scoped delete won't catch
    // a row whose userId and accountId belong to different users.
    await db.delete(transactions).where(eq(transactions.id, mismatched!.id));
    await cleanupUser(userA);
    await cleanupUser(userB);
  });

  const draftId = await repaymentDraft(userA, ingestionId);
  await acceptRepayment(db, userA, draftId, { cardAccountId, fromAccountId, occurredAt: BASE_DATE });

  const rows = await ledgerRowsFor(userA);
  assert.equal(rows.length, 2); // userA's own new out+in pair — the mismatched row isn't userA's

  const [mismatchedAfter] = await db.select().from(transactions).where(eq(transactions.id, mismatched!.id));
  assert.equal(mismatchedAfter!.amountPaise, -500000); // untouched

  const links = await linksFor(userA);
  assert.equal(links.length, 1);
  assert.notEqual(links[0]!.outTransactionId, mismatched!.id);
});
