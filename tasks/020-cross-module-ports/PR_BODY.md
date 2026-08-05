## Summary

Closes **Phase 1** of the module migration (roadmap task 1.9).

- **Physical per-module schema ownership (Policy B, layered).** The 12
  cross-module tables + shared enums move into DAG-depth files under
  `apps/api/src/db/shared/*`; each `modules/<domain>/schema.ts` now
  physically defines its resident tables/enums and re-exports its shared
  surface. `db/schema.ts` becomes a pure re-export barrel and remains the
  sole Drizzle Kit entry point. No module imports another module's schema.
- **NetWorthContributor port.** Net worth no longer reaches into other
  modules' tables; each module implements a contributor. Numbers unchanged.
- **Flat-services cleanup.** `services/` and `repositories/` removed;
  domain-neutral helpers relocated to `lib/`, autopilot/anomaly to
  `modules/automation`, users to `modules/system`.

## Verification

- `npm run typecheck` — clean
- `npm run lint` — clean
- `npm run test -w apps/api` — 885 pass / 0 fail / 1 skip
- `npm run db:generate` + `git diff --exit-code apps/api/drizzle` — zero
  migration diff
- Object-identity proven via `schema.decomposition.test.ts` and the
  per-module `schema.smoke.test.ts` files.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
