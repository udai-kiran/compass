import { and, eq, sql } from "drizzle-orm";
import type {
  CardActivity,
  CardActivityTxn,
  CardDetails,
  CardHolderSummary,
  CardIssuerSettings,
  CardSummary,
  UpsertCardDetails,
  UpsertCardIssuerSettings,
} from "@compass/shared";
import { UpsertCardDetailsSchema, UpsertCardIssuerSettingsSchema } from "@compass/shared";
import type { Db } from "../../../db/index.ts";
import { accounts } from "../../../db/schema.ts";
import { cardDetails, cardIssuerSettings, rewardEntries } from "../schema.ts";
import { HttpError } from "../../../lib/errors.ts";
import { decryptSecret, encryptSecret } from "../../../lib/secret-box.ts";
import { activityWindow, cardCycle, nextOccurrence, splitByCycle } from "./cycle-math.ts";

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

/**
 * Ownership guard shared by nearly every exported function in this module —
 * used cross-file too (`reconciliation-writes.ts` needs the same 404/400
 * checks before it locks the account row). Internal cross-module-file export,
 * not a public HTTP/package API commitment.
 */
export async function ownedCardAccount(db: Db, userId: string, accountId: string) {
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
        coalesce(sum(p.amount_paise), 0)::bigint as total,
        coalesce(sum(p.amount_paise) filter (where t.date < ${billedBefore}), 0)::bigint as at_close,
        coalesce(sum(p.amount_paise) filter (where p.amount_paise < 0 and t.date >= ${billedBefore}), 0)::bigint as current_spend
      from postings p
      join transactions t on t.id = p.transaction_id
      where p.account_id = ${acc.id} and t.user_id = ${userId} and t.deleted_at is null and t.date <= ${ref}
    `);
    const row = sums.rows[0] as { total: string; at_close: string; current_spend: string };
    if (!Number.isSafeInteger(Number(row.total)) || !Number.isSafeInteger(Number(row.at_close)) || !Number.isSafeInteger(Number(row.current_spend))) {
      throw new HttpError(500, "Card balance aggregate exceeded a safe integer — refusing to lose paise");
    }
    const balance = Number(row.total);

    const rewards = await db
      .select({ points: sql<number>`coalesce(sum(points), 0)::int` })
      .from(rewardEntries)
      .where(eq(rewardEntries.accountId, acc.id));

    const owedAtClose = -Number(row.at_close);
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
      coalesce(sum(p.amount_paise), 0)::bigint as total,
      coalesce(sum(p.amount_paise) filter (where t.date < ${billedBefore}), 0)::bigint as at_close
    from postings p
    join transactions t on t.id = p.transaction_id
    where p.account_id = ${accountId} and t.user_id = ${userId} and t.deleted_at is null and t.date <= ${ref}
  `);
  const agg = sums.rows[0] as { total: string; at_close: string };
  if (!Number.isSafeInteger(Number(agg.total)) || !Number.isSafeInteger(Number(agg.at_close))) {
    throw new HttpError(500, "Card balance aggregate exceeded a safe integer — refusing to lose paise");
  }
  const balancePaise = Number(agg.total);
  const owedAtClose = -Number(agg.at_close);
  const totalDuePaise = Math.max(0, cycle ? owedAtClose : -balancePaise);

  const rawRows = await db.execute(sql`
    select t.id, t.date, t.merchant, t.reconciled_statement_id, cat.category_id, p.amount_paise
    from postings p
    join transactions t on t.id = p.transaction_id
    left join lateral (
      select cp.category_id
      from postings cp
      join accounts ca on ca.id = cp.account_id and ca.system_kind is not null and ca.user_id = t.user_id
      where cp.transaction_id = t.id and cp.category_id is not null
      limit 1
    ) cat on true
    where p.account_id = ${accountId}
      and t.user_id = ${userId} and t.deleted_at is null
      and t.date >= ${fromInclusive} and t.date <= ${ref}
    order by t.date desc, t.id desc
  `);
  const rows = rawRows.rows as Array<{
    id: string;
    date: string;
    merchant: string;
    reconciled_statement_id: string | null;
    category_id: string | null;
    amount_paise: string;
  }>;
  const toTxn = (t: (typeof rows)[number]): CardActivityTxn => {
    const amountPaise = Number(t.amount_paise);
    if (!Number.isSafeInteger(amountPaise)) {
      throw new HttpError(500, "Card activity amount exceeded a safe integer — refusing to lose paise");
    }
    return {
      id: t.id,
      date: t.date,
      merchant: t.merchant,
      amountPaise,
      categoryId: t.category_id,
      reconciledStatementId: t.reconciled_statement_id,
    };
  };
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
