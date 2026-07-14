import { useState } from "react";
import { formatINR, type NotificationType } from "@compass/shared";
import { toast } from "../../lib/toast.tsx";
import { useMe } from "../../lib/auth.ts";
import {
  useCapabilities,
  useNotificationPrefs,
  usePrefMutation,
  useProfileMutations,
  useSessionRevoke,
  useSessions,
} from "../../lib/settings-queries.ts";

export function ProfilePanel() {
  const { data: me } = useMe();
  const { updateProfile, changePassword } = useProfileMutations();
  const [name, setName] = useState("");
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");

  return (
    <div className="mt-4 max-w-lg space-y-6">
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-700">Profile</h2>
        <p className="mt-1 text-xs text-slate-400">Signed in as {me?.email}</p>
        <div className="mt-3 flex items-end gap-2">
          <label className="flex flex-1 flex-col gap-1 text-xs text-slate-500">
            Display name
            <input value={name || me?.displayName || ""} onChange={(e) => setName(e.target.value)} className="input" />
          </label>
          <button
            onClick={() => updateProfile.mutate(name || me?.displayName || "", { onSuccess: () => toast("Profile updated", "success") })}
            className="rounded-md bg-slate-800 px-4 py-1.5 text-sm text-white"
          >
            Save
          </button>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-700">Change password</h2>
        <div className="mt-3 space-y-2">
          <input type="password" value={cur} onChange={(e) => setCur(e.target.value)} placeholder="Current password" className="input w-full" />
          <input type="password" value={next} onChange={(e) => setNext(e.target.value)} placeholder="New password (min 8)" className="input w-full" />
          <button
            disabled={!cur || next.length < 8 || changePassword.isPending}
            onClick={() =>
              changePassword.mutate(
                { currentPassword: cur, newPassword: next },
                { onSuccess: () => { setCur(""); setNext(""); toast("Password changed", "success"); } },
              )
            }
            className="rounded-md bg-slate-800 px-4 py-1.5 text-sm text-white disabled:opacity-40"
          >
            Update password
          </button>
        </div>
      </section>
    </div>
  );
}

const PREF_TYPES: Array<{ type: NotificationType; label: string; hasThreshold: boolean }> = [
  { type: "budget", label: "Budget overspend alerts", hasThreshold: false },
  { type: "bill", label: "Bill & subscription reminders", hasThreshold: false },
  { type: "goal", label: "Goal milestones", hasThreshold: false },
  { type: "large_transaction", label: "Large transactions", hasThreshold: true },
  { type: "low_balance", label: "Low account balance", hasThreshold: true },
  { type: "anomaly", label: "Unusual spending", hasThreshold: false },
];

export function NotificationsPanel() {
  const { data: prefs } = useNotificationPrefs();
  const upsert = usePrefMutation();
  const prefFor = (type: NotificationType) => prefs?.find((p) => p.type === type && p.accountId === null);

  return (
    <div className="mt-4 max-w-2xl space-y-2">
      {PREF_TYPES.map(({ type, label, hasThreshold }) => {
        const pref = prefFor(type);
        const enabled = pref?.enabled ?? true;
        return (
          <div key={type} className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white p-3 text-sm">
            <label className="flex flex-1 items-center gap-2">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) =>
                  upsert.mutate({
                    type,
                    accountId: null,
                    enabled: e.target.checked,
                    thresholdPaise: pref?.thresholdPaise ?? null,
                    leadDays: pref?.leadDays ?? null,
                  })
                }
              />
              <span className="text-slate-700">{label}</span>
            </label>
            {hasThreshold && (
              <div className="flex items-center gap-1 text-xs text-slate-500">
                threshold ₹
                <input
                  type="number"
                  defaultValue={pref?.thresholdPaise ? pref.thresholdPaise / 100 : ""}
                  onBlur={(e) =>
                    upsert.mutate({
                      type,
                      accountId: null,
                      enabled,
                      thresholdPaise: e.target.value ? Math.round(parseFloat(e.target.value) * 100) : null,
                      leadDays: pref?.leadDays ?? null,
                    })
                  }
                  className="input w-24"
                />
              </div>
            )}
            {type === "anomaly" && (
              <select
                value={pref?.leadDays === 1 ? "low" : pref?.leadDays === 3 ? "high" : "normal"}
                onChange={(e) =>
                  upsert.mutate({
                    type,
                    accountId: null,
                    enabled,
                    thresholdPaise: null,
                    leadDays: e.target.value === "low" ? 1 : e.target.value === "high" ? 3 : 2,
                  })
                }
                className="input text-xs"
              >
                <option value="low">Low sensitivity</option>
                <option value="normal">Normal</option>
                <option value="high">High sensitivity</option>
              </select>
            )}
          </div>
        );
      })}
      <p className="text-xs text-slate-400">Thresholds shown in rupees; changes save on blur.</p>
    </div>
  );
}

export function SessionsPanel() {
  const { data: sessions } = useSessions();
  const revoke = useSessionRevoke();
  return (
    <div className="mt-4 max-w-lg">
      <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
        {sessions?.map((s) => (
          <li key={s.id} className="flex items-center gap-3 px-4 py-3 text-sm">
            <div className="flex-1">
              <p className="text-slate-700">
                Session {s.id.slice(0, 8)}… {s.current && <span className="ml-1 rounded bg-emerald-100 px-1.5 text-xs text-emerald-700">this device</span>}
              </p>
              <p className="text-xs text-slate-400">Started {new Date(s.createdAt).toLocaleString()}</p>
            </div>
            {!s.current && (
              <button onClick={() => revoke.mutate(s.id, { onSuccess: () => toast("Session revoked", "success") })} className="text-xs text-red-500 underline">
                Revoke
              </button>
            )}
          </li>
        ))}
        {sessions?.length === 0 && <li className="px-4 py-6 text-center text-sm text-slate-400">No active sessions.</li>}
      </ul>
    </div>
  );
}

export function DataPanel() {
  return (
    <div className="mt-4 max-w-lg space-y-4">
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-700">Export your data</h2>
        <p className="mt-1 text-xs text-slate-400">Download a portable copy of everything you've recorded.</p>
        <div className="mt-3 flex gap-2">
          <a href="/api/export.json" className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">Export all (JSON)</a>
          <a href="/api/export/transactions.csv" className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">Transactions (CSV)</a>
        </div>
      </section>
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-700">Backups</h2>
        <p className="mt-1 text-xs text-slate-400">
          Encrypted backups run weekly to the server's backup directory. See BACKUP_RESTORE.md for the restore procedure.
        </p>
      </section>
    </div>
  );
}

export function AboutPanel() {
  const { data: cap } = useCapabilities();
  return (
    <div className="mt-4 max-w-lg space-y-4">
      <section className="rounded-lg border border-slate-200 bg-white p-4 text-sm">
        <h2 className="text-sm font-semibold text-slate-700">Locale &amp; currency</h2>
        <p className="mt-1 text-slate-600">Currency: {cap?.currency ?? "INR"} · Locale: {cap?.locale ?? "en-IN"}</p>
        <p className="mt-1 text-xs text-slate-400">Single-currency in v1; amounts like {formatINR(123456)} format to this locale.</p>
      </section>
      <section className="rounded-lg border border-slate-200 bg-white p-4 text-sm">
        <h2 className="text-sm font-semibold text-slate-700">AI provider</h2>
        <p className="mt-1 text-slate-600">
          Status: <span className="font-medium">{cap?.aiProvider ?? "none"}</span>
          {cap?.aiEnabled ? " (enabled)" : " (disabled)"}
        </p>
        <p className="mt-1 text-xs text-slate-400">
          Configured via the AI_PROVIDER env var. The app is fully functional with AI off.
        </p>
      </section>
    </div>
  );
}
