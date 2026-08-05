# Implementation review verdict

Overall: **INVALID — one BLOCKING completion defect.**

The runtime migration itself is correct: moved production files are behavior-identical apart from required import changes, imports resolve, invariants hold, demo-write protection is genuine, schemas and snapshots are unchanged, and all test/type/lint gates pass.

However, **P14 and AC13 were not implemented**. The roadmap still records task 1.6 as unfinished. The independent verification report’s “ALL ACCEPTANCE ITEMS: PASS” conclusion is therefore incorrect.

## Findings

### BLOCKING — P14 / AC13 roadmap closure was not landed

**Verdict: INVALID**

Required R1–R3 changes are absent:

- [tasks/01.06-migrate-automation.md](/home/udai/PennyPilot/tasks/01.06-migrate-automation.md:6) still says `status: todo`.
- Its acceptance criteria remain unchecked at [lines 15–20](/home/udai/PennyPilot/tasks/01.06-migrate-automation.md:15).
- [tasks/README.md](/home/udai/PennyPilot/tasks/README.md:102) still marks 1.6 as `todo`.
- [tasks/01.09-cross-module-ports.md](/home/udai/PennyPilot/tasks/01.09-cross-module-ports.md:1) contains no required forward note that `ai-settings.ts` now lives in automation.

This directly violates:

- P14: update the 1.06 task, README, and 1.09 forward note.
- AC13: “R1–R3 landed; 1.6 `status: done` only after every other AC is proven.”

The claim at [verification-1.md:486](/home/udai/PennyPilot/tasks/016-migrate-automation/verification-1.md:486) that all acceptance items passed omitted AC13 from its summary table and is contradicted by the real files.

This is documentation/project-state rather than a runtime regression, but it is blocking because it is an explicit acceptance criterion for the completed migration.

## Plan-item review

| Plan item | Verdict | Evidence |
|---|---|---|
| P1 baseline capture | VALID from recorded evidence | Baseline hashes/count are documented in TASK F9. Current hashes still match. This review cannot independently reconstruct the pre-edit timing. |
| P2 schema and smoke tests | VALID | Thin re-export at [schema.ts:24](/home/udai/PennyPilot/apps/api/src/modules/automation/schema.ts:24); two identity tests at [schema.smoke.test.ts:16](/home/udai/PennyPilot/apps/api/src/modules/automation/schema.smoke.test.ts:16) and [line 26](/home/udai/PennyPilot/apps/api/src/modules/automation/schema.smoke.test.ts:26). Both pass. |
| P3 move six services and test | VALID | Exact `HEAD`-to-new-file comparisons show import-only differences; `assistant.ts` and `ai-settings.test.ts` are byte-identical. |
| P4 move two routes | VALID | Exact comparisons show import-only differences. Correct targets appear at [ai.ts:14–20](/home/udai/PennyPilot/apps/api/src/modules/automation/routes/ai.ts:14) and [ai-events.ts:9](/home/udai/PennyPilot/apps/api/src/modules/automation/routes/ai-events.ts:9). |
| P5 plugin registration | VALID | [plugin.ts:20–22](/home/udai/PennyPilot/apps/api/src/modules/automation/plugin.ts:20) registers `aiRoutes`, then `aiEventRoutes`. |
| P6 app registration | VALID | Single import at [app.ts:28](/home/udai/PennyPilot/apps/api/src/app.ts:28), single registration at [app.ts:137](/home/udai/PennyPilot/apps/api/src/app.ts:137), in the original location between backup and profile. Documentation was updated. |
| P7 auth and comments | VALID | Auth has only the import repoint at [auth.ts:20](/home/udai/PennyPilot/apps/api/src/routes/auth.ts:20). Planning/extractor changes are comment-only. |
| P8 demo route tests | VALID | Real app hooks and routes are installed at [automation.route.test.ts:46–57](/home/udai/PennyPilot/apps/api/src/modules/automation/routes/automation.route.test.ts:46); PUT proof at [line 93](/home/udai/PennyPilot/apps/api/src/modules/automation/routes/automation.route.test.ts:93), POST proof at [line 124](/home/udai/PennyPilot/apps/api/src/modules/automation/routes/automation.route.test.ts:124). Both pass. |
| P9 plugin test | VALID | Exactly two route pairs at [plugin.test.ts:18–21](/home/udai/PennyPilot/apps/api/src/modules/automation/plugin.test.ts:18), count assertion at [line 32](/home/udai/PennyPilot/apps/api/src/modules/automation/plugin.test.ts:32). Passes. |
| P10 old paths/import resolution | VALID | All nine old files and `services/ai/` are absent. Repository search found no live-code import of a deleted path. Recorded resolver check: 231 files, 716 relative specifiers, zero unresolved; root typecheck independently confirms resolution. |
| P11 snapshots | VALID | Both hashes match and both real assertions pass. |
| P12 Drizzle zero diff | VALID from independent evidence | [verification-1.md:443–458](/home/udai/PennyPilot/tasks/016-migrate-automation/verification-1.md:443) records “No schema changes” and an unchanged drizzle directory. Not rerun here because this review was explicitly read-only and generation may write. |
| P13 full gates | VALID | Typecheck, lint, focused tests, API suite and root suite all passed in this review. API result: 853/853. |
| P14 roadmap closure | **INVALID — BLOCKING** | Task remains `todo`, checkboxes remain empty, README remains `todo`, and the 1.09 note is missing. |

## Acceptance-criterion review

### AC1 — both route snapshots unchanged

**VALID**

- `route-surface.snapshot.txt`: `a368d4ebfcb6bd9638ae24a3334e5b7fe61798e3cb82bdec12a06e93becc4122`
- `route-table.snapshot.txt`: `be3500582a5cd352dd95a12995b8f8c929a9d95ba3f7adb9962cc20be2bae1b5`

Neither file differs from `HEAD`.

The canonical surface assertion is at [app.route-snapshot.test.ts:107–117](/home/udai/PennyPilot/apps/api/src/app.route-snapshot.test.ts:107), and the raw `printRoutes()` assertion is at [lines 120–131](/home/udai/PennyPilot/apps/api/src/app.route-snapshot.test.ts:120). Both passed.

The corrected plan claim is accurate: wrapping the two already-adjacent registrations in the same order leaves both snapshots byte-identical.

### AC2 — thin schema and unchanged database schema

**VALID**

[schema.ts:24–30](/home/udai/PennyPilot/apps/api/src/modules/automation/schema.ts:24) is a pure named re-export of:

- `aiSettings`
- `aiEvents`
- `aiProvider`
- `aiEventKind`
- `aiEventStatus`

It defines no `pgTable` or `pgEnum`. `apps/api/src/db/schema.ts` has no diff.

There is no ES-module cycle:

- `modules/automation/schema.ts` imports/re-exports from `db/schema.ts`.
- `db/schema.ts` does not import or re-export automation.
- Internal services import owned tables from the local module schema.

The smoke test also proves object identity, rather than merely structural equality.

### AC3 — per-user provider resolution

**VALID**

Exact comparison with the deleted `HEAD` version shows the bodies of `getAiSettings`, `upsertAiSettings`, `getUserAiProvider`, `assertAllowedBaseUrl`, and `normalizeBaseUrl` are byte-identical.

Evidence:

- Per-user settings lookup: [ai-settings.ts:13–20](/home/udai/PennyPilot/apps/api/src/modules/automation/services/ai-settings.ts:13)
- Per-user upsert and `userId` conflict target: [lines 28–70](/home/udai/PennyPilot/apps/api/src/modules/automation/services/ai-settings.ts:28)
- Per-request provider lookup: [lines 78–100](/home/udai/PennyPilot/apps/api/src/modules/automation/services/ai-settings.ts:78)
- `NullProvider` fallback: [lines 85–90](/home/udai/PennyPilot/apps/api/src/modules/automation/services/ai-settings.ts:85)
- Exact normalized allowlist: [lines 102–129](/home/udai/PennyPilot/apps/api/src/modules/automation/services/ai-settings.ts:102)

No global provider was introduced. `app.ts` continues to document per-user resolution at [app.ts:161–163](/home/udai/PennyPilot/apps/api/src/app.ts:161).

### AC4 — event logging remains fire-and-forget

**VALID**

The observer arrow at [ai.ts:36–47](/home/udai/PennyPilot/apps/api/src/modules/automation/routes/ai.ts:36) directly returns `recordAiEvent(...)`’s promise. It is not wrapped in `void`, and its body is byte-identical to the old route.

The actual fire-and-forget boundary remains in untouched `packages/ai/src/http.ts`:

- Successful call: [http.ts:104](/home/udai/PennyPilot/packages/ai/src/http.ts:104)
- Permanent failure: [http.ts:113](/home/udai/PennyPilot/packages/ai/src/http.ts:113)
- Exhausted failure: [http.ts:125](/home/udai/PennyPilot/packages/ai/src/http.ts:125)

`recordAiEvent` also swallows persistence failures in [events.ts:34–56](/home/udai/PennyPilot/apps/api/src/modules/automation/services/events.ts:34).

The root suite passed the package-level test proving a slow observer does not delay the model call.

### AC5 — five assistant tools and cross-module imports

**VALID**

All five tools remain present, with byte-identical `TOOLS`, `TOOL_SPECS`, and `runTool` bodies:

- `get_spending_summary`: [tools.ts:40–60](/home/udai/PennyPilot/apps/api/src/modules/automation/services/tools.ts:40)
- `get_budget_status`: [lines 61–83](/home/udai/PennyPilot/apps/api/src/modules/automation/services/tools.ts:61)
- `get_financial_health`: [lines 84–100](/home/udai/PennyPilot/apps/api/src/modules/automation/services/tools.ts:84)
- `search_transactions`: [lines 101–126](/home/udai/PennyPilot/apps/api/src/modules/automation/services/tools.ts:101)
- `list_goals`: [lines 127–145](/home/udai/PennyPilot/apps/api/src/modules/automation/services/tools.ts:127)

Their resolved imports are correct at [tools.ts:5–11](/home/udai/PennyPilot/apps/api/src/modules/automation/services/tools.ts:5):

- Planning: reports, budgets, insights, goals
- Ledger: search
- Flat service: periods via `../../../services/periods.ts`

`assistant.ts` stayed byte-identical and retains its same-directory `./tools.ts` import.

### AC6 — moved-file body equivalence

**VALID**

Direct old-vs-new comparisons produced only these differences:

- Route infra: `../../../lib`, `../../../services`
- Intra-module services: `../services/*`
- DB/lib depth: `../../../db|lib`
- Owned tables: `../schema.ts`
- Sibling modules: `../../planning|ledger/services/*`
- Flat periods service: `../../../services/periods.ts`

No handler body, URL, status, Zod schema, SQL predicate, pagination condition, cache behavior, redaction logic, `userId` filter, tool body, or provider body changed.

`assistant.ts` and `ai-settings.test.ts` have no content diff at all.

### AC7 — auth-only import repoint

**VALID**

The sole `auth.ts` change is [line 20](/home/udai/PennyPilot/apps/api/src/routes/auth.ts:20). Its `/api/capabilities` handler and all other code are unchanged.

### AC8 — API test count

**VALID**

`npm run test -w apps/api` completed:

- 853 tests
- 853 pass
- 0 fail

The expected +5 is present:

- 2 schema smoke tests
- 1 plugin test
- 2 demo-write tests

### AC9 — typecheck, lint, root test

**VALID**

Fresh review results:

- Root workspace typecheck: exit 0
- Root lint: exit 0
- Root `npm run test`: exit 0
- API suite: 853/853

No waiver was needed.

### AC10 — relative imports resolve

**VALID**

The independent resolver evidence records 231 TypeScript files, 716 relative specifiers, and zero unresolved imports at [verification-1.md:273–284](/home/udai/PennyPilot/tasks/016-migrate-automation/verification-1.md:273).

Fresh typechecking across every workspace also passed. Repository-wide source search found no import from:

- deleted `src/routes/ai.ts`
- deleted `src/routes/ai-events.ts`
- deleted `src/services/ai/*`
- deleted `src/services/ai-settings.ts`

Old-path mentions that remain are historical task/review documentation, not executable imports.

### AC11 — Drizzle and backup invariants

**VALID**

- `db/schema.ts` is unchanged.
- `backup.ts` and `backup.test.ts` are unchanged.
- Focused `backup.test.ts`: 13/13 pass.
- Independent evidence records `db:generate` exit 0, “No schema changes,” and no drizzle-directory changes at [verification-1.md:443–458](/home/udai/PennyPilot/tasks/016-migrate-automation/verification-1.md:443).

### AC12 — genuine demo-write protection

**VALID**

These tests prove the demo guard, not an Origin/CSRF 403.

The injected requests at [automation.route.test.ts:108–113](/home/udai/PennyPilot/apps/api/src/modules/automation/routes/automation.route.test.ts:108) and [lines 139–144](/home/udai/PennyPilot/apps/api/src/modules/automation/routes/automation.route.test.ts:139) supply no `Origin` header.

CSRF checks a mutating request only when `req.headers.origin` is present at [security.ts:65–79](/home/udai/PennyPilot/apps/api/src/plugins/security.ts:65). Therefore it cannot produce these responses.

The authenticated sessions are explicitly created with `{ demo: true }` at [automation.route.test.ts:95](/home/udai/PennyPilot/apps/api/src/modules/automation/routes/automation.route.test.ts:95) and [line 126](/home/udai/PennyPilot/apps/api/src/modules/automation/routes/automation.route.test.ts:126).

The actual demo guard rejects authenticated demo-session mutations at [auth.ts:64–74](/home/udai/PennyPilot/apps/api/src/plugins/auth.ts:64), returning the 403 before route handlers run.

Both tests additionally prove zero database effect:

- No `ai_settings` row: [automation.route.test.ts:116–121](/home/udai/PennyPilot/apps/api/src/modules/automation/routes/automation.route.test.ts:116)
- No `ai_events` row: [lines 147–152](/home/udai/PennyPilot/apps/api/src/modules/automation/routes/automation.route.test.ts:147)

### AC13 — roadmap completion

**INVALID — BLOCKING**

R1–R3 are absent, as detailed in the primary finding.

## Security, compatibility, and convention assessment

No runtime security or compatibility regression was found.

- Per-user data predicates remain intact.
- No global AI configuration or provider was introduced.
- Secret encryption/decryption and base-URL validation are unchanged.
- Demo sessions cannot reach mutating handlers.
- Event persistence remains off the model-call latency path.
- Public URLs, methods, schemas, status codes, and route ordering are unchanged.
- All owned table imports follow the local `../schema.ts` convention.
- All sibling and infrastructure imports use the required depth.
- No live source imports a deleted path.
- No ESM cycle was introduced.

The only required correction is to finish P14/R1–R3 and then update the verification conclusion.