-- WD49: Add sentiment_reason column to articles for first-order-event-tone justification.
-- Surfaced 2026-05-18 by production smoke + classifier audit PR #252 Section 5 Pattern 3.7.
-- Prompt diff at backend/ingest.py:214 produces this field on every new ingestion.
-- Nullable for backward compatibility: existing rows have NULL until backfill decision (separate WD).
-- Idempotent: safe to re-run.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'articles' AND column_name = 'sentiment_reason'
  ) THEN
    ALTER TABLE articles ADD COLUMN sentiment_reason text NULL;
    COMMENT ON COLUMN articles.sentiment_reason IS
      'WD49: One-sentence justification (max 25 words) naming the event(s) that anchored the sentiment label. Written by Gemini at ingest time per FILTER_PROMPT spec. Nullable for backward compatibility with rows ingested before 2026-05-18.';
  END IF;
END $$;

-- Rollback (commented; uncomment + run manually if needed):
-- ALTER TABLE articles DROP COLUMN sentiment_reason;
