import { z } from "zod";
import type { ToolSpec } from "@compass/ai";
import { formatINR } from "@compass/shared";
import type { Redis } from "ioredis";
import type { Db } from "../../../db/index.ts";
import { buildReport } from "../../planning/services/reports.ts";
import { getUtilization } from "../../planning/services/budgets.ts";
import { getInsights } from "../../planning/services/insights.ts";
import { search } from "../../ledger/services/search.ts";
import { listGoals } from "../../planning/services/goals.ts";
import { currentPeriodKey } from "../../../services/periods.ts";

export interface ToolContext {
  db: Db;
  redis: Redis;
  userId: string;
}

interface Tool {
  spec: ToolSpec;
  schema: z.ZodType;
  run(ctx: ToolContext, input: unknown): Promise<unknown>;
}

const periodField = {
  type: "string",
  pattern: "^\\d{4}-\\d{2}$",
  description: "Month as YYYY-MM. Defaults to the current month when omitted.",
};

const PeriodSchema = z.object({ period: z.string().regex(/^\d{4}-\d{2}$/).optional() });
const monthOr = (p?: string) => p ?? currentPeriodKey("monthly");

/**
 * Whitelisted tools the assistant may call. Each is a typed, read-only wrapper
 * over an existing service with its own Zod input validation — the model never
 * touches raw SQL or the DB directly (task 7.4).
 */
const TOOLS: Tool[] = [
  {
    spec: {
      name: "get_spending_summary",
      description: "Income, expenses, net, savings rate, top categories and merchants for a month.",
      inputSchema: { type: "object", properties: { period: periodField } },
    },
    schema: PeriodSchema,
    async run(ctx, input) {
      const { period } = PeriodSchema.parse(input);
      const r = await buildReport(ctx.db, ctx.userId, { period: "monthly", key: monthOr(period) });
      return {
        period: r.periodKey,
        income: formatINR(r.incomePaise),
        expenses: formatINR(r.expensePaise),
        net: formatINR(r.netPaise),
        savingsRatePct: r.savingsRatePct,
        topCategories: r.categories.slice(0, 5).map((c) => ({ name: c.name, spent: formatINR(c.spentPaise) })),
        topMerchants: r.topMerchants.slice(0, 5).map((m) => ({ merchant: m.merchant, spent: formatINR(m.spentPaise) })),
      };
    },
  },
  {
    spec: {
      name: "get_budget_status",
      description: "Budget vs actual per category for a month, including whether the period is closed.",
      inputSchema: { type: "object", properties: { period: periodField } },
    },
    schema: PeriodSchema,
    async run(ctx, input) {
      const { period } = PeriodSchema.parse(input);
      const u = await getUtilization(ctx.db, ctx.userId, "monthly", monthOr(period));
      return {
        period: u.periodKey,
        closed: u.closed,
        totalBudgeted: formatINR(u.totalBudgetedPaise),
        totalSpent: formatINR(u.totalSpentPaise),
        lines: u.lines.slice(0, 12).map((l) => ({
          budgeted: formatINR(l.budgetedPaise + l.carryPaise),
          spent: formatINR(l.spentPaise),
          remaining: formatINR(l.remainingPaise),
        })),
      };
    },
  },
  {
    spec: {
      name: "get_financial_health",
      description: "Overall financial health score (0-100), grade, and its component breakdown for a month.",
      inputSchema: { type: "object", properties: { period: periodField } },
    },
    schema: PeriodSchema,
    async run(ctx, input) {
      const { period } = PeriodSchema.parse(input);
      const ins = await getInsights(ctx.db, ctx.userId, monthOr(period));
      return {
        score: ins.health.score,
        grade: ins.health.grade,
        components: ins.health.components.map((c) => ({ label: c.label, score: c.score, detail: c.detail })),
      };
    },
  },
  {
    spec: {
      name: "search_transactions",
      description: "Find transactions, categories, accounts or goals matching a text query.",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string", description: "text to search for" } },
        required: ["query"],
      },
    },
    schema: z.object({ query: z.string().min(1).max(100) }),
    async run(ctx, input) {
      const { query } = z.object({ query: z.string().min(1).max(100) }).parse(input);
      const r = await search(ctx.db, ctx.userId, query);
      return {
        transactions: r.transactions.slice(0, 8).map((t) => ({
          merchant: t.merchant,
          amount: formatINR(t.amountPaise),
          date: t.date,
        })),
        categories: r.categories.map((c) => c.name),
        accounts: r.accounts.map((a) => a.name),
        goals: r.goals.map((g) => g.name),
      };
    },
  },
  {
    spec: {
      name: "list_goals",
      description: "The user's savings goals with target and current amounts.",
      inputSchema: { type: "object", properties: {} },
    },
    schema: z.object({}),
    async run(ctx) {
      const goals = await listGoals(ctx.db, ctx.userId);
      return goals
        .filter((g) => !g.archived)
        .map((g) => ({
          name: g.name,
          type: g.type,
          target: g.targetPaise !== null ? formatINR(g.targetPaise) : "not set",
        }));
    },
  },
];

export const TOOL_SPECS: ToolSpec[] = TOOLS.map((t) => t.spec);

const BY_NAME = new Map(TOOLS.map((t) => [t.spec.name, t]));

/** Execute a tool by name with validated input. Errors are returned as a
 * string payload so the model can recover rather than the loop crashing. */
export async function runTool(ctx: ToolContext, name: string, input: unknown): Promise<string> {
  const tool = BY_NAME.get(name);
  if (!tool) return JSON.stringify({ error: `Unknown tool: ${name}` });
  try {
    const result = await tool.run(ctx, input);
    return JSON.stringify(result);
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Tool failed" });
  }
}
