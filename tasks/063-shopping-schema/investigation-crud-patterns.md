# Investigation: CRUD Patterns for Shopping Task 9.2

## 1. Representative CRUD module: `modules/protection` (insurance sub-domain)

Chosen because it has full create/list/update/delete with a FK ownership guard,
Zod schemas imported from `@compass/shared`, and a real-DB route test.

### Route file
`apps/api/src/modules/protection/routes/insurance.ts`

- **TypeProvider** — line 31: `const r = app.withTypeProvider<ZodTypeProvider>();`
- **GET list** — lines 33–37:
  ```ts
  r.get("/api/insurance/policies",
    { schema: { response: { 200: z.array(InsurancePolicySchema) } } },
    async (req) => listPolicies(app.db, req.session!.userId));
  ```
- **POST create** — lines 39–43:
  ```ts
  r.post("/api/insurance/policies",
    { schema: { body: CreateInsurancePolicySchema, response: { 200: InsurancePolicySchema } } },
    async (req) => createPolicy(app.db, req.session!.userId, req.body));
  ```
- **PUT update** — lines 45–55: `params: PolicyParams` (z.object({ id: z.uuid() })), body:
  `UpdateInsurancePolicySchema`, handler calls `updatePolicy(app.db, req.session!.userId, req.params.id, req.body)`.
- **DELETE** — lines 57–64: returns `{ ok: true }` with schema `z.object({ ok: z.boolean() })`.
- `req.session!.userId` is used throughout; session is typed by auth plugin's
  declaration (auth.ts line 9).

### Service file
`apps/api/src/modules/protection/services/insurance.ts`

- All exported functions take `(db: Db, userId: string, ...)`. `Db` is imported
  from `../../../db/index.ts`.
- **Ownership guard (private FK on this module's own table)** — lines 73–79:
  private `ownedPolicy(db, userId, id)` queries
  `where: and(eq(insurancePolicies.id, id), eq(insurancePolicies.userId, userId))`
  and throws `new HttpError(404, "Policy not found")` if missing.
- **Ownership guard (client-supplied FK into another module)** — line 110:
  `await assertOwnedResource(db, userId, parsed.resourceId)` from
  `modules/ledger/services/resources.ts` (the cross-module FK guard pattern).
- **Update** (lines 118–132): calls `ownedPolicy` first, then updates with
  `where: and(eq(...id), eq(...userId))`.
- **Delete** (lines 134–157): delete with userId in WHERE; checks `rows.length === 0`
  → `throw new HttpError(404, ...)`.
- **Not-found** is always `throw new HttpError(404, "<noun> not found")` from
  `lib/errors.ts`.

### `lib/ownership.ts` — generic FK guards
`apps/api/src/lib/ownership.ts`

Each guard (`assertOwnedAccount`, `assertOwnedCategory`, `assertOwnedGoal`,
`assertOwnedHolding`) follows the pattern (lines 17–86):
```ts
export async function assertOwnedXxx(db: DbOrTx, userId: string, xId: string | null | undefined) {
  if (!xId) return;  // null/undefined = "no reference" — skip
  const row = await db.query.xxx.findFirst({ where: and(eq(xxx.id, xId), eq(xxx.userId, userId)), columns: { id: true } });
  if (!row) throw new HttpError(404, "Xxx not found");
}
```
Shopping services should add `assertOwnedCatalogItem` / `assertOwnedShoppingList` here
(or inline equivalent) when accepting client-supplied FKs.

### Plugin registration
`apps/api/src/modules/protection/plugin.ts` (lines 20–23):
```ts
export async function protectionRoutes(app: FastifyInstance): Promise<void> {
  await app.register(retirementRoutes);
  await app.register(insuranceRoutes);
}
```
`app.ts` line 149: `await app.register(protectionRoutes);`

---

## 2. Demo-mode mutation block

`apps/api/src/plugins/auth.ts`

- **`MUTATING_METHODS`** — line 16: `new Set(["POST", "PUT", "PATCH", "DELETE"])`.
- **Allowlist** — line 18: `new Set(["/api/auth/logout"])`.
- **Rejection hook** — lines 66–74 in `onRequest`:
  ```ts
  if (req.session?.demo && MUTATING_METHODS.has(req.method)
      && !DEMO_WRITE_ALLOWLIST.has(req.routeOptions.url ?? "")) {
    return reply.code(403).send({ error: "DemoReadOnly", ... });
  }
  ```
- **Conclusion**: every new `POST/PATCH/DELETE` route is **automatically demo-safe**
  without any per-route work — the single `onRequest` hook blocks all mutating
  methods from demo sessions globally. No route-level annotation is needed.

---

## 3. Shopping module registration in `app.ts`

`apps/api/src/app.ts` line 153:
```ts
// First module registered with a Fastify prefix — see modules/shopping/plugin.ts.
await app.register(shoppingRoutes, { prefix: "/api/shopping" });
```

`apps/api/src/modules/shopping/plugin.ts` lines 8–13 (comment) + lines 15–17:
```ts
// Because the prefix is applied at the app.ts registration site (not here),
// route files in this module declare paths relative to it
// (e.g. /units resolves to GET /api/shopping/units).
export async function shoppingRoutes(app: FastifyInstance): Promise<void> {
  await app.register(shoppingUnitRoutes);
}
```
Route files declare paths like `/units`, `/lists`, `/lists/:id` — the `/api/shopping`
prefix is prepended at registration time.

---

## 4. Test conventions

### Hermetic (no DB/Redis) — pure route-wiring test
`apps/api/src/modules/shopping/routes/units.route.test.ts` (lines 1–48)

Builds `Fastify({ logger: false })`, sets validator/serializer compilers, registers
the module plugin with its prefix, calls `app.inject(...)`. No auth plugin — tests
the route schema wiring only. Response is validated against the shared Zod schema.

### Hermetic with `mock.module()` — stubs service, exercises real route
`apps/api/src/modules/planning/routes/planning-analysis.hermetic.test.ts`

```ts
// Stub BEFORE importing the real route (lines 75–92)
await mock.module(new URL("../services/income-surplus.ts", import.meta.url).href, {
  exports: { getIncomeSurplus: async (...) => FIXTURE }
});
// Then import the real plugin (line 95)
const { planningAnalysisRoutes } = await import("./planning-analysis.ts");
```
The hermetic app (lines 101–119) stubs `req.session` via `preHandler` hook and
decorates `app.db` with `{}` — no real Postgres needed. Requires
`--experimental-test-module-mocks` (set in `apps/api/package.json`).

### Real-DB route test — integration
`apps/api/src/modules/protection/routes/protection.route.test.ts` (lines 1–70)

Builds a full Fastify instance with real Postgres + Redis (requires `DATABASE_URL`,
`REDIS_URL`, `SESSION_SECRET` env vars). Registers `setupAuth`, `setupSecurity`, and
the module plugin. Uses `createSession`/`destroySession` to simulate demo vs. normal
sessions; makes real `app.inject(...)` calls and asserts HTTP status codes.

---

## 5. `@compass/shared` schema pattern for Create/Update

`packages/shared/src/schemas/insurance.ts`

- **Entity response schema** — line 60: `export const InsurancePolicySchema = z.object({ ... })` (all fields, including server-generated `id`, `archived`, `healthCards`).
- **Shared field set (private)** — lines 108–132: `const policyFields = { name: ..., kind: ..., ... }` with defaults — shared by both create and update schemas.
- **Create schema** — line 178: `export const CreateInsurancePolicySchema = z.object(policyFields).superRefine(checkPolicyConsistency)` (or equivalent).
- **Update schema** — line 183: `export const UpdateInsurancePolicySchema = z...` (same fields, all optional or partial).
- Types are `z.infer<typeof ...Schema>` for responses and `z.input<typeof ...Schema>` for write inputs (lines 181, 186).

Pattern summary:
1. Define entity response schema (all fields).
2. Define a private `xxxFields` object with defaults.
3. Export `CreateXxxSchema = z.object(xxxFields).superRefine(...)`.
4. Export `UpdateXxxSchema = z.object(...).partial().superRefine(...)` (or `z.object` with optional fields).
5. Export inferred TypeScript types from both.

---

## 6. `backup.ts` coverage of shopping tables

`apps/api/src/modules/system/services/backup.ts`

| Table | List | Line |
|---|---|---|
| `catalog_items` | `ALL_TABLES` | 47 |
| `price_sources` | `ALL_TABLES` | 47 |
| `shopping_lists` | `ALL_TABLES` | 47 |
| `shopping_list_items` | `ALL_TABLES` | 47 |
| `price_observations` | `ALL_TABLES` | 48 |
| `pantry_items` | `ALL_TABLES` | 48 |
| `cart_drafts` | `ALL_TABLES` | 48 |
| `habit_profiles` | `ALL_TABLES` | 48 |
| `catalog_items` | `USER_TABLES` (user_id) | 71 |
| `price_sources` | `USER_TABLES` (user_id) | 71 |
| `shopping_lists` | `USER_TABLES` (user_id) | 71 |
| `price_observations` | `USER_TABLES` (user_id) | 72 |
| `pantry_items` | `USER_TABLES` (user_id) | 72 |
| `cart_drafts` | `USER_TABLES` (user_id) | 72 |
| `habit_profiles` | `USER_TABLES` (user_id) | 73 |
| `shopping_list_items` | `LINKED_TABLES` (fk: list_id → shopping_lists) | 92 |

All 8 shopping tables are already present. `shopping_list_items` is in `LINKED_TABLES`
(not `USER_TABLES`) because it has no direct `user_id` column — it FK's to `shopping_lists`.
No backup.ts edits are needed for task 9.2.
