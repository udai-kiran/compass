I've completed the migration of the protection domain into `apps/api/src/modules/protection/`.

## Summary

**Relocation (not rewrite)** of the 4 protection files into the module structure, with only import-line changes:

- **Created:** `modules/protection/{schema.ts, schema.smoke.test.ts, plugin.ts, plugin.test.ts, routes/insurance.ts, routes/retirement.ts, routes/protection.route.test.ts, services/insurance.ts, services/retirement.ts}`
- **Modified:** `app.ts` (2 imports → 1, 2 registrations → 1 at line 123's position, 1.4 header-comment paragraph); `route-table.snapshot.txt` regenerated (byte-identical, empty diff)
- **Deleted:** the 4 old flat paths under `routes/` and `services/`

**Key compliance:**
- `schema.ts` is a thin named re-export of 7 bindings; `db/schema.ts` unchanged (no `export *` back)
- Split-imports: protection tables from `../schema.ts`, ledger tables from `../../../db/schema.ts`
- Depth adjustments for `lib/errors`, `db/index`, `lib/storage`, and the 4 `ledger/services/*` imports
- Added exactly 5 new `test()` cases (2 smoke + 1 plugin + 2 demo-403) across the 3 new test files

**Verification (all green):**
- `npm run typecheck` — exit 0; `npm run lint` — exit 0
- `npm run test -w apps/api` — **842/842** (837 baseline + 5, matching AC5)
- Root `npm run test` — sole failure is the pre-existing, waived `apps/extractor` DATABASE_URL gap
- `app.route-snapshot.test.ts` — 7/7 (both snapshots byte-identical)
- `backup.test.ts` — 13/13 (no `backup.ts` edit); `db:generate` — zero diff
- The 4 moved files verified via `diff` to contain **zero non-import-line changes** (AC9)

Full evidence written to `tasks/011-migrate-protection/implementation-1.md`. Roadmap `tasks/*.md` edits remain out of scope and were not touched.
