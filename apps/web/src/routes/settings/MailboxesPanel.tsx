import { useState } from "react";
import { SYNC_WINDOW_MINUTES, type MailboxAccount, type MailboxStatus } from "@compass/shared";
import { toast } from "../../lib/toast.tsx";
import {
  useMailboxCredentials,
  useMailboxes,
  useMailboxMutations,
} from "../../lib/mailbox-queries.ts";

const STATUS_STYLE: Record<MailboxStatus, string> = {
  active: "bg-emerald-100 text-emerald-700",
  disconnected: "bg-slate-100 text-slate-500",
  error: "bg-red-100 text-red-700",
};

function fmtWhen(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString() : "never";
}

/**
 * Per-user mailbox onboarding. Credentials never live in the deploy env: each
 * user creates their own Google OAuth client, captures a refresh token locally
 * with the `connect` CLI, and pastes the printed bundle here. The client secret
 * and refresh token are encrypted server-side and never sent back.
 */
export function MailboxesPanel() {
  const { data: mailboxes } = useMailboxes();
  const { data: creds } = useMailboxCredentials();
  const { add, remove, sync } = useMailboxMutations();
  const [bundle, setBundle] = useState("");
  const [windowMinutes, setWindowMinutes] = useState<number>(SYNC_WINDOW_MINUTES[0]);

  function queueSync() {
    sync.mutate(windowMinutes, {
      onSuccess: (res) => toast(`Sync queued — runs within ${res.runsInMinutes} min`, "success"),
      onError: (e) => toast(e instanceof Error ? e.message : "Couldn't queue a sync"),
    });
  }

  function submit() {
    const value = bundle.trim();
    if (!value) return;
    add.mutate(value, {
      onSuccess: (mb) => {
        setBundle("");
        toast(`Connected ${mb.emailAddress}`, "success");
      },
      onError: (e) => toast(e instanceof Error ? e.message : "Couldn't add the mailbox"),
    });
  }

  return (
    <div className="mt-4 max-w-3xl">
      <ol className="mb-4 space-y-1 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
        <li>
          1. Create your own Google OAuth client (see the README) with redirect URI{" "}
          <code className="rounded bg-slate-200 px-1 text-xs">http://127.0.0.1:53682</code>.
        </li>
        <li>
          2. On your own machine, run:{" "}
          <code className="block overflow-x-auto rounded bg-slate-200 px-1.5 py-1 text-xs">
            npm run connect -w apps/ingestor -- you@gmail.com --client-id … --client-secret …
          </code>
        </li>
        <li>3. Paste the bundle it prints below.</li>
      </ol>

      <div className="rounded-lg border border-slate-200 bg-white p-3">
        <label htmlFor="bundle" className="text-sm font-medium text-slate-700">
          Connect a mailbox
        </label>
        <textarea
          id="bundle"
          value={bundle}
          onChange={(e) => setBundle(e.target.value)}
          rows={3}
          placeholder="Paste the bundle from the connect CLI…"
          className="mt-1.5 w-full break-all rounded-md border border-slate-300 px-2 py-1.5 font-mono text-xs"
        />
        <div className="mt-2 flex items-center gap-3">
          <button
            onClick={submit}
            disabled={!bundle.trim() || add.isPending}
            className="rounded-md bg-brand-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
          >
            Add mailbox
          </button>
          <span className="text-xs text-slate-400">
            {creds?.configured
              ? `Client ${creds.clientId} on file`
              : "No Google client on file yet"}
          </span>
        </div>
      </div>

      {mailboxes && mailboxes.length > 0 && (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-medium text-slate-600">Connected mailboxes</h3>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1 text-xs text-slate-500">
              within
              <select
                value={windowMinutes}
                onChange={(e) => setWindowMinutes(Number(e.target.value))}
                className="rounded-md border border-slate-300 px-1.5 py-1"
              >
                {SYNC_WINDOW_MINUTES.map((m) => (
                  <option key={m} value={m}>{m} min</option>
                ))}
              </select>
            </label>
            <button
              onClick={queueSync}
              disabled={sync.isPending}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {sync.isPending ? "Queuing…" : "Queue sync"}
            </button>
          </div>
        </div>
      )}

      {mailboxes && mailboxes.length === 0 && (
        <p className="mt-6 rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-400">
          No mailboxes connected yet — follow the steps above to add your first.
        </p>
      )}

      <ul className="mt-4 divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 bg-white">
        {mailboxes?.map((mb) => (
          <MailboxRow key={mb.id} mailbox={mb} onRemove={(id) => remove.mutate(id)} />
        ))}
      </ul>
    </div>
  );
}

function MailboxRow({
  mailbox: mb,
  onRemove,
}: {
  mailbox: MailboxAccount;
  onRemove: (id: string) => void;
}) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm">
      <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${STATUS_STYLE[mb.status]}`}>
        {mb.status}
      </span>
      <span className="font-medium text-slate-800">{mb.emailAddress}</span>
      <span className="text-xs text-slate-400">{mb.folder}</span>
      <span className="ml-auto text-xs text-slate-400">last sync {fmtWhen(mb.lastSyncedAt)}</span>
      <button
        className="text-xs text-red-500 underline"
        onClick={() => {
          if (confirm(`Disconnect ${mb.emailAddress}? Its refresh token is deleted.`)) onRemove(mb.id);
        }}
      >
        Remove
      </button>
      {mb.status === "error" && mb.lastError && (
        <p className="w-full text-xs text-red-500">{mb.lastError}</p>
      )}
    </li>
  );
}
