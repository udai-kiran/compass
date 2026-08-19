import { useState } from "react";
import { type AiEventKind, type AiEventSummary } from "@compass/shared";
import { useAiEvents, useAiEvent } from "../../lib/ai-event-queries.ts";

const KIND_LABELS: Record<AiEventKind, string> = {
  email_extract: "Email extracted",
  statement_parse: "Statement parsed",
  statement_summary: "Statement summary",
  categorize: "Categorize",
  summary: "Monthly summary",
  assistant: "Assistant",
  goal_roadmap: "Goal roadmap",
};

const FILTERS: Array<{ id: AiEventKind | "all"; label: string }> = [
  { id: "all", label: "All" },
  { id: "email_extract", label: "Email" },
  { id: "statement_parse", label: "Statements" },
  { id: "statement_summary", label: "Summaries" },
  { id: "categorize", label: "Categorize" },
  { id: "summary", label: "Monthly" },
  { id: "assistant", label: "Assistant" },
  { id: "goal_roadmap", label: "Roadmap" },
];

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function EventLogPage() {
  const [kind, setKind] = useState<AiEventKind | "all">("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const query = useAiEvents(kind);
  const events = query.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="flex h-full flex-col">
      <div className="mb-3">
        <h1 className="text-2xl font-semibold text-slate-800">Event Log</h1>
        <p className="mt-1 text-sm text-slate-500">
          Every AI call — the exact context sent to the model and the raw response. Emails send
          only the subject, sender, and stripped body; never the full headers.
        </p>
      </div>

      <div className="mb-3 flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setKind(f.id)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition ${
              kind === f.id
                ? "bg-brand-600 text-white"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {query.isLoading ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : events.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
          No AI events yet. They appear here as emails are ingested and AI features are used.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <ul className="divide-y divide-slate-100">
            {events.map((e) => (
              <EventRow key={e.id} event={e} onOpen={() => setOpenId(e.id)} />
            ))}
          </ul>
          {query.hasNextPage && (
            <div className="border-t border-slate-100 p-2 text-center">
              <button
                onClick={() => query.fetchNextPage()}
                disabled={query.isFetchingNextPage}
                className="rounded-md border border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                {query.isFetchingNextPage ? "Loading…" : "Load more"}
              </button>
            </div>
          )}
        </div>
      )}

      {openId && <EventDrawer id={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function EventRow({ event, onOpen }: { event: AiEventSummary; onOpen: () => void }) {
  return (
    <li>
      <button
        onClick={onOpen}
        className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-slate-50"
      >
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${event.status === "ok" ? "bg-emerald-500" : "bg-rose-500"}`}
          title={event.status}
        />
        <span className="w-32 shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-center text-[11px] font-medium text-slate-600">
          {KIND_LABELS[event.kind]}
        </span>
        <span className="min-w-0 flex-1 truncate text-slate-700">{event.title || "—"}</span>
        <span className="hidden shrink-0 text-xs text-slate-400 sm:inline">
          {[event.provider, event.model].filter(Boolean).join(" · ")}
        </span>
        <span className="w-28 shrink-0 text-right text-xs text-slate-400">{fmtTime(event.createdAt)}</span>
      </button>
    </li>
  );
}

function EventDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, isLoading } = useAiEvent(id);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-2xl flex-col bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h2 className="text-base font-semibold text-slate-800">
            {data ? KIND_LABELS[data.kind] : "Event"}
          </h2>
          <button onClick={onClose} aria-label="Close" className="rounded-md p-1 text-slate-400 hover:bg-slate-100">
            ✕
          </button>
        </div>

        {isLoading || !data ? (
          <p className="p-5 text-sm text-slate-400">Loading…</p>
        ) : (
          <div className="flex-1 space-y-4 overflow-y-auto p-5">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
              <Meta label="Status" value={data.status === "ok" ? "OK" : "Error"} />
              <Meta label="When" value={fmtTime(data.createdAt)} />
              <Meta label="Provider" value={data.provider || "—"} />
              <Meta label="Model" value={data.model || "—"} />
              <Meta label="Latency" value={data.latencyMs !== null ? `${data.latencyMs} ms` : "—"} />
              <Meta label="Title" value={data.title || "—"} />
            </dl>

            {data.error && (
              <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
                {data.error}
              </div>
            )}

            <Block title="Context sent to the model" body={data.requestContext} empty="Nothing recorded." />
            <Block title="Response received" body={data.responseRaw} empty="No response (call failed)." />
          </div>
        )}
      </div>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="text-slate-400">{label}</dt>
      <dd className="min-w-0 truncate font-medium text-slate-700">{value}</dd>
    </div>
  );
}

function Block({ title, body, empty }: { title: string; body: string; empty: string }) {
  return (
    <div>
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
      <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
        {body || empty}
      </pre>
    </div>
  );
}
