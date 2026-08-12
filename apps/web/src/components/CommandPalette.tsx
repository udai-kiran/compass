import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { formatDisplayDate, formatINR, SearchResultsSchema } from "@compass/shared";
import { z } from "zod";
import { apiGet } from "../lib/api.ts";

const PAGES: Array<{ label: string; to: string }> = [
  { label: "Dashboard", to: "/" },
  { label: "Transactions", to: "/transactions" },
  { label: "Import", to: "/import" },
  { label: "Budgets", to: "/budgets" },
  { label: "Trends", to: "/trends" },
  { label: "Goals", to: "/goals" },
  { label: "SIPs", to: "/sips" },
  { label: "Cash Flow", to: "/cash-flow" },
  { label: "Investments", to: "/investments" },
  { label: "Net Worth", to: "/net-worth" },
  { label: "Credit Cards", to: "/cards" },
  { label: "EMIs & Loans", to: "/emis" },
  { label: "Bills & Subscriptions", to: "/bills" },
  { label: "Insights", to: "/insights" },
  { label: "Reports", to: "/reports" },
  { label: "Notifications", to: "/notifications" },
  { label: "Settings", to: "/settings" },
];

type Item = { key: string; group: string; label: string; hint?: string; to: string };

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) {
      setQ("");
      setSel(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const { data: results } = useQuery({
    queryKey: ["search", q],
    queryFn: () => apiGet(`/api/search?q=${encodeURIComponent(q)}`, SearchResultsSchema),
    enabled: open && q.trim().length >= 2,
  });
  const { data: recent } = useQuery({
    queryKey: ["search-recent"],
    queryFn: () => apiGet("/api/search/recent", z.array(z.string())),
    enabled: open,
  });

  const items = useMemo<Item[]>(() => {
    const term = q.trim().toLowerCase();
    const pages = PAGES.filter((p) => !term || p.label.toLowerCase().includes(term)).map((p) => ({
      key: `page:${p.to}`,
      group: "Pages",
      label: p.label,
      to: p.to,
    }));
    const out: Item[] = [...pages];
    if (results) {
      for (const t of results.transactions)
        out.push({ key: `tx:${t.id}`, group: "Transactions", label: t.merchant || "(no merchant)", hint: `${formatDisplayDate(t.date)} · ${formatINR(t.amountPaise)}`, to: `/transactions?q=${encodeURIComponent(t.merchant)}` });
      for (const c of results.categories)
        out.push({ key: `cat:${c.id}`, group: "Categories", label: c.name, to: `/transactions?categoryId=${c.id}` });
      for (const a of results.accounts)
        out.push({ key: `acc:${a.id}`, group: "Accounts", label: a.name, to: `/transactions?accountId=${a.id}` });
      for (const g of results.goals) out.push({ key: `goal:${g.id}`, group: "Goals", label: g.name, to: `/goals` });
    }
    return out;
  }, [q, results]);

  useEffect(() => setSel(0), [q, items.length]);

  if (!open) return null;

  function go(item: Item) {
    setOpen(false);
    void navigate(item.to);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(items.length - 1, s + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
    else if (e.key === "Enter" && items[sel]) { e.preventDefault(); go(items[sel]); }
  }

  let idx = -1;
  const groups = [...new Set(items.map((i) => i.group))];

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/30 pt-24" onClick={() => setOpen(false)}>
      <div className="w-full max-w-xl overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Search transactions, pages, accounts…"
          className="w-full border-b border-slate-200 px-4 py-3 text-sm outline-none"
        />
        <div className="max-h-96 overflow-y-auto p-2">
          {q.trim().length < 2 && recent && recent.length > 0 && (
            <div className="mb-2">
              <p className="px-2 py-1 text-xs font-medium text-slate-400">Recent searches</p>
              {recent.map((rq) => (
                <button key={rq} onClick={() => setQ(rq)} className="block w-full rounded-md px-2 py-1.5 text-left text-sm text-slate-600 hover:bg-slate-100">
                  {rq}
                </button>
              ))}
            </div>
          )}
          {groups.map((group) => (
            <div key={group} className="mb-1">
              <p className="px-2 py-1 text-xs font-medium text-slate-400">{group}</p>
              {items.filter((i) => i.group === group).map((item) => {
                idx += 1;
                const active = idx === sel;
                return (
                  <button
                    key={item.key}
                    onMouseEnter={() => setSel(items.indexOf(item))}
                    onClick={() => go(item)}
                    className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm ${active ? "bg-brand-600 text-white" : "text-slate-700 hover:bg-slate-100"}`}
                  >
                    <span className="truncate">{item.label}</span>
                    {item.hint && <span className={`ml-2 shrink-0 text-xs ${active ? "text-slate-300" : "text-slate-400"}`}>{item.hint}</span>}
                  </button>
                );
              })}
            </div>
          ))}
          {items.length === 0 && <p className="px-2 py-6 text-center text-sm text-slate-400">No matches.</p>}
        </div>
        <div className="border-t border-slate-100 px-4 py-2 text-xs text-slate-400">
          ↑↓ navigate · ↵ open · esc close
        </div>
      </div>
    </div>
  );
}
