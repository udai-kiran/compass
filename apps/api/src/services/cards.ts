import { and, desc, eq, gt, isNull, lte, sql } from "drizzle-orm";
import type {
  CardActivity,
  CardActivityTxn,
  CardDetails,
  CardHolderSummary,
  CardIssuerSettings,
  CardSummary,
  CreateRewardEntry,
  RewardEntry,
  UpsertCardDetails,
  UpsertCardIssuerSettings,
} from "@compass/shared";
import { formatINR, UpsertCardDetailsSchema, UpsertCardIssuerSettingsSchema } from "@compass/shared";
import type { Db } from "../db/index.ts";
import {
  accounts,
  alertLedger,
  cardDetails,
  cardIssuerSettings,
  rewardEntries,
  transactions,
} from "../db/schema.ts";
import { HttpError } from "../lib/errors.ts";
import { decryptSecret, encryptSecret } from "../lib/secret-box.ts";
import { createNotification } from "./notifications.ts";
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
    // The last generated statement's close (or today when the card has no cycle).
    const stmtClose = d ? lastStatementClose(ref, d.cycleDay) : ref;

    const sums = await db.execute(sql`
      select
        coalesce(sum(amount_paise), 0)::bigint as total,
        coalesce(sum(amount_paise) filter (where date <= ${stmtClose}), 0)::bigint as at_close,
        coalesce(sum(amount_paise) filter (where amount_paise < 0 and date > ${stmtClose}), 0)::bigint as current_spend
      from transactions
      where account_id = ${acc.id} and user_id = ${userId} and deleted_at is null and date <= ${ref}
    `);
    const row = sums.rows[0] as { total: string; at_close: string; current_spend: string };
    const balance = acc.openingBalancePaise + Number(row.total);

    const rewards = await db
      .select({ points: sql<number>`coalesce(sum(points), 0)::int` })
      .from(rewardEntries)
      .where(eq(rewardEntries.accountId, acc.id));

    const lastClose = d ? stmtClose : null;
    const prevClose = d && lastClose ? lastOccurrence(dayBefore(lastClose), d.cycleDay) : null;
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
        statementStart: prevClose,
        statementEnd: lastClose,
        amountDuePaise: Math.max(0, owedAtClose),
        dueDate: d && lastClose ? nextOccurrence(lastClose, d.dueDay) : null,
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

  const lastClose = d ? lastStatementClose(ref, d.cycleDay) : null;
  const prevClose = d && lastClose ? lastOccurrence(dayBefore(lastClose), d.cycleDay) : null;
  const dueDate = d && lastClose ? nextOccurrence(lastClose, d.dueDay) : null;
  const listFrom = prevClose ?? shiftDays(ref, -45);

  // Headline balances: owed now, and owed as of the last statement close.
  const sums = await db.execute(sql`
    select
      coalesce(sum(amount_paise), 0)::bigint as total,
      coalesce(sum(amount_paise) filter (where date <= ${lastClose ?? ref}), 0)::bigint as at_close
    from transactions
    where account_id = ${accountId} and user_id = ${userId} and deleted_at is null and date <= ${ref}
  `);
  const agg = sums.rows[0] as { total: string; at_close: string };
  const balancePaise = acc.openingBalancePaise + Number(agg.total);
  const owedAtClose = -(acc.openingBalancePaise + Number(agg.at_close));
  const totalDuePaise = Math.max(0, lastClose ? owedAtClose : -balancePaise);

  const rows = await db.query.transactions.findMany({
    where: and(
      eq(transactions.accountId, accountId),
      eq(transactions.userId, userId),
      isNull(transactions.deletedAt),
      gt(transactions.date, listFrom),
      lte(transactions.date, ref),
    ),
    orderBy: [desc(transactions.date), desc(transactions.id)],
    columns: { id: true, date: true, merchant: true, amountPaise: true, categoryId: true },
  });
  const toTxn = (t: (typeof rows)[number]): CardActivityTxn => ({
    id: t.id,
    date: t.date,
    merchant: t.merchant,
    amountPaise: t.amountPaise,
    categoryId: t.categoryId,
  });
  // Split by the statement close: on/before → billed, after → unbilled.
  const billed =
    lastClose && prevClose
      ? rows.filter((t) => t.date > prevClose && t.date <= lastClose).map(toTxn)
      : [];
  const unbilled = rows.filter((t) => (lastClose ? t.date > lastClose : true)).map(toTxn);
  const unbilledSpendPaise = unbilled.reduce(
    (s, t) => s + (t.amountPaise < 0 ? -t.amountPaise : 0),
    0,
  );

  return {
    accountId: acc.id,
    name: acc.name,
    bankName: acc.institution,
    last4: acc.accountLast4,
    statementStart: prevClose,
    statementEnd: lastClose,
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
