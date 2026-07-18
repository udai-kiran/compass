import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import {
  formatINR,
  type AssetClass,
  type CreateHoldingEvent,
  type GainsTaxClass,
  type HoldingPosition,
} from "@compass/shared";
import { Donut, LineChart, SERIES, StatTile } from "../../lib/viz.tsx";
import { toast } from "../../lib/toast.tsx";
import { useGoals } from "../../lib/goal-queries.ts";
import {
  useAssetGoalMutation,
  usePortfolio,
  useHoldingMutations,
  useRefreshNav,
} from "../../lib/wealth-queries.ts";

// PPF/EPF are not here on purpose — they're account types, managed in Settings.
const ASSET_LABELS: Record<AssetClass, string> = {
  stock: "Stocks",
  mutual_fund: "Mutual funds",
  etf: "ETFs",
  gold: "Gold",
  fd: "Fixed deposit",
  nps: "NPS",
  other: "Other",
};
const ASSET_CLASSES = Object.keys(ASSET_LABELS) as AssetClass[];

export function PortfolioPage() {
  const { data: p, isLoading } = usePortfolio();
  const { data: goals } = useGoals();
  const setGoal = useAssetGoalMutation();
  const refreshNav = useRefreshNav();

  function doRefresh() {
    refreshNav.mutate(undefined, {
      onSuccess: (r) =>
        toast(
          r.refreshed === 0
            ? "No mapped funds to refresh"
            : `Refreshed ${r.refreshed} fund${r.refreshed === 1 ? "" : "s"} · NAV as of ${r.asOf}`,
          "success",
        ),
      onError: () => toast("Couldn't reach AMFI — try again in a moment"),
    });
  }

  if (isLoading) return <p className="text-sm text-slate-400">Loading…</p>;
  if (!p) return null;

  const unrealized = p.totalValuePaise - p.totalInvestedPaise;
  const allocationSlices = p.allocation.map((a) => ({
    key: a.assetClass,
    label: ASSET_LABELS[a.assetClass],
    value: a.valuePaise,
  }));
  const visiblePositions = p.positions.filter((h) => !h.archived);
  const activePositions = visiblePositions.filter((h) => h.currentValuePaise !== 0);
  const zeroValuePositions = visiblePositions.filter((h) => h.currentValuePaise === 0);
  const activeGoals = goals?.filter((g) => !g.archived) ?? [];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">Investments</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Holdings, valuations, and allocation across asset classes.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={doRefresh}
            disabled={refreshNav.isPending}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 disabled:opacity-50"
          >
            {refreshNav.isPending ? "Refreshing…" : "↻ Refresh NAVs"}
          </button>
          <Link
            to="/investments/capital-gains"
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700"
          >
            Capital gains
          </Link>
          <Link
            to="/investments/import"
            className="rounded-md bg-slate-800 px-3 py-1.5 text-sm text-white"
          >
            Import transactions
          </Link>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Portfolio value" value={formatINR(p.totalValuePaise)} />
        <StatTile label="Invested" value={formatINR(p.totalInvestedPaise)} />
        <StatTile
          label="Unrealized"
          value={formatINR(unrealized)}
          sub={<span className={unrealized >= 0 ? "text-emerald-600" : "text-red-600"}>{unrealized >= 0 ? "▲ gain" : "▼ loss"}</span>}
        />
        <StatTile label="Dividends" value={formatINR(p.totalDividendsPaise)} />
      </div>

      {(allocationSlices.length > 0 || p.growth.length > 0) && (
        <div className="grid gap-4 lg:grid-cols-2">
          {allocationSlices.length > 0 && (
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <h2 className="mb-3 text-sm font-semibold text-slate-700">Allocation</h2>
              <Donut slices={allocationSlices} />
            </div>
          )}
          {p.growth.length > 1 && (
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <h2 className="mb-3 text-sm font-semibold text-slate-700">Invested vs value</h2>
              <LineChart
                labels={p.growth.map((g) => g.month)}
                series={[
                  { name: "Value", color: SERIES[0]!, values: p.growth.map((g) => g.valuePaise) },
                  { name: "Invested", color: SERIES[1]!, values: p.growth.map((g) => g.investedPaise) },
                ]}
              />
            </div>
          )}
        </div>
      )}

      <NewHoldingForm />

      <div className="space-y-3">
        {activePositions.map((h) => (
          <HoldingRow
            key={h.id}
            h={h}
            goals={activeGoals}
            onSetGoal={(goalId) =>
              setGoal.mutate(
                { kind: "holding", id: h.id, goalId },
                { onError: () => toast("Couldn't update the goal") },
              )
            }
          />
        ))}
        {visiblePositions.length === 0 && (
          <p className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
            No holdings yet. Add one above.
          </p>
        )}

        {zeroValuePositions.length > 0 && (
          <details className="group rounded-lg border border-slate-200 bg-slate-50">
            <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium text-slate-600 marker:content-none">
              <span className="mr-2 inline-block text-xs transition-transform group-open:rotate-90">▶</span>
              Zero-value holdings ({zeroValuePositions.length})
            </summary>
            <div className="space-y-3 border-t border-slate-200 p-3">
              {zeroValuePositions.map((h) => (
                <HoldingRow
                  key={h.id}
                  h={h}
                  goals={activeGoals}
                  onSetGoal={(goalId) =>
                    setGoal.mutate(
                      { kind: "holding", id: h.id, goalId },
                      { onError: () => toast("Couldn't update the goal") },
                    )
                  }
                />
              ))}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}

function HoldingRow({
  h,
  goals,
  onSetGoal,
}: {
  h: HoldingPosition;
  goals: Array<{ id: string; name: string }>;
  onSetGoal: (goalId: string | null) => void;
}) {
  const { update, remove, setValuation, addEvent, removeEvent, moveEvent } = useHoldingMutations();
  const [open, setOpen] = useState(false);
  const unrealized = h.currentValuePaise - h.investedPaise;
  const goalName = goals.find((g) => g.id === h.goalId)?.name ?? null;

  return (
    <section className="rounded-lg border border-slate-200 bg-white">
      <div className="flex items-center justify-between gap-4 p-4">
        <button onClick={() => setOpen((v) => !v)} className="min-w-0 text-left">
          <h3 className="truncate text-base font-semibold text-slate-800">{h.name}</h3>
          <p className="mt-0.5 text-sm text-slate-500">
            {ASSET_LABELS[h.assetClass]}
            {h.folioNumber && ` · Folio ${h.folioNumber}`}
            {` · Goal: ${goalName ?? "No goal"}`}
            {` · cost basis ${formatINR(h.investedPaise)}`}
            {h.realizedPaise !== 0 && ` · realized ${formatINR(h.realizedPaise)}`}
            {h.lastValuationDate && ` · valued ${h.lastValuationDate}`}
          </p>
        </button>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-3 text-right">
          <label className="text-left text-xs text-slate-500">
            <span className="sr-only">Goal for {h.name}</span>
            <select
              value={h.goalId ?? ""}
              aria-label={`Goal for ${h.name}`}
              onChange={(e) => onSetGoal(e.target.value || null)}
              className="max-w-40 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-600"
            >
              <option value="">No goal</option>
              {goals.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </label>
          <div>
            <p className="text-sm font-semibold text-slate-800">{formatINR(h.currentValuePaise)}</p>
            <p className={`text-xs ${unrealized >= 0 ? "text-emerald-600" : "text-red-600"}`}>
              {unrealized >= 0 ? "+" : ""}
              {formatINR(unrealized)}
            </p>
          </div>
          <button onClick={() => setOpen((v) => !v)} className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-500">
            {open ? "Close" : "Manage"}
          </button>
        </div>
      </div>

      {open && (
        <div className="space-y-4 border-t border-slate-100 bg-slate-50 p-4">
          <ValuationForm onSubmit={(body) => setValuation.mutate({ id: h.id, ...body })} />
          <EventForm onSubmit={(body) => addEvent.mutate({ id: h.id, ...body })} />
          <TaxTreatmentForm
            taxClass={h.gainsTaxClass}
            grandfatherNavPaise={h.grandfatherNavPaise}
            onSubmit={(body) =>
              update.mutate(
                { id: h.id, ...body },
                {
                  onSuccess: () => toast("Tax treatment saved", "success"),
                  onError: () => toast("Couldn't save tax treatment"),
                },
              )
            }
          />
          {h.events.length > 0 && (
            <ul className="divide-y divide-slate-100 rounded-md border border-slate-200 bg-white text-sm">
              {h.events.map((e, i, arr) => {
                // Events come date-desc then FIFO order (seq asc), so same-day rows
                // are contiguous: a same-date neighbour above/below can be swapped.
                const canUp = i > 0 && arr[i - 1]!.date === e.date;
                const canDown = i < arr.length - 1 && arr[i + 1]!.date === e.date;
                return (
                  <li key={e.id} className="flex items-center gap-3 px-3 py-1.5">
                    <span className="w-24 text-slate-500">{e.date}</span>
                    <span className="w-16 capitalize text-slate-600">{e.type}</span>
                    <span className="w-24 font-medium text-slate-800">{formatINR(e.amountPaise)}</span>
                    <span className="min-w-0 flex-1 truncate text-slate-500">{e.note}</span>
                    {(canUp || canDown) && (
                      <span
                        className="flex items-center gap-0.5"
                        title="Reorder within this day — sets FIFO tax-lot order"
                      >
                        <button
                          disabled={!canUp}
                          aria-label="Move earlier in the day"
                          onClick={() => moveEvent.mutate({ id: h.id, eventId: e.id, direction: "up" })}
                          className="px-1 text-slate-400 hover:text-slate-700 disabled:opacity-30"
                        >
                          ▲
                        </button>
                        <button
                          disabled={!canDown}
                          aria-label="Move later in the day"
                          onClick={() => moveEvent.mutate({ id: h.id, eventId: e.id, direction: "down" })}
                          className="px-1 text-slate-400 hover:text-slate-700 disabled:opacity-30"
                        >
                          ▼
                        </button>
                      </span>
                    )}
                    <button className="text-slate-400 hover:text-red-600" onClick={() => removeEvent.mutate({ id: h.id, eventId: e.id })}>✕</button>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="flex gap-2">
            <button onClick={() => update.mutate({ id: h.id, archived: true })} className="rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-600">
              Archive
            </button>
            <button
              onClick={() => { if (confirm(`Delete “${h.name}” and all its events?`)) remove.mutate(h.id); }}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-500 hover:text-red-600"
            >
              Delete
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function ValuationForm({ onSubmit }: { onSubmit: (b: { date: string; valuePaise: number }) => void }) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [value, setValue] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const v = Math.round((parseFloat(value) || 0) * 100);
        if (v < 0) return;
        onSubmit({ date, valuePaise: v });
        setValue("");
        toast("Valuation updated", "success");
      }}
      className="flex flex-wrap items-end gap-2 text-sm"
    >
      <span className="text-xs font-medium text-slate-600">Update value:</span>
      <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input" />
      <input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder="current ₹" className="input w-32" />
      <button type="submit" className="rounded-md bg-slate-800 px-3 py-1.5 text-white">Save</button>
    </form>
  );
}

function EventForm({ onSubmit }: { onSubmit: (b: CreateHoldingEvent) => void }) {
  const [type, setType] = useState<"buy" | "sell" | "dividend">("buy");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const a = Math.round((parseFloat(amount) || 0) * 100);
        if (a <= 0) return;
        onSubmit({ type, date, amountPaise: a, units: null, note });
        setAmount("");
        setNote("");
        toast("Event added", "success");
      }}
      className="flex flex-wrap items-end gap-2 text-sm"
    >
      <span className="text-xs font-medium text-slate-600">Add event:</span>
      <select value={type} onChange={(e) => setType(e.target.value as typeof type)} className="input">
        <option value="buy">Buy</option>
        <option value="sell">Sell</option>
        <option value="dividend">Dividend</option>
      </select>
      <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input" />
      <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="₹ amount" className="input w-28" />
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="note" className="input w-36" />
      <button type="submit" className="rounded-md bg-slate-800 px-3 py-1.5 text-white">Add</button>
    </form>
  );
}

const TAX_CLASS_LABELS: Record<GainsTaxClass, string> = {
  equity: "Equity (12-month LTCG, grandfathered)",
  unlisted_shares: "Unlisted shares (24-month LTCG)",
  other: "Other asset (24m now / 36m pre-Jul-2024)",
  specified_fund: "Specified mutual fund §50AA (post-Apr-2023 units short-term)",
  market_linked_debenture: "Market-linked debenture §50AA (always short-term)",
  unlisted_bond: "Unlisted bond/debenture §50AA (short-term if sold from Jul-2024)",
};

/**
 * Sets the holding's capital-gains tax treatment: the class drives the
 * short/long boundary, and — only for equity — an optional 31-Jan-2018 NAV/unit
 * grandfathers pre-2018 lots.
 */
function TaxTreatmentForm({
  taxClass,
  grandfatherNavPaise,
  onSubmit,
}: {
  taxClass: GainsTaxClass;
  grandfatherNavPaise: number | null;
  onSubmit: (body: { gainsTaxClass: GainsTaxClass; grandfatherNavPaise: number | null }) => void;
}) {
  const [cls, setCls] = useState<GainsTaxClass>(taxClass);
  const [nav, setNav] = useState(grandfatherNavPaise === null ? "" : String(grandfatherNavPaise / 100));
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const trimmed = nav.trim();
        // Only equity carries a grandfather NAV; blank clears it. A non-blank
        // value must be a complete, finite, positive number — reject "abc"/"12abc"
        // rather than let parseFloat coerce them to null (a silent wipe) or ₹12.
        let grandfatherNavPaise: number | null = null;
        if (cls === "equity" && trimmed !== "") {
          const n = Number(trimmed);
          if (!Number.isFinite(n) || n <= 0) {
            toast("Enter a valid NAV (a positive number), or leave it blank");
            return;
          }
          grandfatherNavPaise = Math.round(n * 100);
        }
        onSubmit({ gainsTaxClass: cls, grandfatherNavPaise });
      }}
      className="flex flex-wrap items-end gap-2 text-sm"
    >
      <span className="text-xs font-medium text-slate-600">Tax treatment:</span>
      <select value={cls} onChange={(e) => setCls(e.target.value as GainsTaxClass)} className="input">
        {(Object.keys(TAX_CLASS_LABELS) as GainsTaxClass[]).map((c) => (
          <option key={c} value={c}>
            {TAX_CLASS_LABELS[c]}
          </option>
        ))}
      </select>
      {cls === "equity" && (
        <input
          type="number"
          min="0"
          step="0.0001"
          value={nav}
          onChange={(e) => setNav(e.target.value)}
          placeholder="31-Jan-2018 NAV/unit ₹"
          title="Grandfathers the cost of equity units bought before 01-Feb-2018."
          className="input w-40"
        />
      )}
      <button type="submit" className="rounded-md bg-slate-800 px-3 py-1.5 text-white">
        Save
      </button>
    </form>
  );
}

function NewHoldingForm() {
  const { create } = useHoldingMutations();
  const [name, setName] = useState("");
  const [assetClass, setAssetClass] = useState<AssetClass>("stock");
  const [targetPct, setTargetPct] = useState("");

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!name) return;
    create.mutate(
      { name, assetClass, notes: "", targetPct: targetPct ? parseInt(targetPct, 10) : null },
      { onSuccess: () => { setName(""); setTargetPct(""); toast("Holding added", "success"); } },
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-white p-4 text-sm">
      <label className="flex flex-col gap-1 text-xs text-slate-500">
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Nifty 50 Index Fund" className="input w-56" />
      </label>
      <label className="flex flex-col gap-1 text-xs text-slate-500">
        Asset class
        <select value={assetClass} onChange={(e) => setAssetClass(e.target.value as AssetClass)} className="input">
          {ASSET_CLASSES.map((c) => <option key={c} value={c}>{ASSET_LABELS[c]}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-slate-500">
        Target %
        <input type="number" min={0} max={100} value={targetPct} onChange={(e) => setTargetPct(e.target.value)} className="input w-20" />
      </label>
      <button type="submit" disabled={create.isPending || !name} className="rounded-md bg-slate-800 px-4 py-1.5 text-white disabled:opacity-40">
        Add holding
      </button>
    </form>
  );
}
