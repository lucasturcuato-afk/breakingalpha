# Brief Polish Pass — Handoff

**Run date:** 2026-04-22
**Branch:** `feat/brief-polish-pass` @ `c8893c6`

---

## Top line

- **PR:** https://github.com/lucasturcuato-afk/breakingalpha/pull/123 (supersedes #121 + #122)
- **Preview:** https://signalera-bujhgnxcr-lucasturcuato-afks-projects.vercel.app
- **Prior PRs:** #121 and #122 closed with "superseded by #123" comment

Both build + tsc green. Walked 4 subagents in parallel. Single merge conflict in `brief-section.tsx` resolved (kept the new compact prop while adopting `leading-relaxed`).

---

## What shipped (5 concrete fixes on top of PRs 121 + 122)

1. **Pull-quote removed.** `splitSummary()` regex was failing on corporate abbreviations ("QXO Inc." yanked as the first "sentence"). Removed entirely. Headline is the hero.
2. **Structured body (`lead_paragraph` + `supporting_context` + `what_to_watch`).** New schema fields in synthesize.py + new DB columns (SQL migration `0006`). Lead hero renders three distinct paragraphs with a subtle gold left-bar on the what-to-watch block. Falls back to `summary` split on `\n\n` if fields missing (backward compat).
3. **Sector whitelist enforcement.** Added SECTOR KEY RULE to both MORNING + EVENING system prompts. Hardened `_validate_sector_breakdown` to remap "Technology AI Infrastructure" → "Technology" via prefix match, drops anything unmappable. Existing bad data in the DB needs re-synthesis; new synthesis protected.
4. **Dashboard mode 60/40 side-by-side.** Inline `gridTemplateColumns: '60fr 40fr'`. Lead quadrant full-height on left, others stacked in right column. Signal-strength score = length capped at 1500 + 300 boost for what_to_watch / tomorrow_setup.
5. **MorningReview visible placeholder + reposition.** Now renders a "Appears after market close (5:00 PM PT daily)" card when outcomes empty, with amber pulsing dot. Moved ABOVE Today's Lead (MarketPulse → Review → Lead → ...). Seed script `scripts/seed_brief_outcomes.py` for preview.

Plus visual polish: Top Stories badge soup reduced, sector filter chips aligned to Thesis Board pattern, sector-signal-card dark mode fixed, Analyst Briefing typography tightened.

---

## Manual setup Noah must do (before testing)

### SQL migrations — Supabase SQL editor, in order

All idempotent.

1. `sql/0003_brief_self_grading.sql`
2. `sql/0004_briefings_public_read.sql`
3. `sql/0005_briefings_morning_review_column.sql`
4. **New:** `sql/0006_briefings_structured_body.sql`
5. `sql/0007_cleanup_sector_breakdown.sql` (note-only, no DDL)

**Also run manually** (no subagent emitted this):
```sql
ALTER TABLE briefings ADD COLUMN IF NOT EXISTS market_pulse jsonb;
```

Without `market_pulse` column, the editorial opener renders nothing (graceful fallback). Without the structured-body columns, LeadHero falls back to the paragraph-split rendering.

### Env vars (unchanged from 121)

```
RESEND_API_KEY=
EMAIL_FROM_ADDRESS=briefs@signalera.com
```

### Resend DNS

See `.sprint-notes/resend-dns-setup.md` in the PR.

### cron-job.org

- URL: `https://signalera.ai/api/grading/grade-brief`
- Method: POST
- Header: `x-internal-key: ${INTERNAL_API_KEY}`
- Schedule: `0 0 * * 1-5` (midnight UTC Tue-Sat)

### Visual preview with seed data

Optional, for seeing the populated MorningReview state without waiting for real grading:
```
python3 scripts/seed_brief_outcomes.py
```
Writes dummy calls + outcomes for today's morning brief + attaches a dummy `morning_review` to today's evening brief. Idempotent.

---

## QA checklist — walk the preview

https://signalera-bujhgnxcr-lucasturcuato-afks-projects.vercel.app

### Morning Brief
- [ ] No pull quote above body
- [ ] Either 3 paragraphs (if new synthesis has run) or clean single-paragraph fallback
- [ ] Sector Signals labels all from the 11-item whitelist (no "Technology AI Infrastructure")
- [ ] Dashboard mode: one big 60% quadrant on left, others stacked 40% on right
- [ ] Editorial mode unchanged (still tabbed single-column)
- [ ] Top Stories: numbered, sentiment dot, single sector pill, no signal-score badge
- [ ] Export menu + Share dropdown still work

### Evening Wrap
- [ ] "MORNING BRIEF REVIEW" section renders (placeholder OR populated via seed)
- [ ] Positioned ABOVE Today's Lead
- [ ] Dashboard mode weighted 60/40
- [ ] Sector labels whitelisted
- [ ] No pull quote

### Cross-mode
- [ ] Light + dark mode both clean
- [ ] Typography consistent (serif display, sans body, mono data) — no mixed fonts leaking
- [ ] Generous spacing

---

## Known issues / follow-ups

- **Structured body only populates on next synthesis run.** Existing `briefings` rows use the fallback path. Monday's morning brief is the first that will render the three-paragraph treatment (if the DB migration is applied before the cron fires).
- **Sector label cleanup is forward-only.** The validator prevents new bad labels; old rows in production still render until overwritten.
- **MorningReview populated state hasn't run end-to-end.** Schema migrations not applied to prod yet → `morning_brief_calls` empty → grading has nothing to grade → `morning_review` never populates. The placeholder card visually confirms the section exists; seed script lets you preview populated state. Full end-to-end depends on Noah's setup.
- **Build warning about stale `.next/types/validator.ts`** — harmless; clears on `rm -rf .next && npm run build`. Verified green after clean build.

---

## Worktree cleanup (after merge)

```bash
cd /Users/noahhanning/breakingalpha

git worktree remove ../breakingalpha-polish-synthesis
git worktree remove ../breakingalpha-polish-dashboard
git worktree remove ../breakingalpha-polish-grading
git worktree remove ../breakingalpha-polish-visual

git branch -D polish-synthesis polish-dashboard polish-grading polish-visual

# After PR 123 merges:
git branch -d feat/brief-polish-pass
git push origin --delete feat/brief-polish-pass feat/brief-revamp-visual feat/brief-revamp-grading
```

Pre-existing worktrees from prior sprints (leave alone — Noah to clean later):
- `../breakingalpha-brief-*`, `../breakingalpha-grading-*`, `../breakingalpha-ui-*`, `../breakingalpha-track-*`, `../breakingalpha-trackrec-*`, `../breakingalpha-v4b`

---

## Autonomous decisions

1. **Removed pull quote** (Option A per spec). Stratechery / Axios Pro / Puck don't use pull quotes in short briefs; headline is enough.
2. **Static 60/40 via `gridTemplateColumns: '60fr 40fr'`** — avoided Tailwind arbitrary class purge risk. Signal-strength score caps length at 1500 + boosts forward-looking sections by 300.
3. **Whitelist remap over drop.** Unknown label like "Technology AI Infrastructure" remaps to "Technology" instead of being dropped — preserves Gemini's sector signal while conforming to the canonical list.
4. **MorningReview placeholder leads with honesty.** Repositioned ABOVE Today's Lead, not between userAddendum and Analyst Briefing. This makes accountability visible immediately rather than hidden below the fold.
5. **Seed script is opt-in.** Noah runs `scripts/seed_brief_outcomes.py` manually to preview the populated state. Doesn't touch prod data paths.
