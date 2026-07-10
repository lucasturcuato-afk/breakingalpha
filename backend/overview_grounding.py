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

import json
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

# Macro indicators + release labels legitimately woven into the pulse from the
# macro strip (macro_calendar + bea_calendar), NOT the article corpus. These are
# economic data series, never companies, so they are always SUPPORTED for the
# entity check. A real company name in no source is still rejected.
_MACRO_TERMS = frozenset({
    "nonfarm payrolls", "nonfarm payroll", "payrolls", "nonfarm", "jobs report",
    "unemployment rate", "unemployment", "initial jobless claims", "jobless claims",
    "cpi", "consumer price index", "core cpi", "core consumer price index",
    "pce", "core pce", "personal consumption expenditures",
    "core personal consumption expenditures", "ppi", "producer price index",
    "gdp", "gross domestic product", "retail sales", "durable goods",
    "industrial production", "ism manufacturing", "ism services", "ism",
    "consumer confidence", "consumer sentiment", "housing starts",
    "fomc", "fed funds", "federal funds rate",
})

# Multi-word NON-org proper nouns the V2 pulse legitimately references as color:
# geographies/regions, government bodies / central banks, and rate/data series.
# These are NEVER companies, so the pulse grounding check ignores them (a real
# hallucinated COMPANY not in the stories is still rejected).
_NON_ORG_TERMS = frozenset({
    # geographies / regions
    "middle east", "middle eastern", "strait of hormuz", "strait hormuz",
    "europe", "european union", "eurozone", "asia", "asia pacific",
    "latin america", "north america", "south america", "central america",
    "united states", "united kingdom", "hong kong", "wall street",
    "main street", "persian gulf", "red sea", "south china sea", "east asia",
    "far east", "the gulf",
    # government bodies / central banks / rate & data series
    "federal reserve", "the fed", "us treasury", "u.s. treasury",
    "treasury department", "white house", "capitol hill", "supreme court",
    "european central bank", "bank of japan", "bank of england",
    "10-year treasury", "10 year treasury", "two-year treasury",
    "10-year yield", "the 10-year",
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
    if o in _MACRO_TERMS:
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
    "declined", "declines", "risk-off", "risk off",
    "retreat", "retreated", "sank",
)
# NOTE: "de-risk"/"de-risking" are deliberately NOT market-direction words: they
# describe a company balance-sheet action (e.g. an insurer ceding reserves) and
# false-tripped the check on a clearly risk-on tape. Market risk-off is still
# caught by "risk-off"/"risk off".
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
    # Fire only on a NET contradiction: the narrative's DOMINANT direction opposes
    # the tape. A lone opposite word inside otherwise-consistent language (e.g. one
    # company "de-risking" or "lower guidance" in a plainly risk-on read) is not a
    # market-direction claim and must not false-trip.
    if direction == "down":
        if has_up and not has_down:
            violations.append(
                "overview claims an UP / rallying market but the fetched tape is DOWN"
            )
        if has_strength:
            violations.append(
                "overview describes the tape as resilient/rallying but it is DOWN"
            )
    elif direction == "up":
        if has_down and not has_up:
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


# ── V2 pulse grounding: validate against the pulse's OWN inputs ───────────────
#
# The monolith validate_overview checks entities against the ARTICLE CORPUS. The
# V2 pulse is given a NARROWER, DIFFERENT input set (tape + macro strip + the top
# stories), and it legitimately references vocabulary the corpus never contains
# (macro series, geographies, government bodies). Checking it against the corpus
# false-flags that vocabulary class-by-class. This checks the V2 narrative
# against EXACTLY what V2 was given, and nothing else: a company named that is in
# NONE of {top_stories, tape, macro} is still a genuine hallucination and fails.


def _strip_possessive(s: str) -> str:
    """Drop a trailing possessive so 'CME Group's' validates as 'CME Group'."""
    return re.sub(r"[’']s$", "", s or "").strip()


def _pulse_supported_text(top_stories, macro_strip: str | None) -> str:
    """Lowercased bag of everything the V2 pulse was GIVEN: the top-stories'
    titles / one-liners / sectors / companies, plus the rendered macro strip."""
    parts: list[str] = []
    for s in (top_stories or []):
        if not isinstance(s, dict):
            parts.append(str(s))
            continue
        for k in ("title", "one_liner", "sector"):
            v = s.get(k)
            if isinstance(v, str) and v.strip():
                parts.append(v)
        cos = s.get("companies") or []
        if isinstance(cos, str):
            try:
                cos = json.loads(cos)
            except Exception:
                cos = [cos]
        for c in (cos or []):
            if str(c).strip():
                parts.append(str(c))
    if isinstance(macro_strip, str) and macro_strip.strip():
        parts.append(macro_strip)
    return " ".join(parts).lower()


def pulse_unsupported_entities(narrative: str, top_stories, macro_strip: str | None) -> list[str]:
    """Company-shaped entities in the V2 narrative that are supported by NEITHER
    the pulse's stories/macro inputs NOR the tape/macro/non-org vocabulary. Only
    genuine hallucinated ORGS remain. Possessives are normalized; geographies /
    government bodies / data series / index + macro terms are never flagged."""
    supported = _pulse_supported_text(top_stories, macro_strip)
    bad: list[str] = []
    for o in candidate_orgs(narrative):
        ol = _strip_possessive(o.strip().lower())
        if not ol:
            continue
        if ol in _INDEX_NAMES or ol in _MACRO_TERMS or ol in _NON_ORG_TERMS:
            continue
        if org_supported(ol, supported, set()):
            continue
        bad.append(o)
    return sorted(set(bad))


# ── Numeric-figure provenance (fabricated-number guard) ──────────────────────
# The pulse must not state a specific figure that its inputs do not support (it
# wrote "Micron ... $3 billion" when no source carried that number). Only unit-
# bearing or comma-grouped figures are checked; bare integers/years are ignored.
_FIG_MULT = {"t": 1e12, "tn": 1e12, "trillion": 1e12, "b": 1e9, "bn": 1e9,
             "billion": 1e9, "m": 1e6, "mn": 1e6, "million": 1e6}
_MONEY_RE = re.compile(r"\$?\s*(\d+(?:\.\d+)?)\s*(trillion|billion|million|tn|bn|mn|[bmt])\b", re.I)
_PCT_RE = re.compile(r"(\d+(?:\.\d+)?)\s*%")
_KCOUNT_RE = re.compile(r"(\d[\d,]*(?:\.\d+)?)\s*(?:thousand|k)\b", re.I)
# comma-grouped number NOT immediately followed by a K/thousand unit (that case is
# the K-count above; matching it here too would double-count at the wrong scale).
_COMMA_RE = re.compile(r"\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b(?!(?:\.\d+)?\s*(?:thousand|k)\b)", re.I)


def _pulse_figures(text: str) -> list[tuple[str, float, str]]:
    """Extract (kind, magnitude, raw) for money / percent / count figures."""
    out: list[tuple[str, float, str]] = []
    t = text or ""
    for m in _MONEY_RE.finditer(t):
        out.append(("money", float(m.group(1)) * _FIG_MULT.get(m.group(2).lower(), 1.0), m.group(0).strip()))
    for m in _PCT_RE.finditer(t):
        out.append(("pct", float(m.group(1)), m.group(0).strip()))
    for m in _KCOUNT_RE.finditer(t):
        out.append(("count", float(m.group(1).replace(",", "")) * 1000.0, m.group(0).strip()))
    for m in _COMMA_RE.finditer(t):
        out.append(("count", float(m.group(0).replace(",", "")), m.group(0).strip()))
    return out


def _sourced_figure_set(tape, macro_strip, top_stories) -> list[tuple[str, float, str]]:
    """Every figure the pulse was GIVEN: macro strip + story text + tape (pcts,
    levels, VIX), plus pairwise differences of sourced counts (derived changes like
    a payroll delta of +57K)."""
    figs: list[tuple[str, float, str]] = []
    for tp in (macro_strip or "", _pulse_supported_text(top_stories, None)):
        figs.extend(_pulse_figures(tp))
    for v in ((tape or {}).get("quotes") or {}).values():
        for key, kind in (("pct", "pct"), ("price", "count")):
            try:
                figs.append((kind, float(v.get(key)), "tape"))
            except (TypeError, ValueError):
                pass
    try:
        figs.append(("count", float((tape or {}).get("vix_level")), "tape"))
    except (TypeError, ValueError):
        pass
    counts = [mag for (k, mag, _r) in figs if k == "count"]
    for i in range(len(counts)):
        for j in range(i + 1, len(counts)):
            figs.append(("count", abs(counts[i] - counts[j]), "derived"))
    return figs


def _figure_sourced(kind: str, mag: float, sourced) -> bool:
    for (sk, smag, _r) in sourced:
        if sk != kind:
            continue
        # Percentages match on MAGNITUDE: the narrative carries direction in words
        # ("down 0.88%") while the tape stores the signed pct (-0.88).
        if kind == "pct" and abs(abs(mag) - abs(smag)) <= 0.15:
            return True
        if kind == "money" and (mag == smag or (smag > 0 and abs(mag - smag) / smag <= 0.02)):
            return True
        if kind == "count" and (abs(mag - smag) <= 1 or (smag > 0 and abs(mag - smag) / smag <= 0.01)):
            return True
    return False


def pulse_unsourced_figures(narrative: str, tape, macro_strip, top_stories) -> list[str]:
    """Figures in the narrative not supported by the pulse's inputs (trivial rounding
    + unit forms allowed). A fabricated magnitude (a $3B no source states) is flagged;
    a qualitative claim carries no figure and is never flagged."""
    sourced = _sourced_figure_set(tape, macro_strip, top_stories)
    seen: set[str] = set()
    bad: list[str] = []
    for (kind, mag, raw) in _pulse_figures(narrative):
        if not _figure_sourced(kind, mag, sourced) and raw.lower() not in seen:
            seen.add(raw.lower())
            bad.append(raw)
    return bad


def validate_pulse_grounding(narrative: str, tape: dict | None, macro_strip: str | None,
                             top_stories) -> dict:
    """Grounding check for the DEDICATED V2 pulse. Supported set = the pulse's own
    inputs (tape + macro strip + top stories), NOT the article corpus. Checks entities,
    the tape DIRECTION, AND numeric-figure provenance. A company or a figure in none of
    the pulse's inputs is a hallucination and fails. Pure; same shape as before."""
    ents = pulse_unsupported_entities(narrative, top_stories, macro_strip)
    tapes = tape_claim_violations(narrative, tape)
    figs = pulse_unsourced_figures(narrative, tape, macro_strip, top_stories)
    reasons: list[str] = []
    if ents:
        reasons.append("unsupported entities: " + ", ".join(ents))
    reasons.extend(tapes)
    if figs:
        reasons.append("unsourced figures: " + ", ".join(figs))
    return {
        "ok": not ents and not tapes and not figs,
        "unsupported_entities": ents,
        "tape_violations": tapes,
        "unsourced_figures": figs,
        "reasons": reasons,
    }


# ── Minimal grounded fallback ────────────────────────────────────────────────

def _fmt_pct(pct) -> str | None:
    try:
        return f"{float(pct):+.2f}%"
    except (TypeError, ValueError):
        return None


# ── MARKET_PULSE_V2 opening-subject check (pure) ─────────────────────────────
# The V2 dedicated Market Pulse call must open on the INDEX-LEVEL market read, not
# on a single company or a lone sector. These pure checks let the harness assert
# the flag WITHOUT calling Gemini: (a) the opening must reference index-level
# market terms; (b) the opening subject must not be a single corpus company/ticker
# or a lone sector label. On a violation the caller does ONE bounded re-ask then
# falls back to build_minimal_overview (which leads with the tape by construction).

# Index / market-level terms that count as an equity-market read.
_MARKET_TERMS = (
    "s&p", "s&p 500", "nasdaq", "dow", "dow jones", "russell", "russell 2000",
    "vix", "index", "indices", "equities", "equity market", "stocks", "the tape",
    "tape", "wall street", "broad market", "broader market", "risk-on", "risk off",
    "risk-off", "risk on", "market", "session", "breadth",
)

# Lone sector labels that must not be the SUBJECT of the opening (a sector may be
# color, never the market's stand-in). Kept lowercase; matched as a leading token.
_SECTOR_LABELS = frozenset({
    "insurance", "energy", "healthcare", "technology", "tech", "financials",
    "financial", "industrials", "materials", "utilities", "consumer",
    "biotech", "pharma", "semiconductors", "semiconductor", "chips", "banks",
    "banking", "real estate", "reits", "crypto", "defense", "aerospace",
    "retail", "autos", "auto", "media", "telecom", "software", "hardware",
    "oil", "gas", "mining", "airlines", "housing", "homebuilders",
})


def _first_sentence(text: str) -> str:
    if not isinstance(text, str) or not text.strip():
        return ""
    # First paragraph, first sentence.
    para = text.strip().split("\n\n", 1)[0].strip()
    parts = _SENT_SPLIT.split(para)
    return (parts[0].strip() if parts else para).strip()


def opening_has_market_terms(text: str) -> bool:
    """True when the opening (first paragraph) references index-level market terms:
    a tape number, an index name, a regime word, or a market/breadth term. Pure."""
    if not isinstance(text, str) or not text.strip():
        return False
    para = text.strip().split("\n\n", 1)[0].lower()
    if re.search(r"[+-]?\d+(?:\.\d+)?\s*%", para):  # any percent figure
        return True
    return any(term in para for term in _MARKET_TERMS)


def opening_subject_is_single_focus(text: str, roster) -> bool:
    """Heuristic: True when the opening SENTENCE leads with a single corpus company
    / ticker OR a lone sector label AND lacks index/market terms. This is the
    'sector-as-market hero' / 'single-name hero' detector. Pure, never raises.

    roster: the resolved corpus company names (used to detect a company-led open).
    """
    sent = _first_sentence(text)
    if not sent:
        return False
    low = sent.lower().strip()
    roster_lc = {str(c).strip().lower() for c in (roster or []) if str(c).strip()}

    # What LEADS the sentence decides the subject, regardless of a market term that
    # appears later as an object ("Insurance dominated the tape" leads with a sector).
    # A single-focus open is one whose FIRST token(s) are a sector label or a corpus
    # company / capitalized org, UNLESS the sentence opens directly on an index name
    # or a tape figure (then the market is the subject).

    # Rescue: the sentence opens on an index name or a leading tape figure.
    if re.match(r"^[+-]?\$?\d+(?:\.\d+)?\s*%", low):
        return False
    _INDEX_START = (
        "s&p", "nasdaq", "dow", "russell", "the s&p", "the nasdaq", "the dow",
        "the russell", "vix", "the vix", "equities", "stocks", "the tape",
        "the market", "markets", "the broader market", "the broad market",
        "wall street", "the session", "index", "indices", "major indices",
    )
    if any(low.startswith(t) for t in _INDEX_START):
        return False

    # Lone sector label as the leading token(s): "Insurance ...", "Energy names ...".
    lead_word = re.split(r"[\s,.:;]+", low, maxsplit=1)[0]
    if lead_word in _SECTOR_LABELS:
        return True
    lead_two = " ".join(re.split(r"\s+", low)[:2])
    if lead_two in _SECTOR_LABELS:
        return True

    # A corpus company / ticker as the opening subject (allow a leading article/quote).
    head = low[:80]
    for name in roster_lc:
        if name and re.match(r"^[\"'(]?" + re.escape(name) + r"\b", head):
            return True
    # A standalone capitalized org phrase leads the sentence (covers names not in the
    # roster but that the entity-check would also flag).
    for org in candidate_orgs(sent):
        if low.startswith(org.lower()):
            return True

    # No single-focus lead detected. If the opening still carries NO index/market
    # term at all, it is not a market read either, but that is caught separately by
    # opening_has_market_terms; here we only decide the single-focus question.
    return False


def opening_claim_scope_violation(text: str, brief_type: str | None) -> bool:
    """Morning briefs must not open with a settled whole-day CLOSE verdict; evening
    briefs may. Returns True (violation) when a morning opening asserts a settled
    close ('stocks closed', 'the session ended', 'finished the day'). Pure."""
    if brief_type != "morning":
        return False
    para = (text or "").strip().split("\n\n", 1)[0].lower()
    if not para:
        return False
    _CLOSED_CLAIMS = (
        "closed higher", "closed lower", "closed up", "closed down", "closed mixed",
        "closed the session", "closed the day", "finished the day", "finished higher",
        "finished lower", "ended the session", "ended the day", "the session ended",
        "settled higher", "settled lower", "wrapped the session", "wrapped the day",
        "posted a full-day", "on the day, stocks",
    )
    return any(c in para for c in _CLOSED_CLAIMS)


def validate_pulse_opening(
    text: str, roster, brief_type: str | None = None
) -> dict:
    """MARKET_PULSE_V2 deterministic post-check over the dedicated pulse narrative.
    Returns {"ok": bool, "reasons": [...]}. Pure. The caller does ONE bounded
    re-ask on a violation, then the minimal grounded template."""
    reasons: list[str] = []
    if not opening_has_market_terms(text):
        reasons.append(
            "opening does not reference index-level market terms (index name, tape "
            "figure, regime, or breadth)"
        )
    if opening_subject_is_single_focus(text, roster):
        reasons.append(
            "opening SUBJECT is a single company or a lone sector, not the market"
        )
    if opening_claim_scope_violation(text, brief_type):
        reasons.append(
            "morning pulse opens with a settled whole-day CLOSE verdict "
            "(morning must use opened/opening/early-session framing)"
        )
    return {"ok": not reasons, "reasons": reasons}


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

    # The regime word must match the numbers. The self-select fallback relegates
    # to market-wide on ANY tape (decision b), so this template can fire on a
    # material-move day; a hardcoded "quiet" then contradicts the figures
    # ("On a quiet tape, the S&P 500 is -1.40%"). Derive the framing from the SAME
    # materiality signal the gate uses (market_tape.tape_has_material_move), so the
    # prefix cannot contradict the tape. Lazy import keeps this module standalone.
    try:
        from market_tape import tape_has_material_move as _material
        _is_material = bool(_material(tape))
    except Exception:
        _is_material = False

    if bits:
        prefix = "The tape is moving: " if _is_material else "On a quiet tape, "
        body = prefix + ", ".join(bits) + "."
    else:
        body = "The tape is quiet with no single driver owning the read."

    title = (best_story_title or "").strip()
    if title:
        body += f" Among the day's stories: {title}."
    return body
