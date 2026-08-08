-- Radar: claim_evidence - supporting/challenging stories against an OPEN claim.
-- Created: 2026-08-08 (feat/claim-evidence-ledger)
--
-- DO NOT AUTO-APPLY. Written for human review; apply manually AFTER 0012.
--
-- Additive and non-destructive: one new table. No existing table, column, or
-- constraint is touched. Idempotent: safe to re-run.
--
-- One row per (claim, story) with a directional stance, written by the daily
-- shared pass (backend/grading/claim_evidence.py) while a claim is open. This is
-- a running OBSERVATION log, never a verdict and never a score: the price
-- attribution grader remains the only thing that resolves a claim. Neutral
-- stories are never recorded (a neutral story is not evidence), so absence is the
-- common, honest state.
--
-- The unique(claim_id, article_id) constraint is what makes the daily pass
-- idempotent: a re-run over an overlapping window records no duplicate. The
-- article's sentiment, the claim's direction and the match basis are copied in so
-- the ledger stays auditable if the source article later changes.

CREATE TABLE IF NOT EXISTS claim_evidence (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id             uuid NOT NULL REFERENCES user_claims(id) ON DELETE CASCADE,
  article_id           uuid NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  -- 'support' | 'challenge'; neutral stories are never recorded
  stance               text NOT NULL CHECK (stance IN ('support','challenge')),
  -- copied at match time so the ledger is auditable if the article mutates
  article_sentiment    text NOT NULL CHECK (article_sentiment IN ('bullish','bearish','neutral')),
  claim_direction      text NOT NULL CHECK (claim_direction IN ('bullish','bearish','neutral')),
  -- how the subject overlapped; 'companies' covers the folded primary_company
  match_basis          text NOT NULL CHECK (match_basis IN ('ticker','primary_company','companies','sector')),
  relevance_score      smallint,
  article_published_at timestamptz,
  observed_on          date NOT NULL,          -- the daily-pass session date
  created_at           timestamptz NOT NULL DEFAULT now(),
  -- the constraint that stops one story recorded twice for one claim
  UNIQUE (claim_id, article_id)
);

CREATE INDEX IF NOT EXISTS idx_claim_evidence_claim
  ON claim_evidence (claim_id, article_published_at DESC);
CREATE INDEX IF NOT EXISTS idx_claim_evidence_observed
  ON claim_evidence (observed_on);

ALTER TABLE claim_evidence ENABLE ROW LEVEL SECURITY;

-- Owner-read via the owning claim. Writes are service-role only (the shared
-- daily pass), so there is no INSERT/UPDATE policy: the service role bypasses RLS
-- and no end user may write to another user's ledger.
DROP POLICY IF EXISTS claim_evidence_owner_read ON claim_evidence;
CREATE POLICY claim_evidence_owner_read ON claim_evidence
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM user_claims c
      WHERE c.id = claim_evidence.claim_id AND c.user_id = auth.uid()
    )
  );
