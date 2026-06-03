-- financial_facts: analyst-grade structured financial data extracted from SEC
-- XBRL (the Company Facts JSON API). One row per (company, concept, period,
-- source filing). Spec: docs/xbrl-financial-facts-spec.md. Extractor:
-- backend/edgar/xbrl_facts.py; validation gate: backend/edgar/xbrl_validation.py;
-- job: backend/ingest_xbrl_facts.py.
--
-- !!! PROPOSED / NOT APPLIED !!!
-- Written for review only. As of 2026-06-03 NOT applied to the project (repo
-- convention: Noah applies committed migrations via Studio/CLI). The ingest
-- job fails closed with a clear error until this exists; only --dry-run works.
--
-- Design notes:
--   * Long/narrow so new line items never require a schema change.
--   * History-preserving: ALL facts kept, keyed by source accession, so
--     originals and restatements coexist; financial_facts_latest picks the
--     most-recently-filed VALIDATED value per metric+period.
--   * FAIL-CLOSED: every fact carries validation_status
--     ('validated' | 'quarantined') + validation_reason, assigned by the
--     runtime gate (tie-outs, bounds, cross-endpoint reconciliation).
--     financial_facts_latest exposes ONLY validated facts; quarantined rows
--     are stored for review and never surfaced. Read paths must use the view
--     (or filter validation_status='validated') - the product must be
--     structurally unable to publish an unvalidated number.
--   * Instant facts (balance sheet) store period_start = period_end; the
--     period_type column distinguishes them. This keeps period_start NOT NULL
--     so the UNIQUE constraint is plain columns and PostgREST upserts can
--     target it with on_conflict.
--   * Values are raw, signed, base units (full dollars/shares); unit string
--     stored verbatim; never infer scale. Issuer fiscal labels (fiscal_year,
--     fiscal_period) are stored ALONGSIDE the actual period dates and the SEC
--     calendar frame: fiscal year != calendar year (NVDA is in FY2027 now).
--   * Derived rows (is_derived=true, e.g. discrete-quarter OCF differenced
--     from YTD values) cite the minuend filing's accession and explain
--     themselves in `derivation`.
--   * filing_id intentionally nullable and unset by the v1 job; the join of
--     record to sec_filings is accession_number (backfill is trivial).
--   * RLS: SELECT-only public read, mirroring sec_filings
--     (20260531000000_wd_filings_sec_filings_read_policy.sql). Writes stay
--     with the service-role job; no INSERT/UPDATE/DELETE policy is added.

CREATE TABLE IF NOT EXISTS public.financial_facts (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- joins
    company_id        uuid REFERENCES public.companies(id) ON DELETE SET NULL,
    cik               bigint NOT NULL,
    filing_id         uuid REFERENCES public.sec_filings(id) ON DELETE SET NULL,

    -- provenance: every fact traces to its filing
    accession_number  text NOT NULL,
    filing_url        text,

    -- concept identity
    taxonomy          text NOT NULL DEFAULT 'us-gaap',
    concept_tag       text NOT NULL,   -- ACTUAL XBRL tag used (e.g. 'Revenues')
    metric_key        text NOT NULL,   -- normalized key (e.g. 'revenue')

    -- value
    value             numeric NOT NULL,  -- raw, signed, base units
    unit              text NOT NULL,     -- USD | USD/shares | shares

    -- period (instant facts: period_start = period_end)
    period_type       text NOT NULL CHECK (period_type IN ('duration', 'instant')),
    period_start      date NOT NULL,
    period_end        date NOT NULL,
    fiscal_year       integer,           -- issuer fiscal year (NOT calendar)
    fiscal_period     text,              -- FY | Q1 | Q2 | Q3 | Q4
    sec_frame         text,              -- e.g. CY2026Q1 / CY2026Q1I; NULL if off-calendar

    -- source filing meta
    form              text,              -- 10-K | 10-Q | 10-K/A | 10-Q/A
    filed_date        date,              -- drives latest-wins restatement logic

    -- derived facts (e.g. discrete-quarter OCF = YTD(n) - YTD(n-1))
    is_derived        boolean NOT NULL DEFAULT false,
    derivation        text,

    -- fail-closed validation gate
    validation_status text NOT NULL CHECK (validation_status IN ('validated', 'quarantined')),
    validation_reason text,

    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now(),

    -- One filing reports a concept/period/unit once; plain-column UNIQUE so
    -- the ingest upsert can target it via on_conflict.
    CONSTRAINT financial_facts_uq
        UNIQUE (accession_number, concept_tag, period_start, period_end, unit)
);

CREATE INDEX IF NOT EXISTS financial_facts_company_idx
    ON public.financial_facts (company_id);
CREATE INDEX IF NOT EXISTS financial_facts_cik_metric_period_idx
    ON public.financial_facts (cik, metric_key, period_end DESC);
CREATE INDEX IF NOT EXISTS financial_facts_frame_idx
    ON public.financial_facts (metric_key, sec_frame);
CREATE INDEX IF NOT EXISTS financial_facts_quarantine_review_idx
    ON public.financial_facts (validation_status, created_at)
    WHERE validation_status = 'quarantined';

COMMENT ON TABLE public.financial_facts IS
    'Structured SEC XBRL financial facts (Company Facts API), history-preserving '
    'and accession-keyed. FAIL-CLOSED: read via financial_facts_latest (validated '
    'facts only); quarantined rows are review-only. '
    'Spec: docs/xbrl-financial-facts-spec.md';

-- Restatement-aware, VALIDATED-ONLY current values: the most-recently-filed
-- validated fact per (cik, metric, period, unit). This is the read path; the
-- base table is the audit trail. Quarantined facts can never appear here.
CREATE OR REPLACE VIEW public.financial_facts_latest AS
SELECT DISTINCT ON (cik, metric_key, period_type, period_start, period_end, unit)
    *
FROM public.financial_facts
WHERE validation_status = 'validated'
ORDER BY
    cik, metric_key, period_type, period_start, period_end, unit,
    filed_date DESC NULLS LAST,
    created_at DESC;

-- RLS: public SELECT only (mirrors sec_filings). Writes via service-role job.
ALTER TABLE public.financial_facts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read access"
    ON public.financial_facts
    FOR SELECT
    TO public
    USING (true);

GRANT SELECT ON public.financial_facts TO anon, authenticated;
GRANT SELECT ON public.financial_facts_latest TO anon, authenticated;
