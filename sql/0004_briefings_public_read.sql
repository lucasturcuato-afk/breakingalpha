-- Allow anon clients to SELECT from public.briefings so the public share
-- page at /share/brief/[id] can render without authentication.
--
-- Be conservative. We keep RLS ON (so writes still require an authenticated
-- or service_role context) and add a single read-only policy for `anon`.
--
-- A DO block is used for idempotency because CREATE POLICY IF NOT EXISTS
-- is not universally supported across Postgres versions in Supabase.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'briefings'
      AND policyname = 'briefings_anon_select'
  ) THEN
    EXECUTE 'CREATE POLICY briefings_anon_select
             ON public.briefings
             FOR SELECT
             TO anon
             USING (true)';
  END IF;
END $$;

ALTER TABLE public.briefings ENABLE ROW LEVEL SECURITY;
