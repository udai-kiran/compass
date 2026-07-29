---
sidebar_position: 5
title: Conventions
---

# Conventions

These guardrails ensure code quality and consistency across Compass.

## Money

**All amounts are integer paise (minor units), never float rupees.** This prevents floating-point rounding errors.

Use `packages/shared/src/money.ts` utilities:
- `rupeesToPaise(rupees)` — convert rupees to paise
- `paiseToRupees(paise)` — convert paise to rupees
- `formatINR(paise)` — format paise as a user-facing string in `en-IN` INR

Example:
```ts
import { rupeesToPaise, formatINR } from '@compass/shared';

const paise = rupeesToPaise(100); // 10000
console.log(formatINR(paise));    // ₹100.00
```

## Transaction categorization

**Do not add auto-categorization or rules engines.** Category is manual; AI is assist-only and only in Phase 7.

Users set category manually. The AI module offers suggestions (optional, read-only), but the user always chooses. This is intentional: we do not want Compass to silently miscategorize transactions.

## Code organization

### Backend — services and repositories

- Write new business logic in `services/*.ts`, not `repositories/`.
- `repositories/` is nearly empty (only `users.ts`) — it's a legacy pattern we don't use.
- A service takes a `Db | Tx` handle and `userId`, queries the DB, and returns domain objects.

### Relative imports and TypeScript

The backend runs on Node with native type stripping — there is **no build step**. Relative imports must include the `.ts` extension:

```ts
import { postJson } from "./http.ts";
import { listTransactions } from "../services/transactions.ts";
```

### AI SDK imports

ESLint prohibits importing `@anthropic-ai/*`, `openai`, or `ollama` outside `packages/ai`. This keeps AI fully optional and isolated. The package uses plain `fetch` instead of vendor SDKs.

## Git practices

- **Stage files explicitly for commits.** Never use `git add -A` or `git add .` — the working tree may contain private artifacts (PDFs, screenshots, `data/`) that must never be committed.
- Commit messages end with the trailer: `Co-Authored-By: Claude <email>`

## Mutual-fund positions

A position is keyed by **scheme + folio**, not scheme alone. Units are per house and folio.

When tracking holdings or comparing positions across statements, use both the scheme identifier and folio number.

## Testing

Tests are colocated next to source files as `*.test.ts` and run with Node's built-in `node --test` (no Jest/Vitest).

## Admin model

**There is no admin/owner-privileged data path.** Every user-facing table is `user_id`-scoped. Services filter all queries by `req.session!.userId`. An operator/admin has the same permissions as any other user.
