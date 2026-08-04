## Plan review

Overall: the documentation change is warranted, and the concrete current-code examples are correct. However, I would revise the draft before implementation. There are two substantive wording issues and one verification issue caused by the already-dirty worktree.

### (a) Factual accuracy

The concrete schema claims are true:

- `apps/api/src/modules/planning/schema.ts` physically defines `projection_settings` through a real `pgTable("projection_settings", ...)` call.
- `apps/api/src/modules/ledger/schema.ts` contains no `pgTable()` or `pgEnum()` definitions. It is a thin named re-export of ledger tables and enums from `../../db/schema.ts`.
- `apps/api/src/modules/credit/schema.ts` follows the same thin named re-export pattern and contains no physical table or enum definitions.
- `tasks/01.09-cross-module-ports.md` explicitly owns:
  - producing the complete cross-module FK graph and SCC decomposition;
  - assigning physical definitions to modules where acyclic;
  - defining a policy for cyclic SCCs;
  - converting or removing every transitional thin surface introduced by tasks 1.1–1.8.

One claim is slightly too strong: task 1.9 does not promise that literally every thin surface will become a module-local physical owner. Its exact promise is that every thin surface will be “converted to physical ownership or removed,” while definitions in cyclic SCCs may live in a shared schema file. The draft should say task 1.9 “resolves every remaining thin surface through physical decomposition or removal,” not simply “converts every remaining thin surface to physical ownership.”

### (b) Relationship to the existing `CLAUDE.md`

The new material is not redundant with the general “Transitional module scaffold” bullet. That bullet explains the module directory and registration transition, while the proposed paragraph explains the distinct physical-schema-versus-access-surface convention requested by the original ledger review.

There is, however, a real contradiction with the existing bullet’s absolute wording:

> `db/schema.ts` stays the schema barrel — it re-exports each module's `schema.ts` — and both it and every `modules/<domain>/schema.ts` import shared identity tables from `db/core-schema.ts`

That accurately describes a physically owned slice such as planning, but not the current ledger or credit surfaces:

- Ledger and credit re-export from `db/schema.ts` in the opposite direction.
- `db/schema.ts` must not re-export those thin surfaces back.
- Neither thin schema file imports `db/core-schema.ts`.

A paragraph that merely says there are two kinds of schema files leaves the earlier absolute statement visibly false. This is the main documentation concern.

The cleanest solution would be to adjust the existing scaffold bullet so its barrel/core-schema statement is explicitly limited to physically owned slices, then add the short paragraph under “Database & migrations.” If the one-paragraph/no-other-line scope must remain rigid, the paragraph should explicitly qualify the earlier statement, for example: “The barrel and `core-schema.ts` convention described above applies to physically owned slices; transitional thin surfaces instead re-export named definitions from `db/schema.ts` and are not re-exported back.” That resolves the contradiction without editing the earlier bullet, although editing the bullet itself would produce clearer documentation.

### (c) Whether credit should be named

Yes. `modules/credit/schema.ts` should be named explicitly.

It is a second live example of the same convention and proves that ledger is not a one-off exception. Mentioning it is neither redundant nor excessive in a paragraph whose purpose is to document the current repository state. It also faithfully updates the original task 1.1 concern after task 1.2 landed.

### (d) Wording and placement

Placement under `## Database & migrations` is appropriate. Putting it immediately after the first Drizzle/schema bullet would be better than placing it after all four bullets: the paragraph directly qualifies “schema in `apps/api/src/db/schema.ts`,” while the intervening migration-role, backup, and storage bullets are unrelated.

Recommended wording changes:

- Replace “because that module’s FK graph isn’t acyclic with the still-flat tables yet.” A module does not independently have an “acyclic FK graph,” and ordinary FK direction is not by itself the issue. The problem is that physically splitting definitions can create bidirectional ES-module dependencies while related definitions remain flat. Suggested wording: “where physical relocation would currently create cross-file dependency cycles with still-flat schema definitions.”
- Remove “and every module still to migrate in tasks 1.3–1.8.” Task 1.9 says those migrations are expected to introduce thin surfaces for at least some tables; it does not establish that every future module schema will be wholly thin. Future files also are not current examples.
- Replace “converts every remaining thin surface to physical ownership” with “resolves every remaining thin surface through physical decomposition or removal.”
- Prefer real identifiers and full paths consistently. `projection_settings` is the SQL table name, while `projectionSettings` is the exported TypeScript symbol. Naming both once would be maximally precise.
- The illustrative `export { table } ...` is understandable, but `table` is not a real export. “a named `export { ... } from "../../db/schema.ts"`” avoids looking like copyable code.
- Consider avoiding “0.3’s” in enduring repository guidance. The actual file and table are more useful to future contributors than a historical task number.

A tighter version would be:

> **Schema ownership is transitional during Phase 1 module migration.** Physically owned slices contain their real `pgTable()`/`pgEnum()` definitions—for example, `modules/planning/schema.ts` defines `projectionSettings` (`projection_settings`)—and are re-exported by `db/schema.ts`. Transitional access surfaces such as `modules/ledger/schema.ts` and `modules/credit/schema.ts` instead use named re-exports for definitions that still live in `db/schema.ts`, where relocating them now would create cross-file dependency cycles; they are not re-exported back through the barrel. `tasks/01.09-cross-module-ports.md` resolves all remaining thin surfaces through FK-graph/SCC-guided physical decomposition or removal, so a named `export { ... } from "../../db/schema.ts"` in a module schema is expected until then.

This also directly repairs the misleading absolute barrel statement by stating the direction for both cases.

### (e) Scope, acceptance criteria, and verification

The scope and acceptance criteria are generally proportionate for a tiny documentation-only task. Directly checking the three schema files and task 1.9 is sufficient; no code, schema generation, typecheck, lint, or tests are needed.

Two changes are needed:

1. AC2 should mirror task 1.9 accurately: “resolves every remaining thin surface through conversion to physical ownership or removal,” rather than only “resolves every remaining thin surface” if that is interpreted as module-local physical ownership.

2. AC3, P4, and T1 are not valid against the current working tree. The repository already contains many modified, deleted, and untracked files from the module-migration work. Therefore:
   - `git diff --stat` cannot show exactly one changed file repository-wide.
   - `git status --porcelain` cannot list only `CLAUDE.md`.
   - A verifier cannot truthfully claim that `CLAUDE.md` is “the only diff in the repository.”

Verification should instead be scoped or baseline-aware:

- `git diff -- CLAUDE.md` shows only the intended paragraph change within that file.
- Confirm no file other than `CLAUDE.md` changed as part of this task relative to a captured pre-edit status/diff baseline.
- Directly reread the three schema files and task 1.9.

The restriction that no other `CLAUDE.md` line may change is arguably over-specified because the existing scaffold bullet itself contains the absolute statement being qualified. Either permit a narrowly targeted correction to that bullet, or require the new paragraph to explicitly qualify it.

### (f) Other findings

The original concern from `tasks/007-migrate-ledger/review-1.md` is still satisfied in substance: contributors need to understand that a thin re-export is a module-facing access surface, not physical ownership, and that the arrangement is deliberate and temporary. The draft preserves that distinction and correctly avoids calling ledger or credit physical owners.

The original review also stressed that `db/schema.ts` must not re-export the thin ledger schema back. The current draft implies this through the export direction but does not say it explicitly. Given the contradictory existing scaffold bullet, explicitly stating that thin surfaces are not re-exported back through the barrel would make the guidance materially safer.

No code, schema, migration, or test blocker exists. The documentation task should proceed after:

- correcting the task 1.9 outcome wording;
- resolving or explicitly qualifying the existing scaffold bullet;
- removing the speculative “every module still to migrate” phrase; and
- making verification compatible with the already-dirty worktree.