# CI Failure — run 31581529948

## Which job/step failed

- **Job:** `publish (web)` (job ID 94065473045)
- **Step:** `Run docker/build-push-action@v6`
- **Dockerfile line:** 18 — `RUN npm run typecheck -w apps/web && npm run build -w apps/web`

## Exact error messages

```
src/routes/settings/AccountDetailPage.tsx(308,10): error TS2393: Duplicate function implementation.
src/routes/settings/AccountDetailPage.tsx(439,10): error TS2393: Duplicate function implementation.
```

npm exit code: 2  
Lifecycle script `typecheck` failed (command: `tsc --noEmit`)

Final buildx error:
```
ERROR: failed to build: failed to solve: process "/bin/sh -c npm run typecheck -w apps/web && npm run build -w apps/web" did not complete successfully: exit code: 2
```

## Files and line numbers

| File | Line | Error |
|------|------|-------|
| `apps/web/src/routes/settings/AccountDetailPage.tsx` | 308 | TS2393: Duplicate function implementation |
| `apps/web/src/routes/settings/AccountDetailPage.tsx` | 439 | TS2393: Duplicate function implementation |

## Full relevant log excerpt

```
#21 [build 12/14] RUN npm run typecheck -w apps/web && npm run build -w apps/web
#21 0.188
#21 0.188 > @compass/web@0.1.0 typecheck
#21 0.188 > tsc --noEmit
#21 0.188
#21 13.18 src/routes/settings/AccountDetailPage.tsx(308,10): error TS2393: Duplicate function implementation.
#21 13.18 src/routes/settings/AccountDetailPage.tsx(439,10): error TS2393: Duplicate function implementation.
#21 13.24 npm error Lifecycle script `typecheck` failed with error:
#21 13.24 npm error code 2
#21 13.25 npm error path /app/apps/web
#21 13.25 npm error workspace @compass/web@0.1.0
#21 13.25 npm error location /app/apps/web
#21 13.25 npm error command failed
#21 13.25 npm error command sh -c tsc --noEmit
#21 ERROR: process "/bin/sh -c npm run typecheck -w apps/web && npm run build -w apps/web" did not complete successfully: exit code: 2
------
 > [build 12/14] RUN npm run typecheck -w apps/web && npm run build -w apps/web:
0.188
13.18 src/routes/settings/AccountDetailPage.tsx(308,10): error TS2393: Duplicate function implementation.
13.18 src/routes/settings/AccountDetailPage.tsx(439,10): error TS2393: Duplicate function implementation.
13.24 npm error Lifecycle script `typecheck` failed with error:
13.24 npm error code 2
13.25 npm error path /app/apps/web
13.25 npm error workspace @compass/web@0.1.0
13.25 npm error location /app/apps/web
13.25 npm error command failed
13.25 npm error command sh -c tsc --noEmit
------
Dockerfile:18
--------------------
  16 |     ARG BUILD_TIME=
  17 |     ENV APP_VERSION=$APP_VERSION GIT_SHA=$GIT_SHA BUILD_TIME=$BUILD_TIME
  18 | >>> RUN npm run typecheck -w apps/web && npm run build -w apps/web
  19 |     # Docs are copied after the web build so a docs-only edit doesn't invalidate it.
  20 |     # They ship inside the same image, served at /docs/ by Caddy.
--------------------
ERROR: failed to build: failed to solve: process "/bin/sh -c npm run typecheck -w apps/web && npm run build -w apps/web" did not complete successfully: exit code: 2
##[error]buildx failed with: ERROR: failed to build: failed to solve: process "/bin/sh -c npm run typecheck -w apps/web && npm run build -w apps/web" did not complete successfully: exit code: 2
```

## Context

- All other jobs (`publish (api)`, `publish (ingestor)`, `publish (extractor)`) passed.
- This failure is in the web Docker build only.
- TS2393 ("Duplicate function implementation") means the same function name was declared/implemented twice in `AccountDetailPage.tsx`, at lines 308 and 439.
- The EPF opening balance save feature (task 038) is the likely source — a new handler function was probably added without removing or de-duplicating an existing one with the same name.
