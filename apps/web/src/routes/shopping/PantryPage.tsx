import { useEffect, useState } from "react";
import type { CorrectPantry, PantryItemWithHabit } from "@compass/shared";
import { EmptyState, PageError, PageLoading } from "../../components/States.tsx";
import { usePantryItems, usePantryMutations } from "../../lib/shopping-queries.ts";
import { formatConsumptionRate, formatDepletionEstimate } from "./pantry-view.ts";

export function PantryPage() {
  const pantry = usePantryItems();

  if (pantry.isLoading) return <PageLoading label="Loading pantry…" />;
  if (pantry.isError) {
    return (
      <PageError message="We couldn't load your pantry." onRetry={() => void pantry.refetch()} />
    );
  }

  const items = pantry.data?.items ?? [];
  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-6">
        <h1 className="text-xl font-semibold text-slate-800">Pantry</h1>
        <p className="mt-1 text-sm text-slate-500">Estimated stock from your recorded purchases.</p>
      </header>

      {items.length === 0 ? (
        <EmptyState
          title="No pantry items"
          hint="Items appear here when you mark them bought on a shopping list."
        />
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <PantryCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}

function PantryCard({ item }: { item: PantryItemWithHabit }) {
  const { correct } = usePantryMutations();
  const [quantityBase, setQuantityBase] = useState(item.quantityBase ?? 0);
  const [feedback, setFeedback] = useState<string | null>(null);
  const unit: CorrectPantry["unit"] = item.unit ?? "g";

  useEffect(() => {
    setQuantityBase(item.quantityBase ?? 0);
  }, [item.quantityBase]);

  function updateStock() {
    if (!Number.isSafeInteger(quantityBase) || quantityBase < 0) {
      setFeedback("Enter a whole quantity of zero or more.");
      return;
    }
    setFeedback(null);
    correct.mutate(
      { catalogItemId: item.catalogItemId, body: { quantityBase, unit } },
      {
        onSuccess: () => setFeedback("Stock updated. Consumption estimates are refreshing."),
        onError: (error) =>
          setFeedback(error instanceof Error ? error.message : "Unable to update pantry stock."),
      },
    );
  }

  return (
    <article className="card p-4">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div>
          <h2 className="font-semibold text-slate-800">{item.canonicalName}</h2>
          {item.brand && <p className="text-sm text-slate-500">{item.brand}</p>}
        </div>
        <dl className="grid grid-cols-1 gap-x-5 gap-y-1 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-slate-400">Stock</dt>
            <dd className="font-medium text-slate-700">
              {item.quantityBase === null || item.quantityBase === 0
                ? "Empty"
                : `${item.quantityBase} ${item.unit}`}
            </dd>
          </div>
          <div>
            <dt className="text-slate-400">Estimated until</dt>
            <dd className="font-medium text-slate-700">
              {formatDepletionEstimate(item.expectedDepletionAt, new Date())}
            </dd>
          </div>
          <div>
            <dt className="text-slate-400">Consumption</dt>
            <dd className="font-medium text-slate-700">
              {item.consumptionBasePerMonth === null
                ? "Not enough purchase history"
                : formatConsumptionRate(item.consumptionBasePerMonth, item.consumptionUnit)}
            </dd>
          </div>
        </dl>
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3">
        <label className="text-sm font-medium text-slate-600">
          Correct stock
          <span className="mt-1 flex">
            <input
              type="number"
              min="0"
              step="1"
              value={quantityBase}
              onChange={(event) => setQuantityBase(Number(event.target.value))}
              className="input w-28 rounded-r-none"
              aria-label={`Correct stock quantity for ${item.canonicalName}`}
            />
            <span className="rounded-r-md border border-l-0 border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-500">
              {unit}
            </span>
          </span>
        </label>
        <button
          type="button"
          className="btn-primary"
          onClick={updateStock}
          disabled={correct.isPending}
        >
          {correct.isPending ? "Updating…" : "Update"}
        </button>
        {feedback && (
          <p role="status" className="basis-full text-sm text-slate-500">
            {feedback}
          </p>
        )}
      </div>
    </article>
  );
}
