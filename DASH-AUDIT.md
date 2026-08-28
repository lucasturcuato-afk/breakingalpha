# /internal Dashboard Audit

Status: IN PROGRESS. Written incrementally. A section reading PENDING was not
complete at the time of the last commit.

Rules in force: read only against prod, every retained claim carries its raw
query output, aggregates only, no per-user identifiers.

Audit clock: 2026-08-28, roughly 05:00 UTC. Every window is stated as a literal
UTC instant because the views evaluate `now()` per request.

## SUMMARY

Ranked by how badly each distorts a pilot read.

### No live product outage. The suspected memo outage is not real.

The brief asked whether memo generation is dead in production. It is not, and
the dashboard is not lying about it. The 7d zero is the arithmetically correct
answer to "how many memos did real users generate this week". The single memo
generated this week came from an excluded internal account. Detail in the Memos
card section.

What that zero does reveal is a real engagement collapse rather than an
instrumentation bug: non-founder memo usage is about 5 in 30 days and 0 in 7.
That belongs in a pilot conversation, but it is a product fact, not a defect.

### The one thing that looks like an outage and is one

**The commit sheet is unreachable for every signed-in user.** It is mounted at
exactly one place, `src/app/ledger/page.tsx:109`, behind a gate that requires
`user === null && mobileFixtureScreensEnabled()`. The only adoption path a
signed-in reader can actually reach, `BriefCallsSection.tsx:415`, posts
`call_id` and a window and never sends `commit_note` at all. That is why 17 of
18 claim rows have no note. The required-note product loop is not running in
production. This is not a dashboard defect, it is the loop itself, and it
outranks every measurement problem below.

### Ranked defects

1. **D1, CRITICAL. Brief opens per active is an artifact, and it is the most
   quotable card on the page.** 195 of 224 raw brief-open events in the window
   come from one account, 87.1 percent. Distribution is median 2, p90 10, max
   195. Remove that account and 16.38 becomes 2.42. The emit is guarded only by
   a per-mount `useRef`, so every remount, route change, or reload re-fires. The
   top account shows 195 events across 125 distinct sessions but only 5 distinct
   briefing ids, one of them emitted 84 times in a day.

2. **D2, CRITICAL. Companies researched cannot count memo research at all.** All
   142 memo rows in `outputs` have `source_id` NULL, so that branch of the UNION
   contributes zero. The displayed 5 comes entirely from
   `user_memo_regeneration_quota`, written only on regeneration. 96.3 percent of
   research actions never register. `source_id` is not even a company reference:
   it is polymorphic, qualified by `source_table`, and the real company lives in
   `content->>'ticker'`, which the query ignores. Worse, scoped to real users the
   card would read 1, not 5: four of the five companies exist only because of
   excluded founder and test accounts.

3. **D3, HIGH. A same-day bulk of 96 zero-event users now dominates every
   window-sensitive card.** 96 of 199 users were created on 2026-08-28 itself,
   48 percent of the base, and have never fired an event. "New users (7d) = 98"
   is one bulk load plus two. The 2026-08-24 cohort row (size 98) is entirely
   right-censored, its activation window does not close until 2026-09-01, and it
   renders "1 percent activated" and "2 percent retention" with no censoring
   marker at all.

4. **D4, HIGH. Three populations render on one page with no visual
   distinction.** The header asserts founders and test excluded. Waitlist,
   Companies researched, and the whole instrumentation health table are global.
   The proof is internal to the page: Depth shows "Memos generated 160" while
   the instrumentation row for `memo_generated` shows 262, in identical styling,
   a gap of exactly the 102 excluded-user memo events.

5. **D5, HIGH. WAPS is growth-diluted.** Its denominator is all 199 users. 98 of
   them signed up inside the same window and exactly 1 opened a brief. On the
   101 users older than the window WAPS is 9.9 percent, not 5.5. A further 100
   zero-open signups would print 3.7 percent with no behavior change.

6. **D6, HIGH. `thesis_approved` is read in four places and emitted nowhere.**
   Zero emit sites, zero rows. The user-facing "Theses approved" row on
   /settings/preferences is permanently 0, and one third of the
   collective-signals sector filter contributes nothing.

7. **D7, MEDIUM. 35.4 percent of stored telemetry feeds no metric.** All 10
   `surface.object.action` events plus `brief_section_rated` are read by no named
   query, which is 1067 of 3011 rows. Meanwhile `brief.page.opened` and
   `morning_brief_opened` fire from the same effect; the new name is orphaned and
   the old one is what the dashboard reads.

8. **D8, MEDIUM. Brief opens per active mixes populations in its denominator.**
   Numerator is brief-open events, denominator is all 13 actives, not the 11
   openers. Same-population would be 19.36 against the printed 16.38. Real, but
   it deflates rather than inflates, so it ranks below D1.

9. **D9, MEDIUM. Memo events and memo artifacts disagree by roughly 46
   percent.** 262 events against 142 persisted rows. On 2026-08-26 two artifacts
   were written but only one event fired.

10. **D10, LOW. `weeks_since_signup` is measured from the Monday of the signup
    week, not from each user's actual signup.** 29 of 199 users are credited with
    a full extra week of tenure.

11. **D11, LOW. Rounding is inconsistent.** The activation table's two
    percentages are the only ones in the migration with no scale argument, so
    67.2 renders as 67 while every other percentage on the page carries one
    decimal.

12. **D12, LOW. The activation table's helper text is stale.** It says "the
    2026-04-27 cohort is the reliable read". That cohort is no longer the largest
    (58 against 98). It is still the largest complete one, so the intent
    survives, but the sentence is false as written and hard-codes a date.

### Tested and cleared, explicitly not defects

- **New users (7d) is correct.** It filters `created_at`, not
  `last_sign_in_at`. The reported "identical 95 and 95" was coincidence during a
  live import. Proven behaviorally: they now read 98 and 96 and overlap only 75,
  Jaccard 0.63.
- **4-week retention is not a tiny cohort.** The denominator is 100, not under
  30. The brief's concern does not apply to the All row.
- **Percent with a watchlist is correct.** Numerator properly restricted to
  `dim_users`. 40 of 199 is 20.1.
- **No memo event name drift.** All five write sites emit the literal
  `memo_generated`, and a census of all 3011 rows contains no variant.
- **`least()` in the activation view is correct.** Postgres `least()` ignores
  NULLs, which here makes the filter behave as the OR the copy describes. It is
  load-bearing and undocumented, but not a bug.

## CONNECTION

**Method that worked: `.env.local` in the primary checkout, first in the
prescribed hunt order.** It holds `SUPABASE_SERVICE_ROLE_KEY` and
`NEXT_PUBLIC_SUPABASE_URL`, whose host resolves to ref `pnfjelfvtypkpnwpflmv`,
matching the prod ref in the brief.

**auth.users count: 206.** Obtained via the Auth Admin API, since `auth.users`
is not exposed through PostgREST:

```
page 1 returned 200 rows
page 2 returned 6 rows
AUTH_USERS_COUNT=206
```

Query path for the whole audit: PostgREST as `service_role`, which bypasses RLS
and can read the `internal_kpi_*` views (granted to `service_role` only). All
agents shared one read-only helper so nobody rediscovered the credential.

Methods attempted and their verbatim failures:

```
mcp__supabase__execute_sql
  {"error":{"name":"Error","message":"Unauthorized. Please provide a valid
  access token to the MCP server via the --access-token flag or
  SUPABASE_ACCESS_TOKEN."}}

q.sh "pg_views?select=definition"
  {"code":"PGRST205","message":"Could not find the table 'public.pg_views' in
  the schema cache"}

q.sh "information_schema.views?select=view_definition"
  {"code":"PGRST205","message":"Could not find the table
  'public.information_schema.views' in the schema cache"}

.env                    -> No such file or directory
.env.production         -> No such file or directory
which supabase          -> not installed
supabase/.temp/project-ref -> No such file or directory
SUPABASE_ACCESS_TOKEN   -> not set in shell environment
~/.supabase/access-token -> No such file or directory
```

Consequence: no route to the deployed SQL text exists from this environment.
View parity was established behaviorally. See the View Parity section for how
far that goes.

### Live values at audit time

`internal_kpi_summary`, all three segment rows, verbatim:

```json
[{"segment_domain":"All","total_users":199,"weekly_actives":13,"active_30d":17,
  "logged_in_7d":96,"logged_in_30d":104,"new_users_7d":98,"new_users_30d":99,
  "brief_open_users_7d":11,"brief_opens_7d":213,"memos_all_time":160,
  "memos_7d":0,"memos_30d":5,"users_with_watchlist":40,"waps_pct":5.5,
  "watchlist_pct":20.1,"brief_opens_per_active":16.38,"retention_4w_pct":11.0,
  "waitlist_count":130,"distinct_companies_researched":5},
 {"segment_domain":"USC","total_users":153,"weekly_actives":11,"active_30d":14,
  "logged_in_7d":91,"logged_in_30d":96,"new_users_7d":92,"new_users_30d":92,
  "brief_open_users_7d":9,"brief_opens_7d":16,"memos_all_time":147,"memos_7d":0,
  "memos_30d":4,"users_with_watchlist":27,"waps_pct":5.9,"watchlist_pct":17.6,
  "brief_opens_per_active":1.45,"retention_4w_pct":16.4,"waitlist_count":null,
  "distinct_companies_researched":null},
 {"segment_domain":"other","total_users":46,"weekly_actives":2,"active_30d":3,
  "logged_in_7d":5,"logged_in_30d":8,"new_users_7d":6,"new_users_30d":7,
  "brief_open_users_7d":2,"brief_opens_7d":197,"memos_all_time":13,"memos_7d":0,
  "memos_30d":1,"users_with_watchlist":13,"waps_pct":4.3,"watchlist_pct":28.3,
  "brief_opens_per_active":98.50,"retention_4w_pct":2.6,"waitlist_count":null,
  "distinct_companies_researched":null}]
```

Base table sizes, exact, from `content-range` headers:

```
dim_users              199    (auth.users 206, so 7 excluded)
user_events           3011
outputs               9071    (of which output_type=memo: 142)
watchlist              226    (42 distinct users, 5 rows with NULL user_id)
waitlist               130
user_claims             18
user_claim_outcomes     10
morning_brief_call_outcomes  162
```

Drift from the brief's numbers: the brief cited 95 new users, 127 waitlist, 196
total. Live reads 98, 130, 199. Every slow-moving figure the brief cited
reproduces exactly: memos 160 and 0, brief opens per active 16.38, companies
researched 5, retention 11 percent. Only the counters the import is actively
growing moved.

## VIEW PARITY, does prod run the SQL in the repo

DEFINITION: whether the deployed views match
`supabase/migrations/20260602160000_internal_dashboard_phase_b_views.sql`.
Reading the migration is not verification, so this was tested behaviorally.

VERIFIED: match at the projection and metric layer, high confidence.

- Only two migrations mention these objects. The earlier one never defines
  `dim_users`, so `dim_users` exists in prod only because Phase B applied.
- Prod column sets are identical to the file's SELECT lists, same names and
  order: `dim_users` 5, `internal_kpi_summary` 20, retention 6, activation 7,
  instrumentation health 6.
- Every derived metric reproduces from the file's formula on all three rows:

```
All   | waps 5.5 =5.5 | watchlist 20.1 =20.1 | bopa 16.38 =16.38
USC   | waps 5.9 =5.9 | watchlist 17.6 =17.6 | bopa 1.45  =1.45
other | waps 4.3 =4.3 | watchlist 28.3 =28.3 | bopa 98.5  =98.5
ROLLUP total_users: All=199  sum(segments)=199
All-only cols null on segment rows: true
```

- The instrumentation view reproduces exactly against a full raw paging of all
  3011 rows, per-type, with the sum reconciling to 3011 and nothing left over.

DEFECT: NONE at the projection layer. One residual uncertainty, recorded as the
conservative reading: the `dim_users` WHERE exclusion list could not be proven
byte-identical, because it sits upstream of every observable metric and no
catalog route exists. It is consistent with the file:

```
dim_users ids: 199   user_profiles rows: 198
profiles NOT in dim_users: 7
fixture-pattern profiles STILL INSIDE dim_users: 0
dim_users profiles with firm=Signalera: 0
```

Three of the 7 excluded match the `signalera-internal.com` test fixtures in
`scripts/verify_personalization.py` field for field. Conservative reading taken:
consistent-with, not proven-identical, since a variant that blanket-excluded the
`signalera.ai` domain would produce the same 7. SEVERITY: LOW, but every
"founders excluded" claim below inherits this one unproven assumption.

## CARD: Total users

DEFINITION: count of real users, founders and test excluded.
ACTUAL QUERY: `count(*)` over the `peruser` CTE, base `dim_users`.
Window: none. Population: DIM_USERS. Refresh: live query, plain view,
`force-dynamic`, no materialized view anywhere in the migration tree.
VERIFIED VALUE: 199. RENDERED VALUE: 199. DEFECT: NONE.

Caveat carried from D3: 96 of the 199 are hours old with zero events.

## CARD: Active (7d / 30d)

DEFINITION: users who fired any event in the window.
ACTUAL QUERY: `count(*) FILTER (WHERE active_7d)` where `active_7d` is
`bool_or(e.created_at >= now() - interval '7 days')`.
Window: `[2026-08-21T04:58:37Z, 2026-08-28T04:58:37Z]`. Population: DIM_USERS,
enforced by `dim_users LEFT JOIN user_events`. Refresh: live.
VERIFIED VALUE: 13 and 17. RENDERED VALUE: 13 and 17. DEFECT: NONE.

The exclusion is load-bearing and working: unfiltered distinct actors are 15 and
19, so 2 excluded accounts are correctly dropped from each window.

## CARD: New users (7d / 30d)

DEFINITION: users created in the window.
ACTUAL QUERY: `count(*) FILTER (WHERE new_7d)` from
`d.created_at >= now() - interval '7 days'`.
Window: `[2026-08-21T04:57:48.697Z, now]`. Population: DIM_USERS. Refresh: live.
VERIFIED VALUE: 98 and 99. RENDERED VALUE: 98 and 99.

DEFECT: NONE in the query. **The brief's hypothesis is refuted.** This filters
`created_at`, proven behaviorally rather than by reading the SQL:

```
new_users_7d  (created_at >= b7)      : 98
logged_in_7d  (last_sign_in_at >= b7) : 96
last_sign_in_at IS NULL               : 27

--- 7d OVERLAP ---
created7d AND signedin7d              : 75
created7d AND NOT signedin7d          : 23
signedin7d AND NOT created7d          : 21
union                                 : 119
Jaccard                               : 0.6303
```

75 + 23 = 98 and 75 + 21 = 96. Two different columns over two partly disjoint
populations. If both cards read one column they would be pinned equal forever,
and they are not. The earlier 95 and 95 was arithmetic cancellation of two
similar-sized disjoint groups during a live import.

SEVERITY: NONE for the card. See D3 for the import that dominates it:

```
--- created_at histogram by UTC day (last 40d) ---
  2026-07-19 1   2026-07-20 1   2026-07-21 1   2026-07-22 1
  2026-08-10 1   2026-08-25 1   2026-08-27 1   2026-08-28 96
  max created_at: 2026-08-28T04:46:35.205601+00:00
```

Boundary sensitivity is provably zero: no user has `created_at` or
`last_sign_in_at` within plus or minus 12 hours of the 7d boundary, so `now()`
drift cannot move these numbers.

## CARD: Waitlist

DEFINITION: rows on the waitlist.
ACTUAL QUERY:
`CASE WHEN GROUPING(segment_domain)=1 THEN (SELECT count(*) FROM public.waitlist) END`.
Window: none. Population: **GLOBAL**, All row only. Refresh: live.
VERIFIED VALUE: 130. RENDERED VALUE: 130.
DEFECT: population mismatch with the page header. Part of D4.
SEVERITY: HIGH as part of D4, arithmetic correct.

```
waitlist rows: 130   distinct_lower_email: 130
waitlist rows matching a dim_users exclusion: 0
top domains: usc.edu 107, gmail.com 21, dlsu.edu.ph 1, deusenterprises.co 1
columns: id, email, name, signed_up_at, source, notified_at, notes
```

Structurally it cannot be joined to `dim_users`: there is no `user_id` column.
It is a lead list keyed by email, not a user population, yet it renders in the
same `Stat` component as "Total users 199". Note it already carries a `source`
column, which matters for Phase 2.

## CARD: WAPS

DEFINITION: weekly brief openers over total, 7d.
ACTUAL QUERY:
`round(100.0 * count(*) FILTER (WHERE brief_open_user_7d) / nullif(count(*),0), 1)`.
Numerator 11, denominator 199. Window `[2026-08-21T04:58:37Z, now]`.
Population: DIM_USERS both sides. Refresh: live.
VERIFIED VALUE: 5.5. RENDERED VALUE: 5.5.

DEFECT: the denominator is every user ever, so the metric falls as signups grow
regardless of behavior. Confirmed, not theoretical:

```
signed up within 7d = 98 ; older than 7d = 101
brief openers among NEW-7d users = 1 ; among OLDER users = 10
WAPS as shipped (11/199)                   = 5.5
WAPS if denom excluded the 98 new signups  = 10/101 = 9.9
WAPS if denom were weekly actives          = 11/13  = 84.6
WAPS if 100 more signups arrive w/ 0 opens = 11/299 = 3.7
```

SEVERITY: HIGH. This is D5.

## CARD: Weekly actives

DEFINITION: distinct users with any event in 7d.
ACTUAL QUERY: `count(*) FILTER (WHERE active_7d)`. Window
`[2026-08-21T04:58:37Z, now]`. Population: DIM_USERS. Refresh: live.
VERIFIED VALUE: 13. RENDERED VALUE: 13. DEFECT: NONE.

## CARD: 4-week retention

DEFINITION: joined 4 weeks or more ago, active in last 7d.
ACTUAL QUERY:
`round(100.0 * count(*) FILTER (WHERE coh4w AND active_7d) / nullif(count(*) FILTER (WHERE coh4w),0), 1)`.
Windows: cohort `created_at <= 2026-07-31T04:58:37Z`, activity
`>= 2026-08-21T04:58:37Z`. Population: DIM_USERS. Refresh: live.

VERIFIED VALUE: 11.0, from **numerator 11, denominator 100**.
RENDERED VALUE: 11 percent.

DEFECT: NONE, and the brief's concern is refuted. The raw cohort is 100, not
under 30. The cohort is genuinely old: median account age 120 days, youngest 37.

```
CARD3 RET4W = 11 / 100 = 11   DENOMINATOR UNDER 30? false
[USC]   coh4den=61 coh4num=10 ret=16.4
[other] coh4den=39 coh4num=1  ret=2.6
```

Caveat: the "other" segment row is 1 of 39, so one user swings it 2.6 points.
Both segment denominators still clear 30. SEVERITY: NONE for All, LOW for the
segment rows.

## CARD: Brief opens / active

DEFINITION: in-app brief opens per active user, 7d.
ACTUAL QUERY:
`round(sum(brief_opens_7d)::numeric / nullif(count(*) FILTER (WHERE active_7d),0), 2)`.
Numerator 213 events, denominator 13 all-active users.
Window `[2026-08-21T04:58:37Z, now]`. Refresh: live.
VERIFIED VALUE: 16.38. RENDERED VALUE: 16.38.

DEFECT: two independent defects on one card.

**D1, the numerator is an artifact.**

```
total events: 224      distinct users: 13
mean: 17.23   median: 2   p90: 10   max: 195
all per-user counts desc: 195, 10, 3, 3, 3, 2, 2, 1, 1, 1, 1, 1, 1
excl. largest -> events: 29  users: 12  mean: 2.42
top user share of total: 87.1%
```

The segment split reconciles exactly with one account: non-USC shows 197 opens
across 2 actives, which is 195 plus 2. Forensics:

```
TOP USER: distinct sessions: 125
TOP USER: events per day: {"2026-08-25":84,"2026-08-26":1,"2026-08-27":110}
TOP USER: distinct briefing_ids in payload: 5
           events per briefing_id desc: 84, 63, 45, 2, 1
ALL: distinct (user,event_type,briefing_id) tuples: 27
```

195 events across 5 briefs is not five briefs opened. The emit site,
`src/app/morning-brief/page.tsx:574-606`, guards only with a per-mount ref:

```
574:   const briefOpenEmittedFor = useRef<string | null>(null);
579:     if (briefOpenEmittedFor.current === briefingId) return;
580:     briefOpenEmittedFor.current = briefingId;
605:     trackClientEvent("morning_brief_opened", { briefing_id: briefingId });
606:   }, [user, briefing?.id, briefing?.created_at, rankedStories, profile]);
```

The ref resets on every fresh mount, so remount, route change, or reload
re-fires. No once-per-day guard, no session guard, no server dedupe, no unique
constraint. React Strict Mode is NOT the cause: the ref survives the double
effect call within a mount.

A defensible replacement is
`count(DISTINCT (user_id, date_trunc('day', created_at), payload->>'briefing_id'))`,
which on this window yields 27 rather than 224.

**D8, the denominator mixes populations.** The 11 openers are a strict subset of
the 13 actives; 2 actives contribute to the denominator and nothing to the
numerator. Same-population would be 213 / 11 = 19.36 against the printed 16.38,
so this defect deflates by about 15 percent.

SEVERITY: CRITICAL for D1, MEDIUM for D8.

## CARD: Memos generated (all time)

DEFINITION: `memo_generated` events, all time, real users.
ACTUAL QUERY: `sum(memos_all)` from
`count(*) FILTER (WHERE e.event_type = 'memo_generated')` joined through
`dim_users`. Window: none. Population: DIM_USERS. Refresh: live.
VERIFIED VALUE: 160. RENDERED VALUE: 160. DEFECT: NONE in the card.

```
ALL-TIME memo_generated raw rows in user_events : 262
  counted by internal_kpi_summary (dim_users)   : 160   <-- dashboard shows 160
  dropped as founder/test/internal account      : 102
```

That 102 is exactly the gap against the instrumentation table's 262. See D4.

## CARD: Memos (7d / 30d)

DEFINITION: `memo_generated` events in the window, real users.
Windows: 7d `>= 2026-08-21T04:58:29Z`, 30d `>= 2026-07-29T04:58:29Z`.
Population: DIM_USERS. Refresh: live.
VERIFIED VALUE: 0 and 5. RENDERED VALUE: 0 and 5.

DEFECT: **NONE. The brief's headline hypothesis is refuted on both branches.**

No drift. All five write sites emit the literal `memo_generated`:
`src/app/deal-flow/page.tsx:521` and `:618`, `src/app/trends/page.tsx:1220`,
`src/components/memo/MemoModal.tsx:197`,
`src/components/memo/CompanyIntelMemoModal.tsx:224`. A census of all 3011 rows:

```
--- any event_type containing memo/report/brief-doc ---
  memo_generated  n=262
```

Not dead. The artifact table corroborates the event stream:

```
outputs output_type=memo :: ALL TIME  142
outputs memo :: last 30d (>=2026-07-29)  15
outputs memo :: last 7d  (>=2026-08-21)   2
most recent memo artifact: 2026-08-26T05:42:32Z  (about 2 days ago)
most recent memo_generated event: 2026-08-26T05:39:33Z
```

The line that settles 7d = 0:

```
memo_generated events in last 7d: 1
   created_at=2026-08-26T05:39:33.009422+00:00  in_dim_users=false
```

Weekly shape, a mid-July step-down with a partial August recovery, so not a
clean code-regression cliff:

```
2026-06-08 11 | 2026-06-15 20 | 2026-06-22 29 | 2026-06-29 11
2026-07-06 15 | 2026-07-13  1 | 2026-07-20  1 | 2026-07-27  0
2026-08-03  4 | 2026-08-10  9 | 2026-08-17  2 | 2026-08-24  1
```

SEVERITY: NONE as a dashboard defect. D9 (262 events against 142 artifacts) and
the mid-July step-down are follow-ups.

## CARD: Companies researched

DEFINITION: distinct companies researched. Subtitle: "global, capture fix
deferred (D5a)".
ACTUAL QUERY:

```sql
SELECT count(*) FROM (
  SELECT source_id::text FROM public.outputs
    WHERE output_type = 'memo' AND source_id IS NOT NULL
  UNION
  SELECT company_id FROM public.user_memo_regeneration_quota
    WHERE company_id IS NOT NULL
) z
```

Window: none. Population: **GLOBAL**, All row only. Refresh: live.
VERIFIED VALUE: 5. RENDERED VALUE: 5.

DEFECT: severe, and worse than the subtitle admits.

```
memo rows fetched      : 142
source_id NOT NULL     : 0
source_id NULL         : 142 = 100.0%
source_table NOT NULL  : 0
content.company_id notN: 0
content.ticker NOT NULL: 43 = 30.3%
DISTINCT source_id     : 0
DISTINCT content.ticker: 28
```

The `outputs` branch contributes zero. The displayed 5 is entirely the
regeneration-quota table, all 6 of its rows:

```
Anthropic | SpaceX | SpaceX | Tesla | Bank Of America | Snowflake
```

`source_id` is not a company reference. A `sec_filing` row shows what it holds:

```json
{"output_type":"sec_filing","source_table":"sec_filings",
 "source_id":"29f6ae35-9477-461b-9b88-0c3e86900235"}
```

A memo row, both NULL, company living elsewhere:

```json
{"source_table":null,"source_id":null,"cid":null,"tick":"NVO"}
```

Capture gap: against the card's sibling metric of 160 memo events by real users,
only the 6 quota rows can contribute a company, so **96.3 percent of research
actions never register** (154 of 160). Against 142 persisted memo rows it is 100
percent. Latent type defect: even if populated, `source_id::text` is a UUID
unioned against free-text names like "Bank Of America", so the branches could
never dedupe.

Population defect on top:

```
GLOBAL distinct companies (as rendered): 5
DIM_USERS-scoped distinct companies (if joined): 1
companies attributable ONLY to excluded founder/test users: 4
```

Both underlying tables carry `user_id`, so this is an omitted join, not an
unjoinable table.

SEVERITY: CRITICAL. This is D2.

## CARD: Percent with a watchlist

DEFINITION: share of real users holding at least one watchlist row.
ACTUAL QUERY: `wl AS (SELECT DISTINCT user_id FROM public.watchlist)` then
`LEFT JOIN wl ON wl.user_id = d.id`, then
`round(100.0 * count(*) FILTER (WHERE has_watchlist) / nullif(count(*),0), 1)`.
Window: none. Population: DIM_USERS both sides. Refresh: live.
VERIFIED VALUE: 20.1, from 40 of 199. RENDERED VALUE: 20.1, sub-label "40 of
199". DEFECT: NONE.

```
watchlist rows        : 226
watchlist user_id NULL: 5
DISTINCT watchlist users (ALL): 42
watchlist users IN dim_users   : 40
watchlist users NOT in dim_users: 2
pct (restricted) : 20.1%
pct (ALL wl users/199): 21.1%
```

The join correctly restricts the numerator. Counting all 42 would read 21.1.

## CARD: Secondary footnote, users with a sign-in

DEFINITION: reachability, not engagement, per its own label.
ACTUAL QUERY: `count(*) FILTER (WHERE logged_7d)` from
`d.last_sign_in_at >= now() - interval '7 days'`.
Population: DIM_USERS. Refresh: live.
VERIFIED VALUE: 96 and 104. RENDERED VALUE: 96 and 104. DEFECT: NONE.
The page already labels this correctly as reachability rather than engagement.

## TABLE: Activation funnel

DEFINITION: within 7 days of each user's own signup, share onboarded and
activated. Activated = first brief open or first memo.
Population: DIM_USERS. Refresh: live.
VERIFIED: reproduces from raw `dim_users` plus `user_events` on all 17 rows.

```
cohort_week  size  onb  onb_pct  act  act_pct
2026-03-30    6     0     0       0     0
2026-04-06    2     0     0       0     0
2026-04-13    2     0     0       0     0
2026-04-20    3     0     0       0     0
2026-04-27   58    39    67      30    52
2026-05-04    6     3    50       1    17
2026-05-11    2     1    50       1    50
2026-05-18    3     1    33       1    33
2026-05-25    4     4   100       1    25
2026-06-01    5     3    60       3    60
2026-06-15    1     0     0       0     0
2026-06-22    2     2   100       2   100
2026-06-29    2     1    50       1    50
2026-07-13    1     0     0       0     0
2026-07-20    3     0     0       0     0
2026-08-10    1     0     0       0     0
2026-08-24   98     2     2       1     1
```

DEFECTS:

1. **Right-censored cohort rendered as measurement.** The 2026-08-24 row is 98
   users, of whom 96 were created on 2026-08-28 with zero events ever. Its 7-day
   window does not close until 2026-09-01. "1 percent activated" is not a
   measurement. No censoring marker. SEVERITY: HIGH, part of D3.

```
cohort 2026-08-24 n=98 signups per UTC day = {"2026-08-25":1,"2026-08-27":1,"2026-08-28":96}
of those 98, users with ZERO events ever = 96
users whose own 7-day activation window is NOT yet closed = 98
```

2. **`onboarded_7d` has no lower bound** (line 148). Latent, not live: zero
   events in prod predate their own user's signup, minimum gap +31.9 seconds.
   Nothing in the schema forbids it, so a backdated or replayed event would count
   a user as activated before they existed. One-line fix: add
   `first_onb >= created_at`. SEVERITY: LOW, latent.

3. **`least()` NULL-swallowing is correct but undocumented.** Verified:

```
activated_view_least: 41
activated_explicit_or: 41
activated_if_both_required: 25
briefOnly_counted_activated: 13   memoOnly_counted_activated: 3
```

   16 of the 41 are counted only because `least()` ignores NULLs. The behavior
   matches the UI copy. No change needed, but it should be an explicit `OR` or
   carry a comment. SEVERITY: NONE, fragility note only.

4. **Rounding inconsistency.** Lines 149 and 151 are the only percentages in the
   migration with no scale argument; lines 98, 99, 101, 125 all use
   `round(x, 1)`. 2026-04-27 shows 67 and 52 instead of 67.2 and 51.7.
   SEVERITY: LOW. This is D11.

5. **Stale helper text.** `page.tsx:185` says "the 2026-04-27 cohort is the
   reliable read". It is no longer the largest (58 against 98), though it remains
   the largest complete one. SEVERITY: LOW. This is D12.

## TABLE: Retention cohorts

DEFINITION: per signup week, share active in the last 7d.
Population: DIM_USERS. Refresh: live.

```
cohort_week  size  active_7d  retention  weeks_ago
2026-03-30    6     0           0         21
2026-04-06    2     0           0         20
2026-04-13    2     0           0         19
2026-04-20    3     0           0         18
2026-04-27   58     7          12.1       17
2026-05-04    6     0           0         16
2026-05-11    2     1          50         15
2026-05-18    3     0           0         14
2026-05-25    4     1          25         13
2026-06-01    5     2          40         12
2026-06-15    1     0           0         10
2026-06-22    2     0           0          9
2026-06-29    2     0           0          8
2026-07-13    1     0           0          6
2026-07-20    3     0           0          5
2026-08-10    1     0           0          2
2026-08-24   98     2           2          0
SUM cohort_size=199    SUM active_last_7d=13
```

VERIFIED: `SUM(cohort_size) = 199 = total_users`. Cross-check PASS.

DEFECTS:

1. **15 of 17 rows have cohort_size under 30**, so their percentages are noise
   rendered identically to signal. Several are n=1, where retention can only ever
   print 0 or 100. Only 2026-04-27 (58) and 2026-08-24 (98) clear 30, and the
   latter is censored. SEVERITY: MEDIUM.

2. **`weeks_since_signup` is measured from the Monday 00:00 UTC start of the
   signup week**, not each user's own signup (line 126). Measured impact: 29 of
   199 users land in a strictly higher bucket than their true tenure, overstated
   by up to a full week. The 2026-08-24 row reads 0 weeks while 96 of its members
   are hours old. SEVERITY: LOW. This is D10.

3. **Weeks with zero signups are absent rather than zero-filled**, so the "Weeks
   ago" column jumps 12, 10, 9 and 8, 6, 5, 2, 0. Reads as missing data in a
   cohort table. SEVERITY: LOW.

## TABLE: Instrumentation health

DEFINITION: per event type, freshness and volume.
Population: **GLOBAL**, no `dim_users` join (line 168). Refresh: live.
VERIFIED: reproduces exactly against a full raw paging of all 3011 rows.

```
event_type             last_seen    days_ago  7d    30d   all
brief_section_rated    2026-05-06   114        0     0     12   <- SILENT
thesis_dismissed       2026-06-17    72        0     0      3   <- SILENT
watchlist_added        2026-08-07    21        0     1     30   <- SILENT
watchlist_removed      2026-08-10    18        0     1      9   <- SILENT
thesis_viewed          2026-08-24     4       12    29    293
pattern_clicked        2026-08-25     3        4     5     50
memo_generated         2026-08-26     2        1    16    262
brief.content.copied   2026-08-26     2        1     1      1
brief.deal.exposed     2026-08-26     2       11    27     30
brief.story.exposed    2026-08-26     2       34    92     96
evening_wrap_opened    2026-08-27     1      139   157    530
brief.call.tracked     2026-08-27     1        3    13     14
brief.call.exposed     2026-08-27     1       41   147    157
wrap.page.opened       2026-08-27     1      139   157    159
sector_filter_applied  2026-08-28     0       10    10    306
brief.page.scrolled    2026-08-28     0       80   171    175
brief.page.opened      2026-08-28     0       85   172    178
morning_brief_opened   2026-08-28     0       85   172    400
onboarding_completed   2026-08-28     0        2     2     61
brief.section.dwelled  2026-08-28     0       65   229    245
SUM events_all=3011  (= full user_events table, confirming no dim_users filter)
```

DEFECTS:

1. **Global population under a header claiming exclusion.** 1242 of 3011 events,
   41.2 percent, come from just 3 user ids outside `dim_users`:

```
brief.call.tracked     78.6% outside dim_users
brief.story.exposed    74.0%
brief.deal.exposed     73.3%
brief.call.exposed     63.1%
brief.section.dwelled  62.4%
morning_brief_opened   52.5%
evening_wrap_opened    51.5%
memo_generated         38.9%
```

   The view's own comment states this intent, but the page header does not.
   SEVERITY: HIGH, part of D4.

2. **`days_since_last` is a date subtraction on a different clock from
   `events_7d`.** Confirmed inconsistent:

```
sector_filter_applied  age_hours=0.0   displays 0
morning_brief_opened   age_hours=1.0   displays 0
evening_wrap_opened    age_hours=5.5   displays 1
brief.call.tracked     age_hours=16.3  displays 1
```

   A row showing "1 day ago" can be fresher than another showing "0". At the
   boundary an event 7.2 days old yields `events_7d = 0` with
   `days_since_last = 7`, printing "silent" next to "7 days ago". SEVERITY: LOW.

3. **The UI flags silent on `events_7d === 0` alone** (`page.tsx:262`) while the
   view's comment documents the flag as `days_since_last > 7 AND events_7d = 0`.
   The code is more aggressive than its spec. SEVERITY: LOW.

4. **The view's comment is stale on `watchlist_added`.** It names
   `watchlist_added` and `brief_section_rated` as gone silent. Only
   `brief_section_rated` is truly dead (114 days, 0 in 30d). `watchlist_added`
   fired 21 days ago and has a row inside the 30d window, and it is correctly
   wired end to end. SEVERITY: LOW.

## INVARIANTS

PENDING

## EVENT INVENTORY

Three enumerations done independently, then diffed both ways.

**Emitted: 21 distinct names the application can produce.** Two shared type
unions (`src/lib/track-event.ts:22-34` and `src/lib/user-profile.ts:57-69`)
declare 12 legacy snake_case members, of which 11 have emit sites. The union is
NOT a closed allowlist: `track-event.ts:37-39` also permits the open form
`${string}.${string}.${string}`, and `api/user-events/route.ts:16` validates by
regex, not by enum. Ten `surface.object.action` names come from hook configs.

**Present in prod: 20 distinct names.** Verified by paging all 3011 rows in four
pages and grouping locally. The per-type sum reconciles to exactly 3011, so no
event type can be hiding. This independently reproduces
`internal_kpi_instrumentation_health` on all 20 rows.

**Read: 11 distinct names**, every one of them legacy snake_case. Read sites are
the two KPI migrations (8 literal filters), `collective-signals/route.ts:42`,
`user-profile.ts:84-94`, `profile/insights/route.ts:37-44`, and
`BehavioralInsights.tsx:30-41`. **Zero `surface.object.action` names appear in
any read path.**

### Orphaned: emitted and stored, read by nothing

```
event_type              prod rows   emit site
brief.call.exposed            157   morning-brief:668
brief.call.tracked             14   BriefCallsSection:441
brief.content.copied            1   morning-brief:693
brief.deal.exposed             30   morning-brief:645
brief.page.opened             178   morning-brief:582
brief.page.scrolled           175   morning-brief:685
brief.section.dwelled         245   morning-brief:652-657
brief.story.exposed            96   morning-brief:640
wrap.page.opened              159   evening-wrap:606
brief_section_rated            12   morning-brief:198, evening-wrap:299
--------------------------------------------------------------
ORPHANED ROWS                1067  of 3011 = 35.4% of all telemetry
```

Absence method: complete enumeration. `grep -rn "event_type" supabase/` returns
exactly 28 lines, all enumerated, and no dotted name appears in any of them.

Note the duplication: `brief.page.opened` (178) and `morning_brief_opened` (400)
fire from the same effect (`morning-brief:582` and `:605`); `wrap.page.opened`
(159) and `evening_wrap_opened` (530) likewise. The richer new name is orphaned
and the thin old one is what every metric reads.

### Dead reference: read by a query, emitted nowhere

```
thesis_approved
  READ AT:  collective-signals/route.ts:42   (1 of 3 terms in the .in() filter)
            user-profile.ts:86               (POSITIVE_EVENTS, inferred weights)
            profile/insights/route.ts:39     (POSITIVE, sector activity)
            BehavioralInsights.tsx:32        "Theses approved", user-visible
  EMITTED AT: nowhere
  PROD ROWS:  0
```

Absence method, both permitted forms used. Query:
`q.sh --count "user_events?event_type=eq.thesis_approved"` returns
`content-range: */0`. Enumeration: `grep -rn "thesis_approved" src/ supabase/`
returns exactly 6 lines, all read paths or type declarations, not one a
tracking call.

Impact: "Theses approved" is permanently 0 on the user-facing Learned screen,
one third of the collective-signals sector filter contributes nothing, and the
positive weight bump for approvals can never fire. This is D6.

### Emitted, reachable, zero rows

```
wrap.call.tracked
  EMIT SITE: BriefCallsSection.tsx:441 `${surface}.call.tracked`,
             reachable via evening-wrap/page.tsx:1484 passing surface="wrap"
  PROD ROWS: 0        (q.sh --count -> content-range: */0)
  CONTRAST:  brief.call.tracked with surface="brief" has 14 rows
```

Also confirmed zero and worth noting: the evening-wrap surface has no attention
hooks at all. A grep for
`useExposure|useSectionDwell|useScrollDepth|useCopySignal|eventName` in
`src/app/evening-wrap/page.tsx` returns zero lines, complete enumeration.

### Data quality note on the exposure events

`brief.call.exposed` has 157 rows but only 129 carry a non-null `entity_id`, so
28 exposures cannot be attributed to a call.

## LOOP COVERAGE

One row per step. Absence claims rest on complete enumeration: the 20 prod event
names sum to exactly 3011, the full row count, so no name exists outside that
list.

| # | Step | Instrumented | Event | Rows | Situation |
|---|---|---|---|---|---|
| 1 | brief open | YES | `brief.page.opened` plus legacy `morning_brief_opened`; wrap twins | 178 / 400 / 159 / 530 | FIRING |
| 2 | brief scroll depth | YES | `brief.page.scrolled` | 175 | FIRING |
| 3 | call viewed | YES | `brief.call.exposed` | 157 (129 with a call id) | FIRING |
| 4 | commit sheet opened | NO | none | 0 | NOT INSTRUMENTED |
| 5 | commit sheet abandoned | NO | none | 0 | NOT INSTRUMENTED |
| 6 | adoption completed | YES | `brief.call.tracked` | 14 (`wrap.call.tracked` 0) | FIRING on brief surface only |
| 7 | commit note length | NO event, YES derivable | column `user_claims.commit_note` | 1 of 18 non-null | DERIVABLE from column |
| 8 | resolution state change | NO | none | 0 events, 10 outcome rows | NOT INSTRUMENTED |
| 9 | adopter viewing the resolution of their own adopted call | NO | none | 0 | NOT INSTRUMENTED and NOT DERIVABLE |
| 10 | adopter returning in a later session after an adopted call moved to challenged | NO event, YES derivable | derived from `session_id` + `created_at` | 1 challenged claim, 9 later sessions | DERIVABLE |

Details that matter:

**Steps 4 and 5.** `src/components/commit/commit-sheet.tsx` does not import the
tracking helper at all (`grep -rn "trackClientEvent|@/lib/track-event"
src/components/commit/` returns no matches). Dismiss paths and the
editing/pressing/saving/failed phase transitions are local state only.

**The gate that explains step 7.** The commit sheet is mounted at exactly one
place, `src/app/ledger/page.tsx:109`, behind `sampleAllowed` at `:71`, which is
`user === null && mobileFixtureScreensEnabled()`. A signed-in user cannot reach
it. The adoption path they can reach, `BriefCallsSection.tsx:415`, posts
`call_id` and window and never sends `commit_note`. That is the mechanism behind
17 of 18 rows having no note.

**Step 8.** The transition is a row write in `user_claim_outcomes` plus a
`user_claims.status` change, performed by
`backend/grading/grade_user_claims.py:187`, which emits no telemetry.

**Step 9.** Every surface that renders a reader's own resolution (`/review`,
`/ledger`, `/radar/calls`, the your-calls widget) is telemetry-silent, so no
join has a left-hand event to join to. Required new emission:
`review.resolution.viewed` with `entity_type="user_claim"`,
`entity_id=user_claims.id`, payload carrying outcome state (supported,
challenged, developing, awaiting), `graded_at`, `seconds_since_graded`,
`days_since_adopted`. A weaker proxy exists today (same user re-exposed to the
originating call after `graded_at`) and matches 2 of 10 pairs, but it witnesses
the desk's grading rather than the adopter's own view.

**Step 10.** Derivable with no new emission:

```sql
user_claim_outcomes o
  JOIN user_claims c ON c.id = o.claim_id AND c.source = 'adopted'
  JOIN user_events  e ON e.user_id = c.user_id AND e.created_at > o.graded_at
WHERE o.verdict = 'wrong' AND o.attribution = 'clean'
-- then count(distinct e.session_id) grouped by o.claim_id
```

`wrong` plus `clean` maps to challenged per `src/lib/scored-object-map.ts:11-18`
and `src/lib/verdict-vocabulary.ts:38-45`. Run today it returns 1 challenged
adopted claim and 9 distinct later sessions for that adopter.

## USER_CLAIMS

Full column list (19), so the morning reader knows what exists:

```
id, user_id, user_claim, claim_type, target_symbol, expected_direction,
resolution_method, resolution_window_start, resolution_window_end,
evidence_entities, gradeable, gradeability_note, confidence_in_reduction,
status, source, adopted_from_call_id, created_at, commit_note, commit_note_at
```

```
TOTAL ROWS: 18
source breakdown: adopted 15, authored 3
status breakdown: graded 6, open 6, ungradable 4, archived 2
claim_type breakdown: ticker 10, sector 8
adopted_from_call_id NOT NULL: 15
distinct users: 3
```

Boundaries used, both half-open UTC: 7d `[2026-08-21T00:00:00Z,
2026-08-29T00:00:00Z)`, 28d `[2026-07-31T00:00:00Z, 2026-08-29T00:00:00Z)`.

```
adoptions in last 7d : 3
adoptions in last 28d: 13
all rows in last 7d  : 3
all rows in last 28d : 14
min created_at: 2026-07-04T08:11:21Z   max: 2026-08-26T04:09:56Z
```

Commit note length histogram, bucketed exactly as asked. The column is literally
named `commit_note`:

```
commit_note NON-NULL count: 1   NULL count: 17
note lengths sorted: [93]
HISTOGRAM: {"<=12":0,"13-25":0,"26-60":0,"60+":1}
exactly 12 chars: 0 of 1 notes = 0.0%
```

**Interpretation, stated carefully.** With one note in the entire table, the
filler-versus-thought ratio is not computable, and any claim either way would be
unsupported. The finding that matters is not the ratio but the denominator: 17
of 18 rows have no note at all, because the sheet that collects it is behind a
signed-out fixture gate (see Loop Coverage). The note requirement is not reaching
production.

Adoptions per adopting user:

```
all 18 rows, counts per user: 8, 7, 3     median 7, max 8, exactly-one users 0
adopted only (15),   per user: 8, 4, 3    median 4, max 8, exactly-one users 0
```

**Mobile versus desktop CANNOT be distinguished at all.** Positive evidence, not
a failed grep: the full 19-column list above contains no user_agent, device,
platform, or viewport column; the only JSONB column (`resolution_method`) carries
only `method, adopted, version, graded_by, adopted_horizon`; a token scan over
every row's full JSON matched zero device or UA tokens; and
`grep -rn "CREATE TABLE" sql/ | grep -iE "event|analytic|telemetry|session|device|log"`
returns no matches, so no adjacent table could recover it. The only available
inference is that the commit sheet is the mobile surface, which makes the single
noted row likely mobile, but that is inference from code, not a split from data.

**The 12 character minimum is enforced CLIENT-SIDE ONLY and is bypassable.**

```
src/components/commit/commit-sheet.tsx:53   export const COMMIT_NOTE_MIN = 12;
src/components/commit/commit-sheet.tsx:110  const noteReady = note.trim().length >= COMMIT_NOTE_MIN;
src/components/compose/compose-data.ts:47   export const NOTE_MIN_CHARS = 12;
src/components/compose/compose-screen.tsx:129  const noteOk = note.trim().length >= NOTE_MIN_CHARS;
```

The server route applies no minimum (`adopt/route.ts:57-62` only trims and
truncates) and the DB CHECK only requires non-empty. The route header states the
client-side placement is deliberate.

## METRIC GAPS

PENDING

## FOLLOW-UPS

PENDING
