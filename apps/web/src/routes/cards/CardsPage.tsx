import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import {
  CardNetworkSchema,
  formatINR,
  type CardHolderSummary,
  type CardNetwork,
  type CardSummary,
  type UpsertCardDetails,
  type UpsertCardIssuerSettings,
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
  useCardHolders,
  useIssuerSettingsMutation,
  useRewardMutations,
  useRewards,
  useStatementPasswordMutation,
} from "../../lib/card-queries.ts";
import { DateField } from "../../components/DateField.tsx";

const NETWORK_LABELS: Record<CardNetwork, string> = {
  visa: "Visa",
  mastercard: "Mastercard",
  amex: "Amex",
  rupay: "RuPay",
  diners: "Diners Club",
};

export function CardsPage() {
  const { data: holders, isLoading } = useCardHolders();

  const totalOwed = (holders ?? []).reduce((sum, h) => sum + h.totalOwedPaise, 0);
  const cardCount = (holders ?? []).reduce((sum, h) => sum + h.cards.length, 0);

  return (
    <div className="mx-auto max-w-4xl">
      <header className="mb-4">
        <h1 className="text-xl font-semibold text-slate-800">Credit Cards</h1>
        <p className="mt-0.5 text-sm text-slate-500">
          Grouped by bank — each bank's cards share one combined limit, statement password, and
          registered mobile.
        </p>
      </header>

      {cardCount > 0 && (
        <div className="mb-4 flex items-center justify-between rounded-lg border border-rose-200 bg-rose-50 px-4 py-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-rose-700">Current liability</p>
            <p className="text-2xl font-semibold tabular-nums text-rose-900">{formatINR(totalOwed)}</p>
          </div>
          <p className="text-sm text-rose-700">
            owed across {cardCount} card{cardCount === 1 ? "" : "s"}
          </p>
        </div>
      )}

      {isLoading && <p className="text-sm text-slate-400">Loading…</p>}

      {holders && holders.length === 0 && (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
          No credit-card accounts yet. Add one from{" "}
          <a href="/settings" className="text-slate-800 underline">
            Settings → Accounts
          </a>{" "}
          (type “Credit card”), then configure its cycle here.
        </div>
      )}

      <div className="space-y-4">
        {holders?.map((h) => (
          <HolderSection key={h.institution ?? h.cards[0]!.accountId} holder={h} />
        ))}
      </div>
    </div>
  );
}

/** The bigger "bank" card: combined stats + shared settings, wrapping its cards. */
function HolderSection({ holder }: { holder: CardHolderSummary }) {
  const [editingBank, setEditingBank] = useState(false);
  const assigned = holder.institution !== null;

  return (
    <section className="rounded-xl border border-slate-300 bg-slate-50">
      <div className="flex items-start justify-between gap-4 p-4">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-base font-semibold text-slate-800">
            <InstitutionIcon institution={holder.bankName} />
            <span className="truncate">{assigned ? holder.bankName : "Unassigned"}</span>
          </h2>
          {assigned ? (
            <p className="mt-0.5 text-sm text-slate-500">
              {holder.totalOwedPaise > 0 ? `${formatINR(holder.totalOwedPaise)} owed` : "Nothing owed"}
              {holder.creditLimitPaise > 0 && <> · limit {formatINR(holder.creditLimitPaise)}</>}
              {" · "}
              {holder.cards.length} card{holder.cards.length === 1 ? "" : "s"}
            </p>
          ) : (
            <p className="mt-0.5 text-sm text-slate-500">
              No bank set — assign one (Edit on the card) to share a limit and statement password.
            </p>
          )}
        </div>
        {assigned && (
          <button
            onClick={() => setEditingBank((v) => !v)}
            className="shrink-0 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
          >
            {editingBank ? "Close" : holder.settings ? "Edit bank" : "Set up bank"}
          </button>
        )}
      </div>

      {assigned && holder.utilizationPct !== null && (
        <div className="px-4 pb-3">
          <div className="mb-1 flex justify-between text-xs text-slate-500">
            <span>Combined utilization</span>
            <span
              className={
                holder.utilizationAlertPct !== null && holder.utilizationPct >= holder.utilizationAlertPct
                  ? "font-medium text-red-600"
                  : "text-slate-600"
              }
            >
              {holder.utilizationPct}%
              {holder.utilizationAlertPct !== null && ` (alert at ${holder.utilizationAlertPct}%)`}
            </span>
          </div>
          <Meter pct={holder.utilizationPct} />
        </div>
      )}

      {editingBank && assigned && (
        <BankSettingsForm holder={holder} onDone={() => setEditingBank(false)} />
      )}

      <div className="grid gap-3 p-4 pt-1 sm:grid-cols-2">
        {holder.cards.map((c) => (
          <CardTile key={c.accountId} card={c} billMobile={holder.settings?.billMobile ?? ""} />
        ))}
      </div>
    </section>
  );
}

/** A smaller card tile inside its bank holder. */
function CardTile({ card, billMobile }: { card: CardSummary; billMobile: string }) {
  const [editing, setEditing] = useState(card.details === null);
  const [showRewards, setShowRewards] = useState(false);
  const [showPay, setShowPay] = useState(false);
  const owed = Math.max(0, -card.balancePaise);
  const canPay = bankSupportsBillVpa(card.bankName);

  return (
    <div className="flex flex-col rounded-lg border border-slate-200 bg-white">
      <div className="flex items-start justify-between gap-2 border-b border-slate-100 p-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold">
            <Link to={`/cards/${card.accountId}`} className="text-slate-800 hover:underline">
              {card.name}
            </Link>
          </h3>
          {(card.details?.network || card.details?.productName || card.last4) && (
            <p className="mt-0.5 truncate text-xs text-slate-500">
              {[
                card.details?.network && NETWORK_LABELS[card.details.network],
                card.details?.productName,
                card.last4 && `•• ${card.last4}`,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          )}
          <p className="mt-0.5 text-sm text-slate-600">
            {owed > 0 ? `${formatINR(owed)} owed` : "Nothing owed"}
          </p>
        </div>
        <button
          onClick={() => setEditing((v) => !v)}
          className="shrink-0 rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
        >
          {editing ? "Close" : card.details ? "Edit" : "Set up"}
        </button>
      </div>

      {card.details && (
        <div className="grid grid-cols-2 gap-3 p-3">
          <Stat label="Total due" value={formatINR(card.amountDuePaise)} />
          <Stat label="Due date" value={card.dueDate ?? "—"} />
          <Stat
            label="Statement"
            value={
              card.statementStart && card.statementEnd
                ? `${card.statementStart.slice(5)} → ${card.statementEnd.slice(5)}`
                : "—"
            }
          />
          <Stat label="Recent spends" value={formatINR(card.currentSpendPaise)} />
        </div>
      )}

      <div className="mt-auto flex flex-wrap gap-2 border-t border-slate-100 p-3">
        <button
          onClick={() => setShowRewards((v) => !v)}
          className="rounded-md border border-slate-300 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50"
        >
          {card.rewardPoints.toLocaleString("en-IN")} pts
        </button>
        {canPay && (
          <button
            onClick={() => setShowPay((v) => !v)}
            className="rounded-md border border-slate-300 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50"
          >
            {showPay ? "Hide pay" : "Pay bill"}
          </button>
        )}
      </div>

      {showPay && canPay && <PayBill card={card} billMobile={billMobile} />}
      {editing && <DetailsForm card={card} onDone={() => setEditing(false)} />}
      {showRewards && (
        <RewardsPanel accountId={card.accountId} earnRate={card.details?.earnRatePer100 ?? 0} />
      )}
    </div>
  );
}

/**
 * UPI bill-payment for issuers with a mobile+last4 VPA scheme (Axis, ICICI).
 * The registered mobile is a bank-level setting shared across the issuer's cards.
 */
function PayBill({ card, billMobile }: { card: CardSummary; billMobile: string }) {
  const [copied, setCopied] = useState(false);
  const vpa = cardBillVpa(card.bankName, billMobile || null, card.last4);

  return (
    <div className="border-t border-slate-100 p-3">
      <h4 className="text-xs font-semibold text-slate-700">Pay bill via UPI</h4>
      {vpa ? (
        <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center">
          {/* No prefilled amount: amountDuePaise is the balance at statement close and
              doesn't subtract later payments, so it could re-request an already-paid
              bill. The payer enters the amount in their UPI app. */}
          <UpiQr value={upiPayUri(vpa, card.name)} />
          <div className="min-w-0">
            <p className="text-xs text-slate-500">UPI ID</p>
            <div className="mt-0.5 flex items-center gap-2">
              <code className="truncate rounded bg-slate-100 px-2 py-1 font-mono text-xs text-slate-800">
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
          Add the bank’s <span className="font-medium">registered mobile</span> (Edit bank) and the
          card’s <span className="font-medium">last 4 digits</span> (Settings → account) to generate
          the UPI payment ID.
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

/** Shared settings for the whole bank: combined limit, alerts, mobile, password. */
function BankSettingsForm({ holder, onDone }: { holder: CardHolderSummary; onDone: () => void }) {
  const s = holder.settings;
  const mutation = useIssuerSettingsMutation();
  const [limit, setLimit] = useState(s ? String(s.creditLimitPaise / 100) : "");
  const [alertPct, setAlertPct] = useState(
    s?.utilizationAlertPct === null ? "" : String(s?.utilizationAlertPct ?? 30),
  );
  const [remindDays, setRemindDays] = useState(String(s?.remindDays ?? 3));
  const [billMobile, setBillMobile] = useState(s?.billMobile ?? "");
  const institution = holder.institution!;

  const base = (): UpsertCardIssuerSettings => ({
    institution,
    creditLimitPaise: Math.round((parseFloat(limit) || 0) * 100),
    utilizationAlertPct: alertPct === "" ? null : parseInt(alertPct, 10),
    remindDays: parseInt(remindDays, 10),
    billMobile: billMobile.replace(/\D/g, ""),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    mutation.mutate(base(), {
      onSuccess: () => {
        toast("Bank settings saved", "success");
        onDone();
      },
    });
  }

  return (
    <form
      onSubmit={submit}
      className="grid grid-cols-2 gap-3 border-y border-slate-200 bg-white p-4 sm:grid-cols-3"
    >
      <p className="col-span-2 text-xs text-slate-500 sm:col-span-3">
        These apply to every {institution} card.
      </p>
      <Field label="Combined credit limit (₹)">
        <input
          inputMode="decimal"
          value={limit}
          onChange={(e) => setLimit(e.target.value)}
          className="input"
          placeholder="e.g. 500000"
        />
      </Field>
      <Field label="Utilization alert (%) — blank to disable">
        <input
          type="number"
          min={1}
          max={100}
          value={alertPct}
          onChange={(e) => setAlertPct(e.target.value)}
          className="input"
        />
      </Field>
      <Field label="Remind days before due">
        <input
          type="number"
          min={0}
          max={30}
          value={remindDays}
          onChange={(e) => setRemindDays(e.target.value)}
          className="input"
        />
      </Field>
      <Field
        label={
          bankSupportsBillVpa(institution)
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
      <div className="col-span-2 flex gap-2 sm:col-span-3">
        <button
          type="submit"
          disabled={mutation.isPending}
          className="rounded-md bg-brand-600 px-4 py-1.5 text-sm text-white disabled:opacity-40"
        >
          {mutation.isPending ? "Saving…" : "Save bank settings"}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded-md border border-slate-300 px-4 py-1.5 text-sm text-slate-600"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

/** Per-card settings: identity + statement cycle + reward rate. */
function DetailsForm({ card, onDone }: { card: CardSummary; onDone: () => void }) {
  const d = card.details;
  const mutation = useCardDetailsMutation();
  const passwordMutation = useStatementPasswordMutation();
  const [network, setNetwork] = useState<string>(d?.network ?? "");
  const [productName, setProductName] = useState(d?.productName ?? "");
  const [bankName, setBankName] = useState(card.bankName ?? "");
  const [cycleDay, setCycleDay] = useState(String(d?.cycleDay ?? 1));
  const [dueDay, setDueDay] = useState(String(d?.dueDay ?? 15));
  const [earnRate, setEarnRate] = useState(String(d?.earnRatePer100 ?? 0));
  const [statementPassword, setStatementPassword] = useState("");
  const hasPassword = d?.hasStatementPassword ?? false;

  // Saved on its own (separate endpoint) so it survives a card-details edit and
  // isn't sent as plaintext through the details form. Per-card: each of a bank's
  // cards has its own e-statement password (issuers embed the card's last-4).
  function savePassword(value: string, msg: string) {
    passwordMutation.mutate(
      { accountId: card.accountId, password: value },
      {
        onSuccess: () => {
          toast(msg, "success");
          setStatementPassword("");
        },
      },
    );
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const body: UpsertCardDetails & { accountId: string } = {
      accountId: card.accountId,
      network: network === "" ? null : (network as CardNetwork),
      productName: productName.trim(),
      bankName: bankName.trim(),
      cycleDay: parseInt(cycleDay, 10),
      dueDay: parseInt(dueDay, 10),
      earnRatePer100: parseInt(earnRate, 10) || 0,
    };
    mutation.mutate(body, {
      onSuccess: () => {
        toast("Card saved", "success");
        onDone();
      },
    });
  }

  return (
    <form
      onSubmit={submit}
      className="grid grid-cols-2 gap-3 border-t border-slate-100 bg-slate-50 p-3"
    >
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
      <Field label="Reward pts per ₹100">
        <input
          type="number"
          min={0}
          value={earnRate}
          onChange={(e) => setEarnRate(e.target.value)}
          className="input"
        />
      </Field>
      <Field label="Statement close day (1–28)">
        <input
          type="number"
          min={1}
          max={28}
          value={cycleDay}
          onChange={(e) => setCycleDay(e.target.value)}
          className="input"
        />
      </Field>
      <Field label="Payment due day (1–28)">
        <input
          type="number"
          min={1}
          max={28}
          value={dueDay}
          onChange={(e) => setDueDay(e.target.value)}
          className="input"
        />
      </Field>
      <div className="col-span-2">
        <Field
          label={
            hasPassword
              ? "Statement PDF password (saved — type to replace)"
              : "Statement PDF password"
          }
        >
          <div className="flex items-center gap-2">
            <input
              type="password"
              value={statementPassword}
              onChange={(e) => setStatementPassword(e.target.value)}
              autoComplete="off"
              className="input"
              placeholder={hasPassword ? "••••••••" : "opens this card's e-statement PDF"}
            />
            <button
              type="button"
              onClick={() => savePassword(statementPassword, "Statement password saved")}
              disabled={!statementPassword.trim() || passwordMutation.isPending}
              className="shrink-0 rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 disabled:opacity-40"
            >
              Set
            </button>
            {hasPassword && (
              <button
                type="button"
                onClick={() => savePassword("", "Statement password removed")}
                disabled={passwordMutation.isPending}
                className="shrink-0 text-xs text-red-600 hover:underline disabled:opacity-40"
              >
                Remove
              </button>
            )}
          </div>
        </Field>
      </div>
      <div className="col-span-2 flex gap-2">
        <button
          type="submit"
          disabled={mutation.isPending}
          className="rounded-md bg-brand-600 px-4 py-1.5 text-sm text-white disabled:opacity-40"
        >
          {mutation.isPending ? "Saving…" : "Save card"}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded-md border border-slate-300 px-4 py-1.5 text-sm text-slate-600"
        >
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
    <div className="border-t border-slate-100 bg-slate-50 p-3">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-xs font-semibold text-slate-700">Reward points</h4>
        {earnRate > 0 && <span className="text-xs text-slate-400">Earning {earnRate} pt / ₹100</span>}
      </div>
      <form onSubmit={submit} className="mb-3 flex flex-wrap items-end gap-2 text-sm">
        <DateField value={date} onChange={(iso) => setDate(iso)} className="w-36" aria-label="Reward date" />
        <input
          type="number"
          value={points}
          onChange={(e) => setPoints(e.target.value)}
          placeholder="± points"
          className="input w-28"
          title="positive = earned, negative = redeemed/expired"
        />
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="note" className="input w-40" />
        <button
          type="submit"
          disabled={add.isPending}
          className="rounded-md bg-brand-600 px-3 py-1.5 text-white disabled:opacity-40"
        >
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
