# Investigation 3 — PR #200 CI failures

## 1. Tests asserting 429 / rate-limit active

No test asserts `statusCode === 429` or `"Too Many Requests"`. No test asserts rate-limiting is ON.

`apps/api/src/modules/ingest/routes/ingest.route.test.ts:348–361` is the only test touching rate-limit internals. It tests `bucketFor()` bucket *classification* only — it calls `securityTest.bucketFor(req)` and checks `.name` equals `WRITE_BUCKET.name` or `READ_BUCKET.name`. It imports `_test` from `security.ts` as a pure function; no Redis, no 429 assertion, no rate-limit enabled/disabled check. **No dedicated rate-limit test would break if rate-limiting were disabled.**

## 2. NODE_ENV / RATE_LIMIT_DISABLED in CI and config

`apps/api/src/config.ts:9`:
```ts
NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
```
`"test"` is a valid enum value.

`apps/api/src/config.ts:46`:
```ts
RATE_LIMIT_DISABLED: z.stringbool().default(false),
```

CI test step env (`.github/workflows/ci.yml:47–51`) — only these vars are set:
```yaml
env:
  DATABASE_URL: postgres://compass:compass-ci@localhost:${{ ... }}/compass_ci
  REDIS_URL: redis://localhost:${{ ... }}
  SESSION_SECRET: ci-only-session-secret-not-a-real-value-0123456789
```
`NODE_ENV` and `RATE_LIMIT_DISABLED` are **not set**. Since `NODE_ENV` defaults to `"development"`, rate-limiting is ON in CI tests (security.ts:48: `rateLimitOn = !RATE_LIMIT_DISABLED && NODE_ENV !== "test"`).

Root `package.json` test script: `npm run test --workspaces --if-present`
`apps/api/package.json` test script: `node --env-file-if-exists=../../.env --experimental-test-module-mocks --test "src/**/*.test.ts"`

Other `NODE_ENV` usages outside security.ts/config.ts:
- `apps/api/src/app.ts:159`: `level: config.NODE_ENV === "production" ? "info" : "debug"` — log level only
- `apps/api/src/plugins/auth.ts:26`: `secure: reply.server.config.NODE_ENV === "production"` — session cookie `Secure` flag

Setting `RATE_LIMIT_DISABLED=true` in the CI env is **config-valid** (it's a `z.stringbool()` with default `false`) and surgical — it disables only rate-limiting, leaves log level and cookie secure flag unchanged.

## 3. Bucket key derivation / per-request isolation

`apps/api/src/plugins/security.ts:85`:
```ts
const key = `rl:${bucket.name}:${req.ip}`;
```
`req.ip` is Fastify's IP resolution, which respects `trustProxy`.

`apps/api/src/app.ts:163`: `trustProxy: true`
`apps/api/src/modules/credit/routes/revolving-debt.route.test.ts:43`: `const app = Fastify({ logger: false, trustProxy: true })`

All `buildTestApp()` functions set `trustProxy: true`. With `trustProxy: true`, Fastify reads IP from `X-Forwarded-For`. `app.inject()` accepts `remoteAddress` to set `req.ip`, AND you can pass `headers: { 'x-forwarded-for': '<unique-ip>' }` to vary `req.ip` per test file. This would give each test file a distinct bucket key. However, the buckets have high limits (READ: 600/60s, WRITE: 120/60s, AUTH: 15/300s) and the real problem is likely many route tests sharing the same synthetic IP, so the AUTH bucket (15 requests / 300s) is the binding constraint for login-heavy test files. Per-request isolation via `remoteAddress` or XFF header is feasible but requires modifying every `buildTestApp()` or every `app.inject()` call. `RATE_LIMIT_DISABLED=true` is simpler.

## 4. Audit job — advisory or required gate

`.github/workflows/ci.yml:55–71`: `audit` is a **separate job** from `check`.

```yaml
audit:
  runs-on: ubuntu-latest
  steps:
    - ...
    - run: npm audit --omit=dev --audit-level=high   # hard gate
    - run: npm audit --audit-level=high
      continue-on-error: true                        # informational / non-blocking
```

The hard gate (`--omit=dev`) passes: `found 0 vulnerabilities`.
The informational step (`continue-on-error: true`) finds: **28 vulnerabilities (10 moderate, 18 high)** — all in `@docusaurus/*` dev deps (`serialize-javascript <=7.0.4` via `copy-webpack-plugin`/`css-minimizer-webpack-plugin`, `uuid <11.1.1` via `sockjs`/`webpack-dev-server`). No fix available for `serialize-javascript`; the CI comment at line 69–71 explicitly notes this is non-blocking because Docusaurus pins an old `brace-expansion`.

Branch protection API: **HTTP 403** (private repo, free plan — cannot query required status checks).

Latest 5 main CI runs: all `success` except one `failure` on 2026-08-14 (sha `2cadca2f`). Latest run (32463690075): both `audit` and `check` jobs concluded `success`.

`gh run view 32463690075 --json jobs`:
```json
{"conclusion":"success","name":"audit"}
{"conclusion":"success","name":"check"}
```

**Conclusion:** `audit` is **not currently failing on main**. The `--omit=dev` hard gate passes (0 runtime vulns). The `continue-on-error: true` step is non-blocking by design. The PR #200 audit failure (if any) is likely the `--omit=dev` gate, meaning a runtime dep was added with a HIGH vuln in the shopping/catalogue feature.
