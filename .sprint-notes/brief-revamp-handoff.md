# Brief Revamp Handoff — B-Subagent 2 slice

## Brief Grading Cron Setup

1. Confirm workflow is present: `.github/workflows/brief-grading.yml`.
2. Ensure GitHub repo secrets are set (in `lucasturcuato-afk/breakingalpha`):
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `FINNHUB_API_KEY`
   - `GEMINI_API_KEY`
3. Ensure Vercel env vars are set:
   - `INTERNAL_API_KEY` (shared secret for the trigger route)
   - `GITHUB_DISPATCH_TOKEN` (fine-grained PAT with `contents: read & write` on `lucasturcuato-afk/breakingalpha`)
   - `GITHUB_REPO` (optional override; defaults to `lucasturcuato-afk/breakingalpha`)
4. cron-job.org: add an entry
   - URL: `https://signalera.ai/api/grading/grade-brief`
   - Method: `POST`
   - Headers: `x-internal-key: ${INTERNAL_API_KEY}`
   - Schedule: `0 0 * * 1-5` (midnight UTC Tue–Sat = 5pm PT Mon–Fri preceding day — confirm exact time against US market close + DST)
5. Backfill manually: GitHub → Actions → "Brief Call Grading" → Run workflow → `backfill=true`.

## Files delivered

- `backend/grading/grade_brief_calls.py` — standalone grading script (`python -m backend.grading.grade_brief_calls [--backfill]`).
- `src/app/api/grading/grade-brief/route.ts` — `POST` trigger that fires a GitHub `repository_dispatch`.
- `.github/workflows/brief-grading.yml` — workflow consuming the dispatch.

## Known edge cases

- Weekend / holiday: Finnhub returns `c == 0` for closed markets → call is skipped and retried on the next run (idempotent via the `morning_brief_call_outcomes.call_id` filter).
- Unmapped sector label: logged, skipped — no insert.
- `FINNHUB_API_KEY` missing: the script raises immediately from `finnhub_quote`. The workflow will fail loudly; fix the secret and re-run.
- `GEMINI_API_KEY` missing or Gemini down: notes fall back to a deterministic one-liner (`"<Expected> call; <actual> close at <pct>%."`) — verdict/direction are unaffected.
- No claims extracted for the day → the script prints `0 ungraded calls to process` and exits cleanly.
