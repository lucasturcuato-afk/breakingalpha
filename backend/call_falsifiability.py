"""
call_falsifiability.py - the gate every emitted brief call has to clear.

A call is worth something only if it can be wrong. On 2026-07-27 the brief
emitted five and two of them could not be:

    "A hawkish or dovish surprise from the FOMC rate decision will directly
     impact rates and the curve."
    "Deviation from consensus on the PCE price index could trigger significant
     shifts in risk appetite and sector-specific valuations."

Both are conditionals with two sides and no threshold. Whatever the market did,
neither was falsified. Both landed with expected_direction "neutral" and a null
target_symbol, so the grader had nothing to price them against and recorded "no
honest grader for this claim type yet". Forty percent of that day's calls were
decoration.

The authoring route already solved this for user-written claims
(src/app/api/radar/claims/author/route.ts): a claim is gradeable only if it
reduces to a priceable entity, an explicit direction, and a bounded window, and
when it cannot, the route proposes a proxy the claim CAN be expressed against.
The generator held itself to no such standard. This module is that same
standard, applied to generated calls.

Three rules, in order:

  1. FALSIFIABLE TEXT. A two-sided construction ("hawkish or dovish", "in either
     direction") or an outcome-free one ("could trigger significant shifts",
     "will directly impact rates") is not a call regardless of what direction
     field the model attached to it.
  2. EXPLICIT DIRECTION. bullish or bearish. "neutral" is a description, not a
     prediction.
  3. PRICEABLE TARGET. A symbol the grader can fetch candles for. When the claim
     is directionally real but not priceable as stated, express it against a
     listed proxy (rates to TLT, credit to LQD, dollar to UUP) and keep it. Only
     what cannot be reshaped is dropped.

Deliberately NOT enforced by prompt alone. The prompt is also strengthened, but
a model asked nicely for falsifiable calls will still produce hedges under
pressure, and the whole point is that the standard holds on the bad days.

No backfilling. If a day yields two gradeable calls, two ship. Three real calls
beat five with two decorations.

Pure module: no IO, no env, no Supabase, no Gemini, no second model call.
Importable from tests. Mirrors the shape of the LEAD_V2 anti-tautology guard in
synthesize.py (_lead_tautology_violation): deterministic regexes, applied in
code after generation, offline-testable.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

try:  # same dual-path import synthesize.py uses for call_horizons
    from call_horizons import (
        HORIZON_DAYS,
        HORIZON_MULTIWEEK,
        HORIZON_SESSION,
        HORIZON_WEEK,
        normalize_horizon_days,
    )
except ImportError:  # pragma: no cover - import path only
    from backend.call_horizons import (
        HORIZON_DAYS,
        HORIZON_MULTIWEEK,
        HORIZON_SESSION,
        HORIZON_WEEK,
        normalize_horizon_days,
    )

# ---------------------------------------------------------------------------
# Rule 1: falsifiable text
# ---------------------------------------------------------------------------

#: Two-sided constructions. The claim covers both outcomes, so no outcome can
#: contradict it. Written as explicit opposite pairs rather than a generic
#: "X or Y" so a legitimate disjunction ("XLE or XLB will lead") is untouched.
_BIDIRECTIONAL_PATTERNS = (
    r"\b(?:hawkish|dovish)\s+(?:or|and/or)\s+(?:hawkish|dovish)\b",
    r"\b(?:higher|lower)\s+(?:or|and/or)\s+(?:higher|lower)\b",
    r"\b(?:up|down)\s+(?:or|and/or)\s+(?:up|down)\b",
    r"\b(?:bullish|bearish)\s+(?:or|and/or)\s+(?:bullish|bearish)\b",
    r"\b(?:upside|downside)\s+(?:or|and/or)\s+(?:upside|downside)\b",
    r"\b(?:beat|miss)(?:es)?\s+(?:or|and/or)\s+(?:beat|miss)(?:es)?\b",
    r"\b(?:gain|loss)(?:es|s)?\s+(?:or|and/or)\s+(?:gain|loss)(?:es|s)?\b",
    r"\b(?:rise|fall|rally|selloff|sell-off)\s+(?:or|and/or)\s+(?:rise|fall|rally|selloff|sell-off)\b",
    r"\b(?:strengthen|weaken)\s+(?:or|and/or)\s+(?:strengthen|weaken)\b",
    r"\bin\s+either\s+direction\b",
    r"\beither\s+way\b",
    r"\bone\s+way\s+or\s+the\s+other\b",
)

#: The predicted consequence has magnitude but no sign: something will "shift",
#: "move", or "react". True of every possible tape, so it is damning on its own.
_UNDIRECTED_OUTCOME_PATTERNS = (
    r"\b(?:trigger|spark|cause|drive|lead\s+to|result\s+in|produce|prompt|induce)\b"
    r"(?:\s+\w+){0,4}\s+"
    r"\b(?:shift|swing|move|movement|reaction|repricing|volatility|turbulence|"
    r"dislocation|adjustment|response)s?\b",
    r"\bsignificant\s+(?:shift|swing|move|movement|volatility|reaction)s?\b",
    r"\bdeviation\s+from\s+(?:consensus|estimates|expectations)\b",
    r"\bany\s+(?:surprise|deviation|miss|beat|shift)\b",
    r"\bremains?\s+to\s+be\s+seen\b",
    r"\bcould\s+go\s+either\s+way\b",
    r"\b(?:watch|watching)\s+for\b",
    r"\bkeep\s+an\s+eye\s+on\b",
    r"\bbears?\s+(?:close\s+)?(?:watching|monitoring)\b",
    r"\bwill\s+be\s+(?:closely\s+)?(?:watched|monitored)\b",
)

#: "X will impact Y" is damning ONLY when nothing in the sentence says which
#: way. "The tariff will impact industrials lower" is a call; "a surprise will
#: directly impact rates and the curve" is not.
_UNDIRECTED_IF_NO_DIRECTION_PATTERNS = (
    r"\b(?:directly\s+)?(?:impact|affect|influence|move)(?:s|ing|ed)?\b"
    r"(?:\s+\w+){0,4}\s+"
    r"\b(?:rates?|curve|yields?|markets?|sectors?|valuations?|sentiment|"
    r"appetite|pricing|positioning)\b",
)

#: Words that state which way. Used only to spare an "impact"-family sentence
#: that does name a direction, never as a requirement on its own: a claim can
#: carry its direction in the expected_direction field and still be gradeable
#: ("the sector will see continued consolidation", bullish, XLV).
_DIRECTION_TOKENS = (
    r"\b(?:rise|rises|rising|rose|rally|rallies|rallying|climb|climbs|climbing|"
    r"advance|advances|advancing|gain|gains|gaining|higher|outperform|"
    r"outperforms|outperforming|strengthen|strengthens|strengthening|"
    r"appreciate|appreciates|upside|beat|beats|expand|expands|surge|surges|"
    r"jump|jumps|lift|lifts|tailwind|tailwinds|"
    r"fall|falls|falling|fell|decline|declines|declining|drop|drops|dropping|"
    r"slide|slides|sliding|sink|sinks|lower|underperform|underperforms|"
    r"underperforming|weaken|weakens|weakening|pressure|pressured|selloff|"
    r"sell-off|downside|miss|misses|contract|contracts|slump|slumps|"
    r"headwind|headwinds|retreat|retreats)\b"
)


def has_direction_word(text: object) -> bool:
    """True when the claim text itself names a price direction."""
    if not isinstance(text, str):
        return False
    return re.search(_DIRECTION_TOKENS, text.lower()) is not None


def unfalsifiable_hits(text: object) -> list[str]:
    """
    Return the two-sided or outcome-free constructions found in a claim, or []
    when the text commits to something. Pure; no network.

    The "impact / affect / move" family fires only when the sentence names no
    direction anywhere. "The tariff will impact industrials lower" is a call;
    "a surprise will directly impact rates and the curve" is not.
    """
    if not isinstance(text, str) or not text.strip():
        return ["empty claim text"]
    low = text.lower()
    hits: list[str] = []

    for pat in _BIDIRECTIONAL_PATTERNS:
        m = re.search(pat, low)
        if m:
            hits.append(m.group(0))

    for pat in _UNDIRECTED_OUTCOME_PATTERNS:
        m = re.search(pat, low)
        if m:
            hits.append(m.group(0))

    if not has_direction_word(low):
        for pat in _UNDIRECTED_IF_NO_DIRECTION_PATTERNS:
            m = re.search(pat, low)
            if m:
                hits.append(m.group(0))

    # Dedupe, preserve order, so a repeated hit does not inflate the reason.
    seen: set[str] = set()
    out: list[str] = []
    for h in hits:
        if h not in seen:
            seen.add(h)
            out.append(h)
    return out


# ---------------------------------------------------------------------------
# Rule 3: priceable target, and the proxy map that saves a real claim
# ---------------------------------------------------------------------------

#: Claim types the grader can fetch candles for. Mirrors `priceable` in
#: src/app/api/radar/claims/author/route.ts:126.
PRICEABLE_TYPES = frozenset({"sector", "index", "ticker"})

#: Ordered keyword to proxy map. First match wins, so the specific entries
#: (semiconductors, homebuilders) sit above the general ones (technology,
#: consumer discretionary). Each entry is (pattern, symbol, claim_type).
#:
#: This is the generator's half of the same list the authoring route offers as a
#: gradeable_alternative: a claim about a thing with no ticker gets expressed
#: against the instrument that actually prices that thing.
PROXY_MAP: tuple[tuple[str, str, str], ...] = (
    # Currency and commodities first: a claim about the dollar that mentions a
    # rate differential is a dollar claim, not a rates claim.
    (r"\b(?:the\s+dollar|u\.?s\.?\s+dollar|greenback|dxy|dollar\s+index)\b", "UUP", "index"),
    (r"\b(?:gold|bullion)\b", "GLD", "index"),
    (r"\b(?:oil|crude|wti|brent|petroleum|opec)\b", "XLE", "sector"),
    # Specific industries before the broad sector or theme they sit inside, so
    # "homebuilders slide on rates" is a homebuilder call, not a rates call.
    (r"\b(?:semiconductors?|semis?|chipmakers?|chips)\b", "SMH", "sector"),
    (r"\b(?:homebuilders?|housing\s+market|home\s+builders?)\b", "XHB", "sector"),
    (r"\b(?:small[-\s]caps?|russell\s*2000)\b", "IWM", "index"),
    (r"\b(?:nasdaq|mega[-\s]cap\s+tech)\b", "QQQ", "index"),
    # Rates and credit. See _INVERTING_PROXIES below. A bare "rates" is
    # deliberately NOT a keyword: it appears as a modifier in claims that are
    # about something else entirely.
    (r"\b(?:treasur(?:y|ies)|bond\s+market|bonds?|duration|the\s+curve|yield\s+curve|"
     r"10-?year|two-?year|2-?year|30-?year|interest\s+rates?|yields?)\b",
     "TLT", "index"),
    (r"\b(?:credit\s+spreads?|corporate\s+credit|investment[-\s]grade|high[-\s]yield|"
     r"\bcredit\b)\b", "LQD", "index"),
    # Policy themes, mirroring the route's industrial policy to XLI.
    (r"\b(?:industrial\s+policy|onshoring|reshoring|infrastructure\s+spending|"
     r"tariffs?|trade\s+policy)\b", "XLI", "sector"),
    (r"\b(?:defen[cs]e\s+spending|defen[cs]e\s+budget)\b", "XLI", "sector"),
    # The eleven sectors.
    (r"\b(?:technology|tech\s+sector|software|it\s+sector)\b", "XLK", "sector"),
    (r"\b(?:energy)\b", "XLE", "sector"),
    (r"\b(?:financials?|banks?|lenders?|bank\s+sector)\b", "XLF", "sector"),
    (r"\b(?:healthcare|health\s+care|biotech|pharma(?:ceuticals?)?)\b", "XLV", "sector"),
    (r"\b(?:consumer\s+discretionary|retailers?|retail\s+sector)\b", "XLY", "sector"),
    (r"\b(?:consumer\s+staples|staples)\b", "XLP", "sector"),
    (r"\b(?:industrials?|manufacturing)\b", "XLI", "sector"),
    (r"\b(?:materials|miners?|chemicals)\b", "XLB", "sector"),
    (r"\b(?:real\s+estate|reits?)\b", "XLRE", "sector"),
    (r"\b(?:utilities)\b", "XLU", "sector"),
    (r"\b(?:communication\s+services|media\s+sector|telecom)\b", "XLC", "sector"),
    # A NAMED index, last: it is the fallback, not a first read. Only tokens
    # that name the instrument itself survive here. "broad market", "equities"
    # and "stock market" were removed: see _BROAD_MARKET_NON_SUBJECTS below for
    # why naming the market as a whole is not a priceable subject.
    (r"\b(?:s&p|s\s*&\s*p\s*500|spx)\b", "SPY", "index"),
)

#: Collective nouns for the market as a whole. These name NO instrument.
#:
#: "Equities stay volatile" is not the claim "SPY moves more than X in the
#: predicted direction", and reshaping it onto SPY invents a target the claim
#: never made, then grades it confidently against a bar nobody set. That is
#: worse than dropping the call: an ungradable claim is honest about its own
#: limits, a mis-shaped one is not.
#:
#: The live record agrees. Across 26 graded aggregate calls: ZERO clean reads,
#: 18 ungradable. The claim type has never once resolved cleanly.
#:
#: Matched ONLY to explain the drop in the run log. They are deliberately absent
#: from PROXY_MAP, so a claim reaching here has no listed proxy and is rejected
#: either way; this just says why in words a human can act on.
_BROAD_MARKET_NON_SUBJECTS: tuple[str, ...] = (
    r"\bbroad\s+market\b",
    r"\bequity\s+markets?\b",
    r"\bequities\b",
    r"\bstock\s+market\b",
    r"\bstocks\b",
    r"\bthe\s+market\b",
    r"\bmarkets\b",
    r"\brisk\s+(?:assets|appetite|sentiment)\b",
    r"\binvestor\s+sentiment\b",
)

#: Proxies whose price moves OPPOSITE to the quantity the claim is about. A
#: claim that yields rise is a claim that TLT falls. Getting this backwards
#: would emit a confidently inverted call, which is worse than emitting none, so
#: inversion only applies when the claim's subject is unambiguously the rate or
#: spread itself, and the claim is dropped when it cannot be told apart.
_INVERTING_PROXIES = frozenset({"TLT", "LQD"})

#: The subject is the yield or the spread, not the instrument.
_RATE_QUANTITY_RE = re.compile(
    r"\b(?:yields?|interest\s+rates?|\brates?\b|the\s+curve|yield\s+curve|"
    r"credit\s+spreads?|spreads?)\b"
)
#: The subject is the instrument itself, so its price moves with the claim. The
#: lookahead matters: "Treasury yields" is a claim about the yield, not about
#: the bond, and reading it as the bond would emit an inverted call.
_RATE_INSTRUMENT_RE = re.compile(
    r"\b(?:treasur(?:y|ies)|bonds?|credit)\b(?!\s+(?:yields?|rates?|spreads?))"
    r"|\b(?:duration|tlt|lqd)\b"
    r"|\binvestment[-\s]grade\s+(?:bonds?|debt)\b"
    r"|\bhigh[-\s]yield\s+(?:bonds?|debt)\b"
)

_OPPOSITE = {"bullish": "bearish", "bearish": "bullish"}


def find_proxy(text: object) -> tuple[str, str] | None:
    """First (symbol, claim_type) whose keyword appears in the claim, else None."""
    if not isinstance(text, str) or not text.strip():
        return None
    low = text.lower()
    for pattern, symbol, claim_type in PROXY_MAP:
        if re.search(pattern, low):
            return symbol, claim_type
    return None


def proxy_direction(symbol: str, text: str, direction: str) -> str | None:
    """
    The direction to record against `symbol`, or None when it cannot be
    determined honestly.

    For a non-inverting proxy the claim's direction carries through. For TLT and
    LQD it depends on whether the claim is about the yield (inverts) or the
    instrument (does not). A claim naming both, or neither, returns None and is
    dropped rather than guessed.
    """
    if symbol not in _INVERTING_PROXIES:
        return direction
    low = (text or "").lower()
    is_quantity = _RATE_QUANTITY_RE.search(low) is not None
    is_instrument = _RATE_INSTRUMENT_RE.search(low) is not None
    if is_quantity and not is_instrument:
        return _OPPOSITE.get(direction)
    if is_instrument and not is_quantity:
        return direction
    return None


# ---------------------------------------------------------------------------
# Rule 4: horizon guidance, applied in code
# ---------------------------------------------------------------------------

#: A single company's result propagating to its sector. That takes weeks, not an
#: afternoon: the sector has to re-rate on the read, not on the print. On
#: 2026-07-27 "the healthcare services sector may face headwinds due to Ensign
#: Group's Q2 sales being below analyst estimates" shipped as same-session,
#: which grades a read-through thesis on one day of noise.
_READ_THROUGH_PATTERNS = (
    r"\bread[-\s]?through\b",
    r"\bripple\s+(?:effect|through)\b",
    r"\bknock[-\s]on\b",
    r"\bspill(?:over|s\s+over)\b",
    r"\bimplications?\s+for\s+the\s+(?:sector|industry|group|space)\b",
    r"\bsignals?\s+(?:broader|wider|sector[-\s]wide)\b",
    r"\bbellwether\b",
    r"\bperipheral\b",
)

#: A named company in the possessive, next to a result. Paired with a sector or
#: index claim type, that IS a read-through: the evidence is one name, the
#: subject is the whole group.
_COMPANY_POSSESSIVE_RE = re.compile(r"\b[A-Z][A-Za-z&.\-]+(?:\s+[A-Z][A-Za-z&.\-]+)*'s\b")
_RESULT_TOKEN_RE = re.compile(
    r"\b(?:estimates?|consensus|guidance|earnings|results?|revenue|sales|"
    r"eps|margin|beat|miss(?:ed|es)?|q[1-4]\b|quarter(?:ly)?)\b",
    re.IGNORECASE,
)

#: Theses, not trades. A cycle, a re-rating, a consolidation wave.
_STRUCTURAL_PATTERNS = (
    r"\bconsolidation\b",
    r"\bm&a\s+(?:activity|wave|cycle)\b",
    r"\bcontinued\s+m&a\b",
    r"\bre-?rat(?:e|es|ing)\b",
    r"\b(?:secular|structural)\b",
    r"\bcycle\s+(?:turn|turning|turns)\b",
    r"\bcapex\s+cycle\b",
    r"\bover\s+the\s+coming\s+(?:weeks|months|quarters?)\b",
    r"\bmulti[-\s]?(?:week|month|quarter)\b",
    r"\bfull[-\s]year\s+guidance\b",
    r"\bbuild(?:s|ing)?\s+over\s+time\b",
)

#: Policy and regulation act on a sector with a lag. Not same-session, unless a
#: direct-repricing marker says the market prices it today.
_POLICY_PATTERNS = (
    r"\btariffs?\b",
    r"\b(?:trade|industrial|fiscal|monetary)\s+policy\b",
    r"\bregulat(?:ion|ory|e|es)\b",
    r"\blegislation\b",
    r"\bsubsid(?:y|ies)\b",
    r"\bsanctions?\b",
    r"\bantitrust\b",
    r"\bapproval\s+process\b",
)

#: The market prices this today. Overrides the policy lag, never the structural
#: or read-through floor: a read-through is slow even when the headline is new.
_DIRECT_REPRICING_PATTERNS = (
    r"\btoday\b",
    r"\bthis\s+session\b",
    r"\bat\s+the\s+open\b",
    r"\bon\s+the\s+print\b",
    r"\bintraday\b",
    r"\bovernight\b",
    r"\bpre-?market\b",
    r"\bimmediately\b",
    r"\bsame[-\s]session\b",
)

#: The floor each signal implies, as a DAY COUNT.
#:
#: These were an ordinal rank over three bucket names, which only worked because
#: there were exactly three of them. With a variable horizon the comparison is
#: plain arithmetic: the floor is a number of days and the rule is max(). Same
#: semantics, one fewer indirection, and it now ranks a 13-day call correctly
#: against a 7-day floor, which a bucket rank could not express at all.
#:
#: The values are the named buckets' own day counts (call_horizons.HORIZON_DAYS),
#: so the floors this gate enforced before it spoke in days are unchanged.
FLOOR_STRUCTURAL_DAYS = HORIZON_DAYS[HORIZON_MULTIWEEK]   # 21
FLOOR_READ_THROUGH_DAYS = HORIZON_DAYS[HORIZON_WEEK]      # 7
FLOOR_POLICY_DAYS = HORIZON_DAYS[HORIZON_WEEK]            # 7
FLOOR_NONE_DAYS = HORIZON_DAYS[HORIZON_SESSION]           # 0


def _any(patterns: tuple[str, ...], low: str) -> str | None:
    for pat in patterns:
        m = re.search(pat, low)
        if m:
            return m.group(0)
    return None


def horizon_floor_days(text: object, claim_type: object) -> tuple[int, str | None]:
    """
    The shortest window this claim can honestly resolve over, in calendar days,
    and why.

    Returns (min_days, reason). A zero floor with a None reason means nothing in
    the text argues for a longer window than same-session.
    """
    if not isinstance(text, str) or not text.strip():
        return FLOOR_NONE_DAYS, None
    low = text.lower()

    structural = _any(_STRUCTURAL_PATTERNS, low)
    if structural:
        return FLOOR_STRUCTURAL_DAYS, f"structural or consolidation language ({structural!r})"

    read_through = _any(_READ_THROUGH_PATTERNS, low)
    if read_through:
        return FLOOR_READ_THROUGH_DAYS, f"read-through language ({read_through!r})"

    # A single named company's result carried onto a whole sector or index.
    if isinstance(claim_type, str) and claim_type.lower() in ("sector", "index", "aggregate"):
        if _COMPANY_POSSESSIVE_RE.search(text) and _RESULT_TOKEN_RE.search(text):
            return FLOOR_READ_THROUGH_DAYS, "single-name result read across a sector"

    policy = _any(_POLICY_PATTERNS, low)
    if policy and not _any(_DIRECT_REPRICING_PATTERNS, low):
        return FLOOR_POLICY_DAYS, f"policy effect ({policy!r})"

    return FLOOR_NONE_DAYS, None


def classify_horizon_days(
    text: object, claim_type: object, model_days: object
) -> tuple[int, str | None]:
    """
    The window to store, in calendar days. Never shorter than the floor the text
    implies, never shorter than what the model asked for.

    Upgrade-only on purpose, and now literally max(). Overriding a model that
    asked for 30 days would be a second guess with nothing deterministic behind
    it; raising a model that asked for 0 on a read-through is a correction with
    the text as evidence.

    The model's own value is clamped to [0, 90] first, so the result is bounded
    whatever the model said.
    """
    chosen = normalize_horizon_days(model_days)
    floor, reason = horizon_floor_days(text, claim_type)
    if floor > chosen:
        return floor, reason
    return chosen, None


# ---------------------------------------------------------------------------
# The gate
# ---------------------------------------------------------------------------

KEEP = "keep"
RESHAPE = "reshape"
REJECT = "reject"


@dataclass
class Verdict:
    """One claim's fate, with the reason, so the run log explains every drop."""
    status: str
    claim: dict = field(default_factory=dict)
    reason: str = ""
    #: What changed, for the log. Empty when the claim passed untouched.
    changes: list[str] = field(default_factory=list)

    @property
    def kept(self) -> bool:
        return self.status in (KEEP, RESHAPE)


def evaluate_claim(claim: dict) -> Verdict:
    """
    Apply the three rules plus the horizon floor to one normalized claim.

    Expects the keys extract_and_persist_claims already builds: claim_text,
    claim_type, target_symbol, expected_direction, horizon_days. Returns a
    Verdict carrying a possibly-reshaped copy. Never mutates the input.
    """
    if not isinstance(claim, dict):
        return Verdict(REJECT, {}, "not a claim object")

    out = dict(claim)
    changes: list[str] = []
    text = (out.get("claim_text") or "").strip()
    claim_type = (out.get("claim_type") or "").strip().lower()
    direction = (out.get("expected_direction") or "").strip().lower()
    symbol = out.get("target_symbol")
    symbol = symbol.strip().upper() if isinstance(symbol, str) and symbol.strip() else None

    # Rule 1. Text that cannot be contradicted.
    hits = unfalsifiable_hits(text)
    if hits:
        return Verdict(REJECT, out, f"unfalsifiable phrasing: {', '.join(repr(h) for h in hits)}")

    # Rule 2. A direction, or it is a description.
    if direction not in ("bullish", "bearish"):
        return Verdict(
            REJECT, out,
            f"no explicit direction (expected_direction={direction or 'missing'!r})",
        )

    # Rule 3. A target the grader can price, reshaped through a proxy if needed.
    priceable = claim_type in PRICEABLE_TYPES and bool(symbol)
    if not priceable:
        proxy = find_proxy(text)
        if proxy is None:
            vague = _any(_BROAD_MARKET_NON_SUBJECTS, text.lower())
            if vague:
                return Verdict(
                    REJECT, out,
                    f"names the market as a whole ({vague!r}), which is not a "
                    "priceable subject; a broad-index proxy would invent a target "
                    "the claim never made",
                )
            return Verdict(
                REJECT, out,
                "no priceable target and no listed proxy matches the claim",
            )
        proxy_symbol, proxy_type = proxy
        resolved = proxy_direction(proxy_symbol, text, direction)
        if resolved is None:
            return Verdict(
                REJECT, out,
                f"claim maps to the inverting proxy {proxy_symbol} but names both the "
                "rate and the instrument, so its sign cannot be determined",
            )
        changes.append(
            f"target {symbol or 'none'}/{claim_type or 'none'} -> {proxy_symbol}/{proxy_type}"
        )
        if resolved != direction:
            changes.append(f"direction inverted for {proxy_symbol}: {direction} -> {resolved}")
        out["target_symbol"] = proxy_symbol
        out["claim_type"] = proxy_type
        out["expected_direction"] = resolved
        symbol, claim_type, direction = proxy_symbol, proxy_type, resolved

    # Rule 4. Horizon floor.
    asked = normalize_horizon_days(out.get("horizon_days"))
    horizon, reason = classify_horizon_days(text, claim_type, out.get("horizon_days"))
    if horizon != asked:
        changes.append(f"horizon {asked}d -> {horizon}d ({reason})")
    out["horizon_days"] = horizon

    return Verdict(RESHAPE if changes else KEEP, out, "", changes)


def apply_gate(claims: list) -> tuple[list[dict], list[Verdict]]:
    """
    Run every candidate through the gate.

    Returns (kept_claims, all_verdicts). The caller emits exactly what comes
    back and does not backfill to a count: a day that yields two gradeable calls
    emits two, and a day that yields none emits none. Fabricating a call to fill
    a slot is the failure this module exists to prevent.
    """
    verdicts = [evaluate_claim(c) for c in (claims or [])]
    return [v.claim for v in verdicts if v.kept], verdicts
