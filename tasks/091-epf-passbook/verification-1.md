# Task 091 (EPF passbook) — independent read-only verification #1

Verifier: independent agent (did NOT implement task 091). No files were edited,
created, deleted, staged or committed apart from this report. No migrations or
DB writes were run.

## Per-claim verdicts

### Claim 1 — `apps/api/src/modules/tax/plugin.ts` registers `epfContributionRoutes` — CONFIRMED

`apps/api/src/modules/tax/plugin.ts:13` and `:19`:

```
13	import { epfContributionRoutes } from "./routes/epf-contributions.ts";
...
19	  await app.register(epfContributionRoutes);
```

Module is registered under `{ prefix: "/api/tax" }` per the file header
(`apps/api/src/modules/tax/plugin.ts:5`).

### Claim 2 — `apps/api/src/db/schema.ts` re-exports `epfContributions` exactly once — CONFIRMED

`grep -n "epfContributions\|epf_contributions" apps/api/src/db/schema.ts` →
single hit:

```
154:  epfContributions,
```

Context `apps/api/src/db/schema.ts:144-155`:

```
144	export {
145	  taxRegimePreferences,
146	  taxRegimeEnum,
147	  regimeSourceEnum,
148	  payslips,
149	  payslipComponents,
150	  incomeEvents,
151	  incomeEventStatus,
152	  incomeKind,
153	  incomeSourceKind,
154	  epfContributions,
155	} from "../modules/tax/schema.ts";
```

`grep -c` on the same file = `1`. Exactly one re-export.

### Claim 3 — decomposition test expects 78 tables and lists epfContributions under tax residents — CONFIRMED

`apps/api/src/db/schema.decomposition.test.ts`:

```
5: * exactly 78 tables + 61 enums (plus `users` from core) with no duplicates.
84	const taxResidents = new Set([
85	  "taxRegimePreferences", "taxRegimeEnum", "regimeSourceEnum",
86	  "payslips", "payslipComponents",
87	  "incomeEvents", "incomeEventStatus", "incomeKind", "incomeSourceKind",
88	  "epfContributions",
89	]);
...
127	  // T3c: barrel exports exactly 78 tables + 61 enums + users, no duplicates
128	  it("exports exactly 78 tables + 61 enums + users with no duplicates", () => {
...
160	    assert.equal(tables.length, 78, `expected 78 tables, got ${tables.length}: ${tables.join(", ")}`);
```

### Claim 4 — `epf_contributions` in BOTH ALL_TABLES and USER_TABLES — CONFIRMED

`apps/api/src/modules/system/services/backup.ts`:

```
32:export const ALL_TABLES = [
53:  "epf_contributions",
57:export const USER_TABLES: Record<string, string> = {
84:  epf_contributions: "user_id",
```

Line 53 falls inside the `ALL_TABLES` array (opened at :32); line 84 falls
inside the `USER_TABLES` record (opened at :57). User scoping column is
`user_id`, matching the table definition.

### Claim 5 — `apps/api/drizzle/0016_mighty_blonde_phantom.sql` creates ONLY epf_contributions — CONFIRMED, no mismatches found

File is 26 lines: one `CREATE TABLE`, two `ALTER TABLE ... ADD CONSTRAINT` FKs,
three indexes. No other table/enum/alteration.

Column-by-column cross-check against `apps/api/src/modules/tax/schema.ts:284-350`:

| SQL (0016) | pgTable field | match |
| --- | --- | --- |
| `"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL` | `id: uuid("id").primaryKey().defaultRandom()` | yes |
| `"user_id" uuid NOT NULL` | `userId: uuid("user_id").notNull().references(users.id, cascade)` | yes |
| `"wage_month" text NOT NULL` | `wageMonth: text("wage_month").notNull()` | yes |
| `"employer_name" text` | `employerName: text("employer_name")` | yes |
| `"epfo_member_id" text NOT NULL` | `epfoMemberId: text("epfo_member_id").notNull()` | yes |
| `"expected_employee_paise" bigint` | `bigint("expected_employee_paise", { mode: "number" })` | yes |
| `"expected_employer_paise" bigint` | `bigint("expected_employer_paise", ...)` | yes |
| `"expected_eps_paise" bigint` | `bigint("expected_eps_paise", ...)` | yes |
| `"expected_vpf_paise" bigint DEFAULT 0 NOT NULL` | `bigint("expected_vpf_paise", ...).notNull().default(0)` | yes |
| `"payslip_id" uuid` | `payslipId: uuid("payslip_id").references(() => payslips.id)` | yes |
| `"actual_employee_paise" bigint` | `bigint("actual_employee_paise", ...)` | yes |
| `"actual_employer_paise" bigint` | `bigint("actual_employer_paise", ...)` | yes |
| `"actual_eps_paise" bigint` | `bigint("actual_eps_paise", ...)` | yes |
| `"actual_vpf_paise" bigint` | `bigint("actual_vpf_paise", ...)` | yes |
| `"reconciliation_status" text DEFAULT 'pending' NOT NULL` | `text("reconciliation_status").notNull().default("pending")` | yes |
| `"gap_reason" text` | `text("gap_reason")` | yes |
| `"created_at" timestamp with time zone DEFAULT now() NOT NULL` | `timestamp(..., { withTimezone: true }).notNull().defaultNow()` | yes |
| `"updated_at" timestamp with time zone DEFAULT now() NOT NULL` | same | yes |

FKs:

```
22	ALTER TABLE "epf_contributions" ADD CONSTRAINT "epf_contributions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
23	ALTER TABLE "epf_contributions" ADD CONSTRAINT "epf_contributions_payslip_id_payslips_id_fk" FOREIGN KEY ("payslip_id") REFERENCES "public"."payslips"("id") ON DELETE no action ON UPDATE no action;
```

Matches `references(() => users.id, { onDelete: "cascade" })` and
`references(() => payslips.id)` (no `onDelete` → `no action`).

Indexes:

```
24	CREATE UNIQUE INDEX "epf_contributions_user_month_member_idx" ON "epf_contributions" USING btree ("user_id","wage_month","epfo_member_id");
25	CREATE INDEX "epf_contributions_payslip_idx" ON "epf_contributions" USING btree ("payslip_id") WHERE payslip_id IS NOT NULL;
26	CREATE INDEX "epf_contributions_user_month_idx" ON "epf_contributions" USING btree ("user_id","wage_month");
```

Matches the three index definitions at `apps/api/src/modules/tax/schema.ts:338-349`
(unique on user/month/member; partial payslip index with the same `WHERE
payslip_id IS NOT NULL` predicate; user/month index). No check constraints
exist in the pgTable and none in the SQL — consistent. **No mismatches.**

### Claim 6 — both snapshots contain the six `/api/tax/epf-contributions*` routes — CONFIRMED

`apps/api/src/route-surface.snapshot.txt` (GET/HEAD are the same three routes;
Fastify auto-adds HEAD):

```
155:GET /api/tax/epf-contributions
156:GET /api/tax/epf-contributions/gaps
157:GET /api/tax/epf-contributions/projection
288:HEAD /api/tax/epf-contributions
289:HEAD /api/tax/epf-contributions/gaps
290:HEAD /api/tax/epf-contributions/projection
407:POST /api/tax/epf-contributions
408:POST /api/tax/epf-contributions/:id/confirm-actual
409:POST /api/tax/epf-contributions/import-from-payslip/:payslipId
```

`apps/api/src/route-table.snapshot.txt:114-118`:

```
├── /api/tax/epf-contributions (GET, HEAD, POST)
│   ├── /gaps (GET, HEAD)
│   ├── /projection (GET, HEAD)
│   ├── /import-from-payslip/:payslipId (POST)
│   └── /:id/confirm-actual (POST)
```

The six declared routes:
1. `GET /api/tax/epf-contributions`
2. `GET /api/tax/epf-contributions/gaps`
3. `GET /api/tax/epf-contributions/projection`
4. `POST /api/tax/epf-contributions`
5. `POST /api/tax/epf-contributions/import-from-payslip/:payslipId`
6. `POST /api/tax/epf-contributions/:id/confirm-actual`

All six are declared in `apps/api/src/modules/tax/routes/epf-contributions.ts`
(:60, :80, :100, :125, :151, :177), with the two static sub-paths registered
before the parameterized ones.

Observation (not a defect): both snapshots also contain a pre-existing,
unrelated `POST /api/epf-contributions`
(`route-surface.snapshot.txt:345`, `route-table.snapshot.txt:63`). It is NOT in
`git diff` for either snapshot, i.e. it predates this change; it is the ledger
module's own EPF flow, called out in the route file header comment
(`apps/api/src/modules/tax/routes/epf-contributions.ts:15-17`).

### Claim 7 — `packages/shared/src/schemas/tax.ts` includes `'vpf'` and the Epf schemas used by routes — CONFIRMED

`packages/shared/src/schemas/tax.ts:76-88`:

```
export const CanonicalComponentKindSchema = z.enum([
  "basic",
  "hra",
  "special_allowance",
  "other_earning",
  "employee_epf",
  "employer_epf",
  "eps",
  "vpf",
  "professional_tax",
  "other_deduction",
  "employer_contribution",
]);
```

All nine schemas imported by the route file are exported here:
`EpfContributionSchema` (:421), `CreateEpfContributionBodySchema` (:448),
`ImportFromPayslipBodySchema` (:463 region, defined around :460-465),
`ConfirmActualBodySchema` (:469 region), `EpfGapResultSchema` (:482),
`EpfCorpusProjectionSchema` (:499), `GetEpfContributionsQuerySchema` (:511),
`GetEpfGapsQuerySchema` (:518), `GetEpfProjectionQuerySchema` (:524).
Typecheck passing (see commands) independently confirms every import resolves.

### Claim 8 — projection derives corpus from POSTED balance, not `accounts.openingBalancePaise` — CONFIRMED

`apps/api/src/modules/tax/services/epf-contributions.ts:429-445`:

```
  // Posted balance: same date/deleted/user predicates as listAccounts().
  const [balanceRow] = await db
    .select({
      balancePaise: sql<number>`coalesce(sum(${postings.amountPaise}), 0)::bigint`,
    })
    .from(postings)
    .innerJoin(transactions, eq(transactions.id, postings.transactionId))
    .where(
      and(
        eq(postings.accountId, accountId),
        eq(transactions.userId, userId),
        isNull(transactions.deletedAt),
        lte(transactions.date, sql`current_date`),
      ),
    );

  const currentCorpusPaise = Number(balanceRow?.balancePaise ?? 0);
```

`accounts` is used only for the ownership check
(`:422-427`, `select({ id: accounts.id }) ... eq(accounts.userId, userId)`).
`grep` shows no reference to `openingBalancePaise` anywhere in the service.
Overflow guard present at `:446-448`.

### Claim 9 — `importFromPayslip` maps `"vpf"` → vpf columns; can payslip-parse.ts emit "vpf" today? — CONFIRMED (mapping) / **NO** (parse enum cannot emit it)

Mapping, `apps/api/src/modules/tax/services/epf-contributions.ts:222-239`:

```
    switch (comp.canonicalKind) {
      case "employee_epf":
        expectedEmployeePaise = (expectedEmployeePaise ?? 0) + comp.currentPaise;
        break;
      case "employer_epf":
        expectedEmployerPaise = (expectedEmployerPaise ?? 0) + comp.currentPaise;
        break;
      case "eps":
        expectedEpsPaise = (expectedEpsPaise ?? 0) + comp.currentPaise;
        break;
      case "vpf":
        expectedVpfPaise += comp.currentPaise;
        break;
    }
```

Can the AI parse path emit `"vpf"` today? **No.** The tool JSON-schema enum in
`apps/api/src/modules/tax/services/payslip-parse.ts:94-105` omits it. Exact
values:

```
              enum: [
                "basic",
                "hra",
                "special_allowance",
                "other_earning",
                "employee_epf",
                "employer_epf",
                "eps",
                "professional_tax",
                "other_deduction",
                "employer_contribution",
              ],
```

(10 values; `"vpf"` absent.) The Zod validation applied to the model output
(`payslip-parse.ts:145`, `canonicalKind: CanonicalComponentKindSchema`) DOES
accept `"vpf"`, so a model that returned it would validate — but the constrained
tool schema does not offer it, so the AI-parse path will not produce it in
practice.

`"vpf"` can still reach `payslip_components` via the manual payslip path: the
manual-payslip body schema at `packages/shared/src/schemas/tax.ts:181` uses
`canonicalKind: CanonicalComponentKindSchema` (which contains `"vpf"`).
So the vpf mapping is reachable today only through manual entry, not AI parse.
Reported as a factual gap, not fixed.

## Commands (repo root `/work/personal/compass`)

### 1. `git status --porcelain` — exit 0

```
 M apps/api/drizzle/meta/_journal.json
 M apps/api/src/db/schema.decomposition.test.ts
 M apps/api/src/db/schema.ts
 M apps/api/src/modules/automation/schema.ts
 M apps/api/src/modules/system/services/backup.test.ts
 M apps/api/src/modules/system/services/backup.ts
 M apps/api/src/modules/tax/plugin.ts
 M apps/api/src/modules/tax/schema.ts
 M apps/api/src/route-surface.snapshot.txt
 M apps/api/src/route-table.snapshot.txt
 M apps/web/src/routes/events/EventLogPage.tsx
 M packages/shared/src/schemas/ai-events.ts
 M packages/shared/src/schemas/tax.ts
 M tasks/082-receipt-loop/DELEGATION.md
?? AGENTS.md
?? apps/api/drizzle/0014_smiling_ezekiel_stane.sql
?? apps/api/drizzle/0015_unknown_christian_walker.sql
?? apps/api/drizzle/0016_mighty_blonde_phantom.sql
?? apps/api/drizzle/meta/0014_snapshot.json
?? apps/api/drizzle/meta/0015_snapshot.json
?? apps/api/drizzle/meta/0016_snapshot.json
?? apps/api/src/modules/tax/routes/epf-contributions.ts
?? apps/api/src/modules/tax/routes/income-events.ts
?? apps/api/src/modules/tax/routes/payslips.ts
?? apps/api/src/modules/tax/services/epf-contributions.test.ts
?? apps/api/src/modules/tax/services/epf-contributions.ts
?? apps/api/src/modules/tax/services/income-events.test.ts
?? apps/api/src/modules/tax/services/income-events.ts
?? apps/api/src/modules/tax/services/payslip-parse.test.ts
?? apps/api/src/modules/tax/services/payslip-parse.ts
?? apps/api/src/modules/tax/services/payslip-review.test.ts
?? apps/api/src/modules/tax/services/payslip-review.ts
?? tasks/065-test-ci-agents/
?? tasks/066-catalog-canonicalization/implementation-3.md
?? tasks/066-catalog-canonicalization/implementation-4.md
?? tasks/066-catalog-canonicalization/investigation-2.md
?? tasks/066-catalog-canonicalization/investigation-3.md
?? tasks/066-catalog-canonicalization/investigation-4.md
?? tasks/068-photo-capture/ci-2.txt
?? tasks/068-photo-capture/ci-3.txt
?? tasks/068-photo-capture/ci-4.txt
?? tasks/069-cleanup/
?? tasks/070-price-observations-api/
?? tasks/071-serviceability/
?? tasks/072-basket-arbitrage/
?? tasks/073-card-offer-ingestion/
?? tasks/074-reward-model/
?? tasks/075-reward-aware-checkout/
?? tasks/076-price-history/
?? tasks/077-consumption-rate-pantry/
?? tasks/078-shopping-ui-lists/
?? tasks/079-predictive-cart/
?? tasks/080-pantry-pricewatch-ui/
?? tasks/081-financial-guards/
?? tasks/082-receipt-loop/commit-1.md
?? tasks/082-receipt-loop/commit-verify-1.md
?? tasks/082-receipt-loop/release-status-1.md
?? tasks/084-codex-worker/
?? tasks/085-coordinator-codex-worker/
?? tasks/086-install-bin-scripts/
?? tasks/087-tax-rule-data/release-1.md
?? tasks/088-payslip-parse/
?? tasks/089-fixed-income-instruments/release-fix-1.md
?? tasks/090-taxable-income-ledger/
?? tasks/091-epf-passbook/
?? tasks/091-epf-reconciliation/
?? tasks/092-scheme-limits/
?? tasks/093-80c-basket/
?? tasks/094-regime-comparison/
?? tasks/095-deadline-nudges/
?? tasks/096-advance-tax/
?? tasks/097-loss-carryforward/
?? tasks/098-harvesting-planner/
?? tasks/099-ais-reconciliation/
?? tasks/101-tax-ui/
```

Note: captured BEFORE this report file was written; this report now adds an
untracked file under `tasks/091-epf-passbook/`.

### 2. `git diff --stat` — exit 0

```
 apps/api/drizzle/meta/_journal.json                |  21 +
 apps/api/src/db/schema.decomposition.test.ts       |  15 +-
 apps/api/src/db/schema.ts                          |   7 +
 apps/api/src/modules/automation/schema.ts          |   1 +
 .../api/src/modules/system/services/backup.test.ts |   6 +-
 apps/api/src/modules/system/services/backup.ts     |   8 +
 apps/api/src/modules/tax/plugin.ts                 |   9 +-
 apps/api/src/modules/tax/schema.ts                 | 296 ++++++++++++-
 apps/api/src/route-surface.snapshot.txt            |  28 ++
 apps/api/src/route-table.snapshot.txt              |  17 +
 apps/web/src/routes/events/EventLogPage.tsx        |   2 +
 packages/shared/src/schemas/ai-events.ts           |   1 +
 packages/shared/src/schemas/tax.ts                 | 464 +++++++++++++++++++++
 tasks/082-receipt-loop/DELEGATION.md               |  78 ++++
 14 files changed, 943 insertions(+), 10 deletions(-)
```

### 3. `npm run typecheck` — exit 0

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

All 7 workspaces clean, no diagnostics.

### 4. `npm run lint` — exit 0

```
> compass@0.1.0 lint
> eslint .
```

No warnings, no errors.

### 5. `node --test apps/api/src/modules/tax/services/epf-contributions.test.ts` — exit 0

```
▶ computeStatus
  ✔ returns pending when actual employee is null (passbook not confirmed) (0.468032ms)
  ✔ returns pending even when other actuals are set but employee is null (0.080123ms)
  ✔ returns matched on an exact match across all three columns (0.075334ms)
  ✔ returns matched when the difference is within the 1% tolerance (0.065965ms)
  ✔ returns mismatch when employee differs by more than 1% (0.066427ms)
  ✔ returns mismatch when employer differs by more than 1% (0.065174ms)
  ✔ returns mismatch when eps differs by more than 1% (0.060496ms)
  ✔ treats a null expected column as not comparable (no mismatch) (0.065445ms)
  ✔ treats a zero expected column as not comparable (avoids divide-by-zero) (0.083559ms)
  ✔ treats a null actual (other than employee) as not comparable (0.10005ms)
  ✔ flags a mismatch when actual is lower than expected by more than 1% (0.062399ms)
  ✔ returns matched when all expected are null but employee actual is set (0.080323ms)
✔ computeStatus (2.016174ms)
▶ fyToWageMonthRange
  ✔ maps FY 2025-26 to April 2025 → March 2026 (0.430501ms)
  ✔ maps FY 2024-25 to April 2024 → March 2025 (0.056989ms)
  ✔ handles a century rollover FY 2099-00 (0.061076ms)
  ✔ produces a range that string-orders correctly for wage_month comparison (0.091955ms)
✔ fyToWageMonthRange (0.736383ms)
▶ buildEpfContributionDto
  ✔ converts an unconfirmed payslip-derived row (0.352011ms)
  ✔ computes 80C eligibility from expected values when unconfirmed (0.060595ms)
  ✔ excludes employer EPF and EPS from 80C eligibility (0.050436ms)
  ✔ prefers actual over expected for 80C eligibility once confirmed (0.053111ms)
  ✔ mixes actual employee with expected vpf when only vpf is unconfirmed (0.045056ms)
  ✔ treats a fully null expected/actual row as zero 80C eligibility (0.050016ms)
  ✔ carries a null payslipId for manual entries (0.044836ms)
  ✔ carries a null employerName (0.040687ms)
  ✔ carries gapReason through (0.045887ms)
  ✔ carries the matched status through (0.066176ms)
✔ buildEpfContributionDto (0.93402ms)
ℹ tests 26
ℹ suites 3
ℹ pass 26
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 358.096998
```

Counts: tests 26, pass 26, fail 0, skipped 0, todo 0. Exit code 0.
(Output was piped through `tail -40`; only the per-test header banner lines
above the first suite were dropped — no failures were truncated, `fail 0`.)

## Files inspected

- /work/personal/compass/apps/api/src/modules/tax/plugin.ts
- /work/personal/compass/apps/api/src/modules/tax/schema.ts
- /work/personal/compass/apps/api/src/modules/tax/routes/epf-contributions.ts
- /work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.ts
- /work/personal/compass/apps/api/src/modules/tax/services/payslip-parse.ts
- /work/personal/compass/apps/api/src/db/schema.ts
- /work/personal/compass/apps/api/src/db/schema.decomposition.test.ts
- /work/personal/compass/apps/api/src/modules/system/services/backup.ts
- /work/personal/compass/apps/api/drizzle/0016_mighty_blonde_phantom.sql
- /work/personal/compass/apps/api/src/route-surface.snapshot.txt
- /work/personal/compass/apps/api/src/route-table.snapshot.txt
- /work/personal/compass/packages/shared/src/schemas/tax.ts

## Files changed

Only this report: /work/personal/compass/tasks/091-epf-passbook/verification-1.md
No source file was modified; nothing staged or committed.

## Assumptions

- "Six routes" for claim 6 means six declared route handlers; Fastify's
  auto-added HEAD entries for the three GETs are not counted as separate routes.
- Migration `0016` was matched against the CURRENT pgTable definition in the
  working tree (both are uncommitted), not against `HEAD`.
- Claim 5's cross-check is a source-level diff; I did not apply the migration to
  a database (write operations were out of scope), so runtime equivalence is
  inferred, not executed.

## Unresolved risks / observations

1. `"vpf"` is unreachable from the AI payslip-parse path (tool enum omits it,
   `payslip-parse.ts:94-105`), so `importFromPayslip`'s `case "vpf"` branch can
   only fire for manually entered payslip components today. Not a defect in 091
   itself; flagged for the coordinator.
2. The repo working tree contains large amounts of unrelated uncommitted work
   (payslips, income-events, migrations 0014/0015, AGENTS.md). Any commit for
   091 must stage paths explicitly.
3. Pre-existing `POST /api/epf-contributions` (ledger module) coexists with the
   new `/api/tax/epf-contributions` surface; names are similar enough to invite
   confusion in clients, but the route file documents the distinction.
4. `epf-contributions.test.ts` covers only the pure helpers (`computeStatus`,
   `fyToWageMonthRange`, `buildEpfContributionDto`). There is no test exercising
   the DB-backed operations (`createManual`, `importFromPayslip`,
   `confirmActual`, `listContributions`, `getGaps`, `getProjection`) — notably
   the posted-balance projection query and the upsert conflict targets are
   unverified by automated tests.

VERDICT: PASS
