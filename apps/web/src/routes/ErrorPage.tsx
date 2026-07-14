import { isRouteErrorResponse, Link, useRouteError } from "react-router";

/**
 * Router-level error boundary (500-class). Catches render/loader errors and a
 * 404 route response, showing a friendly page instead of a blank screen.
 */
export function ErrorPage() {
  const error = useRouteError();
  const is404 = isRouteErrorResponse(error) && error.status === 404;
  const status = isRouteErrorResponse(error) ? error.status : 500;
  const message = is404
    ? "We couldn't find the page you were looking for."
    : "An unexpected error occurred. The problem has been logged.";

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-100 px-4 text-center">
      <p className="text-5xl font-bold text-slate-300">{status}</p>
      <h1 className="mt-3 text-lg font-semibold text-slate-700">
        {is404 ? "Page not found" : "Something went wrong"}
      </h1>
      <p className="mt-1 max-w-sm text-sm text-slate-500">{message}</p>
      <Link
        to="/"
        className="mt-6 rounded-md bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
      >
        Back to dashboard
      </Link>
    </div>
  );
}

/** 404 catch-all for unknown paths inside the app shell. */
export function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <p className="text-5xl font-bold text-slate-300">404</p>
      <h1 className="mt-3 text-lg font-semibold text-slate-700">Page not found</h1>
      <p className="mt-1 text-sm text-slate-500">This page doesn't exist or has moved.</p>
      <Link to="/" className="mt-6 rounded-md bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700">
        Back to dashboard
      </Link>
    </div>
  );
}
