import { useQuery } from "@tanstack/react-query";
import { HealthStatusSchema, type BuildInfo } from "@compass/shared";
import { apiGet } from "../../lib/api.ts";
import { buildInfo, shortSha } from "../../lib/build-info.ts";

function Dot({ ok }: { ok: boolean }) {
  return (
    <span
      className={`inline-block h-2.5 w-2.5 rounded-full ${ok ? "bg-emerald-500" : "bg-red-500"}`}
      aria-hidden="true"
    />
  );
}

function StatusRow({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between py-1.5 text-sm">
      <span className="text-slate-600">{label}</span>
      <span className="flex items-center gap-2 font-medium text-slate-700">
        <Dot ok={ok} />
        {ok ? "OK" : "Down"}
      </span>
    </div>
  );
}

function BuildCard({ title, build }: { title: string; build: BuildInfo }) {
  const built = build.builtAt ? new Date(build.builtAt) : null;
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-700">{title}</h2>
      <dl className="mt-3 space-y-2 text-sm">
        <div className="flex items-center justify-between">
          <dt className="text-slate-500">Version</dt>
          <dd className="font-mono font-medium text-slate-800">{build.version}</dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-slate-500">Commit</dt>
          <dd className="font-mono text-slate-700">{shortSha(build.gitSha)}</dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-slate-500">Built</dt>
          <dd className="text-slate-700">
            {built ? built.toLocaleString() : <span className="text-slate-400">—</span>}
          </dd>
        </div>
      </dl>
    </section>
  );
}

export function StatusPage() {
  // Public endpoint; refetch every 30s so the page doubles as a live health view.
  const { data, isLoading, isError } = useQuery({
    queryKey: ["health"],
    queryFn: () => apiGet("/health", HealthStatusSchema),
    refetchInterval: 30_000,
  });

  const apiOk = data?.ok ?? false;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold text-slate-800">Status</h1>
        {!isLoading && (
          <span
            className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
              apiOk ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
            }`}
          >
            {apiOk ? "All systems operational" : "Degraded"}
          </span>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <BuildCard title="Web app" build={buildInfo} />
        {data && <BuildCard title="API" build={data.build} />}
      </div>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-700">Services</h2>
        {isLoading && <p className="mt-2 text-sm text-slate-400">Checking…</p>}
        {isError && <p className="mt-2 text-sm text-red-600">Could not reach the API.</p>}
        {data && (
          <div className="mt-2 divide-y divide-slate-100">
            <StatusRow label="API" ok={data.ok} />
            <StatusRow label="PostgreSQL" ok={data.postgres} />
            <StatusRow label="Redis" ok={data.redis} />
          </div>
        )}
      </section>
    </div>
  );
}
