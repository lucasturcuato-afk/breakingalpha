-- 0006_briefings_structured_body.sql
--
-- Adds the three structured-body columns that the post-polish synthesis schema
-- emits: lead_paragraph (THE lead story), supporting_context (related color),
-- what_to_watch (forward-looking 1-2 sentences).
--
-- The synthesis pipeline tries to insert these columns first and falls back to
-- the base row if they do not exist — so briefings keep shipping even before
-- this migration is applied. It IS applied (verified live 2026-09-05:
-- briefings.lead_paragraph exists), so the fields persist and the LeadHero
-- component renders the three-part layout.
--
-- All three columns are optional; older rows will simply have NULL values and
-- the renderer falls back to `summary` unchanged.

ALTER TABLE briefings ADD COLUMN IF NOT EXISTS lead_paragraph text;
ALTER TABLE briefings ADD COLUMN IF NOT EXISTS supporting_context text;
ALTER TABLE briefings ADD COLUMN IF NOT EXISTS what_to_watch text;
