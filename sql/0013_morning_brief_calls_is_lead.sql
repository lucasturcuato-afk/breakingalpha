-- Contract C2: is_lead flag on extracted morning-brief claims
-- Created: 2026-07-16 (shadow-clock + is_lead sprint)
--
-- Adds morning_brief_calls.is_lead. Exactly one claim per brief (the one whose
-- text matches the SHIPPED lead headline) is written with is_lead=true by
-- extract_and_persist_claims; every other claim is false. This makes a brief's
-- lead joinable to its later grade (morning_brief_call_outcomes) so the lead's
-- hit rate can be tracked distinctly from the supporting calls.
--
-- Idempotent: safe to re-run. ADD COLUMN IF NOT EXISTS + IF NOT EXISTS index.
-- NOT NULL DEFAULT false: existing rows backfill to false, which is correct
-- (they predate lead attribution and carry no lead claim).
--
-- NOTE: do NOT apply autonomously. Written for a human to review and run.

ALTER TABLE morning_brief_calls
  ADD COLUMN IF NOT EXISTS is_lead boolean NOT NULL DEFAULT false;

-- Partial index: reads are "give me the lead claim(s) for these briefs", which
-- only ever wants the true rows. A partial index keeps it small.
CREATE INDEX IF NOT EXISTS idx_mbc_is_lead
  ON morning_brief_calls (brief_id)
  WHERE is_lead;
