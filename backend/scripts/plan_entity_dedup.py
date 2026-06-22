"""Entity-dedup PLANNER for the SEC-reconcile collision clusters (REVIEW-ONLY).

PLAN GENERATOR ONLY. This script performs ZERO database writes. It reads the
companies table and the six tables that FK-reference companies.id (all via REST
SELECT), reconstructs the collision clusters from the PR #405 Phase A artifact,
buckets them, applies a deterministic survivor rule, and emits two artifacts:

  backend/migrations/entity-dedup-plan.sql  per safe cluster, an ordered merge in
      one transaction (repoint child FKs -> survivor, fold mention_count,
      backfill ticker+cik, delete retired rows). Conflict clusters appear ONLY
      as commented-out REVIEW blocks.
  backend/migrations/entity-dedup-plan.md   the written plan.

Nothing here is applied. Noah reviews and runs the SQL manually.

FK graph (discovered from pg_constraint, see the .md):
  aliases.canonical_id             (ON DELETE CASCADE, NOT NULL)
  company_mentions.company_id      (NO ACTION, nullable)
  financial_facts.company_id       (SET NULL, nullable)
  insider_transactions.company_id  (SET NULL, nullable)
  resolution_log.resolved_canonical_id (SET NULL, nullable)
  sec_filings.company_id           (SET NULL, nullable)

Usage (read-only):
  cd <repo root>
  set -a && source .env.local && set +a && export SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
  .venv/bin/python -m backend.scripts.plan_entity_dedup --artifact /path/to/2026-06-21-sec-ticker-reconcile-phase-a.sql

ASCII only. No em-dashes.
"""
from __future__ import annotations

import argparse
import os
import re
import sys
from collections import defaultdict

from supabase import create_client

SQL_PATH = "backend/migrations/entity-dedup-plan.sql"
MD_PATH = "backend/migrations/entity-dedup-plan.md"

# (table, fk_column) for every FK referencing companies.id. Discovered via
# pg_constraint; aliases is included so retired companies' surface forms repoint
# to the survivor (preserving name-based article/deal_flow resolution).
FK_CHILDREN = [
    ("aliases", "canonical_id"),
    ("company_mentions", "company_id"),
    ("financial_facts", "company_id"),
    ("insider_transactions", "company_id"),
    ("resolution_log", "resolved_canonical_id"),
    ("sec_filings", "company_id"),
]


def _chunks(xs, n=150):
    for i in range(0, len(xs), n):
        yield xs[i:i + n]


def parse_artifact(path):
    """cik -> list of {id, set_ticker, name} for every Phase A UPDATE row."""
    by_cik = defaultdict(list)
    for line in open(path):
        if not line.strip().startswith("UPDATE companies SET"):
            continue
        cik = re.search(r"sec_cik = (\d+)", line)
        idm = re.search(r"id = '([0-9a-f-]{36})'", line)
        tkr = re.search(r"ticker = '([^']*)'", line)
        nm = re.search(r"-- [A-Z0-9.\-]+ '(.*?)' ->", line)
        if not (cik and idm):
            continue
        by_cik[int(cik.group(1))].append({
            "id": idm.group(1),
            "set_ticker": tkr.group(1) if tkr else None,
            "art_name": nm.group(1) if nm else None,
        })
    return by_cik


def fetch_companies_by_ids(sb, ids):
    out = {}
    for chunk in _chunks(ids):
        rows = (sb.table("companies")
                .select("id, name, ticker, sec_cik, first_seen, mention_count")
                .in_("id", chunk).execute().data or [])
        for r in rows:
            out[r["id"]] = r
    return out


def fetch_populated_by_cik(sb, ciks):
    """cik -> list of company rows that ALREADY carry that sec_cik (survivors)."""
    out = defaultdict(list)
    for chunk in _chunks([int(c) for c in ciks]):
        rows = (sb.table("companies")
                .select("id, name, ticker, sec_cik, first_seen, mention_count")
                .in_("sec_cik", chunk).execute().data or [])
        for r in rows:
            out[r["sec_cik"]].append(r)
    return out


def fetch_child_counts(sb, member_ids):
    """member id -> {table: child_row_count} across the six FK children."""
    counts = defaultdict(lambda: defaultdict(int))
    idset = set(member_ids)
    for table, col in FK_CHILDREN:
        for chunk in _chunks(list(idset)):
            rows = (sb.table(table).select(col).in_(col, chunk).execute().data or [])
            for r in rows:
                fk = r.get(col)
                if fk in idset:
                    counts[fk][table] += 1
    return counts


def main():
    ap = argparse.ArgumentParser(description="Entity-dedup planner (review-only)")
    ap.add_argument("--artifact", required=True, help="path to the #405 phase-a.sql")
    ap.add_argument("--live", action="store_true", help="intentionally not implemented")
    args = ap.parse_args()
    if args.live:
        print("live mode is intentionally not implemented: this script only plans.")
        return 2

    by_cik = parse_artifact(args.artifact)
    art_ids = [r["id"] for v in by_cik.values() for r in v]
    print(f"artifact: {len(art_ids)} UPDATE rows across {len(by_cik)} distinct CIKs")

    sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])

    art_live = fetch_companies_by_ids(sb, art_ids)
    populated = fetch_populated_by_cik(sb, by_cik.keys())

    # Assemble clusters: members = artifact dups (live state) + populated rows at
    # that cik, deduped by id. A collision cluster has >= 2 distinct members.
    clusters = {}  # cik -> {"members":[rows], "art_ids":set, "art_ticker":str}
    all_member_ids = set()
    for cik, arts in by_cik.items():
        members, seen = [], set()
        art_id_set = {a["id"] for a in arts}
        art_ticker = next((a["set_ticker"] for a in arts if a["set_ticker"]), None)
        for a in arts:
            row = art_live.get(a["id"])
            if row and row["id"] not in seen:
                members.append(row); seen.add(row["id"])
        for row in populated.get(cik, []):
            if row["id"] not in seen:
                members.append(row); seen.add(row["id"])
        if len(members) >= 2:
            clusters[cik] = {"members": members, "art_ids": art_id_set, "art_ticker": art_ticker}
            all_member_ids.update(m["id"] for m in members)

    child_counts = fetch_child_counts(sb, list(all_member_ids))

    def childtotal(mid):
        return sum(child_counts.get(mid, {}).values())

    # Bucket + survivor selection.
    bucket_a, bucket_b, bucket_c = [], [], []   # one-populated, all-empty, conflict
    for cik, cl in clusters.items():
        members = cl["members"]
        populated_members = [m for m in members if m["ticker"] or m["sec_cik"]]
        # CONFLICT: two members disagree on a non-null ticker or non-null cik.
        tickers = {m["ticker"] for m in members if m["ticker"]}
        ciks = {m["sec_cik"] for m in members if m["sec_cik"]}
        conflict = len(tickers) > 1 or len(ciks) > 1
        # survivor rule: prefer ticker+cik; then most child rows; then earliest
        # first_seen; then id (stable).
        def rank(m):
            return (
                1 if (m["ticker"] and m["sec_cik"]) else 0,
                childtotal(m["id"]),
                -(_ts(m["first_seen"])),
                m["id"],
            )
        survivor = max(members, key=rank)
        rec = {"cik": cik, "members": members, "survivor": survivor,
               "art_ticker": cl["art_ticker"],
               "reason": ("conflicting non-null ticker/cik" if conflict
                          else "two or more already-populated rows (pop-vs-pop)"
                          if len(populated_members) > 1 else "")}
        # Quarantine (bucket c) anything not strictly "one populated + N empty"
        # or "all empty": a conflict, OR a cluster that would DELETE an already-
        # populated row (>1 populated member). Deleting a populated company with
        # its own history is a human call, never auto-run.
        if conflict or len(populated_members) > 1:
            bucket_c.append(rec)
        elif len(populated_members) == 1:
            bucket_a.append(rec)
        else:
            bucket_b.append(rec)

    emit_sql(bucket_a, bucket_b, bucket_c, child_counts)
    emit_md(bucket_a, bucket_b, bucket_c, by_cik, art_ids, child_counts)

    # ---- VERIFY (printed) ----
    safe = bucket_a + bucket_b
    safe_dups = sum(len(r["members"]) - 1 for r in safe)
    quar_dups = sum(len(r["members"]) - 1 for r in bucket_c)
    print("\n=== BUCKETS ===")
    print(f"(a) one-populated + empties : {len(bucket_a)} clusters")
    print(f"(b) all-empty               : {len(bucket_b)} clusters")
    print(f"(c) CONFLICT quarantine     : {len(bucket_c)} clusters")
    print(f"total collision clusters    : {len(clusters)}")
    print(f"\nduplicate rows to retire: safe={safe_dups}  quarantined={quar_dups}  total={safe_dups + quar_dups}")
    print(f"artifact collision-tagged rows (expected duplicates): see .md reconciliation")
    print(f"\nwrote {SQL_PATH} and {MD_PATH}; NO DB writes performed")
    return 0


def _ts(s):
    if not s:
        return 0
    m = re.match(r"(\d{4})-(\d{2})-(\d{2})", s)
    return int("".join(m.groups())) if m else 0


def _q(s):
    return (s or "").replace("'", "''")


def _cluster_sql(rec, child_counts, commented=False):
    surv = rec["survivor"]
    dups = [m for m in rec["members"] if m["id"] != surv["id"]]
    dup_ids = ", ".join(f"'{d['id']}'" for d in dups)
    pfx = "-- " if commented else ""
    lines = [f"{pfx}-- cik {rec['cik']}  survivor {surv['id']} {_q(surv['name'])!r}"
             f" (ticker={surv['ticker']}, cik={surv['sec_cik']})"]
    for d in dups:
        lines.append(f"{pfx}--   retire {d['id']} {_q(d['name'])!r} "
                     f"(ticker={d['ticker']}, cik={d['sec_cik']}, children={sum(child_counts.get(d['id'],{}).values())})")
    lines.append(f"{pfx}BEGIN;")
    for table, col in FK_CHILDREN:
        lines.append(f"{pfx}UPDATE {table} SET {col} = '{surv['id']}' WHERE {col} IN ({dup_ids});")
    lines.append(f"{pfx}UPDATE companies SET mention_count = COALESCE(mention_count,0) + "
                 f"COALESCE((SELECT SUM(COALESCE(mention_count,0)) FROM companies WHERE id IN ({dup_ids})),0) "
                 f"WHERE id = '{surv['id']}';")
    tkr = surv["ticker"] or rec["art_ticker"]
    if tkr:
        lines.append(f"{pfx}UPDATE companies SET ticker = COALESCE(ticker, '{_q(tkr)}'), "
                     f"sec_cik = COALESCE(sec_cik, {rec['cik']}) WHERE id = '{surv['id']}';")
    lines.append(f"{pfx}DELETE FROM companies WHERE id IN ({dup_ids});")
    lines.append(f"{pfx}COMMIT;")
    lines.append(f"{pfx}")
    return "\n".join(lines)


def emit_sql(bucket_a, bucket_b, bucket_c, child_counts):
    out = [
        "-- Entity-dedup plan (REVIEW-ONLY; apply manually, one cluster at a time).",
        "-- Generated by backend/scripts/plan_entity_dedup.py. NEVER run by the generator.",
        "-- Per safe cluster, in ONE transaction: repoint the six child FKs to the",
        "-- survivor, fold mention_count, backfill ticker+cik, then delete the retired",
        "-- rows. Idempotent on re-run after a successful commit (dups are gone, so the",
        "-- IN-list updates/deletes affect zero rows).",
        "-- companies.name is UNIQUE; deletes free the retired names, no INSERT into",
        "-- companies, so no unique violation. ticker/sec_cik are NOT unique.",
        "-- STRING-REF HAZARD: articles.companies/primary_company and deal_flow.company",
        "-- reference companies by NAME, not id. Repointing aliases.canonical_id (below)",
        "-- preserves resolution for surface forms already in aliases; a retired name",
        "-- NOT present as an alias is a residual (see the .md). These are NOT auto-",
        "-- repointed here.",
        "",
        f"-- ============ BUCKET A: one populated survivor + empties ({len(bucket_a)} clusters) ============",
        "",
    ]
    for rec in sorted(bucket_a, key=lambda r: r["cik"]):
        out.append(_cluster_sql(rec, child_counts))
    out += ["", f"-- ============ BUCKET B: all-empty, survivor chosen by rule + backfilled ({len(bucket_b)} clusters) ============", ""]
    for rec in sorted(bucket_b, key=lambda r: r["cik"]):
        out.append(_cluster_sql(rec, child_counts))
    out += ["", "-- ============ BUCKET C: CONFLICT, QUARANTINED (commented-out, manual review) ============",
            f"-- {len(bucket_c)} clusters where members disagree on a non-null ticker or sec_cik.",
            "-- DO NOT run these as-is. A human must decide the true survivor / dedupe path.",
            ""]
    for rec in sorted(bucket_c, key=lambda r: r["cik"]):
        out.append(f"-- REVIEW ({rec['reason']}): do not auto-run; human picks the survivor.")
        out.append(_cluster_sql(rec, child_counts, commented=True))
    open(SQL_PATH, "w").write("\n".join(out))


def emit_md(bucket_a, bucket_b, bucket_c, by_cik, art_ids, child_counts):
    safe = bucket_a + bucket_b
    safe_dups = sum(len(r["members"]) - 1 for r in safe)
    quar_dups = sum(len(r["members"]) - 1 for r in bucket_c)
    md = [
        "# Entity-dedup plan (collision clusters from PR #405)",
        "",
        "REVIEW-ONLY. The generator performs no DB writes; every mutation lives as",
        "text in entity-dedup-plan.sql and is applied by a human, one cluster at a time.",
        "",
        "## FK graph (discovered from pg_constraint)",
        "",
        "| child table | fk column | on delete | nullable |",
        "|---|---|---|---|",
        "| aliases | canonical_id | CASCADE | no |",
        "| company_mentions | company_id | NO ACTION | yes |",
        "| financial_facts | company_id | SET NULL | yes |",
        "| insider_transactions | company_id | SET NULL | yes |",
        "| resolution_log | resolved_canonical_id | SET NULL | yes |",
        "| sec_filings | company_id | SET NULL | yes |",
        "",
        "UNIQUE on companies: companies_pkey(id), companies_name_key(name). sec_cik has",
        "a non-unique partial index; ticker has NO unique constraint. A merge that",
        "DELETEs duplicates frees their unique names and never inserts into companies,",
        "so there is no unique-violation risk.",
        "",
        "## String-reference hazards (NOT id FKs, NOT auto-repointed)",
        "",
        "These reference companies by name/ticker STRING, so deleting a duplicate row",
        "does not touch them:",
        "- articles.companies (text[]), articles.primary_company (text) -- by NAME",
        "- deal_flow.company (text) -- by NAME",
        "- theses.ticker, sec_filings.ticker, insider_transactions.ticker,",
        "  competitor_map.ticker, user_profiles.watchlist_tickers,",
        "  user_signal_digest.top_engaged_tickers -- by TICKER",
        "",
        "Mitigation: repointing aliases.canonical_id (an FK child, in the plan) moves a",
        "retired company's existing surface forms to the survivor, so name-based",
        "resolution keeps working for any name already aliased. A retired company NAME",
        "that is NOT present in aliases is a residual: add it as a survivor alias before",
        "deleting if article/deal_flow rows carry that exact name. Flagged for Noah.",
        "",
        "## Count reconciliation (flagged)",
        "",
        f"- PR #405 phase-a.sql: {len(art_ids)} UPDATE rows; the #405 report stated 692",
        "  collision-tagged rows and 457 collision GROUPS.",
        "- This plan re-derives clusters live: a cluster is a target CIK with >= 2",
        "  company rows (artifact duplicates plus any already-populated sibling).",
        f"- Buckets: A={len(bucket_a)}, B={len(bucket_b)}, C(conflict)={len(bucket_c)};",
        f"  total clusters={len(bucket_a)+len(bucket_b)+len(bucket_c)}.",
        f"- Duplicate rows to retire: safe={safe_dups}, quarantined={quar_dups},",
        f"  total={safe_dups+quar_dups}.",
        "- DISCREPANCY NOTE: the goal says '692 clusters' but 692 is the count of",
        "  collision-tagged duplicate ROWS, not clusters. Cluster count and the live",
        "  populated-sibling set are re-derived here; if the retire-row total differs",
        "  from 692 it is because (i) clusters are counted by CIK, and (ii) some #405",
        "  duplicates may have changed state since the report. Both numbers are printed",
        "  by the generator for cross-check.",
        "",
        "## Canonical survivor rule",
        "",
        "Per cluster, pick the survivor deterministically:",
        "1. prefer a member carrying BOTH ticker and sec_cik;",
        "2. tie-break: most child rows across the six FK tables;",
        "3. then earliest first_seen; then lowest id (stable).",
        "Any cluster whose members carry two DIFFERENT non-null tickers or two",
        "different non-null sec_ciks is a CONFLICT -> bucket C (quarantine), never",
        "auto-merged.",
        "",
        "### Worked examples",
        _worked(bucket_a, bucket_b, bucket_c, child_counts, "PTC"),
        _worked(bucket_a, bucket_b, bucket_c, child_counts, "AAOI"),
        "",
        "## Per-cluster operation order (safe clusters)",
        "",
        "1. repoint aliases.canonical_id -> survivor",
        "2. repoint company_mentions.company_id -> survivor",
        "3. repoint financial_facts.company_id -> survivor (usually 0 rows; dups lack a cik)",
        "4. repoint insider_transactions.company_id -> survivor",
        "5. repoint resolution_log.resolved_canonical_id -> survivor",
        "6. repoint sec_filings.company_id -> survivor",
        "7. fold mention_count onto survivor",
        "8. backfill survivor ticker+cik (COALESCE; only fills nulls)",
        "9. DELETE retired duplicate rows",
        "All nine inside one BEGIN/COMMIT per cluster.",
        "",
        "## Rollback considerations",
        "",
        "- Each cluster is one transaction: a failure rolls the whole cluster back.",
        "- Repoints are reversible only by knowing the prior fk values; capture them",
        "  first if you want a manual undo (SELECT ... WHERE fk IN (dups) before each",
        "  block). The DELETE is the irreversible step; run a backup/export of the",
        "  retired rows first.",
        "- mention_count fold is not independently idempotent; rely on the per-cluster",
        "  transaction (after a committed cluster the dups are gone, so a re-run is a",
        "  no-op).",
        "",
        "## Single-cluster dry-run harness (observe deltas, commit nothing)",
        "",
        "Wrap one cluster block in a transaction and ROLLBACK to see row counts move",
        "without persisting:",
        "```sql",
        "BEGIN;",
        "-- paste ONE cluster's repoint+fold+backfill+delete statements here",
        "-- then inspect, e.g.:",
        "SELECT 'mentions_on_survivor' AS k, count(*) FROM company_mentions WHERE company_id = '<survivor>';",
        "SELECT 'survivor_row' AS k, id, ticker, sec_cik, mention_count FROM companies WHERE id = '<survivor>';",
        "SELECT 'retired_still_present' AS k, count(*) FROM companies WHERE id IN (<dups>);",
        "ROLLBACK;  -- nothing is committed",
        "```",
        "",
        "## Quarantined clusters (bucket C, manual review)",
        "",
        "| cik | reason | members (name / ticker / cik) |",
        "|---|---|---|",
    ]
    for rec in sorted(bucket_c, key=lambda r: r["cik"]):
        mem = "; ".join(f"{m['name']} (t={m['ticker']}, cik={m['sec_cik']})" for m in rec["members"])
        md.append(f"| {rec['cik']} | {rec['reason']} | {mem} |")
    md.append("")
    open(MD_PATH, "w").write("\n".join(md))


def _worked(bucket_a, bucket_b, bucket_c, child_counts, ticker):
    for b, label in ((bucket_a, "A"), (bucket_b, "B"), (bucket_c, "C")):
        for rec in b:
            if (rec["survivor"]["ticker"] == ticker or rec["art_ticker"] == ticker
                    or any(m["ticker"] == ticker for m in rec["members"])):
                surv = rec["survivor"]
                mem = "; ".join(f"{m['name']}(t={m['ticker']},cik={m['sec_cik']},"
                                f"children={sum(child_counts.get(m['id'],{}).values())})"
                                for m in rec["members"])
                return (f"\n**{ticker}** (bucket {label}, cik {rec['cik']}): members [{mem}]. "
                        f"Survivor -> {surv['name']} ({surv['id']}).")
    return f"\n**{ticker}**: not found in any reconstructed cluster."


if __name__ == "__main__":
    sys.exit(main())
