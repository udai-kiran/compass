import { and, desc, eq, gt, gte, isNull, lte, sql } from "drizzle-orm";
import type {
  HoldingEvent,
  LinkSipInstallment,
  RecordSipInstallment,
  Sip,
  SipInstallmentCandidate,
} from "@compass/shared";
import { LinkSipInstallmentSchema, RecordSipInstallmentSchema, unitsForInstallment } from "@compass/shared";
import type { SipFundingSource, SipTargetKind } from "@compass/shared";
import type { Db } from "../../../db/index.ts";
import { postings, transactions } from "../../../db/schema.ts";
import { holdingEvents, holdings, sips } from "../schema.ts";
import { HttpError, pgError } from "../../../lib/errors.ts";
import { nextSeqForDate } from "./holdings.ts";
import {
  isArchived,
  isUniqueViolation,
  lastInstallmentDateFor,
  ownedSip,
  toSip,
} from "./sip-lifecycle.ts";

// ---------- Recording an actual installment ----------

/**
 * Whether an installment date falls within the SIP's life — before its start,
 * or after an endDate if one is set. ISO dates (`YYYY-MM-DD`) compare
 * correctly as plain strings, so no Date parsing is needed. Pure so it's
 * unit-testable without a DB.
 */
export function installmentDateError(sip: { startDate: string; endDate: string | null }, date: string): string | null {
  if (date < sip.startDate) return "Installment date is before the SIP started";
  if (sip.endDate !== null && date > sip.endDate) return "Installment date is after the SIP ended";
  return null;
}

/**
 * Why this SIP can't record an installment by linking a ledger transaction, as
 * a status+message to throw, or null when it can. Split out of
 * `linkInstallmentIssue` so the candidate listing can apply exactly the same
 * two SIP-level gates without having to invent a transaction to test against.
 * Pure so both gates are unit-testable without a DB.
 */
export function accountInstallmentSipIssue(sip: {
  targetKind: SipTargetKind;
  fundingSource: SipFundingSource;
}): { status: number; message: string } | null {
  if (sip.targetKind !== "account") {
    return { status: 400, message: "Only an account-target SIP records by linking a ledger transaction" };
  }
  if (sip.fundingSource === "payroll") {
    return { status: 400, message: "A payroll-funded SIP is recorded from your payslip, not manually" };
  }
  return null;
}

/**
 * Whether an existing ledger transaction can stand as this SIP's installment —
 * a status+message to throw, or null when it can. Pure so every rule is
 * unit-testable without a DB, and ordered deliberately: the SIP-level gates
 * first (a wrong-kind SIP makes every later question meaningless), then the
 * row's identity, then its existing link, then the date window.
 *
 * The row must be a *credit into the SIP's own target account*: the outgoing
 * leg of the same transfer is negative and sits in the source account, so the
 * sign check is what keeps the debit side from being mistaken for the deposit.
 * An opening-balance row is excluded because it is a reconciliation seed, not
 * money that moved. A row already linked to *another* SIP is a 409 rather than
 * a 400 — nothing about the request is malformed, it just lost a race for a
 * transaction that is now spoken for. Amount is deliberately *not* checked
 * against `sip.amountPaise`: a real PPF/SSY deposit routinely differs from the
 * plan, exactly as `recordSipInstallment` lets the MF amount be overridden.
 */
export function linkInstallmentIssue(
  sip: {
    id: string;
    targetKind: SipTargetKind;
    targetAccountId: string | null;
    fundingSource: SipFundingSource;
    startDate: string;
    endDate: string | null;
  },
  tx: { accountId: string; amountPaise: number; date: string; isOpening: boolean; sipId: string | null },
): { status: number; message: string } | null {
  const sipIssue = accountInstallmentSipIssue(sip);
  if (sipIssue) return sipIssue;
  if (tx.accountId !== sip.targetAccountId) {
    return { status: 400, message: "That transaction isn't in this SIP's target account" };
  }
  if (tx.isOpening) {
    return { status: 400, message: "An opening-balance entry can't be a SIP installment" };
  }
  if (tx.amountPaise <= 0) {
    return { status: 400, message: "A SIP installment must be money arriving in the target account" };
  }
  if (tx.sipId !== null && tx.sipId !== sip.id) {
    return { status: 409, message: "That transaction is already linked to another SIP's installment" };
  }
  const dateError = installmentDateError(sip, tx.date);
  if (dateError) return { status: 400, message: dateError };
  return null;
}

/**
 * The inclusive date window a linkable transaction must fall in: no earlier
 * than the SIP's start, no later than the `asOf` day the user is recording
 * against — clamped to `endDate` once the SIP has ended, so an ended SIP stops
 * offering deposits it could never have funded (the same clamp
 * `lastOccurrenceOnOrBefore` applies to `today`). An `asOf` before `startDate`
 * yields an empty window (`to < from`), which the query simply returns nothing
 * for. Pure so the clamp is testable without a DB.
 */
export function candidateDateBounds(
  sip: { startDate: string; endDate: string | null },
  asOf: string,
): { from: string; to: string } {
  const to = sip.endDate !== null && asOf > sip.endDate ? sip.endDate : asOf;
  return { from: sip.startDate, to };
}

/** Most ledger candidates offered for one account-target installment link. */
const INSTALLMENT_CANDIDATE_LIMIT = 20;

/**
 * Books an actual buy against a SIP's target folio when an installment goes
 * through — the amount/units/NAV the platform actually allotted, not the
 * SIP's own plan. Deliberately does not create a ledger `transactions` row;
 * the SIP's bank-side debit and this fund-side buy are tracked independently.
 */
export async function recordSipInstallment(
  db: Db,
  userId: string,
  sipId: string,
  input: RecordSipInstallment,
): Promise<HoldingEvent> {
  const parsed = RecordSipInstallmentSchema.parse(input);

  // Everything from the SIP read through the insert runs inside one
  // transaction with the holding and SIP rows locked FOR UPDATE, in that
  // order: the holding is locked before the sips row to match
  // createSip/updateSip's parent-first convention (they lock the referenced
  // account/holding before touching the sips row) — locking sips first here
  // would invert that order and risk a deadlock against a concurrent
  // updateSip on the same SIP. Since we don't know which holding to lock
  // until we've read the SIP, we take an unlocked probe read first, lock the
  // holding, then re-read the SIP under its own lock and confirm its target
  // didn't move in between (a concurrent updateSip could have repointed it).
  // Computing `seq` inside the same locks also stops two concurrent same-day
  // recordings from both computing the same intra-day sequence.
  return db.transaction(async (tx) => {
    // Unlocked probe: we only need it to learn which holding to lock. The
    // authoritative read is the locked one below. Reading it unlocked first is
    // what lets us take the two locks in the same order the rest of this file
    // does — createSip/updateSip both lock the referenced account/holding
    // before touching the sips row, so locking sips first here would invert
    // the order and let a recorder and a concurrent updateSip deadlock.
    const probeRows = await tx
      .select({ targetKind: sips.targetKind, targetHoldingId: sips.targetHoldingId })
      .from(sips)
      .where(and(eq(sips.id, sipId), eq(sips.userId, userId)));
    const probe = probeRows[0];
    if (!probe) throw new HttpError(404, "SIP not found");

    // An account-target SIP (PPF/SSY) has no folio to allot units into — only an
    // mf_folio SIP can book a fund transaction.
    if (probe.targetKind !== "mf_folio") {
      throw new HttpError(400, "Only an MF-folio SIP can record a fund transaction");
    }

    const holdingRows = await tx
      .select({ archivedAt: holdings.archivedAt })
      .from(holdings)
      .where(and(eq(holdings.id, probe.targetHoldingId!), eq(holdings.userId, userId)))
      .for("update");
    const holding = holdingRows[0];
    if (!holding) throw new HttpError(404, "Holding not found");
    if (isArchived(holding.archivedAt)) throw new HttpError(400, "Target holding is archived");

    // Now the SIP itself, locked — and re-checked, because the probe above was
    // unlocked: a concurrent updateSip could have repointed the SIP at another
    // folio in between, which would otherwise book the buy against the holding
    // we just locked rather than the SIP's real current target.
    const sipRows = await tx
      .select()
      .from(sips)
      .where(and(eq(sips.id, sipId), eq(sips.userId, userId)))
      .for("update");
    const sip = sipRows[0];
    if (!sip) throw new HttpError(404, "SIP not found");
    if (sip.targetKind !== "mf_folio" || sip.targetHoldingId !== probe.targetHoldingId) {
      throw new HttpError(409, "The SIP's target folio just changed — refresh and retry");
    }
    // Defence in depth: createSip/updateSip already reject a payroll-funded
    // mf_folio SIP (see sipFundingSourceIssue), so this should be unreachable —
    // but a SIP row created before that constraint existed could still carry
    // this combination, and a payroll SIP's installment is booked automatically
    // from the payslip, never by hand. Read from the locked `sip` row, not the
    // unlocked `probe`, since a concurrent updateSip could have changed
    // `fundingSource` in between.
    if (sip.fundingSource === "payroll") {
      throw new HttpError(400, "A payroll-funded SIP is recorded from your payslip, not manually");
    }

    const dateError = installmentDateError(sip, parsed.date);
    if (dateError) throw new HttpError(400, dateError);

    const amountPaise = parsed.amountPaise ?? sip.amountPaise;
    const units = parsed.units ?? unitsForInstallment(amountPaise, parsed.nav!);

    const seq = await nextSeqForDate(tx, sip.targetHoldingId!, parsed.date);

    try {
      const rows = await tx
        .insert(holdingEvents)
        .values({
          holdingId: sip.targetHoldingId!,
          type: "buy",
          date: parsed.date,
          amountPaise,
          units,
          note: parsed.note,
          seq,
          // Not "import": mf-import.ts's reconcileEvents only ever re-sequences
          // *imported* events on a CAS re-import, so marking this event "manual"
          // keeps a recorded SIP installment safe from being resequenced or
          // dropped by a later statement import (see the test "an import never
          // rewrites a user's manual same-day order").
          source: "manual",
          sipId,
        })
        .returning();
      const e = rows[0]!;
      return { id: e.id, type: e.type, date: e.date, amountPaise: e.amountPaise, units: e.units, note: e.note };
    } catch (err) {
      if (isUniqueViolation(err, "holding_events_sip_date_idx")) {
        throw new HttpError(409, "This SIP installment is already recorded for that date");
      }
      // 23503 = FK violation: the SIP or its holding was deleted between our
      // locked read and the insert (a delete that was already in flight).
      if (pgError(err)?.code === "23503") {
        throw new HttpError(409, "The SIP or its folio was just removed — refresh and retry");
      }
      throw err;
    }
  });
}

// ---------- Linking a ledger transaction as an account-target installment ----------

/**
 * Records an account-target (PPF/SSY) installment by stamping `sip_id` onto a
 * ledger transaction the user already has — the mirror of
 * `recordSipInstallment`, which instead *creates* a `holding_events` buy for an
 * MF folio. Nothing about the transaction's money changes: the deposit was
 * already in the ledger and already in the account's balance, so this only
 * records *which* installment it satisfied. Returns the refreshed SIP so the
 * caller immediately sees `lastInstallmentDate`/`dueInstallmentDate` move.
 */
export async function linkSipInstallment(
  db: Db,
  userId: string,
  sipId: string,
  input: LinkSipInstallment,
): Promise<Sip> {
  const parsed = LinkSipInstallmentSchema.parse(input);

  return db.transaction(async (tx) => {
    // Lock order is the sips row first, the transaction row second — the same
    // direction `deleteSip` already travels: deleting a SIP locks it and then,
    // through `transactions.sip_id`'s ON DELETE SET NULL, updates (and so locks)
    // every transaction referencing it. Locking the transaction first would form
    // the opposite edge, and a delete racing an unlink of the same pair would
    // deadlock outright — the unlinker holding the transaction and waiting for
    // the SIP, the deleter holding the SIP and waiting for the transaction.
    // Nothing else in this file locks a transaction row at all, so this path only
    // has to respect parent-before-child; it never contends with the
    // account/holding-before-sips order createSip/updateSip/recordSipInstallment
    // use, because those never touch transactions.
    const sipRows = await tx
      .select()
      .from(sips)
      .where(and(eq(sips.id, sipId), eq(sips.userId, userId)))
      .for("update");
    const sip = sipRows[0];
    if (!sip) throw new HttpError(404, "SIP not found");

    const txRaw = await tx.execute(sql`
      select t.id, t.date, t.sip_id, t.deleted_at,
        p.account_id,
        p.amount_paise,
        exists (
          select 1 from postings p2
          join accounts a2 on a2.id = p2.account_id
          where p2.transaction_id = t.id and a2.system_kind = 'opening'
        )::boolean as is_opening
      from transactions t
      left join postings p on p.transaction_id = t.id
        and p.account_id = ${sip.targetAccountId}
      where t.id = ${parsed.transactionId} and t.user_id = ${userId}
      for update of t
    `);
    const rawRow = txRaw.rows[0] as
      | {
          id: string;
          date: string;
          sip_id: string | null;
          deleted_at: string | null;
          account_id: string | null;
          amount_paise: string | null;
          is_opening: boolean;
        }
      | undefined;
    // A soft-deleted row is 404, not 400: it is not part of the ledger the user
    // can see, so "not found" is the honest answer — and linking it would stamp
    // an installment that every installment query filters straight back out.
    if (!rawRow || rawRow.deleted_at !== null) throw new HttpError(404, "Transaction not found");
    const ledgerTx = {
      accountId: rawRow.account_id ?? "",
      amountPaise: Number(rawRow.amount_paise ?? 0),
      date: rawRow.date,
      isOpening: rawRow.is_opening as boolean,
      sipId: rawRow.sip_id as string | null,
    };

    const issue = linkInstallmentIssue(sip, ledgerTx);
    if (issue) throw new HttpError(issue.status, issue.message);

    // Idempotent: re-linking the transaction this SIP already points at reports
    // the same success rather than the (sip, date) unique index's 409, so a
    // double-click or a retried request isn't punished.
    if (ledgerTx.sipId === sip.id) {
      return toSip(sip, await lastInstallmentDateFor(tx, sipId));
    }

    try {
      const rows = await tx
        .update(transactions)
        .set({ sipId, updatedAt: new Date() })
        .where(
          and(
            eq(transactions.id, rawRow.id),
            eq(transactions.userId, userId),
            isNull(transactions.sipId),
          ),
        )
        .returning({ id: transactions.id });
      // Unreachable while this row's FOR UPDATE lock is held — kept because the
      // conditional WHERE makes "we only ever claim an unclaimed row" true
      // independently of the lock, the same way linkTargetToGoal does.
      if (rows.length === 0) {
        throw new HttpError(409, "That transaction was just linked elsewhere — refresh and retry");
      }
    } catch (err) {
      if (isUniqueViolation(err, "transactions_sip_date_idx")) {
        throw new HttpError(409, "This SIP installment is already recorded for that date");
      }
      // 23503 = FK violation: the SIP was deleted between our locked read and
      // the update (a delete that was already in flight).
      if (pgError(err)?.code === "23503") {
        throw new HttpError(409, "The SIP was just removed — refresh and retry");
      }
      throw err;
    }
    return toSip(sip, await lastInstallmentDateFor(tx, sipId));
  });
}

/**
 * Detaches a wrongly-linked installment: clears `sip_id` and leaves the ledger
 * transaction itself completely untouched. Without this a mislink could only be
 * undone by deleting a real transaction, because the (sip, date) unique index
 * blocks linking a different row for the same date.
 */
export async function unlinkSipInstallment(
  db: Db,
  userId: string,
  sipId: string,
  transactionId: string,
): Promise<Sip> {
  return db.transaction(async (tx) => {
    // Same sips-before-transaction order as linkSipInstallment, and for the
    // same reason — see there. `deletedAt` is deliberately not checked here — a
    // soft-deleted row already counts for nothing (see lastInstallmentDateFor),
    // so letting its stale link be cleared is pure cleanup.
    const sipRows = await tx
      .select()
      .from(sips)
      .where(and(eq(sips.id, sipId), eq(sips.userId, userId)))
      .for("update");
    const sip = sipRows[0];
    if (!sip) throw new HttpError(404, "SIP not found");

    const txRows = await tx
      .select({ id: transactions.id, sipId: transactions.sipId })
      .from(transactions)
      .where(and(eq(transactions.id, transactionId), eq(transactions.userId, userId)))
      .for("update");
    const ledgerTx = txRows[0];
    if (!ledgerTx) throw new HttpError(404, "Transaction not found");
    if (ledgerTx.sipId !== sipId) throw new HttpError(404, "That transaction isn't linked to this SIP");

    await tx
      .update(transactions)
      .set({ sipId: null, updatedAt: new Date() })
      .where(
        and(
          eq(transactions.id, ledgerTx.id),
          eq(transactions.userId, userId),
          eq(transactions.sipId, sipId),
        ),
      );
    return toSip(sip, await lastInstallmentDateFor(tx, sipId));
  });
}

/**
 * The most recent ledger rows this SIP has already claimed as installments.
 *
 * Deliberately exempt from the *eligibility* rules `unlinkedInstallmentRows`
 * applies — account, sign, opening-row and date window are all ignored here. A
 * row that is already linked must stay visible even if a later edit moved it to
 * another account, flipped its sign, or pushed it outside the SIP's date window:
 * `updateTransaction` leaves `sip_id` in place through all of those (it only
 * rejects the one edit that would collide on the (sip, date) index). Filtering
 * these the same way as free rows would hide exactly the rows a user has reason
 * to detach, leaving no recovery path at all.
 *
 * Still bounded by `INSTALLMENT_CANDIDATE_LIMIT`, though — this is a picker, not
 * an installment history. Ordering is most-recent-first, so what a long-running
 * SIP eventually drops off the end is its oldest installments, while a mislink
 * needing attention is by nature recent. Soft-deleted rows are excluded outright:
 * they already count for nothing (see `lastInstallmentDateFor`), so there is
 * nothing to detach.
 */
async function linkedInstallmentRows(
  db: Db,
  userId: string,
  sipId: string,
): Promise<Array<{ id: string; date: string; amountPaise: number; merchant: string; notes: string }>> {
  const result = await db.execute(sql`
    select t.id, t.date, t.merchant, t.notes, rp.amount_paise
    from transactions t
    join lateral (
      select p.amount_paise
      from postings p
      join accounts a on a.id = p.account_id
      where p.transaction_id = t.id and a.system_kind is null
      order by (p.amount_paise > 0) desc, p.id
      limit 1
    ) rp on true
    where t.user_id = ${userId} and t.sip_id = ${sipId} and t.deleted_at is null
    order by t.date desc, t.created_at desc
    limit ${INSTALLMENT_CANDIDATE_LIMIT}
  `);
  return (result.rows as Array<{ id: string; date: string; merchant: string; notes: string; amount_paise: string }>).map((r) => {
    const amountPaise = Number(r.amount_paise);
    if (!Number.isSafeInteger(amountPaise)) {
      throw new HttpError(500, "SIP installment amount exceeded a safe integer — refusing to lose paise");
    }
    return { id: r.id, date: r.date, merchant: r.merchant, notes: r.notes, amountPaise };
  });
}

/**
 * The free ledger rows that could become this SIP's next installment: credits
 * into its target account, inside the SIP's own date window, not yet claimed by
 * any SIP. These are the rows `linkInstallmentIssue` will accept, so the filters
 * here and its rules must stay in step — anything offered that it would reject
 * is an input guaranteed to 400.
 */
async function unlinkedInstallmentRows(
  db: Db,
  userId: string,
  accountId: string,
  bounds: { from: string; to: string },
): Promise<Array<{ id: string; date: string; amountPaise: number; merchant: string; notes: string }>> {
  return db
    .select({
      id: transactions.id,
      date: transactions.date,
      amountPaise: postings.amountPaise,
      merchant: transactions.merchant,
      notes: transactions.notes,
    })
    .from(transactions)
    .innerJoin(
      postings,
      and(
        eq(postings.transactionId, transactions.id),
        eq(postings.accountId, accountId),
        gt(postings.amountPaise, 0),
      ),
    )
    .where(
      and(
        eq(transactions.userId, userId),
        isNull(transactions.deletedAt),
        isNull(transactions.sipId),
        sql`not exists (
          select 1 from postings p2
          join accounts a2 on a2.id = p2.account_id
          where p2.transaction_id = ${transactions.id} and a2.system_kind = 'opening'
        )`,
        gte(transactions.date, bounds.from),
        lte(transactions.date, bounds.to),
      ),
    )
    .orderBy(desc(transactions.date), desc(transactions.createdAt))
    .limit(INSTALLMENT_CANDIDATE_LIMIT);
}

/**
 * The ledger transactions that could be this SIP's installment as of `asOf`:
 * unlinked credits into its target account plus the most recent of the ones
 * this SIP already linked — the linked rows are exempt from the `asOf` window
 * and the eligibility filters, because their only purpose in the response is to
 * be detachable (see `linkedInstallmentRows`). Response contract: linked rows
 * first, then unlinked, each most-recent-first. Kept server-side rather than
 * left to a client filter over `/api/transactions` because `sip_id` is not
 * part of the transaction API at all — the browser has no way to tell an
 * already-linked deposit from a free one.
 */
export async function listSipInstallmentCandidates(
  db: Db,
  userId: string,
  sipId: string,
  asOf: string,
): Promise<SipInstallmentCandidate[]> {
  const sip = await ownedSip(db, userId, sipId);
  const issue = accountInstallmentSipIssue(sip);
  if (issue) throw new HttpError(issue.status, issue.message);

  // Two budgeted queries rather than one ORed query under a single LIMIT: a run
  // of recent unlinked credits would otherwise crowd this SIP's own older linked
  // installment off the end, and an installment that can't be listed can't be
  // unlinked — so the row that a mislink must be detached from would be exactly
  // the one to disappear. Each group gets its own budget instead. Only the
  // unlinked side is bounded by `asOf`/the eligibility filters — the linked side
  // is exempt from those but still shares the same per-group recency budget (see
  // its doc comment). `linked` comes from which query produced the row, so the
  // raw `sip_id` never has to be selected, let alone returned.
  const [linked, unlinked] = await Promise.all([
    linkedInstallmentRows(db, userId, sipId),
    unlinkedInstallmentRows(db, userId, sip.targetAccountId!, candidateDateBounds(sip, asOf)),
  ]);
  return [
    ...linked.map((row) => ({ ...row, linked: true })),
    ...unlinked.map((row) => ({ ...row, linked: false })),
  ];
}
