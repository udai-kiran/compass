/**
 * Cart Review Screen (task 12.2).
 *
 * Shows the user's active cart draft(s) with editable items, per-source grouping,
 * financial guards, and escape hatches. Nothing is ordered or paid — this is a
 * shopping guide only.
 *
 * Structural pattern follows InboxPage: pre-filled editable cards, review-then-accept.
 */

import { useEffect, useRef, useState } from "react";
import {
  formatINR,
  type CartDraftItem,
  type CartDraftWithItems,
  type CatalogItem,
  type NormalizedUnitInfo,
  type PriceSource,
} from "@compass/shared";
import { useMe } from "../../lib/auth.ts";
import { toast } from "../../lib/toast.tsx";
import { EmptyState, PageError, PageLoading } from "../../components/States.tsx";
import {
  useCartDraftMutations,
  useCartDrafts,
  useFinancialGuards,
  usePriceSources,
  useShoppingCatalog,
  useShoppingUnits,
} from "../../lib/shopping-queries.ts";
import {
  draftSummary,
  groupItemsBySource,
  guardSummaryText,
  itemDisplayName,
  priceLine,
  type SourceGroup,
} from "./cart-view.ts";

// ─── CartPage ─────────────────────────────────────────────────────────────────

export function CartPage() {
  const { data: me } = useMe();
  const isDemo = me?.isDemo ?? false;

  const draftsQuery = useCartDrafts();
  const sourcesQuery = usePriceSources();
  const catalogQuery = useShoppingCatalog();
  const { generate } = useCartDraftMutations();

  // Drafts list failure → page error.
  if (draftsQuery.isLoading) return <PageLoading label="Loading cart…" />;
  if (draftsQuery.isError)
    return (
      <PageError
        message="Could not load cart drafts. Please try again."
        onRetry={() => void draftsQuery.refetch()}
      />
    );

  const allDrafts = draftsQuery.data?.drafts ?? [];
  const activeDrafts = allDrafts.filter((d) => d.status === "draft");

  // Build sources map (failure is degraded, not page-level error).
  const sourcesMap = new Map<string, PriceSource>(
    (sourcesQuery.data ?? []).map((s) => [s.id, s]),
  );

  // Build catalog map (failure is degraded — item names show "unavailable").
  const catalogMap = new Map<string, CatalogItem>(
    (catalogQuery.data ?? []).map((c) => [c.id, c]),
  );
  const catalogUnavailable = catalogQuery.isError;

  return (
    <div className="mx-auto max-w-3xl">
      {/* Header */}
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-800">Cart</h1>
        <button
          onClick={() =>
            generate.mutate(undefined, {
              onSuccess: () => toast("Draft cart ready", "success"),
            })
          }
          disabled={isDemo || generate.isPending}
          className="rounded-md bg-brand-600 px-4 py-1.5 text-sm text-white hover:bg-brand-700 disabled:opacity-40"
          title={isDemo ? "Demo mode — changes disabled" : undefined}
        >
          {generate.isPending ? "Generating…" : "Generate draft"}
        </button>
      </header>

      {isDemo && (
        <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
          Demo mode — changes disabled.
        </p>
      )}

      {/* No drafts at all / only non-draft drafts → EmptyState */}
      {activeDrafts.length === 0 && (
        <EmptyState
          title="No draft carts"
          hint="Generate a draft cart based on your pantry and shopping habits. Nothing is ordered automatically."
          action={
            <button
              onClick={() =>
                generate.mutate(undefined, {
                  onSuccess: () => toast("Draft cart ready", "success"),
                })
              }
              disabled={isDemo || generate.isPending}
              className="rounded-md bg-brand-600 px-4 py-1.5 text-sm text-white disabled:opacity-40"
            >
              {generate.isPending ? "Generating…" : "Generate draft"}
            </button>
          }
        />
      )}

      {/* Active drafts */}
      {activeDrafts.map((draft) => (
        <DraftCard
          key={draft.id}
          draft={draft}
          sourcesMap={sourcesMap}
          catalogMap={catalogMap}
          catalogUnavailable={catalogUnavailable}
          sourcesStatus={{
            isSuccess: sourcesQuery.isSuccess,
            isLoading: sourcesQuery.isLoading,
            isError: sourcesQuery.isError,
          }}
          isDemo={isDemo}
        />
      ))}

      {/* Disclaimer copy */}
      {activeDrafts.length > 0 && (
        <p className="mt-4 text-xs text-slate-400">
          This is a shopping guide — nothing is ordered or paid. Prices are from the time this draft
          was generated. Budget impact excludes delivery fees. Total is based on suggested prices and
          is not adjusted for quantity changes.
        </p>
      )}
    </div>
  );
}

// ─── DraftCard ────────────────────────────────────────────────────────────────

function DraftCard({
  draft,
  sourcesMap,
  catalogMap,
  catalogUnavailable,
  sourcesStatus,
  isDemo,
}: {
  draft: CartDraftWithItems;
  sourcesMap: Map<string, PriceSource>;
  catalogMap: Map<string, CatalogItem>;
  catalogUnavailable: boolean;
  sourcesStatus: { isSuccess: boolean; isLoading: boolean; isError: boolean };
  isDemo: boolean;
}) {
  const [showAbandonDialog, setShowAbandonDialog] = useState(false);
  const abandonBtnRef = useRef<HTMLButtonElement>(null);
  const { updateItem, abandon, accept } = useCartDraftMutations();

  const summary = draftSummary(draft);
  const groups = groupItemsBySource(draft.items, sourcesMap);

  // Financial guards — uses active total (not including delivery fees, documented)
  const guardsQuery = useFinancialGuards(summary.totalPaise);
  const guards = guardsQuery.data
    ? guardSummaryText(guardsQuery.data)
    : null;

  const allRemoved = summary.activeItems === 0 && summary.totalItems > 0;
  const canAccept = summary.activeItems > 0 && !isDemo;

  function handleAbandon() {
    setShowAbandonDialog(false);
    abandon.mutate(draft.id, {
      onSuccess: () => toast("Draft abandoned", "success"),
    });
  }

  function handleAccept() {
    accept.mutate(draft.id, {
      onSuccess: () => toast("Draft accepted as shopping guide", "success"),
    });
  }

  // Escape closes abandon dialog
  useEffect(() => {
    if (!showAbandonDialog) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setShowAbandonDialog(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [showAbandonDialog]);

  return (
    <section className="mb-6 rounded-lg border border-slate-200 bg-white shadow-sm">
      {/* Draft header */}
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <div>
          <span className="text-sm font-medium text-slate-700">
            Draft cart
          </span>
          <span className="ml-2 text-xs text-slate-400">
            Generated {draft.generatedAt.toLocaleDateString()}
          </span>
        </div>
        <span className="rounded bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
          draft
        </span>
      </div>

      {/* Guard banner */}
      {(summary.totalPaise > 0 || summary.unpricedCount > 0) && (
        <div className="border-b border-slate-100 bg-slate-50 px-4 py-3">
          {summary.totalPaise > 0 && guardsQuery.isLoading && (
            <p className="text-xs text-slate-400">Loading financial summary…</p>
          )}
          {summary.totalPaise > 0 && guardsQuery.isError && (
            <p className="text-xs text-rose-600">Could not load financial summary.</p>
          )}
          {summary.totalPaise > 0 && guards !== null && (
            <div aria-live="polite" className="space-y-1 text-xs">
              {guards.budgetLine && (
                <p className={guards.hasOverage ? "font-medium text-rose-700" : "text-emerald-700"}>
                  Budget: {guards.budgetLine}
                  <span className="ml-1 text-slate-400">(excludes delivery fees)</span>
                </p>
              )}
              {guards.goalLines.length > 0 && (
                <ul className="mt-1 space-y-0.5 text-amber-700">
                  {guards.goalLines.map((line) => (
                    <li key={line}>Goal: {line}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {summary.unpricedCount > 0 && (
            <p className="text-slate-500">
              Budget impact based on {summary.activeItems - summary.unpricedCount} of{" "}
              {summary.activeItems} priced items.
            </p>
          )}
        </div>
      )}

      {/* Items — zero items state */}
      {draft.items.length === 0 && (
        <div className="px-4 py-8 text-center text-sm text-slate-400">
          No items need replenishment.
        </div>
      )}

      {/* Items grouped by source */}
      {groups.map((group) => (
        <SourceGroupSection
          key={group.sourceId ?? "__unknown__"}
          group={group}
          draft={draft}
          sourcesMap={sourcesMap}
          catalogMap={catalogMap}
          catalogUnavailable={catalogUnavailable}
          sourcesStatus={sourcesStatus}
          isDemo={isDemo}
          updateItem={updateItem}
        />
      ))}

      {/* Summary bar */}
      {draft.items.length > 0 && (
        <div className="border-t border-slate-100 bg-slate-50 px-4 py-2">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>
              {summary.activeItems} active · {summary.removedCount} removed
              {summary.hasSubstitutions && " · includes substitutions"}
            </span>
            <span className="font-medium text-slate-700">
              {formatINR(summary.totalPaise)}
            </span>
          </div>
          {allRemoved && (
            <p className="mt-1 text-xs text-amber-600">
              All items removed — undo some to enable Accept.
            </p>
          )}
        </div>
      )}

      {/* Card recommendations note */}
      <div className="border-t border-slate-100 px-4 py-2">
        <p className="text-xs text-slate-400">
          Card recommendations available when linked to a shopping list.
        </p>
      </div>

      {/* Action bar */}
      <div className="flex items-center gap-2 border-t border-slate-100 px-4 py-3">
        <button
          onClick={handleAccept}
          disabled={!canAccept || accept.isPending}
          className="rounded-md bg-brand-600 px-4 py-1.5 text-sm text-white hover:bg-brand-700 disabled:opacity-40"
          title={
            isDemo
              ? "Demo mode — changes disabled"
              : allRemoved
              ? "All items removed — undo some to accept"
              : undefined
          }
        >
          {accept.isPending ? "Accepting…" : "Accept as shopping guide"}
        </button>
        <button
          ref={abandonBtnRef}
          onClick={() => setShowAbandonDialog(true)}
          disabled={isDemo || abandon.isPending}
          className="rounded-md border border-slate-300 px-4 py-1.5 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-40"
          title={isDemo ? "Demo mode — changes disabled" : undefined}
        >
          Abandon
        </button>
      </div>

      {/* Abandon confirmation dialog */}
      {showAbandonDialog && (
        <AbandonDialog
          onConfirm={handleAbandon}
          onCancel={() => {
            setShowAbandonDialog(false);
            abandonBtnRef.current?.focus();
          }}
        />
      )}
    </section>
  );
}

// ─── SourceGroupSection ───────────────────────────────────────────────────────

function SourceGroupSection({
  group,
  draft,
  sourcesMap,
  catalogMap,
  catalogUnavailable,
  sourcesStatus,
  isDemo,
  updateItem,
}: {
  group: SourceGroup;
  draft: CartDraftWithItems;
  sourcesMap: Map<string, PriceSource>;
  catalogMap: Map<string, CatalogItem>;
  catalogUnavailable: boolean;
  sourcesStatus: { isSuccess: boolean; isLoading: boolean; isError: boolean };
  isDemo: boolean;
  updateItem: ReturnType<typeof useCartDraftMutations>["updateItem"];
}) {
  const { data: unitsData } = useShoppingUnits();
  const units = unitsData?.units ?? [];
  const groupHasSuggestedSource = group.items.some((item) => item.suggestedSourceId !== null);

  return (
    <div className="border-b border-slate-100 last:border-b-0">
      {/* Source header */}
      <div className="flex flex-wrap items-center gap-2 bg-slate-50 px-4 py-2 text-xs">
        <span className="font-medium text-slate-700">{group.sourceName}</span>
        {sourcesStatus.isSuccess && !group.isActive && group.sourceId !== null && (
          <span className="rounded bg-rose-50 px-1.5 py-0.5 text-rose-600">Inactive</span>
        )}
        {groupHasSuggestedSource && sourcesStatus.isLoading && (
          <span className="text-slate-400">Loading source details…</span>
        )}
        {groupHasSuggestedSource && sourcesStatus.isError && (
          <span className="text-amber-700">Source details unavailable</span>
        )}
        <span className="font-medium text-slate-600">{formatINR(group.subtotalPaise)}</span>
        {group.deliveryFeePaise !== null && (
          <span className="text-slate-400">
            + {formatINR(group.deliveryFeePaise)} delivery
          </span>
        )}
        {group.minCartPaise !== null && (
          <span className="text-slate-400">
            min {formatINR(group.minCartPaise)}
          </span>
        )}
        {group.deliveryEtaBand !== null && (
          <span className="text-slate-400">{group.deliveryEtaBand}</span>
        )}
      </div>

      {/* Item cards */}
      <ul>
        {group.items.map((item) => (
          <CartItemRow
            key={item.id}
            item={item}
            draftId={draft.id}
            sourcesMap={sourcesMap}
            catalogMap={catalogMap}
            catalogUnavailable={catalogUnavailable}
            units={units}
            isDemo={isDemo}
            updateItem={updateItem}
          />
        ))}
      </ul>
    </div>
  );
}

// ─── CartItemRow ──────────────────────────────────────────────────────────────

function CartItemRow({
  item,
  draftId,
  sourcesMap,
  catalogMap,
  catalogUnavailable,
  units,
  isDemo,
  updateItem,
}: {
  item: CartDraftItem;
  draftId: string;
  sourcesMap: Map<string, PriceSource>;
  catalogMap: Map<string, CatalogItem>;
  catalogUnavailable: boolean;
  units: NormalizedUnitInfo[];
  isDemo: boolean;
  updateItem: ReturnType<typeof useCartDraftMutations>["updateItem"];
}) {
  const [qty, setQty] = useState(String(item.quantityBase ?? ""));
  const [unit, setUnit] = useState(item.unit ?? "");
  const busy = updateItem.isPending;

  // Mutations refetch the draft. Keep an editor that remained mounted aligned
  // with the newly persisted quantity/unit pair (including changes from elsewhere).
  useEffect(() => {
    setQty(String(item.quantityBase ?? ""));
    setUnit(item.unit ?? "");
  }, [item.quantityBase, item.unit]);

  const displayName = catalogUnavailable
    ? "Item names unavailable"
    : itemDisplayName(item, catalogMap);

  const pl = priceLine(item, sourcesMap);

  function restorePersistedQuantity() {
    setQty(String(item.quantityBase ?? ""));
    setUnit(item.unit ?? "");
  }

  function validQuantity(): number | null {
    const parsed = Number(qty);
    return qty.trim() !== "" && Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }

  function handleQtyBlur() {
    const newQty = validQuantity();
    if (newQty === null) {
      restorePersistedQuantity();
      return;
    }
    const newUnit = unit as "g" | "ml" | "piece";
    if (newQty === item.quantityBase && newUnit === item.unit) return;
    updateItem.mutate({
      draftId,
      itemId: item.id,
      body: { quantityBase: newQty, unit: newUnit, isRemoved: item.isRemoved },
    });
  }

  function handleUnitChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const newUnit = e.target.value as "g" | "ml" | "piece";
    setUnit(newUnit);
    const newQty = validQuantity();
    if (newQty === null) {
      restorePersistedQuantity();
      return;
    }
    updateItem.mutate({
      draftId,
      itemId: item.id,
      body: { quantityBase: newQty, unit: newUnit, isRemoved: item.isRemoved },
    });
  }

  function handleToggleRemove() {
    updateItem.mutate({
      draftId,
      itemId: item.id,
      body: {
        quantityBase: item.quantityBase,
        unit: item.unit,
        isRemoved: !item.isRemoved,
      },
    });
  }

  function handleSetQuantity() {
    setQty("1");
    setUnit("piece");
    updateItem.mutate({
      draftId,
      itemId: item.id,
      body: { quantityBase: 1, unit: "piece", isRemoved: item.isRemoved },
    });
  }

  return (
    <li
      className={`flex flex-wrap items-start gap-3 px-4 py-3 text-sm ${item.isRemoved ? "opacity-50" : ""}`}
    >
      <div className="min-w-0 flex-1">
        {/* Item name + substitution badge */}
        <div className="flex items-center gap-2">
          <span
            className={`font-medium text-slate-800 ${item.isRemoved ? "line-through text-slate-400" : ""}`}
          >
            {displayName}
          </span>
          {item.substitutionForItemId && (
            <span className="shrink-0 rounded bg-indigo-50 px-1.5 py-0.5 text-xs text-indigo-700">
              substitution
              {item.priceDeltaPaise !== null && item.priceDeltaPaise !== 0 && (
                <span className="ml-1">
                  ({item.priceDeltaPaise > 0 ? "+" : ""}
                  {formatINR(item.priceDeltaPaise)})
                </span>
              )}
            </span>
          )}
        </div>

        {/* Reason */}
        <p className="mt-0.5 text-xs text-slate-400">{item.reason}</p>

        {/* Price provenance */}
        <p className="mt-0.5 text-xs text-slate-400">
          {item.suggestedPricePaise !== null ? (
            <>
              {pl.priceText}{" "}
              <span className="text-slate-300">·</span>{" "}
              {pl.sourceText}{" "}
              <span className="text-slate-300">·</span>{" "}
              {pl.caveat}
            </>
          ) : (
            <span className="text-slate-300">No price available</span>
          )}
        </p>
      </div>

      {/* Quantity + unit editor */}
      {!item.isRemoved && item.quantityBase !== null && (
        <div className="flex shrink-0 items-center gap-1">
          <label htmlFor={`qty-${item.id}`} className="sr-only">
            Quantity for {displayName}
          </label>
          <input
            id={`qty-${item.id}`}
            type="number"
            min={1}
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            onBlur={handleQtyBlur}
            disabled={isDemo || busy}
            className="w-16 rounded border border-slate-300 px-2 py-1 text-xs disabled:opacity-50"
            aria-label={`Quantity for ${displayName}`}
          />
          <label htmlFor={`unit-${item.id}`} className="sr-only">
            Unit for {displayName}
          </label>
          <select
            id={`unit-${item.id}`}
            value={unit}
            onChange={handleUnitChange}
            disabled={isDemo || busy}
            className="rounded border border-slate-300 px-1 py-1 text-xs disabled:opacity-50"
            aria-label={`Unit for ${displayName}`}
          >
            {units.map((u) => (
              <option key={u.unit} value={u.unit}>
                {u.label}
              </option>
            ))}
            {/* Fallback if units not yet loaded */}
            {units.length === 0 && <option value={unit}>{unit}</option>}
          </select>
        </div>
      )}
      {!item.isRemoved && item.quantityBase === null && (
        <div className="flex shrink-0 items-center gap-1 text-xs text-slate-500">
          <span>Qty not set</span>
          <button
            onClick={handleSetQuantity}
            disabled={isDemo || busy}
            className="text-brand-600 hover:underline disabled:opacity-40"
          >
            Edit
          </button>
        </div>
      )}

      {/* Remove / Undo */}
      <button
        onClick={handleToggleRemove}
        disabled={isDemo || busy}
        className="shrink-0 text-xs text-slate-500 hover:text-slate-800 hover:underline disabled:opacity-40"
        aria-label={item.isRemoved ? `Undo remove ${displayName}` : `Remove ${displayName}`}
      >
        {item.isRemoved ? "Undo" : "Remove"}
      </button>
    </li>
  );
}

// ─── AbandonDialog ────────────────────────────────────────────────────────────

function AbandonDialog({
  onConfirm,
  onCancel,
}: {
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  // Auto-focus confirm button on mount.
  useEffect(() => {
    confirmRef.current?.focus();
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40"
      role="dialog"
      aria-modal="true"
      aria-label="Abandon draft cart"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold text-slate-800">Abandon this draft?</h2>
        <p className="mt-1 text-sm text-slate-500">
          The draft will be marked as abandoned and removed from your active carts. You can
          generate a new draft at any time.
        </p>
        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-md border border-slate-300 px-4 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            ref={confirmRef}
            onClick={onConfirm}
            className="rounded-md bg-rose-600 px-4 py-1.5 text-sm text-white hover:bg-rose-700"
          >
            Abandon
          </button>
        </div>
      </div>
    </div>
  );
}
