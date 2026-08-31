#!/usr/bin/env python3
"""EDGAR identity audit for the norm_v2 merge plan. READ-ONLY against the DB.

WHY THIS IS A REQUIRED STEP, NOT AN OPTIONAL CHECK.

0020b section 4 gives the survivor of a cluster the ticker and sec_cik of its
members when exactly one distinct value exists. That rule is what stops the merge
from destroying an identifier. It is also what LAUNDERS a wrong one: if a member
row carries an identifier that does not belong to it, the merge writes that
identifier onto the canonical row and every downstream consumer then treats it as
authoritative.

Two rows in the live table do exactly this today:

    axt      'AXT Inc.'     carries BAX / cik 10456  = BAXTER INTERNATIONAL INC
    compass  'Compass Inc.' carries EHC / cik 785161 = Encompass Health Corp

The classifier cannot see either one. Both clusters have ONE distinct ticker, ONE
distinct cik and ONE identified member, which is the ordinary healthy shape, so
`compass` scores `auto` and would have merged with no human involved. It was
found only because somebody thought to compare the inherited identifier against
EDGAR by hand. This tool makes that comparison mandatory instead of remembered.

WHAT IT DOES

  1. Replays 0020 phase 3 and 0020b sections 1 and 3 in Python, read-only, to
     derive the same clusters section 3 will build.
  2. Fetches SEC company_tickers.json and checks every identifier the merge would
     INHERIT onto a survivor that has none of its own.
  3. Prints the verdicts and EXITS NON-ZERO if any cluster disagrees with EDGAR
     and is not already on the pre-block list.
  3b. Runs a WARN-tier qualifier-gap scan over EVERY member of EVERY cluster,
     not just the ones that would inherit. This exists because 'tencent' carried
     Tencent Music's TME on the survivor itself: nothing was inherited, so the
     inherit-only check above was structurally blind to it. It prints every flag
     on every run and never sets the exit code.
  4. Emits the SQL that records the audit into norm_v2.edgar_audit, which the
     hard gate at the top of section 3 refuses to run without.

The pre-block list is PARSED OUT OF THE SQL FILE rather than duplicated here, so
the tool and the migration cannot disagree about what is already contained.

USAGE

    python tools/norm_v2_edgar_audit.py                 # audit, exit 1 on failure
    python tools/norm_v2_edgar_audit.py --emit-sql      # also print the record SQL
    python tools/norm_v2_edgar_audit.py --json out.json # machine-readable verdicts

Reads public.companies. Writes nothing to the database, ever.
"""
from __future__ import annotations

import argparse
import difflib
import json
import os
import re
import sys
import unicodedata
import urllib.request
from collections import defaultdict

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROPOSAL = os.path.join(REPO, "sql", "proposals", "0020b_norm_v2_revised_phases.sql")
EDGAR_URL = "https://www.sec.gov/files/company_tickers.json"
# SEC rejects requests without an identifying UA and will 403 silently otherwise.
EDGAR_UA = os.environ.get("SEC_USER_AGENT", "Signalera pipeline (noahhanning03@gmail.com)")

# Audit freshness the section 3 gate enforces. The companies table grows every
# ingest run (734 rows in the 15 days to 2026-08-30), and a new contaminated row
# is exactly the thing this catches, so a week-old audit is not evidence.
MAX_AGE_HOURS = 24


# ---------------------------------------------------------------------------
# lookup_key_v1 / v2 -- ports of 0020 lines 35-52 and 0020b section 1.
# The fixtures at the bottom of section 1 are asserted before any use.
# ---------------------------------------------------------------------------
_TRANSLATE = {ord("’"): "'", ord("‘"): "'",
              ord("“"): '"', ord("”"): '"'}

_SUFFIX = re.compile(
    r"\s+(inc|incorporated|corp|corporation|co|company|llc|ltd|limited"
    r"|plc|sa|ag|nv|ab|holdings|group"
    r"|se|spa|oyj|asa|pte|pty)$"
)

_ASCII_PUNCT = "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~"


def lookup_key_v1(s):
    if s is None:
        return None
    x = s.replace("™", "").replace("®", "").replace("©", "")
    return unicodedata.normalize("NFKC", x).translate(_TRANSLATE).lower().strip()


def lookup_key_v2(s):
    base = lookup_key_v1(s)
    if base is None:
        return None
    punct = re.sub(r"[.'’]", "", base)
    punct = "".join(
        " " if (c in _ASCII_PUNCT or unicodedata.category(c).startswith("P")) else c
        for c in punct
    )
    punct = re.sub(r"\s+", " ", punct).strip()
    out = punct
    for _ in range(3):
        prev = out
        out = _SUFFIX.sub("", out)
        if out == prev:
            break
    return punct if out == "" else out


FIXTURES = [
    ("Caterpillar Inc.", "caterpillar"),
    ("Archer-Daniels-Midland", "archer daniels midland"),
    ("Kioxia Holdings Corp.", "kioxia"),
    ("Estée Lauder", "estée lauder"),
    ("Group", "group"),
    ("Moody's Analytics", "moodys analytics"),
    ("BP p.l.c.", "bp"),
    ("SAP SE", "sap"),
    ("Nokia Oyj", "nokia"),
    ("The Coca-Cola Company", "the coca cola"),
    # ASCII SYMBOLS, not Unicode punctuation. '+' is category Sm and '$' is Sc,
    # so a Unicode-only punct class leaves them in. These two are the regression
    # guard for the locale bug that made section 3 build 823 clusters against an
    # audit measuring 825 on 2026-08-30.
    ("Disney+", "disney"),
    ("$MIR", "mir"),
]


def assert_key_parity():
    bad = [(a, e, lookup_key_v2(a)) for a, e in FIXTURES if lookup_key_v2(a) != e]
    if bad:
        for a, e, g in bad:
            print(f"  FIXTURE FAIL {a!r}: expected {e!r}, got {g!r}", file=sys.stderr)
        sys.exit("lookup_key_v2 port disagrees with the fixtures in 0020b section 1. "
                 "The audit would be measuring different clusters than the migration builds.")


# ---------------------------------------------------------------------------
# Pre-block list, parsed from the migration so the two cannot drift.
# ---------------------------------------------------------------------------
def parse_pre_block(path=PROPOSAL):
    try:
        text = open(path, encoding="utf-8").read()
    except OSError as ex:
        sys.exit(f"cannot read the migration at {path}: {ex}")
    start = text.find("PRE-BLOCK LIST")
    if start < 0:
        sys.exit(f"no PRE-BLOCK LIST marker in {path}")
    where = text.find("WHERE new_key IN (", start)
    if where < 0:
        sys.exit(f"could not locate the pre-block IN (...) list in {path}")

    # Strip every SQL comment BEFORE looking for the terminator. Two distinct
    # traps live in those comments and both are silent:
    #   - quoted words ('Tata') and apostrophes (Boyd Gaming's) parse as entries;
    #   - a comment containing ");" ends the list early. This actually happened:
    #     "-- biotech); the identifier is suspect" truncated the list one line
    #     before 'agi', which read as a clean 27-key parse and quietly unblocked
    #     a cluster. Comment-stripping first is the only order that is safe.
    region = "\n".join(re.sub(r"--.*$", "", ln) for ln in text[where:].splitlines())
    end = region.find(");")
    if end < 0:
        sys.exit(f"pre-block list in {path} is not terminated by ');'")
    keys = []
    for line in region[:end].splitlines()[1:]:
        keys.extend(re.findall(r"'([^']*)'", line))
    if not keys:
        sys.exit(f"parsed an EMPTY pre-block list from {path}; refusing to audit "
                 "against a list that would contain nothing")
    # Truncation guard. The emptiness check above cannot see a list that parsed
    # MOSTLY: the ');'-in-a-comment bug produced 27 of 28 keys and looked fine.
    # Every entry the file lists must survive the parse.
    listed = len(re.findall(r"^\s*'", region[:end], re.M))
    if listed != len(keys):
        sys.exit(f"pre-block parse is inconsistent: {listed} quoted entries on their "
                 f"own lines, {len(keys)} keys extracted, in {path}")
    return keys


# ---------------------------------------------------------------------------
# Plan replay
# ---------------------------------------------------------------------------
_CTRL = re.compile(r"[\x00-\x1f\x7f]")


def _ticker(c):
    t = (c.get("ticker") or "").strip()
    return t.upper() if t else None


def read_companies():
    sys.path.insert(0, os.path.join(REPO, "backend"))
    from dotenv import load_dotenv
    load_dotenv(os.path.join(REPO, "backend", ".env"))
    from supabase import create_client
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        sys.exit("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set.")
    sb = create_client(url, key)
    cols = "id,name,ticker,sec_cik,sector,mention_count,first_seen"
    rows, page, size = [], 0, 1000
    while True:
        r = (sb.table("companies").select(cols).order("id")
             .range(page * size, page * size + size - 1).execute())
        rows += r.data
        if len(r.data) < size:
            break
        page += 1
    return rows


def build_clusters(rows, pre_block):
    keyed = []
    quarantined = 0
    for c in rows:
        n = c["name"]
        if n is None or n.strip() == "" or _CTRL.search(n):
            quarantined += 1
            continue
        k = lookup_key_v2(n)
        if k == "" or len(k) == 1:
            quarantined += 1
            continue
        c["new_key"] = k
        keyed.append(c)

    by_key = defaultdict(list)
    for c in keyed:
        by_key[c["new_key"]].append(c)

    def survivor_sort(c):
        fs = c.get("first_seen")
        return (-(c.get("mention_count") or 0), fs is None, fs or "", c["id"])

    clusters = []
    for key, members in by_key.items():
        if len(members) < 2:
            continue
        members = sorted(members, key=survivor_sort)
        survivor = members[0]
        tickers = sorted({t for t in (_ticker(m) for m in members) if t})
        ciks = sorted({m["sec_cik"] for m in members if m["sec_cik"] is not None})
        sectors = {m["sector"] for m in members if m["sector"] is not None}
        identified = sum(1 for m in members if _ticker(m) or m["sec_cik"] is not None)

        if len(ciks) > 1 or len(tickers) > 1:
            risk = "block"
        elif len(sectors) > 1 or identified > 1:
            risk = "review"
        elif identified == 1:
            risk = "auto"
        elif identified == 0 and (len(key) <= 5 or " " not in key):
            risk = "review"
        else:
            risk = "auto"
        if key in pre_block:
            risk = "block"

        survivor_bare = _ticker(survivor) is None and survivor["sec_cik"] is None
        clusters.append({
            "new_key": key,
            "risk": risk,
            "pre_blocked": key in pre_block,
            "survivor_name": survivor["name"],
            "member_count": len(members),
            "inherit_ticker": tickers[0] if len(tickers) == 1 else None,
            "inherit_cik": ciks[0] if len(ciks) == 1 else None,
            "inherits": survivor_bare and (len(tickers) == 1 or len(ciks) == 1),
            "members": [{"name": m["name"], "ticker": _ticker(m), "sec_cik": m["sec_cik"]}
                        for m in members],
        })
    return clusters, quarantined, len(keyed)


# ---------------------------------------------------------------------------
# EDGAR
# ---------------------------------------------------------------------------
_STOP = {"inc", "corp", "corporation", "co", "company", "ltd", "limited", "plc",
         "the", "group", "holdings", "holding", "sa", "ag", "nv", "ab", "se",
         "llc", "international"}


def fetch_edgar():
    req = urllib.request.Request(EDGAR_URL, headers={"User-Agent": EDGAR_UA})
    try:
        data = json.load(urllib.request.urlopen(req, timeout=45))
    except Exception as ex:
        sys.exit(f"could not fetch {EDGAR_URL}: {ex}\n"
                 "The audit is a required gate; it FAILS rather than skipping.")
    by_ticker, by_cik = {}, {}
    for v in data.values():
        by_ticker[v["ticker"].upper()] = (int(v["cik_str"]), v["title"])
        by_cik[int(v["cik_str"])] = (v["ticker"].upper(), v["title"])
    if len(by_ticker) < 5000:
        sys.exit(f"EDGAR returned only {len(by_ticker)} tickers, which is not a "
                 "complete file. Refusing to audit against a truncated source.")
    return by_ticker, by_cik


def _tokens(s):
    return set(re.sub(r"[^a-z0-9 ]", " ", (s or "").lower()).split()) - _STOP


def agrees(edgar_title, names):
    """True when the EDGAR title plausibly names the same company as a member.

    Token overlap first, then a whole-string ratio for spelling variants. Kept
    deliberately loose: this decides whether to STAY SILENT, so a false 'agrees'
    is the expensive direction and the threshold is set high enough that
    'AXT' / 'BAXTER INTERNATIONAL' and 'Compass' / 'Encompass Health' both fail.
    """
    et = _tokens(edgar_title)
    if not et:
        return False
    for n in names:
        nt = _tokens(n)
        if not nt:
            continue
        if et & nt:
            return True
        if difflib.SequenceMatcher(None, " ".join(sorted(et)),
                                   " ".join(sorted(nt))).ratio() > 0.86:
            return True
    return False


# Tokens that carry no identifying weight in an EDGAR title. Wider than _STOP:
# this list also drops the boilerplate EDGAR itself appends (/DE/, share-class
# words) so a state-of-incorporation suffix is not read as a different company.
_TITLE_NOISE = _STOP | {
    "and", "trust", "fund", "class", "common", "stock", "new", "adr", "lp",
    "llp", "ii", "iii", "iv", "sub", "shares", "depositary", "series",
}


def qualifier_gap(edgar_title, names):
    """Substantive words in the EDGAR title that appear in NO member name.

    THE HOLE THIS CLOSES. `agrees` accepts any token overlap, which is right for
    'Stryker' against 'STRYKER CORP' and wrong for 'Tencent' against 'Tencent
    Music Entertainment Group'. Those two share the word Tencent and are
    different companies: 0700.HK versus TME. The survivor already CARRIED the
    wrong ticker, so nothing was inherited, so the inherit-only audit above never
    looked at it. A human found it by reading the list.

    The signal is the leftover: EDGAR knows this identifier as a company whose
    name contains real words that no member of the cluster has. Tencent/Music,
    Compass/Encompass, AXT/Baxter, Stran/Astrana, Science/Gilead all leave one.

    Tokens under 4 characters and non-alphabetic tokens are dropped, which is
    what keeps 'ALBANY INTERNATIONAL CORP /DE/' from reading as a mismatch.

    WARN ONLY. Measured over all 825 clusters on 2026-08-30 it flags 26, of which
    roughly 10 are benign (McDonald's/MCDONALDS CORP, Disney/Walt Disney Co,
    'Alight, Inc.'/'Alight, Inc. / Delaware'). That ratio is right for something a
    human clears once and wrong for something that blocks a run, so this never
    sets the exit code.
    """
    have = set()
    for n in names:
        have |= {t for t in re.sub(r"[^a-z0-9 ]", " ", (n or "").lower()).split()
                 if t not in _TITLE_NOISE}
    title_tokens = [t for t in re.sub(r"[^a-z0-9 ]", " ", (edgar_title or "").lower()).split()
                    if t not in _TITLE_NOISE]
    return [t for t in title_tokens if t not in have and len(t) >= 4 and t.isalpha()]


def scan_qualifier_gaps(clusters, by_ticker, by_cik):
    """Every member whose OWN identifier resolves to a differently-named company.

    Deliberately scans EVERY cluster and EVERY member, not just the ones that
    would inherit: the tencent case is a wrong identifier sitting on a survivor,
    where nothing is inherited at all.
    """
    hits = []
    for c in clusters:
        names = [m["name"] for m in c["members"]]
        for m in c["members"]:
            t, k = m["ticker"], m["sec_cik"]
            title = None
            if t and t in by_ticker:
                title = by_ticker[t][1]
            elif k and k in by_cik:
                title = by_cik[k][1]
            if not title:
                continue
            extra = qualifier_gap(title, names)
            if extra:
                hits.append({"new_key": c["new_key"], "risk": c["risk"],
                             "pre_blocked": c["pre_blocked"], "member": m["name"],
                             "ticker": t, "sec_cik": k, "edgar_title": title,
                             "extra": extra, "members": names})
    return hits


def audit(clusters, by_ticker, by_cik):
    out = []
    for c in clusters:
        if not c["inherits"]:
            continue
        t, k = c["inherit_ticker"], c["inherit_cik"]
        title = None
        if t and t in by_ticker:
            title = by_ticker[t][1]
        elif k and k in by_cik:
            title = by_cik[k][1]
        if title is None:
            verdict = "unknown"
        elif agrees(title, [m["name"] for m in c["members"]]):
            verdict = "ok"
        else:
            verdict = "mismatch"
        out.append({**c, "edgar_title": title, "verdict": verdict})
    return out


# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------
def sql_literal(s):
    return "'" + str(s).replace("'", "''") + "'" if s is not None else "NULL"


def emit_gap_sql(gaps):
    """DDL + UPSERT for the qualifier-gap warn rows.

    UPSERT, not TRUNCATE, and this matters. The audit re-runs before every
    section 3 (the gate enforces a 24h freshness window), so a TRUNCATE would
    silently discard every `cleared` decision a human made and re-block the auto
    tier on warns they had already reviewed. Observed fields are refreshed;
    cleared / cleared_by / cleared_at / cleared_reason are never touched.

    Rows that no longer appear in the scan ARE deleted, including cleared ones.
    If the same gap reappears later the underlying data changed, and it comes
    back uncleared for re-review, which is the honest default.
    """
    L = []
    L.append("""
CREATE TABLE IF NOT EXISTS norm_v2.edgar_qualifier_gap (
  new_key        text   NOT NULL,
  member_name    text   NOT NULL,
  ticker         text,
  sec_cik        bigint,
  edgar_title    text   NOT NULL,
  extra_tokens   text[] NOT NULL,
  risk           text   NOT NULL,
  pre_blocked    boolean NOT NULL,
  observed_at    timestamptz NOT NULL DEFAULT now(),
  cleared        boolean NOT NULL DEFAULT false,
  cleared_by     text,
  cleared_at     timestamptz,
  cleared_reason text,
  PRIMARY KEY (new_key, member_name)
);

COMMENT ON TABLE norm_v2.edgar_qualifier_gap IS
  'WARN tier. A member whose ticker/cik resolves in EDGAR to a company whose '
  'name carries words no member of the cluster has. Roughly a third are benign '
  '(apostrophe folding, corporate renames at the same cik), so this never fails '
  'the audit. It gates APPROVAL instead: the auto-tier approval predicate skips '
  'any cluster with an uncleared row here.';
""".strip())
    L.append("")
    if gaps:
        L.append("INSERT INTO norm_v2.edgar_qualifier_gap "
                 "(new_key, member_name, ticker, sec_cik, edgar_title, extra_tokens, "
                 "risk, pre_blocked) VALUES")
        vals = []
        for g in sorted(gaps, key=lambda x: (x["new_key"], x["member"])):
            arr = "ARRAY[" + ", ".join(sql_literal(t) for t in g["extra"]) + "]::text[]"
            vals.append("  (" + ", ".join([
                sql_literal(g["new_key"]), sql_literal(g["member"]),
                sql_literal(g["ticker"]),
                str(g["sec_cik"]) if g["sec_cik"] is not None else "NULL",
                sql_literal(g["edgar_title"]), arr,
                sql_literal(g["risk"]), "true" if g["pre_blocked"] else "false",
            ]) + ")")
        L.append(",\n".join(vals))
        L.append("ON CONFLICT (new_key, member_name) DO UPDATE SET")
        L.append("  ticker       = EXCLUDED.ticker,")
        L.append("  sec_cik      = EXCLUDED.sec_cik,")
        L.append("  edgar_title  = EXCLUDED.edgar_title,")
        L.append("  extra_tokens = EXCLUDED.extra_tokens,")
        L.append("  risk         = EXCLUDED.risk,")
        L.append("  pre_blocked  = EXCLUDED.pre_blocked,")
        L.append("  observed_at  = now();")
        L.append("  -- cleared / cleared_by / cleared_at / cleared_reason: NOT touched.")
        L.append("")
        keys = ", ".join(f"({sql_literal(g['new_key'])}, {sql_literal(g['member'])})"
                         for g in sorted(gaps, key=lambda x: (x["new_key"], x["member"])))
        L.append("DELETE FROM norm_v2.edgar_qualifier_gap")
        L.append(f" WHERE (new_key, member_name) NOT IN ({keys});")
    else:
        L.append("DELETE FROM norm_v2.edgar_qualifier_gap;  -- scan found no gaps")
    return "\n".join(L)


def emit_sql(audited, cluster_count, companies_read, edgar_count):
    L = []
    L.append("-- Recorded by tools/norm_v2_edgar_audit.py. Paste into Supabase BEFORE")
    L.append("-- 0020b section 3; its hard gate refuses to build the plan without this.")
    L.append("CREATE SCHEMA IF NOT EXISTS norm_v2;")
    L.append("""
CREATE TABLE IF NOT EXISTS norm_v2.edgar_audit_run (
  singleton      boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  audited_at     timestamptz NOT NULL DEFAULT now(),
  companies_read int NOT NULL,
  cluster_count  int NOT NULL,
  inherit_count  int NOT NULL,
  edgar_tickers  int NOT NULL
);

CREATE TABLE IF NOT EXISTS norm_v2.edgar_audit (
  new_key         text PRIMARY KEY,
  risk            text NOT NULL,
  pre_blocked     boolean NOT NULL,
  survivor_name   text NOT NULL,
  inherit_ticker  text,
  inherit_cik     bigint,
  edgar_title     text,
  verdict         text NOT NULL CHECK (verdict IN ('ok','unknown','mismatch')),
  acknowledged    boolean NOT NULL DEFAULT false,
  acknowledged_by text,
  acknowledged_at timestamptz
);
""".strip())
    L.append("")
    L.append("TRUNCATE norm_v2.edgar_audit;")
    L.append("DELETE FROM norm_v2.edgar_audit_run;")
    L.append("")
    L.append("INSERT INTO norm_v2.edgar_audit (new_key, risk, pre_blocked, survivor_name,"
             " inherit_ticker, inherit_cik, edgar_title, verdict) VALUES")
    vals = []
    for a in sorted(audited, key=lambda x: x["new_key"]):
        vals.append("  (" + ", ".join([
            sql_literal(a["new_key"]), sql_literal(a["risk"]),
            "true" if a["pre_blocked"] else "false",
            sql_literal(a["survivor_name"]),
            sql_literal(a["inherit_ticker"]),
            str(a["inherit_cik"]) if a["inherit_cik"] is not None else "NULL",
            sql_literal(a["edgar_title"]), sql_literal(a["verdict"]),
        ]) + ")")
    L.append(",\n".join(vals) + ";")
    L.append("")
    L.append("INSERT INTO norm_v2.edgar_audit_run "
             "(companies_read, cluster_count, inherit_count, edgar_tickers)")
    L.append(f"VALUES ({companies_read}, {cluster_count}, {len(audited)}, {edgar_count});")
    return "\n".join(L)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--emit-sql", action="store_true",
                    help="print the SQL that records this audit for the section 3 gate")
    ap.add_argument("--json", metavar="PATH", help="write the verdicts as JSON")
    args = ap.parse_args()

    assert_key_parity()
    pre_block = set(parse_pre_block())
    print(f"pre-block list, parsed from {os.path.relpath(PROPOSAL, REPO)}: "
          f"{len(pre_block)} keys")

    rows = read_companies()
    clusters, quarantined, keyed = build_clusters(rows, pre_block)
    by_ticker, by_cik = fetch_edgar()
    audited = audit(clusters, by_ticker, by_cik)

    print(f"companies {len(rows)}, keyed {keyed}, quarantined {quarantined}")
    print(f"clusters {len(clusters)}, inheriting an identifier {len(audited)}")
    print(f"EDGAR company_tickers.json: {len(by_ticker)} tickers")

    gaps = scan_qualifier_gaps(clusters, by_ticker, by_cik)

    ok = [a for a in audited if a["verdict"] == "ok"]
    unknown = [a for a in audited if a["verdict"] == "unknown"]
    mismatch = [a for a in audited if a["verdict"] == "mismatch"]
    print(f"\n  agrees with EDGAR      {len(ok)}")
    print(f"  not listed in EDGAR    {len(unknown)}")
    print(f"  DISAGREES with EDGAR   {len(mismatch)}")

    if unknown:
        print("\nNot in EDGAR (foreign listings and some holdings are legitimately "
              "absent; verify by hand):")
        for a in sorted(unknown, key=lambda x: x["new_key"]):
            print(f"  {a['new_key']:<26} inherit ticker={a['inherit_ticker']} "
                  f"cik={a['inherit_cik']}")

    # WARN TIER. Printed in full on every run, never gates. See qualifier_gap.
    print(f"\n{'=' * 72}")
    print(f"WARN: qualifier gap, {len(gaps)} member(s) across "
          f"{len({g['new_key'] for g in gaps})} cluster(s)")
    print("EDGAR knows the identifier as a company whose name carries words no "
          "member has.\nRoughly a third of these are benign spelling artefacts. "
          "Read every one.")
    print("=" * 72)
    for g in sorted(gaps, key=lambda x: (not x["pre_blocked"], x["new_key"])):
        state = "pre-blocked" if g["pre_blocked"] else f"risk={g['risk']}"
        print(f"  {g['new_key']:<24} {state:<12} extra={g['extra']}")
        print(f"     {g['member']!r} [{g['ticker']}] cik={g['sec_cik']} "
              f"-> EDGAR {g['edgar_title']!r}")
    loose_gaps = [g for g in gaps if not g["pre_blocked"]]
    if loose_gaps:
        print(f"\n  {len(loose_gaps)} of these are NOT pre-blocked. This does not fail "
              "the audit; it is\n  your list to clear before approving the clusters "
              "they sit in.")

    contained = [a for a in mismatch if a["pre_blocked"]]
    loose = [a for a in mismatch if not a["pre_blocked"]]

    if contained:
        print("\nDisagrees with EDGAR, already on the pre-block list (contained):")
        for a in sorted(contained, key=lambda x: x["new_key"]):
            print(f"  {a['new_key']:<26} would inherit {a['inherit_ticker']}"
                  f"/{a['inherit_cik']} -> EDGAR says {a['edgar_title']!r}")

    if args.json:
        with open(args.json, "w") as f:
            json.dump({"clusters": len(clusters), "audited": audited,
                       "qualifier_gaps": gaps}, f, indent=1)
        print(f"\nwrote {args.json}")

    if args.emit_sql:
        print("\n" + "=" * 72)
        print(emit_sql(audited, len(clusters), len(rows), len(by_ticker)))
        print()
        print(emit_gap_sql(gaps))
        print("=" * 72)

    if loose:
        print("\n" + "!" * 72, file=sys.stderr)
        print(f"AUDIT FAILED: {len(loose)} cluster(s) would inherit an identifier that "
              "EDGAR says belongs to a different company, and are NOT pre-blocked.",
              file=sys.stderr)
        print("!" * 72, file=sys.stderr)
        for a in sorted(loose, key=lambda x: x["new_key"]):
            print(f"\n  {a['new_key']}  (risk={a['risk']})", file=sys.stderr)
            print(f"    survivor      {a['survivor_name']!r} has no identity of its own",
                  file=sys.stderr)
            print(f"    would inherit ticker={a['inherit_ticker']} cik={a['inherit_cik']}",
                  file=sys.stderr)
            print(f"    EDGAR says    that identifier is {a['edgar_title']!r}",
                  file=sys.stderr)
            print("    members       " + " | ".join(
                m["name"] + (f" [{m['ticker']}]" if m["ticker"] else "")
                + (f" cik={m['sec_cik']}" if m["sec_cik"] else "")
                for m in a["members"]), file=sys.stderr)
        print("\nAdd each key to the PRE-BLOCK LIST in "
              f"{os.path.relpath(PROPOSAL, REPO)} and re-run. Do NOT run section 3 "
              "until this passes.", file=sys.stderr)
        return 1

    print("\nAUDIT PASSED: no cluster would inherit an identifier that contradicts "
          "EDGAR.")
    if not args.emit_sql:
        print("Re-run with --emit-sql to produce the record the section 3 gate requires.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
