## High

None.

## Medium

- [cart-draft-generator.ts:37](/work/personal/compass/apps/api/src/modules/shopping/services/cart-draft-generator.ts:37) does not reject `consumptionBasePerMonth === 0`. With empty/unknown pantry stock, `shouldReplenish` returns true and `generateDraft` creates a zero-quantity line. The explicit requirement says null or zero consumption must skip the item.

- [cart-draft-generator.ts:245](/work/personal/compass/apps/api/src/modules/shopping/services/cart-draft-generator.ts:245) does not guarantee idempotency under concurrent requests. Two default `READ COMMITTED` transactions can both observe no same-day draft and insert separate headers. There is no unique constraint or advisory/row lock preventing this race, so AC5 is violated during simultaneous generation.

- [cart-drafts.ts:92](/work/personal/compass/apps/api/src/modules/shopping/routes/cart-drafts.ts:92) decrements the habit associated with `item.catalogItemId`. For substituted lines, generation replaces that ID with the substitute and records the learned/original item in `substitutionForItemId` ([cart-draft-generator.ts:280](/work/personal/compass/apps/api/src/modules/shopping/services/cart-draft-generator.ts:280)). Removing such a line therefore usually teaches nothing—or teaches the substitute—instead of decrementing the original item’s habit. The lookup should use `substitutionForItemId ?? catalogItemId`.

- [cart-draft-generator.ts:191](/work/personal/compass/apps/api/src/modules/shopping/services/cart-draft-generator.ts:191) selects substitutes by normalized unit price but calculates `deltaPaise` from incomparable raw pack prices at line 201. For example, replacing a ₹100/500g pack with a cheaper-per-unit ₹150/1kg pack produces `-₹50`, contradicting the “cheaper substitute” reason. AC4’s delta should use a common quantity basis, such as `usualUnitPrice - candidateUnitPrice`.

## Low

- [shopping.ts:895](/work/personal/compass/packages/shared/src/schemas/shopping.ts:895) and [shopping.ts:926](/work/personal/compass/packages/shared/src/schemas/shopping.ts:926) use plain `z.number().int()` for bigint-backed quantities and paise. Unlike the existing `quantityField()` and `nonNegativePaiseField()` helpers, these accept values beyond JavaScript’s safe-integer range, allowing silent precision loss on item edits and responses.

- [cart-draft-generator.test.ts:15](/work/personal/compass/apps/api/src/modules/shopping/services/cart-draft-generator.test.ts:15) contains the requested 10 passing pure tests, but there is no service/route integration coverage for same-day idempotency, empty-draft generation, substitutions, false→true removal behavior, or IDOR rejection. This does not satisfy the repository’s requirement that each acceptance criterion have a corresponding test and allowed the zero-rate and substituted-removal defects above to go undetected.

Verification: typecheck and lint pass; the 10 focused cart tests and 351 shared-package tests pass. The full API suite could not be verified because `DATABASE_URL` was unavailable; 33 DB-backed test files exited during setup. Schema, migration, registration, backup mappings, ESM imports, nullable `catalogItemId`, FK actions, and CHECK constraints otherwise match the task.