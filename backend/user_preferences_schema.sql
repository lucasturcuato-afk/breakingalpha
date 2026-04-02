-- user_preferences_schema.sql
-- Run once in the Supabase SQL editor to create the user_preferences table.

CREATE TABLE user_preferences (
    id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id              uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    sectors              text[]      NOT NULL DEFAULT '{}',
    modules              text[]      NOT NULL DEFAULT '{}',
    prioritize_watchlist boolean     NOT NULL DEFAULT false,
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id)
);

-- RLS: users can only read and write their own row
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own preferences" ON user_preferences
    FOR ALL
    USING      (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
