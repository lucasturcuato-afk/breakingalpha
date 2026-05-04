-- W2-A: aliases + resolution_log tables
-- See docs/w2-a-entity-resolution-design.md §3 for full spec
-- This migration is committed but NOT applied automatically. Noah applies via Supabase Studio or CLI.

CREATE TABLE IF NOT EXISTS aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  surface_form text NOT NULL,
  lookup_key text NOT NULL,
  canonical_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  mention_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT aliases_lookup_canonical_unique UNIQUE (lookup_key, canonical_id)
);

CREATE INDEX IF NOT EXISTS aliases_lookup_key_idx ON aliases (lookup_key);

CREATE TABLE IF NOT EXISTS resolution_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  surface_form text NOT NULL,
  lookup_key text NOT NULL,
  resolved_canonical_id uuid REFERENCES companies(id) ON DELETE SET NULL,
  candidate_canonical_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  was_ambiguous boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
