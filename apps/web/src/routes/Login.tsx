import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, Navigate, useNavigate } from "react-router";
import { LoginRequestSchema, UserSchema } from "@compass/shared";
import { ApiError, apiPost } from "../lib/api.ts";
import { meQuery, useBootstrapStatus } from "../lib/auth.ts";
import { AuthField, AuthShell } from "../components/AuthShell.tsx";
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

  // First run (no users yet) → send them straight to account creation.
  if (bootstrap?.needsBootstrap) {
    return <Navigate to="/signup" replace />;
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    login.mutate({ email, password });
  }

  return (
    <AuthShell
      heroCta={bootstrap?.demoAvailable ? <DemoButton variant="hero" /> : undefined}
    >
      <form onSubmit={onSubmit}>
        <h2 className="text-2xl font-semibold text-slate-900">Welcome back</h2>
        <p className="mt-1 text-sm text-slate-500">Sign in to your Compass account.</p>

        <AuthField
          label="Email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <AuthField
          label="Password"
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        {/* 401s are deliberately not toasted (see onApiError), so surface them here. */}
        {login.isError && (
          <p role="alert" className="mt-4 text-sm text-negative">
            {login.error.message}
          </p>
        )}

        <button type="submit" disabled={login.isPending} className="btn-primary mt-6 w-full">
          {login.isPending ? "Signing in…" : "Sign in"}
        </button>

        {bootstrap?.signupEnabled !== false && (
          <p className="mt-4 text-center text-sm text-slate-500">
            New to Compass?{" "}
            <Link to="/signup" className="font-medium text-brand-700 hover:text-brand-800">
              Create an account
            </Link>
          </p>
        )}

        {/* The hero carries the demo CTA at lg+; show it in-card only below lg,
            where the hero is hidden. */}
        {bootstrap?.demoAvailable && (
          <div className="lg:hidden">
            <div className="my-6 flex items-center gap-3 text-xs text-slate-400">
              <span className="h-px flex-1 bg-slate-200" />
              or
              <span className="h-px flex-1 bg-slate-200" />
            </div>
            <DemoButton />
          </div>
        )}
      </form>
    </AuthShell>
  );
}
