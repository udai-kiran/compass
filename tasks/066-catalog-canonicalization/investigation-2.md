# Investigation 2: CI failure diagnosis — PR #200 (tasks 9.3–9.5)

CI run: https://github.com/udai-kiran/PennyPilot/actions/runs/32497783149  
Branch: `feat/shopping-core-capture`  
Total: **1296 tests, 1283 pass, 12 fail, 1 skip**

---

## 1. Rate-limit setup divergence

### Both test files use the identical harness

`catalog.route.test.ts:42-59` and `lists.route.test.ts:44-61` both construct `buildTestApp()` the same way:

```typescript
// Both files, identical pattern:
async function buildTestApp(): Promise<FastifyInstance> {
  const config = loadConfig();
  const app = Fastify({ logger: false, trustProxy: true });
  // ...
  await setupAuth(app);
  await setupSecurity(app);    // <-- rate limiting installed here
  await app.register(shoppingRoutes, { prefix: "/api/shopping" });
  // ...
}
```

`capture.route.test.ts:43-62` and `capture-image.route.test.ts:45-67` also call `setupSecurity(app)`. All four DB-gated shopping test files use the exact same harness with no rate-limit bypass.

### The kill switch that is NOT engaged in CI

`apps/api/src/plugins/security.ts:48`:
```typescript
const rateLimitOn = !app.config.RATE_LIMIT_DISABLED && app.config.NODE_ENV !== "test";
```

`apps/api/src/config.ts:9`:
```typescript
NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
```

CI does **not** set `NODE_ENV=test`. The default is `"development"`. Therefore `rateLimitOn` evaluates as `true` in all test files during CI.

### How the key is derived and what the buckets are

`security.ts:85`:
```typescript
const key = `rl:${bucket.name}:${req.ip}`;
```

`security.ts:18-20`:
```typescript
const AUTH_BUCKET: Bucket = { name: "auth",  limit: 15,  windowSeconds: 300 };
const WRITE_BUCKET: Bucket = { name: "write", limit: 120, windowSeconds: 60  };
const READ_BUCKET:  Bucket = { name: "read",  limit: 600, windowSeconds: 60  };
```

`security.ts:23-28`:
```typescript
function bucketFor(req: FastifyRequest): Bucket {
  const url = req.url.split("?")[0] ?? "";
  if (/^\/api\/auth\/(login|register|password)/.test(url)) return AUTH_BUCKET;
  if (MUTATING.has(req.method)) return WRITE_BUCKET;  // POST, PUT, PATCH, DELETE
  return READ_BUCKET;
}
```

`app.inject()` in Fastify supplies `req.ip = "127.0.0.1"` for all calls. **All POST/PUT/DELETE requests from ALL test files share the single Redis key `rl:write:127.0.0.1`** within the 60-second window.

### Why lists.route.test.ts was green on its own but fails now

Task 9.2 was CI-green with `lists.route.test.ts` alone making roughly 60–80 write calls — within the 120/60s limit. Task 9.3 added `catalog.route.test.ts`, which makes approximately 35–45 additional writes. The combined write budget from both files (plus `capture.route.test.ts` and `capture-image.route.test.ts` making a handful of writes each) pushes the shared bucket over 120 within the 60-second window.

### Which tests fail and why

From the CI run (node:test summary at `apps/api` aggregate):

| Failing test | File | Failure reason |
|---|---|---|
| `categoryId ownership: cross-owner or missing...` | `catalog.route.test.ts:292` | 429 on one of its 4 write inject calls (test ran in 13ms — too fast for real DB round-trips, consistent with immediate 429) |
| `canonicalizeItem: unique match auto-links...` | `catalog.route.test.ts:439` | See §3 — separate test-logic bug |
| `concurrency: parent row FOR UPDATE...` | `lists.route.test.ts` | Write calls hit 429, list-setup inject returns error body → subsequent operations fail |
| `item ordering with duplicate positions...` | `lists.route.test.ts` | POST/GET return 429 → assertion on response body fails |
| `delete item leaves position gaps...` | `lists.route.test.ts` | POST returns 429 |
| `GET /lists default returns both active...` | `lists.route.test.ts` | CI assertion error: `active list must appear in default listing` — POST returned 429 so no real list was created |
| `archived list is readable, mutable...` | `lists.route.test.ts` | POST returns 429 |
| `cross-owner operations on list and items...` | `lists.route.test.ts` | CI: `Expected values to be strictly equal` — POST returns 429 |
| `DELETE /lists/:id removes all child items...` | `lists.route.test.ts` | POST returns 429 |
| `updatedAt is bumped after item add...` | `lists.route.test.ts` | See §3 — NaN caused by 429 |
| `raw-text-only item (no catalogItemId...)` | `lists.route.test.ts` | CI assertion: `Raw-text-only item failed: {"error":"Too Many Requests",...}` — direct 429 |
| `T6(c) precondition: a non-demo session's PUT /api/profile...` | `profile.route.test.ts` | CI assertion: `{"error":"Too Many Requests",...}` — shares the same `rl:write:127.0.0.1` key |

### Do capture tests use the safe harness or the risky harness?

Both `capture.route.test.ts` and `capture-image.route.test.ts` use `setupSecurity(app)` — the same risky harness. They do NOT disable rate limiting. However, those tests passed in this run because they execute BEFORE catalog and lists tests (CI timestamps ~15:31:15–16 vs. catalog at ~15:31:18–20), and their write count is small (mostly GET/401/403/415 operations with only a few POST writes, e.g. the demo-session test).

### What lists.route.test.ts does that keeps it safe on its own

When run in isolation, `lists.route.test.ts` makes ~60–80 POST/PUT/DELETE inject calls — under the 120/60s cap. Only when `catalog.route.test.ts` runs in the same 60-second window (adding ~40 more writes on the same `rl:write:127.0.0.1` key) does the combined total exceed 120.

---

## 2. Request volume — catalog vs. lists

**catalog.route.test.ts** approximate write (POST/PUT/DELETE) inject count across its 9 tests:
- unauthenticated: 0
- CRUD round-trip: 3 (POST, PUT, DELETE)
- PUT strict: 2 (POST, PUT-bad)
- duplicate: 4 (POST×3, PUT)
- IDOR: 3 (POST, PUT, DELETE)
- categoryId ownership: 4 (POST×3, PUT)
- GET /catalog/match: 1 (POST rice; "atta" rows inserted directly via DB)
- canonicalizeItem: ~8 (POST list, POST item, POST canon×3, POST catalog, POST item2 + none-canon)
- IDOR wrong listId: 4 (POST×4)
- stale-match race: 5 (POST×4 + POST catalog)
- demo session: 4 (POST, PUT, DELETE, POST)

**Estimated total: ~38–45 write-bucket hits** from `catalog.route.test.ts`.

**lists.route.test.ts** makes roughly 60–80 write-bucket hits across its 20 tests. Failures begin at test 12 ("concurrency") — approximately the point at which the running total from all files crosses 120.

All calls share `req.ip = "127.0.0.1"` and therefore the same `rl:write:127.0.0.1` Redis key. This is not a per-IP or per-session issue — it is purely a volume issue on a single shared bucket.

---

## 3. updatedAt NaN — two distinct bugs

### 3a. `updatedAt must increase after addItem (t0=NaN, t1=NaN)` — lists.route.test.ts

`lists.route.test.ts:1672-1686`:
```typescript
const getInitial = await app.inject({ method: "GET", url: `/api/shopping/lists/${list.id}`, cookies });
const t0 = new Date((JSON.parse(getInitial.body) as { updatedAt: string }).updatedAt).getTime();
// ...
const addRes = await app.inject({ method: "POST", url: `/api/shopping/lists/${list.id}/items`, ... });
const t1 = new Date((JSON.parse(addRes.body) as { updatedAt: string }).updatedAt).getTime();
assert.ok(t1 > t0, `updatedAt must increase after addItem (t0=${t0}, t1=${t1})`);
```

**Root cause**: `list` is created by a POST that itself returns 429, so `list.id` is `undefined`. The subsequent GET also returns 429. `JSON.parse('{"error":"Too Many Requests",...}').updatedAt` is `undefined`. `new Date(undefined).getTime()` returns `NaN`. Both `t0` and `t1` are `NaN`. This is a cascade from the rate-limit exhaustion, **not** a bug in the service's updatedAt logic.

The Zod schemas (`ShoppingListSchema.updatedAt: z.coerce.date()`, `ShoppingListItemSchema.updatedAt: z.coerce.date()`, `CatalogItemSchema.updatedAt: z.coerce.date()` — `packages/shared/src/schemas/shopping.ts:94,109,71`) use `z.coerce.date()` which accepts ISO strings. The JSON body carries strings; the test casts to `string` and calls `new Date(string).getTime()`. This works correctly when the response is a real list body; it yields NaN only when the body is a 429 error object.

`lists.route.test.ts` has NO case where it calls `new Date(resp.updatedAt)` and gets NaN without the rate-limit cause. The 9.2 `lists.route.test.ts` tests DO assert on `updatedAt` successfully when run in isolation.

### 3b. `list updatedAt unchanged on ambiguous` — catalog.route.test.ts — TEST-LOGIC BUG

CI failure marker (line 2379 of ci-2.txt):
```
AssertionError [ERR_ASSERTION]: list updatedAt unchanged on ambiguous
```

Stack trace (ci-2.txt lines 2377, 2386):
```
test at src/modules/shopping/routes/catalog.route.test.ts:439:1
      at TestContext.<anonymous> (...catalog.route.test.ts:575:10)
```

`catalog.route.test.ts:529-575` (abridged):
```typescript
// After successful "matched" canonicalize:
const listAfter = JSON.parse(
  (await app.inject({ method: "GET", url: `/api/shopping/lists/${list.id}`, cookies })).body,
) as { updatedAt: string };

// NOW: addRes2 adds item2 — this POST bumps list.updatedAt:
const addRes2 = await app.inject({
  method: "POST", url: `/api/shopping/lists/${list.id}/items`,
  cookies, payload: { rawText: "Basmati Rice" },
});
// ^^ addItem always bumps list.updatedAt; listAfter.updatedAt is now STALE

// ... ambiguous canonicalize (correct: no write) ...
const ambigRes = await app.inject({
  method: "POST",
  url: `/api/shopping/lists/${list.id}/items/${item2.id}/canonicalize`,
  cookies,
});

// After ambiguous canonicalize:
const listAfterAmbig = JSON.parse(
  (await app.inject({ method: "GET", url: `/api/shopping/lists/${list.id}`, cookies })).body,
) as { updatedAt: string };
assert.equal(listAfterAmbig.updatedAt, listAfter.updatedAt, "list updatedAt unchanged on ambiguous");
//           ^^^ post-addItem timestamp   ^^^ pre-addItem timestamp   → ALWAYS UNEQUAL
```

**Root cause**: `listAfter` is captured BEFORE `addRes2` (line 529–532), but `addRes2` (adding item2) bumps `shopping_lists.updated_at`. By the time `listAfterAmbig` is queried (line 572–574), the list's `updatedAt` reflects the `addItem` write, not the ambiguous canonicalize. The assertion therefore compares two legitimately different timestamps. The service code is correct.

**Confirmation from service code** (`canonicalize.ts:266-268`):
```typescript
// 5. Ambiguous or none: no write, return item unchanged.
return { item: toItem(itemRow), match };
```
The `if (match.status === "matched")` block at lines 246–264 is the only place writes occur. Ambiguous and none fall through to line 267 — no UPDATE issued.

**The fix is in the test**: capture the list's `updatedAt` AFTER adding `item2` (after `addRes2`) and BEFORE the ambiguous canonicalize call, and compare `listAfterAmbig.updatedAt` against that freshly-captured value.

---

## 4. audit job

Command run: `npm audit --audit-level=high` from `/work/personal/compass`  
Exit code: **1**

```
image-size  *
Severity: high
image-size: ICNS parser allows denial of service through an infinite loop
  - https://github.com/advisories/GHSA-w3rx-r6r6-pgpr
image-size: JXL and HEIF parsers allow denial of service through infinite loops
  - https://github.com/advisories/GHSA-5p2g-fcmc-qvqq
No fix available
node_modules/image-size
  @docusaurus/mdx-loader → @docusaurus/core → @docusaurus/preset-classic (chain)

serialize-javascript  <=7.0.4
Severity: high
Serialize JavaScript: RCE via RegExp.flags and Date.prototype.toISOString()
  - https://github.com/advisories/GHSA-5c6j-r48x-rmvq
Serialize JavaScript: CPU Exhaustion DoS via crafted array-like objects
  - https://github.com/advisories/GHSA-qj8w-gfj5-8c6v
No fix available
node_modules/serialize-javascript
  copy-webpack-plugin → @docusaurus/bundler → @docusaurus/core (chain)
  css-minimizer-webpack-plugin → @docusaurus/bundler (chain)

esbuild  <=0.24.2
Severity: moderate
esbuild enables any website to send requests to the dev server and read the response
  - https://github.com/advisories/GHSA-67mh-4wv8-2f99
fix available via npm audit fix --force (breaking: would downgrade drizzle-kit to 0.18.1)
node_modules/@esbuild-kit/esm-loader → @esbuild-kit/core-utils → drizzle-kit

uuid  <11.1.1
Severity: moderate
uuid: Missing buffer bounds check in v3/v5/v6 when buf is provided
  - https://github.com/advisories/GHSA-w5hq-g745-h8pq
fix available via npm audit fix
node_modules/uuid → sockjs → webpack-dev-server

28 vulnerabilities (10 moderate, 18 high)
```

**Relation to task 9.x**: `git diff --stat main...HEAD -- package.json package-lock.json apps/*/package.json packages/*/package.json` produced **no output** — task 9.x added zero dependency changes. Every vulnerable package above is in the Docusaurus docs chain (`image-size`, `serialize-javascript`) or in dev tooling (`drizzle-kit`/`esbuild`, `webpack-dev-server`/`uuid`). None are in production runtime code. This failure is **pre-existing and unrelated to task 9.x**.

---

## Files inspected

- `tasks/068-photo-capture/ci-2.txt` (full CI failure report, 2280 lines)
- `apps/api/src/modules/shopping/routes/catalog.route.test.ts`
- `apps/api/src/modules/shopping/routes/lists.route.test.ts`
- `apps/api/src/modules/shopping/routes/capture.route.test.ts` (buildTestApp grep)
- `apps/api/src/modules/shopping/routes/capture-image.route.test.ts` (buildTestApp grep)
- `apps/api/src/plugins/security.ts`
- `apps/api/src/config.ts`
- `apps/api/src/modules/shopping/services/canonicalize.ts`
- `packages/shared/src/schemas/shopping.ts`

## Files changed

None (investigate brief).

---

## Unresolved risks

1. **"categoryId ownership" test error type**: The CI report only shows stack frames pointing to `cleanupUser` at `catalog.route.test.ts:81` and the `t.after` callback at line 299. The CI tool's grep for `AssertionError` did not extract a message for this test, suggesting either: (a) the body assertion failed with a non-AssertionError (e.g., 429 body unparsed as UUID causes TypeError), or (b) the body passed but cleanup threw a FK or connection error. Most likely (a): one of its 4 write calls got 429 instead of 404/200.

2. **Capture test write contribution**: `capture.route.test.ts` makes at least one POST write (demo session test creates a session) and `capture-image.route.test.ts` similarly. These add to the cumulative write budget but were not precisely counted.
