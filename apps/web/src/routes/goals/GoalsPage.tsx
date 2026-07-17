import { useState, type FormEvent } from "react";
import { formatINR, type Goal, type GoalProgress, type GoalType } from "@compass/shared";
import { toast } from "../../lib/toast.tsx";
import { useGoalMutations, useGoalProgress, useGoals } from "../../lib/goal-queries.ts";
import { useAssetGoalMutation, useNetWorthByGoal } from "../../lib/wealth-queries.ts";
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

function typeLabel(type: GoalType): string {
  return GOAL_TYPES.find((t) => t.value === type)?.label ?? type;
}

/** basis points → percent string, e.g. 1075 → "10.75%". */
function formatPct(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

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

/** Create or edit a goal. In edit mode (`goal` set) every field is editable. */
function GoalForm({ goal, onDone }: { goal?: Goal; onDone: () => void }) {
  const { create, update } = useGoalMutations();
  const editing = goal !== undefined;
  const [name, setName] = useState(goal?.name ?? "");
  const [type, setType] = useState<GoalType>(goal?.type ?? "savings");
  const [targetR, setTargetR] = useState(goal?.targetPaise != null ? String(goal.targetPaise / 100) : "");
  const [months, setMonths] = useState(goal?.targetMonths != null ? String(goal.targetMonths) : "6");
  const [targetDate, setTargetDate] = useState(goal?.targetDate ?? "");
  const isEfund = type === "emergency_fund";
  const pending = create.isPending || update.isPending;

  function submit(e: FormEvent) {
    e.preventDefault();
    const body = {
      name,
      type,
      targetPaise: targetR ? Math.round(parseFloat(targetR) * 100) : null,
      targetMonths: isEfund && !targetR ? parseInt(months, 10) : null,
      targetDate: targetDate || null,
    };
    if (editing) {
      update.mutate(
        { id: goal.id, ...body },
        {
          onSuccess: () => {
            toast("Goal updated", "success");
            onDone();
          },
          onError: () => toast("Couldn't update the goal"),
        },
      );
    } else {
      create.mutate(body, {
        onSuccess: () => {
          toast("Goal created", "success");
          onDone();
        },
        onError: () => toast("Couldn't create the goal"),
      });
    }
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
      <div className="flex items-center gap-3 sm:col-span-2">
        <button type="submit" disabled={pending || !name} className="rounded-md bg-slate-800 px-4 py-1.5 text-white disabled:opacity-40">
          {editing ? (pending ? "Saving…" : "Save changes") : "Create goal"}
        </button>
        {editing && (
          <button type="button" className="text-slate-500 underline" onClick={onDone}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

function GoalCard({ goal }: { goal: Goal }) {
  const { data: p } = useGoalProgress(goal.id);
  const { update, remove } = useGoalMutations();
  const [editing, setEditing] = useState(false);

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      {editing ? (
        <GoalForm goal={goal} onDone={() => setEditing(false)} />
      ) : (
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold text-slate-800">{goal.name}</h2>
            <p className="text-xs text-slate-400">
              {typeLabel(goal.type)}
              {goal.targetDate ? ` · by ${goal.targetDate}` : " · no target date"}
            </p>
          </div>
          <div className="flex gap-2 text-xs">
            <button className="text-slate-500 underline" onClick={() => setEditing(true)}>
              Edit
            </button>
            <button className="text-slate-500 underline" onClick={() => update.mutate({ id: goal.id, archived: true })}>
              Archive
            </button>
            <button
              className="text-slate-400 hover:text-red-600"
              onClick={() => {
                if (confirm(`Delete goal “${goal.name}”?`)) remove.mutate(goal.id);
              }}
            >
              Delete
            </button>
          </div>
        </div>
      )}

      {p ? <GoalProgressBody goal={goal} p={p} /> : <p className="mt-3 text-sm text-slate-400">Loading progress…</p>}
    </div>
  );
}

function GoalProgressBody({ goal, p }: { goal: Goal; p: GoalProgress }) {
  return (
    <>
      <div className="mt-3 flex items-center gap-3">
        <div className="flex-1">
          <Meter pct={p.percent} />
        </div>
        <span className="text-sm font-medium tabular-nums text-slate-700">{p.percent}%</span>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-sm text-slate-600 sm:grid-cols-4">
        <span>Funded <b className="tabular-nums">{formatINR(p.fundedPaise)}</b></span>
        <span>Target <b className="tabular-nums">{formatINR(p.effectiveTargetPaise)}</b></span>
        <span>Return <b className="tabular-nums">{formatPct(p.blendedReturnBps)}</b>/yr</span>
        <span>Adding <b className="tabular-nums">{formatINR(p.monthlyInflowPaise)}</b>/mo</span>
      </div>

      <ProjectionLine p={p} />
      <MappedAssets goalId={goal.id} p={p} />
    </>
  );
}

/** The "how far behind" summary — growth-aware, so it reflects real projected value. */
function ProjectionLine({ p }: { p: GoalProgress }) {
  if (p.projectedValuePaise !== null && p.onTrack !== null) {
    // Has a target date: compare projected value at that date against the target.
    return (
      <p className="mt-2 text-sm">
        <span className="text-slate-600">
          Projected by target date <b className="tabular-nums text-slate-800">{formatINR(p.projectedValuePaise)}</b>
        </span>{" "}
        {p.onTrack ? (
          <span className="font-medium text-green-700">✓ on track</span>
        ) : (
          <span className="font-medium text-amber-700">
            ⚠ behind by {formatINR(p.shortfallPaise ?? 0)}
          </span>
        )}
        {p.requiredMonthlyPaise !== null && p.requiredMonthlyPaise > 0 && (
          <span className="text-slate-500">
            {" "}· needs <b className="tabular-nums">{formatINR(p.requiredMonthlyPaise)}</b>/mo
          </span>
        )}
      </p>
    );
  }
  // No target date: show the pace-based finish estimate instead.
  return (
    <p className="mt-2 text-sm text-slate-600">
      {p.remainingPaise === 0 ? (
        <span className="font-medium text-green-700">✓ target reached</span>
      ) : p.projectedDate ? (
        <span>On pace to finish ~ <b className="text-slate-800">{p.projectedDate}</b></span>
      ) : (
        <span className="text-slate-400">Map assets or add inflow to project a finish date.</span>
      )}
    </p>
  );
}

// A zero-value holding is usually a fully redeemed MF folio. Hide those (keep
// zero-balance accounts, which can still be useful containers) — same rule the
// net-worth by-goal breakdown uses.
function hasValue(a: { kind: string; valuePaise: number }): boolean {
  return a.kind !== "holding" || a.valuePaise !== 0;
}

/** Assets mapped to this goal, plus a picker to map an unassigned one. */
function MappedAssets({ goalId, p }: { goalId: string; p: GoalProgress }) {
  const { data: byGoal } = useNetWorthByGoal();
  const map = useAssetGoalMutation();
  const [pick, setPick] = useState("");

  const assets = p.assets.filter(hasValue);
  const unassigned = (byGoal?.groups.find((g) => g.goalId === null)?.items ?? []).filter(hasValue);

  function addMapping(value: string) {
    // value = "kind:id"
    const [kind, id] = value.split(":") as ["account" | "holding", string];
    if (!id) return;
    map.mutate({ kind, id, goalId }, { onSuccess: () => setPick("") });
  }

  return (
    <div className="mt-3 rounded-md border border-slate-200">
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-3 py-1.5">
        <span className="text-xs font-medium text-slate-500">Mapped assets ({assets.length})</span>
        {unassigned.length > 0 && (
          <select
            value={pick}
            onChange={(e) => addMapping(e.target.value)}
            disabled={map.isPending}
            className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600"
          >
            <option value="">+ Map an asset…</option>
            {unassigned.map((it) => (
              <option key={`${it.kind}:${it.id}`} value={`${it.kind}:${it.id}`}>
                {it.name} ({formatINR(it.valuePaise)})
              </option>
            ))}
          </select>
        )}
      </div>
      {assets.length === 0 ? (
        <p className="px-3 py-3 text-center text-xs text-slate-400">
          No assets mapped yet — map an account or folio to fund this goal.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100 text-sm">
          {assets.map((a) => (
            <li key={`${a.kind}:${a.id}`} className="flex items-center gap-3 px-3 py-1.5">
              <span className="truncate text-slate-700">{a.name}</span>
              <span className="truncate text-xs text-slate-400">{a.subtitle}</span>
              <span className="ml-auto tabular-nums text-slate-700">{formatINR(a.valuePaise)}</span>
              <span className="w-16 text-right text-xs text-slate-400">{formatPct(a.annualReturnBps)}</span>
              <button
                className="text-slate-400 hover:text-red-600"
                title="Unmap"
                disabled={map.isPending}
                onClick={() => map.mutate({ kind: a.kind, id: a.id, goalId: null })}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
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
