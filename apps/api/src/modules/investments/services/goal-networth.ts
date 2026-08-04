import { eq } from "drizzle-orm";
import type { GoalAsset, GoalGroup, NetWorthByGoal } from "@compass/shared";
import { accountCanHaveGoal, isLiabilityAccount } from "@compass/shared";
import type { Db } from "../../../db/index.ts";
import { goals } from "../../../db/schema.ts";
import { listAccounts } from "../../ledger/services/accounts.ts";
import { getPortfolio } from "./holdings.ts";

export interface GoalMeta {
  id: string;
  name: string;
  type: string | null;
  targetPaise: number | null;
}

function summarize(items: GoalAsset[]): Pick<GoalGroup, "netPaise" | "assetsPaise" | "liabilitiesPaise"> {
  let assetsPaise = 0;
  let liabilitiesPaise = 0;
  for (const it of items) {
    if (it.valuePaise >= 0) assetsPaise += it.valuePaise;
    else liabilitiesPaise += -it.valuePaise;
  }
  return { netPaise: assetsPaise - liabilitiesPaise, assetsPaise, liabilitiesPaise };
}

/**
 * Partitions earmarkable assets into one group per goal plus an "Unassigned"
 * group. Pure so the rollup is testable without a DB. Every goal appears (even
 * with no assets, so its target is visible); Unassigned appears only when
 * something is untagged. An asset whose goalId doesn't match a known goal falls
 * to Unassigned. Every group here is assignable — liabilities are handled apart.
 */
export function groupByGoal(assets: GoalAsset[], goalList: GoalMeta[]): GoalGroup[] {
  const known = new Set(goalList.map((g) => g.id));
  const byGoal = new Map<string, GoalAsset[]>();
  const unassigned: GoalAsset[] = [];
  for (const a of assets) {
    if (a.goalId !== null && known.has(a.goalId)) {
      (byGoal.get(a.goalId) ?? byGoal.set(a.goalId, []).get(a.goalId)!).push(a);
    } else {
      unassigned.push(a);
    }
  }

  const groups: GoalGroup[] = goalList.map((g) => {
    const items = byGoal.get(g.id) ?? [];
    return {
      goalId: g.id,
      goalName: g.name,
      goalType: g.type,
      targetPaise: g.targetPaise,
      assignable: true,
      items,
      ...summarize(items),
    };
  });

  if (unassigned.length > 0) {
    groups.push({
      goalId: null,
      goalName: "Unassigned",
      goalType: null,
      targetPaise: null,
      assignable: true,
      items: unassigned,
      ...summarize(unassigned),
    });
  }
  return groups;
}

/**
 * A single non-assignable "Liabilities" group (credit cards, loans, overdrafts).
 * Kept out of the goal grouping because you don't earmark a debt to a goal —
 * they're shown for completeness, not to be tagged. Null when there are none.
 */
export function liabilitiesGroup(items: GoalAsset[]): GoalGroup | null {
  if (items.length === 0) return null;
  return {
    goalId: null,
    goalName: "Liabilities",
    goalType: null,
    targetPaise: null,
    assignable: false,
    items,
    ...summarize(items),
  };
}

export async function netWorthByGoal(db: Db, userId: string): Promise<NetWorthByGoal> {
  const [accounts, portfolio, goalRows] = await Promise.all([
    listAccounts(db, userId),
    getPortfolio(db, userId),
    db.query.goals.findMany({ where: eq(goals.userId, userId), orderBy: (g, { asc }) => [asc(g.createdAt)] }),
  ]);

  const liveAccounts = accounts.filter((a) => a.archivedAt === null);
  // Only earmarkable assets belong in the goal breakdown: investments and the
  // credited-balance schemes, plus every holding. Liabilities go to their own
  // group; plain savings (bank/cash) are dropped — they can't be tagged and
  // would just be noise (they still show in the top-level breakdown).
  const assets: GoalAsset[] = [
    ...liveAccounts
      .filter((a) => accountCanHaveGoal(a.type))
      .map((a): GoalAsset => ({
        kind: "account",
        id: a.id,
        name: a.name,
        subtitle: a.accountLast4 ? `•••• ${a.accountLast4}` : a.type,
        valuePaise: a.balancePaise,
        goalId: a.goalId,
      })),
    ...portfolio.positions
      .filter((p) => !p.archived)
      .map((p): GoalAsset => ({
        kind: "holding",
        id: p.id,
        name: p.name,
        subtitle: p.folioNumber ? `Folio ${p.folioNumber}` : p.assetClass,
        valuePaise: p.currentValuePaise,
        goalId: p.goalId,
      })),
  ];

  // Account balances are already signed (loans/cards negative), so they net directly.
  const liabilities: GoalAsset[] = liveAccounts
    .filter((a) => isLiabilityAccount(a.type))
    .map((a): GoalAsset => ({
      kind: "account",
      id: a.id,
      name: a.name,
      subtitle: a.accountLast4 ? `•••• ${a.accountLast4}` : a.type,
      valuePaise: a.balancePaise,
      goalId: a.goalId,
    }));

  const goalList: GoalMeta[] = goalRows.map((g) => ({
    id: g.id,
    name: g.name,
    type: g.type,
    targetPaise: g.targetPaise,
  }));

  const groups = groupByGoal(assets, goalList);
  const liab = liabilitiesGroup(liabilities);
  if (liab) groups.push(liab);
  return { groups };
}
