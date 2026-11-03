-- Supabase lockdown (requirements §1.1). Run ONCE in the Supabase SQL editor as `postgres`,
-- BEFORE the first `prisma migrate deploy`. Safe to re-run.
--
-- What it does:
--   1. Creates the private `app` schema that Prisma uses (not listed in the Data API's exposed schemas).
--   2. Creates a least-privilege login role `app_user` for the runtime (DATABASE_URL).
--      Migrations (DIRECT_URL) keep using the `postgres` role.
--   3. Removes all access for Supabase's API roles (anon, authenticated) on `app`.
--   4. Provides a function + event trigger that enables RLS on every table created in `app` and adds a
--      single policy for `app_user` only. anon/authenticated have no policy => deny-all.
--      New tables from future migrations are locked down automatically.
--
-- ALSO in the dashboard: Project Settings -> Data API -> make sure `app` is NOT in "Exposed schemas"
-- (or disable the Data API entirely, since this project never uses it).

-- 1. Private schema
CREATE SCHEMA IF NOT EXISTS app;

-- 2. Runtime role (set the password via the dashboard / psql, never commit it)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user LOGIN NOINHERIT;
  END IF;
END
$$;
-- ALTER ROLE app_user WITH PASSWORD '<generate-a-strong-password>';

GRANT USAGE ON SCHEMA app TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA app TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA app TO app_user;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA app
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA app
  GRANT USAGE, SELECT ON SEQUENCES TO app_user;
-- No BYPASSRLS (not grantable on Supabase): instead each table gets ONE policy scoped to app_user (step 4).

-- 3. Deny Supabase API roles
REVOKE ALL ON SCHEMA app FROM anon, authenticated, public;
REVOKE ALL ON ALL TABLES IN SCHEMA app FROM anon, authenticated, public;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA app FROM anon, authenticated, public;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app FROM anon, authenticated, public;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA app REVOKE ALL ON TABLES FROM anon, authenticated, public;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA app REVOKE ALL ON SEQUENCES FROM anon, authenticated, public;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA app REVOKE ALL ON FUNCTIONS FROM anon, authenticated, public;

-- 4. RLS on every table in `app` (existing + future), no policies = deny-all for non-bypass roles
CREATE OR REPLACE FUNCTION public.app_enable_rls_on_all_tables()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'app' AND c.relkind IN ('r', 'p')
  LOOP
    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY', t.relname);
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'app' AND tablename = t.relname AND policyname = 'app_user_full_access'
    ) THEN
      EXECUTE format(
        'CREATE POLICY app_user_full_access ON app.%I FOR ALL TO app_user USING (true) WITH CHECK (true)',
        t.relname
      );
    END IF;
  END LOOP;
END
$$;
REVOKE ALL ON FUNCTION public.app_enable_rls_on_all_tables() FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.app_rls_event_trigger()
RETURNS event_trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  PERFORM public.app_enable_rls_on_all_tables();
END
$$;
REVOKE ALL ON FUNCTION public.app_rls_event_trigger() FROM public, anon, authenticated;

DROP EVENT TRIGGER IF EXISTS app_enable_rls_on_create;
CREATE EVENT TRIGGER app_enable_rls_on_create
  ON ddl_command_end
  WHEN TAG IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
  EXECUTE FUNCTION public.app_rls_event_trigger();

SELECT public.app_enable_rls_on_all_tables();

-- Verification (both should return zero rows):
-- SELECT tablename FROM pg_policies WHERE schemaname = 'app' AND ('anon' = ANY(roles) OR 'authenticated' = ANY(roles));
-- SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--   WHERE n.nspname = 'app' AND c.relkind = 'r' AND NOT c.relrowsecurity;
