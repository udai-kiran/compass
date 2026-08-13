## Review findings

### Blocking issue

1. Resetting `failed` rows does not reliably re-enqueue them.

The ingestor uses the ingestion ID as BullMQ’s `jobId` and retains failed jobs with `removeOnFail: 500` ([index.ts](/home/udai/common/compass/apps/ingestor/src/index.ts:55)). After exhausting retries, that failed job still exists. A later `queue.add()` with the same ID is deduplicated rather than creating a fresh job. Consequently, the proposed database reset can leave the ingestion `pending` indefinitely.

The plan must address retained failed jobs—such as explicitly retrying/removing them, changing the queue lifecycle, or providing a deliberate replay mechanism. A test covering a retained failed BullMQ job is required.

### Other findings

1. **Root cause:** Correct for ordinary terminal rows. `recordIngestion` deliberately preserves the existing status on conflict ([db.ts](/home/udai/common/compass/apps/ingestor/src/db.ts:75)), and `syncPass` only enqueues `pending` rows ([index.ts](/home/udai/common/compass/apps/ingestor/src/index.ts:109)).

2. **Transaction/type correctness:** Correct. `resetMailboxWatermark` accepts `Db`, which exposes `transaction()`, and both updates can be issued directly through its transaction callback. The codebase’s `DbOrTx` alias is unnecessary unless the function itself must also accept an existing transaction ([db/index.ts](/home/udai/common/compass/apps/api/src/db/index.ts:5)).

3. **Other callers:** There is only one production caller: the reset-watermark route ([mailboxes.ts](/home/udai/common/compass/apps/api/src/modules/ingest/routes/mailboxes.ts:68)). The web mutation calls that route, not the service directly. No other service callers are affected.

4. **Nullable `mailbox_id`:** This is a real uncovered edge case. The column is nullable and uses `ON DELETE SET NULL` ([hubs.ts](/home/udai/common/compass/apps/api/src/db/shared/hubs.ts:158)). Moreover, `recordIngestion` does not restore `mailbox_id` on conflict. If a mailbox is deleted and later re-added, existing matching ingestions can remain `mailbox_id = null`; the proposed reset will not select them, and future conflicts will not repair the association. Null rows cannot safely be assigned to a mailbox solely from `user_id`, so the plan should explicitly define this behavior and consider updating `mailbox_id` on conflict when appropriate.

5. **Processing rows:** Correctly avoided. Restricting the update to the four named terminal statuses leaves both `processing` and already-`pending` rows untouched.

6. **Enum/inArray risk:** The schema exports both requested symbols ([schema.ts](/home/udai/common/compass/apps/api/src/modules/ingest/schema.ts:35)). A hard-coded terminal-status array will not break merely because a new enum value is appended, but a new terminal value would silently not be reset. Conversely, deriving the list as “everything except pending/processing” could incorrectly reset a future nonterminal state. Use an explicitly typed terminal-status tuple and require enum additions to make a deliberate replay-policy decision. Importing `emailIngestStatus` alone does not create exhaustiveness.

7. **Missing tests:** The plan’s verification is insufficient; it contains no automated tests for the changed behavior. Add integration/service tests covering:

   - Each terminal status becomes `pending`, with `error` cleared.
   - `processing` and existing `pending` rows remain unchanged.
   - Different mailbox and different user rows remain unchanged.
   - Missing/wrong-owner mailbox returns 404 without modifying ingestions.
   - Transaction rollback leaves both tables unchanged if the second update fails.
   - Nullable `mailbox_id` behavior is documented and tested.
   - A retained failed BullMQ job can actually be replayed.
   - Ideally, an end-to-end reset → refetch/conflict → enqueue test.

The retained failed-job behavior is the blocking issue; without resolving it, AC1 may pass at the database level while “Reprocess All” still fails for some `failed` ingestions.