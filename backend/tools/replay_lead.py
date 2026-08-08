"""Offline lead replay for a historical brief date. READ-ONLY against prod.

Reconstructs the candidate pool that a past run saw, runs the deterministic
contest against it, and prints the winner next to what actually shipped.

THE TAPE RULE. Historical replays read the STORED briefings.market_tape for that
row. fetch_tape() is never called: it returns LIVE quotes, which on a replay of a
past date forces every candidate to the 0.5 neutral materiality and makes the
whole scoreboard meaningless. Every prior lead scoreboard in this repo was
invalidated by exactly that mistake.

Usage:
  python backend/tools/replay_lead.py 2026-08-07 morning
  python backend/tools/replay_lead.py 2026-08-07 morning --prose   (one Gemini call)
"""

import datetime
import json
import os
import sys
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

SB = os.environ["NEXT_PUBLIC_SUPABASE_URL"].rstrip("/")
KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]


def _get(path):
    req = urllib.request.Request(
        f"{SB}/rest/v1/{path}",
        headers={"apikey": KEY, "Authorization": f"Bearer {KEY}"},
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode())


def load_brief(date_str, brief_type):
    lo = f"{date_str}T00:00:00Z"
    hi = f"{date_str}T23:59:59Z"
    rows = _get(
        "briefings?select=id,created_at,briefing_type,headline,lead_paragraph,market_tape"
        f"&briefing_type=eq.{brief_type}&created_at=gte.{urllib.parse.quote(lo)}"
        f"&created_at=lte.{urllib.parse.quote(hi)}&order=created_at.asc&limit=1"
    )
    if not rows:
        raise SystemExit(f"no {brief_type} briefing row on {date_str}")
    return rows[0]


def load_pool(created_at, hours=24, pub_days=2, limit=60):
    """Point-in-time pool. ingested_at <= the row's created_at, never after it."""
    cut = datetime.datetime.fromisoformat(created_at.replace("Z", "+00:00"))
    ing_lo = (cut - datetime.timedelta(hours=hours)).isoformat()
    pub_lo = (cut - datetime.timedelta(days=pub_days)).isoformat()
    q = (
        "articles?select=id,title,source,summary,content,url,published_at,ingested_at,"
        "sector,companies,relevance_score"
        f"&ingested_at=gte.{urllib.parse.quote(ing_lo)}"
        f"&ingested_at=lte.{urllib.parse.quote(cut.isoformat())}"
        f"&published_at=gte.{urllib.parse.quote(pub_lo)}"
        "&order=relevance_score.desc,ingested_at.desc,published_at.desc,id.asc"
        f"&limit={limit}"
    )
    return _get(q)


def main():
    date_str = sys.argv[1]
    brief_type = sys.argv[2] if len(sys.argv) > 2 else "morning"
    want_prose = "--prose" in sys.argv

    brief = load_brief(date_str, brief_type)
    now = datetime.datetime.fromisoformat(brief["created_at"].replace("Z", "+00:00"))
    tape = brief.get("market_tape")
    if isinstance(tape, str):
        tape = json.loads(tape)

    pool = load_pool(brief["created_at"])

    print(f"=== {date_str} {brief_type} ===")
    print(f"brief_id   {brief['id']}")
    print(f"created_at {brief['created_at']}")
    print(f"pool       {len(pool)} articles (point-in-time, ingested_at <= created_at)")
    print(f"tape       STORED regime={(tape or {}).get('regime')} "
          f"vix={(tape or {}).get('vix_level')} (fetch_tape NOT called)")
    print(f"SHIPPED    {brief.get('headline')}")

    import impact_ranking as ir

    uni = ir.compute_unified_lead(pool, now, brief_type=brief_type, tape=tape,
                                  name_session_pct={}, mega_deal_urls=set(),
                                  mega_demote_urls=set())
    if not uni or not uni.get("article"):
        print("DETERMINISTIC  (no winner)")
        return
    print(f"DETERMINISTIC  {uni['article'].get('title')}")
    print(f"               cluster={uni['cluster_key']} score={uni.get('score')} "
          f"breadth={uni.get('breadth')}")

    if not want_prose:
        return

    import synthesize as syn

    story = {
        "title": uni["article"].get("title"),
        "sector": uni["article"].get("sector"),
        "one_liner": (uni["article"].get("summary") or "")[:400],
        "companies": uni["article"].get("companies") or [],
    }
    macro_ctx = {"releases": [], "today_catalyst": None, "strip": ""}
    lv2 = syn.generate_lead_v2(brief_type, tape, macro_ctx, [story], prior_ctx=None)
    print()
    if not lv2:
        print("PROSE  generate_lead_v2 returned None -> HARD falls back to the "
              "monolith lead (this is the designed fallback, not a crash)")
        return
    print(f"HEADLINE        {lv2.get('headline')}")
    print(f"LEAD_PARAGRAPH  {lv2.get('lead_paragraph')}")
    print(f"SUPPORTING      {lv2.get('supporting_context')}")


if __name__ == "__main__":
    main()
