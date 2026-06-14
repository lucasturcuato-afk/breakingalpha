"""
verify_strongest_anchor.py — pure-Python check of the strongest-anchor dedup.

No DB, no Gemini. Imports deal_extractor.deal_strength (the real strength key)
and folds constructed sibling sequences for ONE (company, deal_type) in every
ingestion order, asserting the surviving row carries the strongest article's
fields regardless of order. The fold mirrors run()'s in-loop decision exactly:
each new article overwrites the current row IFF deal_strength(new) is strictly
greater (a tie or weaker article is a no-op).

Run:
    python backend/scripts/verify_strongest_anchor.py
"""

import os
import sys
from itertools import permutations

# deal_extractor builds module-level Supabase/Gemini clients at import (no
# network at construction). Provide placeholders so import works with no creds;
# we never call run() or any client method.
os.environ.setdefault("SUPABASE_URL", "http://placeholder.invalid")
os.environ.setdefault("SUPABASE_ANON_KEY", "placeholder")
os.environ.setdefault("GEMINI_API_KEY", "placeholder")

_BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _BACKEND not in sys.path:
    sys.path.insert(0, _BACKEND)

import deal_extractor as dx  # noqa: E402


def simulate_dedup(articles):
    """Replicate run()'s strongest-anchor fold: first article seeds the row;
    each later article overwrites it only if STRICTLY stronger. Returns the
    surviving row repr (the winning article dict)."""
    row = None
    for a in articles:
        if row is None:
            row = a
            continue
        if dx.deal_strength(a["stage"], a["valuation"]) > dx.deal_strength(row["stage"], row["valuation"]):
            row = a
    return row


# Each case: (label, articles, expected_winner_label)
CASES = [
    ("C1 SpaceX-style: $75B/closed vs £56B/announced vs no-figure snippet", [
        {"label": "$75B-closed",       "stage": "closed",    "valuation": "$75B", "source_url": "u_75"},
        {"label": "£56B-announced",    "stage": "announced", "valuation": "£56B", "source_url": "u_56"},
        {"label": "no-figure-snippet", "stage": "announced", "valuation": None,   "source_url": "u_none"},
    ], "$75B-closed"),

    ("C2 null-clobber regression: $2B/priced then null-valuation sibling", [
        {"label": "$2B-priced",   "stage": "closed",    "valuation": "$2B", "source_url": "u_2b"},
        {"label": "null-sibling", "stage": "announced", "valuation": None,  "source_url": "u_null"},
    ], "$2B-priced"),

    ("C3 M&A regression: signed/$5B vs announced/$3B vs rumored/null", [
        {"label": "signed-$5B",     "stage": "signed",    "valuation": "$5B", "source_url": "u_s"},
        {"label": "announced-$3B",  "stage": "announced", "valuation": "$3B", "source_url": "u_a"},
        {"label": "rumored-null",   "stage": "rumored",   "valuation": None,  "source_url": "u_r"},
    ], "signed-$5B"),
]


def main():
    print("strongest-anchor dedup verification — pure Python, no DB, no Gemini.\n")
    all_ok = True
    for label, articles, expected_label in CASES:
        expected = next(a for a in articles if a["label"] == expected_label)
        strengths = {a["label"]: dx.deal_strength(a["stage"], a["valuation"]) for a in articles}
        max_strength = max(strengths.values())

        order_ok = True
        mono_ok = True
        n_orders = 0
        for perm in permutations(articles):
            n_orders += 1
            survivor = simulate_dedup(list(perm))
            # field-level: surviving row carries the strongest article's fields
            if (survivor["source_url"], survivor["stage"], survivor["valuation"]) != \
               (expected["source_url"], expected["stage"], expected["valuation"]):
                order_ok = False
            # C4 monotonicity: surviving strength == max and >= every contributor
            s = dx.deal_strength(survivor["stage"], survivor["valuation"])
            if s != max_strength or any(s < v for v in strengths.values()):
                mono_ok = False

        ok = order_ok and mono_ok
        all_ok = all_ok and ok
        print("=" * 88)
        print(label)
        for lab, st in strengths.items():
            mark = "  <-- strongest" if st == max_strength and lab == expected_label else ""
            print(f"  strength[{lab}] = {st}{mark}")
        print(f"  orderings tested      : {n_orders}")
        print(f"  winner-fields-stable  : {'PASS' if order_ok else 'FAIL'} "
              f"(expected '{expected_label}', src={expected['source_url']}, "
              f"stage={expected['stage']}, val={expected['valuation']})")
        print(f"  C4 monotonicity       : {'PASS' if mono_ok else 'FAIL'} "
              f"(surviving strength == max == {max_strength} for every order)")
        print()

    # C5 — recency decoupled from strength: a weaker/no-op sibling arriving
    # AFTER the strongest article must leave the anchor fields intact but still
    # advance updated_at. Exercises the pure decision helper, no DB.
    print("=" * 88)
    print("C5 recency-vs-strength: weaker sibling after strongest -> anchor kept, updated_at advanced")
    strongest = {"stage": "closed", "valuation": "$75B", "source_url": "u_75",
                 "thesis": "t75", "sentiment": "BULLISH", "updated_at": "T1"}
    weaker = {"stage": "announced", "valuation": None, "source_url": "u_none",
              "thesis": "tNone", "sentiment": "NEUTRAL", "updated_at": "T2"}
    # existing row = the strongest anchor (stage/valuation), then the weaker
    # sibling lands with a newer updated_at (T2).
    fields, is_stronger = dx.dedup_update_fields(
        weaker, existing_stage=strongest["stage"], existing_valuation=strongest["valuation"])
    recency_ok = (
        is_stronger is False
        and fields.get("updated_at") == "T2"          # recency advanced
        and "source_url" not in fields                # anchor NOT overwritten
        and "stage" not in fields
        and "valuation" not in fields
    )
    # And the reverse: a stronger sibling DOES move the anchor and recency.
    fields2, is_stronger2 = dx.dedup_update_fields(
        strongest, existing_stage=weaker["stage"], existing_valuation=weaker["valuation"])
    upgrade_ok = (
        is_stronger2 is True
        and fields2.get("updated_at") == "T1"
        and fields2.get("source_url") == "u_75"
        and fields2.get("valuation") == "$75B"
        and fields2.get("stage") == "closed"
    )
    c5_ok = recency_ok and upgrade_ok
    all_ok = all_ok and c5_ok
    print(f"  weaker-after-strongest: stronger={is_stronger} fields_written={sorted(fields.keys())}")
    print(f"    -> anchor kept + updated_at advanced : {'PASS' if recency_ok else 'FAIL'}")
    print(f"  stronger-sibling       : stronger={is_stronger2} fields_written={sorted(fields2.keys())}")
    print(f"    -> anchor moved + updated_at advanced: {'PASS' if upgrade_ok else 'FAIL'}")
    print()

    print("=" * 88)
    print(f"RESULT: {'ALL PASS' if all_ok else 'FAILURES PRESENT'}")
    sys.exit(0 if all_ok else 1)


if __name__ == "__main__":
    main()
