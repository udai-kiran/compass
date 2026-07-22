import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { UserSchema } from "@compass/shared";
import { apiPost } from "../lib/api.ts";
import { meQuery } from "../lib/auth.ts";

/**
 * "Explore the demo" entry, shown on the login/signup pages when the server
 * advertises `demoAvailable`. Starts a read-only demo session, primes the /me
 * cache off a real round trip (so a dropped cookie surfaces here, not on every
 * later page), then enters the app.
 *
 * `variant` controls the styling context: "card" (default) sits inside the
 * sign-in card; "hero" sits on the dark brand hero of the landing page.
 */
export function DemoButton({ variant = "card" }: { variant?: "card" | "hero" }) {
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

  const hero = variant === "hero";

  return (
    <div>
      <button
        type="button"
        onClick={() => demo.mutate()}
        disabled={demo.isPending}
        className={
          hero
            ? "w-full rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-brand-700 shadow-sm transition hover:bg-white/90 disabled:opacity-60"
            : "btn-secondary w-full"
        }
      >
        {demo.isPending ? "Loading demo…" : "Explore the live demo — no sign-up"}
      </button>
      <p className={`mt-2 text-center text-xs ${hero ? "text-white/70" : "text-slate-400"}`}>
        A read-only tour with sample data. Nothing you click changes anything.
      </p>
      {demo.isError && (
        <p
          role="alert"
          className={`mt-2 text-center text-sm ${hero ? "text-rose-200" : "text-negative"}`}
        >
          {demo.error.message}
        </p>
      )}
    </div>
  );
}
