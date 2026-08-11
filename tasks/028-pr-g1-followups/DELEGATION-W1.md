# Sonnet Worker Delegation — W1 (production changes)

## Task
028-pr-g1-followups, Workstream W1: two production-file changes (F10 root cause + F12 type fix).
Branch from origin/main; branch name `fix/pr-g1-followups`.

## Approved Plan

### Step 0: Branch setup
```
git fetch origin
git checkout -b fix/pr-g1-followups origin/main
```

### P1 — accounts.ts: add optional `openingDate?` to `createAccount`

File: `apps/api/src/modules/ledger/services/accounts.ts`

Change the function signature from:
```typescript
export async function createAccount(
  db: Db,
  userId: string,
  input: CreateAccount,
): Promise<Account> {
```
to:
```typescript
export async function createAccount(
  db: Db,
  userId: string,
  input: CreateAccount,
  openingDate?: string,
): Promise<Account> {
```

Inside the function body, change:
```typescript
        date: new Date().toISOString().slice(0, 10),
```
to:
```typescript
        date: openingDate ?? new Date().toISOString().slice(0, 10),
```

The function currently passes `date: new Date().toISOString().slice(0, 10)` as a field
inside the `openingBalanceRow(...)` call argument (inside the `if (seedOpening)` block,
around line 242-248). That is the ONE location to update.

No other changes to accounts.ts. The route handler does not pass `openingDate` (omits it,
defaulting to today). Existing behavior is fully preserved for all non-test callers.

### P2 — account-lock.ts: fix callback type (F12)

File: `apps/api/src/lib/account-lock.ts`

Change the `fn` parameter type from `(lockedDb: Db) => Promise<T>` to
`(lockedDb: Omit<Db, '$client'>) => Promise<T>`.

Current signature:
```typescript
export async function withAccountAdvisoryLock<T>(
  db: Db,
  accountId: string,
  fn: (lockedDb: Db) => Promise<T>,
): Promise<T> {
```

New signature:
```typescript
export async function withAccountAdvisoryLock<T>(
  db: Db,
  accountId: string,
  fn: (lockedDb: Omit<Db, '$client'>) => Promise<T>,
): Promise<T> {
```

The internal `return await fn(lockedDb)` call still type-checks because `Db` (which includes
`$client`) is assignable to `Omit<Db, '$client'>`. No other changes to account-lock.ts.

Both callers (`reconciliation-writes.ts:240` and `accounts.ts:364`) only use
`.transaction(...)` on `lockedDb` — neither accesses `$client` — so they compile clean.

## Files and Symbols
- `apps/api/src/modules/ledger/services/accounts.ts`: `createAccount` function signature + one line inside
- `apps/api/src/lib/account-lock.ts`: `withAccountAdvisoryLock` function signature only

## Required Changes
1. In `accounts.ts`: add 4th parameter `openingDate?: string`; replace hard-coded `new Date()...` date with `openingDate ?? new Date()...`
2. In `account-lock.ts`: change `fn: (lockedDb: Db)` to `fn: (lockedDb: Omit<Db, '$client'>)`

## Must Not Change
- Any other file (routes, services, schemas)
- The logic of `createAccount` beyond the date expression
- Anything in `account-lock.ts` beyond the `fn` type annotation

## Acceptance Criteria
- AC1: `npm run typecheck` exits 0
- AC2: `npm run lint` exits 0
- AC3: `createAccount`'s signature in accounts.ts has `openingDate?: string` as 4th param
- AC4: The date used for the opening transaction is `openingDate ?? new Date()...`
- AC5: `withAccountAdvisoryLock`'s `fn` is typed as `(lockedDb: Omit<Db, '$client'>) => Promise<T>`

## Commands
1. `git fetch origin && git checkout -b fix/pr-g1-followups origin/main`
2. Make the two edits described above
3. `npm run typecheck` (from repo root)
4. `npm run lint` (from repo root)

## Required Evidence
- `git status` output (only accounts.ts and account-lock.ts modified, branch = fix/pr-g1-followups)
- Complete diff of both files
- Exact `npm run typecheck` command and literal output including exit code
- Exact `npm run lint` command and literal output including exit code
