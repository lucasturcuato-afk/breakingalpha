-- Add macro_panel JSONB column to briefings for the deterministic macro strip.
-- Numbers come straight from the BLS + BEA data layers (backend/macro_calendar.py,
-- backend/bea_calendar.py) and never pass through the LLM. Set on morning briefs
-- only. A human applies this migration; the synthesize write is soft-fail and is
-- safe to ship before the column exists.
ALTER TABLE briefings ADD COLUMN IF NOT EXISTS macro_panel jsonb;
COMMENT ON COLUMN briefings.macro_panel IS 'Deterministic macro panel (BLS + BEA), morning briefs only. Shape: { releases: [{ key, name, period, figures: [{ label, value, unit, prior }], vintage_note, confidence, series_ids, footnotes }], periods: { <release key>: <period string> } }';
