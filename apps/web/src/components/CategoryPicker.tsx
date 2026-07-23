import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Category } from "@compass/shared";

/**
 * A category selector that mirrors the Settings tree: type to search, or browse
 * the parent → child hierarchy (parents as headers, children indented). Replaces
 * the flat native <select>s, which are hard to scan and impossible to search.
 *
 * Controlled: `value` is the selected category id (or null), `onChange` fires with
 * the picked id — or null when `emptyLabel` is set and the empty row is chosen.
 */
export interface CategoryPickerProps {
  categories: Category[];
  value: string | null;
  onChange: (id: string | null) => void;
  /** restrict to one kind (e.g. only expense categories on a debit) */
  kind?: Category["kind"];
  /** button text when nothing is selected */
  placeholder?: string;
  /** when set, a first row that clears the selection (e.g. "All categories") */
  emptyLabel?: string;
  className?: string;
  disabled?: boolean;
  /** open the popover on mount (used by the inline click-to-edit cell) */
  defaultOpen?: boolean;
  /** fired whenever the popover closes — lets an inline editor exit edit mode */
  onClose?: () => void;
}

/** Fixed-position coordinates for the portalled popover, anchored to the trigger button. */
interface PopoverPos {
  left: number;
  width: number;
  placement: "above" | "below";
  top?: number;
  bottom?: number;
}

const POPOVER_MIN_WIDTH = 256; // 16rem
const POPOVER_FLIP_THRESHOLD = 300;

interface Flat {
  id: string;
  name: string;
  depth: number;
  /** "Food" or "Food › Dining" — shown in search results for disambiguation */
  path: string;
  isParent: boolean;
}

/** Ordered visible rows: roots then their children, honouring sortOrder. */
function buildTree(cats: Category[]): Flat[] {
  // `cats` has already been filtered (kind mismatch / archived); a category
  // whose parent got filtered out is an orphan. Treat it as a root (depth 0)
  // rather than dropping it, so an active child is never unreachable just
  // because its parent was archived.
  const visibleIds = new Set(cats.map((c) => c.id));
  const byParent = new Map<string | null, Category[]>();
  for (const c of cats) {
    const key = c.parentId && visibleIds.has(c.parentId) ? c.parentId : null;
    (byParent.get(key) ?? byParent.set(key, []).get(key)!).push(c);
  }
  const sort = (a: Category, b: Category) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);
  const out: Flat[] = [];
  const walk = (parentId: string | null, depth: number, prefix: string) => {
    for (const c of (byParent.get(parentId) ?? []).sort(sort)) {
      const path = prefix ? `${prefix} › ${c.name}` : c.name;
      out.push({ id: c.id, name: c.name, depth, path, isParent: (byParent.get(c.id)?.length ?? 0) > 0 });
      walk(c.id, depth + 1, path);
    }
  };
  walk(null, 0, "");
  return out;
}

export function CategoryPicker({
  categories,
  value,
  onChange,
  kind,
  placeholder = "Select category…",
  emptyLabel,
  className = "",
  disabled = false,
  defaultOpen = false,
  onClose,
}: CategoryPickerProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<PopoverPos | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const close = () => {
    setOpen(false);
    onClose?.();
  };

  // The selected value must always be resolvable, even if archived — so keep the
  // selected row visible while hiding other archived categories from the list.
  const visible = useMemo(
    () => categories.filter((c) => (!kind || c.kind === kind) && (!c.archivedAt || c.id === value)),
    [categories, kind, value],
  );
  const tree = useMemo(() => buildTree(visible), [visible]);
  const selected = tree.find((f) => f.id === value) ?? null;

  const q = query.trim().toLowerCase();
  // When searching, flatten to matches (with their breadcrumb path); otherwise
  // show the indented tree. `null` rows carry the optional clear-selection entry.
  const rows: Array<Flat | null> = useMemo(() => {
    const base = q ? tree.filter((f) => f.path.toLowerCase().includes(q)) : tree;
    return emptyLabel && !q ? [null, ...base] : base;
  }, [tree, q, emptyLabel]);

  useEffect(() => setActive(0), [query]);

  // The popover renders through a portal (see below) so it can escape any
  // overflow:auto/virtualized ancestor; position it against the trigger
  // button's viewport rect instead of relying on CSS `absolute`.
  useLayoutEffect(() => {
    if (!open) return;
    const computePosition = () => {
      const btn = triggerRef.current;
      if (!btn) return;
      const rect = btn.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const width = Math.min(Math.max(rect.width, POPOVER_MIN_WIDTH), vw * 0.9);
      const left = Math.min(Math.max(rect.left, 8), Math.max(8, vw - width - 8));
      const spaceBelow = vh - rect.bottom;
      const spaceAbove = rect.top;
      const placement: "above" | "below" =
        spaceBelow < POPOVER_FLIP_THRESHOLD && spaceAbove > spaceBelow ? "above" : "below";
      setPos(
        placement === "below"
          ? { left, width, placement, top: rect.bottom + 4 }
          : { left, width, placement, bottom: vh - rect.top + 4 },
      );
    };
    computePosition();
    // Closing on scroll/resize is simpler and safer than tracking every
    // ancestor's scroll offset — capture phase so scrolling the virtualized
    // list (which doesn't bubble a window "scroll" event) still triggers it.
    const onScrollOrResize = () => close();
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [open]);

  // Close on outside click / Escape. The popover content lives in a portal
  // (outside `rootRef`), so a click inside either the trigger wrapper or the
  // portalled popover counts as "inside".
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      const insideRoot = rootRef.current?.contains(target) ?? false;
      const insidePopover = popoverRef.current?.contains(target) ?? false;
      if (!insideRoot && !insidePopover) close();
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
    else setQuery("");
  }, [open]);

  const pick = (row: Flat | null) => {
    onChange(row ? row.id : null);
    close();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, rows.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (rows.length > 0) pick(rows[Math.min(active, rows.length - 1)] ?? null);
    } else if (e.key === "Escape") {
      close();
    }
  };

  const buttonLabel = selected ? selected.name : emptyLabel ?? placeholder;

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => (open ? close() : setOpen(true))}
        className="flex w-full items-center justify-between gap-1 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-left text-sm disabled:opacity-50"
      >
        <span className={selected ? "truncate" : "truncate text-slate-400"}>{buttonLabel}</span>
        <svg viewBox="0 0 20 20" className="h-4 w-4 shrink-0 text-slate-400" fill="currentColor">
          <path d="M5.5 7.5 10 12l4.5-4.5" stroke="currentColor" strokeWidth="1.5" fill="none" />
        </svg>
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            ref={popoverRef}
            style={{
              position: "fixed",
              left: pos.left,
              width: pos.width,
              ...(pos.placement === "below" ? { top: pos.top } : { bottom: pos.bottom }),
            }}
            className="z-50 max-h-72 overflow-hidden rounded-md border border-slate-200 bg-white shadow-lg"
          >
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Search categories…"
              className="w-full border-b border-slate-200 px-3 py-2 text-sm outline-none"
            />
            <ul className="max-h-60 overflow-y-auto py-1">
              {rows.length === 0 && (
                <li className="px-3 py-2 text-sm text-slate-400">No matches</li>
              )}
              {rows.map((row, i) => {
                const isActive = i === active;
                const isSel = row ? row.id === value : value === null;
                return (
                  <li key={row ? row.id : "__empty__"}>
                    <button
                      type="button"
                      onMouseEnter={() => setActive(i)}
                      onClick={() => pick(row)}
                      style={row && !q ? { paddingLeft: `${0.75 + row.depth * 1}rem` } : undefined}
                      className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-sm ${
                        isActive ? "bg-brand-50" : ""
                      } ${isSel ? "font-medium text-brand-700" : "text-slate-700"}`}
                    >
                      <span className="truncate">
                        {row === null ? (
                          <span className="text-slate-500">{emptyLabel}</span>
                        ) : q ? (
                          // In search results, show the full path so same-named
                          // children under different parents stay distinguishable.
                          <span>
                            {row.path.includes("›") && (
                              <span className="text-slate-400">
                                {row.path.slice(0, row.path.lastIndexOf("›") + 1)}{" "}
                              </span>
                            )}
                            {row.name}
                          </span>
                        ) : (
                          <span className={row.isParent && row.depth === 0 ? "font-medium" : ""}>{row.name}</span>
                        )}
                      </span>
                      {isSel && (
                        <svg viewBox="0 0 20 20" className="h-4 w-4 shrink-0 text-brand-600" fill="currentColor">
                          <path d="m5 10 3.5 3.5L15 7" stroke="currentColor" strokeWidth="1.75" fill="none" />
                        </svg>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>,
          document.body,
        )}
    </div>
  );
}
