-- Beta allowlist for Signalera launch
-- Run order:
--   1. Create tables + RLS
--   2. Backfill existing users (you run this on launch day)
--   3. Bulk-insert TIS member emails (you run this on launch day)

-- ============================================================
-- 1. beta_allowlist table
-- ============================================================
create table if not exists public.beta_allowlist (
  email text primary key,
  added_at timestamptz not null default now(),
  added_by text,
  notes text
);

alter table public.beta_allowlist enable row level security;

-- Only authenticated users can read their own row (so the auth callback can verify)
create policy "allowlist_read_self" on public.beta_allowlist
  for select
  to authenticated
  using (lower(email) = lower(auth.jwt() ->> 'email'));

-- Service role bypass (for the callback's server-side query)
create policy "allowlist_service_read" on public.beta_allowlist
  for select
  to service_role
  using (true);

-- ============================================================
-- 2. waitlist table
-- ============================================================
create table if not exists public.waitlist (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  name text,
  signed_up_at timestamptz not null default now(),
  source text default 'oauth_callback',
  notified_at timestamptz,
  notes text
);

alter table public.waitlist enable row level security;

-- Service role bypass for inserts/reads
create policy "waitlist_service_all" on public.waitlist
  for all
  to service_role
  using (true)
  with check (true);

-- ============================================================
-- 3. Index for fast email lookup (case-insensitive)
-- ============================================================
create unique index if not exists beta_allowlist_email_lower_idx
  on public.beta_allowlist (lower(email));

create unique index if not exists waitlist_email_lower_idx
  on public.waitlist (lower(email));
