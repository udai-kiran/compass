import { useState, type FormEvent } from "react";
import { type Household, type HouseholdMember } from "@compass/shared";
import { SharingControl } from "../../components/SharingControl.tsx";
import {
  useHouseholdMembers,
  useHouseholdMutations,
  useHouseholds,
} from "../../lib/household-queries.ts";
import { useAccounts } from "../../lib/queries.ts";
import { BalancesPanel } from "./BalancesPanel.tsx";

function MemberList({
  household,
  onRemove,
}: {
  household: Household;
  onRemove: (householdId: string, memberId: string) => void;
}) {
  const { data: members } = useHouseholdMembers(household.id);

  if (!members) return <p className="text-sm text-slate-500">Loading members…</p>;

  return (
    <ul className="mt-2 divide-y divide-slate-100">
      {members.map((m: HouseholdMember) => (
        <li key={m.id} className="flex items-center justify-between py-1.5">
          <span className="text-sm text-slate-700">
            {m.displayName}{" "}
            <span className="text-xs text-slate-400">({m.role})</span>
          </span>
          {m.role !== "owner" && (
            <button
              onClick={() => {
                if (window.confirm(`Remove ${m.displayName} from ${household.name}?`)) {
                  onRemove(household.id, m.id);
                }
              }}
              className="text-xs text-red-600 hover:text-red-800"
            >
              Remove
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

function HouseholdCard({
  household,
  onLeave,
  onRemoveMember,
}: {
  household: Household;
  onLeave: (id: string) => void;
  onRemoveMember: (householdId: string, memberId: string) => void;
}) {
  const { invite } = useHouseholdMutations();
  const [inviteToken, setInviteToken] = useState<string | null>(null);

  function handleInvite() {
    invite.mutate(household.id, {
      onSuccess: (data) => setInviteToken(data.token),
    });
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-slate-800">{household.name}</h2>
        <button
          onClick={() => {
            if (window.confirm(`Leave "${household.name}"? You cannot undo this.`)) {
              onLeave(household.id);
            }
          }}
          className="text-xs text-red-600 hover:text-red-800"
        >
          Leave
        </button>
      </div>

      <MemberList household={household} onRemove={onRemoveMember} />

      <BalancesPanel household={household} />

      <div className="mt-3 flex flex-col gap-2">
        <button
          onClick={handleInvite}
          disabled={invite.isPending}
          className="w-full rounded-md bg-brand-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
        >
          Generate Invite Token
        </button>

        {inviteToken && (
          <div className="flex items-center gap-2">
            <input
              readOnly
              value={inviteToken}
              className="flex-1 rounded border border-slate-300 bg-slate-50 px-2 py-1 text-xs font-mono text-slate-700"
              onFocus={(e) => e.target.select()}
            />
            <button
              onClick={() => void navigator.clipboard.writeText(inviteToken)}
              className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
            >
              Copy
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function CreateHouseholdForm({ onDone }: { onDone: () => void }) {
  const { create } = useHouseholdMutations();
  const [name, setName] = useState("");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    create.mutate({ name: name.trim() }, { onSuccess: () => { setName(""); onDone(); } });
  }

  return (
    <form onSubmit={handleSubmit} className="mt-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="mb-3 font-semibold text-slate-800">New Household</h2>
      <div className="flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Household name"
          className="flex-1 rounded border border-slate-300 px-2 py-1.5 text-sm"
          required
        />
        <button
          type="submit"
          disabled={create.isPending}
          className="rounded-md bg-brand-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
        >
          Create
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function AcceptInviteForm() {
  const { acceptInvite } = useHouseholdMutations();
  const [token, setToken] = useState("");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!token.trim()) return;
    acceptInvite.mutate({ token: token.trim() }, { onSuccess: () => setToken("") });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
    >
      <h2 className="mb-3 font-semibold text-slate-800">Accept an Invite</h2>
      <div className="flex gap-2">
        <input
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="Paste invite token"
          className="flex-1 rounded border border-slate-300 px-2 py-1.5 text-sm font-mono"
          required
        />
        <button
          type="submit"
          disabled={acceptInvite.isPending}
          className="rounded-md bg-brand-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
        >
          Join
        </button>
      </div>
    </form>
  );
}

function SharingDemoPanel() {
  const { data: accounts } = useAccounts();
  const firstAccount = accounts?.[0];

  if (!firstAccount) return null;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="mb-3 font-semibold text-slate-800">Sharing Demo</h2>
      <p className="mb-2 text-xs text-slate-500">
        Account: <span className="font-medium text-slate-700">{firstAccount.name}</span>
      </p>
      <SharingControl resourceType="account" resourceId={firstAccount.id} />
    </div>
  );
}

export function HouseholdPage() {
  const { data: households, isLoading, isError } = useHouseholds();
  const { leave, removeMember } = useHouseholdMutations();
  const [showForm, setShowForm] = useState(false);

  if (isLoading) {
    return (
      <div className="mx-auto max-w-2xl">
        <p className="text-sm text-slate-500">Loading…</p>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="mx-auto max-w-2xl">
        <p className="text-sm text-red-600">Failed to load households.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-800">Household</h1>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="rounded-md bg-brand-600 px-3 py-1.5 text-sm text-white"
        >
          {showForm ? "Cancel" : "Create Household"}
        </button>
      </div>

      {showForm && <CreateHouseholdForm onDone={() => setShowForm(false)} />}

      {households && households.length === 0 && !showForm && (
        <p className="text-sm text-slate-500">
          You&apos;re not in any household yet. Create one or accept an invite below.
        </p>
      )}

      <div className="space-y-4">
        {(households ?? []).map((h: Household) => (
          <HouseholdCard
            key={h.id}
            household={h}
            onLeave={(id) => leave.mutate(id)}
            onRemoveMember={(hid, mid) => removeMember.mutate({ householdId: hid, memberId: mid })}
          />
        ))}
      </div>

      <AcceptInviteForm />

      <SharingDemoPanel />
    </div>
  );
}
