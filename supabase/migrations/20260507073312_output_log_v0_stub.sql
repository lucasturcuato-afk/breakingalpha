-- PR-D2: stub table for substrate Step 3 output capture.
-- LOCKED Decision 4: NEW table `output_log_v0_stub`, NOT extend `outputs`.
-- Stub naming preserves Lucas's eventual canonical Step 3 schema (WD21).
-- The recordOutput SDK API is stable; only the underlying table name changes
-- when Step 3 ships (single import + insert target change to repoint).

CREATE TABLE output_log_v0_stub (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  output_type text NOT NULL,
  source_table text NOT NULL,
  source_id text NOT NULL,
  prompt_inputs jsonb,
  generated_at timestamptz NOT NULL DEFAULT now(),
  latency_ms integer,
  metadata jsonb
);

CREATE INDEX idx_output_log_v0_stub_source
  ON output_log_v0_stub (source_table, source_id);

CREATE INDEX idx_output_log_v0_stub_type
  ON output_log_v0_stub (output_type, generated_at DESC);
