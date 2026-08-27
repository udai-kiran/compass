import { useState } from "react";
import { isExpandedByDefault } from "./json-tree.ts";

function primitiveColor(value: unknown): string {
  if (typeof value === "string") return "text-emerald-700";
  if (typeof value === "number") return "text-sky-700";
  if (typeof value === "boolean") return "text-amber-700";
  if (value === null) return "text-slate-400";
  return "text-slate-700";
}

interface NodeProps {
  label: string | null;
  value: unknown;
  depth: number;
}

function TreeNode({ label, value, depth }: NodeProps) {
  const isObject = typeof value === "object" && value !== null;
  const [open, setOpen] = useState(() => isExpandedByDefault(depth));

  if (!isObject) {
    return (
      <div className="flex gap-1 py-0.5 pl-4 font-mono text-xs">
        {label !== null && <span className="text-slate-500">{label}:</span>}
        <span className={`whitespace-pre-wrap break-words ${primitiveColor(value)}`}>
          {JSON.stringify(value)}
        </span>
      </div>
    );
  }

  const isArray = Array.isArray(value);
  const entries: Array<[string, unknown]> = isArray
    ? (value as unknown[]).map((v, i) => [String(i), v])
    : Object.entries(value as Record<string, unknown>);
  const summary = isArray ? `Array(${entries.length})` : `Object(${entries.length})`;

  if (entries.length === 0) {
    return (
      <div className="flex gap-1 py-0.5 pl-4 font-mono text-xs">
        {label !== null && <span className="text-slate-500">{label}:</span>}
        <span className="text-slate-400">{isArray ? "[]" : "{}"}</span>
      </div>
    );
  }

  return (
    <div className="font-mono text-xs">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex items-center gap-1 py-0.5 pl-4 text-left hover:bg-slate-100"
      >
        <span className="w-3 shrink-0 text-slate-400">{open ? "▾" : "▸"}</span>
        {label !== null && <span className="text-slate-500">{label}:</span>}
        <span className="text-slate-400">{summary}</span>
      </button>
      {open && (
        <div className="border-l border-slate-200 pl-3">
          {entries.map(([k, v]) => (
            <TreeNode key={k} label={isArray ? `[${k}]` : k} value={v} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Collapsible tree view of a parsed JSON value — used for the AI event log's
 *  request/response bodies so a nested extracted-entries payload (transactions,
 *  shopping items, tool-call args, ...) is browsable instead of one long
 *  pretty-printed blob. Nodes past DEFAULT_EXPAND_DEPTH start collapsed.
 *  Primitives render via JSON.stringify (correct quote/escape handling) with no
 *  truncation, so the tree never hides part of the recorded request/response —
 *  long strings wrap via whitespace-pre-wrap/break-words instead. */
export function JsonTree({ value }: { value: unknown }) {
  return <TreeNode label={null} value={value} depth={0} />;
}
