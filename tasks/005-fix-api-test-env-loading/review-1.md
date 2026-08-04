## Review outcome

No blocking issues found. The proposed one-line change is correct, safe for CI, and appropriately minimal for the stated objective.

### Verified findings

- [apps/api/package.json](/home/udai/PennyPilot/apps/api/package.json) contains the proposed current test script and uses the exact `--env-file-if-exists=../../.env` flag/path in every environment-dependent sibling script. Because npm executes workspace scripts with `apps/api` as the working directory, `../../.env` correctly resolves to the repository-root `.env`.

- [.github/workflows/ci.yml](/home/udai/PennyPilot/.github/workflows/ci.yml) sets `DATABASE_URL`, `REDIS_URL`, and `SESSION_SECRET` directly on the `npm test` step. Therefore those CI values remain authoritative.

- Node v24 documentation explicitly states that env-file paths are relative to the current directory and that when a variable exists in both the process environment and the file, the process environment wins. It also states that `--env-file-if-exists` has the same behavior as `--env-file`, except a missing file is not an error. The flag became non-experimental in Node v24.10.0, so it is stable on the installed v24.18.0. [Node.js v24 CLI documentation](https://nodejs.org/docs/latest-v24.x/api/cli.html#--env-filefile)

- The flag itself does not print `.env` contents, so it does not introduce credential logging. CI normally has no tracked root `.env`, and even if one were present, the three explicitly configured CI values would not be overridden. An untracked `.env` could supply other unset variables, but that is inherent to the intended local-env-loading behavior and is not a blocker.

- Automatically targeting the root `.env` means a bare local API test run will mutate the configured development database. Inspection confirms the database-backed tests create uniquely identified throwaway users/data and clean them up; the dangerous full-database restore path is explicitly not exercised. This is consistent with the repository’s documented shared-development-database testing model.

- Restricting the change to `apps/api` is reasonable because the acceptance criterion specifically targets `npm run test -w apps/api`. However, `apps/extractor/src/statement-duplicate.test.ts` also requires a real `DATABASE_URL`, so a bare root-level `npm test` without exported variables can still fail after this API-only fix. That deserves a separate follow-up if root-level local testing is expected to work without manual exports; it does not block this task.

### Minor plan correction

The plan repeatedly says “six sibling scripts,” but there are actually seven: `dev`, `start`, `db:generate`, `db:migrate`, `db:seed`, `db:bootstrap`, and `db:restore`. This is documentation-only and does not affect the proposed implementation.

Subject to correcting that count if desired, the plan looks correct, safe, and appropriately scoped.