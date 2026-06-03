-- 8-K summary self-heal: retry tracking for the bounded re-summarize pass.
--
-- The EDGAR cron summarizes an 8-K only on first ingest; a transient Gemini
-- failure leaves summary NULL forever (dedup never reprocesses the accession).
-- backend/ingest_sec.py:resummarize_null_8k re-summarizes stuck-NULL rows on
-- later runs, bounded by an attempt cap and exponential backoff. These columns
-- persist that bound across cron runs so a persistently failing row is not
-- hammered every run.

alter table sec_filings
    add column if not exists summary_attempts integer not null default 0,
    add column if not exists summary_last_attempt_at timestamptz;

-- Partial index for the self-heal candidate query (NULL-summary rows only).
create index if not exists sec_filings_summary_pending_idx
    on sec_filings (filing_date desc)
    where summary is null;
