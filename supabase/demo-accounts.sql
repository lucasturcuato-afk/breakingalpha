-- Demo accounts for Wednesday presentation
-- Run AFTER creating auth accounts for these emails in Supabase Dashboard

-- Account 1: Tech-focused student analyst
INSERT INTO user_profiles (id, full_name, role, sectors, risk_appetite, watchlist_tickers, onboarding_completed)
VALUES (
  (SELECT id FROM auth.users WHERE email = 'demo-tech@signalera.com'),
  'Alex Chen',
  'student_analyst',
  ARRAY['Technology', 'Financial Services', 'Geopolitics & Macro'],
  'aggressive',
  ARRAY['NVDA', 'AAPL', 'MSFT', 'META'],
  true
)
ON CONFLICT (id) DO UPDATE SET
  full_name = EXCLUDED.full_name,
  role = EXCLUDED.role,
  sectors = EXCLUDED.sectors,
  risk_appetite = EXCLUDED.risk_appetite,
  watchlist_tickers = EXCLUDED.watchlist_tickers,
  onboarding_completed = EXCLUDED.onboarding_completed,
  updated_at = NOW();

-- Account 2: PE professional
INSERT INTO user_profiles (id, full_name, role, sectors, risk_appetite, watchlist_tickers, onboarding_completed)
VALUES (
  (SELECT id FROM auth.users WHERE email = 'demo-pe@signalera.com'),
  'Jordan Rivera',
  'private_equity',
  ARRAY['Healthcare & Biotech', 'Industrials & Manufacturing', 'Energy & Oil/Gas'],
  'balanced',
  ARRAY['LMT', 'XOM', 'UNH'],
  true
)
ON CONFLICT (id) DO UPDATE SET
  full_name = EXCLUDED.full_name,
  role = EXCLUDED.role,
  sectors = EXCLUDED.sectors,
  risk_appetite = EXCLUDED.risk_appetite,
  watchlist_tickers = EXCLUDED.watchlist_tickers,
  onboarding_completed = EXCLUDED.onboarding_completed,
  updated_at = NOW();
