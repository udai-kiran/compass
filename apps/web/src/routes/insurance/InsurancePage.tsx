import { useState, type FormEvent, type ReactNode } from "react";
import {
  formatINR,
  HealthTypeSchema,
  InsuranceKindSchema,
  isFixedBenefit,
  PremiumFrequencySchema,
  VehicleKindSchema,
  type HealthType,
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

const HEALTH_LABELS: Record<HealthType, string> = {
  indemnity: "Indemnity",
  top_up: "Top-up / super top-up",
  critical_illness: "Critical illness",
  hospital_cash: "Hospital cash",
  personal_accident: "Personal accident",
  disease_specific: "Disease-specific",
};

const FREQ_LABELS: Record<PremiumFrequency, string> = {
  monthly: "Monthly",
  quarterly: "Quarterly",
  half_yearly: "Half-yearly",
  yearly: "Yearly",
  single: "Single / one-time",
};

/**
 * What the cover figure is called. Indemnity health cover is a reimbursement
 * ceiling ("Sum insured"); a fixed-benefit health plan pays a guaranteed lump
 * sum, so it reads like a life "Sum assured".
 */
function coverLabel(kind: InsuranceKind, healthType: HealthType | null): string {
  if (kind === "life") return "Sum assured";
  if (kind === "vehicle") return "IDV";
  return healthType && isFixedBenefit(healthType) ? "Sum assured" : "Sum insured";
}

const KIND_ORDER: InsuranceKind[] = ["health", "life", "vehicle"];

export function InsurancePage() {
  const { data: policies, isLoading } = usePolicies();
  const [adding, setAdding] = useState(false);
  const [tab, setTab] = useState<InsuranceKind>("health");

  const all = policies ?? [];
  const inTab = all.filter((p) => p.kind === tab);
  const countOf = (k: InsuranceKind) => all.filter((p) => p.kind === k).length;

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
          className="shrink-0 rounded-md bg-brand-600 px-4 py-1.5 text-sm text-white hover:bg-brand-700"
        >
          {adding ? "Close" : "Add policy"}
        </button>
      </header>

      <div className="mb-4 flex gap-1 rounded-lg border border-slate-200 bg-white p-1">
        {KIND_ORDER.map((k) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium ${
              tab === k ? "bg-brand-600 text-white" : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            {KIND_LABELS[k]}
            <span className={`text-xs tabular-nums ${tab === k ? "text-slate-300" : "text-slate-400"}`}>
              {countOf(k)}
            </span>
          </button>
        ))}
      </div>

      <KindSummary kind={tab} policies={inTab} />

      {adding && (
        <div className="mb-4 rounded-lg border border-slate-200 bg-white">
          <PolicyForm defaultKind={tab} onDone={() => setAdding(false)} />
        </div>
      )}

      {isLoading && <p className="text-sm text-slate-400">Loading…</p>}

      {!isLoading && inTab.length === 0 && !adding && (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
          No {KIND_LABELS[tab].toLowerCase()} policies yet. Add one to start tracking cover,
          renewals, and premiums.
        </div>
      )}

      <div className="space-y-4">
        {inTab.map((p) => <PolicyCard key={p.id} policy={p} />)}
      </div>
    </div>
  );
}

/**
 * Per-kind totals for the active tab. Cover only combines within a kind — and
 * for health, indemnity ceilings (reimbursement up to the sum insured) and
 * fixed-benefit payouts stay separate figures, per isFixedBenefit: adding a
 * hospital-cash payout to a hospitalisation ceiling would overstate both.
 */
function KindSummary({ kind, policies }: { kind: InsuranceKind; policies: InsurancePolicy[] }) {
  const active = policies.filter((p) => !p.archived);
  if (active.length === 0) return null;
  const sum = (list: InsurancePolicy[]) => list.reduce((s, p) => s + p.sumAssuredPaise, 0);

  let stats: Array<{ label: string; paise: number }>;
  if (kind === "health") {
    const fixed = active.filter((p) => p.healthType !== null && isFixedBenefit(p.healthType));
    const indemnity = active.filter((p) => !(p.healthType !== null && isFixedBenefit(p.healthType)));
    stats = [
      { label: "Hospitalisation cover", paise: sum(indemnity) },
      { label: "Fixed benefits", paise: sum(fixed) },
    ];
  } else if (kind === "life") {
    stats = [
      { label: "Total life cover", paise: sum(active) },
      { label: "Bonus accrued", paise: active.reduce((s, p) => s + p.bonusPaise, 0) },
    ];
  } else {
    stats = [{ label: "Combined IDV", paise: sum(active) }];
  }
  stats = stats.filter((s) => s.paise > 0);
  if (stats.length === 0) return null;

  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-4 rounded-lg border border-slate-200 bg-white px-4 py-3">
      <div className="flex flex-wrap gap-8">
        {stats.map((s) => (
          <div key={s.label}>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{s.label}</p>
            <p className="text-2xl font-semibold tabular-nums text-slate-800">{formatINR(s.paise)}</p>
          </div>
        ))}
      </div>
      <p className="text-sm text-slate-500">
        {active.length} active {active.length === 1 ? "policy" : "policies"}
      </p>
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
  const { remove, uploadDocument, removeDocument } = usePolicyMutations();

  const kindLabel =
    policy.kind === "vehicle" && policy.vehicleType
      ? `${VEHICLE_LABELS[policy.vehicleType]} insurance`
      : policy.kind === "health" && policy.healthType
        ? `Health · ${HEALTH_LABELS[policy.healthType]}`
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
          <Stat label={coverLabel(policy.kind, policy.healthType)} value={formatINR(policy.sumAssuredPaise)} />
          {policy.bonusPaise > 0 && <Stat label="Bonus" value={formatINR(policy.bonusPaise)} />}
          <Stat
            label="Premium"
            value={`${formatINR(policy.premiumPaise)} · ${FREQ_LABELS[policy.premiumFrequency]}`}
          />
          <Stat label="Started" value={policy.startDate ?? "—"} />
          <Stat label="Renews" value={policy.renewalDate ?? "—"} />
          {policy.kind === "life" && <Stat label="Matures" value={policy.maturityDate ?? "—"} />}
          {policy.vehicleRegNo && <Stat label="Reg. no." value={policy.vehicleRegNo} />}
          {policy.nominee && <Stat label="Nominee" value={policy.nominee} />}
        </div>
      )}

      {!editing && policy.coveredMembers.length > 0 && (
        <div className="border-t border-slate-100 px-4 py-3">
          <p className="text-xs text-slate-500">Covered members</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {policy.coveredMembers.map((m, i) => (
              <span key={i} className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
                {m}
              </span>
            ))}
          </div>
        </div>
      )}

      {!editing && (
        <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 px-4 py-3 text-sm">
          {policy.documentName ? (
            <>
              <a
                href={`/api/insurance/policies/${policy.id}/document`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-slate-700 underline hover:text-slate-900"
              >
                📄 {policy.documentName} ↗
              </a>
              <button
                type="button"
                onClick={() =>
                  removeDocument.mutate(policy.id, { onSuccess: () => toast("Document removed") })
                }
                disabled={removeDocument.isPending}
                className="text-xs text-red-600 hover:underline disabled:opacity-40"
              >
                Remove
              </button>
            </>
          ) : (
            <label className="cursor-pointer">
              <span className="rounded-md border border-slate-300 px-3 py-1.5 text-slate-600 hover:bg-slate-50">
                ⬆ Upload policy document
              </span>
              <input
                type="file"
                accept=".pdf,image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f)
                    uploadDocument.mutate(
                      { id: policy.id, file: f },
                      {
                        onSuccess: () => toast("Policy document uploaded", "success"),
                        onError: (err) =>
                          toast(err instanceof Error ? err.message : "Upload failed", "error"),
                      },
                    );
                  e.target.value = "";
                }}
              />
            </label>
          )}
          {uploadDocument.isPending && <span className="text-xs text-slate-400">Uploading…</span>}
        </div>
      )}

      {!editing && policy.kind === "health" && <HealthCards policy={policy} />}

      {policy.policyWordingUrl && !editing && (
        <p className="border-t border-slate-100 px-4 py-3 text-sm">
          <a
            href={policy.policyWordingUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-slate-600 underline hover:text-slate-800"
          >
            Policy wordings ↗
          </a>
        </p>
      )}

      {policy.notes && !editing && (
        <p className="border-t border-slate-100 px-4 py-3 text-sm text-slate-600">{policy.notes}</p>
      )}

      {editing && <PolicyForm policy={policy} onDone={() => setEditing(false)} />}
      {showPremiums && <PremiumsPanel policy={policy} />}
    </section>
  );
}

/** Health cards for a family-floater — one per covered member, each with a label. */
function HealthCards({ policy }: { policy: InsurancePolicy }) {
  const { uploadHealthCard, removeHealthCard } = usePolicyMutations();
  const [label, setLabel] = useState("");

  return (
    <div className="border-t border-slate-100 px-4 py-3">
      <p className="text-xs text-slate-500">Health cards</p>
      {policy.healthCards.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1.5">
          {policy.healthCards.map((c) => (
            <li key={c.id} className="flex items-center gap-2 text-sm">
              <a
                href={`/api/insurance/health-cards/${c.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-slate-700 underline hover:text-slate-900"
              >
                🪪 {c.label || c.fileName} ↗
              </a>
              {c.label && <span className="text-xs text-slate-400">{c.fileName}</span>}
              <button
                type="button"
                onClick={() =>
                  removeHealthCard.mutate(
                    { id: policy.id, cardId: c.id },
                    { onSuccess: () => toast("Health card removed") },
                  )
                }
                disabled={removeHealthCard.isPending}
                className="ml-auto text-xs text-red-600 hover:underline disabled:opacity-40"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Member (optional)"
          className="w-40 rounded-md border border-slate-300 px-2 py-1 text-sm"
        />
        <label className="cursor-pointer">
          <span className="rounded-md border border-slate-300 px-3 py-1.5 text-slate-600 hover:bg-slate-50">
            ⬆ Add health card
          </span>
          <input
            type="file"
            accept=".pdf,image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f)
                uploadHealthCard.mutate(
                  { id: policy.id, file: f, label: label.trim() },
                  {
                    onSuccess: () => {
                      toast("Health card added", "success");
                      setLabel("");
                    },
                    onError: (err) =>
                      toast(err instanceof Error ? err.message : "Upload failed", "error"),
                  },
                );
              e.target.value = "";
            }}
          />
        </label>
        {uploadHealthCard.isPending && <span className="text-xs text-slate-400">Uploading…</span>}
      </div>
    </div>
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

function PolicyForm({
  policy,
  defaultKind,
  onDone,
}: {
  policy?: InsurancePolicy;
  /** pre-select the active tab's kind when adding a new policy */
  defaultKind?: InsuranceKind;
  onDone: () => void;
}) {
  const { create, update } = usePolicyMutations();
  const [name, setName] = useState(policy?.name ?? "");
  const [kind, setKind] = useState<InsuranceKind>(policy?.kind ?? defaultKind ?? "life");
  const [vehicleType, setVehicleType] = useState<VehicleKind | "">(policy?.vehicleType ?? "");
  const [vehicleRegNo, setVehicleRegNo] = useState(policy?.vehicleRegNo ?? "");
  const [healthType, setHealthType] = useState<HealthType | "">(policy?.healthType ?? "");
  const [insurer, setInsurer] = useState(policy?.insurer ?? "");
  const [policyNumber, setPolicyNumber] = useState(policy?.policyNumber ?? "");
  const [wordingUrl, setWordingUrl] = useState(policy?.policyWordingUrl ?? "");
  const [sumAssured, setSumAssured] = useState(fromPaise(policy?.sumAssuredPaise ?? 0));
  const [bonus, setBonus] = useState(fromPaise(policy?.bonusPaise ?? 0));
  const [premium, setPremium] = useState(fromPaise(policy?.premiumPaise ?? 0));
  const [frequency, setFrequency] = useState<PremiumFrequency>(policy?.premiumFrequency ?? "yearly");
  const [startDate, setStartDate] = useState(policy?.startDate ?? "");
  const [renewalDate, setRenewalDate] = useState(policy?.renewalDate ?? "");
  const [maturityDate, setMaturityDate] = useState(policy?.maturityDate ?? "");
  const [nominee, setNominee] = useState(policy?.nominee ?? "");
  const [coveredMembers, setCoveredMembers] = useState<string[]>(policy?.coveredMembers ?? []);
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
      vehicleRegNo: kind === "vehicle" ? vehicleRegNo.trim() : "",
      healthType: kind === "health" ? (healthType || null) : null,
      insurer: insurer.trim(),
      policyNumber: policyNumber.trim(),
      policyWordingUrl: wordingUrl.trim(),
      sumAssuredPaise: toPaise(sumAssured),
      bonusPaise: toPaise(bonus),
      premiumPaise: toPaise(premium),
      premiumFrequency: frequency,
      startDate: startDate || null,
      renewalDate: renewalDate || null,
      maturityDate: kind === "life" ? (maturityDate || null) : null,
      nominee: nominee.trim(),
      coveredMembers: coveredMembers.map((m) => m.trim()).filter(Boolean),
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
        <>
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
          <Field label="Registration number">
            <input
              value={vehicleRegNo}
              onChange={(e) => setVehicleRegNo(e.target.value.toUpperCase())}
              className="input font-mono"
              placeholder="KA01AB1234"
            />
          </Field>
        </>
      )}
      {kind === "health" && (
        <Field label="Health plan type">
          <select value={healthType} onChange={(e) => setHealthType(e.target.value as HealthType | "")} className="input">
            <option value="">Not set</option>
            {HealthTypeSchema.options.map((h) => (
              <option key={h} value={h}>
                {HEALTH_LABELS[h]}
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
      <Field label={`${coverLabel(kind, kind === "health" ? healthType || null : null)} (₹)`}>
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
        <input value={nominee} onChange={(e) => setNominee(e.target.value)} className="input" placeholder="Who receives the benefit" />
      </Field>
      <div className="col-span-2 sm:col-span-3">
        <label className="mb-1 block text-xs font-medium text-slate-500">Covered members</label>
        <div className="space-y-2">
          {coveredMembers.map((m, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                value={m}
                onChange={(e) =>
                  setCoveredMembers((list) => list.map((x, j) => (j === i ? e.target.value : x)))
                }
                className="input flex-1"
                placeholder="Member name (e.g. self, spouse, child)"
              />
              <button
                type="button"
                onClick={() => setCoveredMembers((list) => list.filter((_, j) => j !== i))}
                className="shrink-0 rounded-md border border-slate-300 px-2 py-1.5 text-xs text-slate-500 hover:bg-slate-100"
                aria-label="Remove member"
              >
                ✕
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setCoveredMembers((list) => [...list, ""])}
            className="rounded-md border border-slate-300 px-3 py-1 text-xs text-slate-600 hover:bg-slate-100"
          >
            + Add member
          </button>
        </div>
      </div>
      <Field label="Policy wordings URL">
        <input
          type="url"
          value={wordingUrl}
          onChange={(e) => setWordingUrl(e.target.value)}
          className="input"
          placeholder="https://insurer.com/…/wordings.pdf"
        />
      </Field>
      <Field label="Notes">
        <input value={notes} onChange={(e) => setNotes(e.target.value)} className="input" placeholder="Optional" />
      </Field>
      <div className="col-span-2 flex gap-2 sm:col-span-3">
        <button type="submit" disabled={pending || name.trim() === ""} className="rounded-md bg-brand-600 px-4 py-1.5 text-sm text-white disabled:opacity-40">
          {pending ? "Saving…" : policy ? "Save changes" : "Add policy"}
        </button>
        <button type="button" onClick={onDone} className="rounded-md border border-slate-300 px-4 py-1.5 text-sm text-slate-600">
          Cancel
        </button>
      </div>
    </form>
  );
}
