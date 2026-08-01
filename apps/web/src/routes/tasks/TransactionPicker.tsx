import { useState } from "react";
import { formatDisplayDate, formatINR, type UserTaskTransaction } from "@compass/shared";
import { useTransactionsInfinite } from "../../lib/queries.ts";

export interface TransactionPickerProps {
  /** The currently linked transaction (summary shape), or null when unlinked. */
  selected: UserTaskTransaction | null;
  /** True when the task has a transactionId whose transaction was soft-deleted. */
  linkUnavailable?: boolean;
  onSelect: (txn: UserTaskTransaction) => void;
  onClear: () => void;
  disabled?: boolean;
}

/**
 * Searchable, paginated transaction picker for linking a task to a ledger
 * transaction. Backed by useTransactionsInfinite ({ q: searchText } hits the
 * free-text server filter), so it never loads the ledger unbounded: only the
 * first page renders until the user explicitly asks for more.
 */
export function TransactionPicker({
  selected,
  linkUnavailable = false,
  onSelect,
  onClear,
  disabled = false,
}: TransactionPickerProps) {
  const [search, setSearch] = useState("");
  const {
    data,
    isLoading,
    isError,
    isFetchNextPageError,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
  } = useTransactionsInfinite({ q: search });
  const items = data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <div className="rounded-lg border border-slate-200 p-2">
      {selected ? (
        <div className="mb-2 flex items-center justify-between gap-2 rounded-md bg-brand-50 px-2 py-1.5 text-xs text-brand-900">
          <span className="min-w-0 truncate">
            Linked: {formatDisplayDate(selected.date)} · {selected.merchant} ·{" "}
            {formatINR(selected.amountPaise)}
          </span>
          <button
            type="button"
            disabled={disabled}
            onClick={onClear}
            className="shrink-0 font-medium text-brand-700 underline disabled:opacity-50"
          >
            Clear link
          </button>
        </div>
      ) : linkUnavailable ? (
        <div className="mb-2 flex items-center justify-between gap-2 rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
          <span>Linked transaction unavailable (deleted from the ledger).</span>
          <button
            type="button"
            disabled={disabled}
            onClick={onClear}
            className="shrink-0 font-medium text-amber-800 underline disabled:opacity-50"
          >
            Clear link
          </button>
        </div>
      ) : null}
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search transactions to link…"
        aria-label="Search transactions to link"
        disabled={disabled}
        className="input w-full"
      />
      <div className="mt-2 max-h-48 overflow-y-auto">
        {isLoading && <p className="px-1 py-2 text-xs text-slate-400">Loading…</p>}
        {isError && (
          <p className="px-1 py-2 text-xs text-rose-600">
            Couldn’t search transactions — try again.
          </p>
        )}
        {!isLoading && !isError && items.length === 0 && (
          <p className="px-1 py-2 text-xs text-slate-400">No transactions found.</p>
        )}
        {items.map((t) => (
          <button
            key={t.id}
            type="button"
            disabled={disabled || selected?.id === t.id}
            onClick={() =>
              onSelect({
                id: t.id,
                accountId: t.accountId,
                date: t.date,
                merchant: t.merchant,
                amountPaise: t.amountPaise,
              })
            }
            className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-100 disabled:opacity-50"
          >
            <span className="min-w-0 truncate">
              <span className="text-slate-400">{formatDisplayDate(t.date)}</span> · {t.merchant}
            </span>
            <span className="shrink-0 tabular-nums">{formatINR(t.amountPaise)}</span>
          </button>
        ))}
        {hasNextPage && (
          <button
            type="button"
            disabled={disabled || isFetchingNextPage}
            onClick={() => void fetchNextPage()}
            className="w-full rounded-md px-2 py-1.5 text-center text-xs font-medium text-brand-700 underline disabled:opacity-50"
          >
            {isFetchingNextPage ? "Loading…" : "Load more"}
          </button>
        )}
        {isFetchNextPageError && (
          <p className="px-1 py-2 text-center text-xs text-rose-600">
            Couldn’t load more transactions — try again.
          </p>
        )}
      </div>
    </div>
  );
}
