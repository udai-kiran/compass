import { desc, eq } from "drizzle-orm";
import type { Db } from "../../../db/index.ts";
import { alertLedger, resources, userTasks, users } from "../../../db/schema.ts";
import { vehicleDetails, vehicleOdometerReadings } from "../schema.ts";
import { checkServiceDue, type VehicleServiceState } from "./service-due.ts";
import { truncateTaskTitle } from "../../credit/services/card-due-tasks.ts";

/**
 * Materialises a vehicle's next-service-due window as a `user_tasks` row, the
 * same way `card-due-tasks.ts` does for a credit-card due date — see that
 * file's doc comment for the full rationale (this module reuses its
 * `truncateTaskTitle` helper rather than duplicating the surrogate-pair-safe
 * truncation logic).
 *
 * **No delete path, no update path.** A stale generated task is left as-is —
 * visible, provenance-labelled, and deletable by the user in one click —
 * exactly per card-due-tasks.ts's "Config drift" rationale.
 */

const VEHICLE_SERVICE_TASK_KIND = "vehicle-service-task";

/**
 * The provenance key shared by the `alert_ledger` claim and the task's
 * `sourceKey`. Ties to the CURRENT service cycle's state (last-known odometer
 * + date), not to the vehicle alone — so marking a service done (which
 * updates those fields) naturally opens a fresh cycle with a new key, and the
 * next time the vehicle falls due it materialises again instead of being
 * permanently suppressed by this cycle's claim.
 */
function vehicleServiceSourceKey(
  resourceId: string,
  lastServiceOdometerKm: number | null,
  lastServiceDate: string | null,
): string {
  return `${resourceId}:${lastServiceOdometerKm ?? "x"}:${lastServiceDate ?? "x"}`;
}

function dueReasonNotes(check: ReturnType<typeof checkServiceDue>, name: string): string {
  const parts: string[] = [];
  if (check.dueByKm && check.kmSinceService !== null) {
    parts.push(`${check.kmSinceService} km since the last service`);
  }
  if (check.dueByTime && check.nextServiceDate !== null) {
    parts.push(`next service was due ${check.nextServiceDate}`);
  }
  const reason = parts.length > 0 ? parts.join("; ") : "service interval reached";
  return `${name}: ${reason}.`;
}

/**
 * Enumerate every vehicle with service tracking configured, across every
 * non-demo user, and materialise a task for any that's due right now —
 * exactly once per (vehicle, service-cycle) key, ever. Returns the number of
 * tasks created.
 *
 * Mirrors `materializeCardDueTasks`'s isolation shape: each user's work is
 * isolated in its own try/catch, and within a user, each vehicle's own
 * claim+insert is additionally isolated so one vehicle colliding with a
 * stale/forged `sourceKey` cannot suppress that user's other vehicles in the
 * same pass.
 */
export async function materializeVehicleServiceTasks(db: Db, today?: string): Promise<number> {
  const ref = today ?? new Date().toISOString().slice(0, 10);

  const eligibleVehicles = await db
    .select({
      resourceId: vehicleDetails.resourceId,
      userId: vehicleDetails.userId,
      name: resources.name,
      serviceIntervalKm: vehicleDetails.serviceIntervalKm,
      serviceIntervalMonths: vehicleDetails.serviceIntervalMonths,
      lastServiceOdometerKm: vehicleDetails.lastServiceOdometerKm,
      lastServiceDate: vehicleDetails.lastServiceDate,
    })
    .from(vehicleDetails)
    .innerJoin(resources, eq(resources.id, vehicleDetails.resourceId))
    .innerJoin(users, eq(users.id, vehicleDetails.userId))
    .where(eq(users.isDemo, false));

  let created = 0;
  for (const vehicle of eligibleVehicles) {
    try {
      const state: VehicleServiceState = {
        serviceIntervalKm: vehicle.serviceIntervalKm,
        serviceIntervalMonths: vehicle.serviceIntervalMonths,
        lastServiceOdometerKm: vehicle.lastServiceOdometerKm,
        lastServiceDate: vehicle.lastServiceDate,
      };
      if (state.serviceIntervalKm === null && state.serviceIntervalMonths === null) continue;

      const [latest] = await db
        .select({ odometerKm: vehicleOdometerReadings.odometerKm })
        .from(vehicleOdometerReadings)
        .where(eq(vehicleOdometerReadings.resourceId, vehicle.resourceId))
        .orderBy(desc(vehicleOdometerReadings.readingDate), desc(vehicleOdometerReadings.createdAt))
        .limit(1);

      const check = checkServiceDue(state, latest?.odometerKm ?? null, ref);
      if (!check.due) continue;

      const sourceKey = vehicleServiceSourceKey(
        vehicle.resourceId,
        state.lastServiceOdometerKm,
        state.lastServiceDate,
      );

      try {
        const wasCreated = await db.transaction(async (tx) => {
          const claimed = await tx
            .insert(alertLedger)
            .values({ userId: vehicle.userId, kind: VEHICLE_SERVICE_TASK_KIND, refKey: sourceKey })
            .onConflictDoNothing()
            .returning({ id: alertLedger.id });
          if (claimed.length === 0) return false;

          await tx.insert(userTasks).values({
            userId: vehicle.userId,
            title: truncateTaskTitle(`Service due for ${vehicle.name}`),
            notes: dueReasonNotes(check, vehicle.name),
            dueDate: check.nextServiceDate,
            source: "vehicle-service",
            sourceKey,
          });
          return true;
        });
        if (wasCreated) created += 1;
      } catch (err) {
        console.error("materializeVehicleServiceTasks: failed for vehicle", {
          userId: vehicle.userId,
          resourceId: vehicle.resourceId,
          err,
        });
      }
    } catch (err) {
      console.error("materializeVehicleServiceTasks: failed for vehicle (pre-claim)", {
        userId: vehicle.userId,
        resourceId: vehicle.resourceId,
        err,
      });
    }
  }
  return created;
}
