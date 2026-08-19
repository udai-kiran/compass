**Findings**

- **Blocking:** P6 is missing required split routes from the task scope. `tasks/053-household-api/TASK.md` requires `GET/PATCH/DELETE /api/splits/:id`, but the proposed plan only has `DELETE /api/splits/:id`. There are also no existing `getSplit` or `updateSplit` service functions in [splits.ts](/work/personal/compass/apps/api/src/modules/household/services/splits.ts:27), and no `UpdateSplitSchema`/split response-with-shares schema in shared. Add those to the plan or explicitly descope them, because AC1 says full CRUD.

- **Blocking:** split creation cannot safely be exposed as-is. [createSplit](/work/personal/compass/apps/api/src/modules/household/services/splits.ts:27) trusts `transactionId`, `householdId`, `payerPersonId`, `memberPersonIds`, and `totalPaise`; it does not verify transaction ownership, household membership, or that the people belong to the household/caller. The route must either perform these checks before calling the service or the service must be hardened. It also throws plain `Error` for validation failures at lines 40, 46, 50, 66, 91, and 93, which the app maps to 500 unless converted to `HttpError`.

- **Blocking:** settlement/balance services are not authorized. [createSettlement](/work/personal/compass/apps/api/src/modules/household/services/settlements.ts:13), [listSettlements](/work/personal/compass/apps/api/src/modules/household/services/settlements.ts:32), and [getHouseholdBalances](/work/personal/compass/apps/api/src/modules/household/services/settlements.ts:54) accept `_userId` but never use it. Route-level membership checks are mandatory unless these services are fixed.

- **Blocking:** sharing grants must validate both sides. A `createGrant` service should verify the caller owns the target resource for the given `resourceType`, the caller is a member/owner of the given household, and `grantedToUserId` is a member of that household. Otherwise a user can create meaningless or potentially dangerous grants for arbitrary resource IDs. For `revokeGrant`/`listGrants`, scope by `ownerUserId = userId`; do not allow deleting/listing another owner’s grants.

- **High:** settlement inputs need person validation. `fromPersonId` and `toPersonId` should be distinct, positive `amountPaise` should be enforced, and both persons should be valid household participants. The DB FKs only prove they are `family_members`, not that they belong to this household context.

**Plan Completeness**

Mostly complete structurally, but missing:

- `GET /api/splits/:id`
- `PATCH /api/splits/:id`
- `getSplit`, `updateSplit`, probably `toSplit` response mapper including shares
- `UpdateSplitSchema`
- likely `SplitShareSchema` or response schema for split shares, not just `SplitSchema`
- route/service auth helpers such as `assertHouseholdMember`, `assertHouseholdOwner`, `assertHouseholdPerson`, `assertOwnedTransaction`
- tests for demo-write 403, unauthenticated 401, cross-user/cross-household access denial

`packages/shared/src/index.ts` already exports household schemas at [index.ts](/work/personal/compass/packages/shared/src/index.ts:22), so P1 does not need a new export unless the file structure changes.

**Route Conflict**

`POST /api/households/accept` does not conflict with `GET /api/households/:id` for POST. I verified Fastify dispatches `POST /api/households/accept` to the static POST route.

One caveat: `GET /api/households/accept` will match `GET /api/households/:id`; if the route has `params: { id: z.uuid() }`, it will return a validation 400 rather than 404. That is acceptable but worth knowing.

**Patterns To Follow**

Existing routes use:

- `const r = app.withTypeProvider<ZodTypeProvider>()`
- `req.session!.userId`; no per-route session check
- `HttpError` for domain errors and authorization failures
- `404` to hide non-member/non-owner resource existence, `403` for known member but insufficient role
- `201` for creation routes
- `{ ok: true }` for deletes
- all request/response schemas from `@compass/shared`
- no explicit demo handling in each route; `plugins/auth.ts` blocks mutating demo requests globally

Household CRUD and membership services already use `HttpError` and membership checks, e.g. [households.ts](/work/personal/compass/apps/api/src/modules/household/services/households.ts:36) and [membership.ts](/work/personal/compass/apps/api/src/modules/household/services/membership.ts:25). Splits/settlements do not yet match that bar.

**Snapshots**

There is no package script or committed regen script. The task text says “regen script”, but I found only the snapshot test logic. The process is effectively manual/temp-script:

- `route-surface.snapshot.txt`: collect `onRoute` pairs, flatten methods, sort `METHOD URL`, join with `\n`, append final `\n`.
- `route-table.snapshot.txt`: `app.printRoutes({ commonPrefix: false })`.

Since Task 053 adds routes, both snapshots must change. `route-surface` is alphabetic by `(METHOD URL)`.

**Drizzle Query API**

`db.query.householdMembers` should work. The schema barrel exports `householdMembers`, `households`, `householdInvites`, `sharingGrants`, `splits`, `splitShares`, and `settlements`, and `createDb()` passes that schema object into Drizzle. No `relations()` config is required for basic `.findFirst()`/`.findMany()`. Do not use nested `with: { ... }` unless relations are added; raw joins are already the repo pattern for member display names.

**Suggested Plan Changes**

Add before route implementation:

- P0: Add shared schemas for full split CRUD, split shares, settlement response, and positive/int paise constraints.
- P0.5: Add/centralize household authorization helpers.
- P2/P6/P7: Harden grant/split/settlement services or explicitly perform route-level checks before service calls.
- P6: Include `GET/PATCH /api/splits/:id`.
- P12: Add focused route tests for authz and demo-write rejection, not just type/lint/test.