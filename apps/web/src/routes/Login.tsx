import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Navigate, useNavigate } from "react-router";
import { LoginRequestSchema, UserSchema } from "@compass/shared";
import { ApiError, apiPost } from "../lib/api.ts";
import { meQuery, useBootstrapStatus } from "../lib/auth.ts";
import { DemoButton } from "../components/DemoButton.tsx";

export function Login() {
  const { data: bootstrap } = useBootstrapStatus();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const login = useMutation({
    mutationFn: async (body: { email: string; password: string }) => {
      await apiPost("/api/auth/login", UserSchema, LoginRequestSchema.parse(body));
      // Don't enter the app on the login response alone — fetch /me so the
      // session cookie has to survive a real round trip. A cookie the browser
      // refused to store (Secure over plain HTTP) would otherwise leave every
      // page rendering off this response while writes 401.
      try {
        return await queryClient.fetchQuery({ ...meQuery, staleTime: 0 });
      } catch {
        throw new ApiError(
          401,
          "Signed in, but your browser did not keep the session cookie. Serve the app over HTTPS (or localhost) and try again.",
        );
      }
    },
    onSuccess: async () => {
      await navigate("/");
    },
  });

  if (bootstrap?.needsBootstrap) {
    return <Navigate to="/welcome" replace />;
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    login.mutate({ email, password });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100">
      <form onSubmit={onSubmit} className="w-full max-w-sm rounded-xl bg-white p-8 shadow">
        <h1 className="text-xl font-semibold text-slate-800">🧭 Compass</h1>
        <p className="mt-1 text-sm text-slate-500">Sign in to your finances</p>
        <label className="mt-6 block text-sm font-medium text-slate-700">
          Email
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </label>
        <label className="mt-4 block text-sm font-medium text-slate-700">
          Password
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </label>
        {/* 401s are deliberately not toasted (see onApiError), so surface them here. */}
        {login.isError && (
          <p role="alert" className="mt-4 text-sm text-red-600">
            {login.error.message}
          </p>
        )}
        <button
          type="submit"
          disabled={login.isPending}
          className="mt-6 w-full rounded-md bg-slate-800 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {login.isPending ? "Signing in…" : "Sign in"}
        </button>
        {bootstrap?.demoAvailable && <DemoButton />}
      </form>
    </div>
  );
}
