# Release preflight — evidence (read-only)

Run at: 2026-08-04, HEAD = 5b3f4990d92ff6852b7c5adc9e05694dee5f58a6 (5b3f499), branch `main`.

No files were edited. No git add/commit/push/tag/stash/checkout/restore/clean/branch commands were run.

---

## A. Version + release mechanics

### 1. `git describe --tags`
```
$ git describe --tags
v1.95.0
$ git describe --tags --abbrev=0
v1.95.0
```
HEAD is exactly on tag `v1.95.0` (no `-N-gHASH` suffix), i.e. the current commit already carries the v1.95.0 tag. Any new release would need a new tag, e.g. `v1.96.0`.

### 2. `git tag --sort=-v:refname | head -15`
```
v1.95.0
v1.94.0
v1.93.0
v1.92.0
v1.91.0
v1.90.0
v1.89.0
v1.88.0
v1.87.0
v1.86.0
v1.85.0
v1.84.0
v1.83.0
v1.82.0
v1.81.0
```

### 3. `git branch --show-current`
```
main
```

### 4. Unpushed commits + status -sb
```
$ git log --oneline origin/main..HEAD
(no output — HEAD is not ahead of origin/main)

$ git status -sb | head -3
## main...origin/main
 M apps/api/src/app.route-snapshot.test.ts
 M apps/api/src/app.ts
```
`main` and `origin/main` are at the same commit (no unpushed commits); all ~140 changes are uncommitted working-tree modifications, not local commits.

### 5. `.github/workflows/publish.yml`
Trigger (lines 6-11):
```yaml
on:
  push:
    branches: [main]
    tags: ["v*"]
  pull_request:
```
Runs on push to `main`, on any tag matching `v*`, and on pull_request (PRs build-only, no push, per comment at line 4-5).

Version derivation (lines 32-36):
```yaml
      - id: ver
        run: |
          echo "version=$(git describe --tags --always --dirty 2>/dev/null || echo dev)" >> "$GITHUB_OUTPUT"
          echo "built_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$GITHUB_OUTPUT"
```
Human-readable version = `git describe --tags --always --dirty` (nearest tag, e.g. `v1.2.0-3-gabc123`, else short SHA, else `dev`). Image tags come from `docker/metadata-action@v5` (lines 54-66) using `type=semver,pattern={{version}}`, `type=semver,pattern={{major}}.{{minor}}`, `type=sha,format=long`, `type=ref,event=branch`, `type=ref,event=pr`, and `type=raw,value=latest` on the default branch. Images: `ghcr.io/<owner>/pennypilot-<app>` for `app` in `[api, web, ingestor, extractor]` (matrix at lines 22-25).

### 6. `.github/workflows/ci.yml`
Triggers (lines 3-6):
```yaml
on:
  push:
    branches: [main]
  pull_request:
```
Runs on push to `main` and on any pull_request (no branch filter on the PR trigger).

Job `check` (self-hosted, docker; postgres:18 + redis:7 services) commands, in order (lines 42-54):
```
npm ci
npm run typecheck
npm run lint
npm run db:migrate          (DATABASE_URL=postgres://compass:compass-ci@localhost:<pg-port>/compass_ci)
npm test                    (DATABASE_URL=..., REDIS_URL=redis://localhost:<redis-port>, SESSION_SECRET=ci-only-session-secret-not-a-real-value-0123456789)
npm run build -w apps/web
npm run build -w apps/docs
```
Job `audit` (lines 56-72):
```
npm ci
npm audit --omit=dev --audit-level=high     (hard gate)
npm audit --audit-level=high                (continue-on-error: true; informational, docusaurus/minimatch pin noted)
```

---

## B. Full gate — literal output

### 7. `npm run typecheck`
Ran all 7 workspaces (`api`, `docs`, `extractor`, `ingestor`, `web`, `ai`, `shared`), each `tsc --noEmit` produced no output (no errors).
```
EXIT:0
```
**Result: PASS, exit 0.**

### 8. `npm run lint`
```
> compass@0.1.0 lint
> eslint .

EXIT:0
```
**Result: PASS, exit 0.**

### 9. `npm run test` (root, all workspaces)

Per-workspace `node --test` summary lines (`ℹ tests / suites / pass / fail / cancelled / skipped / todo / duration_ms`), extracted from the run in source order:

**`@compass/api@0.1.0`** — `node --env-file-if-exists=../../.env --test "src/**/*.test.ts"`
```
ℹ tests 837
ℹ suites 1
ℹ pass 837
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 7951.371641
```

**`@compass/extractor@0.1.0`** — `node --test "src/**/*.test.ts"`
```
ℹ tests 63
ℹ suites 0
ℹ pass 62
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 520.567311
```
Failure detail (verbatim):
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
✖ src/statement-duplicate.test.ts (419.980861ms)

✖ failing tests:

test at src/statement-duplicate.test.ts:1:1
✖ src/statement-duplicate.test.ts (419.980861ms)
  'test failed'
npm error Lifecycle script `test` failed with error:
npm error code 1
npm error path /home/udai/PennyPilot/apps/extractor
npm error workspace @compass/extractor@0.1.0
npm error location /home/udai/PennyPilot/apps/extractor
npm error command failed
npm error command sh -c node --test "src/**/*.test.ts"
```
This is a local-environment issue (`DATABASE_URL` not exported in this shell), not a code assertion failure — the test itself calls `requireDatabaseUrl()` and throws before running.

**`@compass/ingestor@0.1.0`**
```
ℹ tests 12
ℹ suites 0
ℹ pass 12
ℹ fail 0
```

**`@compass/web@0.1.0`**
```
ℹ tests 264
ℹ suites 0
ℹ pass 264
ℹ fail 0
```

**`@compass/ai@0.1.0`**
```
ℹ tests 32
ℹ suites 0
ℹ pass 32
ℹ fail 0
```

**`@compass/shared@0.1.0`**
```
ℹ tests 212
ℹ suites 0
ℹ pass 212
ℹ fail 0
```

Overall command:
```
EXIT:1
```

**Result: `apps/extractor` is the ONLY failing workspace (1 of 63 tests, due to missing `DATABASE_URL` in this shell environment — not a code defect). All other workspaces (api 837/837, ingestor 12/12, web 264/264, ai 32/32, shared 212/212) passed 100%. Root `npm run test` exit code: 1** (because npm propagates the extractor workspace's non-zero exit).

### 10. `npm run build -w apps/web`
```
> @compass/web@0.1.0 build
> vite build

vite v8.1.4 building client environment for production...
transforming...✓ 328 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                              0.53 kB │ gzip:   0.31 kB
dist/assets/index-D55EbFCn.css              54.49 kB │ gzip:  10.27 kB
... (43 asset lines total, largest: dist/assets/index-qQR4DZae.js 338.51 kB │ gzip: 104.92 kB)

✓ built in 1.43s
EXIT:0
```
**Result: PASS, exit 0.**

### 11. Docs build (`apps/docs`)
`apps/docs/package.json` has a `build` script: `"build": "docusaurus build"`. Ran `npm run build -w apps/docs`:
```
> @compass/docs@0.1.0 build
> docusaurus build

[INFO] [en] Creating an optimized production build...
[webpackbar] ℹ Compiling Client
[webpackbar] ℹ Compiling Server
[webpackbar] ✔ Server: Compiled successfully in 1.54s
[webpackbar] ✔ Client: Compiled successfully in 1.98s
[SUCCESS] Generated static files in "build".
[INFO] Use `npm run serve` command to test your build locally.
EXIT:0
```
**Result: PASS, exit 0.**

### 12. `npm audit --omit=dev --audit-level=high`
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
EXIT:1
```
**Result: FAIL, exit 1.** Two high-severity transitive vulnerabilities (`fast-uri` via `fast-json-stringify`/`ajv`, `ip-address`), both with `npm audit fix` available. This matches CI's "hard gate" job (`audit`), which would currently fail on this repo state.

---

## C. Cleanliness

### 13. `git status --porcelain` (full, current)
```
 M apps/api/src/app.route-snapshot.test.ts
 M apps/api/src/app.ts
 M apps/api/src/db/bootstrap.ts
 M apps/api/src/db/seed.ts
 M apps/api/src/jobs/index.ts
 M apps/api/src/route-table.snapshot.txt
 D apps/api/src/routes/account-nps.ts
 D apps/api/src/routes/accounts.ts
 D apps/api/src/routes/attachments.ts
 D apps/api/src/routes/bank-details.ts
 D apps/api/src/routes/cards.ts
 D apps/api/src/routes/categories.ts
 D apps/api/src/routes/emis.ts
 D apps/api/src/routes/holdings.ts
 M apps/api/src/routes/insurance.ts
 D apps/api/src/routes/ledger-events.route.test.ts
 D apps/api/src/routes/networth.ts
 D apps/api/src/routes/overdraft-details.ts
 D apps/api/src/routes/recurring.ts
 D apps/api/src/routes/resources.ts
 D apps/api/src/routes/rules.ts
 D apps/api/src/routes/search.ts
 D apps/api/src/routes/sips.ts
 D apps/api/src/routes/transaction-links.ts
 D apps/api/src/routes/transactions.ts
 D apps/api/src/routes/transfers.ts
 D apps/api/src/routes/user-tasks.route.test.ts
 D apps/api/src/routes/user-tasks.ts
 D apps/api/src/services/account-nps.ts
 D apps/api/src/services/accounts.test.ts
 D apps/api/src/services/accounts.ts
 M apps/api/src/services/ai/tools.ts
 D apps/api/src/services/amfi.ts
 D apps/api/src/services/attachments.test.ts
 D apps/api/src/services/attachments.ts
 M apps/api/src/services/auth.ts
 D apps/api/src/services/average-balance.test.ts
 D apps/api/src/services/average-balance.ts
 D apps/api/src/services/bank-details.ts
 M apps/api/src/services/bills.ts
 D apps/api/src/services/capital-gains.test.ts
 D apps/api/src/services/capital-gains.ts
 D apps/api/src/services/card-due-tasks.test.ts
 D apps/api/src/services/card-due-tasks.ts
 D apps/api/src/services/card-statements.ts
 D apps/api/src/services/cards.test.ts
 D apps/api/src/services/cards.ts
 M apps/api/src/services/cashflow.ts
 D apps/api/src/services/categories.ts
 M apps/api/src/services/dashboard.ts
 M apps/api/src/services/demo.ts
 D apps/api/src/services/emis.test.ts
 D apps/api/src/services/emis.ts
 D apps/api/src/services/epf-contributions.test.ts
 D apps/api/src/services/epf-contributions.ts
 D apps/api/src/services/goal-networth.test.ts
 D apps/api/src/services/goal-networth.ts
 M apps/api/src/services/goals.ts
 D apps/api/src/services/holding-details.ts
 D apps/api/src/services/holdings.test.ts
 D apps/api/src/services/holdings.ts
 M apps/api/src/services/imports.test.ts
 M apps/api/src/services/imports.ts
 M apps/api/src/services/inbox.test.ts
 M apps/api/src/services/inbox.ts
 M apps/api/src/services/insurance.ts
 D apps/api/src/services/merchants.ts
 D apps/api/src/services/mf-import.test.ts
 D apps/api/src/services/mf-import.ts
 D apps/api/src/services/mf-scheme-map.ts
 D apps/api/src/services/networth.test.ts
 D apps/api/src/services/networth.ts
 D apps/api/src/services/overdraft-details.ts
 M apps/api/src/services/periods.test.ts
 D apps/api/src/services/recurring.test.ts
 D apps/api/src/services/recurring.ts
 D apps/api/src/services/resources.ts
 D apps/api/src/services/search.ts
 D apps/api/src/services/sips.test.ts
 D apps/api/src/services/sips.ts
 D apps/api/src/services/tax-lots.test.ts
 D apps/api/src/services/tax-lots.ts
 D apps/api/src/services/transaction-links.test.ts
 D apps/api/src/services/transaction-links.ts
 D apps/api/src/services/transactions.test.ts
 D apps/api/src/services/transactions.ts
 D apps/api/src/services/transfers.test.ts
 D apps/api/src/services/transfers.ts
 D apps/api/src/services/user-tasks.test.ts
 D apps/api/src/services/user-tasks.ts
 D apps/api/src/services/xirr.test.ts
 D apps/api/src/services/xirr.ts
 M tasks/01.01-migrate-ledger.md
 M tasks/01.02-migrate-credit.md
 M tasks/01.03-migrate-investments.md
 M tasks/01.04-migrate-protection.md
 M tasks/01.09-cross-module-ports.md
 M tasks/README.md
?? apps/api/src/modules/credit/
?? apps/api/src/modules/investments/
?? apps/api/src/modules/ledger/
?? apps/api/src/route-surface.snapshot.txt
?? tasks/00.01-00.02-verification-1.md
?? tasks/000-agent-harness/
?? tasks/001-domain-event-bus/
?? tasks/001-engineer-routing-memory/
?? tasks/002-resume-refactor/
?? tasks/002-retire-url-regex-hook/
?? tasks/003-demo-monthday-utc-fix/
?? tasks/004-fix-eslint-no-undef/
?? tasks/005-fix-api-test-env-loading/
?? tasks/006-module-scaffold-and-route-gate/
?? tasks/007-migrate-ledger/
?? tasks/008-migrate-credit/
?? tasks/009-claude-md-schema-ownership-note/
?? tasks/010-migrate-investments/
?? tasks/011-migrate-protection/
```
(Untracked `tasks/012-release-checkpoint/` itself, containing this report, is not shown above since it did not exist until this run created it.)

### 14. Private-artifact patterns
```
$ git check-ignore -v data/
.gitignore:12:data/	data/
```
`data/` at repo root is ignored via the committed `.gitignore` line 12 (`data/`).

Search for `*.pdf`, `Pasted image*`, `data` at repo root (maxdepth 3, excluding `node_modules`):
```
/home/udai/PennyPilot/9907616356178351_24062026.pdf
/home/udai/PennyPilot/data
/home/udai/PennyPilot/apps/api/data
```

Per-file ignore status:
- `apps/api/data` → `.gitignore:12:data/` — **ignored by the committed `.gitignore`.**
- `/home/udai/PennyPilot/data` (repo root) → `.gitignore:12:data/` — **ignored by the committed `.gitignore`.**
- `/home/udai/PennyPilot/9907616356178351_24062026.pdf` (a statement PDF at repo root) →
  ```
  $ git check-ignore -v "9907616356178351_24062026.pdf"
  .git/info/exclude:7:9907616356178351_24062026.pdf	/home/udai/PennyPilot/9907616356178351_24062026.pdf
  ```
  This PDF **is** currently excluded, but the rule lives in the **local, untracked `.git/info/exclude`** (line 7), not in the committed `.gitignore`. The committed `.gitignore` shown below has no `*.pdf` pattern at all. **Risk:** this exclusion is local-only — it protects this one checkout but would not protect a fresh clone or a different contributor's repo; any `*.pdf` dropped at repo root by someone without that local exclude entry would be committable by `git add`/`git add -A`. `git ls-files --error-unmatch` on the PDF confirms it is not currently tracked.

### 15. `.gitignore` (verbatim)
```
# Secrets — never commit
.env
.env.local

# Dependencies & builds
node_modules/
dist/
build/
.docusaurus/

# Local data (attachments, backups)
data/

# Logs & OS noise
*.log
.DS_Store

.claude/

.idea/
```
No `*.pdf` or `Pasted image*` pattern present in the committed `.gitignore`.

---

## Summary of exit codes

| # | Command | Exit | Result |
|---|---|---|---|
| 7 | `npm run typecheck` | 0 | PASS |
| 8 | `npm run lint` | 0 | PASS |
| 9 | `npm run test` | 1 | FAIL — extractor only (1/63 tests, missing `DATABASE_URL` in shell) |
| 10 | `npm run build -w apps/web` | 0 | PASS |
| 11 | `npm run build -w apps/docs` | 0 | PASS |
| 12 | `npm audit --omit=dev --audit-level=high` | 1 | FAIL — 2 high-severity (fast-uri, ip-address) |
