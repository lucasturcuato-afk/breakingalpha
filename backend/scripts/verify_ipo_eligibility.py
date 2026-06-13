"""
verify_ipo_eligibility.py — direct-call verification for the lead-eligibility fix.

Calls deal_extractor.extract_deal() (the standalone per-article classify path)
against four fixtures and prints each JSON verdict. This NEVER calls run() and
NEVER touches the database — extract_deal only makes one Gemini call and returns
a dict. The four article bodies are baked in (pulled read-only from the articles
table), so the only thing this needs from the environment is GEMINI_API_KEY.

Run from anywhere:
    GEMINI_API_KEY=... python backend/scripts/verify_ipo_eligibility.py

Expected with the patched SYSTEM_PROMPT:
    F1 (SpaceX £56bn, gnews TSLA)      -> is_deal=true, deal_type=IPO, value ~£56B, stage closed/announced
    F2 (SpaceX IPO launch, gnews SPCX) -> is_deal=true, deal_type=IPO, stage closed (value may be null: snippet has no amount)
    F3 (bare market-cap, constructed)  -> is_deal=false (valuation-only gate still holds)
    F4 (YOOV merger, named acquirer)   -> unchanged: is_deal=true, deal_type=M&A (M&A path not relaxed)
"""

import os
import sys
import json

# extract_deal makes no DB calls, but importing deal_extractor builds a
# module-level Supabase client (no network until a query). Provide harmless
# placeholders so import works without real Supabase creds. We never query.
os.environ.setdefault(
    "SUPABASE_URL", os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "http://placeholder.invalid")
)
os.environ.setdefault(
    "SUPABASE_ANON_KEY", os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY", "placeholder")
)

if not os.environ.get("GEMINI_API_KEY"):
    print("ERROR: GEMINI_API_KEY is not set. This harness makes real Gemini calls.")
    print("Run: GEMINI_API_KEY=<key> python backend/scripts/verify_ipo_eligibility.py")
    sys.exit(2)

# Import the patched extractor from the sibling backend dir.
_BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _BACKEND not in sys.path:
    sys.path.insert(0, _BACKEND)

import deal_extractor as dx  # noqa: E402

# Fixtures. F1/F2/F4 are real rows (bodies are NULL on gnews snippet articles,
# exactly as production sees them). F3 is a constructed bare-valuation contrast.
FIXTURES = [
    {
        "tag": "F1_spacex_56bn_tsla_feed (id 9949419c, source 'Google News (TSLA)')",
        "title": "SpaceX raises £56bn ahead of biggest ever IPO - Yahoo Finance UK",
        "summary": "SpaceX raises £56bn ahead of biggest ever IPO Yahoo Finance UK",
        "body": None,
        "url": "https://news.google.com/rss/articles/CBMiiAFBVV95cUxPeGlDRTZRVnRiOW0t-SPACEX-TSLA",
        "expect": "is_deal=true, deal_type=IPO, value ~£56B, stage closed/announced",
    },
    {
        "tag": "F2_spacex_ipo_launch_spcx_feed (id 47e4ce42, source 'Google News (SPCX)')",
        "title": "SpaceX (SPCX): Rocket Company Launches Historic IPO - Nasdaq",
        "summary": "SpaceX (SPCX): Rocket Company Launches Historic IPO Nasdaq",
        "body": None,
        "url": "https://news.google.com/rss/articles/CBMihgFBVV95cUxQVlhf-SPACEX-SPCX",
        "expect": "is_deal=true, deal_type=IPO, stage closed; value may be null (snippet has no amount)",
    },
    {
        "tag": "F3_bare_market_cap_CONSTRUCTED (contrast: valuation-only, no offering)",
        "title": "Nvidia Becomes First Company to Reach $5 Trillion Market Cap as Stock Hits Record",
        "summary": "Nvidia's market capitalization topped $5 trillion for the first time as shares hit a record.",
        "body": (
            "Nvidia shares rose about 2% on Thursday to a record high, lifting the chipmaker's "
            "market capitalization above $5 trillion for the first time. No securities were sold or "
            "offered; the move reflects investor demand for AI-infrastructure names. The company did "
            "not announce any transaction, raise, or offering."
        ),
        "url": "https://example.invalid/nvidia-5t-market-cap",
        "expect": "is_deal=false (bare market cap, no offering -> gate must hold)",
    },
    {
        "tag": "F4_yoov_merger_REGRESSION (id d299a9b3, named acquirer Concorde)",
        "title": "Concorde International Group completes YOOV merger and appoints new directors - Investing.com",
        "summary": "Concorde International Group completes YOOV merger and appoints new directors Investing.com",
        "body": "",
        "url": "https://news.google.com/rss/articles/CBMizgFBVV95cUxQWk1Q-YOOV-MERGER",
        "expect": "unchanged: is_deal=true, deal_type=M&A, acquirer Concorde (M&A path not relaxed)",
    },
]


def main() -> None:
    print(f"deal_extractor model: {dx.GEMINI_MODEL}")
    print("Calling extract_deal() directly — no run(), no DB writes.\n")
    for f in FIXTURES:
        print("=" * 88)
        print(f"CASE: {f['tag']}")
        print(f"  title : {f['title']}")
        print(f"  expect: {f['expect']}")
        verdict = dx.extract_deal(f["title"], f["summary"], f["body"], f["url"])
        # extract_deal returns None when is_deal is false (or on parse/API error).
        if verdict is None:
            print("  VERDICT: is_deal=false  (extract_deal returned None)")
        else:
            print("  VERDICT:")
            print(json.dumps(verdict, indent=2, ensure_ascii=False))
        print()


if __name__ == "__main__":
    main()
