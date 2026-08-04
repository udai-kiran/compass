# Follow-up plan review: Task 1.1 — revision 2

## Verdict

Not yet implementation-ready.

Revision 2 successfully resolves the original blocking contradiction. The two-snapshot design is a real separation of concerns, not merely a relabeling:

- `route-surface.snapshot.txt` becomes the hard invariant for the externally visible `(method, path)` set.
- `route-table.snapshot.txt` continues to record Fastify’s raw registration/tree structure, but an intentional plugin-boundary change may legitimately update it after review.

I also directly verified the proposed `onRoute` mechanism against the current application. A root-level hook installed before `registerRoutes(app)` sees routes registered in child and nested plugins, receives the fully prefixed URL, and receives separate `GET` and implicit `HEAD` notifications in the current Fastify version. It therefore provides the information required for this repository’s canonical method/path surface.

The current route surface should remain unchanged by the migration because the same 11 route functions are moved and registered without a prefix; no planned step changes an endpoint definition or method.

However, revision 2 introduces or retains three material plan defects:

1. T11’s proposed “per-basename grep” cannot produce the required zero matches because legitimate cross-module imports will still mention those same basenames after they are updated to `modules/ledger/...`.
2. `plugin.test.ts` checks only three representative routes but AC8 claims it catches any route omitted from the 11-route plugin. That claim is false.
3. The allegedly exhaustive direct/raw-SQL inventory is still incomplete, including at least the still-flat `services/periods.ts` consumer explicitly identified in review-1.

There are also several lesser precision issues: method-array handling is not specified for the canonicalizer, deduplication can mask duplicate registrations, the old-file count in AC7 is wrong, and the task 1.9 physical-decomposition criterion remains under-specified.

## 1. Does the two-snapshot design resolve the original contradiction?

Yes.

Revision 2 correctly retracts the erroneous claim about raw `printRoutes()` stability:

> “the claim above (and revision 1’s) that `printRoutes({ commonPrefix: false })` is ‘content-addressed by path/method, not registration order’ is **wrong**”

It then distinguishes the two different properties the tests are meant to observe:

> “the **set of (method, path) pairs** — the API surface — doesn’t change”

and:

> “A pure registration-structure change (same URLs, same methods, different internal plugin nesting) is not a surface change”

That is exactly the distinction required. The original contradiction arose because one byte string was being asked to represent both public API identity and internal registration structure. Revision 2 gives each property its own artifact.

The new hard gate is:

> “Deduplicate, sort by `(url, method)`, and render as one `"METHOD /path"` line per pair.”

The old raw snapshot is retained as:

> “informational/reviewable, not silently-must-never-change”

This does not merely relabel the original failure. The canonical snapshot is computed independently from route-registration events and is insensitive to the tree layout that caused the original mismatch. Conversely, the raw snapshot continues to expose structural changes rather than discarding that evidence.

One wording qualification is needed: the raw snapshot is not literally “informational” if the test still performs a byte-for-byte assertion against its committed version. It remains a hard regression test after the intentional update; what changed is the policy for deliberately regenerating it. “Structural snapshot with reviewed intentional updates” would be more accurate than “informational.”

Subject to that terminology, the blocking contradiction from review-1 is resolved.

## 2. Is the `onRoute` canonical surface mechanism sound?

### Direct verification against this repository

I tested a root-level `onRoute` hook installed before the current `registerRoutes(app)`, using the same Fastify instance and Zod compilers as `app.route-snapshot.test.ts`.

The current application produced:

- 283 `onRoute` notifications;
- fully resolved paths such as `/health` and `/api/auth/bootstrap`;
- separate notifications for `GET` and Fastify’s automatically generated `HEAD`;
- string methods for all current routes.

I also tested a route inside a plugin nested within another plugin. The root-level hook received both:

```text
GET /nested
HEAD /nested
```

This confirms the important Fastify behaviors on which the design relies:

- A hook installed on the parent before plugin registration is inherited by child plugins.
- It also observes routes inside nested child plugins, including the proposed `modules/ledger/plugin.ts → individual route plugin` structure.
- `url` includes the effective plugin prefix.
- Implicit `HEAD` exposure is visible.
- The hook fires early enough to collect the surface during `registerRoutes()`/`ready()`.

For this application, this is more robust than parsing the formatting and nesting of `printRoutes()`.

### Method handling must be explicit

Fastify types allow `routeOptions.method` to be a single method or an array. The current application happens to yield strings for every notification, but the plan says only:

> “records every `{method, url}` pair”

A robust implementation must explicitly flatten methods:

```ts
const methods = Array.isArray(options.method)
  ? options.method
  : [options.method];
```

It should normalize each method with `String(method).toUpperCase()` before rendering. Otherwise a future route registered with `method: ["GET", "POST"]` could be serialized as one malformed entry rather than two pairs.

This is a precision correction, not a reason to reject the overall mechanism.

### Deduplication weakens the gate slightly

The plan requires:

> “Deduplicate, sort by `(url, method)`”

Deduplication is defensible if the invariant is strictly a mathematical set. It can, however, hide an accidental duplicate registration in separate encapsulated plugin contexts. It can also hide one route’s omission if another registration exposes the same method/path pair.

The raw snapshot may reveal such a change, but the canonical hard gate would not.

A stronger implementation should:

1. Collect the complete ordered multiset of notifications.
2. Assert that no duplicate `(method, url)` pairs exist.
3. Then sort and serialize the unique pairs.

If duplicate pairs are intentionally possible in this application because of route constraints, the canonical key would need to include those constraints. No such constrained duplicates exist in the current route table.

### Scope of the invariant

The canonical snapshot proves method/path identity. It does not prove equality of:

- handlers;
- schemas;
- auth or security hooks;
- host/version constraints;
- body limits;
- content-type parsers;
- decorators;
- response behavior.

That is acceptable because the plan explicitly defines it as a canonical method/path surface gate and retains tests for behavior. It should not be described as proving the entire routing contract.

## 3. Will the current canonical route surface remain unchanged?

Yes, if implementation follows the plan.

The current `registerRoutes()` registers the ledger route functions separately and interleaves them with other modules. Revision 2 proposes moving those same functions and registering them beneath one extra plugin, explicitly with:

> “no prefix”

and:

> “same URLs/handler bodies/status codes/`ledger.mutated` emission exactly as today”

Fastify plugin encapsulation changes tree structure and registration context but does not add a URL segment without a prefix. Therefore the same route definitions produce the same method/path pairs.

The documented route list and current raw snapshot agree on the affected surface, including:

- `/api/accounts`
- `/api/categories`
- `/api/transactions`
- `/api/epf-contributions`
- `/api/transfers`
- `/api/transaction-links/:id`
- `/api/attachments/:id`
- `/api/recurring`
- `/api/merchant-rules`
- `/api/merchants/rename`
- `/api/resources`
- `/api/search`
- `/api/user-tasks`

The migration deliberately excludes `/api/imports` and does not propose modifying any route declaration. No endpoint or method addition, removal, rename, or method substitution is present in the plan.

Consequently:

- The new canonical snapshot should be byte-identical before and after.
- The raw tree should change because formerly interleaved route plugins become descendants of one ledger plugin.

That is the expected and correct outcome.

## 4. Review-1 required changes 2–12

### Item 2: add `services/ai/tools.ts`

Status: resolved.

Revision 2 explicitly says:

> “and **`services/ai/tools.ts`** (imports `search` from `../search.ts` — found by review-1, missing from the original investigation’s grep).”

It is also included in P7:

> “including the review-1-found `services/ai/tools.ts`”

This is sufficient.

### Item 3: add the two omitted tests

Status: resolved.

Scope now lists:

> “`average-balance.test.ts`, `epf-contributions.test.ts`”

and identifies 11 moved test files in total. P4 states:

> “Move each file’s colocated test alongside it (11 test files total, corrected list in Scope)”

AC4 refers to all 11, and T10 requires all 11 to run individually from their new locations.

Although review-1 referred to T7, the verification numbering changed because new snapshot and smoke tests were added. The substantive requirement is covered by T10.

### Item 4: correct the inbound FK inventory

Status: resolved.

Revision 2 states:

> “**23 inbound FK columns across 19 still-flat tables**”

and includes:

> “`emi_details.template_id` → `recurring_templates.id` **and** `emi_details.loan_account_id` → `accounts.id`”

The count and missing relationship now match review-1.

### Item 5: replace wholesale schema repointing with split imports

Status: resolved.

The plan now establishes the correct boundary rule:

> “A service/route that needs both ledger and non-ledger tables uses **split imports** (two import statements), not a widened module barrel.”

It then gives explicit policies for both confirmed mixed consumers:

> “`services/accounts.ts` → ledger tables `accounts`, `transactions` from `../schema.ts`; still-flat `bankDetails`, `retirementDetails`, `sips` from `../../../db/schema.ts`”

and:

> “`services/recurring.ts` → ledger tables `recurringTemplates`, `transactions` from `../schema.ts`; still-flat `emiDetails` from `../../../db/schema.ts`.”

It also correctly requires inspection of every other moved import block.

### Item 6: account for every relative import changed by relocation

Status: resolved at the planning level.

Revision 2 now says:

> “every relative import in every moved file must be individually classified and corrected”

and explicitly covers:

> “ledger-local”

> “ledger schema”

> “still-flat API code (`services/*.ts`, `lib/*.ts`, `db/index.ts`, `jobs/*.ts`)”

> “`@compass/shared`”

It also records reverse dependencies such as:

> “`services/accounts.ts` (moving) imports from `./ownership.ts`”

> “`services/transactions.ts` (moving) imports from `./sips.ts`”

> “`services/recurring.ts` (moving) imports from `./emis.ts` and `./ownership.ts`”

That addresses the original omission. The verification mechanism attached to it still needs correction; see the new T11 issue below.

### Item 7: define the exact schema export surface

Status: resolved.

The plan includes a concrete export block naming 11 tables and seven enums:

> `accounts, categories, resources, transactions, transactionSplits, transferLinks, transactionLinks, merchantRules, recurringTemplates, userTasks, attachments`

and:

> `accountType, categoryKind, expenseNecessity, transactionSource, resourceKind, recurringFrequency, recurringKind`

That is sufficiently explicit.

The parenthetical instruction to re-verify the list during implementation is reasonable defensive practice and does not make the plan ambiguous.

### Item 8: add object-identity tests

Status: resolved.

Scope defines:

> “imports each of the 11 tables from both `../../db/schema.ts` and `./schema.ts` and asserts `assert.strictEqual`”

P3 and T6 repeat the requirement. Testing all 11 tables is stronger than the representative minimum requested by review-1.

### Item 9: update `CLAUDE.md`

Status: resolved.

The modified-file scope explicitly calls for:

> “a short paragraph distinguishing physically-owned schema slices … from transitional thin access surfaces”

P12 schedules the edit, and T13 includes it in diff review.

The plan also consistently warns that `db/schema.ts` must not re-export the thin ledger surface, addressing the associated cycle concern.

### Item 10: add a ledger-plugin registration/readiness test

Status: partially addressed.

Revision 2 adds the requested test, but overstates what its proposed assertions prove:

> “asserts representative routes from the beginning, middle, and end of the internal 11-file list resolve”

and AC8 claims:

> “a route accidentally omitted from `plugin.ts` fails this test”

That claim is false. Testing three representative routes only catches omission of those three registrations. Omitting `categoryRoutes`, `transactionRoutes`, `attachmentRoutes`, `ruleRoutes`, `resourceRoutes`, `searchRoutes`, or another unasserted plugin can still leave the beginning/middle/end examples passing.

There is also ambiguity in “resolve.” If it means request injection, many handlers require decorations and authenticated request state that the snapshot-style bare Fastify instance does not supply. Registration and `app.ready()` may succeed, while injecting a request can fail for unrelated reasons. If it means checking route lookup metadata, the test should say so explicitly.

The test should instead enumerate at least one unique method/path pair from every one of the 11 internal route registrations and use Fastify route lookup, `hasRoute`, or the module-local `onRoute` collection rather than executing handlers. For example, it could assert these ownership-distinguishing pairs:

- accounts: `GET /api/accounts/average-balance`
- categories: `GET /api/categories/tree`
- transactions: `POST /api/epf-contributions`
- transfers: `GET /api/transfers/suggestions`
- attachments: `GET /api/attachments/:id`
- transaction links: `DELETE /api/transaction-links/:id`
- recurring: `GET /api/recurring`
- rules: `POST /api/merchants/rename`
- resources: `GET /api/resources`
- search: `GET /api/search/recent`
- user tasks: `GET /api/user-tasks`

Alternatively, compare the plugin-local collected surface against an explicit expected subset.

Until AC8 and the test design are made consistent, this review-1 item is only partially resolved.

### Item 11: document direct/raw-SQL consumers left outside the module

Status: partially addressed.

Revision 2 now clearly states the intended architectural limitation:

> “this task creates a **directory boundary**, not full domain encapsulation”

and provides a much larger itemized list. That resolves the conceptual concern.

However, the “Changes since review-1” section claims:

> “an honest, itemized list of **every** direct/raw-SQL cross-module consumer found”

The list is not exhaustive. Most notably, review-1 explicitly identified `services/periods.ts` as a raw-SQL consumer of ledger tables. Revision 2 mentions only:

> “`services/periods.ts`/`periods.test.ts` … its test’s import of `advanceDate` … gets a path update”

It does not disclose that `periods.ts` itself directly queries `transactions`, `transaction_splits`, `transfer_links`, `categories`, and `accounts`.

Other still-flat raw-SQL consumers visible in the current source also warrant classification, including `services/dashboard.ts`, `services/insights.ts`, and `services/balances.ts`; AI categorization code also issues raw SQL against ledger tables. Some may be owned by later modules and some may be infrastructure, but that is precisely what an allegedly exhaustive inventory should say.

The required review-1 change only demanded honest clarification of widespread unchanged access, which the revision largely supplies. The stronger revision-2 claim of exhaustive enumeration is nevertheless untrue and should be corrected or the inventory completed.

### Item 12: name the future physical-decomposition task

Status: partially resolved.

Revision 2 does explicitly name:

> “`tasks/01.09-cross-module-ports.md`”

and proposes adding an acceptance criterion covering:

> “physical schema decomposition (FK-graph/SCC analysis, relocating `pgTable()` declarations where an acyclic ordering exists)”

This satisfies the literal requirement to name a responsible task.

The proposed criterion remains too weak to guarantee an outcome for ledger, however. “Where an acyclic ordering exists” permits the analysis to conclude that the ledger-related component is cyclic and leave the declarations central indefinitely. It does not state what 1.9 must do with SCCs, whether SCCs become shared schema units, whether FK declarations are inverted or deferred, or what constitutes completion for the ledger thin surface.

The existing 1.9 task also currently depends on tasks 1.2–1.8 but not 1.1. If it is to own final decomposition of the schema introduced here, its dependency metadata should include 1.1 or explicitly explain why that dependency is transitively guaranteed.

A better 1.9 addition would require:

- producing the full FK graph and SCC decomposition;
- assigning every physical `pgTable()` definition to a final schema unit;
- defining a policy for cyclic SCCs rather than moving only acyclic cases;
- removing or converting every transitional thin surface, including ledger’s;
- retaining one valid Drizzle Kit entry point;
- proving zero migration diff and table-object identity.

Thus the responsibility is named, but the promised physical-decomposition outcome is not yet fully specified.

## 5. New issues in revision 2

### Blocking: T11’s zero-match grep is impossible

P7 says:

> “confirm zero remaining references outside `modules/ledger/`”

AC7 narrows that somewhat to:

> “zero remaining references to the old `services/*`/`routes/*` paths”

But T11 says:

> “Per-basename grep … for each of the 13+11 moved file basenames across the whole repo (excluding `modules/ledger/` itself …) — zero matches”

Those requirements are not equivalent.

After migration, legitimate consumers outside `modules/ledger/` must still import these files through paths such as:

```ts
import { listAccounts } from "../modules/ledger/services/accounts.ts";
```

A basename search for `accounts.ts` outside `modules/ledger/` will therefore find the intended new import. The example earlier in Root Cause has the same problem:

> `grep -rln "from \".*/accounts\.ts\"" apps/api/src | grep -v modules/ledger`

That command would match both the forbidden old path and the correct new path in the importing file; filtering output paths with `grep -v modules/ledger` does not filter the import specifier inside the file.

This makes T11 unsatisfiable after a correct implementation.

Replace it with one of these verifiable approaches:

- Search specifically for import specifiers resolving to the old flat directories, such as `./accounts.ts` from `services/`, `../services/accounts.ts`, and `./routes/accounts.ts` from `app.ts`.
- Use an AST/import-resolution script to resolve relative specifiers and fail if any resolves to one of the deleted absolute old paths.
- Confirm the 35 old paths do not exist, run typecheck, then enumerate imports whose resolved destination is one of the new module files and verify those destinations.
- Use `rg` patterns that include the forbidden flat-directory portion and exclude `/modules/ledger/` in the import text, not in the importing filename.

Because P7/AC7/T11 are the plan’s primary completeness proof for a large import rewrite, this is a blocking verification defect.

### AC7 has an incorrect old-file count

AC7 says:

> “all 24+2(test) old files no longer exist on disk”

The task moves:

- 13 service files;
- 11 route files;
- 11 test files.

That is 24 production source paths plus 11 test paths, not “24+2(test).”

T12 gives the correct categories:

> “all 24 old files … and their 11 old test-file locations”

AC7 should match T12 and say 35 old paths total.

### The plugin test cannot prove plugin completeness as claimed

As discussed under item 10, three representative routes do not prove all 11 route registrations are present. This is a new contradiction between test design and AC8.

Either:

- assert one unique route from every internal registration; or
- weaken AC8 to say it checks only representative registration and readiness while relying on the unchanged canonical global surface to detect other omissions.

The first option is preferable because this test is specifically intended to give a local, comprehensible failure when `plugin.ts` is incomplete.

### “Resolve” is underspecified for a minimally decorated plugin test

The plan says the plugin test uses:

> “a minimally-decorated Fastify instance … no DB/Redis/env needed”

and then:

> “asserts representative routes … resolve”

A bare instance is sufficient for registration and route lookup because handlers do not execute during `ready()`. It is not generally sufficient to inject requests into ledger handlers, which refer to decorations such as `db`, `storage`, `redis`, and authenticated session state.

The plan should specify that the test inspects registered routes without invoking handlers. If it intends to inject requests, it must define the required decorations, auth/session hooks, and safe test doubles.

### Canonical serialization needs an explicit newline policy

The current raw snapshot test carefully documents exact trailing-newline behavior. The new canonical format says only:

> “render as one `"METHOD /path"` line per pair”

For a byte-for-byte gate, it must specify whether the file ends with a newline. Otherwise baseline creation and test rendering may disagree despite identical entries.

For example:

```ts
const rendered = pairs.map(...).join("\n") + "\n";
```

or deliberately omit the final newline, but define one policy and use it for both generation and comparison.

### Canonical baseline creation should be a committed test-driven step

P2 says:

> “capture … a canonical (method,url) list from the unmodified `registerRoutes()`”

This ordering is sound because P1 modifies only roadmap prose, not application code. The route baseline is still taken before any route edit.

However, the plan does not state whether P2 first modifies `app.route-snapshot.test.ts`, uses a temporary script, or manually captures hook output. Since the reviewer is expected to trust that the baseline is independent of the post-migration result, P2 should say:

1. Implement the canonical collector and assertion in the existing test.
2. Generate the initial canonical snapshot from the unmodified application.
3. Run the test and commit/capture its hash before moving any route.
4. Do not regenerate that file after migration.
5. Compare its hash or bytes after migration.

P9 currently says “recapture” the canonical snapshot. Even though it then says the result must be byte-identical, regenerating a hard-gate expected file after the change is weaker than rerunning the unchanged assertion against the already committed baseline. P9 should say “recompute actual output and compare against the untouched P2 file,” not recapture/regenerate the canonical file.

### The raw snapshot review evidence needs a concrete success condition

P9 requires the raw diff to be:

> “explicitly attributed to the registration-structure change”

The unchanged canonical surface proves there was no method/path set change, but it does not by itself prove every raw-tree difference is caused by the intended nesting rather than some other structural accident.

The evidence should state what reviewers must check:

- all raw-tree leaf method/path content corresponds to the canonical set;
- only ordering, common-prefix grouping, branch glyphs, and plugin-derived tree position differ;
- no unexpected route constraints or duplicated branches appear.

This is a precision improvement rather than a blocker.

### The task 1.9 edit risks expanding that task without fully planning it

Adding physical schema decomposition to “Cross-module ports + flat-services cleanup” is a substantial expansion. The current 1.9 task is about ports, net-worth composition, reward/goal interfaces, and removal of flat service directories. Full FK/SCC-based physical decomposition is independently complex.

If 1.9 is truly the chosen owner, its task text should be expanded beyond one acceptance-criterion line to include:

- objective and rationale;
- dependency/order implications;
- cycle-handling strategy;
- Drizzle Kit entry-point design;
- schema identity and migration-diff verification.

Otherwise revision 2 technically names a task but transfers a large unresolved design problem into it without making that future plan actionable.

## 6. Required corrections before implementation

1. Replace T11’s impossible basename-zero-match check with a check for imports that resolve specifically to the deleted flat source paths.
2. Correct AC7’s old-file count to 24 production paths plus 11 test paths.
3. Make `plugin.test.ts` assert at least one unique route from each of the 11 registered route plugins, or weaken AC8 so it no longer claims arbitrary omissions are caught.
4. Define “resolve” as route registration/lookup without handler execution, or specify all required test decorations and hooks.
5. Complete the direct/raw-SQL inventory—at minimum add `services/periods.ts`—or remove the claim that the list contains every consumer.
6. Flatten `onRoute` method arrays explicitly, normalize method names, and assert duplicate `(method, url)` pairs are absent before canonical serialization.
7. Define the canonical snapshot’s trailing-newline policy.
8. Change P9 from “recapture” to comparison against the untouched P2 canonical baseline.
9. Strengthen the proposed task 1.9 edit so cyclic SCCs and final disposition of transitional thin surfaces have an explicit completion rule; add task 1.1 to its dependency metadata if needed.

## Final assessment

The major architectural issue from review-1 is fixed. The two-snapshot design correctly separates API-surface identity from Fastify’s registration-tree representation, and the proposed root-level `onRoute` hook is technically sound for current routes and nested ledger plugins.

Most of review-1’s completeness corrections are also genuinely incorporated. The remaining problems are narrower than those in revision 1, but T11 is an actual blocking contradiction in the verification plan, and the plugin completeness test currently promises more than it tests.

After the corrections above—especially the T11 repair and the plugin-test/AC8 alignment—the plan will be implementation-ready.