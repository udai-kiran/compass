import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { UserSchema } from "@compass/shared";
import { apiPost } from "../lib/api.ts";
import { meQuery } from "../lib/auth.ts";

/**
 * "Explore the demo" entry, shown on Login/Welcome when the server advertises
 * `demoAvailable`. Starts a read-only demo session, primes the /me cache off a
 * real round trip (so a dropped cookie surfaces here, not on every later page),
 * then enters the app.
 */
export function DemoButton() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const demo = useMutation({
    mutationFn: async () => {
      await apiPost("/api/auth/demo", UserSchema);
      return queryClient.fetchQuery({ ...meQuery, staleTime: 0 });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
      await navigate("/");
    },
  });

  return (
    <div className="mt-6 border-t border-slate-200 pt-4">
      <button
        type="button"
        onClick={() => demo.mutate()}
        disabled={demo.isPending}
        className="w-full rounded-md border border-slate-300 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
      >
        {demo.isPending ? "Loading demo…" : "Explore the demo — no sign-up"}
      </button>
      <p className="mt-2 text-center text-xs text-slate-400">
        A read-only tour with sample data. Nothing you click changes anything.
      </p>
      {demo.isError && (
        <p role="alert" className="mt-2 text-center text-sm text-red-600">
          {demo.error.message}
        </p>
      )}
    </div>
  );
}
