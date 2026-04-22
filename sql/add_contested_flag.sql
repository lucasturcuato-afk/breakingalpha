-- Phase 2B: Add contested_flag to trend_clusters
ALTER TABLE trend_clusters ADD COLUMN IF NOT EXISTS contested_flag BOOLEAN DEFAULT FALSE;
