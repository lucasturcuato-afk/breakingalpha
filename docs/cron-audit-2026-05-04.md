# cron-job.org URL audit (2026-05-04)

## 1. Audit metadata

- Date: 2026-05-04
- Branch: noah/cron-sweep-2026-05-04
- Repo commit at audit start: d871b6e (main, working tree clean)
- Tool: read-only repo grep + Vercel/cron context known to orchestrator
- Production URL: https://signalera.ai
- Dead URL (Vercel project renamed, no longer routes): https://breakingalpha.vercel.app
- Out-of-scope: cron-job.org dashboard itself (external service, not reachable from this session). The dashboard verification items live in section 6.

## 2. How cron is configured

Cron-job.org is the external scheduler. It posts on a fixed UTC schedule to one of two destination types:

1. GitHub REST API (`https://api.github.com/repos/lucasturcuato-afk/breakingalpha/actions/workflows/<workflow>.yml/dispatches` and `https://api.github.com/repos/lucasturcuato-afk/breakingalpha/dispatches`) using the `signalera-cron-dispatch` PAT (classic, repo scope, expires 2027-04-13). This drives the Python pipeline + grading workflows.
2. The Signalera Vercel app at `https://signalera.ai/api/...` using the `x-internal-key` shared secret (`INTERNAL_API_KEY`). Each Vercel route in turn calls `POST https://api.github.com/repos/lucasturcuato-afk/breakingalpha/dispatches` with a `repository_dispatch` payload, which fires the matching `.github/workflows/*.yml` on the backend repo.

Source-of-truth files in the repo:

- `docs/HANDOFF.md` lines 192, 204, 223 to 252 (full schedule, PAT, troubleshooting matrix).
- `.sprint-notes/brief-revamp-handoff.md` lines 3 to 21 (brief-grading cron entry).
- `.sprint-notes/brief-polish-handoff.md` lines 60 to 66 (brief-grading cron entry, duplicate).
- `.sprint-notes/brief-revamp-plan.md` line 380 (5pm PT brief-grading cron entry).
- `.github/workflows/schedule.yml`, `grading.yml`, `brief-grading.yml`, `weekly_digest.yml`, `weekly_summary.yml`. Note: `weekly_digest.yml` and `weekly_summary.yml` use GitHub Actions native `schedule:` cron, not cron-job.org. Per HANDOFF.md the native cron is unreliable, so these two are at risk of silent skips and are candidates to migrate to cron-job.org as well (see section 5).

## 3. Dead-URL references

`grep -rn "breakingalpha.vercel.app|breakingalpha-git" --include=*.ts --include=*.tsx --include=*.py --include=*.json --include=*.md --include=*.yml --include=*.yaml .`

Total `breakingalpha.vercel.app` hits: 11. Total `breakingalpha-git` hits: 0.

Application source code (`src/`, `backend/`):

- 0 hits. The legal pages previously called out at `src/app/legal/privacy/page.tsx:22` and `src/app/legal/terms/page.tsx:20` no longer contain `breakingalpha.vercel.app` (verified by grep; PR #170 swept them).

Documentation only:

- `docs/HANDOFF.md:186` "Live at https://breakingalpha.vercel.app (deploying as Signalera)" - Historical (status snapshot from 2026-04-20).
- `docs/HANDOFF.md:211` "Live: breakingalpha.vercel.app" - Historical (Environment block snapshot).
- `docs/HANDOFF.md:259` Supabase Site URL value documented as `https://breakingalpha.vercel.app` - Historical, but flagged in the same file at line 533 as the cause of the OAuth break; tracked separately under "Manual fix required".
- `docs/HANDOFF.md:513` PR #170 release note describing the domain swap - Cosmetic (changelog entry).
- `docs/HANDOFF.md:518` Diagnosis sentence describing the symptom - Cosmetic.
- `docs/HANDOFF.md:608` "Live: https://breakingalpha.vercel.app" - Historical.
- `docs/auth-redirect-diagnosis.md` lines 23, 25, 26, 27, 34, 41, 42, 71 - Cosmetic / Historical (the doc is the diagnosis of this exact issue).

Categorisation summary:

- Dangerous (would actually fire requests to the dead URL): 0
- Cosmetic (changelog, release notes, diagnosis prose): 5
- Historical (status snapshots, "as of <date>" lines): 6

Adjacent stale-domain finds (not `breakingalpha.vercel.app`, but worth flagging because they encode the wrong production host):

- `.sprint-notes/brief-revamp-handoff.md:16` URL: `https://signalera.app/api/grading/grade-brief` - wrong TLD (`.app` vs `.ai`). Cosmetic in the doc, but if Noah copy-pasted this into cron-job.org the job would 404.
- `.sprint-notes/brief-polish-handoff.md:62` same wrong TLD `signalera.app`.
- `.sprint-notes/brief-revamp-plan.md:309` same wrong TLD `signalera.app`.

`.sprint-notes/brief-polish-handoff.md:11` and `:79` reference a Vercel preview URL `signalera-bujhgnxcr-lucasturcuato-afks-projects.vercel.app` - that is a legitimate preview deploy URL for QA, not a cron target. Ignore.

## 4. Cron endpoint inventory

Endpoints in `src/app/api/` that match the "internal-key + dispatch" cron pattern (i.e. the things cron-job.org should be POSTing to on signalera.ai):

- `POST https://signalera.ai/api/grading/trigger`
  - File: `src/app/api/grading/trigger/route.ts`
  - Auth: `x-internal-key: <INTERNAL_API_KEY>`
  - Optional body: `{"force": boolean}`
  - Effect: GitHub `repository_dispatch` event `grading-trigger`, consumed by `.github/workflows/grading.yml`, which runs `backend/cron/daily_grading.py`.
- `POST https://signalera.ai/api/grading/grade-brief`
  - File: `src/app/api/grading/grade-brief/route.ts`
  - Auth: `x-internal-key: <INTERNAL_API_KEY>`
  - Optional body: `{"backfill": boolean}`
  - Effect: GitHub `repository_dispatch` event `grade-brief`, consumed by `.github/workflows/brief-grading.yml`, which runs `backend/grading/grade_brief_calls.py`.
- `POST https://signalera.ai/api/theses/backfill-tickers`
  - File: `src/app/api/theses/backfill-tickers/route.ts`
  - Auth: `x-internal-key: <INTERNAL_API_KEY>`
  - Effect: backfill helper. Not documented as a recurring cron in HANDOFF.md; likely a manual / on-demand endpoint. Inventory it so Noah can confirm whether a cron-job.org entry exists or not (it should NOT, unless intentionally added).

Endpoints that cron-job.org targets directly on `api.github.com` (not on signalera.ai):

- `POST https://api.github.com/repos/lucasturcuato-afk/breakingalpha/actions/workflows/schedule.yml/dispatches`
  - Bearer PAT `signalera-cron-dispatch`
  - Two scheduled cron-job.org entries per HANDOFF.md table:
    - Signalera Morning Pipeline: 10:00 UTC Mon to Fri, body `{"ref":"main"}`.
    - Signalera Evening Pipeline: 04:00 UTC Mon to Fri, body `{"ref":"main","inputs":{"mode":"evening"}}`.
  - Backend workflow: `.github/workflows/schedule.yml` -> `backend/run.py morning|evening`.

GitHub-native `schedule:` cron jobs (NOT driven by cron-job.org, included for completeness so Noah can decide whether to migrate them):

- `.github/workflows/weekly_digest.yml` - `cron: "0 14 * * 0"` (Sunday 14:00 UTC).
- `.github/workflows/weekly_summary.yml` - `cron: "0 15 * * 1"` (Monday 15:00 UTC, 7am PT).
- `.github/workflows/schedule.yml` - workflow_dispatch only; the legacy native-cron block was removed 2026-04-13 per HANDOFF.md.

Total cron endpoints found in repo (Vercel routes that act as cron destinations, plus the GitHub dispatch URL): 4 distinct destinations, 4 expected cron-job.org entries (morning pipeline, evening pipeline, daily grading, brief grading).

## 5. Suggested follow-ups

- 0 dangerous code paths to fix. No `fetch()` or base-URL constant points at `breakingalpha.vercel.app` in `src/` or `backend/`.
- `.sprint-notes/brief-revamp-handoff.md:16`, `.sprint-notes/brief-polish-handoff.md:62`, `.sprint-notes/brief-revamp-plan.md:309`: replace `signalera.app` with `signalera.ai` in the documented cron-job.org URL. Any cron-job.org entry copy-pasted from these notes will 404. Out of scope for this read-only audit; track as a follow-up doc PR.
- `docs/HANDOFF.md` lines 186, 211, 259, 608: update the snapshot lines to `https://signalera.ai`. The "Current Status (2026-04-20)" header makes them historically valid, but they are easy to mistake for current configuration. Out of scope for this PR.
- Consider whether `weekly_digest.yml` and `weekly_summary.yml` should migrate from GitHub-native `schedule:` to cron-job.org, given HANDOFF.md line 225 explicitly calls out native cron as unreliable. Out of scope; flag for product decision.

## 6. Manual check required

The repo cannot inspect cron-job.org. Noah must verify the dashboard entries by hand:

- Open the cron-job.org dashboard. For every job listed, confirm the URL begins with either `https://signalera.ai/` or `https://api.github.com/`. Any job pointing at `https://breakingalpha.vercel.app/`, `https://signalera.app/` (wrong TLD), or any `*.vercel.app` preview host must be updated or paused.
- For each endpoint listed in section 4 (Cron endpoint inventory), confirm there is exactly one matching cron-job.org entry firing on the expected schedule:
  - Signalera Morning Pipeline: `POST https://api.github.com/repos/lucasturcuato-afk/breakingalpha/actions/workflows/schedule.yml/dispatches`, 10:00 UTC Mon to Fri, body `{"ref":"main"}`, `Authorization: Bearer <signalera-cron-dispatch PAT>`.
  - Signalera Evening Pipeline: same URL, 04:00 UTC Mon to Fri, body `{"ref":"main","inputs":{"mode":"evening"}}`.
  - Daily grading: `POST https://signalera.ai/api/grading/trigger`, header `x-internal-key: <INTERNAL_API_KEY>`. Confirm desired schedule (HANDOFF.md does not pin one; check current dashboard cadence).
  - Brief grading: `POST https://signalera.ai/api/grading/grade-brief`, header `x-internal-key: <INTERNAL_API_KEY>`, schedule `0 0 * * 1-5` (midnight UTC Tue to Sat = 5pm PT Mon to Fri).
- Confirm any deprecated cron jobs (e.g. ones still pointing at `breakingalpha.vercel.app`, the wrong `signalera.app` TLD, an old preview deploy host, or a backend route that no longer exists) are paused or deleted in the dashboard.
- Verify the `signalera-cron-dispatch` PAT has not expired. Per HANDOFF.md line 231 it expires 2027-04-13. If the dashboard shows recent 401s on the GitHub-bound jobs, regenerate the PAT and update both Morning + Evening entries.
- Spot-check the most recent execution log for each job:
  - GitHub-bound jobs should return HTTP 204.
  - Vercel-bound jobs should return HTTP 202 (`{"status":"dispatched", ...}`). 401 means `x-internal-key` is wrong; 503 means `GITHUB_DISPATCH_TOKEN` is unset on Vercel.
- Confirm there is NO recurring cron-job.org entry pointing at `https://signalera.ai/api/theses/backfill-tickers` unless intentionally scheduled (it is documented as on-demand).
- Confirm no cron-job.org entry duplicates the GitHub-native schedules in `weekly_digest.yml` or `weekly_summary.yml` (would cause double-fires).
