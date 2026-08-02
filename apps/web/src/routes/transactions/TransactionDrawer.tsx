import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  effectiveNecessity,
  formatDisplayDate,
  formatINR,
  TransactionSchema,
  type ExpenseNecessity,
  type TransactionFilter,
} from "@compass/shared";
import { apiGet } from "../../lib/api.ts";
import { CategoryPicker } from "../../components/CategoryPicker.tsx";
import { toast } from "../../lib/toast.tsx";
import {
  useAttachmentMutations,
  useAttachments,
  useCategories,
  useTransactionLinkMutations,
  useTransactionLinks,
  useTransactionMutations,
  useTransferMutations,
  useTransferSuggestions,
} from "../../lib/queries.ts";
import { useRecurring } from "../../lib/budget-queries.ts";
import { useResources } from "../../lib/resource-queries.ts";

export function TransactionDrawer({
  id,
  filter,
  onClose,
}: {
  id: string;
  filter: TransactionFilter;
  onClose: () => void;
}) {
  const { data: tx } = useQuery({
    queryKey: ["transaction", id],
    queryFn: () => apiGet(`/api/transactions/${id}`, TransactionSchema),
  });
  const qc = useQueryClient();
  const { data: categories } = useCategories();
  const { setSplits, update, remove } = useTransactionMutations(filter);
  const { link, unlink } = useTransferMutations();
  const { data: suggestions } = useTransferSuggestions();
  const { data: attachments } = useAttachments(id);
  const attMut = useAttachmentMutations(id);
  const { data: links } = useTransactionLinks(id);
  const linkMut = useTransactionLinkMutations(id);
  const { data: resources } = useResources();
  const { data: recurring } = useRecurring();

  const [rows, setRows] = useState<Array<{ categoryId: string; amountRupees: string; note: string }>>([]);
  const [notes, setNotes] = useState("");
  const [resourceId, setResourceId] = useState<string | null>(null);
  const [recurringTemplateId, setRecurringTemplateId] = useState<string | null>(null);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkTitle, setLinkTitle] = useState("");

  useEffect(() => {
    if (tx) {
      setRows(
        tx.splits.map((s) => ({
          categoryId: s.categoryId,
          amountRupees: (s.amountPaise / 100).toFixed(2),
          note: s.note,
        })),
      );
      setNotes(tx.notes);
      setResourceId(tx.resourceId);
      setRecurringTemplateId(tx.recurringTemplateId);
    }
  }, [tx]);

  if (!tx) return null;

  const splitTotal = rows.reduce((s, r) => s + Math.round(parseFloat(r.amountRupees || "0") * 100), 0);
  const remainder = tx.amountPaise - splitTotal;
  const balanced = rows.length === 0 || remainder === 0;
  const suggestion = suggestions?.find(
    (s) => s.outTransactionId === tx.id || s.inTransactionId === tx.id,
  );
  const txCategory = tx.categoryId ? categories?.find((c) => c.id === tx.categoryId) : undefined;
  const categoryDefault = txCategory
    ? effectiveNecessity(null, txCategory.necessity ?? null, txCategory.kind ?? null)
    : null;
  const inheritLabel =
    tx.splits.length > 0
      ? "Inherit (each split uses its own category)"
      : tx.categoryId === null
        ? "Inherit (uncategorized — not set)"
        : `Inherit from ${txCategory?.name ?? "…"} (${
            categoryDefault === "essential"
              ? "Essential"
              : categoryDefault === "non_essential"
                ? "Non-essential"
                : "not set"
          })`;

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/30" onClick={onClose}>
      <div
        className="h-full w-full max-w-md overflow-y-auto bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-800">{tx.merchant || "(no merchant)"}</h2>
            <p className="text-sm text-slate-500">
              {formatDisplayDate(tx.date)} · {formatINR(tx.amountPaise)} · {tx.source}
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>

        {/* Notes */}
        <label className="mt-4 block text-sm font-medium text-slate-700">
          Notes
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={() => {
              if (notes !== tx.notes) update.mutate({ id: tx.id, notes });
            }}
            rows={2}
            className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          />
        </label>

        <section className="mt-5">
          <h3 className="text-sm font-semibold text-slate-700">Necessity</h3>
          <p className="mt-0.5 text-xs text-slate-500">
            Is this particular spend a need or a want? Leave it on inherit to use the category’s
            default.
          </p>
          <select
            value={tx.necessity ?? ""}
            onChange={(e) =>
              update.mutate(
                { id: tx.id, necessity: (e.target.value || null) as ExpenseNecessity | null },
                {
                  onSuccess: () => {
                    toast("Saved", "success");
                    void qc.invalidateQueries({ queryKey: ["transaction", id] });
                  },
                },
              )
            }
            className="input mt-1 w-full"
          >
            <option value="">{inheritLabel}</option>
            <option value="essential">Essential</option>
            <option value="non_essential">Non-essential</option>
          </select>
        </section>

        <section className="mt-5">
          <h3 className="text-sm font-semibold text-slate-700">Asset or connection</h3>
          <select
            value={resourceId ?? ""}
            onChange={(e) => setResourceId(e.target.value || null)}
            className="input mt-1 w-full"
          >
            <option value="">Not linked</option>
            {resources?.filter((resource) => !resource.archived).map((resource) => (
              <option key={resource.id} value={resource.id}>
                {resource.name}{resource.identifier ? ` · ${resource.identifier}` : ""}
              </option>
            ))}
          </select>
          <h3 className="mt-3 text-sm font-semibold text-slate-700">Bill or subscription</h3>
          <select
            value={recurringTemplateId ?? ""}
            onChange={(e) => {
              const newRecurringTemplateId = e.target.value || null;
              setRecurringTemplateId(newRecurringTemplateId);
              const template = recurring?.find((item) => item.id === newRecurringTemplateId);
              if (template?.resourceId) {
                setResourceId(template.resourceId);
              }
            }}
            className="input mt-1 w-full"
          >
            <option value="">Not linked</option>
            {recurring?.map((template) => (
              <option key={template.id} value={template.id}>{template.merchant} · {template.frequency}</option>
            ))}
          </select>
          <button
            disabled={update.isPending || (resourceId === tx.resourceId && recurringTemplateId === tx.recurringTemplateId)}
            onClick={() =>
              update.mutate(
                { id: tx.id, resourceId, recurringTemplateId },
                {
                  onSuccess: () => {
                    toast("Saved", "success");
                    void qc.invalidateQueries({ queryKey: ["transaction", id] });
                  },
                },
              )
            }
            className="mt-2 rounded-md bg-brand-600 px-3 py-1.5 text-sm text-white disabled:opacity-40"
          >
            Save
          </button>
        </section>

        {/* Transfer */}
        <section className="mt-5">
          <h3 className="text-sm font-semibold text-slate-700">Transfer</h3>
          {tx.transferLinkId ? (
            <div className="mt-1 flex items-center gap-2 text-sm text-sky-700">
              Linked as a transfer — excluded from income/expense.
              <button
                className="text-slate-500 underline"
                onClick={() => unlink.mutate(tx.transferLinkId!, { onSuccess: () => toast("Transfer unlinked", "success") })}
              >
                Unlink
              </button>
            </div>
          ) : suggestion ? (
            <div className="mt-1 flex items-center gap-2 text-sm text-slate-600">
              Possible transfer match ({suggestion.daysApart}d apart).
              <button
                className="rounded bg-sky-600 px-2 py-0.5 text-white"
                onClick={() =>
                  link.mutate(
                    {
                      outTransactionId: suggestion.outTransactionId,
                      inTransactionId: suggestion.inTransactionId,
                    },
                    { onSuccess: () => toast("Linked as transfer", "success") },
                  )
                }
              >
                Link
              </button>
            </div>
          ) : (
            <p className="mt-1 text-sm text-slate-400">No transfer match suggested.</p>
          )}
        </section>

        {/* Splits */}
        <section className="mt-5">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-700">Splits</h3>
            <button
              className="text-sm text-slate-500 underline"
              onClick={() => setRows([...rows, { categoryId: categories?.[0]?.id ?? "", amountRupees: (remainder / 100).toFixed(2), note: "" }])}
            >
              Add split
            </button>
          </div>
          {rows.map((row, i) => (
            <div key={i} className="mt-2 flex items-center gap-2">
              <CategoryPicker
                categories={categories ?? []}
                value={row.categoryId || null}
                onChange={(id) =>
                  setRows(rows.map((r, j) => (j === i ? { ...r, categoryId: id ?? "" } : r)))
                }
                placeholder="Category…"
                className="flex-1"
              />
              <input
                value={row.amountRupees}
                onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, amountRupees: e.target.value } : r)))}
                className="w-24 rounded-md border border-slate-300 px-2 py-1 text-right text-sm"
              />
              <button className="text-slate-400" onClick={() => setRows(rows.filter((_, j) => j !== i))}>✕</button>
            </div>
          ))}
          {rows.length > 0 && (
            <p className={`mt-2 text-sm ${balanced ? "text-emerald-600" : "text-red-600"}`}>
              {balanced ? "Balanced" : `Remainder: ${formatINR(remainder)}`}
            </p>
          )}
          <button
            disabled={!balanced || setSplits.isPending}
            onClick={() =>
              setSplits.mutate(
                {
                  id: tx.id,
                  splits: rows.map((r) => ({
                    categoryId: r.categoryId,
                    amountPaise: Math.round(parseFloat(r.amountRupees) * 100),
                    note: r.note,
                  })),
                },
                { onSuccess: () => toast("Splits saved", "success") },
              )
            }
            className="mt-2 rounded-md bg-brand-600 px-3 py-1.5 text-sm text-white disabled:opacity-40"
          >
            Save splits
          </button>
        </section>

        {/* Attachments */}
        <section className="mt-5">
          <h3 className="text-sm font-semibold text-slate-700">Receipts</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            {attachments?.map((a) => (
              <div key={a.id} className="w-24">
                <a href={`/api/attachments/${a.id}`} target="_blank" rel="noreferrer">
                  {a.mimeType.startsWith("image/") ? (
                    <img src={`/api/attachments/${a.id}`} alt={a.fileName} className="h-20 w-24 rounded border border-slate-200 object-cover" />
                  ) : (
                    <div className="flex h-20 w-24 items-center justify-center rounded border border-slate-200 text-2xl">📄</div>
                  )}
                </a>
                <button
                  className="mt-0.5 w-full truncate text-xs text-slate-400 hover:text-red-600"
                  title={a.fileName}
                  onClick={() => attMut.remove.mutate(a.id)}
                >
                  ✕ {a.fileName}
                </button>
              </div>
            ))}
          </div>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            className="mt-2 block text-sm text-slate-500"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) attMut.upload.mutate(f, { onSuccess: () => toast("Receipt attached", "success") });
              e.target.value = "";
            }}
          />
        </section>

        {/* Links */}
        <section className="mt-5">
          <h3 className="text-sm font-semibold text-slate-700">Links</h3>
          <div className="mt-2 space-y-1">
            {links?.map((link) => {
              const hostname = (() => {
                try {
                  return new URL(link.url).hostname;
                } catch {
                  return link.url;
                }
              })();
              const displayText = link.title || hostname;
              return (
                <div key={link.id} className="flex items-center gap-2 rounded border border-slate-200 bg-slate-50 px-2 py-1.5">
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 truncate text-sm text-sky-600 hover:underline"
                    title={link.url}
                  >
                    {displayText}
                  </a>
                  <button
                    className="text-slate-400 hover:text-red-600"
                    onClick={() => linkMut.remove.mutate(link.id, {
                      onError: (error) => {
                        toast(error instanceof Error ? error.message : "Failed to remove link", "error");
                      },
                    })}
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
          <div className="mt-2 space-y-2">
            <input
              type="url"
              placeholder="https://..."
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              required
            />
            <input
              type="text"
              placeholder="Label (optional)"
              value={linkTitle}
              onChange={(e) => setLinkTitle(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
            <button
              disabled={linkMut.add.isPending || !linkUrl}
              onClick={() => {
                linkMut.add.mutate(
                  { url: linkUrl, title: linkTitle || undefined },
                  {
                    onSuccess: () => {
                      setLinkUrl("");
                      setLinkTitle("");
                      toast("Link added", "success");
                    },
                    onError: (error) => {
                      toast(error instanceof Error ? error.message : "Failed to add link", "error");
                    },
                  },
                );
              }}
              className="rounded-md bg-brand-600 px-3 py-1.5 text-sm text-white disabled:opacity-40"
            >
              Add link
            </button>
          </div>
        </section>

        <button
          className="mt-8 w-full rounded-md border border-red-200 py-2 text-sm text-red-600 hover:bg-red-50"
          onClick={() =>
            remove.mutate(tx.id, {
              onSuccess: () => {
                toast("Transaction deleted", "success");
                onClose();
              },
            })
          }
        >
          Delete transaction
        </button>
      </div>
    </div>
  );
}
