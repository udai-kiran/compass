import { and, eq, sql } from "drizzle-orm";
import type { DbOrTx } from "../../../db/index.ts";
import { attachments, transactionLinks, transactions, userTasks } from "../schema.ts";
import { extractedTransactions, importRows } from "../../ingest/schema.ts";
import { HttpError } from "../../../lib/errors.ts";

// ---------------------------------------------------------------------------
// Collapsing two transaction headers into one — the shared primitive
// ---------------------------------------------------------------------------
//
// A transfer is ONE header with two real postings (PR-G1). `linkTransfer` and
// `autoLinkTransfers` therefore have to merge two existing headers into one and
// delete the loser, at runtime, every time a user links a transfer.
//
// That merge is where references go missing. Deleting a header CASCADES its
// attachments and transaction links, NULLS its user tasks and
// extracted-transaction links, and orphans `import_rows.transaction_id` /
// `reconciled_from`, which carry no FK at all and so are repaired by nothing.
// Every one of those has to be re-pointed at the survivor first.
//
// The rule is fail-closed: a reference the survivor already holds a DIFFERENT
// value for is a genuine conflict between two domain identities, and merging
// them would silently discard one. That is a 409, not a coin flip.

/**
 * Which of a transfer's two legs survives the collapse: the OUTFLOW leg.
 *
 * It is the leg `primaryRealLeg` projects, so the merged transaction keeps the
 * id, date and header that a global list was already showing for it. The
 * inflow header is the one deleted.
 */
export function survivorOf(
  outTransactionId: string,
  inTransactionId: string,
): { survivorId: string; absorbedId: string } {
  return { survivorId: outTransactionId, absorbedId: inTransactionId };
}

/**
 * Merges the absorbed header's free-text metadata into the survivor's.
 *
 * The survivor keeps its own date, occurred_at, source and created_at. Tags
 * become the union. A merchant or note the user typed on the absorbed leg is
 * APPENDED to the survivor's notes rather than dropped — the merge is lossy
 * enough already, and silently discarding typed text is the kind of loss people
 * notice much later, when they go looking for it.
 *
 * Pure, so the text-carrying rules are testable without a database.
 */
export function mergeHeaderText(
  survivor: { merchant: string; notes: string; tags: string[] },
  absorbed: { merchant: string; notes: string; tags: string[] },
): { notes: string; tags: string[] } {
  const carried: string[] = [];
  if (absorbed.merchant && absorbed.merchant !== survivor.merchant) carried.push(absorbed.merchant);
  if (absorbed.notes && absorbed.notes !== survivor.notes) carried.push(absorbed.notes);
  const notes = [survivor.notes, ...carried].filter(Boolean).join("\n");
  const tags = [...new Set([...survivor.tags, ...absorbed.tags])];
  return { notes, tags };
}

type IdentityRow = Pick<
  typeof transactions.$inferSelect,
  "sipId" | "reconciledStatementId" | "policyId" | "resourceId" | "recurringTemplateId"
>;

/** Single-valued domain identities, with the wording used when both legs hold one. */
const IDENTITIES: Array<{ key: keyof IdentityRow; label: string }> = [
  { key: "sipId", label: "a SIP installment" },
  { key: "reconciledStatementId", label: "a reconciled statement" },
  { key: "policyId", label: "an insurance policy" },
  { key: "resourceId", label: "a vehicle or utility connection" },
  { key: "recurringTemplateId", label: "a recurring bill" },
];

/**
 * Moves every reference held by `absorbedId` onto `survivorId`, refusing when
 * the two legs disagree about a single-valued identity.
 *
 * Runs BEFORE the absorbed header is deleted, on the caller's handle and inside
 * the caller's transaction — a partial remap is worse than none.
 */
export async function remapReferences(
  db: DbOrTx,
  userId: string,
  survivorId: string,
  absorbedId: string,
): Promise<void> {
  const owned = and(eq(transactions.userId, userId));
  const [survivor] = await db
    .select({
      sipId: transactions.sipId,
      reconciledStatementId: transactions.reconciledStatementId,
      policyId: transactions.policyId,
      resourceId: transactions.resourceId,
      recurringTemplateId: transactions.recurringTemplateId,
    })
    .from(transactions)
    .where(and(eq(transactions.id, survivorId), owned));
  const [absorbed] = await db
    .select({
      sipId: transactions.sipId,
      reconciledStatementId: transactions.reconciledStatementId,
      policyId: transactions.policyId,
      resourceId: transactions.resourceId,
      recurringTemplateId: transactions.recurringTemplateId,
    })
    .from(transactions)
    .where(and(eq(transactions.id, absorbedId), owned));
  if (!survivor || !absorbed) throw new HttpError(404, "Transaction not found");

  // 1. Single-valued identities: adopt the absorbed leg's value when the
  //    survivor has none; refuse when both hold different ones.
  const adopt: Partial<IdentityRow> = {};
  for (const { key, label } of IDENTITIES) {
    const mine = survivor[key];
    const theirs = absorbed[key];
    if (theirs === null || mine === theirs) continue;
    if (mine !== null) {
      throw new HttpError(
        409,
        `Both transfer legs are linked to ${label} — unlink one before linking them as a transfer`,
      );
    }
    adopt[key] = theirs as never;
  }
  if (Object.keys(adopt).length > 0) {
    // Clearing the absorbed row's identities FIRST keeps the (sip_id, date)
    // partial unique index satisfied at every point: the two legs can share a
    // date, and moving a sip_id onto the survivor while the absorbed row still
    // holds it would collide with itself.
    await db
      .update(transactions)
      .set({ sipId: null, reconciledStatementId: null, policyId: null, resourceId: null, recurringTemplateId: null })
      .where(and(eq(transactions.id, absorbedId), owned));
    await db.update(transactions).set(adopt).where(and(eq(transactions.id, survivorId), owned));
  }

  // 2. Child rows holding an FK to the header. Attachments and transaction
  //    links (the transaction's saved URLs) would CASCADE away with the
  //    absorbed row; user tasks and extracted-transaction links would be nulled.
  await db
    .update(attachments)
    .set({ transactionId: survivorId })
    .where(eq(attachments.transactionId, absorbedId));
  await db
    .update(transactionLinks)
    .set({ transactionId: survivorId })
    .where(eq(transactionLinks.transactionId, absorbedId));
  await db
    .update(userTasks)
    .set({ transactionId: survivorId })
    .where(eq(userTasks.transactionId, absorbedId));
  await db
    .update(extractedTransactions)
    .set({ transactionId: survivorId })
    .where(eq(extractedTransactions.transactionId, absorbedId));
  await db
    .update(extractedTransactions)
    .set({ matchedTransactionId: survivorId })
    .where(eq(extractedTransactions.matchedTransactionId, absorbedId));

  // 3. `import_rows` has NO foreign key to transactions, so nothing repairs
  //    these: a dangling id here is what makes a later rollback hard-delete the
  //    wrong row. `reconciled_from` is a jsonb snapshot that embeds the id too.
  //    See `rollbackImport`'s cross-batch guard — the other half of this hazard.
  await db
    .update(importRows)
    .set({ transactionId: survivorId })
    .where(eq(importRows.transactionId, absorbedId));
  await db
    .update(importRows)
    .set({
      reconciledFrom: sql`jsonb_set(${importRows.reconciledFrom}, '{transactionId}', to_jsonb(${survivorId}::text))`,
    })
    .where(sql`${importRows.reconciledFrom} ->> 'transactionId' = ${absorbedId}`);
}
