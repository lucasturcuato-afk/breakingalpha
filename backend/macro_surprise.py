"""Deterministic macro-surprise extractor. NO LLM, NO network, pure functions.

Why this exists
---------------
On 2026-08-07 the corpus carried the July payrolls consensus in plain text hours
before synthesis ran ("payrolls declined 23K in July, well below expectations of
growth of nearly 100K", 09:20Z SeekingAlpha). The pulse still shipped "no fresh
catalyst on the tape" and called it "last week's soft-landing jobs read". The
signal was in hand and discarded.

What this module does
---------------------
Reads article title + summary text for a macro release and pulls out, by regex
only:
  * direction vs consensus (below / above / inline), by explicit comparator
    language ONLY,
  * the printed actual value, when it is stated adjacent to the release name,
  * the consensus/expected value, when a source states a number,
  * market-reaction phrases, captured as EVIDENCE ONLY.

Honesty rules, enforced in code, not in a prompt
------------------------------------------------
1. Direction comes ONLY from explicit comparator language ("below expectations",
   "weaker than expected", "misses forecasts"). It is NEVER inferred from the
   price move or from a reaction phrase. Inferring surprise from the tape is the
   tautology PR #463 closed; reaction strings are collected but they cannot vote.
2. No consensus number found means no consensus number is emitted. The object can
   still carry a direction (which is separately sourced), but `expected` stays
   None and callers must not invent one.
3. Sources disagree about the consensus figure on a real release day
   ("nearly 100K" vs a Reuters +80K poll). We NEVER pick a fake precise number:
   `expected` carries `low`, `high` and `modal` (the most frequently stated
   value, ties broken by the first-published mention). Callers render a range
   whenever low != high.
4. A contested direction (both "below" and "above" language present without a
   two-thirds majority) returns None. Silence beats a coin flip.

Measured coverage (2026-02..2026-08 prod corpus, 24 macro-release-day buckets,
247 articles): direction 21.9% of articles / 71% of buckets; a numeric consensus
value only 2.4% of articles / 25% of buckets. So direction is cheap and magnitude
is rare. The design reflects that: direction-primary, magnitude-optional.
"""

from __future__ import annotations

import re
from collections import Counter

# ── Release taxonomy ─────────────────────────────────────────────────────────
# Maps a release key to (display name, detection regex, value kind).
RELEASE_KINDS = {
    "nonfarm_payrolls": (
        "Nonfarm payrolls",
        re.compile(r"\b(?:nonfarm payrolls?|non-farm payrolls?|jobs report|payrolls?|employment report)\b", re.I),
        "jobs",
    ),
    "cpi": ("CPI", re.compile(r"\b(?:consumer price index|CPI)\b"), "pct"),
    "core_cpi": ("Core CPI", re.compile(r"\bcore CPI\b", re.I), "pct"),
    "ppi": ("PPI", re.compile(r"\b(?:producer price index|PPI)\b"), "pct"),
    "pce": ("PCE", re.compile(r"\bPCE\b"), "pct"),
    "core_pce": ("Core PCE", re.compile(r"\bcore PCE\b", re.I), "pct"),
    "gdp": ("GDP", re.compile(r"\bGDP\b|\bgross domestic product\b", re.I), "pct"),
    "retail_sales": ("Retail sales", re.compile(r"\bretail sales\b", re.I), "pct"),
    "unemployment": ("Unemployment rate", re.compile(r"\bunemployment rate\b", re.I), "pct"),
}

# ── Direction lexicons ───────────────────────────────────────────────────────
# "Direction" is the sign of actual vs consensus, NOT good-vs-bad. A cooler CPI
# is BELOW consensus even though the market reads it as bullish. Keeping the
# axis mechanical is what stops the reaction from leaking into the direction.
_BELOW = [
    r"\bbelow (?:market )?(?:expectations|forecasts?|estimates?|consensus)\b",
    r"\b(?:much |well |far )?(?:weaker|worse|softer|cooler|lower|slower)[-\s]than[-\s](?:expected|forecast|estimated|estimates?|consensus)\b",
    r"\bmiss(?:ed|es)? (?:forecasts?|estimates?|expectations?|the mark)\b",
    r"\bunexpectedly (?:fell|fall|contract|contracted|declin\w*|drop\w*|shrank|slowed)\b",
    r"\bunexpected(?:ly)? (?:contraction|decline|drop|weakness|fall)\b",
    r"\bsurprises? to the downside\b",
    r"\b(?:fell|falls|came in) short of\b",
    r"\bshy of (?:forecasts?|estimates?|expectations?|consensus)\b",
    r"\b(?:much )?less than (?:market )?expect\w+\b",
    r"\bunder(?:shot|performed) (?:forecasts?|estimates?|expectations?)\b",
]
_ABOVE = [
    r"\babove (?:market )?(?:expectations|forecasts?|estimates?|consensus)\b",
    r"\b(?:much |well |far )?(?:stronger|better|hotter|firmer|higher|faster)[-\s]than[-\s](?:expected|forecast|estimated|estimates?|consensus)\b",
    r"\bbeat(?:s|ing)? (?:forecasts?|estimates?|expectations?|consensus)\b",
    r"\btopp(?:ed|ing|s) (?:forecasts?|estimates?|expectations?|consensus)\b",
    r"\bunexpectedly (?:rose|rise|jumped|surged|accelerated|climbed)\b",
    r"\bsurprises? to the upside\b",
    r"\bmore than (?:market )?expect\w+\b",
    r"\bexceed(?:ed|s|ing)? (?:forecasts?|estimates?|expectations?|consensus)\b",
]
_INLINE = [
    r"\bin line with (?:forecasts?|estimates?|expectations?|consensus)\b",
    r"\bmatch(?:ed|es|ing)? (?:forecasts?|estimates?|expectations?|consensus)\b",
    r"\bas (?:economists |analysts )?expected\b",
    r"\b(?:comes?|came|coming) in line\b",
    r"\bnear (?:estimates?|forecasts?|expectations?|consensus)\b",
    r"\bclose to (?:estimates?|forecasts?|expectations?|consensus)\b",
]
BELOW_RX = [re.compile(p, re.I) for p in _BELOW]
ABOVE_RX = [re.compile(p, re.I) for p in _ABOVE]
INLINE_RX = [re.compile(p, re.I) for p in _INLINE]

# ── Value grammar ────────────────────────────────────────────────────────────
_NUM = r"(?:minus\s+|negative\s+|-|\+)?\d{1,3}(?:,\d{3})*(?:\.\d+)?\s*(?:K\b|k\b|thousand\b|million\b|%)?"

EXPECTED_RX = [
    re.compile(r"expect\w*\s+(?:of|for|at|to be)?\s*(?:growth of\s*|a gain of\s*|a drop of\s*)?"
               r"(?:about\s+|around\s+|nearly\s+|roughly\s+|some\s+|a\s+)?(" + _NUM + r")", re.I),
    re.compile(r"(?:consensus|forecast|estimate)s?\s+(?:of|for|was|were|at|called for)\s*"
               r"(?:about\s+|around\s+|nearly\s+|roughly\s+|a\s+)?(" + _NUM + r")", re.I),
    re.compile(r"(?:economists|analysts)\s+(?:had\s+)?(?:expected|forecast|projected)\s*"
               r"(?:a\s+|about\s+|around\s+)?(" + _NUM + r")", re.I),
    re.compile(r"(?:vs\.?|versus|against)\s+(?:the\s+)?(" + _NUM + r")\s*"
               r"(?:expected|forecast|consensus|estimate)", re.I),
    re.compile(r"(" + _NUM + r")\s+(?:expected|forecast|consensus|estimated)\b", re.I),
]

_JOBS_ACTUAL_RX = [
    re.compile(r"payrolls?\s+(declined|fell|dropped|contracted|rose|increased|climbed|grew|added|gained)"
               r"\s+(?:by\s+)?(" + _NUM + r")", re.I),
    re.compile(r"payrolls?\s+(?:\w+\s+){0,4}?(declined|fell|dropped|rose|increased|grew)\s+by\s+(" + _NUM + r")", re.I),
    re.compile(r"(?:economy|employers)\s+(added|shed|lost|cut)\s+(" + _NUM + r")\s+jobs", re.I),
]
_PCT_ACTUAL_RX = [
    re.compile(r"(rose|fell|increased|declined|climbed|dropped|gained|jumped|slowed to|accelerated to|hit|hits)"
               r"\s+(?:by\s+|to\s+)?(\d+(?:\.\d+)?%)", re.I),
]
_NEG_VERBS = re.compile(r"decl|fell|drop|contract|shed|lost|cut|shrank|slow", re.I)

# Reaction phrases are EVIDENCE ONLY. They never vote on direction.
REACTION_RX = [
    re.compile(r"\b(?:gutting|slashing|sinking|sank|sinks|quell\w*|boost\w*|lifting|fuel\w*|reshap\w*)\s+"
               r"(?:\w+\s+){0,3}?rate[-\s](?:hike|cut)\s+(?:odds|bets|fears|expectations)", re.I),
    re.compile(r"\brate[-\s](?:hike|cut)\s+(?:odds|bets|fears|expectations)\b", re.I),
    re.compile(r"\bS&P 500\s+(?:hits?|hit|notch\w*|set)\s+(?:a\s+)?record\b", re.I),
]

# How close (in characters) a percentage has to sit to the release name before we
# will call it the release's actual value. Without this, "Why AMD Shares Are
# Sliding Today ... fell 5%" was being read as a CPI print. Verified against the
# 2026-06-11 CPI bucket, which produced exactly that false actual.
_PCT_PROXIMITY = 80


def _norm(raw, kind):
    """Parse a matched magnitude string into (value, unit). Pure."""
    if not raw:
        return None
    s = " ".join(raw.split())
    sign = -1 if re.match(r"^(minus|negative|-)", s, re.I) else 1
    s = re.sub(r"^(minus|negative|\+|-)\s*", "", s, flags=re.I)
    m = re.search(r"\d{1,3}(?:,\d{3})*(?:\.\d+)?", s)
    if not m:
        return None
    val = float(m.group(0).replace(",", ""))
    if "%" in s:
        return (sign * val, "%")
    if kind == "jobs":
        mult = 1_000_000 if re.search(r"million", s, re.I) else (
            1_000 if re.search(r"(K\b|k\b|thousand)", s) else 1)
        return (sign * val * mult, "jobs")
    return (sign * val, "")


def _first(patterns, text):
    for p in patterns:
        m = p.search(text)
        if m:
            return m
    return None


def _article_text(a):
    """title + summary, tolerant of the several shapes the pipeline passes."""
    if not isinstance(a, dict):
        return ""
    title = a.get("title") or a.get("headline") or ""
    body = a.get("summary") or a.get("one_liner") or a.get("description") or ""
    return f"{title}. {body}".strip()


def detect_release_kind(articles):
    """The release key most articles in the pool are about, or None. Pure."""
    votes = Counter()
    for a in articles or []:
        txt = _article_text(a)
        for key, (_name, rx, _vk) in RELEASE_KINDS.items():
            if rx.search(txt):
                votes[key] += 1
    if not votes:
        return None
    # Prefer the specific core_* variant only when it genuinely dominates.
    return votes.most_common(1)[0][0]


def _extract_actual(text, release_key, value_kind):
    """The release's printed value, or None. For percent releases the figure must
    sit within _PCT_PROXIMITY characters of the release name, so an unrelated
    single-stock move in the same article cannot be read as the macro print."""
    if value_kind == "jobs":
        m = _first(_JOBS_ACTUAL_RX, text)
        if not m:
            return None
        parsed = _norm(m.group(2), "jobs")
        if not parsed:
            return None
        val, unit = parsed
        if _NEG_VERBS.search(m.group(1)):
            val = -abs(val)
        else:
            val = abs(val)
        return {"value": val, "unit": unit, "text": m.group(0).strip()}

    name_rx = RELEASE_KINDS[release_key][1]
    for p in _PCT_ACTUAL_RX:
        for m in p.finditer(text):
            lo = max(0, m.start() - _PCT_PROXIMITY)
            window = text[lo:m.end() + _PCT_PROXIMITY]
            if not name_rx.search(window):
                continue
            parsed = _norm(m.group(2), "pct")
            if not parsed:
                continue
            val, unit = parsed
            if _NEG_VERBS.search(m.group(1)):
                val = -abs(val)
            return {"value": val, "unit": unit or "%", "text": m.group(0).strip()}
    return None


def extract_macro_surprise(articles, release_key=None):
    """Extract the day's macro surprise from an article pool. Returns a dict or
    None. Deterministic, offline, no LLM. See module docstring for the honesty
    rules; the important ones are that direction comes only from explicit
    comparator language and that a missing consensus stays missing."""
    articles = [a for a in (articles or []) if isinstance(a, dict)]
    if not articles:
        return None
    key = release_key or detect_release_kind(articles)
    if not key or key not in RELEASE_KINDS:
        return None
    name, name_rx, value_kind = RELEASE_KINDS[key]

    votes = Counter()
    evidence = []
    actual = None
    expected_vals = []
    reactions = []

    for a in articles:
        text = _article_text(a)
        if not text or not name_rx.search(text):
            continue
        src = a.get("source") or a.get("publisher") or ""
        title = a.get("title") or a.get("headline") or ""

        m = _first(BELOW_RX, text)
        d = "below" if m else None
        if not d:
            m = _first(ABOVE_RX, text)
            d = "above" if m else None
        if not d:
            m = _first(INLINE_RX, text)
            d = "inline" if m else None
        if d:
            votes[d] += 1
            evidence.append({"field": "direction", "value": d,
                             "match": m.group(0).strip(), "source": src, "title": title})

        em = _first(EXPECTED_RX, text)
        if em:
            parsed = _norm(em.group(1), value_kind)
            if parsed and parsed[0] != 0:
                expected_vals.append(parsed[0])
                evidence.append({"field": "expected", "value": parsed[0],
                                 "match": em.group(0).strip(), "source": src, "title": title})

        if actual is None:
            act = _extract_actual(text, key, value_kind)
            if act:
                actual = act
                evidence.append({"field": "actual", "value": act["value"],
                                 "match": act["text"], "source": src, "title": title})

        rm = _first(REACTION_RX, text)
        if rm:
            phrase = rm.group(0).strip()
            if phrase.lower() not in {r.lower() for r in reactions}:
                reactions.append(phrase)

    total = sum(votes.values())
    if total == 0:
        # No explicit comparator language anywhere. We do NOT fall back to the
        # price move. Emit nothing.
        return None
    direction, top = votes.most_common(1)[0]
    if top / total < (2 / 3):
        # Genuinely contested. Silence beats a coin flip.
        return None

    expected = None
    if expected_vals:
        counts = Counter(expected_vals)
        modal = max(counts.items(), key=lambda kv: (kv[1], -expected_vals.index(kv[0])))[0]
        expected = {
            "low": min(expected_vals),
            "high": max(expected_vals),
            "modal": modal,
            "n_sources": len(expected_vals),
            "unit": "jobs" if value_kind == "jobs" else "%",
        }

    if total >= 3 and top == total:
        confidence = "high"
    elif total >= 2 and top == total:
        confidence = "medium"
    elif total == 1:
        confidence = "medium" if expected else "low"
    else:
        confidence = "low"

    return {
        "release_key": key,
        "release_name": name,
        "direction": direction,
        "direction_votes": dict(votes),
        "actual": actual,
        "expected": expected,
        "confidence": confidence,
        "reactions": reactions,
        "evidence": evidence,
    }


def _fmt_jobs(v):
    """-23000 -> '-23K'; 100000 -> '+100K'. Pure."""
    k = v / 1000.0
    s = f"{k:.0f}K" if abs(k - round(k)) < 0.05 else f"{k:.1f}K"
    return ("+" if v > 0 else "-" if v < 0 else "") + s.lstrip("-")


def _fmt_val(v, unit):
    if unit == "jobs":
        return _fmt_jobs(v)
    s = f"{v:g}%"
    return ("+" + s) if v > 0 else s


def format_expected(expected):
    """Render the consensus honestly. A range whenever sources disagree, the
    single value when they agree, never a fabricated precise number."""
    if not expected:
        return None
    unit = expected.get("unit") or ""
    lo, hi = expected.get("low"), expected.get("high")
    if lo is None or hi is None:
        return None
    if lo == hi:
        return _fmt_val(lo, unit)
    return f"{_fmt_val(lo, unit)} to {_fmt_val(hi, unit)}"


def format_surprise_strip_line(surprise):
    """The line appended to the pulse macro strip. It enters through the SAME
    channel every other macro figure enters (the strip text is part of the
    grounding sourced set via overview_grounding._sourced_figure_set), so any
    figure it names is sourced and the grounding gate is not weakened.
    Returns '' when there is nothing honest to say."""
    if not surprise:
        return ""
    d = surprise.get("direction")
    if not d:
        return ""
    name = surprise.get("release_name") or "the release"
    bits = []
    act = surprise.get("actual")
    if act:
        bits.append("printed " + _fmt_val(act["value"], act.get("unit") or ""))
    exp_txt = format_expected(surprise.get("expected"))
    word = {"below": "BELOW", "above": "ABOVE", "inline": "IN LINE WITH"}[d]
    if exp_txt:
        bits.append(f"{word} a consensus of {exp_txt}")
    else:
        bits.append(f"{word} consensus (sources state the direction, not a figure)")
    return (
        f"SURPRISE (corpus-derived, deterministic): {name} came in "
        + ", ".join(bits)
        + f" [confidence {surprise.get('confidence')}, "
        + f"{sum((surprise.get('direction_votes') or {}).values())} sources]"
    )


def surprise_framing_clause(surprise):
    """The instruction appended to the pulse's MACRO FRAMING. Tells the model to
    describe the release AS A SURPRISE with its numbers. Never asserts a
    consensus figure that was not extracted."""
    line = format_surprise_strip_line(surprise)
    if not line:
        return ""
    d = surprise["direction"]
    name = surprise.get("release_name") or "the release"
    exp_txt = format_expected(surprise.get("expected"))
    act = surprise.get("actual")
    if d == "inline":
        core = (
            f"{name} landed IN LINE with consensus. Say so plainly. Do NOT call it "
            "a surprise, a shock, or a beat/miss."
        )
    else:
        word = "below" if d == "below" else "above"
        core = (
            f"{name} came in {word.upper()} expectations and THAT is the story, not "
            f"the level. Frame it as today's catalyst and say it came in {word} "
            "expectations"
        )
        if act and exp_txt:
            core += (
                f", naming both numbers ({_fmt_val(act['value'], act.get('unit') or '')} "
                f"actual vs {exp_txt} expected)."
            )
        elif act:
            core += f", naming the printed value ({_fmt_val(act['value'], act.get('unit') or '')})."
        else:
            core += " (no consensus figure is available, so state the direction only and DO NOT invent a number)."
    return (
        "MACRO SURPRISE (deterministic, extracted from today's corpus, NOT inferred "
        f"from the price move): {line}. {core} FORBIDDEN: calling this print "
        "'last week's', 'recent', or backdrop; it is TODAY'S. FORBIDDEN: the 'no "
        "fresh catalyst on the tape' clause - a release that surprised IS a fresh "
        "catalyst. Cite ONLY the figures given on this line; invent nothing."
    )


# ── RELEASE CONTEXT (supersedes the surprise-only gate) ──────────────────────
#
# THE DEFECT THIS FIXES. extract_macro_surprise returns None whenever the corpus
# carries no explicit comparator language ("total == 0 -> return None"). That made
# the whole macro-analysis path SURPRISE-GATED: on a release day where nobody wrote
# "below expectations", the pulse said nothing about the print at all, even though
# the release still happened and its value was already in hand from BLS.
#
# An in-line print is still the day's event. So the trigger is now the RELEASE, and
# the surprise is one optional field on it.
#
# WHERE EACH FIELD COMES FROM, which is also why this is grounded:
#   series, period, actual, prior   the macro_panel release rows, straight from the
#                                   BLS/BEA data layers. These are the SAME figures
#                                   the macro strip already renders, so they are
#                                   already in the pulse's sourced-figure set.
#   consensus, direction_vs_consensus, reactions
#                                   the corpus, and OPTIONAL. Absent stays absent.
#
# HONESTY. direction_vs_prior is arithmetic on two BLS numbers and is always safe.
# direction_vs_consensus comes ONLY from explicit comparator language, never from
# the price move (the #463 tautology). Missing fields are omitted, never guessed.


def _direction_vs_prior(actual, prior):
    """Pure arithmetic on two authoritative figures. Never a claim about
    expectations, so it is safe on a day with no consensus in the corpus."""
    if actual is None or prior is None:
        return None
    if actual > prior:
        return "higher"
    if actual < prior:
        return "lower"
    return "unchanged"


def build_release_context(articles, releases=None, fired_keys=None):
    """One context object per release that printed today. Returns a list, possibly
    empty. Never raises, never guesses a missing field.

    articles     the pool the corpus-side fields are read from. Feed the COVERAGE
                 pool, not the relevance-top spine: on 2026-08-07 every payrolls
                 article ranked 696 or worse of 1000 because 600 articles tied at
                 relevance_score 10, so the spine never saw the consensus.
    releases     macro_panel-style release rows (key, name, period, figures).
    fired_keys   detect_fired_releases output. When given, only those series are
                 built, which is what makes this a RELEASE-DAY object rather than a
                 restatement of the standing macro backdrop.
    """
    out = []
    for rel in (releases or []):
        if not isinstance(rel, dict):
            continue
        # Two row shapes reach here and both are supported rather than one being
        # silently dropped: macro_panel rows (key + figures[]) and
        # released_macro_context rows (name + flat value/prior/unit +
        # is_release_day). Resolve the key from whichever is present.
        key = rel.get("key")
        if not key:
            _nm = (rel.get("name") or "").strip().lower()
            key = next((k for k, (n, _r, _v) in RELEASE_KINDS.items()
                        if n.strip().lower() == _nm), None)
        if key not in RELEASE_KINDS:
            continue
        if fired_keys is not None:
            if key not in set(fired_keys):
                continue
        elif "is_release_day" in rel and not rel.get("is_release_day"):
            # No explicit fired list: fall back to the row's own authoritative
            # release-day flag so this stays a RELEASE-DAY object and never
            # restates the standing backdrop.
            continue
        name, _rx, value_kind = RELEASE_KINDS[key]

        figs = [f for f in (rel.get("figures") or []) if isinstance(f, dict)]
        head = next((f for f in figs if f.get("value") is not None), None)
        if head is None and rel.get("value") is not None:
            head = {"value": rel.get("value"), "prior": rel.get("prior"),
                    "unit": rel.get("unit") or "", "label": rel.get("name")}
            figs = [head]
        actual = head.get("value") if head else None
        prior = head.get("prior") if head else None
        unit = (head.get("unit") or "") if head else ""

        # BLS reports payrolls in thousands; the corpus-side extractor works in
        # jobs. Normalise so the two can be compared without a unit bug.
        a_cmp, p_cmp = actual, prior
        if value_kind == "jobs" and unit.upper() == "K":
            a_cmp = None if actual is None else actual * 1000.0
            p_cmp = None if prior is None else prior * 1000.0

        sur = None
        try:
            sur = extract_macro_surprise(articles, release_key=key)
        except Exception:
            sur = None

        # PROVENANCE. #566 verifies that "down" matches actual < prior. It cannot
        # verify that actual is the RIGHT number: if the panel said CPI printed -0.3%
        # when it printed -0.4%, every directional claim still passes and the brief is
        # confidently wrong. Traced on a real Aug 7 run, the sources are NOT uniform:
        #
        #   actual   BLS/BEA API via series_ids, AND on some days a second,
        #            independent value stated in article text. Two sources -> checkable.
        #   prior    BLS/BEA API only. SINGLE SOURCE, and the panel's own vintage_note
        #            warns it is BLS's current value for the preceding period and may
        #            itself have been revised.
        #   period   BLS/BEA period label only. SINGLE SOURCE for the value; the
        #            release DATE has a second authority in event_calendar, but a date
        #            is not a value.
        #
        # So a cross-check is possible for `actual` and only for `actual`. For the
        # rest the honest fix is provenance: record where the number came from so a
        # wrong value is traceable afterwards instead of invisible.
        _corpus_actual = (sur or {}).get("actual") or None
        _cv = (_corpus_actual or {}).get("value")
        if _cv is None or a_cmp is None:
            _xcheck = "single_source"
            _xdelta = None
        else:
            _tol = max(abs(a_cmp) * 0.02, 1e-9)
            _xdelta = _cv - a_cmp
            _xcheck = "agree" if abs(_xdelta) <= _tol else "disagree"
        provenance = {
            "actual_source": ("BLS/BEA series " + ",".join(rel.get("series_ids") or [])
                              if rel.get("series_ids") else "BLS/BEA panel"),
            "prior_source": "BLS/BEA panel (SINGLE SOURCE, revisable, see vintage_note)",
            "period_source": "BLS/BEA period label (SINGLE SOURCE)",
            "series_ids": rel.get("series_ids") or [],
            "panel_confidence": rel.get("confidence"),
            "vintage_note": rel.get("vintage_note"),
            "corpus_actual": _corpus_actual,
            "actual_cross_check": _xcheck,
            "actual_cross_check_delta": _xdelta,
        }

        ctx = {
            "release_key": key,
            "provenance": provenance,
            "release_name": rel.get("name") or name,
            "period": rel.get("period"),
            "actual": a_cmp,
            "actual_display": None if actual is None else f"{actual}{unit}",
            "prior": p_cmp,
            "prior_display": None if prior is None else f"{prior}{unit}",
            "unit": "jobs" if value_kind == "jobs" else (unit or "%"),
            "direction_vs_prior": _direction_vs_prior(a_cmp, p_cmp),
            "figures": figs,
            # OPTIONAL, corpus-derived. Absent when the corpus does not say it.
            "consensus": (sur or {}).get("expected"),
            "direction_vs_consensus": (sur or {}).get("direction"),
            "consensus_confidence": (sur or {}).get("confidence"),
            "reactions": (sur or {}).get("reactions") or [],
            "evidence": (sur or {}).get("evidence") or [],
        }
        out.append(ctx)
    return out


def cross_check_report(contexts):
    """One line per series: the two sources and the verdict. Deterministic."""
    out = []
    for c in contexts or []:
        p = c.get("provenance") or {}
        ca = (p.get("corpus_actual") or {}).get("value")
        out.append({
            "series": c.get("release_key"), "period": c.get("period"),
            "panel_actual": c.get("actual"), "corpus_actual": ca,
            "verdict": p.get("actual_cross_check"),
            "delta": p.get("actual_cross_check_delta"),
            "corpus_text": (p.get("corpus_actual") or {}).get("text"),
            "actual_source": p.get("actual_source"),
            "panel_confidence": p.get("panel_confidence"),
        })
    return out


def format_cross_check(r):
    tag = {"agree": "AGREE", "disagree": "DISAGREE  <<< FLAG",
           "single_source": "SINGLE SOURCE (no corpus value, not checkable)"}
    return (f"[macro-provenance] {r['series']} ({r['period']}): panel={r['panel_actual']} "
            f"corpus={r['corpus_actual']} -> {tag.get(r['verdict'], r['verdict'])}"
            + (f" delta={r['delta']}" if r.get("delta") is not None else "")
            + f" | src={r['actual_source']} conf={r['panel_confidence']}"
            + (f" | corpus said {r['corpus_text']!r}" if r.get("corpus_text") else ""))


def format_release_strip_line(ctx):
    """One deterministic strip line per release. Every figure here is either a BLS
    panel figure (already sourced) or a corpus-quoted consensus."""
    if not ctx:
        return ""
    fmt = _fmt_jobs if ctx.get("unit") == "jobs" else (lambda v: _fmt_val(v, ctx.get("unit") or "%"))
    bits = [f"RELEASED TODAY - {ctx['release_name']} ({ctx.get('period')})"]
    if ctx.get("actual") is not None:
        bits.append(f"printed {fmt(ctx['actual'])}")
    if ctx.get("prior") is not None:
        bits.append(f"prior {fmt(ctx['prior'])}")
    exp = ctx.get("consensus")
    if exp:
        bits.append(f"consensus {format_expected(exp)}"
                    f" [{ctx.get('consensus_confidence')}, {exp.get('n_sources')} source(s)]")
        if ctx.get("direction_vs_consensus"):
            bits.append(f"{ctx['direction_vs_consensus'].upper()} consensus")
    if ctx.get("reactions"):
        bits.append("observed reaction: " + "; ".join(ctx["reactions"][:2]))
    return ", ".join(bits)


def release_framing_clause(contexts):
    """The pulse's MACRO FRAMING for a release day. Three cases, all demonstrated
    in the PR: MISS / ABOVE, IN LINE, and NO CONSENSUS IN CORPUS."""
    contexts = [c for c in (contexts or []) if c]
    if not contexts:
        return ""
    lead = contexts[0]
    lines = [format_release_strip_line(c) for c in contexts if format_release_strip_line(c)]
    body = "\n".join(f"  {ln}" for ln in lines)

    d = lead.get("direction_vs_consensus")
    has_number = bool(lead.get("consensus"))
    if d in ("below", "above") and has_number:
        word = "BELOW" if d == "below" else "ABOVE"
        case = (
            f"{lead['release_name']} came in {word} expectations and THAT is the story, "
            f"not the level. Name BOTH numbers (the print and the consensus) and say it "
            f"{'missed' if d == 'below' else 'beat'}. If an observed market reaction is "
            f"listed above, you may state the print and the reaction together; do NOT "
            f"invent a causal claim that is not in that list."
        )
    elif d in ("below", "above"):
        # DIRECTION WITHOUT A NUMBER. Sources wrote "below expectations" but no
        # numeric consensus was extractable. Found by the #565 backtest: on
        # 2026-07-02 and 2026-07-14 the old wording said "Name BOTH numbers" with
        # only one number in hand, and the model duly wrote "missing the consensus"
        # and "below expectations" against a consensus that was never in the context.
        # That is the exact failure this design exists to prevent, so the direction
        # is now reported as SOURCED LANGUAGE and the figure is forbidden.
        word = "below" if d == "below" else "above"
        case = (
            f"Today's coverage describes {lead['release_name']} as coming in {word} "
            f"expectations, but NO numeric consensus is in the corpus. You may say that "
            f"reporting characterised the print as {word} expectations. You MUST NOT state "
            f"or imply any consensus FIGURE, and you MUST NOT write 'missed the consensus' "
            f"or 'beat the consensus' as if a number were known. The print and its move "
            f"versus the PRIOR are the only figures you have."
        )
    elif d == "inline":
        case = (
            f"{lead['release_name']} came in IN LINE with expectations. Say so plainly: "
            f"an in-line print is still today's event, and 'matched expectations, leaving "
            f"the path unchanged' is the analysis. Do NOT dramatise it into a surprise."
        )
    else:
        case = (
            f"NO CONSENSUS IS IN TODAY'S CORPUS for {lead['release_name']}. State the print "
            f"and its direction versus the PRIOR only. You MUST NOT say it beat, missed, "
            f"surprised, or matched expectations, and you MUST NOT infer any of that from "
            f"the equity move. If a market reaction is listed above, state it as a separate "
            f"observation, never as a consequence you are asserting."
        )

    return (
        "MACRO FRAMING (RELEASE DAY, deterministic, extracted from today's corpus and "
        "the BLS/BEA panel, NOT inferred from the price move):\n"
        f"{body}\n"
        f"{case} This release IS the day's catalyst; lead sentence one with it. "
        "FORBIDDEN: calling it 'last week's', 'recent', or backdrop; it is TODAY'S. "
        "FORBIDDEN: the 'no fresh catalyst on the tape' clause. Cite ONLY the figures "
        "given on the lines above; invent nothing."
    )
