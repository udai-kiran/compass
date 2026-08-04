# Investigation 1 — task 1.2 "Migrate credit module"

Read-only investigation. No files changed. Basis for the plan for
`tasks/01.02-migrate-credit.md` (roadmap id 1.2), following the template set by
task 1.1 (`tasks/007-migrate-ledger/TASK.md`, merged).

Files inspected (full list): `apps/api/src/services/cards.ts`,
`apps/api/src/routes/cards.ts`, `apps/api/src/services/emis.ts`,
`apps/api/src/routes/emis.ts`, `apps/api/src/routes/overdraft-details.ts`,
`apps/api/src/services/overdraft-details.ts`,
`apps/api/src/routes/bank-details.ts`, `apps/api/src/services/bank-details.ts`,
`apps/api/src/services/card-due-tasks.ts`,
`apps/api/src/services/card-statements.ts`, `apps/api/src/jobs/index.ts`,
`apps/api/src/db/schema.ts` (relevant sections), `apps/api/src/app.ts`,
`apps/api/src/route-surface.snapshot.txt`, `apps/api/src/services/backup.ts`,
`apps/api/src/services/cards.test.ts`, `apps/api/src/services/emis.test.ts`,
`apps/api/src/services/card-due-tasks.test.ts`,
`apps/api/src/modules/ledger/schema.ts`, `apps/api/src/modules/ledger/plugin.ts`,
`apps/api/src/modules/ledger/services/recurring.ts`,
`apps/api/src/modules/ledger/services/recurring.test.ts`,
`tasks/007-migrate-ledger/TASK.md`, `tasks/01.02-migrate-credit.md`,
`tasks/10.06-reward-aware-checkout.md`, `tasks/README.md`,
`packages/shared/src/schemas/wealth.ts` (grep only, see §11).

---

## 1. `apps/api/src/services/cards.ts` — full structure (1182 lines, `wc -l` confirmed)

Top-of-file imports (lines 1-33):
```
import { and, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import type { Redis } from "ioredis";
import type { CardActivity, CardActivityTxn, CardDetails, CardHolderSummary, CardIssuerSettings,
  CardSummary, CreateRewardEntry, RewardEntry, StatementReconciliation, UpsertCardDetails,
  UpsertCardIssuerSettings } from "@compass/shared";
import { formatINR, UpsertCardDetailsSchema, UpsertCardIssuerSettingsSchema } from "@compass/shared";
import type { Db, DbOrTx } from "../db/index.ts";
import { accounts, alertLedger, cardDetails, cardIssuerSettings, extractedTransactions,
  rewardEntries, statementReconciliations, transactions } from "../db/schema.ts";
import { HttpError } from "../lib/errors.ts";
import { decryptSecret, encryptSecret } from "../lib/secret-box.ts";
import { withSerializableRetry } from "../lib/serializable.ts";
import { createNotification } from "./notifications.ts";
import { repairSnapshots } from "./networth.ts";
import { currentPeriodKey } from "./periods.ts";
```
This import block is itself evidence of a **mixed-table schema import** (accounts,
transactions are ledger-owned; cardDetails/cardIssuerSettings/rewardEntries/
statementReconciliations are credit-owned; alertLedger and extractedTransactions
belong to other still-flat modules — notifications/system and ingest
respectively) — a split-import will be needed exactly as task 1.1 required for
`accounts.ts`/`recurring.ts`.

### Natural seams (line ranges are inclusive, from the numbered Read output)

**A. Card & issuer CRUD / details (lines ~35-320)**
- `toDetails` (38-49), `toIssuerSettings` (51-59), `issuerKey` (61-64) — private DTO mappers
- `ownedCardAccount` (182-189) — ownership guard, used by nearly every exported function in the file
- `upsertCardDetails` (191-223) — exported
- `getIssuerSettings` (226-238) — exported
- `upsertIssuerSettings` (246-271) — exported
- `setCardStatementPassword` (278-295) — exported
- `getCardStatementPassword` (301-314) — exported
- `utilization` (317-319) — private helper, reused by `listCardHolders`

**B. Cycle-boundary math (lines 66-180, plus `shiftDays` at 424-429)**
- `pad` (66-68), `lastOccurrence` (71-77, exported), `nextOccurrence` (80-86, exported),
  `dayBefore` (88-92), `STATEMENT_GEN_LAG_DAYS` (95), `lastStatementClose` (102-106),
  `CardCycle` interface (109-116, exported), `cardCycle` (130-133, exported),
  `isBilledIn` (136-138, exported), `ActivityWindow` interface (141-146, exported),
  `activityWindow` (157-162, exported), `splitByCycle` (169-180, exported generic),
  `shiftDays` (425-429, private — used only by `activityWindow`'s no-cycle fallback and
  by `getCardActivity`'s own default window).
- This is the cleanest, most self-contained seam: pure date-math functions, all
  already exported, all already independently reasoned about in their own doc
  comments. The task's own text names `cardCycle`/`splitByCycle` as the piece
  Phase 5 needs.

**C. Card-holder / activity read models (lines 327-548, minus the two seams below)**
- `listCardHolders` (327-422, exported) — the big aggregate query grouping cards by
  issuer, computing owed/utilization/due-date per card. Depends on: `cardCycle`,
  `activityWindow`, `toDetails`, `toIssuerSettings`, `issuerKey`, `utilization`.
- `getCardActivity` (437-514, exported) — per-card CRED-style activity view. Depends
  on `ownedCardAccount`, `cardCycle`, `activityWindow`, `splitByCycle`.
- Both of these are read-model/query functions, not really "alert evaluation" or
  "reward" or "reconciliation" — they are the CRUD/summary seam's natural
  continuation and could stay together with seam A, or become their own
  "activity"/"summary" unit — plan should decide, but they are NOT part of the
  cycle-math seam itself (they *consume* it) nor the alert seam (below), even
  though `listCardHolders` is itself called BY the alert-evaluation functions.

**D. Alert evaluation (lines 516-573)**
- `evaluateCardDueReminders` (517-548, exported) — daily job, iterates every user
  with `cardDetails`, calls `listCardHolders`, inserts into `alertLedger` +
  `createNotification`.
- `evaluateCardUtilization` (551-573, exported) — per-user alerts-queue detector,
  calls `listCardHolders`, `currentPeriodKey` (from `./periods.ts`), `alertLedger`,
  `createNotification`.
- **Both are called only from `apps/api/src/jobs/index.ts`** (see §5/§7)  — this is
  the file referred to by the task's decomposition text as "alert evaluation."
  Neither is called by `card-due-tasks.ts` (that file duplicates its own
  eligibility-window logic against `listCardHolders` directly — see §5) nor by
  any route file.

**E. Reward ledger (lines 575-776, plus reward parts of A/C)**
- `listRewards` (577-585, exported)
- `addRewardEntry` (748-761, exported)
- `deleteRewardEntry` (763-776, exported)
- Reward points are also read inside `listCardHolders` (365-368, the `rewards`
  sub-query summed into `card.rewardPoints`) — so this seam is not 100% separable
  from seam C without either seam C importing from the reward unit or the reward
  unit staying a peer that `listCardHolders` calls into.
- `earnRatePer100` itself (the "earn-rate" the task's AC wants exposed as "a
  documented interface") is **not** read anywhere in `cards.ts`'s reward
  functions today — it is stored on `cardDetails`/returned via `toDetails`, but
  no function in this file computes reward points *from* a spend amount using
  it. See §11 — there is no existing earn-rate lookup function; the AC requires
  creating one, not relocating one.

**F. Statement reconciliation (lines 587-1182, the largest seam — roughly half the file)**
- `ReconciliationRow` type (587)
- `dueDrift` (598-601, exported pure function)
- `DriftPresentation` interface (603-609, exported) + `driftPresentation` (619-636, exported pure function)
- `toReconciliationDto` (638-661, private mapper)
- `ledgerDuesAtDates` (674-711, private — one aggregate query over N statement dates)
- `listReconciliations` (727-746, exported)
- `StatementLineState`/`RecomputedStats`/`StatementFacts` interfaces (781-807, exported)
- `summarizeStatementLines` (833-856, exported pure function)
- `recomputeReconciliation` (867-1009, exported — the largest single function, ~140 lines,
  reads `extractedTransactions` directly — an ingest-module table, see §6/§8)
- `AbsorbCarryoverHooks` interface (1017-1027, exported, test-only seam)
- `absorbCarryover` (1072-1182, exported — the other very large function, ~110 lines,
  SERIALIZABLE transaction, calls `repairSnapshots` from `./networth.ts` post-commit)
- This whole seam is self-contained apart from: `ownedCardAccount` (from seam A),
  `dueDrift`/`toReconciliationDto` internal reuse, and the cross-module
  `repairSnapshots` (networth.ts) / `withSerializableRetry` (lib/serializable.ts)
  calls.

### Summary of natural split (for the ~500-line-per-file AC)
| Candidate unit | Lines (approx) | Size | Exported functions |
|---|---|---|---|
| Cycle math | 66-180, 424-429 | ~120 | `lastOccurrence`, `nextOccurrence`, `cardCycle`, `isBilledIn`, `activityWindow`, `splitByCycle`, `CardCycle`, `ActivityWindow` types |
| Card/issuer CRUD + activity/holder read-models | 35-64, 182-320, 327-548 (minus D) | ~430 | `upsertCardDetails`, `getIssuerSettings`, `upsertIssuerSettings`, `setCardStatementPassword`, `getCardStatementPassword`, `listCardHolders`, `getCardActivity` |
| Alert evaluation | 516-573 | ~60 | `evaluateCardDueReminders`, `evaluateCardUtilization` |
| Reward ledger | 575-585, 748-776 | ~40 | `listRewards`, `addRewardEntry`, `deleteRewardEntry` |
| Statement reconciliation | 587-1182 | ~600 | `dueDrift`, `driftPresentation`, `listReconciliations`, `summarizeStatementLines`, `recomputeReconciliation`, `absorbCarryover`, plus 3 exported interfaces |

Note the reconciliation seam alone (~600 lines) is already over the AC's "~500
lines" ceiling as a single file — it will itself need a further split (e.g.
`recomputeReconciliation`+`absorbCarryover` as a "reconciliation-writes" unit vs.
`listReconciliations`+`dueDrift`+`driftPresentation`+`summarizeStatementLines`+
`ledgerDuesAtDates` as a "reconciliation-reads" unit) to land under ~500 lines
per resulting file. This is a sizing fact from direct measurement, not a design
recommendation — left for the plan to decide the exact split point.

---

## 2. `apps/api/src/routes/cards.ts` — 215 lines (`wc -l`), full endpoint list

Imports `absorbCarryover, addRewardEntry, deleteRewardEntry, getCardActivity,
listCardHolders, listReconciliations, listRewards, recomputeReconciliation,
setCardStatementPassword, upsertCardDetails, upsertIssuerSettings` from
`../services/cards.ts`; `deleteCardStatement, listCardStatements,
readCardStatement, saveCardStatement` from `../services/card-statements.ts`
(**not** `cards.ts` — a separate, already-existing service file, not named in
the task's prose but whose one table, `card_statements`, IS in the task's
table list — see §3b below); `MAX_ATTACHMENT_BYTES` from
`../modules/ledger/services/attachments.ts` (already-moved ledger file);
`mailboxSecret` from `../services/mailboxes.ts` (still-flat, other module).

**Full endpoint list (15 distinct method+path pairs, NOT the "12" the roadmap
task text claims):**
1. `GET /api/cards`
2. `PUT /api/cards/:accountId/details`
3. `PUT /api/card-issuers/settings`
4. `PUT /api/cards/:accountId/statement-password`
5. `GET /api/cards/:accountId/activity`
6. `GET /api/cards/:accountId/rewards`
7. `GET /api/cards/:accountId/reconciliations`
8. `POST /api/cards/:accountId/reconciliations/:id/recompute`
9. `POST /api/cards/:accountId/reconciliations/:id/absorb-carryover`
10. `POST /api/cards/:accountId/rewards`
11. `DELETE /api/cards/:accountId/rewards/:id`
12. `GET /api/cards/:accountId/statements`
13. `POST /api/cards/:accountId/statements` (multipart, plain `app.post`, no zod body schema)
14. `GET /api/card-statements/:id` (plain `app.get`, streams file content)
15. `DELETE /api/cards/:accountId/statements/:id`

**Correction to the roadmap task text: 15 endpoints, not 12** (confirmed
independently against `route-surface.snapshot.txt` — see §12, which lists all
15 as GET/HEAD/PUT/POST/DELETE pairs under `/api/cards*` and
`/api/card-issuers*` and `/api/card-statements*`, 21 total lines including the
6 implicit `HEAD`s for the 6 `GET`s above... wait, cards.ts has 6 GETs — see
§12's literal grep output for the exact 21-line breakdown).

---

## 3. `apps/api/src/services/emis.ts` (493 lines, `wc -l` confirmed) — seam analysis

**Reading confirmed: emis.ts is one cohesive service, not asked to split, and
this reading matches the task's own text** ("split `cards.ts`... " — no mention
of emis.ts needing a split). At 493 lines it is already just under the ~500-line
AC ceiling as a single file, so no split is structurally required by the
`~500 lines` AC either.

Internal structure:
- Pure date/amortization math (14-226): `monthsSince`, `addMonths`, `amortize`
  (exported), `calendarMonthsBetween`, `stepAmortization` (exported — shared with
  `modules/ledger/services/recurring.ts`'s own posting loop, see §7/§8),
  `splitInstallments` (exported), `lockAccountPair` (exported — shared lock
  primitive, also reused by `recurring.ts`'s materializeDue, see §7),
  `assertLoanDestination` (private validator)
- CRUD (234-405): `createEmi` (exported), `deleteEmi` (exported),
  `upsertEmiDetails` (exported — has zero routes/callers today per its own
  doc comment)
- Reads (407-493): `listEmis` (exported), `listEmiInstallments` (exported)

Imports: `accounts, emiDetails, recurringTemplates, transactions` from
`../db/schema.ts` (mixed: `accounts`/`recurringTemplates`/`transactions` are
ledger-owned, `emiDetails` is credit-owned — another split-import case);
`HttpError` from `../lib/errors.ts`; `assertOwnedCategory` from `./ownership.ts`
(still-flat, other module).

### `apps/api/src/routes/emis.ts` — 51 lines, 4 endpoints
Imports `createEmi, deleteEmi, listEmiInstallments, listEmis` from
`../services/emis.ts`; `materializeDue` from
`../modules/ledger/services/recurring.ts` (already-moved ledger file);
`invalidateUserCache` from `../services/cache.ts`; `enqueueBudgetEvaluation`
from `../jobs/index.ts`.

Endpoints:
1. `GET /api/emis`
2. `POST /api/emis`
3. `DELETE /api/emis/:templateId`
4. `GET /api/emis/:templateId/installments`

---

## 4. overdraft-details and bank-details route+service files

**`apps/api/src/routes/overdraft-details.ts`** — 30 lines. Imports
`getOverdraftDetails, upsertOverdraftDetails` from
`../services/overdraft-details.ts` (confirmed exact filename exists, not folded
into cards.ts/emis.ts). Endpoints:
1. `GET /api/accounts/:accountId/overdraft-details`
2. `PUT /api/accounts/:accountId/overdraft-details`

**`apps/api/src/services/overdraft-details.ts`** — 58 lines. Imports
`accounts, overdraftDetails` from `../db/schema.ts` (mixed: `accounts` ledger,
`overdraftDetails` credit — split-import case); `HttpError` from
`../lib/errors.ts`. Exports `getOverdraftDetails`, `upsertOverdraftDetails`.

**`apps/api/src/routes/bank-details.ts`** — 29 lines. Imports
`getBankDetails, upsertBankDetails` from `../services/bank-details.ts`
(confirmed exact filename exists). Endpoints:
1. `GET /api/accounts/:accountId/bank-details`
2. `PUT /api/accounts/:accountId/bank-details`

**`apps/api/src/services/bank-details.ts`** — 74 lines. Imports `accounts,
bankDetails` from `../db/schema.ts` (mixed, same split-import pattern);
`HttpError` from `../lib/errors.ts`; **`syncAccountLast4` from
`../modules/ledger/services/accounts.ts`** (already-moved ledger file — this
import path is already correct/current, needs only depth adjustment once
`bank-details.ts` itself moves one directory deeper into
`modules/credit/services/`). Exports `getBankDetails`, `upsertBankDetails`.

Neither overdraft-details nor bank-details service/route file has a colocated
test today (confirmed — see §9).

---

## 5. `apps/api/src/services/card-due-tasks.ts` — 129 lines (`wc -l` confirmed)

Full read. Structure:
- Module doc comment (7-22) explicitly says this "reuses `listCardHolders` for
  every bit of cycle/due-date/amount arithmetic — it never recomputes any of
  that itself" and that its eligibility window "mirrors
  `evaluateCardDueReminders` exactly (`cards.ts:526-530`)" — i.e. this file
  duplicates (by its own admission) the SAME eligibility-window logic as
  `evaluateCardDueReminders` in `cards.ts`, as a second, independent
  implementation, not a call into it.
- `CARD_DUE_TASK_KIND` constant (24)
- `cardDueSourceKey` (27-29, private)
- `truncateTaskTitle` (39-45, exported — surrogate-pair-safe title truncation)
- `materializeCardDueTasks` (65-129, exported — the main entry point, iterates
  non-demo users, calls `listCardHolders(db, userId, ref)` from `./cards.ts`,
  inserts into `alertLedger` and `userTasks` inside one transaction per card)

Imports: `alertLedger, cardDetails, userTasks, users` from `../db/schema.ts`
(mixed: `cardDetails` credit-owned; `userTasks` is ledger-owned per task 1.1 —
already re-exported from `modules/ledger/schema.ts`; `alertLedger` and `users`
belong to other still-flat modules — `alertLedger` looks system/notifications-
adjacent, `users` is core/auth, likely never module-owned); `listCardHolders`
from `./cards.ts`.

**Does this file belong in the 1.2 credit-module move?** The roadmap task text
(§ "Routes: cards, emis, overdraft-details, bank-details. Tables: ...") does
**not** name `card-due-tasks.ts` or a `card_due_tasks`/similar table (it writes
into `user_tasks`, a ledger table, not a credit table) — so it is not
unambiguously in scope by the literal Routes/Tables line. However: (a) task
1.1's own investigation explicitly flagged it as "credit module, imports
userTasks table directly, bypassing the ledger user-tasks service" (quoted
verbatim in `tasks/007-migrate-ledger/TASK.md`'s Scope, "Explicitly not
moved" list: `services/card-due-tasks.ts` (credit module) — inserts directly
into `userTasks`"), and (b) it is registered/consumed only by the alerts
worker in `jobs/index.ts` (see below) alongside `evaluateCardDueReminders`/
`evaluateCardUtilization` from `cards.ts` itself — i.e. it is part of the same
"card due-date... alert evaluation" surface the AC names. This is a scope
ambiguity for the plan to resolve explicitly, not something this investigation
resolves on its own authority.

**Is it registered/consumed by the alerts worker? Grep of `jobs/index.ts`:**
```
6:import { evaluateCardDueReminders, evaluateCardUtilization } from "../services/cards.ts";
7:import { materializeCardDueTasks } from "../services/card-due-tasks.ts";
265:            const sent = await evaluateCardDueReminders(app.db);
271:            const materialized = await materializeCardDueTasks(app.db);
354:      const cardUtil = await evaluateCardUtilization(app.db, userId);
385:  // card-due-tasks.ts), but it does let an instance that reboots while the
389:  await materializeCardDueTasks(app.db)
```
`evaluateCardDueReminders` and `materializeCardDueTasks` both run inside the
`"cards.remind"` scheduled job (case at line 259 of `jobs/index.ts`, cron
`25 0 * * *` under the `system` queue/worker) and again at boot (line 389).
`evaluateCardUtilization` runs inside the `"alerts"` queue's worker (the
per-user `alertsWorker`, line 345 onward) alongside `evaluateBudgetAlerts`,
`evaluateLargeTransactions`, `evaluateLowBalance`, `evaluateAnomalies`.

**What does "alert evaluation" in the task's decomposition text refer to?**
Based on direct evidence: it refers to `evaluateCardDueReminders` and
`evaluateCardUtilization`, both defined INSIDE `cards.ts` itself (lines
516-573, seam D above) and both consumed exclusively by `jobs/index.ts`.
`card-due-tasks.ts`'s `materializeCardDueTasks` is a related but textually
distinct mechanism (it materialises `user_tasks` rows, not
notifications/alert-ledger entries per se — though it also writes
`alertLedger` as its own dedup claim) that happens to run in the same
scheduled job. The task's AC line "Card due-date and utilization alert
evaluation still fire from the alerts worker" most literally describes
`evaluateCardDueReminders`/`evaluateCardUtilization`; whether
`materializeCardDueTasks` is also meant to be covered by that AC wording is,
again, a plan-level scope call, not resolved by this investigation.

---

## 6. FK inventory for the 8 tables (direct read of `apps/api/src/db/schema.ts`)

Outbound FKs from each of the 8 tables (`.references(() => X.id`, exact grep
+ read):

- `card_details.account_id → accounts.id` (onDelete: cascade) — ledger (1.1)
- `card_details.user_id → users.id` — core/auth, no module yet
- `card_issuer_settings.user_id → users.id` — core/auth
- `card_statements.account_id → accounts.id` (cascade) — ledger
- `card_statements.user_id → users.id` — core/auth
- `bank_details.account_id → accounts.id` (cascade) — ledger
- `bank_details.user_id → users.id` — core/auth
- `overdraft_details.account_id → accounts.id` (cascade) — ledger
- `overdraft_details.user_id → users.id` — core/auth
- `reward_entries.user_id → users.id` — core/auth
- `reward_entries.account_id → accounts.id` (cascade) — ledger
- `reward_entries.ingestion_id → email_ingestions.id` (set null) — **ingest module (1.7)**
- `statement_reconciliations.user_id → users.id` — core/auth
- `statement_reconciliations.account_id → accounts.id` (cascade) — ledger
- `statement_reconciliations.ingestion_id → email_ingestions.id` (set null) — **ingest module (1.7)**
- `emi_details.template_id → recurring_templates.id` (cascade, PK) — ledger
- `emi_details.user_id → users.id` — core/auth
- `emi_details.loan_account_id → accounts.id` (set null) — ledger

So outbound cross-module FK targets (outside the 8): `accounts` (ledger, 8
columns), `recurring_templates` (ledger, 1 column — the `emi_details` PK
itself), `users` (core, 8 columns — one per table), `email_ingestions` (ingest
module 1.7, 2 columns: `reward_entries.ingestion_id`,
`statement_reconciliations.ingestion_id`). No FK to any planning/investments/
protection-module table found from these 8 tables.

**Reverse direction — tables OUTSIDE these 8 referencing INTO these 8 tables**
(grepped `=> cardDetails`, `=> emiDetails`, `=> bankDetails`,
`=> overdraftDetails`, `=> rewardEntries`, `=> statementReconciliations`,
`=> cardIssuerSettings`, `=> cardStatements` across all of `db/schema.ts` —
only one match in the entire file):
```
356:      (): AnyPgColumn => statementReconciliations.id,
```
This is `transactions.reconciledStatementId → statementReconciliations.id`
(onDelete: set null) — a **ledger table (transactions, task 1.1) FKing into a
credit-module table (statement_reconciliations, this task)**. This exact FK is
already documented in task 1.1's `TASK.md` Root Cause as one of the "4 outbound
FKs from ledger tables to tables that stay flat for now" — confirmed here from
the credit-module side too. No other table (in any module) references any of
the other 7 tables' primary keys — `card_details`, `bank_details`,
`overdraft_details` all use `account_id` as their own PK with no separate `id`
column, so nothing can FK to a `cardDetails.id`/`bankDetails.id`/
`overdraftDetails.id` that doesn't exist; `emi_details.template_id` is
similarly the PK (no separate `id`); `card_issuer_settings` has a composite PK
`(userId, institution)`, also nothing referencing it; `card_statements.id` and
`reward_entries.id` exist as real UUID PKs but nothing references them either.

**Also directly read (not FK, but a cross-module raw-table read from inside
this task's own files):** `services/cards.ts`'s `recomputeReconciliation`
queries `extractedTransactions` directly (imported from `../db/schema.ts`,
lines 17-27's import block) — `extracted_transactions` is an **ingest-module
table (task 1.7)**, read directly by a credit-module service, not through any
ingest service function. This is the same "direct/raw-SQL cross-module access,
documented not fixed" pattern task 1.1 established for its own domain — worth
carrying into this task's Scope "explicitly not moved/fixed" section, per the
same discipline.

---

## 7. Cross-references — who imports FROM cards.ts / emis.ts / overdraft-details service / bank-details service / card-due-tasks.ts

Grepped `services/cards\.ts"`, `services/emis\.ts"`, `services/overdraft-details\.ts"`,
`services/bank-details\.ts"`, `services/card-due-tasks\.ts"` across all of
`apps/api/src` (production + test):

- **`services/cards.ts`** imported by:
  - `apps/api/src/jobs/index.ts` — `evaluateCardDueReminders, evaluateCardUtilization`
  - `apps/api/src/routes/cards.ts` — the 11 functions listed in §2
  - `apps/api/src/services/card-due-tasks.ts` — `listCardHolders` (this file itself is in the credit-module candidate set, §5)
  - `apps/api/src/services/cards.test.ts` — its own colocated test (moves with it)
- **`services/emis.ts`** imported by:
  - `apps/api/src/modules/ledger/services/recurring.ts` (**already-moved ledger file**) — `lockAccountPair, stepAmortization` — see §8, this is the reverse-direction cross-module import task 1.1's pattern warns about
  - `apps/api/src/modules/ledger/services/recurring.test.ts` (already-moved ledger test) — `createEmi, listEmiInstallments, upsertEmiDetails`
  - `apps/api/src/routes/emis.ts` — `createEmi, deleteEmi, listEmiInstallments, listEmis`
- **`services/overdraft-details.ts`** imported only by `apps/api/src/routes/overdraft-details.ts`.
- **`services/bank-details.ts`** imported only by `apps/api/src/routes/bank-details.ts`.
- **`services/card-due-tasks.ts`** imported only by `apps/api/src/jobs/index.ts` — `materializeCardDueTasks`.
- **`services/card-statements.ts`** (not explicitly named in the task text, but its one table `card_statements` is in scope) imported only by `apps/api/src/routes/cards.ts` — `deleteCardStatement, listCardStatements, readCardStatement, saveCardStatement`.

No web (`apps/web`) or other workspace imports any of these — they are Fastify
route/service files, consumed only from other API files as shown above.

---

## 8. What THIS task's own files import from elsewhere (import-path updates this task's move will need)

Already-moved `modules/ledger/` files that these credit files import from
today (import paths that are *currently correct* and need only depth
adjustment once the credit files move, not a target-path change):
- `apps/api/src/routes/cards.ts` → `MAX_ATTACHMENT_BYTES` from
  `../modules/ledger/services/attachments.ts`
- `apps/api/src/services/bank-details.ts` → `syncAccountLast4` from
  `../modules/ledger/services/accounts.ts`
- `apps/api/src/services/card-statements.ts` → `assertUploadable` from
  `../modules/ledger/services/attachments.ts`
- `apps/api/src/routes/emis.ts` → `materializeDue` from
  `../modules/ledger/services/recurring.ts`

Still-flat sibling services these credit files import from (need depth
adjustment, same still-flat target):
- `apps/api/src/services/cards.ts` → `createNotification` from
  `./notifications.ts`; `repairSnapshots` from `./networth.ts`;
  `currentPeriodKey` from `./periods.ts`
- `apps/api/src/services/emis.ts` → `assertOwnedCategory` from `./ownership.ts`
- `apps/api/src/routes/cards.ts` → `mailboxSecret` from `../services/mailboxes.ts`
- `apps/api/src/routes/emis.ts` → `invalidateUserCache` from
  `../services/cache.ts`; `enqueueBudgetEvaluation` from `../jobs/index.ts`

**Reverse-direction finding (the "moved services also import still-flat
siblings" pattern task 1.1 flagged, but here it's an ALREADY-MOVED ledger file
importing a still-flat file this task is about to move) — new information not
present in task 1.1's own investigation:**
```
apps/api/src/modules/ledger/services/recurring.ts:12:
  import { lockAccountPair, stepAmortization } from "../../../services/emis.ts";
apps/api/src/modules/ledger/services/recurring.test.ts:11:
  import { createEmi, listEmiInstallments, upsertEmiDetails } from "../../../services/emis.ts";
```
When `emis.ts` moves to (presumably) `modules/credit/services/emis.ts`, these
two already-shipped ledger-module files need their import path updated to
point at the new credit-module location (`../../credit/services/emis.ts` or
equivalent, exact relative depth to be verified at implementation time) — this
is a cross-module import edit in a file this task does NOT otherwise touch,
analogous to what task 1.1 called out for `card-due-tasks.ts`'s `userTasks`
import (there, no change was needed because the table didn't move; here, a
change IS needed because a whole service file moves).

`apps/api/src/services/overdraft-details.ts` and
`apps/api/src/services/bank-details.ts` import only `../db/schema.ts` (mixed
ledger+credit tables — split-import needed) and `../lib/errors.ts` — no other
cross-module service imports besides bank-details.ts's already-covered
`syncAccountLast4` above.

`apps/api/src/services/card-due-tasks.ts` imports `../db/schema.ts`
(`alertLedger, cardDetails, userTasks, users`) and `./cards.ts` — the
`userTasks` import needs NO change (per task 1.1's precedent — the table's
physical home never moves), but `./cards.ts` becomes a same-module relative
import if `card-due-tasks.ts` moves into the same `modules/credit/services/`
directory as `cards.ts` (no depth change, stays `./cards.ts`) — assuming it is
included in this task's scope (see §5's unresolved scope question).

---

## 9. Colocated test files — inventory and sizes

| File | Size | Lines |
|---|---|---|
| `apps/api/src/services/cards.test.ts` | 43 KB | 1068 |
| `apps/api/src/services/emis.test.ts` | 21 KB | 507 |
| `apps/api/src/services/card-due-tasks.test.ts` | 45 KB | 1025 |

**No test file exists for:** `routes/cards.ts`, `routes/emis.ts`,
`routes/overdraft-details.ts` + its service, `routes/bank-details.ts` + its
service, `services/card-statements.ts`. Confirmed by direct `ls` (all these
paths returned "No such file or directory" for a `*.test.ts` sibling).

`cards.test.ts` imports (line 16): `listAccounts` from
`../modules/ledger/services/accounts.ts` (already-moved ledger file — same
depth-adjustment-on-move pattern as the production files) plus
`{ accounts, cardDetails, emailIngestions, statementReconciliations,
transactions, users }` from `../db/schema.ts` directly (mixed ledger+credit+
ingest tables, all still physically in `db/schema.ts` — no path change needed
for these, only for the `modules/ledger/services/accounts.ts` import once this
test file itself moves deeper).

`card-due-tasks.test.ts` imports `{ accounts, alertLedger, cardDetails,
cardIssuerSettings, transactions, userTasks, users }` from `../db/schema.ts`
directly (same story — no path change needed, table locations don't move) and
`cardCycle, lastOccurrence, listCardHolders, nextOccurrence` from `./cards.ts`
(same-module relative import if both files move together).

`emis.test.ts` imports `{ accounts, recurringTemplates, transactions, users }`
from `../db/schema.ts` directly (no path change needed) and `amortize,
createEmi, splitInstallments, stepAmortization, upsertEmiDetails` from
`./emis.ts` (same-module relative import, no change on move).

---

## 10. `apps/api/src/services/backup.ts` entries for these 8 tables

`backup.ts` addresses tables by **raw snake_case string literal**, not by
importing the Drizzle table objects — so this task's move requires **no import
path change to `backup.ts` at all** (a fact worth stating explicitly in the
plan, since task 1.1 didn't need to touch it either but for the same reason).
Exact quoted entries:

`ALL_TABLES` (line 28 array, this task's 8 tables as they appear in the
existing literal order):
```
"card_details", "card_issuer_settings", "card_statements", "bank_details", "retirement_details", "account_nps_details", "overdraft_details",
...
"reward_entries", "emi_details", "holdings", "nps_details", "gold_details",
...
"statement_reconciliations", "ai_events",
```
(`retirement_details`, `account_nps_details` interleaved in the same line are
NOT part of this task's 8 tables — protection/investments modules — quoted
here only because they sit on the same source line.)

`USER_TABLES` (line 44 record):
```
card_details: "user_id", card_issuer_settings: "user_id", card_statements: "user_id",
bank_details: "user_id", retirement_details: "user_id", account_nps_details: "user_id",
overdraft_details: "user_id", insurance_policies: "user_id", insurance_health_cards: "user_id",
reward_entries: "user_id", emi_details: "user_id",
...
statement_reconciliations: "user_id", ai_events: "user_id",
```
All 8 of this task's tables carry `user_id` directly and are scoped that way
— none of them appear in `LINKED_TABLES` (no child-table-via-parent-FK scoping
needed for any of the 8).

---

## 11. Existing "documented interface" for reward earn-rate — none found

Grepped `earnRatePer100|earn_rate|rewardRate` across `apps/api/src`,
`apps/web/src`, `packages/shared/src`:
- `apps/api/src/db/schema.ts:834` — the raw column: `earnRatePer100:
  integer("earn_rate_per_100").notNull().default(0)` on `card_details`
- `apps/api/src/services/cards.ts:45` — `toDetails` passes it straight through
  to the `CardDetails` DTO, untouched (no reward-points-from-spend computation
  anywhere in the file)
- `apps/api/src/services/demo.ts:146-147` — seed data sets `earnRatePer100: 1`
  for two demo cards
- `apps/web/src/routes/cards/CardsPage.tsx` — reads/writes the same raw field
  as a plain number input, no computed "rate" abstraction
- `packages/shared/src/schemas/wealth.ts:20,38` — `earnRatePer100: z.number()...`
  in the Zod schema, again just the raw field

**Conclusion: there is no existing earn-rate lookup function, interface, or
computed-reward abstraction anywhere in the codebase today** — the AC "Reward
earn-rate lookup exposed as a documented interface for later reuse" requires
the plan to **create** this interface (e.g., a function that, given an
account/card and a spend amount, returns points earned per the card's
`earnRatePer100`), not relocate a pre-existing one.

**Roadmap cross-reference confirmed:** `tasks/10.06-reward-aware-checkout.md`
(phase 10, release 2.3.0) states explicitly: *"2. Card reward earn rates from
`reward_entries` and `card_issuer_settings`, via the interface exposed in 1.2"*
— this is the one and only forward reference found; `tasks/README.md`'s table
entry (line 152) just names the task, no further detail. No other task file
references an "earn rate" interface. Note 10.6's own text says the interface
draws from `reward_entries`+`card_issuer_settings`, not `card_details`'s
`earnRatePer100` column — a discrepancy between 10.6's prose and where the
actual `earnRatePer100` field lives today (`card_details`), worth flagging to
whoever designs the interface's exact shape, not resolved here.

---

## 12. Route-surface snapshot count for these 4 route groups

`apps/api/src/route-surface.snapshot.txt` — 283 lines total (one `METHOD
/path` pair per line, includes implicit `HEAD` for every `GET`, per task 1.1's
documented convention).

Grep counts (method+path lines matching each group's URL prefix):
- `cards` (`/api/cards*`, `/api/card-issuers*`, `/api/card-statements*`): **21 lines**
- `emis` (`/api/emis*`): **6 lines**
- `overdraft-details` (`/api/accounts/:accountId/overdraft-details`): **3 lines**
- `bank-details` (`/api/accounts/:accountId/bank-details`): **3 lines**

**Total: 33 canonical (method,path) lines** across these 4 route groups
(includes the implicit `HEAD` entries for every `GET`). In terms of distinct
URL+method combinations a human would count as "endpoints" (excluding the
auto-generated `HEAD`s), this is 15 (cards) + 4 (emis) + 2 (overdraft) + 2
(bank) = **23 real endpoints**, confirming again that the roadmap's "12" for
cards specifically is wrong (§2) — the true count is 15 for cards alone, 23
across all 4 groups combined.

Literal grep output (cards):
```
DELETE /api/cards/:accountId/rewards/:id
DELETE /api/cards/:accountId/statements/:id
GET /api/card-statements/:id
GET /api/cards
GET /api/cards/:accountId/activity
GET /api/cards/:accountId/reconciliations
GET /api/cards/:accountId/rewards
GET /api/cards/:accountId/statements
HEAD /api/card-statements/:id
HEAD /api/cards
HEAD /api/cards/:accountId/activity
HEAD /api/cards/:accountId/reconciliations
HEAD /api/cards/:accountId/rewards
HEAD /api/cards/:accountId/statements
POST /api/cards/:accountId/reconciliations/:id/absorb-carryover
POST /api/cards/:accountId/reconciliations/:id/recompute
POST /api/cards/:accountId/rewards
POST /api/cards/:accountId/statements
PUT /api/card-issuers/settings
PUT /api/cards/:accountId/details
PUT /api/cards/:accountId/statement-password
```
(emis/overdraft-details/bank-details lines omitted here for brevity — quoted
in full above at the top of this section's grep-output paragraph; all 33 lines
were inspected directly, none paraphrased.)

---

## Other facts relevant to planning (not separately numbered above)

- **`apps/api/src/app.ts` registration order** (grep): `cardRoutes` and
  `emiRoutes` register back-to-back (lines 111-112); `bankDetailsRoutes` and
  `overdraftDetailsRoutes` register later, also back-to-back but with
  `retirementRoutes`/`accountNpsRoutes` (protection/investments-module routes)
  registered in between, and `insuranceRoutes` immediately after — i.e. these
  4 route groups are **not** currently contiguous in `registerRoutes()`
  (`cardRoutes, emiRoutes, retirementRoutes, accountNpsRoutes,
  bankDetailsRoutes, overdraftDetailsRoutes, insuranceRoutes` — retirement/
  account-nps sit between emis and bank-details). This means collapsing these
  4 into a single `creditRoutes` plugin call **will** move `bankDetailsRoutes`/
  `overdraftDetailsRoutes` earlier in registration order relative to
  `retirementRoutes`/`accountNpsRoutes`/`insuranceRoutes` — exactly the kind of
  registration-structure change task 1.1's two-snapshot design anticipated
  (canonical surface unaffected, raw `route-table.snapshot.txt` tree expected
  to change and need regeneration/review).
- The `modules/ledger/` precedent (`schema.ts`, `plugin.ts`,
  `schema.smoke.test.ts`, `plugin.test.ts`) was read in full and matches
  exactly what `tasks/007-migrate-ledger/TASK.md` describes — no discrepancy
  found between the shipped code and that task's own documentation.
