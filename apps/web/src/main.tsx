import { lazy, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createBrowserRouter, Navigate, RouterProvider } from "react-router";
import { ApiError } from "./lib/api.ts";
import { toast, ToastProvider } from "./lib/toast.tsx";
import { AppLayout } from "./layouts/AppLayout.tsx";
import { Login } from "./routes/Login.tsx";
import { Signup } from "./routes/Signup.tsx";
import { ErrorPage, NotFound } from "./routes/ErrorPage.tsx";
import "./index.css";

// Authenticated pages are code-split: each becomes its own chunk loaded on first
// visit, keeping the initial bundle (and the charting lib) out of the login path.
// The shared Suspense boundary lives in AppLayout, around <Outlet/>.
const TransactionsPage = lazy(() =>
  import("./routes/transactions/TransactionsPage.tsx").then((m) => ({
    default: m.TransactionsPage,
  })),
);
const ImportPage = lazy(() =>
  import("./routes/imports/ImportPage.tsx").then((m) => ({ default: m.ImportPage })),
);
const DashboardPage = lazy(() =>
  import("./routes/dashboard/DashboardPage.tsx").then((m) => ({ default: m.DashboardPage })),
);
const BudgetsPage = lazy(() =>
  import("./routes/budgets/BudgetsPage.tsx").then((m) => ({ default: m.BudgetsPage })),
);
const TrendsPage = lazy(() =>
  import("./routes/trends/TrendsPage.tsx").then((m) => ({ default: m.TrendsPage })),
);
const GoalsPage = lazy(() =>
  import("./routes/goals/GoalsPage.tsx").then((m) => ({ default: m.GoalsPage })),
);
const InboxPage = lazy(() =>
  import("./routes/inbox/InboxPage.tsx").then((m) => ({ default: m.InboxPage })),
);
const CashFlowPage = lazy(() =>
  import("./routes/cashflow/CashFlowPage.tsx").then((m) => ({ default: m.CashFlowPage })),
);
const BillsPage = lazy(() =>
  import("./routes/bills/BillsPage.tsx").then((m) => ({ default: m.BillsPage })),
);
const CardsPage = lazy(() =>
  import("./routes/cards/CardsPage.tsx").then((m) => ({ default: m.CardsPage })),
);
const CardDetailPage = lazy(() =>
  import("./routes/cards/CardDetailPage.tsx").then((m) => ({ default: m.CardDetailPage })),
);
const EMIsPage = lazy(() =>
  import("./routes/emis/EMIsPage.tsx").then((m) => ({ default: m.EMIsPage })),
);
const InsurancePage = lazy(() =>
  import("./routes/insurance/InsurancePage.tsx").then((m) => ({ default: m.InsurancePage })),
);
const PortfolioPage = lazy(() =>
  import("./routes/investments/PortfolioPage.tsx").then((m) => ({ default: m.PortfolioPage })),
);
const MfImportPage = lazy(() =>
  import("./routes/investments/MfImportPage.tsx").then((m) => ({ default: m.MfImportPage })),
);
const CapitalGainsPage = lazy(() =>
  import("./routes/investments/CapitalGainsPage.tsx").then((m) => ({ default: m.CapitalGainsPage })),
);
const NetWorthPage = lazy(() =>
  import("./routes/networth/NetWorthPage.tsx").then((m) => ({ default: m.NetWorthPage })),
);
const InsightsPage = lazy(() =>
  import("./routes/insights/InsightsPage.tsx").then((m) => ({ default: m.InsightsPage })),
);
const ReportsPage = lazy(() =>
  import("./routes/reports/ReportsPage.tsx").then((m) => ({ default: m.ReportsPage })),
);
const NotificationsPage = lazy(() =>
  import("./routes/notifications/NotificationsPage.tsx").then((m) => ({
    default: m.NotificationsPage,
  })),
);
const SettingsPage = lazy(() =>
  import("./routes/settings/SettingsPage.tsx").then((m) => ({ default: m.SettingsPage })),
);
const AccountDetailPage = lazy(() =>
  import("./routes/settings/AccountDetailPage.tsx").then((m) => ({ default: m.AccountDetailPage })),
);
const StatusPage = lazy(() =>
  import("./routes/status/StatusPage.tsx").then((m) => ({ default: m.StatusPage })),
);

function onApiError(err: unknown) {
  // 401s are handled by redirecting to /login — don't toast them.
  if (err instanceof ApiError && err.status === 401) return;
  toast(err instanceof Error ? err.message : "Something went wrong");
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
  queryCache: new QueryCache({ onError: onApiError }),
  mutationCache: new MutationCache({ onError: onApiError }),
});

const router = createBrowserRouter([
  { path: "/login", element: <Login />, errorElement: <ErrorPage /> },
  { path: "/signup", element: <Signup />, errorElement: <ErrorPage /> },
  // Legacy first-run path — folded into the unified signup page.
  { path: "/welcome", element: <Navigate to="/signup" replace /> },
  {
    path: "/",
    element: <AppLayout />,
    errorElement: <ErrorPage />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: "trends", element: <TrendsPage /> },
      { path: "transactions", element: <TransactionsPage /> },
      { path: "inbox", element: <InboxPage /> },
      { path: "import", element: <ImportPage /> },
      { path: "budgets", element: <BudgetsPage /> },
      { path: "goals", element: <GoalsPage /> },
      { path: "cash-flow", element: <CashFlowPage /> },
      { path: "notifications", element: <NotificationsPage /> },
      { path: "investments", element: <PortfolioPage /> },
      { path: "investments/import", element: <MfImportPage /> },
      { path: "investments/capital-gains", element: <CapitalGainsPage /> },
      { path: "net-worth", element: <NetWorthPage /> },
      { path: "cards", element: <CardsPage /> },
      { path: "cards/:accountId", element: <CardDetailPage /> },
      { path: "emis", element: <EMIsPage /> },
      { path: "bills", element: <BillsPage /> },
      { path: "insurance", element: <InsurancePage /> },
      { path: "insights", element: <InsightsPage /> },
      { path: "reports", element: <ReportsPage /> },
      { path: "settings", element: <SettingsPage /> },
      { path: "settings/accounts/:id", element: <AccountDetailPage /> },
      { path: "status", element: <StatusPage /> },
      { path: "*", element: <NotFound /> },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);
