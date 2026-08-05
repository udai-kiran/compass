## Review outcome

The encapsulation and event-emission coverage is genuine. G2 fully closes the AC5 gap, and the principal AC7 behaviors are exercised through the real plugin boundary.

I found one weakness: G1.2’s “no write” assertion is vacuous because the request targets nonexistent records. The demo 403 itself is still genuine, but the test does not meaningfully prove that a valid ingest mutation was prevented. Therefore, the two gaps are not fully closed to the exact requested standard until that assertion uses a real pending draft and account and verifies the draft and ledger remain unchanged.

## Finding

### Moderate — G1.2’s before/after assertion cannot detect a prevented mutation

At [ingest.route.test.ts:282](/home/udai/PennyPilot/apps/api/src/modules/ingest/routes/ingest.route.test.ts:282), the test establishes only that a newly created user has no `extracted_transactions` rows. It then posts random, nonexistent draft and account IDs at [ingest.route.test.ts:288](/home/udai/PennyPilot/apps/api/src/modules/ingest/routes/ingest.route.test.ts:288), and confirms afterward that the user still has no extracted rows at [ingest.route.test.ts:296](/home/udai/PennyPilot/apps/api/src/modules/ingest/routes/ingest.route.test.ts:296).

That route does not create an `extracted_transactions` row. On a successful request, it changes an existing pending draft to accepted and creates a ledger transaction, as shown at [review-actions.ts:71](/home/udai/PennyPilot/apps/api/src/modules/ingest/services/review-actions.ts:71) and [review-actions.ts:95](/home/udai/PennyPilot/apps/api/src/modules/ingest/services/review-actions.ts:95). With nonexistent IDs, there is no possible extracted row for this handler to mutate, even if execution reached the handler.

The observed 403 is nevertheless strong evidence that the real demo guard ran:

- The session is genuinely created with `demo: true` at [ingest.route.test.ts:276](/home/udai/PennyPilot/apps/api/src/modules/ingest/routes/ingest.route.test.ts:276).
- No hostile `Origin` is supplied, so the CSRF hook is not an alternate source of the response.
- The auth plugin rejects demo mutations at [auth.ts:64](/home/udai/PennyPilot/apps/api/src/plugins/auth.ts:64).

Thus this is not a false-positive demo-guard test, but its claimed “real before/after no-write assertion” is weak. It should seed a real account, ingestion, and pending draft, send a valid accept request as the demo user, then verify that:

- the draft remains `pending`;
- `transactionId` remains null; and
- no ledger transaction was created.

## Detailed assessment

### 1. Harness and plugin boundary

Yes. `buildTestApp()` installs the real infrastructure and hooks:

- real pool and Drizzle database: [ingest.route.test.ts:75](/home/udai/PennyPilot/apps/api/src/modules/ingest/routes/ingest.route.test.ts:75)
- real Redis client: [ingest.route.test.ts:78](/home/udai/PennyPilot/apps/api/src/modules/ingest/routes/ingest.route.test.ts:78)
- real `EventBus`: [ingest.route.test.ts:81](/home/udai/PennyPilot/apps/api/src/modules/ingest/routes/ingest.route.test.ts:81)
- real `setupAuth()` and `setupSecurity()`: [ingest.route.test.ts:82](/home/udai/PennyPilot/apps/api/src/modules/ingest/routes/ingest.route.test.ts:82)
- the whole `ingestRoutes` plugin: [ingest.route.test.ts:100](/home/udai/PennyPilot/apps/api/src/modules/ingest/routes/ingest.route.test.ts:100)

The plugin itself registers imports, inbox, and mailbox route plugins at [plugin.ts:24](/home/udai/PennyPilot/apps/api/src/modules/ingest/plugin.ts:24). No individual route module is registered directly by the test. Parent hooks therefore have to cross Fastify’s encapsulated plugin boundary to protect these routes.

This follows the planning harness precedent at [planning.route.test.ts:46](/home/udai/PennyPilot/apps/api/src/modules/planning/routes/planning.route.test.ts:46).

### 2. G1 / AC7

- **G1.1 unauthenticated write:** Genuine. It injects a request into the encapsulated route without a cookie and requires 401 at [ingest.route.test.ts:260](/home/udai/PennyPilot/apps/api/src/modules/ingest/routes/ingest.route.test.ts:260). If auth stopped applying through the boundary, the nonexistent draft would proceed to a handler-level 404 rather than satisfy this assertion.

- **G1.1b unauthenticated read:** Genuine strengthening. The GET assertion at [ingest.route.test.ts:269](/home/udai/PennyPilot/apps/api/src/modules/ingest/routes/ingest.route.test.ts:269) separately proves default-private behavior for a read route.

- **G1.2 demo 403:** The demo rejection itself is genuine, but the no-write assertion is weak for the reasons in the finding above.

- **G1.3 CSRF:** Genuine. The test creates a normal, non-demo session at [ingest.route.test.ts:305](/home/udai/PennyPilot/apps/api/src/modules/ingest/routes/ingest.route.test.ts:305), sends a hostile origin at [ingest.route.test.ts:315](/home/udai/PennyPilot/apps/api/src/modules/ingest/routes/ingest.route.test.ts:315), and checks both 403 and the security hook’s `"Forbidden"` error at [ingest.route.test.ts:318](/home/udai/PennyPilot/apps/api/src/modules/ingest/routes/ingest.route.test.ts:318). It cannot pass because of missing authentication or demo mode. The response matches the CSRF branch at [security.ts:65](/home/udai/PennyPilot/apps/api/src/plugins/security.ts:65).

- **G1.4 `config.public`:** Genuine. The `onRoute` hook is installed before the whole plugin registration at [ingest.route.test.ts:89](/home/udai/PennyPilot/apps/api/src/modules/ingest/routes/ingest.route.test.ts:89), so it receives every route option registered by all three internal plugins. The test verifies that all three route namespaces were observed at [ingest.route.test.ts:322](/home/udai/PennyPilot/apps/api/src/modules/ingest/routes/ingest.route.test.ts:322), then rejects every captured route whose `config.public` is exactly `true`. That exactly matches the auth hook’s exemption condition at [auth.ts:58](/home/udai/PennyPilot/apps/api/src/plugins/auth.ts:58).

- **G1.5 classification:** Genuine and non-tautological. It invokes the actual exported classifier at [ingest.route.test.ts:338](/home/udai/PennyPilot/apps/api/src/modules/ingest/routes/ingest.route.test.ts:338). If `bucketFor` returned the same bucket for all methods, either the GET or POST assertions would fail because `READ_BUCKET.name` and `WRITE_BUCKET.name` differ. It samples each ingest namespace and the relevant GET/POST distinction required by AC7. The real implementation is at [security.ts:23](/home/udai/PennyPilot/apps/api/src/plugins/security.ts:23).

Testing PUT/PATCH/DELETE individually is not necessary for the stated T6 requirement, which asks for a GET versus a POST ingest path and relies on the same shared mutating-method set.

### 3. G2 / AC5

All five tests are genuine route-level event tests.

Each test:

- registers an `app.eventBus` subscriber before the mutation being assessed;
- sends a real authenticated request through `ingestRoutes`;
- requires HTTP 200;
- validates a mutation-specific result;
- polls for an actual event;
- verifies the emitted `userId`.

Specifically:

- **G2.1 accept:** subscription at [ingest.route.test.ts:365](/home/udai/PennyPilot/apps/api/src/modules/ingest/routes/ingest.route.test.ts:365), request at line 375, real accepted status and `transactionId` at lines 381–384, event assertion at lines 386–388.

- **G2.2 repayment:** subscription at [ingest.route.test.ts:398](/home/udai/PennyPilot/apps/api/src/modules/ingest/routes/ingest.route.test.ts:398), request at line 408, real accepted status and `transactionId` at lines 414–417, event assertion at lines 419–421.

- **G2.3 transfer:** subscription at [ingest.route.test.ts:440](/home/udai/PennyPilot/apps/api/src/modules/ingest/routes/ingest.route.test.ts:440), request at line 450, two accepted drafts with transaction IDs at lines 456–459, event assertion at lines 461–463.

- **G2.4 commit:** subscription at [ingest.route.test.ts:471](/home/udai/PennyPilot/apps/api/src/modules/ingest/routes/ingest.route.test.ts:471), request at line 481, `created === 1` at lines 486–488, event assertion at lines 490–492.

- **G2.5 rollback:** the preliminary commit occurs before the relevant subscription at [ingest.route.test.ts:505](/home/udai/PennyPilot/apps/api/src/modules/ingest/routes/ingest.route.test.ts:505). The rollback subscriber is then installed at line 515, before the rollback request at line 520. It requires `removed === 1` at lines 525–526 and observes the rollback event at lines 528–530. Because `EventBus.emit()` snapshots the current subscribers synchronously at [event-bus.ts:66](/home/udai/PennyPilot/apps/api/src/lib/event-bus.ts:66), the earlier commit event cannot be delivered to the later rollback subscriber.

The polling helper at [ingest.route.test.ts:245](/home/udai/PennyPilot/apps/api/src/modules/ingest/routes/ingest.route.test.ts:245) correctly accounts for `queueMicrotask` dispatch at [event-bus.ts:75](/home/udai/PennyPilot/apps/api/src/lib/event-bus.ts:75).

None of these tests can pass if its corresponding route emit is removed: the successful response assertions would still pass, but `pollForEntry()` would return `undefined` and `assert.ok(entry)` would fail. There is no spy, fabricated event, or direct service invocation.

All five production emit sites are covered:

- accept: [inbox.ts:56](/home/udai/PennyPilot/apps/api/src/modules/ingest/routes/inbox.ts:56)
- repayment: [inbox.ts:72](/home/udai/PennyPilot/apps/api/src/modules/ingest/routes/inbox.ts:72)
- transfer: [inbox.ts:87](/home/udai/PennyPilot/apps/api/src/modules/ingest/routes/inbox.ts:87)
- import commit: [imports.ts:112](/home/udai/PennyPilot/apps/api/src/modules/ingest/routes/imports.ts:112)
- import rollback: [imports.ts:122](/home/udai/PennyPilot/apps/api/src/modules/ingest/routes/imports.ts:122)

G2 is fully closed.

### 4. Hermeticity, cleanup, and flakiness

Normal successful-test cleanup is adequate:

- Redis sessions are destroyed.
- Extracted transactions and ingestions are deleted.
- Ledger transactions are deleted.
- Imports are deleted, cascading their import rows.
- Accounts and users are then deleted.

The cleanup ordering is sensible at [ingest.route.test.ts:215](/home/udai/PennyPilot/apps/api/src/modules/ingest/routes/ingest.route.test.ts:215). Transfer links cascade when their transactions are removed at [schema.ts:446](/home/udai/PennyPilot/apps/api/src/db/schema.ts:446), and import rows cascade from imports at [schema.ts:493](/home/udai/PennyPilot/apps/api/src/db/schema.ts:493).

Per-test subscribers are removed in cleanup, including `finally` protection for G2.5 at [ingest.route.test.ts:531](/home/udai/PennyPilot/apps/api/src/modules/ingest/routes/ingest.route.test.ts:531). The pool and Redis connection are closed at [ingest.route.test.ts:101](/home/udai/PennyPilot/apps/api/src/modules/ingest/routes/ingest.route.test.ts:101).

The 500 ms polling deadline is conservative for a local `queueMicrotask`, not an external asynchronous job. It should not introduce meaningful flakiness. Top-level tests use a shared app, but they do not request concurrent execution, and event subscriptions are removed between tests.

A setup failure before a test reaches its `t.after()` registration could leave partial fixtures, because G2 cleanup registration follows fixture construction—for example at [ingest.route.test.ts:359](/home/udai/PennyPilot/apps/api/src/modules/ingest/routes/ingest.route.test.ts:359). This is common in the precedent harness and is not a normal-pass leak, but registering cleanup immediately after creating the user would make failure-path hermeticity stronger.

### 5. Production changes

No production change was required or smuggled into iteration 2.

The new file imports the existing security `_test` handle at [ingest.route.test.ts:13](/home/udai/PennyPilot/apps/api/src/modules/ingest/routes/ingest.route.test.ts:13). The handle already exists in the checked-in `HEAD` version of `plugins/security.ts`; iteration 2 did not add it.

The reviewed iteration-2 artifact is test-only: [ingest.route.test.ts](/home/udai/PennyPilot/apps/api/src/modules/ingest/routes/ingest.route.test.ts).

## Acceptance conclusion

- **AC5 / G2:** Fully and genuinely closed for all five emit sites.
- **AC7 / G1:** Authentication, demo rejection, CSRF, `config.public` absence, and rate-bucket classification are genuinely exercised through the encapsulated plugin. However, G1.2’s claimed no-write proof is vacuous because it supplies no valid mutation target.

Accordingly, the two gaps are almost closed, but not fully closed to the requested “real before/after no-write assertion” standard. No production change is needed; only G1.2’s fixtures and postconditions need strengthening.