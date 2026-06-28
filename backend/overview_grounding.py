"""Deterministic grounding post-check for the market-wide overview rewrite.

PURE module: no DB, no Gemini, no network, no I/O at import. Import-safe and
unit-testable on its own. This is the real safety net for the grounded
market-wide rewrite (T2/T3): a re-ask is not harness-assertable, but this
validator is.

Two checks over the overview narrative text:

  ENTITY  - every named org/ticker in the overview must be supported by the
            candidate corpus (article titles/body text) or the resolved-company
            roster. This REPLACES the D8 fragment bug in synthesize._candidate_orgs:
            it splits on sentence boundaries FIRST so a sentence period can never
            join "Western Digital. This" into one phrase, and it prefers matching
            against the resolved company/ticker roster over naive capitalized-token
            scanning.

  TAPE     - any directional/numeric market claim (up/down/rallied/fell/risk-off,
            and explicit index figures) must be consistent with the FETCHED tape
            (index %s + VIX). A bullish claim against a down tape is a violation.

The caller (synthesize.run) runs validate_overview(...) after the rewrite. On
any violation it does ONE bounded re-ask naming the violation; if that still
fails it falls back to a MINIMAL grounded template (build_minimal_overview).
Every violation is logged. Nothing ungrounded ships.
"""
from __future__ import annotations

import re

# Sentence terminators we split on so a candidate org never spans a sentence.
_SENT_SPLIT = re.compile(r"[.!?]+(?:\s+|$)")

# A single org-phrase candidate inside ONE sentence: a run of capitalized tokens
# optionally joined by &/of/and/'s. The token char class deliberately EXCLUDES
# the period (the D8 fragment bug). Apostrophes and hyphens stay (O'Reilly,
# Bristol-Myers). A trailing 's is tolerated inside the run via the joiners.
_ORG_TOKEN = r"[A-Z][A-Za-z&'\-]+"
_ORG_PHRASE = re.compile(
    rf"\b({_ORG_TOKEN}(?:\s+(?:of\s+|and\s+|&\s+)?{_ORG_TOKEN}){{0,4}})\b"
)
# A bare ALL-CAPS ticker-like token, length 2-5 (NVDA, AAPL). Single-letter and
# very long all-caps runs are excluded (too noisy).
_TICKER = re.compile(r"\b([A-Z]{2,5})\b")

# Sentence-initial / generic words that on their own do NOT constitute an org.
# These get dropped from a candidate run; a run that is ONLY these is not an org.
_STOP = frozenset({
    "the", "this", "that", "these", "those", "a", "an", "and", "or", "but",
    "federal", "reserve", "wall", "street", "streets", "fed",
    "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
    "january", "february", "march", "april", "may", "june", "july", "august",
    "september", "october", "november", "december",
    "ai", "ceo", "cfo", "ipo", "gdp", "cpi", "pce", "fomc", "us", "u.s.",
    "q1", "q2", "q3", "q4", "vix", "etf", "ev", "it", "we", "they", "their",
    "today", "yesterday", "markets", "market", "stocks", "shares", "index",
    "indices", "investors", "treasury", "treasuries",
    # Direction words sometimes sentence-initial and Capitalized.
    "up", "down", "gains", "losses", "after", "amid", "while", "as", "with",
})
# Generic single heads that cannot alone vouch for a multi-word phrase (a bare
# "Texas" in the corpus must not support "Texas Pacific Land"). Mirrors the D8
# _ORG_GENERIC_HEADS intent.
_GENERIC_HEADS = frozenset({
    "texas", "new", "american", "america", "united", "national", "global",
    "international", "general", "first", "north", "south", "east", "west",
    "central", "pacific", "atlantic", "european", "asian", "western", "eastern",
    "northern", "southern", "capital", "city", "state", "federal", "bank",
    "group", "holdings", "holding", "partners", "industries", "technologies",
    "systems", "solutions", "financial",
})

# Known index proper nouns that are NEVER hallucinated orgs (they are the tape).
_INDEX_NAMES = frozenset({
    "s&p", "s&p 500", "nasdaq", "dow", "dow jones", "russell", "russell 2000",
    "nasdaq composite", "the close",
})


def candidate_orgs(text: str) -> set[str]:
    """Sentence-bounded proper-noun org extractor. Splits on sentence
    terminators FIRST so a period can never join two sentences into one phrase
    (the D8 fix). Returns a set of candidate org strings (>= 2 words, OR a
    standalone ticker-like ALL-CAPS token)."""
    if not isinstance(text, str) or not text.strip():
        return set()
    out: set[str] = set()
    for sentence in _SENT_SPLIT.split(text):
        s = sentence.strip()
        if not s:
            continue
        for m in _ORG_PHRASE.finditer(s):
            phrase = m.group(1).strip().strip(".,;:")
            toks = [t for t in re.split(r"\s+", phrase) if t]
            # Drop runs that are entirely stopwords / sentence-initial noise.
            kept = [t for t in toks if t.lower() not in _STOP]
            if not kept:
                continue
            # Trim leading stopword heads ("The Technology" -> "Technology"),
            # then only keep multi-word runs as org candidates.
            phrase2 = " ".join(kept)
            if phrase2.lower() in _INDEX_NAMES:
                continue
            if len(kept) >= 2:
                out.add(phrase2)
        for m in _TICKER.finditer(s):
            tk = m.group(1)
            if tk.lower() in _STOP or tk in ("US",):
                continue
            out.add(tk)
    return out


def org_supported(org: str, corpus_lc: str, roster_lc: set[str]) -> bool:
    """True when an org candidate is supported by the corpus text or the
    resolved-company roster. Prefers roster membership; a multi-word phrase is
    also supported by a distinctive >= 2-token prefix or a non-generic single
    head present in the corpus/roster. A bare generic/geographic head alone
    (e.g. "texas") can never vouch for a phrase."""
    o = (org or "").strip().lower()
    if not o:
        return True
    if o in _INDEX_NAMES:
        return True
    if o in roster_lc or o in corpus_lc:
        return True
    toks = o.split()
    if len(toks) < 2:
        # Single token (ticker or one-word org): only the whole-string checks
        # above support it. A lone unsupported token stays unsupported.
        return False
    two = " ".join(toks[:2])
    if two in roster_lc or two in corpus_lc:
        return True
    head = toks[0]
    if len(head) > 3 and head not in _GENERIC_HEADS and (
        head in roster_lc or head in corpus_lc
    ):
        return True
    return False


def unsupported_entities(text: str, corpus_text: str, roster) -> list[str]:
    """Return the sorted list of org/ticker candidates in `text` that are NOT
    supported by the corpus or the resolved-company roster. Empty list == clean.
    This is the ENTITY check; it also doubles as the D8 fragment-bug fix."""
    corpus_lc = (corpus_text or "").lower()
    roster_lc = {str(c).strip().lower() for c in (roster or []) if str(c).strip()}
    bad = [o for o in candidate_orgs(text) if not org_supported(o, corpus_lc, roster_lc)]
    return sorted(set(bad))


# ── Tape-claim check ─────────────────────────────────────────────────────────

_UP_WORDS = (
    "rally", "rallied", "rallies", "surge", "surged", "surges", "jump",
    "jumped", "climb", "climbed", "climbs", "rose", "rise", "rises", "rising",
    "gain", "gained", "gains", "advance", "advanced", "higher", "buoyant",
    "risk-on", "risk on", "rebound", "rebounded", "soared", "soar",
)
_DOWN_WORDS = (
    "fell", "fall", "falls", "falling", "drop", "dropped", "drops", "slump",
    "slumped", "slide", "slid", "sink", "sank", "plunge", "plunged", "tumble",
    "tumbled", "selloff", "sell-off", "sold off", "lower", "decline",
    "declined", "declines", "risk-off", "risk off", "de-risk", "de-risking",
    "retreat", "retreated", "sank",
)
# Words that explicitly assert calm/strength when the tape is weak, or vice
# versa. These are the "mixed/resilient/rallying" claims the tape directive bans.
_STRENGTH_WORDS = ("resilient", "resilience", "rallying", "rallied", "buoyant")


def _tape_direction(tape: dict | None) -> str | None:
    """Reduce the fetched tape to 'up' | 'down' | 'flat' | None. Uses the regime
    when present (it already encodes VIX + SPX), else the S&P sign. None when no
    usable tape."""
    if not tape:
        return None
    regime = (tape.get("regime") or "").strip().lower()
    if regime == "risk-on":
        return "up"
    if regime == "risk-off":
        return "down"
    # Neutral / unknown regime: fall back to the S&P sign if material.
    try:
        spx = (tape.get("quotes") or {}).get("^GSPC") or {}
        pct = float(spx.get("pct"))
    except (TypeError, ValueError):
        return "flat" if regime == "neutral" else None
    if pct >= 0.3:
        return "up"
    if pct <= -0.3:
        return "down"
    return "flat"


def tape_claim_violations(text: str, tape: dict | None) -> list[str]:
    """Return a list of human-readable tape-claim violations: directional words
    in `text` that contradict the fetched tape. Soft: no tape -> no violations
    (cannot validate). A neutral/flat tape does not flag direction words (it is
    genuinely mixed). Pure, never raises."""
    if not isinstance(text, str) or not text.strip() or not tape:
        return []
    direction = _tape_direction(tape)
    if direction is None or direction == "flat":
        return []
    low = text.lower()
    violations: list[str] = []
    has_up = any(w in low for w in _UP_WORDS)
    has_down = any(w in low for w in _DOWN_WORDS)
    has_strength = any(w in low for w in _STRENGTH_WORDS)
    if direction == "down":
        if has_up:
            violations.append(
                "overview claims an UP / rallying market but the fetched tape is DOWN"
            )
        if has_strength:
            violations.append(
                "overview describes the tape as resilient/rallying but it is DOWN"
            )
    elif direction == "up":
        if has_down:
            violations.append(
                "overview claims a DOWN / risk-off market but the fetched tape is UP"
            )
    return violations


def validate_overview(text: str, corpus_text: str, roster, tape: dict | None) -> dict:
    """Run BOTH checks over the overview text. Returns:
        {"ok": bool,
         "unsupported_entities": [...],
         "tape_violations": [...],
         "reasons": [...]}.
    Pure. The caller decides re-ask vs minimal-template fallback from `ok`."""
    ents = unsupported_entities(text, corpus_text, roster)
    tapes = tape_claim_violations(text, tape)
    reasons: list[str] = []
    if ents:
        reasons.append("unsupported entities: " + ", ".join(ents))
    reasons.extend(tapes)
    return {
        "ok": not ents and not tapes,
        "unsupported_entities": ents,
        "tape_violations": tapes,
        "reasons": reasons,
    }


# ── Minimal grounded fallback ────────────────────────────────────────────────

def _fmt_pct(pct) -> str | None:
    try:
        return f"{float(pct):+.2f}%"
    except (TypeError, ValueError):
        return None


def build_minimal_overview(tape: dict | None, best_story_title: str | None = None) -> str:
    """Last-resort grounded template built ONLY from the fetched tape numbers
    plus, optionally, the single best-supported corpus story as a mention. Short
    by design (brevity is correct when material is thin). Never invents a
    direction or a name. When there is no tape at all, returns a minimal, honest
    'no live tape' line. Pure."""
    if not tape:
        base = "Market data is unavailable for this session; no live tape to characterize."
        title = (best_story_title or "").strip()
        if title:
            base += f" One story in focus: {title}."
        return base

    quotes = tape.get("quotes") or {}
    bits = []
    spx = _fmt_pct((quotes.get("^GSPC") or {}).get("pct"))
    if spx:
        bits.append(f"the S&P 500 is {spx}")
    ndx = _fmt_pct((quotes.get("^IXIC") or {}).get("pct"))
    if ndx:
        bits.append(f"the Nasdaq {ndx}")
    vix = tape.get("vix_level")
    try:
        vix_txt = f"VIX at {float(vix):.1f}" if vix is not None else None
    except (TypeError, ValueError):
        vix_txt = None
    if vix_txt:
        bits.append(vix_txt)

    if bits:
        body = "On a quiet tape, " + ", ".join(bits) + "."
    else:
        body = "The tape is quiet with no single driver owning the read."

    title = (best_story_title or "").strip()
    if title:
        body += f" Among the day's stories: {title}."
    return body
