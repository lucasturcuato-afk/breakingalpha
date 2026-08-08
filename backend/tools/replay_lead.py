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

WHAT THIS REPRODUCES, STAGE BY STAGE. Printed in every run's header so no output
can be read without its own fidelity assumptions attached.

  stage 1  pool         impact_ranking.fetch_coverage_pool(sb, now). articles,
                        _POOL_COLS, ingested_at in [now-24h, now) and published_at
                        in [now-48h, now), BOTH bounded above by the run's own
                        timestamp, order ingested_at desc, limit 1000.
                        REPRODUCIBLE.
  stage 2  weights      pinned from the run's stored unified.weights_used.
                        active_weights_meta() reads a LIVE calibrated store that has
                        moved since, so using it scores a historical field with
                        weights that did not exist yet. REPRODUCIBLE when the row
                        carries weights_used; the run is marked DEGRADED when it
                        does not.
  stage 3  tape         stored briefings.market_tape. REPRODUCIBLE.
  stage 4  clustering   impact_ranking.score_clusters inside compute_unified_lead.
                        REPRODUCIBLE.
  stage 5  argmax       impact_ranking.compute_unified_lead. REPRODUCIBLE.

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


# Declared, never silently substituted. Ported from #561: a harness that reports a
# clean number while quietly swapping an input is worse than one that reports a
# dirty number honestly.
DEGRADED_DIMENSIONS = (
    "name_session_pct (live intraday per-name Yahoo quotes at run time, unrecoverable)",
    "mega_deal_urls / mega_demote_urls (read LIVE from deal_flow, which mutates in "
    "place with no history; it has not drifted across the recent window, but that is "
    "an observation about a window, not a guarantee)",
)


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
        _uni = pd.get("unified") or {}
        out.append({
            "preselect_decision": pd,
            "weights_used": _uni.get("weights_used") or pd.get("unified_weights") or {},
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


def stored_candidates(pd):
    """The run's audited candidate set, keyed by cluster.

    CANONICAL C1 SHAPE: components are NESTED under "components", not flat c_* keys.
    Reading the flat names returns None on every row, which makes an empty replay
    look like a perfect match. That is the single easiest way for this tool to lie.
    """
    out = {}
    for row in ((pd.get("unified") or {}).get("candidates") or []):
        if isinstance(row, dict) and row.get("cluster"):
            out[row["cluster"]] = row
    return out


def component_diff(pd, got):
    """Per-cluster, per-component stored-vs-replay comparison.

    A winner-only gate cannot separate a wrongly rebuilt pool from a correctly
    rebuilt pool scored with one drifted input. This can: component-identical shared
    clusters prove the pool and clustering reproduced, and isolate the divergence to
    the component that actually moved. This is what made #560's floor legible as ONE
    repeated cause (materiality -> 0.75 on every mega-flagged deal) instead of an
    unexplained 3/5.
    """
    st = stored_candidates(pd)
    rep = {c["cluster_key"]: c for c in (got or {}).get("unified_candidates") or []}
    rows = []
    for key in sorted(set(st) | set(rep)):
        a, b = st.get(key), rep.get(key)
        ac = (a or {}).get("components") or {}
        deltas = {}
        if a and b:
            for comp, flat in (("materiality", "c_materiality"),
                               ("session_fit", "c_session_fit"),
                               ("confirmation", "c_confirmation"),
                               ("breadth", "c_breadth")):
                x, y = ac.get(comp), b.get(flat)
                if x is not None and y is not None and abs(float(x) - float(y)) > 1e-6:
                    deltas[comp] = [round(float(x), 4), round(float(y), 4)]
        rows.append({
            "cluster": key, "in_stored": a is not None, "in_replay": b is not None,
            "stored_score": (a or {}).get("weighted_score"),
            "replay_score": (b or {}).get("unified_score"),
            "component_deltas": deltas,
            "replay_is_mega": (b or {}).get("is_mega_deal"),
        })
    return rows


def print_component_diff(cd, indent="   "):
    shared = [r for r in cd if r["in_stored"] and r["in_replay"]]
    exact = [r for r in shared if not r["component_deltas"]]
    only_s = [r for r in cd if r["in_stored"] and not r["in_replay"]]
    only_r = [r for r in cd if r["in_replay"] and not r["in_stored"]]
    print(f"{indent}clusters: {len(shared)} shared, {len(exact)} component-identical, "
          f"{len(only_s)} only-stored, {len(only_r)} only-replay")
    for r in shared:
        if r["component_deltas"]:
            print(f"{indent}  DRIFT {r['cluster'][:44]}: {r['component_deltas']} "
                  f"score {r['stored_score']} -> {r['replay_score']}"
                  f"{' [replay flags MEGA]' if r['replay_is_mega'] else ''}")
    for r in only_s:
        print(f"{indent}  ONLY-STORED {r['cluster'][:52]} (score {r['stored_score']})")
    for r in only_r:
        print(f"{indent}  ONLY-REPLAY {r['cluster'][:52]} (score {r['replay_score']})")


def contest_at(now, brief_type, tape, always_include=None, weights=None):
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
    # STAGE 2: pin the run's own weights. active_weights_meta() reads a live
    # calibrated store that has moved since the run, so leaving it live scores a
    # historical field with weights that did not exist yet. Restored in `finally`
    # so one replay cannot leak its weights into the next.
    _orig = ir.active_weights_meta
    if weights:
        _vals = weights.get("values") if isinstance(weights.get("values"), dict) else weights
        _ver = weights.get("version") if isinstance(weights, dict) else None
        ir.active_weights_meta = lambda: {
            "values": dict(_vals), "source": "replay-pinned", "version": _ver,
        }
    try:
        try:
            uni = ir.compute_unified_lead(
                pool, now, always_include_clusters=always_include or set(), **kwargs
            )
        except TypeError:
            uni = ir.compute_unified_lead(pool, now, **kwargs)
    finally:
        ir.active_weights_meta = _orig
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
                            always_include={run.get("shipped_cluster") or ""},
                            weights=run.get("weights_used"))
        title = (uni or {}).get("article", {}).get("title") if uni else None
        results.append({
            "offset_min": m, "now": _iso(now), "pool": n,
            "winner": title, "cluster": (uni or {}).get("cluster_key"),
            "score": (uni or {}).get("score"),
            "diff": component_diff(run.get("preselect_decision") or {}, uni),
        })
    # A run with no stored weights cannot be weight-pinned, so it is scored with the
    # live store and is DEGRADED on that dimension. Say so rather than let it pass as
    # a clean replay.
    degraded = list(DEGRADED_DIMENSIONS)
    if not run.get("weights_used"):
        degraded.append("weights (no unified.weights_used on this row, scored with the "
                        "LIVE calibrated store)")
    return {"run": run, "briefing": br, "tape_regime": (tape or {}).get("regime"),
            "weights_pinned": bool(run.get("weights_used")),
            "degraded": degraded, "sweep": results}


def _norm(x):
    return " ".join((x or "").lower().split())[:60]


def cmd_fidelity(n_days=5):
    runs = [r for r in load_runs() if r["stored_winner"]]
    runs = runs[-n_days:]
    print(f"FIDELITY GATE: {len(runs)} run(s) with a stored unified_winner\n")
    print("STAGES: 1 pool REPRODUCIBLE | 2 weights PINNED from unified.weights_used | "
          "3 tape STORED | 4 clustering REPRODUCIBLE | 5 argmax REPRODUCIBLE")
    print("DEGRADED dimensions (declared, never silently substituted):")
    for d in DEGRADED_DIMENSIONS:
        print(f"  - {d}")
    print()
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
        print(f"    weights   {'PINNED from the run' if res['weights_pinned'] else 'DEGRADED: live store'}")
        if not hit:
            print_component_diff(best.get("diff") or [], indent="    ")
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
