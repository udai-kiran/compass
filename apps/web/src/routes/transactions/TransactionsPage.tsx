import { useMemo, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  effectiveNecessity,
  formatDisplayDate,
  formatINR,
  todayInIST,
  type Category,
  type ExpenseNecessity,
  type Transaction,
  type TransactionFilter,
} from "@compass/shared";
import { toast } from "../../lib/toast.tsx";
import {
  useAccounts,
  useCategories,
  useTransactionMutations,
  useTransactionsInfinite,
  useTransferMutations,
} from "../../lib/queries.ts";
import { CategoryPicker } from "../../components/CategoryPicker.tsx";
import { DateField } from "../../components/DateField.tsx";
import { TransactionDrawer } from "./TransactionDrawer.tsx";
import { AiCategorizePanel } from "./AiCategorizePanel.tsx";
import { SmartFillPanel } from "./SmartFillPanel.tsx";
import { RecordEpfModal } from "./RecordEpfModal.tsx";
import { useCapabilities } from "../../lib/settings-queries.ts";

const FILTER_KEYS = [
  "q",
  "from",
  "to",
  "minAmountPaise",
  "maxAmountPaise",
  "accountId",
  "categoryId",
  "tag",
] as const;

function filterFromParams(params: URLSearchParams): TransactionFilter {
  const f: Record<string, string | number> = {};
  for (const k of FILTER_KEYS) {
    const v = params.get(k);
    if (v !== null && v !== "") f[k] = k.endsWith("Paise") ? Number(v) : v;
  }
  return f as TransactionFilter;
}

export function TransactionsPage() {
  const [params, setParams] = useSearchParams();
  const filter = useMemo(() => filterFromParams(params), [params]);
  const { data: accounts } = useAccounts();
  const { data: categories } = useCategories();
  const query = useTransactionsInfinite(filter);
  const mutations = useTransactionMutations(filter);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [allMatching, setAllMatching] = useState(false);
  const [drawerTx, setDrawerTx] = useState<string | null>(null);
  const [aiCategorize, setAiCategorize] = useState(false);
  const [smartFill, setSmartFill] = useState(false);
  const [showRecordEpf, setShowRecordEpf] = useState(false);
  const { data: capabilities } = useCapabilities();

  const items = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data]);
  const totalCount = query.data?.pages[0]?.totalCount ?? 0;
  const totalAmount = query.data?.pages[0]?.totalAmountPaise ?? 0;

  const parentRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: items.length + (query.hasNextPage ? 1 : 0),
    getScrollElement: () => parentRef.current,
    estimateSize: () => 44,
    overscan: 20,
    scrollMargin: listRef.current?.offsetTop ?? 0,
  });
  const virtualItems = virtualizer.getVirtualItems();
  const lastVirtual = virtualItems[virtualItems.length - 1];
  if (
    lastVirtual &&
    lastVirtual.index >= items.length - 1 &&
    query.hasNextPage &&
    !query.isFetchingNextPage
  ) {
    void query.fetchNextPage();
  }

  function setFilterParam(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value === "") next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
    setSelected(new Set());
    setAllMatching(false);
  }

  const catName = (id: string | null) =>
    id === null ? "—" : (categories?.find((c) => c.id === id)?.name ?? "…");
  const accName = (id: string) => accounts?.find((a) => a.id === id)?.name ?? "…";

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setAllMatching(false);
  }

  function bulkTarget() {
    return allMatching ? { filter } : { ids: [...selected] };
  }

  function runBulk(action: Parameters<typeof mutations.bulk.mutate>[0], label: string) {
    mutations.bulk.mutate(action, {
      onSuccess: (result) => {
        setSelected(new Set());
        setAllMatching(false);
        toast(`${label} (${result.affected} transactions)`, "success", {
          label: "Undo",
          onClick: () =>
            mutations.bulk.mutate(
              { action: "restore", snapshot: result.snapshot },
              { onSuccess: () => toast("Undone", "success") },
            ),
        });
      },
    });
  }

  const selectedCount = allMatching ? totalCount : selected.size;

  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold text-slate-800">Transactions</h1>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowRecordEpf(true)}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            + Record EPF
          </button>
          <button
            onClick={() => setSmartFill(true)}
            className="rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-700 hover:bg-amber-100"
          >
            ⚡ Smart Fill
          </button>
          {capabilities?.features.categorization && (
            <button
              onClick={() => setAiCategorize(true)}
              className="rounded-md border border-violet-300 bg-violet-50 px-3 py-1.5 text-sm font-medium text-violet-700 hover:bg-violet-100"
            >
              ✨ Suggest categories
            </button>
          )}
          <p className="text-sm text-slate-500">
            {totalCount} transactions · net {formatINR(totalAmount)}
          </p>
        </div>
      </div>

      {/* Filter bar — URL-backed, combinable */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          placeholder="Search merchant or notes…"
          defaultValue={params.get("q") ?? ""}
          onKeyDown={(e) => {
            if (e.key === "Enter") setFilterParam("q", e.currentTarget.value);
          }}
          className="w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm sm:w-56"
        />
        <DateField
          value={params.get("from") ?? ""}
          onChange={(iso) => setFilterParam("from", iso)}
          className="w-36"
          aria-label="From date"
        />
        <DateField
          value={params.get("to") ?? ""}
          onChange={(iso) => setFilterParam("to", iso)}
          className="w-36"
          aria-label="To date"
        />
        <select
          value={params.get("accountId") ?? ""}
          onChange={(e) => setFilterParam("accountId", e.target.value)}
          className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
        >
          <option value="">All accounts</option>
          {accounts?.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <CategoryPicker
          categories={categories ?? []}
          value={params.get("categoryId") || null}
          onChange={(id) => setFilterParam("categoryId", id ?? "")}
          emptyLabel="All categories"
          className="w-44"
        />
        <input
          placeholder="tag"
          defaultValue={params.get("tag") ?? ""}
          onKeyDown={(e) => {
            if (e.key === "Enter") setFilterParam("tag", e.currentTarget.value);
          }}
          className="w-24 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
        />
        {[...params.keys()].length > 0 && (
          <button
            onClick={() => setParams(new URLSearchParams(), { replace: true })}
            className="text-sm text-slate-500 underline"
          >
            Clear
          </button>
        )}
      </div>

      <QuickAdd filter={filter} />

      {/* Bulk bar */}
      {selectedCount > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-2 rounded-md bg-brand-600 px-3 py-2 text-sm text-white">
          <span>{selectedCount} selected</span>
          {!allMatching && selected.size === items.length && totalCount > items.length && (
            <button className="underline" onClick={() => setAllMatching(true)}>
              Select all {totalCount} matching
            </button>
          )}
          <CategoryPicker
            categories={categories ?? []}
            value={null}
            onChange={(id) => {
              if (id) runBulk({ action: "setCategory", categoryId: id, ...bulkTarget() }, "Recategorized");
            }}
            placeholder="Set category…"
            className="w-44 text-slate-700"
          />
          <button
            className="rounded bg-brand-700 px-2 py-1"
            onClick={() => {
              const tag = prompt("Tag to add:");
              if (tag) runBulk({ action: "addTag", tag, ...bulkTarget() }, `Tagged “${tag}”`);
            }}
          >
            Add tag
          </button>
          <button
            className="rounded bg-red-600 px-2 py-1"
            onClick={() => runBulk({ action: "delete", ...bulkTarget() }, "Deleted")}
          >
            Delete
          </button>
          <button
            className="ml-auto underline"
            onClick={() => {
              setSelected(new Set());
              setAllMatching(false);
            }}
          >
            Clear selection
          </button>
        </div>
      )}

      {/* Virtualized table */}
      <div
        ref={parentRef}
        className="min-h-0 flex-1 overflow-auto rounded-lg border border-slate-200 bg-white"
      >
        {/* Column headers */}
        <div className="sticky top-0 z-10 flex min-w-[560px] items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
          <span className="w-3.5 shrink-0" />
          <span className="w-28 text-xs font-medium uppercase tracking-wide text-slate-500">Date</span>
          <span className="min-w-0 flex-1 text-xs font-medium uppercase tracking-wide text-slate-500">Merchant</span>
          <span className="hidden w-32 text-xs font-medium uppercase tracking-wide text-slate-500 md:block">Account</span>
          <span className="w-36 text-xs font-medium uppercase tracking-wide text-slate-500">Category</span>
          <span className="w-28 text-right text-xs font-medium uppercase tracking-wide text-slate-500">Amount</span>
          <span className="w-7 shrink-0" />
        </div>
        <div
          ref={listRef}
          className="min-w-[560px]"
          style={{ height: virtualizer.getTotalSize(), position: "relative" }}
        >
          {virtualItems.map((vi) => {
            const tx = items[vi.index];
            if (!tx) {
              return (
                <div
                  key="loader"
                  className="absolute left-0 w-full px-3 py-2 text-center text-sm text-slate-400"
                  style={{ top: vi.start - virtualizer.options.scrollMargin }}
                >
                  Loading more…
                </div>
              );
            }
            return (
              <TxRow
                key={tx.id}
                tx={tx}
                top={vi.start - virtualizer.options.scrollMargin}
                selected={allMatching || selected.has(tx.id)}
                onToggle={() => toggleSelect(tx.id)}
                onOpen={() => setDrawerTx(tx.id)}
                catName={catName}
                accName={accName}
                accounts={accounts ?? []}
                categories={categories ?? []}
                onUpdate={(patch) => mutations.update.mutate({ id: tx.id, ...patch })}
              />
            );
          })}
        </div>
        {items.length === 0 && !query.isLoading && (
          <p className="p-8 text-center text-sm text-slate-400">
            No transactions match. Add one above or adjust filters.
          </p>
        )}
      </div>

      {drawerTx && (
        <TransactionDrawer id={drawerTx} filter={filter} onClose={() => setDrawerTx(null)} />
      )}
      {aiCategorize && (
        <AiCategorizePanel
          onClose={() => setAiCategorize(false)}
          onApply={(id, categoryId) => mutations.update.mutate({ id, categoryId })}
        />
      )}
      {smartFill && (
        <SmartFillPanel
          onClose={() => setSmartFill(false)}
          onApplyMerchant={async (txnIds, categoryId) => {
            await mutations.bulk.mutateAsync({ action: "setCategory", ids: txnIds, categoryId });
          }}
        />
      )}
      {showRecordEpf && <RecordEpfModal onClose={() => setShowRecordEpf(false)} />}
    </div>
  );
}

function TxRow({
  tx,
  top,
  selected,
  onToggle,
  onOpen,
  catName,
  accName,
  accounts,
  categories,
  onUpdate,
}: {
  tx: Transaction;
  top: number;
  selected: boolean;
  onToggle: () => void;
  onOpen: () => void;
  catName: (id: string | null) => string;
  accName: (id: string) => string;
  accounts: Array<{ id: string; name: string; type: string; archivedAt: string | null }>;
  categories: Category[];
  onUpdate: (
    patch: Partial<{
      categoryId: string | null;
      date: string;
      amountPaise: number;
      merchant: string;
      accountId: string;
      necessity: ExpenseNecessity | null;
    }>,
  ) => void;
}) {
  const [editing, setEditing] = useState<
    "category" | "date" | "amount" | "merchant" | "account" | "necessity" | null
  >(null);
  const [editingDate, setEditingDate] = useState("");
  const lastCommittedDate = useRef<string | null>(null);
  const isTransfer = tx.isTransfer;
  // Distinguish a plain account move from a credit-card payment by looking at the
  // two legs' account types, and name the counterpart so the row is self-explaining.
  const counterpart = tx.transferCounterpartAccountId
    ? accounts.find((a) => a.id === tx.transferCounterpartAccountId)
    : undefined;
  const thisAccount = accounts.find((a) => a.id === tx.accountId);
  const involvesCard =
    thisAccount?.type === "credit_card" || counterpart?.type === "credit_card";
  const transferLabel = involvesCard ? "card payment" : "transfer";
  const txCategory = tx.categoryId ? categories.find((c) => c.id === tx.categoryId) : undefined;
  const isSplit = tx.splits.length > 0;
  // A split transaction has no single category to inherit from — each part
  // resolves against its own. Only an explicit override is meaningful at row level.
  const resolvedNecessity = isSplit
    ? tx.necessity
    : effectiveNecessity(tx.necessity, txCategory?.necessity ?? null, txCategory?.kind ?? null);
  const necessityIsExplicit = tx.necessity !== null;
  return (
    <div
      className="absolute left-0 flex w-full items-center gap-2 border-b border-slate-100 px-3 text-sm hover:bg-slate-50"
      style={{ top, height: 44 }}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggle}
        onClick={(e) => e.stopPropagation()}
      />
      {editing === "date" ? (
        <DateField
          value={editingDate}
          defaultOpen
          autoFocus
          onChange={(iso) => {
            setEditingDate(iso);
            if (iso && iso !== lastCommittedDate.current) {
              onUpdate({ date: iso });
              lastCommittedDate.current = iso;
            }
          }}
          onClose={() => setEditing(null)}
          className="w-28"
          aria-label="Transaction date"
        />
      ) : (
        <button
          className="w-28 text-left text-slate-500"
          onClick={() => {
            setEditingDate(tx.date);
            lastCommittedDate.current = tx.date;
            setEditing("date");
          }}
        >
          {formatDisplayDate(tx.date)}
        </button>
      )}
      {editing === "merchant" ? (
        <input
          autoFocus
          defaultValue={tx.merchant}
          placeholder="Merchant"
          onBlur={(e) => {
            const v = e.target.value.trim();
            if (v !== tx.merchant) onUpdate({ merchant: v });
            setEditing(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") setEditing(null);
          }}
          className="min-w-0 flex-1 rounded border border-slate-300 px-1 py-0.5"
        />
      ) : (
        <button
          className="min-w-0 flex-1 truncate text-left font-medium text-slate-800"
          onClick={() => setEditing("merchant")}
        >
          {tx.merchant || "(no merchant)"}
          {isTransfer && (
            <span
              className={`ml-2 rounded px-1.5 py-0.5 text-xs font-normal ${
                involvesCard ? "bg-violet-100 text-violet-700" : "bg-sky-100 text-sky-700"
              }`}
              title={
                counterpart
                  ? `${involvesCard ? "Credit-card payment" : "Transfer"} ${
                      tx.amountPaise < 0 ? "to" : "from"
                    } ${counterpart.name}`
                  : undefined
              }
            >
              {transferLabel}
              {counterpart && ` ${tx.amountPaise < 0 ? "→" : "←"} ${counterpart.name}`}
            </span>
          )}
          {tx.splits.length > 0 && (
            <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-normal text-amber-700">
              split
            </span>
          )}
          {tx.tags.map((t) => (
            <span
              key={t}
              className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-normal text-slate-500"
            >
              #{t}
            </span>
          ))}
        </button>
      )}
      {editing === "account" ? (
        <select
          autoFocus
          defaultValue={tx.accountId}
          onBlur={() => setEditing(null)}
          onChange={(e) => {
            if (e.target.value && e.target.value !== tx.accountId) {
              onUpdate({ accountId: e.target.value });
            }
            setEditing(null);
          }}
          className="hidden w-32 rounded border border-slate-300 px-1 py-0.5 md:block"
        >
          {accounts
            .filter((a) => !a.archivedAt || a.id === tx.accountId)
            .map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
        </select>
      ) : isTransfer ? (
        // A linked transfer's legs must stay in different accounts; moving one
        // inline could collapse both legs into one account (the update API does
        // not revalidate transfer invariants). Unlink via the ⋯ drawer first.
        <span
          className="hidden w-32 cursor-default truncate text-slate-500 md:block"
          title="Part of a transfer — unlink it (⋯) before changing the account"
        >
          {accName(tx.accountId)}
        </span>
      ) : (
        <button
          className="hidden w-32 truncate text-left text-slate-500 md:block"
          onClick={() => setEditing("account")}
        >
          {accName(tx.accountId)}
        </button>
      )}
      {editing === "category" ? (
        <CategoryPicker
          categories={categories}
          value={tx.categoryId}
          defaultOpen
          onClose={() => setEditing(null)}
          onChange={(id) => onUpdate({ categoryId: id })}
          emptyLabel="Uncategorized"
          className="w-40"
        />
      ) : (
        <button
          className="w-36 truncate text-left text-slate-500"
          onClick={() => setEditing("category")}
        >
          {tx.splits.length > 0 ? "(split)" : catName(tx.categoryId)}
        </button>
      )}
      {editing === "necessity" ? (
        <select
          autoFocus
          value={tx.necessity ?? ""}
          onChange={(e) => {
            onUpdate({ necessity: (e.target.value || null) as ExpenseNecessity | null });
            setEditing(null);
          }}
          onBlur={() => setEditing(null)}
          className="hidden w-32 rounded border border-slate-300 px-1 py-0.5 text-xs md:block"
        >
          <option value="">Inherit</option>
          <option value="essential">Essential</option>
          <option value="non_essential">Non-essential</option>
        </select>
      ) : (
        <button
          className={`hidden w-8 shrink-0 rounded text-center text-xs md:block ${
            resolvedNecessity === "essential"
              ? necessityIsExplicit
                ? "bg-emerald-100 font-semibold text-emerald-700"
                : "text-emerald-600"
              : resolvedNecessity === "non_essential"
                ? necessityIsExplicit
                  ? "bg-amber-100 font-semibold text-amber-700"
                  : "text-amber-600"
                : "text-slate-300 hover:text-slate-500"
          }`}
          onClick={() => setEditing("necessity")}
          title={
            necessityIsExplicit
              ? `Set to ${tx.necessity === "essential" ? "Essential" : "Non-essential"} on this transaction. Click to change.`
              : isSplit
                ? "Each split uses its own category's default. Click to override the whole transaction."
                : resolvedNecessity !== null
                  ? `Inherited from ${catName(tx.categoryId)} (${
                      resolvedNecessity === "essential" ? "Essential" : "Non-essential"
                    }). Click to override for this transaction only.`
                  : tx.categoryId === null
                    ? "Uncategorized — no necessity set. Click to set one for this transaction."
                    : `${catName(tx.categoryId)} has no default necessity. Click to set one for this transaction.`
          }
        >
          {resolvedNecessity === "essential" ? "E" : resolvedNecessity === "non_essential" ? "N" : "–"}
        </button>
      )}
      {editing === "amount" ? (
        <input
          autoFocus
          type="number"
          step="0.01"
          defaultValue={(tx.amountPaise / 100).toFixed(2)}
          onBlur={(e) => {
            const v = Math.round(parseFloat(e.target.value) * 100);
            if (!Number.isNaN(v) && v !== 0) onUpdate({ amountPaise: v });
            setEditing(null);
          }}
          className="w-28 rounded border border-slate-300 px-1 py-0.5 text-right"
        />
      ) : (
        <button
          className={`w-28 text-right tabular-nums ${tx.amountPaise < 0 ? "text-slate-800" : "text-emerald-600"}`}
          onClick={() => setEditing("amount")}
        >
          {formatINR(tx.amountPaise)}
        </button>
      )}
      <button
        className="shrink-0 rounded px-1.5 text-slate-400 hover:bg-slate-200 hover:text-slate-600"
        title="Details — splits, transfers, receipts"
        onClick={onOpen}
      >
        ⋯
      </button>
    </div>
  );
}

function QuickAdd({ filter }: { filter: TransactionFilter }) {
  const { data: accounts } = useAccounts();
  const { data: categories } = useCategories();
  const { create } = useTransactionMutations(filter);
  const { record } = useTransferMutations();
  const [merchant, setMerchant] = useState("");
  const [amount, setAmount] = useState("");
  const [kind, setKind] = useState<"expense" | "income" | "transfer">("expense");
  const [accountId, setAccountId] = useState("");
  const [toAccountId, setToAccountId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [date, setDate] = useState(todayInIST());
  const active = accounts?.filter((a) => !a.archivedAt) ?? [];
  // Only ever use a source account that is still active — a stored selection can
  // go stale if the account is archived while this form stays mounted, and the
  // stale id would otherwise be submitted while the dropdown showed something
  // else. Mirrors the membership check used for the destination below.
  const effAccount = active.some((a) => a.id === accountId) ? accountId : (active[0]?.id ?? "");
  // The destination list never contains the source account, and the effective
  // destination is only ever taken from that list — so the value the dropdown
  // shows is always exactly the value submit sends, even after the source
  // changes or an account is archived out from under us.
  const transferTargets = active.filter((a) => a.id !== effAccount);
  const effToAccount = transferTargets.some((a) => a.id === toAccountId)
    ? toAccountId
    : (transferTargets[0]?.id ?? "");
  const canTransfer = transferTargets.length > 0;

  function submit(e: FormEvent) {
    e.preventDefault();
    const rupees = parseFloat(amount);
    if (kind === "transfer") {
      if (Number.isNaN(rupees) || rupees <= 0) return;
      if (!effAccount || !effToAccount || effToAccount === effAccount) {
        toast("Choose two different accounts to transfer between", "error");
        return;
      }
      record.mutate(
        {
          fromAccountId: effAccount,
          toAccountId: effToAccount,
          date,
          amountPaise: Math.round(rupees * 100),
          merchant,
          notes: "",
          tags: [],
        },
        {
          onSuccess: () => {
            setMerchant("");
            setAmount("");
            toast("Transfer recorded", "success");
          },
        },
      );
      return;
    }
    if (!effAccount || Number.isNaN(rupees) || rupees <= 0) return;
    const paise = Math.round(rupees * 100) * (kind === "expense" ? -1 : 1);
    create.mutate(
      {
        accountId: effAccount,
        date,
        amountPaise: paise,
        merchant,
        categoryId: categoryId || null,
        notes: "",
        tags: [],
      },
      {
        onSuccess: () => {
          setMerchant("");
          setAmount("");
          toast("Transaction added", "success");
        },
      },
    );
  }

  return (
    <form
      onSubmit={submit}
      className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-2"
    >
      <select
        value={kind}
        onChange={(e) => {
          setKind(e.target.value as "expense" | "income" | "transfer");
          setCategoryId(""); // categories are kind-specific — drop a now-mismatched pick
        }}
        className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
      >
        <option value="expense">Expense</option>
        <option value="income">Income</option>
        <option value="transfer">Transfer</option>
      </select>
      <input
        placeholder={kind === "transfer" ? "Description" : kind === "income" ? "Source" : "Merchant"}
        aria-label={kind === "transfer" ? "Description" : kind === "income" ? "Source" : "Merchant"}
        value={merchant}
        onChange={(e) => setMerchant(e.target.value)}
        className="w-44 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
      />
      <input
        placeholder="₹ amount"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        inputMode="decimal"
        className="w-28 rounded-md border border-slate-300 px-2 py-1.5 text-sm text-right"
      />
      <DateField
        value={date}
        onChange={(iso) => setDate(iso)}
        className="w-36"
        aria-label="Transaction date"
      />
      <select
        value={effAccount}
        onChange={(e) => setAccountId(e.target.value)}
        aria-label={kind === "transfer" ? "From account" : undefined}
        className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
      >
        {active.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
      {kind === "transfer" && (
        <select
          value={effToAccount}
          onChange={(e) => setToAccountId(e.target.value)}
          aria-label="To account"
          className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
        >
          {transferTargets.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      )}
      {kind !== "transfer" && (
        <CategoryPicker
          categories={categories ?? []}
          value={categoryId || null}
          onChange={(id) => setCategoryId(id ?? "")}
          kind={kind}
          placeholder="Category…"
          className="w-40"
        />
      )}
      <button
        type="submit"
        disabled={kind === "transfer" ? record.isPending || !canTransfer : create.isPending}
        className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
      >
        Add
      </button>
    </form>
  );
}
