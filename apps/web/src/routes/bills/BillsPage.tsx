import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  formatINR,
  type BillOccurrence,
  type RecurringTemplate,
  type SubscriptionSuggestion,
} from "@compass/shared";
import { toast } from "../../lib/toast.tsx";
import { useRecurring, useRecurringMutations } from "../../lib/budget-queries.ts";
import {
  useDismissSuggestion,
  useSubscriptionSuggestions,
  useUpcomingBills,
} from "../../lib/goal-queries.ts";
import { compactINR, StatTile } from "../../lib/viz.tsx";
import { useResources } from "../../lib/resource-queries.ts";

const KIND_LABEL: Record<string, string> = {
  bill: "Bill",
  subscription: "Subscription",
  insurance: "Insurance",
  emi: "EMI",
};

/** Monthly-equivalent cost of one template. */
function monthlyCost(t: RecurringTemplate): number {
  const amt = Math.abs(Math.min(0, t.amountPaise));
  switch (t.frequency) {
    case "daily":
      return (amt * 30.44) / t.interval;
    case "weekly":
      return (amt * 4.35) / t.interval;
    case "monthly":
      return amt / t.interval;
    case "yearly":
      return amt / (12 * t.interval);
  }
}

export function BillsPage() {
  const [days, setDays] = useState(60);
  const [view, setView] = useState<"list" | "calendar">("list");
  const { data: upcoming } = useUpcomingBills(view === "calendar" ? 90 : days);
  const { data: templates } = useRecurring();
  const { data: suggestions } = useSubscriptionSuggestions();
  const { data: resources } = useResources();

  const billTemplates = useMemo(
    () => templates?.filter((t) => t.kind !== "none") ?? [],
    [templates],
  );
  const monthlyTotal = billTemplates
    .filter((t) => !t.paused)
    .reduce((s, t) => s + monthlyCost(t), 0);
  const subsTotal = billTemplates
    .filter((t) => !t.paused && t.kind === "subscription")
    .reduce((s, t) => s + monthlyCost(t), 0);

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-800">Bills & Subscriptions</h1>
        <div className="flex items-center gap-2 text-sm">
          {[30, 60, 90].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`rounded-md px-2.5 py-1 ${days === d ? "bg-brand-600 text-white" : "border border-slate-300 text-slate-600"}`}
            >
              {d}d
            </button>
          ))}
          <span className="mx-1 h-5 w-px bg-slate-200" />
          {(["list", "calendar"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`rounded-md px-2.5 py-1 capitalize ${view === v ? "bg-brand-600 text-white" : "border border-slate-300 text-slate-600"}`}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile label="Recurring cost / month" value={compactINR(Math.round(monthlyTotal))} sub="all active bills, monthly equivalent" />
        <StatTile label="Subscriptions / month" value={compactINR(Math.round(subsTotal))} />
        <StatTile label="Tracked bills" value={String(billTemplates.length)} sub={<a className="underline" href="/settings">manage in Settings → recurring</a>} />
      </div>

      {suggestions && suggestions.length > 0 && <SuggestionsPanel suggestions={suggestions} />}

      {view === "calendar" && upcoming && <BillCalendar occurrences={upcoming} />}

      <section className={`rounded-lg border border-slate-200 bg-white ${view === "calendar" ? "hidden" : ""}`}>
        <h2 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-700">
          Due in the next {days} days
        </h2>
        <ul className="divide-y divide-slate-100">
          {upcoming?.map((b) => (
            <li key={`${b.templateId}-${b.dueDate}`} className="flex items-center gap-3 px-4 py-2 text-sm">
              <span className={`w-24 shrink-0 tabular-nums ${b.dueDate <= today ? "font-semibold text-red-700" : "text-slate-500"}`}>
                {b.dueDate}
              </span>
              <span className="min-w-0 flex-1 truncate text-slate-700">
                {b.merchant}
                {(() => {
                  const resourceId = templates?.find((t) => t.id === b.templateId)?.resourceId;
                  const resource = resources?.find((r) => r.id === resourceId);
                  return resource ? <span className="ml-2 text-xs text-slate-400">· {resource.name}</span> : null;
                })()}
              </span>
              <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                {KIND_LABEL[b.kind] ?? b.kind}
              </span>
              {b.paused && <span className="text-xs text-amber-700">paused</span>}
              <span className="w-28 text-right tabular-nums text-slate-800">
                {formatINR(Math.abs(b.amountPaise))}
              </span>
            </li>
          ))}
          {upcoming?.length === 0 && (
            <li className="px-4 py-8 text-center text-sm text-slate-400">
              Nothing due — mark recurring templates as bill/subscription to track them here.
            </li>
          )}
        </ul>
      </section>
    </div>
  );
}

/** Month-grid renewal calendar over the fetched horizon. */
function BillCalendar({ occurrences }: { occurrences: BillOccurrence[] }) {
  const [offset, setOffset] = useState(0);
  const now = new Date();
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
  const monthKey = first.toISOString().slice(0, 7);
  const daysInMonth = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const firstDow = first.getUTCDay();

  const byDay = new Map<number, BillOccurrence[]>();
  for (const o of occurrences) {
    if (o.dueDate.slice(0, 7) !== monthKey) continue;
    const d = Number(o.dueDate.slice(8));
    byDay.set(d, [...(byDay.get(d) ?? []), o]);
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-700">
          {first.toLocaleString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" })}
        </h2>
        <div className="flex gap-1 text-sm">
          <button onClick={() => setOffset((v) => v - 1)} disabled={offset <= 0} className="rounded border border-slate-300 px-2 py-0.5 disabled:opacity-30">←</button>
          <button onClick={() => setOffset((v) => v + 1)} disabled={offset >= 2} className="rounded border border-slate-300 px-2 py-0.5 disabled:opacity-30">→</button>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-7 gap-px overflow-hidden rounded-md bg-slate-200 text-xs">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div key={d} className="bg-slate-50 px-1 py-1 text-center font-medium text-slate-500">{d}</div>
        ))}
        {Array.from({ length: firstDow }, (_, i) => (
          <div key={`pad-${i}`} className="min-h-16 bg-white" />
        ))}
        {Array.from({ length: daysInMonth }, (_, i) => {
          const day = i + 1;
          const items = byDay.get(day) ?? [];
          return (
            <div key={day} className="min-h-16 bg-white p-1">
              <span className="text-slate-400">{day}</span>
              {items.map((o) => (
                <div
                  key={`${o.templateId}-${o.dueDate}`}
                  title={`${o.merchant} · ${formatINR(Math.abs(o.amountPaise))}`}
                  className="mt-0.5 truncate rounded bg-sky-100 px-1 py-0.5 text-[10px] text-sky-900"
                >
                  {o.merchant} {formatINR(Math.abs(o.amountPaise))}
                </div>
              ))}
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-slate-400">Showing scheduled charges up to 90 days out.</p>
    </section>
  );
}

function SuggestionsPanel({ suggestions }: { suggestions: SubscriptionSuggestion[] }) {
  const qc = useQueryClient();
  const { create } = useRecurringMutations();
  const dismiss = useDismissSuggestion();

  function convert(s: SubscriptionSuggestion) {
    create.mutate(
      {
        accountId: s.accountId,
        categoryId: s.categoryId,
        merchant: s.merchant,
        amountPaise: s.avgAmountPaise,
        frequency: s.periodicity,
        nextDueDate:
          s.nextExpectedDate >= new Date().toISOString().slice(0, 10)
            ? s.nextExpectedDate
            : new Date().toISOString().slice(0, 10),
        kind: "subscription",
      },
      {
        onSuccess: () => {
          toast(`Now tracking ${s.merchant}`, "success");
          void qc.invalidateQueries({ queryKey: ["subscription-suggestions"] });
          void qc.invalidateQueries({ queryKey: ["bills-upcoming"] });
        },
      },
    );
  }

  return (
    <section className="rounded-lg border border-sky-200 bg-sky-50 p-4">
      <h2 className="text-sm font-semibold text-sky-800">Looks like subscriptions</h2>
      <p className="mt-0.5 text-xs text-sky-700">
        Regular same-amount charges that aren't tracked yet.
      </p>
      <ul className="mt-2 space-y-2">
        {suggestions.map((s) => (
          <li key={s.merchant} className="flex flex-wrap items-center gap-3 rounded-md bg-white px-3 py-2 text-sm">
            <span className="min-w-0 flex-1 truncate font-medium text-slate-700">{s.merchant}</span>
            <span className="text-slate-500">
              {formatINR(Math.abs(s.avgAmountPaise))} · {s.periodicity} · seen {s.occurrences}×
            </span>
            <span className="text-xs text-slate-400">next ~{s.nextExpectedDate}</span>
            <button
              onClick={() => convert(s)}
              className="rounded-md bg-brand-600 px-2.5 py-1 text-xs text-white"
            >
              Track
            </button>
            <button
              onClick={() => dismiss.mutate(s.merchant)}
              className="rounded-md border border-slate-300 px-2.5 py-1 text-xs text-slate-600"
            >
              Dismiss
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
