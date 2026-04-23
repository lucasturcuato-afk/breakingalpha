"""
Seed dummy morning_brief_call_outcomes rows so the Evening Wrap renders the
populated MorningReview state. Also writes a dummy morning_review directly onto
the latest evening briefing row so Noah can preview the UI without running the
grading job.

Usage: python scripts/seed_brief_outcomes.py

Idempotent: deletes existing dummy rows for today first.
"""
import os
from datetime import date
from supabase import create_client


def main():
    url = os.environ["SUPABASE_URL"]
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ["SUPABASE_ANON_KEY"]
    sb = create_client(url, key)

    today = date.today().isoformat()

    # Find latest morning brief id for today
    morning = (
        sb.table("briefings")
        .select("id")
        .eq("briefing_type", "morning")
        .gte("created_at", today)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    if not morning.data:
        print("No morning brief for today - abort")
        return
    brief_id = morning.data[0]["id"]
    print(f"Morning brief: {brief_id}")

    # Seed a few calls + outcomes
    calls = [
        {
            "brief_id": brief_id,
            "brief_date": today,
            "claim_text": "S&P likely higher on Fed dovish tone",
            "claim_type": "aggregate",
            "target_symbol": "SPY",
            "expected_direction": "bullish",
            "confidence": 0.65,
        },
        {
            "brief_id": brief_id,
            "brief_date": today,
            "claim_text": "Tech outperforms on NVDA guidance",
            "claim_type": "sector",
            "target_symbol": "XLK",
            "expected_direction": "bullish",
            "confidence": 0.72,
        },
        {
            "brief_id": brief_id,
            "brief_date": today,
            "claim_text": "Energy pressured by crude slide",
            "claim_type": "sector",
            "target_symbol": "XLE",
            "expected_direction": "bearish",
            "confidence": 0.58,
        },
    ]

    # Clear any prior seed calls for today (cascades to outcomes via FK ON DELETE CASCADE)
    sb.table("morning_brief_calls").delete().eq("brief_id", brief_id).execute()
    inserted = sb.table("morning_brief_calls").insert(calls).execute()
    call_ids = [c["id"] for c in inserted.data]

    outcomes = [
        {
            "call_id": call_ids[0],
            "actual_open": 510.0,
            "actual_close": 512.4,
            "actual_pct_change": 0.0047,
            "actual_direction": "up",
            "verdict": "correct",
            "verdict_notes": (
                "Fed minutes came in more dovish than consensus; SPY closed +0.47%, "
                "confirming our bullish aggregate call."
            ),
        },
        {
            "call_id": call_ids[1],
            "actual_open": 215.0,
            "actual_close": 214.2,
            "actual_pct_change": -0.0037,
            "actual_direction": "down",
            "verdict": "wrong",
            "verdict_notes": (
                "NVDA rallied early but tech faded into the close on rate-sensitive "
                "selling. XLK closed -0.37%. We underweighted the rate-sensitivity of "
                "the mega-cap tech basket."
            ),
        },
        {
            "call_id": call_ids[2],
            "actual_open": 95.0,
            "actual_close": 93.8,
            "actual_pct_change": -0.0126,
            "actual_direction": "down",
            "verdict": "correct",
            "verdict_notes": "Crude -2.1% on inventory build; XLE -1.3%. Bearish call confirmed.",
        },
    ]
    sb.table("morning_brief_call_outcomes").delete().in_("call_id", call_ids).execute()
    sb.table("morning_brief_call_outcomes").insert(outcomes).execute()
    print(f"Seeded {len(calls)} calls + {len(outcomes)} outcomes")

    # Also seed a morning_review on today's evening brief (if one exists)
    evening = (
        sb.table("briefings")
        .select("id")
        .eq("briefing_type", "evening")
        .gte("created_at", today)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    if evening.data:
        evening_id = evening.data[0]["id"]
        review = {
            "aggregate_sentence": (
                "Morning brief was broadly right - directional calls confirmed on "
                "aggregate and energy, wrong on tech."
            ),
            "sector_reflections": [
                {
                    "sector": "Technology",
                    "verdict": "wrong",
                    "paragraph": (
                        "We expected NVDA guidance to drive tech outperformance, but "
                        "the rate-sensitive mega-cap basket faded into the close as "
                        "Treasuries sold off. XLK -0.37%. We underweighted duration-risk "
                        "in the sector when rates drifted higher."
                    ),
                },
                {
                    "sector": "Energy",
                    "verdict": "correct",
                    "paragraph": (
                        "Called for pressure on energy and crude inventory build "
                        "delivered. XLE -1.3%, XOM and CVX both red. Framing was "
                        "directionally accurate."
                    ),
                },
            ],
            "ticker_reflection": None,
        }
        sb.table("briefings").update({"morning_review": review}).eq("id", evening_id).execute()
        print(f"Seeded morning_review on evening brief {evening_id}")
    else:
        print("No evening brief for today yet - skipped morning_review seeding")


if __name__ == "__main__":
    main()
