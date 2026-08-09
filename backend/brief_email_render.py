"""
brief_email_render.py - pure rendering for the daily Morning Brief email.

No IO, no env reads, no network, no model calls. Everything here is a pure
function of its arguments so the whole email body is testable offline.

SECTION ORDER is fixed and load-bearing:
  1. Market pulse, broken into labelled blocks (the tape, macro backdrop,
     sector leadership, single names, looking ahead) rather than one wall of
     prose. Every sentence of the model's pulse survives; only the grouping is
     ours. Stamped with the generation time and framed as pre-open so a reader
     opening it at noon never reads it as live.
  2. How the last session's calls resolved. This is the reason the email
     exists and the reason it is unlike any other newsletter, so it sits above
     the lead rather than below the fold. Challenged calls and no-clean-reads
     render exactly like supported ones. The block is OMITTED entirely when
     nothing resolved; it is never padded.
  3. The lead: headline plus lead paragraph.
  4. Today's calls, each with its resolution horizon and a per-call deep link
     into the site where the call can be adopted.
  5. Today's stories, three to five headlines.
  6. Footer: working unsubscribe link plus the disclaimer.

SUBJECT is an editorial headline about the day, derived from the lead: no
product-name prefix, no counts, no timestamps. See subject_line().

VOCABULARY. Verdict words come from verdict_vocabulary.py, which mirrors
src/lib/verdict-vocabulary.ts. This module used to keep a private table of its
own and went on using the retired words for months after #543 removed them
everywhere else. There is no local copy left to drift.

COMPLIANCE. Everything in sections 1 to 5 originates from model-written brief
copy, so it cannot be trusted to stay inside our compliance vocabulary. Every
model-authored string passes through scrub_compliance() before it reaches the
body. That is a vocabulary swap, not a rewrite: the claim survives, the banned
word does not. BANNED_TERMS is the same list the render test asserts against,
so the guard and the test can never drift apart.

MOBILE FIRST. Single column throughout, no fixed-width tables, body copy at
16px, and every tap target at least 44px tall. Most readers are students on a
phone.
"""

from __future__ import annotations

import html as _html
import re
from dataclasses import dataclass, field

try:  # pragma: no cover - import shim, mirrors backend/brief_email_send.py
    from verdict_vocabulary import verdict_word
except ImportError:  # pragma: no cover
    from backend.verdict_vocabulary import verdict_word

# ---------------------------------------------------------------------------
# Compliance vocabulary
# ---------------------------------------------------------------------------

#: Terms that must never appear in a rendered body. Single words are matched on
#: word boundaries (so "holdings", "buyback", "seller", "threshold" are fine);
#: multi-word entries are matched as phrases. This list IS the test assertion.
BANNED_TERMS: tuple[str, ...] = (
    "buy",
    "sell",
    "hold",
    "allocate",
    "your portfolio",
    "your returns",
    "performance",
    "gains",
)

#: Neutral, readable substitutions. Phrases are applied before single words so a
#: phrase match is never broken up by a word-level swap first.
_PHRASE_SWAPS: tuple[tuple[str, str], ...] = (
    ("your portfolio", "a portfolio"),
    ("your returns", "those outcomes"),
)

_WORD_SWAPS: tuple[tuple[str, str], ...] = (
    ("buying", "purchasing"),
    ("buys", "purchases"),
    ("buy", "purchase"),
    ("selling", "offloading"),
    ("sells", "offloads"),
    ("sell", "offload"),
    ("holds", "retains"),
    ("hold", "retain"),
    ("allocates", "deploys"),
    ("allocating", "deploying"),
    ("allocate", "deploy"),
    ("performances", "results"),
    ("performance", "results"),
    ("gains", "advances"),
)


def _match_case(source: str, replacement: str) -> str:
    """Carry the source token's casing onto the replacement.

    Only the two cases that occur in prose are handled: ALL CAPS and
    Capitalized. Anything else returns the replacement unchanged.
    """
    if source.isupper():
        return replacement.upper()
    if source[:1].isupper():
        return replacement[:1].upper() + replacement[1:]
    return replacement


def scrub_compliance(text: str) -> str:
    """Return `text` with every banned term swapped for a neutral equivalent.

    Model-written brief copy routinely says things like "strong performance" or
    "boosting its holdings". The claim is fine; the vocabulary is not, because
    this email must never read as advice or as a track record. Swapping keeps
    the sentence intact and keeps the body provably clean.
    """
    if not text:
        return ""
    out = text
    for phrase, repl in _PHRASE_SWAPS:
        out = re.sub(
            re.escape(phrase),
            lambda m, r=repl: _match_case(m.group(0), r),
            out,
            flags=re.IGNORECASE,
        )
    for word, repl in _WORD_SWAPS:
        out = re.sub(
            rf"\b{re.escape(word)}\b",
            lambda m, r=repl: _match_case(m.group(0), r),
            out,
            flags=re.IGNORECASE,
        )
    return out


def find_banned_terms(text: str) -> list[str]:
    """Return every BANNED_TERMS entry present in `text`. Empty means clean.

    Used by the render test and by the send path's last-mile guard, so a body
    that somehow slipped a banned term through is caught before dispatch rather
    than after it landed in an inbox.
    """
    low = text.lower()
    hits: list[str] = []
    for term in BANNED_TERMS:
        pattern = re.escape(term) if " " in term else rf"\b{re.escape(term)}\b"
        if re.search(pattern, low):
            hits.append(term)
    return hits


# ---------------------------------------------------------------------------
# Payload types
# ---------------------------------------------------------------------------


@dataclass
class ResolvedCall:
    """One call from a PRIOR session, with its real graded outcome.

    Every field comes from morning_brief_calls joined to
    morning_brief_call_outcomes. Nothing here is inferred and nothing is
    filtered by verdict.
    """

    entity: str
    claim: str
    verdict: str
    attribution: str | None = None
    entity_move_pct: float | None = None
    benchmark_symbol: str | None = None
    benchmark_move_pct: float | None = None
    ungradable_reason: str | None = None


@dataclass
class TodayCall:
    """One call from TODAY's brief, still open, with its declared horizon."""

    call_id: str
    entity: str
    claim: str
    horizon_label: str
    track_url: str


@dataclass
class BriefEmailPayload:
    brief_id: str
    brief_date: str
    generated_at_display: str
    market_pulse: str
    headline: str
    lead_paragraph: str
    unsubscribe_url: str
    site_url: str
    resolved: list[ResolvedCall] = field(default_factory=list)
    today_calls: list[TodayCall] = field(default_factory=list)
    stories: list[str] = field(default_factory=list)
    issue_number: int | None = None


# ---------------------------------------------------------------------------
# Horizons (parity with backend/call_horizons.py and src/lib/call-horizons.ts)
# ---------------------------------------------------------------------------

#: Day counts must stay identical to HORIZON_DAYS in backend/call_horizons.py.
_HORIZON_LABELS: tuple[tuple[int, str], ...] = (
    (0, "Resolves same session"),
    (7, "Resolves in 1 week"),
    (21, "Resolves in 3 weeks"),
)


def horizon_label_for_days(days: int | None) -> str:
    """Human label for a call's forward window, in calendar days.

    A call with no resolve_on gets the honest "horizon not set" label rather
    than a fabricated one. Buckets are inclusive upper bounds so an off-by-one
    resolve_on still lands in the nearest declared bucket.
    """
    if days is None:
        return "Horizon not set"
    for bound, label in _HORIZON_LABELS:
        if days <= bound:
            return label
    return f"Resolves in {days} days"


# ---------------------------------------------------------------------------
# Verdict + attribution phrasing
# ---------------------------------------------------------------------------

_UNGRADABLE_REASONS = {
    "unmapped_symbol": "no tradable symbol to grade against",
    "no_price_data": "no price data for the window",
    "no_benchmark_data": "no benchmark data for the window",
    "no_honest_grader": "no method could grade this claim honestly",
}


def verdict_label(verdict: str | None) -> str:
    """Reader-facing verdict word, from the shared vocabulary.

    Thin delegate kept so callers and tests have one name to import. The table
    itself lives in verdict_vocabulary.py alongside its TypeScript parity test.
    """
    return verdict_word(verdict)


def _pct(value: float | None) -> str:
    return "n/a" if value is None else f"{value:+.2f}"


def attribution_line(call: ResolvedCall) -> str:
    """One sentence explaining whether the call can be credited for the move.

    Three honest shapes:
      clean         the entity ran past its benchmark, so the call is credited
      confounded    it moved with its benchmark, so the call cannot be credited
      inconclusive  the move sat inside the noise band, so nothing is credited
    When there is no price read at all we say so instead of inventing numbers.
    """
    if call.entity_move_pct is None or call.benchmark_symbol is None:
        reason = _UNGRADABLE_REASONS.get(
            (call.ungradable_reason or "").strip().lower(),
            "no credible read was available",
        )
        return f"Not graded: {reason}."

    head = (
        f"{call.entity} {_pct(call.entity_move_pct)} "
        f"vs {call.benchmark_symbol} {_pct(call.benchmark_move_pct)}"
    )
    attribution = (call.attribution or "").strip().lower()
    if attribution == "clean":
        return f"{head}. Clean read: it moved beyond its benchmark."
    if attribution == "confounded":
        return f"{head}. It moved with its benchmark, so the call cannot be credited."
    if attribution == "inconclusive":
        return (
            f"{head}. The move sat inside the noise band, "
            "so the call cannot be credited."
        )
    return f"{head}."


# ---------------------------------------------------------------------------
# Copy blocks
# ---------------------------------------------------------------------------

#: One permanent line under the wordmark. Most recipients signed up months ago
#: and have never seen this email; they get one sentence of orientation, not a
#: paragraph.
STANDFIRST = "Market calls scored against the close. Misses included."

PULSE_FRAMING = (
    "Written before the open. The read below describes that moment, "
    "not the session as it stands now."
)

RESOLUTION_INTRO = (
    "Every call the last session made, scored against the close with benchmark "
    "attribution. Challenged calls and no-clean-reads are listed alongside the "
    "supported ones, in the same order they were made."
)

TODAY_CALLS_INTRO = (
    "Captured before the outcome is known. Each one carries the window it will "
    "be scored over."
)

DISCLAIMER = (
    "Signalera is informational only. Nothing here is investment advice, a "
    "recommendation, or a solicitation, and nothing here is a claim about "
    "results."
)

#: Last-resort subject when a brief carries no headline and no stories. Says
#: what the email is, still without a product prefix, a count or a timestamp.
EVERGREEN_SUBJECT = "The calls we made, and how they scored"


# ---------------------------------------------------------------------------
# Subject line: an editorial headline about the day
# ---------------------------------------------------------------------------

#: Inbox truncation on a phone starts biting around here.
SUBJECT_MAX = 50

#: Clause openers we can cut a headline at and still leave something
#: grammatical. Order does not matter; every cut point is tried.
_CLAUSE_CUTS: tuple[str, ...] = (
    ", ",
    "; ",
    " After ",
    " As ",
    " Amid ",
    " While ",
    " With ",
    " Following ",
    " Despite ",
    " Ahead of ",
    " Even as ",
)

#: "$55 Billion" reads as metadata; "$55B" reads as a headline.
_MAGNITUDE_SWAPS: tuple[tuple[str, str], ...] = (
    (r"\$(\d[\d,.]*)\s+[Tt]rillion", r"$\1T"),
    (r"\$(\d[\d,.]*)\s+[Bb]illion", r"$\1B"),
    (r"\$(\d[\d,.]*)\s+[Mm]illion", r"$\1M"),
    (r"\bbasis points\b", "bps"),
    (r"\bpercentage points\b", "pts"),
    (r"\bpercent\b", "%"),
)

#: "Electronic Arts (EA)" or "eBay (NASDAQ: EBAY)". Group 1 is the long name,
#: group 2 the ticker we can swap in to buy headline room.
_TICKER_PAREN = re.compile(
    r"([A-Z][A-Za-z0-9.&'’-]*(?:\s+[A-Z][A-Za-z0-9.&'’-]*){0,3})"
    r"\s*\((?:NYSE|NASDAQ|NYSEARCA|AMEX|OTC|LSE)?\s*:?\s*([A-Z]{1,5})\)"
)

#: Any leftover exchange parenthetical, once the swap has been applied.
_PAREN_CHUNK = re.compile(r"\s*\([^)]*\)")


def _entity_shortenings(*sources: str) -> list[tuple[str, str]]:
    """Long company name -> ticker, harvested from "Name (TICKER)" mentions.

    Longest name first so "Electronic Arts Inc" is replaced before
    "Electronic Arts" can match part of it.
    """
    pairs: dict[str, str] = {}
    for source in sources:
        for name, ticker in _TICKER_PAREN.findall(source or ""):
            tokens = name.split()
            # The capitalized run before "(EA)" can reach back across a sentence
            # boundary and pick up "Debt Focus Intensifies Electronic Arts", so
            # every trailing 1-to-3 word window is offered as a candidate and
            # the longest one actually present in the subject wins.
            for width in (3, 2, 1):
                if len(tokens) < width:
                    continue
                candidate = " ".join(tokens[-width:])
                if len(candidate) > len(ticker) and candidate != ticker:
                    pairs[candidate] = ticker
    return sorted(pairs.items(), key=lambda kv: len(kv[0]), reverse=True)


def _tidy(text: str) -> str:
    """Collapse whitespace and strip dangling punctuation or conjunctions."""
    out = re.sub(r"\s+", " ", text or "").strip()
    out = out.strip(" ,;:.")
    out = re.sub(r"\s+(and|but|as|with|after|amid|while|to|of|for|on|in)$", "", out,
                 flags=re.IGNORECASE)
    return out.strip(" ,;:.")


def _subject_candidates(text: str) -> list[str]:
    """Every clause-truncation of `text`, longest first."""
    seen = {text}
    for cut in _CLAUSE_CUTS:
        start = 0
        while True:
            index = text.find(cut, start)
            if index < 0:
                break
            seen.add(text[:index])
            start = index + 1
    return sorted({_tidy(c) for c in seen if _tidy(c)}, key=len, reverse=True)


def subject_line(payload: BriefEmailPayload) -> str:
    """An editorial headline about the day, under SUBJECT_MAX characters.

    Register: "EA closes its $55B buyout", not "Signalera Morning Brief: 1 call
    resolved". A subject that leads with our product name and a count tells the
    reader nothing about whether to open it, and every inbox already shows the
    sender.

    Deterministic, because this module makes no model calls. The lead headline
    is compressed in four passes: swap long company names for the tickers the
    lead itself supplies, drop exchange parentheticals, abbreviate magnitudes,
    then keep the longest clause-truncation that fits. Nothing is invented; the
    result is always a prefix of the model's own headline.
    """
    source = _tidy(scrub_compliance(payload.headline))
    if not source and payload.stories:
        source = _tidy(scrub_compliance(payload.stories[0]))
    if not source:
        return EVERGREEN_SUBJECT

    context = f"{payload.headline} {payload.lead_paragraph}"
    text = source
    for name, ticker in _entity_shortenings(context, source):
        text = text.replace(name, ticker)
    text = _PAREN_CHUNK.sub("", text)
    for pattern, repl in _MAGNITUDE_SWAPS:
        text = re.sub(pattern, repl, text)
    text = _tidy(text)

    for candidate in _subject_candidates(text):
        # A three-word fragment is not a headline; keep looking.
        if len(candidate) <= SUBJECT_MAX and len(candidate) >= 16:
            return candidate

    # Nothing fit at a clause boundary. Trim on the last whole word.
    if len(text) <= SUBJECT_MAX:
        return text
    clipped = text[:SUBJECT_MAX]
    if " " in clipped:
        clipped = clipped[: clipped.rindex(" ")]
    return _tidy(clipped) or EVERGREEN_SUBJECT


# ---------------------------------------------------------------------------
# Preheader: the line the inbox shows after the subject
# ---------------------------------------------------------------------------

PREHEADER_MAX = 110

_NUMBER_WORDS = {
    1: "One", 2: "Two", 3: "Three", 4: "Four", 5: "Five",
    6: "Six", 7: "Seven", 8: "Eight", 9: "Nine", 10: "Ten",
}


#: Placeholders the call rows use when no symbol resolved. Real inside the
#: record, meaningless in a one-line inbox preview.
_PLACEHOLDER_ENTITIES = frozenset({"unmapped", "market", "n/a", ""})


def _fresh_entities(entities: list[str], already_said: str) -> list[str]:
    """Entities not already visible in the subject, de-duplicated, in order."""
    out: list[str] = []
    seen = set()
    for raw in entities:
        name = (raw or "").strip()
        key = name.lower()
        if not name or key in seen or key in _PLACEHOLDER_ENTITIES:
            continue
        if name in already_said:
            continue
        seen.add(key)
        out.append(name)
    return out


def preheader(payload: BriefEmailPayload) -> str:
    """One line continuing the subject with the rest of the day's items.

    The old template let the first visible text become the preview, so every
    inbox showed "Market pulse - generated Aug 07 at 14:17 UTC": our own
    plumbing, in the one line of copy that decides whether the email is opened.
    This says what else is inside, and deliberately never repeats the subject.
    """
    subject = subject_line(payload)
    bits: list[str] = []

    if payload.resolved:
        names = _fresh_entities([c.entity for c in payload.resolved], subject)
        bits.append(
            f"how {', '.join(names[:3])} scored"
            if names
            else "how the last session scored"
        )

    if payload.today_calls:
        count = len(payload.today_calls)
        word = _NUMBER_WORDS.get(count, str(count)).lower()
        noun = "call" if count == 1 else "calls"
        names = _fresh_entities([c.entity for c in payload.today_calls], subject)
        bits.append(
            f"{word} new {noun} on the board ({', '.join(names[:4])})"
            if names
            else f"{word} new {noun} on the board"
        )

    if payload.stories:
        bits.append("and the headlines behind them")

    if not bits:
        return STANDFIRST

    line = ", ".join(bits)
    line = line[:1].upper() + line[1:]
    if len(line) > PREHEADER_MAX:
        clipped = line[:PREHEADER_MAX]
        if " " in clipped:
            clipped = clipped[: clipped.rindex(" ")]
        line = clipped.rstrip(" ,;:")
    return line if line.endswith(".") else line + "."


# ---------------------------------------------------------------------------
# Market pulse: one wall of prose, broken into labelled blocks
# ---------------------------------------------------------------------------

#: Block order is fixed. A block with no sentences is not rendered.
PULSE_BLOCK_ORDER: tuple[str, ...] = (
    "The tape",
    "Macro backdrop",
    "Sector leadership",
    "Single names",
    "Looking ahead",
)

_AHEAD_HINTS = ("looking ahead", "ahead,", "later this week", "on deck",
                "watch for", "will continue", "tomorrow", "next week")

_TAPE_HINTS = ("s&p", "nasdaq", "dow ", "russell", "treasury", "10-year",
               "ten-year", "yield", "basis point", "crude", "wti", "brent",
               "gold", "the dollar", "vix", "index", "indices", "stocks ",
               "equities", "on the tape", "small-cap", "large-cap", "futures",
               "premarket", "pre-market")

_SECTOR_HINTS = ("sector", "etf", "consumer discretionary", "consumer staples",
                 "materials", "real estate", "financials", "utilities",
                 "industrials", "health care", "healthcare", "communication "
                 "services", "energy etf")

_MACRO_HINTS = ("payroll", "unemployment", "jobless", "cpi", "pce", "inflation",
                "jobs read", "jobs report", "fed ", "fomc", "gdp", "rate cut",
                "rate hike", "retail sales", "ism", "ppi")

#: Sentence boundary: a terminator, whitespace, then something that starts a
#: new sentence. Decimals ("0.22%") and "S.A. announced" do not qualify.
_SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+(?=[A-Z(\"“])")


def _sentences(text: str) -> list[str]:
    out: list[str] = []
    for paragraph in (text or "").split("\n"):
        stripped = paragraph.strip()
        if not stripped:
            continue
        out.extend(s.strip() for s in _SENTENCE_SPLIT.split(stripped) if s.strip())
    return out


#: An exchange tag inside a company mention, e.g. "eBay (NASDAQ: EBAY)". The
#: ticker prefix is not a statement about the index, so it must not drag a
#: single-name sentence into the tape block. Stripped for classification only;
#: the rendered prose keeps it.
_EXCHANGE_PAREN = re.compile(
    r"\((?:NYSE|NASDAQ|NYSEARCA|AMEX|OTC|LSE)[^)]*\)", re.IGNORECASE
)


def _classify_pulse_sentence(sentence: str) -> str:
    low = _EXCHANGE_PAREN.sub(" ", sentence).lower()
    if any(h in low for h in _AHEAD_HINTS):
        return "Looking ahead"
    if any(h in low for h in _TAPE_HINTS):
        return "The tape"
    if any(h in low for h in _SECTOR_HINTS):
        return "Sector leadership"
    if any(h in low for h in _MACRO_HINTS):
        return "Macro backdrop"
    return "Single names"


def pulse_blocks(market_pulse: str) -> list[tuple[str, str]]:
    """Group the pulse into (label, prose) blocks, preserving every sentence.

    This is a PARTITION, not a filter. Each sentence lands in exactly one
    block, order within a block is the model's original order, and the
    concatenation of all blocks is the original sentence set. A pulse fact can
    never be dropped by a classifier miss; at worst it is filed under a less
    apt heading.
    """
    grouped: dict[str, list[str]] = {label: [] for label in PULSE_BLOCK_ORDER}
    for sentence in _sentences(market_pulse):
        grouped[_classify_pulse_sentence(sentence)].append(sentence)
    return [
        (label, " ".join(grouped[label]))
        for label in PULSE_BLOCK_ORDER
        if grouped[label]
    ]


# ---------------------------------------------------------------------------
# Plain-text body
# ---------------------------------------------------------------------------


def render_text(payload: BriefEmailPayload) -> str:
    lines: list[str] = []

    lines.append("SIGNALERA")
    lines.append(STANDFIRST)
    lines.append("")
    lines.append(preheader(payload))
    lines.append("")

    # 1. Market pulse, in blocks.
    lines.append("MARKET PULSE")
    lines.append(f"{PULSE_FRAMING} Generated {payload.generated_at_display}.")
    lines.append("")
    for label, prose in pulse_blocks(scrub_compliance(payload.market_pulse)):
        lines.append(f"{label.upper()}")
        lines.append(f"  {prose}")
        lines.append("")

    # 2. Resolutions, above the lead. Omitted when empty, never padded.
    if payload.resolved:
        lines.append("HOW THE LAST SESSION'S CALLS RESOLVED")
        lines.append(RESOLUTION_INTRO)
        lines.append("")
        for call in payload.resolved:
            lines.append(f"{call.entity} - {verdict_label(call.verdict)}")
            lines.append(f"  {scrub_compliance(call.claim)}")
            lines.append(f"  {scrub_compliance(attribution_line(call))}")
            lines.append("")

    # 3. The lead.
    lines.append("THE LEAD")
    lines.append("")
    lines.append(scrub_compliance(payload.headline))
    lines.append("")
    lines.append(scrub_compliance(payload.lead_paragraph))
    lines.append("")

    # 4. Today's calls.
    if payload.today_calls:
        lines.append("TODAY'S CALLS")
        lines.append(TODAY_CALLS_INTRO)
        lines.append("")
        for call in payload.today_calls:
            lines.append(f"{call.entity} - {call.horizon_label}")
            lines.append(f"  {scrub_compliance(call.claim)}")
            lines.append(f"  Track this call: {call.track_url}")
            lines.append("")

    # 5. Today's stories.
    if payload.stories:
        lines.append("TODAY'S STORIES")
        lines.append("")
        for story in payload.stories[:5]:
            lines.append(f"- {scrub_compliance(story)}")
        lines.append("")

    # 6. Footer.
    lines.append("---")
    lines.append(f"Unsubscribe: {payload.unsubscribe_url}")
    lines.append(DISCLAIMER)

    return "\n".join(lines).strip() + "\n"


# ---------------------------------------------------------------------------
# HTML body
# ---------------------------------------------------------------------------

_BG = "#fbf8f1"
_CARD = "#ffffff"
_SHELL = "#fdfbf6"
_BORDER = "#e7dec8"
_INK = "#1f1a14"
_MUTED = "#6b6458"
_GOLD = "#c9922a"
_UP = "#2f7d4f"
_DOWN = "#a8342a"

#: Verdict word -> accent. Keys are the shared vocabulary's words, so a change
#: in verdict_vocabulary.py that this table has not caught up with degrades to
#: the muted default rather than mislabelling a colour.
_VERDICT_COLORS = {
    "Supported": _UP,
    "Challenged": _DOWN,
    "No clean read": _MUTED,
    "Awaiting": _MUTED,
}

#: Body copy floor. Anything smaller is unreadable on a phone.
_BODY_PX = 16

#: A tap target must clear 44px. 20px of line box plus 12px of padding each
#: side gets there exactly.
_TAP_TARGET = (
    "display:inline-block;padding:12px 18px;line-height:20px;"
    "min-width:120px;text-align:center;"
)

#: Bold the figures that carry the point. Guarded against matching the digits
#: inside an HTML entity such as &#x27;, and against bolding bare years.
_NUMBER_RE = re.compile(r"(?<![&#\w])([+-]?\$?\d[\d,]*(?:\.\d+)?[KMBT]?%?)")
_BARE_YEAR = re.compile(r"^(19|20)\d{2}$")


def _esc(text: str) -> str:
    return _html.escape(text or "", quote=True)


def _bold_numbers(escaped: str) -> str:
    """Wrap numeric tokens in <strong>. Input must already be escaped."""

    def _wrap(match: re.Match[str]) -> str:
        token = match.group(1)
        if _BARE_YEAR.match(token):
            return token
        return f"<strong>{token}</strong>"

    return _NUMBER_RE.sub(_wrap, escaped)


def _section_heading(label: str) -> str:
    return (
        f'<p style="font-size:12px;letter-spacing:1.6px;text-transform:uppercase;'
        f'font-weight:700;color:{_MUTED};margin:0 0 12px;">{_esc(label)}</p>'
    )


def _block(inner: str) -> str:
    """One section, in its own bordered card with consistent spacing."""
    return (
        f'<div style="border:1px solid {_BORDER};border-radius:12px;'
        f'background:{_CARD};padding:20px 18px;margin:0 0 16px;">{inner}</div>'
    )


def _para(text_html: str, size: int = _BODY_PX, color: str = _INK,
          margin: str = "0 0 12px", italic: bool = False) -> str:
    style = (
        f"font-size:{size}px;line-height:1.6;color:{color};margin:{margin};"
        f"{'font-style:italic;' if italic else ''}"
    )
    return f'<p style="{style}">{text_html}</p>'


def render_html(payload: BriefEmailPayload) -> str:
    parts: list[str] = []

    # 1. Market pulse, in labelled blocks rather than one wall of prose.
    pulse_inner = [_section_heading("Market pulse")]
    pulse_inner.append(
        _para(
            f"{_esc(PULSE_FRAMING)} Generated {_esc(payload.generated_at_display)}.",
            size=13,
            color=_MUTED,
            margin="0 0 16px",
        )
    )
    for label, prose in pulse_blocks(scrub_compliance(payload.market_pulse)):
        pulse_inner.append(
            f'<p style="font-size:11px;letter-spacing:1.4px;text-transform:uppercase;'
            f'font-weight:700;color:{_GOLD};margin:0 0 6px;">{_esc(label)}</p>'
        )
        pulse_inner.append(_para(_bold_numbers(_esc(prose)), margin="0 0 18px"))
    parts.append(_block("".join(pulse_inner).rstrip()))

    # 2. Resolutions, above the lead. Omitted when empty.
    if payload.resolved:
        inner = [_section_heading("How the last session's calls resolved")]
        inner.append(_para(_esc(RESOLUTION_INTRO), size=13, color=_MUTED,
                           margin="0 0 16px"))
        for call in payload.resolved:
            label = verdict_label(call.verdict)
            color = _VERDICT_COLORS.get(label, _MUTED)
            inner.append(
                f'<div style="border-left:4px solid {color};padding:2px 0 2px 14px;'
                f'margin:0 0 18px;">'
                f'<p style="font-size:15px;font-weight:700;color:{_INK};'
                f'margin:0 0 6px;">{_esc(call.entity)}'
                f'<span style="color:{color};"> &middot; {_esc(label)}</span></p>'
                f"{_para(_esc(scrub_compliance(call.claim)), margin='0 0 6px')}"
                f"{_para(_bold_numbers(_esc(scrub_compliance(attribution_line(call)))), size=14, color=_MUTED, margin='0', italic=True)}"
                f"</div>"
            )
        parts.append(_block("".join(inner).rstrip()))

    # 3. The lead.
    lead_inner = [_section_heading("The lead")]
    lead_inner.append(
        f'<h1 style="font-family:Georgia,\'Times New Roman\',serif;font-size:24px;'
        f'line-height:1.3;font-weight:700;color:{_INK};margin:0 0 12px;">'
        f"{_esc(scrub_compliance(payload.headline))}</h1>"
    )
    lead_inner.append(
        _para(_bold_numbers(_esc(scrub_compliance(payload.lead_paragraph))),
              size=17, margin="0")
    )
    parts.append(_block("".join(lead_inner)))

    # 4. Today's calls, each with horizon and adopt deep link.
    if payload.today_calls:
        inner = [_section_heading("Today's calls")]
        inner.append(_para(_esc(TODAY_CALLS_INTRO), size=13, color=_MUTED,
                           margin="0 0 16px"))
        for call in payload.today_calls:
            inner.append(
                f'<div style="border-top:1px solid {_BORDER};padding:16px 0 4px;">'
                f'<p style="font-size:15px;font-weight:700;color:{_INK};'
                f'margin:0 0 6px;">{_esc(call.entity)}'
                f'<span style="font-weight:400;color:{_MUTED};"> &middot; '
                f"{_esc(call.horizon_label)}</span></p>"
                f"{_para(_esc(scrub_compliance(call.claim)), margin='0 0 14px')}"
                f'<a href="{_esc(call.track_url)}" '
                f'style="{_TAP_TARGET}font-size:15px;font-weight:600;'
                f"color:{_CARD};background:{_GOLD};border-radius:8px;"
                f'text-decoration:none;">Track this call &rarr;</a>'
                f"</div>"
            )
        parts.append(_block("".join(inner)))

    # 5. Today's stories.
    if payload.stories:
        inner = [_section_heading("Today's stories")]
        items = "".join(
            f'<li style="font-size:{_BODY_PX}px;line-height:1.6;color:{_INK};'
            f'margin:0 0 12px;">{_esc(scrub_compliance(s))}</li>'
            for s in payload.stories[:5]
        )
        inner.append(f'<ul style="margin:0;padding-left:20px;">{items}</ul>')
        parts.append(_block("".join(inner)))

    # 6. Footer.
    parts.append(
        f'<div style="padding:8px 18px 0;">'
        f'<p style="font-size:14px;line-height:1.6;margin:0 0 10px;">'
        f'<a href="{_esc(payload.unsubscribe_url)}" '
        f'style="color:{_MUTED};display:inline-block;padding:12px 0;'
        f'line-height:20px;">Unsubscribe from the Morning Brief</a></p>'
        f'<p style="font-size:13px;line-height:1.6;color:{_MUTED};margin:0;">'
        f"{_esc(DISCLAIMER)}</p></div>"
    )

    body = "".join(parts)
    preview = _esc(preheader(payload))
    return (
        "<!doctype html><html><head>"
        '<meta name="viewport" content="width=device-width,initial-scale=1" />'
        '<meta name="color-scheme" content="light" />'
        "</head><body "
        f'style="margin:0;padding:16px;background:{_BG};'
        'font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Arial,sans-serif;'
        '-webkit-text-size-adjust:100%;">'
        # Preview text: shown by the inbox, never rendered in the body.
        f'<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;'
        f'font-size:1px;line-height:1px;color:{_BG};opacity:0;">{preview}</div>'
        f'<div style="max-width:600px;width:100%;margin:0 auto;">'
        f'<div style="padding:8px 18px 20px;">'
        f'<p style="font-family:Georgia,serif;font-size:22px;color:{_GOLD};'
        'margin:0 0 6px;">Signalera</p>'
        f'<p style="font-size:13px;line-height:1.5;color:{_MUTED};margin:0;">'
        f"{_esc(STANDFIRST)}</p></div>"
        f"{body}"
        "</div></body></html>"
    )


def render_email(payload: BriefEmailPayload) -> dict[str, str]:
    """Render subject, html and text in one pass. The only entry point callers need."""
    return {
        "subject": subject_line(payload),
        "html": render_html(payload),
        "text": render_text(payload),
    }
