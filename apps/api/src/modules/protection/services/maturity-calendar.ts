/**
 * Maturity & renewal calendar (task 14.3).
 * Pure, DB-free — takes plain values from the DB shell, returns CalendarEvent[].
 */

import type { CalendarEvent, CalendarSource, MaturityCalendar } from "@compass/shared";
import { formatINR } from "@compass/shared";

export interface CalendarInput {
  today: string; // YYYY-MM-DD

  /** Insurance policies (active, non-archived) */
  insurancePolicies: Array<{
    id: string;
    name: string;
    kind: "life" | "health" | "vehicle";
    maturityDate: string | null;
    renewalDate: string | null;
    sumAssuredPaise: number;
    premiumPaise: number;
  }>;

  /** PPF/SSY/EPF accounts with their retirement_details */
  schemeAccounts: Array<{
    id: string;
    name: string;
    type: "ppf" | "epf" | "ssy" | "nps";
    schemeOpenedDate: string | null;
    balancePaise: number;
    maturityDate: string | null; // from retirement_details, if joined
  }>;

  /** SGB holdings with gold_details */
  sgbHoldings: Array<{
    id: string;
    name: string;
    maturityDate: string | null;
    /** approximate value in paise */
    valuePaise: number;
  }>;

  /** FD/RD/NSC deposits */
  deposits: Array<{
    holdingId: string;
    holdingName: string;
    depositKind: "fd" | "rd" | "nsc" | "tax_saver_fd";
    startDate: string;
    maturityDate: string;
    autoRenewal: boolean;
    principalPaise: number | null;
    installmentPaise: number | null;
  }>;

  /** ELSS holdings with their buy events for per-instalment lock-in */
  elssHoldings: Array<{
    holdingId: string;
    holdingName: string;
    buyEvents: Array<{
      date: string;
      amountPaise: number;
      units: number | null;
    }>;
  }>;
}

// ---------- Date helpers ----------

/** Adds whole years to an ISO date string, returning YYYY-MM-DD. */
function addYearsIso(iso: string, years: number): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y + years, m - 1, d)).toISOString().slice(0, 10);
}

/**
 * Computes the PPF maturity date: 15 years from the END of the financial year
 * in which the account was opened (FY = Apr–Mar).
 *
 * Opening FY end:
 * - If opened Apr–Mar of a given year, the FY end is 31 Mar of the NEXT year
 *   (e.g. opened May 2010 → FY 2010-11 → FY end = 31 Mar 2011).
 * - If opened 01 Apr of year Y through 31 Mar of year Y+1, FY end = 31 Mar Y+1.
 *
 * Then add 15 years to the FY end.
 */
export function ppfMaturityDate(schemeOpenedDate: string): string {
  const [y, m] = schemeOpenedDate.split("-").map(Number) as [number, number];
  // FY ending year: if month >= 4 (Apr or later), FY ends next year; otherwise same year
  const fyEndYear = m >= 4 ? y + 1 : y;
  const fyEnd = `${fyEndYear}-03-31`;
  return addYearsIso(fyEnd, 15);
}

// ---------- Pure computation ----------

function makeEvent(
  key: string,
  date: string,
  source: CalendarSource,
  title: string,
  description: string,
  entityId: string,
  amountPaise: number | null,
  today: string,
  warnings: string[] = [],
): CalendarEvent {
  return {
    key,
    date,
    source,
    title,
    description,
    entityId,
    amountPaise,
    isPast: date < today,
    warnings,
  };
}

/**
 * Computes the full maturity/renewal calendar from plain input values.
 * No DB access — all data must be supplied by the caller.
 */
export function computeMaturityCalendar(input: CalendarInput): MaturityCalendar {
  const { today } = input;
  const events: CalendarEvent[] = [];

  // ── Insurance ────────────────────────────────────────────────────────────
  for (const policy of input.insurancePolicies) {
    if (policy.renewalDate) {
      events.push(
        makeEvent(
          `insurance_renewal:${policy.id}`,
          policy.renewalDate,
          "insurance_renewal",
          `${policy.name} renewal due`,
          `${policy.kind.charAt(0).toUpperCase() + policy.kind.slice(1)} insurance policy renewal. Premium: ${formatINR(policy.premiumPaise)}.`,
          policy.id,
          policy.premiumPaise,
          today,
        ),
      );
    }
    if (policy.kind === "life" && policy.maturityDate) {
      events.push(
        makeEvent(
          `insurance_maturity:${policy.id}`,
          policy.maturityDate,
          "insurance_maturity",
          `${policy.name} matures`,
          `Life policy matures. Sum assured: ${formatINR(policy.sumAssuredPaise)}.`,
          policy.id,
          policy.sumAssuredPaise,
          today,
        ),
      );
    }
  }

  // ── Deposits (FD / RD / NSC / tax_saver_fd) ─────────────────────────────
  for (const dep of input.deposits) {
    const sourceMap: Record<string, CalendarSource> = {
      fd: "fd_maturity",
      tax_saver_fd: "fd_maturity",
      rd: "rd_maturity",
      nsc: "nsc_maturity",
    };
    const source = sourceMap[dep.depositKind] ?? "fd_maturity";
    const kindLabel =
      dep.depositKind === "tax_saver_fd"
        ? "Tax-saver FD"
        : dep.depositKind.toUpperCase();
    const amountPaise =
      dep.principalPaise != null
        ? dep.principalPaise
        : dep.installmentPaise;

    const warnings: string[] = [];
    if (dep.autoRenewal && (dep.depositKind === "fd" || dep.depositKind === "tax_saver_fd")) {
      warnings.push("Auto-renewal may roll into a worse rate");
    }

    events.push(
      makeEvent(
        `${source}:${dep.holdingId}`,
        dep.maturityDate,
        source,
        `${dep.holdingName} ${kindLabel} matures`,
        `${kindLabel} matures on ${dep.maturityDate}.${dep.autoRenewal ? " Auto-renewal is enabled." : ""}`,
        dep.holdingId,
        amountPaise,
        today,
        warnings,
      ),
    );
  }

  // ── Scheme accounts (PPF / SSY / EPF / NPS) ──────────────────────────────
  for (const acct of input.schemeAccounts) {
    if (acct.type === "ppf") {
      // Use explicit maturityDate from retirement_details if set; otherwise compute
      const matDate =
        acct.maturityDate ??
        (acct.schemeOpenedDate ? ppfMaturityDate(acct.schemeOpenedDate) : null);

      if (matDate) {
        events.push(
          makeEvent(
            `ppf_maturity:${acct.id}`,
            matDate,
            "ppf_maturity",
            `${acct.name} PPF matures`,
            `PPF account matures 15 years from end of opening financial year (${matDate}). Balance: ${formatINR(acct.balancePaise)}.`,
            acct.id,
            acct.balancePaise || null,
            today,
          ),
        );

        // 5-year extension blocks after maturity
        for (let block = 1; block <= 3; block++) {
          const extDate = addYearsIso(matDate, block * 5);
          events.push(
            makeEvent(
              `ppf_extension:${acct.id}:${block}`,
              extDate,
              "ppf_extension",
              `${acct.name} PPF extension block ${block} ends`,
              `PPF 5-year extension block ${block} ends. You may withdraw or renew for another block.`,
              acct.id,
              null,
              today,
            ),
          );
        }
      }
    } else if (acct.type === "ssy") {
      const matDate =
        acct.maturityDate ??
        (acct.schemeOpenedDate ? addYearsIso(acct.schemeOpenedDate, 21) : null);

      if (matDate) {
        events.push(
          makeEvent(
            `ssy_maturity:${acct.id}`,
            matDate,
            "ssy_maturity",
            `${acct.name} SSY matures`,
            `Sukanya Samriddhi account matures 21 years from account opening (${matDate}).`,
            acct.id,
            acct.balancePaise || null,
            today,
          ),
        );
      }

      // Partial withdrawal available after the girl turns 18 (18 years from opening)
      if (acct.schemeOpenedDate) {
        const partialDate = addYearsIso(acct.schemeOpenedDate, 18);
        events.push(
          makeEvent(
            `ssy_partial_withdrawal:${acct.id}`,
            partialDate,
            "ssy_partial_withdrawal",
            `${acct.name} SSY partial withdrawal available`,
            `SSY partial withdrawal (up to 50% of previous year balance) available after the girl turns 18. Verify the account holder's date of birth for accuracy.`,
            acct.id,
            null,
            today,
          ),
        );
      }
    } else if (acct.type === "epf") {
      events.push(
        makeEvent(
          `epf_retirement:${acct.id}`,
          // No specific date without DOB — use a far-future placeholder that
          // signals "track manually"; the description explains.
          "9999-12-31",
          "epf_retirement",
          `${acct.name} EPF accessible at retirement`,
          `EPF is accessible at retirement (typically age 58). Date cannot be computed without date of birth — please track manually.`,
          acct.id,
          acct.balancePaise || null,
          today,
        ),
      );
    }
    // NPS: no fixed statutory maturity — omit from calendar
  }

  // ── SGB ──────────────────────────────────────────────────────────────────
  for (const sgb of input.sgbHoldings) {
    if (!sgb.maturityDate) continue;

    // Full maturity (year 8)
    events.push(
      makeEvent(
        `sgb_maturity:${sgb.id}`,
        sgb.maturityDate,
        "sgb_maturity",
        `${sgb.name} SGB matures`,
        `Sovereign Gold Bond matures (8-year tenure). Redemption at prevailing gold price.`,
        sgb.id,
        sgb.valuePaise || null,
        today,
      ),
    );

    // Exit window opens at year 5 (maturityDate - 3 years)
    const exitDate = addYearsIso(sgb.maturityDate, -3);
    events.push(
      makeEvent(
        `sgb_exit_window:${sgb.id}`,
        exitDate,
        "sgb_exit_window",
        `${sgb.name} SGB exit window opens`,
        `SGB premature exit window opens (year 5 from issue). You may redeem on the next coupon date.`,
        sgb.id,
        null,
        today,
      ),
    );
  }

  // ── ELSS per-instalment lock-in ───────────────────────────────────────────
  for (const elss of input.elssHoldings) {
    for (const evt of elss.buyEvents) {
      const unlockDate = addYearsIso(evt.date, 3);
      events.push(
        makeEvent(
          `elss_unlock:${elss.holdingId}:${evt.date}`,
          unlockDate,
          "elss_unlock",
          `${elss.holdingName} ELSS units unlock`,
          `ELSS units bought on ${evt.date} (amount: ${formatINR(evt.amountPaise)}${evt.units != null ? `, ${evt.units} units` : ""}) are locked until ${unlockDate}.`,
          elss.holdingId,
          evt.amountPaise,
          today,
        ),
      );
    }
  }

  // ── Sort by date ascending ────────────────────────────────────────────────
  events.sort((a, b) => a.date.localeCompare(b.date));

  const upcomingCount = events.filter((e) => !e.isPast).length;
  const pastCount = events.filter((e) => e.isPast).length;
  const maturedIdleCount = events.filter(
    (e) => e.isPast && e.source.endsWith("_maturity"),
  ).length;

  return { events, upcomingCount, pastCount, maturedIdleCount };
}
