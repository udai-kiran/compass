import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, useParams } from "react-router";
import {
  AccountNumberSchema,
  availableToDrawPaise,
  BankAccountSubtypeSchema,
  formatINR,
  IfscSchema,
  isBankAccount,
  isOverdraftAccount,
  isRetirementAccount,
  UpiIdSchema,
  type AccountWithBalance,
  type BankAccountSubtype,
} from "@compass/shared";
import { ACCOUNT_TYPE_LABELS, ACCOUNT_TYPES, maskAccountNumber } from "../../lib/account-meta.ts";
import {
  useBankDetails,
  useBankDetailsMutation,
  useOverdraftDetails,
  useOverdraftDetailsMutation,
  useRetirementDetails,
  useRetirementDetailsMutation,
} from "../../lib/account-detail-queries.ts";
import { InstitutionDatalist, InstitutionIcon, INSTITUTION_LIST_ID } from "../../lib/institutions.tsx";
import { UpiQr, upiPayUri } from "../../components/UpiQr.tsx";
import { useAccountMutations, useAccounts } from "../../lib/queries.ts";
import { useCardHolders, useStatementPasswordMutation } from "../../lib/card-queries.ts";
import { toast } from "../../lib/toast.tsx";

const SUBTYPE_LABELS: Record<BankAccountSubtype, string> = {
  savings: "Savings",
  current: "Current",
  salary: "Salary",
  nre: "NRE",
  nro: "NRO",
};

const NON_UPI_ACCOUNT_TYPES: readonly AccountWithBalance["type"][] = [
  "loan",
  "overdraft",
  "home_loan_od",
  "epf",
  "ppf",
];

/** Validates with the same schema the API enforces, so the two can't disagree. */
function errorOf(schema: { safeParse: (v: unknown) => { success: boolean; error?: unknown } }, value: string) {
  if (value === "") return null;
  const res = schema.safeParse(value);
  if (res.success) return null;
  const issues = (res.error as { issues?: Array<{ message: string }> }).issues;
  return issues?.[0]?.message ?? "Invalid";
}

export function AccountDetailPage() {
  const { id = "" } = useParams();
  const { data: accounts, isPending } = useAccounts();
  const account = accounts?.find((a) => a.id === id);

  if (isPending) return <p className="p-6 text-sm text-slate-400">Loading…</p>;
  if (!account) {
    return (
      <div className="p-6">
        <p className="text-sm text-slate-500">That account no longer exists.</p>
        <Link to="/settings?tab=accounts" className="mt-2 inline-block text-sm text-slate-600 underline">
          Back to accounts
        </Link>
      </div>
    );
  }
  return <AccountDetail account={account} />;
}

function AccountDetail({ account }: { account: AccountWithBalance }) {
  const supportsUpi = !NON_UPI_ACCOUNT_TYPES.includes(account.type);

  return (
    <div className="mx-auto max-w-2xl p-6">
      <InstitutionDatalist />
      <Link to="/settings?tab=accounts" className="text-xs text-slate-500 underline">
        ‹ Back to accounts
      </Link>

      <header className="mt-4 flex items-center gap-3 border-b border-slate-200 pb-5">
        <InstitutionIcon institution={account.institution} />
        <div>
          <h1 className="text-lg font-medium text-slate-800">{account.name}</h1>
          <p className="text-xs text-slate-500">
            {[account.institution, ACCOUNT_TYPE_LABELS[account.type]].filter(Boolean).join(" · ")}
          </p>
        </div>
        <span className="ml-auto tabular-nums text-slate-600">{formatINR(account.balancePaise)}</span>
      </header>

      <IdentitySection account={account} />
      {supportsUpi && <UpiSection account={account} />}
      {/* Keyed by type so a change within a family (e.g. PPF→EPF) remounts the
          section with fresh state rather than keeping the old scheme's values. */}
      {isBankAccount(account.type) && <BankSection key={account.type} account={account} />}
      {isOverdraftAccount(account.type) && <OverdraftSection key={account.type} account={account} />}
      {isRetirementAccount(account.type) && <RetirementSection key={account.type} account={account} />}
      {account.type === "credit_card" && <StatementPasswordSection account={account} />}
    </div>
  );
}

function StatementPasswordSection({ account }: { account: AccountWithBalance }) {
  const { data: holders } = useCardHolders();
  const mutation = useStatementPasswordMutation();
  // The statement password is an issuer-level setting, shared across the bank's cards.
  const holder = holders?.find((h) => h.cards.some((c) => c.accountId === account.id));
  const hasPassword = holder?.settings?.hasStatementPassword ?? false;
  const [password, setPassword] = useState("");
  const dirty = password.trim() !== "";

  function save(value: string, msg: string) {
    mutation.mutate(
      { accountId: account.id, password: value },
      {
        onSuccess: () => {
          toast(msg, "success");
          setPassword("");
        },
      },
    );
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (dirty) save(password, "Statement password saved");
  }

  return (
    <Section
      title="Statement password"
      hint="Opens this card's password-protected e-statement PDFs. Stored encrypted — never shown again."
    >
      <form onSubmit={submit} className="space-y-3">
        <Field label="Password">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="off"
            className={inputClass}
            placeholder={hasPassword ? "•••••••• saved — type to replace" : "e-statement password"}
          />
        </Field>
        <div className="flex items-center gap-3 pl-[8.75rem]">
          <button
            type="submit"
            disabled={!dirty || mutation.isPending}
            className="rounded-md bg-slate-800 px-3 py-1.5 text-sm text-white disabled:opacity-40"
          >
            {mutation.isPending ? "Saving…" : "Save"}
          </button>
          {hasPassword && (
            <button
              type="button"
              onClick={() => save("", "Statement password removed")}
              className="text-xs text-red-600 hover:underline"
            >
              Remove
            </button>
          )}
        </div>
      </form>
    </Section>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="border-b border-slate-100 py-6">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h2>
      {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
      <div className="mt-4 space-y-3">{children}</div>
    </section>
  );
}

function Field({ label, error, children }: { label: string; error?: string | null; children: ReactNode }) {
  return (
    <label className="flex items-baseline gap-3 text-sm">
      <span className="w-32 shrink-0 text-slate-500">{label}</span>
      <span className="flex-1">
        {children}
        {error && <span className="mt-1 block text-xs text-red-600">{error}</span>}
      </span>
    </label>
  );
}

const inputClass =
  "w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-slate-400 focus:outline-none";

function SaveButton({ dirty, disabled, pending }: { dirty: boolean; disabled: boolean; pending: boolean }) {
  return (
    <button
      type="submit"
      disabled={!dirty || disabled || pending}
      className="rounded-md bg-slate-800 px-3 py-1.5 text-sm text-white disabled:opacity-40"
    >
      {pending ? "Saving…" : dirty ? "Save" : "Saved"}
    </button>
  );
}

function IdentitySection({ account }: { account: AccountWithBalance }) {
  const { update } = useAccountMutations();
  const [name, setName] = useState(account.name);
  const [holder, setHolder] = useState(account.holderName ?? "");
  const [institution, setInstitution] = useState(account.institution ?? "");
  const [type, setType] = useState<AccountWithBalance["type"]>(account.type);

  const dirty =
    name !== account.name ||
    holder !== (account.holderName ?? "") ||
    institution !== (account.institution ?? "") ||
    type !== account.type;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (name.trim() === "") return;
    update.mutate(
      {
        id: account.id,
        name: name.trim(),
        holderName: holder.trim() || null,
        institution: institution.trim() || null,
        type,
      },
      { onSuccess: () => toast("Account updated", "success") },
    );
  }

  return (
    <form onSubmit={submit}>
      <Section title="Identity" hint="The name is yours to write — nothing parses it.">
        <Field label="Name">
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Holder name">
          <input
            value={holder}
            onChange={(e) => setHolder(e.target.value)}
            placeholder="As printed by the bank"
            className={inputClass}
          />
        </Field>
        <Field label="Bank">
          <input
            value={institution}
            onChange={(e) => setInstitution(e.target.value)}
            list={INSTITUTION_LIST_ID}
            placeholder="HDFC"
            className={inputClass}
          />
        </Field>
        <Field label="Type">
          <select
            value={type}
            onChange={(e) => setType(e.target.value as AccountWithBalance["type"])}
            className={inputClass}
          >
            {ACCOUNT_TYPES.map((t) => (
              <option key={t} value={t}>
                {ACCOUNT_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </Field>
        <div className="pt-1">
          <SaveButton dirty={dirty} disabled={name.trim() === ""} pending={update.isPending} />
        </div>
      </Section>
    </form>
  );
}

function UpiSection({ account }: { account: AccountWithBalance }) {
  const { update } = useAccountMutations();
  const [draft, setDraft] = useState("");
  const error = errorOf(UpiIdSchema, draft.trim());

  function save(ids: string[], message: string) {
    update.mutate({ id: account.id, upiIds: ids }, { onSuccess: () => toast(message, "success") });
  }

  function add(e: FormEvent) {
    e.preventDefault();
    const v = draft.trim().toLowerCase();
    if (v === "" || error) return;
    if (account.upiIds.includes(v)) {
      toast("That UPI ID is already on this account");
      return;
    }
    save([...account.upiIds, v], "UPI ID added");
    setDraft("");
  }

  return (
    <Section title="UPI" hint="Handles that resolve to this account. The first one is primary.">
      {account.upiIds.length > 0 && (
        <ul className="space-y-1.5">
          {account.upiIds.map((upi, i) => (
            <li key={upi} className="flex items-center gap-2 text-sm">
              <span className="font-mono text-slate-700">{upi}</span>
              {i === 0 && (
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">primary</span>
              )}
              {i > 0 && (
                <button
                  type="button"
                  className="text-xs text-slate-400 underline"
                  onClick={() =>
                    save([upi, ...account.upiIds.filter((u) => u !== upi)], "Primary UPI ID changed")
                  }
                >
                  Make primary
                </button>
              )}
              <button
                type="button"
                className="ml-auto text-xs text-red-500 underline"
                onClick={() => save(account.upiIds.filter((u) => u !== upi), "UPI ID removed")}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {account.upiIds[0] && (
        <div className="flex items-center gap-3">
          <UpiQr value={upiPayUri(account.upiIds[0], account.name)} size={120} />
          <p className="text-xs text-slate-500">
            Scan to pay <span className="font-mono text-slate-700">{account.upiIds[0]}</span>
            <br />
            <span className="text-slate-400">Primary UPI ID · works in any UPI app</span>
          </p>
        </div>
      )}
      <form onSubmit={add} className="flex items-start gap-2">
        <div className="flex-1">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="name@okhdfcbank"
            aria-label="Add UPI ID"
            aria-invalid={error !== null}
            className={`${inputClass} ${error ? "border-red-400" : ""}`}
          />
          {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
        </div>
        <button
          type="submit"
          disabled={draft.trim() === "" || error !== null}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 disabled:opacity-40"
        >
          Add
        </button>
      </form>
    </Section>
  );
}

function BankSection({ account }: { account: AccountWithBalance }) {
  const { data, isPending } = useBankDetails(account.id, true);
  const save = useBankDetailsMutation(account.id);
  const [number, setNumber] = useState("");
  const [ifsc, setIfsc] = useState("");
  const [branch, setBranch] = useState("");
  const [subtype, setSubtype] = useState<BankAccountSubtype | "">("");
  const [reveal, setReveal] = useState(false);

  // The form is uncontrolled until the fetch lands; seed it once it does.
  useEffect(() => {
    if (!data) return;
    setNumber(data.accountNumber);
    setIfsc(data.ifsc);
    setBranch(data.branch);
    setSubtype(data.subtype ?? "");
  }, [data]);

  const numberError = errorOf(AccountNumberSchema, number);
  const ifscError = errorOf(IfscSchema, ifsc);
  const dirty =
    number !== (data?.accountNumber ?? "") ||
    ifsc !== (data?.ifsc ?? "") ||
    branch !== (data?.branch ?? "") ||
    subtype !== (data?.subtype ?? "");

  function submit(e: FormEvent) {
    e.preventDefault();
    if (numberError || ifscError) return;
    save.mutate(
      { accountNumber: number, ifsc, branch, subtype: subtype || null },
      { onSuccess: () => toast("Bank details saved", "success") },
    );
  }

  if (isPending) return <Section title="Bank details"><p className="text-sm text-slate-400">Loading…</p></Section>;

  return (
    <form onSubmit={submit}>
      <Section title="Bank details" hint="What you'd read out to someone paying you.">
        <Field label="A/C number" error={numberError}>
          <div className="flex items-center gap-2">
            <input
              value={reveal || number === "" ? number : maskAccountNumber(number)}
              onChange={(e) => setNumber(e.target.value.replace(/\D/g, "").slice(0, 18))}
              onFocus={() => setReveal(true)}
              inputMode="numeric"
              placeholder="50100123453510"
              aria-invalid={numberError !== null}
              className={`${inputClass} font-mono ${numberError ? "border-red-400" : ""}`}
            />
            {number !== "" && (
              <button
                type="button"
                onClick={() => setReveal((r) => !r)}
                className="shrink-0 text-xs text-slate-500 underline"
              >
                {reveal ? "Hide" : "Reveal"}
              </button>
            )}
          </div>
        </Field>
        <Field label="IFSC" error={ifscError}>
          <input
            value={ifsc}
            onChange={(e) => setIfsc(e.target.value.toUpperCase().slice(0, 11))}
            placeholder="HDFC0001234"
            aria-invalid={ifscError !== null}
            className={`${inputClass} font-mono ${ifscError ? "border-red-400" : ""}`}
          />
        </Field>
        <Field label="Branch">
          <input
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            placeholder="Kondapur"
            className={inputClass}
          />
        </Field>
        <Field label="Account type">
          <select
            value={subtype}
            onChange={(e) => setSubtype(e.target.value as BankAccountSubtype | "")}
            className={inputClass}
          >
            <option value="">Not set</option>
            {BankAccountSubtypeSchema.options.map((s) => (
              <option key={s} value={s}>
                {SUBTYPE_LABELS[s]}
              </option>
            ))}
          </select>
        </Field>
        <p className="text-xs text-slate-400">
          {number === ""
            ? "Without a full number, the last 4 stays editable in the accounts list."
            : `The accounts list shows •••• ${number.slice(-4)}, taken from this number.`}
        </p>
        <div className="pt-1">
          <SaveButton
            dirty={dirty}
            disabled={numberError !== null || ifscError !== null}
            pending={save.isPending}
          />
        </div>
      </Section>
    </form>
  );
}

function DerivedRow({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex items-baseline gap-3 text-sm">
      <span className="w-32 shrink-0 text-slate-500">{label}</span>
      <span className="flex-1">
        <span className="tabular-nums text-slate-700">{value}</span>
        {hint && <span className="ml-2 text-xs text-slate-400">{hint}</span>}
      </span>
    </div>
  );
}

function OverdraftSection({ account }: { account: AccountWithBalance }) {
  const { data, isPending } = useOverdraftDetails(account.id, true);
  const save = useOverdraftDetailsMutation(account.id);
  const [limit, setLimit] = useState("");
  const [rate, setRate] = useState("");

  useEffect(() => {
    if (!data) return;
    setLimit(data.sanctionedLimitPaise === 0 ? "" : (data.sanctionedLimitPaise / 100).toString());
    setRate(data.annualRateBps === 0 ? "" : (data.annualRateBps / 100).toFixed(2));
  }, [data]);

  const limitPaise = limit === "" ? 0 : Math.round(Number(limit) * 100);
  const rateBps = rate === "" ? 0 : Math.round(Number(rate) * 100);
  const limitError = limit !== "" && (Number.isNaN(limitPaise) || limitPaise < 0) ? "must be a positive amount" : null;
  const rateError = rate !== "" && (Number.isNaN(rateBps) || rateBps < 0 || rateBps > 2000) ? "0–20%" : null;

  // Balance is negative for a liability; owed is the positive amount you owe.
  const owedPaise = Math.max(0, -account.balancePaise);
  const availablePaise = availableToDrawPaise(limitPaise, owedPaise);
  const interestSavedPaise = Math.round((availablePaise * rateBps) / 10000);

  const dirty = limitPaise !== (data?.sanctionedLimitPaise ?? 0) || rateBps !== (data?.annualRateBps ?? 0);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (limitError || rateError) return;
    save.mutate(
      { sanctionedLimitPaise: limitPaise, annualRateBps: rateBps },
      { onSuccess: () => toast("Overdraft details saved", "success") },
    );
  }

  if (isPending) return <Section title="Overdraft"><p className="text-sm text-slate-400">Loading…</p></Section>;

  return (
    <form onSubmit={submit}>
      <Section
        title="Overdraft"
        hint="Park surplus into the loan to cut interest — it stays withdrawable as drawing power."
      >
        <Field label="Sanctioned limit" error={limitError}>
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-400">₹</span>
            <input
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              inputMode="decimal"
              placeholder="5000000"
              aria-invalid={limitError !== null}
              className={`${inputClass} tabular-nums ${limitError ? "border-red-400" : ""}`}
            />
          </div>
        </Field>
        <Field label="Interest rate" error={rateError}>
          <div className="flex items-center gap-2">
            <input
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              inputMode="decimal"
              placeholder="8.55"
              aria-invalid={rateError !== null}
              className={`${inputClass} ${rateError ? "border-red-400" : ""}`}
            />
            <span className="text-sm text-slate-400">%</span>
          </div>
        </Field>

        <div className="space-y-2 rounded-md bg-slate-50 p-3">
          <DerivedRow label="Limit availed" value={formatINR(owedPaise)} hint="what you owe now" />
          <DerivedRow
            label="Limit available"
            value={formatINR(availablePaise)}
            hint={limitPaise === 0 ? "set a limit to see this" : "surplus you can withdraw"}
          />
          {interestSavedPaise > 0 && (
            <DerivedRow
              label="Interest saved"
              value={`≈ ${formatINR(interestSavedPaise)}/yr`}
              hint="estimate, at this rate"
            />
          )}
        </div>

        <div className="pt-1">
          <SaveButton
            dirty={dirty}
            disabled={limitError !== null || rateError !== null}
            pending={save.isPending}
          />
        </div>
      </Section>
    </form>
  );
}

function RetirementSection({ account }: { account: AccountWithBalance }) {
  const { data, isPending } = useRetirementDetails(account.id, true);
  const save = useRetirementDetailsMutation(account.id);
  const [rate, setRate] = useState("");
  const [maturity, setMaturity] = useState("");
  const [reference, setReference] = useState("");
  const [eps, setEps] = useState("");
  const isEpf = account.type === "epf";
  const referenceLabel =
    account.type === "epf" ? "UAN" : account.type === "ssy" ? "SSY account number" : "PPF account number";

  useEffect(() => {
    if (!data) return;
    setRate(data.annualRateBps === 0 ? "" : (data.annualRateBps / 100).toFixed(2));
    setMaturity(data.maturityDate ?? "");
    setReference(data.referenceNumber);
    setEps(data.epsBalancePaise == null ? "" : (data.epsBalancePaise / 100).toFixed(2));
  }, [data]);

  const rateBps = rate === "" ? 0 : Math.round(Number(rate) * 100);
  const rateError = rate !== "" && (Number.isNaN(rateBps) || rateBps < 0 || rateBps > 5000) ? "0–50%" : null;
  const epsPaise = eps === "" ? null : Math.round(Number(eps) * 100);
  const epsError = eps !== "" && (epsPaise === null || Number.isNaN(epsPaise) || epsPaise < 0) ? "≥ 0" : null;
  const dirty =
    rateBps !== (data?.annualRateBps ?? 0) ||
    maturity !== (data?.maturityDate ?? "") ||
    reference !== (data?.referenceNumber ?? "") ||
    (isEpf && epsPaise !== (data?.epsBalancePaise ?? null));

  function submit(e: FormEvent) {
    e.preventDefault();
    if (rateError || epsError) return;
    save.mutate(
      {
        annualRateBps: rateBps,
        // EPF never carries a maturity date; sending a stale one the API rejects.
        maturityDate: isEpf ? null : maturity || null,
        referenceNumber: reference.trim(),
        epsBalancePaise: isEpf ? epsPaise : null,
      },
      { onSuccess: () => toast("Details saved", "success") },
    );
  }

  if (isPending) return <Section title="Scheme details"><p className="text-sm text-slate-400">Loading…</p></Section>;

  return (
    <form onSubmit={submit}>
      <Section
        title="Scheme details"
        hint={isEpf ? "EPF interest is credited by EPFO — the balance is a fact, not an estimate." : undefined}
      >
        <Field label="Interest rate" error={rateError}>
          <div className="flex items-center gap-2">
            <input
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              inputMode="decimal"
              placeholder="7.10"
              aria-invalid={rateError !== null}
              className={`${inputClass} ${rateError ? "border-red-400" : ""}`}
            />
            <span className="text-sm text-slate-400">%</span>
          </div>
        </Field>
        <Field label={referenceLabel}>
          <input
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder={isEpf ? "100123456789" : "Account number"}
            className={`${inputClass} font-mono`}
          />
        </Field>
        {/* EPS is an EPF-only pension pot EPFO tracks apart from the PF corpus. */}
        {isEpf && (
          <Field label="EPS balance" error={epsError}>
            <div className="flex items-center gap-2">
              <span className="text-sm text-slate-400">₹</span>
              <input
                value={eps}
                onChange={(e) => setEps(e.target.value)}
                inputMode="decimal"
                placeholder="Pension balance"
                aria-invalid={epsError !== null}
                className={`${inputClass} ${epsError ? "border-red-400" : ""}`}
              />
            </div>
          </Field>
        )}
        {/* EPF has no maturity — the API rejects one, so don't offer the field. */}
        {!isEpf && (
          <Field label="Matures on">
            <input
              type="date"
              value={maturity}
              onChange={(e) => setMaturity(e.target.value)}
              className={inputClass}
            />
          </Field>
        )}
        <div className="pt-1">
          <SaveButton dirty={dirty} disabled={rateError !== null || epsError !== null} pending={save.isPending} />
        </div>
      </Section>
    </form>
  );
}
