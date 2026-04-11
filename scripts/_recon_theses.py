"""
_recon_theses.py — throwaway recon script (Phase 0).

Selects one row from `theses` and prints the keys so we can confirm the
actual column set. Reads SUPABASE_URL / SUPABASE_ANON_KEY from the
environment. Load `.env.local` (NEXT_PUBLIC_* fallback) before running.
"""

import os
import json
import sys

# Allow the script to work whether env is named SUPABASE_* or NEXT_PUBLIC_SUPABASE_*
url = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
key = os.environ.get("SUPABASE_ANON_KEY") or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")

if not url or not key:
    print("ERROR: SUPABASE_URL / SUPABASE_ANON_KEY not set (and no NEXT_PUBLIC_* fallback)")
    sys.exit(2)

from supabase import create_client  # noqa: E402

supabase = create_client(url, key)

try:
    resp = supabase.table("theses").select("*").order("generated_at", desc=True).limit(1).execute()
    rows = resp.data or []
    if not rows:
        print("theses table: EMPTY")
        sys.exit(0)
    row = rows[0]
    print("theses columns observed (1 row):")
    for k in sorted(row.keys()):
        v = row[k]
        preview = str(v)[:80]
        print(f"  - {k:<28} {type(v).__name__:<8} {preview}")
    print("\nRaw row (truncated to 2000 chars):")
    print(json.dumps(row, default=str)[:2000])
except Exception as e:
    print(f"theses query failed: {e}")
    sys.exit(1)
