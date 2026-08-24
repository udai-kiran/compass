# Implementation 3 — PR #200 CI fixes (branch feat/shopping-core-capture)

## Files inspected
- `tasks/066-catalog-canonicalization/investigation-2.md`
- `tasks/066-catalog-canonicalization/investigation-3.md`
- `.github/workflows/ci.yml`
- `apps/api/src/modules/shopping/routes/catalog.route.test.ts` (lines 500–590)

## Files changed
- `.github/workflows/ci.yml`
- `apps/api/src/modules/shopping/routes/catalog.route.test.ts`

---

## FIX A — Disable rate-limiting in CI test step

### Before (`.github/workflows/ci.yml` lines 47–51):
```yaml
      - run: npm test
        env:
          DATABASE_URL: postgres://compass:compass-ci@localhost:${{ job.services.postgres.ports['5432'] }}/compass_ci
          REDIS_URL: redis://localhost:${{ job.services.redis.ports['6379'] }}
          SESSION_SECRET: ci-only-session-secret-not-a-real-value-0123456789
```

### After (`.github/workflows/ci.yml` lines 47–52):
```yaml
      - run: npm test
        env:
          DATABASE_URL: postgres://compass:compass-ci@localhost:${{ job.services.postgres.ports['5432'] }}/compass_ci
          REDIS_URL: redis://localhost:${{ job.services.redis.ports['6379'] }}
          SESSION_SECRET: ci-only-session-secret-not-a-real-value-0123456789
          RATE_LIMIT_DISABLED: "true"
```

Added `RATE_LIMIT_DISABLED: "true"` to the existing `env:` map of the `npm test` step in the `check` job. The `audit` job was not touched.

`RATE_LIMIT_DISABLED` is a `z.stringbool()` with `default(false)` in `apps/api/src/config.ts:46`. `security.ts:48` evaluates `rateLimitOn = !app.config.RATE_LIMIT_DISABLED && app.config.NODE_ENV !== "test"` — setting this var to `"true"` makes `rateLimitOn = false`, disabling rate-limit enforcement for all test-file `app.inject()` calls that share `req.ip = "127.0.0.1"`.

---

## FIX B — Correct stale-baseline assertion in catalog.route.test.ts

Root cause: `listAfter` was captured BEFORE `addRes2` (the `POST .../items` for item2), but `addItem` always bumps `shopping_lists.updated_at`. The assertion compared `listAfterAmbig.updatedAt` (post-ambiguous-canonicalize) against `listAfter.updatedAt` (pre-addItem), which are legitimately different — the service is correct.

### Before (`catalog.route.test.ts` ~lines 555–575):
```typescript
  // Capture catalog_items count before ambiguous canonicalize (AC4).
  const ambigCountBefore = (
    await app.db.select({ id: catalogItems.id }).from(catalogItems).where(eq(catalogItems.userId, userId))
  ).length;

  const ambigRes = await app.inject({
    ...
  });
  ...
  // List updatedAt must be unchanged on ambiguous (still equal to the post-match value).
  const listAfterAmbig = JSON.parse(
    (await app.inject({ method: "GET", url: `/api/shopping/lists/${list.id}`, cookies })).body,
  ) as { updatedAt: string };
  assert.equal(listAfterAmbig.updatedAt, listAfter.updatedAt, "list updatedAt unchanged on ambiguous");
```

### After (`catalog.route.test.ts` ~lines 555–582):
```typescript
  // Re-capture list updatedAt AFTER addRes2 (which legitimately bumps it) and
  // BEFORE the ambiguous canonicalize, so the assertion proves that canonicalize
  // itself does not bump the list.
  const listBeforeAmbig = JSON.parse(
    (await app.inject({ method: "GET", url: `/api/shopping/lists/${list.id}`, cookies })).body,
  ) as { updatedAt: string };

  // Capture catalog_items count before ambiguous canonicalize (AC4).
  const ambigCountBefore = (
    await app.db.select({ id: catalogItems.id }).from(catalogItems).where(eq(catalogItems.userId, userId))
  ).length;

  const ambigRes = await app.inject({
    ...
  });
  ...
  // List updatedAt must be unchanged on ambiguous (still equal to the pre-ambiguous value).
  const listAfterAmbig = JSON.parse(
    (await app.inject({ method: "GET", url: `/api/shopping/lists/${list.id}`, cookies })).body,
  ) as { updatedAt: string };
  assert.equal(listAfterAmbig.updatedAt, listBeforeAmbig.updatedAt, "list updatedAt unchanged on ambiguous");
```

The assertion now compares the post-ambiguous-canonicalize `updatedAt` against a fresh baseline captured immediately after `addRes2` and immediately before the `canonicalize` call, correctly isolating the canonicalize step.

---

## Commands run

```
npm run typecheck
```
Output:
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
Exit code: 0

```
npm run lint
```
Output:
```
> compass@0.1.0 lint
> eslint .
```
Exit code: 0

```
python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/ci.yml')); print('yaml-ok')"
```
Output: `yaml-ok`  
Exit code: 0

```
git status --porcelain && git diff --stat
```
Output:
```
M .github/workflows/ci.yml
 M apps/api/src/modules/shopping/routes/catalog.route.test.ts
 M tasks/066-catalog-canonicalization/TASK.md
?? tasks/065-test-ci-agents/
?? tasks/066-catalog-canonicalization/investigation-2.md
?? tasks/066-catalog-canonicalization/investigation-3.md
?? tasks/068-photo-capture/ci-2.txt
 .github/workflows/ci.yml                                   |  1 +
 apps/api/src/modules/shopping/routes/catalog.route.test.ts | 11 +++++++++--
 tasks/066-catalog-canonicalization/TASK.md                 |  9 +++++++++
 3 files changed, 19 insertions(+), 2 deletions(-)
```
Exit code: 0

Note: `tasks/066-catalog-canonicalization/TASK.md` is a pre-existing unstaged modification (it was already modified before this task began, recording the PR #200 CI failure status). Only `.github/workflows/ci.yml` and `apps/api/src/modules/shopping/routes/catalog.route.test.ts` were changed by this implementation.

---

## Assumptions

- `catalog.route.test.ts` is DB-gated and was not run locally (no DATABASE_URL) — consistent with the brief.
- `TASK.md` modification is pre-existing, not introduced by this task.

## Unresolved risks

None. Both fixes are minimal and targeted:
- FIX A: single env var addition to an existing map; YAML validated; audit job untouched.
- FIX B: one new GET inject + baseline variable; assertion strengthened (not weakened), now correctly isolates canonicalize-on-ambiguous as the cause under test.
