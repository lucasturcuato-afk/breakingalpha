"""
verify_a2_eligibility.py — direct, in-memory verification of lead_preselect's
Filter A2 / Filter A qualification predicates. No Gemini, no DB.

Imports the real predicate functions from lead_preselect and feeds them
constructed (article, deal_row) pairs. lead_preselect's module-level Supabase
client is None when SUPABASE_URL/ANON_KEY are unset, and these predicates are
pure functions that never touch the DB.

Run:
    python backend/scripts/verify_a2_eligibility.py
"""

import os
import sys

# lead_preselect sets supabase=None when these are unset; predicates are pure.
os.environ.pop("SUPABASE_URL", None)
os.environ.pop("SUPABASE_ANON_KEY", None)

_BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _BACKEND not in sys.path:
    sys.path.insert(0, _BACKEND)

import lead_preselect as lp  # noqa: E402

F1_URL = "https://news.google.com/rss/articles/CBMiiAFBVV95cUxPeGlDRTZRVnRiOW0t-SPACEX-TSLA"


def art(title, summary=""):
    return {"title": title, "summary": summary, "url": F1_URL,
            "published_at": "2026-06-12T15:12:00+00:00"}


def deal(deal_type, stage, valuation, acquirer=None):
    return {"company": "X", "acquirer": acquirer, "deal_type": deal_type,
            "stage": stage, "valuation": valuation, "source_url": F1_URL}


# (label, fn, article, deal_row, expectation-string, predicate)
CASES = [
    # 1 — priced SpaceX IPO, closed, GBP size. MUST qualify (stage=closed bypasses
    #     keyword; parse('£56B') -> 56.0 at parity passes the $1B floor).
    ("C1 priced SpaceX IPO closed/£56B (A2)",
     art("SpaceX raises £56bn ahead of biggest ever IPO - Yahoo Finance UK",
         "SpaceX raises £56bn ahead of biggest ever IPO"),
     deal("IPO", "closed", "£56B"), "MUST qualify", "a2"),

    # 2 — USD priced IPO, $2B, closed. MUST qualify (USD path intact).
    ("C2 USD IPO closed/$2B (A2)",
     art("Acme Corp prices $2 billion IPO and begins trading", ""),
     deal("IPO", "closed", "$2B"), "MUST qualify", "a2"),

    # 3 — JPY IPO, closed, ¥56B (~$370M). MUST NOT qualify: ¥ is not in the
    #     valuation regex -> parse returns None -> below floor / fail-safe.
    ("C3 JPY IPO closed/¥56B ~$370M (A2)",
     art("Acme KK prices ¥56B IPO on the TSE", ""),
     deal("IPO", "closed", "¥56B"), "MUST NOT qualify (below $1B / unparseable)", "a2"),

    # 4a — M&A through A2: deal_type not in NON_MA_DEAL_TYPES -> None (A2 ignores M&A).
    ("C4a YOOV-style M&A via A2 ($2B)",
     art("Concorde International Group completes YOOV merger", ""),
     deal("M&A", "closed", "$2B", acquirer="Concorde International Group"),
     "None (A2 does not handle M&A)", "a2"),
    # 4b — same M&A through Filter A (regression): MUST still qualify.
    ("C4b YOOV-style M&A via Filter A ($2B, named acquirer, signed)",
     art("Concorde International Group signs $2 billion deal to acquire YOOV", ""),
     deal("M&A", "signed", "$2B", acquirer="Concorde International Group"),
     "MUST qualify (M&A path unchanged)", "a"),

    # 5 — bare valuation / non-deal: no deal_row -> None.
    ("C5 bare valuation / no deal_row (A2)",
     art("Nvidia becomes first company to reach $5 trillion market cap", ""),
     None, "None", "a2"),

    # 6 — REAL-WORLD PROOF that #359 alone suffices for the dominant USD coverage:
    #     USD '$75bn' IPO, announced, text has 'raises $' -> qualifies via keyword.
    ("C6 USD SpaceX $75B announced + 'raises $' (A2)",
     art("SpaceX raises record-setting $75bn in IPO debut - Silicon Republic",
         "SpaceX IPO raises $75bn in world's biggest stock debut"),
     deal("IPO", "announced", "$75B"), "MUST qualify via 'raises $' keyword", "a2"),

    # 7 — EDGE CASE (documents the only residual gap): GBP raise, announced.
    #     'raises £56bn' has no 'raises $' -> CURRENT A2 returns None.
    ("C7 GBP SpaceX £56B announced + 'raises £' (A2) [edge case]",
     art("SpaceX raises £56bn ahead of biggest ever IPO - Yahoo Finance UK",
         "SpaceX raises £56bn ahead of biggest ever IPO"),
     deal("IPO", "announced", "£56B"),
     "None under current A2 (non-USD raise keyword gap; non-blocking)", "a2"),
]


def main():
    print("lead_preselect A2/A predicate check — pure in-memory, no Gemini, no DB.")
    print(f"MIN_DEAL_VALUE_NON_MA_USD_B = {lp.MIN_DEAL_VALUE_NON_MA_USD_B}")
    print(f"NON_MA_DEAL_TYPES = {lp.NON_MA_DEAL_TYPES}\n")
    for label, article, deal_row, expect, which in CASES:
        if which == "a2":
            res = lp._qualifies_filter_a2(article, deal_row)
        else:
            res = lp._qualifies_filter_a(article, deal_row)
        verdict = "None" if res is None else f"qualifies (value={res})"
        print("=" * 84)
        print(f"{label}")
        print(f"  expect : {expect}")
        print(f"  result : {verdict}")
        print()


if __name__ == "__main__":
    main()
