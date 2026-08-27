import { and, desc, eq, gte, lte, max, min, sql } from "drizzle-orm";
import type {
  CreateOdometerReading,
  MarkServiceDone,
  OdometerReading,
  UpdateVehicleServiceConfig,
  VehicleOverview,
  VehicleServiceConfig,
  VehicleSummary,
  VehicleTransactionCandidate,
} from "@compass/shared";
import type { Db, DbOrTx } from "../../../db/index.ts";
import { resources } from "../../../db/schema.ts";
import { HttpError } from "../../../lib/errors.ts";
import { assertOwnedActiveTransaction } from "../../ledger/services/user-tasks.ts";
import { vehicleDetails, vehicleOdometerReadings } from "../schema.ts";
import { computeMileageIntervals, type OdometerPoint } from "./mileage.ts";
import { checkServiceDue } from "./service-due.ts";

type VehicleDetailsRow = typeof vehicleDetails.$inferSelect;
type OdometerRow = typeof vehicleOdometerReadings.$inferSelect;

const today = () => new Date().toISOString().slice(0, 10);

/** Asserts the resource exists, belongs to this user, and is a vehicle. Returns its name. */
export async function assertOwnedVehicle(db: DbOrTx, userId: string, resourceId: string): Promise<string> {
  const row = await db.query.resources.findFirst({
    where: and(eq(resources.id, resourceId), eq(resources.userId, userId)),
    columns: { kind: true, name: true },
  });
  if (!row) throw new HttpError(404, "Vehicle not found");
  if (row.kind !== "vehicle") throw new HttpError(400, "Not a vehicle resource");
  return row.name;
}

function toConfig(resourceId: string, row: VehicleDetailsRow | undefined): VehicleServiceConfig {
  return {
    resourceId,
    serviceIntervalKm: row?.serviceIntervalKm ?? null,
    serviceIntervalMonths: row?.serviceIntervalMonths ?? null,
    lastServiceOdometerKm: row?.lastServiceOdometerKm ?? null,
    lastServiceDate: row?.lastServiceDate ?? null,
  };
}

function toReading(row: OdometerRow & { amountPaise: number | null }): OdometerReading {
  return {
    id: row.id,
    resourceId: row.resourceId,
    odometerKm: row.odometerKm,
    readingDate: row.readingDate,
    transactionId: row.transactionId,
    amountPaise: row.amountPaise,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * The same "real, non-system leg" lookup `listReadingRows` does in bulk via a
 * lateral join, but for one transaction — used right after inserting a
 * reading so the response reflects its linked spend without re-querying
 * every reading on the vehicle. Null for no link, a soft-deleted transaction,
 * or a transaction with no ordinary (non-system) posting.
 */
async function fetchTransactionAmountPaise(
  db: DbOrTx,
  userId: string,
  transactionId: string | null | undefined,
): Promise<number | null> {
  if (!transactionId) return null;
  const result = await db.execute(sql`
    select abs(p.amount_paise) as amount_paise
    from postings p
    join accounts a on a.id = p.account_id
    join transactions t on t.id = p.transaction_id
    where t.id = ${transactionId} and t.user_id = ${userId} and t.deleted_at is null and a.system_kind is null
    order by (p.amount_paise < 0) desc, p.id
    limit 1
  `);
  const row = result.rows[0] as { amount_paise: string } | undefined;
  return row ? Number(row.amount_paise) : null;
}

/**
 * Every reading for a vehicle, newest first, with the linked transaction's
 * paise magnitude joined in (the "real", non-system leg — same lateral-join
 * shape `user-tasks.ts` uses for a task's linked transaction). A reading with
 * no `transactionId`, or whose link has since been soft-deleted, gets a null
 * `amountPaise` rather than being dropped.
 */
async function listReadingRows(
  db: DbOrTx,
  userId: string,
  resourceId: string,
): Promise<Array<OdometerRow & { amountPaise: number | null }>> {
  const result = await db.execute(sql`
    select
      r.id, r.user_id, r.resource_id, r.odometer_km, r.reading_date, r.transaction_id, r.notes,
      r.created_at, r.updated_at,
      rp.amount_paise as txn_amount_paise
    from vehicle_odometer_readings r
    left join transactions t
      on t.id = r.transaction_id
      and t.user_id = r.user_id
      and t.deleted_at is null
    left join lateral (
      select abs(p.amount_paise) as amount_paise
      from postings p
      join accounts a on a.id = p.account_id
      where p.transaction_id = t.id and a.system_kind is null
      order by (p.amount_paise < 0) desc, p.id
      limit 1
    ) rp on t.id is not null
    where r.resource_id = ${resourceId} and r.user_id = ${userId}
    order by r.reading_date desc, r.created_at desc
  `);
  return (
    result.rows as Array<{
      id: string;
      user_id: string;
      resource_id: string;
      odometer_km: number;
      reading_date: string;
      transaction_id: string | null;
      notes: string;
      created_at: string;
      updated_at: string;
      txn_amount_paise: string | null;
    }>
  ).map((row) => ({
    id: row.id,
    userId: row.user_id,
    resourceId: row.resource_id,
    odometerKm: row.odometer_km,
    readingDate: row.reading_date,
    transactionId: row.transaction_id,
    notes: row.notes,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    amountPaise: row.txn_amount_paise !== null ? Number(row.txn_amount_paise) : null,
  }));
}

/** Full detail view: config, due status, every reading, and the derived mileage intervals. */
export async function getVehicleSummary(db: Db, userId: string, resourceId: string): Promise<VehicleSummary> {
  const name = await assertOwnedVehicle(db, userId, resourceId);
  const [detailsRow, readingRows] = await Promise.all([
    db.query.vehicleDetails.findFirst({ where: eq(vehicleDetails.resourceId, resourceId) }),
    listReadingRows(db, userId, resourceId),
  ]);
  const config = toConfig(resourceId, detailsRow);
  const currentOdometerKm = readingRows[0]?.odometerKm ?? null; // newest-first
  const check = checkServiceDue(config, currentOdometerKm, today());
  const points: OdometerPoint[] = [...readingRows]
    .reverse() // oldest-first for interval computation
    .map((r) => ({ id: r.id, odometerKm: r.odometerKm, readingDate: r.readingDate, amountPaise: r.amountPaise }));

  return {
    resourceId,
    name,
    config,
    currentOdometerKm,
    serviceDue: check.due,
    dueByKm: check.dueByKm,
    dueByTime: check.dueByTime,
    nextServiceOdometerKm: check.nextServiceOdometerKm,
    nextServiceDate: check.nextServiceDate,
    readings: readingRows.map(toReading),
    intervals: computeMileageIntervals(points),
  };
}

/** Cheap per-vehicle summary for the overview list — no readings/intervals payload. */
export async function listVehicleOverviews(db: Db, userId: string): Promise<VehicleOverview[]> {
  const vehicleResources = await db.query.resources.findMany({
    where: and(eq(resources.userId, userId), eq(resources.kind, "vehicle")),
    columns: { id: true, name: true, archivedAt: true },
    orderBy: (r, { asc }) => [asc(r.archivedAt), asc(r.name)],
  });

  const overviews: VehicleOverview[] = [];
  for (const resource of vehicleResources) {
    const [detailsRow] = await db
      .select()
      .from(vehicleDetails)
      .where(eq(vehicleDetails.resourceId, resource.id));
    const [latest] = await db
      .select({ odometerKm: vehicleOdometerReadings.odometerKm })
      .from(vehicleOdometerReadings)
      .where(eq(vehicleOdometerReadings.resourceId, resource.id))
      .orderBy(desc(vehicleOdometerReadings.readingDate), desc(vehicleOdometerReadings.createdAt))
      .limit(1);
    const config = toConfig(resource.id, detailsRow);
    const check = checkServiceDue(config, latest?.odometerKm ?? null, today());
    overviews.push({
      resourceId: resource.id,
      name: resource.name,
      currentOdometerKm: latest?.odometerKm ?? null,
      serviceDue: check.due,
      dueByKm: check.dueByKm,
      dueByTime: check.dueByTime,
    });
  }
  return overviews;
}

/** Upsert the service-interval configuration. Creates the `vehicle_details` row on first use. */
export async function updateVehicleServiceConfig(
  db: Db,
  userId: string,
  resourceId: string,
  input: UpdateVehicleServiceConfig,
): Promise<VehicleServiceConfig> {
  await assertOwnedVehicle(db, userId, resourceId);
  const [row] = await db
    .insert(vehicleDetails)
    .values({ resourceId, userId, ...input })
    .onConflictDoUpdate({
      target: vehicleDetails.resourceId,
      set: { ...input, updatedAt: new Date() },
    })
    .returning();
  return toConfig(resourceId, row);
}

/** Convenience action: stamp "serviced today, at this odometer reading" without touching intervals. */
export async function markServiceDone(
  db: Db,
  userId: string,
  resourceId: string,
  input: MarkServiceDone,
): Promise<VehicleServiceConfig> {
  return updateVehicleServiceConfig(db, userId, resourceId, {
    lastServiceOdometerKm: input.odometerKm,
    lastServiceDate: input.serviceDate,
  });
}

/**
 * Sanity-checks a new reading against readings already on either side of its
 * date — a real odometer only counts up, so a value lower than an
 * earlier-dated reading, or higher than a later-dated one, is rejected rather
 * than silently corrupting every mileage interval it touches. Same-day
 * entries are allowed either order (the interval math handles that via its
 * own tiebreak).
 */
async function assertMonotonic(
  db: DbOrTx,
  resourceId: string,
  readingDate: string,
  odometerKm: number,
): Promise<void> {
  const [priorRow] = await db
    .select({ maxKm: max(vehicleOdometerReadings.odometerKm) })
    .from(vehicleOdometerReadings)
    .where(and(eq(vehicleOdometerReadings.resourceId, resourceId), lte(vehicleOdometerReadings.readingDate, readingDate)));
  if (priorRow?.maxKm !== null && priorRow?.maxKm !== undefined && odometerKm < priorRow.maxKm) {
    throw new HttpError(400, `Odometer reading is lower than an earlier reading of ${priorRow.maxKm} km`);
  }
  const [nextRow] = await db
    .select({ minKm: min(vehicleOdometerReadings.odometerKm) })
    .from(vehicleOdometerReadings)
    .where(and(eq(vehicleOdometerReadings.resourceId, resourceId), gte(vehicleOdometerReadings.readingDate, readingDate)));
  if (nextRow?.minKm !== null && nextRow?.minKm !== undefined && odometerKm > nextRow.minKm) {
    throw new HttpError(400, `Odometer reading is higher than a later reading of ${nextRow.minKm} km`);
  }
}

export async function addOdometerReading(
  db: Db,
  userId: string,
  resourceId: string,
  input: CreateOdometerReading,
): Promise<OdometerReading> {
  await assertOwnedVehicle(db, userId, resourceId);
  await assertOwnedActiveTransaction(db, userId, input.transactionId);
  await assertMonotonic(db, resourceId, input.readingDate, input.odometerKm);

  const [row] = await db
    .insert(vehicleOdometerReadings)
    .values({
      userId,
      resourceId,
      odometerKm: input.odometerKm,
      readingDate: input.readingDate,
      transactionId: input.transactionId ?? null,
      notes: input.notes,
    })
    .returning();
  const amountPaise = await fetchTransactionAmountPaise(db, userId, row!.transactionId);
  return toReading({ ...row!, amountPaise });
}

/**
 * Recent transactions already tagged to this vehicle resource, near a given
 * date — candidates for the "link to a spend" picker on the odometer-reading
 * form. Deliberately a small standalone query rather than a call into
 * `listTransactions` (ledger/services/transactions.ts): that service's filter
 * surface, response shape, and totals are carefully load-bearing for the main
 * Transactions page, and adding a `resourceId` filter there for this one
 * picker isn't worth the risk to it. `nearDate ± windowDays`, newest first,
 * capped at 20 — this is a convenience picker, not a full ledger view.
 */
export async function listVehicleTransactionCandidates(
  db: Db,
  userId: string,
  resourceId: string,
  nearDate: string,
  windowDays = 30,
): Promise<VehicleTransactionCandidate[]> {
  await assertOwnedVehicle(db, userId, resourceId);
  const result = await db.execute(sql`
    select t.id, t.date, t.merchant, rp.amount_paise
    from transactions t
    join lateral (
      select p.amount_paise
      from postings p
      join accounts a on a.id = p.account_id
      where p.transaction_id = t.id and a.system_kind is null
      order by (p.amount_paise < 0) desc, p.id
      limit 1
    ) rp on true
    where t.user_id = ${userId}
      and t.resource_id = ${resourceId}
      and t.deleted_at is null
      and abs(t.date::date - ${nearDate}::date) <= ${windowDays}
    order by t.date desc, t.id desc
    limit 20
  `);
  return (result.rows as Array<{ id: string; date: string; merchant: string; amount_paise: string }>).map(
    (row) => ({
      id: row.id,
      date: row.date,
      merchant: row.merchant,
      amountPaise: Number(row.amount_paise),
    }),
  );
}

export async function deleteOdometerReading(
  db: Db,
  userId: string,
  resourceId: string,
  id: string,
): Promise<void> {
  const rows = await db
    .delete(vehicleOdometerReadings)
    .where(
      and(
        eq(vehicleOdometerReadings.id, id),
        eq(vehicleOdometerReadings.resourceId, resourceId),
        eq(vehicleOdometerReadings.userId, userId),
      ),
    )
    .returning({ id: vehicleOdometerReadings.id });
  if (rows.length === 0) throw new HttpError(404, "Odometer reading not found");
}
