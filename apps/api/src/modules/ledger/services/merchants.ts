import { and, eq, ilike } from "drizzle-orm";
import type { Db, DbOrTx } from "../../../db/index.ts";
import { merchantRules, transactions } from "../schema.ts";

const NOISE_TOKENS = new Set([
  "pos", "upi", "imps", "neft", "rtgs", "ach", "ecs", "atm", "ecom", "vps", "ib", "mb",
  "payment", "pay", "payments", "pvt", "ltd", "limited", "india", "in", "txn", "ref",
  "autopay", "mandate", "si", "billpay", "recharge", "purchase", "card",
]);

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/(^|\s)\S/g, (c) => c.toUpperCase());
}

/** Built-in cleanup: "POS 402911 AMAZON PAY INDIA BLR" → "Amazon". */
export function heuristicNormalize(raw: string): string {
  const tokens = raw
    .split(/[\s\-/*_|:;,]+/)
    .map((t) => t.trim())
    .map((t) => (t.includes("@") ? t.split("@")[0]! : t)) // UPI VPA: keep the local part (usually the merchant)
    .filter(Boolean)
    .filter((t) => !/^[\d Xx*#]+$/.test(t)) // reference numbers, masked cards
    .filter((t) => !/\d{4,}/.test(t)) // tokens with long digit runs
    .filter((t) => !NOISE_TOKENS.has(t.toLowerCase()));
  if (tokens.length === 0) return titleCase(raw.trim()).slice(0, 60) || raw.trim();
  return titleCase(tokens.slice(0, 3).join(" "));
}

export type MerchantRule = { match: string; replacement: string };

/** User rules win over heuristics; matched case-insensitively as substring of the raw descriptor. */
export function normalizeMerchant(raw: string, rules: MerchantRule[]): string {
  const lower = raw.toLowerCase();
  for (const r of rules) {
    if (lower.includes(r.match.toLowerCase())) return r.replacement;
  }
  return heuristicNormalize(raw);
}

export async function getMerchantRules(db: DbOrTx, userId: string): Promise<MerchantRule[]> {
  return db.query.merchantRules.findMany({
    where: eq(merchantRules.userId, userId),
    columns: { match: true, replacement: true },
  });
}

export async function renameMerchant(
  db: Db,
  userId: string,
  input: { from: string; to: string; applyToAll: boolean; createRule: boolean },
): Promise<{ updated: number }> {
  let updated = 0;
  if (input.applyToAll) {
    const rows = await db
      .update(transactions)
      .set({ merchant: input.to, updatedAt: new Date() })
      .where(and(eq(transactions.userId, userId), ilike(transactions.merchant, input.from)))
      .returning({ id: transactions.id });
    updated = rows.length;
  }
  if (input.createRule) {
    await db
      .insert(merchantRules)
      .values({ userId, match: input.from, replacement: input.to })
      .onConflictDoUpdate({
        target: [merchantRules.userId, merchantRules.match],
        set: { replacement: input.to },
      });
  }
  return { updated };
}
