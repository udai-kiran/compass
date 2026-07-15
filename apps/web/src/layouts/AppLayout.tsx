import { Suspense, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, Navigate, NavLink, Outlet, useNavigate } from "react-router";
import { z } from "zod";
import { apiPost } from "../lib/api.ts";
import { buildInfo } from "../lib/build-info.ts";
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

function VersionFooter({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <Link
      to="/status"
      onClick={onNavigate}
      className="block border-t border-slate-200 px-4 py-2 text-xs text-slate-400 hover:bg-slate-50 hover:text-slate-600"
      title={`Build ${buildInfo.version} · ${buildInfo.gitSha}`}
    >
      {buildInfo.version} · Status
    </Link>
  );
}

function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav aria-label="Primary" className="flex-1 space-y-0.5 overflow-y-auto p-2">
      {NAV_SECTIONS.map((s) => (
        <NavLink
          key={s.to}
          to={s.to}
          end={s.to === "/"}
          onClick={onNavigate}
          className={({ isActive }) =>
            `block rounded-md px-3 py-2 text-sm ${
              isActive ? "bg-slate-800 font-medium text-white" : "text-slate-600 hover:bg-slate-100"
            }`
          }
        >
          {s.label}
        </NavLink>
      ))}
    </nav>
  );
}

export function AppLayout() {
  const { data: me, isLoading, isError } = useMe();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

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
      {/* Desktop sidebar — persistent from md up */}
      <aside className="hidden w-60 flex-col border-r border-slate-200 bg-white md:flex">
        <div className="flex h-14 items-center border-b border-slate-200 px-4 text-lg font-semibold text-slate-800">
          🧭 Compass
        </div>
        <SidebarNav />
        <VersionFooter />
      </aside>

      {/* Mobile slide-over drawer + backdrop — below md only */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true">
          <div
            className="absolute inset-0 bg-slate-900/40"
            onClick={() => setMobileNavOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 flex w-64 flex-col border-r border-slate-200 bg-white shadow-xl">
            <div className="flex h-14 items-center justify-between border-b border-slate-200 px-4 text-lg font-semibold text-slate-800">
              <span>🧭 Compass</span>
              <button
                onClick={() => setMobileNavOpen(false)}
                aria-label="Close navigation"
                className="rounded-md p-1 text-slate-400 hover:bg-slate-100"
              >
                ✕
              </button>
            </div>
            <SidebarNav onNavigate={() => setMobileNavOpen(false)} />
            <VersionFooter onNavigate={() => setMobileNavOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b border-slate-200 bg-white px-4 sm:px-6">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setMobileNavOpen(true)}
              aria-label="Open navigation"
              className="rounded-md border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50 md:hidden"
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path
                  d="M3 5h14M3 10h14M3 15h14"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                />
              </svg>
            </button>
            <button
              onClick={() =>
                window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }))
              }
              className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-400 hover:bg-slate-50"
            >
              <span>Search…</span>
              <kbd className="hidden rounded bg-slate-100 px-1.5 text-xs text-slate-500 sm:inline">
                ⌘K
              </kbd>
            </button>
          </div>
          <div className="flex items-center gap-4">
            <NotificationBell />
            <span className="hidden text-sm text-slate-600 sm:inline">{me.displayName}</span>
            <button
              onClick={() => logout.mutate()}
              disabled={logout.isPending}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
            >
              Log out
            </button>
          </div>
        </header>
        <main id="main-content" className="flex-1 overflow-y-auto p-4 sm:p-6">
          <Suspense fallback={<div className="text-sm text-slate-500">Loading…</div>}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
}
