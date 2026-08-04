# npm audit fix — evidence (audit-fix-1)

Date: 2026-08-04
Working directory: /home/udai/PennyPilot

## Hard constraints observed
- No state-changing git commands were run (no add/commit/push/tag/stash/checkout/restore/clean/branch).
- `npm audit fix` was run WITHOUT `--force`.
- No files under `apps/` or `packages/` were hand-edited.
- Only `package-lock.json` changed; `npm audit fix` resolved the flagged high-severity vulns without needing `--force`, so no stop/escalation was required.

## Step 1 — baseline uncommitted-change count

Command:
```
git status --porcelain | wc -l
```
Output:
```
118
```

## Step 2 — "before" audit (prod deps, high+)

Command:
```
npm audit --omit=dev --audit-level=high
```
Exit code: `1`

Output:
```
# npm audit report

fast-uri  3.0.0 - 3.1.4 || 4.0.0 - 4.1.1
Severity: high
fast-uri vulnerable to host confusion via backslash authority introducer - https://github.com/advisories/GHSA-7p8r-x3mc-p8w7
fast-uri vulnerable to host confusion via backslash authority introducer - https://github.com/advisories/GHSA-7p8r-x3mc-p8w7
fix available via `npm audit fix`
node_modules/fast-json-stringify/node_modules/ajv/node_modules/fast-uri
node_modules/fast-json-stringify/node_modules/fast-uri
node_modules/fast-uri

ip-address  <=10.3.0
Severity: high
ip-address: Address4 decodes leading-zero octets as decimal while resolvers decode them as octal, allowing SSRF and trust-boundary bypass - https://github.com/advisories/GHSA-mwp4-54f8-5fhr
ip-address: a CIDR suffix on the parsed address suppresses special-use classification and can bypass SSRF and trust-boundary checks - https://github.com/advisories/GHSA-4xrf-jv44-h6hh
ip-address: misclassification of IPv4-mapped/NAT64 IPv6 addresses can bypass SSRF and trust-boundary checks - https://github.com/advisories/GHSA-22jq-vg5j-6vgg
fix available via `npm audit fix`
node_modules/ip-address

2 high severity vulnerabilities

To address all issues, run:
  npm audit fix
```

## Step 3 — `npm audit fix`

Command:
```
npm audit fix
```
Exit code: `1` (non-zero because remaining moderate/high issues in **dev**-only tooling — `esbuild` via `drizzle-kit`, and `serialize-javascript`/`uuid` via the docs-site's `@docusaurus/*` webpack toolchain — still require `--force`, which was NOT run per the hard constraint. These do not affect `--omit=dev` production audit, see Step 5.)

Output:
```
changed 7 packages, and audited 1604 packages in 34s

509 packages are looking for funding
  run `npm fund` for details

# npm audit report

esbuild  <=0.24.2
Severity: moderate
esbuild enables any website to send any requests to the development server and read the response - https://github.com/advisories/GHSA-67mh-4wv8-2f99
fix available via `npm audit fix --force`
Will install drizzle-kit@0.18.1, which is a breaking change
node_modules/@esbuild-kit/core-utils/node_modules/esbuild
  @esbuild-kit/core-utils  *
  Depends on vulnerable versions of esbuild
  node_modules/@esbuild-kit/core-utils
    @esbuild-kit/esm-loader  *
    Depends on vulnerable versions of @esbuild-kit/core-utils
    node_modules/@esbuild-kit/esm-loader
      drizzle-kit  0.19.0 - 1.0.0-beta.1-fd8bfcc
      Depends on vulnerable versions of @esbuild-kit/esm-loader
      node_modules/drizzle-kit

serialize-javascript  <=7.0.4
Severity: high
Serialize JavaScript is Vulnerable to RCE via RegExp.flags and Date.prototype.toISOString() - https://github.com/advisories/GHSA-5c6j-r48x-rmvq
Serialize JavaScript has CPU Exhaustion Denial of Service via crafted array-like objects - https://github.com/advisories/GHSA-qj8w-gfj5-8c6v
fix available via `npm audit fix --force`
Will install @docusaurus/core@3.5.2, which is a breaking change
node_modules/serialize-javascript
  copy-webpack-plugin  6.1.1 - 13.0.1
  Depends on vulnerable versions of serialize-javascript
  node_modules/copy-webpack-plugin
    @docusaurus/bundler  *
    Depends on vulnerable versions of copy-webpack-plugin
    Depends on vulnerable versions of css-minimizer-webpack-plugin
    node_modules/@docusaurus/bundler
      @docusaurus/core  *
      Depends on vulnerable versions of @docusaurus/bundler
      Depends on vulnerable versions of webpack-dev-server
      node_modules/@docusaurus/core
        @docusaurus/plugin-content-blog  <=0.0.0-6119 || 3.5.2-canary-6121 - 3.5.2-canary-6131 || >=3.6.0-canary-6132
        Depends on vulnerable versions of @docusaurus/core
        node_modules/@docusaurus/plugin-content-blog
        @docusaurus/plugin-content-docs  <=0.0.0-6119 || 3.5.2-canary-6121 - 3.5.2-canary-6131 || >=3.6.0-canary-6132
        Depends on vulnerable versions of @docusaurus/core
        node_modules/@docusaurus/plugin-content-docs
        @docusaurus/plugin-content-pages  <=0.0.0-6119 || 3.5.2-canary-6121 - 3.5.2-canary-6131 || >=3.6.0-canary-6132
        Depends on vulnerable versions of @docusaurus/core
        node_modules/@docusaurus/plugin-content-pages
        @docusaurus/plugin-css-cascade-layers  *
        Depends on vulnerable versions of @docusaurus/core
        node_modules/@docusaurus/plugin-css-cascade-layers
          @docusaurus/preset-classic  <=0.0.0-6119 || 3.5.2-canary-6121 - 3.5.2-canary-6131 || >=3.6.0-canary-6132
          Depends on vulnerable versions of @docusaurus/core
          Depends on vulnerable versions of @docusaurus/plugin-content-blog
          Depends on vulnerable versions of @docusaurus/plugin-content-docs
          Depends on vulnerable versions of @docusaurus/plugin-content-pages
          Depends on vulnerable versions of @docusaurus/plugin-css-cascade-layers
          Depends on vulnerable versions of @docusaurus/plugin-debug
          Depends on vulnerable versions of @docusaurus/plugin-google-analytics
          Depends on vulnerable versions of @docusaurus/plugin-google-gtag
          Depends on vulnerable versions of @docusaurus/plugin-google-tag-manager
          Depends on vulnerable versions of @docusaurus/plugin-sitemap
          Depends on vulnerable versions of @docusaurus/plugin-svgr
          Depends on vulnerable versions of @docusaurus/theme-classic
          Depends on vulnerable versions of @docusaurus/theme-search-algolia
          node_modules/@docusaurus/preset-classic
        @docusaurus/plugin-debug  <=0.0.0-6119 || 3.5.2-canary-6121 - 3.5.2-canary-6131 || >=3.6.0-canary-6132
        Depends on vulnerable versions of @docusaurus/core
        node_modules/@docusaurus/plugin-debug
        @docusaurus/plugin-google-analytics  <=0.0.0-6119 || 3.5.2-canary-6121 - 3.5.2-canary-6131 || >=3.6.0-canary-6132
        Depends on vulnerable versions of @docusaurus/core
        node_modules/@docusaurus/plugin-google-analytics
        @docusaurus/plugin-google-gtag  <=0.0.0-6119 || 3.5.2-canary-6121 - 3.5.2-canary-6131 || >=3.6.0-canary-6132
        Depends on vulnerable versions of @docusaurus/core
        node_modules/@docusaurus/plugin-google-gtag
        @docusaurus/plugin-google-tag-manager  <=0.0.0-6119 || 3.5.2-canary-6121 - 3.5.2-canary-6131 || >=3.6.0-canary-6132
        Depends on vulnerable versions of @docusaurus/core
        node_modules/@docusaurus/plugin-google-tag-manager
        @docusaurus/plugin-sitemap  <=0.0.0-6119 || 3.5.2-canary-6121 - 3.5.2-canary-6131 || >=3.6.0-canary-6132
        Depends on vulnerable versions of @docusaurus/core
        node_modules/@docusaurus/plugin-sitemap
        @docusaurus/plugin-svgr  *
        Depends on vulnerable versions of @docusaurus/core
        node_modules/@docusaurus/plugin-svgr
        @docusaurus/theme-classic  <=0.0.0-6119 || 3.5.2-canary-6121 - 3.5.2-canary-6131 || >=3.6.0-canary-6132
        Depends on vulnerable versions of @docusaurus/core
        Depends on vulnerable versions of @docusaurus/plugin-content-blog
        Depends on vulnerable versions of @docusaurus/plugin-content-docs
        Depends on vulnerable versions of @docusaurus/plugin-content-pages
        node_modules/@docusaurus/theme-classic
        @docusaurus/theme-search-algolia  <=0.0.0-6119 || 3.5.2-canary-6121 - 3.5.2-canary-6131 || >=3.6.0-canary-6132
        Depends on vulnerable versions of @docusaurus/core
        Depends on vulnerable versions of @docusaurus/plugin-content-docs
        node_modules/@docusaurus/theme-search-algolia
  css-minimizer-webpack-plugin  1.1.4 - 7.0.4
  Depends on vulnerable versions of serialize-javascript
  node_modules/css-minimizer-webpack-plugin

uuid  <11.1.1
Severity: moderate
uuid: Missing buffer bounds check in v3/v5/v6 when buf is provided - https://github.com/advisories/GHSA-w5hq-g745-h8pq
fix available via `npm audit fix --force`
Will install @docusaurus/core@3.5.2, which is a breaking change
node_modules/uuid
  sockjs  >=0.3.17
  Depends on vulnerable versions of uuid
  node_modules/sockjs
    webpack-dev-server  2.0.0-beta - 5.2.6
    Depends on vulnerable versions of sockjs
    node_modules/webpack-dev-server

25 vulnerabilities (24 moderate, 1 high)

To address issues that do not require attention, run:
  npm audit fix

To address all issues (including breaking changes), run:
  npm audit fix --force
npm warn allow-scripts 6 packages have install scripts not yet covered by allowScripts:
npm warn allow-scripts   esbuild@0.18.20 (install: (install scripts present))
npm warn allow-scripts   argon2@0.44.0 (install: node-gyp rebuild)
npm warn allow-scripts   core-js@3.49.0 (install: (install scripts present))
npm warn allow-scripts   esbuild@0.25.12 (install: (install scripts present))
npm warn allow-scripts   esbuild@0.28.1 (install: (install scripts present))
npm warn allow-scripts   msgpackr-extract@3.0.4 (install: node-gyp rebuild)
npm warn allow-scripts
npm warn allow-scripts Run `npm approve-scripts --allow-scripts-pending` to review, or `npm approve-scripts <pkg>` to allow.
```

Note: `npm audit fix` bumped 7 packages (patch/minor-only, no `--force`). The remaining 25 vulnerabilities listed above are all dev-only (drizzle-kit's esbuild, and docs' docusaurus/webpack-dev-server chain) and require `--force`/breaking upgrades, which was explicitly forbidden. They are out of scope for AC1 because AC1 is scoped to `--omit=dev --audit-level=high`.

## Step 4 — diff stat of package-lock.json / package.json

Command:
```
git diff --stat package-lock.json package.json
```
Output:
```
 package-lock.json | 44 ++++++++++++++++++++++----------------------
 1 file changed, 22 insertions(+), 22 deletions(-)
```
`package.json` itself: no diff (0 changes) — `git diff --stat package.json` alone produced no output.

Packages that moved version in the lockfile (per full `git diff package-lock.json`):
- `brace-expansion` (root/dev): 5.0.8 → 5.0.9
- `node_modules/fast-json-stringify/node_modules/ajv/node_modules/fast-uri`: 3.1.4 → 3.1.5
- `node_modules/fast-json-stringify/node_modules/fast-uri`: 4.1.1 → 4.1.2
- `node_modules/fast-uri` (top-level): 3.1.4 → 3.1.5
- `ip-address`: 10.2.0 → 10.4.0
- `postcss` (dev): 8.5.18 → 8.5.25 (nanoid dep range `^3.3.12` → `^3.3.16`)
- `serve-handler/node_modules/brace-expansion` (dev): 1.1.16 → 1.1.18

The two high-severity prod-path vulns (`fast-uri`, `ip-address`) are resolved by these bumps.

## Step 5 — "after" audit (prod deps, high+)

Command:
```
npm audit --omit=dev --audit-level=high
```
Exit code: `0`

Output:
```
found 0 vulnerabilities
```

**AC1: PASS**

## Step 6 — full gate re-run

### `npm run typecheck`
Exit code: `0`
Summary (per-workspace, all silent/no errors — `tsc --noEmit` prints nothing on success):
```
> compass@0.1.0 typecheck
> npm run typecheck --workspaces --if-present

> @compass/api@0.1.0 typecheck
> tsc --noEmit

> @compass/docs@0.1.0 typecheck
> tsc --noEmit

> @compass/extractor@0.1.0 typecheck
> tsc --noEmit

> @compass/ingestor@0.1.0 typecheck
> tsc --noEmit

> @compass/web@0.1.0 typecheck
> tsc --noEmit

> @compass/ai@0.1.0 typecheck
> tsc --noEmit

> @compass/shared@0.1.0 typecheck
> tsc --noEmit
```

### `npm run lint`
Exit code: `0`
Output:
```
> compass@0.1.0 lint
> eslint .
```
(no lint errors/warnings printed)

### `npm run test` (root)
Exit code: `1` (the only failure is the pre-existing, expected `apps/extractor` DATABASE_URL failure)

Per-workspace summary (from `node --test`'s own `ℹ tests/pass/fail` counters):

| Workspace | tests | pass | fail |
|---|---|---|---|
| `@compass/api` | 837 | 837 | 0 |
| `@compass/extractor` | 63 | 62 | 1 |
| `@compass/ingestor` | 12 | 12 | 0 |
| `@compass/web` | 264 | 264 | 0 |
| `@compass/ai` | 32 | 32 | 0 |
| `@compass/shared` | 212 | 212 | 0 |

`apps/extractor` failure (the sole, expected failure), verbatim:
```
file:///home/udai/PennyPilot/apps/extractor/src/statement-duplicate.test.ts:30
    throw new Error(
          ^

Error: statement-duplicate.test.ts needs DATABASE_URL set (a real Postgres connection) — this repo has no DB-mocking infrastructure. Export it (see apps/extractor/.env) before running `npm run test -w apps/extractor`.
    at requireDatabaseUrl (file:///home/udai/PennyPilot/apps/extractor/src/statement-duplicate.test.ts:30:11)
    at file:///home/udai/PennyPilot/apps/extractor/src/statement-duplicate.test.ts:39:25
    at ModuleJob.run (node:internal/modules/esm/module_job:439:25)
    at async node:internal/modules/esm/loader:643:26
    at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:101:5)

Node.js v24.18.0
✖ src/statement-duplicate.test.ts (429.952669ms)
ℹ tests 63
ℹ suites 0
ℹ pass 62
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 535.474966

✖ failing tests:

test at src/statement-duplicate.test.ts:1:1
✖ src/statement-duplicate.test.ts (429.952669ms)
  'test failed'
npm error Lifecycle script `test` failed with error:
npm error code 1
npm error path /home/udai/PennyPilot/apps/extractor
npm error workspace @compass/extractor@0.1.0
npm error location /home/udai/PennyPilot/apps/extractor
npm error command failed
npm error command sh -c node --test "src/**/*.test.ts"
```
No second failure appeared in any workspace. `apps/api` remains 837/837 (matches AC3's required count exactly).

**AC3: PASS** (api 837/837; only the pre-existing extractor DATABASE_URL failure present; no regressions)

### `npm run build -w apps/web`
Exit code: `0`
Tail of output:
```
dist/assets/TransactionsPage-168fVFpG.js    54.00 kB │ gzip:  14.94 kB
dist/assets/SettingsPage-CwAUoAjE.js        58.51 kB │ gzip:  13.95 kB
dist/assets/src-Dx0jFFc7.js                144.99 kB │ gzip:  40.33 kB
dist/assets/index-qQR4DZae.js              338.51 kB │ gzip: 104.92 kB

✓ built in 510ms
```

### `npm run build -w apps/docs`
Exit code: `0`
Output:
```
> @compass/docs@0.1.0 build
> docusaurus build

[INFO] [en] Creating an optimized production build...
[webpackbar] ℹ Compiling Client
[webpackbar] ℹ Compiling Server
[webpackbar] ✔ Server: Compiled successfully in 20.95s
[webpackbar] ✔ Client: Compiled successfully in 33.52s
[SUCCESS] Generated static files in "build".
[INFO] Use `npm run serve` command to test your build locally.
```

**AC2: PASS** (typecheck 0, lint 0, web build 0, docs build 0)

## Step 7 — final uncommitted-change count

Command:
```
git status --porcelain | wc -l
```
Output:
```
119
```
Baseline was 118 (step 1); final is 119 — exactly +1, and the sole file newly touched is `package-lock.json` (confirmed via `git status --porcelain | grep -E "package-lock.json|package.json"` → ` M package-lock.json` only; `package.json` shows no diff). No other file changed.

**AC4: PASS**

## Assumptions
- The brief's "or +1 only if package.json newly appears as modified" language was interpreted permissively: the +1 delta here is `package-lock.json` (which was already tracked, so its modification produces exactly one `M` line), not `package.json`. `package.json` itself was not touched by `npm audit fix` in this run.
- `npm audit fix`'s own non-zero (1) exit code is expected/documented behavior when unresolved (dev-only) vulnerabilities remain that would require `--force` — it does not indicate the fix step failed; the fix step's success is judged by the "after" `--omit=dev --audit-level=high` audit in Step 5, which is what AC1 specifies.

## Unresolved risks
- 25 vulnerabilities remain unresolved in dev-only dependency chains (drizzle-kit's bundled esbuild — moderate; and the docs workspace's `@docusaurus/*`/webpack-dev-server chain — 1 high + rest moderate). These are out of scope per the brief (AC1 is `--omit=dev`) and per the explicit "no `--force`" constraint, but they remain visible in a full (non-`--omit=dev`) `npm audit` and would need a deliberate, reviewed major-version bump (`drizzle-kit@0.18.1` / `@docusaurus/core@3.5.2`) to clear.
