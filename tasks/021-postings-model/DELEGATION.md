# Sonnet Worker / backend-engineer Delegation

## Task
021 / 2.1 Postings model — **SP0 only** (pure TypeScript, additive, ships green, ZERO behavior change).

## Iteration 1 (SP0)

### Approved plan slice
Deliver ONLY the pure, DB-free foundation from the approved plan (tasks/021-postings-model/TASK.md, decisions D3/D12/D22 and the SP0 line). NO schema change, NO migration, NO seed change, NO change to any existing service/route/query, NO removal of any column. Nothing in SP0 may alter runtime behavior — it only ADDS new, independently-tested pure code + one new shared schema export.

### Files and symbols (create/modify ONLY these)
1. `packages/shared/src/schemas/money.ts` (or the existing money util file — locate it; CLAUDE.md says `packages/shared/src/money.ts`): ADD and export `SafePaiseSchema = z.number().int().refine(Number.isSafeInteger, "amount exceeds safe integer range")`. Do NOT replace any existing schema's money field with it (that is SP1). Just add the export. Re-export it from `packages/shared/src/index.ts` if that's the barrel convention.
2. NEW FILE `apps/api/src/modules/ledger/services/postings.ts` — PURE module. It MUST NOT import the db, drizzle, the (nonexistent) postings table, or any service with side effects. It may import types from `@compass/shared` (e.g. `ExpenseNecessity`) and `HttpError` from `../../../lib/errors.ts`.
3. NEW FILE `apps/api/src/modules/ledger/services/postings.test.ts` — `node:test` + `node:assert/strict`, DB-free.

### Required exact API surface in postings.ts
```ts
export interface PostingDraft {
  accountId: string;
  amountPaise: number;
  categoryId: string | null;
  necessity: ExpenseNecessity | null;
  note: string;
}
export type SystemKind = "expenses" | "income" | "opening";

// throws HttpError(400,...) if n is not a safe integer
export function assertSafePaise(n: number): void;
// BigInt sum of already-safe amounts; asserts each safe first and the result safe; returns Number
export function sumPaise(amounts: readonly number[]): number;
// throws HttpError(400, "postings do not balance (...)") if BigInt sum of amounts !== 0n; validates each safe
export function assertZeroSum(postings: readonly Pick<PostingDraft, "amountPaise">[]): void;

// Builders return a zero-sum PostingDraft[] and call assertZeroSum before returning.
export function buildOrdinaryPostings(input: {
  accountId: string; amountPaise: number; categoryId: string | null; necessity: ExpenseNecessity | null;
  systemExpensesAccountId: string; systemIncomeAccountId: string;
}): PostingDraft[];
// asset leg: {accountId, amountPaise, categoryId:null, necessity:null, note:""}
// counter leg on Expenses if amountPaise<0 else Income: {accountId:<sys>, amountPaise:-amountPaise, categoryId, necessity, note:""}

export function buildSplitPostings(input: {
  accountId: string;
  splits: ReadonlyArray<{ categoryId: string; amountPaise: number; necessity: ExpenseNecessity | null; note: string }>;
  systemExpensesAccountId: string; systemIncomeAccountId: string;
}): PostingDraft[];
// asset leg amountPaise = sum of split.amountPaise (legacy SIGNED split amounts).
// per split: counter leg on Expenses if split.amountPaise<0 else Income:
//   {accountId:<sys>, amountPaise:-split.amountPaise, categoryId:split.categoryId, necessity:split.necessity, note:split.note}

export function buildTransferPostings(input: {
  fromAccountId: string; toAccountId: string; amountPaise: number /* positive magnitude */; note: string;
}): PostingDraft[];
// from leg {fromAccountId,-amountPaise,null,null,note}; to leg {toAccountId,+amountPaise,null,null,note}. Reject amountPaise<=0.

export function buildOpeningPostings(input: {
  accountId: string; amountPaise: number; systemOpeningAccountId: string;
}): PostingDraft[];
// asset {accountId,+amountPaise,null,null,""}; opening {systemOpeningAccountId,-amountPaise,null,null,""}

// Projection (reconstruct legacy DTO fields from a transaction's postings). systemKindOf returns null for real accounts.
export function classifyShape(postings: readonly PostingDraft[], systemKindOf: (accountId: string) => SystemKind | null):
  "ordinary" | "split" | "transfer" | "opening";
// opening if any posting is systemKind "opening"; else transfer if zero system postings and >=2 real;
// ordinary if exactly 1 real and exactly 1 system; split if exactly 1 real and >=2 system.
export function projectRealLeg(postings: readonly PostingDraft[], systemKindOf: (a: string) => SystemKind | null):
  { accountId: string; amountPaise: number };  // the single real posting; throw if not exactly one real
export function projectCounter(postings: readonly PostingDraft[], systemKindOf: (a: string) => SystemKind | null):
  { categoryId: string | null; necessity: ExpenseNecessity | null };  // the single non-opening system posting; throw if not exactly one
export function projectSplits(postings: readonly PostingDraft[], systemKindOf: (a: string) => SystemKind | null):
  Array<{ categoryId: string | null; amountPaise: number; note: string }>;  // each expenses/income system posting, amountPaise negated to legacy signed
```

### Required tests in postings.test.ts
- assertZeroSum: hand-rolled property loop (no fast-check — it is NOT installed) — seed a small deterministic PRNG; for N iterations build a random balanced set (pick k-1 random safe amounts, set the last to the negation of their sum) and assert `assertZeroSum` does NOT throw; then perturb one amount by +1 or -1 and assert it DOES throw. Include boundary cases with amounts near `+Number.MAX_SAFE_INTEGER` and `-Number.MAX_SAFE_INTEGER` where the BigInt sum is still exactly 0 (accept) and off-by-one (reject). Also assert `assertSafePaise(Number.MAX_SAFE_INTEGER+1)` throws.
- Each builder: returns a zero-sum set (assert `assertZeroSum` passes), correct legs/signs for a worked example (e.g. −200000 expense → asset −200000 + Expenses +200000; split −200000 into −150000/−50000 → asset −200000 + two Expenses legs +150000/+50000; transfer 200000 → −200000/+200000; opening 500000 → +500000/−500000).
- Projection round-trip: build ordinary/split/opening drafts, then `classifyShape` returns the right label and `projectRealLeg`/`projectCounter`/`projectSplits` reconstruct the original inputs (splits negated back to signed). Transfer classifies as "transfer".

### Must NOT change / do
- No import of db/drizzle/schema in postings.ts. No new migration. No edit to any existing service, route, query, schema table, seed, or backup file. Do NOT wire these helpers into any caller (that is SP1). Do NOT replace existing money-field schemas with SafePaiseSchema. No `git add`/commit.

### Acceptance criteria (SP0)
- New pure module + tests added; `SafePaiseSchema` exported additively.
- `npm run typecheck` clean across all workspaces. `npm run lint` clean. `npm run test -w apps/api` green incl. the new `postings.test.ts`; full existing suite unchanged/green (zero behavior change).

### Commands to run and capture (literal output + exit codes)
1. `npm run typecheck`
2. `npm run lint`
3. `npm run test -w apps/api`

### Required evidence (report back)
- Files created/modified (paths).
- Complete `git status --short` and the full `git diff` of the changes.
- The three commands' literal output tails + pass/fail counts + exit codes.
- Any deviation from this spec or blocker.
