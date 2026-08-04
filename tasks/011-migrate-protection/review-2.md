# Verdict: NOT IMPLEMENTATION-READY

B2 and all requested non-blocking corrections are resolved. B1 is now handled transparently rather than silently weakened, but the new task is not yet sufficiently gated or specified to ensure the deferred verification actually happens before Phase 1 closes.

## Blocking finding

### B1: the carve-out is honest, but its roadmap placement and specification leave an escape hatch

Amending the original criterion is an honest resolution in principle. The revised plan explicitly says task 1.4 does not prove disk/S3 behavior and makes completion conditional on amending the roadmap plus creating and indexing task 1.10:

- Scope decision: [TASK.md](/home/udai/PennyPilot/tasks/011-migrate-protection/TASK.md:51)
- Planned roadmap edits: [TASK.md](/home/udai/PennyPilot/tasks/011-migrate-protection/TASK.md:386)
- AC2 tracking requirement: [TASK.md](/home/udai/PennyPilot/tasks/011-migrate-protection/TASK.md:396)
- T14 verification: [TASK.md](/home/udai/PennyPilot/tasks/011-migrate-protection/TASK.md:460)

The amendment/task/index files do not exist yet, but that is expected because nothing has been implemented. P12 and AC2 correctly require all three outputs before 1.4 can become `done`.

The unresolved problem is sequencing:

- Task 1.9 explicitly “Closes Phase 1” at [tasks/01.09-cross-module-ports.md](/home/udai/PennyPilot/tasks/01.09-cross-module-ports.md:10).
- It currently depends on tasks 1.1–1.8, including 1.4, but not 1.10: [tasks/01.09-cross-module-ports.md](/home/udai/PennyPilot/tasks/01.09-cross-module-ports.md:7).
- Phase 2 begins after 1.9; task 2.1 depends only on 1.9: [tasks/02.01-postings-model.md](/home/udai/PennyPilot/tasks/02.01-postings-model.md:7).
- P12 proposes placing 1.10 “next to 1.9,” while giving it only `depends: [1.4]`: [TASK.md](/home/udai/PennyPilot/tasks/011-migrate-protection/TASK.md:337), [TASK.md](/home/udai/PennyPilot/tasks/011-migrate-protection/TASK.md:386).

Consequently, 1.9 can close Phase 1 and unblock Phase 2 while 1.10 remains `todo`. Calling 1.10 “phase 1 / release 2.0.0” does not itself enforce completion.

Concrete correction:

- Add 1.10 before 1.9 in `tasks/README.md`.
- Retain `1.10 depends: [1.4]`.
- Amend task 1.9 to depend on 1.10 as well.
- Retain the statement that 1.9 closes Phase 1.

The proposed 1.10 content is also too weakly constrained. P12 requires only “the stated frontmatter,” while AC2 checks merely that the file exists and is indexed. That permits an effectively empty parking-lot task. Require the new file to contain concrete acceptance criteria covering:

- Both real backends: temporary disk storage and an S3-compatible backend.
- Both protection resource types: policy documents and health cards.
- At least upload and byte-identical download for each resource type against each backend.
- Backend setup/teardown and the command or CI environment used to run the contract.
- A failure if either backend is skipped or silently replaced by a mock.

That would make the deferral actionable and preserve the substance of the original criterion.

One factual wording correction is also needed: “no storage test of any kind exists” at [TASK.md](/home/udai/PennyPilot/tasks/011-migrate-protection/TASK.md:30) and [TASK.md](/home/udai/PennyPilot/tasks/011-migrate-protection/TASK.md:340) is literally false. `backup.test.ts` contains a typed `Storage` stub and exercises backup/restore flows with it at [backup.test.ts](/home/udai/PennyPilot/apps/api/src/services/backup.test.ts:272). The accurate claim is: “no disk-or-S3 backend contract test exists.” This does not remove the need for 1.10, but it should be stated precisely.

## B2: resolved — +5 and 842 are correct

The coordinator’s correction is right.

Each precedent smoke file contains two `test(...)` cases:

- Credit: [schema.smoke.test.ts](/home/udai/PennyPilot/apps/api/src/modules/credit/schema.smoke.test.ts:25) and [schema.smoke.test.ts](/home/udai/PennyPilot/apps/api/src/modules/credit/schema.smoke.test.ts:35)
- Ledger: [schema.smoke.test.ts](/home/udai/PennyPilot/apps/api/src/modules/ledger/schema.smoke.test.ts:36) and [schema.smoke.test.ts](/home/udai/PennyPilot/apps/api/src/modules/ledger/schema.smoke.test.ts:46)
- Investments: [schema.smoke.test.ts](/home/udai/PennyPilot/apps/api/src/modules/investments/schema.smoke.test.ts:36) and [schema.smoke.test.ts](/home/udai/PennyPilot/apps/api/src/modules/investments/schema.smoke.test.ts:46)

Protection therefore adds:

- 2 schema-smoke cases
- 1 plugin case
- 2 demo-403 cases

That is exactly +5. Given the measured 837 baseline, 842 is the correct expected count. AC5 states this correctly at [TASK.md](/home/udai/PennyPilot/tasks/011-migrate-protection/TASK.md:409), including the appropriate requirement to remeasure immediately before implementation.

## Non-blocking dispositions

All requested corrections were applied faithfully:

- NB1: the raw route-table snapshot is expected byte-identical, with an empty diff explicitly treated as correct: [TASK.md](/home/udai/PennyPilot/tasks/011-migrate-protection/TASK.md:266), [TASK.md](/home/udai/PennyPilot/tasks/011-migrate-protection/TASK.md:331), [TASK.md](/home/udai/PennyPilot/tasks/011-migrate-protection/TASK.md:374).
- NB2: the inventory now says “54 matching lines” and “65 identifier tokens”: [TASK.md](/home/udai/PennyPilot/tasks/011-migrate-protection/TASK.md:176).
- NB3: the wording is now “must not change” and correctly attributes enforcement to the canonical snapshot: [TASK.md](/home/udai/PennyPilot/tasks/011-migrate-protection/TASK.md:261).
- NB4: the plan now identifies all four ledger-service import statements: one route-to-attachments edge and three service edges.
- NB5: the PPF fixture is correctly described as strengthening the mutation assertion, not as necessary to obtain the 403.
- NB6: accepted. Retaining the no-storage-decoration warning is justified. If demo protection regresses, a missing storage decoration makes the insurance request fail loudly instead of allowing a permissive stub to mask execution past the guard. The paragraph protects the intended failure mode and does not create implementation risk.

No other new blocking issue was found in Scope, AC5, T14, or the Non-Goals. The remaining blocker is the enforceability and concrete content of the 1.10 carve-out.