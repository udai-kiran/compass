import { useState } from "react";
import type { NotificationType } from "@compass/shared";
import { useAccounts } from "../../lib/queries.ts";
import { useNotificationMutations, useNotifications } from "../../lib/budget-queries.ts";
import {
  useArchiveNotification,
  useNotificationPrefs,
  useUpsertPref,
} from "../../lib/goal-queries.ts";

const TYPE_LABEL: Record<string, string> = {
  "budget-alert": "Budget",
  budget: "Budget",
  bill: "Bill",
  goal: "Goal",
  goal_plan: "Goal plan",
  large_transaction: "Large transaction",
  low_balance: "Low balance",
  anomaly: "Unusual spending",
  cash_runway: "Cash flow",
};

export function NotificationsPage() {
  const { data } = useNotifications();
  const { markRead, markAllRead } = useNotificationMutations();
  const archive = useArchiveNotification();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-800">Notifications</h1>
        {data && data.unreadCount > 0 && (
          <button onClick={() => markAllRead.mutate()} className="text-sm text-slate-500 underline">
            Mark all read ({data.unreadCount})
          </button>
        )}
      </div>

      <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
        {data?.items.map((n) => (
          <li key={n.id} className={`flex items-start gap-3 px-4 py-3 ${n.readAt ? "" : "bg-sky-50/50"}`}>
            <span className="mt-0.5 rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
              {TYPE_LABEL[n.type] ?? n.type}
            </span>
            <div className="min-w-0 flex-1">
              <p className={`text-sm ${n.readAt ? "text-slate-600" : "font-medium text-slate-800"}`}>{n.title}</p>
              {n.body && <p className="mt-0.5 text-xs text-slate-500">{n.body}</p>}
              <p className="mt-0.5 text-xs text-slate-400">{new Date(n.createdAt).toLocaleString()}</p>
            </div>
            {!n.readAt && (
              <button className="text-xs text-slate-500 underline" onClick={() => markRead.mutate(n.id)}>
                Read
              </button>
            )}
            <button
              className="text-xs text-slate-400 hover:text-slate-700"
              title="Archive"
              onClick={() => archive.mutate(n.id)}
            >
              Archive
            </button>
          </li>
        ))}
        {data?.items.length === 0 && (
          <li className="px-4 py-10 text-center text-sm text-slate-400">All clear.</li>
        )}
      </ul>

      <PrefsPanel />
    </div>
  );
}

function PrefsPanel() {
  const { data: prefs } = useNotificationPrefs();
  const { data: accounts } = useAccounts();
  const upsert = useUpsertPref();

  const get = (type: NotificationType, accountId: string | null = null) =>
    prefs?.find((p) => p.type === type && p.accountId === accountId);
  const cashAccounts =
    accounts?.filter((a) => !a.archivedAt && (a.type === "bank" || a.type === "cash")) ?? [];

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-700">Preferences</h2>
      <div className="mt-3 space-y-3 text-sm">
        {(
          [
            { type: "budget" as const, label: "Budget alerts (80% / overspend)" },
            { type: "bill" as const, label: "Bill due reminders" },
            { type: "goal" as const, label: "Goal milestones" },
          ]
        ).map(({ type, label }) => {
          const p = get(type);
          const enabled = p?.enabled ?? true;
          return (
            <label key={type} className="flex items-center gap-2 text-slate-700">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => upsert.mutate({ type, enabled: e.target.checked })}
              />
              {label}
            </label>
          );
        })}

        <ThresholdRow
          type="large_transaction"
          label="Large transaction alert over"
          placeholder="e.g. 50000"
          pref={get("large_transaction")}
        />
        <ThresholdRow
          type="low_balance"
          label="Low balance alert (all accounts) under"
          placeholder="e.g. 5000"
          pref={get("low_balance")}
        />
        {cashAccounts.map((a) => (
          <ThresholdRow
            key={a.id}
            type="low_balance"
            accountId={a.id}
            label={`· ${a.name} under`}
            placeholder="account floor"
            pref={get("low_balance", a.id)}
          />
        ))}
      </div>
    </section>
  );
}

function ThresholdRow({
  type,
  label,
  placeholder,
  pref,
  accountId = null,
}: {
  type: NotificationType;
  label: string;
  placeholder: string;
  pref?: { enabled: boolean; thresholdPaise: number | null };
  accountId?: string | null;
}) {
  const upsert = useUpsertPref();
  const [value, setValue] = useState<string | null>(null);
  const shown = value ?? (pref?.thresholdPaise != null ? String(pref.thresholdPaise / 100) : "");
  const enabled = (pref?.enabled ?? true) && pref?.thresholdPaise != null;

  function save(rupees: string, on: boolean) {
    const paise = rupees ? Math.round(parseFloat(rupees) * 100) : null;
    upsert.mutate({ type, accountId, enabled: on, thresholdPaise: paise });
  }

  return (
    <div className="flex items-center gap-2 text-slate-700">
      <input
        type="checkbox"
        checked={enabled}
        onChange={(e) => save(shown, e.target.checked)}
        disabled={!shown}
      />
      <span>{label}</span>
      <span className="text-slate-400">₹</span>
      <input
        value={shown}
        placeholder={placeholder}
        inputMode="decimal"
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => value !== null && save(value, true)}
        className="w-28 rounded-md border border-slate-300 px-2 py-1 text-right"
      />
    </div>
  );
}
