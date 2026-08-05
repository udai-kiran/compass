import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import { eq } from "drizzle-orm";
import type { Config } from "../../../config.ts";
import type { Db } from "../../../db/index.ts";
import {
  accounts,
  bankDetails,
  budgetLines,
  budgets,
  cardDetails,
  cardIssuerSettings,
  categories,
  emiDetails,
  goals,
  holdingEvents,
  holdingValuations,
  holdings,
  insurancePolicies,
  netWorthSnapshots,
  recurringTemplates,
  retirementDetails,
  rewardEntries,
  transactions,
  users,
} from "../../../db/schema.ts";
import { seedDefaultCategories } from "../../ledger/services/categories.ts";
import { findUserByEmail } from "./users.ts";

/** ₹ → paise. Amounts throughout the seed are written in rupees for readability. */
const r = (rupees: number): number => Math.round(rupees * 100);

/** YYYY-MM-DD for a date `monthsAgo` months back, on day `day`. Uses UTC
 * calendar fields throughout (matching this app's LEDGER_DAY_TZ=UTC
 * convention, e.g. services/recurring.ts's todayIso()) so the result is
 * deterministic regardless of the server's local wall-clock time-of-day or
 * timezone — a local-time/UTC-serialization mismatch here previously
 * produced the wrong date in positive-UTC-offset timezones near midnight. */
function monthDay(monthsAgo: number, day: number): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsAgo, day))
    .toISOString()
    .slice(0, 10);
}

/** "YYYY-MM" period key for `monthsAgo` months back. Same UTC-based approach as monthDay. */
function monthKey(monthsAgo: number): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsAgo, 1))
    .toISOString()
    .slice(0, 7);
}

const MONTHS = 6; // how much history to generate

/** Exported for unit tests only. */
export const _demoDates = { monthDay, monthKey, rupeesToPaise: r };

/**
 * Ensure the read-only demo account exists and is populated. Idempotent: does
 * nothing once the demo user has accounts, so it's safe to call on every demo
 * login. Returns the demo user's id. All demo writes are blocked elsewhere, so
 * this data can only ever be created here.
 */
export async function ensureDemoData(db: Db, config: Config): Promise<string> {
  const existing = await findUserByEmail(db, config.DEMO_EMAIL.toLowerCase());
  if (existing) {
    const hasData = await db.query.accounts.findFirst({
      where: eq(accounts.userId, existing.id),
      columns: { id: true },
    });
    if (hasData) return existing.id;
    // A demo user with no data (interrupted seed) — repopulate below.
    await seedInto(db, existing.id);
    return existing.id;
  }

  const passwordHash = await argon2.hash(randomUUID(), { type: argon2.argon2id });
  const [user] = await db
    .insert(users)
    .values({
      email: config.DEMO_EMAIL.toLowerCase(),
      passwordHash,
      displayName: "Demo User",
      isDemo: true,
    })
    // Two concurrent first-time logins would both pass the check above; the
    // unique email lets only one insert win. The loser gets no row back and
    // re-reads the winner's user instead of seeding a second time.
    .onConflictDoNothing({ target: users.email })
    .returning();
  if (!user) {
    const winner = await findUserByEmail(db, config.DEMO_EMAIL.toLowerCase());
    return winner!.id;
  }
  await seedInto(db, user.id);
  return user.id;
}

/** Populate one (empty) user's account with a coherent demo dataset. */
async function seedInto(db: Db, userId: string): Promise<void> {
  await seedDefaultCategories(db, userId);
  const cats = await db.query.categories.findMany({
    where: eq(categories.userId, userId),
    columns: { id: true, name: true, parentId: true },
  });
  const catId = (name: string): string => {
    const found = cats.find((c) => c.name === name);
    if (!found) throw new Error(`demo seed: missing category ${name}`);
    return found.id;
  };

  await db.transaction(async (tx) => {
    // ---- Accounts ----
    const [hdfc, cash, _zerodha, hdfcCard, iciciCard, _homeLoan, ppf, epf] = await tx
      .insert(accounts)
      .values([
        // Bank/cash opening balances are seeded as real "Opening balance" ledger
        // rows below (isOpening), matching createAccount — so the column stays 0.
        { userId, name: "HDFC Savings", type: "bank", institution: "HDFC", accountLast4: "4821", holderName: "Demo User", openingBalancePaise: 0 },
        { userId, name: "Cash Wallet", type: "cash", openingBalancePaise: 0 },
        { userId, name: "Zerodha", type: "investment", institution: "Zerodha", holderName: "Demo User", openingBalancePaise: 0 },
        { userId, name: "HDFC Millennia", type: "credit_card", institution: "HDFC", accountLast4: "7702", holderName: "Demo User", openingBalancePaise: 0 },
        { userId, name: "ICICI Amazon Pay", type: "credit_card", institution: "ICICI", accountLast4: "5140", holderName: "Demo User", openingBalancePaise: 0 },
        { userId, name: "SBI Home Loan", type: "home_loan_od", institution: "SBI", openingBalancePaise: r(-4200000) },
        { userId, name: "PPF", type: "ppf", institution: "SBI", openingBalancePaise: r(920000) },
        { userId, name: "EPF", type: "epf", institution: "EPFO", openingBalancePaise: r(1350000) },
      ])
      .returning({ id: accounts.id });

    await tx.insert(bankDetails).values({
      accountId: hdfc!.id,
      userId,
      accountNumber: "50100234567821",
      ifsc: "HDFC0000123",
      branch: "Koramangala, Bengaluru",
      subtype: "savings",
    });
    await tx.insert(retirementDetails).values([
      { accountId: ppf!.id, userId, annualRateBps: 710, referenceNumber: "PPF-0012345", maturityDate: monthDay(-108, 1) },
      { accountId: epf!.id, userId, annualRateBps: 810, referenceNumber: "UAN100200300400", epsBalancePaise: r(210000) },
    ]);

    // ---- Credit cards ----
    await tx.insert(cardDetails).values([
      { accountId: hdfcCard!.id, userId, network: "visa", productName: "Millennia", cycleDay: 18, dueDay: 7, earnRatePer100: 1 },
      { accountId: iciciCard!.id, userId, network: "visa", productName: "Amazon Pay", cycleDay: 24, dueDay: 12, earnRatePer100: 1 },
    ]);
    await tx.insert(cardIssuerSettings).values([
      { userId, institution: "HDFC", creditLimitPaise: r(350000), utilizationAlertPct: 40, billMobile: "9876543210" },
      { userId, institution: "ICICI", creditLimitPaise: r(200000), utilizationAlertPct: 30, billMobile: "9876543210" },
    ]);
    await tx.insert(rewardEntries).values([
      { userId, accountId: hdfcCard!.id, date: monthDay(2, 18), points: 1240, note: "Statement cycle" },
      { userId, accountId: hdfcCard!.id, date: monthDay(1, 18), points: 980, note: "Statement cycle" },
      { userId, accountId: hdfcCard!.id, date: monthDay(0, 18), points: 1105, note: "Statement cycle" },
      { userId, accountId: hdfcCard!.id, date: monthDay(1, 20), points: -1500, note: "Redeemed for voucher" },
      { userId, accountId: iciciCard!.id, date: monthDay(1, 24), points: 640, note: "Amazon spends" },
    ]);

    // ---- Goals ----
    const [emergency, europe, car] = await tx
      .insert(goals)
      .values([
        { userId, name: "Emergency Fund", type: "emergency_fund", targetMonths: 6 },
        { userId, name: "Europe Trip", type: "vacation", targetPaise: r(500000), targetDate: monthDay(-9, 1) },
        { userId, name: "New Car", type: "vehicle", targetPaise: r(1200000), targetDate: monthDay(-20, 1) },
      ])
      .returning({ id: goals.id });
    await tx.update(accounts).set({ goalId: emergency!.id }).where(eq(accounts.id, hdfc!.id));
    await tx.update(accounts).set({ goalId: car!.id }).where(eq(accounts.id, ppf!.id));

    // ---- Transactions: MONTHS of income + everyday spending ----
    type Txn = typeof transactions.$inferInsert;
    const txns: Txn[] = [];
    const spend = (accountId: string, monthsAgo: number, day: number, rupees: number, category: string, merchant: string) =>
      txns.push({ userId, accountId, date: monthDay(monthsAgo, day), amountPaise: r(-rupees), categoryId: catId(category), merchant, source: "manual" });
    const earn = (accountId: string, monthsAgo: number, day: number, rupees: number, category: string, merchant: string) =>
      txns.push({ userId, accountId, date: monthDay(monthsAgo, day), amountPaise: r(rupees), categoryId: catId(category), merchant, source: "manual" });

    // Opening balances as real ledger rows (dated before the activity below) so the
    // bank/cash ledgers reconcile — the same model createAccount uses for new accounts.
    txns.push({ userId, accountId: hdfc!.id, date: monthDay(12, 1), amountPaise: r(180000), merchant: "Opening balance", isOpening: true });
    txns.push({ userId, accountId: cash!.id, date: monthDay(12, 1), amountPaise: r(6000), merchant: "Opening balance", isOpening: true });

    for (let m = MONTHS - 1; m >= 0; m--) {
      earn(hdfc!.id, m, 1, 150000, "Salary", "Acme Corp Payroll");
      earn(hdfc!.id, m, 5, 340, "Interest", "HDFC Savings Interest");
      spend(hdfc!.id, m, 3, 32000, "Rent", "Landlord");
      spend(hdfc!.id, m, 4, 1899, "Electricity", "BESCOM");
      spend(hdfc!.id, m, 4, 999, "Internet", "ACT Fibernet");
      spend(hdfc!.id, m, 6, 549, "Mobile", "Airtel Postpaid");
      spend(hdfc!.id, m, 8, 25000, "Investments", "Groww SIP");
      spend(hdfcCard!.id, m, 9, 4200 + m * 120, "Groceries", "Big Basket");
      spend(hdfcCard!.id, m, 12, 1650, "Restaurants", "Truffles");
      spend(iciciCard!.id, m, 14, 2380, "Electronics", "Amazon");
      spend(hdfcCard!.id, m, 16, 900, "Food Delivery", "Swiggy");
      spend(hdfc!.id, m, 18, 3000, "Fuel", "Indian Oil");
      spend(cash!.id, m, 20, 450, "Public Transport", "Namma Metro");
      spend(hdfcCard!.id, m, 22, 1299, "Subscriptions", "Assorted");
      spend(hdfc!.id, m, 25, 2100, "Doctor", "Apollo Clinic");
      // Occasional larger one-offs so trends/insights have texture.
      if (m === 2) spend(iciciCard!.id, m, 15, 18990, "Clothing", "Myntra Sale");
      if (m === 4) spend(hdfc!.id, m, 19, 12500, "Vehicle Maintenance", "Bosch Service");
      // Card payments (positive inflow to the card account, from the bank).
      spend(hdfc!.id, m, 6, 9000, "Other Expense", "HDFC Card Payment");
      earn(hdfcCard!.id, m, 6, 9000, "Refunds", "Card Payment Received");
    }
    await tx.insert(transactions).values(txns);

    // ---- Budget for the current month ----
    const [budget] = await tx
      .insert(budgets)
      .values({ userId, period: "monthly", periodKey: monthKey(0) })
      .returning({ id: budgets.id });
    await tx.insert(budgetLines).values([
      { budgetId: budget!.id, categoryId: catId("Food & Dining"), amountPaise: r(15000) },
      { budgetId: budget!.id, categoryId: catId("Transport"), amountPaise: r(6000) },
      { budgetId: budget!.id, categoryId: catId("Shopping"), amountPaise: r(8000) },
      { budgetId: budget!.id, categoryId: catId("Utilities"), amountPaise: r(4000) },
      { budgetId: budget!.id, categoryId: catId("Entertainment"), amountPaise: r(2000) },
    ]);

    // ---- Insurance ----
    await tx.insert(insurancePolicies).values([
      { userId, name: "HDFC Life Click 2 Protect", kind: "life", insurer: "HDFC Life", policyNumber: "HL-778210", sumAssuredPaise: r(15000000), premiumPaise: r(18500), premiumFrequency: "yearly", startDate: monthDay(30, 12), renewalDate: monthDay(-6, 12), nominee: "Spouse" },
      { userId, name: "Star Family Health Optima", kind: "health", healthType: "indemnity", insurer: "Star Health", policyNumber: "SH-4402913", sumAssuredPaise: r(1000000), premiumPaise: r(28400), premiumFrequency: "yearly", startDate: monthDay(20, 3), renewalDate: monthDay(-4, 3), coveredMembers: ["Self", "Spouse", "Child"] },
      { userId, name: "ICICI Lombard Motor", kind: "vehicle", vehicleType: "car", vehicleRegNo: "KA01MJ4821", insurer: "ICICI Lombard", policyNumber: "IL-9920011", sumAssuredPaise: r(820000), premiumPaise: r(14200), premiumFrequency: "yearly", startDate: monthDay(10, 8), renewalDate: monthDay(-2, 8) },
    ]);

    // ---- Holdings (mutual funds + a stock) with cost lots + latest valuation ----
    const [nifty, flexi, smallcap, itc] = await tx
      .insert(holdings)
      .values([
        { userId, name: "UTI Nifty 50 Index Fund", assetClass: "mutual_fund", amfiSchemeCode: 120716, folioNumber: "911234/22", gainsTaxClass: "equity", goalId: europe!.id },
        { userId, name: "Parag Parikh Flexi Cap", assetClass: "mutual_fund", amfiSchemeCode: 122639, folioNumber: "550021/11", gainsTaxClass: "equity" },
        { userId, name: "Nippon India Small Cap", assetClass: "mutual_fund", amfiSchemeCode: 118778, folioNumber: "778452/03", gainsTaxClass: "equity" },
        { userId, name: "ITC Ltd", assetClass: "stock", gainsTaxClass: "equity" },
      ])
      .returning({ id: holdings.id });

    await tx.insert(holdingEvents).values([
      { holdingId: nifty!.id, type: "buy", date: monthDay(24, 8), amountPaise: r(200000), units: 8200, note: "Lump sum", source: "manual" },
      { holdingId: nifty!.id, type: "buy", date: monthDay(6, 8), amountPaise: r(60000), units: 2100, note: "SIP", source: "manual" },
      { holdingId: flexi!.id, type: "buy", date: monthDay(18, 8), amountPaise: r(150000), units: 2400, note: "Lump sum", source: "manual" },
      { holdingId: smallcap!.id, type: "buy", date: monthDay(12, 8), amountPaise: r(90000), units: 640, note: "SIP", source: "manual" },
      { holdingId: itc!.id, type: "buy", date: monthDay(20, 10), amountPaise: r(80000), units: 200, note: "200 @ ₹400", source: "manual" },
    ]);
    await tx.insert(holdingValuations).values([
      { holdingId: nifty!.id, date: monthDay(0, 1), valuePaise: r(342000), nav: 33.15 },
      { holdingId: flexi!.id, date: monthDay(0, 1), valuePaise: r(198000), nav: 82.5 },
      { holdingId: smallcap!.id, date: monthDay(0, 1), valuePaise: r(126500), nav: 197.6 },
      { holdingId: itc!.id, date: monthDay(0, 1), valuePaise: r(94000), nav: 470 },
    ]);

    // ---- Recurring: bills, subscriptions, and the home-loan EMI ----
    const [, , , emiTemplate] = await tx
      .insert(recurringTemplates)
      .values([
        { userId, accountId: hdfc!.id, categoryId: catId("Subscriptions"), merchant: "Netflix", amountPaise: r(-649), frequency: "monthly", nextDueDate: monthDay(-1, 2), kind: "subscription" },
        { userId, accountId: hdfc!.id, categoryId: catId("Subscriptions"), merchant: "Spotify", amountPaise: r(-119), frequency: "monthly", nextDueDate: monthDay(-1, 4), kind: "subscription" },
        { userId, accountId: hdfc!.id, categoryId: catId("Electricity"), merchant: "BESCOM", amountPaise: r(-1899), frequency: "monthly", nextDueDate: monthDay(-1, 4), kind: "bill" },
        { userId, accountId: hdfc!.id, categoryId: catId("EMI & Loans"), merchant: "SBI Home Loan EMI", amountPaise: r(-38500), frequency: "monthly", nextDueDate: monthDay(-1, 5), kind: "emi" },
      ])
      .returning({ id: recurringTemplates.id });
    await tx.insert(emiDetails).values({
      templateId: emiTemplate!.id,
      userId,
      principalPaise: r(5500000),
      annualRateBps: 875,
      totalInstallments: 240,
      startDate: monthDay(30, 5),
    });

    // ---- Net-worth history so the trend has a shape ----
    const snapshots = [] as (typeof netWorthSnapshots.$inferInsert)[];
    for (let m = MONTHS; m >= 0; m--) {
      const assets = r(2600000 + (MONTHS - m) * 65000);
      const liabilities = r(4200000 - (MONTHS - m) * 38500);
      snapshots.push({
        userId,
        date: monthDay(m, 1),
        assetsPaise: assets,
        liabilitiesPaise: liabilities,
        breakdown: { cash: r(186000), holdings: r(760000), investmentAccounts: r(0), creditCards: r(-42000), loans: liabilities },
        estimated: true,
      });
    }
    await tx.insert(netWorthSnapshots).values(snapshots);
  });
}

