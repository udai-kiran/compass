No blocking issues found.

- P1: Correct. Exactly `extracted`, `ignored`, `deferred`, and `failed` rows are reset to `pending`, with `error: null`. `processing` rows are excluded.
- P2: Correct. Both updates use the same `db.transaction()` callback.
- 404: Preserved for missing or wrong-owner mailboxes; ingestion updates do not execute.
- P3: Correct. `queue.getJob()` precedes `queue.add()`; failed jobs are removed, while other existing jobs remain untouched through BullMQ deduplication.
- Scope: Both implementation diffs contain only requested changes. Other unrelated worktree changes exist but are outside these files.
- Imports: `inArray` and `emailIngestions` are correct and sufficient.
- `typecheck`: Passed.
- `lint`: Passed.
- `git diff --check`: Passed.
- Tests: Could not fully pass because required `DATABASE_URL`/Redis environment configuration is absent; failures were environment-dependent DB-backed tests, not failures attributable to this change.