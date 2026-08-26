import { Suspense, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, Navigate, NavLink, Outlet, useNavigate } from "react-router";
import { z } from "zod";
import { apiPost } from "../lib/api.ts";
import { buildInfo, relativeBuildTime, shortSha } from "../lib/build-info.ts";
import { useMe } from "../lib/auth.ts";
import { useInboxCount } from "../lib/inbox-queries.ts";
import { useDraftCount } from "../lib/shopping-queries.ts";
import { NotificationBell } from "../components/NotificationBell.tsx";
import { CommandPalette } from "../components/CommandPalette.tsx";
import { Assistant } from "../components/Assistant.tsx";
import { ThemeSelect } from "../components/ThemeSelect.tsx";
import { Icon, type IconName } from "../components/icons.tsx";

interface NavItem {
  to: string;
  label: string;
  icon: IconName;
}
interface NavGroup {
  heading: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    heading: "Overview",
    items: [
      { to: "/", label: "Dashboard", icon: "dashboard" },
      { to: "/inbox", label: "Inbox", icon: "inbox" },
      { to: "/transactions", label: "Transactions", icon: "transactions" },
    ],
  },
  {
    heading: "Money",
    items: [
      { to: "/accounts", label: "Accounts", icon: "wallet" },
      { to: "/budgets", label: "Budgets", icon: "budgets" },
      { to: "/cash-flow", label: "Cash Flow", icon: "cashflow" },
      { to: "/bills", label: "Bills & Subscriptions", icon: "bills" },
      { to: "/resources", label: "Assets & Connections", icon: "wallet" },
      { to: "/cards", label: "Credit Cards", icon: "cards" },
      { to: "/emis", label: "EMIs & Loans", icon: "loans" },
    ],
  },
  {
    heading: "Wealth",
    items: [
      { to: "/investments", label: "Investments", icon: "investments" },
      { to: "/net-worth", label: "Net Worth", icon: "networth" },
      { to: "/insurance", label: "Insurance", icon: "insurance" },
      { to: "/protection/calendar", label: "Calendar", icon: "activity" },
      { to: "/protection/dossier", label: "Dossier", icon: "book" },
    ],
  },
  {
    heading: "Plan",
    items: [
      { to: "/goals", label: "Goals", icon: "goals" },
      { to: "/tasks", label: "Tasks", icon: "check" },
      { to: "/sips", label: "SIPs", icon: "investments" },
      { to: "/trends", label: "Trends", icon: "trends" },
      { to: "/insights", label: "Insights", icon: "insights" },
      { to: "/reports", label: "Reports", icon: "reports" },
      { to: "/tax", label: "Tax", icon: "tax" },
    ],
  },
  {
    heading: "Shopping",
    items: [
      { to: "/shopping/lists", label: "Lists", icon: "shopping" },
      { to: "/shopping/cart", label: "Cart", icon: "cart" },
      { to: "/shopping/pantry", label: "Pantry", icon: "pantry" },
      { to: "/shopping/price-watch", label: "Price Watch", icon: "pricewatch" },
    ],
  },
  {
    heading: "Setup",
    items: [
      { to: "/household", label: "Household", icon: "household" },
      { to: "/settings", label: "Settings", icon: "settings" },
      { to: "/events", label: "Event Log", icon: "activity" },
    ],
  },
];

function BrandMark() {
  return (
    <div className="flex h-14 items-center gap-2 border-b border-slate-200 px-4 text-lg font-semibold text-slate-800">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-brand-600 to-accent-600 text-white">
        <Icon name="compass" className="h-5 w-5" />
      </span>
      Compass
    </div>
  );
}

function VersionFooter({ onNavigate }: { onNavigate?: () => void }) {
  const sha = shortSha(buildInfo.gitSha);
  // Untagged builds describe as the short SHA — don't print the same thing twice.
  const showSha = sha !== "unknown" && sha !== buildInfo.version;
  const built = relativeBuildTime(buildInfo.builtAt);

  return (
    <Link
      to="/status"
      onClick={onNavigate}
      className="block border-t border-slate-200 px-4 py-2 text-xs text-slate-400 hover:bg-slate-50 hover:text-slate-600"
      title={`Build ${buildInfo.version}${showSha ? ` (${buildInfo.gitSha})` : ""}${
        buildInfo.builtAt ? ` · built ${new Date(buildInfo.builtAt).toLocaleString()}` : ""
      }`}
    >
      <span className="font-mono">
        {buildInfo.version}
        {showSha && ` · ${sha}`}
      </span>
      <span className="block">{built ? `built ${built}` : "Status"}</span>
    </Link>
  );
}

function NavRow({
  item,
  pending,
  draftCount,
  onNavigate,
}: {
  item: NavItem;
  pending: number;
  draftCount: number;
  onNavigate?: () => void;
}) {
  return (
    <NavLink
      to={item.to}
      end={item.to === "/"}
      onClick={onNavigate}
      className={({ isActive }) =>
        `group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${
          isActive
            ? "bg-brand-50 font-medium text-brand-800"
            : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
        }`
      }
    >
      {({ isActive }) => (
        <>
          {isActive && (
            <span className="absolute inset-y-1.5 left-0 w-1 rounded-r bg-brand-600" aria-hidden="true" />
          )}
          <Icon
            name={item.icon}
            className={`h-5 w-5 shrink-0 ${isActive ? "text-brand-600" : "text-slate-400 group-hover:text-slate-500"}`}
          />
          <span className="flex-1">{item.label}</span>
          {item.to === "/inbox" && pending > 0 && (
            <span className="badge bg-rose-600 text-white">{pending}</span>
          )}
          {item.to === "/shopping/cart" && draftCount > 0 && (
            <span className="badge bg-brand-600 text-white">{draftCount}</span>
          )}
        </>
      )}
    </NavLink>
  );
}

function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const { data: inbox } = useInboxCount();
  const pending = inbox?.pending ?? 0;
  const draftCount = useDraftCount().data ?? 0;
  return (
    <nav aria-label="Primary" className="flex-1 space-y-5 overflow-y-auto p-3">
      {NAV_GROUPS.map((group) => (
        <div key={group.heading} className="space-y-0.5">
          <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            {group.heading}
          </p>
          {group.items.map((item) => (
            <NavRow
              key={item.to}
              item={item}
              pending={pending}
              draftCount={draftCount}
              onNavigate={onNavigate}
            />
          ))}
        </div>
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
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-brand-700 focus:px-3 focus:py-2 focus:text-sm focus:text-white"
      >
        Skip to content
      </a>
      <CommandPalette />
      <Assistant />
      {/* Desktop sidebar — persistent from md up */}
      <aside className="hidden w-64 flex-col border-r border-slate-200 bg-white md:flex">
        <BrandMark />
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
            <div className="flex items-center justify-between border-b border-slate-200 pr-2">
              <BrandMark />
              <button
                onClick={() => setMobileNavOpen(false)}
                aria-label="Close navigation"
                className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100"
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
        {me.isDemo && (
          <div className="flex items-center justify-center gap-2 bg-amber-100 px-4 py-1.5 text-center text-xs font-medium text-amber-900">
            <span>🔒 Demo mode — sample data, read-only. Changes are disabled so you can explore freely.</span>
          </div>
        )}
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
              className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-400 hover:border-slate-300 hover:bg-slate-50"
            >
              <span>Search…</span>
              <kbd className="hidden rounded bg-slate-100 px-1.5 text-xs text-slate-500 sm:inline">
                ⌘K
              </kbd>
            </button>
          </div>
          <div className="flex items-center gap-3 sm:gap-4">
            <a
              href="/docs/"
              target="_blank"
              rel="noreferrer"
              aria-label="Documentation"
              title="Documentation"
              className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-slate-500 transition hover:bg-slate-50 hover:text-slate-700"
            >
              <Icon name="book" className="h-5 w-5" />
              <span className="hidden lg:inline">Docs</span>
            </a>
            <div className="hidden sm:block">
              <ThemeSelect variant="header" />
            </div>
            <NotificationBell />
            <span className="hidden text-sm text-slate-600 sm:inline">{me.displayName}</span>
            <button
              onClick={() => logout.mutate()}
              disabled={logout.isPending}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
            >
              {me.isDemo ? "Exit demo" : "Log out"}
            </button>
          </div>
        </header>
        <main id="main-content" className="flex-1 overflow-y-auto p-4 sm:p-6">
          <div className="mx-auto h-full w-full max-w-5xl">
            <Suspense fallback={<div className="text-sm text-slate-500">Loading…</div>}>
              <Outlet />
            </Suspense>
          </div>
        </main>
      </div>
    </div>
  );
}
