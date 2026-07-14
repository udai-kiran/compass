import { useState, type FormEvent } from "react";
import { formatINR, type Goal, type GoalType } from "@compass/shared";
import { toast } from "../../lib/toast.tsx";
import { useAccounts } from "../../lib/queries.ts";
import { useGoalMutations, useGoalProgress, useGoals } from "../../lib/goal-queries.ts";
import { Meter } from "../../lib/viz.tsx";

const GOAL_TYPES: Array<{ value: GoalType; label: string }> = [
  { value: "savings", label: "Savings" },
  { value: "emergency_fund", label: "Emergency fund" },
  { value: "vacation", label: "Vacation" },
  { value: "home", label: "Home" },
  { value: "vehicle", label: "Vehicle" },
  { value: "education", label: "Education" },
  { value: "retirement", label: "Retirement" },
  { value: "custom", label: "Custom" },
];

export function GoalsPage() {
  const { data: goals } = useGoals();
  const [showForm, setShowForm] = useState(false);
  const active = goals?.filter((g) => !g.archived) ?? [];
  const archived = goals?.filter((g) => g.archived) ?? [];

  return (
    <div className="mx-auto max-w-4xl">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-800">Goals</h1>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="rounded-md bg-slate-800 px-3 py-1.5 text-sm text-white"
        >
          {showForm ? "Close" : "New goal"}
        </button>
      </div>

      {showForm && <GoalForm onDone={() => setShowForm(false)} />}

      <div className="mt-4 space-y-4">
        {active.map((g) => (
          <GoalCard key={g.id} goal={g} />
        ))}
        {active.length === 0 && !showForm && (
          <p className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">
            No goals yet — create one to start tracking progress.
          </p>
        )}
      </div>

      {archived.length > 0 && (
        <details className="mt-6">
          <summary className="cursor-pointer text-sm text-slate-500">
            Archived ({archived.length})
          </summary>
          <div className="mt-2 space-y-2">
            {archived.map((g) => (
              <ArchivedRow key={g.id} goal={g} />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function GoalForm({ onDone }: { onDone: () => void }) {
  const { data: accounts } = useAccounts();
  const { create } = useGoalMutations();
  const [name, setName] = useState("");
  const [type, setType] = useState<GoalType>("savings");
  const [targetR, setTargetR] = useState("");
  const [months, setMonths] = useState("6");
  const [targetDate, setTargetDate] = useState("");
  const [accountId, setAccountId] = useState("");
  const isEfund = type === "emergency_fund";

  function submit(e: FormEvent) {
    e.preventDefault();
    create.mutate(
      {
        name,
        type,
        targetPaise: targetR ? Math.round(parseFloat(targetR) * 100) : null,
        targetMonths: isEfund && !targetR ? parseInt(months, 10) : null,
        targetDate: targetDate || null,
        accountId: accountId || null,
      },
      {
        onSuccess: () => {
          toast("Goal created", "success");
          onDone();
        },
      },
    );
  }

  return (
    <form onSubmit={submit} className="mt-4 grid gap-3 rounded-lg border border-slate-200 bg-white p-4 text-sm sm:grid-cols-2">
      <label className="block">
        <span className="text-slate-600">Name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} required className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5" />
      </label>
      <label className="block">
        <span className="text-slate-600">Type</span>
        <select value={type} onChange={(e) => setType(e.target.value as GoalType)} className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5">
          {GOAL_TYPES.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="text-slate-600">Target amount (₹){isEfund && " — optional"}</span>
        <input value={targetR} onChange={(e) => setTargetR(e.target.value)} inputMode="decimal" required={!isEfund} className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-right" />
      </label>
      {isEfund && (
        <label className="block">
          <span className="text-slate-600">Months of expenses</span>
          <input type="number" min={1} max={36} value={months} onChange={(e) => setMonths(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-right" />
        </label>
      )}
      <label className="block">
        <span className="text-slate-600">Target date (optional)</span>
        <input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5" />
      </label>
      <label className="block">
        <span className="text-slate-600">Linked account (inflows auto-count)</span>
        <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5">
          <option value="">None — manual contributions</option>
          {accounts?.filter((a) => !a.archivedAt).map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
      </label>
      <div className="sm:col-span-2">
        <button type="submit" disabled={create.isPending || !name} className="rounded-md bg-slate-800 px-4 py-1.5 text-white disabled:opacity-40">
          Create goal
        </button>
      </div>
    </form>
  );
}

function GoalCard({ goal }: { goal: Goal }) {
  const { data: p } = useGoalProgress(goal.id);
  const { update, remove, contribute, removeContribution } = useGoalMutations();
  const [amountR, setAmountR] = useState("");
  const [open, setOpen] = useState(false);

  const typeLabel = GOAL_TYPES.find((t) => t.value === goal.type)?.label ?? goal.type;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-slate-800">{goal.name}</h2>
          <p className="text-xs text-slate-400">
            {typeLabel}
            {goal.targetDate && ` · by ${goal.targetDate}`}
            {goal.accountId && " · linked account"}
          </p>
        </div>
        <div className="flex gap-2 text-xs">
          <button className="text-slate-500 underline" onClick={() => update.mutate({ id: goal.id, archived: true })}>
            Archive
          </button>
          <button
            className="text-slate-400 hover:text-red-600"
            onClick={() => {
              if (confirm(`Delete goal “${goal.name}” and its contributions?`)) remove.mutate(goal.id);
            }}
          >
            Delete
          </button>
        </div>
      </div>

      {p ? (
        <>
          <div className="mt-3 flex items-center gap-3">
            <div className="flex-1">
              <Meter pct={p.percent} />
            </div>
            <span className="text-sm font-medium tabular-nums text-slate-700">{p.percent}%</span>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-sm text-slate-600 sm:grid-cols-4">
            <span>Saved <b className="tabular-nums">{formatINR(p.savedPaise)}</b></span>
            <span>Target <b className="tabular-nums">{formatINR(p.effectiveTargetPaise)}</b></span>
            <span>
              Rate <b className="tabular-nums">{formatINR(p.monthlyRatePaise)}</b>/mo
            </span>
            {p.requiredMonthlyPaise !== null ? (
              <span>
                Needs <b className="tabular-nums">{formatINR(p.requiredMonthlyPaise)}</b>/mo{" "}
                {p.onTrack !== null && (
                  <span className={p.onTrack ? "text-green-700" : "text-amber-700"}>
                    {p.onTrack ? "✓ on track" : "⚠ behind"}
                  </span>
                )}
              </span>
            ) : p.projectedDate ? (
              <span>Done ~ <b>{p.projectedDate}</b></span>
            ) : (
              <span className="text-slate-400">No recent contributions</span>
            )}
          </div>

          <form
            className="mt-3 flex items-center gap-2 text-sm"
            onSubmit={(e) => {
              e.preventDefault();
              const paise = Math.round(parseFloat(amountR) * 100);
              if (!paise) return;
              contribute.mutate(
                { id: goal.id, amountPaise: paise, date: new Date().toISOString().slice(0, 10), note: "" },
                { onSuccess: () => setAmountR("") },
              );
            }}
          >
            <input
              placeholder="add ₹"
              value={amountR}
              onChange={(e) => setAmountR(e.target.value)}
              inputMode="decimal"
              className="w-28 rounded-md border border-slate-300 px-2 py-1 text-right"
            />
            <button type="submit" disabled={!amountR || contribute.isPending} className="rounded-md border border-slate-300 px-3 py-1 disabled:opacity-40">
              Contribute
            </button>
            <button type="button" className="ml-auto text-xs text-slate-500 underline" onClick={() => setOpen((v) => !v)}>
              {open ? "Hide" : "Show"} contributions ({p.contributions.length})
            </button>
          </form>

          {open && (
            <ul className="mt-2 divide-y divide-slate-100 rounded-md border border-slate-200 text-sm">
              {p.contributions.map((c) => (
                <li key={c.id} className="flex items-center gap-3 px-3 py-1.5">
                  <span className="text-slate-500">{c.date}</span>
                  <span className="flex-1 truncate text-slate-400">{c.note}</span>
                  <span className="tabular-nums text-slate-700">{formatINR(c.amountPaise)}</span>
                  {c.transactionId === null && (
                    <button
                      className="text-slate-400 hover:text-red-600"
                      onClick={() => removeContribution.mutate({ goalId: goal.id, id: c.id })}
                    >
                      ✕
                    </button>
                  )}
                </li>
              ))}
              {p.contributions.length === 0 && (
                <li className="px-3 py-4 text-center text-slate-400">No contributions yet.</li>
              )}
            </ul>
          )}
        </>
      ) : (
        <p className="mt-3 text-sm text-slate-400">Loading progress…</p>
      )}
    </div>
  );
}

function ArchivedRow({ goal }: { goal: Goal }) {
  const { update, remove } = useGoalMutations();
  return (
    <div className="flex items-center gap-3 rounded-md border border-slate-200 bg-white px-4 py-2 text-sm">
      <span className="flex-1 text-slate-600">{goal.name}</span>
      <button className="text-xs text-slate-500 underline" onClick={() => update.mutate({ id: goal.id, archived: false })}>
        Restore
      </button>
      <button
        className="text-xs text-slate-400 hover:text-red-600"
        onClick={() => {
          if (confirm(`Delete goal “${goal.name}”?`)) remove.mutate(goal.id);
        }}
      >
        Delete
      </button>
    </div>
  );
}
