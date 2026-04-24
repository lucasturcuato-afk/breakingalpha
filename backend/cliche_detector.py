"""
cliche_detector.py — post-generation regex-based cliche filter.

Implements Approach B per SPEC_approach_b_cliche_detector.md. Pure-regex
detector over the 10 banned constructions introduced by PR #127's LANGUAGE
CONSTRAINT block. No LLM calls in detection; an optional targeted Gemini
call is used only for the REJECT-then-STRIP policy on the highest-value
fields (lead_paragraph, supporting_context, what_to_watch,
market_pulse.narrative).

Hook point in synthesize.py: between filter_undisclosed_deals and the
structured-body derived summary — see spec §5.1.

Parallel hook in deal_extractor.py: after json.loads of the extracted
deal, STRIP the thesis field — see spec §5.3.

Observability: stdout log lines per field action (retry/strip/drop).
Default per spec §8 Q1 — no new jsonb column.
"""

from __future__ import annotations

import json
import re
from typing import Any

# ---------------------------------------------------------------------------
# Regex pattern inventory (spec §2)
#
# Each category maps 1:1 to a banned-construction bullet in PR #127's
# LANGUAGE CONSTRAINT block. Case-insensitive matching is enabled at
# finditer time. Word-boundary anchored to minimize false positives.
# ---------------------------------------------------------------------------

# Shared modifier-stack group: 0-3 whitespace-separated modifiers.
# Covers both stacked adjectives ("robust investor appetite", "continued
# strong investor confidence") and spec §2's simpler single-modifier cases.
# A token that is neither an article nor a cliche-noun and is shorter than
# ~15 chars counts as a modifier — bounded by max 3 to prevent runaway
# backtracking on long noun phrases.
_MODSTACK = r"(?:\w+(?:'s|s')?\s+){0,4}"

# Category 1 — "signals [vague trend]"
R_SIGNALS_VAGUE = [
    # "signals" + optional article + optional modifier stack + vague noun.
    # Modifier stack absorbs stacked adjectives like "robust investor",
    # "private equity's", "likely increased government defense".
    r"\bsignals?\b\s+(?:a\s+|an\s+|the\s+)?" + _MODSTACK + r"(?:appetite|interest|demand|confidence|headwinds?|trend|activity|momentum|leadership|growth|expansion|spending|advancements?|resilience|strength|conviction|deployment)\b",
    # "would/could/may/might signal <vague>"
    r"\b(?:would|could|may|might)\s+signals?\b\s+(?:a\s+|an\s+|the\s+)?" + _MODSTACK + r"(?:appetite|interest|demand|confidence|resilience|growth|trend|strength|activity|spending|expansion|leadership|momentum|conviction|headwinds?)\b",
    # "signaling <vague>"
    r"\bsignaling\b\s+(?:a\s+|an\s+|the\s+)?" + _MODSTACK + r"(?:appetite|interest|demand|confidence|headwinds?|trend|activity|momentum|leadership|growth|expansion|spending|advancements?|resilience|strength)\b",
]

# Category 2 — "underscores [vague importance]"
R_UNDERSCORES_VAGUE = [
    r"\bunderscores?\b\s+(?:a\s+|an\s+|the\s+)?" + _MODSTACK + r"(?:importance|interest|appetite|demand|conflict|commitment|shift|trend|momentum|confidence|resilience|need|imperative)\b",
    r"\bunderscoring\b\s+(?:a\s+|an\s+|the\s+)?" + _MODSTACK + r"(?:importance|interest|appetite|demand|conflict|commitment|shift|trend|momentum|confidence|resilience)\b",
]

# Category 3 — "highlights [vague trend]"
R_HIGHLIGHTS_VAGUE = [
    r"\bhighlights?\b\s+(?:a\s+|an\s+|the\s+)?" + _MODSTACK + r"(?:trend|risks?|appetite|importance|interest|demand|need|shift|momentum|concerns?)\b",
    r"\bhighlighting\b\s+(?:a\s+|an\s+|the\s+)?" + _MODSTACK + r"(?:trend|risks?|appetite|importance|interest|demand|need|shift|momentum|concerns?)\b",
]

# Category 4 — "reflects [vague continuation]"
R_REFLECTS_VAGUE = [
    r"\breflects?\b\s+(?:a\s+|an\s+|the\s+)?" + _MODSTACK + r"(?:appetite|interest|demand|confidence|conflict|trend|momentum|growth|expansion|resilience|strength|activity|commitment)\b",
    r"\breflecting\b\s+(?:a\s+|an\s+|the\s+)?" + _MODSTACK + r"(?:appetite|interest|demand|confidence|conflict|trend|momentum|growth|expansion|resilience)\b",
]

# Category 5 — "demonstrates [vague positive]"
R_DEMONSTRATES_VAGUE = [
    r"\bdemonstrates?\b\s+(?:a\s+|an\s+|the\s+)?" + _MODSTACK + r"(?:capital\s+deployment|fundamentals?|appetite|interest|demand|confidence|resilience|strength|commitment|growth|momentum|leadership)\b",
    r"\bdemonstrating\b\s+(?:a\s+|an\s+|the\s+)?" + _MODSTACK + r"(?:capital\s+deployment|fundamentals?|appetite|interest|demand|confidence|resilience|strength|commitment)\b",
]

# Category 6 — "indicates [vague positive]"
R_INDICATES_VAGUE = [
    r"\b(?:indicates?|indicating)\b\s+(?:a\s+|an\s+|the\s+)?" + _MODSTACK + r"(?:capital\s+activity|private\s+capital|appetite|interest|demand|confidence|resilience|strength|headwinds?|trend|momentum|activity|growth)\b",
    r"\b(?:would|could|may|might)\s+indicate\b\s+(?:a\s+|an\s+|the\s+)?" + _MODSTACK + r"(?:capital\s+activity|appetite|interest|demand|confidence|resilience|headwinds?|trend|momentum|growth)\b",
]

# Category 7 — "[X]'s strong/continued appetite for [Y]" (unquantified)
R_APPETITE_UNQUANTIFIED = [
    r"\b\w+(?:'s|s')\s+(?:strong|continued|sustained|growing|robust|increased)\s+appetite\s+for\b",
]

# Category 8 — "[X]'s continued/sustained [adj] [noun]" (unquantified)
R_CONTINUED_SUSTAINED_POSSESSIVE = [
    r"\b\w+(?:'s|s')\s+(?:continued|sustained)\s+\w+\s+(?:appetite|interest|demand|confidence|growth|expansion|activity|momentum|resilience|commitment|leadership)\b",
]

# Category 9 — Abstract sector-trend language
# Per spec §2: "Cannot be purely regex'd without prompting — flagged as
# soft/advisory." Intentionally not enumerated as a regex. Future work.
R_ABSTRACT_SECTOR: list[str] = []

# Category 10 — Temporal filler: "the ongoing/continued/sustained <noun>"
R_TEMPORAL_FILLER = [
    r"\bthe\s+(?:ongoing|continued|sustained)\s+\w+\b",
]

# Category 11 — Impact filler: "significant/substantial/major <cliche-adjacent noun>"
R_IMPACT_FILLER = [
    r"\b(?:significant|substantial|major)\s+(?:appetite|interest|demand|confidence|expansion|growth|headwinds?|trend|risks?|momentum|commitment|spending|shift|activity|impact)\b",
]

ALL_PATTERNS: dict[str, list[str]] = {
    "signals_vague":         R_SIGNALS_VAGUE,
    "underscores_vague":     R_UNDERSCORES_VAGUE,
    "highlights_vague":      R_HIGHLIGHTS_VAGUE,
    "reflects_vague":        R_REFLECTS_VAGUE,
    "demonstrates_vague":    R_DEMONSTRATES_VAGUE,
    "indicates_vague":       R_INDICATES_VAGUE,
    "appetite_unquantified": R_APPETITE_UNQUANTIFIED,
    "continued_sustained":   R_CONTINUED_SUSTAINED_POSSESSIVE,
    "temporal_filler":       R_TEMPORAL_FILLER,
    "impact_filler":         R_IMPACT_FILLER,
}

# Pre-compile patterns once. Case-insensitive everywhere.
_COMPILED: dict[str, list[re.Pattern[str]]] = {
    pid: [re.compile(p, re.IGNORECASE) for p in plist]
    for pid, plist in ALL_PATTERNS.items()
}


# ---------------------------------------------------------------------------
# Core detection
# ---------------------------------------------------------------------------

def detect_cliches(text: str) -> list[dict[str, Any]]:
    """
    Return a list of {pattern_id, span: (start, end), match_text} for every
    cliche hit in `text`. Case-insensitive. Pure regex — no LLM calls.
    """
    if not text or not isinstance(text, str):
        return []
    hits: list[dict[str, Any]] = []
    for pid, regexes in _COMPILED.items():
        for rx in regexes:
            for m in rx.finditer(text):
                hits.append({
                    "pattern_id": pid,
                    "span": (m.start(), m.end()),
                    "match_text": m.group(0),
                })
    return hits


# ---------------------------------------------------------------------------
# Sentence splitting — hand-rolled with abbrev guard (spec §7 point 4)
# ---------------------------------------------------------------------------

# Common abbreviations that end in a period but do NOT end a sentence.
# Matched case-sensitively (acronyms like U.S., Inc., Corp.) and lower-cased
# (e.g., "Mr.", "vs.") — we fold once in the splitter.
_ABBREVS = {
    "u.s.", "u.k.", "e.u.", "e.g.", "i.e.", "etc.", "vs.",
    "mr.", "mrs.", "ms.", "dr.", "st.", "jr.", "sr.",
    "inc.", "corp.", "ltd.", "co.", "llc.", "plc.",
    "no.", "ft.", "sq.",
}


def split_sentences(text: str) -> list[tuple[int, int, str]]:
    """
    Naive sentence splitter with abbreviation + decimal-number guards.
    Returns list of (start_offset, end_offset, sentence_text).

    Handles:
      - "U.S.", "Inc.", "Dr." (abbrev set below)
      - Decimal numbers like "$1.5B" or "3.2%" (period between digits)
      - Standard '.', '!', '?' followed by whitespace + capital letter.

    Good enough for analyst prose; nltk/spaCy would be overkill for one
    use site.
    """
    if not text:
        return []

    sentences: list[tuple[int, int, str]] = []
    n = len(text)
    start = 0
    i = 0
    while i < n:
        ch = text[i]
        if ch in ".!?":
            # Decimal-in-number guard: "3.5" — period between digits.
            if ch == "." and 0 < i < n - 1 and text[i - 1].isdigit() and text[i + 1].isdigit():
                i += 1
                continue
            # Abbrev guard: look at the last whitespace-delimited word including the period.
            if ch == ".":
                word_start = i
                while word_start > start and not text[word_start - 1].isspace():
                    word_start -= 1
                word = text[word_start:i + 1].lower()
                if word in _ABBREVS:
                    i += 1
                    continue
            # Advance past consecutive terminators like "..." or "?!".
            end = i + 1
            while end < n and text[end] in ".!?":
                end += 1
            # Must be followed by whitespace (or end of string) to count as a sentence break.
            if end >= n or text[end].isspace():
                sent = text[start:end].strip()
                if sent:
                    # Compute the trimmed start/end so callers can locate the sentence.
                    sent_start = start
                    while sent_start < end and text[sent_start].isspace():
                        sent_start += 1
                    sent_end = end
                    while sent_end > sent_start and text[sent_end - 1].isspace():
                        sent_end -= 1
                    sentences.append((sent_start, sent_end, text[sent_start:sent_end]))
                # Skip trailing whitespace to start the next sentence.
                start = end
                while start < n and text[start].isspace():
                    start += 1
                i = start
                continue
        i += 1

    # Trailing sentence with no terminator.
    if start < n:
        tail = text[start:].strip()
        if tail:
            sent_start = start
            while sent_start < n and text[sent_start].isspace():
                sent_start += 1
            sentences.append((sent_start, n, text[sent_start:n].rstrip()))

    return sentences


def strip_cliche_sentences(text: str) -> tuple[str, int]:
    """
    Sentence-level strip: drop any sentence that contains a cliche hit.
    Returns (new_text, n_stripped).

    Paragraph boundaries (single blank line) are preserved — we strip only
    offending sentences within each paragraph, and drop empty paragraphs
    after stripping.
    """
    if not text:
        return "", 0

    # Split on paragraph boundaries (two or more consecutive newlines).
    paragraphs = re.split(r"(\n\s*\n)", text)

    out_parts: list[str] = []
    total_stripped = 0
    for chunk in paragraphs:
        if re.fullmatch(r"\n\s*\n", chunk or ""):
            out_parts.append(chunk)
            continue
        sents = split_sentences(chunk)
        if not sents:
            continue
        kept: list[str] = []
        for _s, _e, sent_text in sents:
            if detect_cliches(sent_text):
                total_stripped += 1
                continue
            kept.append(sent_text)
        if kept:
            out_parts.append(" ".join(kept))

    # Reassemble and collapse any stray leading/trailing whitespace or
    # empty paragraph markers.
    new = "".join(out_parts).strip()
    new = re.sub(r"\n\s*\n\s*\n+", "\n\n", new)
    return new, total_stripped


# ---------------------------------------------------------------------------
# Targeted regen (REJECT policy) — single-field Gemini call.
# Imported lazily; synthesize.py already instantiates gemini_client.
# ---------------------------------------------------------------------------

def regenerate_field(
    gemini_generate_fn,
    system: str,
    user_content: str,
    field_name: str,
    offending_text: str,
    hits: list[dict[str, Any]],
    primary_story_id: str,
) -> str | None:
    """
    Targeted follow-up Gemini call asking the model to rewrite a SINGLE
    field. Returns the rewritten text (stripped) or None on failure.

    Uses the main brief's system prompt plus a short rewrite directive
    appended to the user message. Response is parsed as JSON with a single
    key ``rewrite`` to keep the surface area minimal.
    """
    try:
        first_hit = hits[0] if hits else {}
        match_text = first_hit.get("match_text", "")
        pattern_id = first_hit.get("pattern_id", "unknown")
        directive = (
            "\n\n--- CLICHE RETRY DIRECTIVE ---\n"
            f"Your previous output for field `{field_name}` violated the "
            f"LANGUAGE CONSTRAINT. Offending construction: \"{match_text}\" "
            f"(category: {pattern_id}). primary_story_id: \"{primary_story_id}\".\n"
            f"Previous text of `{field_name}`:\n{offending_text}\n\n"
            "Rewrite ONLY this field. Respond with strict JSON of the form "
            '{"rewrite": "..."}. No markdown, no code fences.\n'
            "Rules (enforced):\n"
            "- Quote a specific number (deal value, market cap, multiple, "
            "growth rate, percentage, basis points) OR name a comparable "
            "transaction or peer company by name OR state a specific "
            "forward-looking implication with a measurable target.\n"
            "- If you cannot state a concrete claim, write a SHORTER "
            "bare-fact sentence or return an empty rewrite.\n"
            "- No 'signals/underscores/highlights/reflects/demonstrates/"
            "indicates <vague>' constructions. No 'the ongoing/continued/"
            "sustained <noun>' temporal filler. No 'significant/substantial/"
            "major' without a number.\n"
        )
        raw = gemini_generate_fn(system, user_content + directive)
        if not raw:
            return None
        # Strip optional code fences, same pattern as synthesize.py.
        raw = re.sub(r"^```json|^```|```$", "", raw, flags=re.MULTILINE).strip()
        try:
            obj = json.loads(raw)
        except Exception:
            m = re.search(r"\{.*\}", raw, re.DOTALL)
            if not m:
                return None
            try:
                obj = json.loads(m.group(0))
            except Exception:
                return None
        rewrite = obj.get("rewrite")
        if not isinstance(rewrite, str):
            return None
        return rewrite.strip() or None
    except Exception as e:
        print(f"  ⚠ cliche regen failed for {field_name}: {e}")
        return None


# ---------------------------------------------------------------------------
# Dotted-path helpers for the data dict.
# ---------------------------------------------------------------------------

def _get(data: dict, path: list[str]) -> Any:
    cur: Any = data
    for key in path:
        if not isinstance(cur, dict):
            return None
        cur = cur.get(key)
    return cur


def _set(data: dict, path: list[str], value: Any) -> None:
    cur: Any = data
    for key in path[:-1]:
        if not isinstance(cur.get(key), dict):
            cur[key] = {}
        cur = cur[key]
    cur[path[-1]] = value


def _unset(data: dict, path: list[str]) -> None:
    cur: Any = data
    for key in path[:-1]:
        if not isinstance(cur, dict) or key not in cur:
            return
        cur = cur[key]
    if isinstance(cur, dict):
        cur.pop(path[-1], None)


# ---------------------------------------------------------------------------
# Per-brief orchestrator — applied at the hook point in synthesize.py.
# ---------------------------------------------------------------------------

# Fields to scan, with policy. Order matters only for retry budgeting.
# See spec §4 for per-field-type policy table.
_REJECT_THEN_STRIP = "reject-then-strip"
_STRIP = "strip"

FIELD_POLICIES: list[tuple[list[str], str]] = [
    (["lead_paragraph"],              _REJECT_THEN_STRIP),
    (["supporting_context"],          _REJECT_THEN_STRIP),
    (["what_to_watch"],               _REJECT_THEN_STRIP),
    (["market_pulse", "narrative"],   _REJECT_THEN_STRIP),
    (["sections", "deals_and_ma"],    _STRIP),
    (["sections", "public_markets"],  _STRIP),
    (["sections", "macro_and_rates"], _STRIP),
    (["sections", "geopolitics"],     _STRIP),
    (["sections", "sector_spotlight"], _STRIP),
    (["sections", "what_to_watch"],   _STRIP),   # morning-only
    (["sections", "tomorrow_setup"],  _STRIP),   # evening-only
]

# Retry budget per brief (spec §8 Q3 default).
CLICHE_RETRY_BUDGET = 2
# Minimum lengths to retain stripped text (spec §4).
_MIN_SECTION_LEN = 20
_MIN_SECTOR_NARRATIVE_LEN = 20
_MIN_ONE_LINER_LEN = 15
_MIN_MARKET_PULSE_TITLE_LEN = 5
_MIN_DEAL_THESIS_LEN = 10


def apply_cliche_filter(
    data: dict,
    *,
    brief_type: str,
    system: str,
    user_content: str,
    gemini_generate_fn=None,
) -> dict:
    """
    Apply the per-field cliche filter to an already-parsed Gemini brief
    payload in-place and return summary stats.

    Parameters
    ----------
    data : dict             — the parsed Gemini JSON payload.
    brief_type : str        — 'morning' | 'evening' (for logging only).
    system : str            — system prompt used for the main call (passed
                              through to regenerate_field).
    user_content : str      — user content used for the main call.
    gemini_generate_fn      — callable(system, user_content) -> str. If
                              None, REJECT policy is downgraded to STRIP
                              (the detector still runs; just no retries).
    """
    if not isinstance(data, dict):
        return {"retries_used": 0, "fields_stripped": 0, "fields_dropped": 0}

    retries_used = 0
    fields_stripped = 0
    fields_dropped = 0
    primary_story_id = (data.get("primary_story_id") or "").strip() if isinstance(data.get("primary_story_id"), str) else ""

    def _log(action: str, path: str, pattern_id: str | None, match: str | None) -> None:
        payload = {
            "brief_type": brief_type,
            "field": path,
            "action": action,
            "pattern_id": pattern_id,
            "match": (match[:120] if isinstance(match, str) else None),
        }
        print(f"  🎯 [cliche] {json.dumps(payload, ensure_ascii=False)}")

    # ---- Top-level / sections fields -----------------------------------------
    for path, policy in FIELD_POLICIES:
        text = _get(data, path)
        if not isinstance(text, str) or not text.strip():
            continue
        hits = detect_cliches(text)
        if not hits:
            continue

        path_str = ".".join(path)
        first = hits[0]
        _log("detected", path_str, first.get("pattern_id"), first.get("match_text"))

        regen_ok = False
        if (
            policy == _REJECT_THEN_STRIP
            and gemini_generate_fn is not None
            and retries_used < CLICHE_RETRY_BUDGET
        ):
            retries_used += 1
            _log("retry", path_str, first.get("pattern_id"), first.get("match_text"))
            new_text = regenerate_field(
                gemini_generate_fn, system, user_content,
                path_str, text, hits, primary_story_id,
            )
            if new_text and not detect_cliches(new_text):
                _set(data, path, new_text)
                regen_ok = True
                _log("retry_ok", path_str, None, None)
        if regen_ok:
            continue

        # STRIP fallback.
        stripped, n = strip_cliche_sentences(text)
        if stripped and not detect_cliches(stripped) and len(stripped) >= _MIN_SECTION_LEN:
            _set(data, path, stripped)
            fields_stripped += 1
            _log("strip", path_str, first.get("pattern_id"), first.get("match_text"))
        else:
            _unset(data, path)
            fields_dropped += 1
            _log("drop", path_str, first.get("pattern_id"), first.get("match_text"))

    # ---- sector_breakdown dynamic keys ---------------------------------------
    sector_breakdown = data.get("sector_breakdown")
    if isinstance(sector_breakdown, dict):
        for sector_key in list(sector_breakdown.keys()):
            narrative = sector_breakdown.get(sector_key)
            if not isinstance(narrative, str) or not narrative.strip():
                continue
            hits = detect_cliches(narrative)
            if not hits:
                continue
            path_str = f"sector_breakdown.{sector_key}"
            first = hits[0]
            _log("detected", path_str, first.get("pattern_id"), first.get("match_text"))
            stripped, _n = strip_cliche_sentences(narrative)
            if (
                not stripped
                or detect_cliches(stripped)
                or len(stripped) < _MIN_SECTOR_NARRATIVE_LEN
            ):
                del sector_breakdown[sector_key]
                fields_dropped += 1
                _log("drop", path_str, first.get("pattern_id"), first.get("match_text"))
            else:
                sector_breakdown[sector_key] = stripped
                fields_stripped += 1
                _log("strip", path_str, first.get("pattern_id"), first.get("match_text"))

    # ---- top_deals[].one_liner ----------------------------------------------
    top_deals = data.get("top_deals")
    if isinstance(top_deals, list):
        for idx, deal in enumerate(top_deals):
            if not isinstance(deal, dict):
                continue
            ol = deal.get("one_liner")
            if not isinstance(ol, str) or not ol.strip():
                continue
            # See-lead clamp already applied upstream — exempt it explicitly.
            if ol.strip().lower().startswith("see lead"):
                continue
            hits = detect_cliches(ol)
            if not hits:
                continue
            path_str = f"top_deals[{idx}].one_liner"
            first = hits[0]
            _log("detected", path_str, first.get("pattern_id"), first.get("match_text"))
            stripped, _n = strip_cliche_sentences(ol)
            if (
                not stripped
                or detect_cliches(stripped)
                or len(stripped) < _MIN_ONE_LINER_LEN
            ):
                deal["one_liner"] = ""
                fields_dropped += 1
                _log("drop", path_str, first.get("pattern_id"), first.get("match_text"))
            else:
                deal["one_liner"] = stripped
                fields_stripped += 1
                _log("strip", path_str, first.get("pattern_id"), first.get("match_text"))

    # ---- market_pulse.headlines[].title (spec §8 Q2 default: yes, scan) ------
    market_pulse = data.get("market_pulse")
    if isinstance(market_pulse, dict):
        headlines = market_pulse.get("headlines")
        if isinstance(headlines, list):
            kept_headlines: list[Any] = []
            for idx, chip in enumerate(headlines):
                if not isinstance(chip, dict):
                    kept_headlines.append(chip)
                    continue
                title = chip.get("title")
                if not isinstance(title, str) or not title.strip():
                    kept_headlines.append(chip)
                    continue
                hits = detect_cliches(title)
                if not hits:
                    kept_headlines.append(chip)
                    continue
                path_str = f"market_pulse.headlines[{idx}].title"
                first = hits[0]
                _log("detected", path_str, first.get("pattern_id"), first.get("match_text"))
                stripped, _n = strip_cliche_sentences(title)
                if (
                    not stripped
                    or detect_cliches(stripped)
                    or len(stripped) < _MIN_MARKET_PULSE_TITLE_LEN
                ):
                    # Drop the chip entirely if the strip would empty the title.
                    fields_dropped += 1
                    _log("drop", path_str, first.get("pattern_id"), first.get("match_text"))
                    continue
                chip["title"] = stripped
                kept_headlines.append(chip)
                fields_stripped += 1
                _log("strip", path_str, first.get("pattern_id"), first.get("match_text"))
            market_pulse["headlines"] = kept_headlines

    return {
        "retries_used": retries_used,
        "fields_stripped": fields_stripped,
        "fields_dropped": fields_dropped,
    }


def filter_deal_thesis(thesis: str | None) -> str | None:
    """
    STRIP policy for deal_extractor.py `thesis` field (spec §5.3).

    Returns the cleaned thesis or None if the result would be shorter than
    _MIN_DEAL_THESIS_LEN characters. Safe to call with None.
    """
    if not isinstance(thesis, str) or not thesis.strip():
        return thesis if isinstance(thesis, str) else None
    hits = detect_cliches(thesis)
    if not hits:
        return thesis
    stripped, _n = strip_cliche_sentences(thesis)
    if not stripped or detect_cliches(stripped) or len(stripped) < _MIN_DEAL_THESIS_LEN:
        print(
            f"  🎯 [cliche] deal_thesis dropped — pattern={hits[0].get('pattern_id')} "
            f"match={hits[0].get('match_text', '')[:80]!r}"
        )
        return None
    print(
        f"  🎯 [cliche] deal_thesis stripped — pattern={hits[0].get('pattern_id')} "
        f"match={hits[0].get('match_text', '')[:80]!r}"
    )
    return stripped
