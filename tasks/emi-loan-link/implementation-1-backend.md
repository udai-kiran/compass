All checks pass. Both required files contain exactly the specified content, typecheck exits 0, and I touched no other files (the other working-tree entries were pre-existing and left untouched).

---

## Implementation Report

### 1. Files modified

- **`apps/api/src/modules/credit/services/emis.ts`** (modified)
- **`apps/api/src/modules/credit/routes/emis.ts`** (modified)

No files were created or deleted.

### 2. Summary of each change

**`apps/api/src/modules/credit/services/emis.ts`**
- Appended the `getEmiDetail` service helper at the very end of the file, after the closing brace of `getEmiInterestEstimateForFy`. It performs a read-only `db.query.emiDetails.findFirst` probe scoped by both `templateId` and `userId` (ownership enforced), returns the stored `principalPaise`, `annualRateBps`, `totalInstallments`, and `startDate` fields, and throws `HttpError(404, "EMI not found")` when no row matches. This lets the loan-account PATCH route supply the unchanged schedule fields to `upsertEmiDetails` without the caller echoing them back.

**`apps/api/src/modules/credit/routes/emis.ts`**
- Step A: updated the services import from `import { createEmi, deleteEmi, listEmiInstallments, listEmis } from "../services/emis.ts";` to `import { createEmi, deleteEmi, getEmiDetail, listEmiInstallments, listEmis, upsertEmiDetails } from "../services/emis.ts";` (adds `getEmiDetail` and `upsertEmiDetails`).
- Step B: added the `PATCH /api/emis/:templateId/loan-account` route just before the closing `}` of `emiRoutes`, after the existing GET installments handler. It validates `params` with the existing `IdParams` and a body of `z.object({ loanAccountId: z.uuid().nullable() })`, responds `200` with `EmiSummarySchema`, calls `getEmiDetail` to fetch the unchanged fields, merges them with `loanAccountId` from the request body into `upsertEmiDetails`, invalidates the user cache via `invalidateUserCache(app.redis, req.session!.userId)`, and returns the updated `EmiSummary`.

### 3. Commands run and output

- `npm run typecheck -w apps/api` → `> @compass/api@0.1.0 typecheck` / `> tsc --noEmit`, exit code **0** (no TS errors).
- `git status --porcelain` → confirms only the two intended files were modified by me: `apps/api/src/modules/credit/routes/emis.ts` and `apps/api/src/modules/credit/services/emis.ts`. The other listed entries (`.claude/agents/coordinator.md`, `.claude/agents/sonnet-worker.md`, untracked `.omo/`, `AGENTS.md`, `tasks/events-retry-fix/`, `tasks/navall-parser-fix/`) were already present in the working tree before this task and were left undisturbed.

### 4. Issues, risks, deviations

- **No deviations.** Only the two listed files were changed; no imports beyond those specified were added (all were already present or newly required); no schema, migrations, tests, or other files were touched; no `git add` or commit was performed.
- **Compatibility verified:** the `getEmiDetail` return shape plus `loanAccountId` is structurally compatible with `UpsertEmiDetails` (`z.input<typeof UpsertEmiDetailsSchema>`, whose `loanAccountId` field is `.default(null)` — optional in the input type), confirmed by the passing typecheck and by inspection of `packages/shared/src/schemas/wealth.ts`.
- **Pre-existing working-tree changes** (`.claude/agents/*`, `AGENTS.md`, `.omo/`, `tasks/events-retry-fix/`, `tasks/navall-parser-fix/`) are unrelated to this task and remain untouched, as instructed.
