"""lead_replay.py - a FAITHFUL point-in-time replay of the deterministic lead picker.

WHY THIS EXISTS. Nobody could answer "is the deterministic picker better than the
monolith?" because every prior replay reconstructed a DIFFERENT pool than the real
run did, and then scored a contest the real run never held. One of them returned an
Ondas contract on Aug 7 where the real run picked macro:jobs. Conclusions drawn from
those harnesses are not evidence.

THE BUG IN EVERY PRIOR HARNESS. compute_unified_lead does NOT run on the pool that
synthesize.run() selects for the brief body. run() pulls a relevance-ordered
LIMIT 60 slice into `articles`; the picker runs on `_pool`, which is
impact_ranking.fetch_coverage_pool: a RECENCY-ordered LIMIT 1000 window with a
different sort key and a different size. Reconstructing `articles` and scoring it
reproduces nothing.

WHAT THIS REPRODUCES EXACTLY
  stage 1  pool            impact_ranking.fetch_coverage_pool(sb, now)
                           articles, _POOL_COLS,
                           ingested_at  in [now-24h, now)   <- bounded BOTH sides
                           published_at in [now-48h, now)   <- bounded BOTH sides
                           order ingested_at desc, limit 1000
                           `now` is the run's own created_at, so the window is
                           point-in-time. An unbounded ingested_at is what produced
                           the bogus "22 payrolls articles" count: it swept in rows
                           ingested after the brief had already shipped.
  stage 2  weights         pinned from the run's stored unified.weights_used.
                           active_weights_meta() reads a LIVE calibrated store that
                           has moved since; using today's weights would score a
                           historical field with weights that did not exist yet.
  stage 3  tape            stored briefings.market_tape for that brief. NEVER
                           market_tape.fetch_tape(): it returns live quotes, which
                           collapses every historical day to a 0.5 neutral
                           materiality and is why prior scoreboards were meaningless.
  stage 4  clustering      impact_ranking.score_clusters(pool, now, recent_events)
  stage 5  argmax          impact_ranking.compute_unified_lead(...)

WHAT CANNOT BE REPRODUCED OFFLINE. Declared, never silently substituted. Any run
carrying a degraded dimension is marked DEGRADED in every output row.
  name_session_pct   the real run called market_tape.fetch_quote (Yahoo) up to 20
                     times for per-name session moves AT RUN TIME. Those intraday
                     quotes are not recoverable. Passed as None, which suppresses
                     the per-name driver tiers in _unified_materiality.
  mega_deal_urls     derived from deal_flow, whose stage column mutates after the
                     run (a 'rumored' row later becomes 'confirmed'). Reading it
                     today is a read of a DIFFERENT table state.

SELECT ONLY. This tool never writes, never migrates, never dispatches a run.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(_HERE))

DEGRADED_DIMENSIONS = (
    "name_session_pct (live intraday per-name quotes, unrecoverable)",
    "mega_deal_urls (deal_flow.stage mutates after the run)",
)


def _client():
    from dotenv import load_dotenv
    for p in (os.path.join(os.path.dirname(os.path.dirname(_HERE)), ".env.local"),
              "/Users/noahhanning/breakingalpha/.env.local"):
        if os.path.exists(p):
            load_dotenv(p)
            break
    from supabase import create_client
    url = os.environ["NEXT_PUBLIC_SUPABASE_URL"]
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ["NEXT_PUBLIC_SUPABASE_ANON_KEY"]
    return create_client(url, key)


def _pd(run: dict) -> dict:
    v = run.get("preselect_decision") or {}
    return json.loads(v) if isinstance(v, str) else v


def load_runs(sb, limit: int = 200) -> list[dict]:
    """Every pipeline_run that retained a preselect_decision, newest first."""
    r = (sb.table("pipeline_runs")
         .select("id,created_at,brief_type,preselect_decision")
         .order("created_at", desc=True).limit(limit).execute())
    out = []
    for row in (r.data or []):
        pd = _pd(row)
        uni = pd.get("unified") or {}
        if uni.get("winner") or pd.get("unified_winner"):
            row["_pd"] = pd
            out.append(row)
    return out


def stored_candidates(pd: dict) -> dict:
    """The real run's audited candidate set, keyed by cluster.

    CANONICAL C1 SHAPE (matches lead_weight_calibrator._c1_rows_to_candidates):
        {title, cluster, source, is_shipped_lead, below_cap,
         components: {materiality, session_fit, confirmation, breadth},
         weighted_score}
    The components are NESTED, not flat c_* keys. Reading the flat names returns
    None on every row and makes an empty replay look like a match, which is the
    single easiest way for this harness to lie.
    """
    out = {}
    for row in ((pd.get("unified") or {}).get("candidates") or []):
        if isinstance(row, dict) and row.get("cluster"):
            out[row["cluster"]] = row
    return out


def component_diff(pd: dict, got: dict) -> list[dict]:
    """Per-cluster, per-component comparison between the real run and the replay.

    A winner-only comparison cannot tell a pool that was rebuilt wrongly from a
    pool that was rebuilt correctly and then scored with one drifted input. This
    can: identical components on the shared clusters prove the pool and the
    clustering reproduced, and isolate the divergence to the component that moved.
    """
    st = stored_candidates(pd)
    rep = {c["cluster_key"]: c for c in (got or {}).get("unified_candidates") or []}
    rows = []
    for key in sorted(set(st) | set(rep)):
        a, b = st.get(key), rep.get(key)
        ac = (a or {}).get("components") or {}
        deltas = {}
        if a and b:
            for comp, flat in (("materiality", "c_materiality"), ("session_fit", "c_session_fit"),
                               ("confirmation", "c_confirmation"), ("breadth", "c_breadth")):
                x, y = ac.get(comp), b.get(flat)
                if x is not None and y is not None and abs(float(x) - float(y)) > 1e-6:
                    deltas[comp] = [float(x), float(y)]
        rows.append({
            "cluster": key,
            "in_stored": a is not None,
            "in_replay": b is not None,
            "stored_score": (a or {}).get("weighted_score"),
            "replay_score": (b or {}).get("unified_score"),
            "component_deltas": deltas,
            "replay_is_mega": (b or {}).get("is_mega_deal"),
        })
    return rows


def stored_winner(pd: dict) -> dict:
    """The winner the real run SERVED. `unified_winner` is the flat audit row and
    is the one carrying cluster_key; `unified.winner` is a nested variant that on
    some runs omits it. Prefer whichever actually has a cluster_key, then fall
    back to the flat cluster field, so a shape difference can never be read as a
    null-equals-null match."""
    uni = pd.get("unified") or {}
    for cand in (pd.get("unified_winner"), uni.get("winner")):
        if isinstance(cand, dict) and cand.get("cluster_key"):
            return cand
    if pd.get("unified_cluster"):
        return {"cluster_key": pd["unified_cluster"],
                "title": pd.get("unified_lead_title") or "",
                "unified_score": pd.get("unified_score")}
    return {}


def stored_tape(sb, created_at: str, brief_type: str):
    """The tape the brief itself stored. Matched to the briefing nearest the run."""
    lo = (dt.datetime.fromisoformat(created_at) - dt.timedelta(hours=6)).isoformat()
    hi = (dt.datetime.fromisoformat(created_at) + dt.timedelta(hours=6)).isoformat()
    r = (sb.table("briefings")
         .select("id,created_at,briefing_type,headline,market_tape")
         .gte("created_at", lo).lte("created_at", hi)
         .order("created_at", desc=False).limit(20).execute())
    rows = [x for x in (r.data or []) if (x.get("briefing_type") or "").startswith(brief_type[:7])]
    rows = rows or (r.data or [])
    if not rows:
        return None, None
    target = dt.datetime.fromisoformat(created_at)
    best = min(rows, key=lambda x: abs(dt.datetime.fromisoformat(x["created_at"]) - target))
    tape = best.get("market_tape")
    if isinstance(tape, str):
        try:
            tape = json.loads(tape)
        except Exception:
            tape = None
    return tape, best


def replay_one(sb, run: dict) -> dict:
    """Replay one stored run. Returns the comparison record; never raises."""
    import impact_ranking as ir

    pd = run["_pd"]
    now = dt.datetime.fromisoformat(run["created_at"])
    uni = pd.get("unified") or {}
    weights = uni.get("weights_used") or pd.get("unified_weights") or {}
    tape, briefing = stored_tape(sb, run["created_at"], run["brief_type"])

    pool = ir.fetch_coverage_pool(sb, now)

    # Stage 2: pin the weights the run actually used. active_weights_meta() reads a
    # live store that has moved since; scoring a July field with August weights is
    # not a replay of anything.
    orig = ir.active_weights_meta
    if weights:
        vals = weights.get("values") if isinstance(weights.get("values"), dict) else weights
        _ver = weights.get("version") if isinstance(weights, dict) else None
        ir.active_weights_meta = lambda: {
            "values": dict(vals), "source": "replay-pinned", "version": _ver,
        }
    try:
        got = ir.compute_unified_lead(
            pool, now,
            brief_type=run["brief_type"],
            tape=tape,                 # stored, never fetch_tape()
            name_session_pct=None,     # DEGRADED
            mega_deal_urls=None,       # DEGRADED
            mega_demote_urls=None,
            asof_date=now.date(),
        )
    finally:
        ir.active_weights_meta = orig

    want = stored_winner(pd)
    got_key = (got or {}).get("cluster_key")
    got_title = (((got or {}).get("article") or {}).get("title") or "").strip()[:110]
    return {
        "run_id": run["id"],
        "created_at": run["created_at"],
        "session": run["brief_type"],
        "pool_size": len(pool),
        "tape_present": tape is not None,
        "weights_pinned": bool(weights),
        "stored_cluster": want.get("cluster_key"),
        "stored_title": (want.get("title") or "")[:110],
        "stored_score": want.get("unified_score"),
        "replay_cluster": got_key,
        "replay_title": got_title,
        "replay_score": (got or {}).get("score"),
        # GREEN IS NOT EVIDENCE. A replay that produced nothing, or a stored row
        # whose cluster_key is missing, is a FAILURE to reproduce, never a match.
        # `None == None` passing silently is exactly how a harness lies.
        "match_cluster": bool(got_key) and bool(want.get("cluster_key"))
                         and got_key == want.get("cluster_key"),
        "replay_empty": got is None,
        "shipped_title": (uni.get("shipped_title") or pd.get("impact_lead_title") or ""),
        "shipped_cluster": uni.get("shipped_cluster") or pd.get("impact_lead_cluster"),
        "briefing_headline": (briefing or {}).get("headline"),
        "degraded": list(DEGRADED_DIMENSIONS),
        "component_diff": component_diff(pd, got),
    }


def main() -> int:
    ap = argparse.ArgumentParser(description="Faithful point-in-time replay of the unified lead picker.")
    ap.add_argument("--limit", type=int, default=200, help="how many pipeline_runs to scan")
    ap.add_argument("--days", type=int, default=0, help="replay only the N most recent stored runs (0 = all)")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    sb = _client()
    runs = load_runs(sb, args.limit)
    if args.days:
        runs = runs[: args.days]
    print(f"stored runs with a unified winner: {len(runs)}")
    print("DEGRADED dimensions (declared, never substituted):")
    for d in DEGRADED_DIMENSIONS:
        print(f"  - {d}")
    print()

    results = []
    for r in runs:
        try:
            res = replay_one(sb, r)
        except Exception as e:  # never raises out
            res = {"run_id": r["id"], "created_at": r["created_at"],
                   "session": r["brief_type"], "error": repr(e)}
        results.append(res)
        if args.json:
            continue
        if res.get("error"):
            print(f"{res['created_at'][:16]} {res['session']:<8} ERROR {res['error']}")
            continue
        ok = "MATCH" if res["match_cluster"] else "DIVERGE"
        print(f"{res['created_at'][:16]} {res['session']:<8} pool={res['pool_size']:<5} "
              f"tape={'Y' if res['tape_present'] else 'N'} {ok}")
        print(f"   stored : {res['stored_cluster']}")
        print(f"            {res['stored_title']}")
        print(f"   replay : {res['replay_cluster']}")
        print(f"            {res['replay_title']}")
        cd = res.get("component_diff") or []
        shared = [r for r in cd if r["in_stored"] and r["in_replay"]]
        exact = [r for r in shared if not r["component_deltas"]]
        print(f"   clusters: {len(shared)} shared, {len(exact)} component-identical, "
              f"{len([r for r in cd if r['in_stored'] and not r['in_replay']])} only-stored, "
              f"{len([r for r in cd if r['in_replay'] and not r['in_stored']])} only-replay")
        for r in shared:
            if r["component_deltas"]:
                print(f"     DRIFT {r['cluster'][:44]}: {r['component_deltas']} "
                      f"score {r['stored_score']} -> {r['replay_score']}"
                      f"{' [replay flags MEGA]' if r['replay_is_mega'] else ''}")

    if args.json:
        print(json.dumps(results, indent=2, default=str))
    else:
        good = sum(1 for x in results if x.get("match_cluster"))
        print(f"\nFIDELITY: {good}/{len(results)} cluster matches")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())


# ── FIDELITY RESULT, 2026-08-08 (see lead_replay_fidelity_2026-08-08.txt) ──
#
# 9/19 winner matches. The Phase-1 gate (5/5 on the five most recent stored runs)
# FAILS: the first five are MATCH, DIVERGE, DIVERGE, MATCH, MATCH = 3/5.
#
# The component diff says exactly where the harness is and is not faithful, and
# it is a much tighter result than the winner count suggests:
#
#   pool + clustering    FAITHFUL. Across all 19 runs the replay produced no
#                        cluster the real run did not also audit, and shared
#                        clusters appear in the same relative order. Several days
#                        are 10/10 component-identical.
#   session_fit          FAITHFUL. Zero drift on any cluster on any day.
#   confirmation         FAITHFUL. Zero drift.
#   breadth              FAITHFUL. Zero drift.
#   materiality          DRIFTS, and ONLY on clusters the replay now flags
#                        is_mega_deal. Every single drift row in the full run is
#                        a materiality delta on a mega-flagged deal cluster.
#                        Examples: co:electronic arts:ma 0.1875 -> 0.75,
#                        co:easyjet:ma 0.1875 -> 0.6885, co:visa:ma 0.1875 ->
#                        0.6304. Each promotes a deal the real run ranked 11th
#                        (below the audit cap) to rank 1.
#
# ROOT CAUSE, and why it is not fixable by editing this file. The mega-deal gate
# reads state that is MUTATED IN PLACE after the run: deal_flow.stage (a 'rumored'
# row later flipped to 'confirmed') and articles.relevance_score (backfilled),
# which together drive both _mega_deal_urls and the D12 same-day-confirmation
# relaxation in score_clusters. Neither table keeps history, so the run-time value
# of is_mega_deal is not recoverable from the database as it stands. Passing
# mega_deal_urls=None does not avoid it: score_clusters re-derives the flag from
# the pool's own article signals, which have also moved.
#
# CONSEQUENCE. This harness must NOT be used to score the picker against the
# monolith. It systematically over-promotes deal clusters relative to what the
# real run did, which is the exact bias that would manufacture a false "the
# picker wins on big-deal days" result.
#
# WHAT WOULD MAKE IT FAITHFUL (write-path work, not tool work):
#   1. persist the run's is_mega_deal / mega_deal_urls decision into
#      preselect_decision so the classification is replayable, or
#   2. append-only history on deal_flow.stage with a valid_from timestamp.
# Either one turns this from 9/19 into a usable scoreboard.
