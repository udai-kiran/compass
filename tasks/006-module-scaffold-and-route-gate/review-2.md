# Follow-up Plan Review — Task 0.3 revision 2

## Verdict

Revision 2 is substantially improved, but it is not yet implementation-ready.

Most of review-1’s required changes are genuinely resolved. The proposed plugin now exercises the intended Fastify module-entry pattern, the route-snapshot harness is correctly hermetic, the snapshot contract is precisely defined, and treating `projection_settings` as the first real planning slice is now accurate.

Two plan defects still block implementation:

1. The proposed `db/core-schema.ts` wiring does break the original cycle, but `db/schema.ts` is described as only re-exporting `users`. A re-export does not create the local `users` binding needed by all the table definitions that remain inline in `db/schema.ts`. Implementing the plan literally will produce `Cannot find name 'users'` errors.
2. The Drizzle-directory comparison still uses only `git status --short` before and after. That is not a content comparison and does not fully satisfy required change 12 or the plan’s own stronger acceptance wording.

There are also two material partial resolutions:

- The representative auth/public/demo characterization requested by review-1 is only partly supplied: projection-settings covers unauthorized and demo-write behavior, but no public-route characterization is added.
- The requested goals integration check is explicitly omitted.

Those two omissions are reasonable scope decisions under the literal roadmap acceptance criteria and need not block task 0.3, but the claim that revision 2 addresses every required change is inaccurate.

The baseline-capture design and the proposed synthetic snapshot-comparator tests should also be tightened before implementation, although neither requires a redesign.

## Review of the 12 required changes

### 1. Define a non-circular schema dependency and add runtime schema verification

**Status: Partially resolved; blocking defect remains.**

The proposed dependency graph is acyclic:

```text
db/core-schema.ts
  defines users

modules/planning/schema.ts
  imports users from db/core-schema.ts
  defines projectionSettings

db/schema.ts
  aggregates core-schema and planning/schema
```

That genuinely fixes the cycle identified in review-1. `modules/planning/schema.ts` no longer imports the aggregate barrel, and `core-schema.ts` has no reverse dependency.

However, the literal `db/schema.ts` design is invalid. The task says:

```ts
export * from "./core-schema.ts";
export * from "../modules/planning/schema.ts";
```

while leaving every other table inline and unchanged. Those inline definitions contain many expressions such as:

```ts
.references(() => users.id, ...)
```

An `export * from` declaration forwards exports to consumers; it does not bind `users` in the current module scope. After removing the inline `users` definition, `db/schema.ts` itself will have no `users` identifier.

The plan must explicitly require:

```ts
import { users } from "./core-schema.ts";

export { users } from "./core-schema.ts";
export * from "../modules/planning/schema.ts";
```

or an equivalent import-plus-export arrangement.

The runtime acceptance language is improved: AC5 requires `db.query.projectionSettings` and `db.query.users` at runtime, and `db:generate` exercises Drizzle Kit’s schema loading. Nevertheless, the plan no longer contains the concrete runtime metadata smoke test requested in review-1. It should add a hermetic test that imports the aggregate schema and verifies at least:

- `users` and `projectionSettings` are each exported once;
- their SQL names are `users` and `projection_settings`;
- `projectionSettings` retains the expected four columns;
- `createDb()` exposes both `db.query.users` and `db.query.projectionSettings`.

No live database is necessary to construct the Drizzle instance for that check.

There is also an over-broad architectural claim:

> This is the “core schema” leaf every module’s `schema.ts` may import from … each reuse[s it] for their own cross-module FKs.

This design is sound for the identity root because nearly every domain references `users`. It is not a general solution for arbitrary cross-module foreign keys. Moving every cross-module-referenced table into `core-schema.ts` would hollow out module ownership and conflict with task 1.9’s intended boundary cleanup.

The convention should say that `core-schema.ts` owns deliberately shared identity/core tables, initially only `users`. Other cross-domain dependencies still require an explicit ownership/port decision; they should not automatically be moved into “core.”

### 2. Treat the slice as the initial real planning module and correct task 1.5

**Status: Resolved.**

Revision 2 now accurately describes `projection_settings` as the first real slice of the planning module and says task 1.5 will complete the module.

The planned edit to `tasks/01.05-migrate-planning.md` corrects the existing mismatch between its route list and table list. This directly resolves review-1’s concern.

The temporary dependency from flat `services/goals.ts` into `modules/planning/services/projection-settings.ts` is also acknowledged rather than presenting the slice as fully isolated.

### 3. Make `plugin.ts` a real plugin and use it in production

**Status: Resolved.**

The proposed path is now:

```text
buildApp()
  -> registerRoutes(app)
    -> app.register(planningRoutes)
      -> app.register(projectionSettingsRoutes)
```

That is a real nested Fastify plugin arrangement, not a re-export-only file. It exercises the plugin-entry pattern Phase 1 needs, including Fastify encapsulation and descendant registration.

Keeping it unprefixed is correct for this task. It should preserve:

```text
GET /api/projection-settings
PUT /api/projection-settings
```

The root auth/security hooks are registered before `registerRoutes()` in `buildApp()`, so they apply to the descendant planning plugin. The proposed route injection test also verifies the most relevant behavior for this first nested module.

### 4. Capture the route baseline before extraction or relocation

**Status: Resolved in principle, with a new reliability weakness.**

P1 now occurs before any production edit and retains the output outside the Git diff. P3 and P6 compare against that baseline. This resolves the ordering defect from review-1.

The new weakness is that P1 proposes manually duplicating all 39 registration calls into a throwaway harness. That can reproduce the current route table—I independently registered the actual 39 current route exports in a hermetic Fastify instance, and `app.ready()` succeeded with no infrastructure—but transcription remains a source of false confidence:

- a registration could be omitted;
- the order could be copied incorrectly;
- the wrong export could be selected;
- the same copying error could then be repeated during `registerRoutes()` extraction.

The baseline artifact would still be internally consistent while not representing the literal production block.

This is not fatal if the plan adds explicit safeguards. P1 should require:

- exactly 39 copied route registrations;
- review or scripted comparison of the copied plugin/export sequence against the 39 production calls;
- confirmation that the output contains the expected approximately 155 URL patterns;
- independent extraction of `registerRoutes()`, followed by byte comparison to the retained P1 result.

A stronger option is a one-off source-driven harness that reads the existing import/register pairs rather than manually maintaining a second list, but the temporary copy is acceptable if those checks are explicit.

### 5. Make the route snapshot harness hermetic

**Status: Resolved.**

The planned harness now uses only:

```ts
const app = Fastify({ logger: false });
app.setValidatorCompiler(validatorCompiler);
app.setSerializerCompiler(serializerCompiler);
await registerRoutes(app);
await app.ready();
```

It does not use configuration, Postgres, Redis, storage, queues, the event bus, auth, or security.

That is sufficient for the real route files. I independently imported and registered all 39 current route plugins in such an app and successfully ran `app.ready()` and `printRoutes({ commonPrefix: false })`. The current handlers only access `app.db`, `app.redis`, `app.storage`, `app.config`, and similar decorations when requests execute, not while routes register or during `ready()`.

Importing `app.ts` does bring in the infrastructure modules, but those imports do not themselves call `requireEnv()`, connect to Postgres/Redis, or start jobs. Calling only the extracted `registerRoutes()` remains hermetic.

The test should close the app with `t.after(() => app.close())` or `try/finally`, even though the minimal instance has no external connections.

### 6. Fix the `printRoutes()` options and snapshot loading/newline conventions

**Status: Resolved.**

Revision 2 fixes the representation as:

```ts
app.printRoutes({ commonPrefix: false })
```

It specifies:

- UTF-8 loading;
- `import.meta.url`-relative snapshot resolution;
- byte-for-byte comparison;
- an explicit trailing-newline policy;
- no `process.cwd()` dependency.

This is sufficiently precise. It also consciously accepts route registration order and Fastify formatter output as part of the snapshot contract.

### 7. State the route gate’s actual compatibility boundary

**Status: Resolved.**

The task now clearly says the snapshot protects URL and method identity, not:

- authentication or public-route classification;
- demo-mode protection;
- CSRF or rate-limit coverage;
- hooks and hook order;
- request/response schemas;
- handler identity;
- status codes or response bodies.

This corrects the earlier overstatement that a route-table snapshot proved broader production compatibility.

Recording the limitation in `tasks/README.md` is useful, although that note should be phrased as a warning and verification requirement rather than implying the snapshot itself provides the missing protection.

### 8. Add representative auth/public/demo characterization before Phase 1

**Status: Partially resolved; deferral is a reasonable non-blocking scope decision.**

The new projection-settings route test covers two of the requested properties:

- an unauthenticated protected route is rejected;
- a demo session cannot perform `PUT`.

It also exercises authenticated `GET` and `PUT`. Because the route is registered through the new planning plugin, this provides meaningful evidence that the first nested module remains under the root auth hook.

What remains missing is a public-route characterization. The current public routes are health and selected auth endpoints using `config: { public: true }`. A future plugin migration could preserve their URLs while losing or broadening that metadata, and the route snapshot would not notice.

Revision 2 explicitly defers broad auth/public/demo/CSRF/rate-limit characterization to Phase 1 and records the issue as a Known trap. Given the literal task 0.3 acceptance criteria—route snapshot, module scaffold, no migration diff, backup coverage, full green suite—that is a defensible scope call. Task 0.3 does not promise a security-policy snapshot.

However:

- the “all required changes addressed” claim is false;
- a Known-traps entry does not mechanically obligate tasks 1.1–1.8 unless those task plans or acceptance criteria actually reference it;
- the projection-settings test means auth/demo characterization is only deferred for the full route set, not wholly out of scope.

This should be described as an explicitly accepted residual risk. It does not need to block implementation if Phase 1 task reviews enforce the requirement.

### 9. Add projection-settings characterization and a goals integration check

**Status: Partially resolved.**

The projection-settings portion is well covered. The planned tests include:

- default value when no row exists;
- validation and upsert;
- a second update of the same row;
- cross-user isolation;
- saved-value round trip;
- unauthenticated rejection;
- demo-mode `PUT` rejection.

The route test appropriately uses real Postgres/Redis because it executes handlers and auth behavior, unlike the snapshot test. Reusing the selective `buildTestApp()` pattern from `user-tasks.route.test.ts` is correct.

The goals integration portion is expressly omitted. The plan acknowledges that `services/goals.ts` consumes `getProjectionSettings` and says no existing test covers that behavior, but calls it pre-existing and out of scope. Relocating the service does not alter its behavior, and typechecking will catch a broken import, so this omission is not a hard blocker for a file-movement task. Still, it does not resolve required change 9 in full.

The route-test plan should also specify cleanup. Deleting each test user should cascade its `projection_settings` row, but the test should consistently destroy Redis sessions and delete created users in `t.after()` so failures do not leave shared test data behind.

### 10. Update `CLAUDE.md` with the transitional module convention

**Status: Resolved.**

Revision 2 includes the documentation update in this task and correctly explains that modules coexist temporarily with flat routes/services.

The documentation should apply the corrected, narrow definition of `core-schema.ts`: shared identity/core tables, initially `users`, not every table that happens to participate in a cross-domain foreign key.

### 11. Verify all real importers and remove old flat paths/files

**Status: Resolved.**

The task now identifies the actual importer set, including `services/goals.ts`, updates its import, deletes the old route and service files, and performs repository cleanup checks.

The proposed grep is useful, but the final verification should separately assert file absence:

```text
apps/api/src/routes/projection-settings.ts
apps/api/src/services/projection-settings.ts
```

A grep alone proves no imports remain; it does not prove unused old files were deleted. The Scope and T10 already intend deletion, so this is a minor verification wording improvement.

### 12. Compare the entire Drizzle output directory with its pre-task state

**Status: Partially resolved; verification method must be corrected.**

Revision 2 widens the check from “no new SQL file” to:

```text
git status --short apps/api/drizzle/
```

before and after. That catches many cases, including new files and clean-to-modified tracked metadata. It does not prove byte identity of the directory:

- if a Drizzle file is already modified before the command and remains modified afterward, identical status output says nothing about whether its content changed;
- status records file state, not content;
- a generator could alter one already-dirty file while leaving the same `M` status;
- the current repository is broadly dirty, making state-only comparisons especially inappropriate as a general verification convention, even though `apps/api/drizzle/` appears clean at review time.

The plan’s AC2 says “file list and content,” but P8 and T6 do not implement that claim.

P8 should capture a content manifest before generation, for example hashes plus relative paths for every file under `apps/api/drizzle/`, and compare it afterward. Alternatively, if the directory is verified clean first, compare both:

- `git status --short -- apps/api/drizzle`;
- `git diff --exit-code -- apps/api/drizzle`;
- untracked file listings before and after.

A hash manifest is the clearest byte-identity proof.

## Special-focus findings

### `db/core-schema.ts`: cycle fixed, but the literal barrel wiring is broken

The leaf extraction is the correct direction for `users`. It genuinely eliminates:

```text
db/schema.ts
  -> modules/planning/schema.ts
    -> db/schema.ts
```

and replaces it with a DAG.

The new issue is lexical binding, not a new cycle. `db/schema.ts` must import `users` for its own remaining inline definitions and separately re-export it for consumers.

Once corrected, the design should preserve:

```ts
type Db = NodePgDatabase<typeof schema>;
```

and both relational query properties. Runtime schema loading and Drizzle generation should be explicitly tested rather than inferred from typechecking.

The plan should not advertise `core-schema.ts` as a catch-all solution for future cross-module relationships. Keep it an intentional identity/core leaf.

### Real module plugin: the intended Phase 1 pattern is now exercised

The proposed `planningRoutes()` is a genuine Fastify plugin that registers its child route plugin, and production uses that entry. This resolves the architectural concern from review-1.

The projection-settings route injection test is especially valuable here because it verifies that the nested production pattern remains within the existing root auth hook. The route snapshot then verifies that the extra encapsulation layer does not change URL or method identity.

### Hermetic route snapshot: sufficient for the current application

The minimal harness is sufficient for the current `app.ts` and route files.

The real production-only pieces omitted from the snapshot do not add application routes:

- `setupAuth()` registers cookies and hooks;
- `setupSecurity()` registers hooks;
- multipart and compression are HTTP-support plugins;
- jobs, storage, event bus, Postgres, and Redis do not participate in route declaration.

All 39 current route modules can register and reach `app.ready()` without those decorations because their dependency access occurs inside request handlers.

The remaining architectural blind spot is unchanged: if a future developer registers an application route directly in `buildApp()` outside `registerRoutes()`, the snapshot test will miss it. The `CLAUDE.md` convention should explicitly require all application routes to be registered through `registerRoutes()` or descendants. A structural test or lint check would be stronger, but documentation plus review is adequate for task 0.3.

### Deferring full security characterization is acceptable under the literal task

The source roadmap acceptance criteria require:

- a committed route snapshot;
- failure on route additions/removals/renames;
- a proven module scaffold with no migration diff;
- backup coverage;
- a green full suite with zero URL changes.

They do not require a security-policy snapshot.

Therefore, deferring full auth/public/demo/CSRF/rate-limit characterization to Phase 1 is a reasonable scope decision, particularly because this task’s migrated route receives focused unauthenticated and demo-write coverage.

The plan should stop claiming that required change 8 was completely addressed. It should also ensure future Phase 1 plans contain explicit acceptance criteria, rather than relying solely on a prose Known-traps entry.

## New issues introduced by revision 2

### Blocking: `export *` does not bind `users` inside `db/schema.ts`

This is the most important new issue. The plan’s literal implementation cannot compile while the remaining inline tables reference an unbound `users`.

Add an explicit import and re-export.

### Medium: `core-schema.ts` is described too broadly

A leaf for `users` is appropriate. Treating it as the destination for every future cross-module-referenced table would centralize domain tables and defeat the module slices the roadmap is trying to establish.

Document it as the shared identity/core layer, not a universal cross-module-FK bucket.

### Medium: the P1 baseline is hand-copied, not directly derived from production assembly

Temporarily duplicating the 39 calls is workable but susceptible to transcription errors. Require an explicit comparison of the plugin sequence and count against `app.ts`, plus the expected route count, before accepting the baseline.

The scratch artifact should also be retained until all P3, P4, and P6 comparisons complete, then deleted.

### Medium: the synthetic comparison test may prove only the assertion wrapper

If the comparison helper is effectively:

```ts
assert.equal(actual, expected);
```

then synthetic added/removed/renamed/method examples only prove that unequal strings are unequal. They do not prove that Fastify’s route printer represents those changes.

The real assurance comes from:

- the committed output being generated by `printRoutes({ commonPrefix: false })`;
- the final output being compared to the pre-change baseline;
- the printed representation visibly including methods.

The synthetic test is harmless, but its claim should be modest. It tests the helper’s rejection behavior, not the full route-capture pipeline. If retained, implement it as `assert.throws()` around the exact helper used by the snapshot test and avoid presenting it as the primary evidence that every production method change is detectable.

### Medium: Drizzle verification wording exceeds its mechanism

AC2 promises directory content identity, while P8/T6 compare only status text. Replace that with an actual content manifest or equivalent byte comparison.

### Low: direct snapshot-test command should match the workspace’s execution convention

T4 uses:

```text
node --test apps/api/src/app.route-snapshot.test.ts
```

This should work under the repository’s Node requirement, and the test is intentionally environment-free. For consistency and to avoid cwd-dependent surprises, running from `apps/api` as:

```text
node --test src/app.route-snapshot.test.ts
```

would better mirror the other task commands. Snapshot loading via `import.meta.url` makes either invocation valid.

### Low: “approximately 155 patterns” should not substitute for an exact captured baseline

The independent current registration produced a route print with 157 output lines, which is not itself an exact URL count because formatting and implicit methods affect the representation. The committed snapshot is the authoritative contract. Any count used as a P1 sanity check should be computed explicitly from the captured representation and recorded exactly rather than relying on “~155.”

## Required changes before implementation

1. Correct the schema-barrel plan so `db/schema.ts` explicitly imports `users` for its remaining inline definitions and re-exports it for consumers.
2. Add the promised hermetic runtime schema smoke test, or specify an equally concrete runtime verification for aggregate exports, SQL names/columns, and `db.query.users`/`db.query.projectionSettings`.
3. Narrow the documented purpose of `core-schema.ts` to intentional shared identity/core tables; do not present it as the default destination for every cross-module FK target.
4. Replace the Drizzle pre/post `git status` comparison with a real file-list-and-content comparison.
5. Add explicit safeguards around the manually duplicated P1 registration list: exact 39-plugin sequence verification and an exact baseline sanity count.
6. Reword the “all required changes addressed” claim: required changes 8 and 9 are only partially addressed and deliberately deferred.

With those corrections, the plan will be implementation-ready. The remaining absence of a public-route characterization and goals integration test can be accepted as documented, non-blocking scope debt under task 0.3’s literal acceptance criteria.