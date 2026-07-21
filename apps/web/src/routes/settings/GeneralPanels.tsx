import { useEffect, useState } from "react";
import { formatINR, type NotificationType } from "@compass/shared";
import { toast } from "../../lib/toast.tsx";
import { useMe } from "../../lib/auth.ts";
import {
  useCapabilities,
  useNotificationPrefs,
  usePrefMutation,
  useProfileMutations,
  useProjectionSettings,
  useProjectionSettingsMutation,
  useSessionRevoke,
  useSessions,
} from "../../lib/settings-queries.ts";

export function ProjectionsPanel() {
  const { data } = useProjectionSettings();
  const update = useProjectionSettingsMutation();
  const [equityReturnPct, setEquityReturnPct] = useState("");

  useEffect(() => {
    if (data) setEquityReturnPct(String(data.equityReturnBps / 100));
  }, [data]);

  const parsedPct = Number(equityReturnPct);
  const invalid = !Number.isFinite(parsedPct) || parsedPct < 0 || parsedPct > 100;

  return (
    <div className="mt-4 max-w-lg">
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-700">Goal projection assumptions</h2>
        <p className="mt-1 text-xs text-slate-400">
          Used for stocks, equity funds, ETFs, and generic investment accounts. EPF, PPF, and SSA
          continue to use the interest rate recorded on each account.
        </p>
        <label className="mt-4 flex max-w-xs flex-col gap-1 text-xs text-slate-500">
          Expected annual equity return
          <span className="flex items-center gap-2">
            <input
              type="number"
              min="0"
              max="100"
              step="0.01"
              value={equityReturnPct}
              onChange={(e) => setEquityReturnPct(e.target.value)}
              className="input w-28 text-right"
              aria-invalid={invalid}
            />
            <span>% per year</span>
            <button
              type="button"
              disabled={invalid || update.isPending}
              onClick={() =>
                update.mutate(
                  { equityReturnBps: Math.round(parsedPct * 100) },
                  { onSuccess: () => toast("Projection assumptions updated", "success") },
                )
              }
              className="rounded-md bg-slate-800 px-4 py-1.5 text-sm text-white disabled:opacity-40"
            >
              Save
            </button>
          </span>
        </label>
        {invalid && <p className="mt-2 text-xs text-red-600">Enter a percentage from 0 to 100.</p>}
      </section>
    </div>
  );
}

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
      <BackupSection />
      <RestoreSection />
      <OrphanSection />
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-700">Server backups</h2>
        <p className="mt-1 text-xs text-slate-400">
          Separately, encrypted full-database backups run weekly to the server's backup directory.
          See BACKUP_RESTORE.md for the instance-level restore procedure.
        </p>
      </section>
    </div>
  );
}

/** Download an encrypted archive: every row plus every uploaded file. */
function BackupSection() {
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);

  async function download() {
    setBusy(true);
    try {
      const res = await fetch("/api/backup/archive", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ passphrase }),
      });
      if (!res.ok) {
        const body = (await res.json()) as { message?: string };
        throw new Error(body.message ?? "Backup failed");
      }
      const blob = await res.blob();
      const name =
        res.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] ??
        "compass-backup.cmpb";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
      toast("Backup downloaded — keep the passphrase safe, it cannot be recovered", "success");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Backup failed", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-700">Encrypted backup</h2>
      <p className="mt-1 text-xs text-slate-400">
        One file with everything — every record plus every uploaded document, statement, and card.
        Encrypted with a passphrase you choose, so it restores on any Compass instance.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <input
          type="password"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          placeholder="Passphrase (min 8 chars)"
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
          autoComplete="new-password"
        />
        <button
          onClick={() => void download()}
          disabled={busy || passphrase.length < 8}
          className="rounded-md bg-slate-800 px-4 py-1.5 text-sm text-white hover:bg-slate-700 disabled:opacity-40"
        >
          {busy ? "Preparing…" : "Download backup"}
        </button>
      </div>
    </section>
  );
}

/** Upload an archive into a fresh account (new instance / after data loss). */
function RestoreSection() {
  const [passphrase, setPassphrase] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  async function restore() {
    if (!file) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.append("passphrase", passphrase);
      form.append("file", file);
      const res = await fetch("/api/backup/restore", { method: "POST", body: form });
      const body = (await res.json()) as { message?: string; rows?: number; files?: number };
      if (!res.ok) throw new Error(body.message ?? "Restore failed");
      toast(`Restored ${body.rows} records and ${body.files} files — reloading`, "success");
      setTimeout(() => window.location.reload(), 1200);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Restore failed", "error");
      setBusy(false);
    }
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-700">Restore from backup</h2>
      <p className="mt-1 text-xs text-slate-400">
        Bring a backup into this account — it must be fresh (no accounts or transactions yet).
        Register, come here, upload, and everything comes back: records and files.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          type="file"
          accept=".cmpb"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="text-sm text-slate-600 file:mr-2 file:rounded-md file:border file:border-slate-300 file:bg-white file:px-3 file:py-1.5 file:text-sm file:text-slate-600"
        />
        <input
          type="password"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          placeholder="Backup passphrase"
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
          autoComplete="off"
        />
        <button
          onClick={() => void restore()}
          disabled={busy || !file || passphrase.length < 8}
          className="rounded-md bg-slate-800 px-4 py-1.5 text-sm text-white hover:bg-slate-700 disabled:opacity-40"
        >
          {busy ? "Restoring…" : "Restore"}
        </button>
      </div>
    </section>
  );
}

/** Report-only check for storage objects no record references. */
function OrphanSection() {
  const [result, setResult] = useState<{ totalObjects: number; orphaned: number } | null>(null);
  const [busy, setBusy] = useState(false);

  async function check() {
    setBusy(true);
    try {
      const res = await fetch("/api/backup/orphans");
      if (!res.ok) throw new Error("Check failed");
      setResult((await res.json()) as { totalObjects: number; orphaned: number });
    } catch (err) {
      toast(err instanceof Error ? err.message : "Check failed", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-700">Storage health</h2>
      <p className="mt-1 text-xs text-slate-400">
        Finds uploaded objects that no record references anymore. Report only — nothing is deleted.
      </p>
      <div className="mt-3 flex items-center gap-3">
        <button
          onClick={() => void check()}
          disabled={busy}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-40"
        >
          {busy ? "Checking…" : "Check storage"}
        </button>
        {result && (
          <span className="text-sm text-slate-600">
            {result.totalObjects} objects · {result.orphaned === 0 ? "no orphans" : `${result.orphaned} orphaned`}
          </span>
        )}
      </div>
    </section>
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
