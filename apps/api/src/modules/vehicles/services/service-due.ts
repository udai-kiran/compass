/**
 * Pure service-due arithmetic — "whichever comes first" between the km and
 * time intervals, each independently optional. Kept DB-free so it's directly
 * unit-testable; `service-due-tasks.ts` is the only caller that feeds it real
 * data.
 */

/** How early to start reminding, so the task lands before the deadline, not on it. */
export const SERVICE_REMIND_KM = 300;
export const SERVICE_REMIND_DAYS = 14;

export interface VehicleServiceState {
  serviceIntervalKm: number | null;
  serviceIntervalMonths: number | null;
  lastServiceOdometerKm: number | null;
  lastServiceDate: string | null; // ISO date
}

export interface ServiceDueCheck {
  due: boolean;
  dueByKm: boolean;
  dueByTime: boolean;
  /** null when either the last service odometer or the current one is unknown */
  kmSinceService: number | null;
  /** null when km isn't tracked (serviceIntervalKm or lastServiceOdometerKm missing) */
  nextServiceOdometerKm: number | null;
  /** null when time isn't tracked (serviceIntervalMonths or lastServiceDate missing) */
  nextServiceDate: string | null;
}

/**
 * Add whole months to an ISO date, clamping to the target month's last day
 * (e.g. 31 Jan + 1 month → 28/29 Feb, never rolling into March).
 */
export function addMonths(startDate: string, months: number): string {
  const [y, m, d] = startDate.split("-").map(Number) as [number, number, number];
  const total = m - 1 + months;
  const ty = y + Math.floor(total / 12);
  const tm = (total % 12) + 1;
  const lastDay = new Date(Date.UTC(ty, tm, 0)).getUTCDate();
  return `${ty}-${String(tm).padStart(2, "0")}-${String(Math.min(d, lastDay)).padStart(2, "0")}`;
}

function subDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * `currentOdometerKm` is the vehicle's latest known reading (null if it has
 * none yet — the km leg is then simply unevaluable, same as an unconfigured
 * interval). `today` is an ISO date, injectable for tests.
 */
export function checkServiceDue(
  state: VehicleServiceState,
  currentOdometerKm: number | null,
  today: string,
): ServiceDueCheck {
  const nextServiceOdometerKm =
    state.lastServiceOdometerKm !== null && state.serviceIntervalKm !== null
      ? state.lastServiceOdometerKm + state.serviceIntervalKm
      : null;
  const kmSinceService =
    state.lastServiceOdometerKm !== null && currentOdometerKm !== null
      ? currentOdometerKm - state.lastServiceOdometerKm
      : null;
  const dueByKm =
    nextServiceOdometerKm !== null &&
    currentOdometerKm !== null &&
    currentOdometerKm >= nextServiceOdometerKm - SERVICE_REMIND_KM;

  const nextServiceDate =
    state.lastServiceDate !== null && state.serviceIntervalMonths !== null
      ? addMonths(state.lastServiceDate, state.serviceIntervalMonths)
      : null;
  const dueByTime = nextServiceDate !== null && today >= subDays(nextServiceDate, SERVICE_REMIND_DAYS);

  return {
    due: dueByKm || dueByTime,
    dueByKm,
    dueByTime,
    kmSinceService,
    nextServiceOdometerKm,
    nextServiceDate,
  };
}
