import { eq } from "drizzle-orm";
import type { GoalAsset, GoalGroup, NetWorthByGoal } from "@compass/shared";
import type { Db } from "../db/index.ts";
import { goals } from "../db/schema.ts";
import { listAccounts } from "./accounts.ts";
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
 * Partitions tagged assets into one group per goal plus an "Unassigned" group.
 * Pure so the rollup is testable without a DB. Every goal appears (even with no
 * assets, so its target is visible); Unassigned appears only when something is
 * untagged. An asset whose goalId doesn't match a known goal falls to Unassigned.
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
      items: unassigned,
      ...summarize(unassigned),
    });
  }
  return groups;
}

export async function netWorthByGoal(db: Db, userId: string): Promise<NetWorthByGoal> {
  const [accounts, portfolio, goalRows] = await Promise.all([
    listAccounts(db, userId),
    getPortfolio(db, userId),
    db.query.goals.findMany({ where: eq(goals.userId, userId), orderBy: (g, { asc }) => [asc(g.createdAt)] }),
  ]);

  const assets: GoalAsset[] = [
    // Account balances are already signed (loans/cards negative), so they net directly.
    ...accounts
      .filter((a) => a.archivedAt === null)
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

  const goalList: GoalMeta[] = goalRows.map((g) => ({
    id: g.id,
    name: g.name,
    type: g.type,
    targetPaise: g.targetPaise,
  }));

  return { groups: groupByGoal(assets, goalList) };
}
