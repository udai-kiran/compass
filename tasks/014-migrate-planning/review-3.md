## BLOCKING

### B1 — T17 still does not fully establish AC12

AC12 requires **every relative import specifier** to resolve to an existing file ([TASK.md:306](/home/udai/PennyPilot/tasks/014-migrate-planning/TASK.md:306)). T17’s enumerated syntax covers:

- `… from "./x.ts"` — including `import type`
- `export … from "./x.ts"`
- literal `import("./x.ts")`

But it omits side-effect imports such as:

```ts
import "./setup.ts";
```

The current tree has no relative side-effect imports, but T17 is intended as a post-migration general proof, so its extractor must explicitly include that form ([TASK.md:334](/home/udai/PennyPilot/tasks/014-migrate-planning/TASK.md:334)).

The resolver semantics also need one clarification. A candidate must be a **regular file**, not merely an existing filesystem path. Otherwise a directory specifier could pass because the directory exists even though it does not resolve to a file. If directory/index and extensionless support is intentional, T17 should explicitly try defined candidates such as the exact path, supported extensions, and `index.ts`, accepting only a file. The API uses NodeNext resolution ([tsconfig.base.json:5](/home/udai/PennyPilot/tsconfig.base.json:5), [tsconfig.base.json:6](/home/udai/PennyPilot/tsconfig.base.json:6)) and normally uses explicit `.ts` extensions ([CLAUDE.md:7](/home/udai/PennyPilot/CLAUDE.md:7)).

Non-relative workspace imports such as `@compass/shared` must remain excluded; they are package specifiers, not paths relative to the importer. Type-only imports must remain included because they are still statically resolved.

I ran the equivalent comprehensive check over the present tree, with file-only resolution and candidates for exact paths, TypeScript/JavaScript extensions, and directory indexes:

- 223 TypeScript files scanned
- 686 relative static specifiers scanned
- 0 unresolvable relative specifiers

Therefore T17’s pre-migration expectation of zero is achievable on the current tree ([TASK.md:337](/home/udai/PennyPilot/tasks/014-migrate-planning/TASK.md:337), [TASK.md:339](/home/udai/PennyPilot/tasks/014-migrate-planning/TASK.md:339)). The blocker is the stated checker’s incomplete syntax coverage and underspecified file resolution, not an existing broken import.

## Non-blocking

### 1. CLAUDE.md:49 is characterized correctly and completely

The actual guidance says both that the barrel “re-exports each module’s `schema.ts`” and that every module schema imports `db/core-schema.ts` ([CLAUDE.md:49](/home/udai/PennyPilot/CLAUDE.md:49)).

Both halves of F16 are correct:

- The only module-schema re-export currently present in the barrel is planning’s ([db/schema.ts:22](/home/udai/PennyPilot/apps/api/src/db/schema.ts:22)). D1 removes it ([TASK.md:128](/home/udai/PennyPilot/tasks/014-migrate-planning/TASK.md:128)), after which the barrel re-exports no module schema.
- Ledger, credit, investments, and protection are thin named re-exports from `db/schema.ts`, not importers of `core-schema.ts`: [ledger/schema.ts:27](/home/udai/PennyPilot/apps/api/src/modules/ledger/schema.ts:27), [credit/schema.ts:26](/home/udai/PennyPilot/apps/api/src/modules/credit/schema.ts:26), [investments/schema.ts:28](/home/udai/PennyPilot/apps/api/src/modules/investments/schema.ts:28), and [protection/schema.ts:25](/home/udai/PennyPilot/apps/api/src/modules/protection/schema.ts:25). Planning is presently the sole exception ([planning/schema.ts:2](/home/udai/PennyPilot/apps/api/src/modules/planning/schema.ts:2)), and P2 converts it to the same thin-re-export pattern ([TASK.md:221](/home/udai/PennyPilot/tasks/014-migrate-planning/TASK.md:221)).

I found no other live-guidance sentence in `CLAUDE.md` that this revision newly falsifies. The general `app.ts` description is already imprecise because completed modules are plugin-registered ([CLAUDE.md:43](/home/udai/PennyPilot/CLAUDE.md:43)); planning does not newly create that discrepancy. The database guidance that the aggregate schema is in `db/schema.ts` remains true ([CLAUDE.md:72](/home/udai/PennyPilot/CLAUDE.md:72)).

Not committing exact replacement prose before implementation is acceptable. F16, Scope, P2, and AC13 identify the false propositions that must be removed ([TASK.md:112](/home/udai/PennyPilot/tasks/014-migrate-planning/TASK.md:112), [TASK.md:205](/home/udai/PennyPilot/tasks/014-migrate-planning/TASK.md:205), [TASK.md:311](/home/udai/PennyPilot/tasks/014-migrate-planning/TASK.md:311)). The implementer can choose concise accurate wording during the documentation edit.

### 2. D3 matches repository practice

The completed task records describe the architecture implemented at their respective times and are used as historical rationale. For example, the current ledger schema explicitly points readers back to task 1.1’s root-cause record ([ledger/schema.ts:4](/home/udai/PennyPilot/apps/api/src/modules/ledger/schema.ts:4)), while the live task-1.9 roadmap carries the forward-looking physical-decomposition policy ([01.09-cross-module-ports.md:16](/home/udai/PennyPilot/tasks/01.09-cross-module-ports.md:16), [01.09-cross-module-ports.md:20](/home/udai/PennyPilot/tasks/01.09-cross-module-ports.md:20)).

Tasks 1.1–1.4 followed this division: completed implementation records were retained, while live roadmap guidance was updated. Task 1.1’s live roadmap entry, for example, records the transitional thin-schema result and points forward to task 1.9 ([01.01-migrate-ledger.md:14](/home/udai/PennyPilot/tasks/01.01-migrate-ledger.md:14)).

Nothing D3 classifies as untouchable history is functioning as current repository guidance. The live sources that do require correction—`CLAUDE.md`, source comments, and todo roadmap files—are correctly separated at [TASK.md:178](/home/udai/PennyPilot/tasks/014-migrate-planning/TASK.md:178) through [TASK.md:190](/home/udai/PennyPilot/tasks/014-migrate-planning/TASK.md:190).

### 3. P2’s insertion point is correct

Line 747 is exactly the closing `);` of `subscriptionDismissals` ([db/schema.ts:736](/home/udai/PennyPilot/apps/api/src/db/schema.ts:736), [db/schema.ts:747](/home/udai/PennyPilot/apps/api/src/db/schema.ts:747)). Line 748 is blank, and the next declaration starts at line 749 ([db/schema.ts:749](/home/udai/PennyPilot/apps/api/src/db/schema.ts:749)). The insertion therefore lands between two complete declarations, outside any comment block.

It is syntactically valid. `projectionSettings` depends only on `users`, which is imported before all table declarations ([planning/schema.ts:2](/home/udai/PennyPilot/apps/api/src/modules/planning/schema.ts:2), [planning/schema.ts:5](/home/udai/PennyPilot/apps/api/src/modules/planning/schema.ts:5)). It neither depends on nor is referenced by intervening schema declarations. Existing planning relationships already follow valid dependency order: `budgets` precedes `budgetLines` ([db/schema.ts:563](/home/udai/PennyPilot/apps/api/src/db/schema.ts:563), [db/schema.ts:579](/home/udai/PennyPilot/apps/api/src/db/schema.ts:579)); `goals` is complete before `subscriptionDismissals` ([db/schema.ts:693](/home/udai/PennyPilot/apps/api/src/db/schema.ts:693), [db/schema.ts:736](/home/udai/PennyPilot/apps/api/src/db/schema.ts:736)). Inserting the independent projection table at line 748 changes none of those relationships.

T18’s extract-and-diff proof is appropriate for the promised character-identical move ([TASK.md:216](/home/udai/PennyPilot/tasks/014-migrate-planning/TASK.md:216), [TASK.md:341](/home/udai/PennyPilot/tasks/014-migrate-planning/TASK.md:341)).

### 4. T15’s 24 deleted paths are exactly correct

The real deletion set is seven route files:

- `apps/api/src/routes/budgets.ts`
- `apps/api/src/routes/goals.ts`
- `apps/api/src/routes/cashflow.ts`
- `apps/api/src/routes/bills.ts`
- `apps/api/src/routes/dashboard.ts`
- `apps/api/src/routes/insights.ts`
- `apps/api/src/routes/reports.ts`

Eleven service files:

- `apps/api/src/services/budgets.ts`
- `apps/api/src/services/goals.ts`
- `apps/api/src/services/goal-allocation.ts`
- `apps/api/src/services/goal-plan.ts`
- `apps/api/src/services/goal-projection.ts`
- `apps/api/src/services/goal-returns.ts`
- `apps/api/src/services/cashflow.ts`
- `apps/api/src/services/bills.ts`
- `apps/api/src/services/dashboard.ts`
- `apps/api/src/services/insights.ts`
- `apps/api/src/services/reports.ts`

And six colocated tests:

- `apps/api/src/services/goal-allocation.test.ts`
- `apps/api/src/services/goal-plan.test.ts`
- `apps/api/src/services/goal-projection.test.ts`
- `apps/api/src/services/goal-returns.test.ts`
- `apps/api/src/services/insights.test.ts`
- `apps/api/src/services/reports.test.ts`

This exactly matches D2’s 7 + 11 + 6 accounting ([TASK.md:161](/home/udai/PennyPilot/tasks/014-migrate-planning/TASK.md:161) through [TASK.md:168](/home/udai/PennyPilot/tasks/014-migrate-planning/TASK.md:168)). No path is misnamed or miscounted. T15’s explicit per-path assertion is sufficient once instantiated with this set ([TASK.md:331](/home/udai/PennyPilot/tasks/014-migrate-planning/TASK.md:331)).

### 5. AC7 remains correct

This revision adds no further `test()` cases. The planned additions remain:

- 3 schema-smoke cases ([TASK.md:224](/home/udai/PennyPilot/tasks/014-migrate-planning/TASK.md:224))
- 1 plugin case ([TASK.md:242](/home/udai/PennyPilot/tasks/014-migrate-planning/TASK.md:242))
- 2 demo-route cases ([TASK.md:244](/home/udai/PennyPilot/tasks/014-migrate-planning/TASK.md:244))

Thus AC7’s `842 → 848 (+6)` remains arithmetically correct ([TASK.md:292](/home/udai/PennyPilot/tasks/014-migrate-planning/TASK.md:292)).

No other new regression was introduced by this revision.

The plan is **not implementation-ready** until T17 explicitly covers side-effect imports and defines file-only resolution behavior.