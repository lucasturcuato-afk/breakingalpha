-- Add tour_completed_v1 flag to user_profiles
-- Defaults to FALSE so existing users see the tour on next login.
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS tour_completed_v1 boolean NOT NULL DEFAULT false;
