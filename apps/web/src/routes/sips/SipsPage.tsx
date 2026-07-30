import { useMemo, useRef, useState, type FormEvent } from "react";
import {
  accountCanHaveGoal,
  formatDisplayDate,
  formatINR,
  isBankAccount,
  rupeesToPaise,
  todayInIST,
  type Sip,
  type SipFrequency,
  type SipFundingSource,
  type SipTargetKind,
} from "@compass/shared";
import { toast } from "../../lib/toast.tsx";
import {
  useAllSips,
  useGoals,
  useRecordInstallments,
  useSipInstallmentCandidates,
  useSipMutations,
  type SipInstallmentDraft,
  type SipInstallmentOutcome,
} from "../../lib/goal-queries.ts";
import { useAccounts } from "../../lib/queries.ts";
import { usePortfolio } from "../../lib/wealth-queries.ts";
import { DateField } from "../../components/DateField.tsx";
import {
  installmentDraftReady,
  rowIsSubmittable,
  sipLinkDue,
  sipPrechecked,
  sipRecordBlock,
  sipRowRank,
  SIP_RECORD_BLOCK_LABEL,
} from "./sip-recording.ts";

const SIP_FREQUENCY_LABEL: Record<SipFrequency, string> = { monthly: "mo", quarterly: "qtr", yearly: "yr" };
const SIP_FREQUENCY_OPTIONS: Array<{ value: SipFrequency; label: string }> = [
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "yearly", label: "Yearly" },
];

export function SipsPage() {
  const { data: sipList } = useAllSips();
  const { data: goals } = useGoals();
  const { data: accountList } = useAccounts();
  const { data: portfolio } = usePortfolio();
  const [showForm, setShowForm] = useState(false);
  const [date, setDate] = useState(todayInIST());
  // Deliberately owned by the page, not by InstallmentBatch: the batch is
  // remounted on every date change (see key={date} below), which would destroy
  // an in-flight mutation's state and let the same SIP/date be submitted twice.
  // Kept here, `record.isPending` still disables the button after a remount.
  // The trade-off is that a remount loses the per-row outcomes, since those
  // setters belong to the old instance — the toast is then the surviving
  // feedback, and the query invalidation in useRecordInstallments still runs.
  const record = useRecordInstallments();

  // A synchronous latch, because `record.isPending` is only a render snapshot:
  // two activations in the same tick both read `false` and would launch two
  // batches. The DB's unique index still prevents a duplicate installment row,
  // but TanStack fires per-call callbacks only for the latest `mutate`, so the
  // loser's "already recorded" 409 would be reported in place of the winner's
  // success. A ref flips synchronously, so a second call returns immediately.
  // It lives here beside the mutation — above InstallmentBatch's key={date}
  // remount boundary — so neither can be reset while a batch is in flight.
  const submitting = useRef(false);

  const submitBatch = (
    payload: SipInstallmentDraft[],
    onDone: (results: SipInstallmentOutcome[]) => void,
  ) => {
    if (submitting.current || record.isPending) return;
    submitting.current = true;
    record.mutate(payload, {
      onSuccess: onDone,
      // Released on settle rather than on success: an unexpected throw must not
      // leave the latch stuck closed and the page unable to submit ever again.
      onSettled: () => {
        submitting.current = false;
      },
    });
  };

  const goalName = (id: string) => goals?.find((g) => g.id === id)?.name ?? "Unknown goal";
  const accountName = (id: string) => accountList?.find((a) => a.id === id)?.name ?? "Account";
  const targetLabel = (sip: Sip) => {
    if (sip.targetKind === "mf_folio") {
      const h = portfolio?.positions.find((p) => p.id === sip.targetHoldingId);
      return h ? `${h.name}${h.folioNumber ? ` (Folio ${h.folioNumber})` : ""}` : "MF folio";
    }
    return accountName(sip.targetAccountId!);
  };

  // Array.prototype.sort is stable, so SIPs that land on the same rank and
  // goal name keep the API's createdAt order rather than jumping around.
  const sorted = useMemo(
    () =>
      [...(sipList ?? [])].sort(
        (a, b) =>
          sipRowRank(a, date) - sipRowRank(b, date) ||
          goalName(a.goalId).localeCompare(goalName(b.goalId)),
      ),
    [sipList, date, goals],
  );

  const sips = sipList ?? [];

  return (
    <div className="mx-auto max-w-4xl">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-800">SIPs</h1>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="rounded-md bg-brand-600 px-3 py-1.5 text-sm text-white"
        >
          {showForm ? "Close" : "New SIP"}
        </button>
      </div>

      {showForm && (
        <div className="mt-4 rounded-lg border border-slate-200 bg-white p-4 text-sm">
          <SipForm onDone={() => setShowForm(false)} />
        </div>
      )}

      {sips.length === 0 && !showForm ? (
        <p className="mt-4 rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">
          No SIPs yet — add one to fund a goal automatically.
        </p>
      ) : (
        sips.length > 0 && (
          <div className="mt-4">
            <div className="flex items-center gap-2">
              <span className="text-sm text-slate-600">Record installments as of</span>
              <DateField
                value={date}
                onChange={setDate}
                aria-label="Record installments as of"
                disabled={record.isPending}
              />
            </div>
            {/* key={date} is load-bearing: remounting InstallmentBatch on a date
                change is what resets every row's draft, rather than an effect
                trying to re-sync state that was typed against the old date. */}
            <InstallmentBatch
              key={date}
              date={date}
              sips={sorted}
              goalName={goalName}
              accountName={accountName}
              targetLabel={targetLabel}
              record={record}
              submitBatch={submitBatch}
            />
          </div>
        )
      )}
    </div>
  );
}

interface RowDraft {
  include: boolean;
  amountR: string;
  valueKind: "nav" | "units";
  valueInput: string;
  note: string;
}

function defaultDraft(sip: Sip, date: string): RowDraft {
  return {
    include: sipPrechecked(sip, date),
    amountR: String(sip.amountPaise / 100),
    valueKind: "nav",
    valueInput: "",
    note: "",
  };
}

/** The date-scoped batch of installment rows, plus each row's pause/delete controls. */
function InstallmentBatch({
  date,
  sips,
  goalName,
  accountName,
  targetLabel,
  record,
  submitBatch,
}: {
  date: string;
  sips: Sip[];
  goalName: (id: string) => string;
  accountName: (id: string) => string;
  targetLabel: (sip: Sip) => string;
  record: ReturnType<typeof useRecordInstallments>;
  submitBatch: (payload: SipInstallmentDraft[], onDone: (results: SipInstallmentOutcome[]) => void) => void;
}) {
  const { update, remove } = useSipMutations();
  // Sparse: a SIP with no entry yet reads its defaults from `defaultDraft`, so
  // a SIP created while this page is open still gets sensible defaults without
  // an effect keeping the map in sync.
  const [drafts, setDrafts] = useState<Record<string, RowDraft>>({});
  // Key present with `null` means that row recorded successfully; a string is
  // its error message; absent means not attempted this session.
  const [outcomes, setOutcomes] = useState<Record<string, string | null>>({});

  const draftOf = (sip: Sip): RowDraft => drafts[sip.id] ?? defaultDraft(sip, date);
  const setDraft = (id: string, patch: Partial<RowDraft>) =>
    setDrafts((prev) => {
      const sip = sips.find((s) => s.id === id);
      const base = prev[id] ?? (sip ? defaultDraft(sip, date) : undefined);
      return base ? { ...prev, [id]: { ...base, ...patch } } : prev;
    });

  const included = sips.filter((s) => rowIsSubmittable(s, date, draftOf(s), outcomes[s.id]));
  const ready = included.every((s) => installmentDraftReady(draftOf(s)));

  // The fan-out is per-row independent by design (see useRecordInstallments):
  // one bad NAV must not roll back the installments that were fine, so
  // outcomes are merged per-row rather than treated as one atomic result.
  // Re-entry is latched in the page's `submitBatch`, not here — a check against
  // `record.isPending` in this function would only ever see a stale render
  // snapshot.
  function submit() {
    const payload: SipInstallmentDraft[] = included.map((sip) => {
      const draft = draftOf(sip);
      const value = Number(draft.valueInput.trim());
      return {
        id: sip.id,
        date,
        amountPaise: rupeesToPaise(Number(draft.amountR.trim())),
        nav: draft.valueKind === "nav" ? value : null,
        units: draft.valueKind === "units" ? value : null,
        note: draft.note,
      };
    });
    submitBatch(payload, (results) => {
      setOutcomes((prev) => ({ ...prev, ...Object.fromEntries(results.map((r) => [r.id, r.error])) }));
      for (const r of results) {
        if (r.error === null) setDraft(r.id, { include: false, valueInput: "" });
      }
      const ok = results.filter((r) => r.error === null).length;
      if (ok === results.length) {
        toast(`Recorded ${results.length} installment${results.length === 1 ? "" : "s"}`, "success");
      } else {
        toast(`Recorded ${ok} of ${results.length} — check the highlighted rows`);
      }
    });
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="mt-3 rounded-md border border-slate-200"
    >
      <ul className="divide-y divide-slate-100 text-sm">
        {sips.map((sip) => {
          const block = sipRecordBlock(sip, date);
          const draft = draftOf(sip);
          const outcome = outcomes[sip.id];
          return (
            <li key={sip.id} className="px-3 py-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-slate-400">{goalName(sip.goalId)}</span>
                <span className="truncate text-slate-700">{accountName(sip.sourceAccountId)}</span>
                <span className="text-slate-400">→</span>
                <span className="truncate text-slate-700">{targetLabel(sip)}</span>
                <span className="ml-auto tabular-nums text-slate-700">
                  {formatINR(sip.amountPaise)}/{SIP_FREQUENCY_LABEL[sip.frequency]}
                </span>
                <span className="text-xs text-slate-400">day {sip.dayOfMonth}</span>
                {sip.status === "paused" && (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">paused</span>
                )}
                {sip.fundingSource === "payroll" && (
                  <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] text-blue-700">payroll</span>
                )}
                {sip.dueInstallmentDate !== null ? (
                  <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700">
                    due {formatDisplayDate(sip.dueInstallmentDate)}
                  </span>
                ) : (
                  sip.lastInstallmentDate !== null && (
                    <span className="text-[11px] text-slate-400">last {formatDisplayDate(sip.lastInstallmentDate)}</span>
                  )
                )}
                <button
                  type="button"
                  className="text-xs text-slate-500 underline"
                  disabled={update.isPending}
                  onClick={() =>
                    update.mutate({ id: sip.id, status: sip.status === "active" ? "paused" : "active" })
                  }
                >
                  {sip.status === "active" ? "Pause" : "Resume"}
                </button>
                <button
                  type="button"
                  className="text-slate-400 hover:text-red-600"
                  title="Delete"
                  disabled={remove.isPending}
                  onClick={() => {
                    if (confirm("Delete this SIP?")) remove.mutate(sip.id);
                  }}
                >
                  ✕
                </button>
              </div>

              {outcome === null ? (
                <p role="status" className="mt-1 text-xs font-medium text-green-700">✓ Recorded</p>
              ) : block === "account_target" ? (
                <LinkInstallmentRow sip={sip} date={date} />
              ) : block !== null ? (
                <p className="mt-1 text-xs text-slate-400">{SIP_RECORD_BLOCK_LABEL[block]}</p>
              ) : (
                <div className="mt-1">
                  <div className="flex flex-wrap items-end gap-2 text-xs">
                    <input
                      type="checkbox"
                      aria-label={`Record ${targetLabel(sip)}`}
                      checked={draft.include}
                      onChange={(e) => setDraft(sip.id, { include: e.target.checked })}
                    />
                    <label className="block">
                      <span className="text-slate-600">Amount (₹)</span>
                      <input
                        value={draft.amountR}
                        onChange={(e) => setDraft(sip.id, { amountR: e.target.value })}
                        inputMode="decimal"
                        className="mt-1 w-24 rounded-md border border-slate-300 px-2 py-1.5 text-right"
                      />
                    </label>
                    <label className="block">
                      <span className="text-slate-600">Basis</span>
                      <select
                        value={draft.valueKind}
                        onChange={(e) => setDraft(sip.id, { valueKind: e.target.value as "nav" | "units" })}
                        className="mt-1 w-20 rounded-md border border-slate-300 px-2 py-1.5"
                      >
                        <option value="nav">NAV</option>
                        <option value="units">Units</option>
                      </select>
                    </label>
                    <label className="block">
                      <span className="text-slate-600">{draft.valueKind === "nav" ? "NAV (₹)" : "Units"}</span>
                      <input
                        value={draft.valueInput}
                        onChange={(e) => setDraft(sip.id, { valueInput: e.target.value })}
                        inputMode="decimal"
                        className="mt-1 w-24 rounded-md border border-slate-300 px-2 py-1.5 text-right"
                      />
                    </label>
                    <label className="block min-w-[6rem] flex-1">
                      <span className="text-slate-600">Note (optional)</span>
                      <input
                        value={draft.note}
                        onChange={(e) => setDraft(sip.id, { note: e.target.value })}
                        className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5"
                      />
                    </label>
                  </div>
                  {typeof outcome === "string" && <p role="alert" className="mt-1 text-xs text-red-600">{outcome}</p>}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <div className="flex items-center gap-3 border-t border-slate-100 px-3 py-2 text-sm">
        <button
          type="submit"
          disabled={included.length === 0 || !ready || record.isPending}
          className="rounded-md bg-brand-600 px-3 py-1.5 text-white disabled:opacity-40"
        >
          {record.isPending
            ? "Recording…"
            : `Record ${included.length} installment${included.length === 1 ? "" : "s"}`}
        </button>
        {included.length > 0 && !ready && (
          <span className="text-xs text-amber-700">Fill in the amount and NAV/units for every ticked SIP.</span>
        )}
      </div>
    </form>
  );
}

/** Add-SIP form: a goal, a bank source account, a polymorphic target (MF folio or account), amount, and debit day. */
function SipForm({ onDone }: { onDone: () => void }) {
  const { data: goals } = useGoals();
  const { data: accountList } = useAccounts();
  const { data: portfolio } = usePortfolio();
  const { create } = useSipMutations();

  const activeGoals = (goals ?? []).filter((g) => !g.archived);
  const bankAccounts = (accountList ?? []).filter((a) => isBankAccount(a.type) && a.archivedAt === null);

  const [goalId, setGoalId] = useState("");
  const [sourceAccountId, setSourceAccountId] = useState("");
  const [targetKind, setTargetKind] = useState<SipTargetKind>("mf_folio");
  const [targetHoldingId, setTargetHoldingId] = useState("");
  const [targetAccountId, setTargetAccountId] = useState("");
  const [fundingSource, setFundingSource] = useState<SipFundingSource>("bank_debit");
  const [amountR, setAmountR] = useState("");
  const [dayOfMonth, setDayOfMonth] = useState("5");
  const [frequency, setFrequency] = useState<SipFrequency>("monthly");

  // MF-folio target candidates: this goal's own folios, plus unmapped ones —
  // a folio mapped to a *different* goal can't be picked (it would double-count
  // toward two goals' funding). Unmapped folios get linked to this goal on create.
  const folios = (portfolio?.positions ?? []).filter(
    (p) => !p.archived && (p.goalId === null || p.goalId === goalId),
  );

  // Account-target candidates: investment-scheme accounts (PPF/EPF/SSY/investment)
  // — bank/cash accounts are excluded because the cash-flow forecast already
  // aggregates every bank/cash balance, so crediting one as a SIP target would
  // fabricate a cash loss — mapped to this goal or unmapped, excluding the source.
  const targetAccounts = (accountList ?? []).filter(
    (a) =>
      a.archivedAt === null &&
      accountCanHaveGoal(a.type) &&
      (a.goalId === null || a.goalId === goalId) &&
      a.id !== sourceAccountId,
  );

  const canSubmit =
    goalId !== "" &&
    sourceAccountId !== "" &&
    amountR !== "" &&
    (targetKind === "mf_folio" ? targetHoldingId !== "" : targetAccountId !== "");

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    create.mutate(
      {
        goalId,
        sourceAccountId,
        targetKind,
        targetHoldingId: targetKind === "mf_folio" ? targetHoldingId : null,
        targetAccountId: targetKind === "account" ? targetAccountId : null,
        fundingSource,
        amountPaise: rupeesToPaise(parseFloat(amountR)),
        dayOfMonth: parseInt(dayOfMonth, 10),
        frequency,
      },
      {
        onSuccess: () => {
          toast("SIP added", "success");
          onDone();
        },
        onError: (err) => toast(err instanceof Error ? err.message : "Couldn't add the SIP"),
      },
    );
  }

  return (
    <form onSubmit={submit} className="grid gap-2 text-xs sm:grid-cols-2">
      <label className="block">
        <span className="text-slate-600">Goal</span>
        <select
          value={goalId}
          onChange={(e) => {
            // Both target lists are filtered by goal, so a target picked for the
            // previous goal would stay in state while vanishing from its own
            // dropdown — invisible, still non-empty, and rejected by the server
            // as "already earmarked for a different goal".
            setGoalId(e.target.value);
            setTargetHoldingId("");
            setTargetAccountId("");
          }}
          required
          className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5"
        >
          <option value="">Select…</option>
          {activeGoals.map((g) => (
            <option key={g.id} value={g.id}>{g.name}</option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="text-slate-600">Source account</span>
        <select
          value={sourceAccountId}
          onChange={(e) => setSourceAccountId(e.target.value)}
          required
          className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5"
        >
          <option value="">Select…</option>
          {bankAccounts.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="text-slate-600">Target</span>
        <select
          value={targetKind}
          onChange={(e) => {
            const kind = e.target.value as SipTargetKind;
            setTargetKind(kind);
            // payroll is only valid for an account target — see the Funded by field.
            if (kind === "mf_folio") setFundingSource("bank_debit");
          }}
          className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5"
        >
          <option value="mf_folio">MF folio</option>
          <option value="account">Account (PPF/SSY…)</option>
        </select>
      </label>
      {targetKind === "mf_folio" ? (
        <label className="block sm:col-span-2">
          <span className="text-slate-600">MF folio</span>
          <select
            value={targetHoldingId}
            onChange={(e) => setTargetHoldingId(e.target.value)}
            required
            className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5"
          >
            <option value="">Select…</option>
            {folios.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}{f.folioNumber ? ` (Folio ${f.folioNumber})` : ""}
                {f.goalId === null ? " (will link to this goal)" : ""}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <label className="block sm:col-span-2">
          <span className="text-slate-600">Target account</span>
          <select
            value={targetAccountId}
            onChange={(e) => setTargetAccountId(e.target.value)}
            required
            className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5"
          >
            <option value="">Select…</option>
            {targetAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}{a.goalId === null ? " (will link to this goal)" : ""}
              </option>
            ))}
          </select>
        </label>
      )}
      {/* Only offered for an account target: a payroll-funded SIP is a salary
          deduction the payslip already books as a bank→retirement transfer, so
          pairing it with an MF folio is rejected (see sipFundingSourceIssue).
          A `payroll` SIP is also excluded from the 90-day cash forecast, since
          its debit is already in the ledger. */}
      {targetKind === "account" && (
        <label className="block">
          <span className="text-slate-600">Funded by</span>
          <select
            value={fundingSource}
            onChange={(e) => setFundingSource(e.target.value as SipFundingSource)}
            className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5"
          >
            <option value="bank_debit">Bank auto-debit</option>
            <option value="payroll">Salary deduction (EPF)</option>
          </select>
        </label>
      )}
      <label className="block">
        <span className="text-slate-600">Amount (₹/{SIP_FREQUENCY_LABEL[frequency]})</span>
        <input
          value={amountR}
          onChange={(e) => setAmountR(e.target.value)}
          inputMode="decimal"
          required
          className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-right"
        />
      </label>
      <label className="block">
        <span className="text-slate-600">Frequency</span>
        <select
          value={frequency}
          onChange={(e) => setFrequency(e.target.value as SipFrequency)}
          className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5"
        >
          {SIP_FREQUENCY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="text-slate-600">Day of month</span>
        <input
          type="number"
          min={1}
          max={28}
          value={dayOfMonth}
          onChange={(e) => setDayOfMonth(e.target.value)}
          className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-right"
        />
      </label>
      <div className="flex items-center gap-3 sm:col-span-2">
        <button
          type="submit"
          disabled={create.isPending || !canSubmit}
          className="rounded-md bg-brand-600 px-4 py-1.5 text-white disabled:opacity-40"
        >
          {create.isPending ? "Adding…" : "Add SIP"}
        </button>
        <button type="button" className="text-slate-500 underline" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/**
 * The account-target (PPF/SSY) recording control: point the SIP at the ledger
 * transaction that funded this installment. Deliberately outside the batch —
 * there is nothing to type, the deposit already exists, so it commits on its own
 * button instead of waiting for the batch submit. It renders plain
 * `type="button"` controls and never a nested <form>, because it lives inside
 * InstallmentBatch's form element.
 */
function LinkInstallmentRow({ sip, date }: { sip: Sip; date: string }) {
  // A due row opens itself; anything else stays collapsed so the page doesn't
  // fire a candidates request per account row on mount.
  const [open, setOpen] = useState(sipLinkDue(sip, date));
  const [selected, setSelected] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { linkInstallment, unlinkInstallment } = useSipMutations();
  const { data: candidates, isPending, isError } = useSipInstallmentCandidates(sip.id, date, open);

  if (!open) {
    return (
      <p className="mt-1 text-xs text-slate-400">
        Recorded by linking a ledger transaction —{" "}
        <button type="button" className="underline" onClick={() => setOpen(true)}>
          choose one
        </button>
      </p>
    );
  }

  if (isPending) {
    return <p className="mt-1 text-xs text-slate-400">Loading deposits…</p>;
  }
  if (isError) {
    return <p className="mt-1 text-xs text-slate-400">Couldn't load this account's deposits.</p>;
  }

  const unlinked = candidates.filter((c) => !c.linked);
  const linked = candidates.filter((c) => c.linked);

  return (
    <div className="mt-1">
      {unlinked.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="rounded-md border border-slate-300 px-2 py-1.5"
          >
            <option value="">Select a deposit…</option>
            {unlinked.map((c) => (
              <option key={c.id} value={c.id}>
                {formatDisplayDate(c.date)} · {formatINR(c.amountPaise)}
                {c.merchant !== "" ? ` · ${c.merchant}` : ""}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={selected === "" || linkInstallment.isPending}
            className="rounded-md bg-brand-600 px-2 py-1 text-white disabled:opacity-40"
            onClick={() => {
              setError(null);
              linkInstallment.mutate(
                { id: sip.id, transactionId: selected },
                {
                  onSuccess: () => {
                    setSelected("");
                    toast("Installment linked", "success");
                  },
                  onError: (err) =>
                    setError(err instanceof Error ? err.message : "Couldn't link this installment"),
                },
              );
            }}
          >
            Link
          </button>
        </div>
      ) : (
        <p className="text-xs text-slate-400">No unlinked deposits in this account up to this date.</p>
      )}
      {linked.map((c) => (
        <div key={c.id} className="mt-1 flex items-center gap-2 text-xs">
          <span className="font-medium text-green-700">
            ✓ {formatDisplayDate(c.date)} · {formatINR(c.amountPaise)} recorded
          </span>
          <button
            type="button"
            className="text-slate-500 underline"
            disabled={unlinkInstallment.isPending}
            onClick={() => {
              setError(null);
              unlinkInstallment.mutate(
                { id: sip.id, transactionId: c.id },
                {
                  onSuccess: () => toast("Installment unlinked", "success"),
                  onError: (err) =>
                    setError(err instanceof Error ? err.message : "Couldn't unlink this installment"),
                },
              );
            }}
          >
            Unlink
          </button>
        </div>
      ))}
      {error !== null && <p role="alert" className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
