"""
Wikipedia IDENTITY fetcher and disambiguation guard.

WHY THIS EXISTS
---------------
`companies.description` is NULL on all 4,276 rows. The IDENTITY pillar is
carried today by exactly two sources: 34 hand-written COMPANY_IDENTITY briefs
and Yahoo's `assetProfile.longBusinessSummary`, which only exists for rows that
resolve a ticker. Measured on the 302 thin names that lack IDENTITY, 277 clear a
74-character prose floor on the first paragraph of their English Wikipedia lead
alone. That is 91.7 percent, against 109 for all six other free sources
combined at the same bar.

THE VERBATIM RULE, AND IT IS A CODE-PATH REQUIREMENT
----------------------------------------------------
CC BY-SA 4.0 section 3(b) (ShareAlike) is conditioned on the single clause
"if You Share Adapted Material You produce". Section 1(a) defines Adapted
Material as material in which the Licensed Material is "translated, altered,
arranged, transformed, or otherwise modified". A verbatim lead paragraph is
reproduction "in whole or in part" under section 2(a)(1)(A), so ShareAlike
NEVER FIRES.

The moment anything trims, summarises, re-writes or truncates the paragraph it
becomes Adapted Material, and 3(b)(1) would force Signalera to publish its own
generated identity prose under CC BY-SA 4.0 for competitors to lift.

So: this module stores what the API returned, byte for byte. There is no
truncation, no ellipsis, no whitespace collapse, no sentence-boundary cut and
no maximum length anywhere between `fetch_lead()` and the Postgres write. The
only transform applied to the extract is `strip()` of leading and trailing
whitespace, which is not a modification of the licensed text (section 2(a)(4)
authorises technical modifications necessary to exercise the rights, and
"simply making modifications authorized by this Section 2(a)(4) never produces
Adapted Material"). `assert_verbatim()` below is the enforcement point and the
backfill runner refuses to write a row that fails it.

THE DISAMBIGUATION GUARD, AND IT IS MANDATORY
---------------------------------------------
The naive Wikidata-sitelink path landed on the WRONG ENTITY for 20 of 280
names, 7.1 percent: `Vanguard` to a 1981 arcade game, `Cummins` to a surname
page, `Walt Disney` to the man, `Pershing Square` to a Los Angeles metro
station, `Macquarie` to an Australian electoral division. Shipping without the
guard would put an arcade game's description on /company/vanguard, which is
strictly worse than the empty page it replaces.

Three signals, all returned by the same two API calls that fetch the prose, so
the guard costs no extra requests:

  S1  P31 organisation-class check. The article's Wikidata item must be an
      instance of a class whose CLOSEST root through P279 (subclass of) is an
      organisation root. Closest-root, not mere reachability: `New England
      town` reaches `human settlement` at 2 hops and `organization` at 5, so a
      reachability test accepts `Needham, Massachusetts`. Measured, live.
      A direct P31 of human, family name, given name or a Wikimedia
      housekeeping type vetoes outright.
  S2  Surname and disambiguation text reject. `pageprops.disambiguation`,
      the Wikidata short description, and the lead prose itself are all
      checked for surname / disambiguation / given-name phrasing.
  S3  Typed-name-in-lead check. The name the student typed must appear in the
      first 200 characters of the first paragraph, after normalisation. This
      is what catches parent substitution: `BofA Securities` landing on
      `Bank of America` fails S3 and is not shipped.
  S4  COMMERCIAL term in the Wikidata short description OR in the DEFINING
      CLAUSE of the lead (sentence one, capped). Added after the fresh
      adversarial set shipped `Renaissance` the European historical period on
      S1 alone, and tightened from "organisational" to "commercial" after a
      production dry run shipped `Forterra` the Seattle land-conservation
      nonprofit. It is the one signal that does not share S1's dependence on an
      ontology built for a different question.

      IT READS THE LEAD AS WELL AS THE DESCRIPTION, AND THE FIRST VERSION DID
      NOT. That version's cost was reported as 0.4 percent, measured on the
      302-name census the vocabulary had been fitted to. Measured on 500 FRESH
      production names it was 4.5 percent, and the pages it blocked were pages
      whose own first sentence says what they are: `Oncolytics Biotech Inc. is
      a biotech company` carries no Wikidata description at all. See
      `description_names_a_commercial_organisation` for why the window is
      sentence one and not the paragraph.

VERDICTS
  accept  -> all three signals pass. This is the ONLY verdict that writes.
  review  -> prose exists and looks organisational but one signal is soft.
             NOT shipped. Held for a human.
  reject  -> a signal fired. Never shipped, never stored.

An empty page beats a wrong page. `review` is deliberately not a ship state.

API ETIQUETTE
-------------
Sequential only, no concurrency. A delay floor between every request
(`REQUEST_DELAY_S`). A real contact User-Agent. Batched at the documented
limits (20 titles per extracts call, 50 ids per wbgetentities call) so the
whole 302-name set costs about 40 requests rather than 900. A hard request
budget (`RequestBudget`) that raises rather than silently continuing.

ASCII only. No em-dashes.
"""

from __future__ import annotations

import json
import re
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field, asdict
from typing import Any, Iterable, Sequence

# ---------------------------------------------------------------------------
# Transport
# ---------------------------------------------------------------------------

WIKIPEDIA_API = "https://en.wikipedia.org/w/api.php"
WIKIDATA_API = "https://www.wikidata.org/w/api.php"

# Wikimedia's API etiquette asks for a descriptive User-Agent with a way to
# reach a human. https://meta.wikimedia.org/wiki/User-Agent_policy
USER_AGENT = "Signalera-identity-backfill/1.0 (noahhanning03@gmail.com)"

# Sequential only. This is the floor between requests, not a target.
REQUEST_DELAY_S = 0.4

# Documented batch ceilings for anonymous callers.
EXTRACT_BATCH = 20      # exlimit for prop=extracts
ENTITY_BATCH = 50       # ids per wbgetentities call

HTTP_TIMEOUT_S = 30
MAX_RETRIES = 2         # on 429 / 5xx only, with backoff. Never on 4xx.


class BudgetExceeded(RuntimeError):
    """Raised when a run would exceed its declared outbound request cap."""


@dataclass
class RequestBudget:
    """A hard cap on outbound requests. Raises rather than degrading silently.

    Every caller states a cap. A run that would exceed it stops; it does not
    quietly drop names, because a silently truncated run reports a coverage
    number that is not the number it measured.
    """

    cap: int
    used: int = 0
    log: list[dict[str, Any]] = field(default_factory=list)

    def charge(self, host: str, note: str = "") -> None:
        if self.used >= self.cap:
            raise BudgetExceeded(
                f"outbound request cap of {self.cap} reached (host={host}, note={note})"
            )
        self.used += 1

    def record(self, host: str, status: int, ms: float, note: str = "") -> None:
        self.log.append({"host": host, "status": status, "ms": round(ms, 1), "note": note})

    @property
    def remaining(self) -> int:
        return self.cap - self.used


_last_request_at = 0.0


def _sleep_floor() -> None:
    """Enforce REQUEST_DELAY_S between requests, process-wide and sequential."""
    global _last_request_at
    gap = time.monotonic() - _last_request_at
    if gap < REQUEST_DELAY_S:
        time.sleep(REQUEST_DELAY_S - gap)
    _last_request_at = time.monotonic()


def api_get(endpoint: str, params: dict[str, Any], budget: RequestBudget) -> dict[str, Any]:
    """One sequential, rate-floored, budgeted GET against a MediaWiki API."""
    host = urllib.parse.urlsplit(endpoint).netloc
    query = dict(params)
    query.setdefault("format", "json")
    query.setdefault("formatversion", "2")
    url = endpoint + "?" + urllib.parse.urlencode(query)

    last_error: Exception | None = None
    for attempt in range(MAX_RETRIES + 1):
        budget.charge(host, note=str(params.get("action")))
        _sleep_floor()
        started = time.monotonic()
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        try:
            with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT_S) as resp:
                body = json.loads(resp.read().decode("utf-8"))
                budget.record(host, resp.status, (time.monotonic() - started) * 1000,
                              str(params.get("action")))
                return body
        except urllib.error.HTTPError as exc:
            budget.record(host, exc.code, (time.monotonic() - started) * 1000, "http_error")
            # Back off only on throttling and server faults. A 4xx is our bug.
            if exc.code in (429, 500, 502, 503, 504) and attempt < MAX_RETRIES:
                time.sleep(2.0 * (attempt + 1))
                last_error = exc
                continue
            raise
        except (urllib.error.URLError, TimeoutError) as exc:
            budget.record(host, 0, (time.monotonic() - started) * 1000, "network_error")
            if attempt < MAX_RETRIES:
                time.sleep(2.0 * (attempt + 1))
                last_error = exc
                continue
            raise
    raise RuntimeError(f"unreachable retry exit: {last_error}")


# ---------------------------------------------------------------------------
# Normalisation shared by the guard signals
# ---------------------------------------------------------------------------

_LEGAL_SUFFIX_RE = re.compile(
    r"[\s,]+(?:inc|inc\.|incorporated|corp|corp\.|corporation|co|co\.|company|"
    r"llc|l\.l\.c\.|ltd|ltd\.|limited|plc|p\.l\.c\.|lp|l\.p\.|llp|l\.l\.p\.|"
    r"sca|s\.c\.a\.|sa|s\.a\.|nv|n\.v\.|ag|gmbh|ab|as|a\/s|oyj|spa|s\.p\.a\.|"
    r"pty|bv|b\.v\.|kk|k\.k\.|sarl|s\.a\.r\.l\.)$",
    re.IGNORECASE,
)


def normalise_for_match(text: str) -> str:
    """Fold a name or a lead sentence into a comparable form.

    Diacritics folded, ampersand spelled out, punctuation dropped, whitespace
    collapsed, lowercased. This touches only the COMPARISON copy. The stored
    and rendered paragraph is never passed through here.
    """
    folded = unicodedata.normalize("NFKD", text)
    folded = "".join(ch for ch in folded if not unicodedata.combining(ch))
    folded = folded.replace("&", " and ")
    folded = re.sub(r"[‐-―−]", "-", folded)
    folded = re.sub(r"[‘’‛′]", "'", folded)
    folded = re.sub(r"[^0-9a-zA-Z]+", " ", folded)
    return re.sub(r"\s+", " ", folded).strip().lower()


def strip_legal_suffix(name: str) -> str:
    """Drop one trailing legal-form token so `Cinven Limited` matches `Cinven`."""
    out = name.strip()
    for _ in range(2):
        stripped = _LEGAL_SUFFIX_RE.sub("", out).strip()
        if stripped == out or len(stripped) < 3:
            break
        out = stripped
    return out


def first_paragraph(extract: str) -> str:
    """The first paragraph of an `exintro&explaintext` extract, VERBATIM.

    `exintro` returns the whole lead section, which is often several
    paragraphs. The first paragraph is the conservative reading of "lead
    paragraph" and it is what the 342-character median was measured on.

    This SELECTS a paragraph. It does not shorten one. The returned string is
    a prefix of the extract up to the first blank line, with surrounding
    whitespace stripped, and nothing inside it is altered. There is no length
    cap here and there must never be one.
    """
    if not extract:
        return ""
    for block in re.split(r"\n\s*\n", extract.strip()):
        candidate = block.strip()
        if candidate:
            return candidate
    return ""


def paragraphs(extract: str) -> list[str]:
    """Every blank-line-delimited paragraph of an extract, stripped, in order.

    `first_paragraph()` returns element 0 of this list. The list itself is what
    `assert_verbatim()` matches against, because BOUNDARY ALIGNMENT is the
    property that separates a reproduction from an excerpt of an excerpt.
    """
    if not extract:
        return []
    return [block.strip() for block in re.split(r"\n\s*\n", extract.strip()) if block.strip()]


class VerbatimViolation(RuntimeError):
    """Raised when a paragraph about to be stored is not what was fetched."""


def assert_verbatim(stored: str, *, source_extract: str) -> None:
    """THE ENFORCEMENT POINT for the licence rule.

    `stored` must be a WHOLE paragraph of `source_extract`, byte for byte.
    A trimmed, ellipsised, re-wrapped, re-normalised or model-rewritten string
    fails here and the backfill refuses to write it.

    TWO THINGS ABOUT THIS SIGNATURE, BOTH LEARNED FROM DEFECTS IT SHIPPED WITH.

    `source_extract` IS KEYWORD-ONLY. The previous version took it positionally
    and the runner called `assert_verbatim(result.paragraph, result.paragraph)`,
    passing the same value twice. Containment of a string in itself is
    unconditionally true, so the gate accepted a truncation, a full model
    rewrite, an NFD re-normalisation and an NBSP collapse, and the test suite
    stayed green because the tests alone called it with two different values.
    Naming the argument makes that call read as the absurdity it is. The
    load-bearing fix is structural and lives in `storage_payload()`, which now
    reads BOTH values off one `Adjudication` so no caller can supply either.

    IT MATCHES A PARAGRAPH AND NOT A SUBSTRING. The previous version asked
    `stored in source_extract`, which is true of every bare prefix, so a
    truncation to any length passed. `test_assert_verbatim_rejects_a_slice`
    claimed to cover that and passed for an unrelated reason: it cut at index
    80 of a fixture whose character 79 is a space, so the edge-whitespace rule
    fired and the containment rule was never exercised. Cutting at 79 or 81
    sailed through. Paragraph equality has no such accident in it.
    """
    if not stored:
        raise VerbatimViolation("empty paragraph")
    if not source_extract:
        raise VerbatimViolation("no source extract to compare against")
    if stored != stored.strip():
        raise VerbatimViolation("paragraph carries edge whitespace")
    for marker in ("…", "..."):
        if stored.endswith(marker):
            raise VerbatimViolation(f"paragraph ends in a truncation marker: {marker!r}")
    blocks = paragraphs(source_extract)
    if stored not in blocks:
        detail = "is not a whole paragraph of the fetched extract"
        if stored in source_extract:
            detail = ("is a partial slice of a paragraph, not the paragraph "
                      f"({len(stored)} chars)")
        raise VerbatimViolation(f"paragraph {detail}")


# ---------------------------------------------------------------------------
# S1. P31 organisation-class check
# ---------------------------------------------------------------------------
#
# THREE TIERS, and the tiering is the whole trick. A flat "does this class reach
# an organisation root" test ACCEPTS `Needham, Massachusetts`, measured live:
# the class `New England town` (Q2154459) reaches `human settlement` at 2 hops
# and `organization` at 5, because Wikidata models municipalities as a kind of
# organisation. Plain reachability is therefore not a usable signal. The rule
# that works is CLOSEST ROOT WINS.
#
#   VETO_QIDS       a direct P31 here ends the check, whatever else is present.
#                   These are the classes where the article simply is not about
#                   an organisation at all: a person, a surname list, a
#                   disambiguation page.
#   ORG_ROOT_QIDS   reaching one of these makes a class organisational.
#   NON_ORG_ROOT_QIDS  reaching one of these makes a class disqualifying.
#
# Per class: walk P279 up to CLASS_WALK_DEPTH, take the minimum hop distance to
# any org root and to any non-org root, and let the CLOSER one decide. Ties go
# to non-org, because an empty page beats a wrong page.
#
# Across a page's whole P31 set: a veto beats everything, then any org class
# wins. A company that ships software is P31 {business, software}; rejecting it
# for the second value would drop `Harvey (software)`, a real company article,
# measured live.

ORG_ROOT_QIDS = {
    "Q43229",     # organization
    "Q4830453",   # business
    "Q783794",    # company
    "Q6881511",   # enterprise
    "Q167037",    # corporation
    "Q79913",     # non-governmental organization
    "Q327333",    # government agency
    "Q22687",     # bank
    "Q1664720",   # institute
    "Q3918",      # university
}

# A direct P31 in this set ends the check. Every one of these was observed on
# the naive Wikidata-sitelink path in the 302-name census.
VETO_QIDS = {
    "Q5",          # human                    (Walt Disney -> the man,
                   #                           Slash -> the musician,
                   #                           Jane Street -> a labor organizer,
                   #                           Edward Jones -> a British Army officer)
    "Q101352",     # family name              (Cummins, Schlumberger, Harvey,
                   #                           Ledger, Pilot, Uzum -> surname pages)
    "Q12308941",   # male given name
    "Q11879590",   # female given name
    "Q3409032",    # unisex given name
    "Q4167410",    # Wikimedia disambiguation page
    "Q13406463",   # Wikimedia list article
    "Q4167836",    # Wikimedia category
    "Q11266439",   # Wikimedia template
    "Q15407973",   # Wikimedia disambiguation category
    "Q17362920",   # Wikimedia duplicated page
    "Q22808320",   # Wikimedia human name disambiguation page
}

# Reaching one of these disqualifies a class. Direct membership disqualifies at
# hop 0, which is why `Vanguard (video game)` and `Pershing Square station` stop
# here rather than needing a walk.
NON_ORG_ROOT_QIDS = {
    "Q7889",       # video game               (Vanguard -> 1981 arcade game,
                   #                           Perplexity -> 1990 video game)
    "Q1755420",    # arcade game
    "Q7397",       # software                 (Coherent -> an operating system)
    "Q235557",     # file format              (Zip -> ZIP the archive format)
    "Q928830",     # metro station            (Pershing Square -> LA Metro stop)
    "Q55488",      # railway station
    "Q719456",     # station
    "Q192611",     # electoral district       (Macquarie -> an Australian division)
    "Q486972",     # human settlement         (Needham -> a town in Massachusetts)
    "Q56061",      # administrative territorial entity
    "Q5398426",    # television series        (Udaan -> an Indian social drama)
    "Q11424",      # film
    "Q571",        # book
    "Q482994",     # album
    "Q7366",       # song
    "Q838948",     # work of art              (Tapestry -> woven textile art)
    "Q735",        # art
    "Q2424752",    # product
    "Q2095",       # food                     (Granola -> the breakfast cereal)
    "Q34770",      # language
    "Q23442",      # island
    "Q8502",       # mountain
    "Q4022",       # river
    "Q1656682",    # event
    "Q11862829",   # academic discipline
    # Wikidata models a MOVEMENT as a kind of organisation, so a reachability
    # test on `Renaissance` lands on the historical period and calls it a firm.
    # Measured live on the fresh set: this is the same modelling artifact as
    # `New England town`, one branch over.
    "Q2198855",    # cultural movement        (Renaissance -> the historical period)
    "Q968159",     # art movement
    "Q49773",      # social movement
    "Q11514315",   # historical period
    "Q186081",     # time interval
    "Q178885",     # deity                    (Apollo, Ares, Janus)
    "Q523",        # star                     (Antares)
    "Q16521",      # taxon                    (Starling, Walleye, Appaloosa)
    "Q11344",      # chemical element         (Atom)
}

CLASS_WALK_DEPTH = 4


def _claim_values(entity: dict[str, Any], prop: str) -> list[str]:
    """Item-valued claim targets for one property, deprecated ranks dropped."""
    out: list[str] = []
    for claim in (entity.get("claims") or {}).get(prop, []) or []:
        if claim.get("rank") == "deprecated":
            continue
        snak = claim.get("mainsnak") or {}
        if snak.get("snaktype") != "value":
            continue
        value = (snak.get("datavalue") or {}).get("value") or {}
        qid = value.get("id")
        if qid:
            out.append(qid)
    return out


def fetch_entities(qids: Sequence[str], budget: RequestBudget,
                   props: str = "claims|labels") -> dict[str, dict[str, Any]]:
    """wbgetentities, batched at the documented 50-id ceiling."""
    out: dict[str, dict[str, Any]] = {}
    unique = [q for q in dict.fromkeys(qids) if q]
    for i in range(0, len(unique), ENTITY_BATCH):
        chunk = unique[i:i + ENTITY_BATCH]
        body = api_get(
            WIKIDATA_API,
            {"action": "wbgetentities", "ids": "|".join(chunk),
             "props": props, "languages": "en"},
            budget,
        )
        for qid, entity in (body.get("entities") or {}).items():
            if not entity.get("missing"):
                out[qid] = entity
    return out


class ClassGraph:
    """P31 -> organisation resolution, with a cache so prod runs cost nothing.

    The class graph is small and static: the 302-name census saw 111 distinct
    P31 classes across the whole set. Resolve each one once, persist the
    verdict, and every later run answers from the cache with zero requests.
    """

    def __init__(self, cache: dict[str, Any] | None = None):
        raw = cache or {}
        self.verdicts: dict[str, str] = dict(raw.get("verdicts") or {})
        self.labels: dict[str, str] = dict(raw.get("labels") or {})

    def to_cache(self) -> dict[str, Any]:
        return {"verdicts": self.verdicts, "labels": self.labels}

    def resolve(self, classes: Iterable[str], budget: RequestBudget) -> None:
        """Populate a verdict for every class not already cached.

        Verdict vocabulary: veto | org | nonorg | unknown.
        """
        pending: list[str] = []
        for qid in dict.fromkeys(classes):
            if not qid or qid in self.verdicts:
                continue
            if qid in VETO_QIDS:
                self.verdicts[qid] = "veto"
            elif qid in ORG_ROOT_QIDS:
                self.verdicts[qid] = "org"
            elif qid in NON_ORG_ROOT_QIDS:
                self.verdicts[qid] = "nonorg"
            else:
                pending.append(qid)
        if not pending:
            return

        # Breadth-first over P279, one batched wbgetentities call per level per
        # 50 classes. `hop[start][node]` is the shortest distance found.
        hops: dict[str, dict[str, int]] = {q: {q: 0} for q in pending}
        frontier: dict[str, list[str]] = {q: [q] for q in pending}
        for depth in range(CLASS_WALK_DEPTH):
            level = sorted({q for nodes in frontier.values() for q in nodes})
            if not level:
                break
            entities = fetch_entities(level, budget)
            parents: dict[str, list[str]] = {}
            for qid in level:
                entity = entities.get(qid)
                if not entity:
                    parents[qid] = []
                    continue
                label = ((entity.get("labels") or {}).get("en") or {}).get("value")
                if label:
                    self.labels[qid] = label
                parents[qid] = _claim_values(entity, "P279")
            next_frontier: dict[str, list[str]] = {}
            for start, nodes in frontier.items():
                seen = hops[start]
                advance: list[str] = []
                for node in nodes:
                    for parent in parents.get(node, []):
                        if parent in seen:
                            continue
                        seen[parent] = depth + 1
                        # A root ends this branch; nothing above it can be closer.
                        if parent not in ORG_ROOT_QIDS and parent not in NON_ORG_ROOT_QIDS \
                                and parent not in VETO_QIDS:
                            advance.append(parent)
                if advance:
                    next_frontier[start] = advance
            frontier = next_frontier

        for qid in pending:
            self.verdicts[qid] = self._closest_root(hops[qid])

    @staticmethod
    def _closest_root(distances: dict[str, int]) -> str:
        """CLOSEST ROOT WINS. Ties go to non-org: an empty page beats a wrong one."""
        d_org = min((d for q, d in distances.items() if q in ORG_ROOT_QIDS), default=None)
        d_non = min((d for q, d in distances.items()
                     if q in NON_ORG_ROOT_QIDS or q in VETO_QIDS), default=None)
        if d_org is None and d_non is None:
            return "unknown"
        if d_non is None:
            return "org"
        if d_org is None:
            return "nonorg"
        return "org" if d_org < d_non else "nonorg"

    def classify(self, p31: Sequence[str]) -> str:
        """org | reject | unknown, for a page's whole P31 set.

        A veto beats everything. Otherwise any organisational class wins, so a
        company that also carries a product class still reads as a company:
        `Harvey (software)` is P31 {company, software} and is a real company
        article.
        """
        if not p31:
            return "unknown"
        verdicts = [self.verdicts.get(q, "unknown") for q in p31]
        if "veto" in verdicts:
            return "reject"
        if "org" in verdicts:
            return "org"
        if "nonorg" in verdicts:
            return "reject"
        return "unknown"


# ---------------------------------------------------------------------------
# S2. Surname and disambiguation text reject
# ---------------------------------------------------------------------------

# Matched against the Wikidata short description (`pageterms`) and the lead.
_DISAMBIG_DESC_RE = re.compile(
    r"\b(?:surname|family name|given name|forename|patronymic|"
    r"disambiguation|topics? referred to by the same term|"
    r"wikimedia (?:disambiguation|list|category|template)|"
    r"list of\b|name list)\b",
    re.IGNORECASE,
)

# Matched against the first paragraph. These are the stock openings MediaWiki
# uses for set-index, surname and disambiguation pages.
_DISAMBIG_LEAD_RE = re.compile(
    r"may refer to|may also refer to|is a surname|is an? (?:English|Irish|Scottish|"
    r"German|Dutch|French|Welsh|Italian|Spanish|Swedish|Norwegian|Danish|Polish|"
    r"Jewish|Latin|Hebrew|Arabic|Chinese|Japanese|Korean|Indian)?\s*(?:family name|surname|"
    r"given name|masculine given name|feminine given name|male given name|"
    r"female given name|unisex given name)|"
    r"is a list of|the following is a list|"
    r"notable people with (?:the|this) (?:surname|name)|"
    r"people with the surname|"
    r"is the name of several|can refer to",
    re.IGNORECASE,
)


def surname_or_disambiguation(*, is_disambig_pageprop: bool, short_description: str,
                              lead_text: str) -> tuple[bool, str]:
    """S2. Returns (fired, reason)."""
    if is_disambig_pageprop:
        return True, "pageprops.disambiguation"
    match = _DISAMBIG_DESC_RE.search(short_description or "")
    if match:
        return True, f"wikidata_description:{match.group(0).lower()}"
    match = _DISAMBIG_LEAD_RE.search((lead_text or "")[:400])
    if match:
        return True, f"lead_text:{match.group(0).lower()}"
    reason = list_header_reason(first_paragraph(lead_text or ""))
    if reason:
        return True, reason
    return False, ""


def list_header_reason(paragraph: str) -> str:
    """A PARAGRAPH THAT ENDS IN A COLON IS ANNOUNCING A LIST, NOT DESCRIBING A
    COMPANY. Returns a reason string, or "" when the paragraph is prose.

    THIS IS THE `Hyundai` DEFECT AND IT IS WORTH ITS OWN RULE. Measured live:
    the `Hyundai` article's lead paragraph is 119 characters, which clears the
    74-character identity floor. Its P31 is a conglomerate, so S1 passes. It is
    not flagged as a disambiguation page, so S2 passed. Its own name is in the
    first sentence, so S3 passes. Its Wikidata description says "multinational
    conglomerate headquartered in Seoul", so S4 passes. Four signals, zero
    reasons, verdict `accept`, and what it would have shipped onto
    /company/hyundai is:

        Hyundai is a former South Korean industrial conglomerate ("chaebol"),
        which was restructured into the following groups:

    That is a set-index page written as prose. Every content word the page has
    is in the list that follows the colon, and the paragraph selector stops at
    the colon by design because the list is not a paragraph. No signal built on
    what the page IS can see this, because the page is about a real
    conglomerate. It is the paragraph's SHAPE that is wrong.

    Also caught: the "may refer to" family that MediaWiki renders without the
    disambiguation pageprop, and any lead whose only sentence promises a list.
    """
    para = (paragraph or "").strip()
    if not para:
        return ""
    if para.endswith(":"):
        return f"lead_paragraph_is_a_list_header:{para[-60:]!r}"
    if re.search(r"\b(?:the following|listed below|as follows)\b\s*[:.]?\s*$", para,
                 re.IGNORECASE):
        return "lead_paragraph_promises_a_list_it_does_not_contain"
    return ""


# ---------------------------------------------------------------------------
# S4. COMMERCIAL term in the Wikidata short description
# ---------------------------------------------------------------------------
#
# The free fourth signal. `pageterms` rides along in the same extracts call, so
# it costs nothing, and it is written by a human to say what the thing IS.
#
# WHY IT IS REQUIRED AND NOT ADVISORY. S1 is a walk over an ontology that was
# not built for this question and it will keep producing surprises: municipality
# and cultural movement both reach `organization`. S4 is the independent check
# that does not share that failure mode. `Renaissance` shipped the European
# historical period on S1 alone, measured live on a fresh adversarial set.
#
# WHY THE BAR IS COMMERCIAL AND NOT MERELY ORGANISATIONAL. Measured on a
# 120-row production dry run: the `Forterra` row, whose own sector is
# "Aerospace & Defense", landed on Forterra the Seattle LAND CONSERVATION
# NONPROFIT. It is an organisation, its lead contains "Forterra", it is not a
# disambiguation page and its Wikidata description says "organization". All
# four signals passed on an organisation-level bar. Signalera's universe is
# firms, so the bar is a COMMERCIAL term: company, firm, bank, manufacturer,
# fund, manager, platform, service, and so on. `organization`, `institution`,
# `agency`, `association`, `university` and `nonprofit` are NOT sufficient on
# their own.
#
# CALIBRATION, offline, against the 302-name hand-adjudicated census
# (/Users/noahhanning/t2-out/work/step1_sitelinks.json crossed with
# item6_wikipedia_census_302.json): of the 238 names whose census verdict is
# `accept` AND whose naive sitelink title equals the adjudicated final title,
# 237 carry a short description that matches this vocabulary. The one that does
# not is `Replit`, described as "Online IDE", where the description describes
# the PRODUCT rather than the company. It falls to `review`, not to a wrong
# page. 0 of 238 had an empty description.
#
# That is a 0.4 percent coverage cost, and it is the correct trade because the
# standing test is asymmetric: a page asserting something false is a failure and
# a missing page is merely no gain.

_COMMERCIAL_TERM_RE = re.compile(
    r"\b(?:compan(?:y|ies)|corporation|corporate|incorporated|firm|business|"
    r"enterprise|conglomerate|bank|banking|insurer|insurance|brokerage|broker|"
    r"manufacturer|manufacturing|retailer|producer|provider|operator|developer|"
    r"publisher|carrier|airline|utility|chain|startup|start-up|"
    r"group|holding|holdings|subsidiary|joint venture|partnership|llc|plc|"
    r"management|manager|advisor|adviser|advisory|investor|fund|"
    r"private equity|venture capital|hedge fund|investment|trading|securities|"
    r"consultancy|consulting|contractor|studio|label|marketplace|platform|network|"
    r"professional services|service|services|maker|vendor|supplier|dealer|exchange|"
    r"clearing|bureau|software|app|brand)\b",
    re.IGNORECASE,
)


# The defining clause of a lead: "X is a <what it is>". Sentence one and no
# further, capped. THE CAP AND THE SENTENCE BOUND ARE BOTH LOAD-BEARING AND WERE
# BOTH MEASURED. Reading the whole paragraph admits `KBRA`, a radio station in
# Freer, Texas that clears S1, S2 and S3 on a production row meaning Kroll Bond
# Rating Agency: its first sentence says "radio station", and "Cobra
# Broadcasting, LLC" appears one sentence later. Sentence one blocks it; the
# paragraph does not.
S4_LEAD_CLAUSE_CHARS = 300

# Abbreviations that end in a period and do not end a sentence. Without these,
# "Expedia Inc. is an American online travel agency" truncates at "Expedia Inc."
# and the defining clause is never read.
_SENTENCE_END_RE = re.compile(
    r"(?<!\b[A-Z])"
    r"(?<!\bInc)(?<!\bCorp)(?<!\bCo)(?<!\bLtd)(?<!\bPlc)(?<!\bSt)(?<!\bJr)(?<!\bSr)"
    r"(?<!\bLLC)(?<!\bL\.P)(?<!\bS\.A)(?<!\bN\.V)(?<!\bA\.G)(?<!\bPty)(?<!\bBhd)"
    r"(?<!\bU\.S)(?<!\bU\.K)(?<!\bNo)(?<!\bvs)(?<!\betc)(?<!\bapprox)"
    r"\.\s+(?=[A-Z0-9])"
)


# A relative clause describes something OTHER than the subject's category, so
# it is cut before S4 reads. MEASURED, NOT TASTE: the `Federal Open Market
# Committee` lead opens "is a committee within the Federal Reserve System" and
# then says "that is charged under United States law with overseeing the
# nation's open market operations (e.g., the Fed's buying and selling of United
# States Treasury securities)". The word "securities" is a thing the committee
# trades, not a thing it is, and on the full sentence it admitted a Federal
# Reserve committee as a commercial firm.
_RELATIVE_CLAUSE_RE = re.compile(r"[;:]|\s(?:that|which|who|whose|where)\s", re.IGNORECASE)


def defining_clause(lead_text: str, cap: int = S4_LEAD_CLAUSE_CHARS) -> str:
    """The COPULA CLAUSE of a lead: sentence one, minus its relative clauses.

    "X is a <category>" and nothing after the point where the sentence stops
    saying what X is and starts saying what X does or where X lives.

    Comparison copy only. This never touches the stored or rendered paragraph.
    It builds a short string for S4 to read and throws it away.
    """
    para = first_paragraph(lead_text or "")
    if not para:
        return ""
    match = _SENTENCE_END_RE.search(para[:cap + 120])
    clause = para[: match.start() + 1] if match else para
    cut = _RELATIVE_CLAUSE_RE.search(clause)
    if cut:
        clause = clause[: cut.start()]
    return clause[:cap]


def description_names_a_commercial_organisation(
    short_description: str, lead_text: str = "",
) -> tuple[bool, str]:
    """S4. Returns (passes, reason).

    TWO PLACES ARE READ, AND THE SECOND ONE IS THE FIX. The Wikidata short
    description first, then the DEFINING CLAUSE of the lead: sentence one of the
    first paragraph, capped at `S4_LEAD_CLAUSE_CHARS`.

    WHY THE LEAD IS READ AT ALL. S4 shipped reading the short description and
    nothing else, and the cost of that was reported as 0.4 percent because it
    was measured on the 302-name census the vocabulary had been fitted to.
    Measured on 500 FRESH production names, the pages it blocks are pages whose
    own first sentence says what they are in plain words: `Oncolytics Biotech
    Inc. is a biotech company` carries no Wikidata description at all, and
    `Expedia Inc. is an American online travel agency owned by Expedia Group` is
    described as a "travel website". Blocking a firm because a volunteer wrote
    a product noun into a one-line field is not a licence or correctness
    property, it is a data-entry accident.

    WHY SENTENCE ONE AND NOT THE PARAGRAPH. Measured: reading the whole
    paragraph admits `KBRA`, a Texas radio station that clears S1, S2 and S3 on
    a row that means Kroll Bond Rating Agency, on the words "Cobra Broadcasting,
    LLC" in its second sentence. Its first sentence says "radio station". The
    defining clause is where a lead states its category; everything after it is
    where a lead mentions other people's categories.

    WHAT DOES NOT CHANGE. The bar is still COMMERCIAL and not merely
    organisational, which is what holds the Forterra land-conservation nonprofit
    and, measured fresh, the Federal Open Market Committee, Major League
    Baseball and the National Football League. An absent short description is no
    longer an automatic hold, but it is not a pass either: the lead still has to
    say a commercial word.
    """
    text = (short_description or "").strip()
    if text:
        match = _COMMERCIAL_TERM_RE.search(text)
        if match:
            return True, ""
    clause = defining_clause(lead_text)
    if clause:
        match = _COMMERCIAL_TERM_RE.search(clause)
        if match:
            return True, ""
    if not text:
        return False, "S4_no_short_description_and_lead_names_no_commercial_form"
    return False, f"S4_neither_description_nor_lead_is_commercial:{text[:60]}"


# ---------------------------------------------------------------------------
# S3. Typed-name-in-lead check
# ---------------------------------------------------------------------------

NAME_IN_LEAD_WINDOW = 200


def name_in_lead(typed_name: str, lead_text: str,
                 window: int = NAME_IN_LEAD_WINDOW) -> tuple[bool, bool]:
    """S3. Returns (in_window, in_first_paragraph).

    The window read is what an `accept` requires. The wider read exists only so
    a soft miss can be routed to `review` instead of being silently dropped;
    `review` never ships.

    Matching is on the normalised forms so `Rothschild & Co` matches
    `Rothschild & Co SCA`, and the typed name's legal suffix is stripped so
    `Cinven` matches `Cinven Limited`.
    """
    needle = normalise_for_match(strip_legal_suffix(typed_name))
    if not needle:
        return False, False
    para = first_paragraph(lead_text)
    full = normalise_for_match(para)
    # Normalise the window on the RAW paragraph prefix, not on the normalised
    # string, so the 200-character budget is measured in source characters.
    windowed = normalise_for_match(para[:window])
    return (needle in windowed), (needle in full)


# ---------------------------------------------------------------------------
# Fetch: one batched call returns the prose and every guard signal
# ---------------------------------------------------------------------------

@dataclass
class PageFetch:
    """Everything one article contributes, from a single batched API call."""
    requested_title: str
    resolved_title: str | None = None
    pageid: int | None = None
    revid: int | None = None
    qid: str | None = None
    short_description: str = ""
    is_disambig_pageprop: bool = False
    extract: str = ""
    missing: bool = False
    redirected_from: str | None = None


def fetch_pages(titles: Sequence[str], budget: RequestBudget) -> dict[str, PageFetch]:
    """Lead extract + wikibase id + short description + revid, batched.

    One request per 20 titles. `prop=extracts|pageprops|pageterms|revisions`
    means the prose and two of the three guard signals arrive together; the
    third (P31) needs the Wikidata call that the qid feeds. Redirects are
    followed so `Cinven Limited` resolves to `Cinven`.
    """
    out: dict[str, PageFetch] = {}
    unique = [t for t in dict.fromkeys(titles) if t]
    for i in range(0, len(unique), EXTRACT_BATCH):
        chunk = unique[i:i + EXTRACT_BATCH]
        body = api_get(
            WIKIPEDIA_API,
            {
                "action": "query",
                "prop": "extracts|pageprops|pageterms|revisions",
                "titles": "|".join(chunk),
                "redirects": "1",
                "exintro": "1",
                "explaintext": "1",
                "exlimit": str(EXTRACT_BATCH),
                "ppprop": "wikibase_item|disambiguation",
                "wbptterms": "description",
                "rvprop": "ids",
            },
            budget,
        )
        query = body.get("query") or {}

        # Map every requested title through normalisation and redirects so the
        # caller can look up by what it asked for.
        alias: dict[str, str] = {}
        for entry in query.get("normalized") or []:
            alias[entry["from"]] = entry["to"]
        redirect_source: dict[str, str] = {}
        for entry in query.get("redirects") or []:
            redirect_source[entry["to"]] = entry["from"]
            alias[entry["from"]] = entry["to"]

        by_title: dict[str, PageFetch] = {}
        for page in query.get("pages") or []:
            title = page.get("title") or ""
            fetched = PageFetch(requested_title=title, resolved_title=title)
            if page.get("missing"):
                fetched.missing = True
                by_title[title] = fetched
                continue
            fetched.pageid = page.get("pageid")
            revisions = page.get("revisions") or []
            if revisions:
                fetched.revid = revisions[0].get("revid")
            pageprops = page.get("pageprops") or {}
            fetched.qid = pageprops.get("wikibase_item")
            fetched.is_disambig_pageprop = "disambiguation" in pageprops
            terms = page.get("terms") or {}
            descriptions = terms.get("description") or []
            fetched.short_description = descriptions[0] if descriptions else ""
            fetched.extract = page.get("extract") or ""
            fetched.redirected_from = redirect_source.get(title)
            by_title[title] = fetched

        for requested in chunk:
            final = alias.get(requested, requested)
            found = by_title.get(final)
            if found is None:
                # MediaWiki title-cases the first letter; try that form.
                found = by_title.get(final[:1].upper() + final[1:] if final else final)
            if found is None:
                out[requested] = PageFetch(requested_title=requested, missing=True)
            else:
                clone = PageFetch(**{**asdict(found), "requested_title": requested})
                out[requested] = clone
    return out


# ---------------------------------------------------------------------------
# Adjudication
# ---------------------------------------------------------------------------

# The scorer's IDENTITY floor: 74 characters of prose that actually resolves.
IDENTITY_FLOOR_CHARS = 74

LICENSE_NAME = "CC BY-SA 4.0"
LICENSE_URL = "https://creativecommons.org/licenses/by-sa/4.0/"


@dataclass
class Adjudication:
    name: str
    verdict: str                      # accept | review | reject
    reasons: list[str] = field(default_factory=list)
    title: str | None = None
    qid: str | None = None
    revid: int | None = None
    p31: list[str] = field(default_factory=list)
    p31_class: str = "unknown"        # org | reject | unknown
    short_description: str = ""
    paragraph: str = ""               # VERBATIM. Never trimmed.
    # THE EXTRACT `paragraph` WAS SELECTED FROM, carried so the verbatim gate
    # has something real to compare against. Its absence is why the runner's
    # gate degenerated into `assert_verbatim(paragraph, paragraph)`: the
    # dataclass asserted a property in a field comment that nothing on it could
    # enforce. A guard needs the other side of the comparison in hand.
    source_extract: str = ""
    paragraph_chars: int = 0
    clears_floor: bool = False
    name_in_window: bool = False
    name_in_paragraph: bool = False
    description_is_organisational: bool = False

    @property
    def source_url(self) -> str | None:
        if not self.title:
            return None
        return "https://en.wikipedia.org/wiki/" + urllib.parse.quote(
            self.title.replace(" ", "_"), safe="_(),!$*:/-"
        )


def adjudicate(name: str, page: PageFetch, p31: Sequence[str],
               graph: ClassGraph) -> Adjudication:
    """Run all three guard signals over one fetched page.

    Order matters only for readability of the reason list; every signal is
    evaluated so the report can show which ones fired.
    """
    result = Adjudication(name=name, verdict="reject", title=page.resolved_title,
                          qid=page.qid, revid=page.revid, p31=list(p31),
                          short_description=page.short_description)

    if page.missing or not page.extract.strip():
        result.reasons.append("no_article")
        return result

    para = first_paragraph(page.extract)
    result.paragraph = para
    result.source_extract = page.extract
    result.paragraph_chars = len(para)
    result.clears_floor = len(para) >= IDENTITY_FLOOR_CHARS

    # S2 first: it is the cheapest and it is the one that catches the pages
    # where the other two signals are meaningless.
    fired, reason = surname_or_disambiguation(
        is_disambig_pageprop=page.is_disambig_pageprop,
        short_description=page.short_description,
        lead_text=para,
    )
    if fired:
        result.reasons.append(f"S2_disambiguation:{reason}")

    # S1.
    result.p31_class = graph.classify(p31)
    if result.p31_class == "reject":
        labels = ",".join(graph.labels.get(q, q) for q in p31) or "none"
        result.reasons.append(f"S1_not_organisation:{labels}")
    elif result.p31_class == "unknown":
        result.reasons.append("S1_class_unresolved")

    # S3.
    in_window, in_para = name_in_lead(name, para)
    result.name_in_window = in_window
    result.name_in_paragraph = in_para
    if not in_para:
        result.reasons.append("S3_name_absent_from_lead")
    elif not in_window:
        result.reasons.append("S3_name_outside_200char_window")

    # S4. The lead is passed as well as the description; S4 reads only its
    # defining clause, and only when the description did not already answer.
    s4_ok, s4_reason = description_names_a_commercial_organisation(
        page.short_description, para)
    result.description_is_organisational = s4_ok
    if not s4_ok:
        result.reasons.append(s4_reason)

    if not result.clears_floor:
        result.reasons.append(f"below_identity_floor:{result.paragraph_chars}")

    # Hard reasons reject outright. Soft reasons hold for a human and NEVER
    # ship. The split matters only for the report; neither state writes a row.
    #
    # S4 disagreeing with an S1 that says `org` is a HOLD, not a reject: two
    # independent signals disagree and a human should look. That is where the
    # Forterra land-conservation nonprofit lands, and where `Replit`, a real
    # company described as "Online IDE", lands too. When S1 also fails, both
    # signals agree it is not a commercial organisation and the reject is safe.
    hard_reasons = ["S2_", "S1_not_organisation", "S3_name_absent", "below_identity_floor"]
    if result.p31_class != "org":
        # PREFIX, NOT THE OLD FULL REASON STRING. S4 emits two failure reasons
        # now (no description at all, and neither source commercial), and the
        # previous line matched only one of them by name. A reason list that a
        # verdict rule matches by exact string is a rule that silently stops
        # firing the day the string changes.
        hard_reasons.append("S4_")
    hard = any(r.startswith(tuple(hard_reasons)) for r in result.reasons)
    if hard:
        result.verdict = "reject"
    elif result.reasons:
        # Soft only: unresolved class, or the name sitting past the window.
        # Held for a human. NEVER shipped.
        result.verdict = "review"
    else:
        result.verdict = "accept"
    return result


def resolve_identity(names_to_titles: dict[str, str], budget: RequestBudget,
                     graph: ClassGraph,
                     display_names: dict[str, str] | None = None) -> dict[str, Adjudication]:
    """End to end for a batch: fetch, classify, adjudicate.

    `names_to_titles` maps a lookup KEY to the candidate article title (from the
    Wikidata sitelink, or the name itself). `display_names` optionally maps that
    key to the name a student would actually type, which is what S3 checks
    against. The repair pass needs the split because it tries several candidate
    titles for one name in a single batch, so the key cannot be the name.
    """
    pages = fetch_pages(list(names_to_titles.values()), budget)
    by_name = {name: pages.get(title, PageFetch(requested_title=title, missing=True))
               for name, title in names_to_titles.items()}

    qids = [p.qid for p in by_name.values() if p.qid]
    entities = fetch_entities(qids, budget, props="claims") if qids else {}
    p31_by_qid = {qid: _claim_values(entity, "P31") for qid, entity in entities.items()}

    all_classes = {c for classes in p31_by_qid.values() for c in classes}
    graph.resolve(all_classes, budget)

    labels = display_names or {}
    return {
        key: adjudicate(labels.get(key, key), page,
                        p31_by_qid.get(page.qid or "", []), graph)
        for key, page in by_name.items()
    }


# ---------------------------------------------------------------------------
# Repair. Every candidate goes through the SAME guard, so a repair can never
# ship a page the guard would have rejected.
# ---------------------------------------------------------------------------

# Ordered cheapest-first. Stage 1 is batched 20 candidates to a request, so
# expanding 60 held names costs about a dozen requests rather than 60.
CANDIDATE_SUFFIXES = (
    "({0} (company))",
    "({0}, Inc.)",
    "({0} Inc.)",
    "({0} Group)",
    "(The {0} Group)",
    "({0} Corporation)",
    "({0} Capital)",
    "({0} Capital Management)",
    "({0} Partners)",
    "({0} Management)",
    "({0} AI)",
    "({0} Technologies)",
)


def candidate_titles(name: str) -> list[str]:
    """Title guesses for a name whose direct lookup did not survive the guard."""
    base = name.strip()
    if not base:
        return []
    out = [pattern[1:-1].format(base) for pattern in CANDIDATE_SUFFIXES]
    return list(dict.fromkeys(out))


def search_titles(name: str, budget: RequestBudget, limit: int = 3) -> list[str]:
    """Stage 2 repair. One `list=search` request per name, so it is the
    expensive rung and callers gate it on the remaining budget."""
    body = api_get(
        WIKIPEDIA_API,
        {"action": "query", "list": "search", "srsearch": name,
         "srlimit": str(limit), "srnamespace": "0"},
        budget,
    )
    return [hit["title"] for hit in ((body.get("query") or {}).get("search") or [])]


def repair(names: Sequence[str], budget: RequestBudget, graph: ClassGraph,
           use_search: bool = False,
           search_reserve: int = 20) -> dict[str, Adjudication]:
    """Try to recover a correct company article for names the direct path held.

    Returns only the names that reached `accept`. The guard runs unchanged on
    every candidate, so this rung cannot lower the correctness bar against
    NON-company pages: the worst a bad candidate can do is fail to be accepted.

    IT DOES INTRODUCE ONE RISK THE DIRECT PATH DOES NOT HAVE, and it is the
    residual the licensing memo already named: a landing on a DIFFERENT COMPANY
    THAT SHARES THE NAME. `Summit` expanding to `Summit Partners` when the row
    meant `Summit Materials` produces a page that is an organisation, whose lead
    contains the typed string, and whose short description says "company". All
    four guard signals pass and the page is still wrong.

    So this is OFF by default in the backfill runner, rows it produces are
    stamped `wikipedia_repaired` rather than `wikipedia`, and `use_search` is a
    second opt-in on top because relevance ranking makes that rung the most
    likely to surface a same-name different-firm article.
    """
    recovered: dict[str, Adjudication] = {}

    def try_batch(pairs: Sequence[tuple[str, str]]) -> None:
        """One batched adjudication of (name, candidate title) pairs."""
        pending = [(n, t) for n, t in pairs if n not in recovered]
        if not pending:
            return
        keys = {f"{n}\u0000{t}": t for n, t in pending}
        display = {f"{n}\u0000{t}": n for n, t in pending}
        for key, result in resolve_identity(keys, budget, graph, display).items():
            name = display[key]
            if result.verdict == "accept" and name not in recovered:
                recovered[name] = result

    # Stage 1: batched candidate titles. 20 candidates to a request.
    plan = [(n, t) for n in names for t in candidate_titles(n)]
    for i in range(0, len(plan), EXTRACT_BATCH):
        try_batch(plan[i:i + EXTRACT_BATCH])

    # Stage 2: full-text search. One request per remaining name, so it is the
    # expensive rung as well as the risky one. Budget-gated and opt-in.
    if use_search:
        for name in names:
            if name in recovered or budget.remaining <= search_reserve:
                continue
            try:
                hits = search_titles(name, budget)
            except BudgetExceeded:
                break
            if hits:
                try_batch([(name, t) for t in hits])
    return recovered


def sitelink_titles(qids: Sequence[str], budget: RequestBudget) -> dict[str, str]:
    """QID -> English Wikipedia article title, batched at 50."""
    out: dict[str, str] = {}
    unique = [q for q in dict.fromkeys(qids) if q]
    for i in range(0, len(unique), ENTITY_BATCH):
        chunk = unique[i:i + ENTITY_BATCH]
        body = api_get(
            WIKIDATA_API,
            {"action": "wbgetentities", "ids": "|".join(chunk),
             "props": "sitelinks", "sitefilter": "enwiki"},
            budget,
        )
        for qid, entity in (body.get("entities") or {}).items():
            link = ((entity.get("sitelinks") or {}).get("enwiki") or {}).get("title")
            if link:
                out[qid] = link
    return out


def storage_payload(result: Adjudication, fetched_at_iso: str) -> dict[str, Any]:
    """The exact columns the backfill writes. VERBATIM paragraph, plus provenance.

    THE VERBATIM GATE RUNS HERE, AND THAT LOCATION IS THE POINT. Both sides of
    the comparison are read off the one `Adjudication`, so a caller cannot pass
    the paragraph as its own source and cannot pass an extract from a different
    page. The docstring used to claim this function raised `VerbatimViolation`
    while nothing in it could; the claim is now true.

    Callers must not catch it around the payload build alone: a row that cannot
    prove it is verbatim must not be written.
    """
    if result.verdict != "accept":
        raise ValueError(f"refusing to build a payload for verdict={result.verdict}")
    assert_verbatim(result.paragraph, source_extract=result.source_extract)
    if result.paragraph != first_paragraph(result.source_extract):
        raise VerbatimViolation(
            "paragraph is not the lead paragraph of the extract it claims to come from"
        )
    return {
        "description": result.paragraph,
        "description_source": "wikipedia",
        "description_source_url": result.source_url,
        "description_source_title": result.title,
        "description_source_revid": result.revid,
        "description_license": LICENSE_NAME,
        "description_license_url": LICENSE_URL,
        "description_fetched_at": fetched_at_iso,
    }
