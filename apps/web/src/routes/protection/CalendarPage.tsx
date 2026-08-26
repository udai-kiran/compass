import { formatINR } from "@compass/shared";
import { useMaturityCalendar } from "../../lib/protection-queries.ts";
import { PageLoading, PageError, EmptyState } from "../../components/States.tsx";

const SOURCE_LABELS: Record<string, string> = {
  insurance_renewal: "Insurance renewal",
  insurance_maturity: "Insurance maturity",
  fd_maturity: "FD maturity",
  rd_maturity: "RD maturity",
  nsc_maturity: "NSC maturity",
  ppf_maturity: "PPF maturity",
  ppf_extension: "PPF extension",
  ssy_maturity: "SSY maturity",
  ssy_partial_withdrawal: "SSY partial withdrawal",
  sgb_exit_window: "SGB exit window",
  sgb_maturity: "SGB maturity",
  elss_unlock: "ELSS unlock",
  epf_retirement: "EPF retirement",
};

export function CalendarPage() {
  const { data, isLoading, isError } = useMaturityCalendar();
  if (isLoading) return <PageLoading />;
  if (isError) return <PageError />;
  if (!data) return null;

  const { events, upcomingCount, pastCount, maturedIdleCount } = data;
  const upcoming = events.filter((e) => !e.isPast);
  const past = events.filter((e) => e.isPast);

  return (
    <div className="mx-auto max-w-4xl">
      <header className="mb-4">
        <h1 className="text-xl font-semibold text-slate-800">Maturity & Renewal Calendar</h1>
        <p className="mt-0.5 text-sm text-slate-500">
          Every instrument that comes due — maturities, renewals, lock-in expiries, and exit windows.
        </p>
      </header>

      {/* Summary stats */}
      <div className="mb-4 grid grid-cols-3 gap-3">
        <div className="card p-3 text-center">
          <p className="text-2xl font-semibold text-slate-800 tabular-nums">{upcomingCount}</p>
          <p className="text-xs text-slate-500">Upcoming</p>
        </div>
        <div className="card p-3 text-center">
          <p className="text-2xl font-semibold text-slate-800 tabular-nums">{pastCount}</p>
          <p className="text-xs text-slate-500">Past</p>
        </div>
        {maturedIdleCount > 0 && (
          <div className="card p-3 text-center border-amber-200 bg-amber-50">
            <p className="text-2xl font-semibold text-amber-700 tabular-nums">{maturedIdleCount}</p>
            <p className="text-xs text-amber-600">Matured & possibly idle</p>
          </div>
        )}
      </div>

      {events.length === 0 && (
        <EmptyState title="No maturity or renewal dates found" hint="Add accounts, deposits, or policies to see your calendar." />
      )}

      {/* Upcoming events */}
      {upcoming.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 text-sm font-medium text-slate-600">Upcoming</h2>
          <div className="space-y-2">
            {upcoming.map((e) => (
              <div key={e.key} className="card flex items-start gap-3 p-3">
                <div className="shrink-0 rounded bg-brand-50 px-2 py-1 text-center">
                  <p className="text-xs font-medium text-brand-700">{e.date.slice(5, 7)}/{e.date.slice(2, 4)}</p>
                  <p className="text-[10px] text-brand-500">{e.date.slice(8, 10)}</p>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-800">{e.title}</p>
                  <p className="text-xs text-slate-500">{SOURCE_LABELS[e.source] ?? e.source}</p>
                  <p className="mt-0.5 text-xs text-slate-500">{e.description}</p>
                  {e.amountPaise != null && (
                    <p className="mt-0.5 text-xs font-medium text-slate-600 tabular-nums">{formatINR(e.amountPaise)}</p>
                  )}
                  {e.warnings.map((w, i) => (
                    <p key={i} className="mt-0.5 text-xs text-amber-600">⚠ {w}</p>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Past events */}
      {past.length > 0 && (
        <details className="mb-6">
          <summary className="mb-2 cursor-pointer text-sm font-medium text-slate-600 hover:text-slate-800">
            Past events ({pastCount})
          </summary>
          <div className="space-y-2">
            {past.map((e) => (
              <div key={e.key} className="card flex items-start gap-3 p-3 opacity-60">
                <div className="shrink-0 rounded bg-slate-100 px-2 py-1 text-center">
                  <p className="text-xs font-medium text-slate-500">{e.date.slice(5, 7)}/{e.date.slice(2, 4)}</p>
                  <p className="text-[10px] text-slate-400">{e.date.slice(8, 10)}</p>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-600">{e.title}</p>
                  <p className="text-xs text-slate-400">{SOURCE_LABELS[e.source] ?? e.source}</p>
                  {e.amountPaise != null && (
                    <p className="mt-0.5 text-xs text-slate-400 tabular-nums">{formatINR(e.amountPaise)}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
