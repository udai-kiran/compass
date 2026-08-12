import { useState } from "react";
import { Link, useParams } from "react-router";
import {
  formatDisplayDate,
  formatINR,
  type CardActivityTxn,
  type CardStatement,
  type StatementReconciliation,
} from "@compass/shared";
import {
  useAbsorbCarryoverMutation,
  useCardActivity,
  useCardStatements,
  useRecomputeReconciliation,
  useReconciliations,
  useStatementMutations,
} from "../../lib/card-queries.ts";
import { useAccounts, useCategories } from "../../lib/queries.ts";
import { DateField } from "../../components/DateField.tsx";
import { reconRowView } from "./reconRowView.ts";

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
            {data.dueDate ? `Due by ${formatDisplayDate(data.dueDate)}` : "No due date set"}
            {data.statementStart && data.statementEnd
              ? ` · statement ${formatDisplayDate(data.statementStart)} → ${formatDisplayDate(data.statementEnd)}`
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
            ? `Billed${data.dueDate ? ` · due by ${formatDisplayDate(data.dueDate)}` : ""}`
            : "No statement cycle configured for this card."
        }
        txns={data.billed}
        catName={catName}
        empty="No transactions in the last statement period."
      />

      <ReconciliationSection accountId={data.accountId} cardName={data.name} />
      <StatementsSection accountId={data.accountId} />
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** "2026-07" → "Jul 2026"; passes anything unexpected through unchanged. */
function formatPeriod(period: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  if (!m) return period;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1));
  return Number.isNaN(d.getTime())
    ? period
    : d.toLocaleString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

/**
 * Statement reconciliation history: what the extractor read off each cycle's
 * statement and how much of that spend is already in the ledger from real-time
 * alerts. Read-only — clearing happens automatically when a statement is
 * processed. `deltaPaise` is the listed spend not yet recorded; unmatched lines
 * are the exceptions worth a look.
 */
function ReconciliationSection({ accountId, cardName }: { accountId: string; cardName: string }) {
  const { data: cycles } = useReconciliations(accountId);
  const recompute = useRecomputeReconciliation(accountId);
  const absorb = useAbsorbCarryoverMutation(accountId);

  return (
    <section className="rounded-lg border border-slate-200 bg-white">
      <div className="flex items-baseline justify-between border-b border-slate-100 px-4 py-2.5">
        <div>
          <h2 className="text-sm font-semibold text-slate-700">Reconciliation</h2>
          <p className="text-xs text-slate-400">
            Statement cycles matched against your ledger.
          </p>
        </div>
        <span className="text-xs text-slate-400">{cycles?.length ?? 0} cycles</span>
      </div>
      {recompute.isError && (
        <p className="px-4 pt-2 text-xs text-rose-600">{(recompute.error as Error).message}</p>
      )}
      {absorb.isError && (
        <p className="px-4 pt-2 text-xs text-rose-600">{(absorb.error as Error).message}</p>
      )}
      {!cycles || cycles.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-slate-400">
          No statements reconciled yet.
        </p>
      ) : (
        <ul>
          {cycles.map((c) => (
            <ReconciliationRow
              key={c.id}
              cycle={c}
              cardName={cardName}
              onRecheck={() => recompute.mutate(c.id)}
              pending={recompute.isPending && recompute.variables === c.id}
              onAbsorb={() => absorb.mutate(c.id)}
              absorbPending={absorb.isPending && absorb.variables === c.id}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function ReconciliationRow({
  cycle,
  cardName,
  onRecheck,
  pending,
  onAbsorb,
  absorbPending,
}: {
  cycle: StatementReconciliation;
  cardName: string;
  onRecheck: () => void;
  pending: boolean;
  onAbsorb: () => void;
  absorbPending: boolean;
}) {
  const view = reconRowView(cycle);
  const { data: accounts, isLoading: accountsLoading, isError: accountsError } = useAccounts();
  const account = accounts?.find((a) => a.id === cycle.accountId);
  const before = account?.openingBalancePaise ?? null;

  // Only a POSITIVE drift ("shortfall") gets this affordance — `carryHint` is
  // only ever set for that kind (see reconRowView/driftPresentation). A
  // negative or credit drift has no button here (tasks/cc-recon-02-carryover-
  // seed/TASK.md P2).
  const canAbsorb = view.carryHint !== null && cycle.dueDriftPaise !== null;
  // The confirm dialog must always show the before → after opening balance,
  // so the button stays disabled until that data has actually loaded (and
  // stays disabled if the accounts query errored) rather than silently
  // dropping the line.
  const balanceUnavailable = accountsLoading || accountsError || before === null;

  const onClick = () => {
    if (cycle.dueDriftPaise === null || before === null) return;
    const after = before - cycle.dueDriftPaise;
    const lines = [
      `Set carried-forward balance for ${cardName}?`,
      `Statement period: ${formatPeriod(cycle.period)}`,
      `Adjustment: ${formatINR(cycle.dueDriftPaise)}`,
      `Opening balance: ${formatINR(before)} → ${formatINR(after)}`,
      "If you think ledger entries are missing instead, add those first — this permanently shifts the card's starting balance.",
      // Range-disclosure caveat (TASK.md P4): the account's exact age isn't
      // available on this page, so this is shown unconditionally rather than
      // only past the 370-day threshold — see the delegation iteration log.
      "Net-worth history older than about a year will not be fully restated by this change.",
    ].filter((l): l is string => l !== null);
    if (!confirm(lines.join("\n"))) return;
    onAbsorb();
  };

  return (
    <li className="border-b border-slate-50 px-4 py-2.5 text-sm last:border-0">
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-medium text-slate-800">{formatPeriod(cycle.period)}</p>
        <div className="flex items-baseline gap-3">
          {cycle.totalDuePaise !== null && (
            <span className="tabular-nums text-slate-500">
              {formatINR(cycle.totalDuePaise)} due
            </span>
          )}
          <button
            type="button"
            onClick={onRecheck}
            disabled={pending}
            className="text-xs text-slate-500 underline hover:text-slate-700 disabled:opacity-50"
          >
            {pending ? "Re-checking…" : "Re-check"}
          </button>
        </div>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
        <span>
          <span className="tabular-nums text-slate-700">
            {cycle.matchedCount}/{cycle.lineCount}
          </span>{" "}
          cleared
        </span>
        {cycle.deltaPaise > 0 && (
          <span className="text-amber-700">
            {formatINR(cycle.deltaPaise)} not yet in ledger
          </span>
        )}
        {cycle.unmatchedCount > 0 && (
          <span className="text-slate-500">
            {cycle.unmatchedCount} to review
          </span>
        )}
        {view.showClearedBadge && (
          <span
            title={view.badgeTitle}
            className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-700"
          >
            ✓ fully cleared
          </span>
        )}
      </div>
      {view.driftLine && (
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <span className={view.driftLine.tone === "amber" ? "text-amber-700" : "text-slate-500"}>
            {view.driftLine.text}
          </span>
          {view.carryHint && <span className="text-slate-400">{view.carryHint}</span>}
          {canAbsorb && (
            <button
              type="button"
              onClick={onClick}
              disabled={absorbPending || balanceUnavailable}
              title={
                accountsError
                  ? "Couldn't load the account's opening balance — try reloading the page."
                  : balanceUnavailable
                    ? "Loading the account's opening balance…"
                    : undefined
              }
              className="text-amber-700 underline hover:text-amber-900 disabled:opacity-50"
            >
              {absorbPending
                ? "Setting…"
                : balanceUnavailable
                  ? "Loading balance…"
                  : "Set carried-forward balance"}
            </button>
          )}
        </div>
      )}
    </li>
  );
}

function StatementsSection({ accountId }: { accountId: string }) {
  const { data: statements } = useCardStatements(accountId);
  const { upload, remove } = useStatementMutations(accountId);
  const [period, setPeriod] = useState("");

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    upload.mutate({ file, period }, { onSettled: () => setPeriod("") });
    e.target.value = ""; // let the same file be re-picked
  };

  return (
    <section className="rounded-lg border border-slate-200 bg-white">
      <div className="flex items-baseline justify-between border-b border-slate-100 px-4 py-2.5">
        <div>
          <h2 className="text-sm font-semibold text-slate-700">Statements</h2>
          <p className="text-xs text-slate-400">Bank statement PDFs, stored securely.</p>
        </div>
        <span className="text-xs text-slate-400">{statements?.length ?? 0} files</span>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3">
        <DateField
          value={period}
          onChange={(iso) => setPeriod(iso)}
          className="w-36"
          aria-label="Statement period (optional)"
        />
        <label className="cursor-pointer rounded bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700">
          {upload.isPending ? "Uploading…" : "Upload statement"}
          <input
            type="file"
            accept="application/pdf,image/jpeg,image/png,image/webp"
            className="hidden"
            disabled={upload.isPending}
            onChange={onFile}
          />
        </label>
        <span className="text-xs text-slate-400">PDF or image, up to 10 MB</span>
      </div>
      {upload.isError && (
        <p className="px-4 pt-2 text-xs text-rose-600">{(upload.error as Error).message}</p>
      )}

      {!statements || statements.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-slate-400">No statements uploaded yet.</p>
      ) : (
        <ul>
          {statements.map((s) => (
            <StatementRow key={s.id} statement={s} onRemove={() => remove.mutate(s.id)} />
          ))}
        </ul>
      )}
    </section>
  );
}

function StatementRow({
  statement,
  onRemove,
}: {
  statement: CardStatement;
  onRemove: () => void;
}) {
  return (
    <li className="flex items-center justify-between gap-3 border-b border-slate-50 px-4 py-2 text-sm last:border-0">
      <div className="min-w-0">
        <a
          href={`/api/card-statements/${statement.id}`}
          target="_blank"
          rel="noreferrer"
          className="truncate font-medium text-slate-800 underline decoration-slate-300 hover:decoration-slate-500"
        >
          {statement.fileName}
        </a>
        <p className="text-xs text-slate-400">
          {[statement.period, formatBytes(statement.sizeBytes)].filter(Boolean).join(" · ")}
        </p>
      </div>
      <button
        type="button"
        onClick={onRemove}
        className="shrink-0 text-xs text-slate-400 hover:text-rose-600"
      >
        Remove
      </button>
    </li>
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
                <p className="flex items-center gap-1.5 truncate font-medium text-slate-800">
                  <span className="truncate">{t.merchant || "—"}</span>
                  {t.reconciledStatementId && (
                    <span
                      title="Cleared by a statement"
                      className="shrink-0 rounded bg-emerald-50 px-1 py-0.5 text-[10px] font-normal text-emerald-700"
                    >
                      ✓ cleared
                    </span>
                  )}
                </p>
                <p className="text-xs text-slate-400">
                  {formatDisplayDate(t.date)}
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
