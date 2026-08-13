# Sonnet Worker Delegation — Task 042

## Task
042-statement-attribution-fix

## Approved Plan
- P1: Add `institution` to `CreditCardRef` and `loadCreditCards` in db.ts; fix comment
- P2: Implement pure exported `rankCardsBySubject` function (new file or top of index.ts)
- P3: Use `rankCardsBySubject` in `processStatement` before the password loop
- P4: Fix inaccurate JSDoc comments in `processStatement` and `StatementOutcome`
- P5: Add unit tests in `statement-rank.test.ts`

## Files and Symbols
- `apps/extractor/src/db.ts`
  - Interface `CreditCardRef` (line ~86): add `institution: string`
  - `loadCreditCards` query (line ~100): add `coalesce(a.institution, '') as institution` to SELECT
  - `loadCreditCards` row type: add `institution: string`
  - `loadCreditCards` return map: add `institution: r.institution`
  - Fix comment "issuers like HDFC embed the card's own last-4" — remove, replace with accurate description
- `apps/extractor/src/index.ts`
  - `StatementOutcome.accountId` JSDoc: fix "the card whose password opened the PDF" to be accurate
  - `processStatement` JSDoc: fix "the password that decrypts it identifies the card"
  - `processStatement` body (~line 161): replace `for (const card of cards)` with ranked array
- New file `apps/extractor/src/statement-rank.ts` — export `rankCardsBySubject`
- New file `apps/extractor/src/statement-rank.test.ts` — unit tests

## Required Changes

### 1. `apps/extractor/src/db.ts`

Add `institution: string` to `CreditCardRef`:
```ts
export interface CreditCardRef {
  id: string;
  name: string;
  institution: string;
  statementPasswordEnc: string;
}
```

Update query and mapping:
```ts
const res = await pool.query<{ id: string; name: string; institution: string; statement_password_enc: string }>(
  `select a.id, a.name, coalesce(a.institution, '') as institution,
          coalesce(cd.statement_password_enc, '') as statement_password_enc
     from accounts a
     left join card_details cd on cd.account_id = a.id
    where a.user_id = $1 and a.type = 'credit_card' and a.archived_at is null`,
  [userId],
);
return res.rows.map((r) => ({
  id: r.id,
  name: r.name,
  institution: r.institution,
  statementPasswordEnc: r.statement_password_enc,
}));
```

Replace the comment about HDFC embedding last-4 with:
```
 * Credit-card accounts + their stored statement password, to open a statement PDF.
 * The password is stored per-card in card_details.statement_password_enc. Banks often
 * use a shared formula (e.g. the cardholder's DOB) for all cards of the same issuer,
 * so multiple cards can share the same password. The institution field is used by the
 * ranking heuristic to match subject lines to the right card when passwords are shared.
```

### 2. New file `apps/extractor/src/statement-rank.ts`

```ts
/**
 * Rank credit cards by how closely their name and institution match the email
 * subject. Used to select the right card when multiple cards share the same
 * statement PDF password (common with Indian banks that use a DOB-based formula
 * for all cards of the same issuer).
 */

const STOPWORDS = new Set([
  "bank", "credit", "card", "statement", "your", "account",
  "the", "for", "and", "of", "a", "an", "in", "on", "at",
]);

/** Split a string into lowercase alphanumeric tokens, excluding stopwords. */
function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-zA-Z0-9]+/)
    .filter((w) => w.length > 0 && !STOPWORDS.has(w));
}

/**
 * Return a copy of `cards` sorted so the card whose name + institution words
 * best match the email subject appears first. Equal-score cards retain their
 * original order (stable, using explicit index comparison).
 */
export function rankCardsBySubject<T extends { name: string; institution: string }>(
  cards: T[],
  subject: string,
): T[] {
  const subjectTokens = new Set(tokenize(subject));
  const scored = cards.map((card, originalIndex) => {
    const nameTokens = new Set(tokenize(card.name));
    const instTokens = new Set(tokenize(card.institution));
    const nameScore = [...nameTokens].filter((t) => subjectTokens.has(t)).length;
    const instScore = [...instTokens].filter((t) => subjectTokens.has(t)).length;
    return { card, score: nameScore + instScore, originalIndex };
  });
  scored.sort((a, b) => b.score - a.score || a.originalIndex - b.originalIndex);
  return scored.map((s) => s.card);
}
```

### 3. `apps/extractor/src/index.ts`

Fix `StatementOutcome.accountId` JSDoc (line ~109):
Change: `/** the card whose password opened the PDF; null for an unencrypted statement */`
To:     `/** the card whose name best matched the subject and whose password opened the PDF; null for an unencrypted statement */`

Fix `processStatement` JSDoc (lines ~99-104):
Change: `"the password that decrypts it identifies the card"` → `"subject-line ranking selects the likely card first; the password confirms the PDF can be opened"`

In `processStatement` body, add import and change the loop:
```ts
import { rankCardsBySubject } from "./statement-rank.ts";
// ...
const cards = await loadCreditCards(pool, userId);
for (const card of rankCardsBySubject(cards, email.subject)) {
  // rest of loop unchanged — only the variable name changed from `card` (same name)
```

### 4. New file `apps/extractor/src/statement-rank.test.ts`

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { rankCardsBySubject } from "./statement-rank.ts";

const CARDS = [
  { id: "1", name: "Swiggy",                  institution: "HDFC" },
  { id: "2", name: "Diners Club International", institution: "HDFC" },
  { id: "3", name: "Tata Neu",                  institution: "HDFC" },
  { id: "4", name: "Axis Airtel",               institution: "Axis" },
  { id: "5", name: "Rewards",                   institution: "Axis" },
  { id: "6", name: "SBI PhonePe",               institution: "SBI" },
];

describe("rankCardsBySubject", () => {
  it("puts Swiggy first for its own subject", () => {
    const ranked = rankCardsBySubject(CARDS, "Your HDFC Bank - Swiggy HDFC Bank Credit Card Statement - July-2026");
    assert.equal(ranked[0]!.id, "1");
  });

  it("puts Diners first for Diners Black subject", () => {
    const ranked = rankCardsBySubject(CARDS, "Your HDFC Bank - Diners Black Credit Card Statement - July-2026");
    assert.equal(ranked[0]!.id, "2");
  });

  it("puts Tata Neu first for Tata Neu subject", () => {
    const ranked = rankCardsBySubject(CARDS, "Your HDFC Bank - Tata Neu Infinity HDFC Bank Credit Card Statement - July-2026");
    assert.equal(ranked[0]!.id, "3");
  });

  it("puts Axis Airtel first for Airtel Axis subject", () => {
    const ranked = rankCardsBySubject(CARDS, "Airtel Axis Bank Mastercard Credit Card Statement ending XX23 - July 2026");
    assert.equal(ranked[0]!.id, "4");
  });

  it("puts Rewards first for Axis Rewards subject", () => {
    const ranked = rankCardsBySubject(CARDS, "Your Axis Bank Rewards Credit Card ending XX86 - July 2026");
    assert.equal(ranked[0]!.id, "5");
  });

  it("puts SBI PhonePe first for SBI PhonePe subject", () => {
    const ranked = rankCardsBySubject(CARDS, "Your PhonePe SBI Card SELECT Monthly Statement -Jul 2026");
    assert.equal(ranked[0]!.id, "6");
  });

  it("preserves original order when all scores are zero (empty subject)", () => {
    const ranked = rankCardsBySubject(CARDS, "");
    assert.deepEqual(ranked.map((c) => c.id), CARDS.map((c) => c.id));
  });

  it("preserves original order when all scores are zero (generic subject)", () => {
    const ranked = rankCardsBySubject(CARDS, "Bank Credit Card Statement");
    // all stopwords → all score 0 → original order preserved
    assert.deepEqual(ranked.map((c) => c.id), CARDS.map((c) => c.id));
  });

  it("handles punctuation-attached tokens in subject", () => {
    const ranked = rankCardsBySubject(CARDS, "Swiggy-HDFC Bank Credit:Card Statement!");
    assert.equal(ranked[0]!.id, "1");
  });

  it("is case-insensitive", () => {
    const ranked = rankCardsBySubject(CARDS, "DINERS BLACK CREDIT CARD STATEMENT");
    assert.equal(ranked[0]!.id, "2");
  });

  it("returns a new array and does not mutate input", () => {
    const input = [...CARDS];
    rankCardsBySubject(input, "Rewards");
    assert.deepEqual(input.map((c) => c.id), CARDS.map((c) => c.id));
  });
});
```

## Must Not Change
- Any other file in the repository
- The fallback path in `processStatement` (unencrypted PDF handling at lines ~183-190)
- The `saveResults`, `processStatement` outer control flow, job worker loop

## Acceptance Criteria
- AC1: `loadCreditCards` returns `institution` on each row
- AC2: `processStatement` calls `rankCardsBySubject(cards, email.subject)` before the loop
- AC3: Stopwords excluded; alphanumeric tokenization
- AC4: Secondary sort by original index
- AC5: All 6 production examples pass as unit tests
- AC6: `npm run typecheck` exits 0
- AC7: `npm run test -w apps/extractor` passes (all non-DB tests)

## Commands
1. Implement all changes per Required Changes above
2. Run `npm run typecheck 2>&1; echo "EXIT:$?"`
3. Run `npm run test -w apps/extractor 2>&1; echo "EXIT:$?"`

## Required Evidence
- Exact diff of each changed/created file
- Full typecheck output + exit code
- Full extractor test output + exit code (pass/fail counts, test names)
- Confirmation no other files were touched
