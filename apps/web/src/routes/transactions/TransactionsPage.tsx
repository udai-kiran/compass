import { useMemo, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router";
import { useVirtualizer } from "@tanstack/react-virtual";
import { formatINR, type Transaction, type TransactionFilter } from "@compass/shared";
import { toast } from "../../lib/toast.tsx";
import {
  useAccounts,
  useCategories,
  useTransactionMutations,
  useTransactionsInfinite,
} from "../../lib/queries.ts";
import { TransactionDrawer } from "./TransactionDrawer.tsx";
import { AiCategorizePanel } from "./AiCategorizePanel.tsx";
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
  const { data: capabilities } = useCapabilities();

  const items = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data]);
  const totalCount = query.data?.pages[0]?.totalCount ?? 0;
  const totalAmount = query.data?.pages[0]?.totalAmountPaise ?? 0;

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: items.length + (query.hasNextPage ? 1 : 0),
    getScrollElement: () => parentRef.current,
    estimateSize: () => 44,
    overscan: 20,
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
        <input
          type="date"
          value={params.get("from") ?? ""}
          onChange={(e) => setFilterParam("from", e.target.value)}
          className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
        />
        <input
          type="date"
          value={params.get("to") ?? ""}
          onChange={(e) => setFilterParam("to", e.target.value)}
          className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
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
        <select
          value={params.get("categoryId") ?? ""}
          onChange={(e) => setFilterParam("categoryId", e.target.value)}
          className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
        >
          <option value="">All categories</option>
          {categories
            ?.filter((c) => !c.archivedAt)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
        </select>
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
        <div className="mb-2 flex flex-wrap items-center gap-2 rounded-md bg-slate-800 px-3 py-2 text-sm text-white">
          <span>{selectedCount} selected</span>
          {!allMatching && selected.size === items.length && totalCount > items.length && (
            <button className="underline" onClick={() => setAllMatching(true)}>
              Select all {totalCount} matching
            </button>
          )}
          <select
            className="rounded bg-slate-700 px-2 py-1"
            defaultValue=""
            onChange={(e) => {
              if (e.target.value) {
                runBulk(
                  { action: "setCategory", categoryId: e.target.value, ...bulkTarget() },
                  "Recategorized",
                );
                e.target.value = "";
              }
            }}
          >
            <option value="">Set category…</option>
            {categories
              ?.filter((c) => !c.archivedAt)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
          <button
            className="rounded bg-slate-700 px-2 py-1"
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
        <div
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
                  style={{ top: vi.start }}
                >
                  Loading more…
                </div>
              );
            }
            return (
              <TxRow
                key={tx.id}
                tx={tx}
                top={vi.start}
                selected={allMatching || selected.has(tx.id)}
                onToggle={() => toggleSelect(tx.id)}
                onOpen={() => setDrawerTx(tx.id)}
                catName={catName}
                accName={accName}
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
  categories: Array<{ id: string; name: string; archivedAt: string | null }>;
  onUpdate: (
    patch: Partial<{ categoryId: string | null; date: string; amountPaise: number }>,
  ) => void;
}) {
  const [editing, setEditing] = useState<"category" | "date" | "amount" | null>(null);
  const isTransfer = tx.transferLinkId !== null;
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
        <input
          type="date"
          autoFocus
          defaultValue={tx.date}
          onBlur={(e) => {
            onUpdate({ date: e.target.value });
            setEditing(null);
          }}
          className="w-32 rounded border border-slate-300 px-1 py-0.5"
        />
      ) : (
        <button className="w-24 text-left text-slate-500" onClick={() => setEditing("date")}>
          {tx.date}
        </button>
      )}
      <button
        className="min-w-0 flex-1 truncate text-left font-medium text-slate-800"
        onClick={onOpen}
      >
        {tx.merchant || "(no merchant)"}
        {isTransfer && (
          <span className="ml-2 rounded bg-sky-100 px-1.5 py-0.5 text-xs font-normal text-sky-700">
            transfer
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
      <span className="hidden w-32 truncate text-slate-500 md:block">{accName(tx.accountId)}</span>
      {editing === "category" ? (
        <select
          autoFocus
          defaultValue={tx.categoryId ?? ""}
          onBlur={() => setEditing(null)}
          onChange={(e) => {
            onUpdate({ categoryId: e.target.value === "" ? null : e.target.value });
            setEditing(null);
          }}
          className="w-36 rounded border border-slate-300 px-1 py-0.5"
        >
          <option value="">Uncategorized</option>
          {categories
            .filter((c) => !c.archivedAt)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
        </select>
      ) : (
        <button
          className="w-36 truncate text-left text-slate-500"
          onClick={() => setEditing("category")}
        >
          {tx.splits.length > 0 ? "(split)" : catName(tx.categoryId)}
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
    </div>
  );
}

function QuickAdd({ filter }: { filter: TransactionFilter }) {
  const { data: accounts } = useAccounts();
  const { data: categories } = useCategories();
  const { create } = useTransactionMutations(filter);
  const [merchant, setMerchant] = useState("");
  const [amount, setAmount] = useState("");
  const [kind, setKind] = useState<"expense" | "income">("expense");
  const [accountId, setAccountId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const active = accounts?.filter((a) => !a.archivedAt) ?? [];
  const effAccount = accountId || active[0]?.id || "";

  function submit(e: FormEvent) {
    e.preventDefault();
    const rupees = parseFloat(amount);
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
        onChange={(e) => setKind(e.target.value as "expense" | "income")}
        className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
      >
        <option value="expense">Expense</option>
        <option value="income">Income</option>
      </select>
      <input
        placeholder="Merchant"
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
      <input
        type="date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
        className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
      />
      <select
        value={effAccount}
        onChange={(e) => setAccountId(e.target.value)}
        className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
      >
        {active.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
      <select
        value={categoryId}
        onChange={(e) => setCategoryId(e.target.value)}
        className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
      >
        <option value="">Category…</option>
        {categories
          ?.filter((c) => !c.archivedAt && c.kind === kind)
          .map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
      </select>
      <button
        type="submit"
        disabled={create.isPending}
        className="rounded-md bg-slate-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
      >
        Add
      </button>
    </form>
  );
}
