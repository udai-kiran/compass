import { Link, useParams } from "react-router";
import { formatINR, type CardActivityTxn } from "@compass/shared";
import { useCardActivity } from "../../lib/card-queries.ts";
import { useCategories } from "../../lib/queries.ts";

export function CardDetailPage() {
  const { accountId } = useParams();
  const { data, isLoading } = useCardActivity(accountId ?? null);
  const { data: categories } = useCategories();
  const catName = (id: string | null) => (id ? (categories?.find((c) => c.id === id)?.name ?? null) : null);

  if (isLoading) return <p className="p-6 text-sm text-slate-400">Loading…</p>;
  if (!data) {
    return (
      <div className="p-6">
        <p className="text-sm text-slate-500">That card no longer exists.</p>
        <Link to="/cards" className="mt-2 inline-block text-sm text-slate-600 underline">
          Back to cards
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <Link to="/cards" className="text-xs text-slate-500 underline">
        ‹ Back to cards
      </Link>
      <header>
        <h1 className="text-lg font-medium text-slate-800">{data.name}</h1>
        <p className="text-xs text-slate-500">
          {[data.bankName, data.last4 && `•• ${data.last4}`].filter(Boolean).join(" · ")}
        </p>
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-4">
          <p className="text-xs font-medium text-rose-700">Total due</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-rose-900">
            {formatINR(data.totalDuePaise)}
          </p>
          <p className="mt-1 text-xs text-rose-700/70">
            {data.dueDate ? `Due by ${data.dueDate}` : "No due date set"}
            {data.statementStart && data.statementEnd
              ? ` · statement ${data.statementStart} → ${data.statementEnd}`
              : ""}
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs font-medium text-slate-500">Recent spends</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-800">
            {formatINR(data.unbilledSpendPaise)}
          </p>
          <p className="mt-1 text-xs text-slate-400">Since the last statement — not billed yet</p>
        </div>
      </div>

      <TxnSection
        title="Recent spends"
        hint="Made after your last statement closed — will appear on the next bill."
        txns={data.unbilled}
        catName={catName}
        empty="Nothing new since your last statement."
      />
      <TxnSection
        title="This statement"
        hint={
          data.statementEnd
            ? `Billed${data.dueDate ? ` · due by ${data.dueDate}` : ""}`
            : "No statement cycle configured for this card."
        }
        txns={data.billed}
        catName={catName}
        empty="No transactions in the last statement period."
      />
    </div>
  );
}

function TxnSection({
  title,
  hint,
  txns,
  catName,
  empty,
}: {
  title: string;
  hint: string;
  txns: CardActivityTxn[];
  catName: (id: string | null) => string | null;
  empty: string;
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white">
      <div className="flex items-baseline justify-between border-b border-slate-100 px-4 py-2.5">
        <div>
          <h2 className="text-sm font-semibold text-slate-700">{title}</h2>
          <p className="text-xs text-slate-400">{hint}</p>
        </div>
        <span className="text-xs text-slate-400">{txns.length} txns</span>
      </div>
      {txns.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-slate-400">{empty}</p>
      ) : (
        <ul>
          {txns.map((t) => (
            <li
              key={t.id}
              className="flex items-center justify-between gap-3 border-b border-slate-50 px-4 py-2 text-sm last:border-0"
            >
              <div className="min-w-0">
                <p className="truncate font-medium text-slate-800">{t.merchant || "—"}</p>
                <p className="text-xs text-slate-400">
                  {t.date}
                  {catName(t.categoryId) ? ` · ${catName(t.categoryId)}` : ""}
                </p>
              </div>
              <span
                className={`shrink-0 tabular-nums ${
                  t.amountPaise >= 0 ? "text-emerald-600" : "text-slate-800"
                }`}
              >
                {t.amountPaise >= 0 ? "+" : "−"}
                {formatINR(Math.abs(t.amountPaise))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
