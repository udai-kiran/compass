import { useState, type FormEvent } from "react";
import { formatINR, type AccountType, type Category, type CategoryKind } from "@compass/shared";
import { toast } from "../../lib/toast.tsx";
import {
  useAccountMutations,
  useAccounts,
  useCategories,
  useCategoryMutations,
} from "../../lib/queries.ts";
import { RulesPanel } from "./RulesPanel.tsx";
import { RecurringPanel } from "./RecurringPanel.tsx";
import { AboutPanel, DataPanel, NotificationsPanel, ProfilePanel, SessionsPanel } from "./GeneralPanels.tsx";

const ACCOUNT_TYPES: AccountType[] = ["bank", "cash", "credit_card", "investment", "loan"];

const TABS = [
  "profile",
  "accounts",
  "categories",
  "rules",
  "recurring",
  "notifications",
  "sessions",
  "data",
  "about",
] as const;
type Tab = (typeof TABS)[number];

export function SettingsPage() {
  const [tab, setTab] = useState<Tab>("profile");
  return (
    <div>
      <h1 className="text-2xl font-semibold text-slate-800">Settings</h1>
      <div className="mt-4 flex flex-wrap gap-2 border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-sm capitalize ${tab === t ? "border-b-2 border-slate-800 font-medium text-slate-800" : "text-slate-500"}`}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === "profile" && <ProfilePanel />}
      {tab === "accounts" && <AccountsPanel />}
      {tab === "categories" && <CategoriesPanel />}
      {tab === "rules" && <RulesPanel />}
      {tab === "recurring" && <RecurringPanel />}
      {tab === "notifications" && <NotificationsPanel />}
      {tab === "sessions" && <SessionsPanel />}
      {tab === "data" && <DataPanel />}
      {tab === "about" && <AboutPanel />}
    </div>
  );
}

function AccountsPanel() {
  const { data: accounts } = useAccounts();
  const { create, update, remove } = useAccountMutations();
  const [name, setName] = useState("");
  const [type, setType] = useState<AccountType>("bank");
  const [opening, setOpening] = useState("0");
  const [showArchived, setShowArchived] = useState(false);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!name) return;
    create.mutate(
      {
        name,
        type,
        currency: "INR",
        openingBalancePaise: Math.round(parseFloat(opening || "0") * 100),
      },
      { onSuccess: () => { setName(""); setOpening("0"); toast("Account created", "success"); } },
    );
  }

  const visible = accounts?.filter((a) => showArchived || !a.archivedAt) ?? [];

  return (
    <div className="mt-4 max-w-2xl">
      <form onSubmit={submit} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-3">
        <input placeholder="Account name" value={name} onChange={(e) => setName(e.target.value)} className="w-44 rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
        <select value={type} onChange={(e) => setType(e.target.value as AccountType)} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm">
          {ACCOUNT_TYPES.map((t) => (
            <option key={t} value={t}>{t.replace("_", " ")}</option>
          ))}
        </select>
        <input placeholder="Opening ₹" value={opening} onChange={(e) => setOpening(e.target.value)} inputMode="decimal" className="w-28 rounded-md border border-slate-300 px-2 py-1.5 text-right text-sm" />
        <button type="submit" className="rounded-md bg-slate-800 px-3 py-1.5 text-sm text-white">Add account</button>
      </form>

      {visible.length === 0 && (
        <p className="mt-6 rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-400">
          No accounts yet — create your first bank, cash or credit card account above to start tracking.
        </p>
      )}

      <ul className="mt-4 divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
        {visible.map((a, i) => (
          <li key={a.id} className={`flex items-center gap-3 px-4 py-3 text-sm ${a.archivedAt ? "opacity-50" : ""}`}>
            <div className="flex flex-col">
              <button disabled={i === 0} className="text-xs text-slate-400 disabled:opacity-30" onClick={() => {
                const above = visible[i - 1]!;
                update.mutate({ id: a.id, sortOrder: above.sortOrder });
                update.mutate({ id: above.id, sortOrder: a.sortOrder === above.sortOrder ? a.sortOrder + 1 : a.sortOrder });
              }}>▲</button>
              <button disabled={i === visible.length - 1} className="text-xs text-slate-400 disabled:opacity-30" onClick={() => {
                const below = visible[i + 1]!;
                update.mutate({ id: a.id, sortOrder: below.sortOrder === a.sortOrder ? below.sortOrder + 1 : below.sortOrder });
                update.mutate({ id: below.id, sortOrder: a.sortOrder });
              }}>▼</button>
            </div>
            <InlineName value={a.name} onSave={(name2) => update.mutate({ id: a.id, name: name2 })} />
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">{a.type.replace("_", " ")}</span>
            <span className="ml-auto tabular-nums text-slate-600">{formatINR(a.balancePaise)}</span>
            {a.archivedAt ? (
              <button className="text-xs text-slate-500 underline" onClick={() => update.mutate({ id: a.id, archived: false })}>Restore</button>
            ) : (
              <button className="text-xs text-slate-500 underline" onClick={() => update.mutate({ id: a.id, archived: true })}>Archive</button>
            )}
            <button
              className="text-xs text-red-500 underline"
              onClick={() =>
                remove.mutate(a.id, {
                  onSuccess: () => toast("Account deleted", "success"),
                })
              }
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
      <label className="mt-2 block text-sm text-slate-500">
        <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} className="mr-1" />
        Show archived
      </label>
    </div>
  );
}

function InlineName({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <input
        autoFocus
        defaultValue={value}
        onBlur={(e) => { if (e.target.value && e.target.value !== value) onSave(e.target.value); setEditing(false); }}
        className="rounded border border-slate-300 px-1 py-0.5 text-sm"
      />
    );
  }
  return <button className="font-medium text-slate-800" onClick={() => setEditing(true)}>{value}</button>;
}

function CategoriesPanel() {
  const { data: categories } = useCategories();
  const { create, update, merge } = useCategoryMutations();
  const [kind, setKind] = useState<CategoryKind>("expense");
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState("");
  const [showArchived, setShowArchived] = useState(false);

  const ofKind = categories?.filter((c) => c.kind === kind) ?? [];
  const roots = ofKind.filter((c) => c.parentId === null && (showArchived || !c.archivedAt));
  const childrenOf = (id: string) =>
    ofKind.filter((c) => c.parentId === id && (showArchived || !c.archivedAt));

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!name) return;
    create.mutate(
      { name, kind, parentId: parentId || null, icon: "", color: "" },
      { onSuccess: () => { setName(""); toast("Category created", "success"); } },
    );
  }

  return (
    <div className="mt-4 max-w-2xl">
      <div className="flex gap-2">
        {(["expense", "income"] as const).map((k) => (
          <button key={k} onClick={() => setKind(k)} className={`rounded-full px-3 py-1 text-sm capitalize ${kind === k ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-600"}`}>
            {k}
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-3">
        <input placeholder="Category name" value={name} onChange={(e) => setName(e.target.value)} className="w-44 rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
        <select value={parentId} onChange={(e) => setParentId(e.target.value)} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm">
          <option value="">(top level)</option>
          {ofKind.filter((c) => c.parentId === null && !c.archivedAt).map((c) => (
            <option key={c.id} value={c.id}>under {c.name}</option>
          ))}
        </select>
        <button type="submit" className="rounded-md bg-slate-800 px-3 py-1.5 text-sm text-white">Add category</button>
      </form>

      {roots.length === 0 && (
        <p className="mt-6 rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-400">
          No {kind} categories — add your first one above.
        </p>
      )}

      <ul className="mt-4 rounded-lg border border-slate-200 bg-white">
        {roots.map((c) => (
          <li key={c.id} className="border-b border-slate-100 last:border-0">
            <CategoryRow category={c} all={ofKind} onUpdate={update.mutate} onMerge={merge.mutate} depth={0} />
            {childrenOf(c.id).map((ch) => (
              <CategoryRow key={ch.id} category={ch} all={ofKind} onUpdate={update.mutate} onMerge={merge.mutate} depth={1} />
            ))}
          </li>
        ))}
      </ul>
      <label className="mt-2 block text-sm text-slate-500">
        <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} className="mr-1" />
        Show archived
      </label>
    </div>
  );
}

function CategoryRow({
  category: c,
  all,
  onUpdate,
  onMerge,
  depth,
}: {
  category: Category;
  all: Category[];
  onUpdate: (v: { id: string } & Record<string, unknown>) => void;
  onMerge: (v: { id: string; intoCategoryId: string }) => void;
  depth: number;
}) {
  const reparentTargets = all.filter((x) => x.id !== c.id && x.parentId === null && !x.archivedAt);
  const mergeTargets = all.filter((x) => x.id !== c.id && !x.archivedAt);
  return (
    <div className={`flex items-center gap-2 px-4 py-2 text-sm ${c.archivedAt ? "opacity-50" : ""}`} style={{ paddingLeft: 16 + depth * 24 }}>
      <span>{c.icon}</span>
      <InlineName value={c.name} onSave={(name) => onUpdate({ id: c.id, name })} />
      <span className="ml-auto" />
      <select
        value=""
        onChange={(e) => {
          if (e.target.value === "__root__") onUpdate({ id: c.id, parentId: null });
          else if (e.target.value.startsWith("merge:")) {
            if (confirm(`Merge “${c.name}” into the selected category? Its transactions move over.`)) {
              onMerge({ id: c.id, intoCategoryId: e.target.value.slice(6) });
            }
          } else if (e.target.value) onUpdate({ id: c.id, parentId: e.target.value });
        }}
        className="rounded border border-slate-200 px-1 py-0.5 text-xs text-slate-500"
      >
        <option value="">Move / merge…</option>
        {depth === 1 && <option value="__root__">→ top level</option>}
        {reparentTargets.map((t) => (
          <option key={t.id} value={t.id}>→ under {t.name}</option>
        ))}
        <optgroup label="Merge into">
          {mergeTargets.map((t) => (
            <option key={t.id} value={`merge:${t.id}`}>⇒ {t.name}</option>
          ))}
        </optgroup>
      </select>
      {c.archivedAt ? (
        <button className="text-xs text-slate-500 underline" onClick={() => onUpdate({ id: c.id, archived: false })}>Restore</button>
      ) : (
        <button className="text-xs text-slate-500 underline" onClick={() => onUpdate({ id: c.id, archived: true })}>Archive</button>
      )}
    </div>
  );
}
