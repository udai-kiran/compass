# sonnet-worker Delegation — SP4 FIX iteration (Codex review-10 findings F2-F6)

## Task
020-cross-module-ports (roadmap 1.9), SP4 fix pass. COMMENT/DOC (JSDoc + markdown + `//`) edits ONLY — zero code,
signature, SQL, schema, route, test-assertion, or migration change. Six inaccuracy findings from Codex review-10;
F1 is rejected/out-of-scope (do NOT touch it). Fix F2-F6 below. Each is a precise string replacement; if any OLD
string does not match byte-for-byte, STOP and report the actual text — do not guess.

## FIX F2 — CLAUDE.md (line 49 bullet)
File: /home/udai/PennyPilot/CLAUDE.md
OLD substring:
`each `+"`modules/<domain>/schema.ts`"+` defines the real `+"`pgTable()`/`pgEnum()`"+` for its RESIDENT tables/enums, and re-exports the cross-domain ones it references.`
NEW substring:
`each `+"`modules/<domain>/schema.ts`"+` defines the real `+"`pgTable()`/`pgEnum()`"+` for its RESIDENT tables/enums, imports from `+"`db/shared/*`"+` the cross-domain tables its residents FK to, and separately re-exports the shared tables/enums that make up its module-facing schema surface (the referenced and re-exported sets need not coincide).`

## FIX F3 — ledger/plugin.ts (JSDoc, ~lines 17-18)
File: /home/udai/PennyPilot/apps/api/src/modules/ledger/plugin.ts
OLD substring (spans a line break; match exactly incl. ` * ` prefixes):
`physically defines ledger's 6 resident tables (its enums are defined in the
 * shared layers) and re-exports the cross-domain tables it references from `+"`db/shared/*`"
NEW substring:
`physically defines ledger's 6 resident tables (its enums live in the shared
 * layers) and re-exports the shared tables/enums that make up its schema surface from `+"`db/shared/*`"

## FIX F4 — investments/plugin.ts (JSDoc, ~lines 10-11)
File: /home/udai/PennyPilot/apps/api/src/modules/investments/plugin.ts
OLD substring:
`physically defines investments' 6 resident tables and 4 owned enums;
 * re-exports the cross-domain tables it references from `+"`db/shared/*`"
NEW substring:
`physically defines investments' 6 resident tables and 4 owned enums;
 * re-exports the shared tables/enums that make up its schema surface from `+"`db/shared/*`"

## FIX F6 — core-schema.ts (JSDoc, lines 3-9)
File: /home/udai/PennyPilot/apps/api/src/db/core-schema.ts
OLD substring (exact, spans lines 4-9):
` * Shared identity leaf: tables that genuinely need a cycle-free home because
 * both `+"`db/schema.ts`"+` (now a pure re-export barrel) and `+"`modules/<domain>/schema.ts`"+`
 * files reference them via `+"`.references(() => users.id, ...)`"+`. Deliberately
 * narrow — starts with just `+"`users`"+` — and is NOT a general destination for
 * every cross-module foreign key; future cross-module FK targets get their
 * own explicit ownership decision in whichever Phase-1 task introduces them.`
NEW substring:
` * Shared identity leaf: tables that genuinely need a cycle-free home because the
 * schema-definition files that hold the real FK definitions — the `+"`db/shared/*`"+`
 * layers and each `+"`modules/<domain>/schema.ts`"+` — reference them via
 * `+"`.references(() => users.id, ...)`"+`. (`+"`db/schema.ts`"+` is now a pure re-export
 * barrel and holds no FK definitions itself.) Deliberately narrow — starts with
 * just `+"`users`"+` — and is NOT a general destination for every cross-module foreign
 * key; future cross-module FK targets get their own explicit ownership decision
 * in whichever Phase-1 task introduces them.`

## FIX F5 — five schema.smoke.test.ts comment blocks (COMMENT lines ONLY; touch NO test code/assertion)
The five files below have an intro comment that calls the module's FULL export-surface enum count "owned",
though those enums are re-exported shared symbols, not resident. Replace ONLY the comment block. Do NOT touch
the automation, credit, or system smoke tests (their counts are correct — leave them alone).

### F5a — apps/api/src/modules/ledger/schema.smoke.test.ts (lines 6-10)
OLD:
`// Object-identity proof: modules/ledger/schema.ts now physically defines its
// resident tables and enums; the test asserts the module's export is the exact
// same object as the barrel's (identity through the barrel). Every one of the
// 11 ledger tables (and their 7 owned enums) imported via the module path must
// be the identical object from db/schema.ts — not just structurally equal.`
NEW:
`// Object-identity proof: modules/ledger/schema.ts physically defines its 6
// resident tables (its enums live in the shared layers) and re-exports the
// shared symbols that complete its schema surface. The test asserts the
// module's export is the exact same object as the barrel's (identity through
// the barrel): every one of the 11 tables and 7 enums on the module's export
// surface — residents plus re-exported shared symbols — must be the identical
// object from db/schema.ts, not just structurally equal.`

### F5b — apps/api/src/modules/investments/schema.smoke.test.ts (lines 6-11)
OLD:
`// Object-identity proof: modules/investments/schema.ts now physically defines
// its resident tables and enums; the test asserts the module's export is the
// exact same object as the barrel's (identity through the barrel). Every one
// of the 8 investments tables (and their 10 owned enums) imported via the
// module path must be the identical object from db/schema.ts — not just
// structurally equal.`
NEW:
`// Object-identity proof: modules/investments/schema.ts physically defines its 6
// resident tables and 4 resident enums and re-exports the shared symbols that
// complete its schema surface. The test asserts the module's export is the
// exact same object as the barrel's (identity through the barrel): every one
// of the 8 tables and 10 enums on the module's export surface — residents plus
// re-exported shared symbols — must be the identical object from db/schema.ts,
// not just structurally equal.`

### F5c — apps/api/src/modules/ingest/schema.smoke.test.ts (lines 9-14)
OLD:
`// Object-identity proof: modules/ingest/schema.ts now physically defines its
// resident tables and enums; the test asserts the module's export is the exact
// same object as the barrel's (identity through the barrel). Every one of the
// 7 ingest tables (and their 8 owned enums) imported via the module path must
// be the identical object from db/schema.ts — not just structurally equal.
// Mirrors modules/planning/schema.smoke.test.ts.`
NEW:
`// Object-identity proof: modules/ingest/schema.ts physically defines its
// resident tables/enums and re-exports the shared symbols that complete its
// schema surface. The test asserts the module's export is the exact same
// object as the barrel's (identity through the barrel): every one of the 7
// tables and 8 enums on the module's export surface — residents plus
// re-exported shared symbols — must be the identical object from db/schema.ts,
// not just structurally equal. Mirrors modules/planning/schema.smoke.test.ts.`

### F5d — apps/api/src/modules/planning/schema.smoke.test.ts (lines 9-14)
OLD:
`// Object-identity proof: modules/planning/schema.ts now physically defines its
// resident tables and enums; the test asserts the module's export is the exact
// same object as the barrel's (identity through the barrel). Every one of the
// 6 planning tables (and their 2 owned enums) imported via the module path must
// be the identical object from db/schema.ts — not just structurally equal.
// Mirrors modules/credit/schema.smoke.test.ts.`
NEW:
`// Object-identity proof: modules/planning/schema.ts physically defines its
// resident tables/enums and re-exports the shared symbols that complete its
// schema surface. The test asserts the module's export is the exact same
// object as the barrel's (identity through the barrel): every one of the 6
// tables and 2 enums on the module's export surface — residents plus
// re-exported shared symbols — must be the identical object from db/schema.ts,
// not just structurally equal. Mirrors modules/credit/schema.smoke.test.ts.`

### F5e — apps/api/src/modules/protection/schema.smoke.test.ts (lines 6-11)
OLD:
`// Object-identity proof: modules/protection/schema.ts now physically defines
// its resident tables and enums; the test asserts the module's export is the
// exact same object as the barrel's (identity through the barrel). Every one
// of the 3 protection tables (and their 4 owned enums) imported via the module
// path must be the identical object from db/schema.ts — not just structurally
// equal. Mirrors modules/ledger/schema.smoke.test.ts exactly.`
NEW:
`// Object-identity proof: modules/protection/schema.ts physically defines its
// resident tables/enums and re-exports the shared symbols that complete its
// schema surface. The test asserts the module's export is the exact same
// object as the barrel's (identity through the barrel): every one of the 3
// tables and 4 enums on the module's export surface — residents plus
// re-exported shared symbols — must be the identical object from db/schema.ts,
// not just structurally equal. Mirrors modules/ledger/schema.smoke.test.ts exactly.`

## Must NOT change
- CLAUDE.md line 42 ("all DB access … routes are thin") — F1, deliberately left.
- automation/credit/system schema.smoke.test.ts comments.
- Any code, import, signature, SQL, schema def, route, test assertion, TABLE_NAMES list, or migration.

## Gate (capture exact command, literal output, exit code)
1. `npm run typecheck`
2. `npm run lint`
3. `npm run test -w apps/api` (report pass/fail/skip + exit; confirm all schema.smoke + decomposition still pass)
4. `git diff --stat` (confirm only the 8 files above changed beyond the pre-existing SP1-SP3 footprint)

## Required evidence
- Each edit's before/after; the full `git diff` for the 8 touched files (must be comment/markdown-only).
- Each command's exact invocation, literal output (counts), exit code.
- Any OLD-string mismatch or deviation — STOP and report.
