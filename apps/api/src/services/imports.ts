import { createHash } from "node:crypto";
import { setImmediate as yieldLoop } from "node:timers/promises";
import { and, desc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import type {
  BankPreset,
  CommitResult,
  ImportBatch,
  ImportMapping,
  ImportRow,
} from "@compass/shared";
import { ImportMappingSchema } from "@compass/shared";
import type { Db } from "../db/index.ts";
import {
  accounts,
  categories,
  importPresets,
  importRows,
  imports,
  transactions,
  transferLinks,
} from "../db/schema.ts";
import { parseAmountCell, parseCsv, parseDateCell } from "../lib/csv.ts";
import { HttpError } from "../lib/errors.ts";
import { parseHdfcStatement } from "../lib/hdfc-statement.ts";
import { getMerchantRules, normalizeMerchant } from "./merchants.ts";
import { reconcileStatementTransactions } from "./import-reconciliation.ts";
import { autoLinkTransfers } from "./transfers.ts";

export const MAX_IMPORT_BYTES = 25 * 1024 * 1024;
const BATCH = 1000;
const YIELD_EVERY = 2000;

// ---------- Bank presets ----------

export const BANK_PRESETS: BankPreset[] = [
  {
    // HDFC's delimited statement columns are: Date, Narration, Chq./Ref.No.,
    // Value Dt, Withdrawal Amt., Deposit Amt., Closing Balance. Dates are
    // DD/MM/YY — parseDateCell's DD/MM/YYYY branch expands the 2-digit year.
    name: "HDFC Bank",
    mapping: {
      dateColumn: "Date",
      dateFormat: "DD/MM/YYYY",
      amountMode: "debit_credit",
      debitColumn: "Withdrawal Amt.",
      creditColumn: "Deposit Amt.",
      invertSign: false,
      merchantColumn: "Narration",
    },
  },
  {
    name: "ICICI Bank",
    mapping: {
      dateColumn: "Transaction Date",
      dateFormat: "DD/MM/YYYY",
      amountMode: "debit_credit",
      debitColumn: "Withdrawal Amount (INR )",
      creditColumn: "Deposit Amount (INR )",
      invertSign: false,
      merchantColumn: "Transaction Remarks",
    },
  },
  {
    name: "SBI",
    mapping: {
      dateColumn: "Txn Date",
      dateFormat: "DD MMM YYYY",
      amountMode: "debit_credit",
      debitColumn: "Debit",
      creditColumn: "Credit",
      invertSign: false,
      merchantColumn: "Description",
    },
  },
  {
    name: "Axis Bank",
    mapping: {
      dateColumn: "Tran Date",
      dateFormat: "DD-MM-YYYY",
      amountMode: "debit_credit",
      debitColumn: "DR",
      creditColumn: "CR",
      invertSign: false,
      merchantColumn: "PARTICULARS",
    },
  },
  {
    name: "Generic (signed amount)",
    mapping: {
      dateColumn: "Date",
      dateFormat: "YYYY-MM-DD",
      amountMode: "signed",
      amountColumn: "Amount",
      invertSign: false,
      merchantColumn: "Description",
    },
  },
  // ---- credit-card statement formats ----
  // Single amount column with Dr/Cr suffix: purchases (Dr) → outflow, payments/
  // refunds (Cr) → inflow — parseAmountCell reads the suffix, no invert needed.
  {
    name: "HDFC / Amex Credit Card",
    mapping: {
      dateColumn: "Date",
      dateFormat: "DD/MM/YYYY",
      amountMode: "signed",
      amountColumn: "Amount",
      invertSign: false,
      merchantColumn: "Transaction Description",
    },
  },
  // Separate debit/credit columns: spends in the debit column (outflow),
  // payments in the credit column (inflow, auto-linked as transfers on commit).
  {
    name: "ICICI / SBI Credit Card",
    mapping: {
      dateColumn: "Transaction Date",
      dateFormat: "DD/MM/YYYY",
      amountMode: "debit_credit",
      debitColumn: "Amount (Dr)",
      creditColumn: "Amount (Cr)",
      invertSign: false,
      merchantColumn: "Details",
    },
  },
];

function mappingColumns(m: ImportMapping): string[] {
  return [
    m.dateColumn,
    m.merchantColumn,
    m.amountColumn,
    m.debitColumn,
    m.creditColumn,
    m.notesColumn,
  ].filter((c): c is string => Boolean(c));
}

/** Pick the built-in preset whose mapped columns all exist in the file's headers. */
export function suggestMapping(headers: string[]): BankPreset | null {
  const set = new Set(headers.map((h) => h.trim()));
  for (const preset of BANK_PRESETS) {
    if (mappingColumns(preset.mapping).every((c) => set.has(c))) return preset;
  }
  return null;
}

// ---------- Row parsing ----------

type ParsedFields = {
  date: string | null;
  amountPaise: number | null;
  merchant: string;
  rawMerchant: string;
  notes: string;
  error: string | null;
};

export function parseRow(
  raw: Record<string, string>,
  mapping: ImportMapping,
  normalize: (merchant: string) => string,
): ParsedFields {
  const rawMerchant = (raw[mapping.merchantColumn] ?? "").trim();
  const notes = mapping.notesColumn ? (raw[mapping.notesColumn] ?? "").trim() : "";
  const date = parseDateCell(raw[mapping.dateColumn] ?? "", mapping.dateFormat);

  let amountPaise: number | null = null;
  if (mapping.amountMode === "signed") {
    amountPaise = parseAmountCell(raw[mapping.amountColumn ?? ""] ?? "");
    if (amountPaise !== null && mapping.invertSign) amountPaise = -amountPaise;
  } else {
    const debit = parseAmountCell(raw[mapping.debitColumn ?? ""] ?? "");
    const credit = parseAmountCell(raw[mapping.creditColumn ?? ""] ?? "");
    if (debit !== null && debit !== 0) amountPaise = -Math.abs(debit);
    else if (credit !== null && credit !== 0) amountPaise = Math.abs(credit);
  }

  let error: string | null = null;
  if (!date) error = "Unparseable date";
  else if (amountPaise === null) error = "Unparseable amount";
  else if (!rawMerchant) error = "Missing merchant/description";

  return {
    date,
    amountPaise,
    merchant: rawMerchant ? normalize(rawMerchant) : "",
    rawMerchant,
    notes,
    error,
  };
}

export function dedupeHash(
  accountId: string,
  date: string,
  amountPaise: number,
  merchant: string,
): string {
  return createHash("sha256")
    .update(`${accountId}|${date}|${amountPaise}|${merchant.toLowerCase()}`)
    .digest("hex");
}

/**
 * Serialize to a Postgres array literal, passed as ONE text param and cast
 * server-side (drizzle's sql template would expand a JS array into a record).
 */
function pgArray(values: Array<string | number | boolean | null>): string {
  const parts = values.map((v) => {
    if (v === null) return "NULL";
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    return `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  });
  return `{${parts.join(",")}}`;
}

// ---------- Batch shaping ----------

type ImportRowDb = typeof importRows.$inferSelect;
type ImportDb = typeof imports.$inferSelect;

function toBatch(row: ImportDb): ImportBatch {
  return {
    id: row.id,
    accountId: row.accountId,
    fileName: row.fileName,
    status: row.status,
    headers: row.headers,
    rowCount: row.rowCount,
    errorCount: row.errorCount,
    mapping: row.mapping ? ImportMappingSchema.parse(row.mapping) : null,
    createdAt: row.createdAt.toISOString(),
    committedAt: row.committedAt?.toISOString() ?? null,
  };
}

function toRow(r: ImportRowDb): ImportRow {
  return {
    id: r.id,
    rowIndex: r.rowIndex,
    raw: r.raw as Record<string, string>,
    date: r.date,
    amountPaise: r.amountPaise,
    merchant: r.merchant,
    rawMerchant: r.rawMerchant,
    notes: r.notes,
    categoryId: r.categoryId,
    duplicate: r.duplicate,
    include: r.include,
    error: r.error,
  };
}

async function ownedImport(db: Db, userId: string, id: string): Promise<ImportDb> {
  const row = await db.query.imports.findFirst({
    where: and(eq(imports.id, id), eq(imports.userId, userId)),
  });
  if (!row) throw new HttpError(404, "Import not found");
  return row;
}

// ---------- Staging ----------

/**
 * Parse the CSV and stage raw rows. Yields to the event loop between batches
 * so a 50k-row file never blocks other requests. If a saved preset (or a
 * matching built-in) exists, the mapping is applied immediately.
 */
export async function createImport(
  db: Db,
  userId: string,
  input: { accountId: string; fileName: string; csv: string },
): Promise<ImportBatch> {
  const account = await db.query.accounts.findFirst({
    where: and(eq(accounts.id, input.accountId), eq(accounts.userId, userId)),
  });
  if (!account) throw new HttpError(404, "Account not found");

  // HDFC's printed statement is fixed-width text, not a delimited file — detect
  // that layout and normalize it to CSV so the rest of the pipeline is unchanged.
  const csv = parseHdfcStatement(input.csv) ?? input.csv;
  const rows = parseCsv(csv);
  const first = rows.next();
  if (first.done) throw new HttpError(400, "CSV file is empty");
  const headers = first.value.map((h) => h.trim());
  if (headers.filter(Boolean).length === 0) throw new HttpError(400, "CSV has no header row");

  const [batch] = await db
    .insert(imports)
    .values({ userId, accountId: input.accountId, fileName: input.fileName, headers })
    .returning();
  const importId = batch!.id;

  let pending: Array<typeof importRows.$inferInsert> = [];
  let rowIndex = 0;
  for (const cells of rows) {
    const raw: Record<string, string> = {};
    headers.forEach((h, i) => {
      if (h) raw[h] = cells[i] ?? "";
    });
    pending.push({ importId, rowIndex, raw });
    rowIndex += 1;
    if (pending.length >= BATCH) {
      await db.insert(importRows).values(pending);
      pending = [];
    }
    if (rowIndex % YIELD_EVERY === 0) await yieldLoop();
  }
  if (pending.length > 0) await db.insert(importRows).values(pending);

  await db.update(imports).set({ rowCount: rowIndex }).where(eq(imports.id, importId));

  // one-click reuse: saved per-account preset wins, then built-in header match
  const preset = await db.query.importPresets.findFirst({
    where: and(eq(importPresets.userId, userId), eq(importPresets.accountId, input.accountId)),
  });
  const auto =
    (preset ? ImportMappingSchema.safeParse(preset.mapping).data : undefined) ??
    suggestMapping(headers)?.mapping;
  if (auto && mappingColumns(auto).every((c) => headers.includes(c))) {
    return applyMapping(db, userId, importId, auto, { saveAsPreset: false });
  }
  return toBatch((await db.query.imports.findFirst({ where: eq(imports.id, importId) }))!);
}

// ---------- Mapping / parsing / dedupe ----------

/**
 * (Re)parse every staged row with the given mapping: dates, amounts, merchant
 * normalization and duplicate flagging — both against existing transactions
 * and within the batch. Categories are set per-row by the user (or AI later).
 */
export async function applyMapping(
  db: Db,
  userId: string,
  importId: string,
  mapping: ImportMapping,
  opts: { saveAsPreset: boolean },
): Promise<ImportBatch> {
  const batch = await ownedImport(db, userId, importId);
  if (batch.status !== "staged") throw new HttpError(409, "Import already committed");
  const missing = mappingColumns(mapping).filter((c) => !batch.headers.includes(c));
  if (missing.length > 0) {
    throw new HttpError(400, `Mapped columns not in file: ${missing.join(", ")}`);
  }

  const merchantRules = await getMerchantRules(db, userId);
  const normalize = (m: string) => normalizeMerchant(m, merchantRules);

  const staged = await db.query.importRows.findMany({
    where: eq(importRows.importId, importId),
    orderBy: (r, { asc }) => [asc(r.rowIndex)],
  });

  // parse all rows first to learn the batch's date range
  const parsed = staged.map((r) => parseRow(r.raw as Record<string, string>, mapping, normalize));

  const dates = parsed.map((p) => p.date).filter((d): d is string => d !== null);
  const existingHashes = new Set<string>();
  if (dates.length > 0) {
    const minDate = dates.reduce((a, b) => (a < b ? a : b));
    const maxDate = dates.reduce((a, b) => (a > b ? a : b));
    const existing = await db
      .select({
        date: transactions.date,
        amountPaise: transactions.amountPaise,
        merchant: transactions.merchant,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, userId),
          eq(transactions.accountId, batch.accountId),
          gte(transactions.date, minDate),
          lte(transactions.date, maxDate),
        ),
      );
    for (const t of existing) {
      existingHashes.add(dedupeHash(batch.accountId, t.date, t.amountPaise, t.merchant));
    }
  }

  const seenInBatch = new Set<string>();
  let errorCount = 0;
  for (let i = 0; i < staged.length; i += BATCH) {
    const chunk = staged.slice(i, i + BATCH);
    // one bulk update per chunk via unnest — per-row UPDATEs make 50k rows take minutes
    const ids: string[] = [];
    const dates: Array<string | null> = [];
    const amounts: Array<number | null> = [];
    const merchants: string[] = [];
    const rawMerchants: string[] = [];
    const notes: string[] = [];
    const hashes: Array<string | null> = [];
    const duplicates: boolean[] = [];
    const includes: boolean[] = [];
    const errors: Array<string | null> = [];
    for (let j = 0; j < chunk.length; j += 1) {
      const row = chunk[j]!;
      const p = parsed[i + j]!;
      let hash: string | null = null;
      let duplicate = false;
      if (p.error === null && p.date && p.amountPaise !== null) {
        hash = dedupeHash(batch.accountId, p.date, p.amountPaise, p.merchant);
        duplicate = existingHashes.has(hash) || seenInBatch.has(hash);
        seenInBatch.add(hash);
      } else {
        errorCount += 1;
      }
      ids.push(row.id);
      dates.push(p.date);
      amounts.push(p.amountPaise);
      merchants.push(p.merchant);
      rawMerchants.push(p.rawMerchant);
      notes.push(p.notes);
      hashes.push(hash);
      duplicates.push(duplicate);
      includes.push(p.error === null && !duplicate);
      errors.push(p.error);
    }
    await db.execute(sql`
      update ${importRows} as ir set
        date = u.date::date,
        amount_paise = u.amount_paise,
        merchant = u.merchant,
        raw_merchant = u.raw_merchant,
        notes = u.notes,
        dedupe_hash = u.dedupe_hash,
        duplicate = u.duplicate,
        include = u.include,
        error = u.error
      from (
        select
          unnest(${pgArray(ids)}::uuid[]) as id,
          unnest(${pgArray(dates)}::text[]) as date,
          unnest(${pgArray(amounts)}::bigint[]) as amount_paise,
          unnest(${pgArray(merchants)}::text[]) as merchant,
          unnest(${pgArray(rawMerchants)}::text[]) as raw_merchant,
          unnest(${pgArray(notes)}::text[]) as notes,
          unnest(${pgArray(hashes)}::text[]) as dedupe_hash,
          unnest(${pgArray(duplicates)}::boolean[]) as duplicate,
          unnest(${pgArray(includes)}::boolean[]) as include,
          unnest(${pgArray(errors)}::text[]) as error
      ) u
      where ir.id = u.id
    `);
    await yieldLoop();
  }

  await db.update(imports).set({ mapping, errorCount }).where(eq(imports.id, importId));

  if (opts.saveAsPreset) {
    await db
      .insert(importPresets)
      .values({ userId, accountId: batch.accountId, name: "Saved mapping", mapping })
      .onConflictDoUpdate({
        target: [importPresets.userId, importPresets.accountId],
        set: { mapping, updatedAt: new Date() },
      });
  }

  return toBatch((await db.query.imports.findFirst({ where: eq(imports.id, importId) }))!);
}

// ---------- Listing / row edits ----------

export async function listImports(db: Db, userId: string): Promise<ImportBatch[]> {
  const rows = await db.query.imports.findMany({
    where: eq(imports.userId, userId),
    orderBy: [desc(imports.createdAt)],
  });
  return rows.map(toBatch);
}

export async function getImport(db: Db, userId: string, id: string): Promise<ImportBatch> {
  return toBatch(await ownedImport(db, userId, id));
}

export async function listImportRows(
  db: Db,
  userId: string,
  importId: string,
  query: { offset: number; limit: number; onlyProblems?: boolean },
): Promise<{ items: ImportRow[]; totalCount: number }> {
  await ownedImport(db, userId, importId);
  const conds = [eq(importRows.importId, importId)];
  if (query.onlyProblems) {
    conds.push(sql`(${importRows.duplicate} or ${importRows.error} is not null)`);
  }
  const where = and(...conds);
  const [items, total] = await Promise.all([
    db.query.importRows.findMany({
      where,
      orderBy: (r, { asc }) => [asc(r.rowIndex)],
      offset: query.offset,
      limit: query.limit,
    }),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(importRows)
      .where(where),
  ]);
  return { items: items.map(toRow), totalCount: total[0]!.count };
}

export async function updateImportRow(
  db: Db,
  userId: string,
  importId: string,
  rowId: string,
  input: { include?: boolean; categoryId?: string | null; duplicate?: boolean },
): Promise<ImportRow> {
  const batch = await ownedImport(db, userId, importId);
  if (batch.status !== "staged") throw new HttpError(409, "Import already committed");
  // A row may only be tagged with one of the user's own categories — otherwise a
  // foreign category UUID would ride through commit into the ledger.
  if (input.categoryId) {
    const cat = await db.query.categories.findFirst({
      where: and(eq(categories.id, input.categoryId), eq(categories.userId, userId)),
      columns: { id: true },
    });
    if (!cat) throw new HttpError(404, "Category not found");
  }
  const rows = await db
    .update(importRows)
    .set(input)
    .where(and(eq(importRows.id, rowId), eq(importRows.importId, importId)))
    .returning();
  if (rows.length === 0) throw new HttpError(404, "Row not found");
  return toRow(rows[0]!);
}

// ---------- Commit / rollback ----------

export async function commitImport(
  db: Db,
  userId: string,
  importId: string,
): Promise<CommitResult> {
  const batch = await ownedImport(db, userId, importId);
  if (batch.status !== "staged") throw new HttpError(409, "Import already committed");
  if (!batch.mapping) throw new HttpError(400, "Set a column mapping before committing");
  const mapping = ImportMappingSchema.parse(batch.mapping);

  const account = await db.query.accounts.findFirst({
    where: and(eq(accounts.id, batch.accountId), eq(accounts.userId, userId)),
    columns: { type: true },
  });
  if (!account) throw new HttpError(404, "Account not found");

  const rows = await db.query.importRows.findMany({
    where: eq(importRows.importId, importId),
    orderBy: (r, { asc }) => [asc(r.rowIndex)],
  });

  const committable = rows.filter(
    (r) =>
      r.include && !r.duplicate && r.error === null && r.date !== null && r.amountPaise !== null,
  );
  let created = 0;
  let matchedExisting = 0;
  let updatedFromStatement = 0;
  let reconciliationConflicts = 0;
  let skippedDuplicates = rows.filter((r) => r.duplicate).length;
  const skippedErrors = rows.filter((r) => r.error !== null).length;
  let skippedExcluded = rows.length - committable.length - skippedDuplicates - skippedErrors;
  let reconciledNetPaise = committable.reduce((sum, row) => sum + row.amountPaise!, 0);

  // atomic: either the whole batch lands in transactions or none of it
  await db.transaction(async (t) => {
    // Claim the batch first, under a row lock: transition staged -> committed
    // only if it's still staged. A second concurrent commit blocks here, then
    // matches zero rows and bails — so a batch can never be inserted twice.
    const claimed = await t
      .update(imports)
      .set({ status: "committed", committedAt: new Date() })
      .where(and(eq(imports.id, importId), eq(imports.status, "staged")))
      .returning({ id: imports.id });
    if (claimed.length === 0) throw new HttpError(409, "Import already committed");

    let toCreate = committable;
    if (account.type === "credit_card") {
      // Serialize different imports for one card. The second commit then sees
      // the first commit's inserts and reconciles instead of recreating them.
      await t.execute(sql`select id from ${accounts} where id = ${batch.accountId} for update`);

      // Auto-flagged duplicates have include=false. They still participate in
      // reconciliation so re-importing a statement attaches to existing data
      // rather than silently dropping or recreating it.
      const statementRows = rows
        .filter(
          (row) =>
            (row.include || row.duplicate) &&
            row.error === null &&
            row.date !== null &&
            row.amountPaise !== null,
        )
        .map((row) => ({
          id: row.id,
          date: row.date!,
          amountPaise: row.amountPaise!,
          merchant: row.merchant,
          notes: row.notes,
        }));

      let existing: Array<{
        id: string;
        date: string;
        amountPaise: number;
        merchant: string;
        notes: string;
      }> = [];
      if (statementRows.length > 0) {
        const dates = statementRows.map((row) => row.date).sort();
        const shift = (date: string, days: number) => {
          const value = new Date(`${date}T00:00:00Z`);
          value.setUTCDate(value.getUTCDate() + days);
          return value.toISOString().slice(0, 10);
        };
        existing = await t
          .select({
            id: transactions.id,
            date: transactions.date,
            amountPaise: transactions.amountPaise,
            merchant: transactions.merchant,
            notes: transactions.notes,
          })
          .from(transactions)
          .where(
            and(
              eq(transactions.userId, userId),
              eq(transactions.accountId, batch.accountId),
              isNull(transactions.deletedAt),
              gte(transactions.date, shift(dates[0]!, -3)),
              lte(transactions.date, shift(dates.at(-1)!, 3)),
            ),
          )
          .orderBy(transactions.date, transactions.id);
      }

      const plan = reconcileStatementTransactions(statementRows, existing);
      const updates = plan.filter((item) => item.action === "update");
      for (const item of updates) {
        await t
          .update(transactions)
          .set({
            date: item.row.date,
            amountPaise: item.row.amountPaise,
            merchant: item.row.merchant,
            ...(mapping.notesColumn ? { notes: item.row.notes } : {}),
            source: "import",
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(transactions.id, item.transactionId),
              eq(transactions.userId, userId),
              eq(transactions.accountId, batch.accountId),
            ),
          );
      }
      const updatedIds = updates.map((item) => item.transactionId);
      if (updatedIds.length > 0) {
        // A statement correction can invalidate an inferred card payment.
        // Preserve manual transfer links and let auto-linking rebuild its own.
        await t
          .delete(transferLinks)
          .where(
            and(
              eq(transferLinks.userId, userId),
              eq(transferLinks.auto, true),
              or(
                inArray(transferLinks.outTransactionId, updatedIds),
                inArray(transferLinks.inTransactionId, updatedIds),
              ),
            ),
          );
      }

      matchedExisting = plan.filter((item) => item.action === "matched").length;
      updatedFromStatement = updates.length;
      reconciliationConflicts = plan.filter((item) => item.action === "conflict").length;
      skippedDuplicates = matchedExisting;
      const createIds = new Set(
        plan.filter((item) => item.action === "create").map((item) => item.row.id),
      );
      toCreate = rows.filter((row) => createIds.has(row.id));
      skippedExcluded = rows.length - plan.length - skippedErrors;
      reconciledNetPaise = plan
        .filter((item) => item.action !== "conflict")
        .reduce((sum, item) => sum + item.row.amountPaise, 0);
    }

    created = toCreate.length;
    for (let i = 0; i < toCreate.length; i += BATCH) {
      const chunk = toCreate.slice(i, i + BATCH);
      const inserted = await t
        .insert(transactions)
        .values(
          chunk.map((r) => ({
            userId,
            accountId: batch.accountId,
            date: r.date!,
            amountPaise: r.amountPaise!,
            merchant: r.merchant,
            categoryId: r.categoryId,
            notes: r.notes,
            source: "import" as const,
          })),
        )
        .returning({ id: transactions.id });
      const rowIds = chunk.map((r) => r.id);
      const txIds = inserted.map((x) => x.id);
      await t.execute(sql`
        update ${importRows} as ir set transaction_id = u.tx::uuid
        from (select unnest(${pgArray(rowIds)}::uuid[]) as id, unnest(${pgArray(txIds)}::uuid[]) as tx) u
        where ir.id = u.id
      `);
    }
  });

  // card payments (credits) that match a debit on the paying account become
  // transfers, not income — keeps aggregates and net worth honest
  const linkedTransfers = await autoLinkTransfers(db, userId);

  return {
    created,
    matchedExisting,
    updatedFromStatement,
    reconciliationConflicts,
    skippedDuplicates,
    skippedExcluded,
    skippedErrors,
    netPaise: reconciledNetPaise,
    linkedTransfers,
  };
}

/** Hard-delete exactly the batch's transactions; balances recompute automatically. */
export async function rollbackImport(
  db: Db,
  userId: string,
  importId: string,
): Promise<{ removed: number }> {
  const batch = await ownedImport(db, userId, importId);
  if (batch.status !== "committed")
    throw new HttpError(409, "Only committed imports can be rolled back");

  const rows = await db
    .select({ transactionId: importRows.transactionId })
    .from(importRows)
    .where(and(eq(importRows.importId, importId), sql`${importRows.transactionId} is not null`));
  const ids = rows.map((r) => r.transactionId!).filter(Boolean);

  await db.transaction(async (t) => {
    for (let i = 0; i < ids.length; i += BATCH) {
      await t
        .delete(transactions)
        .where(
          and(eq(transactions.userId, userId), inArray(transactions.id, ids.slice(i, i + BATCH))),
        );
    }
    await t
      .update(importRows)
      .set({ transactionId: null })
      .where(eq(importRows.importId, importId));
    await t.update(imports).set({ status: "rolled_back" }).where(eq(imports.id, importId));
  });

  return { removed: ids.length };
}

export async function deleteImport(db: Db, userId: string, importId: string): Promise<void> {
  const batch = await ownedImport(db, userId, importId);
  if (batch.status === "committed") {
    throw new HttpError(409, "Roll back the import before deleting it");
  }
  await db.delete(imports).where(eq(imports.id, importId));
}
