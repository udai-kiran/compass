import { useState, type FormEvent } from "react";
import {
  CardNetworkSchema,
  formatINR,
  type CardNetwork,
  type CardSummary,
  type UpsertCardDetails,
} from "@compass/shared";
import { Meter } from "../../lib/viz.tsx";
import { toast } from "../../lib/toast.tsx";
import { UpiQr, upiPayUri } from "../../components/UpiQr.tsx";
import { bankSupportsBillVpa, cardBillVpa } from "../../lib/card-billpay.ts";
import {
  InstitutionDatalist,
  InstitutionIcon,
  INSTITUTION_LIST_ID,
} from "../../lib/institutions.tsx";
import {
  useCardDetailsMutation,
  useCards,
  useRewardMutations,
  useRewards,
} from "../../lib/card-queries.ts";

const NETWORK_LABELS: Record<CardNetwork, string> = {
  visa: "Visa",
  mastercard: "Mastercard",
  amex: "Amex",
  rupay: "RuPay",
  diners: "Diners Club",
};

export function CardsPage() {
  const { data: cards, isLoading } = useCards();

  // Total credit-card liability = what's owed across every card (each card's
  // balance is signed, negative when owed), summed and shown up top.
  const totalOwed = (cards ?? []).reduce((sum, c) => sum + Math.max(0, -c.balancePaise), 0);

  return (
    <div className="mx-auto max-w-4xl">
      <header className="mb-4">
        <h1 className="text-xl font-semibold text-slate-800">Credit Cards</h1>
        <p className="mt-0.5 text-sm text-slate-500">
          Statement periods, amounts due, and utilization for your credit-card accounts.
        </p>
      </header>

      {cards && cards.length > 0 && (
        <div className="mb-4 flex items-center justify-between rounded-lg border border-rose-200 bg-rose-50 px-4 py-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-rose-700">Current liability</p>
            <p className="text-2xl font-semibold tabular-nums text-rose-900">{formatINR(totalOwed)}</p>
          </div>
          <p className="text-sm text-rose-700">
            owed across {cards.length} card{cards.length === 1 ? "" : "s"}
          </p>
        </div>
      )}

      {isLoading && <p className="text-sm text-slate-400">Loading…</p>}

      {cards && cards.length === 0 && (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
          No credit-card accounts yet. Add one from{" "}
          <a href="/settings" className="text-slate-800 underline">
            Settings → Accounts
          </a>{" "}
          (type “Credit card”), then configure its cycle here.
        </div>
      )}

      <div className="space-y-4">
        {cards?.map((c) => <CardRow key={c.accountId} card={c} />)}
      </div>
    </div>
  );
}

function CardRow({ card }: { card: CardSummary }) {
  const [editing, setEditing] = useState(card.details === null);
  const [showRewards, setShowRewards] = useState(false);
  const owed = Math.max(0, -card.balancePaise);

  return (
    <section className="rounded-lg border border-slate-200 bg-white">
      <div className="flex items-start justify-between gap-4 border-b border-slate-100 p-4">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold text-slate-800">{card.name}</h2>
          {(card.bankName || card.details?.network || card.details?.productName) && (
            <p className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500">
              <InstitutionIcon institution={card.bankName} />
              <span className="truncate">
                {[
                  card.bankName,
                  card.details?.network && NETWORK_LABELS[card.details.network],
                  card.details?.productName,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </p>
          )}
          <p className="mt-0.5 text-sm text-slate-500">
            {owed > 0 ? `${formatINR(owed)} owed` : "Nothing owed"}
            {card.details && card.details.creditLimitPaise > 0 && (
              <> · limit {formatINR(card.details.creditLimitPaise)}</>
            )}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            onClick={() => setShowRewards((v) => !v)}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
          >
            {card.rewardPoints.toLocaleString("en-IN")} pts
          </button>
          <button
            onClick={() => setEditing((v) => !v)}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
          >
            {editing ? "Close" : card.details ? "Edit" : "Set up"}
          </button>
        </div>
      </div>

      {card.details && (
        <div className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-4">
          <Stat label="Amount due" value={formatINR(card.amountDuePaise)} />
          <Stat label="Due date" value={card.dueDate ?? "—"} />
          <Stat
            label="Statement"
            value={
              card.statementStart && card.statementEnd
                ? `${card.statementStart.slice(5)} → ${card.statementEnd.slice(5)}`
                : "—"
            }
          />
          <Stat label="Spend this cycle" value={formatINR(card.currentSpendPaise)} />
          {card.utilizationPct !== null && (
            <div className="col-span-2 sm:col-span-4">
              <div className="mb-1 flex justify-between text-xs text-slate-500">
                <span>Utilization</span>
                <span
                  className={
                    card.details.utilizationAlertPct !== null &&
                    card.utilizationPct >= card.details.utilizationAlertPct
                      ? "font-medium text-red-600"
                      : "text-slate-600"
                  }
                >
                  {card.utilizationPct}%
                  {card.details.utilizationAlertPct !== null &&
                    ` (alert at ${card.details.utilizationAlertPct}%)`}
                </span>
              </div>
              <Meter pct={card.utilizationPct} />
            </div>
          )}
        </div>
      )}

      <PayBill card={card} />

      {editing && <DetailsForm card={card} onDone={() => setEditing(false)} />}
      {showRewards && <RewardsPanel accountId={card.accountId} earnRate={card.details?.earnRatePer100 ?? 0} />}
    </section>
  );
}

/**
 * UPI bill-payment for issuers with a mobile+last4 VPA scheme (Axis, ICICI).
 * Renders nothing for banks without a scheme. Shows a copyable UPI ID and a
 * scannable QR; falls back to a hint when the mobile or last-4 is missing.
 */
function PayBill({ card }: { card: CardSummary }) {
  const [copied, setCopied] = useState(false);
  if (!bankSupportsBillVpa(card.bankName)) return null;
  const vpa = cardBillVpa(card.bankName, card.details?.billMobile ?? null, card.last4);

  return (
    <div className="border-t border-slate-100 p-4">
      <h3 className="text-sm font-semibold text-slate-700">Pay bill via UPI</h3>
      {vpa ? (
        <div className="mt-2 flex flex-col gap-4 sm:flex-row sm:items-center">
          {/* No prefilled amount: amountDuePaise is the balance at statement close and
              doesn't subtract later payments, so it could re-request an already-paid
              bill. The payer enters the amount in their UPI app. */}
          <UpiQr value={upiPayUri(vpa, card.name)} />
          <div className="min-w-0">
            <p className="text-xs text-slate-500">UPI ID</p>
            <div className="mt-0.5 flex items-center gap-2">
              <code className="truncate rounded bg-slate-100 px-2 py-1 font-mono text-sm text-slate-800">
                {vpa}
              </code>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard?.writeText(vpa);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
                className="shrink-0 rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <p className="mt-2 max-w-xs text-xs text-slate-400">
              Scan the QR or pay to this UPI ID from any app, entering the amount yourself. Confirm it
              resolves to {card.bankName} before paying.
            </p>
          </div>
        </div>
      ) : (
        <p className="mt-2 text-xs text-slate-500">
          Add the card’s <span className="font-medium">registered mobile</span> (Edit cycle) and its{" "}
          <span className="font-medium">last 4 digits</span> (Settings → account) to generate the UPI
          payment ID.
        </p>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-0.5 text-sm font-medium text-slate-800">{value}</p>
    </div>
  );
}

function DetailsForm({ card, onDone }: { card: CardSummary; onDone: () => void }) {
  const d = card.details;
  const mutation = useCardDetailsMutation();
  const [network, setNetwork] = useState<string>(d?.network ?? "");
  const [productName, setProductName] = useState(d?.productName ?? "");
  const [bankName, setBankName] = useState(card.bankName ?? "");
  const [billMobile, setBillMobile] = useState(d?.billMobile ?? "");
  const [cycleDay, setCycleDay] = useState(String(d?.cycleDay ?? 1));
  const [dueDay, setDueDay] = useState(String(d?.dueDay ?? 15));
  const [limit, setLimit] = useState(d ? String(d.creditLimitPaise / 100) : "");
  const [alertPct, setAlertPct] = useState(d?.utilizationAlertPct === null ? "" : String(d?.utilizationAlertPct ?? 30));
  const [remindDays, setRemindDays] = useState(String(d?.remindDays ?? 3));
  const [earnRate, setEarnRate] = useState(String(d?.earnRatePer100 ?? 0));
  const [statementPassword, setStatementPassword] = useState("");
  const hasPassword = d?.hasStatementPassword ?? false;

  const base = (): UpsertCardDetails & { accountId: string } => ({
    accountId: card.accountId,
    network: network === "" ? null : (network as CardNetwork),
    productName: productName.trim(),
    bankName: bankName.trim(),
    billMobile: billMobile.replace(/\D/g, ""),
    cycleDay: parseInt(cycleDay, 10),
    dueDay: parseInt(dueDay, 10),
    creditLimitPaise: Math.round((parseFloat(limit) || 0) * 100),
    utilizationAlertPct: alertPct === "" ? null : parseInt(alertPct, 10),
    remindDays: parseInt(remindDays, 10),
    earnRatePer100: parseInt(earnRate, 10) || 0,
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    const body = base();
    // A typed password replaces the stored one; blank leaves it untouched.
    if (statementPassword.trim()) body.statementPassword = statementPassword;
    mutation.mutate(body, {
      onSuccess: () => {
        toast("Card cycle saved", "success");
        onDone();
      },
    });
  }

  function removePassword() {
    mutation.mutate(
      { ...base(), statementPassword: "" },
      {
        onSuccess: () => {
          toast("Statement password removed");
          setStatementPassword("");
        },
      },
    );
  }

  return (
    <form onSubmit={submit} className="grid grid-cols-2 gap-3 border-t border-slate-100 bg-slate-50 p-4 sm:grid-cols-3">
      <InstitutionDatalist />
      <Field label="Bank">
        <input
          value={bankName}
          onChange={(e) => setBankName(e.target.value)}
          list={INSTITUTION_LIST_ID}
          className="input"
          placeholder="e.g. HDFC"
        />
      </Field>
      <Field label="Network">
        <select value={network} onChange={(e) => setNetwork(e.target.value)} className="input">
          <option value="">—</option>
          {CardNetworkSchema.options.map((n) => (
            <option key={n} value={n}>
              {NETWORK_LABELS[n]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Product name">
        <input
          value={productName}
          onChange={(e) => setProductName(e.target.value)}
          className="input"
          placeholder="e.g. Regalia Gold"
        />
      </Field>
      <Field
        label={
          bankSupportsBillVpa(bankName)
            ? "Registered mobile (for UPI bill payment)"
            : "Registered mobile"
        }
      >
        <input
          value={billMobile}
          onChange={(e) => setBillMobile(e.target.value)}
          inputMode="numeric"
          maxLength={10}
          className="input"
          placeholder="10-digit mobile"
        />
      </Field>
      <Field label="Statement close day (1–28)">
        <input type="number" min={1} max={28} value={cycleDay} onChange={(e) => setCycleDay(e.target.value)} className="input" />
      </Field>
      <Field label="Payment due day (1–28)">
        <input type="number" min={1} max={28} value={dueDay} onChange={(e) => setDueDay(e.target.value)} className="input" />
      </Field>
      <Field label="Credit limit (₹)">
        <input inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} className="input" placeholder="e.g. 200000" />
      </Field>
      <Field label="Utilization alert (%) — blank to disable">
        <input type="number" min={1} max={100} value={alertPct} onChange={(e) => setAlertPct(e.target.value)} className="input" />
      </Field>
      <Field label="Remind days before due">
        <input type="number" min={0} max={30} value={remindDays} onChange={(e) => setRemindDays(e.target.value)} className="input" />
      </Field>
      <Field label="Reward pts per ₹100">
        <input type="number" min={0} value={earnRate} onChange={(e) => setEarnRate(e.target.value)} className="input" />
      </Field>
      <Field
        label={
          hasPassword ? "Statement PDF password (saved — type to replace)" : "Statement PDF password"
        }
      >
        <div className="flex items-center gap-2">
          <input
            type="password"
            value={statementPassword}
            onChange={(e) => setStatementPassword(e.target.value)}
            autoComplete="off"
            className="input"
            placeholder={hasPassword ? "••••••••" : "opens the e-statement PDF"}
          />
          {hasPassword && (
            <button
              type="button"
              onClick={removePassword}
              disabled={mutation.isPending}
              className="shrink-0 text-xs text-red-600 hover:underline disabled:opacity-40"
            >
              Remove
            </button>
          )}
        </div>
      </Field>
      <div className="col-span-2 flex gap-2 sm:col-span-3">
        <button type="submit" disabled={mutation.isPending} className="rounded-md bg-slate-800 px-4 py-1.5 text-sm text-white disabled:opacity-40">
          {mutation.isPending ? "Saving…" : "Save cycle"}
        </button>
        <button type="button" onClick={onDone} className="rounded-md border border-slate-300 px-4 py-1.5 text-sm text-slate-600">
          Cancel
        </button>
      </div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-slate-500">
      {label}
      {children}
    </label>
  );
}

function RewardsPanel({ accountId, earnRate }: { accountId: string; earnRate: number }) {
  const { data: rewards } = useRewards(accountId);
  const { add, remove } = useRewardMutations(accountId);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [points, setPoints] = useState("");
  const [note, setNote] = useState("");

  function submit(e: FormEvent) {
    e.preventDefault();
    const p = parseInt(points, 10);
    if (!p) return;
    add.mutate(
      { date, points: p, note },
      {
        onSuccess: () => {
          setPoints("");
          setNote("");
          toast("Reward entry added", "success");
        },
      },
    );
  }

  return (
    <div className="border-t border-slate-100 bg-slate-50 p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700">Reward points</h3>
        {earnRate > 0 && <span className="text-xs text-slate-400">Earning {earnRate} pt / ₹100</span>}
      </div>
      <form onSubmit={submit} className="mb-3 flex flex-wrap items-end gap-2 text-sm">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input" />
        <input
          type="number"
          value={points}
          onChange={(e) => setPoints(e.target.value)}
          placeholder="± points"
          className="input w-28"
          title="positive = earned, negative = redeemed/expired"
        />
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="note" className="input w-40" />
        <button type="submit" disabled={add.isPending} className="rounded-md bg-slate-800 px-3 py-1.5 text-white disabled:opacity-40">
          Add
        </button>
      </form>
      <ul className="divide-y divide-slate-100 rounded-md border border-slate-200 bg-white">
        {rewards?.map((r) => (
          <li key={r.id} className="flex items-center gap-3 px-3 py-1.5 text-sm">
            <span className="w-24 text-slate-500">{r.date}</span>
            <span className={`w-20 font-medium ${r.points < 0 ? "text-red-600" : "text-emerald-600"}`}>
              {r.points > 0 ? "+" : ""}
              {r.points.toLocaleString("en-IN")}
            </span>
            <span className="min-w-0 flex-1 truncate text-slate-600">{r.note}</span>
            <button className="text-slate-400 hover:text-red-600" onClick={() => remove.mutate(r.id)}>
              ✕
            </button>
          </li>
        ))}
        {rewards?.length === 0 && (
          <li className="px-3 py-4 text-center text-xs text-slate-400">No reward entries yet.</li>
        )}
      </ul>
    </div>
  );
}
