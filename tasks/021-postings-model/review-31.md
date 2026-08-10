**BLOCKING Findings**

1. [PLAN-pr-e.md](/work/personal/compass/tasks/021-postings-model/PLAN-pr-e.md:497) leaves the revised parity test plan incomplete for in-scope behavior.

The plan still does not cover the review-30 parity gaps the requester called out:

- PE1 only seeds “two expense transactions, one transfer-payment”; it does not cover split transaction display in `getCardActivity`.
- PE5 seeds a split transaction but only asserts result count, not the displayed split amount.
- PE8 only verifies `applyMapping`; it still does not exercise the `commitImport` credit-card reconciliation read path, even though PE8 explicitly converts that path at [PLAN-pr-e.md](/work/personal/compass/tasks/021-postings-model/PLAN-pr-e.md:407).

That makes the PR-E implementation incomplete against its own parity-test scope. The PE8 gap is especially material because the converted `commitImport` reconciliation query drives matching/update decisions, not just display.