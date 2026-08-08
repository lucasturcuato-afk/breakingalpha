"""Backtest the release-context path across every release day in the stored window.

Harness rules from #562/#564: stored briefings.market_tape only, fetch_tape() is
NEVER called, point-in-time window bounded by each run's created_at.
"""
import datetime
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
os.environ.setdefault("SUPABASE_URL", os.environ.get("NEXT_PUBLIC_SUPABASE_URL", ""))
os.environ.setdefault("SUPABASE_KEY", os.environ.get("SUPABASE_SERVICE_ROLE_KEY", ""))
os.environ.setdefault("SUPABASE_ANON_KEY", os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY", ""))

from supabase_client import get_service_client  # noqa: E402
import impact_ranking as ir  # noqa: E402
import macro_surprise as ms  # noqa: E402

sb = get_service_client()
SERIES = ("nonfarm_payrolls", "unemployment", "cpi", "core_cpi", "pce", "core_pce", "ppi", "gdp")

print("DEGRADED dimensions (declared, never silently substituted):")
print("  - name_session_pct (live intraday per-name Yahoo quotes, unrecoverable)")
print("  - mega_deal_urls / mega_demote_urls (live deal_flow, no history)")
print("TAPE=stored briefings.market_tape, fetch_tape() NEVER called")
print("WINDOW=point-in-time, bounded above by each run's created_at")
print()


def pool_at(now):
    return ir.fetch_release_text_pool(sb, now)


def periods_of(mp):
    return (mp or {}).get("periods") or {}


rows = (sb.table("briefings")
        .select("id,created_at,briefing_type,headline,market_tape,macro_panel")
        .gte("created_at", "2026-06-15T00:00:00Z")
        .order("created_at", desc=False).limit(400).execute()).data or []
morn = [r for r in rows if r["briefing_type"] == "morning" and (r.get("macro_panel") or {}).get("periods")]
print(f"morning briefs with a macro panel: {len(morn)}")

release_days = []
for i in range(1, len(morn)):
    prev, cur = morn[i - 1], morn[i]
    pp, cp = periods_of(prev["macro_panel"]), periods_of(cur["macro_panel"])
    fired = []
    for k in SERIES:
        a, b = pp.get(k), cp.get(k)
        if not a or not b or a == b:
            continue
        oa, ob = ms._norm, None  # placeholder to keep lint quiet
        fired.append(k)
    if fired:
        release_days.append((cur, fired))

print(f"release days detected in the window: {len(release_days)}\n")
print("=" * 100)
print(f"{'date':12}{'series':18}{'actual':>12}{'prior':>12}  consensus  dir_vs_cons")
print("=" * 100)

with_consensus = 0
summary = []
for br, fired in release_days:
    now = datetime.datetime.fromisoformat(br["created_at"].replace("Z", "+00:00"))
    pool = pool_at(now)
    ctxs = ms.build_release_context(pool, releases=(br["macro_panel"] or {}).get("releases"),
                                    fired_keys=fired)
    for c in ctxs:
        cons = c.get("consensus")
        if cons:
            with_consensus += 1
        print(f"{br['created_at'][:10]:12}{c['release_key']:18}"
              f"{str(c.get('actual_display')):>12}{str(c.get('prior_display')):>12}"
              f"  {ms.format_expected(cons) if cons else 'NONE':<10}"
              f" {c.get('direction_vs_consensus') or '-'}")
        if cons:
            ev = [e for e in c.get("evidence") or [] if e.get("field") == "expected"]
            for e in ev[:1]:
                src_ing = next((a.get("ingested_at") for a in pool
                                if (a.get("title") or "") == e.get("title")), "?")
                print(f"{'':12}  source: {e.get('source')}  ing={str(src_ing)[:19]}  "
                      f"(run at {br['created_at'][:19]})")
                print(f"{'':12}  match : {e.get('match')}")
    summary.append((br, fired, ctxs, pool))

print()
print(f"release-series prints in window: {sum(len(c) for _, _, c, _ in summary)}")
print(f"of those, consensus found in corpus: {with_consensus}")
json.dump([{"date": b["created_at"][:10], "fired": f,
            "ctx": [{k: v for k, v in c.items() if k != "evidence"} for c in cs]}
           for b, f, cs, _ in summary], open("/tmp/release_backtest.json", "w"), default=str)
print("wrote /tmp/release_backtest.json")
