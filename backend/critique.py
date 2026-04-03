"""
critique.py — BreakingAlpha Phase 1 Observation Layer
Brief Critic: heuristic-only quality scorer for generated briefings.

Called as step 5 of run.py after observe.py.
No LLM calls. Pure text heuristics and Supabase reads/writes only.

Reads the most recent briefing for brief_type written after started_at,
runs deterministic checks, and writes one row to brief_quality_scores.

Heuristic categories
--------------------
Hard signals  — high-confidence quality failures drawn directly from the
                banned-phrase list in synthesize.py SECTION RULES, or from
                clearly templated/vague headline patterns. These feed
                headline_pass, banned_phrase_hits, and what_to_watch_banned_hits.

Soft flags    — ambiguous patterns that are plausibly legitimate in real
                analyst prose. Logged in soft_flags jsonb; never affect any
                hard metric.

All values are observational. No composite score.
If a field fails to parse, the row is still written with that field null.
"""

import os
import json
from supabase import create_client

supabase = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_ANON_KEY"])

# ---------------------------------------------------------------------------
# Hard heuristics — headline vague patterns
#
# Case-insensitive substring match against the headline.
# Failing any of these sets headline_pass = False (combined with word-count check).
# Each entry is narrow and specific to avoid false positives.
#
# "markets react" is intentionally absent — moved to soft flags.
# ---------------------------------------------------------------------------
HEADLINE_VAGUE_PATTERNS = [
    "market intelligence unavailable",  # stub run
    "markets face",                     # templated dread framing
    "volatility returns",               # generic non-event
    "sector active",                    # non-informative category label
    "uncertainty continues",            # filler with no named cause
    "investors await",                  # forward-looking nothing
    "mixed signals",                    # non-directional placeholder
    "week in review",                   # summary label, not a story
]

# ---------------------------------------------------------------------------
# Hard heuristics — body banned phrases
#
# Case-insensitive substring match across summary + all section values.
# Sourced verbatim from the BANNED phrases list in synthesize.py SECTION RULES.
# If these appear, the model violated an explicit prompt instruction.
#
# "markets reacted to" is here (exact verbatim banned phrase from the prompt).
# "markets react" is NOT here — that shorter form is a soft flag only.
# ---------------------------------------------------------------------------
BANNED_PHRASES = [
    "does not directly impact",
    "no geopolitical developments",
    "no direct geopolitical",
    "investors should monitor",
    "broadly supportive",
    "ongoing uncertainty",
    "markets reacted to",
    "could also affect",
    "this is consistent with",
    "broadly positive",
    "limited direct impact",
    "while not directly",
]

# ---------------------------------------------------------------------------
# Hard heuristics — what_to_watch / tomorrow_setup banned phrases
#
# Applied only to the watch section, not the full body scan.
# "watch for" is intentionally absent — moved to soft flags.
# ---------------------------------------------------------------------------
WHAT_TO_WATCH_BANNED = [
    "bears watching",
    "remain cautious",
    "could be impacted",
    "may be affected",
    "investors should monitor",   # also in BANNED_PHRASES; counted independently here
]

# ---------------------------------------------------------------------------
# Soft flags
#
# Each entry is (flag_id, check_fn).
# check_fn receives (headline_lower: str, sections_dict: dict) and returns bool.
# Triggered flags are written to soft_flags jsonb; they never affect hard metrics.
# ---------------------------------------------------------------------------
def _soft_check_markets_react(headline_lower, sections_dict):
    return "markets react" in headline_lower

def _soft_check_watch_for(headline_lower, sections_dict):
    watch_text = ""
    if isinstance(sections_dict, dict):
        watch_text = (
            (sections_dict.get("what_to_watch") or "")
            + " "
            + (sections_dict.get("tomorrow_setup") or "")
        )
    return "watch for" in watch_text.lower()

SOFT_FLAG_CHECKS = [
    ("headline:markets_react", _soft_check_markets_react),
    ("watch:watch_for",        _soft_check_watch_for),
]

# ---------------------------------------------------------------------------
# Full expected section key sets per brief_type.
# Used to compute sections_present and sections_omitted.
# geopolitics is explicitly optional in the synthesize.py prompt —
# its absence is tracked as data but is not inherently a defect.
# ---------------------------------------------------------------------------
SECTION_KEYS = {
    "morning": {
        "deals_and_ma", "public_markets", "macro_and_rates",
        "geopolitics", "sector_spotlight", "what_to_watch",
    },
    "evening": {
        "deals_and_ma", "public_markets", "macro_and_rates",
        "geopolitics", "sector_spotlight", "tomorrow_setup",
    },
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _safe_json(value, default):
    """
    Return value unchanged if already a dict or list.
    Attempt json.loads if it is a string; return default on failure.
    Return default for None.
    """
    if value is None:
        return default
    if isinstance(value, (dict, list)):
        return value
    try:
        return json.loads(value)
    except Exception:
        return default


def _count_phrase_hits(text, phrases):
    """
    Count how many distinct phrases in the list appear in text
    (case-insensitive substring; one count per phrase regardless of
    how many times it appears in the text).
    """
    if not text:
        return 0
    text_lower = text.lower()
    return sum(1 for p in phrases if p.lower() in text_lower)


def _flatten_sections(sections_dict):
    """Concatenate all section string values into one string for phrase scanning."""
    if not isinstance(sections_dict, dict):
        return ""
    return " ".join(str(v) for v in sections_dict.values() if v)


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def score_run(brief_type, started_at, run_id=None):
    """
    Fetch the most recent briefing for brief_type written at or after
    started_at, run heuristic checks, and write one row to
    brief_quality_scores.

    Parameters
    ----------
    brief_type : str       — 'morning' | 'evening'
    started_at : datetime  — timezone-aware UTC; when run.py started
    run_id     : str|None  — id from pipeline_runs row; nullable

    Errors are caught and printed locally. This function never raises so
    run.py is unaffected by critique failures.
    """
    # --- Fetch the briefing written by this run ---------------------------
    briefing = None
    try:
        resp = (
            supabase.table("briefings")
            .select("headline, summary, sections, top_deals, created_at")
            .eq("briefing_type", brief_type)
            .gte("created_at", started_at.isoformat())
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
        briefing = resp.data[0] if resp.data else None
    except Exception as e:
        print(f"  [critique] briefing fetch failed: {e}")

    if briefing is None:
        print("  [critique] no briefing found for this run — skipping row write")
        return

    # --- Status -----------------------------------------------------------
    headline_raw = briefing.get("headline") or ""
    status = "stub" if headline_raw == "Market Intelligence Unavailable" else "success"

    # --- Headline checks --------------------------------------------------
    words = headline_raw.split()
    headline_word_count = len(words)

    headline_lower = headline_raw.lower()
    vague_hit = any(p.lower() in headline_lower for p in HEADLINE_VAGUE_PATTERNS)
    headline_pass = (10 <= headline_word_count <= 15) and not vague_hit

    # --- Banned phrase scan (summary + all sections) ----------------------
    summary_text = briefing.get("summary") or ""
    sections_dict = _safe_json(briefing.get("sections"), {})
    sections_text = _flatten_sections(sections_dict)
    combined_text = summary_text + " " + sections_text
    banned_phrase_hits = _count_phrase_hits(combined_text, BANNED_PHRASES)

    # --- what_to_watch / tomorrow_setup banned phrases --------------------
    watch_key = "what_to_watch" if brief_type == "morning" else "tomorrow_setup"
    watch_text = ""
    if isinstance(sections_dict, dict):
        watch_text = sections_dict.get(watch_key) or ""
    what_to_watch_banned_hits = _count_phrase_hits(watch_text, WHAT_TO_WATCH_BANNED)

    # --- Section presence / omission -------------------------------------
    expected_keys = SECTION_KEYS.get(brief_type, set())
    present_keys = set(sections_dict.keys()) if isinstance(sections_dict, dict) else set()
    sections_present = sorted(present_keys)
    sections_omitted = sorted(expected_keys - present_keys)

    # --- top_deals count -------------------------------------------------
    top_deals = _safe_json(briefing.get("top_deals"), None)
    top_deals_count = len(top_deals) if isinstance(top_deals, list) else None

    # --- Soft flags -------------------------------------------------------
    # Never affect any hard metric. Logged as observational data only.
    triggered = [
        flag_id
        for flag_id, check_fn in SOFT_FLAG_CHECKS
        if check_fn(headline_lower, sections_dict)
    ]
    soft_flags = json.dumps(triggered) if triggered else None

    # --- Write row -------------------------------------------------------
    score_row = {
        "run_id":                    run_id,
        "brief_type":                brief_type,
        "headline_word_count":       headline_word_count,
        "headline_pass":             headline_pass,
        "banned_phrase_hits":        banned_phrase_hits,
        "what_to_watch_banned_hits": what_to_watch_banned_hits,
        "sections_present":          json.dumps(sections_present),
        "sections_omitted":          json.dumps(sections_omitted),
        "top_deals_count":           top_deals_count,
        "status":                    status,
        "soft_flags":                soft_flags,
    }

    try:
        supabase.table("brief_quality_scores").insert(score_row).execute()
        flag_note = f", soft_flags={triggered}" if triggered else ""
        print(
            f"  [critique] brief scored — "
            f"headline_pass={headline_pass} ({headline_word_count}w), "
            f"banned_hits={banned_phrase_hits}, "
            f"watch_hits={what_to_watch_banned_hits}, "
            f"present={sections_present}, "
            f"omitted={sections_omitted}, "
            f"deals={top_deals_count}, "
            f"status={status}"
            f"{flag_note}"
        )
    except Exception as e:
        print(f"  [critique] failed to insert brief_quality_scores row: {e}")
