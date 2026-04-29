# Company Intel Investigation Summary

**Branch:** `noah/company-intel-investigation`
**Run:** Overnight parallel sub-agent B, 2026-04-29
**Companion:** `COMPANY_INTEL_FIX_PLAN.md` (this branch, root)

## Primary deliverable: fix plan
`COMPANY_INTEL_FIX_PLAN.md` covers all four reported symptoms with root cause (file paths + line numbers), proposed fix scope, risk-to-launch rating, recommended fix order, testing approach, and explicit "needs more investigation" sections. Detailed within. Honest about unknowns — no glossing.

## Optional fix shipped
**No fix shipped.** Reviewed the four symptoms against the strict criteria (< 30 line diff, no backend cron-adjacent edits, no overlap with Lucas's recent files, highest visible value).

The most attractive narrow target was symptom 2 (search broken). The minimum viable fix for symptom 2 requires a new server-side `/api/companies?q=` route plus client-side debounced fetch logic — comfortably > 30 lines and entangled with symptom 3 (the underlying data source is wrong; a server-side ilike on `companies` would surface results that then render empty detail panels). A bare expansion of `CANONICAL` in `src/lib/company-intel.ts` (Phase 1C) would fit the size budget and meaningfully reduce duplicate rows, but does not address symptom 2 (search). Splitting it from a coordinated rollout creates user confusion ("yesterday I saw two Robinhood cards, today I see one but still can't search HOOD").

Decision: ship the plan only. Title becomes `docs: Company Intel fix plan`.

## Files changed (with line counts)
- `COMPANY_INTEL_FIX_PLAN.md` — new file, ~290 lines
- `COMPANY_INTEL_INVESTIGATION_SUMMARY.md` — this file, ~70 lines

No source files modified.

## Key decisions
1. **No code fix tonight.** Strict criteria + entanglement of symptoms 2/3 made any narrow fix worse than no fix.
2. **Phase 1C (frontend dedup map expansion) named as the smallest visible win**, but explicitly NOT shipped tonight to avoid splitting a coordinated rollout.
3. **Phase 1A (backend `upsert_company` canonicalization) flagged as cron-adjacent and out of scope for this branch** per hard constraints.
4. **Phase 1B (data merge migration) flagged as Supabase-SQL-execution and out of scope.**
5. **Symptom 4 fix recommended as a read-only join on `watchlist_articles`** rather than a new fetcher, to reuse existing infra and minimize new cron paths.
6. **No Lucas overlap.** Confirmed against `/tmp/lucas-recent.txt` — `OnboardingWizard.tsx` and `thesis-detail-panel.tsx` are not on any proposed fix path.

## Known unknowns (full list in fix plan)
- Exact count and shape of duplicate clusters in the `companies` table
- Whether `companies.ticker` is populated reliably enough for ticker-based search
- Whether `watchlist_articles.identifier` is canonicalized or raw user input
- RLS posture on `companies`, `company_mentions`, `watchlist_articles`
- Cost/rate-limit headroom for any per-page-view Exa fetch
- Whether `/company` should be in scope for the imminent launch at all

## Needs verification (Wednesday morning)
Run these read-only commands (no DB writes) to confirm the diagnosis assumptions before any code work:

```bash
ls src/app/api/companies 2>&1 | head -5
grep -r "exa\|EXA" src/app/company/ src/lib/company-intel.ts | head
grep -n "from(\"companies\"\|from('companies'" src/app/company/page.tsx src/app/company/\[id\]/page.tsx
grep -i "robinhood\|hood" src/lib/company-intel.ts
```

Run separately in Supabase Studio (read-only):
```
select id, name, ticker, mention_count, last_updated from companies where name ilike '%robinhood%' or ticker = 'HOOD';
select id, title, ingested_at from articles where 'Robinhood' = ANY(companies) order by ingested_at desc limit 5;
select name, count(*) from companies group by name having count(*) > 1 order by count(*) desc limit 50;
```

## Rollback
```bash
git checkout main
git branch -D noah/company-intel-investigation  # only after PR closed
git push origin --delete noah/company-intel-investigation  # only if needed
```

PR closes by clicking "Close pull request" in GitHub UI; nothing on main needs reverting because nothing was committed to main.

## Lucas overlap check
`/tmp/lucas-recent.txt` contents:
```
src/components/onboarding/OnboardingWizard.tsx
src/components/thesis/thesis-detail-panel.tsx
```
Confirmed: neither file is referenced on any fix path proposed in `COMPANY_INTEL_FIX_PLAN.md`. No overlap.
