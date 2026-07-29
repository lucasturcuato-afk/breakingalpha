-- O3 DURABLE DEAL_FLOW -> ARTICLE JOIN (Agent CONSTRAIN, feat/lead-authority-constrain)
--
-- WRITTEN ONLY. NOT APPLIED. Agents never apply migrations; a human runs this.
--
-- Root cause (ROOT Phase 1 verdict): the mega-deal gate joins deal_flow to the
-- article pool by EXACT source_url string equality. In prod the source_url is very
-- often a Google-News RSS redirect (news.google.com/rss/articles/CBMi...) that never
-- string-matches the article.url stored in `articles`, so a correct confirmed
-- $14.8B "closed" deal_flow row (Uber / Delivery Hero) does not join to any article
-- and is_mega_deal never fires. The Python side (impact_ranking.confirmed_mega_deal_urls)
-- now recovers this at read time via a normalized COMPANY-name join (O3 company-join
-- lane). This migration makes the join DURABLE at write time so the read-side heuristic
-- is a fallback, not the only path.
--
-- Additive + reversible. No backfill of the FK is forced here (deal_extractor should
-- populate article_id going forward); existing rows keep article_id = NULL and the
-- read-side company-join covers them.

BEGIN;

-- 1. Stable FK from a deal to the article it was extracted from. Nullable so old
--    rows and rows whose article was purged do not block inserts.
ALTER TABLE public.deal_flow
  ADD COLUMN IF NOT EXISTS article_id BIGINT
  REFERENCES public.articles (id) ON DELETE SET NULL;

-- 2. Normalized company head, for the read-side entity join and for dedup. Written
--    by deal_extractor (lower-cased, legal-form suffixes stripped: "Uber Technologies"
--    -> "uber"). Kept as a plain column (not generated) so the normalization rule can
--    evolve in Python without a schema migration.
ALTER TABLE public.deal_flow
  ADD COLUMN IF NOT EXISTS company_norm TEXT;

-- 3. Indexes to keep the join + the mega-gate scan cheap on the hot path.
CREATE INDEX IF NOT EXISTS idx_deal_flow_article_id
  ON public.deal_flow (article_id);

CREATE INDEX IF NOT EXISTS idx_deal_flow_company_norm
  ON public.deal_flow (company_norm);

-- 4. The mega-gate reads recent CONFIRMED, priced rows. A partial index over the
--    confirmed stages keeps that scan tight as deal_flow grows.
CREATE INDEX IF NOT EXISTS idx_deal_flow_confirmed_recent
  ON public.deal_flow (updated_at DESC)
  WHERE stage IN ('signed', 'closed');

COMMENT ON COLUMN public.deal_flow.article_id IS
  'Source article FK (O3 durable join). NULL for legacy/purged rows; read-side '
  'company-name join in impact_ranking.confirmed_mega_deal_urls is the fallback.';
COMMENT ON COLUMN public.deal_flow.company_norm IS
  'Normalized company head (lower-cased, legal-form suffixes stripped) for the '
  'entity join. Written by deal_extractor.';

COMMIT;

-- ROLLBACK (manual):
--   DROP INDEX IF EXISTS idx_deal_flow_confirmed_recent;
--   DROP INDEX IF EXISTS idx_deal_flow_company_norm;
--   DROP INDEX IF EXISTS idx_deal_flow_article_id;
--   ALTER TABLE public.deal_flow DROP COLUMN IF EXISTS company_norm;
--   ALTER TABLE public.deal_flow DROP COLUMN IF EXISTS article_id;
