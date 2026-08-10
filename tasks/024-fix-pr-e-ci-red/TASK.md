# Task 024: Fix the 57 apps/api failures that turned `main` red (issue #176)

## Status
IMPLEMENTING (plan review closed at review-1; DELEGATION.md iteration 1 issued)

## Objective
`main` is green on CI, with no test weakened, skipped or deleted, and each failure
group fixed at its true root cause.

## Root Cause
Two independent causes, both introduced by the PR-E merge (`2253623`). Last green
commit on `main` is `11ecb3c`.

- **Cause A (production defect, ~18 failures).** PR-E replaced a typed Drizzle
  select in `modules/ledger/services/user-tasks.ts` with a raw
  `db.execute(TASK_LATERAL_QUERY)`. Raw `db.execute` bypasses Drizzle's decoding, so
  `timestamptz` arrives as a **Postgres text string**, but `TaskRawRow` still
  declares `Date` (`:15`, `:19`, `:20`) and `toUserTask` calls `.toISOString()`
  (`:42`, `:55`, `:56`) → `TypeError`.
- **Cause B (test-fixture defect, ~39 failures).** PR-E converted three production
  readers to `postings`, but their test fixtures still insert into `transactions`
  only, with no posting. The readers correctly return 0/absent, and the tests fail.

## Decisive evidence (verified, do not re-derive)
- E1. Driver is `drizzle-orm/node-postgres` over a `pg.Pool`. **No** `setTypeParser`
  / `pg.types` override exists anywhere in the repo.
- E2. **Empirical probe** — same column, two paths:
  - `db.execute(sql\`...\`)` → `typeof "string"`, value `"2026-07-30 12:04:02.460779+00"`
  - typed `db.select({...})` → `instanceof Date`, `"2026-07-30T12:04:02.460Z"`
- E3. The contract is strict: `packages/shared/src/schemas/user-tasks.ts` declares
  `createdAt: z.iso.datetime()`, `updatedAt: z.iso.datetime()`,
  `completedAt: z.iso.datetime().nullable()`, and the route registers
  `response: { 200: UserTaskSchema }`, so `fastify-type-provider-zod` validates
  every response on the way out.
- E4. **House convention** for reading a timestamp outside a typed select:
  `transactions.ts:348` uses
  `to_char(col AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`.
- E5 (**CORRECTED — the original claim was false**). The ordinary write paths *do*
  dual-write atomically: `transactions.ts:403`, `imports.ts:747,769`,
  `recurring.ts:288,341`, `demo.ts:216`, `accounts.ts:253,463`. **But restore is an
  exception:** `restore-user.ts` commits the transaction rows (`:184`), reconciles
  postings only *afterwards* (`:200`), and **swallows a reconciliation failure**
  (`:203`) — behaviour deliberately asserted by `backup.test.ts:1181-1259`. Boot
  reconciliation is also not absolute: per-row failures are collected and startup
  continues (`reconcile-postings.ts:85`, `app.ts:186,193`). **Therefore production
  CAN hold a postings-less transaction indefinitely**, and the converted readers
  then silently treat a real transaction as absent.

## Decisive design rulings
- **D1 — Fix Cause A in SQL, not in JS.** Emit ISO-8601 from Postgres with `to_char`
  per E4, then type the fields `string` / `string | null` and delete the three
  `.toISOString()` calls.
- **D2 — REJECTED: "declare the fields `string` and just delete `.toISOString()`".**
  Verified **UNSAFE**. The raw value `"2026-07-30 12:04:02.460779+00"` (space, not
  `T`; microseconds; `+00`, not `+00:00`) fails `z.iso.datetime()` (E3). That trades
  a loud `TypeError` for a **500 on every user-tasks response** — a strictly worse
  failure because it is silent at the type level.
- **D3 — REJECTED: revert `TASK_LATERAL_QUERY` to a typed Drizzle select.** The
  lateral join onto `postings` is the PR-E conversion itself; reverting it would
  undo the migration step.
- **D4 (REVISED after review-1) — For Cause B, fix the FIXTURES**, under a hard
  guard: **every existing assertion value must stay unchanged.** The fixtures model
  the *normal* production shape incorrectly — they bypass the service layer with raw
  inserts, so they omit the postings every ordinary writer creates. Repairing them is
  right. If any expected value has to move to make a test pass, that is evidence of a
  real production bug and the task returns to plan review.
  **Scope limit, stated explicitly:** because corrected-E5 shows a postings-less
  transaction IS reachable via failed restore reconciliation, D4 is **not** a
  complete production fix — it makes the suite honest about the healthy path. The
  degraded-path behaviour (readers silently reporting a real transaction as absent;
  most seriously the EMI guard at `emis.ts:374` letting a user re-point an account
  despite real payment history) is a **genuine pre-existing PR-E defect** that this
  task does NOT fix. It is filed separately and must not be implied as resolved.
- **D5b — fixtures mirror the FULL posting family**, not just the real leg: a
  balanced set including the system counter-leg, so they stay consistent with
  `findInconsistentPostings`. Use `createTransaction` where practical.
- **D5 — `completed_at` is nullable.** `to_char(NULL, ...)` returns `NULL`, so the
  null path is preserved. Must be covered by a test.

## Scope
- `apps/api/src/modules/ledger/services/user-tasks.ts` (Cause A, production).
- `apps/api/src/modules/investments/services/sip-installments.ts:308` — latent copy
  of the same defect: raw `t.deleted_at` from `tx.execute` declared `Date | null`
  when `pg` returns a string. It only null-checks today (`:317`) so it does not
  crash, but it is the same type lie and is cheap to correct.
- `apps/api/src/app.ts:182-185` — the comment claiming posting-derived reader
  failures "cannot surface because every reader is still legacy-derived" is **stale
  and actively misleading** after PR-E. Correct the comment only; no logic change.
- Fixtures only, in:
  - `apps/api/src/modules/credit/services/card-due-tasks.test.ts` (`createTxn`)
  - `apps/api/src/modules/credit/services/reconciliation-writes.test.ts` (`createTxn`)
  - `apps/api/src/modules/credit/services/emis.test.ts` (`insertInstallmentHistory`)

## Dependencies
None. Independent of PR-F (#175), which touches none of these files.

## Plan
- P1: In `TASK_LATERAL_QUERY`, replace the bare `ut.created_at, ut.updated_at,
  ut.completed_at` selections with `to_char(<col> AT TIME ZONE 'UTC',
  'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as <name>`, matching E4 exactly.
- P2: Retype `TaskRawRow.created_at`/`updated_at` to `string` and `completed_at` to
  `string | null`; delete the three `.toISOString()` calls.
- P3: Audit every other field of `TaskRawRow` against what `db.execute` actually
  returns for its column type, and fix any other mis-declaration found. (`due_date`
  is `date`→string; `txn_amount_paise` is `bigint`→string and is already
  `Number()`-ed with a safe-integer guard — confirm both.)
- P4: Add postings rows to the three fixtures so each transaction carries its real
  posting with the same signed amount, mirroring the production dual-write shape.
- P5: Sweep for the same fixture gap in tests that currently PASS — a fixture with no
  posting may be silently asserting the wrong thing against a converted reader.
  Report findings; do not fix out of scope.

## Acceptance Criteria
- AC1: `listUserTasks` and `getUserTask` return `createdAt`/`updatedAt` as strict
  ISO-8601 accepted by `z.iso.datetime()`, verified through the ROUTE (so the
  response serialiser actually validates), not only the service.
- AC2: `completedAt` is `null` for an incomplete task and strict ISO-8601 for a
  completed one (D5), asserted through **both** the list and get routes.
- AC2b (review-1): a dedicated regression test inserts timestamps with **non-zero
  microseconds**, calls both HTTP routes, asserts 200, and parses every returned
  timestamp with `z.iso.datetime()`. Without non-zero microseconds a future change
  could accidentally exercise only millisecond precision and miss the bug.
  (Confirmed by review-1 against the installed Zod 4.4.3: `...460779Z` is accepted,
  `2026-07-30 12:04:02.460779+00` is rejected.)
- AC2c: `sip-installments.ts:308` no longer declares a raw-SQL timestamp as `Date`.
- AC3: No `.toISOString()` call remains on a value sourced from `db.execute` in
  `user-tasks.ts`, and no field of `TaskRawRow` is declared `Date`.
- AC4: All ~39 Cause-B failures pass **with every pre-existing expected value
  unchanged** (D4) — in particular `reconciliation-writes` expecting `2540475`, and
  `card-due-tasks` expecting `created >= 1`.
- AC5: No test is skipped, deleted, or weakened. Test count does not decrease.
- AC6: `npm run typecheck`, `npm run lint` green; **`npm run test -w apps/api` has
  0 failures**.
- AC7: CI on the PR is fully green, including the `check` job.
- AC8: P5's sweep is reported, with any out-of-scope fixture gaps listed for
  follow-up.

## Verification
- T1: `node --test apps/api/src/modules/ledger/services/user-tasks.test.ts`
- T2: `node --test apps/api/src/modules/ledger/routes/user-tasks.route.test.ts`
- T3: `node --test apps/api/src/modules/ledger/services/postings-pr-e-parity.test.ts`
- T4: `node --test apps/api/src/modules/credit/services/card-due-tasks.test.ts`
- T5: `node --test apps/api/src/modules/credit/services/reconciliation-writes.test.ts`
- T6: `node --test apps/api/src/modules/credit/services/emis.test.ts`
- T7: `npm run test -w apps/api` — must be 0 failures
- T8: `npm run typecheck`, `npm run lint`
- T9: CI green on the PR

## Non-Goals
- Changing the postings migration itself or reverting any PR-E conversion.
- Touching PR-F's four files or PR #175.
- Editing any expected value to make a test pass (D4).
- Fixing fixture gaps found by P5 outside the three named files.

## Iteration-1 findings (lead-validated, from implementation-A.md)

Worker A completed items 1-6, 10, 11. Its own route test passes 7/7, and its P3
audit confirmed every other `TaskRawRow` field was already correctly typed
(`due_date`→string, `txn_amount_paise`→bigint-as-string with a `Number()` +
`isSafeInteger` guard). Two failures fell OUTSIDE all assigned ownership. I read
both sites myself; they are NOT the same class of problem.

- **F1 — a FOURTH Cause-B fixture file. My Scope list was incomplete.**
  `user-tasks.test.ts:63` `createTxn` raw-inserts into `transactions` with no
  posting (lead-verified by reading the helper). `TASK_LATERAL_QUERY`'s lateral join
  on `postings` therefore yields `null` for `account_id`/`amount_paise` and AC6's
  `deepEqual` fails on `accountId`/`amountPaise` only. Identical to the three named
  credit fixtures. This is one of the 57 red failures, so AC6/AC4 require fixing it —
  it is NOT covered by the "P5 findings are out of scope" Non-Goal, which was written
  for tests that currently PASS. **This is a scope defect in my plan, so it returns to
  plan review (review-2) rather than being patched by fiat.**
- **F2 — possible THIRD root cause, NOT a fixture gap.** PE7 in
  `postings-pr-e-parity.test.ts:495` fails `'Pe7merchant'` (actual) vs `'PE7Merchant'`
  (expected). Lead-verified that this fixture does NOT have the Cause-B shape: it
  seeds through the real `createTransaction`/`createTransfer` services, and the
  amount assertion (`-600`, "amount from posting") is not what failed. The delta is a
  case transform — capitalise-first, lowercase-rest — so something normalises
  `merchant` on write or on read. Worker A's claim that this is "pre-existing" is
  **rejected as unverified**: this test FILE was added by PR-E and cannot predate it,
  so PE7 is part of the red that this task must clear (AC6 = 0 failures).
  Under investigation; must not be "fixed" by editing the expectation until the
  production behaviour is known to be intended (D4 guard).

## Amendment 1 (post-iteration-1, pending review-2)

### F2 resolved — D6, a NARROW and DOCUMENTED exception to D4
Lead-validated by reading the code directly, not by accepting the worker's verdict:
- `merchants.ts:11-15` `titleCase` = `.toLowerCase()` then capitalise-after-whitespace.
  `"PE7Merchant"` is one token that survives every noise filter (a single digit, so
  `/\d{4,}/` does not strip it), so `heuristicNormalize` returns
  `titleCase("PE7Merchant")` === `"Pe7merchant"`. Reproduced by hand from the source.
- `transactions.ts:402` applies `normalizeMerchant` **on WRITE**; the stored row holds
  `"Pe7merchant"`.
- `search.ts:35` returns `r.merchant` verbatim — there is NO read-side transform, so
  PR-E's postings conversion is not implicated.
- Intent is corroborated by THREE tests that already acknowledge normalised storage:
  `imports.test.ts:135`, `postings-planning-parity.test.ts:537` (states plainly that
  `"MerchantX"` is stored as `"Merchantx"`), and `epf-contributions.test.ts:105`.
  **Correction from review-2:** I originally cited the `merchants.ts:17` docstring as
  proof of intent. That docstring is STALE — it claims `→ "Amazon"` but the
  implementation retains `BLR`, and `imports.test.ts:136` expects `"Amazon Blr"`. The
  docstring still shows normalisation is deliberate, but it is NOT exact evidence and
  must not be quoted as such. (Stale docstring = follow-up, out of scope here.)

**D6 — PE7's expectation is genuinely wrong and MAY be corrected.** PE7 asserts that
`createTransaction` round-trips `merchant` verbatim. It does not, and has not since
before PR-E. This is a test-authoring defect in a test PR-E added, NOT a production
bug, so D4's guard does not apply. **Fix: change ONLY the merchant expectation at
`postings-pr-e-parity.test.ts:528` to `"Pe7merchant"`, and add a comment citing
`merchants.ts:11-15` + `transactions.ts:402`,** following the `epf-contributions.test.ts:105`
precedent so the next reader is not re-confused.

- **REJECTED: rewrite the fixture merchant to a `titleCase` fixed point.**
  **Rationale CORRECTED after review-2 — my original justification was overstated.**
  I claimed rewriting the literals risked destroying the Pattern-C transfer-exclusion
  coverage. Codex checked and that is not so: a fixed-point literal would still match
  the raw-updated out-leg case-insensitively, so Pattern-C coverage would survive.
  The alternative is still rejected, but for the honest reason: editing only the wrong
  expectation is the SMALLER edit, it keeps a realistic non-fixed-point service input,
  and it incidentally pins the actual normalised stored value.
- **D4 IS NOT RELAXED.** D6 is confined to this single merchant assertion, justified by
  production behaviour that PREDATES PR-E. For the Cause-B fixtures the guard stands
  unchanged: an expectation that must move is a production bug and returns to review.
- **Linchpin CLOSED at review-2, by two independent derivations that agree.** Codex
  re-derived from git, without seeing the worker's report: `titleCase`/
  `heuristicNormalize`/`normalizeMerchant` are attributed to initial commit `90ee575`
  (2026-07-14); `transactions.ts` already called `normalizeMerchant` in PR-E's PARENT
  commit; `postings-pr-e-parity.test.ts` (PE7 included) arrived with `2253623`.
  PE7 therefore could never have passed as committed, and D6 is not masking a PR-E
  regression.
- **No contract requires verbatim merchant round-tripping** (review-2, verified against
  consumers): `packages/shared/src/schemas/search.ts:3` accepts any string;
  `CommandPalette.tsx:79` merely displays it and filters case-insensitively; and search
  itself matches `lower(...) LIKE lower(term)` (`search.ts:10`), which is why the term
  `"PE7Merchant"` still finds the stored `"Pe7merchant"`. Verbatim casing survives only
  via explicit user merchant RULES — a different path that D6 does not touch.

### F1 resolved — scope now includes a FOURTH fixture file
`apps/api/src/modules/ledger/services/user-tasks.test.ts` (`createTxn`, `:63`) joins
the Cause-B fixture list. Same treatment as the three credit fixtures (D5b: full
balanced posting family, prefer `createTransaction`), same D4 guard: AC6's expected
`amountPaise: -12345` and its `accountId` must NOT be edited.

### Added plan items
- P6: Repair `user-tasks.test.ts` `createTxn` to create the transaction's postings.
- P7: Apply D6 to `postings-pr-e-parity.test.ts:528` (expectation + explanatory comment).

### Added acceptance criteria
- AC9: `node --test apps/api/src/modules/ledger/services/user-tasks.test.ts` is 18/18
  with AC6's `accountId`/`amountPaise` expectations byte-unchanged.
- AC10: `postings-pr-e-parity.test.ts` is 10/10, with PE7's amount and
  `results.transactions.length === 1` assertions byte-unchanged — only the merchant
  string and a new comment differ.
- AC11 (supersedes the earlier accounting): my "~18 + ~39 = 57" split was incomplete —
  it missed F1 and F2. The bar is not the arithmetic; it is AC6: 0 failures in
  `npm run test -w apps/api`.

## Iteration-2 results (lead-verified by reading the diffs, not the reports)

- **Worker C — P6/P7 ACCEPTED.** `createTxn` (`user-tasks.test.ts:64-81`) now calls
  `seedSystemAccounts` then the real `createTransaction`, so the fixture inherits the
  production dual-write instead of re-implementing it. `user-tasks.test.ts` 18/18,
  `postings-pr-e-parity.test.ts` 10/10, both exit 0. I read both edits: AC6's
  `accountId`/`amountPaise: -12345` are byte-unchanged, and the P7 change is confined
  to the merchant string plus a behaviour-describing comment (`:528-532`) that also
  records that the normalisation predates PR-E. PE7's `length === 1`,
  `amountPaise === -600` and `findInconsistentPostings` assertions are untouched.
- **CAUTION — an inaccuracy in review-2 that I verified is WRONG.** Codex stated that
  both `"Test merchant"` and `"Bookstore"` are `titleCase` fixed points. `"Bookstore"`
  is; **`"Test merchant"` is NOT** — `titleCase` lowercases then capitalises after
  whitespace, so `createTxn`'s default merchant is now STORED as `"Test Merchant"`
  (capital M). This is harmless today only because no assertion reads that default,
  which is why 18/18 still passes. Recorded as a latent trap: a future test asserting
  the literal `"Test merchant"` against this helper will fail confusingly.
- **Worker B — 2 of 3 files ACCEPTED, one open.** `card-due-tasks.test.ts` 27/27 and
  `emis.test.ts` 29/29 (both exit 0) via `createTransaction`.
  `reconciliation-writes.test.ts` is 24/26.

## F3 — Worker B's "expectation must change" claim, REJECTED pending proof

Worker B reported that `openingBalancePaise === -350000` (`reconciliation-writes.test.ts:734`)
"cannot be preserved" and must become `-400000`. **I rejected this rather than acting on
it**, because D4 treats exactly this as the signature of a production bug, and accepting
it would edit away the evidence.

Lead reading of the test: its OWN hook manufactures the inconsistency. At `:715-718`
connection B does `txB.update(transactions).set({ amountPaise: -150000 })` — a raw
test-side write that mutates `transactions.amount_paise` and leaves the posting alone.
Since PR-E made the aggregate postings-derived, "B overwrites what A's aggregate read"
must now also overwrite the POSTING. If so, the fix is in the hook and `-350000` is
preserved untouched.

**Unresolved arithmetic that must be settled before any ruling:** the seed at `:690-693`
is a bare `db.insert(transactions)` with no posting, so a postings-only aggregate should
sum 0 and yield `-500000`, not the observed `-400000`. `-400000` implies the aggregate
saw exactly `-100000`. Until that is explained, I do not know whether this is
(a) a test-side dual-write gap, (b) a genuine production writer bug PR-E exposed, or
(c) something else. Investigation in flight; **no expectation may move until then.**
Note also the deadlock hazard documented at `:660-684`: any fix must avoid touching
`account_id`, or it re-acquires the `FOR KEY SHARE` lock on `accounts` and deadlocks.

## Amendment 2 — F3 resolved (pending review-3)

**Worker B's "the expectation must become -400000" claim is REFUTED BY ITS OWN LITERAL
OUTPUT.** `implementation-B.md:247-249` shows the failure is at
`reconciliation-writes.test.ts:728` — `"the retry must have happened"`, i.e. the
`hookCalls === 2` assertion. Execution never reached the `openingBalancePaise`
assertion at `:734`, so **`-400000` was never observed anywhere**; the worker
extrapolated a number for an assertion that never ran. Had I accepted the digest I
would have edited a CORRECT expectation to match a value that does not exist. This is
the concrete justification for D4 and for reading literal evidence over summaries.

### Confirmed mechanism (investigation-3, empirical)
- The seeds at `:690-693` and `:742-745` are bare `db.insert(transactions)` and create
  **zero** postings — proven by a throwaway probe returning `row count: 0`. No trigger
  creates postings on a raw insert (the only two triggers are split-sum checks).
- `ledgerDuesAtDates` (`reconciliation-reads.ts:124`) reads `postings.amount_paise`
  after PR-E.
- Each hook's connection B updates only `transactions.amount_paise` — a table the
  aggregate **no longer reads**. So there is no rw-anti-dependency between A's read set
  and B's write set, hence no SSI cycle, no `40001`, no retry: `hookCalls` stays 1 and
  the test fails at `:728`.
- **Consequence worth stating plainly: PR-E silently made these two tests VACUOUS.**
  They are named for serialization-failure retry and no longer exercise it at all.
  Repairing them restores real coverage rather than merely turning the suite green.

### D7 — fix is test-side; there is NO production bug here
1. Create both seeds via `createTransaction` instead of `db.insert(transactions)`, so
   the row the aggregate must read actually exists in `postings`.
2. **REVISED after review-3 — my first version of this step was WRONG and blocking.**
   I had said to update only the matching real-leg posting. Codex caught that this
   leaves the family unbalanced: real leg `-150000` with the counter-leg still
   `+100000` sums to `-50000`, not zero. Lead-verified — `buildOrdinaryPostings`
   (`postings.ts:90-106`) emits a PAIR, so a one-leg update manufactures an invalid
   ledger shape and contradicts D5b.
   **Correct construction:** keep the existing `transactions.amountPaise` update, and
   update BOTH existing legs in one statement, the card leg carrying the conflict:
   `UPDATE postings SET amount_paise = CASE WHEN account_id = <accountId> THEN <new> ELSE -<new> END WHERE transaction_id = <seed.id>`
   with `.returning()` and an assertion that **exactly two rows** were updated. No FK
   column appears in the SET list, so the locking argument in (3) still holds.
2b. **FORBIDDEN: `rebuildPostingsForTransaction` inside the hook** (review-3). It
   DELETEs and re-INSERTs postings (`post-entry.ts:68`), and the inserts do perform FK
   checks — which is precisely how the documented deadlock returns. Direct UPDATE of the
   existing rows is the only safe construction. This is the tempting "cleaner" refactor
   and it must not be taken.
3. **Deadlock safety (the hazard documented at `:660-684`):** updating `amount_paise` on
   an EXISTING posting row does not modify `account_id`, so Postgres takes no FK
   `FOR KEY SHARE` lock on `accounts` and the reproduced deadlock cannot recur. Verified
   by investigation-3; must be re-confirmed by the run, not assumed.
4. **All expectations are PRESERVED byte-for-byte:** `-350000` (`:734`), and test 2's
   `40001` rejection, `hookCalls === 2`, and `openingBalancePaise === 0`.

- **REJECTED: change `-350000` to `-400000`** (Worker B's proposal). Based on a value
  that was never observed; would have masked the fact that the test had gone vacuous.
- **REJECTED: revert `ledgerDuesAtDates` to read `transactions`.** That is the PR-E
  conversion itself (D3 applies).

### Added plan item / criteria
- P8: apply D7 to both SSI tests in `reconciliation-writes.test.ts`.
- AC12: `reconciliation-writes.test.ts` is 26/26 with ALL FOUR of the above expected
  values unchanged, and no new deadlock (the test must not hang).
- AC12b (review-3): each hook's posting update must leave the family ZERO-SUM, asserted
  in-test by confirming exactly two existing posting rows were updated. Without this the
  repaired concurrency test could go green while manufacturing a different invalid
  ledger shape.

### review-3 (Codex, Amendment 2) — digested
**Verdict: amendment required; sound once P8 updates both legs.** My refutation of the
`-400000` claim was confirmed from the literal output. All four diagnosis links
confirmed against source, plus corrections/additions I have taken:
- **BLOCKER (taken, above):** one-leg update breaks zero-sum.
- Claim (c) locking **confirmed**: an UPDATE whose SET list omits every FK column does
  not fire the FK triggers, so no `FOR KEY SHARE` on `accounts`. `postings.account_id`
  is indexed (`db/shared/ledger.ts:150`) but unmodified; `amount_paise` is unindexed so
  the update may be HOT, which affects tuple/index maintenance, not FK checks or SSI
  conflict detection; no repo migration defines any trigger on `postings`.
- **Correction to my mental model of this aggregate:** `ledgerDuesAtDates`
  (`reconciliation-reads.ts:124`) has **no `system_kind` predicate at all**. The
  counter-leg is excluded simply because its `account_id` is a system account rather
  than the requested card account. (The `system_kind is null` filter I noted earlier
  belongs to `TASK_LATERAL_QUERY`, a different query — do not conflate them.)
- SSI reliability **confirmed deterministic**: under SERIALIZABLE, Postgres registers
  SIREAD predicate locks for both index and sequential scans, and a seq-scan promotes to
  a broader relation lock, which yields at least the same conflict — not fewer. So the
  restored `40001` is not plan-dependent or flaky.
- **Production-writer audit CLEAN**, which is the load-bearing confirmation that D7 is
  test-side: every real writer that changes an amount rebuilds postings in the same
  transaction — `transactions.ts:491,502`, `imports.ts:655,725`, `imports.ts:915,932`,
  `accounts.ts:477,487`. Other direct updates touch header-only fields (merchant, SIP
  link, reconciliation link, soft-delete) and correctly leave amounts alone. The
  restore/reconciliation defect remains real but is a DIFFERENT mechanism (postings
  ABSENT, not stale) and does not undermine D7.
- P8 will need a `postings` schema import in the test file.

## Iteration-3 result (lead-verified by reading the code, not the report)

**Worker D — P8 ACCEPTED.** `reconciliation-writes.test.ts` 26/26 on TWO consecutive
runs, exit 0, no hang. I read the construction at `:690`, `:706-724` and `:745`:
- both seeds now use the real `createTransaction`
- `txB` still reads `accounts` FIRST (the deliberate reverse edge), unreordered
- the SET list contains ONLY `amountPaise`; `postings.accountId` appears solely inside
  the CASE *expression* (read, never assigned), so no FK re-check and no `FOR KEY SHARE`
  on `accounts` — the documented deadlock cannot recur, and empirically did not
- both legs move together and exactly two updated rows are asserted (AC12b)
- `-350000` at `:737` and test 2's three expectations are byte-unchanged
- a `::bigint` cast was needed because Drizzle sends JS numbers as text parameters

### P9 (comment accuracy, comment-only — same class as the approved `app.ts:182` fix)
The explanatory comment at `:677-684` is now **actively misleading**: it still says B
updates the *transaction's* `amount_paise` and that "A's earlier ledger aggregate read
the row's OLD amount". Post-PR-E the aggregate reads POSTINGS, so the `transactions`
update contributes nothing to the cycle — the posting UPDATE is what creates it. Left
as-is, a future reader could delete the posting UPDATE as redundant and silently
re-vacuum the test, which is the exact defect this task just spent three iterations
uncovering. Correct the comment; change no logic.

## Review log
- **review-1 (Codex, plan):** D1 and D2 CONFIRMED, including the highest-risk
  detail — Codex empirically checked the installed **Zod 4.4.3** and found
  `z.iso.datetime()` accepts 6-digit `.US` precision (`...460779Z` ✓) and rejects the
  raw pg form (`... 12:04:02.460779+00` ✗). It also correctly noted the
  `transactions.ts:348` precedent proves *formatting* only, since that value is
  base64url-encoded into a cursor and never Zod-validated — the installed-Zod check
  is what actually justifies D1.
  **One BLOCKER: E5 was false.** Restore commits transactions then reconciles
  post-commit and swallows failure, so postings-less transactions ARE reachable in
  production. Lead-validated. E5 rewritten, D4 re-scoped to state plainly that it is
  not a complete production fix, and the degraded-path defect filed separately rather
  than papered over.
  Other findings taken: non-zero-microsecond route regression test (AC2b); latent
  `Date` mis-declaration at `sip-installments.ts:308` (AC2c); fixtures should carry
  the full balanced posting family (D5b); stale, risk-obscuring comment at
  `app.ts:182`; P5 refined to cross-reference posting-derived readers rather than
  flagging every raw insert.
- **review-2 (Codex, Amendment 1): APPROVED, no blocking issue.** All five links of the
  D6 chain confirmed against source, the git linchpin independently re-derived (see
  above), and F1 confirmed at `user-tasks.test.ts:63` with the mechanism pinned more
  precisely than I had it: `toUserTask` builds the projection with **non-null
  assertions** (`user-tasks.ts:44-50`), so a null `txn_account_id`/`txn_amount_paise`
  from the missing posting is asserted-away rather than caught — which is exactly why
  AC6 fails on those two keys only.
  Two corrections to MY reasoning, both recorded above rather than quietly dropped:
  the stale `merchants.ts:17` docstring, and my overstated rejection of the
  fixed-point alternative.
  **Implementation constraints extracted from review-2 (binding on P6):**
  - Using `createTransaction` requires `seedSystemAccounts(db, userId)` first for each
    test user.
  - AC6's expectations are safe: `"Test merchant"` and `"Bookstore"` are already
    `titleCase` fixed points, so write-normalisation cannot move them.
  - A full two-leg posting family cannot multiply task rows — the lateral query is
    `limit 1` — and the system counter-leg is excluded by `a.system_kind is null`, so
    AC6 still sees the real-account leg and `-12345`.
  - AC10 ordering is computed purely from user-task columns (`user-tasks.ts:113`) and
    its fixture inserts unlinked tasks, so postings cannot perturb it.
  - Soft-delete tests still hide the transaction at the `t.deleted_at is null` join,
    before the lateral posting lookup.
  **New P5 item (report only, NOT to be fixed):** `user-tasks.route.test.ts:110` also
  raw-inserts a transaction without postings. It currently passes because it exercises
  soft-deleted projection and cross-user isolation, not an active projection — so it
  stays out of P6 and goes in the P5 list.
  Codex also notes the reconciliation/backup tests create inconsistent rows
  DELIBERATELY to exercise degraded behaviour and must NOT be mechanically converted.
- **Deliberately NOT taken into this task:** Codex's request to resolve the
  restore/reconciliation degraded state before shipping. That is a real pre-existing
  PR-E defect, but folding it in would block un-redding `main` behind a design change
  to restore semantics. Tracked as its own issue; the release decision is the user's.
