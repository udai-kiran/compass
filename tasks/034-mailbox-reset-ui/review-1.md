## Review findings

1. **High — The plan never queues a sync.**  
   [TASK.md](/home/udai/common/compass/tasks/034-mailbox-reset-ui/TASK.md:36) only calls `resetWatermark.mutate`; the endpoint merely sets `last_uid = 0`. Consequently, the success toast “Watermark reset — sync queued” and the objective/AC3 are false. After a successful reset, call `sync.mutate(...)` or revise the objective and toast to say reprocessing will occur on the next sync. Note that the existing sync API supports delayed windows of 5–30 minutes, not an immediate run.

2. **Medium — Pending state is missing.**  
   The proposed `MailboxRow` props should include something such as `resetting: boolean`, and the button should be `disabled={resetting}` with disabled styling and preferably a `"Reprocessing…"` label. Otherwise repeated clicks remain possible while `resetWatermark.isPending`. A single boolean disables every row; tracking the active mailbox ID would provide accurate per-row state.

3. **Medium — Reset and sync require explicit failure handling.**  
   Queue sync only after reset succeeds. If reset succeeds but queueing fails, do not show the combined success toast. Report that the watermark was reset but sync could not be queued, allowing the user to use the existing Queue sync button. The eventual success toast should use `QueueSyncResult.runsInMinutes`, matching the existing sync convention.

4. **Medium — The confirmation text overpromises.**  
   “This queues a new extraction run for every message” is inaccurate when:

   - The proposed implementation does not queue anything.
   - A never-synced mailbox has `uid_validity = null`; resetting it remains a semantic no-op and the next sync baselines to current mail rather than fetching history.
   - The queue operation is user-wide, not mailbox-specific.

   Prefer wording such as: “Reset this mailbox and queue a sync to reprocess its available mail?”

5. **Low — Concurrent operations need consideration.**  
   Reset/reprocess should be disabled while `sync.isPending`, and Queue sync should ideally be disabled while a reset-plus-sync sequence is running. Otherwise independently queued work can race with the watermark update. Task 033 also documents the accepted backend race where an already-running sync can overwrite the reset; the UI cannot fully solve that, but the plan should acknowledge it.

## Requested checks

- `apiPost` does accept no body: its third argument is optional, and it omits both the request body and `Content-Type` when absent. The proposed call is valid.
- The query mutation structure matches existing `add`, `remove`, and `sync` patterns. `onSuccess: invalidate` is consistent, although mailbox invalidation has little visible value because the watermark is not returned in the mailbox model.
- Extending `MailboxRow` with callback props matches the existing `onRemove` pattern, but the plan is incomplete without pending/disabled props.
- Resetting alone is insufficient for the task’s promised behavior. It only affects the next sync; an explicit sync request must follow.
- `toast(message, "success")` and default-error toast usage match repository conventions.
- The native `confirm(...)` pattern matches the existing Remove button and other pages.
- `text-xs text-amber-600 underline` is consistent with the existing link-style Remove action. Add `disabled:opacity-50` and possibly `disabled:no-underline`; `type="button"` is prudent if the row is ever moved into a form.
- Verification should cover the reset→sync sequence and partial failure behavior, not just typechecking. Even without component-test infrastructure, the acceptance criteria should explicitly require that the sync endpoint is called only after a successful reset and never after cancellation or reset failure.