import { useMemo, useState } from "react";
import { formatINR, type UtilizationLine } from "@compass/shared";
import { toast } from "../../lib/toast.tsx";
import { useCategories } from "../../lib/queries.ts";
import {
  useBudgetComparison,
  useBudgetMutations,
  useBudgetSuggestions,
  useBudgetUtilization,
} from "../../lib/budget-queries.ts";
import { Meter, compactINR } from "../../lib/viz.tsx";

function currentMonthKey(): string {
  return new Date().toISOString().slice(0, 7);
}

function shiftMonth(key: string, delta: number): string {
  const [y, m] = key.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function BudgetsPage() {
  const [key, setKey] = useState(currentMonthKey());
  const [tab, setTab] = useState<"budget" | "comparison">("budget");
  const { data: util } = useBudgetUtilization("monthly", key);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-800">Budgets</h1>
        <div className="flex items-center gap-2 text-sm">
          <button onClick={() => setKey(shiftMonth(key, -1))} className="rounded border border-slate-300 px-2 py-1">←</button>
          <span className="w-20 text-center font-medium text-slate-700">{key}</span>
          <button onClick={() => setKey(shiftMonth(key, 1))} disabled={key >= currentMonthKey()} className="rounded border border-slate-300 px-2 py-1 disabled:opacity-30">→</button>
        </div>
      </div>

      <div className="mb-3 flex gap-2 border-b border-slate-200">
        {(["budget", "comparison"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-sm capitalize ${tab === t ? "border-b-2 border-brand-600 font-medium text-brand-700" : "text-slate-500"}`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "comparison" ? (
        <ComparisonView periodKey={key} />
      ) : !util ? (
        <p className="p-8 text-center text-sm text-slate-400">Loading…</p>
      ) : util.budgetId === null && !util.closed ? (
        <Wizard periodKey={key} />
      ) : (
        <UtilizationView periodKey={key} lines={util.lines} closed={util.closed} totals={{ budgeted: util.totalBudgetedPaise, spent: util.totalSpentPaise }} />
      )}
    </div>
  );
}

/** Setup wizard: trailing 3-month averages pre-filled — a full budget in under a minute. */
function Wizard({ periodKey }: { periodKey: string }) {
  const { data: categories } = useCategories();
  const { data: suggestions } = useBudgetSuggestions(true);
  const { saveAll, copyPrevious } = useBudgetMutations("monthly", periodKey);
  const [amounts, setAmounts] = useState<Record<string, string>>({});

  const expenseCats = useMemo(
    () => categories?.filter((c) => !c.archivedAt && c.kind === "expense" && !c.parentId) ?? [],
    [categories],
  );
  const suggested = new Map(suggestions?.map((s) => [s.categoryId, s.avgMonthlyPaise]));

  const value = (catId: string) =>
    amounts[catId] ?? (suggested.has(catId) ? String((suggested.get(catId) ?? 0) / 100) : "");

  function save() {
    const lines = expenseCats
      .map((c) => ({ categoryId: c.id, amountPaise: Math.round(parseFloat(value(c.id) || "0") * 100), rollover: false }))
      .filter((l) => l.amountPaise > 0);
    if (lines.length === 0) {
      toast("Enter at least one amount");
      return;
    }
    saveAll.mutate(lines, { onSuccess: () => toast("Budget created", "success") });
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-slate-700">Set up your {periodKey} budget</h2>
        <button
          className="text-xs text-slate-500 underline"
          onClick={() =>
            copyPrevious.mutate(undefined, {
              onSuccess: () => toast("Copied from last month", "success"),
            })
          }
        >
          Copy last month
        </button>
      </div>
      <p className="mt-1 text-xs text-slate-400">
        Amounts are pre-filled from your trailing 3-month averages — adjust and save.
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {expenseCats.map((c) => (
          <label key={c.id} className="flex items-center gap-2 text-sm">
            <span className="min-w-0 flex-1 truncate text-slate-600">{c.name}</span>
            <span className="text-slate-400">₹</span>
            <input
              value={value(c.id)}
              onChange={(e) => setAmounts({ ...amounts, [c.id]: e.target.value })}
              inputMode="decimal"
              placeholder="0"
              className="w-24 rounded-md border border-slate-300 px-2 py-1 text-right"
            />
          </label>
        ))}
      </div>
      <button
        onClick={save}
        disabled={saveAll.isPending}
        className="mt-4 rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        Create budget
      </button>
    </div>
  );
}

function UtilizationView({
  periodKey,
  lines,
  closed,
  totals,
}: {
  periodKey: string;
  lines: UtilizationLine[];
  closed: boolean;
  totals: { budgeted: number; spent: number };
}) {
  const { data: categories } = useCategories();
  const { saveLine, removeLine } = useBudgetMutations("monthly", periodKey);
  const [adding, setAdding] = useState(false);
  const [newCat, setNewCat] = useState("");
  const [newAmt, setNewAmt] = useState("");
  const catName = (id: string) => categories?.find((c) => c.id === id)?.name ?? "…";
  const unbudgeted = categories?.filter(
    (c) => !c.archivedAt && c.kind === "expense" && !lines.some((l) => l.categoryId === c.id),
  );

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-baseline justify-between">
        <p className="text-sm text-slate-600">
          <span className="font-semibold">{formatINR(totals.spent)}</span> spent of{" "}
          <span className="font-semibold">{formatINR(totals.budgeted)}</span>
        </p>
        {closed && <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-500">closed period</span>}
      </div>
      <ul className="mt-4 space-y-3">
        {lines.map((l) => {
          const avail = l.budgetedPaise + l.carryPaise;
          const pct = avail > 0 ? (l.spentPaise / avail) * 100 : l.spentPaise > 0 ? 101 : 0;
          return (
            <li key={l.categoryId}>
              <div className="mb-1 flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0 flex-1 truncate text-slate-700">
                  {catName(l.categoryId)}
                  {l.carryPaise !== 0 && (
                    <span className="ml-1.5 text-xs text-slate-400" title="rolled over from last period">
                      ({l.carryPaise > 0 ? "+" : ""}{compactINR(l.carryPaise)} carried)
                    </span>
                  )}
                </span>
                <span className="tabular-nums text-xs text-slate-500">
                  {compactINR(l.spentPaise)} / {compactINR(avail)}
                </span>
                {!closed && (
                  <>
                    <input
                      key={`${l.categoryId}-${l.budgetedPaise}`}
                      defaultValue={(l.budgetedPaise / 100).toFixed(0)}
                      inputMode="decimal"
                      onBlur={(e) => {
                        const v = Math.round(parseFloat(e.target.value || "0") * 100);
                        if (!Number.isNaN(v) && v !== l.budgetedPaise && v > 0) {
                          saveLine.mutate({ categoryId: l.categoryId, amountPaise: v, rollover: l.rollover });
                        }
                      }}
                      className="w-20 rounded border border-slate-200 px-1.5 py-0.5 text-right text-xs"
                    />
                    <label className="flex items-center gap-1 text-xs text-slate-400" title="carry unspent into next month">
                      <input
                        type="checkbox"
                        checked={l.rollover}
                        onChange={(e) =>
                          saveLine.mutate({ categoryId: l.categoryId, amountPaise: l.budgetedPaise, rollover: e.target.checked })
                        }
                      />
                      roll
                    </label>
                    <button className="text-slate-300 hover:text-red-600" onClick={() => removeLine.mutate(l.categoryId)}>✕</button>
                  </>
                )}
              </div>
              <Meter pct={pct} />
            </li>
          );
        })}
      </ul>
      {!closed &&
        (adding ? (
          <form
            className="mt-4 flex items-center gap-2 text-sm"
            onSubmit={(e) => {
              e.preventDefault();
              const v = Math.round(parseFloat(newAmt || "0") * 100);
              if (!newCat || v <= 0) return;
              saveLine.mutate(
                { categoryId: newCat, amountPaise: v, rollover: false },
                { onSuccess: () => { setAdding(false); setNewCat(""); setNewAmt(""); } },
              );
            }}
          >
            <select value={newCat} onChange={(e) => setNewCat(e.target.value)} className="rounded-md border border-slate-300 px-2 py-1">
              <option value="">Category…</option>
              {unbudgeted?.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <input value={newAmt} onChange={(e) => setNewAmt(e.target.value)} placeholder="₹" inputMode="decimal" className="w-24 rounded-md border border-slate-300 px-2 py-1 text-right" />
            <button type="submit" className="rounded-md bg-brand-600 px-3 py-1 text-white">Add</button>
            <button type="button" className="text-slate-400 underline" onClick={() => setAdding(false)}>cancel</button>
          </form>
        ) : (
          <button className="mt-4 text-sm text-slate-500 underline" onClick={() => setAdding(true)}>
            + Add category
          </button>
        ))}
    </div>
  );
}

/** This month vs last vs trailing 3-month average. */
function ComparisonView({ periodKey }: { periodKey: string }) {
  const { data } = useBudgetComparison(periodKey);
  const { data: categories } = useCategories();
  const catName = (id: string) => categories?.find((c) => c.id === id)?.name ?? "…";
  if (!data) return <p className="p-8 text-center text-sm text-slate-400">Loading…</p>;

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
            <th className="px-4 py-2">category</th>
            <th className="px-2 py-2 text-right">budgeted</th>
            <th className="px-2 py-2 text-right">this month</th>
            <th className="px-2 py-2 text-right">last month</th>
            <th className="px-2 py-2 text-right">3-mo avg</th>
            <th className="px-4 py-2 text-right">Δ vs last</th>
          </tr>
        </thead>
        <tbody>
          {data.lines.map((l) => {
            const delta = l.spentPaise - l.lastSpentPaise;
            return (
              <tr key={l.categoryId} className="border-b border-slate-50">
                <td className="px-4 py-1.5 text-slate-700">{catName(l.categoryId)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-slate-500">
                  {l.budgetedPaise === null ? "—" : compactINR(l.budgetedPaise)}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums text-slate-800">{compactINR(l.spentPaise)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-slate-500">{compactINR(l.lastSpentPaise)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-slate-500">{compactINR(l.avg3moPaise)}</td>
                <td className={`px-4 py-1.5 text-right tabular-nums ${delta > 0 ? "text-red-600" : "text-emerald-700"}`}>
                  {delta > 0 ? "+" : ""}{compactINR(delta)}
                </td>
              </tr>
            );
          })}
          {data.lines.length === 0 && (
            <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">No spending in this window.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
