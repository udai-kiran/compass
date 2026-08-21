No BLOCKING findings in the implementation.

**Findings**

- non-blocking: `convertToBaseQuantity` does not validate `displayUnit` at runtime. The signature limits callers in TypeScript, but unlike `unitPricePaise` it has no runtime guard, so JS/dynamic callers can get an invalid normalized unit back. Example: the non-`kg`/`litre` branch casts `displayUnit` directly at [money.ts](/work/personal/compass/packages/shared/src/money.ts:145). This is not exercised by tests. Given `unitPricePaise` explicitly guards its `unit`, I would add the same style guard here.

- non-blocking: the DB-gated integration test does not “skip locally with literal reason” as AC8/plan P6 requested. It throws at module load if env vars are absent: [catalog.route.test.ts](/work/personal/compass/apps/api/src/modules/shopping/routes/catalog.route.test.ts:28). Running it locally without env failed with `catalog.route.test.ts needs DATABASE_URL set...`, not a skipped test. This matches some existing route-test conventions, but it does not match this task’s stated AC8 wording.

- non-blocking: ambiguous/none no-write coverage is incomplete. The implementation does no write on `ambiguous`/`none` at [canonicalize.ts](/work/personal/compass/apps/api/src/modules/shopping/services/canonicalize.ts:266), but tests only prove `none` leaves item `updatedAt` unchanged and only prove `ambiguous` leaves `catalogItemId` null: [catalog.route.test.ts](/work/personal/compass/apps/api/src/modules/shopping/routes/catalog.route.test.ts:450), [catalog.route.test.ts](/work/personal/compass/apps/api/src/modules/shopping/routes/catalog.route.test.ts:504). They do not assert list `updatedAt` stays unchanged on none/ambiguous, nor item `updatedAt` unchanged on ambiguous.

- non-blocking: AC4 “canonicalization never creates” is true in code, but not directly proven by a test. `matchCatalog` only selects at [canonicalize.ts](/work/personal/compass/apps/api/src/modules/shopping/services/canonicalize.ts:81), and `canonicalizeItem` only updates list items/lists on matched at [canonicalize.ts](/work/personal/compass/apps/api/src/modules/shopping/services/canonicalize.ts:249). The tests do not count `catalog_items` before/after `GET /catalog/match` or `canonicalizeItem`.

**Blocking Fixes Check**

B1 is correctly implemented. `canonicalizeItem` opens one transaction, locks the owned list first with `FOR UPDATE`, then locks the item by `id` and `listId` with `FOR UPDATE`, then reads/matches `rawText` under the item lock: [canonicalize.ts](/work/personal/compass/apps/api/src/modules/shopping/services/canonicalize.ts:224). This closes the stale-match race. The lock order is compatible with add/delete/reorder list-first locking and does not deadlock against `updateItem`, since `updateItem` is not holding the item lock while waiting on the list update.

B2 is materially correct. There is no float/epsilon path. Decimal parsing is string-based, kg/litre use `padEnd(3, "0")`, so `"0.001"` maps to `1`, `"1"` maps to `1000`, `"1.500"` maps to `1500`, and `>3` dp is rejected: [money.ts](/work/personal/compass/packages/shared/src/money.ts:118). Oversized results are rejected with `Number.isSafeInteger` at [money.ts](/work/personal/compass/packages/shared/src/money.ts:154). The only caveat is the runtime invalid-unit guard noted above.

B3 is correct. On unique match, item `catalogItemId` and item `updatedAt` are bumped, then parent list `updatedAt` is bumped with the same timestamp: [canonicalize.ts](/work/personal/compass/apps/api/src/modules/shopping/services/canonicalize.ts:246). Ambiguous/none returns without writes.

B4 is correct. Create and update translate pg `23505` to `409` with no racy duplicate pre-check: [canonicalize.ts](/work/personal/compass/apps/api/src/modules/shopping/services/canonicalize.ts:106), [canonicalize.ts](/work/personal/compass/apps/api/src/modules/shopping/services/canonicalize.ts:162).

**Other Assessment**

`unitPricePaise` is correct: BigInt round-half-up formula is used, result is checked against `MAX_SAFE_INTEGER` before `Number()`, zero price is allowed, and zero/negative quantity is rejected: [money.ts](/work/personal/compass/packages/shared/src/money.ts:68).

`matchCatalog` is owner-scoped, case-insensitive exact, ambiguous on `>=2`, parameterized through Drizzle’s SQL template, and never inserts: [canonicalize.ts](/work/personal/compass/apps/api/src/modules/shopping/services/canonicalize.ts:73).

Catalog CRUD is owner-scoped and IDOR-safe. `GET`/`PUT`/`DELETE` constrain `id` and `userId`; `categoryId` is checked on create/update including null-safe handling; duplicate names map to `409`: [canonicalize.ts](/work/personal/compass/apps/api/src/modules/shopping/services/canonicalize.ts:98).

Routes are ordered correctly with `/catalog/match` before `/catalog/:id`, have session-scoped handlers, no public config, and canonicalize params are `listId`/`itemId`: [catalog.ts](/work/personal/compass/apps/api/src/modules/shopping/routes/catalog.ts:72).

No migration, shopping schema, or backup change was made; `git diff` shows only the route snapshots among those areas.

**Acceptance Criteria**

AC1: satisfied and well tested.

AC2: satisfied. Unique auto-link tested; ambiguous behavior tested, but no-write is only partially proven.

AC3: satisfied in code; partially proven by tests for `none`.

AC4: satisfied in code; not directly proven by tests.

AC5: satisfied. Tests cover catalog IDOR, category ownership, PUT strictness, and duplicate `409`; update with nonexistent categoryId is not separately tested.

AC6: satisfied. Demo 403 uses the real auth hook in integration; unauth 401 is covered.

AC7: satisfied. Snapshot test passes and fixture diff is exactly new catalog/canonicalize routes plus HEAD for new GETs.

AC8: partially satisfied. `typecheck`, `lint`, shared tests, hermetic tests, and route snapshot tests pass. DB integration could not run locally without env and fails instead of reporting a skip.

**Verification Run**

- `npm run typecheck`: pass
- `npm run lint`: pass
- `npm run test -w packages/shared`: pass, 310 tests
- `node --experimental-test-module-mocks --test apps/api/src/modules/shopping/routes/catalog.hermetic.test.ts`: pass, 5 tests
- `node --experimental-test-module-mocks --test apps/api/src/app.route-snapshot.test.ts`: pass, 7 tests
- `node --env-file-if-exists=../../.env --experimental-test-module-mocks --test apps/api/src/modules/shopping/routes/catalog.route.test.ts`: fail locally because `DATABASE_URL` is not set; no skip reported.