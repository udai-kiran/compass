## Verdict

**SP0 is CORRECT-AND-BEHAVIOR-NEUTRAL.** I found no correctness bug, sign error, purity violation, runtime wiring, lossy balance check, or existing-schema behavior change.

### Implementation review

- Builders in [postings.ts](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/postings.ts:74) follow the delegated conventions:

  - Ordinary: real leg retains the signed amount; Expenses is selected for negative amounts and Income otherwise; counter is the exact negation.
  - Split: asset amount is the exact signed split sum; every split is negated onto Expenses/Income according to its sign, preserving category, necessity, and note.
  - Transfer: rejects `<= 0`, then produces `from = -amount` and `to = +amount`.
  - Opening: produces real `+amount` and Opening Balances `-amount`.
  - Every builder calls `assertZeroSum` before returning.

- Integer-paise safety is correct:

  - [assertZeroSum](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/postings.ts:51) validates every operand as a safe integer, converts each exact integer to `BigInt`, and compares the `BigInt` total directly with `0n`. It contains no `Number()` conversion and cannot miss a one-paisa imbalance near `Number.MAX_SAFE_INTEGER`.
  - [sumPaise](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/postings.ts:36) also accumulates entirely in `BigInt`. Its `Number(total)` conversion occurs only at the required number-return boundary and is followed by a safe-integer check. An out-of-range `BigInt` cannot become a safe integer through that conversion, so this cannot silently mask overflow or imbalance.
  - Unary negations in the builders are safe because all returned drafts are subsequently validated by `assertZeroSum`; split aggregation additionally validates operands and the aggregate before constructing drafts.

- Projection and classification match the exact delegated API:

  - [classifyShape](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/postings.ts:218) applies the specified precedence and cardinalities for opening, transfer, ordinary, and split shapes, rejecting unmatched degenerate shapes.
  - [projectRealLeg](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/postings.ts:238) requires exactly one real posting.
  - [projectCounter](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/postings.ts:257) requires exactly one Expenses/Income counter and safely rejects transfers, openings, and multi-counter splits.
  - [projectSplits](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/postings.ts:281) selects only Expenses/Income postings, negates amounts back to legacy signed semantics, and preserves category and posting note.
  - Transfer and opening projection behavior is deliberately safe rather than inventing a lossy legacy representation.

- Purity and behavior neutrality are intact:

  - [postings.ts imports](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/postings.ts:1) are limited to a type-only shared import and `HttpError`. There are no DB, Drizzle, schema-table, or side-effecting-service imports.
  - Repository grep found no caller importing this module other than [postings.test.ts](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/postings.test.ts:3).
  - No existing service, route, query, schema table, migration, seed, or backup code is wired to it.

- `SafePaiseSchema` is correctly additive:

  - [money.ts](/home/udai/PennyPilot/packages/shared/src/money.ts:12) defines the exact requested `z.number().int().refine(Number.isSafeInteger, ...)` schema.
  - It is publicly re-exported through the existing `export * from "./money.ts"` barrel in [index.ts](/home/udai/PennyPilot/packages/shared/src/index.ts:1).
  - Repository grep found no use of `SafePaiseSchema` in an existing money field, so it has not replaced or changed any current validation contract.

### Test quality and verification

The tests are substantive, not hollow:

- Exact builder arrays, signs, account selection, metadata, and zero-sum behavior are asserted at [postings.test.ts:111](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/postings.test.ts:111).
- A deterministic 500-case balanced/±1-perturbation loop is present at [postings.test.ts:72](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/postings.test.ts:72).
- Exact `±Number.MAX_SAFE_INTEGER` balance and one-paisa boundary failures are covered at [postings.test.ts:97](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/postings.test.ts:97).
- Unsafe operands and safe-operands-with-overflowing-total are covered at [postings.test.ts:52](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/postings.test.ts:52).
- Ordinary, split, mixed-sign split, opening, transfer, and degenerate projection/classification cases are covered at [postings.test.ts:222](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/postings.test.ts:222), including split-note preservation and signed round trips.

Read-only verification results:

- Targeted postings tests: **17 passed, 0 failed**.
- Workspace typecheck: **passed across API, docs, extractor, ingestor, and web**.
- ESLint: **passed**.

No SP1 work is required for this SP0 review.