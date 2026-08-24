## Medium

- **K2 — NOT RESOLVED.** The concurrency test permits either submitted value to disappear:
  - `chosen === null || chosen === chosenRegime` at [regime-preference.test.ts:253](/work/personal/compass/apps/api/src/modules/tax/services/regime-preference.test.ts:253)
  - `inferredRegime === null || inferredRegime === inferredRegime` at [regime-preference.test.ts:257](/work/personal/compass/apps/api/src/modules/tax/services/regime-preference.test.ts:257)

  This contradicts the comment that both writes should succeed at [regime-preference.test.ts:250](/work/personal/compass/apps/api/src/modules/tax/services/regime-preference.test.ts:250). A reverted read-modify-write implementation could lose either concurrent field and still pass.

  The effective/source assertions at [regime-preference.test.ts:262](/work/personal/compass/apps/api/src/modules/tax/services/regime-preference.test.ts:262) are a genuine resolution invariant, but only for the partial state that survived. They do not establish the required postcondition that both `chosen` and `inferredRegime` equal their submitted values.

  There are no sleeps, deadlines, or scheduling assumptions, so correct code should not fail due to timing. However, detection of the old race is timing-dependent and unreliable: ten `Promise.all` attempts at [regime-preference.test.ts:231](/work/personal/compass/apps/api/src/modules/tax/services/regime-preference.test.ts:231) may miss the vulnerable interleaving, and even an observed lost update is explicitly accepted.

## High

- None.

## Low

- None.

## Resolved items

- **K1 — RESOLVED.** `regimeSourceEnum` is included in `taxResidents` at [schema.decomposition.test.ts:84](/work/personal/compass/apps/api/src/db/schema.decomposition.test.ts:84) and in the enum identity map at [schema.decomposition.test.ts:270](/work/personal/compass/apps/api/src/db/schema.decomposition.test.ts:270). The decomposition suite passes.

- **K3 — RESOLVED.** The test mocks only the service before importing the real route plugin at [regime-preference.hermetic.test.ts:40](/work/personal/compass/apps/api/src/modules/tax/routes/regime-preference.hermetic.test.ts:40) and registers that real plugin at [regime-preference.hermetic.test.ts:71](/work/personal/compass/apps/api/src/modules/tax/routes/regime-preference.hermetic.test.ts:71). It correctly verifies:
  - invalid GET → 400 at [line 81](/work/personal/compass/apps/api/src/modules/tax/routes/regime-preference.hermetic.test.ts:81)
  - invalid PUT → 400 at [line 93](/work/personal/compass/apps/api/src/modules/tax/routes/regime-preference.hermetic.test.ts:93)
  - valid GET → 200 with schema-valid response at [line 110](/work/personal/compass/apps/api/src/modules/tax/routes/regime-preference.hermetic.test.ts:110)

  All three cases pass locally.

- **K5 — RESOLVED.** The comment now records presidential assent on 30 March 2026 at [tax-rules.ts:361](/work/personal/compass/apps/api/src/lib/tax-rules.ts:361).

- **K4 rationale — ACCEPTABLE under G9.** G9 expressly allowed omission with a documented rationale. The rationale at [TASK.md:184](/work/personal/compass/tasks/087-tax-rule-data/TASK.md:184) identifies demo rejection as a global mutating-method auth invariant, making a tax-route-specific demo test duplicative rather than route-specific coverage.

## Final verdict

**Not COMPLETE-ready.** K1, K3, K4, and K5 are resolved, but K2 remains blocking. The concurrency test must require both settled fields exactly:

```ts
assert.equal(row.chosen, chosenRegime);
assert.equal(row.inferredRegime, inferredRegime);
```

followed by the chosen/effective/source consistency assertions. To convincingly catch the reverted read-modify-write race without probabilistic scheduling, the test also needs a deterministic synchronization/interleaving mechanism rather than relying solely on ten uncontrolled `Promise.all` iterations.