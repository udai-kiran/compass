## High

None.

## Medium

None.

## Low

None.

The K2 concurrency test now:

- Requires `row.chosen === chosenRegime`.
- Requires `row.inferredRegime === inferredRegime`.
- Requires `row.effective === row.chosen` and `row.source === "chosen"`.
- Runs 25 iterations and accurately documents the remaining probabilistic detection tradeoff.

These exact postconditions eliminate the loss-tolerant escapes. If a reverted read-modify-write loses either concurrent field, the corresponding equality assertion fails; it can no longer silently pass once the faulty interleaving occurs.

No other test in [regime-preference.test.ts](/work/personal/compass/apps/api/src/modules/tax/services/regime-preference.test.ts) appears weakened: the existing validation, idempotency, resolution-order, field-preservation, and user-isolation assertions remain intact.

**FINAL VERDICT: COMPLETE-ready for task 087.**