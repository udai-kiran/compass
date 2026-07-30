import type { Sip } from "@compass/shared";

/**
 * Why a SIP can't have an installment recorded by hand on a given date.
 *
 * This is a **UI affordance only** — the API re-checks every one of these
 * rules server-side (`recordSipInstallment` and `installmentDateError` in
 * apps/api/src/services/sips.ts) and remains the sole authority. Duplicating
 * them here just avoids offering the user an input that is certain to 400.
 * Kept pure so the row-state rules are unit-testable without React.
 */
export type SipRecordBlock = "account_target" | "payroll" | "before_start" | "after_end";

/** Human label for each block reason, shown in place of the row's inputs. */
export const SIP_RECORD_BLOCK_LABEL: Record<SipRecordBlock, string> = {
  account_target: "Recorded from the account's own ledger, not here",
  payroll: "Comes in from your payslip",
  before_start: "Hadn't started yet on this date",
  after_end: "Had already ended by this date",
};

/**
 * The reason this SIP can't record an installment on `date`, or null when it
 * can. Order matches the server's: target kind, then funding source, then the
 * date window. A `paused` SIP is deliberately NOT blocked — the server allows
 * backfilling one by hand, it just never prompts for it (see
 * `dueInstallmentDate`).
 */
export function sipRecordBlock(
  sip: Pick<Sip, "targetKind" | "fundingSource" | "startDate" | "endDate">,
  date: string,
): SipRecordBlock | null {
  if (sip.targetKind !== "mf_folio") return "account_target";
  if (sip.fundingSource === "payroll") return "payroll";
  if (date < sip.startDate) return "before_start";
  if (sip.endDate !== null && date > sip.endDate) return "after_end";
  return null;
}

/**
 * Whether a row starts ticked for the one-shot batch: a recordable, active SIP
 * whose outstanding installment has come due on or before the chosen date.
 * `dueInstallmentDate <= date` is what makes the common case work — SIPs
 * scheduled on the 5th recorded on the 7th, the first day the market was open
 * and a NAV existed. A SIP with nothing outstanding (`dueInstallmentDate ===
 * null`) never starts ticked, so re-visiting the page doesn't offer to
 * double-record.
 */
export function sipPrechecked(
  sip: Pick<Sip, "targetKind" | "fundingSource" | "startDate" | "endDate" | "status" | "dueInstallmentDate">,
  date: string,
): boolean {
  if (sipRecordBlock(sip, date) !== null) return false;
  if (sip.status !== "active") return false;
  return sip.dueInstallmentDate !== null && sip.dueInstallmentDate <= date;
}

/**
 * Sort rank for the page's single list, lowest first: rows awaiting a record
 * on the chosen date, then other recordable rows, then blocked ones. Ties are
 * broken by the caller (by goal, then creation order) so the ordering stays
 * stable as the date changes.
 */
export function sipRowRank(
  sip: Pick<Sip, "targetKind" | "fundingSource" | "startDate" | "endDate" | "status" | "dueInstallmentDate">,
  date: string,
): number {
  if (sipPrechecked(sip, date)) return 0;
  if (sipRecordBlock(sip, date) === null) return 1;
  return 2;
}

/**
 * Whether a submit will actually send this row: it must be recordable on the
 * chosen date, still ticked, and not already recorded in this batch session.
 *
 * `outcome === null` is the "already recorded" case — the outcomes map keys a
 * row to `null` on success and to a message string on failure, and holds no
 * key at all for a row never attempted. Excluding *exactly* `null` is what
 * lets a failed row be corrected and retried while a successful one can't be
 * double-posted. Pure so that three-way distinction is pinned by a test
 * instead of living only in a JSX filter expression.
 */
export function rowIsSubmittable(
  sip: Pick<Sip, "targetKind" | "fundingSource" | "startDate" | "endDate">,
  date: string,
  draft: { include: boolean },
  outcome: string | null | undefined,
): boolean {
  if (sipRecordBlock(sip, date) !== null) return false;
  if (outcome === null) return false;
  return draft.include;
}

/**
 * Whether a row's typed amount and NAV/units value are both usable. Guards the
 * submit button so an empty or non-numeric field can't be sent as `NaN`, which
 * would serialize to `null` in JSON and be rejected server-side with a
 * confusing "provide either units or nav".
 */
export function installmentDraftReady(draft: { amountR: string; valueInput: string }): boolean {
  return isPositiveDecimal(draft.amountR) && isPositiveDecimal(draft.valueInput);
}

/**
 * A trimmed decimal string that parses to a finite positive number. Rejects
 * "", "abc", "0", "-5", and "1e5abc" — `parseFloat` alone accepts trailing
 * garbage, so the whole string is validated by pattern first.
 */
export function isPositiveDecimal(value: string): boolean {
  const trimmed = value.trim();
  if (!/^\d*\.?\d+$/.test(trimmed)) return false;
  const n = Number(trimmed);
  return Number.isFinite(n) && n > 0;
}
