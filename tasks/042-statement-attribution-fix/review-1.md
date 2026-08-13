## Plan review

The plan addresses the demonstrated cases, but should be strengthened before implementation.

1. `CreditCardRef` is defined and exported directly in [db.ts](/home/udai/common/compass/apps/extractor/src/db.ts:86). It is not imported from elsewhere.

2. `loadCreditCards` has only one caller: `processStatement` in [index.ts](/home/udai/common/compass/apps/extractor/src/index.ts:161). Adding `institution` is additive and will not break that caller. Update the `pool.query` row type and returned mapping as well as `CreditCardRef`.

3. `email.subject` is correct. `ParsedEmail` defines it as a non-null `string` in [email.ts](/home/udai/common/compass/apps/extractor/src/email.ts:9), with missing subjects parsed as `""`.

4. The heuristic has several edge cases:

   - Generic tokens such as `bank`, `credit`, `card`, and `statement` can create false matches if present in account names.
   - Equal scores retain nondeterministic database heap order. A stable sort prevents reordering during the sort, but does not make the underlying tie deterministic.
   - Tokenization must be specified. Splitting only on whitespace leaves punctuation attached, such as `statement:` or `bank-card`, causing missed matches. Use normalized alphanumeric tokens, preferably Unicode-aware.
   - Clarify whether a word occurring in both name and institution counts once or twice. The current formula permits twice because it describes two separate counts.
   - Short or generic institution names can dominate without identifying a particular card. This is expected for subjects that mention only the issuer.
   - A misleading positive match is worse than a zero-score tie because cards sharing a password will still open successfully and the wrong card will be selected confidently.

   At minimum, exclude common stopwords such as `bank`, `credit`, `card`, `statement`, `your`, and `account`, and add tests for punctuation, case, duplicate tokens, generic names, and ties. A deterministic secondary key such as account ID would make behavior reproducible, though it cannot make ambiguous attribution correct.

5. There are no direct tests for either `processStatement` or `loadCreditCards`. Existing extractor tests cover statement extraction and duplicate handling, while [db.test.ts](/home/udai/common/compass/apps/extractor/src/db.test.ts:1) only covers `saveResults`. The plan should add:

   - A unit test confirming `loadCreditCards` selects/maps `institution` and coalesces null to `""`.
   - Pure ranking tests for the four production examples and the edge cases above.
   - Ideally, a `processStatement` test proving the highest-ranked card is attempted first.

   Testing `processStatement` directly is awkward because it is private and importing `index.ts` initializes configuration, the pool, and the worker. Extracting the ranking into a small exported pure function/module would make meaningful tests straightforward.

6. The existing structure permits insertion cleanly immediately after `loadCreditCards` and before the loop. Prefer a new ranked array rather than mutating `cards`, for example by decorating each card with its original index, sorting by score then index, and mapping back. Explicit index comparison also avoids relying solely on runtime sort-stability guarantees.

## Additional finding

P3 does not cover all inaccurate commentary. The `processStatement` documentation says “the password that decrypts it identifies the card,” and `StatementOutcome.accountId` says “the card whose password opened the PDF.” Both are contradicted by the root cause and should be revised to say that subject ranking selects the candidate whose password opened the PDF.

Overall: approve the query/type change and insertion point, but revise the plan to define robust tokenization, handle generic words, extract/test the ranking function, and correct all password-identification comments.