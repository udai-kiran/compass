-- Repair: give the Compass app role ownership of every table it needs.
--
-- Root cause of "permission denied for table <x>": the API connects as the
-- `compass` role, and it can only touch tables it owns. Migrations are meant to
-- run as `compass` (so new tables are compass-owned), but any migration that was
-- run as the `postgres` superuser instead created tables owned by `postgres`,
-- which `compass` then has no rights on. This surfaced first on
-- `mailbox_credentials` (saving Google OAuth creds → 500), but affects every
-- table created out-of-band as postgres.
--
-- This script reassigns any public table/sequence/type NOT already owned by the
-- app role back to it. Ownership (not just GRANT) is required so future
-- migrations, which run as `compass`, can ALTER these objects. Enum types matter
-- too: `ALTER TYPE ... ADD VALUE` can only be run by the type's owner, so an enum
-- created out-of-band as postgres blocks any later migration that extends it
-- (this surfaced on `extracted_txn_status` when migration 0038 added 'duplicate').
--
-- Run as a SUPERUSER (postgres), it is idempotent:
--   psql "$DATABASE_URL_SUPERUSER" -f apps/api/scripts/repair-table-ownership.sql
-- e.g. docker exec -i <pg-container> psql -U postgres -d compass -f - < this file
--
-- Prevention: always run `npm run db:migrate` / `db:bootstrap` with a
-- DATABASE_URL whose role is `compass`, never the postgres superuser.

\set app_role compass

DO $$
DECLARE
  app_role text := 'compass';
  obj record;
BEGIN
  FOR obj IN
    SELECT 'TABLE' AS kind, format('%I.%I', schemaname, tablename) AS ident
      FROM pg_tables
      WHERE schemaname = 'public' AND tableowner <> app_role
    UNION ALL
    SELECT 'SEQUENCE', format('%I.%I', schemaname, sequencename)
      FROM pg_sequences
      WHERE schemaname = 'public' AND sequenceowner <> app_role
    UNION ALL
    SELECT 'TYPE', format('%I.%I', n.nspname, t.typname)
      FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
      JOIN pg_roles r ON r.oid = t.typowner
      WHERE n.nspname = 'public' AND t.typtype = 'e' AND r.rolname <> app_role
  LOOP
    EXECUTE format('ALTER %s %s OWNER TO %I', obj.kind, obj.ident, app_role);
    RAISE NOTICE 'reassigned % % -> %', obj.kind, obj.ident, app_role;
  END LOOP;
END $$;
