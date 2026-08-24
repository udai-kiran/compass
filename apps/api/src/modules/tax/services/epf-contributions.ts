/**
 * epf-contributions.ts — EPF passbook reconciliation service (task 13.5).
 *
 * Operations:
 *   - createManual          — manual entry (upsert on user/month/member)
 *   - importFromPayslip     — derive expected_* from an accepted payslip's components
 *   - confirmActual         — record passbook actuals, compute + persist reconciliationStatus
 *   - listContributions     — list with optional FY or wageMonth filter
 *   - getGaps               — rows with expected_employee_paise set but actual not confirmed (FY)
 *   - getProjection         — compound-interest projection of EPF corpus to retirement
 *
 * Employer EPF invariant:
 *   employer_epf = credited to PF corpus (AFTER EPS diversion).
 *   employer_epf + eps = gross employer share (no fixed-rate check — the actual rate varies by employer/payslip; H2 removed the unconditional 12%-of-basic assumption).
 *   Never double-count.
 *
 * 80C eligibility:
 *   eligible = (actual_employee ?? expected_employee ?? 0) + (actual_vpf ?? expected_vpf ?? 0).
 *   employer_epf is NOT 80C eligible.
 *
 * Reconciliation status state machine (pure):
 *   pending  → all four actuals are null (unconditional), OR any non-null expected has a null actual
 *   matched  → all relevant components have their actual set, all within 1% tolerance
 *   mismatch → all relevant components have their actual set, ≥1 differs by >1%
 *   confirmed → reserved for a future explicit user-override action (not computed here)
 */

import { and, eq, gte, isNotNull, isNull, lte, sql } from "drizzle-orm";
import type { Db, DbOrTx } from "../../../db/index.ts";
import { epfContributions, payslips, payslipComponents } from "../schema.ts";
import { accounts } from "../../../db/shared/hubs.ts";
import { postings, transactions } from "../../../db/shared/ledger.ts";
import { userProfiles } from "../../system/schema.ts";
import { HttpError } from "../../../lib/errors.ts";
import type {
  EpfContribution,
  EpfGapResult,
  EpfCorpusProjection,
  CreateEpfContributionBody,
  ConfirmActualBody,
  ReconciliationStatus,
} from "@compass/shared";

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Compute reconciliation status from a row's actual vs expected values.
 * Pure function — no I/O.
 *
 * Logic (H4 + blocker 1 / review-4):
 *   0. Unconditional leading check: if ALL four actuals are null → 'pending' always.
 *   1. Employee/employer/EPS: any non-null expected with null actual → 'pending'
 *      (including exactly zero expected; zero-expected EPS/employee/employer now
 *      needs an actual). VPF keeps its zero-skip exception (0 = no VPF expected).
 *   2. Once all relevant components have their actual set:
 *      - Any component where |actual − expected| * 100 > expected → 'mismatch'
 *        (integer cross-multiplication; skips null or zero expected).
 *   3. Otherwise → 'matched'.
 *
 * 'confirmed' is intentionally unreachable from this function — it is reserved
 * for a future explicit user-override action, not an automatically computed state.
 * All four components are checked: employee, employer, EPS, and VPF.
 */
export function computeStatus(row: {
  actualEmployeePaise: number | null;
  actualEmployerPaise: number | null;
  actualEpsPaise: number | null;
  actualVpfPaise: number | null;
  expectedEmployeePaise: number | null;
  expectedEmployerPaise: number | null;
  expectedEpsPaise: number | null;
  /** NOT NULL in DB; defaults to 0 (meaning no VPF). */
  expectedVpfPaise: number;
}): ReconciliationStatus {
  // Unconditional: a row where nothing has been confirmed yet is always
  // 'pending', regardless of what is expected (blocker 1 / review-4).
  if (
    row.actualEmployeePaise === null &&
    row.actualEmployerPaise === null &&
    row.actualEpsPaise === null &&
    row.actualVpfPaise === null
  ) {
    return "pending";
  }

  // A component "needs confirmation" if it has a non-null expected value
  // (including exactly zero) but actual is still null. VPF is the one
  // exception: its expected defaults to 0 meaning "no VPF", so a zero
  // expected VPF does not need an actual.
  const needsConfirmation = (expected: number | null, actual: number | null): boolean =>
    expected !== null && actual === null;
  const vpfNeedsConfirmation = (expected: number, actual: number | null): boolean =>
    expected !== 0 && actual === null;

  if (
    needsConfirmation(row.expectedEmployeePaise, row.actualEmployeePaise) ||
    needsConfirmation(row.expectedEmployerPaise, row.actualEmployerPaise) ||
    needsConfirmation(row.expectedEpsPaise, row.actualEpsPaise) ||
    vpfNeedsConfirmation(row.expectedVpfPaise, row.actualVpfPaise)
  ) {
    return "pending";
  }

  // All positive-expected components have their actual set.
  // Check for mismatch using integer cross-multiplication (no floating point on paise).
  // Skip a component when its expected is null or zero (divide-by-zero guard).
  const isMismatch = (expected: number | null, actual: number | null): boolean => {
    if (expected === null || expected === 0 || actual === null) return false;
    // Equivalent to: |actual - expected| / expected > 0.01
    // Cross-multiplied: |actual - expected| * 100 > expected
    return Math.abs(actual - expected) * 100 > expected;
  };

  if (
    isMismatch(row.expectedEmployeePaise, row.actualEmployeePaise) ||
    isMismatch(row.expectedEmployerPaise, row.actualEmployerPaise) ||
    isMismatch(row.expectedEpsPaise, row.actualEpsPaise) ||
    isMismatch(row.expectedVpfPaise, row.actualVpfPaise)
  ) {
    return "mismatch";
  }

  return "matched";
}

/**
 * Convert wage_month-based FY label to the inclusive wage_month range.
 * FY "2025-26" → { start: "2025-04", end: "2026-03" }
 */
export function fyToWageMonthRange(fy: string): { start: string; end: string } {
  const startYear = Number(fy.slice(0, 4));
  const endYear = startYear + 1;
  return {
    start: `${startYear}-04`,
    end: `${endYear}-03`,
  };
}

/**
 * Returns true when a wage month is eligible to be reported as a gap.
 * A gap is only reportable after a 45-day grace period from the end of the
 * wage month. Pure function — injectable `asOf` date for unit-testability.
 *
 * wageMonth: "YYYY-MM" format (e.g. "2025-06")
 * asOf: the date to test against (typically `new Date()`)
 */
export function isGapEligible(wageMonth: string, asOf: Date): boolean {
  const [yearStr, monthStr] = wageMonth.split("-");
  const year = Number(yearStr);
  // month is 1-indexed in the string; Date.UTC uses 0-indexed month.
  // new Date(Date.UTC(year, month, 0)) → day-0 of (month) in 0-indexed → last day of wageMonth.
  const wageMonthEnd = new Date(Date.UTC(year, Number(monthStr), 0));
  const graceEnd = new Date(wageMonthEnd);
  graceEnd.setUTCDate(graceEnd.getUTCDate() + 45);
  return asOf >= graceEnd;
}

/**
 * Year-by-year integer EPF corpus compounding.
 * Rate: assumedAnnualRateBps (e.g. 825 = 8.25% p.a.)
 * Compounded once per year for floor(monthsToRetirement / 12) whole years.
 * Returns projectedCorpusPaise as an exact integer (rounding at each year step).
 * Pure — no I/O, no Date(), no floating-point accumulation.
 */
export function computeEpfProjection(
  currentCorpusPaise: number,
  monthsToRetirement: number,
  assumedAnnualRateBps: number,
): number {
  // Per-step BigInt arithmetic: avoids silent precision loss when the intermediate
  // product (corpus * rateNumerator) exceeds Number.MAX_SAFE_INTEGER.
  const yearsToCompound = Math.floor(monthsToRetirement / 12);
  const rateNumerator = 10000n + BigInt(assumedAnnualRateBps);
  const rateDenominator = 10000n;
  const half = rateDenominator / 2n;
  const maxSafe = BigInt(Number.MAX_SAFE_INTEGER);
  let corpus = BigInt(currentCorpusPaise);
  for (let i = 0; i < yearsToCompound; i++) {
    corpus = (corpus * rateNumerator + half) / rateDenominator;
    if (corpus > maxSafe) {
      // Throws HttpError (not plain Error) so the app's error handler preserves
      // this curated message rather than masking it to a generic 500.
      // HttpError is a plain Error subclass with a statusCode field — it does not
      // perform any I/O, so using it here does not violate the "Pure — no I/O" contract.
      throw new HttpError(
        500,
        "computeEpfProjection: projected corpus exceeded Number.MAX_SAFE_INTEGER during compounding — refusing to lose paise",
      );
    }
  }
  return Number(corpus);
}

/** Build the EpfContribution DTO from a DB row. Pure — no I/O. */
export function buildEpfContributionDto(
  row: typeof epfContributions.$inferSelect,
): EpfContribution {
  const eligibleEmployee = row.actualEmployeePaise ?? row.expectedEmployeePaise ?? 0;
  const eligibleVpf = row.actualVpfPaise ?? row.expectedVpfPaise ?? 0;

  // grossEmployerContributionPaise = employer + eps (actuals preferred over expected).
  const employerForGross = row.actualEmployerPaise ?? row.expectedEmployerPaise ?? 0;
  const epsForGross = row.actualEpsPaise ?? row.expectedEpsPaise ?? 0;

  return {
    id: row.id,
    wageMonth: row.wageMonth,
    employerName: row.employerName ?? null,
    epfoMemberId: row.epfoMemberId,
    expectedEmployeePaise: row.expectedEmployeePaise ?? null,
    expectedEmployerPaise: row.expectedEmployerPaise ?? null,
    expectedEpsPaise: row.expectedEpsPaise ?? null,
    expectedVpfPaise: row.expectedVpfPaise ?? 0,
    payslipId: row.payslipId ?? null,
    actualEmployeePaise: row.actualEmployeePaise ?? null,
    actualEmployerPaise: row.actualEmployerPaise ?? null,
    actualEpsPaise: row.actualEpsPaise ?? null,
    actualVpfPaise: row.actualVpfPaise ?? null,
    reconciliationStatus: row.reconciliationStatus as ReconciliationStatus,
    gapReason: row.gapReason ?? null,
    eligible80cPaise: eligibleEmployee + eligibleVpf,
    grossEmployerContributionPaise: employerForGross + epsForGross,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ─── Service operations ───────────────────────────────────────────────────────

/**
 * Create a manual EPF contribution entry.
 * Upserts on (user_id, wage_month, epfo_member_id) — safe to call multiple times.
 * Does NOT update actual_* columns on conflict. Recomputes reconciliationStatus
 * atomically on every upsert using the existing actual_* values + new expected_*.
 */
export async function createManual(
  db: Db,
  userId: string,
  input: CreateEpfContributionBody,
): Promise<EpfContribution> {
  return db.transaction(async (tx) => {
    // Select the existing row to get current actual_* values before the upsert.
    // .for("update") acquires a row-level lock for the remainder of this transaction,
    // so a concurrent confirmActual's UPDATE on the same row blocks until we commit —
    // eliminating the TOCTOU race where we might read stale actual_* values.
    // On the fresh-insert path (no existing row) this is a no-op.
    const [existing] = await tx
      .select()
      .from(epfContributions)
      .where(
        and(
          eq(epfContributions.userId, userId),
          eq(epfContributions.wageMonth, input.wageMonth),
          eq(epfContributions.epfoMemberId, input.epfoMemberId),
        ),
      )
      .for("update");

    const status = computeStatus({
      actualEmployeePaise: existing?.actualEmployeePaise ?? null,
      actualEmployerPaise: existing?.actualEmployerPaise ?? null,
      actualEpsPaise: existing?.actualEpsPaise ?? null,
      actualVpfPaise: existing?.actualVpfPaise ?? null,
      expectedEmployeePaise: input.expectedEmployeePaise ?? null,
      expectedEmployerPaise: input.expectedEmployerPaise ?? null,
      expectedEpsPaise: input.expectedEpsPaise ?? null,
      expectedVpfPaise: input.expectedVpfPaise ?? 0,
    });

    const [row] = await tx
      .insert(epfContributions)
      .values({
        userId,
        wageMonth: input.wageMonth,
        employerName: input.employerName ?? null,
        epfoMemberId: input.epfoMemberId,
        expectedEmployeePaise: input.expectedEmployeePaise ?? null,
        expectedEmployerPaise: input.expectedEmployerPaise ?? null,
        expectedEpsPaise: input.expectedEpsPaise ?? null,
        expectedVpfPaise: input.expectedVpfPaise ?? 0,
        reconciliationStatus: status,
      })
      .onConflictDoUpdate({
        target: [epfContributions.userId, epfContributions.wageMonth, epfContributions.epfoMemberId],
        set: {
          expectedEmployeePaise: sql`EXCLUDED.expected_employee_paise`,
          expectedEmployerPaise: sql`EXCLUDED.expected_employer_paise`,
          expectedEpsPaise: sql`EXCLUDED.expected_eps_paise`,
          expectedVpfPaise: sql`EXCLUDED.expected_vpf_paise`,
          employerName: sql`EXCLUDED.employer_name`,
          reconciliationStatus: sql`EXCLUDED.reconciliation_status`,
          updatedAt: sql`NOW()`,
        },
      })
      .returning();

    if (!row) throw new HttpError(500, "Failed to create EPF contribution");
    return buildEpfContributionDto(row);
  });
}

/**
 * Import EPF expected values from an accepted payslip's components.
 *
 * Algorithm:
 * 1. Load payslip — verify ownership and status='accepted'.
 * 2. Sum canonical component kinds → expected_* columns.
 * 3. Select existing row (to read current actual_* values).
 * 4. Upsert on (user_id, wage_month, epfo_member_id); recompute reconciliationStatus
 *    atomically from existing actual_* + new expected_*. actual_* NOT in SET clause.
 *
 * Idempotency: the upsert's ON CONFLICT DO UPDATE refreshes expected_* columns
 * from the current payslip components on every call — corrected payslip values
 * always take effect. actual_* columns are NOT in the SET clause, so confirmed
 * passbook values are preserved across re-imports.
 *
 * employer_epf = credited to PF corpus (AFTER EPS diversion).
 * employer_epf + eps = gross employer share. Never double-count.
 */
export async function importFromPayslip(
  db: Db,
  userId: string,
  payslipId: string,
  epfoMemberId: string,
): Promise<EpfContribution> {
  return db.transaction(async (tx) => {
    // Step 1: Load payslip — ownership + status check.
    const [payslip] = await tx
      .select()
      .from(payslips)
      .where(and(eq(payslips.id, payslipId), eq(payslips.userId, userId)));

    if (!payslip) throw new HttpError(404, "Payslip not found");
    if (payslip.status !== "accepted") {
      throw new HttpError(409, "Payslip must be in accepted status to import EPF contributions");
    }

    // Step 2: Load components and sum by canonical kind.
    const components = await tx
      .select()
      .from(payslipComponents)
      .where(eq(payslipComponents.payslipId, payslipId));

    let expectedEmployeePaise: number | null = null;
    let expectedEmployerPaise: number | null = null;
    let expectedEpsPaise: number | null = null;
    let expectedVpfPaise = 0;

    for (const comp of components) {
      switch (comp.canonicalKind) {
        case "employee_epf":
          expectedEmployeePaise = (expectedEmployeePaise ?? 0) + comp.currentPaise;
          break;
        case "employer_epf":
          // NET credited to PF corpus (after EPS diversion) — do not add EPS here.
          expectedEmployerPaise = (expectedEmployerPaise ?? 0) + comp.currentPaise;
          break;
        case "eps":
          // EPS pension diversion — separate accumulator, never added to employer_epf.
          expectedEpsPaise = (expectedEpsPaise ?? 0) + comp.currentPaise;
          break;
        case "vpf":
          expectedVpfPaise += comp.currentPaise;
          break;
      }
    }

    // Step 3: Select existing row to get current actual_* values for status recompute.
    // .for("update") acquires a row-level lock for the remainder of this transaction,
    // so a concurrent confirmActual's UPDATE on the same row blocks until we commit —
    // eliminating the TOCTOU race where we might read stale actual_* values.
    // On the fresh-insert path (no existing row) this is a no-op.
    const [existing] = await tx
      .select()
      .from(epfContributions)
      .where(
        and(
          eq(epfContributions.userId, userId),
          eq(epfContributions.wageMonth, payslip.payMonth),
          eq(epfContributions.epfoMemberId, epfoMemberId),
        ),
      )
      .for("update");

    const status = computeStatus({
      actualEmployeePaise: existing?.actualEmployeePaise ?? null,
      actualEmployerPaise: existing?.actualEmployerPaise ?? null,
      actualEpsPaise: existing?.actualEpsPaise ?? null,
      actualVpfPaise: existing?.actualVpfPaise ?? null,
      expectedEmployeePaise,
      expectedEmployerPaise,
      expectedEpsPaise,
      expectedVpfPaise,
    });

    // Step 4: Upsert — refreshes expected_* from current payslip components;
    // actual_* are NOT in the SET clause so confirmed passbook values survive re-import.
    const [row] = await tx
      .insert(epfContributions)
      .values({
        userId,
        wageMonth: payslip.payMonth,
        employerName: payslip.employerName ?? null,
        epfoMemberId,
        expectedEmployeePaise,
        expectedEmployerPaise,
        expectedEpsPaise,
        expectedVpfPaise,
        payslipId,
        reconciliationStatus: status,
      })
      .onConflictDoUpdate({
        target: [epfContributions.userId, epfContributions.wageMonth, epfContributions.epfoMemberId],
        set: {
          expectedEmployeePaise: sql`EXCLUDED.expected_employee_paise`,
          expectedEmployerPaise: sql`EXCLUDED.expected_employer_paise`,
          expectedEpsPaise: sql`EXCLUDED.expected_eps_paise`,
          expectedVpfPaise: sql`EXCLUDED.expected_vpf_paise`,
          payslipId: sql`EXCLUDED.payslip_id`,
          employerName: sql`EXCLUDED.employer_name`,
          reconciliationStatus: sql`EXCLUDED.reconciliation_status`,
          updatedAt: sql`NOW()`,
          // actual_* columns are NOT in the SET clause — preserved on re-import.
        },
      })
      .returning();

    if (!row) throw new HttpError(500, "Failed to import EPF contribution from payslip");
    return buildEpfContributionDto(row);
  });
}

/**
 * Confirm actual EPF passbook values for a contribution row.
 * Computes reconciliationStatus via computeStatus() and persists it atomically.
 *
 * The computed status can be 'pending' (if some expected component still lacks
 * an actual after this call), 'matched', or 'mismatch'
 * (never 'confirmed' — that label is reserved for a future explicit-confirm flow).
 * Returns the updated row.
 */
export async function confirmActual(
  db: Db,
  userId: string,
  id: string,
  body: ConfirmActualBody,
): Promise<EpfContribution> {
  return db.transaction(async (tx) => {
    // Load the row first so we can run computeStatus.
    // .for("update") acquires a row-level lock for the remainder of this transaction,
    // so a concurrent createManual/importFromPayslip upsert on the same row blocks until
    // we commit — eliminating the TOCTOU race where expected_* might change between our
    // SELECT and UPDATE, causing us to write a stale reconciliationStatus.
    const [existing] = await tx
      .select()
      .from(epfContributions)
      .where(and(eq(epfContributions.id, id), eq(epfContributions.userId, userId)))
      .for("update");

    if (!existing) throw new HttpError(404, "EPF contribution not found");

    const newActuals = {
      actualEmployeePaise: body.actualEmployeePaise,
      actualEmployerPaise: body.actualEmployerPaise ?? null,
      actualEpsPaise: body.actualEpsPaise ?? null,
      actualVpfPaise: body.actualVpfPaise ?? null,
    };

    const status = computeStatus({
      actualEmployeePaise: newActuals.actualEmployeePaise,
      actualEmployerPaise: newActuals.actualEmployerPaise,
      actualEpsPaise: newActuals.actualEpsPaise,
      actualVpfPaise: newActuals.actualVpfPaise,
      expectedEmployeePaise: existing.expectedEmployeePaise ?? null,
      expectedEmployerPaise: existing.expectedEmployerPaise ?? null,
      expectedEpsPaise: existing.expectedEpsPaise ?? null,
      expectedVpfPaise: existing.expectedVpfPaise ?? 0,
    });

    const [updated] = await tx
      .update(epfContributions)
      .set({
        ...newActuals,
        reconciliationStatus: status,
        updatedAt: new Date(),
      })
      .where(and(eq(epfContributions.id, id), eq(epfContributions.userId, userId)))
      .returning();

    if (!updated) throw new HttpError(404, "EPF contribution not found");
    return buildEpfContributionDto(updated);
  });
}

/**
 * List EPF contributions for a user.
 * Optional filter: fy (wage_month range) or explicit wageMonth.
 */
export async function listContributions(
  db: DbOrTx,
  userId: string,
  filter: { fy?: string; wageMonth?: string },
): Promise<EpfContribution[]> {
  const conditions = [eq(epfContributions.userId, userId)];

  if (filter.wageMonth) {
    conditions.push(eq(epfContributions.wageMonth, filter.wageMonth));
  } else if (filter.fy) {
    const { start, end } = fyToWageMonthRange(filter.fy);
    conditions.push(gte(epfContributions.wageMonth, start));
    conditions.push(lte(epfContributions.wageMonth, end));
  }

  const rows = await db
    .select()
    .from(epfContributions)
    .where(and(...conditions))
    .orderBy(epfContributions.wageMonth);

  return rows.map(buildEpfContributionDto);
}

/**
 * Return gap rows for a given FY.
 * Gaps = rows where expected_employee_paise IS NOT NULL AND actual_employee_paise IS NULL
 *        AND the 45-day grace period from the end of the wage month has elapsed.
 *
 * The 45-day eligibility check is applied in-process via `isGapEligible` (pure function)
 * rather than in the DB query — this keeps the date arithmetic unit-testable.
 * Status 'gap' is NOT persisted — this endpoint is purely read-only.
 */
export async function getGaps(
  db: DbOrTx,
  userId: string,
  fy: string,
  asOf: Date = new Date(),
): Promise<EpfGapResult[]> {
  const { start, end } = fyToWageMonthRange(fy);

  const rows = await db
    .select()
    .from(epfContributions)
    .where(
      and(
        eq(epfContributions.userId, userId),
        gte(epfContributions.wageMonth, start),
        lte(epfContributions.wageMonth, end),
        isNotNull(epfContributions.expectedEmployeePaise),
        isNull(epfContributions.actualEmployeePaise),
      ),
    )
    .orderBy(epfContributions.wageMonth);

  // Apply the 45-day grace period in-process (pure function — no DB date arithmetic).
  return rows
    .filter((r) => isGapEligible(r.wageMonth, asOf))
    .map((r) => ({
      id: r.id,
      wageMonth: r.wageMonth,
      employerName: r.employerName ?? null,
      epfoMemberId: r.epfoMemberId,
      expectedEmployeePaise: r.expectedEmployeePaise ?? null,
      expectedEmployerPaise: r.expectedEmployerPaise ?? null,
      expectedEpsPaise: r.expectedEpsPaise ?? null,
      expectedVpfPaise: r.expectedVpfPaise ?? 0,
    }));
}

/**
 * Project EPF corpus to retirement date using year-by-year integer compounding.
 *
 * Rate: 8.25% p.a. (assumedAnnualRateBps: 825) — last known official rate (FY 2024-25).
 * No future contributions assumed (isEstimate: true).
 *
 * Current corpus: the account's POSTED balance — sum of postings on
 * non-deleted transactions dated on or before today. This matches how
 * `listAccounts` derives balancePaise (the opening balance is itself
 * materialised as a posting against the `opening` system account), so the
 * projection can never disagree with the account list.
 * Retirement date: user_profiles.date_of_birth + retirementAge years (default 60).
 * If no date_of_birth, retirement is 20 years out (fallback estimate).
 *
 * Requires accountId to refer to an account with type='epf'; any other type
 * is rejected with 404 (same as an unowned account — no type-sniffing leak).
 */
export async function getProjection(
  db: DbOrTx,
  userId: string,
  accountId: string,
  retirementAge = 60,
): Promise<EpfCorpusProjection> {
  // Load account — verify ownership AND type=epf.
  // Any other type is rejected with the same 404 as an unowned account
  // to avoid leaking whether the account exists under a different type.
  const [account] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(
      and(
        eq(accounts.id, accountId),
        eq(accounts.userId, userId),
        eq(accounts.type, "epf"),
      ),
    );

  if (!account) throw new HttpError(404, "EPF account not found");

  // Posted balance: same date/deleted/user predicates as listAccounts().
  const [balanceRow] = await db
    .select({
      balancePaise: sql<number>`coalesce(sum(${postings.amountPaise}), 0)::bigint`,
    })
    .from(postings)
    .innerJoin(transactions, eq(transactions.id, postings.transactionId))
    .where(
      and(
        eq(postings.accountId, accountId),
        eq(transactions.userId, userId),
        isNull(transactions.deletedAt),
        lte(transactions.date, sql`current_date`),
      ),
    );

  const currentCorpusPaise = Number(balanceRow?.balancePaise ?? 0);
  if (!Number.isSafeInteger(currentCorpusPaise)) {
    throw new HttpError(500, "Balance aggregate exceeded a safe integer — refusing to lose paise");
  }

  // Load user profile for date_of_birth.
  const [profile] = await db
    .select({ dateOfBirth: userProfiles.dateOfBirth })
    .from(userProfiles)
    .where(eq(userProfiles.userId, userId));

  const now = new Date();
  let monthsToRetirement: number;
  let retirementDate: Date;
  let dobMissing: boolean;

  if (profile?.dateOfBirth) {
    dobMissing = false;
    const dob = new Date(profile.dateOfBirth);
    retirementDate = new Date(dob);
    retirementDate.setFullYear(dob.getFullYear() + retirementAge);
    // Calendar-month difference (integer)
    monthsToRetirement = Math.max(
      0,
      (retirementDate.getFullYear() - now.getFullYear()) * 12 +
        retirementDate.getMonth() -
        now.getMonth(),
    );
  } else {
    // Fallback: 20 years if no DOB recorded (240 months).
    dobMissing = true;
    monthsToRetirement = 240;
    retirementDate = new Date(now);
    retirementDate.setFullYear(now.getFullYear() + 20);
  }

  const ASSUMED_ANNUAL_RATE_BPS = 825; // 8.25% p.a. — FY 2024-25 official rate
  const BASE_DISCLAIMER =
    "This is an estimate assuming no future EPF contributions and using the last known official EPF interest rate (8.25% p.a. for FY 2024-25). Actual corpus may differ based on future rate declarations and contributions.";
  const DOB_MISSING_DISCLAIMER =
    "Date of birth not on file — assumed 20 years to retirement. " + BASE_DISCLAIMER;

  const projectedCorpusPaise = computeEpfProjection(
    currentCorpusPaise,
    monthsToRetirement,
    ASSUMED_ANNUAL_RATE_BPS,
  );

  if (!Number.isSafeInteger(projectedCorpusPaise)) {
    throw new HttpError(500, "Projected corpus exceeded a safe integer — refusing to lose paise");
  }

  return {
    currentCorpusPaise,
    projectedCorpusPaise,
    monthsToRetirement,
    retirementDate: retirementDate.toISOString().slice(0, 10),
    isEstimate: true,
    rateSource: "last_known_official",
    rateApplicableFy: "2024-25",
    assumedAnnualRateBps: ASSUMED_ANNUAL_RATE_BPS,
    disclaimer: dobMissing ? DOB_MISSING_DISCLAIMER : BASE_DISCLAIMER,
  };
}
