# Release Report — tasks 087–089

## Preflight

**git status --porcelain:** 13 modified tracked + 1 modified task file + untracked new code (37 files across migrations, libs, services, routes, tests, new tax module, task dirs)

**git remote -v:**
- origin fetch: https://github.com/udai-kiran/PennyPilot.git
- origin push: https://github.com/udai-kiran/PennyPilot.git

**git branch -vv:**
- feat/082-083-receipt-cart-review [origin/feat/082-083-receipt-cart-review] a4b0cf6 (pre-commit)
- main [origin/main] ae660f1 (at v3.6.0)

**git tag --list 'v3.*' --sort=-v:refname | head -5:**
- v3.7.0, v3.6.0, v3.5.0, v3.4.0, v3.3.0

**git log --oneline --decorate -3:**
- a4b0cf6 (HEAD → feat/082-083-receipt-cart-review, origin/feat/082-083-receipt-cart-review) feat(shopping): receipt loop and cart review UI (tasks 082-083)
- ae660f1 (tag: v3.6.0, origin/main, origin/HEAD, main) feat(shopping): Phase 11-12 pantry, predictive cart, guards & UI (tasks 077-081) (#202)
- 9cb19ce (tag: v3.5.0) Merge pull request #201 from udai-kiran/feat/shopping-deals-phase-10

## Staged Files

**Count:** 37 added (A) + 12 modified (M) = 49 total

**Modified tracked (12):**
- apps/api/drizzle/meta/_journal.json
- apps/api/src/app.ts
- apps/api/src/db/schema.decomposition.test.ts
- apps/api/src/db/schema.ts
- apps/api/src/modules/investments/plugin.ts
- apps/api/src/modules/investments/schema.ts
- apps/api/src/modules/investments/services/capital-gains.ts
- apps/api/src/modules/system/services/backup.ts
- apps/api/src/route-surface.snapshot.txt
- apps/api/src/route-table.snapshot.txt
- packages/shared/src/index.ts
- packages/shared/src/schemas/wealth.ts

**Untracked new code (25 files):**
- apps/api/drizzle/0012_simple_nightshade.sql
- apps/api/drizzle/meta/0012_snapshot.json
- apps/api/drizzle/0013_same_angel.sql
- apps/api/drizzle/meta/0013_snapshot.json
- apps/api/src/lib/financial-year.ts
- apps/api/src/lib/financial-year.test.ts
- apps/api/src/lib/tax-rules.ts
- apps/api/src/lib/tax-rules.test.ts
- apps/api/src/modules/investments/routes/deposit-details.ts
- apps/api/src/modules/investments/services/deposit-accrual.ts
- apps/api/src/modules/investments/services/deposit-accrual.test.ts
- apps/api/src/modules/investments/services/deposit-details.ts
- apps/api/src/modules/investments/services/deposit-details.test.ts
- apps/api/src/modules/tax/schema.ts
- apps/api/src/modules/tax/plugin.ts
- apps/api/src/modules/tax/routes/regime-preference.ts
- apps/api/src/modules/tax/routes/regime-preference.hermetic.test.ts
- apps/api/src/modules/tax/services/regime-preference.ts
- apps/api/src/modules/tax/services/regime-preference.test.ts
- packages/shared/src/schemas/tax.ts

**Task dirs (2, full contents staged):**
- tasks/087-tax-rule-data/ (14 files: TASK.md, DELEGATION.md, 13 implementation/review/verification/fix docs)
- tasks/089-fixed-income-instruments/ (14 files: TASK.md, DELEGATION.md, 13 implementation/review/verification/fix docs)

**Unstaged (deliberately):**
- packages/shared/src/schemas/wealth.test.ts (not in commit list)
- tasks/082-receipt-loop/DELEGATION.md (not in commit list)
- AGENTS.md, tasks/065–086/*, and other untracked artifacts (not staged)

## Commit

**Hash:** 07e0898958d79a2527baabf3c4aa4183d8fd97fb

**Message:**
```
feat(tax): FY tax-rule data, regime preference & fixed-income deposits (tasks 087, 089)

13.1: effective-dated income-tax rules FY 2023-24..2026-27 (both regimes,
ordinary/senior/super-senior), deduction-cap matrix incl. employer-rate 80CCD(2),
advance-tax schedule; GET/PUT /api/tax/regime-preference via atomic upserts;
enum-typed persistence (migrations 0012+0013).
13.3: deposit_details for FD/RD/NSC/tax-saver FD with computed-on-demand
accrual schedules; exact BigInt interest AND balance arithmetic (half-up per
period); GET/PUT /api/holdings/:id/deposit(+ /schedule).

Co-Authored-By: Claude <noreply@anthropic.com>
```

## Version Derivation

- **Current:** v3.6.0 is at ae660f1 (main)
- **Available remote tags:** v3.7.0, v3.6.0, v3.5.0, v3.4.0, v3.3.0, ...
- **Initial derivation attempt:** v3.7.0 (v3.6.0 + 1 minor) → rejected (already exists in remote)
- **Correction:** v3.8.0 (v3.7.0 + 1 minor)
- **Versioning model:** Host-side only (COMPASS_VERSION in ~/infra/.env); package.json all remain 0.1.0

## Release

**Tag:** v3.8.0

**Message:** `Tax intelligence begins: FY tax rules & regime preference; fixed-income deposit instruments (tasks 087, 089)`

**Push results:**
- Branch push: ✓ `feat/082-083-receipt-cart-review` (a4b0cf6 → 07e0898)
- Tag push: ✓ `v3.8.0` (new tag)

**Exit codes:** 0 (branch), 0 (tag)

**Errors:** None (v3.7.0 pre-existed, recovered with v3.8.0)

