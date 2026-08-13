# Task: Fix credit card statement account attribution

## Status
COMPLETE

## Objective
Credit card statements are extracted successfully but attributed to the wrong card
account (all non-SBI statements get `suggested_account_id = Swiggy HDFC` instead of
their own card). Fix attribution so each statement is matched to the card whose name
best matches the email subject.

## Root Cause
`processStatement` (apps/extractor/src/index.ts ~line 162) iterates `loadCreditCards`
results in undefined heap order and returns as soon as ANY password opens the PDF.

Indian banks issue encrypted statement PDFs locked with a shared per-issuer formula
(typically the cardholder DOB: DDMMYYYY). This user has the same password for all HDFC
cards and the same for both Axis cards. Whichever card appears first in the heap scan
wins for every statement from that bank.

Production evidence (prod-event-log-1.md):
- Diners Black, Tata Neu, Airtel Axis, Axis Rewards → all attributed to Swiggy HDFC (id: 12d4b791)
- SBI PhonePe → attributed correctly (SBI uses a different password format)
- `loadCreditCards` query has no ORDER BY

## Scope
- `apps/extractor/src/db.ts` — `loadCreditCards`: add `institution` to the returned
  CreditCardRef so the scorer can use it as a tiebreaker
- `apps/extractor/src/index.ts` — `processStatement`: sort `cards` by subject-match
  score before the password loop; update `CreditCardRef` usage accordingly

## Dependencies
- None

## Codex Plan Review Findings (review-1.md)
- `CreditCardRef` is defined and exported in db.ts — additive, safe.
- Single caller of `loadCreditCards` — adding `institution` won't break anything.
- `email.subject` is correct (non-null string on ParsedEmail).
- Generic tokens (`bank`, `credit`, `card`, `statement`, `your`, `account`) must be
  excluded (stopwords) to prevent false matches from common words in names.
- Tokenization must be alphanumeric split (`/[^a-zA-Z0-9]+/`), not whitespace only,
  to handle punctuation-attached tokens like `statement:`.
- Secondary sort key must be original index (explicit), not just relying on runtime
  stable-sort guarantee, so tiebreaks are reproducible.
- Extract `rankCardsBySubject` as a pure exported function for testability.
- Unit tests required for the ranking function (production examples + edge cases).
- P3 must also fix comments in `processStatement` JSDoc and `StatementOutcome.accountId`
  (both currently say "the password that decrypts it identifies the card" — wrong after this fix).
- [All resolved in revised plan below]

## Plan
- P1: In `loadCreditCards` (db.ts ~line 100):
  - Add `a.institution` (coalesce to `''`) to the SELECT and pool.query row type
  - Add `institution: string` to `CreditCardRef`
  - Fix the inaccurate comment that says "HDFC embeds the card's last-4 in the password"
- P2: Extract a pure exported function `rankCardsBySubject` in index.ts (or a new
  `statement-rank.ts` file):
  ```ts
  export function rankCardsBySubject<T extends { name: string; institution: string }>(
    cards: T[],
    subject: string,
  ): T[]
  ```
  Tokenization: `s.toLowerCase().split(/[^a-zA-Z0-9]+/).filter(Boolean)`
  Stopwords to exclude from scoring: `bank`, `credit`, `card`, `statement`, `your`,
  `account`, `the`, `for`, `and`, `of`, `a`.
  Score = (distinct matched tokens from name) + (distinct matched tokens from institution).
  Sort descending by score; secondary sort by original index (explicit, for reproducibility).
  Returns a new array; does not mutate input.
- P3: In `processStatement`, replace `for (const card of cards)` with
  `for (const card of rankCardsBySubject(cards, email.subject))`.
- P4: Fix comments — `processStatement` JSDoc and `StatementOutcome.accountId` JSDoc:
  replace "the password that decrypts it identifies the card" with an accurate description
  (subject-ranking selects the candidate, password merely opens the PDF).
- P5: Add unit tests in a new `apps/extractor/src/statement-rank.test.ts`:
  - Production cases: "Swiggy HDFC Bank Credit Card Statement" → Swiggy first
  - Production cases: "Diners Black Credit Card Statement" → Diners first
  - Production cases: "Airtel Axis Bank Mastercard" → Airtel Axis first over plain Rewards
  - Edge case: generic words only (all zero score) → original order preserved
  - Edge case: subject with punctuation ("Bank-card:") → tokenizes correctly
  - Edge case: empty subject → all score 0 → original order preserved
  - Edge case: card whose name partially matches (stopword only) → score 0

## Acceptance Criteria
- AC1: `loadCreditCards` returns `institution` on each row
- AC2: `processStatement` calls `rankCardsBySubject(cards, email.subject)` before the loop
- AC3: Score uses both card name and institution words, excluding stopwords
- AC4: Secondary sort by original index makes tiebreaks reproducible
- AC5: `rankCardsBySubject` is a pure exported function with its own test file
- AC6: All production attribution cases pass as unit tests
- AC7: `npm run typecheck` exits 0
- AC8: `npm run test` non-DB tests pass (no regressions)

## Verification
- T1: `npm run typecheck` — zero errors
- T2: `npm run test` — all non-DB tests pass
- T3: Manual trace: for email subject "Your HDFC Bank - Diners Black Credit Card Statement":
  - Card "Diners Club International" (institution HDFC) → words "Diners"(✓), "Club", "International" → score includes "Diners"
  - Card "Swiggy" (institution HDFC) → words "Swiggy" → "Swiggy" not in subject → score 0 (just institution word "HDFC" may match both equally, but "Diners" tips it)
  - Diners Card sorts first ✓

## Non-Goals
- Not changing the fallback (unencrypted / no password match) path
- Not implementing multi-password-match disambiguation (the sort heuristic is sufficient)
- Not fixing the two deferred ingestions (Amazon Pay ICICI, SBI OCTANE — separate issue)
- Not retroactively re-attributing already-stored extracted_transactions (requires reprocess)
