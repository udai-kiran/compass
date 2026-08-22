Verdict: **REJECT**

The chooser fixes the reported rollback path, but the plan still permits cross-unit consumption-rate data to be applied to pantry stock. That needs a design decision before implementation.

## High

- **Mixed-unit observations can still corrupt pantry decay calculations.** The plan inserts every unit observation before calling `replenishPantry`. That function calls `learnConsumptionRate()` ([pantry-management.ts](/work/personal/compass/apps/api/src/modules/shopping/services/pantry-management.ts:148)), which uses only `catalog.unit` as its target. When the catalog unit is null, it chooses the most frequent observation unit ([consumption-rate.ts](/work/personal/compass/apps/api/src/modules/shopping/services/consumption-rate.ts:62)). It does not consider the existing pantry unit.

  Therefore, with pantry `g`, catalog null, and mixed `g`/`ml` observations, the chooser can correctly replenish `g` while learning/upserting an `ml` habit profile ([consumption-rate.ts](/work/personal/compass/apps/api/src/modules/shopping/services/consumption-rate.ts:209)). A later `g` replenishment then applies that `ml` consumption rate to gram stock because `replenishPantry` never validates `habit.unit` ([pantry-management.ts](/work/personal/compass/apps/api/src/modules/shopping/services/pantry-management.ts:94)). This avoids the 400 but leaves dimensionally invalid pantry quantities and depletion dates.

  F6c must define the learning-unit rule. The natural rule is the same precedence as replenishment: catalog unit, otherwise existing pantry unit, otherwise a deterministic observation unit. This can be implemented in `consumption-rate.ts` without changing `pantry-management.ts`, but it expands the proposed scope and needs tests.

## Medium

- **The batch lookups do not guarantee that `replenishPantry` cannot still return a unit-mismatch 400.** The two explicit 400 paths are catalog mismatch ([pantry-management.ts](/work/personal/compass/apps/api/src/modules/shopping/services/pantry-management.ts:80)) and existing-pantry mismatch ([pantry-management.ts](/work/personal/compass/apps/api/src/modules/shopping/services/pantry-management.ts:90)). The chooser covers both for the values observed by its batch queries, but those reads are not locked or otherwise coupled to the later reads inside `replenishPantry`. A concurrent catalog edit, pantry correction, or pantry creation can change the unit between selection and replenishment.

  Worse, concurrent creation after `replenishPantry`’s own “no existing row” read can reach its upsert and overwrite the competing pantry unit without producing a 400. The plan should either explicitly declare concurrent pantry/catalog mutation out of F6c scope or specify serialization/retry behavior. It should not claim that the chooser makes the call universally non-throwing.

- **`orderBy position` alone is not a stable total order.** `receipt_lines.position` is nonnegative but not unique ([schema.ts](/work/personal/compass/apps/api/src/modules/shopping/schema.ts:421)). Duplicate positions are therefore valid database state, even if normal creation usually assigns increasing values. Use `position, id` as the order, matching the established list-item convention. Without a tie-breaker, “first compatible” can still vary.

- **The existing catalog lookup remains unscoped by `userId`.** It currently filters only with `inArray(ci.id, catalogIds)` ([receipt-confirm.ts](/work/personal/compass/apps/api/src/modules/shopping/services/receipt-confirm.ts:168)). Reusing it unchanged violates the repository rule that all user data queries remain user-scoped. Both catalog and pantry batch queries should include `userId`. If an aggregate has no owned catalog result, it should not be treated as “catalog unit null” and sent to `replenishPantry`, where the ownership guard would abort confirmation with 404.

- **The proposed tests do not cover the High-severity learner interaction.** Add coverage showing that catalog null + existing pantry `g` + mixed observations cannot produce an `ml` habit profile or apply an `ml` rate to gram pantry stock. A pure target-unit resolver can provide DB-free coverage; a narrow real-DB service test would give stronger protection without requiring a full confirm integration suite.

## Low

- **The six chooser cases omit basic boundaries.** Add:

  - empty items → null;
  - catalog and pantry both `g`, matching and nonmatching aggregates → `g`;
  - catalog and pantry both `g`, no matching aggregate → null;
  - preferred match appearing after other aggregates;
  - returned value is the original aggregate, preserving its total quantity and metadata.

- **The existing local aggregation test should be removed or replaced.** It claims to test aggregation “by catalogItemId” and implements a local single-key algorithm ([receipt-confirm.test.ts](/work/personal/compass/apps/api/src/modules/shopping/services/receipt-confirm.test.ts:80)), while production now aggregates by `catalogItemId:unit` ([receipt-confirm.ts](/work/personal/compass/apps/api/src/modules/shopping/services/receipt-confirm.ts:143)). It is a false characterization of F6 and should not remain alongside the new real-helper tests.

- **P2 and P4 have no direct regression coverage.** The pure chooser tests prove selection semantics but do not prove that all unit aggregates are inserted, only one pantry call occurs per catalog item, null choices skip the call, or the pantry unit is actually supplied to the chooser. The earlier decision to defer a full confirm integration suite is reasonable, but this residual risk should be stated explicitly rather than treating the chooser tests as coverage of the complete wiring.

- **The extra `pantryChoiceMap` is unnecessary.** Once items are grouped by catalog ID, the code can choose and replenish in that loop. A second map adds state without adding behavior. This is minor and not a correctness problem.

- **Keep the chooser narrowly typed.** Use the existing normalized-unit union and `null` explicitly for both stored units. Avoid accepting arbitrary strings or silently treating missing catalog rows as a null catalog unit. This is an internal service rule, so moving it to shared contracts is unnecessary.

## Product choice

**Catalog/pantry conflict should skip pantry replenishment rather than fail confirmation.** Receipt confirmation’s authoritative effects are the user-approved ledger entry and purchase observations; rolling all of those back because pre-existing ancillary pantry metadata conflicts would be disproportionate. The conflict should ideally be observable through a warning or repair path, but it should not abort confirmation.

The compatibility predicate and conflict result are otherwise correct: catalog `g` plus pantry `ml` has no unit that can satisfy both, so returning null is appropriate.

## Sufficiency summary

- Batch pantry lookup: sufficient for ordinary pre-existing state, provided it is user-scoped and missing owned catalog rows are handled; not sufficient as a concurrency guarantee.
- `orderBy position`: insufficient for a formally stable order; add `id` as a tie-breaker.
- Chooser truth table: correct for replenishment selection.
- Overall F6c plan: incomplete until the consumption learner’s target unit and the concurrency limitation are addressed.