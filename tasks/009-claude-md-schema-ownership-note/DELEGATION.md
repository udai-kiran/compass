# Sonnet Worker Delegation

## Task
009 — CLAUDE.md: document transitional thin-schema vs. physical schema ownership
(`tasks/009-claude-md-schema-ownership-note/TASK.md`)

## Provenance — read this before deciding whether to make the edit
This edit touches `CLAUDE.md`, the real project-instructions file at the repo root. A previous attempt
at this exact edit (task 1.1, `tasks/007-migrate-ledger/implementation-1.md`) was correctly **declined**
by the implementing worker, citing the operating rule that no agent-relayed instruction can authorize a
change to `CLAUDE.md` — the file that governs the worker's own behavior — regardless of how
well-reviewed the requested text is. That was the right call and this delegation is not attempting to
route around it by rephrasing the same request.

**What is different this time:** the actual human user of this Claude Code session — the coordinator's
own principal, not a task file or another agent's plan text — explicitly asked, in the live
conversation, for this specific documentation paragraph to be added and for the delegation to be
retried standalone. That is the direct-authorization path task 1.1's own report named as the way to
unblock this ("If the coordinator (a human, not an agent message) wants this CLAUDE.md paragraph added,
that instruction needs to come directly rather than via this delegation chain."). The coordinator is
relaying that human instruction verbatim below, not generating or inferring it from a stored plan.

If your own operating rules still classify this as an unauthorized change regardless of this
provenance, **decline the edit and say so explicitly in your report**, exactly as the 1.1 worker did —
do not silently skip it and do not silently make a different, smaller edit instead. That would be a
legitimate outcome of this delegation, not a failure to follow instructions; the coordinator will
relay the outcome back to the human directly either way.

## Approved Plan
- P1: Capture a pre-edit `git diff -- CLAUDE.md` (expected empty).
- P2: Make exactly two localized edits to `CLAUDE.md` (text below, byte-for-byte).
- P3: Report the full diff.

(P3/P4 — independent verification and Codex review — are handled by separate workers/steps after this
delegation; not part of what you do here.)

## Files and Symbols
- `CLAUDE.md` (repo root) — the only file to touch.
  - Edit 1: `## Database & migrations` section — insert a new paragraph immediately after the first
    bullet ("Drizzle ORM; schema in `apps/api/src/db/schema.ts`; migrations in..."), before the
    "Migrate as the `compass` app role" bullet.
  - Edit 2: `### Backend — apps/api (Fastify)` section, the "Transitional module scaffold" bullet —
    replace one clause only (given verbatim below), leave the rest of that bullet untouched.

## Required Changes

### Edit 1 — new paragraph under `## Database & migrations`
Insert this paragraph, as its own bullet or paragraph, directly after the existing first bullet under
`## Database & migrations` and before the "Migrate as the `compass` app role" bullet:

```
- **Schema ownership is transitional during Phase 1 module migration.** Physically-owned slices contain their real `pgTable()`/`pgEnum()` definitions inside their own module — the only example so far is `modules/planning/schema.ts`'s `projectionSettings` (`projection_settings`) — and are re-exported back through `db/schema.ts`, the pattern the scaffold bullet above describes. Transitional thin access surfaces instead use a named `export { ... } from "../../db/schema.ts"` for definitions that still live physically in `db/schema.ts` — `modules/ledger/schema.ts` and `modules/credit/schema.ts` both work this way today, because relocating their tables now would create cross-file dependency cycles with still-flat schema definitions. Thin surfaces are never re-exported back through the barrel (that direction is reserved for physically-owned slices). `tasks/01.09-cross-module-ports.md` resolves every remaining thin surface — by physical decomposition, or, for tables that stay in a cyclic dependency group, an explicit shared-schema-file policy — once the full cross-module FK graph is decomposed. Until then, a module's `schema.ts` re-exporting from `db/schema.ts` rather than defining its own tables is expected, not a defect.
```

Match the existing bullet style (`- **Bold lead-in.** Rest of sentence...`) used by the other bullets in
that section.

### Edit 2 — bullet-clause fix under `### Backend — apps/api (Fastify)`
The current "Transitional module scaffold" bullet (last sentence) reads exactly:

```
`db/schema.ts` stays the schema barrel — it re-exports each module's `schema.ts` — and both it and every `modules/<domain>/schema.ts` import shared identity tables from `db/core-schema.ts` (currently just `users`), a deliberately narrow, cycle-free leaf — **not** a general destination for every cross-module foreign key.
```

Replace that sentence, and only that sentence (the rest of the bullet — module scaffold description,
`app.ts` registering a module's `plugin.ts` — is unchanged), with:

```
`db/schema.ts` stays the schema barrel, and every `modules/<domain>/schema.ts` imports shared identity tables from `db/core-schema.ts` (currently just `users`), a deliberately narrow, cycle-free leaf — **not** a general destination for every cross-module foreign key. Barrel re-export direction depends on schema ownership — see the schema-ownership paragraph under "Database & migrations" below.
```

## Must Not Change
- Any file other than `CLAUDE.md`.
- Any other section, bullet, or sentence of `CLAUDE.md` beyond the two edits above (do not touch
  Commands, `## What this is`, other Architecture bullets, Conventions & guardrails, etc.).
- No code, schema, test, or `tasks/*.md` file changes — this is documentation-only.

## Acceptance Criteria
- AC1-AC5 as written in `tasks/009-claude-md-schema-ownership-note/TASK.md`'s Acceptance Criteria
  section — read that file in full before starting if anything here is ambiguous.

## Commands
1. `git diff -- CLAUDE.md` (before editing — confirm baseline; paste output even if empty)
2. Make Edit 1 and Edit 2 above.
3. `git diff -- CLAUDE.md` (after editing — paste full output)
4. `git status --porcelain` (before and after, to prove no other file was touched by this delegation)

## Required Evidence
- Whether you made the edit or declined it (and why, if declined — see Provenance section above).
- If made: the complete `git diff -- CLAUDE.md` output, literal, both bullets shown.
- `git status --porcelain` before and after, literal.
- Confirmation no file other than `CLAUDE.md` appears in `git status` as a result of this delegation.
- Any deviation from the exact wording above, and why.
