---
sidebar_position: 2
title: Development
---

# Local Development

Set up a local dev environment to run the API, web app, and documentation site.

## Prerequisites

- Node 24 (use `nvm use` in the repo root)
- Postgres and Redis running on external machines — provide their endpoints as `DATABASE_URL` and `REDIS_URL` in `.env`

## Setup

```bash
nvm use                 # Node 24
npm install
npm run db:migrate      # apply database migrations
npm run db:seed         # optional: seed demo user
```

The demo user credentials are `demo@compass.local` / `demo1234`. The demo account is read-only: all write operations are rejected.

## Running the dev server

```bash
npm run dev
```

This starts:
- **API** on http://localhost:3001
- **Web** on http://localhost:5173

The API auto-reloads on file changes. The web app uses Vite's hot module replacement.

## Running docs locally

```bash
npm run docs:dev
```

The docs site runs on http://localhost:3000.

## Type checking and linting

```bash
npm run typecheck       # tsc --noEmit across all workspaces
npm run lint            # eslint . (root)
```

## Tests

Run all tests:

```bash
npm run test
```

Run tests in a single workspace:

```bash
npm run test -w apps/api
```

Run a single test file:

```bash
node --test apps/api/src/services/capital-gains.test.ts
```

Tests are written with Node's built-in `node --test` runner (no Jest/Vitest) and are colocated next to source files as `*.test.ts`.
