-- Fix RLS policies for user_profiles to ensure upserts work correctly.
-- The original INSERT policy may have a NULL qual that silently blocks upserts.
-- Replace individual SELECT/INSERT/UPDATE policies with a single FOR ALL policy.

DROP POLICY IF EXISTS "Users can read own profile" ON user_profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON user_profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON user_profiles;
DROP POLICY IF EXISTS "Users can upsert own profile" ON user_profiles;

-- Single policy covering SELECT, INSERT, UPDATE, DELETE for the owning user
CREATE POLICY "Users can manage own profile"
  ON user_profiles FOR ALL
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);
