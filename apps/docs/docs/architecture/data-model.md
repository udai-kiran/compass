---
sidebar_position: 2
title: Data Model
---

# Data Model

Compass uses Drizzle ORM with PostgreSQL. The schema is defined in `apps/api/src/db/schema.ts`, and migrations are stored in `apps/api/drizzle/*.sql`.

## Schema workflow

1. **Edit schema** — modify `apps/api/src/db/schema.ts`
2. **Generate migrations** — run `npm run db:generate` to create a Drizzle migration file (SQL)
3. **Review the SQL** — check `apps/api/drizzle/NNNN_*.sql` for correctness
4. **Apply migrations** — run `npm run db:migrate` to apply pending migrations

## Key rules

### User scoping

Every user-facing table includes a `user_id` column and is scoped to that user. Services filter all queries by the requesting user's ID (`req.session!.userId`). There is no admin/owner-privileged data path; all data is user-scoped.

### App role

**Always migrate as the `compass` app role, not `postgres`.** If tables are created as `postgres`, the app will hit "permission denied" errors. A repair script exists for fixing table ownership if this happens.

### Backup coverage

Every schema table **must** be listed in `ALL_TABLES` or `USER_TABLES` in `apps/api/src/services/backup.ts`, or `backup.test.ts` will fail. Add new tables there in the same commit as the schema change.

## Domain notes

### Mutual-fund positions

A mutual-fund position is keyed by **scheme + folio**, not scheme alone. Units are per house and folio. When tracking holdings, use the scheme identifier plus the folio number to uniquely identify a position.

### Money in the database

All amounts are stored as integer paise (minor units), never as float rupees. Use the money utilities in `packages/shared/src/money.ts` when converting between rupees and paise or formatting for display.

### Transfer detection

The system automatically detects and links transfers between accounts within a time window. This is handled by the transfer-detection service.
