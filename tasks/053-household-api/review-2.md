**Findings**

- High: `/api/splits/:id` read/update/delete are not membership-scoped. `getSplit` ignores `userId`, so any authenticated user with a split UUID can read it; `updateSplit`/`deleteSplit` only check `createdByUserId`, not current household membership. These routes need to load the split’s `householdId` and assert current membership before returning or mutating it. See [splits.ts](/work/personal/compass/apps/api/src/modules/household/routes/splits.ts:67) and [splits.ts](/work/personal/compass/apps/api/src/modules/household/services/splits.ts:99).

- High: `createGrant` has no resource-owner authorization and no grantee household-membership check. The route only asserts the caller belongs to `input.householdId`; the service then inserts any `resourceType/resourceId/grantedToUserId`. Since `withSharing` later grants access based only on `resource_id` and `granted_to_user_id`, a caller who knows another user’s resource UUID can create a grant for it. See [sharing.ts](/work/personal/compass/apps/api/src/modules/household/routes/sharing.ts:32), [grants.ts](/work/personal/compass/apps/api/src/modules/household/services/grants.ts:19), and [sharing.ts](/work/personal/compass/apps/api/src/lib/sharing.ts:21).

- High: split creation is only household-member checked, not transaction-owner checked. `POST /api/transactions/:txId/split` can attach a household split to any transaction UUID that satisfies the FK, even if the transaction belongs to another user. See [splits.ts](/work/personal/compass/apps/api/src/modules/household/routes/splits.ts:47) and [splits.ts](/work/personal/compass/apps/api/src/modules/household/services/splits.ts:56).

- Medium: settlement creation validates caller membership in the household, but not that `fromPersonId` and `toPersonId` are valid people for that household’s members. This can create cross-user/cross-household balance entries if a caller submits unrelated `familyMembers.id` values. See [settlements.ts](/work/personal/compass/apps/api/src/modules/household/routes/settlements.ts:37) and [settlements.ts](/work/personal/compass/apps/api/src/modules/household/services/settlements.ts:13).

- Medium: `DELETE /api/households/:id/members/:memberId` appears to take a household-member row id, but the service treats it as a target user id. `listMembers` returns both `id` and `userId`, and the route parameter is named `memberId`; passing the returned member `id` will fail to find the member. See [membership.ts](/work/personal/compass/apps/api/src/modules/household/routes/membership.ts:38) and [membership.ts](/work/personal/compass/apps/api/src/modules/household/services/membership.ts:161).

- Medium: `PATCH /api/splits/:id` cannot recompute shares through the public schema because `UpdateHouseholdSplitSchema` omits `totalPaise`, while `updateSplit` only recreates shares when both `memberPersonIds` and `totalPaise` are present. The route accepts `memberPersonIds/sharePaise/ratios`, but updates will leave old shares unchanged unless a `totalPaise` somehow bypasses schema validation. See [household.ts](/work/personal/compass/packages/shared/src/schemas/household.ts:113) and [splits.ts](/work/personal/compass/apps/api/src/modules/household/services/splits.ts:130).

- Low: `createSettlement` still throws a plain `Error` on insert failure instead of `HttpError`. The task explicitly called out this conversion for splits, which is correct there, but this new household service still has the same pattern. See [settlements.ts](/work/personal/compass/apps/api/src/modules/household/services/settlements.ts:28).

- Low: `apps/api/src/route-surface.snapshot.txt` contains HEAD duplicates for the new GET routes, despite the requested “no HEAD duplicates” condition. Examples start at [route-surface.snapshot.txt](/work/personal/compass/apps/api/src/route-surface.snapshot.txt:161).

**Verified**

- Household CRUD routes use `req.session!.userId`; create returns `201`; not-found/not-member paths in the household service use `HttpError(404)`.
- Invite accept path is correctly `/api/households/invites/accept`.
- `POST /api/sharing-grants` calls `assertMember`.
- `POST /api/transactions/:txId/split`, `GET /api/households/:id/balances`, and settlement `POST/GET` call `assertMember`.
- `householdRoutes` registers all five route groups.
- `app.ts` registers `householdRoutes` after `automationRoutes`.
- Shared household split, settlement, and balance schemas are present; paise fields are `z.number().int()`, and `CreateSettlementSchema` rejects identical `fromPersonId`/`toPersonId`.
- Snapshot contains the 20 new non-HEAD household routes.
- `npm run typecheck` passes.