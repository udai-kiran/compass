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
