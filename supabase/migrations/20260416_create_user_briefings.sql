-- Per-user briefing addenda written by backend/user_synthesis.py.
-- Each row is a short "for you" takeaway that personalizes the global
-- morning/evening briefing for a single user, based on their onboarding
-- profile + recently-inferred sector weights. Consumed by the morning /
-- evening pages via /api/briefing?type=...&user_addendum=1.
create table if not exists public.user_briefings (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  briefing_type   text not null,                -- 'morning' | 'evening'
  addendum        text not null default '',     -- short markdown paragraph
  profile_hash    text,                         -- sha256 of profile snapshot used
  generated_at    timestamptz not null default now()
);

create index if not exists idx_user_briefings_user_type_gen
  on public.user_briefings(user_id, briefing_type, generated_at desc);

alter table public.user_briefings enable row level security;

-- Users read only their own addenda.
drop policy if exists user_briefings_read_own on public.user_briefings;
create policy user_briefings_read_own on public.user_briefings
  for select to authenticated using (auth.uid() = user_id);

-- Writes happen from the service role (pipeline) — no public insert/update/delete.
