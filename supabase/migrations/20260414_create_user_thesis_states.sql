CREATE TABLE IF NOT EXISTS user_thesis_states (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  thesis_id UUID NOT NULL REFERENCES theses(id) ON DELETE CASCADE,
  status TEXT CHECK (status IN ('active', 'archived', 'watching')) DEFAULT 'active',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, thesis_id)
);

ALTER TABLE user_thesis_states ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own thesis states"
  ON user_thesis_states FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_user_thesis_states_user ON user_thesis_states(user_id, status);
