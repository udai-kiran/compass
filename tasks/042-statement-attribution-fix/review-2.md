No implementation defects found.

- AC1–AC6: satisfied.
- AC7: `npm run typecheck` passed.
- Ranking tests: all 11 passed, including all six production cases and requested edge cases.
- Implementation correctly unions name and institution tokens, excludes stopwords, uses the required tokenizer, explicitly tie-breaks by original index, and returns a new array without mutation.
- Database query/type/mapping and both JSDoc fixes are present.
- AC8 could not fully pass: extractor tests reported 73 passed and 1 failed because `statement-duplicate.test.ts` requires `DATABASE_URL`. This is an environment prerequisite, not a regression in task 042.