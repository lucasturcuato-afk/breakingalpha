-- 0012: extend output_type_enum with the radar cluster cache values.
-- DO NOT AUTO-APPLY. Run manually in the Supabase SQL editor.
--
-- Why: src/app/api/radar/clusters (and the label endpoint) cache the
-- shared per-topic cluster trees and their LLM labels in the outputs
-- table via recordOutput. outputs.output_type is the Postgres enum
-- output_type_enum, which does not include these values, so every
-- insert is rejected with 22P02 (invalid input value for enum) and the
-- cache silently degrades to per-instance in-memory only: trees
-- recompute after every cold start and labels re-generate (extra
-- Gemini calls). /api/health flags this state until applied.
--
-- ALTER TYPE ... ADD VALUE cannot run inside a transaction block;
-- run each statement on its own.

ALTER TYPE output_type_enum ADD VALUE IF NOT EXISTS 'radar_clusters';
ALTER TYPE output_type_enum ADD VALUE IF NOT EXISTS 'radar_cluster_label';
