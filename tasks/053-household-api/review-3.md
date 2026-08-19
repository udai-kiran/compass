**Findings**

- Residual risk: [sharing.ts](/work/personal/compass/apps/api/src/modules/household/routes/sharing.ts:34) explicitly defers resource ownership verification for `resourceId`, and [grants.ts](/work/personal/compass/apps/api/src/modules/household/services/grants.ts:24) inserts the grant with `ownerUserId = caller` without checking the resource actually belongs to that caller. This is outside the specific fix criteria you listed, but it remains a security-sensitive gap if this route is production-facing.

**Requested Checks**

All 3 previous high findings are resolved against the requested criteria:

- [splits.ts](/work/personal/compass/apps/api/src/modules/household/routes/splits.ts:79): `GET /api/splits/:id` calls `getSplit`, then `assertMember(..., split.householdId)`.
- [splits.ts](/work/personal/compass/apps/api/src/modules/household/routes/splits.ts:90): `PATCH /api/splits/:id` calls `getSplit` first, then `assertMember`, then `updateSplit`.
- [splits.ts](/work/personal/compass/apps/api/src/modules/household/routes/splits.ts:101): `DELETE /api/splits/:id` calls `getSplit`, then `assertMember`, then `deleteSplit`.
- [splits.ts](/work/personal/compass/apps/api/src/modules/household/routes/splits.ts:54): `POST /api/transactions/:txId/split` loads the transaction, returns `404` if missing, and returns `403` if `txRow.userId !== session.userId` before `createSplit`.
- [sharing.ts](/work/personal/compass/apps/api/src/modules/household/routes/sharing.ts:32): `POST /api/sharing-grants` checks caller household membership.
- [sharing.ts](/work/personal/compass/apps/api/src/modules/household/routes/sharing.ts:35): `POST /api/sharing-grants` also checks `grantedToUserId` is a member of the same household.
- [household.ts](/work/personal/compass/packages/shared/src/schemas/household.ts:115): `UpdateHouseholdSplitSchema` has `totalPaise: z.number().int().positive().optional()`.
- [settlements.ts](/work/personal/compass/apps/api/src/modules/household/services/settlements.ts:29): `createSettlement` throws `HttpError(500, ...)`, not plain `Error`.

**Verification**

- `npm run typecheck`: exits `0`.
- Route snapshot test, run directly as `node --env-file-if-exists=../../.env --test src/app.route-snapshot.test.ts` from `apps/api`: exits `0`, 7 passed / 0 failed.

Note: `npm run test -w apps/api -- app.route-snapshot.test.ts` does not isolate the route snapshot file because the package script always includes `src/**/*.test.ts`; that broad run failed on unrelated DB-backed tests due missing `DATABASE_URL`. The route snapshot test itself passed cleanly.