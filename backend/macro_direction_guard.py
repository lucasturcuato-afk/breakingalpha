"""Deterministic directional guard for macro-release prose. No LLM, pure, offline.

WHY THIS EXISTS. During #565's backtest a live render said unemployment "ticked up
to +4.2% from +4.3%". That is backwards. The release context was CORRECT; the model
inverted the direction. It was caught by a re-render, not by any guard, and nothing
structurally prevented the next inversion. A reversed labor-market direction is
instantly disqualifying to an IB or PE reader.

Every number needed to check the claim is already in the release context, so this
needs no model and no network.

TWO SEPARATE COMPARISONS, deliberately not collapsed into one:

  VS PRIOR       actual vs prior, both authoritative BLS/BEA figures. Always
                 checkable. Compared NUMERICALLY, never inferred from wording, so
                 payrolls going +20K -> -23K is DOWN even though 23 > 20, and
                 unemployment 4.3 -> 4.2 is DOWN even though the prose may frame a
                 falling jobless rate as good news.

  VS CONSENSUS   only checkable when a consensus VALUE is in the context. On 11 of
                 12 prints in the stored window consensus is ABSENT, so a
                 consensus-direction claim on those days is UNVERIFIABLE and is
                 itself a violation. #565 split the prompt branch so
                 direction-without-a-number cannot name a figure; this enforces it
                 at the OUTPUT instead of trusting the prompt.

SCOPE. A clause is only examined when it names a macro release series, using the
same RELEASE_KINDS name regexes the extractor uses. Tape language (indices,
sectors, yields, oil, VIX) never matches a series name, so "Energy ETFs are
lagging" and "the 10-year yield is down 4 basis points" are out of scope by
construction, not by a blocklist. Verified by the zero-false-positive run over all
eight known-good renders.

ON VIOLATION the caller strips or re-asks the offending CLAUSE only. Never reject
the whole narrative: falling to minimal_template over one bad clause is the
regression #491's strip-or-repair pattern exists to prevent.
"""

import re

from macro_surprise import RELEASE_KINDS

# Directional assertions. Longest-first within each set so "ticked up" wins over
# "up" and the recorded match is the real phrase, which matters for the log.
_UP = (
    "ticked up", "edged up", "moved up", "rose", "climbed", "increased", "jumped",
    "surged", "accelerated", "higher", "hotter", "firmer", "gained", "up",
)
_DOWN = (
    "ticked down", "edged down", "moved down", "fell", "declined", "dropped",
    "decreased", "slowed", "cooled", "eased", "softened", "lower", "softer",
    "cooler", "weaker", "down", "contracted", "shrank",
)
_FLAT = (
    "in line with", "matching", "matched", "unchanged", "flat", "steady",
    "held at", "in line",
)


def _rx(words):
    return re.compile(r"\b(" + "|".join(re.escape(w) for w in
                                        sorted(words, key=len, reverse=True)) + r")\b", re.I)


_UP_RX, _DOWN_RX, _FLAT_RX = _rx(_UP), _rx(_DOWN), _rx(_FLAT)

# Markers that make a claim a CONSENSUS claim rather than a prior claim.
_CONSENSUS_RX = re.compile(
    r"\b(consensus|expectation|expectations|expected|forecast|forecasts|estimate|"
    r"estimates|missed|misses|beat|beats|surprise|surprised)\b", re.I)


# Sentence boundary: punctuation, whitespace, then a capital. A bare "." split
# breaks "+4.2%" into "+4" and "2%", which produced a mangled repair on the first
# run of this guard. Decimals must survive.
_SENT_RX = re.compile(r"(?<=[.!?])\s+(?=[A-Z\"'(])")


def _sentences(text):
    out, pos = [], 0
    for piece in _SENT_RX.split(text or ""):
        i = (text or "").find(piece, pos)
        if i < 0:
            i = pos
        out.append((piece, i))
        pos = i + len(piece)
    return out


def _clauses_of(sent, base):
    out, pos = [], 0
    for part in re.split(r"(,\s+|\s+while\s+|\s+whereas\s+|\s+although\s+|;\s+)", sent):
        if part and not re.fullmatch(r"(,\s+|\s+while\s+|\s+whereas\s+|\s+although\s+|;\s+)", part):
            i = sent.find(part, pos)
            if i >= 0:
                out.append((part, base + i, base + i + len(part)))
                pos = i + len(part)
    return out


def _clauses(text):
    """Sentence, then comma / conjunction split. Returns (clause, start, end)."""
    out = []
    _pos = 0
    _sents = []
    for _piece in _SENT_RX.split(text or ""):
        _i = (text or "").find(_piece, _pos)
        if _i < 0:
            _i = _pos
        _sents.append((_piece, _i))
        _pos = _i + len(_piece)
    for sent, base in _sents:
        pos = 0
        for part in re.split(r"(,\s+|\s+while\s+|\s+whereas\s+|\s+although\s+|;\s+)", sent):
            if part and not re.fullmatch(r"(,\s+|\s+while\s+|\s+whereas\s+|\s+although\s+|;\s+)", part):
                s = sent.find(part, pos)
                if s >= 0:
                    out.append((part, base + s, base + s + len(part)))
                    pos = s + len(part)
    return out


def _expected_dir(actual, other):
    if actual is None or other is None:
        return None
    if actual > other:
        return "up"
    if actual < other:
        return "down"
    return "flat"


_ATTRIB_WINDOW = 60   # chars: how close a direction word must sit to its subject

# COMPETING SUBJECTS. "US stocks opened higher as July payrolls printed -23K" has two
# subjects in one clause, and "higher" belongs to stocks. Proximity alone is not
# enough: on the first false-positive run this misattributed the equity move to the
# release on three of eight known-good renders. A direction word is only the
# SERIES' claim when the series is the NEAREST subject to it.
_OTHER_SUBJECT_RX = re.compile(
    r"\b(stocks?|equities|shares?|futures|index|indices|S&P ?500|Nasdaq|Dow|Russell|"
    r"ETFs?|sector|sectors|yield|yields|treasury|crude|oil|WTI|VIX|volatility|"
    r"dollar|gold|bitcoin|market|markets)\b", re.I)

# QUANTIFIED MISS. Rule 2 exists to stop the prose asserting a consensus FIGURE or a
# verifiable-sounding miss when no number is in the context. Bare "came in below
# expectations" is SOURCED language: #565 permits it explicitly and the extractor
# read "below" out of a real article. What must never ship is a consensus number, or
# a quantified miss/beat that implies one.
_QUANT_MISS_RX = re.compile(
    r"\b(missed?|misses|missing|beat|beats|topped|exceeded|shy of|short of|"
    r"undershot|overshot)\b", re.I)
_CONSENSUS_FIGURE_RX = re.compile(
    r"(consensus|expectation|expectations|forecast|estimate)s?\s+(of|at|near|around)?\s*"
    r"[+\-]?\$?\d", re.I)


def _claimed_dir(clause, anchor):
    """The directional assertion ABOUT the series, or None.

    POSITION-AWARE, because a clause can carry two subjects. On the first run of
    this guard "US stocks opened higher after June nonfarm payrolls printed well
    below expectations" reported the claim as 'higher', which belongs to stocks, not
    to payrolls. The direction word is now chosen by proximity to `anchor`, the
    offset of the series mention, and must sit within _ATTRIB_WINDOW of it.
    """
    cands = []
    for rx, d in ((_FLAT_RX, "flat"), (_DOWN_RX, "down"), (_UP_RX, "up")):
        for m in rx.finditer(clause):
            mid = (m.start() + m.end()) // 2
            cands.append((abs(mid - anchor), m.start(), d, m.group(0)))
    cands = [c for c in cands if c[0] <= _ATTRIB_WINDOW]
    # Drop any candidate whose nearest subject is something other than this series.
    kept = []
    for dist, cstart, d, phrase in cands:
        mid = cstart + len(phrase) // 2
        rival = min((abs(((m.start() + m.end()) // 2) - mid)
                     for m in _OTHER_SUBJECT_RX.finditer(clause)), default=None)
        if rival is not None and rival < dist:
            continue
        kept.append((dist, cstart, d, phrase))
    cands = kept
    if not cands:
        return None
    # Nearest wins; FLAT breaks a tie because "in line with expectations" contains
    # no up/down word and must not be shadowed by an incidental one.
    cands.sort(key=lambda c: (c[0], 0 if c[2] == "flat" else 1))
    return cands[0][2], cands[0][3]


def check(narrative, release_ctx):
    """Return a list of violation dicts. Empty means clean. Never raises."""
    violations = []
    if not narrative or not release_ctx:
        return violations
    for clause, start, end in _clauses(narrative):
        for ctx in release_ctx:
            key = ctx.get("release_key")
            spec = RELEASE_KINDS.get(key)
            if not spec or not spec[1].search(clause):
                continue
            _sm = spec[1].search(clause)
            _anchor = (_sm.start() + _sm.end()) // 2
            claimed = _claimed_dir(clause, _anchor)
            if not claimed:
                continue
            cdir, phrase = claimed
            # A consensus claim only when a consensus marker sits near the direction
            # word, not merely somewhere in the clause.
            _pi = clause.lower().find(phrase.lower())
            is_consensus = any(
                abs(((m.start() + m.end()) // 2) - _pi) <= _ATTRIB_WINDOW
                for m in _CONSENSUS_RX.finditer(clause)
            )
            if is_consensus:
                cons = ctx.get("consensus") or {}
                cval = cons.get("modal")
                if cval is None:
                    # Bare direction-versus-expectations with no figure is sourced
                    # language and is allowed (#565). Only a stated consensus FIGURE
                    # or a quantified miss/beat is a violation.
                    if not (_QUANT_MISS_RX.search(clause)
                            or _CONSENSUS_FIGURE_RX.search(clause)):
                        continue
                    violations.append({
                        "kind": "consensus_unverifiable", "series": key,
                        "period": ctx.get("period"), "clause": clause.strip(),
                        "claim": phrase, "claimed_dir": cdir,
                        "actual": ctx.get("actual"), "prior": ctx.get("prior"),
                        "consensus": None,
                        "why": ("claims a direction versus consensus but NO consensus value "
                                "is in the release context, so the claim is unverifiable"),
                        "span": [start, end],
                    })
                    continue
                want = _expected_dir(ctx.get("actual"), cval)
                if want and cdir != want:
                    violations.append({
                        "kind": "consensus_inverted", "series": key,
                        "period": ctx.get("period"), "clause": clause.strip(),
                        "claim": phrase, "claimed_dir": cdir, "expected_dir": want,
                        "actual": ctx.get("actual"), "consensus": cval,
                        "why": f"actual {ctx.get('actual')} vs consensus {cval} is {want}",
                        "span": [start, end],
                    })
                continue
            want = _expected_dir(ctx.get("actual"), ctx.get("prior"))
            if want and cdir != want:  # noqa: E129
                violations.append({
                    "kind": "prior_inverted", "series": key,
                    "period": ctx.get("period"), "clause": clause.strip(),
                    "claim": phrase, "claimed_dir": cdir, "expected_dir": want,
                    "actual": ctx.get("actual"), "prior": ctx.get("prior"),
                    "why": f"actual {ctx.get('actual')} vs prior {ctx.get('prior')} is {want}",
                    "span": [start, end],
                })
    # SENTENCE SCOPE for consensus claims. A quantified miss or a stated consensus
    # figure often lives in a clause that does not itself name the series, e.g.
    # "payrolls at +57K for June, which missed expectations of +80K". The clause loop
    # above cannot see it, and on the first run that let criterion 4 through. So the
    # series is resolved at SENTENCE scope while the repair span stays the offending
    # CLAUSE, keeping the strip surgical.
    for sent, sbase in _sentences(narrative):
        for ctx in release_ctx:
            spec = RELEASE_KINDS.get(ctx.get("release_key"))
            if not spec or not spec[1].search(sent):
                continue
            if (ctx.get("consensus") or {}).get("modal") is not None:
                continue
            for cl, cs, ce in _clauses_of(sent, sbase):
                m = _QUANT_MISS_RX.search(cl) or _CONSENSUS_FIGURE_RX.search(cl)
                if not m:
                    continue
                if any(v["span"] == [cs, ce] and v["series"] == ctx["release_key"]
                       for v in violations):
                    continue
                violations.append({
                    "kind": "consensus_unverifiable", "series": ctx["release_key"],
                    "period": ctx.get("period"), "clause": cl.strip(),
                    "claim": m.group(0), "claimed_dir": "vs-consensus",
                    "actual": ctx.get("actual"), "prior": ctx.get("prior"),
                    "consensus": None,
                    "why": ("asserts a quantified miss or a consensus figure but NO "
                            "consensus value is in the release context"),
                    "span": [cs, ce],
                })
    return violations


def format_violation(v):
    return (f"[macro-direction] {v['kind']} {v['series']} ({v.get('period')}): "
            f"claimed {v['claimed_dir']!r} via {v['claim']!r}"
            + (f", numbers say {v['expected_dir']!r}" if v.get("expected_dir") else "")
            + f" | actual={v.get('actual')} prior={v.get('prior')} "
              f"consensus={v.get('consensus')} | clause={v['clause'][:110]!r}")


# Tokens that must NEVER be title-cased when they land at the start of a sentence.
# A ticker, an all-caps series name and a figure are already correctly cased, and
# "capitalising" them corrupts the text (Cpi, Gdp, Wti, +0.4%).
_NO_TOUCH_RX = re.compile(r"^(?:[A-Z0-9&./$+\-]{2,}|[$+\-]?[\d(].*)")

# Orphaned conjunctions. After a clause strip the remainder can begin with the
# connective that used to join it to the removed clause: "and the unemployment rate
# ticked down", "while the VIX...". Leading them is not prose.
_ORPHAN_RX = re.compile(
    r"^(?:and|but|while|whereas|although|though|as|with|which|also|then)\b[\s,]*", re.I)


def _tidy(text):
    """Repair-artifact cleanup. Deterministic, order matters.

    Every rule here fixes an artifact observed in #566's acceptance run, not a
    hypothetical one. The observed set was: a lowercase fragment after a sentence
    boundary ("in early trade. and the unemployment"), a comma left touching a
    period, doubled spaces, and a leading comma on the remainder."""
    t = text or ""
    t = re.sub(r"\s{2,}", " ", t)                    # doubled spaces
    t = re.sub(r"\s+([.,;:])", r"\1", t)             # space before punctuation
    t = re.sub(r",\s*([.!?])", r"\1", t)             # trailing comma before a period
    t = re.sub(r"([.!?])\s*,", r"\1", t)             # period immediately followed by a comma
    t = re.sub(r"([.!?])\s*\1+", r"\1", t)           # doubled terminators
    t = re.sub(r"([,;:])\s*\1+", r"\1", t)           # doubled commas / semicolons
    t = re.sub(r"(?m)^[\s,;:]+", "", t)              # leading punctuation on the whole text
    t = re.sub(r"\(\s*\)", "", t)                    # empty parens left by a strip

    # Sentence-start pass: drop an orphaned conjunction, then capitalise, skipping
    # tokens that are already correctly cased.
    parts = re.split(r"(?<=[.!?])(\s+)", t)
    rebuilt = []
    for i, seg in enumerate(parts):
        if i % 2 == 1:            # the whitespace separator itself
            rebuilt.append(seg)
            continue
        seg2 = _ORPHAN_RX.sub("", seg, count=1) if seg else seg
        # Refuse the orphan strip if it would leave nothing meaningful.
        if seg and not seg2.strip():
            seg2 = seg
        if seg2 and not _NO_TOUCH_RX.match(seg2):
            seg2 = seg2[0].upper() + seg2[1:]
        rebuilt.append(seg2)
    t = "".join(rebuilt)
    t = re.sub(r"\s{2,}", " ", t)
    # Terminal punctuation. Stripping a trailing clause takes the sentence's own
    # period with it, observed on #566 criterion 3b which ended "from a prior +129K".
    t = t.rstrip()
    if t and t[-1] not in ".!?":
        t = t.rstrip(",;: ") + "."
    return t


def strip_violations(narrative, violations):
    """CLAUSE-LEVEL removal, the #491 pattern. The rest of the narrative is left
    byte-identical. Returns (new_narrative, n_stripped). Never returns empty: if
    every clause would go, the original is kept and the caller keeps the original
    rather than shipping nothing."""
    if not violations:
        return narrative, 0
    spans = sorted({tuple(v["span"]) for v in violations}, reverse=True)
    out = narrative
    for s, e in spans:
        # Absorb the delimiter that introduced the clause so removing it does not
        # leave "+129K., reinforcing". Look back over a comma / conjunction.
        m = re.search(r"(,\s+|\s+while\s+|\s+whereas\s+|\s+although\s+|;\s+)$", out[:s])
        if m:
            s2, e2 = m.start(), e
        else:
            # Sentence-initial clause: absorb the delimiter that FOLLOWS it instead,
            # so removing it does not leave "in early trade., and the ...".
            f = re.match(r"(,\s+|\s+while\s+|\s+whereas\s+|\s+although\s+|;\s+)", out[e:])
            s2, e2 = s, e + (f.end() if f else 0)
        out = out[:s2] + out[e2:]
    out = _tidy(out)
    # Only refuse the strip when it leaves essentially nothing. The earlier 80-char
    # floor silently swallowed a legitimate repair (criterion 3c left a valid 63-char
    # sentence), which is exactly the "guard that half works" failure mode.
    if not out.strip() or len(out.strip()) < 25:
        return narrative, 0
    return out.strip(), len(spans)
