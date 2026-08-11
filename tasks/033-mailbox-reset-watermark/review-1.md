## Review findings

### 1. Never-synced mailboxes do not fully re-fetch

High priority: the plan is only correct when `uid_validity` is non-null.

The ingestor constructs a stored watermark only when both columns are non-null:

```ts
mb.uidValidity !== null && mb.lastUid !== null
  ? { uidValidity: mb.uidValidity, lastUid: mb.lastUid }
  : null
```

For a never-synced mailbox, resetting only `last_uid` produces `(uid_validity=null, last_uid=0)`. This is converted to `stored=null`, so `planSync()` baselines to `uidNext - 1` and fetches no history.

The design needs an explicit reset state that works without a known UID validity—for example, teaching the ingestor that `last_uid=0` means fetch from UID 1 using the currently opened mailbox’s UID validity. Add tests for:

- Existing matching `uid_validity` → fetch from 1.
- `uid_validity=null`, `last_uid=null` before reset → fetch from 1 after reset.
- Stored UID validity differs from the server after reset → still fetch the current mailbox from 1.

Simply setting `uid_validity` to null would not work.

### 2. Concurrent sync can lose the reset

If a sync has already loaded the old watermark, the endpoint may set `last_uid=0`, after which that in-flight sync can overwrite it via `saveWatermark()` with its old/high watermark. The promised “next sync” would then not re-fetch history.

The implementation needs serialization or an optimistic condition/version so an in-flight sync cannot overwrite a newer reset request.

### 3. Ownership/security approach is sound

Filtering by both mailbox ID and `userId` is the correct authorization boundary:

```ts
and(eq(mailboxAccounts.id, id), eq(mailboxAccounts.userId, userId))
```

Returning the same 404 for nonexistent and foreign-owned mailboxes avoids ownership enumeration. Existing module-wide authentication, demo-write protection, CSRF protection, and write-rate limiting should cover the POST route.

Tests should nevertheless prove that a second user receives 404 and the owner’s watermark remains unchanged.

### 4. Missing tests

The task should not rely only on typecheck and regression tests. Add route/service coverage for:

- Successful reset changes `last_uid` to 0.
- `uid_validity` remains unchanged.
- Never-synced/null-validity behavior.
- Unknown mailbox returns 404.
- Another user’s mailbox returns 404 without mutation.
- Unauthenticated request returns 401.
- Demo session and hostile Origin are rejected consistently with existing write routes.
- The route returns exactly `{ ok: true }`.

`apps/api/src/modules/ingest/plugin.test.ts` does not require updating: it intentionally checks one representative route per route file. The generic route-security assertions will include the new route automatically, though an explicit write-bucket assertion would improve clarity.

An ingestor test is also required because the null-validity fix necessarily affects watermark interpretation, not just the API.

### 5. Route conventions

The proposed route follows existing conventions in `mailboxes.ts`:

- `app.withTypeProvider<ZodTypeProvider>()`
- Inline UUID params schema
- Inline `{ ok: true }` response schema
- `req.session!.userId`
- Service-level ownership filtering
- `HttpError(404, "Mailbox not found")`
- HTTP 200 rather than 204, matching DELETE

Place the static `/api/mailboxes/sync` route before parameterized mailbox routes for readability and to avoid future ambiguity, although Fastify normally prioritizes static routes correctly.

The main blocker to approving the plan is the incorrect never-synced/null-`uid_validity` behavior, followed by the reset-versus-active-sync race.