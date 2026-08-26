import { formatINR } from "@compass/shared";
import { useDossier } from "../../lib/protection-queries.ts";
import { PageLoading, PageError, EmptyState } from "../../components/States.tsx";

const ENTITY_LABELS: Record<string, string> = {
  account: "Account",
  holding: "Investment",
  insurance_policy: "Insurance policy",
};

export function DossierPage() {
  const { data, isLoading, isError } = useDossier();
  if (isLoading) return <PageLoading />;
  if (isError) return <PageError />;
  if (!data) return null;

  const { entries, missingNomineeCount, totalEntries, disclaimer } = data;

  return (
    <div className="mx-auto max-w-4xl">
      <header className="mb-4">
        <h1 className="text-xl font-semibold text-slate-800">Continuity Dossier</h1>
        <p className="mt-0.5 text-sm text-slate-500">
          Every account, holding, and policy with its nominee — so your family can find and claim everything.
        </p>
      </header>

      {/* Disclaimer: nomination ≠ inheritance */}
      <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
        <p className="text-xs text-slate-600">{disclaimer}</p>
      </div>

      {/* Missing nominees headline */}
      {missingNomineeCount > 0 && (
        <div className="mb-4 card border-amber-200 bg-amber-50 p-4">
          <p className="text-lg font-semibold text-amber-700 tabular-nums">
            {missingNomineeCount} of {totalEntries}
            <span className="text-sm font-normal text-amber-600 ml-1">
              {missingNomineeCount === 1 ? "account has" : "accounts have"} no nominee recorded
            </span>
          </p>
          <p className="mt-1 text-xs text-amber-600">
            Missing nominations are the most common failure in continuity planning.
          </p>
        </div>
      )}

      {missingNomineeCount === 0 && totalEntries > 0 && (
        <div className="mb-4 card border-emerald-200 bg-emerald-50 p-4">
          <p className="text-sm font-medium text-emerald-700">All {totalEntries} entries have nominees recorded.</p>
        </div>
      )}

      {totalEntries === 0 && (
        <EmptyState title="No accounts, holdings, or policies found" hint="Add financial instruments to build your dossier." />
      )}

      {/* Dossier entries */}
      {entries.length > 0 && (
        <div className="space-y-2">
          {entries.map((e) => (
            <div key={e.key} className={`card p-3 ${e.missingNominee ? "border-amber-200" : ""}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-slate-800">{e.name}</p>
                    <span className="badge bg-slate-100 text-slate-600 text-[10px]">{ENTITY_LABELS[e.entityType] ?? e.entityType}</span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-500">
                    <span>{e.subtype}</span>
                    {e.institution && <span>{e.institution}</span>}
                    {e.identifier && <span className="font-mono">{e.identifier}</span>}
                    {e.valuePaise != null && <span className="tabular-nums">{formatINR(e.valuePaise)}</span>}
                    {e.hasDocument && <span className="text-emerald-600">📄 Document on file</span>}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  {e.missingNominee ? (
                    <span className="text-xs font-medium text-amber-600">No nominee</span>
                  ) : (
                    <div>
                      <p className="text-xs font-medium text-slate-700">{e.nominee || e.nomineePersonName || "—"}</p>
                      {e.nomineePersonName && e.nominee && e.nominee !== e.nomineePersonName && (
                        <p className="text-[10px] text-slate-400">{e.nomineePersonName}</p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
