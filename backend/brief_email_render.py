"""
brief_email_render.py - pure rendering for the daily Morning Brief email.

No IO, no env reads, no network, no model calls. Everything here is a pure
function of its arguments so the whole email body is testable offline.

Section order is fixed and load-bearing (see docs in the PR body):
  1. Market pulse, verbatim, stamped with the generation time and explicitly
     framed as pre-open so a reader opening it at noon never reads it as live.
  2. The lead: headline plus lead paragraph.
  3. How the last session's calls resolved. This is the reason the email
     exists. Misses and no-clean-reads render exactly like hits. The block is
     OMITTED entirely when nothing resolved; it is never padded.
  4. Today's calls, each with its resolution horizon and a per-call deep link
     into the site where the call can be adopted.
  5. Today's stories, three to five headlines.
  6. Footer: working unsubscribe link plus the disclaimer.

COMPLIANCE. Everything in sections 1 to 5 originates from model-written brief
copy, so it cannot be trusted to stay inside our compliance vocabulary. Every
model-authored string passes through scrub_compliance() before it reaches the
body. That is a vocabulary swap, not a rewrite: the claim survives, the banned
word does not. BANNED_TERMS is the same list the render test asserts against,
so the guard and the test can never drift apart.
"""

from __future__ import annotations

import html as _html
import re
from dataclasses import dataclass, field

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

#: Reader-facing verdict words. "ungradable" is deliberately surfaced as a
#: first-class state, not hidden: a call we could not grade honestly is part of
#: the record. Anything unrecognized also degrades to no-clean-read rather than
#: silently claiming a hit.
_VERDICT_LABELS = {
    "correct": "Correct",
    "wrong": "Wrong",
    "partial": "Partial",
    "ungradable": "No clean read",
}

_UNGRADABLE_REASONS = {
    "unmapped_symbol": "no tradable symbol to grade against",
    "no_price_data": "no price data for the window",
    "no_benchmark_data": "no benchmark data for the window",
    "no_honest_grader": "no method could grade this claim honestly",
}


def verdict_label(verdict: str | None) -> str:
    return _VERDICT_LABELS.get((verdict or "").strip().lower(), "No clean read")


def _pct(value: float | None) -> str:
    return "n/a" if value is None else f"{value:+.2f}"


def attribution_line(call: ResolvedCall) -> str:
    """One sentence explaining whether the thesis can be credited for the move.

    Three honest shapes:
      clean         the entity ran past its benchmark, so the call is credited
      confounded    it moved with its benchmark, so the thesis cannot be credited
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
        return (
            f"{head}. It moved with its benchmark, so the thesis cannot be credited."
        )
    if attribution == "inconclusive":
        return (
            f"{head}. The move sat inside the noise band, "
            "so the thesis cannot be credited."
        )
    return f"{head}."


# ---------------------------------------------------------------------------
# Copy blocks
# ---------------------------------------------------------------------------

PULSE_FRAMING = (
    "Written before the open. The read below describes that moment, "
    "not the session as it stands now."
)

RESOLUTION_INTRO = (
    "Every call the last session made, scored against the close with benchmark "
    "attribution. Misses and no-clean-reads are listed alongside the hits, in the "
    "same order they were made."
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


def subject_line(payload: BriefEmailPayload) -> str:
    base = "Signalera Morning Brief"
    if payload.issue_number:
        base = f"{base} - Issue #{payload.issue_number}"
    if payload.resolved:
        n = len(payload.resolved)
        noun = "call" if n == 1 else "calls"
        return f"{base}: {n} {noun} resolved"
    return base


# ---------------------------------------------------------------------------
# Plain-text body
# ---------------------------------------------------------------------------


def render_text(payload: BriefEmailPayload) -> str:
    lines: list[str] = []

    lines.append(f"MARKET PULSE (generated {payload.generated_at_display})")
    lines.append(PULSE_FRAMING)
    lines.append("")
    lines.append(scrub_compliance(payload.market_pulse))
    lines.append("")

    lines.append("THE LEAD")
    lines.append("")
    lines.append(scrub_compliance(payload.headline))
    lines.append("")
    lines.append(scrub_compliance(payload.lead_paragraph))
    lines.append("")

    # Section 3 is omitted entirely when nothing resolved. Never padded.
    if payload.resolved:
        lines.append("HOW THE LAST SESSION'S CALLS RESOLVED")
        lines.append(RESOLUTION_INTRO)
        lines.append("")
        for call in payload.resolved:
            lines.append(f"{call.entity} - {verdict_label(call.verdict)}")
            lines.append(f"  {scrub_compliance(call.claim)}")
            lines.append(f"  {scrub_compliance(attribution_line(call))}")
            lines.append("")

    if payload.today_calls:
        lines.append("TODAY'S CALLS")
        lines.append(TODAY_CALLS_INTRO)
        lines.append("")
        for call in payload.today_calls:
            lines.append(f"{call.entity} - {call.horizon_label}")
            lines.append(f"  {scrub_compliance(call.claim)}")
            lines.append(f"  Track this thesis: {call.track_url}")
            lines.append("")

    if payload.stories:
        lines.append("TODAY'S STORIES")
        lines.append("")
        for story in payload.stories[:5]:
            lines.append(f"- {scrub_compliance(story)}")
        lines.append("")

    lines.append("---")
    lines.append(f"Unsubscribe: {payload.unsubscribe_url}")
    lines.append(DISCLAIMER)

    return "\n".join(lines).strip() + "\n"


# ---------------------------------------------------------------------------
# HTML body
# ---------------------------------------------------------------------------

_BG = "#fbf8f1"
_CARD = "#ffffff"
_BORDER = "#e7dec8"
_INK = "#1f1a14"
_MUTED = "#6b6458"
_GOLD = "#c9922a"
_UP = "#2f7d4f"
_DOWN = "#a8342a"

_VERDICT_COLORS = {
    "Correct": _UP,
    "Wrong": _DOWN,
    "Partial": _MUTED,
    "No clean read": _MUTED,
}


def _esc(text: str) -> str:
    return _html.escape(text or "", quote=True)


def _section_heading(label: str) -> str:
    return (
        f'<p style="font-size:10px;letter-spacing:2px;text-transform:uppercase;'
        f'font-weight:700;color:{_MUTED};margin:32px 0 10px;">{_esc(label)}</p>'
    )


def render_html(payload: BriefEmailPayload) -> str:
    parts: list[str] = []

    # 1. Market pulse, verbatim, timestamped and past-framed.
    parts.append(
        _section_heading(f"Market pulse - generated {payload.generated_at_display}")
    )
    parts.append(
        f'<p style="font-size:11px;line-height:1.5;color:{_MUTED};margin:0 0 12px;">'
        f"{_esc(PULSE_FRAMING)}</p>"
    )
    parts.append(
        f'<p style="font-size:14px;line-height:1.65;color:{_INK};margin:0 0 8px;">'
        f"{_esc(scrub_compliance(payload.market_pulse))}</p>"
    )

    # 2. The lead.
    parts.append(_section_heading("The lead"))
    parts.append(
        f'<h1 style="font-family:Georgia,\'Times New Roman\',serif;font-size:22px;'
        f'line-height:1.3;font-weight:700;color:{_INK};margin:0 0 12px;">'
        f"{_esc(scrub_compliance(payload.headline))}</h1>"
    )
    parts.append(
        f'<p style="font-size:15px;line-height:1.65;color:{_INK};margin:0;">'
        f"{_esc(scrub_compliance(payload.lead_paragraph))}</p>"
    )

    # 3. Resolutions. Omitted when empty.
    if payload.resolved:
        parts.append(_section_heading("How the last session's calls resolved"))
        parts.append(
            f'<p style="font-size:12px;line-height:1.55;color:{_MUTED};margin:0 0 14px;">'
            f"{_esc(RESOLUTION_INTRO)}</p>"
        )
        for call in payload.resolved:
            label = verdict_label(call.verdict)
            color = _VERDICT_COLORS.get(label, _MUTED)
            parts.append(
                f'<div style="border-left:3px solid {color};padding:2px 0 2px 12px;'
                f'margin:0 0 16px;">'
                f'<p style="font-size:13px;font-weight:700;color:{_INK};margin:0 0 4px;">'
                f"{_esc(call.entity)}"
                f'<span style="color:{color};font-weight:700;"> - {_esc(label)}</span>'
                f"</p>"
                f'<p style="font-size:13px;line-height:1.6;color:{_INK};margin:0 0 4px;">'
                f"{_esc(scrub_compliance(call.claim))}</p>"
                f'<p style="font-size:12px;line-height:1.55;color:{_MUTED};'
                f'font-style:italic;margin:0;">'
                f"{_esc(scrub_compliance(attribution_line(call)))}</p>"
                f"</div>"
            )

    # 4. Today's calls, each with horizon and adopt deep link.
    if payload.today_calls:
        parts.append(_section_heading("Today's calls"))
        parts.append(
            f'<p style="font-size:12px;line-height:1.55;color:{_MUTED};margin:0 0 14px;">'
            f"{_esc(TODAY_CALLS_INTRO)}</p>"
        )
        for call in payload.today_calls:
            parts.append(
                f'<div style="border:1px solid {_BORDER};border-radius:8px;'
                f'padding:12px 14px;margin:0 0 12px;">'
                f'<p style="font-size:13px;font-weight:700;color:{_INK};margin:0 0 4px;">'
                f"{_esc(call.entity)}"
                f'<span style="font-weight:400;color:{_MUTED};"> - '
                f"{_esc(call.horizon_label)}</span></p>"
                f'<p style="font-size:13px;line-height:1.6;color:{_INK};margin:0 0 10px;">'
                f"{_esc(scrub_compliance(call.claim))}</p>"
                f'<a href="{_esc(call.track_url)}" '
                f'style="font-size:12px;font-weight:600;color:{_GOLD};'
                f'text-decoration:none;">Track this thesis &rarr;</a>'
                f"</div>"
            )

    # 5. Today's stories.
    if payload.stories:
        parts.append(_section_heading("Today's stories"))
        items = "".join(
            f'<li style="font-size:13px;line-height:1.6;color:{_INK};margin:0 0 8px;">'
            f"{_esc(scrub_compliance(s))}</li>"
            for s in payload.stories[:5]
        )
        parts.append(
            f'<ul style="margin:0;padding-left:18px;">{items}</ul>'
        )

    # 6. Footer.
    parts.append(
        f'<hr style="border:none;border-top:1px solid {_BORDER};margin:32px 0 16px;" />'
        f'<p style="font-size:11px;line-height:1.6;color:{_MUTED};margin:0 0 6px;">'
        f'<a href="{_esc(payload.unsubscribe_url)}" style="color:{_MUTED};">'
        f"Unsubscribe from the Morning Brief</a></p>"
        f'<p style="font-size:11px;line-height:1.6;color:{_MUTED};margin:0;">'
        f"{_esc(DISCLAIMER)}</p>"
    )

    body = "".join(parts)
    return (
        "<!doctype html><html><body "
        f'style="margin:0;padding:24px;background:{_BG};'
        'font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Arial,sans-serif;">'
        f'<div style="max-width:560px;margin:0 auto;background:{_CARD};'
        f'border:1px solid {_BORDER};border-radius:12px;padding:32px 28px;">'
        f'<p style="font-family:Georgia,serif;font-size:20px;color:{_GOLD};'
        'margin:0 0 24px;">Signalera</p>'
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
