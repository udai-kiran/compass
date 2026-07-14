import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Navigate, useNavigate } from "react-router";
import { RegisterRequestSchema, UserSchema } from "@compass/shared";
import { apiPost } from "../lib/api.ts";
import { useBootstrapStatus } from "../lib/auth.ts";

/** First-run owner account creation — only reachable while no user exists. */
export function Welcome() {
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

  if (bootstrap && !bootstrap.needsBootstrap) {
    return <Navigate to="/login" replace />;
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    register.mutate({ email, password, displayName });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100">
      <form onSubmit={onSubmit} className="w-full max-w-sm rounded-xl bg-white p-8 shadow">
        <h1 className="text-xl font-semibold text-slate-800">Welcome to Compass 🧭</h1>
        <p className="mt-1 text-sm text-slate-500">
          Set up the owner account for this self-hosted instance.
        </p>
        <label className="mt-6 block text-sm font-medium text-slate-700">
          Your name
          <input
            required
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </label>
        <label className="mt-4 block text-sm font-medium text-slate-700">
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
          Password (min 8 characters)
          <input
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </label>
        <button
          type="submit"
          disabled={register.isPending}
          className="mt-6 w-full rounded-md bg-slate-800 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {register.isPending ? "Creating…" : "Create account"}
        </button>
      </form>
    </div>
  );
}
