import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, Navigate, useNavigate } from "react-router";
import { RegisterRequestSchema, UserSchema } from "@compass/shared";
import { apiPost } from "../lib/api.ts";
import { useBootstrapStatus } from "../lib/auth.ts";
import { AuthField, AuthShell } from "../components/AuthShell.tsx";
import { DemoButton } from "../components/DemoButton.tsx";

/** Open self-service registration (gated server-side by SIGNUP_ENABLED). */
export function Signup() {
  const { data: bootstrap } = useBootstrapStatus();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const register = useMutation({
    mutationFn: (body: { email: string; password: string; displayName: string }) =>
      apiPost("/api/auth/register", UserSchema, RegisterRequestSchema.parse(body)),
    onSuccess: async (user) => {
      queryClient.setQueryData(["me"], user);
      await queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
      await navigate("/");
    },
  });

  // Registration turned off on this instance → nothing to do here but sign in.
  if (bootstrap && bootstrap.signupEnabled === false) {
    return <Navigate to="/login" replace />;
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    register.mutate({ email, password, displayName });
  }

  return (
    <AuthShell>
      <form onSubmit={onSubmit}>
        <h2 className="text-2xl font-semibold text-slate-900">Create your account</h2>
        <p className="mt-1 text-sm text-slate-500">
          {bootstrap?.needsBootstrap
            ? "Set up the first account for this instance."
            : "Start tracking your money in a few seconds."}
        </p>

        <AuthField
          label="Your name"
          required
          autoComplete="name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />
        <AuthField
          label="Email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <AuthField
          label="Password (min 8 characters)"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        {register.isError && (
          <p role="alert" className="mt-4 text-sm text-negative">
            {register.error.message}
          </p>
        )}

        <button type="submit" disabled={register.isPending} className="btn-primary mt-6 w-full">
          {register.isPending ? "Creating…" : "Create account"}
        </button>

        <p className="mt-4 text-center text-sm text-slate-500">
          Already have an account?{" "}
          <Link to="/login" className="font-medium text-brand-700 hover:text-brand-800">
            Sign in
          </Link>
        </p>

        {bootstrap?.demoAvailable && (
          <>
            <div className="my-6 flex items-center gap-3 text-xs text-slate-400">
              <span className="h-px flex-1 bg-slate-200" />
              or
              <span className="h-px flex-1 bg-slate-200" />
            </div>
            <DemoButton />
          </>
        )}
      </form>
    </AuthShell>
  );
}
