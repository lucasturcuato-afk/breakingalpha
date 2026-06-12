"""companies[]-only backfill for the #352 primary_company fold.

Retroactively applies, to EXISTING articles, the same fold #352 does at ingest:
add primary_company to articles.companies[] when it resolves to an indexed company
(case-insensitive exact match against companies.name) and is not already present.

HARD FREEZE: this tool touches articles.companies[] ONLY. It NEVER inserts
company_mentions and NEVER updates companies.mention_count or aliases.mention_count.
The single write site is _append_company_to_article (an articles.update of the
companies array). Grep this file for "company_mentions" and "mention_count": the
only hits are this docstring, comments, and the read-only snapshot/validate code
that READS companies.mention_count to prove it did not move. There is no write path
to those tables.

Modes:
  --dry-run   (default) compute the change set, write scripts/out/backfill_plan.jsonl
              and scripts/out/mention_count_snapshot.json, print counts. Writes
              NOTHING to the database.
  --execute   apply the companies[] additions in batches of 500, idempotent (re-check
              absence per article), append each applied change to
              scripts/out/backfill_audit_<timestamp>.jsonl, resumable (skip
              article_ids already audited). companies[] only.
  --rollback <auditfile>   remove exactly the (article_id, add_company) pairs in the
              audit log from companies[]. Fully reverses an --execute.
  --validate  re-check that below-threshold pages now cross the ArticlesTab threshold,
              and assert companies.mention_count for the top 25 affected companies
              equals the pre-write snapshot (the freeze held).

DB: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (service role; required for --execute,
also used for reads). Run from the repo root with .env.local present.
"""

import argparse
import glob
import json
import os
import sys
from datetime import datetime, timezone, timedelta

from dotenv import load_dotenv
from supabase import create_client


OUT_DIR = os.path.join(os.path.dirname(__file__), "out")
PLAN_PATH = os.path.join(OUT_DIR, "backfill_plan.jsonl")
SNAPSHOT_PATH = os.path.join(OUT_DIR, "mention_count_snapshot.json")
BATCH_SIZE = 500
PAGE_SIZE = 1000
THRESHOLD = 3  # ArticlesTab below-threshold cutoff (tagged in 14d)
TOP_N_SNAPSHOT = 25


def get_client():
    load_dotenv()
    load_dotenv(".env.local")
    url = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY. Service role is "
              "required (no anon fallback). Aborting, nothing done.")
        sys.exit(1)
    return create_client(url, key)


def _ensure_out():
    os.makedirs(OUT_DIR, exist_ok=True)


# ---------------------------------------------------------------------------
# Resolution + change-set computation (mirrors backend/ingest.py #352 logic)
# ---------------------------------------------------------------------------
def load_indexed_names(client):
    """All companies.name, lowercased, as a set. Read-only, paginated."""
    names = set()
    page = 0
    while True:
        # Stable order is required: PostgREST .range() pagination without an
        # explicit order can skip or duplicate rows across pages.
        resp = (client.table("companies").select("name").order("id")
                .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1).execute())
        rows = resp.data or []
        for r in rows:
            n = (r.get("name") or "").strip()
            if n:
                names.add(n.lower())
        if len(rows) < PAGE_SIZE:
            break
        page += 1
    return names


def compute_change_set(client, indexed):
    """Return list of {article_id, add_company} for every article whose
    primary_company resolves to an indexed company and is not already in its
    companies[]. Read-only, paginated."""
    changes = []
    page = 0
    while True:
        # Stable order (by id) so .range() pagination cannot skip or duplicate
        # rows across pages. Without it the change set is undercounted.
        resp = (client.table("articles")
                .select("id, primary_company, companies")
                .not_.is_("primary_company", "null")
                .order("id")
                .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1).execute())
        rows = resp.data or []
        for r in rows:
            primary = (r.get("primary_company") or "").strip()
            if not primary:
                continue
            if primary.lower() not in indexed:
                continue
            companies = r.get("companies") or []
            if any((c or "").lower() == primary.lower() for c in companies):
                continue
            changes.append({"article_id": r["id"], "add_company": primary})
        if len(rows) < PAGE_SIZE:
            break
        page += 1
    return changes


def _top_companies(changes, n):
    counts = {}
    for ch in changes:
        k = ch["add_company"]
        counts[k] = counts.get(k, 0) + 1
    return sorted(counts.items(), key=lambda kv: kv[1], reverse=True)[:n]


# ---------------------------------------------------------------------------
# The ONLY write site. companies[] update. No mention_count, no company_mentions.
# ---------------------------------------------------------------------------
def _append_company_to_article(client, article_id, add_company):
    """Idempotent companies[] append for one article. Re-reads the row, adds
    add_company only if still absent (case-insensitive), and updates ONLY the
    companies column. Returns True if it wrote, False if it was already present /
    missing. This function and its single .update() are the entire write surface
    of this tool. It does not and cannot reach company_mentions or mention_count."""
    cur = (client.table("articles").select("companies").eq("id", article_id)
           .limit(1).execute())
    if not cur.data:
        return False
    companies = cur.data[0].get("companies") or []
    if any((c or "").lower() == add_company.lower() for c in companies):
        return False
    new_companies = [*companies, add_company]
    client.table("articles").update({"companies": new_companies}).eq("id", article_id).execute()
    return True


def _remove_company_from_article(client, article_id, add_company):
    """Reverse of the append: remove add_company (case-insensitive) from companies[].
    companies[] only."""
    cur = (client.table("articles").select("companies").eq("id", article_id)
           .limit(1).execute())
    if not cur.data:
        return False
    companies = cur.data[0].get("companies") or []
    new_companies = [c for c in companies if (c or "").lower() != add_company.lower()]
    if len(new_companies) == len(companies):
        return False
    client.table("articles").update({"companies": new_companies}).eq("id", article_id).execute()
    return True


# ---------------------------------------------------------------------------
# Snapshot (read-only): companies.mention_count for the top affected companies
# ---------------------------------------------------------------------------
def capture_mention_count_snapshot(client, changes):
    top = _top_companies(changes, TOP_N_SNAPSHOT)
    snap = {"captured_at": datetime.now(timezone.utc).isoformat(), "rows": []}
    for name, affected in top:
        resp = (client.table("companies").select("name, ticker, mention_count")
                .eq("name", name).limit(1).execute())
        row = (resp.data or [{}])[0]
        snap["rows"].append({
            "name": name,
            "ticker": row.get("ticker"),
            "mention_count": row.get("mention_count"),
            "affected_articles": affected,
        })
    return snap


# ---------------------------------------------------------------------------
# Modes
# ---------------------------------------------------------------------------
def mode_dry_run(client):
    _ensure_out()
    print("[dry-run] loading indexed company names...")
    indexed = load_indexed_names(client)
    print(f"[dry-run] indexed companies: {len(indexed)}")
    print("[dry-run] computing change set (read-only)...")
    changes = compute_change_set(client, indexed)
    distinct = len({c["add_company"].lower() for c in changes})
    with open(PLAN_PATH, "w") as f:
        for ch in changes:
            f.write(json.dumps(ch) + "\n")
    snap = capture_mention_count_snapshot(client, changes)
    with open(SNAPSHOT_PATH, "w") as f:
        json.dump(snap, f, indent=2)
    print("-" * 64)
    print(f"[dry-run] change-set articles:   {len(changes)}")
    print(f"[dry-run] distinct companies:    {distinct}")
    print(f"[dry-run] plan written:          {PLAN_PATH}")
    print(f"[dry-run] mention_count snapshot: {SNAPSHOT_PATH}")
    print("[dry-run] NOTHING was written to the database.")
    print("-" * 64)


def _load_plan():
    if not os.path.exists(PLAN_PATH):
        print(f"No plan at {PLAN_PATH}. Run --dry-run first.")
        sys.exit(1)
    out = []
    with open(PLAN_PATH) as f:
        for line in f:
            line = line.strip()
            if line:
                out.append(json.loads(line))
    return out


def _audited_ids(audit_path):
    done = set()
    if os.path.exists(audit_path):
        with open(audit_path) as f:
            for line in f:
                line = line.strip()
                if line:
                    try:
                        done.add(json.loads(line)["article_id"])
                    except Exception:
                        pass
    return done


def mode_execute(client, resume_audit=None):
    _ensure_out()
    changes = _load_plan()
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    audit_path = resume_audit or os.path.join(OUT_DIR, f"backfill_audit_{stamp}.jsonl")
    done = _audited_ids(audit_path)
    print(f"[execute] plan rows: {len(changes)}; already audited: {len(done)}; "
          f"audit log: {audit_path}")
    print("[execute] companies[]-only. No company_mentions, no mention_count.")
    applied = skipped = 0
    with open(audit_path, "a") as audit:
        for i, ch in enumerate(changes):
            if ch["article_id"] in done:
                skipped += 1
                continue
            wrote = _append_company_to_article(client, ch["article_id"], ch["add_company"])
            if wrote:
                audit.write(json.dumps({
                    "article_id": ch["article_id"],
                    "add_company": ch["add_company"],
                    "applied_at": datetime.now(timezone.utc).isoformat(),
                }) + "\n")
                audit.flush()
                applied += 1
            else:
                skipped += 1
            if (i + 1) % BATCH_SIZE == 0:
                print(f"[execute] progress {i + 1}/{len(changes)} "
                      f"(applied {applied}, skipped {skipped})")
    print(f"[execute] done. applied {applied}, skipped {skipped}. audit: {audit_path}")


def mode_rollback(client, audit_path):
    if not os.path.exists(audit_path):
        print(f"Audit file not found: {audit_path}")
        sys.exit(1)
    removed = missing = 0
    with open(audit_path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            rec = json.loads(line)
            if _remove_company_from_article(client, rec["article_id"], rec["add_company"]):
                removed += 1
            else:
                missing += 1
    print(f"[rollback] removed {removed}, already-absent {missing}, from {audit_path}")


def _tagged_14d_for_name(client, name):
    """Read-only count of articles in the last 14d whose companies[] contains `name`
    (case-insensitive exact element). Proxy for the ArticlesTab tagged count."""
    cut = (datetime.now(timezone.utc) - timedelta(days=14)).isoformat()
    resp = (client.table("articles").select("companies")
            .gte("published_at", cut).limit(5000).execute())
    n = 0
    for r in (resp.data or []):
        if any((c or "").lower() == name.lower() for c in (r.get("companies") or [])):
            n += 1
    return n


def mode_validate(client):
    if not os.path.exists(SNAPSHOT_PATH):
        print(f"No snapshot at {SNAPSHOT_PATH}. Run --dry-run before execute.")
        sys.exit(1)
    with open(SNAPSHOT_PATH) as f:
        snap = json.load(f)
    print("[validate] freeze check: companies.mention_count vs pre-write snapshot")
    ok = True
    for row in snap["rows"]:
        resp = (client.table("companies").select("mention_count")
                .eq("name", row["name"]).limit(1).execute())
        now_mc = (resp.data or [{}])[0].get("mention_count")
        status = "OK" if now_mc == row["mention_count"] else "CHANGED"
        if status == "CHANGED":
            ok = False
        print(f"  {status:7} {row['name']:24} snapshot={row['mention_count']} now={now_mc}")
    print(f"[validate] freeze {'HELD' if ok else 'VIOLATED'}: "
          f"mention_count unchanged for all {len(snap['rows'])} top companies"
          if ok else "[validate] FREEZE VIOLATED: a mention_count changed (investigate)")
    print("[validate] page-fill spot check (tagged in 14d vs threshold):")
    for row in snap["rows"][:10]:
        t = _tagged_14d_for_name(client, row["name"])
        print(f"  {row['name']:24} tagged_14d={t} "
              f"{'POPULATED' if t >= THRESHOLD else 'still thin'}")


def main():
    p = argparse.ArgumentParser(description="companies[]-only primary_company backfill")
    g = p.add_mutually_exclusive_group()
    g.add_argument("--dry-run", action="store_true", help="compute change set, write nothing (default)")
    g.add_argument("--execute", action="store_true", help="apply companies[] additions (writes)")
    g.add_argument("--rollback", metavar="AUDITFILE", help="reverse an execute from its audit log")
    g.add_argument("--validate", action="store_true", help="check freeze + page-fill after execute")
    p.add_argument("--resume", metavar="AUDITFILE", help="resume an --execute from an existing audit log")
    args = p.parse_args()

    client = get_client()
    if args.execute:
        mode_execute(client, resume_audit=args.resume)
    elif args.rollback:
        mode_rollback(client, args.rollback)
    elif args.validate:
        mode_validate(client)
    else:
        mode_dry_run(client)


if __name__ == "__main__":
    main()
