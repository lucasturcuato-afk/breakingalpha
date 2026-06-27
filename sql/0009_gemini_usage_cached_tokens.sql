-- Add cached-token accounting to gemini_usage so the explicit filter prompt
-- cache discount is visible in SQL cost queries. Without this column, cached
-- tokens get billed at the full input rate in per-run cost math, overstating
-- the filter step by roughly 4x (one real run read $5.49 in SQL vs ~$1 to
-- $1.50 actual).
--
-- Default 0 keeps every existing row valid and lets the soft-fail usage logger
-- insert rows that omit the field without error. bigint matches the unbounded
-- nature of summed per-run token counts.
--
-- Apply this in the Supabase SQL editor, then keep the NOTIFY so PostgREST
-- reloads its schema cache and starts accepting the new column on inserts.
alter table public.gemini_usage
    add column if not exists cached_content_token_count bigint not null default 0;

notify pgrst, 'reload schema';
