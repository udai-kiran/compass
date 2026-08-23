Implemented P3/P4 pages and corrected the zero-stock display edge case.

Files affected:

- `apps/web/src/routes/shopping/PantryPage.tsx` — full pantry UI; zero quantity displays as “Empty.”
- `apps/web/src/routes/shopping/PriceWatchPage.tsx` — full price-watch UI.

Verification:

```text
$ npm run typecheck
Exit code: 0
All workspace TypeScript checks passed.

$ npm run lint
Exit code: 0
eslint . passed.

$ npm run build -w apps/web
Exit code: 0
vite v8.2.1 building client environment for production...
✓ 356 modules transformed.
✓ built in 178ms
```

Complete diffs:

```diff
diff --git a/apps/web/src/routes/shopping/PantryPage.tsx b/apps/web/src/routes/shopping/PantryPage.tsx
new file mode 100644
index 0000000..4681be6
--- /dev/null
+++ b/apps/web/src/routes/shopping/PantryPage.tsx
@@ -0,0 +1,134 @@
+import { useEffect, useState } from "react";
+import type { CorrectPantry, PantryItemWithHabit } from "@compass/shared";
+import { EmptyState, PageError, PageLoading } from "../../components/States.tsx";
+import { usePantryItems, usePantryMutations } from "../../lib/shopping-queries.ts";
+import { formatConsumptionRate, formatDepletionEstimate } from "./pantry-view.ts";
+
+export function PantryPage() {
+  const pantry = usePantryItems();
+
+  if (pantry.isLoading) return <PageLoading label="Loading pantry…" />;
+  if (pantry.isError) {
+    return (
+      <PageError message="We couldn't load your pantry." onRetry={() => void pantry.refetch()} />
+    );
+  }
+
+  const items = pantry.data?.items ?? [];
+  return (
+    <div className="mx-auto max-w-3xl">
+      <header className="mb-6">
+        <h1 className="text-xl font-semibold text-slate-800">Pantry</h1>
+        <p className="mt-1 text-sm text-slate-500">Estimated stock from your recorded purchases.</p>
+      </header>
+
+      {items.length === 0 ? (
+        <EmptyState
+          title="No pantry items"
+          hint="Items appear here when you mark them bought on a shopping list."
+        />
+      ) : (
+        <div className="space-y-3">
+          {items.map((item) => (
+            <PantryCard key={item.id} item={item} />
+          ))}
+        </div>
+      )}
+    </div>
+  );
+}
+
+function PantryCard({ item }: { item: PantryItemWithHabit }) {
+  const { correct } = usePantryMutations();
+  const [quantityBase, setQuantityBase] = useState(item.quantityBase ?? 0);
+  const [feedback, setFeedback] = useState<string | null>(null);
+  const unit: CorrectPantry["unit"] = item.unit ?? "g";
+
+  useEffect(() => {
+    setQuantityBase(item.quantityBase ?? 0);
+  }, [item.quantityBase]);
+
+  function updateStock() {
+    if (!Number.isSafeInteger(quantityBase) || quantityBase < 0) {
+      setFeedback("Enter a whole quantity of zero or more.");
+      return;
+    }
+    setFeedback(null);
+    correct.mutate(
+      { catalogItemId: item.catalogItemId, body: { quantityBase, unit } },
+      {
+        onSuccess: () => setFeedback("Stock updated. Consumption estimates are refreshing."),
+        onError: (error) =>
+          setFeedback(error instanceof Error ? error.message : "Unable to update pantry stock."),
+      },
+    );
+  }
+
+  return (
+    <article className="card p-4">
+      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
+        <div>
+          <h2 className="font-semibold text-slate-800">{item.canonicalName}</h2>
+          {item.brand && <p className="text-sm text-slate-500">{item.brand}</p>}
+        </div>
+        <dl className="grid grid-cols-1 gap-x-5 gap-y-1 text-sm sm:grid-cols-3">
+          <div>
+            <dt className="text-slate-400">Stock</dt>
+            <dd className="font-medium text-slate-700">
+              {item.quantityBase === null || item.quantityBase === 0
+                ? "Empty"
+                : `${item.quantityBase} ${item.unit}`}
+            </dd>
+          </div>
+          <div>
+            <dt className="text-slate-400">Estimated until</dt>
+            <dd className="font-medium text-slate-700">
+              {formatDepletionEstimate(item.expectedDepletionAt, new Date())}
+            </dd>
+          </div>
+          <div>
+            <dt className="text-slate-400">Consumption</dt>
+            <dd className="font-medium text-slate-700">
+              {item.consumptionBasePerMonth === null
+                ? "Not enough purchase history"
+                : formatConsumptionRate(item.consumptionBasePerMonth, item.consumptionUnit)}
+            </dd>
+          </div>
+        </dl>
+      </div>
+
+      <div className="mt-4 flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3">
+        <label className="text-sm font-medium text-slate-600">
+          Correct stock
+          <span className="mt-1 flex">
+            <input
+              type="number"
+              min="0"
+              step="1"
+              value={quantityBase}
+              onChange={(event) => setQuantityBase(Number(event.target.value))}
+              className="input w-28 rounded-r-none"
+              aria-label={`Correct stock quantity for ${item.canonicalName}`}
+            />
+            <span className="rounded-r-md border border-l-0 border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-500">
+              {unit}
+            </span>
+          </span>
+        </label>
+        <button
+          type="button"
+          className="btn-primary"
+          onClick={updateStock}
+          disabled={correct.isPending}
+        >
+          {correct.isPending ? "Updating…" : "Update"}
+        </button>
+        {feedback && (
+          <p role="status" className="basis-full text-sm text-slate-500">
+            {feedback}
+          </p>
+        )}
+      </div>
+    </article>
+  );
+}
diff --git a/apps/web/src/routes/shopping/PriceWatchPage.tsx b/apps/web/src/routes/shopping/PriceWatchPage.tsx
new file mode 100644
index 0000000..faf9e6b
--- /dev/null
+++ b/apps/web/src/routes/shopping/PriceWatchPage.tsx
@@ -0,0 +1,219 @@
+import { useMemo, useState } from "react";
+import { formatINR } from "@compass/shared";
+import { EmptyState, PageError, PageLoading } from "../../components/States.tsx";
+import {
+  useBuyWait,
+  useHonestyCheck,
+  usePriceHistory,
+  usePriceSources,
+  useShoppingCatalog,
+} from "../../lib/shopping-queries.ts";
+import { LineChart, SERIES } from "../../lib/viz.tsx";
+import { chartDataFromPoints, honestyVerdict, trendLabel } from "./pantry-view.ts";
+
+export function PriceWatchPage() {
+  const [itemId, setItemId] = useState<string | null>(null);
+  const [claimedRupees, setClaimedRupees] = useState("");
+  const [checkedMrpPaise, setCheckedMrpPaise] = useState(0);
+  const catalog = useShoppingCatalog();
+  const sources = usePriceSources();
+  const history = usePriceHistory(itemId);
+  const buyWait = useBuyWait(itemId);
+  const honesty = useHonestyCheck(itemId, checkedMrpPaise);
+  const chart = useMemo(
+    () => chartDataFromPoints(history.data?.points ?? []),
+    [history.data?.points],
+  );
+  const sourceNames = useMemo(
+    () => new Map((sources.data ?? []).map((source) => [source.id, source.name])),
+    [sources.data],
+  );
+
+  function checkHonesty() {
+    const rupees = Number(claimedRupees);
+    setCheckedMrpPaise(Number.isFinite(rupees) && rupees > 0 ? Math.round(rupees * 100) : 0);
+  }
+
+  if (catalog.isLoading) return <PageLoading label="Loading catalog…" />;
+  if (catalog.isError) {
+    return (
+      <PageError message="We couldn't load your catalog." onRetry={() => void catalog.refetch()} />
+    );
+  }
+
+  const items = catalog.data ?? [];
+  return (
+    <div className="mx-auto max-w-3xl">
+      <header className="mb-6">
+        <h1 className="text-xl font-semibold text-slate-800">Price Watch</h1>
+        <p className="mt-1 text-sm text-slate-500">
+          See observed prices before deciding when to buy.
+        </p>
+      </header>
+
+      {items.length === 0 ? (
+        <EmptyState title="No catalog items" hint="Add items to your catalog first." />
+      ) : (
+        <>
+          <label className="block text-sm font-medium text-slate-700">
+            Catalog item
+            <select
+              className="input mt-1 block w-full"
+              value={itemId ?? ""}
+              onChange={(event) => {
+                setItemId(event.target.value || null);
+                setCheckedMrpPaise(0);
+              }}
+            >
+              <option value="">Choose an item…</option>
+              {items.map((item) => (
+                <option key={item.id} value={item.id}>
+                  {item.canonicalName}
+                  {item.brand ? ` · ${item.brand}` : ""}
+                </option>
+              ))}
+            </select>
+          </label>
+
+          {itemId && (
+            <div className="mt-5 space-y-5">
+              <section className="card p-4">
+                <h2 className="font-semibold text-slate-800">Price history</h2>
+                {history.isLoading ? (
+                  <PageLoading label="Loading price history…" />
+                ) : history.isError ? (
+                  <PageError
+                    message="We couldn't load price history."
+                    onRetry={() => void history.refetch()}
+                  />
+                ) : chart.values.length === 0 ? (
+                  <EmptyState title="No price observations" hint="Record prices to see trends." />
+                ) : (
+                  <div className="mt-3">
+                    <LineChart
+                      labels={chart.labels}
+                      series={[{ name: "Observed price", color: SERIES[0], values: chart.values }]}
+                    />
+                    <p className="mt-2 text-xs text-slate-400">
+                      Sources:{" "}
+                      {[
+                        ...new Set(
+                          (history.data?.points ?? []).map(
+                            (point) => sourceNames.get(point.sourceId) ?? "Unknown source",
+                          ),
+                        ),
+                      ].join(", ")}
+                    </p>
+                  </div>
+                )}
+              </section>
+
+              <section className="card p-4">
+                <h2 className="font-semibold text-slate-800">Buy now or wait</h2>
+                {buyWait.isLoading ? (
+                  <PageLoading label="Assessing price trend…" />
+                ) : buyWait.isError ? (
+                  <PageError
+                    message="We couldn't assess the price trend."
+                    onRetry={() => void buyWait.refetch()}
+                  />
+                ) : buyWait.data ? (
+                  <div className="mt-2 text-sm text-slate-600">
+                    {buyWait.data.trend === "insufficient_data" ? (
+                      <p>
+                        Not enough data ({buyWait.data.observationCount} observations,{" "}
+                        {buyWait.data.distinctDayCount} distinct days; need{" "}
+                        {buyWait.data.minObservationsRequired} obs,{" "}
+                        {buyWait.data.distinctDaysRequired} days)
+                      </p>
+                    ) : (
+                      <>
+                        <p className="font-medium text-slate-800">
+                          {trendLabel(buyWait.data.trend, buyWait.data.confidence)}
+                        </p>
+                        {buyWait.data.recommendationPaise !== null && (
+                          <p className="mt-1">
+                            Recommended price: {formatINR(buyWait.data.recommendationPaise)}
+                          </p>
+                        )}
+                      </>
+                    )}
+                  </div>
+                ) : null}
+              </section>
+
+              <section className="card p-4">
+                <h2 className="font-semibold text-slate-800">Was-price honesty check</h2>
+                <div className="mt-3 flex flex-wrap items-end gap-2">
+                  <label className="text-sm font-medium text-slate-600">
+                    Claimed MRP
+                    <span className="mt-1 flex">
+                      <span className="rounded-l-md border border-r-0 border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-500">
+                        ₹
+                      </span>
+                      <input
+                        type="number"
+                        min="0"
+                        step="0.01"
+                        value={claimedRupees}
+                        onChange={(event) => setClaimedRupees(event.target.value)}
+                        className="input w-36 rounded-l-none"
+                        aria-label="Claimed MRP in rupees"
+                      />
+                    </span>
+                  </label>
+                  <button type="button" className="btn-primary" onClick={checkHonesty}>
+                    Check
+                  </button>
+                </div>
+
+                {honesty.isLoading && checkedMrpPaise > 0 ? (
+                  <PageLoading label="Checking observed prices…" />
+                ) : null}
+                {honesty.isError ? (
+                  <PageError
+                    message="We couldn't check this claimed price."
+                    onRetry={() => void honesty.refetch()}
+                  />
+                ) : null}
+                {honesty.data &&
+                  (honesty.data.maxObservedPricePaise === null ? (
+                    <EmptyState
+                      title="No price data"
+                      hint="Record prices first to check honesty."
+                    />
+                  ) : (
+                    <div className="mt-3">
+                      <p className="text-sm font-medium text-slate-700">
+                        {honestyVerdict(
+                          honesty.data.flagged,
+                          honesty.data.maxObservedPricePaise,
+                          honesty.data.claimedMrpPaise,
+                        )}
+                      </p>
+                      <ul className="mt-3 divide-y divide-slate-100 text-sm">
+                        {honesty.data.evidence.map((point, index) => (
+                          <li
+                            key={`${point.sourceId}-${point.observedAt.toISOString()}-${index}`}
+                            className="flex justify-between gap-3 py-2 text-slate-600"
+                          >
+                            <span>
+                              {sourceNames.get(point.sourceId) ?? "Unknown source"} ·{" "}
+                              {point.observedAt.toLocaleDateString("en-IN")}
+                            </span>
+                            <span className="shrink-0 tabular-nums font-medium text-slate-700">
+                              {formatINR(point.pricePaise)}
+                            </span>
+                          </li>
+                        ))}
+                      </ul>
+                    </div>
+                  ))}
+              </section>
+            </div>
+          )}
+        </>
+      )}
+    </div>
+  );
+}
```

No backend, shared-contract, query-hook, navigation, or helper files were changed. The worktree already contained the prerequisite P1/P2 changes; they were left untouched.