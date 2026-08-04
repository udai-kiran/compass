import { and, eq, isNull, lte } from "drizzle-orm";
import type {
  CreateRecurringTemplate,
  RecurringTemplate,
  UpdateRecurringTemplate,
} from "@compass/shared";
import { EMI_DESTINATION_TYPES } from "@compass/shared";
import type { Db } from "../../../db/index.ts";
import { recurringTemplates, transactions } from "../schema.ts";
import { emiDetails } from "../../../db/schema.ts";
import { HttpError } from "../../../lib/errors.ts";
import { lockAccountPair, stepAmortization } from "../../credit/services/emis.ts";
import { assertOwnedAccount, assertOwnedCategory } from "../../../services/ownership.ts";
import { assertOwnedResource } from "./resources.ts";

type TemplateRow = typeof recurringTemplates.$inferSelect;

function toTemplate(r: TemplateRow): RecurringTemplate {
  return {
    id: r.id,
    accountId: r.accountId,
    categoryId: r.categoryId,
    merchant: r.merchant,
    amountPaise: r.amountPaise,
    notes: r.notes,
    frequency: r.frequency,
    interval: r.interval,
    nextDueDate: r.nextDueDate,
    endDate: r.endDate,
    paused: r.pausedAt !== null,
    kind: r.kind,
    remindDays: r.remindDays,
    resourceId: r.resourceId,
  };
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Advance a due date by one schedule step; month/year steps clamp the day (Jan 31 → Feb 28). */
export function advanceDate(
  date: string,
  frequency: RecurringTemplate["frequency"],
  interval: number,
): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  switch (frequency) {
    case "daily": {
      const t = new Date(Date.UTC(y, m - 1, d + interval));
      return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
    }
    case "weekly": {
      const t = new Date(Date.UTC(y, m - 1, d + 7 * interval));
      return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
    }
    case "monthly": {
      const total = m - 1 + interval;
      const ty = y + Math.floor(total / 12);
      const tm = (total % 12) + 1;
      const lastDay = new Date(Date.UTC(ty, tm, 0)).getUTCDate();
      return `${ty}-${pad(tm)}-${pad(Math.min(d, lastDay))}`;
    }
    case "yearly": {
      const ty = y + interval;
      const lastDay = new Date(Date.UTC(ty, m, 0)).getUTCDate();
      return `${ty}-${pad(m)}-${pad(Math.min(d, lastDay))}`;
    }
  }
}

export async function listTemplates(db: Db, userId: string): Promise<RecurringTemplate[]> {
  const rows = await db.query.recurringTemplates.findMany({
    where: eq(recurringTemplates.userId, userId),
    orderBy: (t, { asc }) => [asc(t.nextDueDate)],
  });
  return rows.map(toTemplate);
}

export async function createTemplate(
  db: Db,
  userId: string,
  input: CreateRecurringTemplate,
): Promise<RecurringTemplate> {
  // An EMI-kind template must always be paired with an emiDetails row,
  // created together in one transaction by createEmi (see
  // modules/credit/services/emis.ts).
  // Letting this generic create path accept kind: "emi" would produce a
  // template materializeDue's EMI branch tries to read emiDetails for, finds
  // nothing, and silently falls back to source-only posting — not wrong, but
  // a template that can never be a real EMI. Rejected outright instead.
  if (input.kind === "emi") {
    throw new HttpError(
      400,
      "An EMI can only be created via POST /api/emis, not POST /api/recurring",
    );
  }
  await assertOwnedAccount(db, userId, input.accountId);
  await assertOwnedCategory(db, userId, input.categoryId);
  await assertOwnedResource(db, userId, input.resourceId);
  const rows = await db
    .insert(recurringTemplates)
    .values({ ...input, userId })
    .returning();
  return toTemplate(rows[0]!);
}

/**
 * Atomic (locked, single transaction): reads the current row, validates the
 * *effective* (patch-applied) state, and writes — all inside one `SELECT
 * ... FOR UPDATE`-guarded transaction, so two concurrent PATCH requests on
 * the same template can't each individually pass validation against a stale
 * snapshot and combine into an invalid state. Also enforces that an EMI-kind
 * template's schedule stays monthly/interval-1 (materializeDue's EMI branch
 * depends on "every materialized date is exactly one monthly period" — see
 * tasks/emi-loan-destination-account) and rejects any transition *into*
 * `kind: "emi"` (only `createEmi` may create one, always paired with its
 * `emiDetails` row). A transition *away* from `"emi"` is left unrestricted —
 * pre-existing decoupling between `kind` and `emiDetails`'s existence,
 * `listEmis` already tolerates it.
 */
export async function updateTemplate(
  db: Db,
  userId: string,
  id: string,
  input: UpdateRecurringTemplate,
): Promise<RecurringTemplate> {
  const { paused, ...rest } = input;
  await assertOwnedAccount(db, userId, rest.accountId);
  await assertOwnedCategory(db, userId, rest.categoryId);
  await assertOwnedResource(db, userId, rest.resourceId);
  return db.transaction(async (trx) => {
    const rows = await trx
      .select()
      .from(recurringTemplates)
      .where(and(eq(recurringTemplates.id, id), eq(recurringTemplates.userId, userId)))
      .for("update");
    const current = rows[0];
    if (!current) throw new HttpError(404, "Template not found");
    if (rest.kind === "emi" && current.kind !== "emi") {
      throw new HttpError(
        400,
        "An EMI can only be created via POST /api/emis, not by changing an existing template's kind",
      );
    }
    const effectiveKind = rest.kind ?? current.kind;
    const effectiveFrequency = rest.frequency ?? current.frequency;
    const effectiveInterval = rest.interval ?? current.interval;
    if (effectiveKind === "emi" && (effectiveFrequency !== "monthly" || effectiveInterval !== 1)) {
      throw new HttpError(400, "An EMI's schedule must stay monthly with interval 1");
    }
    const set: Record<string, unknown> = { ...rest, updatedAt: new Date() };
    if (paused !== undefined) set.pausedAt = paused ? new Date() : null;
    const updated = await trx
      .update(recurringTemplates)
      .set(set)
      // id + userId, matching today's predicate exactly — redundant with the
      // locked read above (which already scoped by both), kept anyway as
      // visible defense-in-depth rather than narrowed to id alone.
      .where(and(eq(recurringTemplates.id, id), eq(recurringTemplates.userId, userId)))
      .returning();
    return toTemplate(updated[0]!);
  });
}

export async function deleteTemplate(db: Db, userId: string, id: string): Promise<void> {
  const rows = await db
    .delete(recurringTemplates)
    .where(and(eq(recurringTemplates.id, id), eq(recurringTemplates.userId, userId)))
    .returning({ id: recurringTemplates.id });
  if (rows.length === 0) throw new HttpError(404, "Template not found");
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Materialize every due instance across all users. Insert + pointer advance
 * happen in one DB transaction per template, so a crash can't double-create —
 * the daily job is idempotent. Returns the affected user ids.
 *
 * Claim mechanism: locks the template row (`SELECT ... FOR UPDATE`) *first*,
 * then generates `dates` and builds every insert from that freshly locked
 * row — never the outer batch-query snapshot. This closes a staleness
 * window a concurrent `updateTemplate` call could otherwise open (changing
 * `accountId`/`amountPaise`/`frequency`/etc. without touching `nextDueDate`,
 * which the old CAS-based claim wouldn't have caught) — see
 * tasks/emi-loan-destination-account, "round 3" notes, finding 3. This
 * replaces the old optimistic (CAS: `UPDATE ... WHERE next_due_date = ?`)
 * double-fire guard with a blocking one: a concurrent second run on the same
 * template now blocks on the lock until the first transaction commits, then
 * re-reads and sees `nextDueDate` already past `today`, so `dates.length ===
 * 0` and it no-ops. Equivalent double-create protection, just via blocking
 * instead of a non-blocking CAS miss — a deliberate, disclosed behavior
 * change to the shared mechanism (affects every `recurringKind`, not just
 * EMI), inconsequential for a background batch job.
 *
 * `onEmiLegsForTest` is a TEST-ONLY injection seam: an optional callback,
 * defaulting to a no-op, invoked (with the template id being processed)
 * between the EMI branch's source-leg insert and its destination-leg
 * insert. It exists solely so recurring.test.ts can force a failure
 * mid-transaction to prove the whole thing rolls back atomically (no
 * partial state) — this repo has no DB-mocking infrastructure to induce
 * that any other way. Receiving the template id (rather than a bare
 * no-argument callback) lets the test scope its forced failure to only its
 * own throwaway template, so it doesn't collaterally abort some other,
 * genuinely-due EMI template's real materialization if this runs against a
 * shared database. Never referenced outside that test.
 */
export async function materializeDue(
  db: Db,
  onEmiLegsForTest?: (templateId: string) => void | Promise<void>,
): Promise<{ created: number; userIds: string[] }> {
  const today = todayIso();
  const due = await db.query.recurringTemplates.findMany({
    where: and(isNull(recurringTemplates.pausedAt), lte(recurringTemplates.nextDueDate, today)),
    columns: { id: true },
  });
  let created = 0;
  const userIds = new Set<string>();
  for (const { id } of due) {
    const result = await db.transaction(async (trx) => {
      const rows = await trx
        .select()
        .from(recurringTemplates)
        .where(eq(recurringTemplates.id, id))
        .for("update");
      const t = rows[0];
      if (!t || t.pausedAt !== null) return null; // deleted or paused since the outer scan
      const dates: string[] = [];
      let next = t.nextDueDate;
      while (next <= today) {
        if (t.endDate !== null && next > t.endDate) break;
        dates.push(next);
        next = advanceDate(next, t.frequency, t.interval);
      }
      if (dates.length === 0) return null;
      await trx
        .update(recurringTemplates)
        .set({ nextDueDate: next, updatedAt: new Date() })
        .where(eq(recurringTemplates.id, t.id));

      if (t.kind === "emi") {
        // Unlocked probe read, purely to learn which account (if any) to
        // lock — materializeDue can't know the destination account id
        // until it has read emiDetails at least once. Same technique
        // recordSipInstallment uses in sips.ts to learn which holding to
        // lock before locking the SIP row; unlike that caller, there's no
        // interactive request to retry against here, so a stale probe just
        // falls through to source-only posting instead of a 409.
        const probe = await trx.query.emiDetails.findFirst({
          where: eq(emiDetails.templateId, t.id),
        });
        if (probe?.loanAccountId) {
          const locked = await lockAccountPair(trx, t.userId, t.accountId, probe.loanAccountId);
          const d = await trx
            .select()
            .from(emiDetails)
            .where(eq(emiDetails.templateId, t.id))
            .for("update");
          const details = d[0];
          const dest = locked.get(probe.loanAccountId);
          const destStillValid =
            details?.loanAccountId === probe.loanAccountId && // unchanged since the probe
            dest !== undefined &&
            dest.archivedAt === null &&
            (EMI_DESTINATION_TYPES as readonly string[]).includes(dest.type) &&
            t.frequency === "monthly" &&
            t.interval === 1; // belt-and-suspenders — see "round 3" note 2

          if (details && destStillValid) {
            let balance = details.outstandingPrincipalPaise ?? details.principalPaise;
            const principalLegs: { date: string; amountPaise: number }[] = [];
            for (const date of dates) {
              const step = stepAmortization(balance, details.annualRateBps, t.amountPaise);
              balance = step.balancePaise;
              // Zero-principal steps are skipped on the destination side (no
              // ₹0 transaction) — guarded for defensiveness/symmetry with
              // splitInstallments, not expected in practice since
              // t.amountPaise is always the template's fixed, fully-paid
              // installment.
              if (step.principalPaise > 0) {
                principalLegs.push({ date, amountPaise: step.principalPaise });
              }
            }
            await trx.insert(transactions).values(
              dates.map((date) => ({
                userId: t.userId,
                accountId: t.accountId,
                date,
                amountPaise: t.amountPaise,
                merchant: t.merchant,
                categoryId: t.categoryId,
                notes: t.notes,
                source: "recurring" as const,
                resourceId: t.resourceId,
                recurringTemplateId: t.id,
              })),
            );
            if (onEmiLegsForTest) await onEmiLegsForTest(t.id);
            if (principalLegs.length > 0) {
              await trx.insert(transactions).values(
                principalLegs.map((leg) => ({
                  userId: t.userId,
                  accountId: details.loanAccountId!,
                  date: leg.date,
                  amountPaise: leg.amountPaise,
                  merchant: t.merchant,
                  categoryId: null,
                  notes: "",
                  source: "recurring" as const,
                  recurringTemplateId: t.id,
                })),
              );
            }
            await trx
              .update(emiDetails)
              .set({ outstandingPrincipalPaise: balance, updatedAt: new Date() })
              .where(eq(emiDetails.templateId, t.id));
            return { created: dates.length, userId: t.userId };
          }
          // destination configured but no longer valid (archived/retyped/
          // repointed/schedule changed) at materialization time — fall
          // through to the generic path below: source leg only, exactly
          // like an EMI with no destination account.
        }
      }

      await trx.insert(transactions).values(
        dates.map((date) => ({
          userId: t.userId,
          accountId: t.accountId,
          date,
          amountPaise: t.amountPaise,
          merchant: t.merchant,
          categoryId: t.categoryId,
          notes: t.notes,
          source: "recurring" as const,
          resourceId: t.resourceId,
          recurringTemplateId: t.id,
        })),
      );
      return { created: dates.length, userId: t.userId };
    });
    if (result) {
      created += result.created;
      userIds.add(result.userId);
    }
  }
  return { created, userIds: [...userIds] };
}
