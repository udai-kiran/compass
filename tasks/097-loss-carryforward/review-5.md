# Review verdict

**Not implementation-ready.**

The rewrite substantially improves the plan and directly addresses all four review-4 High findings. The PostgreSQL/Drizzle locking approach is viable. However, two High-severity contradictions remain:

1. `confirmSetOff` does not define the target gain pool after current-year loss adjustment, even though the available service returns signed net totals.
2. Annual exact-allocation reconciliation simultaneously says “do not clamp” and “apply what the pool can cover,” which is clamping.

Several Medium contract, lifecycle, functional-core, and testing gaps also remain.

## Review-4 finding resolution table

| Review-4 finding | Status | Current TASK.md evidence and assessment |
|---|---:|---|
| **H1 — timely-filing eligibility** | **Resolved** | Under **“Codex Review-4 Findings — H1”**, the plan adds literal `filed_within_due_date BOOLEAN NOT NULL DEFAULT false` and says BFLA requires all three flags ([TASK.md:39](/work/personal/compass/tasks/097-loss-carryforward/TASK.md:39)). The schema repeats the three-flag gate ([TASK.md:76](/work/personal/compass/tasks/097-loss-carryforward/TASK.md:76)), annual selection enforces it ([TASK.md:131](/work/personal/compass/tasks/097-loss-carryforward/TASK.md:131)), and confirmation requires it ([TASK.md:163](/work/personal/compass/tasks/097-loss-carryforward/TASK.md:163)). The belated-return test is listed in P7 ([TASK.md:228](/work/personal/compass/tasks/097-loss-carryforward/TASK.md:228)). |
| **H2 — exact/advisory ordering undefined** | **Partially resolved** | The canonical service now explicitly says to partition records, “Apply exact records FIRST,” then “simulate the advisory records” ([TASK.md:132](/work/personal/compass/tasks/097-loss-carryforward/TASK.md:132)). Mixed records are labeled per record as `confirmed` or `advisory` ([TASK.md:135](/work/personal/compass/tasks/097-loss-carryforward/TASK.md:135)). The remaining exact-allocation discrepancy contradiction is High severity below. |
| **H3 — target-gain conservation across different records** | **Partially resolved** | `confirmSetOff` now takes `pg_advisory_xact_lock(hash(userId, setoffFy))`, expressly serializing all same-user/FY confirmations ([TASK.md:161](/work/personal/compass/tasks/097-loss-carryforward/TASK.md:161)), and sums allocations across all loss records ([TASK.md:166](/work/personal/compass/tasks/097-loss-carryforward/TASK.md:166)). This fixes the original cross-record race, but the pool being conserved is not correctly defined after CYLA. |
| **H4 — absent-row materialize/declare race** | **Resolved in design** | Both paths acquire the same conceptual per-`(userId, originFy)` transaction lock before selecting/upserting: materialization ([TASK.md:143](/work/personal/compass/tasks/097-loss-carryforward/TASK.md:143)) and declaration ([TASK.md:152](/work/personal/compass/tasks/097-loss-carryforward/TASK.md:152)). This covers absent rows, provided implementation uses one canonical lock-key helper. |
| **M1 — `confirmed_at` used as a tax date** | **Policy resolved; text inconsistent** | The revised policy correctly says dated simulation is always advisory and never applies confirmed amounts ([TASK.md:137](/work/personal/compass/tasks/097-loss-carryforward/TASK.md:137)). But it also says it “NEVER reads `capital_loss_allocations`” while requiring an existence read to emit a warning ([TASK.md:139](/work/personal/compass/tasks/097-loss-carryforward/TASK.md:139)). |
| **M2 — unvalidated/mutable confirmation** | **Partially resolved** | All-zero confirmation is rejected ([TASK.md:160](/work/personal/compass/tasks/097-loss-carryforward/TASK.md:160)), destination/source headroom is checked ([TASK.md:165](/work/personal/compass/tasks/097-loss-carryforward/TASK.md:165)), and confirmations are declared immutable ([TASK.md:246](/work/personal/compass/tasks/097-loss-carryforward/TASK.md:246)). Duplicate behavior and later portfolio-discrepancy semantics remain insufficient. |
| **M3 — contradictory lifecycle states** | **Partially resolved** | The checks prohibit declared derived rows and “timely” undeclared rows ([TASK.md:84](/work/personal/compass/tasks/097-loss-carryforward/TASK.md:84)). They still permit `source='user_filed', loss_declared_in_itr=false`, a state no planned operation legitimately creates. |
| **M4 — arbitrary FY materialization** | **Resolved** | The canonical operation returns 400 unless `fy === currentFy()` ([TASK.md:143](/work/personal/compass/tasks/097-loss-carryforward/TASK.md:143)), with a corresponding P7 test ([TASK.md:228](/work/personal/compass/tasks/097-loss-carryforward/TASK.md:228)). |
| **M5 — insufficient functional-core separation** | **Partially resolved** | A DB-free `capital-loss-math.ts` is now explicit ([TASK.md:108](/work/personal/compass/tasks/097-loss-carryforward/TASK.md:108)). But the new exact-first/advisory-second allocation and discrepancy logic remains assigned to the orchestration service in P3b, not the pure financial core ([TASK.md:221](/work/personal/compass/tasks/097-loss-carryforward/TASK.md:221)). |
| **M6 — safe-integer contracts** | **Not fully resolved** | The plan promises `SafePaiseSchema` for every paise field ([TASK.md:55](/work/personal/compass/tasks/097-loss-carryforward/TASK.md:55)), but cites a nonexistent path and still defines signed net paise outputs as bare `number` ([TASK.md:186](/work/personal/compass/tasks/097-loss-carryforward/TASK.md:186), [TASK.md:195](/work/personal/compass/tasks/097-loss-carryforward/TASK.md:195)). |
| **M7 — TDD checkbox convention** | **Resolved** | Acceptance criteria now use unchecked `- [ ] ACn:` entries ([TASK.md:230](/work/personal/compass/tasks/097-loss-carryforward/TASK.md:230)). |
| **L1 — zero-loss records** | **Resolved** | Both mutation paths omit/delete zero rows ([TASK.md:148](/work/personal/compass/tasks/097-loss-carryforward/TASK.md:148), [TASK.md:156](/work/personal/compass/tasks/097-loss-carryforward/TASK.md:156)). |
| **L2 — FY validation/boundaries** | **Resolved at the service boundary** | The plan requires `parseFy` for stored/accepted FYs and rejects origin years from 9991 onward ([TASK.md:61](/work/personal/compass/tasks/097-loss-carryforward/TASK.md:61), [TASK.md:124](/work/personal/compass/tasks/097-loss-carryforward/TASK.md:124)). |
| **L3 — exact response contracts** | **Not fully resolved** | Named shapes now exist ([TASK.md:170](/work/personal/compass/tasks/097-loss-carryforward/TASK.md:170)), but some fields are still unsafe or semantically ambiguous, and mutation response schemas are absent. |

# High findings

### H1 — The conserved target gain pool is undefined after CYLA

The actual capital-gains service returns signed, already-netted term totals named `shortTermGainPaise` and `longTermGainPaise` ([capital-gains.ts:135](/work/personal/compass/apps/api/src/modules/investments/services/capital-gains.ts:135)). It does not return separate gross gain and loss pools.

The plan merely says:

> “Fetch the `setoffFy` capital-gains statement’s STCG/LTCG” and ensure allocations do not exceed “the actual recorded gain for that FY.”

([TASK.md:166](/work/personal/compass/tasks/097-loss-carryforward/TASK.md:166))

That is insufficient. Confirmable BFLA destination capacity must be the residual after CYLA, not simply `max(0, shortTermGainPaise)` and `max(0, longTermGainPaise)` independently.

Example:

- Statement STCG = `-₹100`
- Statement LTCG = `+₹100`
- CY STCL consumes the LTCG.
- Confirmable BF LTCG capacity is therefore zero.

A raw-positive LTCG check would incorrectly permit another ₹100 BF allocation.

The plan must explicitly define, inside the confirmation transaction:

```text
statement
→ getCurrentFyLossInputs(statement)
→ computeSetOff(...)
→ targetStcgPool = CYLA.netStcg
→ targetLtcgPool = CYLA.netLtcg
```

Then enforce separately:

```text
Σ(stcl_to_stcg) + new.stcl_to_stcg <= targetStcgPool

Σ(stcl_to_ltcg + ltcl_to_ltcg)
  + new.stcl_to_ltcg
  + new.ltcl_to_ltcg
<= targetLtcgPool
```

The exact annual algorithm and confirmation validation must share this pure pool derivation.

### H2 — The exact-allocation discrepancy rule is internally contradictory

Under **“Codex Review-4 Findings — M2”**, the plan says a stored confirmed allocation is a real historical fact and must be surfaced:

> “rather than silently clamping, erroring, or hiding it”

([TASK.md:47](/work/personal/compass/tasks/097-loss-carryforward/TASK.md:47))

But the canonical annual algorithm says:

> “do not clamp or throw — apply what the pool can cover”

([TASK.md:133](/work/personal/compass/tasks/097-loss-carryforward/TASK.md:133))

“Apply what the pool can cover” is a clamp. The response contract then exposes only `stclAppliedPaise` and `ltclAppliedPaise` ([TASK.md:184](/work/personal/compass/tasks/097-loss-carryforward/TASK.md:184)), so it cannot distinguish:

- the stored filed amount;
- the amount supported by current Compass data;
- the unsupported discrepancy.

The plan must select one coherent policy. A suitable response would retain the filed fact and separately reconcile it:

```text
claimedStclToStcgPaise
claimedStclToLtcgPaise
claimedLtclToLtcgPaise
supported... fields
discrepancy... fields
```

The computed net pool should never go below zero, but the confirmed fact must not be silently replaced by its supported minimum.

# Medium findings

### M1 — Dated simulation cannot both “never read” allocations and warn when one exists

The canonical dated section says it:

> “NEVER reads `capital_loss_allocations` for exact application”

and immediately requires:

> “If a confirmed allocation exists … add an explicit `notes[]` entry”

([TASK.md:139](/work/personal/compass/tasks/097-loss-carryforward/TASK.md:139))

The route and AC5 strengthen this to “never reads confirmed allocations” ([TASK.md:212](/work/personal/compass/tasks/097-loss-carryforward/TASK.md:212), [TASK.md:235](/work/personal/compass/tasks/097-loss-carryforward/TASK.md:235)).

It must instead say: “reads only whether a same-FY confirmation exists for warning purposes; never reads or applies its destination amounts.”

### M2 — The lifecycle constraints remain one-directional

The schema permits:

```text
source = user_filed
loss_declared_in_itr = false
filed_within_due_date = false
```

Yet `source='user_filed'` is defined as an asserted filed balance, and `declareFiledLoss` always sets `loss_declared_in_itr=true`.

Add the reverse invariant, making filed source equivalent to declaration, for example:

```sql
CHECK (
  (source = 'user_filed') = loss_declared_in_itr
)
```

The existing timely-filing check remains appropriate because belated filed losses are a valid stored-but-ineligible state.

### M3 — The exact/advisory financial algorithm is still outside the functional core

The house convention requires allocation and tax rules to live in a pure module. P3a includes low-level `consume`, availability, and ordering, but P3b assigns the most error-prone new behavior—partitioning, exact-first application, discrepancy handling, and advisory simulation—to `capital-loss.ts` ([TASK.md:221](/work/personal/compass/tasks/097-loss-carryforward/TASK.md:221)).

Add pure functions such as:

```text
deriveCylaTargetPools(...)
validateConfirmedDestinationCapacity(...)
applyExactThenAdvisory(...)
reconcileConfirmedAllocation(...)
```

The service should only load rows, acquire locks, invoke these functions, and persist.

### M4 — Safe-integer compliance is contradicted by the response contract

The named source path is wrong: `SafePaiseSchema` is in [packages/shared/src/money.ts:12](/work/personal/compass/packages/shared/src/money.ts:12), not `packages/shared/src/schemas/money.ts` as stated at [TASK.md:55](/work/personal/compass/tasks/097-loss-carryforward/TASK.md:55).

More importantly, these paise fields remain bare numbers:

- `netStcgPaise: number`
- `netLtcgPaise: number`

([TASK.md:186](/work/personal/compass/tasks/097-loss-carryforward/TASK.md:186), [TASK.md:195](/work/personal/compass/tasks/097-loss-carryforward/TASK.md:195))

`SafePaiseSchema` already permits signed amounts, so these must use it too. Intermediate additions—especially the sum of two individually safe request amounts—must also be checked before use.

### M5 — Calling capital gains within the transaction requires a planned signature change

`getCapitalGains` currently accepts `Db`, not `DbOrTx` ([capital-gains.ts:51](/work/personal/compass/apps/api/src/modules/investments/services/capital-gains.ts:51)). A Drizzle transaction handle has the required query methods at runtime, so changing this to `DbOrTx` is straightforward, but it is an existing cross-module modification that P3/P6 do not name.

This should be explicit and tested so `confirmSetOff` does not accidentally query outside its transaction.

### M6 — “Actual gain pool” assumes Compass has a complete portfolio

The investments statement only includes holdings and events recorded in Compass ([capital-gains.ts:58](/work/personal/compass/apps/api/src/modules/investments/services/capital-gains.ts:58)). It is not an authoritative ITR-wide gain statement.

Therefore the hard 409 at [TASK.md:166](/work/personal/compass/tasks/097-loss-carryforward/TASK.md:166) can reject a valid filed allocation involving an external broker or missing historical data. That conflicts conceptually with treating confirmations as immutable filed facts.

The plan must either:

- explicitly require portfolio completeness before confirmation; or
- offer a clearly labeled user-asserted reconciliation override; or
- model an authoritative target-FY filed gain pool separately.

### M7 — Duplicate immutable confirmation behavior is unspecified

The database uniqueness constraint prevents a second `(loss_record_id, setoff_fy)` row ([TASK.md:97](/work/personal/compass/tasks/097-loss-carryforward/TASK.md:97)), but the service does not specify a controlled 409 before insertion. As written, a duplicate can escape as a raw unique-constraint error.

Immutability needs an explicit duplicate check/response and a test.

### M8 — Response contracts are still not exact enough

Remaining ambiguities include:

- whether `broughtForwardSummary.totalAvailable*` means pre-application opening or post-application remaining;
- whether `expiringLosses.remaining*` is before or after the current simulation;
- whether per-record applied figures are claimed or currently supported for discrepant confirmed rows;
- no response schemas for materialize, declare, or confirm mutations;
- `CapitalLossRecordListSchema.isEstimate` is permanently `true` even when every row is filed ([TASK.md:181](/work/personal/compass/tasks/097-loss-carryforward/TASK.md:181)), without explaining whether this represents the collection, its availability calculations, or row provenance.

### M9 — The lock key remains pseudocode

`hash(userId, fy)` is not a PostgreSQL or repository helper. The plan should prescribe one exact canonical helper used by all three mutation paths, such as a namespaced string passed to:

```sql
pg_advisory_xact_lock(hashtextextended(key_text, 0))
```

Namespacing and unambiguous separators should be defined. Hash collisions only cause extra serialization, not lost correctness, but different key construction between materialize and declare would reopen H4.

# Low findings

### L1 — PostgreSQL and Drizzle support the locking approach

PostgreSQL provides both the one-`bigint` and two-`integer` forms of `pg_advisory_xact_lock`; it waits for an exclusive transaction-level lock, and transaction-level advisory locks release automatically at transaction end. See the official [advisory-lock function documentation](https://www.postgresql.org/docs/current/functions-admin.html#FUNCTIONS-ADVISORY-LOCKS) and [explicit-locking documentation](https://www.postgresql.org/docs/current/explicit-locking.html#ADVISORY-LOCKS).

The repository already demonstrates:

- PostgreSQL advisory locking and database-side `hashtextextended` in [account-lock.ts:25](/work/personal/compass/apps/api/src/lib/account-lock.ts:25);
- `.for("update")` inside a Drizzle transaction in [accounts.ts:371](/work/personal/compass/apps/api/src/modules/ledger/services/accounts.ts:371);
- raw parameterized `tx.execute(sql\`...\`)` inside that transaction in [accounts.ts:460](/work/personal/compass/apps/api/src/modules/ledger/services/accounts.ts:460).

`account-lock.ts` uses a session-level lock because it has a different SERIALIZABLE snapshot requirement. This task’s transaction-level lock is appropriate under PostgreSQL’s normal `READ COMMITTED` behavior. The implementation should not change these transactions to repeatable-read/serializable without revisiting snapshot timing.

### L2 — The capital-gains data is available, with limitations

The service exposes:

- signed `shortTermGainPaise`;
- signed `longTermGainPaise`;
- dated slices containing `sellDate`, `gainPaise`, and term.

See [capital-gains.ts:135](/work/personal/compass/apps/api/src/modules/investments/services/capital-gains.ts:135) and [capital-gains.ts:137](/work/personal/compass/apps/api/src/modules/investments/services/capital-gains.ts:137).

That is enough for annual CYLA normalization and cutoff simulations. It is not enough to treat raw positive totals as the BFLA destination pool without running CYLA first, nor does it provide gross ITR-wide gains.

### L3 — Status metadata does not follow CLAUDE.md literally

[CLAUDE.md:9](/work/personal/compass/CLAUDE.md:9) says task status frontmatter is the source of truth, while TASK.md uses:

> `## Status` / `PLAN_REVIEW`

([TASK.md:3](/work/personal/compass/tasks/097-loss-carryforward/TASK.md:3))

Most neighboring task files use the same heading convention, so this appears to be a repository-documentation inconsistency rather than a task-097-only defect. It should be reconciled centrally rather than inventing a unique format here.

## Missing tests beyond P7

P7 is much stronger but should additionally include:

- CYLA-adjusted target-pool cases, particularly current STCL consuming target LTCG before BFLA confirmation;
- property/invariant coverage for exact-plus-advisory application: pools never become negative, applied destination totals reconcile, and source conservation holds over generated safe-integer inputs;
- discrepant confirmed allocation after portfolio data changes, asserting both claimed and supported amounts;
- controlled duplicate confirmation → 409;
- `declareFiledLoss` versus `confirmSetOff` race on an existing record;
- materialize-versus-materialize and declare-versus-declare absent-row races;
- rollback when allocation insertion or `updatedAt` touching fails;
- database rejection of every invalid lifecycle combination;
- safe-integer request boundaries, intermediate-sum overflow, SQL aggregate overflow, and signed response boundaries;
- malformed FY labels on all six routes;
- exact FY start/end dates, impossible cutoff dates, and leap-day cutoffs;
- no-gain, no-loss, only-STCL, only-LTCL, and both-pool cases;
- advisory-lock key equivalence between materialize and declare, plus isolation between different users;
- incomplete-portfolio/external-gain behavior, once the product policy is chosen;
- mutation response contract tests;
- migration checks for CHECK constraints, uniqueness, FK cascade, backup/restore order, barrel identity, decomposition count, and route snapshots.

## Unnecessary complexity

The three availability scopes remain justified.

The avoidable complexity is:

- `source` plus two booleans when a constrained filing-status enum could represent the lifecycle without invalid combinations;
- a free-form `notes[]` channel carrying machine-relevant discrepancy data;
- storing `expires_fy` without a database consistency invariant tying it to `origin_fy`;
- accepting `?fy=` on a materialize endpoint that only permits the server’s current FY;
- calling confirmed amounts “exact” while exposing only a possibly clamped applied total.

## Required changes before implementation

1. Define target gain capacity as the CYLA residual and validate STCG/LTCG destinations separately across all records.
2. Resolve the confirmed-discrepancy contradiction; expose claimed, supported, and discrepancy amounts explicitly.
3. Move exact/advisory application and target-pool validation into the DB-free math module.
4. Clarify that dated simulation may read confirmation existence but never applies confirmation amounts.
5. Complete the lifecycle invariant and specify duplicate-confirmation behavior.
6. Use the real `SafePaiseSchema` path and apply it to every signed and unsigned paise response.
7. Specify one canonical advisory-lock key helper and the `getCapitalGains(DbOrTx, ...)` change.
8. Decide how valid external/unrecorded gains can be represented.
9. Add the missing race, invariant, boundary, rollback, and discrepancy tests above.

**Explicit verdict: not implementation-ready.**