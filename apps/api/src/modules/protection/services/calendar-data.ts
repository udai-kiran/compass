/**
 * DB shell for the maturity calendar (task 14.3).
 * Gathers data from multiple tables and passes it to the pure computeMaturityCalendar.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "../../../db/index.ts";
import { todayInIST, type MaturityCalendar } from "@compass/shared";
import { accounts } from "../../../db/shared/hubs.ts";
import { insurancePolicies, holdings } from "../../../db/shared/spines.ts";
import { retirementDetails } from "../schema.ts";
import { goldDetails, depositDetails, holdingEvents } from "../../investments/schema.ts";
import { computeMaturityCalendar, type CalendarInput } from "./maturity-calendar.ts";

export async function getMaturityCalendar(db: Db, userId: string): Promise<MaturityCalendar> {
  const today = todayInIST();

  // Fetch all data sources in parallel
  const [policies, schemeAccts, sgb, deps, elssData] = await Promise.all([
    // 1. Insurance policies (non-archived)
    db
      .select({
        id: insurancePolicies.id,
        name: insurancePolicies.name,
        kind: insurancePolicies.kind,
        maturityDate: insurancePolicies.maturityDate,
        renewalDate: insurancePolicies.renewalDate,
        sumAssuredPaise: insurancePolicies.sumAssuredPaise,
        premiumPaise: insurancePolicies.premiumPaise,
      })
      .from(insurancePolicies)
      .where(and(eq(insurancePolicies.userId, userId), isNull(insurancePolicies.archivedAt))),

    // 2. PPF/EPF/SSY/NPS accounts with retirement_details
    db
      .select({
        id: accounts.id,
        name: accounts.name,
        type: accounts.type,
        schemeOpenedDate: accounts.schemeOpenedDate,
        maturityDate: retirementDetails.maturityDate,
      })
      .from(accounts)
      .leftJoin(retirementDetails, eq(retirementDetails.accountId, accounts.id))
      .where(
        and(
          eq(accounts.userId, userId),
          isNull(accounts.archivedAt),
          isNull(accounts.systemKind),
          sql`${accounts.type} in ('ppf', 'epf', 'ssy', 'nps')`,
        ),
      ),

    // 3. SGB holdings with gold_details
    db
      .select({
        id: holdings.id,
        name: holdings.name,
        maturityDate: goldDetails.maturityDate,
      })
      .from(holdings)
      .innerJoin(
        goldDetails,
        and(
          eq(goldDetails.holdingId, holdings.id),
          sql`${goldDetails.form} = 'sgb'`,
        ),
      )
      .where(and(eq(holdings.userId, userId), isNull(holdings.archivedAt))),

    // 4. FD/RD/NSC deposits
    db
      .select({
        holdingId: depositDetails.holdingId,
        holdingName: holdings.name,
        depositKind: depositDetails.depositKind,
        startDate: depositDetails.startDate,
        maturityDate: depositDetails.maturityDate,
        autoRenewal: depositDetails.autoRenewal,
        principalPaise: depositDetails.principalPaise,
        installmentPaise: depositDetails.installmentPaise,
      })
      .from(depositDetails)
      .innerJoin(holdings, eq(holdings.id, depositDetails.holdingId))
      .where(and(eq(depositDetails.userId, userId), isNull(holdings.archivedAt))),

    // 5. ELSS holdings with buy events
    db
      .select({
        holdingId: holdings.id,
        holdingName: holdings.name,
        eventDate: holdingEvents.date,
        eventAmountPaise: holdingEvents.amountPaise,
        eventUnits: holdingEvents.units,
      })
      .from(holdings)
      .innerJoin(
        holdingEvents,
        and(
          eq(holdingEvents.holdingId, holdings.id),
          sql`${holdingEvents.type} = 'buy'`,
        ),
      )
      .where(
        and(
          eq(holdings.userId, userId),
          eq(holdings.isElss, true),
          isNull(holdings.archivedAt),
        ),
      ),
  ]);

  // Group ELSS buy events by holding
  const elssMap = new Map<
    string,
    {
      holdingId: string;
      holdingName: string;
      buyEvents: Array<{ date: string; amountPaise: number; units: number | null }>;
    }
  >();
  for (const row of elssData) {
    let entry = elssMap.get(row.holdingId);
    if (!entry) {
      entry = { holdingId: row.holdingId, holdingName: row.holdingName, buyEvents: [] };
      elssMap.set(row.holdingId, entry);
    }
    entry.buyEvents.push({
      date: row.eventDate,
      amountPaise: row.eventAmountPaise,
      units: row.eventUnits,
    });
  }

  const input: CalendarInput = {
    today,
    insurancePolicies: policies as CalendarInput["insurancePolicies"],
    schemeAccounts: schemeAccts.map((a) => ({
      id: a.id,
      name: a.name,
      type: a.type as "ppf" | "epf" | "ssy" | "nps",
      schemeOpenedDate: a.schemeOpenedDate,
      balancePaise: 0, // balance not critical for the calendar
      maturityDate: a.maturityDate,
    })),
    sgbHoldings: sgb.map((s) => ({
      id: s.id,
      name: s.name,
      maturityDate: s.maturityDate,
      valuePaise: 0,
    })),
    deposits: deps as CalendarInput["deposits"],
    elssHoldings: [...elssMap.values()],
  };

  return computeMaturityCalendar(input);
}
