export function Stub({ title, taskRef }: { title: string; taskRef: string }) {
  return (
    <div>
      <h1 className="text-2xl font-semibold text-slate-800">{title}</h1>
      <div className="mt-6 rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center">
        <p className="text-slate-500">This section is coming soon.</p>
        <p className="mt-1 text-sm text-slate-400">Planned in task {taskRef}.</p>
      </div>
    </div>
  );
}
