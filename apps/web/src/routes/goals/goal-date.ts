function dateParts(date: string): [number, number, number] | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function completeMonthsBetween(
  [fromYear, fromMonth, fromDay]: [number, number, number],
  [toYear, toMonth, toDay]: [number, number, number],
): number {
  const monthDifference = (toYear - fromYear) * 12 + toMonth - fromMonth;
  return monthDifference - (toDay < fromDay ? 1 : 0);
}

function formatMonths(months: number): string {
  const years = Math.floor(months / 12);
  const remainingMonths = months % 12;
  const parts: string[] = [];
  if (years > 0) parts.push(`${years} ${years === 1 ? "year" : "years"}`);
  if (remainingMonths > 0) {
    parts.push(`${remainingMonths} ${remainingMonths === 1 ? "month" : "months"}`);
  }
  return parts.join(" ");
}

/** Formats calendar time from today to a YYYY-MM-DD goal deadline. */
export function formatGoalDeadlineDistance(targetDate: string, now = new Date()): string {
  const target = dateParts(targetDate);
  if (!target) return "";

  const today: [number, number, number] = [
    now.getFullYear(),
    now.getMonth() + 1,
    now.getDate(),
  ];
  const targetNumber = target[0] * 10_000 + target[1] * 100 + target[2];
  const todayNumber = today[0] * 10_000 + today[1] * 100 + today[2];

  if (targetNumber === todayNumber) return "due today";

  const overdue = targetNumber < todayNumber;
  const months = overdue
    ? completeMonthsBetween(target, today)
    : completeMonthsBetween(today, target);

  if (months === 0) return overdue ? "less than 1 month overdue" : "less than 1 month left";
  return `${formatMonths(months)} ${overdue ? "overdue" : "left"}`;
}
