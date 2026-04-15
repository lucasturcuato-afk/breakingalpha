-- Add cached brief improvement addendum columns to weekly_digests
ALTER TABLE weekly_digests ADD COLUMN IF NOT EXISTS morning_brief_addendum text;
ALTER TABLE weekly_digests ADD COLUMN IF NOT EXISTS evening_brief_addendum text;
