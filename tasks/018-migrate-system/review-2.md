## Findings

- Non-blocking — [system.route.test.ts:323](/home/udai/PennyPilot/apps/api/src/modules/system/routes/system.route.test.ts:323): T6(g) would still pass if the entire auth hook were removed, because `/health` would remain reachable. It genuinely detects removal of `/health`’s `config.public` while auth remains active, and T6(a) independently detects removal of the auth hook, so the combined suite satisfies AC2/AC3. This is only an assertion-isolation weakness, not an acceptance blocker.

No blocking findings.

## Plan assessment

- P1 — Satisfied. [plugin.ts:27](/home/udai/PennyPilot/apps/api/src/modules/system/plugin.ts:27) registers health → auth → notifications → backup → profile. [schema.ts:30](/home/udai/PennyPilot/apps/api/src/modules/system/schema.ts:30) exports `users` from `db/core-schema.ts`; lines 31–39 export exactly the five other tables and two enums from `db/schema.ts`. It does not export `budgetAlerts` or `categories`.

- P2 — Satisfied. All nine services and three colocated tests were moved. Direct comparisons against each old Git blob show only import-specifier changes. Handler/service bodies, SQL, cache keys (`sess:` and `sess-user:`), backup table/column strings, and demo data/allowlist behavior are unchanged. Cross-module dependencies remain direct imports, including [auth.ts:8](/home/udai/PennyPilot/apps/api/src/modules/system/services/auth.ts:8), [demo.ts:27](/home/udai/PennyPilot/apps/api/src/modules/system/services/demo.ts:27), and [notifications.ts:8](/home/udai/PennyPilot/apps/api/src/modules/system/services/notifications.ts:8); none was converted to a port.

- P3 — Satisfied. All five route files moved with route methods, URLs, schemas, `config.public`, and handler bodies unchanged. Only necessary relative import paths changed.

- P4 — Satisfied. [app.ts:19](/home/udai/PennyPilot/apps/api/src/app.ts:19) imports `systemRoutes`; [app.ts:140](/home/udai/PennyPilot/apps/api/src/app.ts:140) registers it first, and lines 141–147 preserve the relative order of all remaining plugins. Lines 128–137 document the expected tree re-nesting.

- P5 — Satisfied and exhaustive. Independent searches for every moved route/service found no surviving legacy-path importer. Updated inbound edges include:

  - [plugins/auth.ts:3](/home/udai/PennyPilot/apps/api/src/plugins/auth.ts:3)
  - [jobs/index.ts:4](/home/udai/PennyPilot/apps/api/src/jobs/index.ts:4), lines 16–17
  - [db/restore.ts:4](/home/udai/PennyPilot/apps/api/src/db/restore.ts:4)
  - [credit/services/alerts.ts:5](/home/udai/PennyPilot/apps/api/src/modules/credit/services/alerts.ts:5)
  - [planning/services/bills.ts:7](/home/udai/PennyPilot/apps/api/src/modules/planning/services/bills.ts:7), lines 7–8
  - [planning/services/goals.ts:43](/home/udai/PennyPilot/apps/api/src/modules/planning/services/goals.ts:43), lines 43–45
  - [autopilot.ts:9](/home/udai/PennyPilot/apps/api/src/services/autopilot.ts:9), lines 9–10
  - [anomaly.ts:6](/home/udai/PennyPilot/apps/api/src/services/anomaly.ts:6), lines 6–7
  - All eight specified foreign-module route tests now import session from `modules/system/services/session.ts`.

  Searches across `apps/ingestor` and `apps/extractor` found no moved-file imports.

- P6 — Satisfied. [schema.smoke.test.ts:31](/home/udai/PennyPilot/apps/api/src/modules/system/schema.smoke.test.ts:31) checks all six table identities and SQL names; lines 45–54 prove the `users` core-schema path; lines 56–63 check both enums; lines 66–91 check runtime `db.query` accessors. [plugin.test.ts:18](/home/udai/PennyPilot/apps/api/src/modules/system/plugin.test.ts:18) covers one route from each route file. `system.route.test.ts` supplies T6(a)–(g).

- P7 — Satisfied. `route-table.snapshot.txt` matches the currently generated `printRoutes()` output byte-for-byte. Its diff only relocates existing route-tree entries. `route-surface.snapshot.txt` is untouched and the canonical surface test passes.

## T6 genuineness

- T6(a), [system.route.test.ts:135](/home/udai/PennyPilot/apps/api/src/modules/system/routes/system.route.test.ts:135) — Genuine. Without authentication enforcement it returns something other than the asserted 401.

- T6(b), [system.route.test.ts:144](/home/udai/PennyPilot/apps/api/src/modules/system/routes/system.route.test.ts:144) — Genuine. It compares the exact five-route public set and excludes Fastify-generated HEAD entries correctly at lines 162–171. Any missing or additional explicitly declared public route fails the set comparison; non-public entries are also checked at lines 174–184.

- T6(c), [system.route.test.ts:189](/home/udai/PennyPilot/apps/api/src/modules/system/routes/system.route.test.ts:189) — Genuine. It seeds a real `user_profiles` row, uses a valid demo session and valid changed DOB, asserts `DemoReadOnly` 403 and unchanged persisted state, then lines 233–250 run the same body through a non-demo session and require a successful 200/update. Removal of the demo guard makes the demo assertion fail.

- T6(d), [system.route.test.ts:254](/home/udai/PennyPilot/apps/api/src/modules/system/routes/system.route.test.ts:254) — Genuine. It uses a non-demo session and a valid existing mutation, so the asserted 403 can only come from hostile-Origin CSRF rejection.

- T6(e), [system.route.test.ts:275](/home/udai/PennyPilot/apps/api/src/modules/system/routes/system.route.test.ts:275) — Genuine. It calls the real pre-existing `_test.bucketFor` export and compares all auth/read/write cases against the real bucket objects.

- T6(f), [system.route.test.ts:297](/home/udai/PennyPilot/apps/api/src/modules/system/routes/system.route.test.ts:297) — Genuine HTTP injection. Removing any header-setting line causes its exact assertion to fail.

- T6(g), [system.route.test.ts:323](/home/udai/PennyPilot/apps/api/src/modules/system/routes/system.route.test.ts:323) — Real HTTP injection with exact body checks. The non-blocking isolation caveat is noted above; combined with T6(a), it proves the intended mechanism.

Iteration 2 did not modify [plugins/security.ts:99](/home/udai/PennyPilot/apps/api/src/plugins/security.ts:99). `_test`, including `bucketFor`, was pre-existing; no export was added.

## Acceptance criteria

- AC1 — Satisfied. Canonical surface is byte-identical, raw route table matches its regenerated snapshot, no schema/migration/core-schema diff exists, and the full API suite—including moved backup tests—passes.

- AC2 — Satisfied. T6(a) proves the app-level auth hook applies through `systemRoutes`; the eight other modules’ existing authenticated route suites reran successfully.

- AC3 — Satisfied. The exact system public set is asserted, including correct HEAD handling, and real unauthenticated `/health` returns 200.

- AC4 — Satisfied. T6(c) proves a prevented write, unchanged database state, and a same-body non-demo success control.

- AC5 — Satisfied. CSRF, all six headers, and real rate-bucket classification are covered. Production [security.ts:23](/home/udai/PennyPilot/apps/api/src/plugins/security.ts:23) and lines 41–97 are unchanged.

- AC6 — Satisfied subject to the documented pre-existing extractor waiver. API typecheck passed; repository lint passed; API tests passed 881 with one storage-contract skip; ingestor passed 12/12. Extractor passed 62 tests and retained its known single `DATABASE_URL` setup failure in `statement-duplicate.test.ts`, exactly matching the approved task’s pre-existing waiver.

- AC7 — Satisfied. Object identity, SQL names, both enum identities, query accessors, and `users` resolving through the core-schema leaf all pass.

The implementation satisfies P1–P7 and AC1–AC7 with no runtime behavior change. The only finding is the non-blocking standalone sensitivity limitation in T6(g); the combined guard suite closes that gap.