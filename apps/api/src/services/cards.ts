import { and, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import type { Redis } from "ioredis";
import type {
  CardActivity,
  CardActivityTxn,
  CardDetails,
  CardHolderSummary,
  CardIssuerSettings,
  CardSummary,
  CreateRewardEntry,
  RewardEntry,
  StatementReconciliation,
  UpsertCardDetails,
  UpsertCardIssuerSettings,
} from "@compass/shared";
import { formatINR, UpsertCardDetailsSchema, UpsertCardIssuerSettingsSchema } from "@compass/shared";
import type { Db, DbOrTx } from "../db/index.ts";
import {
  accounts,
  alertLedger,
  cardDetails,
  cardIssuerSettings,
  extractedTransactions,
  rewardEntries,
  statementReconciliations,
  transactions,
} from "../db/schema.ts";
import { HttpError } from "../lib/errors.ts";
import { decryptSecret, encryptSecret } from "../lib/secret-box.ts";
import { withSerializableRetry } from "../lib/serializable.ts";
import { createNotification } from "./notifications.ts";
import { repairSnapshots } from "./networth.ts";
import { currentPeriodKey } from "./periods.ts";

type DetailsRow = typeof cardDetails.$inferSelect;
type IssuerRow = typeof cardIssuerSettings.$inferSelect;

function toDetails(d: DetailsRow): CardDetails {
  return {
    accountId: d.accountId,
    network: d.network,
    productName: d.productName,
    cycleDay: d.cycleDay,
    dueDay: d.dueDay,
    earnRatePer100: d.earnRatePer100,
    // Expose only that a password exists — never the value itself.
    hasStatementPassword: d.statementPasswordEnc !== "",
  };
}

function toIssuerSettings(s: IssuerRow): CardIssuerSettings {
  return {
    institution: s.institution,
    creditLimitPaise: s.creditLimitPaise,
    utilizationAlertPct: s.utilizationAlertPct,
    remindDays: s.remindDays,
    billMobile: s.billMobile,
  };
}

/** The trimmed institution that groups a card into an issuer holder, or null. */
function issuerKey(institution: string | null): string | null {
  return institution?.trim() || null;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Latest date with the given day-of-month (1–28) on or before `ref`. */
export function lastOccurrence(ref: string, day: number): string {
  const [y, m, d] = ref.split("-").map(Number) as [number, number, number];
  if (d >= day) return `${y}-${pad(m)}-${pad(day)}`;
  const pm = m === 1 ? 12 : m - 1;
  const py = m === 1 ? y - 1 : y;
  return `${py}-${pad(pm)}-${pad(day)}`;
}

/** First date with the given day-of-month (1–28) strictly after `ref`. */
export function nextOccurrence(ref: string, day: number): string {
  const [y, m, d] = ref.split("-").map(Number) as [number, number, number];
  if (d < day) return `${y}-${pad(m)}-${pad(day)}`;
  const nm = m === 12 ? 1 : m + 1;
  const ny = m === 12 ? y + 1 : y;
  return `${ny}-${pad(nm)}-${pad(day)}`;
}

function dayBefore(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Days after a cycle closes before the issuer actually generates that bill. */
const STATEMENT_GEN_LAG_DAYS = 4;

/**
 * Close date of the last *generated* statement as of `ref`. A cycle that closed
 * only a day or two ago hasn't been billed yet — until it is, the last statement
 * is still the prior cycle's, and the just-closed period's spends stay "recent".
 */
function lastStatementClose(ref: string, cycleDay: number): string {
  const close = lastOccurrence(ref, cycleDay);
  const daysSince = (Date.parse(`${ref}T00:00:00Z`) - Date.parse(`${close}T00:00:00Z`)) / 86_400_000;
  return daysSince >= STATEMENT_GEN_LAG_DAYS ? close : lastOccurrence(dayBefore(close), cycleDay);
}

/** The statement cycle in force as of a reference date. */
export interface CardCycle {
  /** first day this statement bills — the previous cycle's close day */
  start: string;
  /** last day this statement bills (the day before `close`) */
  end: string;
  /** this statement's close/generation date, and the first day of the next cycle */
  close: string;
}

/**
 * The cycle a card closing on `cycleDay` is billing as of `ref`.
 *
 * A cycle runs `[start, close)` — the close day itself opens the *next* cycle.
 * That is what issuers actually bill: an HDFC statement dated 20 Jul lists spends
 * from 20 Jun through 19 Jul, so a charge dated on the close day lands on the
 * following statement, never the one closing that day. Treating the window as
 * `(start, close]` instead silently drops every charge dated on the start day.
 *
 * Consecutive cycles therefore partition the calendar exactly: each date is
 * billed by exactly one statement, with no gap and no double-count.
 */
export function cardCycle(ref: string, cycleDay: number): CardCycle {
  const close = lastStatementClose(ref, cycleDay);
  return { start: lastOccurrence(dayBefore(close), cycleDay), end: dayBefore(close), close };
}

/** Whether a transaction date is billed by this cycle — `[start, close)`. */
export function isBilledIn(date: string, cycle: CardCycle): boolean {
  return date >= cycle.start && date < cycle.close;
}

/** The date window a card's activity view covers, as half-open bounds. */
export interface ActivityWindow {
  /** first date to list — inclusive, so a charge dated on it is not dropped */
  fromInclusive: string;
  /** exclusive upper bound of "already billed": the close day bills next cycle */
  billedBefore: string;
}

/**
 * The bounds both card views query with. Kept in one place because the two
 * halves have to agree: `fromInclusive` is the cycle's first billed day, so the
 * SQL that loads rows must be inclusive of it (`>=`, never `>`) or the billed
 * split silently loses every charge dated on the start day.
 *
 * With no cycle configured there is no statement window: list the last ~45 days
 * and treat everything up to and including today as billed, hence `ref + 1`.
 */
export function activityWindow(cycle: CardCycle | null, ref: string): ActivityWindow {
  return {
    fromInclusive: cycle?.start ?? shiftDays(ref, -45),
    billedBefore: cycle ? cycle.close : shiftDays(ref, 1),
  };
}

/**
 * Partition rows into the statement that bills them and what is still unbilled.
 * Every row lands in exactly one bucket: `[start, close)` bills, `close` onward
 * does not. With no cycle nothing is billed yet, so it is all unbilled.
 */
export function splitByCycle<T extends { date: string }>(
  rows: T[],
  cycle: CardCycle | null,
): { billed: T[]; unbilled: T[] } {
  const billed: T[] = [];
  const unbilled: T[] = [];
  for (const row of rows) {
    if (cycle && isBilledIn(row.date, cycle)) billed.push(row);
    else unbilled.push(row);
  }
  return { billed, unbilled };
}

async function ownedCardAccount(db: Db, userId: string, accountId: string) {
  const acc = await db.query.accounts.findFirst({
    where: and(eq(accounts.id, accountId), eq(accounts.userId, userId)),
  });
  if (!acc) throw new HttpError(404, "Account not found");
  if (acc.type !== "credit_card") throw new HttpError(400, "Not a credit card account");
  return acc;
}

export async function upsertCardDetails(
  db: Db,
  userId: string,
  accountId: string,
  input: UpsertCardDetails,
): Promise<CardDetails> {
  await ownedCardAccount(db, userId, accountId);
  const parsed = UpsertCardDetailsSchema.parse(input);
  // Bank/issuer lives on the account (institution), not card_details — keep it
  // out of the card_details row and write it through to the account. Both writes
  // run in one transaction so a failed account update can't leave the card_details
  // change committed on its own.
  const { bankName, ...cardCols } = parsed;
  const row = await db.transaction(async (tx) => {
    const rows = await tx
      .insert(cardDetails)
      .values({ ...cardCols, accountId, userId })
      .onConflictDoUpdate({
        target: cardDetails.accountId,
        set: { ...cardCols, updatedAt: new Date() },
      })
      .returning();
    // Omitted bankName means "leave the issuer as-is"; "" clears it, a name sets it.
    if (bankName !== undefined) {
      await tx
        .update(accounts)
        .set({ institution: bankName.trim() || null })
        .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId)));
    }
    return rows[0]!;
  });
  return toDetails(row);
}

/** The issuer settings for one of the user's banks, or null when none are saved. */
export async function getIssuerSettings(
  db: Db,
  userId: string,
  institution: string,
): Promise<CardIssuerSettings | null> {
  const row = await db.query.cardIssuerSettings.findFirst({
    where: and(
      eq(cardIssuerSettings.userId, userId),
      eq(cardIssuerSettings.institution, institution),
    ),
  });
  return row ? toIssuerSettings(row) : null;
}

/**
 * Create or update the settings shared across a bank's cards (combined limit,
 * utilization alert, reminder lead time, registered mobile). Guards that the
 * user actually has a card at that institution, so settings can't dangle. (The
 * statement password is per-card — see setCardStatementPassword.)
 */
export async function upsertIssuerSettings(
  db: Db,
  userId: string,
  input: UpsertCardIssuerSettings,
): Promise<CardIssuerSettings> {
  const parsed = UpsertCardIssuerSettingsSchema.parse(input);
  const { institution, ...cols } = parsed;
  const owns = await db.query.accounts.findFirst({
    where: and(
      eq(accounts.userId, userId),
      eq(accounts.type, "credit_card"),
      eq(accounts.institution, institution),
    ),
    columns: { id: true },
  });
  if (!owns) throw new HttpError(404, "No card found for that bank");
  const rows = await db
    .insert(cardIssuerSettings)
    .values({ ...cols, userId, institution })
    .onConflictDoUpdate({
      target: [cardIssuerSettings.userId, cardIssuerSettings.institution],
      set: { ...cols, updatedAt: new Date() },
    })
    .returning();
  return toIssuerSettings(rows[0]!);
}

/**
 * Set (or, with "", clear) a card's statement-PDF password, without touching the
 * rest of its details. Per-card: issuers like HDFC embed the card's own last-4
 * in the password, so each card of a bank needs its own.
 */
export async function setCardStatementPassword(
  db: Db,
  userId: string,
  accountId: string,
  password: string,
  secret: string,
): Promise<{ hasStatementPassword: boolean }> {
  await ownedCardAccount(db, userId, accountId);
  const enc = password ? encryptSecret(password, secret) : "";
  await db
    .insert(cardDetails)
    .values({ userId, accountId, statementPasswordEnc: enc })
    .onConflictDoUpdate({
      target: cardDetails.accountId,
      set: { statementPasswordEnc: enc, updatedAt: new Date() },
    });
  return { hasStatementPassword: enc !== "" };
}

/**
 * The decrypted statement-PDF password for a card, or null when none is stored.
 * Used by the statement importer to open the encrypted PDF. Per-card.
 */
export async function getCardStatementPassword(
  db: Db,
  userId: string,
  accountId: string,
  secret: string,
): Promise<string | null> {
  await ownedCardAccount(db, userId, accountId);
  const row = await db.query.cardDetails.findFirst({
    where: and(eq(cardDetails.accountId, accountId), eq(cardDetails.userId, userId)),
    columns: { statementPasswordEnc: true },
  });
  if (!row || row.statementPasswordEnc === "") return null;
  return decryptSecret(row.statementPasswordEnc, secret);
}

/** Combined utilization %, rounded to 0.1, or null when there's no limit. */
function utilization(owedPaise: number, limitPaise: number): number | null {
  return limitPaise > 0 ? Math.round((owedPaise / limitPaise) * 1000) / 10 : null;
}

/**
 * Every credit card grouped under its bank/issuer holder. Cards sharing an
 * institution roll up into one holder whose limit and utilization are combined
 * (India's typical shared limit); cards with no institution each become their
 * own "unassigned" holder with no shared settings.
 */
export async function listCardHolders(
  db: Db,
  userId: string,
  today?: string,
): Promise<CardHolderSummary[]> {
  const ref = today ?? new Date().toISOString().slice(0, 10);
  const cards = await db.query.accounts.findMany({
    where: and(eq(accounts.userId, userId), eq(accounts.type, "credit_card")),
    orderBy: (a, { asc }) => [asc(a.sortOrder), asc(a.createdAt)],
  });
  if (cards.length === 0) return [];
  const details = await db.query.cardDetails.findMany({ where: eq(cardDetails.userId, userId) });
  const detailsByAccount = new Map(details.map((d) => [d.accountId, d]));
  const issuers = await db.query.cardIssuerSettings.findMany({
    where: eq(cardIssuerSettings.userId, userId),
  });
  const issuerByInstitution = new Map(issuers.map((s) => [s.institution, s]));

  // Build each card's summary + its current owed, then group by institution.
  type Built = { institution: string | null; owed: number; card: CardSummary };
  const built: Built[] = [];
  for (const acc of cards) {
    if (acc.archivedAt) continue;
    const d = detailsByAccount.get(acc.id);
    const cycle = d ? cardCycle(ref, d.cycleDay) : null;
    const { billedBefore } = activityWindow(cycle, ref);

    const sums = await db.execute(sql`
      select
        coalesce(sum(amount_paise), 0)::bigint as total,
        coalesce(sum(amount_paise) filter (where date < ${billedBefore}), 0)::bigint as at_close,
        coalesce(sum(amount_paise) filter (where amount_paise < 0 and date >= ${billedBefore}), 0)::bigint as current_spend
      from transactions
      where account_id = ${acc.id} and user_id = ${userId} and deleted_at is null and date <= ${ref}
    `);
    const row = sums.rows[0] as { total: string; at_close: string; current_spend: string };
    const balance = acc.openingBalancePaise + Number(row.total);

    const rewards = await db
      .select({ points: sql<number>`coalesce(sum(points), 0)::int` })
      .from(rewardEntries)
      .where(eq(rewardEntries.accountId, acc.id));

    const owedAtClose = -(acc.openingBalancePaise + Number(row.at_close));
    built.push({
      institution: issuerKey(acc.institution),
      owed: Math.max(0, -balance),
      card: {
        accountId: acc.id,
        name: acc.name,
        bankName: acc.institution,
        last4: acc.accountLast4,
        details: d ? toDetails(d) : null,
        balancePaise: balance,
        statementStart: cycle?.start ?? null,
        statementEnd: cycle?.end ?? null,
        amountDuePaise: Math.max(0, owedAtClose),
        dueDate: d && cycle ? nextOccurrence(cycle.close, d.dueDay) : null,
        currentSpendPaise: -Number(row.current_spend),
        rewardPoints: rewards[0]!.points,
      },
    });
  }

  // Group in first-seen order: same institution → one holder; null → singleton.
  const order: string[] = [];
  const groups = new Map<string, { institution: string | null; items: Built[] }>();
  for (const b of built) {
    const key = b.institution ? `inst:${b.institution}` : `acc:${b.card.accountId}`;
    let g = groups.get(key);
    if (!g) {
      g = { institution: b.institution, items: [] };
      groups.set(key, g);
      order.push(key);
    }
    g.items.push(b);
  }

  return order.map((key) => {
    const g = groups.get(key)!;
    const settings = g.institution ? (issuerByInstitution.get(g.institution) ?? null) : null;
    const creditLimitPaise = settings?.creditLimitPaise ?? 0;
    const utilizationAlertPct = settings?.utilizationAlertPct ?? null;
    const totalOwedPaise = g.items.reduce((sum, b) => sum + b.owed, 0);
    return {
      institution: g.institution,
      bankName: g.institution ?? g.items[0]!.card.name,
      settings: settings ? toIssuerSettings(settings) : null,
      creditLimitPaise,
      totalOwedPaise,
      utilizationPct: utilization(totalOwedPaise, creditLimitPaise),
      utilizationAlertPct,
      cards: g.items.map((b) => b.card),
    };
  });
}

/** Days-shifted ISO date (e.g. 45 days before `iso`). */
function shiftDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * A card's CRED-style activity: the last closed statement's amount due with its
 * line items, and the spends since the close that haven't been billed yet. When
 * the card has no cycle configured there's no statement window — the last ~45
 * days show as recent spends and the whole owed balance as "due".
 */
export async function getCardActivity(
  db: Db,
  userId: string,
  accountId: string,
  today?: string,
): Promise<CardActivity> {
  const acc = await ownedCardAccount(db, userId, accountId);
  const ref = today ?? new Date().toISOString().slice(0, 10);
  const d = await db.query.cardDetails.findFirst({
    where: and(eq(cardDetails.accountId, accountId), eq(cardDetails.userId, userId)),
  });

  const cycle = d ? cardCycle(ref, d.cycleDay) : null;
  const dueDate = d && cycle ? nextOccurrence(cycle.close, d.dueDay) : null;
  const { fromInclusive, billedBefore } = activityWindow(cycle, ref);

  // Headline balances: owed now, and owed as of the last statement close.
  const sums = await db.execute(sql`
    select
      coalesce(sum(amount_paise), 0)::bigint as total,
      coalesce(sum(amount_paise) filter (where date < ${billedBefore}), 0)::bigint as at_close
    from transactions
    where account_id = ${accountId} and user_id = ${userId} and deleted_at is null and date <= ${ref}
  `);
  const agg = sums.rows[0] as { total: string; at_close: string };
  const balancePaise = acc.openingBalancePaise + Number(agg.total);
  const owedAtClose = -(acc.openingBalancePaise + Number(agg.at_close));
  const totalDuePaise = Math.max(0, cycle ? owedAtClose : -balancePaise);

  const rows = await db.query.transactions.findMany({
    where: and(
      eq(transactions.accountId, accountId),
      eq(transactions.userId, userId),
      isNull(transactions.deletedAt),
      gte(transactions.date, fromInclusive),
      lte(transactions.date, ref),
    ),
    orderBy: [desc(transactions.date), desc(transactions.id)],
    columns: {
      id: true,
      date: true,
      merchant: true,
      amountPaise: true,
      categoryId: true,
      reconciledStatementId: true,
    },
  });
  const toTxn = (t: (typeof rows)[number]): CardActivityTxn => ({
    id: t.id,
    date: t.date,
    merchant: t.merchant,
    amountPaise: t.amountPaise,
    categoryId: t.categoryId,
    reconciledStatementId: t.reconciledStatementId,
  });
  const split = splitByCycle(rows, cycle);
  const billed = split.billed.map(toTxn);
  const unbilled = split.unbilled.map(toTxn);
  const unbilledSpendPaise = unbilled.reduce(
    (s, t) => s + (t.amountPaise < 0 ? -t.amountPaise : 0),
    0,
  );

  return {
    accountId: acc.id,
    name: acc.name,
    bankName: acc.institution,
    last4: acc.accountLast4,
    statementStart: cycle?.start ?? null,
    statementEnd: cycle?.end ?? null,
    dueDate,
    totalDuePaise,
    unbilledSpendPaise,
    balancePaise,
    billed,
    unbilled,
  };
}

/** Daily job: due-date reminders for every configured card, once per due date. */
export async function evaluateCardDueReminders(db: Db): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);
  const users = await db.selectDistinct({ userId: cardDetails.userId }).from(cardDetails);
  let sent = 0;
  for (const { userId } of users) {
    const holders = await listCardHolders(db, userId, today);
    for (const holder of holders) {
      // Reminder lead time is an issuer-level setting; due dates stay per card.
      const remindDays = holder.settings?.remindDays ?? 3;
      for (const card of holder.cards) {
        if (card.dueDate === null || card.amountDuePaise <= 0) continue;
        const remindFrom = new Date(`${card.dueDate}T00:00:00Z`);
        remindFrom.setUTCDate(remindFrom.getUTCDate() - remindDays);
        if (today < remindFrom.toISOString().slice(0, 10) || today > card.dueDate) continue;
        const inserted = await db
          .insert(alertLedger)
          .values({ userId, kind: "card-due", refKey: `${card.accountId}:${card.dueDate}` })
          .onConflictDoNothing()
          .returning({ id: alertLedger.id });
        if (inserted.length === 0) continue;
        await createNotification(db, userId, {
          type: "bill",
          title: `${card.name} payment due ${card.dueDate === today ? "today" : `on ${card.dueDate}`}`,
          body: `${formatINR(card.amountDuePaise)} due for the statement ending ${card.statementEnd ?? ""}.`,
          data: { accountId: card.accountId, dueDate: card.dueDate },
        });
        sent += 1;
      }
    }
  }
  return sent;
}

/** Alerts-queue detector: combined utilization crossing a bank's threshold, once per period. */
export async function evaluateCardUtilization(db: Db, userId: string): Promise<number> {
  const holders = await listCardHolders(db, userId);
  const period = currentPeriodKey("monthly");
  let fired = 0;
  for (const h of holders) {
    if (h.institution === null || h.utilizationAlertPct === null || h.utilizationPct === null) continue;
    if (h.utilizationPct < h.utilizationAlertPct) continue;
    const inserted = await db
      .insert(alertLedger)
      .values({ userId, kind: "card-utilization", refKey: `${h.institution}:${period}` })
      .onConflictDoNothing()
      .returning({ id: alertLedger.id });
    if (inserted.length === 0) continue;
    await createNotification(db, userId, {
      type: "budget",
      title: `${h.bankName} cards at ${h.utilizationPct}% utilization`,
      body: `${formatINR(h.totalOwedPaise)} of ${formatINR(h.creditLimitPaise)} combined limit.`,
      data: { institution: h.institution },
    });
    fired += 1;
  }
  return fired;
}

// ---------- rewards ----------

export async function listRewards(db: Db, userId: string, accountId: string): Promise<RewardEntry[]> {
  await ownedCardAccount(db, userId, accountId);
  const rows = await db.query.rewardEntries.findMany({
    where: and(eq(rewardEntries.userId, userId), eq(rewardEntries.accountId, accountId)),
    orderBy: [desc(rewardEntries.date), desc(rewardEntries.createdAt)],
    limit: 100,
  });
  return rows.map((r) => ({ id: r.id, accountId: r.accountId, date: r.date, points: r.points, note: r.note }));
}

type ReconciliationRow = typeof statementReconciliations.$inferSelect;

/**
 * Drift between the issuer's stated `totalDuePaise` and what the ledger itself
 * says was due at the statement close: `totalDue − ledgerDue`. Positive means
 * the ledger is short (a carried-forward balance, or spend never captured
 * this cycle); negative means the ledger shows more owed than the statement
 * (a payment/refund not reflected in this cycle's lines). `null` unless both
 * inputs are known — a card with no statement date, or a statement that never
 * stated a total, has nothing to compare.
 */
export function dueDrift(totalDuePaise: number | null, ledgerDuePaise: number | null): number | null {
  if (totalDuePaise === null || ledgerDuePaise === null) return null;
  return totalDuePaise - ledgerDuePaise;
}

export interface DriftPresentation {
  kind: "none" | "shortfall" | "surplus" | "credit";
  /** only ever true for `shortfall` — a credit balance is never "carried forward" */
  carryForwardHint: boolean;
  /** true only for `shortfall`; a credit or surplus keeps the "all lines matched" badge */
  suppressCleared: boolean;
}

/**
 * Classifies a due-drift for display. `ledgerDuePaise < 0` (the ledger holds a
 * credit balance on this card) is checked BEFORE the drift sign: a credit
 * balance against a small/zero statement due still subtracts to a *positive*
 * `dueDrift`, but that is not a shortfall — the ledger has money in hand, not
 * a gap — so it is classified `credit` first and never folds into
 * `shortfall`'s "more due than the ledger shows" copy or carry-forward hint.
 */
export function driftPresentation(
  dueDriftPaise: number | null,
  ledgerDuePaise: number | null,
): DriftPresentation {
  if (dueDriftPaise === null || ledgerDuePaise === null) {
    return { kind: "none", carryForwardHint: false, suppressCleared: false };
  }
  if (ledgerDuePaise < 0) {
    return { kind: "credit", carryForwardHint: false, suppressCleared: false };
  }
  if (dueDriftPaise > 0) {
    return { kind: "shortfall", carryForwardHint: true, suppressCleared: true };
  }
  if (dueDriftPaise < 0) {
    return { kind: "surplus", carryForwardHint: false, suppressCleared: false };
  }
  return { kind: "none", carryForwardHint: false, suppressCleared: false };
}

function toReconciliationDto(r: ReconciliationRow, ledgerDuePaise: number | null): StatementReconciliation {
  const dueDriftPaise = dueDrift(r.totalDuePaise, ledgerDuePaise);
  if (dueDriftPaise !== null && !Number.isSafeInteger(dueDriftPaise)) {
    throw new HttpError(500, "Due drift aggregate exceeded a safe integer — refusing to lose paise");
  }
  return {
    id: r.id,
    accountId: r.accountId,
    period: r.period,
    statementDate: r.statementDate,
    totalDuePaise: r.totalDuePaise,
    minDuePaise: r.minDuePaise,
    rewardClosing: r.rewardClosing,
    lineCount: r.lineCount,
    lineDebitPaise: r.lineDebitPaise,
    matchedCount: r.matchedCount,
    matchedPaise: r.matchedPaise,
    unmatchedCount: r.unmatchedCount,
    deltaPaise: Math.max(0, r.lineDebitPaise - r.matchedPaise),
    ledgerDuePaise,
    dueDriftPaise,
    updatedAt: r.updatedAt.toISOString(),
  };
}

/**
 * Signed ledger balance at close — `−(opening + Σ tx dated before that
 * date)` — for each of `dates`, in ONE query regardless of how many distinct
 * dates are asked for (bounded per AC6: `listReconciliations` must not issue
 * one aggregate per row). Negative means the ledger shows this card in
 * credit; never clamped here (see `driftPresentation` for how a negative
 * value is presented). `date < statementDate` (strict) matches this card's
 * documented `[start, close)` cycle convention — a transaction dated exactly
 * on the close belongs to the *next* cycle. Scoped to `accountId` AND
 * `userId`, and excludes soft-deleted rows.
 */
async function ledgerDuesAtDates(
  db: DbOrTx,
  userId: string,
  accountId: string,
  openingBalancePaise: number,
  dates: readonly string[],
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  const distinct = [...new Set(dates)];
  if (distinct.length === 0) return result;
  const dateList = sql.join(
    distinct.map((d) => sql`${d}::date`),
    sql`, `,
  );
  const agg = await db.execute(sql`
    select ds.stmt_date::text as stmt_date,
      coalesce(sum(t.amount_paise), 0)::bigint as sum_paise
    from unnest(array[${dateList}]) as ds(stmt_date)
    left join transactions t
      on t.account_id = ${accountId}
      and t.user_id = ${userId}
      and t.deleted_at is null
      and t.date < ds.stmt_date
    group by ds.stmt_date
  `);
  for (const row of agg.rows as { stmt_date: string; sum_paise: string }[]) {
    const sum = Number(row.sum_paise);
    if (!Number.isSafeInteger(sum)) {
      throw new HttpError(500, "Ledger balance aggregate exceeded a safe integer — refusing to lose paise");
    }
    const ledgerDuePaise = -(openingBalancePaise + sum);
    if (!Number.isSafeInteger(ledgerDuePaise)) {
      throw new HttpError(500, "Ledger balance aggregate exceeded a safe integer — refusing to lose paise");
    }
    result.set(row.stmt_date, ledgerDuePaise);
  }
  return result;
}

/**
 * A card's statement reconciliations, newest cycle first. `deltaPaise` — the
 * listed spend not yet cleared in the ledger — is derived here so the client
 * doesn't have to. Read-only; the extractor writes these when it processes a
 * statement (see apps/extractor: upsertReconciliation).
 *
 * `ledgerDuePaise`/`dueDriftPaise` compare the issuer's own total due against
 * the ledger's own balance at that statement's close, surfacing a
 * carried-forward balance or other ledger shortfall the statement's lines
 * never mention (see tasks/cc-recon-01-statement-drift). Bounded to at most
 * 3 total queries regardless of row count (AC6): ownership lookup, the
 * reconciliations themselves, and one aggregate over their distinct
 * statement dates.
 */
export async function listReconciliations(
  db: Db,
  userId: string,
  accountId: string,
): Promise<StatementReconciliation[]> {
  const acc = await ownedCardAccount(db, userId, accountId);
  const rows = await db.query.statementReconciliations.findMany({
    where: and(
      eq(statementReconciliations.userId, userId),
      eq(statementReconciliations.accountId, accountId),
    ),
    orderBy: [desc(statementReconciliations.period)],
    limit: 24,
  });
  const dates = rows.map((r) => r.statementDate).filter((d): d is string => d !== null);
  const ledgerDueByDate = await ledgerDuesAtDates(db, userId, accountId, acc.openingBalancePaise, dates);
  return rows.map((r) =>
    toReconciliationDto(r, r.statementDate !== null ? (ledgerDueByDate.get(r.statementDate) ?? null) : null),
  );
}

export async function addRewardEntry(
  db: Db,
  userId: string,
  accountId: string,
  input: CreateRewardEntry & { points: number },
): Promise<RewardEntry> {
  await ownedCardAccount(db, userId, accountId);
  const rows = await db
    .insert(rewardEntries)
    .values({ userId, accountId, date: input.date, points: input.points, note: input.note ?? "" })
    .returning();
  const r = rows[0]!;
  return { id: r.id, accountId: r.accountId, date: r.date, points: r.points, note: r.note };
}

export async function deleteRewardEntry(
  db: Db,
  userId: string,
  accountId: string,
  id: string,
): Promise<void> {
  const rows = await db
    .delete(rewardEntries)
    .where(
      and(eq(rewardEntries.id, id), eq(rewardEntries.userId, userId), eq(rewardEntries.accountId, accountId)),
    )
    .returning({ id: rewardEntries.id });
  if (rows.length === 0) throw new HttpError(404, "Entry not found");
}

// ---------- statement reconciliation: recompute ----------

/** One statement line plus the live ledger transaction it is tied to, if any. */
export interface StatementLineState {
  direction: "debit" | "credit";
  /** positive magnitude, as extracted */
  amountPaise: number;
  /** the live ledger transaction this line is tied to, or null when it isn't */
  ledgerTxnId: string | null;
}

/** Recomputed match stats over a statement's lines. Mirrors the extractor's shape. */
export interface RecomputedStats {
  lineCount: number;
  lineDebitPaise: number;
  matchedCount: number;
  matchedPaise: number;
  unmatchedCount: number;
  matchedTxnIds: string[];
}

/**
 * What the statement itself said — the issuer's own totals, as first extracted.
 * These are facts about the bill, not about our ledger, so a recompute preserves
 * them verbatim.
 */
export interface StatementFacts {
  lineCount: number;
  lineDebitPaise: number;
}

/**
 * Re-derive a cycle's match stats from the links recorded on its statement lines,
 * keeping the issuer's own totals untouched.
 *
 * This deliberately does NOT re-run fuzzy matching. The extractor matches once,
 * at extraction time, against the ledger as it stood then — so a statement that
 * arrives before its spends are accepted records zero matches forever. By then the
 * link is no longer a guess: the line was either auto-matched to a transaction or
 * accepted into one. Recomputing from that recorded link is both cheaper and more
 * truthful than guessing again.
 *
 * `lineCount` and `lineDebitPaise` are carried over from `facts` rather than
 * recounted, because the surviving lines are not the whole statement: the
 * extractor skips inserting a line whose spend was already captured from a
 * real-time alert (`on conflict (user_id, dedupe_hash) do nothing`). Recounting
 * would quietly replace what the issuer billed with whatever rows happen to
 * remain — on a fully-deduplicated statement, zero.
 *
 * A skipped line is therefore invisible here and counts as unmatched, which
 * overstates what is left to review rather than claiming a false all-clear.
 *
 * Only matched *debits* add to `matchedPaise`, exactly as the extractor does — a
 * cleared refund is not cleared spend and must not shrink the spend delta.
 */
export function summarizeStatementLines(
  facts: StatementFacts,
  lines: StatementLineState[],
): RecomputedStats {
  let matchedCount = 0;
  let matchedPaise = 0;
  const matchedTxnIds: string[] = [];
  for (const line of lines) {
    if (line.ledgerTxnId === null) continue;
    matchedCount += 1;
    if (line.direction === "debit") matchedPaise += line.amountPaise;
    matchedTxnIds.push(line.ledgerTxnId);
  }
  return {
    lineCount: facts.lineCount,
    lineDebitPaise: facts.lineDebitPaise,
    matchedCount,
    matchedPaise,
    // Never negative: a statement may carry more recorded links than the issuer
    // listed lines if a line was re-extracted after a replay.
    unmatchedCount: Math.max(0, facts.lineCount - matchedCount),
    matchedTxnIds,
  };
}

/**
 * Re-derive one cycle's reconciliation from the ledger as it stands now, and
 * re-stamp the transactions it cleared.
 *
 * The extractor's snapshot is a point-in-time reading; accepting the statement's
 * lines afterwards (the normal flow) leaves it understating what is cleared.
 * This is the repair path — read-only with respect to the statement lines
 * themselves, so it can be run as often as the user likes.
 */
export async function recomputeReconciliation(
  db: Db,
  userId: string,
  accountId: string,
  id: string,
): Promise<StatementReconciliation> {
  await ownedCardAccount(db, userId, accountId);
  const updated = await db.transaction(async (tx) => {
    // Lock the snapshot for the duration: the extractor upserts this same row by
    // (account_id, period), and without the lock a concurrent statement run could
    // leave a hybrid of its ingestion and our stats.
    const [snapshot] = await tx
      .select()
      .from(statementReconciliations)
      .where(
        and(
          eq(statementReconciliations.id, id),
          eq(statementReconciliations.accountId, accountId),
          eq(statementReconciliations.userId, userId),
        ),
      )
      .for("update");
    if (!snapshot) throw new HttpError(404, "Reconciliation not found");
    // The snapshot names the statement email its lines came from. Without it there
    // is nothing to recompute against (the ingestion was deleted).
    if (!snapshot.ingestionId) {
      throw new HttpError(409, "This statement's email is no longer available to re-check");
    }

    const lines = await tx
      .select({
        direction: extractedTransactions.direction,
        amountPaise: extractedTransactions.amountPaise,
        transactionId: extractedTransactions.transactionId,
        matchedTransactionId: extractedTransactions.matchedTransactionId,
      })
      .from(extractedTransactions)
      .where(
        and(
          eq(extractedTransactions.ingestionId, snapshot.ingestionId),
          eq(extractedTransactions.userId, userId),
          // One email can in principle carry more than one card's lines; only this
          // card's belong to this cycle.
          eq(extractedTransactions.suggestedAccountId, accountId),
        ),
      );

    // A link is only real if the transaction is still there, still this user's, and
    // still on this card: a since-deleted or moved row must not count as cleared.
    const candidateIds = [
      ...new Set(
        lines.flatMap((l) =>
          [l.matchedTransactionId, l.transactionId].filter((v): v is string => v !== null),
        ),
      ),
    ];
    const live =
      candidateIds.length === 0
        ? []
        : await tx
            .select({ id: transactions.id })
            .from(transactions)
            .where(
              and(
                inArray(transactions.id, candidateIds),
                eq(transactions.userId, userId),
                eq(transactions.accountId, accountId),
                isNull(transactions.deletedAt),
              ),
            );
    const liveIds = new Set(live.map((t) => t.id));
    const stats = summarizeStatementLines(
      { lineCount: snapshot.lineCount, lineDebitPaise: snapshot.lineDebitPaise },
      lines.map((l) => {
        // The duplicate link is the stronger claim; fall back to the accepted one.
        const linked = [l.matchedTransactionId, l.transactionId].find(
          (v): v is string => v !== null && liveIds.has(v),
        );
        return { direction: l.direction, amountPaise: l.amountPaise, ledgerTxnId: linked ?? null };
      }),
    );

    const [row] = await tx
      .update(statementReconciliations)
      .set({
        matchedCount: stats.matchedCount,
        matchedPaise: stats.matchedPaise,
        unmatchedCount: stats.unmatchedCount,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(statementReconciliations.id, id),
          eq(statementReconciliations.accountId, accountId),
          eq(statementReconciliations.userId, userId),
        ),
      )
      .returning();
    // Re-stamp as the extractor does: drop this cycle's prior stamps so a recompute
    // that clears fewer rows leaves none stale, then mark the current set. Both
    // writes stay scoped to this user's rows on this card.
    await tx
      .update(transactions)
      .set({ reconciledStatementId: null })
      .where(
        and(
          eq(transactions.reconciledStatementId, id),
          eq(transactions.userId, userId),
          eq(transactions.accountId, accountId),
        ),
      );
    if (stats.matchedTxnIds.length > 0) {
      await tx
        .update(transactions)
        .set({ reconciledStatementId: id })
        .where(
          and(
            inArray(transactions.id, stats.matchedTxnIds),
            eq(transactions.userId, userId),
            eq(transactions.accountId, accountId),
            isNull(transactions.deletedAt),
          ),
        );
    }

    // Enrich with the same ledger-due arithmetic as listReconciliations, computed
    // through this same transaction handle (not a follow-up call after commit) so
    // the returned drift describes the identical ledger snapshot as `row`'s stats
    // — see review-1/2 on recompute's enrichment needing one consistent instant.
    const [acctRow] = await tx
      .select({ openingBalancePaise: accounts.openingBalancePaise })
      .from(accounts)
      .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId)));
    const ledgerDuePaise =
      row!.statementDate !== null && acctRow
        ? ((
            await ledgerDuesAtDates(tx, userId, accountId, acctRow.openingBalancePaise, [row!.statementDate])
          ).get(row!.statementDate) ?? null)
        : null;
    return { row: row!, ledgerDuePaise };
  });
  return toReconciliationDto(updated.row, updated.ledgerDuePaise);
}

// ---------- statement reconciliation: absorb a carried-forward balance ----------

/**
 * Test-only concurrency seam for `absorbCarryover`. Every field is optional
 * and a no-op in every production caller — see `afterAggregate` below.
 */
export interface AbsorbCarryoverHooks {
  /**
   * Fires once per attempt, immediately after this transaction has read the
   * ledger aggregate (`ledgerDuesAtDates`) and before it updates the account
   * row. Exists so a test can deterministically land a concurrent write in
   * exactly the window the SSI race depends on
   * (tasks/cc-recon-02-carryover-seed/TASK.md P6a). Never set by a real
   * route handler.
   */
  afterAggregate?: () => Promise<void>;
}

/**
 * Absorb a statement's carried-forward balance into the card's opening
 * balance, so the ledger-derived due at that statement's close matches what
 * the issuer actually billed (`totalDuePaise`). See
 * tasks/cc-recon-02-carryover-seed/TASK.md.
 *
 * Runs in ONE transaction at `SERIALIZABLE` isolation, wrapped by
 * `withSerializableRetry` (one retry on SQLSTATE `40001`): a concurrent
 * ledger write touching this card, a settings opening-balance edit, or a
 * second absorb call (same or a different reconciliation row of the same
 * card) either serializes cleanly against this call or forces it to retry
 * against fresh state — it never commits an adjustment computed from a
 * ledger snapshot that no longer held by commit time.
 *
 * Lock order is account (`FOR UPDATE`) then reconciliation (`FOR UPDATE`) —
 * the same order `updateAccount` (accounts.ts) uses for its own
 * opening-balance edits, so the two can never deadlock against each other.
 * Every check (existence, `type = 'credit_card'`, not archived) is read from
 * that same locked row version, not from an earlier unlocked read.
 *
 * Only a POSITIVE drift is absorbed (`drift <= 0` → 409 "Nothing to carry
 * forward"): drift is evidence of a carried-forward balance, not proof of
 * one — missing, misdated, or misassigned ledger entries can produce the
 * same number — so an already-complete or over-complete ledger is never
 * silently reinterpreted as history.
 *
 * `opening_balance_paise` carries no effective date, so this mutation
 * reinterprets the card's liability for every historical date, not merely
 * from today forward. That is accepted deliberately (TASK.md P4): a card
 * onboarded mid-history should have carried this balance from account
 * creation, so this corrects history rather than corrupting it. After
 * commit this fires a fire-and-forget, best-effort `repairSnapshots` scoped
 * to this user, `from` = the account's `created_at` converted to a UTC date
 * string — errors (including `repairSnapshots`'s own 409 when a repair is
 * already running) are logged and never fail this call's response.
 * `recomputeSnapshotsSince` (which `repairSnapshots` wraps) clamps `from` to
 * at most `MAX_RECOMPUTE_SINCE_DAYS` (370) days before today, and the
 * nightly sweep only ever revisits the trailing 45 days — so for a card
 * older than ~370 days, stored net-worth snapshots between account creation
 * and that clamp boundary remain UNREPAIRED until a future targeted repair.
 * This is an accepted, disclosed limitation (see the web confirm dialog),
 * not a bug.
 */
export async function absorbCarryover(
  db: Db,
  redis: Pick<Redis, "set" | "eval">,
  userId: string,
  accountId: string,
  reconciliationId: string,
  hooks?: AbsorbCarryoverHooks,
): Promise<StatementReconciliation> {
  const { dto, createdAt } = await withSerializableRetry(() =>
    db.transaction(
      async (tx) => {
        // Lock the account first — this is what serializes against a concurrent
        // opening-balance edit (updateAccount locks the same row the same way
        // before its own edit) or a second absorb on this same card.
        const [account] = await tx
          .select()
          .from(accounts)
          .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId)))
          .for("update");
        if (!account) throw new HttpError(404, "Account not found");
        if (account.type !== "credit_card") throw new HttpError(400, "Not a credit card account");
        if (account.archivedAt !== null) throw new HttpError(409, "Card is archived");

        const [reconciliation] = await tx
          .select()
          .from(statementReconciliations)
          .where(
            and(
              eq(statementReconciliations.id, reconciliationId),
              eq(statementReconciliations.accountId, accountId),
              eq(statementReconciliations.userId, userId),
            ),
          )
          .for("update");
        if (!reconciliation) throw new HttpError(404, "Reconciliation not found");
        if (reconciliation.totalDuePaise === null || reconciliation.statementDate === null) {
          throw new HttpError(409, "This statement has no total due or statement date to absorb against");
        }
        const statementDate = reconciliation.statementDate;

        // Recompute the ledger due server-side, inside this same transaction —
        // never trust a client-sent number, and never reuse a figure read before
        // this transaction started.
        const beforeLedgerDueByDate = await ledgerDuesAtDates(
          tx,
          userId,
          accountId,
          account.openingBalancePaise,
          [statementDate],
        );
        const ledgerDuePaise = beforeLedgerDueByDate.get(statementDate) ?? null;

        // Test seam only — see AbsorbCarryoverHooks. Fires after the ledger
        // aggregate read above and before the account UPDATE below, which is the
        // exact window tasks/cc-recon-02-carryover-seed/TASK.md P6a's SSI
        // dependency-cycle test depends on.
        await hooks?.afterAggregate?.();

        const drift = dueDrift(reconciliation.totalDuePaise, ledgerDuePaise);
        if (drift === null || drift <= 0) {
          throw new HttpError(409, "Nothing to carry forward");
        }

        // Sign proof: ledgerDue = −(opening + Σtx); want −(opening' + Σtx) =
        // totalDue ⇒ opening' = opening − drift (see dueDrift and TASK.md P1).
        const nextOpeningBalancePaise = account.openingBalancePaise - drift;
        if (!Number.isSafeInteger(nextOpeningBalancePaise)) {
          throw new HttpError(500, "Adjusted opening balance exceeded a safe integer — refusing to lose paise");
        }

        await tx
          .update(accounts)
          .set({ openingBalancePaise: nextOpeningBalancePaise })
          .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId)));

        // Re-derive from the post-update state through this SAME tx handle (not a
        // follow-up call after commit), mirroring recomputeReconciliation's own
        // enrichment — the returned drift must describe the committed opening
        // balance, not the pre-update arithmetic.
        const afterLedgerDueByDate = await ledgerDuesAtDates(
          tx,
          userId,
          accountId,
          nextOpeningBalancePaise,
          [statementDate],
        );
        const afterLedgerDuePaise = afterLedgerDueByDate.get(statementDate) ?? null;

        return {
          dto: toReconciliationDto(reconciliation, afterLedgerDuePaise),
          createdAt: account.createdAt,
        };
      },
      { isolationLevel: "serializable" },
    ),
  );

  // Post-commit, fire-and-forget: never let a repair failure fail this
  // response (see JSDoc above). Logged, not surfaced.
  const from = createdAt.toISOString().slice(0, 10);
  void repairSnapshots(db, redis, userId, from).catch((err: unknown) => {
    console.error("absorbCarryover: post-commit net-worth snapshot repair failed", {
      userId,
      accountId,
      from,
      err,
    });
  });

  return dto;
}
