"""Live-render the pulse for every release day and two non-release days.

Harness rules: stored briefings.market_tape only, fetch_tape() NEVER called,
point-in-time window bounded by each run's created_at.
"""
import datetime
import json
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
for k, v in (("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"),
             ("SUPABASE_KEY", "SUPABASE_SERVICE_ROLE_KEY"),
             ("SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY")):
    os.environ.setdefault(k, os.environ.get(v, ""))

from supabase_client import get_service_client  # noqa: E402
import impact_ranking as ir  # noqa: E402
import macro_surprise as ms  # noqa: E402
import synthesize as syn  # noqa: E402

sb = get_service_client()
SER = ("nonfarm_payrolls", "unemployment", "cpi", "core_cpi", "pce", "core_pce", "ppi", "gdp")
RELEASE_WORDS = ("payroll", "nonfarm", "cpi", "consumer price", "pce", "ppi", "producer price",
                 "gdp", "gross domestic", "unemployment rate", "jobs report",
                 "released today", "consensus", "expectations", "expected")


def brief(day):
    return (sb.table("briefings")
            .select("id,created_at,market_tape,macro_panel")
            .eq("briefing_type", "morning")
            .gte("created_at", f"{day}T00:00:00Z").lte("created_at", f"{day}T23:59:59Z")
            .order("created_at").limit(1).execute()).data[0]


def fired_for(day):
    rows = (sb.table("briefings").select("created_at,macro_panel")
            .eq("briefing_type", "morning").lte("created_at", f"{day}T23:59:59Z")
            .order("created_at", desc=True).limit(6).execute()).data or []
    rows = [r for r in rows if (r.get("macro_panel") or {}).get("periods")]
    if len(rows) < 2:
        return []
    cp = rows[0]["macro_panel"]["periods"]
    pp = rows[1]["macro_panel"]["periods"]
    return [k for k in SER if pp.get(k) and cp.get(k) and pp[k] != cp[k]]


def stories(now):
    sp = (sb.table("articles")
          .select("id,title,summary,companies,sector,relevance_score,ingested_at,published_at")
          .gte("ingested_at", (now - datetime.timedelta(hours=24)).isoformat())
          .lt("ingested_at", now.isoformat())
          .gte("published_at", (now - datetime.timedelta(hours=48)).isoformat())
          .lt("published_at", now.isoformat())
          .order("relevance_score", desc=True).order("ingested_at", desc=True)
          .limit(60).execute()).data or []
    return syn._pulse_top_stories(sp, None, lambda a: a.get("companies") or [])


def render(day, label):
    br = brief(day)
    now = datetime.datetime.fromisoformat(br["created_at"].replace("Z", "+00:00"))
    fired = fired_for(day)
    t0 = time.time()
    pool = ir.fetch_release_text_pool(sb, now)
    fetch_s = time.time() - t0
    ctx = ms.build_release_context(pool, releases=(br["macro_panel"] or {}).get("releases"),
                                   fired_keys=fired)
    strip = "\n".join(x for x in (ms.format_release_strip_line(c) for c in ctx) if x)
    clause, branch = syn._pulse_macro_framing(
        bool(fired), {"has_driver": False, "decisive_move": False, "drivers": []},
        release_ctx=ctx)
    print("=" * 92)
    print(f"{label}   {day}   fired={fired or 'NONE'}")
    print(f"release_text_pool: {len(pool)} rows in {fetch_s:.2f}s")
    print(f"release_context ({len(ctx)} object(s)):")
    for c in ctx:
        print(f"  {c['release_key']:18} period={c.get('period')!s:12} "
              f"actual={c.get('actual_display')!s:9} prior={c.get('prior_display')!s:9} "
              f"consensus={'PRESENT ' + ms.format_expected(c['consensus']) if c.get('consensus') else 'ABSENT':22} "
              f"vs_prior={c.get('direction_vs_prior')} vs_cons={c.get('direction_vs_consensus') or '-'}")
    if not ctx:
        print("  (empty)")
    print(f"release_framing_clause = {clause[:60]!r}{' ...' if len(clause) > 60 else ''}")
    print(f"branch = {branch}")
    n = syn.generate_market_pulse("morning", br["market_tape"], strip, stories(now),
                                  prior_ctx=None, macro_is_release_day=bool(fired),
                                  release_ctx=ctx)
    print("-" * 92)
    print(n or "(generation returned None)")
    path = "v2_primary" if n else "minimal_template"
    print(f"pulse_shipped_path = {path}")
    leaks = [w for w in RELEASE_WORDS if w in (n or "").lower()] if not fired else []
    if leaks:
        print(f"  !! NON-RELEASE DAY LEAK: mentions {leaks}")
    print()
    return {"day": day, "fired": fired, "ctx": ctx, "path": path,
            "clause": clause, "narrative": n, "leaks": leaks, "fetch_s": fetch_s,
            "pool": len(pool), "strip": strip}


out = []
print("#" * 92)
print("PART 1: NON-RELEASE DAYS (release_context must be empty, clause must be '')")
print("#" * 92)
for d in ((_o.environ.get("NONREL") or "2026-08-06,2026-08-05").split(",") if (_o := __import__("os")) else []):
    out.append(render(d, "NON-RELEASE"))

print("#" * 92)
print("PART 2: EVERY RELEASE DAY IN THE STORED WINDOW, full context set")
print("#" * 92)
import os as _o
_days = (_o.environ.get("DAYS") or "2026-06-25,2026-07-02,2026-07-14,2026-07-15,2026-07-30,2026-08-07").split(",")
for d in _days:
    out.append(render(d, "RELEASE"))

print("#" * 92)
print("SUMMARY")
print("#" * 92)
bad = [r for r in out if r["path"] != "v2_primary"]
print(f"renders: {len(out)}   minimal_template: {len(bad)}")
print(f"non-release leaks: {sum(len(r['leaks']) for r in out)}")
tot = sum(r["fetch_s"] for r in out)
print(f"release_text_pool: {sum(r['pool'] for r in out)} rows across {len(out)} runs, "
      f"{tot:.2f}s total, {tot/len(out):.2f}s mean per run")
json.dump([{k: v for k, v in r.items() if k != "ctx"} for r in out],
          open("/tmp/renders.json", "w"), default=str)
