-- financial_facts: analyst-grade structured financial data extracted from SEC
-- XBRL (the "Company Facts" JSON API). One row per (company, concept, period,
-- source filing). See docs/xbrl-financial-facts-spec.md for the full rationale,
-- the read-only spike that validated coverage (12/12 v1 concepts x 5/5 test
-- companies), and the correctness findings (tag migration, YTD-vs-discrete
-- cash flow, fiscal!=calendar year, restatements).
--
-- !!! PROPOSED / NOT APPLIED !!!
-- This migration is written for review only. As of 2026-06-03 it has NOT been
-- applied to the project (the available Supabase MCP is read-only and the repo
-- convention is that Noah applies committed migrations via Studio/CLI). Do not
-- treat the table as existing until it is applied and verified.
--
-- Design notes:
--   * Long/narrow EAV-style so new line items never require a schema change.
--   * Keeps ALL facts (original + restated), keyed by source accession, so the
--     audit trail is preserved; financial_facts_latest exposes the
--     restatement-aware "current" value (max filed_date per cik/metric/period).
--   * Stores raw signed values in base units + the unit string verbatim; never
--     infer scale. Stores BOTH issuer fiscal labels and actual period dates.
--   * RLS: SELECT-only public read (mirrors sec_filings 20260531000000_...).
--     Writes stay with the service-role ingest (backend/ingest_sec.py); no
--     INSERT/UPDATE/DELETE policy is granted, so this is not a write over-grant.

CREATE TABLE IF NOT EXISTS public.financial_facts (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- joins
    company_id        uuid REFERENCES public.companies(id) ON DELETE SET NULL,
    cik               bigint NOT NULL,
    filing_id         uuid REFERENCES public.sec_filings(id) ON DELETE SET NULL,
    accession_number  text NOT NULL,          -- provenance: SEC `accn`

    -- concept identity
    taxonomy          text NOT NULL DEFAULT 'us-gaap',  -- us-gaap | dei
    concept           text NOT NULL,          -- ACTUAL XBRL tag used, e.g. 'Revenues'
    metric_key        text NOT NULL,          -- normalized key, e.g. 'revenue'

    -- value
    value             numeric NOT NULL,       -- raw, signed, base units
    unit              text NOT NULL,          -- USD | USD/shares | shares

    -- period
    period_type       text NOT NULL CHECK (period_type IN ('duration', 'instant')),
    period_start      date,                   -- NULL for instant facts
    period_end        date NOT NULL,
    fiscal_year       integer,                -- issuer fiscal year (NOT calendar)
    fiscal_period     text,                   -- FY | Q1 | Q2 | Q3 | Q4
    frame             text,                   -- SEC calendar frame, e.g. CY2026Q1 / CY2026Q1I; NULL if off-calendar

    -- source filing meta
    form              text,                   -- 10-K | 10-Q | 10-K/A ...
    filed_date        date,                   -- drives latest-wins restatement logic

    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);

-- One filing reports a given concept/period/unit once. COALESCE the nullable
-- period_start so instant facts (NULL start) still dedup deterministically.
CREATE UNIQUE INDEX IF NOT EXISTS financial_facts_uq
    ON public.financial_facts (
        accession_number, concept,
        (COALESCE(period_start, '0001-01-01'::date)), period_end, unit
    );

-- Read patterns: by company, by cik+metric over time, calendar alignment.
CREATE INDEX IF NOT EXISTS financial_facts_company_idx
    ON public.financial_facts (company_id);
CREATE INDEX IF NOT EXISTS financial_facts_cik_metric_period_idx
    ON public.financial_facts (cik, metric_key, period_end DESC);
CREATE INDEX IF NOT EXISTS financial_facts_frame_idx
    ON public.financial_facts (metric_key, frame);

COMMENT ON TABLE public.financial_facts IS
    'Structured SEC XBRL financial facts (Company Facts API). History-preserving; '
    'see financial_facts_latest for restatement-aware current values. '
    'Spec: docs/xbrl-financial-facts-spec.md';

-- Restatement-aware "current" value: the most-recently-FILED fact per
-- (cik, metric_key, period_end, period_type, unit). The base table keeps the
-- full history (original + any restatement); this view is what the product reads.
CREATE OR REPLACE VIEW public.financial_facts_latest AS
SELECT DISTINCT ON (cik, metric_key, period_end, period_type, unit)
    *
FROM public.financial_facts
ORDER BY
    cik, metric_key, period_end, period_type, unit,
    filed_date DESC NULLS LAST,
    created_at DESC;

-- RLS: public SELECT only (mirrors sec_filings). Writes via service-role ingest.
ALTER TABLE public.financial_facts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read access"
    ON public.financial_facts
    FOR SELECT
    TO public
    USING (true);

GRANT SELECT ON public.financial_facts TO anon, authenticated;
GRANT SELECT ON public.financial_facts_latest TO anon, authenticated;
