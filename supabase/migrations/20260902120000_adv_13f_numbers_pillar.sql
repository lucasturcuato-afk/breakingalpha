-- Adviser registry: the NUMBERS pillar for names that will never file XBRL.
--
-- !!! PROPOSED / NOT APPLIED !!!
-- Written for review only. Repo convention: Noah applies committed migrations
-- via Studio/CLI. backend/ingest_adviser_registry.py fails closed with a clear
-- error until these tables exist; only --dry-run works before then.
--
-- WHY THIS EXISTS
-- ---------------
-- Company Intel's NUMBERS pillar is satisfied today by one of: a validated XBRL
-- fact, a sec_filings row, or an insider_transactions row. All three require the
-- name to be an EDGAR reporting issuer. Measured on the 2,869-name universe,
-- 306 names hold exactly one pillar and every one of the 306 is missing NUMBERS.
-- They are private advisers, buyout firms and fund managers. They will never
-- file a 10-K, so waiting for XBRL is waiting forever.
--
-- Two SEC public-domain datasets carry a financial artifact for exactly this
-- population:
--
--   1. FORM ADV PART 1, Item 5.F(2)(c): Regulatory Assets Under Management.
--      A dollar figure, self-reported, filed annually, populated on 16,876 of
--      16,876 rows of the SEC IA firm roster (605 of those report exactly 0).
--      Keyed on Organization CRD#. This is a FIGURE.
--
--   2. FORM 13F-HR: quarterly holdings report, required of any manager with
--      discretion over $100M+ of section 13(f) securities. Keyed on the manager
--      CIK. This is an EXISTENCE FLAG, not a figure: the table stores that the
--      manager files and when, not what it holds. 13F-NT filings carry NO
--      holdings (they are notices that the holdings appear on another manager's
--      report), so an NT-only filer is deliberately NOT credited.
--
-- Both are SEC public domain and redistributable, so the figures may be shown.
--
-- DESIGN NOTES
-- ------------
--   * Two tables, not one, because the natural keys genuinely differ (CRD vs
--     CIK) and a single table would need a nullable half of its own primary key.
--   * company_id is the LINK and it is nullable. The registry rows are ingested
--     wholesale from the SEC source; only a subset ever links to a companies
--     row. An unlinked row is a normal state, not an error.
--   * match_tier and match_confirmed record HOW the link was made. The matcher
--     is a name matcher over legal/business names, and a name matcher on
--     financial firms produces affiliate hits ("BNP Paribas" ->
--     "BNP PARIBAS ASSET MANAGEMENT USA, INC."). Storing the tier means a read
--     path can decide what to trust, and an audit can be replayed without
--     re-running the ingest.
--   * raum_total_usd is stored in FULL DOLLARS, unrounded, exactly as filed.
--     The discretionary/non-discretionary split is kept because it is free and
--     because the total alone hides a 100%-non-discretionary book.
--   * raum_reported_at is the adviser's own latest ADV filing date. RAUM is
--     annual and STALE BY CONSTRUCTION; every read path must show the date next
--     to the figure. A dollar amount with no as-of date is worse than nothing.
--   * Exempt Reporting Advisers (the ia*-exempt roster) are NOT ingested. Their
--     filing has 171 columns and no Item 5 at all: no RAUM, no employees, no
--     client counts. There is no number to carry, so they supply no pillar.
--   * RLS: public SELECT only, mirroring sec_filings
--     (20260531000000_wd_filings_sec_filings_read_policy.sql). Writes stay with
--     the service-role job; no INSERT/UPDATE/DELETE policy is added.

-- ---------------------------------------------------------------------------
-- Form ADV Part 1: registered investment advisers, keyed on CRD.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.adviser_registrations (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- natural key: SEC/FINRA Organization CRD number, unique per firm
    crd                 bigint NOT NULL UNIQUE,

    -- link into Company Intel; NULL when the roster row matches no companies row
    company_id          uuid REFERENCES public.companies(id) ON DELETE SET NULL,

    -- identity as filed. BOTH names are read, never one. The matcher is fed
    -- both, so the link can be won by either, and a read path that prints one
    -- and drops the other attributes a figure to an entity that did not file
    -- it: "INVESCO" printed over a book filed by INVESCO CANADA LTD.
    primary_business_name text NOT NULL,
    legal_name            text,

    -- the EXACT registry string that won the company_id link, so the read path
    -- and an auditor can both see which of the row's names produced the tier
    -- below rather than inferring it. NULL for an unlinked row.
    matched_name          text,

    -- Item 5.F(2): regulatory assets under management, full dollars, as filed.
    -- total = discretionary + non_discretionary (the roster's own arithmetic;
    -- verified to hold exactly on the sampled rows).
    raum_total_usd              numeric,
    raum_discretionary_usd      numeric,
    raum_non_discretionary_usd  numeric,
    raum_total_accounts         integer,

    -- as-of. RAUM is an ANNUAL figure; never render the number without this.
    raum_reported_at    date,

    -- SEC registration status as filed ('Approved' | '120-Day Approval')
    sec_status          text,

    -- how the company_id link was made, so a reader and an auditor can both
    -- tell an exact legal-name hit from an affiliate-shaped prefix hit.
    --   'exact'  roster name equals the company name after normalization
    --   'core'   roster name equals the company name plus a legal suffix
    --   'prefix' roster name starts with the company name (affiliate-shaped)
    match_tier          text CHECK (match_tier IN ('exact', 'core', 'prefix')),
    -- TRUE only when a human adjudicated the link. The matcher never sets it.
    match_confirmed     boolean NOT NULL DEFAULT false,

    source_file         text NOT NULL,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS adviser_registrations_company_idx
    ON public.adviser_registrations (company_id)
    WHERE company_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS adviser_registrations_raum_idx
    ON public.adviser_registrations (raum_total_usd DESC NULLS LAST);

COMMENT ON TABLE public.adviser_registrations IS
    'SEC Form ADV Part 1 firm roster (public domain FOIA download), keyed on '
    'Organization CRD#. raum_total_usd is Item 5.F(2)(c) in full dollars as '
    'filed; it is an ANNUAL self-reported figure and must always be rendered '
    'with raum_reported_at. Ingest: backend/ingest_adviser_registry.py.';

-- ---------------------------------------------------------------------------
-- Form 13F-HR: institutional investment managers, keyed on manager CIK.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.institutional_managers (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- natural key: the manager's own EDGAR CIK (NOT an issuer CIK)
    cik                 bigint NOT NULL UNIQUE,

    company_id          uuid REFERENCES public.companies(id) ON DELETE SET NULL,

    -- the filer's CURRENT name on EDGAR.
    filer_name          text NOT NULL,

    -- the EXACT registry string that won the company_id link. The matcher is
    -- fed every FORMER name EDGAR lists, so this is frequently NOT filer_name,
    -- and without it the read path cannot tell that "Martin Marietta" was
    -- linked to a filer now called LOCKHEED MARTIN INVESTMENT MANAGEMENT CO.
    matched_name        text,

    -- EXISTENCE FLAG, the whole point of this table. TRUE means the manager has
    -- filed at least one 13F-HR, i.e. it reported discretion over $100M+ of
    -- section 13(f) securities. This table stores NO holdings and NO position
    -- values; it is not a portfolio.
    files_13f_hr        boolean NOT NULL DEFAULT false,
    -- TRUE when the manager has ONLY ever filed 13F-NT (notice) reports. An NT
    -- filing carries no holdings, so files_13f_hr stays false and the row
    -- supplies no pillar. Stored so the exclusion is auditable, not invisible.
    notice_only         boolean NOT NULL DEFAULT false,

    last_filing_date    date,
    forms               text[] NOT NULL DEFAULT '{}',

    match_tier          text CHECK (match_tier IN ('exact', 'core', 'prefix')),
    match_confirmed     boolean NOT NULL DEFAULT false,

    source_file         text NOT NULL,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS institutional_managers_company_idx
    ON public.institutional_managers (company_id)
    WHERE company_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS institutional_managers_hr_idx
    ON public.institutional_managers (files_13f_hr)
    WHERE files_13f_hr = true;

COMMENT ON TABLE public.institutional_managers IS
    'SEC Form 13F filer identities, keyed on the MANAGER CIK. files_13f_hr is '
    'an existence flag (the manager reported $100M+ of section 13(f) '
    'securities); this table stores no holdings. 13F-NT filings carry no '
    'holdings and never set files_13f_hr. Ingest: '
    'backend/ingest_adviser_registry.py.';

-- ---------------------------------------------------------------------------
-- RLS: public SELECT only. Writes via the service-role job.
-- ---------------------------------------------------------------------------
ALTER TABLE public.adviser_registrations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.institutional_managers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read access"
    ON public.adviser_registrations
    FOR SELECT
    TO public
    USING (true);

CREATE POLICY "Public read access"
    ON public.institutional_managers
    FOR SELECT
    TO public
    USING (true);

GRANT SELECT ON public.adviser_registrations  TO anon, authenticated;
GRANT SELECT ON public.institutional_managers TO anon, authenticated;
