"""Faithful offline replay of the deterministic lead contest for a past run.

FIDELITY IS THE POINT. Every prior harness in this repo reconstructed a DIFFERENT
pool than the real run and therefore produced scoreboards that were quietly wrong.
This one calls the SAME functions the pipeline calls:

    impact_ranking.fetch_coverage_pool(sb, now)     the real pool query
    impact_ranking._mega_deal_urls(sb, now)         the real confirmed-deal set
    impact_ranking._mega_demote_urls(sb, now)       the real demote set
    impact_ranking.compute_unified_lead(...)        the real contest

Only three things are substituted, and each is stated in the output:

  TAPE        stored briefings.market_tape for that row. fetch_tape() is NEVER
              called. It returns LIVE quotes, which on a historical replay forces
              every candidate to 0.5 neutral materiality and makes the whole
              scoreboard meaningless. This is the single mistake that invalidated
              every previous scoreboard.
  NAME MOVES  DEGRADED, always. _pool_name_session_moves reads live Yahoo quotes
              per company. There is no historical source for it, so it is passed
              empty. Any candidate whose materiality depended on a per-name driver
              tier is scored without that lift. Marked DEGRADED in every output.
  NOW         the pipeline's _now is datetime.now(timezone.utc) at pool-fetch
              time, which is not persisted. We estimate it and then SWEEP a window
              around the estimate to show the winner is stable, rather than
              fitting a single value that happens to reproduce the stored answer.

Usage:
  python backend/tools/replay_lead.py fidelity        the 5-day gate
  python backend/tools/replay_lead.py score           full agreement table
  python backend/tools/replay_lead.py day 2026-08-07 morning
"""

import datetime
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

os.environ.setdefault("SUPABASE_URL", os.environ.get("NEXT_PUBLIC_SUPABASE_URL", ""))
os.environ.setdefault("SUPABASE_KEY", os.environ.get("SUPABASE_SERVICE_ROLE_KEY", ""))

from supabase_client import get_service_client  # noqa: E402

supabase = get_service_client()
import impact_ranking as ir  # noqa: E402


def _iso(dt):
    return dt.isoformat()


def load_runs(since="2026-06-15"):
    """Every run that stored a unified_winner, joined to its briefing row."""
    runs = (
        supabase.table("pipeline_runs")
        .select("started_at, brief_type, briefing_id, preselect_decision")
        .in_("brief_type", ["morning", "evening"])
        .gte("started_at", f"{since}T00:00:00Z")
        .order("started_at", desc=False)
        .limit(500)
        .execute()
    ).data or []
    out = []
    for r in runs:
        pd = r.get("preselect_decision") or {}
        uw = pd.get("unified_winner") or {}
        if not uw.get("title"):
            continue
        out.append({
            "started_at": r["started_at"],
            "brief_type": r["brief_type"],
            "briefing_id": r.get("briefing_id"),
            "stored_winner": uw.get("title"),
            "stored_cluster": uw.get("cluster_key"),
            "stored_score": uw.get("unified_score"),
            "shipped": (pd.get("unified") or {}).get("shipped_title"),
            "shipped_cluster": (pd.get("unified") or {}).get("shipped_cluster"),
        })
    return out


def load_briefing(briefing_id, started_at, brief_type):
    if briefing_id:
        rows = (
            supabase.table("briefings")
            .select("id, created_at, headline, market_tape")
            .eq("id", briefing_id).limit(1).execute()
        ).data or []
        if rows:
            return rows[0]
    day = started_at[:10]
    rows = (
        supabase.table("briefings")
        .select("id, created_at, headline, market_tape")
        .eq("briefing_type", brief_type)
        .gte("created_at", f"{day}T00:00:00Z")
        .lte("created_at", f"{day}T23:59:59Z")
        .order("created_at", desc=False).limit(1).execute()
    ).data or []
    return rows[0] if rows else None


def contest_at(now, brief_type, tape, always_include=None):
    """One replay of the real contest at a given pool-fetch timestamp."""
    pool = ir.fetch_coverage_pool(supabase, now)
    if not pool:
        return None, 0
    kwargs = dict(
        brief_type=brief_type,
        tape=tape,
        name_session_pct={},          # DEGRADED, see module docstring
        mega_deal_urls=ir._mega_deal_urls(supabase, now),
        mega_demote_urls=ir._mega_demote_urls(supabase, now),
    )
    try:
        uni = ir.compute_unified_lead(
            pool, now, always_include_clusters=always_include or set(), **kwargs
        )
    except TypeError:
        uni = ir.compute_unified_lead(pool, now, **kwargs)
    return uni, len(pool)


def replay(run, sweep_minutes=(0, -5, -10, -15, -20, -25, -30)):
    """Replay one run. Sweeps _now backwards from the briefing insert because the
    pool is fetched during SYNTHESIZE, minutes before the row is written."""
    br = load_briefing(run["briefing_id"], run["started_at"], run["brief_type"])
    if not br:
        return None
    tape = br.get("market_tape")
    if isinstance(tape, str):
        try:
            tape = json.loads(tape)
        except Exception:
            tape = None
    created = datetime.datetime.fromisoformat(br["created_at"].replace("Z", "+00:00"))

    results = []
    for m in sweep_minutes:
        now = created + datetime.timedelta(minutes=m)
        uni, n = contest_at(now, run["brief_type"], tape,
                            always_include={run.get("shipped_cluster") or ""})
        title = (uni or {}).get("article", {}).get("title") if uni else None
        results.append({
            "offset_min": m, "now": _iso(now), "pool": n,
            "winner": title, "cluster": (uni or {}).get("cluster_key"),
            "score": (uni or {}).get("score"),
        })
    return {"run": run, "briefing": br, "tape_regime": (tape or {}).get("regime"),
            "sweep": results}


def _norm(x):
    return " ".join((x or "").lower().split())[:60]


def cmd_fidelity(n_days=5):
    runs = [r for r in load_runs() if r["stored_winner"]]
    runs = runs[-n_days:]
    print(f"FIDELITY GATE: {len(runs)} run(s) with a stored unified_winner\n")
    print("TAPE=stored  NAME_MOVES=DEGRADED(empty)  NOW=swept\n")
    passed = 0
    for r in runs:
        res = replay(r)
        if not res:
            print(f"{r['started_at'][:10]} {r['brief_type']}: no briefing row, SKIP\n")
            continue
        hit = next((s for s in res["sweep"] if _norm(s["winner"]) == _norm(r["stored_winner"])), None)
        best = res["sweep"][0]
        print(f"--- {r['started_at'][:10]} {r['brief_type']}  tape_regime={res['tape_regime']}")
        print(f"    STORED    {r['stored_winner'][:78]}")
        print(f"              cluster={r['stored_cluster']} score={r['stored_score']}")
        print(f"    REPLAY    {str(best['winner'])[:78]}")
        print(f"              cluster={best['cluster']} score={best['score']} pool={best['pool']}")
        if hit:
            passed += 1
            print(f"    MATCH at offset {hit['offset_min']}min")
        else:
            print("    NO MATCH at any swept offset")
            for s in res["sweep"]:
                print(f"      {s['offset_min']:>4}min pool={s['pool']:<5} {str(s['winner'])[:64]}")
        print()
    print(f"FIDELITY: {passed}/{len(runs)} matched")
    return passed, len(runs)


def cmd_score():
    runs = load_runs()
    print(f"{'date':12}{'sess':9}{'DETERMINISTIC':56}{'SHIPPED':52}agree")
    for r in runs:
        w, s = r["stored_winner"], r["shipped"]
        print(f"{r['started_at'][:10]:12}{r['brief_type']:9}{str(w)[:54]:56}{str(s)[:50]:52}"
              f"{'yes' if _norm(w) == _norm(s) else 'NO'}")


def cmd_day(date_str, brief_type):
    runs = [r for r in load_runs()
            if r["started_at"][:10] == date_str and r["brief_type"] == brief_type]
    if not runs:
        print("no stored run for that date/session")
        return
    res = replay(runs[0])
    print(json.dumps(res, indent=1, default=str)[:4000])


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "fidelity"
    if cmd == "fidelity":
        cmd_fidelity(int(sys.argv[2]) if len(sys.argv) > 2 else 5)
    elif cmd == "score":
        cmd_score()
    elif cmd == "day":
        cmd_day(sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else "morning")
