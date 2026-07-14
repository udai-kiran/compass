import { Suspense } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Navigate, NavLink, Outlet, useNavigate } from "react-router";
import { z } from "zod";
import { apiPost } from "../lib/api.ts";
import { useMe } from "../lib/auth.ts";
import { NotificationBell } from "../components/NotificationBell.tsx";
import { CommandPalette } from "../components/CommandPalette.tsx";
import { Assistant } from "../components/Assistant.tsx";

const NAV_SECTIONS = [
  { to: "/", label: "Dashboard" },
  { to: "/transactions", label: "Transactions" },
  { to: "/import", label: "Import" },
  { to: "/budgets", label: "Budgets" },
  { to: "/trends", label: "Trends" },
  { to: "/goals", label: "Goals" },
  { to: "/cash-flow", label: "Cash Flow" },
  { to: "/investments", label: "Investments" },
  { to: "/net-worth", label: "Net Worth" },
  { to: "/cards", label: "Credit Cards" },
  { to: "/emis", label: "EMIs & Loans" },
  { to: "/bills", label: "Bills & Subscriptions" },
  { to: "/insights", label: "Insights" },
  { to: "/reports", label: "Reports" },
  { to: "/settings", label: "Settings" },
];

export function AppLayout() {
  const { data: me, isLoading, isError } = useMe();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const logout = useMutation({
    mutationFn: () => apiPost("/api/auth/logout", z.object({ ok: z.boolean() })),
    onSuccess: async () => {
      queryClient.clear();
      await navigate("/login");
    },
  });

  if (isLoading) {
    return <div className="flex h-screen items-center justify-center text-slate-500">Loading…</div>;
  }
  if (isError || !me) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="flex h-screen bg-slate-100">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-slate-800 focus:px-3 focus:py-2 focus:text-sm focus:text-white"
      >
        Skip to content
      </a>
      <CommandPalette />
      <Assistant />
      <aside className="flex w-60 flex-col border-r border-slate-200 bg-white">
        <div className="flex h-14 items-center border-b border-slate-200 px-4 text-lg font-semibold text-slate-800">
          🧭 Compass
        </div>
        <nav aria-label="Primary" className="flex-1 space-y-0.5 overflow-y-auto p-2">
          {NAV_SECTIONS.map((s) => (
            <NavLink
              key={s.to}
              to={s.to}
              end={s.to === "/"}
              className={({ isActive }) =>
                `block rounded-md px-3 py-2 text-sm ${
                  isActive
                    ? "bg-slate-800 font-medium text-white"
                    : "text-slate-600 hover:bg-slate-100"
                }`
              }
            >
              {s.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="flex flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b border-slate-200 bg-white px-6">
          <button
            onClick={() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }))}
            className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-400 hover:bg-slate-50"
          >
            <span>Search…</span>
            <kbd className="rounded bg-slate-100 px-1.5 text-xs text-slate-500">⌘K</kbd>
          </button>
          <div className="flex items-center gap-4">
            <NotificationBell />
            <span className="text-sm text-slate-600">{me.displayName}</span>
            <button
              onClick={() => logout.mutate()}
              disabled={logout.isPending}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
            >
              Log out
            </button>
          </div>
        </header>
        <main id="main-content" className="flex-1 overflow-y-auto p-6">
          <Suspense
            fallback={<div className="text-sm text-slate-500">Loading…</div>}
          >
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
}
