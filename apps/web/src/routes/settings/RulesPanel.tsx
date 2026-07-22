import { useState } from "react";
import { toast } from "../../lib/toast.tsx";
import { useMerchantMutations, useMerchantRules } from "../../lib/import-queries.ts";

/** Merchant-name normalization map. Categorization is manual (AI-assisted later). */
export function RulesPanel() {
  const { data: rules } = useMerchantRules();
  const { rename, removeRule } = useMerchantMutations();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [applyToAll, setApplyToAll] = useState(true);

  return (
    <div className="mt-4 max-w-3xl">
      <section>
        <h2 className="text-sm font-semibold text-slate-700">Merchant name cleanup</h2>
        <p className="mt-0.5 text-xs text-slate-400">
          Raw descriptors containing the match are replaced at entry and import. Raw text is kept on
          imported rows.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!from || !to) return;
            rename.mutate(
              { from, to, applyToAll, createRule: true },
              {
                onSuccess: (r) => {
                  setFrom("");
                  setTo("");
                  toast(applyToAll ? `Renamed ${r.updated} transactions` : "Rule saved", "success");
                },
              },
            );
          }}
          className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-3 text-sm"
        >
          <input placeholder="descriptor contains…" value={from} onChange={(e) => setFrom(e.target.value)} className="w-44 rounded-md border border-slate-300 px-2 py-1.5" />
          <span className="text-slate-500">→</span>
          <input placeholder="display as…" value={to} onChange={(e) => setTo(e.target.value)} className="w-40 rounded-md border border-slate-300 px-2 py-1.5" />
          <label className="flex items-center gap-1 text-slate-600">
            <input type="checkbox" checked={applyToAll} onChange={(e) => setApplyToAll(e.target.checked)} />
            apply to existing
          </label>
          <button type="submit" disabled={!from || !to} className="rounded-md bg-brand-600 px-3 py-1.5 text-white disabled:opacity-40">
            Save
          </button>
        </form>
        <ul className="mt-3 divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
          {rules?.map((r) => (
            <li key={r.id} className="flex items-center gap-3 px-4 py-2 text-sm">
              <span className="min-w-0 flex-1 truncate text-slate-700">
                “{r.match}” → <span className="font-medium">{r.replacement}</span>
              </span>
              <button className="text-slate-400 hover:text-red-600" onClick={() => removeRule.mutate(r.id)}>✕</button>
            </li>
          ))}
          {rules?.length === 0 && (
            <li className="px-4 py-6 text-center text-sm text-slate-400">No merchant rules yet.</li>
          )}
        </ul>
      </section>
    </div>
  );
}
