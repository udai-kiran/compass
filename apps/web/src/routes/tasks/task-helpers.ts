/**
 * Pure due-date logic for the Tasks page, kept JSX-free so node --test can
 * type-strip it directly.
 *
 * All dates are canonical `YYYY-MM-DD` strings, compared lexicographically —
 * correct for ISO calendar dates. A `Date` is deliberately never constructed
 * from a date-only string here: `new Date("2026-02-10")` parses at UTC
 * midnight and can shift the displayed/comparison day in timezones behind UTC.
 *
 * `today` is always passed in by the caller (e.g. from shared's `todayInIST()`,
 * which formats via Intl.DateTimeFormat rather than `toISOString()`, which is
 * UTC), so this module is testable without mocking the clock.
 */

export interface OverdueTaskLike {
  dueDate: string | null;
  completedAt: string | null;
}

/**
 * True when the task is incomplete and its due date is strictly before today.
 * Due-today is not overdue; a null due date is never overdue; a completed task
 * is never overdue.
 */
export function isOverdue(task: OverdueTaskLike, today: string): boolean {
  return !task.completedAt && task.dueDate !== null && task.dueDate < today;
}

/** Shape of the PATCH body the link panel sends — a subset of UpdateUserTask. */
export interface LinkPanelPatch {
  completed?: boolean;
  transactionId?: string | null;
}

/**
 * Which primary action the row's link panel is performing:
 * - `"complete"`: ticking an incomplete task — the PATCH completes it.
 * - `"link-only"`: adding a link to an already-completed task — the PATCH
 *   must not touch `completed`.
 */
export type LinkPanelMode = "complete" | "link-only";

/**
 * PATCH body for the panel's primary button ("Mark done" / "Save link"), or
 * null when the action is not currently valid (link-only mode with nothing
 * picked — the caller disables the button in that case).
 *
 * In "complete" mode with nothing picked the body is `{ completed: true }`
 * with NO transactionId key, so an existing link is left untouched; clearing
 * a link is the explicit "Done without a link" path below.
 */
export function linkPanelPrimaryPatch(
  mode: LinkPanelMode,
  pickedId: string | null,
): LinkPanelPatch | null {
  if (mode === "complete") {
    return pickedId === null
      ? { completed: true }
      : { completed: true, transactionId: pickedId };
  }
  return pickedId === null ? null : { transactionId: pickedId };
}

/** PATCH body for "Done without a link": complete and explicitly clear the link. */
export function doneWithoutLinkPatch(): LinkPanelPatch {
  return { completed: true, transactionId: null };
}
