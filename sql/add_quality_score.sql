-- Phase 1C: Add deterministic quality_score column to articles
ALTER TABLE articles ADD COLUMN IF NOT EXISTS quality_score REAL;

-- Index for synthesis selection (quality_score DESC alongside relevance_score)
CREATE INDEX IF NOT EXISTS idx_articles_quality_score ON articles (quality_score DESC NULLS LAST);
