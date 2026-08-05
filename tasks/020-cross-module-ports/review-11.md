No blocking or non-blocking findings.

Verified:

- [CLAUDE.md:49](/home/udai/PennyPilot/CLAUDE.md:49) accurately distinguishes FK-target imports from module-surface re-exports. The investments, credit, automation, and ledger schemas match the stated examples; no residual equivalence overclaim remains.
- [ledger/plugin.ts:17](/home/udai/PennyPilot/apps/api/src/modules/ledger/plugin.ts:17) correctly states 6 resident tables, no resident enums, and shared-layer surface re-exports.
- [investments/plugin.ts:10](/home/udai/PennyPilot/apps/api/src/modules/investments/plugin.ts:10) correctly states 6 resident tables, 4 resident enums, and shared-layer surface re-exports.
- [core-schema.ts:3](/home/udai/PennyPilot/apps/api/src/db/core-schema.ts:3) correctly attributes `users` FK definitions to shared layers and module schemas. [db/schema.ts:1](/home/udai/PennyPilot/apps/api/src/db/schema.ts:1) is a pure re-export barrel and contains no `.references()` call.
- The corrected smoke-test comment blocks accurately describe export surfaces:
  - [ledger/schema.smoke.test.ts:6](/home/udai/PennyPilot/apps/api/src/modules/ledger/schema.smoke.test.ts:6): 11 tables / 7 enums; 6 resident tables / 0 resident enums.
  - [investments/schema.smoke.test.ts:6](/home/udai/PennyPilot/apps/api/src/modules/investments/schema.smoke.test.ts:6): 8 / 10; 6 resident tables / 4 resident enums.
  - [ingest/schema.smoke.test.ts:9](/home/udai/PennyPilot/apps/api/src/modules/ingest/schema.smoke.test.ts:9): 7 / 8; 5 resident tables / 4 resident enums.
  - [planning/schema.smoke.test.ts:9](/home/udai/PennyPilot/apps/api/src/modules/planning/schema.smoke.test.ts:9): 6 / 2; 5 resident tables / 1 resident enum (`budgetPeriod`).
  - [protection/schema.smoke.test.ts:6](/home/udai/PennyPilot/apps/api/src/modules/protection/schema.smoke.test.ts:6): 3 / 4; 2 resident tables / 0 resident enums.
- The automation, credit, and system smoke-test comments remain accurate against their physical definitions.
- Across all eight smoke tests, the diff changes only introductory comment blocks. No imports, test code, assertions, `TABLE_NAMES`, or `ENUM_NAMES` lists were altered.

F1 and the intentionally excluded CLAUDE.md line 42 language were not re-reviewed.