import { useState, type FormEvent, type ReactNode } from "react";
import {
  formatINR,
  InsuranceKindSchema,
  PremiumFrequencySchema,
  VehicleKindSchema,
  type InsuranceKind,
  type InsurancePolicy,
  type PremiumFrequency,
  type VehicleKind,
} from "@compass/shared";
import { usePolicies, usePolicyMutations } from "../../lib/insurance-queries.ts";
import { toast } from "../../lib/toast.tsx";
import { PremiumsPanel } from "./PremiumsPanel.tsx";

const KIND_LABELS: Record<InsuranceKind, string> = {
  life: "Life",
  health: "Health",
  vehicle: "Vehicle",
};

const VEHICLE_LABELS: Record<VehicleKind, string> = {
  car: "Car",
  bike: "Bike",
  other: "Other",
};

const FREQ_LABELS: Record<PremiumFrequency, string> = {
  monthly: "Monthly",
  quarterly: "Quarterly",
  half_yearly: "Half-yearly",
  yearly: "Yearly",
  single: "Single / one-time",
};

/** What the cover figure is called for each kind. */
const COVER_LABEL: Record<InsuranceKind, string> = {
  life: "Sum assured",
  health: "Sum insured",
  vehicle: "IDV",
};

export function InsurancePage() {
  const { data: policies, isLoading } = usePolicies();
  const [adding, setAdding] = useState(false);

  const active = (policies ?? []).filter((p) => !p.archived);
  const totalCover = active.reduce((s, p) => s + p.sumAssuredPaise, 0);

  return (
    <div className="mx-auto max-w-4xl">
      <header className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">Insurance</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Life, health, and vehicle policies — cover, renewals, and premium payments.
          </p>
        </div>
        <button
          onClick={() => setAdding((v) => !v)}
          className="shrink-0 rounded-md bg-slate-800 px-4 py-1.5 text-sm text-white hover:bg-slate-700"
        >
          {adding ? "Close" : "Add policy"}
        </button>
      </header>

      {active.length > 0 && (
        <div className="mb-4 flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Total cover</p>
            <p className="text-2xl font-semibold tabular-nums text-slate-800">{formatINR(totalCover)}</p>
          </div>
          <p className="text-sm text-slate-500">
            across {active.length} active {active.length === 1 ? "policy" : "policies"}
          </p>
        </div>
      )}

      {adding && (
        <div className="mb-4 rounded-lg border border-slate-200 bg-white">
          <PolicyForm onDone={() => setAdding(false)} />
        </div>
      )}

      {isLoading && <p className="text-sm text-slate-400">Loading…</p>}

      {policies && policies.length === 0 && !adding && (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
          No policies yet. Add your first life, health, or vehicle policy to start tracking cover,
          renewals, and premiums.
        </div>
      )}

      <div className="space-y-4">
        {policies?.map((p) => <PolicyCard key={p.id} policy={p} />)}
      </div>
    </div>
  );
}

function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">
      {children}
    </span>
  );
}

function PolicyCard({ policy }: { policy: InsurancePolicy }) {
  const [editing, setEditing] = useState(false);
  const [showPremiums, setShowPremiums] = useState(false);
  const { remove } = usePolicyMutations();

  const kindLabel =
    policy.kind === "vehicle" && policy.vehicleType
      ? `${VEHICLE_LABELS[policy.vehicleType]} insurance`
      : `${KIND_LABELS[policy.kind]} insurance`;

  function del() {
    if (!confirm(`Delete "${policy.name}"? Its logged premiums stay in the ledger.`)) return;
    remove.mutate(policy.id, { onSuccess: () => toast("Policy deleted", "success") });
  }

  return (
    <section className={`rounded-lg border bg-white ${policy.archived ? "border-slate-200 opacity-60" : "border-slate-200"}`}>
      <div className="flex items-start justify-between gap-4 border-b border-slate-100 p-4">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 truncate text-base font-semibold text-slate-800">
            {policy.name}
            <Badge>{kindLabel}</Badge>
            {policy.archived && <Badge>Archived</Badge>}
          </h2>
          <p className="mt-0.5 truncate text-xs text-slate-500">
            {[policy.insurer, policy.policyNumber && `#${policy.policyNumber}`]
              .filter(Boolean)
              .join(" · ") || "No insurer set"}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            onClick={() => setShowPremiums((v) => !v)}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
          >
            Premiums
          </button>
          <button
            onClick={() => setEditing((v) => !v)}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
          >
            {editing ? "Close" : "Edit"}
          </button>
          <button
            onClick={del}
            disabled={remove.isPending}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 disabled:opacity-40"
          >
            Delete
          </button>
        </div>
      </div>

      {!editing && (
        <div className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-4">
          <Stat label={COVER_LABEL[policy.kind]} value={formatINR(policy.sumAssuredPaise)} />
          {policy.bonusPaise > 0 && <Stat label="Bonus" value={formatINR(policy.bonusPaise)} />}
          <Stat
            label="Premium"
            value={`${formatINR(policy.premiumPaise)} · ${FREQ_LABELS[policy.premiumFrequency]}`}
          />
          <Stat label="Started" value={policy.startDate ?? "—"} />
          <Stat label="Renews" value={policy.renewalDate ?? "—"} />
          {policy.kind === "life" && <Stat label="Matures" value={policy.maturityDate ?? "—"} />}
          {policy.nominee && <Stat label="Nominee" value={policy.nominee} />}
        </div>
      )}

      {policy.notes && !editing && (
        <p className="border-t border-slate-100 px-4 py-3 text-sm text-slate-600">{policy.notes}</p>
      )}

      {editing && <PolicyForm policy={policy} onDone={() => setEditing(false)} />}
      {showPremiums && <PremiumsPanel policy={policy} />}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-0.5 truncate text-sm font-medium text-slate-800">{value}</p>
    </div>
  );
}

function Field({ label, children, error }: { label: string; children: ReactNode; error?: string | null }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-slate-500">
      {label}
      {children}
      {error && <span className="text-red-600">{error}</span>}
    </label>
  );
}

const toPaise = (v: string) => Math.round((parseFloat(v) || 0) * 100);
const fromPaise = (p: number) => (p === 0 ? "" : (p / 100).toString());

function PolicyForm({ policy, onDone }: { policy?: InsurancePolicy; onDone: () => void }) {
  const { create, update } = usePolicyMutations();
  const [name, setName] = useState(policy?.name ?? "");
  const [kind, setKind] = useState<InsuranceKind>(policy?.kind ?? "life");
  const [vehicleType, setVehicleType] = useState<VehicleKind | "">(policy?.vehicleType ?? "");
  const [insurer, setInsurer] = useState(policy?.insurer ?? "");
  const [policyNumber, setPolicyNumber] = useState(policy?.policyNumber ?? "");
  const [sumAssured, setSumAssured] = useState(fromPaise(policy?.sumAssuredPaise ?? 0));
  const [bonus, setBonus] = useState(fromPaise(policy?.bonusPaise ?? 0));
  const [premium, setPremium] = useState(fromPaise(policy?.premiumPaise ?? 0));
  const [frequency, setFrequency] = useState<PremiumFrequency>(policy?.premiumFrequency ?? "yearly");
  const [startDate, setStartDate] = useState(policy?.startDate ?? "");
  const [renewalDate, setRenewalDate] = useState(policy?.renewalDate ?? "");
  const [maturityDate, setMaturityDate] = useState(policy?.maturityDate ?? "");
  const [nominee, setNominee] = useState(policy?.nominee ?? "");
  const [notes, setNotes] = useState(policy?.notes ?? "");

  const pending = create.isPending || update.isPending;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (name.trim() === "") return;
    // Mirror the server's rules so we never send a field it rejects.
    const body = {
      name: name.trim(),
      kind,
      vehicleType: kind === "vehicle" ? (vehicleType || null) : null,
      insurer: insurer.trim(),
      policyNumber: policyNumber.trim(),
      sumAssuredPaise: toPaise(sumAssured),
      bonusPaise: toPaise(bonus),
      premiumPaise: toPaise(premium),
      premiumFrequency: frequency,
      startDate: startDate || null,
      renewalDate: renewalDate || null,
      maturityDate: kind === "life" ? (maturityDate || null) : null,
      nominee: nominee.trim(),
      notes: notes.trim(),
    };
    const onSuccess = () => {
      toast(policy ? "Policy updated" : "Policy added", "success");
      onDone();
    };
    if (policy) update.mutate({ id: policy.id, body: { ...body, archived: policy.archived } }, { onSuccess });
    else create.mutate(body, { onSuccess });
  }

  return (
    <form onSubmit={submit} className="grid grid-cols-2 gap-3 bg-slate-50 p-4 sm:grid-cols-3">
      <Field label="Policy name">
        <input value={name} onChange={(e) => setName(e.target.value)} className="input" placeholder="e.g. LIC Jeevan Anand" />
      </Field>
      <Field label="Type">
        <select value={kind} onChange={(e) => setKind(e.target.value as InsuranceKind)} className="input">
          {InsuranceKindSchema.options.map((k) => (
            <option key={k} value={k}>
              {KIND_LABELS[k]}
            </option>
          ))}
        </select>
      </Field>
      {kind === "vehicle" && (
        <Field label="Vehicle">
          <select value={vehicleType} onChange={(e) => setVehicleType(e.target.value as VehicleKind | "")} className="input">
            <option value="">Not set</option>
            {VehicleKindSchema.options.map((v) => (
              <option key={v} value={v}>
                {VEHICLE_LABELS[v]}
              </option>
            ))}
          </select>
        </Field>
      )}
      <Field label="Insurance company">
        <input value={insurer} onChange={(e) => setInsurer(e.target.value)} className="input" placeholder="e.g. LIC, Star Health" />
      </Field>
      <Field label="Policy number">
        <input value={policyNumber} onChange={(e) => setPolicyNumber(e.target.value)} className="input font-mono" />
      </Field>
      <Field label={`${COVER_LABEL[kind]} (₹)`}>
        <input inputMode="decimal" value={sumAssured} onChange={(e) => setSumAssured(e.target.value)} className="input" placeholder="1000000" />
      </Field>
      <Field label="Bonus so far (₹)">
        <input inputMode="decimal" value={bonus} onChange={(e) => setBonus(e.target.value)} className="input" placeholder="0" />
      </Field>
      <Field label="Premium (₹)">
        <input inputMode="decimal" value={premium} onChange={(e) => setPremium(e.target.value)} className="input" placeholder="12000" />
      </Field>
      <Field label="Frequency">
        <select value={frequency} onChange={(e) => setFrequency(e.target.value as PremiumFrequency)} className="input">
          {PremiumFrequencySchema.options.map((f) => (
            <option key={f} value={f}>
              {FREQ_LABELS[f]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Started from">
        <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="input" />
      </Field>
      <Field label="Renewal date">
        <input type="date" value={renewalDate} onChange={(e) => setRenewalDate(e.target.value)} className="input" />
      </Field>
      {kind === "life" && (
        <Field label="Maturity date">
          <input type="date" value={maturityDate} onChange={(e) => setMaturityDate(e.target.value)} className="input" />
        </Field>
      )}
      <Field label="Nominee">
        <input value={nominee} onChange={(e) => setNominee(e.target.value)} className="input" placeholder="Who's covered / benefits" />
      </Field>
      <Field label="Notes">
        <input value={notes} onChange={(e) => setNotes(e.target.value)} className="input" placeholder="Optional" />
      </Field>
      <div className="col-span-2 flex gap-2 sm:col-span-3">
        <button type="submit" disabled={pending || name.trim() === ""} className="rounded-md bg-slate-800 px-4 py-1.5 text-sm text-white disabled:opacity-40">
          {pending ? "Saving…" : policy ? "Save changes" : "Add policy"}
        </button>
        <button type="button" onClick={onDone} className="rounded-md border border-slate-300 px-4 py-1.5 text-sm text-slate-600">
          Cancel
        </button>
      </div>
    </form>
  );
}
