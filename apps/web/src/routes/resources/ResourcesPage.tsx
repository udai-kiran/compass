import { useState, type FormEvent } from "react";
import type { ResourceKind } from "@compass/shared";
import { toast } from "../../lib/toast.tsx";
import { useResourceMutations, useResources } from "../../lib/resource-queries.ts";

const KINDS: Array<{ value: ResourceKind; label: string; identifier: string }> = [
  { value: "vehicle", label: "Vehicle", identifier: "Registration number" },
  { value: "electricity", label: "Electricity", identifier: "Consumer number" },
  { value: "mobile", label: "Mobile", identifier: "Mobile number" },
  { value: "internet", label: "Internet", identifier: "Account number" },
  { value: "gas", label: "Gas", identifier: "Consumer number" },
  { value: "water", label: "Water", identifier: "Connection number" },
  { value: "other", label: "Other", identifier: "Identifier" },
];

export function ResourcesPage() {
  const { data: resources } = useResources();
  const { create, update, remove } = useResourceMutations();
  const [kind, setKind] = useState<ResourceKind>("vehicle");
  const [name, setName] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [provider, setProvider] = useState("");
  const [planName, setPlanName] = useState("");
  const meta = KINDS.find((item) => item.value === kind)!;

  function submit(event: FormEvent) {
    event.preventDefault();
    create.mutate(
      { kind, name, identifier, provider, planName, details: "" },
      {
        onSuccess: () => {
          setName("");
          setIdentifier("");
          setProvider("");
          setPlanName("");
          toast("Asset or connection added", "success");
        },
      },
    );
  }

  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-800">Assets & Connections</h1>
      <p className="mt-1 text-sm text-slate-500">
        Identify the vehicle or service behind a transaction, bill, or subscription.
      </p>

      <form onSubmit={submit} className="mt-5 grid gap-3 rounded-xl border border-slate-200 bg-white p-4 md:grid-cols-6">
        <select value={kind} onChange={(e) => setKind(e.target.value as ResourceKind)} className="input">
          {KINDS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
        <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Friendly name" className="input" />
        <input value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder={meta.identifier} className="input" />
        <input value={provider} onChange={(e) => setProvider(e.target.value)} placeholder={kind === "vehicle" ? "Manufacturer" : "Provider"} className="input" />
        <input value={planName} onChange={(e) => setPlanName(e.target.value)} placeholder={kind === "vehicle" ? "Model / fuel type" : "Plan name"} className="input" />
        <button disabled={create.isPending} className="rounded-md bg-brand-600 px-3 py-2 text-sm text-white disabled:opacity-50">Add</button>
      </form>

      <div className="mt-6 space-y-6">
        {KINDS.map((group) => {
          const rows = resources?.filter((item) => item.kind === group.value) ?? [];
          if (rows.length === 0) return null;
          return (
            <section key={group.value}>
              <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">{group.label}</h2>
              <div className="mt-2 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {rows.map((item) => (
                  <article key={item.id} className={`rounded-xl border border-slate-200 bg-white p-4 ${item.archived ? "opacity-50" : ""}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="truncate font-medium text-slate-800">{item.name}</h3>
                        <p className="mt-1 text-sm text-slate-500">
                          {[item.provider, item.identifier, item.planName].filter(Boolean).join(" · ") || "No details yet"}
                        </p>
                      </div>
                      <span className="badge bg-slate-100 text-slate-600">{group.label}</span>
                    </div>
                    <div className="mt-4 flex gap-3 text-xs">
                      <button className="text-slate-500 underline" onClick={() => update.mutate({ id: item.id, archived: !item.archived })}>
                        {item.archived ? "Restore" : "Archive"}
                      </button>
                      <button className="text-rose-600 underline" onClick={() => {
                        if (confirm(`Delete ${item.name}? Existing links will be detached.`)) remove.mutate(item.id);
                      }}>Delete</button>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          );
        })}
        {resources?.length === 0 && <p className="rounded-xl border border-dashed border-slate-300 p-10 text-center text-sm text-slate-400">Add your first vehicle or connection above.</p>}
      </div>
    </div>
  );
}
