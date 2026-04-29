-- BACKFILL: Run this AFTER the main migration
-- Auto-allowlist all existing auth.users so they don't get locked out

insert into public.beta_allowlist (email, added_by, notes)
select
  lower(email) as email,
  'auto-backfill' as added_by,
  'Existing user at allowlist launch' as notes
from auth.users
where email is not null
on conflict (email) do nothing;

-- Add Noah explicitly in case he's not signed in yet
insert into public.beta_allowlist (email, added_by, notes)
values ('noahhanning03@gmail.com', 'manual', 'Co-founder')
on conflict (email) do nothing;

-- Verify count
select count(*) as total_allowlisted from public.beta_allowlist;
