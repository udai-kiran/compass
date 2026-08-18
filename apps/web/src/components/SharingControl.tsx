import { type SharingResourceType } from "@compass/shared";
import { useHouseholdMembers, useHouseholds } from "../lib/household-queries.ts";
import { useSharingGrants, useSharingMutations } from "../lib/sharing-queries.ts";

interface SharingControlProps {
  resourceType: SharingResourceType;
  resourceId: string;
  /** The owner's userId — used to derive the first household to share within */
}

export function SharingControl({ resourceType, resourceId }: SharingControlProps) {
  const { data: households } = useHouseholds();
  const firstHousehold = households?.[0]; // Use first household for Phase 4
  const { data: members } = useHouseholdMembers(firstHousehold?.id);
  const { data: grants } = useSharingGrants(resourceType, resourceId);
  const { grant, revoke } = useSharingMutations(resourceType, resourceId);

  if (!firstHousehold) {
    return (
      <span className="text-xs text-slate-400">Private (no household)</span>
    );
  }

  const grantedToUserIds = new Set((grants ?? []).map((g) => g.grantedToUserId));
  const grantsByUserId = Object.fromEntries((grants ?? []).map((g) => [g.grantedToUserId, g.id]));

  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-slate-500">
        {grantedToUserIds.size === 0
          ? "Private"
          : `Shared with ${grantedToUserIds.size} member${grantedToUserIds.size > 1 ? "s" : ""}`}
      </span>
      {(members ?? [])
        .filter((m) => m.role !== "owner") // don't show option to share with self/owner
        .map((m) => {
          const isShared = grantedToUserIds.has(m.userId);
          return (
            <label key={m.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={isShared}
                onChange={(e) => {
                  if (e.target.checked) {
                    grant.mutate({
                      resourceType,
                      resourceId,
                      grantedToUserId: m.userId,
                      householdId: firstHousehold.id,
                    });
                  } else {
                    const grantId = grantsByUserId[m.userId];
                    if (grantId) revoke.mutate(grantId);
                  }
                }}
                className="h-4 w-4 rounded border-slate-300"
              />
              <span>{m.displayName}</span>
            </label>
          );
        })}
    </div>
  );
}
