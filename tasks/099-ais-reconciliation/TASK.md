# Task: 13.13 — AIS / 26AS Reconciliation & Form 16 Import

## Status
PLAN_REVIEW

## Codex Review-1 Findings (addressed)

**H1 (promotion idempotency)**: Promotion creates income event with `sourceKind='ais'`, `sourceId=aisLine.id` (update schema comments claiming AIS has null source id). One transaction: claim line via `UPDATE ais_lines SET match_status='promoting' WHERE id=? AND user_id=? AND match_status='unmatched' AND matched_income_event_id IS NULL RETURNING` → insert event with `onConflictDoNothing()` + fetch-on-conflict → link line. Repeat request returns existing event or deterministic 409; never a second insert. Document-level dedup: `content_sha256 TEXT NOT NULL` on ais_documents + per-user unique index `(user_id, content_sha256)`; re-import of identical file returns existing document.

**H2 (matcher)**: Deterministic global one-to-one matcher modeled on ingest import-reconciliation:
- Eligible events: status='accepted' only (pending surfaced separately as "unreviewed")
- Pass 1: stable identifiers — normalized payer PAN or TAN + section
- Pass 2: aggregate grouping by (payerIdentifier, section, FY) before amount comparison (one AIS aggregate ↔ N monthly events)
- Each line and event consumed at most once
- >1 remaining candidate → match_type='ambiguous', no selection
- match metadata: `{matchType: 'exact'|'aggregate'|'approximate'|'ambiguous', amountDeltaPaise, reason}`
- Proximity: |delta| <= max(1% of gross, absolute floor 100_00 paise); zero-amount lines handled explicitly
- ais_lines gains `payer_tan TEXT`; TAN is the primary identifier for salary/TDS sections in 26AS

**H3 (redaction/tokenization)**: Deterministic local tokenization, not blind redaction:
1. Extract text locally (PDF text layer; vision path FORBIDDEN for AIS)
2. Detect+validate PANs/TANs locally with case-insensitive regex (also fix shared redact.ts PAN pattern to be case-insensitive)
3. Replace each with stable opaque tokens `[PAN_1]`, `[TAN_1]`, `[ACCT_1]`
4. Model associates tokens with extracted lines
5. Locally rehydrate validated identifiers post-validation; drop unresolved tokens
6. Sanitize BOTH ai_events observer request AND response before persisting
7. Raw identifiers never in titles/errors/logs/quotes
8. AC reworded: amounts are sent to the model (required for extraction); identifiers are tokenized. Labelled in TASK.md so this is explicit.

**M4/M5 (staging lifecycle)**: Borrow ingest semantics into tax-owned tables. Document states: `uploaded → processing → staged | failed` (+ committed implicit via line promotion). Row-level: `parse_error TEXT`, `include BOOLEAN DEFAULT true`, per-line errors retained for retry; partial documents leave valid rows staged.

**M6 (backup)**: ais_documents + ais_lines → ALL_TABLES; ais_documents → USER_TABLES; ais_lines → LINKED_TABLES (scope through document_id, DROP user_id from lines); document_key → FILE_COLUMNS. Restore order: income_events < ais_documents < ais_lines... wait — FK direction: lines.linked_event_id references income_events, so income_events must restore BEFORE ais_lines. Order in ALL_TABLES: ..., income_events, ..., ais_documents, ais_lines.

**M7 (tenant integrity)**: Drop ais_lines.user_id entirely (scope via document). Add UNIQUE(document_id, line_number), UNIQUE(matched_income_event_id) (one-to-one), CHECK constraints tying match_status to link nullity, ON DELETE RESTRICT on matched_income_event_id (service must un-match first), rematches never overwrite ignored/user-confirmed matches, reconciliation writes transactional.

**M8 (provenance vs reconciliation)**: Explicitly two relationships: sourceKind/sourceId = creation provenance; matchedIncomeEventId = reconciliation link. Promotion writes both atomically; matching an existing event writes only the link. Tests cover rerun/delete/ignore/rematch state consistency.

**M9 (AI optional + storage sensitivity)**: Manual CSV/JSON line import endpoint (`POST /ais/documents/:id/lines/manual` or bulk) works with AI disabled — deterministic path is primary for these structured documents; AI optional fallback after tokenization. Storage: opaque keys, auth-scoped download/delete routes, replacement deletes old object, orphan sweep documented.

**L10**: New AI event kind 'ais_parse' added to BOTH shared AiEventKindSchema and DB ai_event_kind enum (migration) + decomposition test enum count.
**L11**: Line validation pre-promotion: tds>=0, tds<=gross, safe-integer paise, PAN/TAN normalization, rent kind allowed, extracted-FY vs document-FY consistency check, missing-vs-zero distinction, row-level errors instead of invented defaults; promotion requires accrual_date (review supplies; deterministic fallback = last day of document FY).

## Objective
Import AIS/26AS and Form 16 documents through the staged, reviewable import pattern; line-by-line matching against income_events; discrepancies surfaced as reviewable items (never auto-applied); PAN/TAN redaction before any AI call.

## Root Cause
Users can't reconcile what the tax department believes about them against what Compass knows. AIS mismatches often reveal unreported income or wrong TDS credits. These are the most sensitive artifacts Compass handles.

## Scope

### New tables
```sql
ais_documents (
  id UUID PK,
  user_id UUID FK→users ON DELETE CASCADE,
  fy TEXT NOT NULL,
  document_kind TEXT NOT NULL,      -- pgEnum: 'ais' | '26as' | 'form16'
  document_key TEXT NOT NULL,       -- storage key
  content_sha256 TEXT NOT NULL,     -- dedup: UNIQUE (user_id, content_sha256)
  status TEXT NOT NULL DEFAULT 'uploaded',
    -- 'uploaded' | 'processing' | 'staged' | 'failed' (promotion is per-line; no doc-level commit)
  line_count INTEGER,
  parse_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)

ais_lines (
  id UUID PK,
  document_id UUID FK→ais_documents(id) ON DELETE CASCADE,
  -- NO user_id column: always scoped through the owned document
  line_number INTEGER NOT NULL,
  income_kind TEXT NOT NULL,        -- shared IncomeKindSchema incl. rent
  section TEXT,
  payer_name TEXT,
  payer_pan TEXT,                   -- validated ^[A-Z]{5}[0-9]{4}[A-Z]$; tokenized before AI
  payer_tan TEXT,                   -- validated ^[A-Z]{4}[0-9]{5}[A-Z]$; primary for TDS sections
  gross_paise BIGINT NOT NULL CHECK (gross_paise >= 0),
  tds_paise BIGINT NOT NULL DEFAULT 0 CHECK (tds_paise >= 0 AND tds_paise <= gross_paise),
  accrual_date DATE,                -- required at promotion time
  include BOOLEAN NOT NULL DEFAULT true,
  parse_error TEXT,                 -- row-level failure retained for retry
  match_status TEXT NOT NULL DEFAULT 'unmatched',
    -- 'unmatched' | 'matched' | 'ambiguous' | 'ignored' | 'promoted'
  matched_income_event_id UUID FK→income_events(id) ON DELETE RESTRICT,
  match_meta JSONB,                 -- {matchType, amountDeltaPaise, reason}
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (document_id, line_number),
  UNIQUE (matched_income_event_id)  -- one-to-one reconciliation link
  -- CHECKs: matched requires non-null event id; unmatched/ignored/ambiguous require null
)
```

### AI-assisted extraction
Upload AIS PDF → AI extracts structured lines (using existing payslip-parse pattern):
- Redact PAN, Aadhaar, phone, address BEFORE sending to model
- Tool spec for structured extraction: `AIS_EXTRACT_TOOL`
- Parse returns array of AisLine objects
- Store in ais_lines table with pending match_status

### Matching logic (pure, user-triggered)
Match ais_lines against income_events by:
1. income_kind + FY (must match)
2. payer_pan match (if both have PAN)
3. Amount proximity (within 1%)
4. Prefer exact matches over approximate

Unmatched AIS lines → "You have income that Compass doesn't know about. Create an income event?"
Unmatched income_events → "This income wasn't found in AIS. PAN mismatch or unreported?"

### Routes (relative paths in tax plugin)
- `POST /ais/import` — upload document (multipart/form-data; sha256 dedup returns existing doc)
- `GET /ais/documents?fy=` — list documents
- `GET /ais/documents/:id/lines` — list extracted lines (incl. parse errors, include flags)
- `PATCH /ais/lines/:id` — edit/correct a staged line (accrual_date, amounts) pre-promotion
- `POST /ais/lines/:id/match?fy=` — run deterministic matcher (one-to-one, ambiguity-safe)
- `GET /ais/reconciliation?fy=` — matched/unmatched/ambiguous on both sides + TDS totals
- `POST /ais/lines/:id/ignore`
- `POST /ais/lines/:id/create-income-event` — idempotent promotion (claim → insert → link; 409 on concurrent double-promote)
- `POST /ais/documents/:id/lines/manual` — bulk CSV/JSON manual import (AI-disabled path)

### Matching algorithm (deterministic, one-to-one)
1. Eligible events: status='accepted' only; pending listed separately
2. Group AIS lines by (payer_pan|payer_tan, section); group events likewise for aggregate compare
3. Pass 1: identifier match (normalized PAN/TAN + section) within FY
4. Pass 2: amount proximity |delta| <= max(1%, ₹100 floor paise=10_000); TDS as secondary evidence
5. Consume each line/event at most once; >1 candidate → 'ambiguous', no selection
6. Aggregate match: one AIS aggregate ↔ N events summing within tolerance → matchType='aggregate'
7. Never overwrite ignored/user-set matches on re-run

## Dependencies
- 13.4 (income_events — the matching target) — task 090
- 13.10 (advance tax — AIS TDS verification) — task 096

## Plan
- P1: Add ais_documents + ais_lines tables to tax/schema.ts
- P2: Add shared Zod schemas
- P3: Create ais-parse.ts service (AI-based extraction with redaction)
- P4: Create ais-reconciliation.ts service (matching logic + status management)
- P5: Create routes (7 endpoints)
- P6: Wire plugin, backup, barrel, decomposition
- P7: Generate migration; update route snapshots
- P8: Tests: PAN redaction, matching rules, partial document tolerance, create-income-event from line

## Acceptance Criteria
- AC1: AIS documents stored via Storage abstraction; PAN/income detail redacted before any AI call
- AC2: Line-by-line matching against income_events; unmatched on both sides surfaced separately
- AC3: Discrepancies are reviewable (ignore or create income event); never auto-applied
- AC4: TDS credits from AIS shown against recorded TDS in income_events
- AC5: Partial documents don't fail import (missing sections → handled gracefully)
- AC6: PAN validated and never logged raw
- AC7: tables in backup; typecheck + lint + test green

## Non-Goals
- Automatic ITR prefilling
- 26AS vs AIS discrepancy (both map to the same reconciliation format)
- Form 26Q/27Q (TDS returns; too specialized)
