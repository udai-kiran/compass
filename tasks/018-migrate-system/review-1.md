## Findings

1. **Blocking — P5 omits two inbound consumers of moved `notifications.ts` and `prefs.ts`.**

   `services/autopilot.ts` imports both `createNotification` and `prefEnabled` from the flat services at [apps/api/src/services/autopilot.ts:9](/home/udai/PennyPilot/apps/api/src/services/autopilot.ts:9) and [apps/api/src/services/autopilot.ts:10](/home/udai/PennyPilot/apps/api/src/services/autopilot.ts:10). `services/anomaly.ts` likewise imports `createNotification` and `listPrefs` at [apps/api/src/services/anomaly.ts:6](/home/udai/PennyPilot/apps/api/src/services/anomaly.ts:6) and [apps/api/src/services/anomaly.ts:7](/home/udai/PennyPilot/apps/api/src/services/anomaly.ts:7).

   Both files are intentionally deferred flat services under the batch charter ([tasks/BATCH-phase1-close.md:30](/home/udai/PennyPilot/tasks/BATCH-phase1-close.md:30)), so their imports must be changed to `../modules/system/services/{notifications,prefs}.ts`. P5 lists jobs, restore, credit, planning, and session-test consumers but omits these two files ([tasks/018-migrate-system/TASK.md:90](/home/udai/PennyPilot/tasks/018-migrate-system/TASK.md:90)-[100](/home/udai/PennyPilot/tasks/018-migrate-system/TASK.md:100)). Without these edits, typechecking/module resolution will fail.

   The independent importer audit found no other omitted external consumers. In particular, the eight external `session.ts` test consumers listed in P5 are exhaustive; the ninth non-plugin consumer is `routes/auth.ts`, which moves with the service.

2. **Blocking — AC2’s “route in another module” proof is absent from T6.**

   AC2 requires both an authenticated system route and a route in another module to return 401 unauthenticated ([tasks/018-migrate-system/TASK.md:112](/home/udai/PennyPilot/tasks/018-migrate-system/TASK.md:112)-[113](/home/udai/PennyPilot/tasks/018-migrate-system/TASK.md:113)). The planned harness registers only `systemRoutes` ([tasks/018-migrate-system/TASK.md:137](/home/udai/PennyPilot/tasks/018-migrate-system/TASK.md:137)-[139](/home/udai/PennyPilot/tasks/018-migrate-system/TASK.md:139)), and T6(a) asserts only an unauthenticated system route ([tasks/018-migrate-system/TASK.md:139](/home/udai/PennyPilot/tasks/018-migrate-system/TASK.md:139)-[140](/home/udai/PennyPilot/tasks/018-migrate-system/TASK.md:140)). It cannot exercise any other module.

   Either register a representative non-system module in this harness and assert its 401, or make the AC rely explicitly on an existing whole-app test that is rerun after migration.

3. **Blocking — the security-header portion of AC5 has no planned assertion.**

   AC5 expressly includes security headers ([tasks/018-migrate-system/TASK.md:120](/home/udai/PennyPilot/tasks/018-migrate-system/TASK.md:120)-[121](/home/udai/PennyPilot/tasks/018-migrate-system/TASK.md:121)), but T6 covers public metadata, demo protection, CSRF, and bucket classification only ([tasks/018-migrate-system/TASK.md:140](/home/udai/PennyPilot/tasks/018-migrate-system/TASK.md:140)-[146](/home/udai/PennyPilot/tasks/018-migrate-system/TASK.md:146)). The actual security plugin installs six unconditional response headers in its app-level `onSend` hook ([apps/api/src/plugins/security.ts:50](/home/udai/PennyPilot/apps/api/src/plugins/security.ts:50)-[63](/home/udai/PennyPilot/apps/api/src/plugins/security.ts:63)). Add a response-level assertion against an encapsulated system route, preferably checking all six unconditional headers.

4. **Blocking — T6 does not actually prove `/health` remains reachable unauthenticated.**

   AC3 requires `/health` to be reachable without authentication ([tasks/018-migrate-system/TASK.md:114](/home/udai/PennyPilot/tasks/018-migrate-system/TASK.md:114)-[116](/home/udai/PennyPilot/tasks/018-migrate-system/TASK.md:116)). T6(b) only proposes `onRoute` introspection of `config.public` ([tasks/018-migrate-system/TASK.md:140](/home/udai/PennyPilot/tasks/018-migrate-system/TASK.md:140)-[141](/home/udai/PennyPilot/tasks/018-migrate-system/TASK.md:141)). Metadata inspection proves the flag survived relocation, but not that the app-level auth hook honors it across the encapsulation boundary.

   Add an unauthenticated `GET /health` assertion with its expected successful status/body. The source route does carry `config: { public: true }` at [apps/api/src/routes/health.ts:10](/home/udai/PennyPilot/apps/api/src/routes/health.ts:10), while the auth hook consumes that metadata at [apps/api/src/plugins/auth.ts:55](/home/udai/PennyPilot/apps/api/src/plugins/auth.ts:55)-[61](/home/udai/PennyPilot/apps/api/src/plugins/auth.ts:61).

5. **Non-blocking — the claimed exact global public set is stronger than the proposed introspection scope.**

   AC3 calls the five routes the “exact public-route set” ([tasks/018-migrate-system/TASK.md:114](/home/udai/PennyPilot/tasks/018-migrate-system/TASK.md:114)-[116](/home/udai/PennyPilot/tasks/018-migrate-system/TASK.md:116)), but T6’s collector sees only routes registered by `systemRoutes`. It can prove the exact public set within the system module, not that no other module has acquired `config.public`.

   The five source flags themselves are correct: `/health` plus four auth endpoints; the auth route flags occur at [apps/api/src/routes/auth.ts:29](/home/udai/PennyPilot/apps/api/src/routes/auth.ts:29), [43](/home/udai/PennyPilot/apps/api/src/routes/auth.ts:43), [57](/home/udai/PennyPilot/apps/api/src/routes/auth.ts:57), and [73](/home/udai/PennyPilot/apps/api/src/routes/auth.ts:73). If “exact” is intended globally, assert it through the whole-app route collector/snapshot test. Otherwise narrow the AC wording to “exact public set within system.”

6. **Non-blocking — schema smoke coverage is weaker than the 1.7 precedent on SQL names.**

   P6 requests object identity and `db.query` accessors ([tasks/018-migrate-system/TASK.md:101](/home/udai/PennyPilot/tasks/018-migrate-system/TASK.md:101)-[103](/home/udai/PennyPilot/tasks/018-migrate-system/TASK.md:103)), but not SQL table-name assertions. The sibling ingest smoke test checks each re-export’s physical SQL name at [apps/api/src/modules/ingest/schema.smoke.test.ts:36](/home/udai/PennyPilot/apps/api/src/modules/ingest/schema.smoke.test.ts:36)-[47](/home/udai/PennyPilot/apps/api/src/modules/ingest/schema.smoke.test.ts:47). Because this task explicitly treats table/column names as invariants, matching that check for all six system tables would preserve the established convention and provide direct coverage.

7. **Non-blocking — T1’s wording conflicts with the plan’s “regenerate route-table only” rule.**

   P7 correctly says to regenerate only `route-table.snapshot.txt` ([tasks/018-migrate-system/TASK.md:107](/home/udai/PennyPilot/tasks/018-migrate-system/TASK.md:107)), but T1 says to assert that `route-surface.snapshot.txt` “regenerates byte-identical” ([tasks/018-migrate-system/TASK.md:127](/home/udai/PennyPilot/tasks/018-migrate-system/TASK.md:127)-[130](/home/udai/PennyPilot/tasks/018-migrate-system/TASK.md:130)). The 1.7 lesson was to compare the generated/current surface to the committed baseline without rewriting the baseline. T1 should say that explicitly.

## Regression-risk assessment

No planned production change requires altering a handler body, SQL statement, table/column name, cache or rate-limit key, route method/URL, demo allowlist, CSRF logic, rate-limit classification, or `config.public` declaration. The app-level guards currently register before routes, and the plan preserves that arrangement. The route consolidation changes registration/tree nesting only.

The demo-write test is not vacuous as planned: T6(c) explicitly requires real seeded state, a genuine otherwise-valid mutation, and a before/after assertion that the state remains unchanged ([tasks/018-migrate-system/TASK.md:141](/home/udai/PennyPilot/tasks/018-migrate-system/TASK.md:141)-[143](/home/udai/PennyPilot/tasks/018-migrate-system/TASK.md:143)). That directly addresses the 1.7 failure mode. A valid seeded `PUT /api/profile` or `PUT /api/notification-prefs` would satisfy it; the implementation should record the successful-path precondition so a malformed request cannot make the assertion vacuous.

## Open Questions

- **Q1 — Use the split-source re-export as planned.** `users` is physically defined in the deliberately cycle-free leaf at [apps/api/src/db/core-schema.ts:3](/home/udai/PennyPilot/apps/api/src/db/core-schema.ts:3)-[11](/home/udai/PennyPilot/apps/api/src/db/core-schema.ts:11), while `db/schema.ts` merely re-exports it at [apps/api/src/db/schema.ts:21](/home/udai/PennyPilot/apps/api/src/db/schema.ts:21). Directly re-exporting `users` from `core-schema.ts` accurately identifies its canonical definition and follows the leaf’s stated purpose. No existing module schema re-exports `users`, so there is no contrary precedent. The other five tables and two enums remain physically defined in `db/schema.ts`, making the split source correct.

  Not re-exporting `budgetAlerts` or `categories` is also correct: they are planning/ledger-owned dependencies rather than system-owned schema. Their definitions are at [apps/api/src/db/schema.ts:211](/home/udai/PennyPilot/apps/api/src/db/schema.ts:211) and [597](/home/udai/PennyPilot/apps/api/src/db/schema.ts:597).

- **Q2 — Accept the `db/restore.ts → modules/system/services/backup.ts` edge for 1.8.** `db/restore.ts` genuinely depends on the canonical `ALL_TABLES` ordering at [apps/api/src/db/restore.ts:4](/home/udai/PennyPilot/apps/api/src/db/restore.ts:4) and [67](/home/udai/PennyPilot/apps/api/src/db/restore.ts:67). Moving `backup.ts` therefore requires the P5 import rewrite. This introduces a layering inversion, but not an ES-module cycle: `backup.ts` does not import `db/restore.ts`; `restore-user.ts` is the file importing both at [apps/api/src/services/restore-user.ts:5](/home/udai/PennyPilot/apps/api/src/services/restore-user.ts:5)-[6](/home/udai/PennyPilot/apps/api/src/services/restore-user.ts:6). Extracting `ALL_TABLES` during a no-behaviour-change migration would add unnecessary structural work. Defer that ownership correction to 1.9.

- **Q3 — Keep `health → auth → notifications → backup → profile`.** It matches their current relative registration order at [apps/api/src/app.ts:134](/home/udai/PennyPilot/apps/api/src/app.ts:134), [135](/home/udai/PennyPilot/apps/api/src/app.ts:135), [139](/home/udai/PennyPilot/apps/api/src/app.ts:139), [143](/home/udai/PennyPilot/apps/api/src/app.ts:143), and [145](/home/udai/PennyPilot/apps/api/src/app.ts:145). The consolidation necessarily moves them relative to other modules, but does not alter the method/URL surface. The regenerated tree snapshot is the correct place to capture that re-nesting.

- **Q4 — P5 is not exhaustive.** Add `services/autopilot.ts` and `services/anomaly.ts` as described in Finding 1. Apart from those two files, the independently grepped inbound-consumer list, including all eight external `session.ts` route tests, is exhaustive.

The production migration design is sound, but the plan is **not ready to implement** until the P5 importer omissions and the three acceptance-test blockers above are corrected.