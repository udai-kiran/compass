import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { createBrowserRouter, RouterProvider } from "react-router";
import { ApiError } from "./lib/api.ts";
import { toast, ToastProvider } from "./lib/toast.tsx";
import { AppLayout } from "./layouts/AppLayout.tsx";
import { Login } from "./routes/Login.tsx";
import { Welcome } from "./routes/Welcome.tsx";
import { TransactionsPage } from "./routes/transactions/TransactionsPage.tsx";
import { ImportPage } from "./routes/imports/ImportPage.tsx";
import { DashboardPage } from "./routes/dashboard/DashboardPage.tsx";
import { BudgetsPage } from "./routes/budgets/BudgetsPage.tsx";
import { TrendsPage } from "./routes/trends/TrendsPage.tsx";
import { GoalsPage } from "./routes/goals/GoalsPage.tsx";
import { CashFlowPage } from "./routes/cashflow/CashFlowPage.tsx";
import { BillsPage } from "./routes/bills/BillsPage.tsx";
import { CardsPage } from "./routes/cards/CardsPage.tsx";
import { EMIsPage } from "./routes/emis/EMIsPage.tsx";
import { PortfolioPage } from "./routes/investments/PortfolioPage.tsx";
import { NetWorthPage } from "./routes/networth/NetWorthPage.tsx";
import { InsightsPage } from "./routes/insights/InsightsPage.tsx";
import { ReportsPage } from "./routes/reports/ReportsPage.tsx";
import { NotificationsPage } from "./routes/notifications/NotificationsPage.tsx";
import { SettingsPage } from "./routes/settings/SettingsPage.tsx";
import { ErrorPage, NotFound } from "./routes/ErrorPage.tsx";
import "./index.css";

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
  { path: "/welcome", element: <Welcome />, errorElement: <ErrorPage /> },
  {
    path: "/",
    element: <AppLayout />,
    errorElement: <ErrorPage />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: "trends", element: <TrendsPage /> },
      { path: "transactions", element: <TransactionsPage /> },
      { path: "import", element: <ImportPage /> },
      { path: "budgets", element: <BudgetsPage /> },
      { path: "goals", element: <GoalsPage /> },
      { path: "cash-flow", element: <CashFlowPage /> },
      { path: "notifications", element: <NotificationsPage /> },
      { path: "investments", element: <PortfolioPage /> },
      { path: "net-worth", element: <NetWorthPage /> },
      { path: "cards", element: <CardsPage /> },
      { path: "emis", element: <EMIsPage /> },
      { path: "bills", element: <BillsPage /> },
      { path: "insights", element: <InsightsPage /> },
      { path: "reports", element: <ReportsPage /> },
      { path: "settings", element: <SettingsPage /> },
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
