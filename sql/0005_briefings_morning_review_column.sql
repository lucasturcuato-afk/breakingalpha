-- Add morning_review JSONB column to briefings for evening-wrap self-reflection section
ALTER TABLE briefings ADD COLUMN IF NOT EXISTS morning_review jsonb;
COMMENT ON COLUMN briefings.morning_review IS 'Structured self-reflection on morning brief calls vs actual market outcomes. Set only on evening wrap briefs. Shape: { aggregate_sentence, sector_reflections: [{ sector, verdict, paragraph }], ticker_reflection: { symbol, verdict, paragraph } | null }';
