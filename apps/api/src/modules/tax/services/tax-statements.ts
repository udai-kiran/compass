/**
 * tax-statements.ts — staged AIS / 26AS / Form-16 import + reconciliation
 * (task 13.13).
 *
 * The pattern is the one the rest of Compass uses for disagreeing documents:
 * **staged, reviewable, reversible — never auto-applied.** An import lands as a
 * `pending` tax_statements row plus its reported lines; reconciliation compares
 * those lines against the user's own income_events ledger and stamps verdicts
 * on the statement's OWN rows. Accepting a statement never writes to the
 * ledger — the discrepancy report IS the product.
 *
 * PRIVACY (non-negotiable, see tasks/13.13): these documents carry PAN and
 * full income detail. The assessee's full PAN is never persisted or echoed —
 * only its last 4 digits at creation time. Matching is deterministic string/
 * amount comparison: NO model call anywhere in this path, so there is nothing
 * to redact before a model call and nothing is logged raw.
 */

import { and, asc, eq, isNull, ne } from "drizzle-orm";
import type {
  TaxLineMatchStatus,
  TaxStatementDetail,
  TaxStatementList,
  TaxStatementSummary,
  UnmatchedLedgerEvent,
} from "@compass/shared";
import type { CreateTaxStatementBody } from "@compass/shared";
import type { Db, DbOrTx } from "../../../db/index.ts";
import type { Storage } from "../../../lib/storage.ts";
import { incomeEvents, taxStatementLines, taxStatements } from "../schema.ts";
import { HttpError } from "../../../lib/errors.ts";

// ─── The matcher (pure) ───────────────────────────────────────────────────────

/** The slice of an income-event row matching needs. */
export interface MatchCandidateEvent {
  id: string;
  incomeKind: string;
  section: string | null;
  payerName: string | null;
  payerTan: string | null;
  grossPaise: number;
  tdsPaise: number;
}

/** One reported line, reduced to the fields matching reads. */
export interface MatchableLine {
  section: string | null;
  category: string;
  payerName: string | null;
  payerTan: string | null;
  grossPaise: number;
  tdsPaise: number;
}

export interface LineVerdict {
  status: TaxLineMatchStatus;
  matchedIncomeEventId: string | null;
}

/** Case/space-insensitive payer-name key; null passes through for absent names. */
function normName(name: string | null): string | null {
  return name == null ? null : name.trim().toLowerCase().replace(/\s+/g, " ");
}

function tanKey(line: MatchableLine): string | null {
  return line.payerTan == null || line.payerTan === "" ? null : line.payerTan.toUpperCase();
}

/**
 * Match statement lines against ledger events, one-to-one and deterministically.
 *
 * A line pairs with an event when:
 *   - `category` equals the event's income kind, AND
 *   - sections do not CONFLICT: equal when both are stated; an absent section
 *     on either side acts as a wildcard,
 *   - identity binds: TANs present on both sides and equal, OR names present
 *     on both sides and equal after normalisation. Neither ⇒ no pairing — an
 *     anonymous "interest received" AIS line is NOT force-matched to whatever
 *     interest event happens to exist.
 *
 * Matching runs in TWO passes so a greedy early pairing can never steal an
 * event that a later line would have matched EXACTLY:
 *   pass 1 — every line takes its first unconsumed qualifying event whose gross
 *            AND TDS are identical (`matched`);
 *   pass 2 — each still-unpaired line pairs with the first unconsumed
 *            qualifying event as `amount_mismatch` — the figures disagree,
 *            which is exactly what review should surface.
 * Paired events are consumed, so two identical lines against one event yield
 * one match and one unmatched, never a double-count. Callers pass events
 * ordered by (createdAt, id) so "first" is stable.
 */
export function matchStatementLines(
  lines: MatchableLine[],
  events: MatchCandidateEvent[],
): LineVerdict[] {
  const qualifies = (line: MatchableLine, e: MatchCandidateEvent): boolean => {
    if (e.incomeKind !== line.category) return false;
    if (line.section != null && e.section != null && e.section !== line.section) return false;
    const lt = tanKey(line);
    const et = e.payerTan == null || e.payerTan === "" ? null : e.payerTan.toUpperCase();
    if (lt != null && et != null) return lt === et;
    const ln = normName(line.payerName);
    const en = normName(e.payerName);
    return ln != null && en != null && ln === en;
  };

  const remaining = new Set(events.map((e) => e.id));
  const exactFor = new Array<string | null>(lines.length).fill(null);

  // Pass 1 — exact (gross AND TDS) matches claim their events first.
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const exact = events.find(
      (e) =>
        remaining.has(e.id) &&
        qualifies(line, e) &&
        e.grossPaise === line.grossPaise &&
        e.tdsPaise === line.tdsPaise,
    );
    if (exact) {
      remaining.delete(exact.id);
      exactFor[i] = exact.id;
    }
  }

  // Pass 2 — everything else pairs with the first unconsumed qualifier.
  return lines.map((line, i): LineVerdict => {
    if (exactFor[i]) return { status: "matched", matchedIncomeEventId: exactFor[i] };
    const fallback = events.find((e) => remaining.has(e.id) && qualifies(line, e));
    if (!fallback) return { status: "unmatched", matchedIncomeEventId: null };
    remaining.delete(fallback.id);
    return { status: "amount_mismatch", matchedIncomeEventId: fallback.id };
  });
}

/**
 * Ledger events for this FY that no reported line accounted for — the
 * reviewable list behind `unmatchedLedgerCount`. Pure: given the statement's
 * own lines (already stamped with `matchedIncomeEventId` by reconciliation)
 * and the candidate events, returns the events no line references. No DB
 * access, so it is unit-testable directly.
 *
 * Two different things both end up called "unmatchedLedgerCount" in this
 * file, and they can disagree: `taxStatements.unmatchedLedgerCount` is a
 * column PERSISTED by `reconcileInTx()` — stale (0 by default) until the
 * first reconcile/accept, and stale again if the ledger changes afterward.
 * `getDetail()` instead derives its `unmatchedLedgerCount` LIVE, as
 * `deriveUnmatchedLedgerEvents(...).length`, from this same call whose result
 * becomes its `unmatchedLedgerEvents` list — so the detail response's count
 * and list can never contradict each other, even for a never-reconciled or
 * since-drifted statement. `listTaxStatements()` (`toSummary()`) has no
 * per-line detail to do this cheaply for every row (would be an N+1 query),
 * so it is left on the persisted column — an accepted limitation for that
 * endpoint specifically.
 */
export function deriveUnmatchedLedgerEvents<E extends { id: string }>(
  lines: Array<{ matchedIncomeEventId: string | null }>,
  events: E[],
): E[] {
  const consumed = new Set(
    lines.map((l) => l.matchedIncomeEventId).filter((id): id is string => id != null),
  );
  return events.filter((e) => !consumed.has(e.id));
}

// ─── Row mapping ──────────────────────────────────────────────────────────────

type StatementRow = typeof taxStatements.$inferSelect;
type LineRow = typeof taxStatementLines.$inferSelect;

/** PAN shape (5 letters + 4 digits + 1 letter) — masked out of line echoes. */
const PAN_SHAPE = /^[A-Za-z]{5}[0-9]{4}[A-Za-z]$/;

/**
 * A reported "TAN" that is actually the assessee's PAN is needed for matching
 * but must never be echoed back. TANs (and anything else) pass through.
 */
export function maskPayerTan(value: string | null): string | null {
  return value != null && PAN_SHAPE.test(value) ? null : value;
}

function toSummary(row: StatementRow): TaxStatementSummary {
  return {
    id: row.id,
    fy: row.fy,
    docKind: row.docKind,
    status: row.status,
    hasDocument: row.documentKey != null,
    sourceLabel: row.sourceLabel,
    lineCount: row.lineCount,
    grossTotalPaise: row.grossTotalPaise,
    tdsTotalPaise: row.tdsTotalPaise,
    matchedCount: row.matchedCount,
    unmatchedCount: row.unmatchedCount,
    amountMismatchCount: row.amountMismatchCount,
    unmatchedLedgerCount: row.unmatchedLedgerCount,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
  };
}

function toLine(row: LineRow): TaxStatementDetail["lines"][number] {
  return {
    id: row.id,
    statementId: row.statementId,
    section: row.section,
    category: row.category,
    payerName: row.payerName,
    // AIS lines often carry the assessee's own PAN where a TAN is expected.
    // It was needed for matching, but it is never echoed — the statement's
    // panLast4 already covers identity confirmation.
    payerTan: maskPayerTan(row.payerTan),
    period: row.period,
    accrualDate: row.accrualDate,
    grossPaise: row.grossPaise,
    tdsPaise: row.tdsPaise,
    matchStatus: row.matchStatus,
    matchedIncomeEventId: row.matchedIncomeEventId,
  };
}

// ─── DB operations ────────────────────────────────────────────────────────────

async function loadStatement(db: Db, userId: string, id: string): Promise<StatementRow> {
  const [row] = await db
    .select()
    .from(taxStatements)
    .where(and(eq(taxStatements.id, id), eq(taxStatements.userId, userId)));
  if (!row) throw new HttpError(404, "Tax statement not found");
  return row;
}

async function loadLines(db: Db, statementId: string): Promise<LineRow[]> {
  return db
    .select()
    .from(taxStatementLines)
    .where(eq(taxStatementLines.statementId, statementId))
    .orderBy(asc(taxStatementLines.createdAt), asc(taxStatementLines.id));
}

async function getDetail(db: Db, userId: string, id: string): Promise<TaxStatementDetail> {
  const row = await loadStatement(db, userId, id);
  const lines = await loadLines(db, id);
  const events = await db
    .select({
      id: incomeEvents.id,
      incomeKind: incomeEvents.incomeKind,
      payerName: incomeEvents.payerName,
      grossPaise: incomeEvents.grossPaise,
      tdsPaise: incomeEvents.tdsPaise,
      accrualDate: incomeEvents.accrualDate,
    })
    .from(incomeEvents)
    .where(
      and(
        eq(incomeEvents.userId, userId),
        eq(incomeEvents.fy, row.fy),
        ne(incomeEvents.status, "rejected"),
      ),
    )
    .orderBy(asc(incomeEvents.createdAt), asc(incomeEvents.id));
  const unmatchedLedgerEvents: UnmatchedLedgerEvent[] = deriveUnmatchedLedgerEvents(lines, events);
  return {
    ...toSummary(row),
    // Override toSummary(row)'s persisted, reconcile-time-computed count: a
    // statement that was just created (never reconciled) has that column at
    // its 0 default while unmatchedLedgerEvents below is derived live and can
    // be non-empty, and even a reconciled statement can drift if the ledger
    // changes afterward. The DETAIL response must be internally consistent
    // with the list it returns, so the count here is always
    // unmatchedLedgerEvents.length — never the row's stored value. (The
    // LIST/summary endpoint has no per-line detail to derive a live count
    // from without an N+1 query, so it stays on the persisted column — an
    // accepted, pre-existing limitation for that endpoint only.)
    unmatchedLedgerCount: unmatchedLedgerEvents.length,
    panLast4: row.panLast4,
    lines: lines.map(toLine),
    unmatchedLedgerEvents,
  };
}

/** Create a staged import from typed/pasted rows. Totals are computed here. */
export async function createTaxStatement(
  db: Db,
  userId: string,
  body: CreateTaxStatementBody,
): Promise<TaxStatementDetail> {
  const grossTotalPaise = body.lines.reduce((s, l) => s + l.grossPaise, 0);
  const tdsTotalPaise = body.lines.reduce((s, l) => s + l.tdsPaise, 0);

  const created = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(taxStatements)
      .values({
        userId,
        fy: body.fy,
        docKind: body.docKind,
        status: "pending",
        panLast4: body.panLast4 ?? null,
        // Free text (CreateTaxStatementBodySchema caps it at 200 chars), but
        // only ever set and echoed back to the SAME user who owns this
        // statement — never shown to another user, never logged. Not a
        // cross-user PAN-leak vector the way `payerTan` was, so left as-is.
        sourceLabel: body.sourceLabel ?? "typed",
        lineCount: body.lines.length,
        grossTotalPaise,
        tdsTotalPaise,
        note: body.note ?? null,
      })
      .returning();
    if (body.lines.length > 0) {
      await tx.insert(taxStatementLines).values(
        body.lines.map((l) => ({
          statementId: row!.id,
          section: l.section ?? null,
          category: l.category,
          payerName: l.payerName ?? null,
          // Masked at WRITE time, not just on read: a PAN-shaped "TAN" must
          // never sit in the DB unmasked (see the file docstring's privacy
          // guarantee). matchStatementLines() falls back to normalized
          // payer-name matching when TAN is absent on either side, so a
          // masked-to-null payerTan here still matches via payer name when
          // one is stated, and correctly stays unmatched (not force-matched)
          // when it isn't — matching stays sound.
          payerTan: maskPayerTan(
            l.payerTan == null || l.payerTan === "" ? null : l.payerTan.toUpperCase(),
          ),
          period: l.period ?? null,
          accrualDate: l.accrualDate ?? null,
          grossPaise: l.grossPaise,
          tdsPaise: l.tdsPaise,
        })),
      );
    }
    return row!;
  });
  return getDetail(db, userId, created.id);
}

/** List staged imports for an FY, newest first. */
export async function listTaxStatements(
  db: Db,
  userId: string,
  fy: string,
): Promise<TaxStatementList> {
  const rows = await db
    .select()
    .from(taxStatements)
    .where(and(eq(taxStatements.userId, userId), eq(taxStatements.fy, fy)))
    .orderBy(asc(taxStatements.createdAt));
  return { fy, statements: rows.map(toSummary).reverse() };
}

export async function getTaxStatement(
  db: Db,
  userId: string,
  id: string,
): Promise<TaxStatementDetail> {
  return getDetail(db, userId, id);
}

/**
 * Reconciliation core — runs INSIDE a transaction. Loads the statement's lines
 * and the user's non-rejected income events for its FY, stamps verdicts onto
 * the lines and refreshes all match counters (including how many ledger events
 * no reported line accounted for). Ledger rows are never touched.
 */
async function reconcileInTx(tx: DbOrTx, userId: string, statement: StatementRow): Promise<void> {
  const lines = await tx
    .select()
    .from(taxStatementLines)
    .where(eq(taxStatementLines.statementId, statement.id))
    .orderBy(asc(taxStatementLines.createdAt), asc(taxStatementLines.id));

  const events = await tx
    .select({
      id: incomeEvents.id,
      incomeKind: incomeEvents.incomeKind,
      section: incomeEvents.section,
      payerName: incomeEvents.payerName,
      payerPan: incomeEvents.payerPan,
      payerTan: incomeEvents.payerTan,
      grossPaise: incomeEvents.grossPaise,
      tdsPaise: incomeEvents.tdsPaise,
    })
    .from(incomeEvents)
    .where(
      and(
        eq(incomeEvents.userId, userId),
        eq(incomeEvents.fy, statement.fy),
        ne(incomeEvents.status, "rejected"),
      ),
    )
    .orderBy(asc(incomeEvents.createdAt), asc(incomeEvents.id));

  // Events carry both PAN and TAN columns; matching treats them as one
  // identity slot (TAN preferred, PAN as fallback) since AIS reports both.
  const candidates = events.map((e) => ({
    id: e.id,
    incomeKind: e.incomeKind,
    section: e.section,
    payerName: e.payerName,
    payerTan: e.payerTan ?? e.payerPan,
    grossPaise: e.grossPaise,
    tdsPaise: e.tdsPaise,
  }));

  const verdicts = matchStatementLines(lines, candidates);

  for (let i = 0; i < lines.length; i++) {
    const v = verdicts[i]!;
    await tx
      .update(taxStatementLines)
      .set({ matchStatus: v.status, matchedIncomeEventId: v.matchedIncomeEventId })
      .where(eq(taxStatementLines.id, lines[i]!.id));
  }
  const matchedCount = verdicts.filter((v) => v.status === "matched").length;
  const amountMismatchCount = verdicts.filter((v) => v.status === "amount_mismatch").length;
  const consumed = new Set(verdicts.map((v) => v.matchedIncomeEventId));
  await tx
    .update(taxStatements)
    .set({
      matchedCount,
      amountMismatchCount,
      unmatchedCount: verdicts.length - matchedCount - amountMismatchCount,
      unmatchedLedgerCount: events.filter((e) => !consumed.has(e.id)).length,
      updatedAt: new Date(),
    })
    .where(eq(taxStatements.id, statement.id));
}

/**
 * Re-run reconciliation for a statement in any state.
 */
export async function reconcileTaxStatement(
  db: Db,
  userId: string,
  id: string,
): Promise<TaxStatementDetail> {
  const statement = await loadStatement(db, userId, id);
  await db.transaction(async (tx) => reconcileInTx(tx, userId, statement));
  return getDetail(db, userId, id);
}

/**
 * Guarded state transition: pending → accepted, with reconciliation in the
 * SAME transaction — an accepted statement can never be stale, and a failed
 * reconcile leaves it pending rather than half-committed.
 */
export async function acceptTaxStatement(
  db: Db,
  userId: string,
  id: string,
): Promise<TaxStatementDetail> {
  await db.transaction(async (tx) => {
    const [statement] = await tx
      .select()
      .from(taxStatements)
      .for("update")
      .where(and(eq(taxStatements.id, id), eq(taxStatements.userId, userId)));
    if (!statement) throw new HttpError(404, "Tax statement not found");
    if (statement.status !== "pending") throw new HttpError(409, "Statement is not pending");
    await reconcileInTx(tx, userId, statement);
    await tx
      .update(taxStatements)
      .set({ status: "accepted", updatedAt: new Date() })
      .where(eq(taxStatements.id, id));
  });
  return getDetail(db, userId, id);
}

/** Guarded state transition: pending → rejected. */
export async function rejectTaxStatement(
  db: Db,
  userId: string,
  id: string,
): Promise<TaxStatementDetail> {
  await loadStatement(db, userId, id);
  const updated = await db
    .update(taxStatements)
    .set({ status: "rejected", updatedAt: new Date() })
    .where(and(eq(taxStatements.id, id), eq(taxStatements.status, "pending")))
    .returning({ id: taxStatements.id });
  if (updated.length === 0) throw new HttpError(409, "Statement is not pending");
  return getDetail(db, userId, id);
}

/** Human label for an attached raw document — never the raw filename, which
 * can carry PAN or employer details that have no business in the DB. */
function describeUpload(mime: string): string {
  if (mime === "application/pdf") return "PDF upload";
  if (mime.startsWith("image/")) return "Image upload";
  if (mime === "application/json") return "JSON export upload";
  if (mime === "text/csv") return "CSV upload";
  if (mime.includes("excel") || mime.includes("spreadsheet")) return "Spreadsheet upload";
  return "File upload";
}

/**
 * Attach (or replace) the raw document behind an opaque Storage key.
 *
 * Failure ordering is deliberate:
 *   - upload first; if the row update then fails, the freshly uploaded object
 *     is deleted (no orphan);
 *   - the row update is a COMPARE-AND-SWAP on the observed `document_key`: two
 *     concurrent replacements cannot both win, so the loser deletes its own
 *     fresh object and surfaces 409 instead of orphaning the winner's object;
 *   - a REPLACED document's old key is deleted only after the row points at the
 *     new one (a dangling old object beats a row pointing at nothing).
 */
export async function attachTaxStatementDocument(
  db: Db,
  storage: Storage,
  userId: string,
  id: string,
  file: { buffer: Buffer; contentType: string },
): Promise<{ hasDocument: true }> {
  const existing = await loadStatement(db, userId, id); // also proves ownership
  const observedKey = existing.documentKey;
  const key = await storage.put(file.buffer, file.contentType);
  try {
    // CAS guard: match on the key we observed (IS NULL when there was none), so
    // a concurrent replacement between our read and write makes this update a
    // no-op rather than silently clobbering the other request's object.
    const updated = await db
      .update(taxStatements)
      .set({
        documentKey: key,
        sourceLabel: describeUpload(file.contentType),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(taxStatements.id, id),
          eq(taxStatements.userId, userId),
          observedKey == null
            ? isNull(taxStatements.documentKey)
            : eq(taxStatements.documentKey, observedKey),
        ),
      )
      .returning({ id: taxStatements.id });
    if (updated.length === 0)
      throw new HttpError(409, "Statement changed concurrently — retry with its current state");
  } catch (e) {
    await storage.delete(key).catch(() => {});
    throw e;
  }
  if (observedKey && observedKey !== key) {
    await storage.delete(observedKey).catch(() => {});
  }
  return { hasDocument: true };
}

/**
 * Remove a staged import entirely — rows AND its stored raw document. Nothing
 * was ever applied to the ledger, so this is a complete undo.
 */
export async function deleteTaxStatement(
  db: Db,
  storage: Storage,
  userId: string,
  id: string,
): Promise<void> {
  const deleted = await db
    .delete(taxStatements)
    .where(and(eq(taxStatements.id, id), eq(taxStatements.userId, userId)))
    .returning({ id: taxStatements.id, documentKey: taxStatements.documentKey });
  if (deleted.length === 0) throw new HttpError(404, "Tax statement not found");
  const key = deleted[0]!.documentKey;
  if (key) await storage.delete(key).catch(() => {});
}
