import { formatINR } from "@compass/shared";
import { useHouseholdBalances, useSettlements } from "../../lib/split-queries.ts";
import type { Household } from "@compass/shared";

export function BalancesPanel({ household }: { household: Household }) {
  const { data: balances } = useHouseholdBalances(household.id);
  const { data: settlements } = useSettlements(household.id);

  const memberName = (personId: string) => {
    // balances are keyed by personId (family_members.id)
    // display personId truncated for now
    return personId.slice(0, 8) + "…";
  };

  if (!balances || Object.keys(balances).length === 0) {
    return <p className="text-sm text-slate-500 mt-2">No balances yet.</p>;
  }

  return (
    <div className="mt-4">
      <h3 className="text-sm font-semibold text-slate-700">Balances</h3>
      <ul className="mt-1 space-y-1">
        {Object.entries(balances).map(([personId, paise]) => (
          <li key={personId} className="flex justify-between text-sm">
            <span className="text-slate-600">{memberName(personId)}</span>
            <span className={paise >= 0 ? "text-green-600" : "text-red-600"}>
              {paise >= 0 ? "+" : ""}{formatINR(paise)}
            </span>
          </li>
        ))}
      </ul>
      {settlements && settlements.length > 0 && (
        <div className="mt-3">
          <h4 className="text-xs font-medium text-slate-500">Recent Settlements</h4>
          <ul className="mt-1 space-y-0.5">
            {settlements.slice(0, 5).map((s) => (
              <li key={s.id} className="text-xs text-slate-500">
                {memberName(s.fromPersonId)} {"→"} {memberName(s.toPersonId)}: {formatINR(s.amountPaise)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
