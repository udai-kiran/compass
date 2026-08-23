# Task: 13.2 — Payslip Parsing → CTC, TDS & EPF

## Status
COMPLETE

## Objective
AI-powered payslip parsing that extracts salary components into a structured, reviewable payslip record. PII redaction applied before model calls for text extraction; vision path requires user consent as raw pixels cannot be redacted.

## Root Cause
Compass has no payslip parser. EPF contributions are manually entered as one combined amount via `RecordEpfModal.tsx`. Three downstream consumers need this: 80C basket (employee EPF), regime comparison (TDS + HRA), and income model (reliable salary).

## Codex Review Findings (review-1)
- **H1 (vision privacy)**: Accepted. Vision sends raw pixels — cannot redact PII pre-call. Two-tier approach: (a) text extraction from PDF → redact → send text, (b) vision path requires explicit user consent with a clear warning that raw document leaves the server. AC6 updated.
- **H2 (employer EPF ≠ 80CCD(2))**: Accepted. Employer EPF is recognized provident fund, not NPS/80CCD(2). Fix AC4 to say "employer EPF correctly treated as recognized PF contribution, not 80C or 80CCD(2)".
- **H3 (staged review design)**: Accepted. Match `extracted_transactions` pattern: guarded state transitions, reviewer-corrected values, no downstream queries on pending rows.
- **H4 (TDS YTD)**: Accepted. FY TDS = sum of validated monthly `tdsCurrent` values. YTD stored for reconciliation only, never summed. Multi-employer and job-change handling specified.
- **M1 (two-table design)**: Accepted. `payslips` (header) + `payslip_components` (per-component rows with canonical kind, raw label, amount, YTD).
- **M2 (PDF ingestion)**: Accepted. Text PDFs parsed with pdf-parse or similar. Scanned PDFs → vision path (with consent). MIME + magic byte validation.
- **M3 (AI event kind + pgEnum)**: Accepted. Both Zod schema AND Drizzle pgEnum must be updated, plus a migration to ALTER the enum.
- **M4 (extraction conventions)**: Accepted. Amounts requested in rupees from model, converted to paise deterministically. Gate vision on `supportsVision`, not provider name.

## Scope

### New files
- `apps/api/src/modules/tax/services/payslip-parse.ts` — AI extraction service
- `apps/api/src/modules/tax/services/payslip-parse.test.ts` — unit tests
- `apps/api/src/modules/tax/routes/payslips.ts` — upload, list, review, accept/reject routes
- `apps/api/src/modules/tax/services/payslip-review.ts` — staged review service with state machine

### Modified files
- `apps/api/src/modules/tax/schema.ts` — add `payslips` + `payslip_components` tables (extend from 13.1)
- `apps/api/src/modules/tax/plugin.ts` — register payslip routes
- `packages/shared/src/schemas/ai-events.ts` — add `"payslip_parse"` kind
- `packages/shared/src/schemas/tax.ts` — add payslip Zod schemas
- `apps/api/src/modules/automation/schema.ts` — add `"payslip_parse"` to `aiEventKind` pgEnum
- `apps/api/src/modules/system/services/backup.ts` — add tables + FILE_COLUMNS for document

### Table design
```
payslips (
  id UUID PK DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL FK → users(id) ON DELETE CASCADE,
  fy TEXT NOT NULL,
  pay_month TEXT NOT NULL,  -- "2025-06" 
  employer_name TEXT,
  document_key TEXT,  -- storage key for uploaded document
  status TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'accepted' | 'rejected'
  gross_paise BIGINT,
  net_paise BIGINT,
  tds_current_paise BIGINT,  -- TDS deducted this month
  tds_ytd_paise BIGINT,      -- YTD as printed on payslip (for reconciliation)
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, pay_month, employer_name)
)

payslip_components (
  id UUID PK DEFAULT gen_random_uuid(),
  payslip_id UUID NOT NULL FK → payslips(id) ON DELETE CASCADE,
  raw_label TEXT NOT NULL,           -- as printed on payslip
  canonical_kind TEXT NOT NULL,      -- 'basic' | 'hra' | 'special_allowance' | 'other_earning' | 'employee_epf' | 'employer_epf' | 'eps' | 'professional_tax' | 'other_deduction' | 'employer_contribution'
  category TEXT NOT NULL,            -- 'earning' | 'deduction' | 'employer_contribution'
  current_paise BIGINT NOT NULL,
  ytd_paise BIGINT,
  source_quote TEXT,                 -- exact text from document
  confidence REAL,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)
```

### EPF classification
- **Employee EPF** → `canonical_kind: 'employee_epf'`, feeds 80C basket (recognized PF, ₹1.5L cap)
- **Employer EPF** → `canonical_kind: 'employer_epf'`, recognized PF treatment (exempt up to limit, NOT 80CCD(2))
- **EPS** → `canonical_kind: 'eps'`, part of employer contribution diverted to pension
- Extraction must clarify: employer EPF on payslip may include or exclude EPS diversion. Store both raw and reconciled values.

### TDS accumulation
- FY total TDS = `SUM(tds_current_paise)` across accepted payslips for that FY
- `tds_ytd_paise` stored for reconciliation only, never summed
- Multi-employer: separate payslip records per employer
- Job change: YTD resets tracked per employer

## Dependencies
- 8.1 (AI vision support) — done
- 6.1 (income model) — done
- 13.1 (tax module scaffold) — must complete first

## Plan
- P1: Add `"payslip_parse"` to both `AiEventKindSchema` (Zod) and `aiEventKind` pgEnum (Drizzle). Tests first.
- P2: Add `payslips` + `payslip_components` tables to tax schema with all constraints
- P3: Create payslip review service — state machine matching `extracted_transactions` pattern: `pending → accepted | rejected`, guarded `UPDATE ... WHERE status='pending' RETURNING`, reviewer corrections applied atomically
- P4: Create payslip extraction service — tool-calling prompt, text redaction for PDF text path, vision consent gate, amounts in rupees → paise conversion
- P5: Create routes — `POST /payslips` (upload+parse), `GET /payslips?fy=`, `GET /payslips/:id`, `POST /payslips/:id/accept` (with corrections), `POST /payslips/:id/reject`, `POST /payslips/manual` (manual entry fallback)
- P6: Wire into plugin, backup (ALL_TABLES, USER_TABLES, LINKED_TABLES for components, FILE_COLUMNS for document)
- P7: Generate migration (including ALTER TYPE for ai_event_kind enum)
- P8: Comprehensive tests: state transitions, component classification, TDS accumulation, redaction

## Acceptance Criteria
- AC1: Extracts gross, basic, HRA, allowances, employee/employer EPF, EPS, professional tax, TDS into structured components
- AC2: Unknown layouts degrade to manual entry route
- AC3: Reviewable before commit with source quotes as provenance; reviewer can correct values before acceptance
- AC4: Employee EPF flows to 80C basket as recognized PF; employer EPF treated as recognized PF (NOT 80C or 80CCD(2))
- AC5: FY TDS = sum of monthly `tds_current_paise` from accepted payslips; YTD stored for reconciliation only
- AC6: Text path: PII redacted before model call. Vision path: requires explicit user consent, raw content never logged in ai_events
- AC7: New `ai_events` kind in both Zod and pgEnum; documents stored via Storage
- AC8: typecheck + lint + test green

## Verification
- T1: `npm run typecheck` passes
- T2: `npm run lint` passes
- T3: `npm run test` passes
- T4: AI event kind accepted in both schema validation and DB insert
- T5: Tables in backup arrays, FILE_COLUMNS for document
- T6: Migration includes ALTER TYPE for pgEnum

## Codex Review Findings (review-2) — Fix Round

**H findings to fix:**
- H1: PDF uploaded without `extractedText` must NOT fall through to vision path. Vision path only for images (JPEG/PNG/WebP). For PDF with no `extractedText`, return `{available: false, message}` directing to manual entry. No server-side PDF text extraction in this task (deferred to future).
- H2: Documents must be persisted to Storage; `documentKey` written to payslip row. Vision path currently deletes key immediately — instead keep it. Both paths (text + vision) must store document permanently (or if storage fails, continue without key but log).
- H3: `loadUserIdentity` fails silently → empty identity → PII not redacted. Fix: if identity load fails, still run structural regex redaction (names array stays empty but structural patterns still catch PAN/Aadhaar/phone). The `try/catch` should be tightened.
- H4: Model output missing `payMonth` or empty `components` → must redirect to manual entry, never create an invalid row. Add validation gate after parsing.

**M findings to fix:**
- M1: Component correction: check `affected === 0` and throw 400 when component IDs don't match.
- M2: Manual and AI payslip creation must be atomic (transaction wrapping header + component inserts).
- M4: Add cross-field Zod refinement: `payMonth` year must match `fy` start year (e.g., payMonth "2025-09" must be in FY "2025-26" or preceding transition month).
- M6: Fix tool prompt: `grossRupees` should say "Total gross salary as printed" not "CTC monthly equivalent".
- M8: Catch `ai.chat()` exceptions (network/timeout/provider errors) and return `{available: false, message}` instead of letting them become 500s.

**L findings to fix:**
- L3: `rupeesToPaise` returning `null` for oversized values must cause the model result to be REJECTED (redirect to manual), not silently zero-valued.

**Deferred (non-goals or future tasks):**
- Server-side PDF text extraction (future; client supplies extractedText)
- M9 comprehensive DB integration tests (requires live DB; note in test file)
- M10 full suite green (DB-dependent; pre-existing)
- M5 80C basket flow (explicitly Non-Goals, 13.4)
- M3 DB check constraints (text vs enum — schema design choice, minimal DB risk)
- L4 FY TDS safe-integer guard (safe in practice for realistic payslip counts)
- L5 `.toSorted()` instead of in-place sort (minor; toSorted may not be available in Node 24 without flag check)

## Non-Goals
- Auto-committing payslip data to income ledger (13.4)
- Annual CTC computation (monthly payroll only)
- Regime inference logic from TDS data (13.8 — field exists but inference deferred)
- Server-side PDF text extraction (clients supply extractedText; future enhancement)
