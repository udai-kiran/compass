# Staging report — 012-release-checkpoint

## Step 1 — branch

```
$ git branch --show-current
main
```

```
$ git switch -c refactor/module-migration-phase1-ledger-credit-investments
Switched to a new branch 'refactor/module-migration-phase1-ledger-credit-investments'
```

## Step 2 — guard check before touching .gitignore

```
$ git ls-files '*.pdf'
(empty output)

$ git ls-files 'Pasted image*'
(empty output)
```

Both empty — safe to proceed with the .gitignore append.

## Step 3 — append ignore patterns

Appended two lines to the end of `/home/udai/PennyPilot/.gitignore` (all prior content preserved exactly):

```
*.pdf
Pasted image*
```

Full resulting file (`\cat .gitignore`):

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
*.pdf
Pasted image*
```

Confirm root statement PDF now ignored via committed file:

```
$ git status --porcelain | grep -c pdf
0
```

(0 matches — the previously-untracked root PDF no longer shows up in `git status --porcelain` output, confirming it is now ignored.)

## Step 4 — stage dependency fix alone

```
$ git add package-lock.json
$ git status --porcelain --untracked-files=no | head -5
 M .gitignore
 M apps/api/src/app.route-snapshot.test.ts
 M apps/api/src/app.ts
 M apps/api/src/db/bootstrap.ts
 M apps/api/src/db/seed.ts
```

(Note: this `head -5` is unfiltered `git status --porcelain` output — the first 5 lines are all still-unstaged `M` entries; `package-lock.json`'s staged `M ` line appears further down in the full listing, see Step 7.)

## Step 5 — diff of staged set

```
$ git diff --cached --stat
 package-lock.json | 44 ++++++++++++++++++++++----------------------
 1 file changed, 22 insertions(+), 22 deletions(-)
```

Only `package-lock.json` is staged. No stop condition triggered.

## Step 6 — dry-run against commit-filelist.txt (no staging performed)

```
$ git add --dry-run --pathspec-from-file=tasks/012-release-checkpoint/commit-filelist.txt --verbose 2>&1 | tail -40
add 'apps/api/src/modules/ledger/services/transaction-links.ts'
add 'apps/api/src/modules/ledger/services/transactions.test.ts'
add 'apps/api/src/modules/ledger/services/transactions.ts'
add 'apps/api/src/modules/ledger/services/transfers.test.ts'
add 'apps/api/src/modules/ledger/services/transfers.ts'
add 'apps/api/src/modules/ledger/services/user-tasks.test.ts'
add 'apps/api/src/modules/ledger/services/user-tasks.ts'
add 'apps/api/src/route-surface.snapshot.txt'
add 'tasks/007-migrate-ledger/DELEGATION.md'
add 'tasks/007-migrate-ledger/TASK.md'
add 'tasks/007-migrate-ledger/implementation-1.md'
add 'tasks/007-migrate-ledger/investigation-1.md'
add 'tasks/007-migrate-ledger/review-1.md'
add 'tasks/007-migrate-ledger/review-2.md'
add 'tasks/007-migrate-ledger/review-3.md'
add 'tasks/007-migrate-ledger/review-4.md'
add 'tasks/007-migrate-ledger/verification-1.md'
add 'tasks/008-migrate-credit/DELEGATION.md'
add 'tasks/008-migrate-credit/TASK.md'
add 'tasks/008-migrate-credit/implementation-1.md'
add 'tasks/008-migrate-credit/investigation-1.md'
add 'tasks/008-migrate-credit/review-1.md'
add 'tasks/008-migrate-credit/review-2.md'
add 'tasks/008-migrate-credit/review-3.md'
add 'tasks/008-migrate-credit/verification-1.md'
add 'tasks/009-claude-md-schema-ownership-note/DELEGATION.md'
add 'tasks/009-claude-md-schema-ownership-note/TASK.md'
add 'tasks/009-claude-md-schema-ownership-note/review-1.md'
add 'tasks/010-migrate-investments/DELEGATION.md'
add 'tasks/010-migrate-investments/TASK.md'
add 'tasks/010-migrate-investments/implementation-1.md'
add 'tasks/010-migrate-investments/investigation-1.md'
add 'tasks/010-migrate-investments/investigation-2.md'
add 'tasks/010-migrate-investments/review-1.md'
add 'tasks/010-migrate-investments/review-2.md'
add 'tasks/010-migrate-investments/review-3.md'
add 'tasks/010-migrate-investments/verification-1.md'
add 'tasks/011-migrate-protection/TASK.md'
add 'tasks/011-migrate-protection/investigation-1.md'
add 'tasks/011-migrate-protection/review-1.md'
```

Total line count of the dry run:

```
$ git add --dry-run --pathspec-from-file=tasks/012-release-checkpoint/commit-filelist.txt --verbose 2>&1 | wc -l
230
```

No files from this pathspec were actually staged — this was a dry run only. Only `package-lock.json` remains staged (per Step 5).

## Step 7 — full current `git status --porcelain` (unstaged remainder, informational only, not acted on)

```
$ git status --porcelain
 M .gitignore
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
M  package-lock.json
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
?? tasks/012-release-checkpoint/
```

Only `package-lock.json` is staged (`M ` in index column). All other files remain unstaged/untracked, as instructed — no further staging was performed.
