import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router";
import {
  accountCanHaveGoal,
  formatINR,
  OverdraftDetailsSchema,
  type AccountType,
  type Category,
  type CategoryKind,
} from "@compass/shared";
import { apiPut } from "../../lib/api.ts";
import { toast } from "../../lib/toast.tsx";
import { ACCOUNT_TYPES, ACCOUNT_TYPE_LABELS } from "../../lib/account-meta.ts";
import {
  InstitutionDatalist,
  InstitutionIcon,
  INSTITUTION_LIST_ID,
} from "../../lib/institutions.tsx";
import {
  useAccountMutations,
  useAccounts,
  useCategories,
  useCategoryMutations,
} from "../../lib/queries.ts";
import { useGoals } from "../../lib/goal-queries.ts";
import { useAssetGoalMutation } from "../../lib/wealth-queries.ts";
import { RulesPanel } from "./RulesPanel.tsx";
import { RecurringPanel } from "./RecurringPanel.tsx";
import { AboutPanel, DataPanel, NotificationsPanel, ProfilePanel, SessionsPanel } from "./GeneralPanels.tsx";

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
  // Tab lives in the URL so returning from a sub-page (e.g. account details)
  // lands back on the tab you left, and so tabs are linkable.
  const [params, setParams] = useSearchParams();
  const raw = params.get("tab");
  const tab: Tab = (TABS as readonly string[]).includes(raw ?? "") ? (raw as Tab) : "profile";
  const setTab = (t: Tab) => setParams({ tab: t }, { replace: true });
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
  const { data: goals } = useGoals();
  const { create, update, remove } = useAccountMutations();
  const setGoal = useAssetGoalMutation();
  const [name, setName] = useState("");
  const [type, setType] = useState<AccountType>("bank");
  const [institution, setInstitution] = useState("");
  const [last4, setLast4] = useState("");
  const [opening, setOpening] = useState("0");
  const [limitAvailed, setLimitAvailed] = useState("");
  const [limitAvailable, setLimitAvailable] = useState("");
  const [showArchived, setShowArchived] = useState(false);

  const last4Invalid = last4 !== "" && !/^\d{4}$/.test(last4);

  const availedPaise = Math.round(Number(limitAvailed || "0") * 100);
  const availablePaise = Math.round(Number(limitAvailable || "0") * 100);
  const isOverdraft = type === "overdraft" || type === "home_loan_od";
  const overdraftInvalid =
    isOverdraft &&
    (!Number.isFinite(availedPaise) || availedPaise < 0 || !Number.isFinite(availablePaise) || availablePaise < 0);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name || last4Invalid || overdraftInvalid) return;
    try {
      const account = await create.mutateAsync({
        name,
        type,
        institution: institution || null,
        accountLast4: last4 || null,
        // Holder name, UPI and bank details are set afterwards, in Details —
        // this form stays the short path to getting an account on the books.
        holderName: null,
        currency: "INR",
        // Liability balances are negative. For Maxgain, limit availed is the
        // current amount owed and therefore becomes the opening balance.
        openingBalancePaise:
          isOverdraft ? -availedPaise : Math.round(parseFloat(opening || "0") * 100),
      });
      if (isOverdraft) {
        await apiPut(
          `/api/accounts/${account.id}/overdraft-details`,
          OverdraftDetailsSchema,
          { sanctionedLimitPaise: availedPaise + availablePaise, annualRateBps: 0 },
        );
      }
      setName("");
      setInstitution("");
      setLast4("");
      setOpening("0");
      setLimitAvailed("");
      setLimitAvailable("");
      toast("Account created", "success");
    } catch {
      toast("Couldn't create the account");
    }
  }

  const visible = accounts?.filter((a) => showArchived || !a.archivedAt) ?? [];

  return (
    <div className="mt-4 max-w-7xl">
      <InstitutionDatalist />
      <form onSubmit={submit} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-3">
        <input placeholder="Account name" value={name} onChange={(e) => setName(e.target.value)} className="w-44 rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
        <select value={type} onChange={(e) => setType(e.target.value as AccountType)} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm">
          {ACCOUNT_TYPES.map((t) => (
            <option key={t} value={t}>{ACCOUNT_TYPE_LABELS[t]}</option>
          ))}
        </select>
        <input
          placeholder="Bank"
          value={institution}
          onChange={(e) => setInstitution(e.target.value)}
          list={INSTITUTION_LIST_ID}
          className="w-32 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
        />
        <input
          placeholder="Last 4"
          value={last4}
          onChange={(e) => setLast4(e.target.value.replace(/\D/g, "").slice(0, 4))}
          inputMode="numeric"
          aria-invalid={last4Invalid}
          className={`w-20 rounded-md border px-2 py-1.5 text-sm ${last4Invalid ? "border-red-400" : "border-slate-300"}`}
        />
        {isOverdraft ? (
          <>
            <input
              placeholder="Limit availed ₹"
              aria-label="Limit availed"
              value={limitAvailed}
              onChange={(e) => setLimitAvailed(e.target.value)}
              inputMode="decimal"
              className="w-36 rounded-md border border-slate-300 px-2 py-1.5 text-right text-sm"
            />
            <input
              placeholder="Limit available ₹"
              aria-label="Limit available"
              value={limitAvailable}
              onChange={(e) => setLimitAvailable(e.target.value)}
              inputMode="decimal"
              className="w-36 rounded-md border border-slate-300 px-2 py-1.5 text-right text-sm"
            />
          </>
        ) : (
          <input placeholder="Opening ₹" value={opening} onChange={(e) => setOpening(e.target.value)} inputMode="decimal" className="w-28 rounded-md border border-slate-300 px-2 py-1.5 text-right text-sm" />
        )}
        <button type="submit" disabled={last4Invalid || overdraftInvalid || create.isPending} className="rounded-md bg-slate-800 px-3 py-1.5 text-sm text-white disabled:opacity-50">Add account</button>
        {last4Invalid && (
          <p role="alert" className="w-full text-xs text-red-600">
            Last 4 must be exactly 4 digits — we only ever store the last four, never the full number.
          </p>
        )}
        {overdraftInvalid && (
          <p role="alert" className="w-full text-xs text-red-600">
            Limit availed and limit available must be positive amounts.
          </p>
        )}
      </form>

      {visible.length === 0 && (
        <p className="mt-6 rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-400">
          No accounts yet — create your first bank, cash or credit card account above to start tracking.
        </p>
      )}

      <ul className="mt-4 divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 bg-white">
        {visible.length > 0 && (
          <li
            aria-hidden="true"
            className="hidden grid-cols-[1.25rem_2rem_minmax(7rem,1.2fr)_minmax(6rem,1fr)_4.25rem_4.5rem_minmax(6rem,0.9fr)_7rem_minmax(8.5rem,auto)] items-center gap-x-2 bg-slate-50 px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-slate-400 md:grid"
          >
            <span />
            <span />
            <span>Account</span>
            <span>Goal</span>
            <span>Number</span>
            <span>Institution</span>
            <span>Type</span>
            <span className="text-right">Balance</span>
            <span className="text-right">Actions</span>
          </li>
        )}
        {visible.map((a, i) => (
          <li
            key={a.id}
            className={`grid grid-cols-[1.25rem_2rem_minmax(0,1fr)] items-center gap-x-2 gap-y-2 px-4 py-3 text-sm md:grid-cols-[1.25rem_2rem_minmax(7rem,1.2fr)_minmax(6rem,1fr)_4.25rem_4.5rem_minmax(6rem,0.9fr)_7rem_minmax(8.5rem,auto)] ${a.archivedAt ? "opacity-50" : ""}`}
          >
            <div className="flex shrink-0 flex-col">
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

            <InstitutionIcon institution={a.institution} />

            <div className="min-w-0">
              <InlineName value={a.name} onSave={(name2) => update.mutate({ id: a.id, name: name2 })} />
            </div>

            <div className="col-start-3 min-w-0 md:col-start-auto">
              {accountCanHaveGoal(a.type) ? (
                <select
                  value={a.goalId ?? ""}
                  aria-label={`Goal for ${a.name}`}
                  onChange={(e) =>
                    setGoal.mutate(
                      { kind: "account", id: a.id, goalId: e.target.value || null },
                      { onError: () => toast("Couldn't update the goal") },
                    )
                  }
                  className="block max-w-full rounded bg-slate-100 px-1.5 py-1 text-xs text-slate-500"
                >
                  <option value="">No goal</option>
                  {goals?.filter((g) => !g.archived).map((g) => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                </select>
              ) : (
                <span className="text-xs text-slate-300">—</span>
              )}
            </div>

            <div className="col-start-3 md:col-start-auto">
              <InlineField
                value={a.accountLast4}
                placeholder="+ last 4"
                render={(v) => <span className="tabular-nums">•••• {v}</span>}
                sanitize={(v) => v.replace(/\D/g, "").slice(0, 4)}
                validate={(v) => (v === "" || /^\d{4}$/.test(v) ? null : "4 digits")}
                onSave={(v) => update.mutate({ id: a.id, accountLast4: v || null })}
              />
            </div>

            <div className="col-start-3 md:col-start-auto">
              <InlineField
                value={a.institution}
                placeholder="+ bank"
                listId={INSTITUTION_LIST_ID}
                onSave={(v) => update.mutate({ id: a.id, institution: v || null })}
              />
            </div>

            <span className="col-start-3 min-w-0 truncate text-xs text-slate-500 md:col-start-auto">
              {ACCOUNT_TYPE_LABELS[a.type]}
            </span>

            <span className="col-start-3 text-left tabular-nums font-medium text-slate-700 md:col-start-auto md:text-right">
              {formatINR(a.balancePaise)}
            </span>

            <div className="col-start-3 flex flex-wrap items-center gap-x-3 gap-y-1 md:col-start-auto md:justify-end md:gap-x-2">
              <Link to={`/settings/accounts/${a.id}`} className="text-xs text-slate-500 underline">
                Details
              </Link>
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
            </div>
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

/**
 * Click-to-edit for optional account metadata. Shows a muted placeholder when
 * unset, so an empty field is still discoverable.
 */
function InlineField({
  value,
  placeholder,
  onSave,
  render,
  sanitize,
  validate,
  listId,
}: {
  value: string | null;
  placeholder: string;
  onSave: (v: string) => void;
  render?: (v: string) => React.ReactNode;
  sanitize?: (v: string) => string;
  validate?: (v: string) => string | null;
  listId?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const error = editing && validate ? validate(draft) : null;

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        list={listId}
        aria-label={placeholder}
        aria-invalid={error !== null}
        title={error ?? undefined}
        onChange={(e) => setDraft(sanitize ? sanitize(e.target.value) : e.target.value)}
        onBlur={() => {
          // Keep the row editable rather than silently discarding a bad value.
          if (error) return;
          if (draft !== (value ?? "")) onSave(draft);
          setEditing(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") { setDraft(value ?? ""); setEditing(false); }
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        className={`w-24 rounded border px-1 py-0.5 text-xs ${error ? "border-red-400" : "border-slate-300"}`}
      />
    );
  }
  return (
    <button
      className="text-xs text-slate-400 hover:text-slate-600"
      onClick={() => { setDraft(value ?? ""); setEditing(true); }}
    >
      {value ? (render?.(value) ?? value) : placeholder}
    </button>
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
  return (
    <button
      className="block max-w-full truncate text-left font-medium text-slate-800"
      onClick={() => setEditing(true)}
      title={value}
    >
      {value}
    </button>
  );
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
