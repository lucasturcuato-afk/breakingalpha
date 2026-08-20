"""Curated recruiting-universe resolution: measure the gap, plan a seed.

WHY THIS EXISTS
---------------
The onboarding audience is ~700 USC finance students. The single most likely
first action is typing the firm they interviewed with. That is a BOUNDED set,
so it can be curated and measured rather than solved in general.

`backend/data/recruiting_universe.json` is that curated set, written the way a
student TYPES it ("Evercore", "Centerview", "Jane Street"), not the way a filer
registers.

WHAT THIS MODULE DOES, AND DOES NOT
-----------------------------------
It classifies each universe name against a READ-ONLY entity snapshot, using the
SAME resolution order as `ingest._resolve_primary_to_canonical`, and returns a
plan. It NEVER writes. There is deliberately no apply path in this file and no
Supabase client in it at all: `plan_universe` takes a plain snapshot dict, so
the only thing that can reach a database is the caller. `render_seed_sql`
returns TEXT. A human applies it, or does not.

THE ANTI-DUPLICATION RULE (the reason this is not a naive INSERT)
-----------------------------------------------------------------
The index already holds fragment rows ("Ola" for Coca-Cola, "LIC" for Republic
Services) and 805 normalized collision keys covering 2,171 of 5,463 rows. A
naive insert of the 300-name universe measured 126 exact-name duplicates and 12
normalized collisions, and those 12 would BREAK resolution for names that work
today: seeding "Citi" makes the existing "Citi" -> "Citigroup" alias hit
ambiguous, and the uniqueness guard then refuses BOTH.

So the plan is ALIAS-FIRST:

  already_resolves  the name resolves today, in ingest AND on the company page.
                    Do nothing.
  frontend_blind    the name resolves in ingest but NOT on /company/<slug>,
                    because `resolveAlias` reads only companies.ticker and a
                    case-insensitive companies.name. It never consults the
                    aliases table and never normalizes a suffix. NO DATA CHANGE
                    FIXES THIS. Adding a companies row with the typed spelling
                    would collide with the row it already resolves to. The fix
                    is code: give resolveAlias the resolution order that
                    already exists in ingest.
  seed_public       no hit, but `cik_tickers` carries an SEC identity for it.
                    Seed name + ticker + sec_cik COPIED from cik_tickers, never
                    invented.
  seed_private      no hit, no SEC identity, but the corpus really does cover
                    the firm. Seed name only; ticker and sec_cik stay NULL.
  refuse_collision  the normalized key already names TWO OR MORE companies.
                    Seeding would break the uniqueness guard for all of them.
                    Refuse, and say so.
  refuse_no_content the name resolves to nothing and the corpus has no evidence
                    for it. A row here buys a resolution statistic and an empty
                    page. Refuse.

There is deliberately no "alias_only" action. It looks like it should exist, but
it is unreachable: step 5 of the resolution order already returns any name whose
normalized key points at exactly one company, so such a name never reaches
classification as a miss. Aliases are still emitted, but only ALONGSIDE a seeded
row, to collapse the other typed spellings of the same firm onto it.

`refuse_no_content` is the load-bearing one. A `companies` row is not a
populated entry: the page renders articles, filings, financials and a brief.
For a private partnership there are no filings and no XBRL, so the ONLY thing
left is articles. If the corpus has none, seeding converts an honest empty
state into a full tab chrome with every tab empty, which reads as broken.
"""

import json
import os
from typing import Dict, List, Optional

try:
    from company_match import looks_like_ticker, normalize_company_key
    from normalize import normalize_lookup_key
except ImportError:  # pragma: no cover - import-style shim, mirrors entity_resolver
    from backend.company_match import looks_like_ticker, normalize_company_key
    from backend.normalize import normalize_lookup_key

UNIVERSE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                             "data", "recruiting_universe.json")

#: Minimum whole-word title mentions in the article corpus before a name with no
#: SEC identity is worth a `companies` row. Below this the page has nothing to
#: render but its own name.
#:
#: Measured over 180,223 article rows on 2026-08-20: of the 165 universe names
#: that resolve to nothing today, 78 have ZERO title mentions, 40 have 1-4, and
#: 47 have 5 or more. The 5+ group is where a seeded row lights up real content
#: that the index simply lacks a row for (BTIG 111, William Blair 95, Huron 82,
#: Renaissance Technologies 174, Amundi 168, Janus Henderson 140).
MIN_CORPUS_EVIDENCE = 5

ACTIONS = (
    "already_resolves",
    "frontend_blind",
    "seed_public",
    "seed_private",
    "refuse_collision",
    "refuse_no_content",
)


def load_universe(path: str = UNIVERSE_PATH) -> Dict[str, dict]:
    """Read the curated universe. Returns {category: {"why": str, "names": []}}."""
    with open(path) as fh:
        return json.load(fh)["categories"]


def _unique(snapshot: dict, ids) -> Optional[str]:
    if not ids or len(ids) != 1:
        return None
    return snapshot["name_by_id"].get(next(iter(ids)))


def resolve(snapshot: dict, name: str) -> Optional[str]:
    """The project's resolution order, verbatim from
    `ingest._resolve_primary_to_canonical` / `primary_fold_eval.resolve_after`:
    exact name, case-insensitive name, alias key, ticker, normalized key.
    Returns the CANONICAL name or None. Reads a snapshot; touches no client."""
    if name in snapshot["exact_names"]:
        return name
    canonical = snapshot["lower_names"].get(name.lower())
    if canonical:
        return canonical
    canonical = _unique(snapshot, snapshot["by_alias"].get(normalize_lookup_key(name)))
    if canonical:
        return canonical
    if looks_like_ticker(name):
        canonical = _unique(snapshot, snapshot["by_ticker"].get(name.strip().upper()))
        if canonical:
            return canonical
    return _unique(snapshot, snapshot["by_norm"].get(normalize_company_key(name)))


def classify(snapshot: dict, name: str, category: str,
             corpus_evidence: int = 0,
             cik_by_name: Optional[Dict[str, dict]] = None,
             frontend_resolves: bool = True) -> dict:
    """Decide what, if anything, this name should get. Pure. Never writes.

    `corpus_evidence` is the whole-word title-mention count for `name` in the
    article corpus, supplied by the caller so this stays client-free.
    `cik_by_name` maps a normalized name key to a {cik, ticker, company_name}
    row from `cik_tickers`, the only permitted source of a public identity.
    `frontend_resolves` is the caller's answer for the same name under
    `resolveAlias`; a False here on a name that DOES resolve in ingest is the
    frontend_blind class, which no amount of seeding can fix.
    """
    canonical = resolve(snapshot, name)
    if canonical and frontend_resolves:
        return dict(name=name, category=category, action="already_resolves",
                    canonical=canonical, reason="resolves in ingest and on the page")
    if canonical:
        return dict(name=name, category=category, action="frontend_blind",
                    canonical=canonical,
                    reason=f"ingest resolves this to {canonical!r} via the alias or "
                           f"normalized surface; resolveAlias reads neither")

    norm = normalize_company_key(name)
    colliding = snapshot["by_norm"].get(norm) or set()

    # NOTE: len(colliding) == 1 is unreachable here. Step 5 of resolve() already
    # returns the unique company behind a normalized key, so such a name never
    # arrives as a miss. Do not add an "alias_only" branch: it would be dead code.
    #
    # Two or more colliding rows IS reachable, and seeding a third would make the
    # uniqueness guard refuse all of them, breaking names that work today.
    if len(colliding) > 1:
        names = sorted(snapshot["name_by_id"].get(i, "?") for i in colliding)
        return dict(name=name, category=category, action="refuse_collision",
                    canonical=None,
                    reason=f"normalized key {norm!r} already names {len(names)} "
                           f"companies: {names[:4]}")

    sec = (cik_by_name or {}).get(normalize_lookup_key(name))
    if sec:
        return dict(name=name, category=category, action="seed_public",
                    canonical=None, sec=sec,
                    reason=f"cik_tickers carries {sec['ticker']} / cik {sec['cik']}")

    if corpus_evidence < MIN_CORPUS_EVIDENCE:
        return dict(name=name, category=category, action="refuse_no_content",
                    canonical=None, evidence=corpus_evidence,
                    reason=f"{corpus_evidence} corpus mentions (< {MIN_CORPUS_EVIDENCE}); "
                           f"a row here renders an empty page")

    return dict(name=name, category=category, action="seed_private",
                canonical=None, evidence=corpus_evidence,
                reason=f"{corpus_evidence} corpus mentions, no SEC identity")


def plan_universe(snapshot: dict, universe: Dict[str, dict],
                  evidence: Dict[str, int],
                  cik_by_name: Optional[Dict[str, dict]] = None,
                  frontend_hits: Optional[set] = None) -> List[dict]:
    """Classify every name in the universe. Pure; returns a list of decisions.

    `frontend_hits` is the set of names resolveAlias can reach. Omit it and every
    name is assumed frontend-reachable, which collapses the report to the backend
    view only."""
    out = []
    for category, block in universe.items():
        for name in block["names"]:
            out.append(classify(
                snapshot, name, category, evidence.get(name, 0), cik_by_name,
                frontend_resolves=(frontend_hits is None or name in frontend_hits),
            ))
    return out


def _sql_str(value: Optional[str]) -> str:
    if value is None:
        return "NULL"
    return "'" + str(value).replace("'", "''") + "'"


def render_seed_sql(plan: List[dict]) -> str:
    """Render the plan as a SQL PROPOSAL. Returns TEXT and nothing else.

    HAND-APPLY ONLY. Nothing in this repo executes it. Every statement is
    guarded so a re-run is a no-op and so a row that appeared between planning
    and applying is never duplicated.
    """
    public = [d for d in plan if d["action"] == "seed_public"]
    private = [d for d in plan if d["action"] == "seed_private"]
    refused = [d for d in plan if d["action"].startswith("refuse")]
    blind = [d for d in plan if d["action"] == "frontend_blind"]

    # Other typed spellings of a firm we are about to seed. These become alias
    # rows on the seeded company rather than second companies rows, which is the
    # whole anti-duplication mechanism: "Centerview Partners" must land on the
    # "Centerview" row, not create a rival one that makes both ambiguous.
    seeded_norms = {normalize_company_key(d["name"]): d["name"] for d in public + private}
    variants = []
    for d in plan:
        if d["action"] not in ("refuse_no_content", "refuse_collision"):
            continue
        target = seeded_norms.get(normalize_company_key(d["name"]))
        if target and target != d["name"]:
            variants.append((d["name"], target))

    lines = [
        "-- Recruiting-universe seed. PROPOSAL ONLY: hand-apply, never automated.",
        "-- Generated by tools/recruiting_universe_eval.py --emit-seed.",
        "--",
        f"-- {len(public)} public company rows, {len(private)} private company rows, "
        f"{len(variants)} alias rows.",
        f"-- {len(refused)} names deliberately REFUSED; see the tail of this file.",
        f"-- {len(blind)} names need a CODE fix, not data; see the tail of this file.",
        "--",
        "-- Every statement is idempotent. Company inserts are guarded on the",
        "-- lowercased name and on the CIK, so re-running after the pipeline has",
        "-- minted a variant cannot create a duplicate.",
        "BEGIN;",
        "",
    ]

    if public:
        lines += ["", "-- Public firms: name, ticker and CIK COPIED from cik_tickers.",
                  "-- Nothing here is invented."]
    for d in public:
        sec = d["sec"]
        lines.append(
            "INSERT INTO companies (name, ticker, sec_cik)\n"
            f"SELECT {_sql_str(d['name'])}, {_sql_str(sec['ticker'])}, {int(sec['cik'])}\n"
            f"  WHERE NOT EXISTS (SELECT 1 FROM companies c\n"
            f"                    WHERE lower(c.name) = {_sql_str(d['name'].lower())}\n"
            f"                       OR c.sec_cik = {int(sec['cik'])});"
        )

    if private:
        lines += ["", "-- Private firms with real corpus coverage but no SEC identity.",
                  "-- ticker and sec_cik stay NULL: guessing either is how a page ends",
                  "-- up rendering someone else's financials."]
    for d in private:
        lines.append(
            "INSERT INTO companies (name, ticker, sec_cik)\n"
            f"SELECT {_sql_str(d['name'])}, NULL, NULL\n"
            f"  WHERE NOT EXISTS (SELECT 1 FROM companies c\n"
            f"                    WHERE lower(c.name) = {_sql_str(d['name'].lower())});"
        )

    if variants:
        lines += ["", "-- Other spellings of a firm seeded above. Alias rows, never",
                  "-- second companies rows: that is what stops the duplication."]
    for typed, target in variants:
        key = normalize_lookup_key(typed)
        lines.append(
            "INSERT INTO aliases (lookup_key, surface_form, canonical_id)\n"
            f"SELECT {_sql_str(key)}, {_sql_str(typed)}, c.id\n"
            f"  FROM companies c WHERE lower(c.name) = {_sql_str(target.lower())}\n"
            f"  AND NOT EXISTS (SELECT 1 FROM aliases a WHERE a.lookup_key = {_sql_str(key)});"
        )

    lines += ["", "COMMIT;", "", "-- REFUSED, and why:"]
    for d in refused:
        lines.append(f"--   [{d['action']}] {d['name']}: {d['reason']}")
    if blind:
        lines += ["",
                  "-- NOT FIXABLE BY DATA. These resolve in ingest but not on",
                  "-- /company/<slug>, because resolveAlias reads neither the aliases",
                  "-- table nor a normalized key. Seeding the typed spelling would",
                  "-- collide with the row it already resolves to. Fix resolveAlias."]
        for d in blind:
            lines.append(f"--   [{d['action']}] {d['name']} -> {d['canonical']}")
    return "\n".join(lines) + "\n"
