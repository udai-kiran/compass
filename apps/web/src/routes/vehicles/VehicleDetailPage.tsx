import { useState } from "react";
import { Link, useParams } from "react-router";
import { formatDisplayDate, formatINR } from "@compass/shared";
import {
  useVehicleMutations,
  useVehicleSummary,
  useVehicleTransactionCandidates,
} from "../../lib/vehicle-queries.ts";
import { toast } from "../../lib/toast.tsx";
import { DateField } from "../../components/DateField.tsx";

const today = () => new Date().toISOString().slice(0, 10);

export function VehicleDetailPage() {
  const { resourceId } = useParams();
  const { data, isLoading } = useVehicleSummary(resourceId);

  if (isLoading) return <p className="p-6 text-sm text-slate-400">Loading…</p>;
  if (!data) {
    return (
      <div className="p-6">
        <p className="text-sm text-slate-500">That vehicle no longer exists.</p>
        <Link to="/resources" className="mt-2 inline-block text-sm text-slate-600 underline">
          Back to assets & connections
        </Link>
      </div>
    );
  }

  return <VehicleDetail resourceId={resourceId!} data={data} />;
}

function VehicleDetail({
  resourceId,
  data,
}: {
  resourceId: string;
  data: NonNullable<ReturnType<typeof useVehicleSummary>["data"]>;
}) {
  const { updateServiceConfig, markServiceDone, addReading, deleteReading } = useVehicleMutations(resourceId);

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <Link to="/resources" className="text-xs text-slate-500 underline">
        ‹ Back to assets & connections
      </Link>
      <header>
        <h1 className="text-lg font-medium text-slate-800">{data.name}</h1>
        <p className="text-xs text-slate-500">
          {data.currentOdometerKm !== null ? `${data.currentOdometerKm.toLocaleString("en-IN")} km` : "No odometer readings yet"}
        </p>
      </header>

      {data.serviceDue && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-medium text-amber-800">Service due</p>
          <p className="mt-1 text-xs text-amber-700">
            {[
              data.dueByKm && data.nextServiceOdometerKm !== null
                ? `by ${data.nextServiceOdometerKm.toLocaleString("en-IN")} km`
                : null,
              data.dueByTime && data.nextServiceDate !== null
                ? `by ${formatDisplayDate(data.nextServiceDate)}`
                : null,
            ]
              .filter(Boolean)
              .join(" or ")}
            {" — a reminder has been added to Tasks."}
          </p>
        </div>
      )}

      <ServiceConfigForm
        resourceId={resourceId}
        config={data.config}
        currentOdometerKm={data.currentOdometerKm}
        onSave={(body) => updateServiceConfig.mutate(body, { onSuccess: () => toast("Service settings saved", "success") })}
        onMarkDone={(body) => markServiceDone.mutate(body, { onSuccess: () => toast("Service recorded", "success") })}
        saving={updateServiceConfig.isPending || markServiceDone.isPending}
      />

      <ReadingForm
        resourceId={resourceId}
        currentOdometerKm={data.currentOdometerKm}
        onAdd={(body) => addReading.mutate(body, { onSuccess: () => toast("Odometer reading added", "success") })}
        saving={addReading.isPending}
      />

      <MileageSection data={data} onDelete={(id) => deleteReading.mutate(id)} />
    </div>
  );
}

function ServiceConfigForm({
  config,
  currentOdometerKm,
  onSave,
  onMarkDone,
  saving,
}: {
  resourceId: string;
  config: NonNullable<ReturnType<typeof useVehicleSummary>["data"]>["config"];
  currentOdometerKm: number | null;
  onSave: (body: { serviceIntervalKm: number | null; serviceIntervalMonths: number | null }) => void;
  onMarkDone: (body: { odometerKm: number; serviceDate: string }) => void;
  saving: boolean;
}) {
  const [intervalKm, setIntervalKm] = useState(config.serviceIntervalKm?.toString() ?? "");
  const [intervalMonths, setIntervalMonths] = useState(config.serviceIntervalMonths?.toString() ?? "");

  function save() {
    onSave({
      serviceIntervalKm: intervalKm.trim() === "" ? null : Number(intervalKm),
      serviceIntervalMonths: intervalMonths.trim() === "" ? null : Number(intervalMonths),
    });
  }

  function markDone() {
    if (currentOdometerKm === null) {
      toast("Add an odometer reading first", "error");
      return;
    }
    onMarkDone({ odometerKm: currentOdometerKm, serviceDate: today() });
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-700">Service schedule</h2>
      <p className="mt-1 text-xs text-slate-500">
        Reminds "whichever comes first" — set either interval, or both.
      </p>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <label className="text-xs text-slate-500">
          Every (km)
          <input
            type="number"
            min={1}
            value={intervalKm}
            onChange={(e) => setIntervalKm(e.target.value)}
            placeholder="e.g. 5000"
            className="input mt-1 w-full"
          />
        </label>
        <label className="text-xs text-slate-500">
          Every (months)
          <input
            type="number"
            min={1}
            value={intervalMonths}
            onChange={(e) => setIntervalMonths(e.target.value)}
            placeholder="e.g. 6"
            className="input mt-1 w-full"
          />
        </label>
      </div>
      <p className="mt-2 text-xs text-slate-400">
        Last service: {config.lastServiceOdometerKm !== null ? `${config.lastServiceOdometerKm.toLocaleString("en-IN")} km` : "—"}
        {config.lastServiceDate ? ` on ${formatDisplayDate(config.lastServiceDate)}` : ""}
      </p>
      <div className="mt-3 flex gap-2">
        <button disabled={saving} onClick={save} className="rounded-md bg-brand-600 px-3 py-1.5 text-xs text-white disabled:opacity-50">
          Save schedule
        </button>
        <button disabled={saving} onClick={markDone} className="rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50">
          Mark serviced today
        </button>
      </div>
    </section>
  );
}

function ReadingForm({
  resourceId,
  currentOdometerKm,
  onAdd,
  saving,
}: {
  resourceId: string;
  currentOdometerKm: number | null;
  onAdd: (body: { odometerKm: number; readingDate: string; transactionId: string | null; notes: string }) => void;
  saving: boolean;
}) {
  const [odometerKm, setOdometerKm] = useState("");
  const [readingDate, setReadingDate] = useState(today());
  const [transactionId, setTransactionId] = useState("");
  const { data: candidates } = useVehicleTransactionCandidates(resourceId, readingDate);

  function submit() {
    const km = Number(odometerKm);
    if (!Number.isFinite(km) || km < 0) {
      toast("Enter a valid odometer reading", "error");
      return;
    }
    onAdd({ odometerKm: km, readingDate, transactionId: transactionId || null, notes: "" });
    setOdometerKm("");
    setTransactionId("");
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-700">Log odometer reading</h2>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="text-xs text-slate-500">
          Odometer (km)
          <input
            type="number"
            min={currentOdometerKm ?? 0}
            value={odometerKm}
            onChange={(e) => setOdometerKm(e.target.value)}
            placeholder={currentOdometerKm !== null ? `≥ ${currentOdometerKm}` : "e.g. 24500"}
            className="input mt-1 w-full"
          />
        </label>
        <label className="text-xs text-slate-500">
          Date
          <DateField value={readingDate} onChange={setReadingDate} className="mt-1 w-full" />
        </label>
        <label className="text-xs text-slate-500 sm:col-span-2">
          Link a spend (optional — powers the fuel-economy figures below)
          <select value={transactionId} onChange={(e) => setTransactionId(e.target.value)} className="input mt-1 w-full">
            <option value="">Not linked to a spend</option>
            {candidates?.map((c) => (
              <option key={c.id} value={c.id}>
                {formatDisplayDate(c.date)} · {c.merchant || "—"} · {formatINR(c.amountPaise)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <button disabled={saving} onClick={submit} className="mt-3 rounded-md bg-brand-600 px-3 py-1.5 text-xs text-white disabled:opacity-50">
        Add reading
      </button>
    </section>
  );
}

function MileageSection({
  data,
  onDelete,
}: {
  data: NonNullable<ReturnType<typeof useVehicleSummary>["data"]>;
  onDelete: (id: string) => void;
}) {
  if (data.readings.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-400">
        No odometer readings yet.
      </p>
    );
  }

  // intervals are oldest-to-newest; show newest-first to match the readings list.
  const intervalByToId = new Map(data.intervals.map((i) => [i.toReadingId, i]));

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-700">Readings & fuel economy</h2>
      <p className="mt-1 text-xs text-slate-500">
        Economy is km covered per ₹100 spent on the fuel-up that opened each interval — never litres,
        since that's rarely what a receipt states.
      </p>
      <ul className="mt-3 divide-y divide-slate-100">
        {data.readings.map((reading) => {
          const interval = intervalByToId.get(reading.id);
          return (
            <li key={reading.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <div>
                <p className="font-medium text-slate-800">{reading.odometerKm.toLocaleString("en-IN")} km</p>
                <p className="text-xs text-slate-500">
                  {formatDisplayDate(reading.readingDate)}
                  {reading.amountPaise !== null ? ` · ${formatINR(reading.amountPaise)} spent` : ""}
                  {interval ? ` · ${interval.kmDriven} km since previous` : ""}
                  {interval?.kmPer100Rupees !== null && interval?.kmPer100Rupees !== undefined
                    ? ` · ${interval.kmPer100Rupees.toFixed(1)} km/₹100`
                    : ""}
                </p>
              </div>
              <button
                onClick={() => {
                  if (confirm("Delete this odometer reading?")) onDelete(reading.id);
                }}
                className="shrink-0 text-xs text-rose-600 underline"
              >
                Delete
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
