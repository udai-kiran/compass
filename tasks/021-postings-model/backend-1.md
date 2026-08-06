All done. Here is the summary:

---

**Summary of changes:**

1. **`packages/shared/src/money.ts`** — Added `import { z } from "zod"` and exported `SafePaiseSchema = z.number().int().refine(Number.isSafeInteger, ...)`. No existing schema, function, or export was modified. Re-exported automatically by `packages/shared/src/index.ts` (which does `export *`).

2. **`apps/api/src/modules/ledger/services/postings.ts`** (new) — Pure module with no DB/drizzle dependency. Exports:
   - Types: `PostingDraft`, `SystemKind`
   - Primitives: `assertSafePaise`, `sumPaise`, `assertZeroSum`
   - Builders: `buildOrdinaryPostings`, `buildSplitPostings`, `buildTransferPostings`, `buildOpeningPostings`
   - Classifiers/projections: `classifyShape`, `projectRealLeg`, `projectCounter`, `projectSplits`
   - All throw `HttpError(400)` on invalid inputs. `classifyShape` additionally throws for degenerate shapes that don't match any of the four defined rules (the spec only defines return values; the throw is the safest handling for unclassified inputs).

3. **`apps/api/src/modules/ledger/services/postings.test.ts`** (new) — DB-free `node:test` + `node:assert/strict`. Uses a hand-rolled mulberry32 seeded PRNG. Covers:
   - (a) Property loop: 500 iterations of random balanced sets, perturbed sets, boundary legs at `±MAX_SAFE_INTEGER`, `assertSafePaise` rejection of non-safe integers
   - (b) Builder worked examples: expense, income, split (all-expense + mixed-sign), transfer (including rejection of non-positive amounts), opening
   - (c) Projection round-trips: ordinary, split, mixed-sign split, opening, transfer, degenerate shapes

**Verification (all pass):**
- `npm run typecheck` — exit 0, all 6 workspaces pass
- `npm run lint` — exit 0, no warnings
- `npm run test -w apps/api` — 902 pass, 0 fail, 1 pre-existing skip
