# Third-pass narrow plan review: Task 1.1 — revision 3

## Overall verdict

Not yet implementation-ready.

Seven of review-2’s nine required corrections are genuinely resolved. Item 1 is not resolved: T11 still does not check import specifiers that resolve specifically to the deleted flat paths, and revision 3 retains the explicitly rejected basename-zero-match instruction elsewhere in the plan. Item 9 is only partially resolved because the strengthened task-1.9 edit is correctly specified in Scope, but T13 still contradicts it by requiring that task file’s only change be one acceptance-criterion line.

The new `plugin.test.ts` list was checked against `investigation-1.md` §8 and the current route files. All 11 selected `(method, path)` pairs are real and correctly attributed to their respective route plugins.

## 1. T11 checks imports resolving specifically to deleted flat paths

**Status: not resolved**

Revision 3 correctly recognizes that basename matching is invalid:

> P7: “After finishing, prove completeness per T11's corrected method (below) — **not a basename grep**, which cannot distinguish an old flat import from a correct new `modules/ledger/...` import that happens to contain the same basename.”

But T11 replaces it with a different positive inventory check:

> T11: “completeness is proven by (a) a clean `npm run typecheck` … (b) T12's direct confirmation the 24 old production files no longer exist, and (c) a **positive** grep — `grep -rn "from \".*modules/ledger/\(services\|routes\)/" apps/api/src` … checked line-by-line against Root Cause's exact cross-import inventory”

That does not implement review-2’s requested check for import specifiers which resolve specifically to the deleted flat source paths. It checks that expected new module imports exist, while `typecheck` indirectly detects unresolved imports. Neither check explicitly resolves every relative import and rejects those whose target is one of the 24 deleted flat production paths.

Worse, the Root Cause section still retains the impossible check that revision 3 says it replaced:

> “the real proof is `npm run typecheck` passing … **combined with an explicit post-move grep for each moved file's basename** … to positively confirm **zero remaining references outside `modules/ledger/`**.”

That instruction is still unsatisfiable because legitimate cross-module imports outside `modules/ledger/` contain the moved basename.

Required correction: remove the stale basename-zero-match paragraph and specify a source-aware import-resolution check that parses/resolves relative import specifiers and asserts that none resolve to any of the 24 deleted flat production paths. T12 can separately verify deletion of the 11 old test locations.

## 2. AC7 counts 24 production paths plus 11 test paths

**Status: resolved**

AC7 now says:

> “All **35** old paths (13 service files + 11 route files + 11 test files) no longer exist on disk”

T12 independently matches that count:

> “all 24 old production files (13 services + 11 routes) and their 11 old test-file locations (**35 paths total**) no longer exist on disk”

This correctly states 24 production paths plus 11 test paths, for 35 total.

## 3. `plugin.test.ts` covers all 11 route plugins and AC8 is narrowed accordingly

**Status: resolved**

Scope now defines the test as:

> “asserts **one uniquely-attributable (method, path) pair from every one of the 11 internal route registrations**”

It supplies these exact assertions:

> “`GET /api/accounts/average-balance` (accounts), `GET /api/categories/tree` (categories), `POST /api/epf-contributions` (transactions), `GET /api/transfers/suggestions` (transfers), `DELETE /api/transaction-links/:id` (transaction-links), `GET /api/attachments/:id` (attachments), `GET /api/recurring` (recurring), `POST /api/merchants/rename` (rules), `GET /api/resources` (resources), `GET /api/search/recent` (search), `GET /api/user-tasks` (user-tasks).”

The investigation and current route files confirm that all 11 pairs exist and are correctly attributed:

- `accounts.ts`: `GET /api/accounts/average-balance`
- `categories.ts`: `GET /api/categories/tree`
- `transactions.ts`: `POST /api/epf-contributions`
- `transfers.ts`: `GET /api/transfers/suggestions`
- `transaction-links.ts`: `DELETE /api/transaction-links/:id`
- `attachments.ts`: `GET /api/attachments/:id`
- `recurring.ts`: `GET /api/recurring`
- `rules.ts`: `POST /api/merchants/rename`
- `resources.ts`: `GET /api/resources`
- `search.ts`: `GET /api/search/recent`
- `user-tasks.ts`: `GET /api/user-tasks`

AC8 is correspondingly narrowed:

> “`plugin.test.ts` asserts one uniquely-attributable route from **each** of the 11 internal route registrations … a route file accidentally omitted from `plugin.ts` fails this test”

The test design and acceptance claim now align.

## 4. “Resolve” means registration/lookup without handler execution

**Status: resolved**

Scope explicitly states:

> “via route registration/lookup introspection (the plugin's own `onRoute` collection, or Fastify's route-existence check) — **never `app.inject()`/handler execution**”

It also explains why:

> “handlers reference `db`/`storage`/`redis`/session decorations this hermetic instance doesn't provide.”

P6 repeats the constraint:

> “via route-lookup introspection — never `app.inject()`”

T7 likewise says:

> “all 11 uniquely-attributable routes resolve via route-lookup, not handler execution”

The intended meaning of “resolve” is now unambiguous.

## 5. Direct/raw-SQL inventory includes `services/periods.ts` and is representative, not exhaustive

**Status: resolved**

The explicit inventory now includes:

> “**`services/periods.ts`** … directly queries `transactions`, `transaction_splits`, `transfer_links`, `categories`, and `accounts`”

The plan also retracts the exhaustive-consumer claim:

> “Known-similar cases flagged for task 1.9's classification, **not enumerated exhaustively here**”

and:

> “This list is a **representative sample** of the pattern … not a literal enumeration of every such call site in the codebase”

It names additional known-similar cases:

> “`services/dashboard.ts`, `services/insights.ts`, `services/balances.ts`, and AI-categorization code”

This satisfies both parts of the required correction.

## 6. Method-array normalization and duplicate-pair detection

**Status: resolved**

The canonicalization requirements now say:

> “**Flatten and normalize methods explicitly**: `routeOptions.method` can be a string or an array; flatten to an array (`Array.isArray(m) ? m : [m]`) and uppercase each before use”

They also require:

> “**Assert no duplicate `(method, url)` pairs before serializing** (collect the full ordered list first, check for accidental duplicates, *then* dedupe/sort)”

Both method-array handling and duplicate detection are explicit and correctly ordered before serialization.

## 7. Canonical snapshot trailing-newline policy

**Status: resolved**

The plan defines an exact rendering rule:

> “render as `pairs.map(p => \`${p.method} ${p.url}\`).sort().join("\n") + "\n"`”

It further specifies:

> “one convention, stated once, used identically for both the committed file and the live comparison”

The canonical file therefore explicitly ends with one trailing newline.

## 8. P9 compares against the untouched P2 baseline

**Status: resolved**

P9 now says:

> “**Compare, do not regenerate, the canonical snapshot**”

and:

> “recompute the live canonical (method,url) output from the post-move `registerRoutes(app)` and compare it byte-for-byte against the **untouched P2 baseline file**”

It removes any remaining ambiguity:

> “the canonical file itself is **never rewritten after P2, only compared against**”

AC1 and T4 reinforce the same rule:

> “proven by comparison against the untouched P2 baseline (**never regenerated**)”

> “byte-identical to P2's untouched pre-move baseline file (**never regenerated, only compared against**)”

This correction is fully incorporated.

## 9. Strengthened task-1.9 edit and dependency metadata

**Status: partially resolved**

The Scope entry correctly specifies all requested additions:

> “add `1.1` to its `depends:` list”

> “producing the full cross-module FK graph and its strongly-connected-component (SCC) decomposition”

> “an explicit policy for tables that remain in a cyclic SCC (e.g., a small shared ‘core’ schema file per SCC … rather than leaving them in a monolithic `db/schema.ts` indefinitely)”

> “converting or removing every transitional thin-schema surface introduced by tasks 1.1-1.8”

> “retaining exactly one Drizzle Kit entry point”

> “proving zero migration diff and table-object identity for every relocation”

Those instructions genuinely cover cyclic-SCC disposition, Drizzle Kit entry-point retention, schema identity, migration-diff verification, and the missing `1.1` dependency.

However, T13 still says:

> “confirm … that `tasks/01.09-cross-module-ports.md`'s **only change is the new acceptance-criterion line**”

That directly contradicts Scope, which requires a dependency-list edit plus “a new paragraph plus acceptance criteria.” Following T13 would reject the strengthened edit or encourage an implementer to collapse it back to the inadequate revision-2 form.

Required correction: change T13 to verify the full task-1.9 edit described in Scope—dependency metadata, rationale/ownership paragraph, cyclic-SCC policy, transitional-surface disposition, single Drizzle Kit entry point, and identity/migration-diff acceptance criteria.

## Final assessment

The plan is close, but it is not implementation-ready until:

1. T11 is replaced with an actual source-aware check for imports resolving to the deleted flat production paths, and the stale basename-zero-match instruction is removed.
2. T13 is aligned with the strengthened multi-part task-1.9 edit rather than claiming that only one acceptance-criterion line changes.

Items 2 through 8 are genuinely resolved, including a valid and correctly attributed 11-route `plugin.test.ts` assertion list.