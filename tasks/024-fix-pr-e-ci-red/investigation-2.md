# Investigation 2 — PE7 merchant case mismatch (merchant normalisation)

## Files inspected

- `apps/api/src/modules/ledger/services/merchants.ts`
- `apps/api/src/modules/ledger/services/transactions.ts` (lines 399–412)
- `apps/api/src/modules/ledger/services/search.ts`
- `apps/api/src/modules/ledger/services/postings-pr-e-parity.test.ts` (lines 495–531)
- `apps/api/src/modules/ledger/services/epf-contributions.test.ts` (lines 103–131)
- `apps/api/src/modules/ledger/services/recurring.ts` (lines 288–350)
- `apps/api/src/modules/ledger/services/recurring.test.ts` (lines 187–230)
- `apps/api/src/modules/ledger/services/transfers.test.ts` (lines 131–142)
- `apps/api/src/modules/planning/services/postings-planning-parity.test.ts` (lines 538, 661)
- `packages/shared/src/schemas/ledger.ts`
- git history via `git log`, `git show`, `git diff`

## Files changed

None.

---

## Question 1 — Where does the case transform happen?

### The function

`apps/api/src/modules/ledger/services/merchants.ts`, lines 11–29:

```ts
// line 11-15
function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/(^|\s)\S/g, (c) => c.toUpperCase());
}

// line 17-29  (docstring at 17)
/** Built-in cleanup: "POS 402911 AMAZON PAY INDIA BLR" → "Amazon". */
export function heuristicNormalize(raw: string): string {
  const tokens = raw
    .split(/[\s\-/*_|:;,]+/)
    .map((t) => t.trim())
    .map((t) => (t.includes("@") ? t.split("@")[0]! : t))
    .filter(Boolean)
    .filter((t) => !/^[\d Xx*#]+$/.test(t))
    .filter((t) => !/\d{4,}/.test(t))
    .filter((t) => !NOISE_TOKENS.has(t.toLowerCase()));
  if (tokens.length === 0) return titleCase(raw.trim()).slice(0, 60) || raw.trim();
  return titleCase(tokens.slice(0, 3).join(" "));
}
```

`"PE7Merchant"` is one token, no spaces, no noise token match, no `\d{4,}` run (only one digit `7`). It passes all filters, so `titleCase` is applied to the join of one token:

1. `.toLowerCase()` → `"pe7merchant"`
2. `.replace(/(^|\s)\S/g, c => c.toUpperCase())` → `"Pe7merchant"` (regex matches only `p` at position 0; there are no spaces)

### Where it is called (ON WRITE)

`apps/api/src/modules/ledger/services/transactions.ts`, lines 399–410:

```ts
// normalize the merchant; the category is whatever the caller supplied
// (manual entry now, AI-assisted categorization later)
const merchantRulesList = await getMerchantRules(db, userId);
const merchant = input.merchant ? normalizeMerchant(input.merchant, merchantRulesList) : "";
// ...
.values({ ...input, merchant, userId })
```

`normalizeMerchant` (merchants.ts:34) falls through to `heuristicNormalize` when no user rules match. The normalized string is inserted into the DB. The DB row therefore stores `"Pe7merchant"`.

### Read path (no transform)

`apps/api/src/modules/ledger/services/search.ts`, lines 33–35:

```ts
transactions: (txs.rows as Array<{ id: string; merchant: string; amount_paise: string; date: string }>).map((r) => ({
  ...
  merchant: r.merchant,
```

The read path returns `r.merchant` verbatim. There is no re-transform on read.

### Conclusion: the transform is ON WRITE. The DB row itself holds `"Pe7merchant"`.

### DB verification note

The test cleans up (`t.after(() => cleanupUser(userId))`), so no persistent rows survive for direct inspection. The transform was verified by replaying the exact `heuristicNormalize` logic in Node.js (see Commands section below). The logic is deterministic and has no DB-side component.

---

## Question 2 — Is this normalisation intended or accidental?

**Intended.** Evidence:

1. **Docstring** at merchants.ts:17 explicitly describes the feature purpose:
   ```ts
   /** Built-in cleanup: "POS 402911 AMAZON PAY INDIA BLR" → "Amazon". */
   ```

2. **Initial build commit message** (`90ee575`, July 2026) lists "merchant normalization" as a delivered capability under the Import section.

3. **`epf-contributions.test.ts` lines 105–110** contain a comment that explicitly acknowledges the normalisation and explains the test fixture was designed around it:
   ```ts
   // Deliberately no digits/UUID in the employer string: createTransaction runs
   // the merchant through normalizeMerchant/heuristicNormalize, which strips
   // long digit runs (reference-number heuristic) — a raw randomUUID() employer
   // would come back mangled by that pre-existing, unrelated normalization, not
   // by anything under test here.
   const employer = "Acme Corp Employer";
   ```
   This is the established pattern: tests that call `createTransaction` must use merchant strings that survive normalisation.

4. No comment, test, or PRD note treats `titleCase` as unintentional or a bug.

---

## Question 3 — Was PE7 ever passing?

**No. PE7 was born failing.**

Timeline from git log:

| Commit | Date | What happened |
|--------|------|---------------|
| `90ee575` | 2026-07-14 | Initial build — `apps/api/src/services/merchants.ts` created with `titleCase` + `heuristicNormalize` + `normalizeMerchant`. Normalisation active from day one. |
| `41845e5` | later | Module migration — file moved to `apps/api/src/modules/ledger/services/merchants.ts`, logic unchanged (4-line diff). |
| `2253623` | 2026-08-10 | PR-E merge — `postings-pr-e-parity.test.ts` created (742 lines, this commit is the file's entire history). PE7 asserting `"PE7Merchant"` introduced here. |

The normalisation (`90ee575`) predates PR-E (`2253623`) by several weeks. The test file was created in the very commit that is the failing CI run. PE7 has no prior history to be green in.

```
$ git log --oneline --follow -- apps/api/src/modules/ledger/services/merchants.ts
41845e5 refactor(api): migrate ledger, credit and investments into modules/ (roadmap 1.1-1.3)
a58a30f fix: address pipeline review — resilience, idempotency, safety
90ee575 Build Compass: full ledger, budgets, goals, cards, insights, AI module

$ git log --oneline --follow -- apps/api/src/modules/ledger/services/postings-pr-e-parity.test.ts
2253623 feat(api): postings model PR-E — convert remaining readers to postings (roadmap 2.1) (#174)
```

---

## Question 4 — Does the same normalisation affect other tests?

Each test asserting a `.merchant` value was checked:

| Test file:line | Merchant asserted | Normalised result | Affected? | Reason |
|----------------|------------------|-------------------|-----------|--------|
| `transfers.test.ts:141-142` | `"Move to savings"` | `"Move To Savings"` | **No** | Tests pure function `buildTransferLegs`, never calls `createTransaction` |
| `recurring.test.ts:215` | `` `Test ${kind}` `` e.g. `"Test none"` | `"Test None"` | **No** | `recurring.ts` inserts via `trx.insert(transactions).values(...)` directly (lines 288, 309, 341, 347), bypassing `normalizeMerchant` entirely |
| `epf-contributions.test.ts:131` | `"Acme Corp Employer"` | `"Acme Corp Employer"` | **No** | Idempotent under normalisation (already title-case, no noise tokens) — and the comment at line 105 says this was deliberate |
| `planning/postings-planning-parity.test.ts:661` | `"Netflix"` | `"Netflix"` | **No** | Idempotent |
| `planning/postings-planning-parity.test.ts:538` | `"Merchantx"` | `"Merchantx"` | **No** | Idempotent |
| `imports.test.ts:25` | `"Swiggy Bangalore"` | n/a | **No** | Asserts the OUTPUT of `heuristicNormalize` itself, not a round-trip through `createTransaction` |
| `postings-pr-e-parity.test.ts:528` | `"PE7Merchant"` | `"Pe7merchant"` | **YES** | The only affected test |

**PE7 is the only symptom.**

---

## Commands run

```bash
# Replay heuristicNormalize on relevant strings (exit 0)
node --eval "
function titleCase(s) {
  return s.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());
}
const NOISE_TOKENS = new Set([
  'pos','upi','imps','neft','rtgs','ach','ecs','atm','ecom','vps','ib','mb',
  'payment','pay','payments','pvt','ltd','limited','india','in','txn','ref',
  'autopay','mandate','si','billpay','recharge','purchase','card',
]);
function heuristicNormalize(raw) {
  const tokens = raw
    .split(/[\s\-/*_|:;,]+/)
    .map(t => t.trim())
    .map(t => (t.includes('@') ? t.split('@')[0] : t))
    .filter(Boolean)
    .filter(t => !/^[\d Xx*#]+$/.test(t))
    .filter(t => !/\d{4,}/.test(t))
    .filter(t => !NOISE_TOKENS.has(t.toLowerCase()));
  if (tokens.length === 0) return titleCase(raw.trim()).slice(0, 60) || raw.trim();
  return titleCase(tokens.slice(0, 3).join(' '));
}
console.log('PE7Merchant ->', heuristicNormalize('PE7Merchant'));
console.log('Test none ->', heuristicNormalize('Test none'));
console.log('Test bill ->', heuristicNormalize('Test bill'));
console.log('Move to savings ->', heuristicNormalize('Move to savings'));
console.log('Acme Corp Employer ->', heuristicNormalize('Acme Corp Employer'));
console.log('Netflix ->', heuristicNormalize('Netflix'));
console.log('Merchantx ->', heuristicNormalize('Merchantx'));
"
```

Output:
```
PE7Merchant -> Pe7merchant
Test none -> Test None
Test bill -> Test Bill
Move to savings -> Move To Savings
Acme Corp Employer -> Acme Corp Employer
Netflix -> Netflix
Merchantx -> Merchantx
```
Exit code: 0

```bash
git -C /home/udai/common/compass log --oneline --follow -- apps/api/src/modules/ledger/services/merchants.ts
# 41845e5 refactor(api): migrate ledger, credit and investments into modules/ (roadmap 1.1-1.3)
# a58a30f fix: address pipeline review — resilience, idempotency, safety
# 90ee575 Build Compass: full ledger, budgets, goals, cards, insights, AI module

git -C /home/udai/common/compass log --oneline --follow -- apps/api/src/modules/ledger/services/postings-pr-e-parity.test.ts
# 2253623 feat(api): postings model PR-E — convert remaining readers to postings (roadmap 2.1) (#174)

git -C /home/udai/common/compass show 2253623 --stat | head -15
# (confirms postings-pr-e-parity.test.ts added with 742 lines in the PR-E commit)

git -C /home/udai/common/compass show 90ee575 --stat | head -5
# (confirms initial build commit, 2026-07-14, includes merchant normalisation)
```

---

## Assessment

**Correct fix: (iii) — the test expectation at line 528 is wrong. The normalisation is intended.**

The test at `postings-pr-e-parity.test.ts:528` asserts:
```ts
assert.equal(results.transactions[0]!.merchant, "PE7Merchant");
```

`createTransaction` normalises the merchant on write via `normalizeMerchant` → `heuristicNormalize` → `titleCase`, so the DB stores `"Pe7merchant"`. The correct expectation is `"Pe7merchant"`.

Reasoning:
1. `heuristicNormalize` is intentional, present since the initial commit, and has its own docstring and commit-message mention.
2. The `epf-contributions.test.ts` comment proves the team knows about this and designs test fixtures accordingly.
3. The transform happens on write. Removing it from the production path would be a wider behavioural change affecting all merchants stored via `createTransaction`.
4. PE7 was never green. The wrong expectation was introduced in the same PR-E commit that is the failing CI run.

**The one-line fix** is at `postings-pr-e-parity.test.ts:528`:
```
- assert.equal(results.transactions[0]!.merchant, "PE7Merchant");
+ assert.equal(results.transactions[0]!.merchant, "Pe7merchant");
```

**Confidence: high.** The data flow is fully traced end-to-end with no ambiguity.

### Unresolved risks

None for the PE7 fix. Latent note: `"Test none"` and `"Move to savings"` would be mangled by `heuristicNormalize` if they ever flowed through `createTransaction`, but currently they do not (recurring.ts inserts directly; transfers.test.ts tests a pure function). Outside scope of this investigation.
