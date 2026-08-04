# Plan Review — Task 0.3: Module scaffold + route-table identity gate

## Verdict

The route-table gate is directionally sound, and `projection_settings` is among the smallest behavioral slices available. However, the plan is not implementation-ready.

Two issues need resolution before work begins:

1. Moving `projectionSettings` into `modules/planning/schema.ts` while it references `users` creates an under-specified schema dependency and likely a circular module graph through the proposed `db/schema.ts` barrel.
2. The proposed `plugin.ts` is merely a re-export while production continues registering the route function directly. That does not actually prove the module-plugin wiring pattern Phase 1 is supposed to rely on.

The route snapshot harness is also considerably more stateful than necessary. Route registration currently needs neither Postgres, Redis, storage, the event bus, authentication, nor security. Using real infrastructure would add failure modes without improving the route-table characterization.

## 1. Incorrect assumptions about the codebase

### High: `projection_settings` is not independent of the remaining flat schema

The table is small, but it is not self-contained:

```ts
export const projectionSettings = pgTable("projection_settings", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  // ...
});
```

The plan says to move this definition “verbatim” into `modules/planning/schema.ts` and re-export it from `db/schema.ts`, but does not say how the moved file obtains `users`.

The obvious import:

```ts
import { users } from "../../db/schema.ts";
```

would create this graph:

```text
db/schema.ts
  re-exports modules/planning/schema.ts
    imports users from db/schema.ts
```

Even if Drizzle’s lazy foreign-key callback happens not to trigger an immediate temporal-dead-zone failure, this is a circular schema dependency and a poor foundation for the remaining module migration. It also conflicts with the intended end state in task 1.9, where modules should not reach through the aggregate schema barrel to obtain another module’s tables.

The plan must explicitly define the cross-slice foreign-key convention before selecting this proof slice. Reasonable options include extracting an identity/core schema slice first, or otherwise introducing a non-circular schema dependency mechanism. Silently importing `users` from the barrel is not acceptable.

### Medium: the plan incorrectly calls this unrelated to the real Phase 1 boundaries

The plan says `projection_settings` is “deliberately not one of the 8 real Phase-1 module boundaries” and calls it a “throwaway proof slice.”

That is factually inconsistent with the roadmap:

- The proposed destination is `modules/planning/`.
- Task 1.5 is explicitly “Migrate planning module.”
- Task 1.5 explicitly lists `projection-settings` among the planning routes.

This task would therefore begin the real planning-module migration, even if only with one slice. Calling it throwaway understates the ownership decision and invites task 1.5 to reorganize it again.

The plan should state that task 0.3 establishes the initial planning module and task 1.5 completes it. The task 1.5 table list should also be corrected to include `projection_settings`, which it currently omits.

### Medium: the plugin scaffold is not actually exercised

The plan proposes:

- `modules/planning/plugin.ts` as a thin re-export of `projectionSettingsRoutes`
- `app.ts` importing `projectionSettingsRoutes` from its new route path
- production continuing to register the route function directly

That proves file relocation, but not a module plugin-entry pattern. The proposed `plugin.ts` is dead indirection and could be deleted without changing the application.

If `plugin.ts` is the convention Phase 1 will follow, `app.ts` should import and register the plugin entry. The plugin should register the projection-settings route internally, without a prefix for this task. The route snapshot would then characterize the exact indirect-registration mechanism Phase 1 is preparing to use.

### Low: the importer list in the prose is speculative

The task mentions checking `goal-plan.ts`, `goal-projection.ts`, and similar files. The actual additional service importer is:

```text
apps/api/src/services/goals.ts
  -> ./projection-settings.ts
```

The complete production TypeScript importer set is currently:

- `apps/api/src/app.ts` imports the route.
- `apps/api/src/routes/projection-settings.ts` imports the service.
- `apps/api/src/services/goals.ts` imports `getProjectionSettings`.
- `apps/api/src/services/projection-settings.ts` imports the table from the schema barrel.

The plan’s eventual whole-repository grep would find these, but its factual description should identify `services/goals.ts` directly.

### Low: “39 app.register calls” needs qualification

There are 39 route-module registrations, but 41 registrations in the relevant portion of `buildApp()` when `multipart` and `compress` are included. The plan generally says “39 route registrations,” which is accurate, but several passages loosely describe them as the full registration block.

The extracted helper should be described specifically as the route-module registration block. Multipart and compression should remain in production setup unless the helper is deliberately widened to cover all HTTP plugins.

## 2. Missing scope and edge cases

### High: define the schema dependency/barrel design before implementation

The plan needs an explicit step and acceptance criterion covering:

- how `modules/planning/schema.ts` references `users`;
- avoidance of a `db/schema.ts ↔ modules/planning/schema.ts` cycle;
- preservation of `Db = NodePgDatabase<typeof schema>`;
- preservation of `db.query.projectionSettings`;
- successful direct import/evaluation of `db/schema.ts`;
- successful Drizzle introspection.

`db:generate` producing no SQL is necessary but not sufficient. Typechecking can pass despite an unsafe runtime ESM cycle.

### High: exercise `plugin.ts` in production

The scaffold’s acceptance criterion should require that the production registration path uses the module entry:

```text
app.ts/registerRoutes
  -> modules/planning/plugin.ts
    -> modules/planning/routes/projection-settings.ts
```

A re-export that production bypasses does not prove the intended architecture.

The plugin should remain unprefixed in task 0.3 so the URL stays `/api/projection-settings`. Phase 1 can later introduce module prefixes under the snapshot gate.

### Medium: `projection_settings` is probably the smallest behavioral slice, but not dependency-free

Its advantages are real:

- one small table;
- two endpoints;
- one service;
- unchanged backup classification;
- no child tables;
- no jobs, queues, object storage, or event-bus behavior;
- no ledger mutation side effects.

Its disadvantages are:

- FK dependency on `users`;
- a real cross-service consumer in `services/goals.ts`;
- it belongs to the actual planning module that task 1.5 will complete.

It remains a reasonable choice if the identity-schema dependency is designed first. Without that design, it is not the “safest” slice merely because it has few lines.

### Medium: `setupAuth()` and `setupSecurity()` are not required for the current route snapshot

Neither plugin conditionally registers application routes.

`setupAuth()`:

- registers `@fastify/cookie`;
- decorates requests with `session`;
- adds an `onRequest` hook.

`setupSecurity()`:

- adds `onSend` and `onRequest` hooks;
- registers no routes;
- adds no decoration needed while application routes are being declared.

The route modules refer to `req.session`, `app.db`, `app.redis`, and similar values inside request handlers, not while registering routes. Those handlers do not run during `app.ready()` or `printRoutes()`.

Therefore, for the current code, the route-snapshot app needs only:

- `Fastify({ logger: false })`;
- the Zod validator compiler;
- the Zod serializer compiler;
- `registerRoutes(app)`;
- `await app.ready()`.

It does not need real config, Postgres, Redis, storage, queues, the event bus, auth, or security.

Running auth and security would not make `printRoutes()` more production-realistic because the default output does not characterize hooks, authentication policy, CSRF behavior, rate limits, or security headers. It would merely make the test depend on environment and infrastructure.

If the intended snapshot includes route metadata or hooks, the plan must say so and use appropriate `printRoutes()` options. That would be a broader and much noisier compatibility contract than the roadmap currently requests.

### Medium: extracting `registerRoutes()` is safe for current route identity, but not a complete production-assembly guarantee

For today’s code, extracting the 39 route calls unchanged is sufficient for the route table because:

- all production application routes are in those 39 route plugins;
- auth and security add hooks, not routes;
- multipart and compression do not add application URLs;
- route handlers do not execute during registration.

There is nevertheless a future blind spot: a developer could add a route registration directly to `buildApp()` outside `registerRoutes()`. The snapshot test would continue calling only `registerRoutes()` and would miss the new production route.

The plan should establish and document an enforceable convention that every application route is registered exclusively through `registerRoutes()` or its descendant module plugins. A small architectural test or lint rule would be stronger than documentation, but documentation plus review may be sufficient for task 0.3. The current acceptance claim that the test fails on “any route added” is otherwise too broad.

### Medium: establish the exact `printRoutes()` options

The plan says byte-for-byte `app.printRoutes()` but does not lock down options. It should explicitly use one stable call, preferably:

```ts
app.printRoutes({ commonPrefix: false })
```

A flat representation is easier to review and diff during module-prefix changes than Fastify’s radix-tree rendering. Whichever form is chosen must be fixed in the test and generation instructions.

The plan should also document that the snapshot captures:

- URL structure;
- registered methods, including Fastify’s implicit `HEAD` behavior where applicable.

It does not capture:

- request/response schemas;
- route configuration such as `config.public`;
- hooks or hook order;
- handler identity;
- authentication behavior;
- response compatibility.

That limitation is acceptable for this roadmap gate but should be stated accurately.

### Medium: snapshot file loading is unspecified

The test should load the committed snapshot relative to the test module, using `import.meta.url`, rather than depending on the process working directory. Root test scripts and direct `node --test` invocations should behave identically.

The plan should also specify UTF-8 and avoid silently trimming the value. If equality is byte-for-byte, trailing newline policy must be deliberate.

### Medium: baseline capture must occur before route relocation

T7 says the baseline is captured as part of T4’s “before-any-edit state,” but P3 occurs after P1/P2 in the written order. The task should explicitly capture and retain the baseline before:

- extracting `registerRoutes()`;
- changing the projection-settings registration path;
- adding the module plugin.

Otherwise, a mistake introduced during extraction could become the committed baseline and pass forever.

A safe order is:

1. Build a temporary/read-only baseline harness against the current registrations.
2. Capture the route output.
3. Commit the snapshot test.
4. Extract the shared registration helper without changing output.
5. Move the module and verify the same snapshot again.

## 3. Regressions the plan could introduce

### High: runtime failure or incomplete Drizzle schema from circular imports

The proposed barrel may introduce a runtime ESM cycle between the schema barrel and planning schema. Possible consequences include:

- initialization-time reference errors;
- foreign-key callbacks resolving an uninitialized binding;
- Drizzle Kit failing to introspect the schema;
- `db.query.projectionSettings` disappearing or becoming incorrectly typed;
- different behavior between TypeScript checking, Node runtime, and Drizzle Kit loading.

“No migration generated” does not rule out all of these.

### High: scaffold drift because production bypasses the plugin

If production imports the route directly and `plugin.ts` only re-exports it, Phase 1 implementers may copy a pattern that has never been exercised. Later switching to real nested plugins can expose Fastify encapsulation or prefix behavior only after the supposed scaffold task is complete.

### Medium: route snapshot can bless an already-changed route table

Generating the committed snapshot after refactoring without preserving a pre-change baseline risks recording a regression as the expected result.

The temporary perturbation test proves the assertion mechanism reacts to later differences. It does not prove the committed snapshot represents the pre-task production table.

### Medium: unnecessarily infrastructure-backed tests can become flaky or destructive

The planned harness contemplates real:

- Postgres;
- Redis;
- storage initialization;
- configuration;
- event bus.

None is needed to print the current routes. Including them would create:

- environment failures unrelated to route identity;
- Redis connection cleanup concerns;
- storage directory or object-store side effects;
- possible database connection exhaustion;
- slower full-suite execution;
- pressure to add `requireEnv()` guards to a test that should be hermetic.

The existing `buildTestApp()` convention is appropriate for injection tests that actually exercise authentication and database behavior. It should not be copied mechanically into a pure registration snapshot.

### Medium: cross-service import direction may worsen

Moving `getProjectionSettings()` into `modules/planning/services/` means the still-flat `services/goals.ts` must import into the module. That is acceptable as a temporary migration dependency, but it should be acknowledged and later eliminated when goals moves into the same planning module.

The plan should not present the slice as fully self-contained while this importer remains outside it.

### Low: snapshot churn on Fastify upgrades

A raw `printRoutes()` text snapshot is coupled to Fastify/find-my-way formatting. Dependency upgrades may change whitespace or tree rendering without changing API behavior. This is not a reason to reject the gate, but failure triage should distinguish:

- real route changes;
- method changes;
- serializer formatting changes caused by dependency upgrades.

A flat `commonPrefix: false` representation may reduce incidental churn.

## 4. Security and compatibility risks

### Medium: route identity is narrower than API compatibility

The proposed gate protects URL/method identity. It does not protect:

- `config.public` metadata;
- authentication requirements;
- demo-mode write protection;
- CSRF handling;
- rate-limit classification;
- schemas;
- status codes;
- response bodies;
- handler behavior.

The task should avoid describing the route snapshot as proving full API compatibility or “production reality.” It proves route-table identity only.

### Medium: future plugin encapsulation can change hook coverage without changing the snapshot

Phase 1 will introduce nested/prefixed plugins. Fastify hooks are encapsulated by plugin scope and registration order. A module could preserve every URL and method while accidentally moving routes outside the auth/security hook scope.

The route snapshot would remain green.

Task 0.3 should add at least a small security characterization test confirming representative routes remain:

- unauthorized without a session;
- demo-write-protected for a mutating endpoint;
- public only where explicitly configured.

Alternatively, this limitation must be called out as a separate Phase 1 gate. Given the scale of the planned plugin migration, relying only on URL snapshots leaves a meaningful security regression class uncovered.

### Medium: public-route configuration is not included

Health and selected auth endpoints use `config: { public: true }`, while the global auth hook protects everything else. Moving routes through plugins could preserve URLs but lose or accidentally broaden public configuration.

A focused route-config/security test is more valuable than invoking `setupAuth()` in the print-only snapshot app.

### Low: route order is not necessarily a compatibility contract

Byte-for-byte tree output may detect changes caused by registration order even when URL/method identity is identical. The task says order must remain unchanged, so this is currently acceptable, but it should be a conscious constraint rather than an accidental consequence of the formatter.

## 5. Missing tests and verification

### High: schema barrel runtime smoke test

Add a test that imports the aggregate schema and confirms:

- `projectionSettings` is present exactly once;
- its SQL name is `projection_settings`;
- its columns remain `user_id`, `equity_return_bps`, `created_at`, and `updated_at`;
- its primary key and FK metadata remain intact where Drizzle exposes them;
- `createDb()` still exposes `db.query.projectionSettings`.

This test should load the real modules at runtime, not only rely on `tsc`.

### High: production must use the module plugin

Add a structural or behavior test proving that registering the planning plugin creates both projection-settings routes with unchanged methods and URLs. This is especially important if the main snapshot test registers only the aggregate `registerRoutes()` helper.

### High: pre-change and post-change snapshot comparison

Verification must compare the final snapshot against output captured before any refactor. The snapshot test alone cannot establish this retroactively.

### Medium: projection-settings endpoint behavior

There are currently no tests specifically covering the projection-settings service or routes. File movement should add or preserve characterization for:

- GET returns the default when no row exists;
- PUT validates input and upserts;
- a second PUT updates the existing user row;
- users cannot affect each other’s settings;
- GET returns the saved value;
- unauthorized access is rejected;
- demo sessions cannot PUT.

At minimum, add a small service test plus a route injection test. This is the one behavioral slice being used to prove the module scaffold, so verifying only URL presence is weak.

### Medium: goals integration

Because `services/goals.ts` consumes `getProjectionSettings`, add or identify an existing test proving goal projection still uses the per-user equity-return setting after the import move. Typechecking only proves the symbol resolves, not that the real integration still behaves correctly.

### Medium: no-DB route snapshot test

The route snapshot test should explicitly prove it runs without `DATABASE_URL`, `REDIS_URL`, or `SESSION_SECRET`. It should not inherit the `requireEnv()` convention because that convention applies only to genuinely DB/Redis-backed tests.

### Medium: snapshot sensitivity should cover methods as well as paths

The acceptance criteria mention added, removed, and renamed routes. The test should also be demonstrated to fail on a method change, such as GET to POST, since `printRoutes()` captures methods and method compatibility is as important as path identity.

### Medium: cleanup verification for old paths

After relocation, grep should assert there are no imports of:

- `routes/projection-settings.ts` from the old flat location;
- `services/projection-settings.ts` from the old flat location.

It should also confirm the old files are actually removed and that the new module entry is the production import.

### Medium: backup test selection

`apps/api/src/services/backup.test.ts` contains both hermetic schema-coverage tests and real database-backed tests later in the file. Running the entire file may require environment setup. The plan should use the established `requireEnv()` convention if new DB-backed coverage is added, or select the relevant named structural tests when the purpose is only to verify schema enumeration.

The plan’s `--test-name-pattern=backup` suggestion may not select tests whose names do not include “backup,” including the per-user coverage checks. Prefer the exact file with the required environment loaded, or explicit name patterns that match the actual test names.

### Low: verify source and generated migration state separately

`db:generate` should be accompanied by:

- pre-command `git status --short apps/api/drizzle`;
- post-command status;
- inspection of any changed metadata as well as `.sql` files.

“No new migration file” is weaker than “no change anywhere under `apps/api/drizzle/` relative to the pre-task baseline.”

## 6. Unnecessary complexity

### High: real infrastructure in the route snapshot harness

Decorating `config`, `pg`, `db`, `redis`, `storage`, and `eventBus` is unnecessary for current route registration. It makes the test slower, less reliable, and harder to run.

A minimal harness is sufficient:

```ts
const app = Fastify({ logger: false });
app.setValidatorCompiler(validatorCompiler);
app.setSerializerCompiler(serializerCompiler);
await registerRoutes(app);
await app.ready();
```

Then compare `app.printRoutes(...)` and close the Fastify instance.

No `requireEnv()`, database pool, Redis client, storage initialization, auth, security, queues, or jobs are required.

### Medium: a re-export-only `plugin.ts`

A file whose sole purpose is to re-export a route function, while production imports the route directly, is unnecessary complexity. Either make it the actual Fastify plugin entry and use it, or omit it until it has a real role. Given the task objective, using it is preferable.

### Medium: manual perturbation is not a substitute for deterministic tests

Temporarily editing a production route and reverting it is useful implementation evidence, but it should not be a central acceptance mechanism. A deterministic unit-level characterization can show the comparison rejects a deliberately different string without touching source files.

The important implementation proof is the before/after production snapshot comparison, not a manually reverted edit.

### Low: documenting the convention in a source comment is insufficient

A comment in `plugin.ts` is easy to miss and will become stale. Since this task establishes an architecture used by eight subsequent tasks, the module convention belongs in `CLAUDE.md` or a short module-level README. Task 1.9 already expects `CLAUDE.md` to be updated eventually, but deferring all documentation means Phase 1 begins without a canonical convention.

## 7. Convention violations

### High: circular imports conflict with the intended module-boundary conventions

Importing `users` from the aggregate `db/schema.ts` barrel inside `modules/planning/schema.ts` would make the aggregate root a dependency of one of its leaves. That is the inverse of a healthy barrel structure and undermines task 1.9’s “no module imports another module’s schema slice directly” goal.

The schema dependency direction must be defined explicitly.

### Medium: bypassing `plugin.ts` conflicts with the stated scaffold convention

The task says the layout is:

```text
modules/<domain>/
  schema.ts
  services/
  routes/
  plugin.ts
```

If `app.ts` imports the route beneath the entry point directly, the code violates its own newly stated convention on the first migrated slice.

### Medium: the proposed test misapplies the `buildTestApp()` convention

The repository convention established in `user-tasks.route.test.ts` is not “every route test uses real Postgres and Redis.” It is:

- do not reuse `buildApp()` where that would start jobs;
- wire only the dependencies needed by the test;
- use `requireEnv()` for genuinely DB-backed tests;
- close resources cleanly.

For a print-only registration test, “only the dependencies needed” means no external dependencies.

### Medium: missing colocated behavioral tests

`CLAUDE.md` says tests are colocated next to source. A module move should place new projection-settings service tests alongside the moved service and route tests alongside the moved route, rather than relying exclusively on a global `app.route-snapshot.test.ts`.

The global route-table test itself is appropriately colocated with `app.ts`.

### Medium: architecture documentation is being deferred too far

`CLAUDE.md` currently says new API features use flat `services/x.ts`, `routes/x.ts`, and registration in `app.ts`. After this task, that guidance will become partially false.

The plan should update `CLAUDE.md` in task 0.3 to describe the transitional module convention, while noting that most domains remain flat until Phase 1. Waiting until task 1.9 leaves every intervening migration task operating against stale repository guidance.

### Low: ESM import extensions must be explicit in all new files

The plan generally acknowledges import-path updates but should explicitly preserve the repository’s `.ts` extension convention in:

- the schema re-export;
- module service imports;
- module route imports;
- plugin imports;
- snapshot file loading code where applicable.

## Required plan changes before implementation

1. Define a non-circular way for `modules/planning/schema.ts` to reference `users`; add runtime schema-import verification.
2. Treat this as the initial real planning-module slice, not a throwaway unrelated scaffold; update task 1.5’s ownership/table description accordingly.
3. Make `modules/planning/plugin.ts` a real Fastify plugin entry and have production register it.
4. Capture the route baseline before any extraction or relocation.
5. Make the route snapshot harness hermetic: Fastify plus Zod compilers and route registration only.
6. State fixed `printRoutes()` options and snapshot newline/loading conventions.
7. Document that the snapshot protects URL/method identity, not auth, schemas, hooks, or response compatibility.
8. Add focused auth/public/demo-mode characterization for representative routes before Phase 1 plugin encapsulation begins.
9. Add projection-settings service/route characterization and a goals-integration check.
10. Update `CLAUDE.md` with the transitional module convention in this task.
11. Verify all actual importers, especially `services/goals.ts`, and assert old flat imports/files are gone.
12. Compare the entire Drizzle output directory against its pre-task state, not only the presence of new SQL files.