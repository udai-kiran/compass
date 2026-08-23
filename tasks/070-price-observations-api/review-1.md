**Findings**

1. **BLOCKER: ownership changes are omitted.**  
   `price_observations` accepts two client-supplied FKs, `catalogItemId` and `priceSourceId`, and the schema explicitly warns both can point at another user’s rows and must be guarded before writes land: [schema.ts](/work/personal/compass/apps/api/src/modules/shopping/schema.ts:20). Existing shopping ownership helpers only cover lists, list items, and catalog items: [ownership.ts](/work/personal/compass/apps/api/src/modules/shopping/services/ownership.ts:42). The plan should include `apps/api/src/modules/shopping/services/ownership.ts` changes, at least `assertOwnedPriceSource`, and service tests/route tests proving cross-user `catalogItemId`, `priceSourceId`, and observation IDs return 404.

2. **BLOCKER: route snapshot files are omitted.**  
   Adding `/api/shopping/sources` and `/api/shopping/observations` changes the canonical route surface and raw Fastify tree. `app.route-snapshot.test.ts` compares both snapshots byte-for-byte: [app.route-snapshot.test.ts](/work/personal/compass/apps/api/src/app.route-snapshot.test.ts:80) and [app.route-snapshot.test.ts](/work/personal/compass/apps/api/src/app.route-snapshot.test.ts:120). The plan needs updates to `apps/api/src/route-surface.snapshot.txt` and `apps/api/src/route-table.snapshot.txt`, with the expected feature-route justification.

3. **HIGH: seeding “from shopping POST /sources on first visit” is the wrong trigger for AC4.**  
   Per-user seeding itself makes sense because `price_sources.user_id` is required and unique with `name` per user: [schema.ts](/work/personal/compass/apps/api/src/modules/shopping/schema.ts:108). It also aligns with per-user backup/export, where `price_sources` and `price_observations` are user-scoped: [backup.ts](/work/personal/compass/apps/api/src/modules/system/services/backup.ts:71). But seeding only on `POST /sources` means a new user who first calls `GET /sources` sees no platform registry, and a user creating a custom source may race/conflict with delayed seed insertion. Put `ensurePlatformSeeds(db, userId)` on `GET /sources` and optionally before create/list operations, make it idempotent with `on conflict (user_id, name) do nothing`, and do not overwrite/reactivate user-edited or soft-deleted rows.

4. **HIGH: planned tests do not prove the API acceptance criteria end to end.**  
   Hermetic route tests with mocked services can prove registration/schema/auth config, but not “POST creates,” “GET lists,” uniqueness handling, DB FK ownership, soft delete, or observation join behavior. Existing shopping list/catalog work has real `.route.test.ts` integration coverage in addition to hermetic tests. Add DB-backed route tests for sources and observations, especially create/list/delete, duplicate source name -> 409, cross-user FK rejection, and stale flag in the returned joined response.

5. **MEDIUM: shared schema tests are omitted.**  
   The plan adds new shared contracts beside existing `PriceSourceSchema` and `PriceObservationSchema`: [shopping.ts](/work/personal/compass/packages/shared/src/schemas/shopping.ts:78) and [shopping.ts](/work/personal/compass/packages/shared/src/schemas/shopping.ts:116). Since verification includes `npm run test -w packages/shared`, the plan should include `packages/shared/src/schemas/shopping.test.ts` updates for the new create/update/response contracts, including quantity/unit pairing and Date coercion.

6. **MEDIUM: route method choice is inconsistent with nearby CRUD unless intentional.**  
   The plan uses `PATCH /sources/:id`: [TASK.md](/work/personal/compass/tasks/070-price-observations-api/TASK.md:16). Existing shopping CRUD uses `PUT` for full replacement and documents that update schemas have all fields required: [shopping.ts](/work/personal/compass/packages/shared/src/schemas/shopping.ts:184). `PATCH` is acceptable if `UpdatePriceSourceSchema` is explicitly partial and tests cover preserve-on-omission. If the intent is full replace, use `PUT` to match local convention.

**Direct Answers**

1. Planned files/symbols are mostly correct: `schema.ts` already has `priceSources` and `priceObservations`; shared already has base `PriceSourceSchema` and `PriceObservationSchema`; `plugin.ts` is the right registration point and route files should use relative paths under `/api/shopping`: [plugin.ts](/work/personal/compass/apps/api/src/modules/shopping/plugin.ts:19). Missing symbol: an ownership guard for price sources.

2. Omitted needed file changes: `services/ownership.ts`, route snapshots, likely `packages/shared/src/schemas/shopping.test.ts`, and DB-backed route tests. A `shopping/plugin.test.ts` would also be consistent with other modules, though snapshots already catch production registration.

3. Seeding 11 platforms per-user makes sense with the current schema. A global registry does not fit `price_sources.user_id NOT NULL`. The trigger should be idempotent per user and happen on read/list, not only on source creation.

4. Existing schema smoke should not break if this task does not alter schema. Existing route snapshot tests will break unless updated. New route names also need care around snapshot HEAD entries for GET routes.

5. Yes: the stale threshold belongs in `services/price-observations.ts`, preferably as a named constant plus injectable `now`/clock for deterministic unit tests. Do not hardcode `now() - interval '7 days'` in SQL; list rows by owner/catalog item, join the source, then compute `isStale` in service code.