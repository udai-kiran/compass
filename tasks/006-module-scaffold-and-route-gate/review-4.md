# Implementation Review — Task 006

## Verdict

**Not acceptance-ready due to one plan-conformance test defect.**

The production implementation correctly performs the approved relocation and preserves route behavior, schema identity, authentication, and demo-mode enforcement. However, the required service characterization test does not actually test input validation despite claiming that it does.

## Blocking finding

### Medium — Service test does not verify that PUT input is validated

`modules/planning/services/projection-settings.test.ts` contains:

> `test("updateProjectionSettings validates and upserts a new row", ...)`

But it only submits a valid value:

```ts
await updateProjectionSettings(db, userId, { equityReturnBps: 900 });
```

There is no invalid input, no `assert.rejects()`, and no assertion that an invalid call leaves the database unchanged.

This does not satisfy DELEGATION.md Required Change 9’s explicit requirement that the service test cover “PUT validates and upserts.” The upsert is covered; validation is not. The test name overstates what the test proves.

Add a test using an `equityReturnBps` value outside `UpdateProjectionSettingsSchema`’s accepted range, assert rejection, and preferably confirm that no settings row was created or changed. This is a missing required test rather than a production behavior regression—the service still calls `UpdateProjectionSettingsSchema.parse(input)` exactly as before.

## Verified implementation details

### AC1 — Route-table identity gate

Passes.

- `app.route-snapshot.test.ts` is genuinely hermetic. It constructs only Fastify, installs the two Zod compilers, calls `registerRoutes(app)`, awaits readiness, prints routes, and closes the instance.
- It does not load configuration or initialize PostgreSQL, Redis, storage, queues, the event bus, authentication, or security.
- The snapshot is loaded using `new URL("./route-table.snapshot.txt", import.meta.url)`.
- It compares the raw strings without trimming or normalizing newlines.
- It uses `app.printRoutes({ commonPrefix: false })`.
- The synthetic tests accurately describe themselves as tests of the comparison helper, not proof of Fastify’s rendering behavior.
- Added, removed, renamed, and method-changed synthetic cases are present.
- The committed table contains `GET, HEAD, PUT` for `/api/projection-settings`.
- The hermetic snapshot suite passed locally.

The historical P1/P3/P6 baseline sequence cannot be independently recreated from the current post-implementation tree, but the implementation evidence records the required byte-identical comparisons and hashes. No current-code contradiction was found.

### AC2 — Planning module scaffold and production path

Passes.

The required structure exists:

- `modules/planning/schema.ts`
- `modules/planning/services/projection-settings.ts`
- `modules/planning/routes/projection-settings.ts`
- `modules/planning/plugin.ts`

`app.ts` imports `planningRoutes` from `./modules/planning/plugin.ts`. Its exported `registerRoutes()` calls:

```ts
await app.register(planningRoutes);
```

It does not import or register `projectionSettingsRoutes` directly. `plugin.ts` then registers `projectionSettingsRoutes`, so the plugin is genuinely exercised in production.

No route prefix was added. Multipart and compression remain in `buildApp()`, outside `registerRoutes()`.

The transitional convention and the deliberately narrow purpose of `core-schema.ts` are documented correctly in `CLAUDE.md`.

### AC3 — Backup behavior

No current-code regression found.

Neither `apps/api/src/services/backup.ts` nor its table arrays were changed in the current diff. Moving the table declarations does not change their exports through the aggregate schema barrel.

The implementer reports the existing backup test passing. I found no production-code change that would alter its table identities.

### AC4 — Build and behavior

Production behavior is preserved, subject to the missing required validation test above.

The current tree passes:

- Root `npm run typecheck`
- Root `npm run lint`
- Hermetic route snapshot tests
- Hermetic schema smoke tests

The DB/Redis-backed suites were not rerun as part of this read-only review, but their implementations were inspected.

### AC5 — Schema barrel and runtime Drizzle construction

Passes.

The actual import graph is acyclic:

```text
db/index.ts
  -> db/schema.ts
       -> db/core-schema.ts
       -> modules/planning/schema.ts
            -> db/core-schema.ts
```

`core-schema.ts` imports only Drizzle primitives. It does not import `db/schema.ts`, `db/index.ts`, or any planning file. Therefore, there is no path from `modules/planning/schema.ts` back to `db/schema.ts`.

`db/schema.ts` correctly uses both:

```ts
import { users } from "./core-schema.ts";
export { users } from "./core-schema.ts";
```

The import provides the local binding needed by remaining inline foreign keys, while the export preserves existing barrel consumers.

`schema.smoke.test.ts` constructs a real runtime database object by calling:

```ts
const db = createDb(stubPool);
```

`createDb()` is:

```ts
return drizzle(pool, { schema });
```

There is no query or connection operation in `createDb()`. The stub’s `query()` and `connect()` methods throw if called, and construction succeeds, so the test soundly demonstrates that Drizzle only consumes the pool reference during construction. It then checks `db.query.users` and `db.query.projectionSettings` on the real returned object.

The moved table definitions match their former definitions. No other schema table was moved or changed in the implementation diff.

One non-blocking precision issue: the first smoke-test title says the tables are exposed “exactly once,” but its assertions only prove that the canonical properties reference the expected table objects. They would not detect an additional alias property pointing to either object. The current schema was inspected and contains no such alias, so this is not a current implementation defect.

## Route and service behavior comparison

The moved route handlers are identical to the former flat handlers apart from relative import paths.

Preserved behavior includes:

- `GET /api/projection-settings`
- `PUT /api/projection-settings`
- GET response schema and status 200
- PUT body validation schema
- PUT response schema and status 200
- Session user scoping through `req.session!.userId`
- Default `equityReturnBps`
- Validation through `UpdateProjectionSettingsSchema.parse()`
- Conflict-update behavior and `updatedAt` refresh
- Response shape `{ equityReturnBps }`

No URL, HTTP method, handler body, response shape, status-code behavior, or validation implementation changed.

## Security review

No regression found.

In `buildApp()`, the order remains:

```text
setupAuth(app)
setupSecurity(app)
registerRoutes(app)
  -> planningRoutes
       -> projectionSettingsRoutes
```

The authentication hook is installed on the root Fastify instance before the nested planning plugin is registered, so it applies to the moved routes.

The routes do not declare `config.public: true`, so unauthenticated requests remain subject to the global 401 guard.

The demo-mode hook rejects `PUT` because `PUT` is in `MUTATING_METHODS`, and `/api/projection-settings` is not on the demo write allowlist. The route-injection test confirms a demo request receives 403. Because rejection occurs in the root `onRequest` hook, the update handler does not execute.

The security plugin is likewise installed before planning route registration, preserving CSRF and security-hook coverage.

## Conventions and cleanup

Passes.

- All inspected relative TypeScript imports use `.ts` extensions.
- Service and route tests are colocated with their moved implementation files.
- The plugin, route, service, and schema layering follows the documented scaffold.
- `services/goals.ts` imports the moved service from the correct new path.
- `apps/api/src/services/projection-settings.ts` no longer exists.
- `apps/api/src/routes/projection-settings.ts` no longer exists.
- No obsolete imports of those old flat paths remain outside the planning module.
- No Fastify prefix was introduced.
- Multipart/compression registration was not moved.
- `backup.ts` and `.github/workflows/ci.yml` were not changed by this implementation.

The required planning-task table entry and Known-traps wording are present. The overall `tasks/README.md` working-tree diff contains extensive unrelated changes, so its “exactly one line” history cannot be proven from the current dirty tree alone; the required new line itself is correctly written and does not create a code defect.

## Required disposition

Add genuine invalid-input coverage to `modules/planning/services/projection-settings.test.ts`. With that corrected and the required DB-backed/full-suite commands still green, the implementation is acceptance-ready.