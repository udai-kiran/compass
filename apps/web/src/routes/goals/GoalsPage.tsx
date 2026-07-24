import { useState, type FormEvent } from "react";
import {
  accountCanHaveGoal,
  formatINR,
  isBankAccount,
  rupeesToPaise,
  type Goal,
  type GoalProgress,
  type GoalType,
  type Sip,
  type SipFrequency,
  type SipTargetKind,
} from "@compass/shared";
import { toast } from "../../lib/toast.tsx";
import {
  useGoalMutations,
  useGoalProgress,
  useGoals,
  useSipMutations,
  useSips,
} from "../../lib/goal-queries.ts";
import { useAccounts } from "../../lib/queries.ts";
import { useAssetGoalMutation, useNetWorthByGoal, usePortfolio } from "../../lib/wealth-queries.ts";
import { SERIES } from "../../lib/viz.tsx";
import { formatGoalDeadlineDistance } from "./goal-date.ts";
import { DateField } from "../../components/DateField.tsx";

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
  const { reorder } = useGoalMutations();
  const [showForm, setShowForm] = useState(false);
  const active = goals?.filter((g) => !g.archived) ?? [];
  const archived = goals?.filter((g) => g.archived) ?? [];

  return (
    <div className="mx-auto max-w-4xl">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-800">Goals</h1>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="rounded-md bg-brand-600 px-3 py-1.5 text-sm text-white"
        >
          {showForm ? "Close" : "New goal"}
        </button>
      </div>

      {showForm && <GoalForm onDone={() => setShowForm(false)} />}

      <div className="mt-4 space-y-4">
        {active.map((g, index) => (
          <GoalCard
            key={g.id}
            goal={g}
            canMoveUp={index > 0}
            canMoveDown={index < active.length - 1}
            reorderPending={reorder.isPending}
            onMove={(offset) => {
              const reordered = [...active];
              const [moved] = reordered.splice(index, 1);
              reordered.splice(index + offset, 0, moved!);
              reorder.mutate(
                { goalIds: reordered.map(({ id }) => id) },
                { onError: () => toast("Couldn't rearrange goals") },
              );
            }}
          />
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
        <DateField value={targetDate} onChange={(iso) => setTargetDate(iso)} className="mt-1 w-full" aria-label="Target date" />
      </label>
      <div className="flex items-center gap-3 sm:col-span-2">
        <button type="submit" disabled={pending || !name} className="rounded-md bg-brand-600 px-4 py-1.5 text-white disabled:opacity-40">
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

function GoalCard({
  goal,
  canMoveUp,
  canMoveDown,
  reorderPending,
  onMove,
}: {
  goal: Goal;
  canMoveUp: boolean;
  canMoveDown: boolean;
  reorderPending: boolean;
  onMove: (offset: -1 | 1) => void;
}) {
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
              {goal.targetDate
                ? ` · by ${goal.targetDate} · ${formatGoalDeadlineDistance(goal.targetDate)}`
                : " · no target date"}
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <div className="flex flex-col" aria-label={`Rearrange ${goal.name}`}>
              <button
                type="button"
                aria-label={`Move ${goal.name} up`}
                title="Move goal up"
                disabled={!canMoveUp || reorderPending}
                className="leading-3 text-slate-400 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-25"
                onClick={() => onMove(-1)}
              >
                ▲
              </button>
              <button
                type="button"
                aria-label={`Move ${goal.name} down`}
                title="Move goal down"
                disabled={!canMoveDown || reorderPending}
                className="leading-3 text-slate-400 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-25"
                onClick={() => onMove(1)}
              >
                ▼
              </button>
            </div>
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
          <GoalFundingMeter p={p} />
        </div>
        <span className="text-sm font-medium tabular-nums text-slate-700">{p.percent}%</span>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-sm text-slate-600 sm:grid-cols-4">
        <span>Funded <b className="tabular-nums">{formatINR(p.fundedPaise)}</b></span>
        <span>Target <b className="tabular-nums">{formatINR(p.effectiveTargetPaise)}</b></span>
        <span>Return <b className="tabular-nums">{formatPct(p.blendedReturnBps)}</b>/yr</span>
        <span>Adding <b className="tabular-nums">{formatINR(p.monthlyInflowPaise)}</b>/mo</span>
      </div>

      {p.fundedPaise > 0 && (
        <div className="mt-2 flex flex-wrap gap-2 text-xs">
          <span className="rounded-full bg-emerald-50 px-2 py-1 text-emerald-700">
            Equity <b className="tabular-nums">{p.equityPct}%</b>
          </span>
          <span className="rounded-full bg-blue-50 px-2 py-1 text-blue-700">
            Debt <b className="tabular-nums">{p.debtPct}%</b>
          </span>
          {p.otherPct > 0 && (
            <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-600">
              Other <b className="tabular-nums">{p.otherPct}%</b>
            </span>
          )}
        </div>
      )}

      <ProjectionLine p={p} />
      <GoalPlanBody p={p} />
      <MappedAssets goalId={goal.id} p={p} />
      <SipsSection goalId={goal.id} />
    </>
  );
}

function assetColor(index: number): string {
  return SERIES[index] ?? `hsl(${(index * 137.508) % 360} 58% 45%)`;
}

function constituentPct(valuePaise: number, fundedPaise: number): number {
  if (valuePaise <= 0 || fundedPaise <= 0) return 0;
  return (valuePaise / fundedPaise) * 100;
}

function formatConstituentPct(pct: number): string {
  if (pct > 0 && pct < 0.1) return "<0.1%";
  return `${pct.toFixed(1)}%`;
}

/** Goal progress split into the mapped assets that make up the funded corpus. */
function GoalFundingMeter({ p }: { p: GoalProgress }) {
  const assets = p.assets.filter(hasValue);
  const positiveAssets = assets.filter((asset) => asset.valuePaise > 0);
  const positiveFundedPaise = positiveAssets.reduce(
    (sum, asset) => sum + asset.valuePaise,
    0,
  );
  const barTotalPaise = Math.max(p.effectiveTargetPaise, positiveFundedPaise);
  const fundedAssetCount = positiveAssets.length;

  return (
    <div
      className="flex h-2 w-full rounded-full bg-slate-200"
      role="img"
      aria-label={`${p.percent}% funded, split across ${fundedAssetCount} mapped asset${fundedAssetCount === 1 ? "" : "s"}`}
    >
      {positiveAssets.map((asset, index) => {
        const share = constituentPct(asset.valuePaise, positiveFundedPaise);
        return (
          <span
            key={`${asset.kind}:${asset.id}`}
            className="group relative h-full first:rounded-l-full last:rounded-r-full focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
            tabIndex={0}
            aria-label={`${asset.name}: ${formatINR(asset.valuePaise)}, ${formatConstituentPct(share)} of funded assets`}
            style={{
              width: `${barTotalPaise > 0 ? (asset.valuePaise / barTotalPaise) * 100 : 0}%`,
              backgroundColor: assetColor(index),
            }}
          >
            <span
              role="tooltip"
              className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 hidden w-max max-w-56 -translate-x-1/2 rounded-md bg-slate-900 px-2 py-1.5 text-xs font-normal text-white shadow-lg group-hover:block group-focus:block"
            >
              <b>{asset.name}</b>
              <br />
              {formatINR(asset.valuePaise)} · {formatConstituentPct(share)} of funded
            </span>
          </span>
        );
      })}
    </div>
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

/**
 * The prescriptive plan: recommended equity/debt mix (horizon glide-path) and,
 * when the goal is behind pace, the monthly investment to catch up — split to
 * that mix. The weekly Autopilot goal review sends the same proposal by notification.
 */
function GoalPlanBody({ p }: { p: GoalProgress }) {
  const { plan } = p;
  const propose = plan.recommendedMonthlyPaise !== null && plan.recommendedMonthlyPaise > 0;

  return (
    <div className="mt-3 rounded-md border border-slate-200 bg-slate-50/60 px-3 py-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-slate-500">Recommended mix</span>
        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700">
          Equity <b className="tabular-nums">{plan.targetEquityPct}%</b>
        </span>
        <span className="rounded-full bg-blue-50 px-2 py-0.5 text-blue-700">
          Debt <b className="tabular-nums">{plan.targetDebtPct}%</b>
        </span>
        {plan.allocationDrifted && (
          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-700">
            ⚠ drifted — consider rebalancing
          </span>
        )}
      </div>
      {propose && (
        <>
          <p className="mt-1.5 text-slate-600">
            To stay on track, invest{" "}
            <b className="tabular-nums text-slate-800">{formatINR(plan.recommendedMonthlyPaise!)}</b>/mo —{" "}
            <b className="tabular-nums text-emerald-700">{formatINR(plan.monthlyEquityPaise)}</b> equity +{" "}
            <b className="tabular-nums text-blue-700">{formatINR(plan.monthlyDebtPaise)}</b> debt.
          </p>
          <div className="mt-1.5 grid grid-cols-3 gap-2 text-[11px] text-slate-500">
            <span>
              Required
              <b className="block tabular-nums text-slate-700">{formatINR(plan.recommendedMonthlyPaise!)}</b>
            </span>
            <span>
              Committed
              <b className="block tabular-nums text-slate-700">{formatINR(plan.committedMonthlyPaise)}</b>
            </span>
            <span>
              Gap
              <b className={`block tabular-nums ${plan.gapMonthlyPaise > 0 ? "text-amber-700" : "text-green-700"}`}>
                {formatINR(plan.gapMonthlyPaise)}
              </b>
            </span>
          </div>
        </>
      )}
    </div>
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
  const positiveFundedPaise = assets.reduce(
    (sum, asset) => sum + Math.max(0, asset.valuePaise),
    0,
  );
  // The Unassigned group is the assignable one with no goal — not the (also
  // goalId-null) Liabilities group, whose rows can't be mapped to a goal.
  const unassigned = (
    byGoal?.groups.find((g) => g.goalId === null && g.assignable)?.items ?? []
  ).filter(hasValue);

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
          {assets.map((a, index) => (
            <li key={`${a.kind}:${a.id}`} className="flex items-center gap-3 px-3 py-1.5">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-sm"
                style={{ backgroundColor: assetColor(index) }}
                aria-hidden
              />
              <span className="truncate text-slate-700">{a.name}</span>
              <span className="truncate text-xs text-slate-400">{a.subtitle}</span>
              <span className="ml-auto tabular-nums text-slate-700">{formatINR(a.valuePaise)}</span>
              <span
                className="w-14 text-right text-xs font-medium tabular-nums text-slate-600"
                title="Share of funded assets"
              >
                {formatConstituentPct(constituentPct(a.valuePaise, positiveFundedPaise))}
              </span>
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

const SIP_FREQUENCY_LABEL: Record<SipFrequency, string> = { monthly: "mo", quarterly: "qtr", yearly: "yr" };
const SIP_FREQUENCY_OPTIONS: Array<{ value: SipFrequency; label: string }> = [
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "yearly", label: "Yearly" },
];

/** SIPs funding this goal — a source account debiting monthly into an MF folio or another account (e.g. PPF/SSY). */
function SipsSection({ goalId }: { goalId: string }) {
  const { data: sipList } = useSips(goalId);
  const { data: accountList } = useAccounts();
  const { data: portfolio } = usePortfolio();
  const { update, remove } = useSipMutations();
  const [showForm, setShowForm] = useState(false);

  const accountName = (id: string) => accountList?.find((a) => a.id === id)?.name ?? "Account";
  const targetLabel = (sip: Sip) => {
    if (sip.targetKind === "mf_folio") {
      const h = portfolio?.positions.find((p) => p.id === sip.targetHoldingId);
      return h ? `${h.name}${h.folioNumber ? ` (Folio ${h.folioNumber})` : ""}` : "MF folio";
    }
    return accountName(sip.targetAccountId!);
  };

  const sips = sipList ?? [];

  return (
    <div className="mt-3 rounded-md border border-slate-200">
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-3 py-1.5">
        <span className="text-xs font-medium text-slate-500">SIPs ({sips.length})</span>
        <button
          className="text-xs text-brand-600 underline"
          onClick={() => setShowForm((v) => !v)}
        >
          {showForm ? "Close" : "+ Add SIP"}
        </button>
      </div>

      {showForm && (
        <div className="border-b border-slate-100 p-3">
          <SipForm goalId={goalId} onDone={() => setShowForm(false)} />
        </div>
      )}

      {sips.length === 0 ? (
        <p className="px-3 py-3 text-center text-xs text-slate-400">
          No SIPs yet — add one to fund this goal automatically each month.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100 text-sm">
          {sips.map((sip) => (
            <li key={sip.id} className="flex flex-wrap items-center gap-2 px-3 py-1.5">
              <span className="truncate text-slate-700">{accountName(sip.sourceAccountId)}</span>
              <span className="text-slate-400">→</span>
              <span className="truncate text-slate-700">{targetLabel(sip)}</span>
              <span className="ml-auto tabular-nums text-slate-700">
                {formatINR(sip.amountPaise)}/{SIP_FREQUENCY_LABEL[sip.frequency]}
              </span>
              <span className="text-xs text-slate-400">day {sip.dayOfMonth}</span>
              {sip.status === "paused" && (
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">paused</span>
              )}
              <button
                className="text-xs text-slate-500 underline"
                disabled={update.isPending}
                onClick={() =>
                  update.mutate({ id: sip.id, status: sip.status === "active" ? "paused" : "active" })
                }
              >
                {sip.status === "active" ? "Pause" : "Resume"}
              </button>
              <button
                className="text-slate-400 hover:text-red-600"
                title="Delete"
                disabled={remove.isPending}
                onClick={() => {
                  if (confirm("Delete this SIP?")) remove.mutate(sip.id);
                }}
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

/** Add-SIP form: a bank source account, a polymorphic target (MF folio or account), amount, and debit day. */
function SipForm({ goalId, onDone }: { goalId: string; onDone: () => void }) {
  const { data: accountList } = useAccounts();
  const { data: portfolio } = usePortfolio();
  const { create } = useSipMutations();

  const bankAccounts = (accountList ?? []).filter((a) => isBankAccount(a.type) && a.archivedAt === null);

  const [sourceAccountId, setSourceAccountId] = useState("");
  const [targetKind, setTargetKind] = useState<SipTargetKind>("mf_folio");
  const [targetHoldingId, setTargetHoldingId] = useState("");
  const [targetAccountId, setTargetAccountId] = useState("");
  const [amountR, setAmountR] = useState("");
  const [dayOfMonth, setDayOfMonth] = useState("5");
  const [frequency, setFrequency] = useState<SipFrequency>("monthly");

  // MF-folio target candidates: this goal's own folios, plus unmapped ones —
  // a folio mapped to a *different* goal can't be picked (it would double-count
  // toward two goals' funding). Unmapped folios get linked to this goal on create.
  const folios = (portfolio?.positions ?? []).filter(
    (p) => !p.archived && (p.goalId === null || p.goalId === goalId),
  );

  // Account-target candidates: investment-scheme accounts (PPF/EPF/SSY/investment)
  // — bank/cash accounts are excluded because the cash-flow forecast already
  // aggregates every bank/cash balance, so crediting one as a SIP target would
  // fabricate a cash loss — mapped to this goal or unmapped, excluding the source.
  const targetAccounts = (accountList ?? []).filter(
    (a) =>
      a.archivedAt === null &&
      accountCanHaveGoal(a.type) &&
      (a.goalId === null || a.goalId === goalId) &&
      a.id !== sourceAccountId,
  );

  const canSubmit =
    sourceAccountId !== "" &&
    amountR !== "" &&
    (targetKind === "mf_folio" ? targetHoldingId !== "" : targetAccountId !== "");

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    create.mutate(
      {
        goalId,
        sourceAccountId,
        targetKind,
        targetHoldingId: targetKind === "mf_folio" ? targetHoldingId : null,
        targetAccountId: targetKind === "account" ? targetAccountId : null,
        amountPaise: rupeesToPaise(parseFloat(amountR)),
        dayOfMonth: parseInt(dayOfMonth, 10),
        frequency,
      },
      {
        onSuccess: () => {
          toast("SIP added", "success");
          onDone();
        },
        onError: () => toast("Couldn't add the SIP"),
      },
    );
  }

  return (
    <form onSubmit={submit} className="grid gap-2 text-xs sm:grid-cols-2">
      <label className="block">
        <span className="text-slate-600">Source account</span>
        <select
          value={sourceAccountId}
          onChange={(e) => setSourceAccountId(e.target.value)}
          required
          className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5"
        >
          <option value="">Select…</option>
          {bankAccounts.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="text-slate-600">Target</span>
        <select
          value={targetKind}
          onChange={(e) => setTargetKind(e.target.value as SipTargetKind)}
          className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5"
        >
          <option value="mf_folio">MF folio</option>
          <option value="account">Account (PPF/SSY…)</option>
        </select>
      </label>
      {targetKind === "mf_folio" ? (
        <label className="block sm:col-span-2">
          <span className="text-slate-600">MF folio</span>
          <select
            value={targetHoldingId}
            onChange={(e) => setTargetHoldingId(e.target.value)}
            required
            className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5"
          >
            <option value="">Select…</option>
            {folios.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}{f.folioNumber ? ` (Folio ${f.folioNumber})` : ""}
                {f.goalId === null ? " (will link to this goal)" : ""}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <label className="block sm:col-span-2">
          <span className="text-slate-600">Target account</span>
          <select
            value={targetAccountId}
            onChange={(e) => setTargetAccountId(e.target.value)}
            required
            className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5"
          >
            <option value="">Select…</option>
            {targetAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}{a.goalId === null ? " (will link to this goal)" : ""}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="block">
        <span className="text-slate-600">Amount (₹/{SIP_FREQUENCY_LABEL[frequency]})</span>
        <input
          value={amountR}
          onChange={(e) => setAmountR(e.target.value)}
          inputMode="decimal"
          required
          className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-right"
        />
      </label>
      <label className="block">
        <span className="text-slate-600">Frequency</span>
        <select
          value={frequency}
          onChange={(e) => setFrequency(e.target.value as SipFrequency)}
          className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5"
        >
          {SIP_FREQUENCY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="text-slate-600">Day of month</span>
        <input
          type="number"
          min={1}
          max={28}
          value={dayOfMonth}
          onChange={(e) => setDayOfMonth(e.target.value)}
          className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-right"
        />
      </label>
      <div className="flex items-center gap-3 sm:col-span-2">
        <button
          type="submit"
          disabled={create.isPending || !canSubmit}
          className="rounded-md bg-brand-600 px-4 py-1.5 text-white disabled:opacity-40"
        >
          {create.isPending ? "Adding…" : "Add SIP"}
        </button>
        <button type="button" className="text-slate-500 underline" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
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
