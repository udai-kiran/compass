/**
 * deadline-nudges.ts — Tax deadline nudge service (task 13.9).
 *
 * Nightly job: per-user evaluation of tax-related notifications:
 *  - New-regime users: fires one "80C is pointless for you" explanation per FY,
 *    so users aren't misled into chasing pointless deductions.
 *  - Old-regime users: escalating 80C / 80CCD(1B) / 80D headroom prompts at
 *    90 / 30 / 7 days before 31 March, only when headroom > 0.
 *  - All users, regime-independent: PPF/SSY minimum-contribution-before-
 *    dormancy nudges (11.6), escalating at the same 90/30/7 days-before-31-
 *    March tiers as the 80C/80D headroom nudges (fired once per account per
 *    tier per FY), from the same below-minimum signal scheme-compliance.ts
 *    already computes.
 *  - All users, regime-independent: ELSS lock-in ending / tax-saver FD
 *    maturity awareness (11.3, 12.3), fired once per lot/deposit within a
 *    30-day lead window of the unlock/maturity date.
 *  - All users: advance-tax instalment reminders within ADVANCE_TAX_LEAD_DAYS
 *    of each statutory due date, once per (userId, kind, dueDate) — gated on
 *    the user actually crossing the Sec 208 ₹10,000 net-payable threshold
 *    (reuses advance-tax.ts's getAdvanceTaxPosition/sec208Applies).
 *
 * Dedup: every notification is gated through alert_ledger (unique index on
 * userId + kind + refKey) so each fires at most once per tier / instalment /
 * account / lot / deposit, inserted atomically with the notification itself
 * (single db.transaction — see fireOnce) so a post-insert failure never
 * permanently burns a dedup key without the user ever seeing the nudge.
 *
 * Kill switches via notificationPrefs:
 *   "tax"         — headroom + regime explanation + scheme-dormancy +
 *                   ELSS/FD-maturity nudges (default: enabled)
 *   "advance_tax" — instalment reminders (default: enabled)
 *
 * All amounts: integer paise.
 */

import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "../../../db/index.ts";
import { alertLedger } from "../../../db/schema.ts";
import { incomeEvents } from "../schema.ts";
import { userProfiles } from "../../system/schema.ts";
import { createNotification } from "../../system/services/notifications.ts";
import { prefEnabled } from "../../system/services/prefs.ts";
import { getRegimePreference } from "./regime-preference.ts";
import { getDeductionBasket } from "./deductions.ts";
import { isSeniorCitizenOnDate } from "./deductions.ts";
import { getAllSchemeCompliance } from "./scheme-compliance.ts";
import { getAdvanceTaxPosition, sec208Applies } from "./advance-tax.ts";
import { holdings, holdingEvents, depositDetails } from "../../investments/schema.ts";
import { realizeGains } from "../../investments/services/tax-lots.ts";
import { addMonthsClamped } from "../../investments/services/tax-harvesting.ts";
import { getAdvanceTaxSchedule, coveredFys } from "../../../lib/tax-rules.ts";
import { fyOf, fyRange } from "../../../lib/financial-year.ts";
import { formatINR, type AccountComplianceResult } from "@compass/shared";

/** Lead time for advance-tax instalment reminders (days before due date). */
const ADVANCE_TAX_LEAD_DAYS = 14;

/**
 * Lead time for ELSS lock-in-ending / tax-saver-FD-maturity nudges (days
 * before the unlock/maturity date). These are single point-in-time events
 * (not an FY-bound deadline), so one lead window is used rather than the
 * 90/30/7-day headroomTier escalation.
 */
const MATURITY_LEAD_DAYS = 30;

/**
 * ELSS lock-in period, in months. Mirrors tax-harvesting.ts's private
 * `ELSS_LOCKIN_MONTHS` (not exported there, so duplicated here as a constant
 * rather than re-derived) — `addMonthsClamped` itself IS reused from that
 * module so the date math stays identical.
 */
const ELSS_LOCKIN_MONTHS = 36;

// ─── Pure helpers (exported for unit tests) ───────────────────────────────────

/**
 * Days from `today` to `target` (both ISO "YYYY-MM-DD").
 * Returns 0 on the same day, negative if target is in the past.
 */
export function daysUntil(today: string, target: string): number {
  return Math.round(
    (Date.UTC(
      Number(target.slice(0, 4)),
      Number(target.slice(5, 7)) - 1,
      Number(target.slice(8, 10)),
    ) -
      Date.UTC(
        Number(today.slice(0, 4)),
        Number(today.slice(5, 7)) - 1,
        Number(today.slice(8, 10)),
      )) /
      86_400_000,
  );
}

/**
 * Returns the escalation tier label for a given days-remaining count before FY end,
 * or null if no nudge is warranted yet (> 90 days out or already past).
 *
 * Tier schedule:
 *   ≤  7 days → "7d"   (final warning)
 *   ≤ 30 days → "30d"
 *   ≤ 90 days → "90d"  (first reminder)
 *   > 90 days → null
 */
export function headroomTier(daysToFyEnd: number): "7d" | "30d" | "90d" | null {
  if (daysToFyEnd < 0) return null;
  if (daysToFyEnd <= 7) return "7d";
  if (daysToFyEnd <= 30) return "30d";
  if (daysToFyEnd <= 90) return "90d";
  return null;
}

/**
 * True when `daysToTarget` names a future (or same-day) date within
 * `leadDays` of it — i.e. the target hasn't passed and is close enough to
 * warrant a nudge. Used for the ELSS lock-in and tax-saver FD maturity
 * nudges, which are single point-in-time events rather than an escalating
 * FY-end deadline (see headroomTier for that pattern instead).
 */
export function withinLeadWindow(daysToTarget: number, leadDays: number): boolean {
  return daysToTarget >= 0 && daysToTarget <= leadDays;
}

/**
 * True when a scheme-compliance result represents a PPF/SSY account at risk
 * of (or already) discontinued for missing the statutory minimum
 * contribution. NPS Tier I is excluded — it reports "below_min", a distinct
 * status with no analogous discontinuation risk.
 */
export function isSchemeDormancyRisk(
  result: Pick<AccountComplianceResult, "schemeKind" | "statusCode">,
): boolean {
  return (
    (result.schemeKind === "ppf" || result.schemeKind === "ssy") &&
    (result.statusCode === "discontinued_risk" || result.statusCode === "discontinued")
  );
}

// ─── Internal: deduped fire-once helper ──────────────────────────────────────

/**
 * Insert the alert_ledger dedup row and create the notification atomically —
 * a single transaction so a post-insert failure (e.g. a transient DB error
 * from createNotification) can never permanently burn a dedup key without the
 * user ever seeing the corresponding notification.
 */
async function fireOnce(
  db: Db,
  userId: string,
  kind: string,
  refKey: string,
  notification: { type: string; title: string; body: string; data?: unknown },
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(alertLedger)
      .values({ userId, kind, refKey })
      .onConflictDoNothing()
      .returning({ id: alertLedger.id });
    if (inserted.length === 0) return false;
    await createNotification(tx, userId, notification);
    return true;
  });
}

// ─── Per-user evaluator ───────────────────────────────────────────────────────

/**
 * Evaluate and fire tax deadline nudges for a single user.
 *
 * @param today - ISO "YYYY-MM-DD" override (defaults to today UTC). Injected in tests.
 * @returns count of notifications fired.
 */
export async function evaluateTaxDeadlineNudges(
  db: Db,
  userId: string,
  today?: string,
): Promise<number> {
  const todayStr = today ?? new Date().toISOString().slice(0, 10);
  const fy = fyOf(todayStr);

  // Skip if FY not covered by tax rules data
  if (!coveredFys().includes(fy)) return 0;

  // FY end date: 31 March of the closing year, e.g. "2026-03-31"
  const fyEnd = fyRange(fy)[1];

  let fired = 0;

  // ── Regime / headroom nudges ───────────────────────────────────────────────
  const taxEnabled = await prefEnabled(db, userId, "tax");
  if (taxEnabled) {
    // Escalating-deadline window (90/30/7 days before 31 March), shared by
    // the old-regime headroom block below AND the regime-independent scheme-
    // dormancy block further down — computed once here so both can use it.
    const daysToFyEnd = daysUntil(todayStr, fyEnd);
    const tier = headroomTier(daysToFyEnd);
    const daysLabel = `${daysToFyEnd} day${daysToFyEnd === 1 ? "" : "s"} left`;

    const regimePref = await getRegimePreference(db, userId, fy);
    const regime = regimePref.effective;

    if (regime === "new") {
      // Fire once per FY: explain why 80C/80D headroom is irrelevant under new regime.
      const sent = await fireOnce(db, userId, "tax-new-regime-explain", fy, {
        type: "tax",
        title: "80C investments won't save tax under new regime",
        body:
          `You're on the new tax regime for FY ${fy}. Deductions like 80C (ELSS, PPF) ` +
          `and 80D don't apply — chasing them for tax saving is pointless. Use the ` +
          `regime comparison to decide if switching to old regime benefits you.`,
        data: { fy, regime: "new" },
      });
      if (sent) fired++;
    } else {
      // Old regime — escalating headroom nudges as 31 March approaches.
      if (tier !== null) {
        const basket = await getDeductionBasket(db, userId, fy);

        // 80C headroom
        const eightyCHeadroom = basket.eightyC.headroomPaise;
        if (eightyCHeadroom !== null && eightyCHeadroom > 0) {
          const sent = await fireOnce(db, userId, "tax-80c-headroom", `${fy}:${tier}`, {
            type: "tax",
            title: `${formatINR(eightyCHeadroom)} of 80C headroom — ${daysLabel}`,
            body:
              `You have unused 80C deduction space for FY ${fy}. Invest in ELSS, PPF, ` +
              `or NPS before 31 March to reduce taxable income under the old regime.`,
            data: { fy, regime, section: "80C", headroomPaise: eightyCHeadroom, daysToFyEnd, tier },
          });
          if (sent) fired++;
        }

        // 80CCD(1B) headroom — NPS additional deduction, separate ceiling from 80C
        const ccd1bHeadroom = basket.eightyCcd1b.headroomPaise;
        if (ccd1bHeadroom !== null && ccd1bHeadroom > 0) {
          const sent = await fireOnce(db, userId, "tax-ccd1b-headroom", `${fy}:${tier}`, {
            type: "tax",
            title: `${formatINR(ccd1bHeadroom)} of 80CCD(1B) NPS headroom — ${daysLabel}`,
            body:
              `Extra NPS contributions beyond 80C qualify for an additional ` +
              `₹50,000 deduction under 80CCD(1B). ${daysLabel} to invest for FY ${fy}.`,
            data: { fy, regime, section: "80CCD(1B)", headroomPaise: ccd1bHeadroom, daysToFyEnd, tier },
          });
          if (sent) fired++;
        }

        // 80D headroom (self+family + parents combined)
        const eightyDHeadroom =
          (basket.eightyD.selfFamily.headroomPaise ?? 0) +
          (basket.eightyD.parents.headroomPaise ?? 0);
        if (eightyDHeadroom > 0) {
          const sent = await fireOnce(db, userId, "tax-80d-headroom", `${fy}:${tier}`, {
            type: "tax",
            title: `${formatINR(eightyDHeadroom)} of 80D health-insurance headroom — ${daysLabel}`,
            body:
              `You have unused 80D deduction capacity for FY ${fy}. Health insurance ` +
              `premiums for self, family, and parents can still be claimed before 31 March.`,
            data: { fy, regime, section: "80D", headroomPaise: eightyDHeadroom, daysToFyEnd, tier },
          });
          if (sent) fired++;
        }
      }
    }

    // ── PPF/SSY minimum-contribution-before-dormancy nudge (11.6) ───────────
    // Regime-independent (unlike the 80C/80D block above): missing a scheme's
    // statutory minimum risks account discontinuation regardless of whether
    // the contribution itself earns a deduction this FY. Reuses
    // scheme-compliance.ts's own status/notes rather than re-deriving the
    // below-minimum signal. Gated behind the same 90/30/7-day headroomTier
    // escalation window as the 80C/80D nudges above: statusCode can already
    // report discontinued_risk very early in the FY (e.g. right after 1
    // April), long before the 31 March deadline is actually urgent, so
    // firing unconditionally would burn the one-shot-per-FY dedup key months
    // before the risk is actionable and then never fire again as the
    // deadline approaches. Keying the dedup on tier (not just fy:accountId)
    // lets the nudge re-fire at each tier boundary, mirroring the 80C/80D
    // escalation pattern exactly.
    if (tier !== null) {
      const complianceResults = await getAllSchemeCompliance(db, userId, fy);
      for (const result of complianceResults) {
        if (!isSchemeDormancyRisk(result)) continue;
        const schemeName = result.schemeKind === "ppf" ? "PPF" : "SSY";
        const note =
          result.notes[result.notes.length - 1] ??
          `${schemeName} contribution is below the statutory minimum for FY ${fy} — the account risks discontinuation.`;
        const sent = await fireOnce(
          db,
          userId,
          "tax-scheme-dormancy",
          `${fy}:${tier}:${result.accountId}`,
          {
            type: "tax",
            title: `${schemeName} account at risk of discontinuation — ${daysLabel}`,
            body: `${note} ${daysLabel} in FY ${fy}.`,
            data: {
              fy,
              accountId: result.accountId,
              schemeKind: result.schemeKind,
              statusCode: result.statusCode,
              deficitPaise: result.deficitPaise,
              daysToFyEnd,
              tier,
            },
          },
        );
        if (sent) fired++;
      }
    }

    // ── ELSS lock-in ending nudge (11.3) ─────────────────────────────────────
    // Fires once per open lot, within MATURITY_LEAD_DAYS of its 3-year unlock
    // date. `addMonthsClamped` and the FIFO `realizeGains` open-lot list are
    // reused verbatim from tax-harvesting.ts / tax-lots.ts rather than
    // re-derived, to avoid subtly-different date/lot math living in two places.
    const elssHoldings = await db.query.holdings.findMany({
      where: and(eq(holdings.userId, userId), eq(holdings.isElss, true)),
    });
    if (elssHoldings.length > 0) {
      const holdingIds = elssHoldings.map((h) => h.id);
      const elssEvents = await db.query.holdingEvents.findMany({
        where: inArray(holdingEvents.holdingId, holdingIds),
      });
      for (const h of elssHoldings) {
        const evts = elssEvents.filter((e) => e.holdingId === h.id && e.date <= todayStr);
        if (evts.length === 0) continue;
        const gains = realizeGains(evts, {
          taxClass: h.gainsTaxClass,
          grandfatherNavPaise: h.grandfatherNavPaise,
        });
        for (const lot of gains.openLots) {
          const unlockDate = addMonthsClamped(lot.buyDate, ELSS_LOCKIN_MONTHS);
          const daysToUnlock = daysUntil(todayStr, unlockDate);
          if (!withinLeadWindow(daysToUnlock, MATURITY_LEAD_DAYS)) continue;
          const sent = await fireOnce(db, userId, "tax-elss-lockin", `${h.id}:${lot.buyDate}`, {
            type: "tax",
            title: `ELSS lock-in ending — ${h.name}`,
            body:
              `Units of "${h.name}" bought on ${lot.buyDate} complete their 3-year ELSS ` +
              `lock-in on ${unlockDate} and become freely redeemable. Decide whether to ` +
              `hold or redeem.`,
            data: { holdingId: h.id, buyDate: lot.buyDate, unlockDate },
          });
          if (sent) fired++;
        }
      }
    }

    // ── Tax-saver FD maturity nudge (12.3) ───────────────────────────────────
    // Fires once per deposit, within MATURITY_LEAD_DAYS of its 5-year maturity
    // date (deposit_details.maturityDate is fixed at creation for a lump-sum
    // instrument — no recompute needed, unlike the ELSS unlock date above).
    const taxSaverFds = await db
      .select({
        holdingId: depositDetails.holdingId,
        maturityDate: depositDetails.maturityDate,
        holdingName: holdings.name,
      })
      .from(depositDetails)
      .innerJoin(holdings, eq(holdings.id, depositDetails.holdingId))
      .where(and(eq(depositDetails.userId, userId), eq(depositDetails.depositKind, "tax_saver_fd")));

    for (const fd of taxSaverFds) {
      const daysToMaturity = daysUntil(todayStr, fd.maturityDate);
      if (!withinLeadWindow(daysToMaturity, MATURITY_LEAD_DAYS)) continue;
      const sent = await fireOnce(db, userId, "tax-fd-maturity", fd.holdingId, {
        type: "tax",
        title: `Tax-saver FD maturing — ${fd.holdingName}`,
        body:
          `Your tax-saver FD "${fd.holdingName}" matures on ${fd.maturityDate} (5-year ` +
          `lock-in ends). Decide whether to reinvest or withdraw.`,
        data: { holdingId: fd.holdingId, maturityDate: fd.maturityDate },
      });
      if (sent) fired++;
    }
  }

  // ── Advance-tax instalment reminders (all regimes) ────────────────────────
  const advTaxEnabled = await prefEnabled(db, userId, "advance_tax");
  if (advTaxEnabled) {
    const schedule = getAdvanceTaxSchedule(fy);

    // Senior citizens (age ≥ 60 on FY end) with no business income are exempt
    // from advance tax (Sec 207). Respect the schedule's seniorCitizenExempt flag.
    if (schedule.seniorCitizenExempt) {
      const [profile] = await db
        .select({ dateOfBirth: userProfiles.dateOfBirth })
        .from(userProfiles)
        .where(eq(userProfiles.userId, userId));
      if (isSeniorCitizenOnDate(profile?.dateOfBirth, fyEnd)) {
        return fired; // senior citizen exempt — skip all instalment reminders
      }
    }

    // Gate on actual advance-tax obligation (Sec 208: net payable after TDS
    // must be ≥ ₹10,000) — reuse the same position assembler and threshold
    // check advance-tax.ts's own route pays for, rather than firing "pay your
    // instalment" at every user regardless of whether TDS already covers
    // their liability or their net payable is below the statutory floor.
    const position = await getAdvanceTaxPosition(db, userId, fy);
    // Defensive second guard: getAdvanceTaxPosition resolves the senior-
    // citizen exemption independently (it re-checks age against fyEnd itself)
    // — honour it even though the schedule-level check above should already
    // have caught it.
    const netPayable = position.assessedTaxPaise - position.income.totalTdsPaise;
    if (!position.seniorCitizenExempt && sec208Applies(netPayable)) {
      for (const instalment of schedule.instalments) {
        const daysToInstalment = daysUntil(todayStr, instalment.dueDate);
        // Only fire within the lead window (0–ADVANCE_TAX_LEAD_DAYS days before due)
        if (daysToInstalment < 0 || daysToInstalment > ADVANCE_TAX_LEAD_DAYS) continue;
        const sent = await fireOnce(
          db,
          userId,
          "tax-adv-instalment",
          `${fy}:${instalment.dueDate}`,
          {
            type: "advance_tax",
            title: `Advance tax instalment due ${instalment.dueDate}`,
            body:
              `${instalment.cumulativePct}% of estimated total tax liability must be paid by ` +
              `${instalment.dueDate}. Late payment attracts 1%/month interest under Sec 234C.`,
            data: { fy, dueDate: instalment.dueDate, cumulativePct: instalment.cumulativePct },
          },
        );
        if (sent) fired++;
      }
    }
  }

  return fired;
}

// ─── All-users fan-out ────────────────────────────────────────────────────────

export interface TaxNudgesResult {
  fired: number;
  processed: number;
  errors: Array<{ userId: string; error: unknown }>;
}

/**
 * Nightly all-users pass: evaluates tax deadline nudges for every distinct user
 * who has at least one ACCEPTED income_event in the current FY.
 *
 * Restricting to current-FY accepted events avoids pinging dormant users who
 * had a single transaction years ago and are no longer actively tracking income.
 */
export async function runTaxDeadlineNudges(db: Db): Promise<TaxNudgesResult> {
  const todayStr = new Date().toISOString().slice(0, 10);
  const currentFy = fyOf(todayStr);

  const userRows = await db
    .selectDistinct({ userId: incomeEvents.userId })
    .from(incomeEvents)
    .where(
      and(
        eq(incomeEvents.fy, currentFy),
        eq(incomeEvents.status, "accepted"),
      ),
    );

  let fired = 0;
  const errors: TaxNudgesResult["errors"] = [];

  for (const { userId } of userRows) {
    try {
      fired += await evaluateTaxDeadlineNudges(db, userId);
    } catch (err) {
      errors.push({ userId, error: err });
    }
  }

  return { fired, processed: userRows.length, errors };
}
