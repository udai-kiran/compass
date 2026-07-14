import { useState, type FormEvent } from "react";
import { formatINR, type CardSummary } from "@compass/shared";
import { Meter } from "../../lib/viz.tsx";
import { toast } from "../../lib/toast.tsx";
import {
  useCardDetailsMutation,
  useCards,
  useRewardMutations,
  useRewards,
} from "../../lib/card-queries.ts";

export function CardsPage() {
  const { data: cards, isLoading } = useCards();

  return (
    <div className="mx-auto max-w-4xl">
      <header className="mb-4">
        <h1 className="text-xl font-semibold text-slate-800">Credit Cards</h1>
        <p className="mt-0.5 text-sm text-slate-500">
          Statement periods, amounts due, and utilization for your credit-card accounts.
        </p>
      </header>

      {isLoading && <p className="text-sm text-slate-400">Loading…</p>}

      {cards && cards.length === 0 && (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
          No credit-card accounts yet. Add one from{" "}
          <a href="/settings" className="text-slate-800 underline">
            Settings → Accounts
          </a>{" "}
          (type “Credit card”), then configure its cycle here.
        </div>
      )}

      <div className="space-y-4">
        {cards?.map((c) => <CardRow key={c.accountId} card={c} />)}
      </div>
    </div>
  );
}

function CardRow({ card }: { card: CardSummary }) {
  const [editing, setEditing] = useState(card.details === null);
  const [showRewards, setShowRewards] = useState(false);
  const owed = Math.max(0, -card.balancePaise);

  return (
    <section className="rounded-lg border border-slate-200 bg-white">
      <div className="flex items-start justify-between gap-4 border-b border-slate-100 p-4">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold text-slate-800">{card.name}</h2>
          <p className="mt-0.5 text-sm text-slate-500">
            {owed > 0 ? `${formatINR(owed)} owed` : "Nothing owed"}
            {card.details && card.details.creditLimitPaise > 0 && (
              <> · limit {formatINR(card.details.creditLimitPaise)}</>
            )}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            onClick={() => setShowRewards((v) => !v)}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
          >
            {card.rewardPoints.toLocaleString("en-IN")} pts
          </button>
          <button
            onClick={() => setEditing((v) => !v)}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
          >
            {editing ? "Close" : card.details ? "Edit cycle" : "Set up"}
          </button>
        </div>
      </div>

      {card.details && (
        <div className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-4">
          <Stat label="Amount due" value={formatINR(card.amountDuePaise)} />
          <Stat label="Due date" value={card.dueDate ?? "—"} />
          <Stat
            label="Statement"
            value={
              card.statementStart && card.statementEnd
                ? `${card.statementStart.slice(5)} → ${card.statementEnd.slice(5)}`
                : "—"
            }
          />
          <Stat label="Spend this cycle" value={formatINR(card.currentSpendPaise)} />
          {card.utilizationPct !== null && (
            <div className="col-span-2 sm:col-span-4">
              <div className="mb-1 flex justify-between text-xs text-slate-500">
                <span>Utilization</span>
                <span
                  className={
                    card.details.utilizationAlertPct !== null &&
                    card.utilizationPct >= card.details.utilizationAlertPct
                      ? "font-medium text-red-600"
                      : "text-slate-600"
                  }
                >
                  {card.utilizationPct}%
                  {card.details.utilizationAlertPct !== null &&
                    ` (alert at ${card.details.utilizationAlertPct}%)`}
                </span>
              </div>
              <Meter pct={card.utilizationPct} />
            </div>
          )}
        </div>
      )}

      {editing && <DetailsForm card={card} onDone={() => setEditing(false)} />}
      {showRewards && <RewardsPanel accountId={card.accountId} earnRate={card.details?.earnRatePer100 ?? 0} />}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-0.5 text-sm font-medium text-slate-800">{value}</p>
    </div>
  );
}

function DetailsForm({ card, onDone }: { card: CardSummary; onDone: () => void }) {
  const d = card.details;
  const mutation = useCardDetailsMutation();
  const [cycleDay, setCycleDay] = useState(String(d?.cycleDay ?? 1));
  const [dueDay, setDueDay] = useState(String(d?.dueDay ?? 15));
  const [limit, setLimit] = useState(d ? String(d.creditLimitPaise / 100) : "");
  const [alertPct, setAlertPct] = useState(d?.utilizationAlertPct === null ? "" : String(d?.utilizationAlertPct ?? 30));
  const [remindDays, setRemindDays] = useState(String(d?.remindDays ?? 3));
  const [earnRate, setEarnRate] = useState(String(d?.earnRatePer100 ?? 0));

  function submit(e: FormEvent) {
    e.preventDefault();
    mutation.mutate(
      {
        accountId: card.accountId,
        cycleDay: parseInt(cycleDay, 10),
        dueDay: parseInt(dueDay, 10),
        creditLimitPaise: Math.round((parseFloat(limit) || 0) * 100),
        utilizationAlertPct: alertPct === "" ? null : parseInt(alertPct, 10),
        remindDays: parseInt(remindDays, 10),
        earnRatePer100: parseInt(earnRate, 10) || 0,
      },
      {
        onSuccess: () => {
          toast("Card cycle saved", "success");
          onDone();
        },
      },
    );
  }

  return (
    <form onSubmit={submit} className="grid grid-cols-2 gap-3 border-t border-slate-100 bg-slate-50 p-4 sm:grid-cols-3">
      <Field label="Statement close day (1–28)">
        <input type="number" min={1} max={28} value={cycleDay} onChange={(e) => setCycleDay(e.target.value)} className="input" />
      </Field>
      <Field label="Payment due day (1–28)">
        <input type="number" min={1} max={28} value={dueDay} onChange={(e) => setDueDay(e.target.value)} className="input" />
      </Field>
      <Field label="Credit limit (₹)">
        <input inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} className="input" placeholder="e.g. 200000" />
      </Field>
      <Field label="Utilization alert (%) — blank to disable">
        <input type="number" min={1} max={100} value={alertPct} onChange={(e) => setAlertPct(e.target.value)} className="input" />
      </Field>
      <Field label="Remind days before due">
        <input type="number" min={0} max={30} value={remindDays} onChange={(e) => setRemindDays(e.target.value)} className="input" />
      </Field>
      <Field label="Reward pts per ₹100">
        <input type="number" min={0} value={earnRate} onChange={(e) => setEarnRate(e.target.value)} className="input" />
      </Field>
      <div className="col-span-2 flex gap-2 sm:col-span-3">
        <button type="submit" disabled={mutation.isPending} className="rounded-md bg-slate-800 px-4 py-1.5 text-sm text-white disabled:opacity-40">
          {mutation.isPending ? "Saving…" : "Save cycle"}
        </button>
        <button type="button" onClick={onDone} className="rounded-md border border-slate-300 px-4 py-1.5 text-sm text-slate-600">
          Cancel
        </button>
      </div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-slate-500">
      {label}
      {children}
    </label>
  );
}

function RewardsPanel({ accountId, earnRate }: { accountId: string; earnRate: number }) {
  const { data: rewards } = useRewards(accountId);
  const { add, remove } = useRewardMutations(accountId);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [points, setPoints] = useState("");
  const [note, setNote] = useState("");

  function submit(e: FormEvent) {
    e.preventDefault();
    const p = parseInt(points, 10);
    if (!p) return;
    add.mutate(
      { date, points: p, note },
      {
        onSuccess: () => {
          setPoints("");
          setNote("");
          toast("Reward entry added", "success");
        },
      },
    );
  }

  return (
    <div className="border-t border-slate-100 bg-slate-50 p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700">Reward points</h3>
        {earnRate > 0 && <span className="text-xs text-slate-400">Earning {earnRate} pt / ₹100</span>}
      </div>
      <form onSubmit={submit} className="mb-3 flex flex-wrap items-end gap-2 text-sm">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input" />
        <input
          type="number"
          value={points}
          onChange={(e) => setPoints(e.target.value)}
          placeholder="± points"
          className="input w-28"
          title="positive = earned, negative = redeemed/expired"
        />
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="note" className="input w-40" />
        <button type="submit" disabled={add.isPending} className="rounded-md bg-slate-800 px-3 py-1.5 text-white disabled:opacity-40">
          Add
        </button>
      </form>
      <ul className="divide-y divide-slate-100 rounded-md border border-slate-200 bg-white">
        {rewards?.map((r) => (
          <li key={r.id} className="flex items-center gap-3 px-3 py-1.5 text-sm">
            <span className="w-24 text-slate-500">{r.date}</span>
            <span className={`w-20 font-medium ${r.points < 0 ? "text-red-600" : "text-emerald-600"}`}>
              {r.points > 0 ? "+" : ""}
              {r.points.toLocaleString("en-IN")}
            </span>
            <span className="min-w-0 flex-1 truncate text-slate-600">{r.note}</span>
            <button className="text-slate-400 hover:text-red-600" onClick={() => remove.mutate(r.id)}>
              ✕
            </button>
          </li>
        ))}
        {rewards?.length === 0 && (
          <li className="px-3 py-4 text-center text-xs text-slate-400">No reward entries yet.</li>
        )}
      </ul>
    </div>
  );
}
