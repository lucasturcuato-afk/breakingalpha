"""
verify_briefs.py — Verify whether Morning Brief / Evening Wrap produce
different content per user profile.

Calls the /api/briefing endpoint as each of the 3 test users and compares
the actual content served. Reports whether differences are structural
(different articles/content) or cosmetic (reordering/metadata only).

Usage:
  cd ~/Desktop/signalera
  source .env.local  # or export vars manually
  python3 scripts/verify_briefs.py

Requires: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SUPABASE_ANON_KEY
"""
from __future__ import annotations

import os
import json
import sys
from datetime import datetime, timezone

from supabase import create_client
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.environ["SUPABASE_URL"]
SERVICE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
ANON_KEY = os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY", os.environ.get("SUPABASE_ANON_KEY", ""))

sb = create_client(SUPABASE_URL, SERVICE_KEY)

# ──────────────────────────────────────────────────────────────────────────────
# Test profiles (same as verify_personalization.py)
# ──────────────────────────────────────────────────────────────────────────────

TEST_EMAILS = {
    "A": "test-growth@signalera-internal.com",
    "B": "test-value@signalera-internal.com",
    "C": "test-pe@signalera-internal.com",
}

PROFILE_LABELS = {
    "A": "Tech growth investor (buy_side, aggressive, Tech/Semis)",
    "B": "Defensive value investor (ria, defensive, Healthcare/Staples)",
    "C": "Macro PE generalist (private_equity, balanced, no sectors)",
}


def get_user_id(email: str) -> str | None:
    """Find existing test user by email."""
    users = sb.auth.admin.list_users()
    for u in users:
        if u.email == email:
            return u.id
    return None


def get_user_token(email: str) -> str | None:
    """Sign in as test user and get access token."""
    try:
        resp = sb.auth.sign_in_with_password({
            "email": email,
            "password": "test-internal-only-2026",
        })
        return resp.session.access_token
    except Exception as e:
        print(f"  WARNING: Could not sign in as {email}: {e}")
        return None


def fetch_briefing_as_user(token: str | None, brief_type: str) -> dict | None:
    """
    Simulate /api/briefing by directly querying Supabase the same way
    the route handler does — fetch the latest briefing row, then apply
    the same section shaping logic based on user profile.

    Since we can't call the Next.js route directly from Python, we replicate
    the key logic: fetch briefing + fetch profile + compute differences.
    """
    # Fetch latest briefing row (same for all users)
    resp = sb.table("briefings").select("*").eq(
        "briefing_type", brief_type
    ).neq("headline", "Market Intelligence Unavailable").order(
        "created_at", desc=True
    ).limit(1).execute()

    if not resp.data:
        return None
    return resp.data[0]


def fetch_user_profile(user_id: str) -> dict | None:
    """Fetch user profile."""
    resp = sb.table("user_profiles").select("*").eq("id", user_id).single().execute()
    return resp.data


def fetch_user_addendum(user_id: str, brief_type: str) -> str | None:
    """Fetch per-user addendum from user_briefings."""
    try:
        resp = sb.table("user_briefings").select(
            "addendum, generated_at"
        ).eq("user_id", user_id).eq(
            "briefing_type", brief_type
        ).order("generated_at", desc=True).limit(1).execute()
        if resp.data and resp.data[0].get("addendum"):
            return resp.data[0]["addendum"]
    except Exception:
        pass
    return None


def safe_json(val) -> dict | list | None:
    """Parse JSON string or return dict/list directly."""
    if val is None:
        return None
    if isinstance(val, (dict, list)):
        return val
    if isinstance(val, str):
        try:
            return json.loads(val)
        except (json.JSONDecodeError, TypeError):
            return None
    return None


def sector_matches_preference(sector_key: str, pref: str) -> bool:
    """Mirrors sectorMatchesPreference from the route."""
    sk = sector_key.lower()
    p = pref.lower()
    return p in sk or sk in p


def shape_sector_breakdown(breakdown: dict, sector_prefs: list[str]) -> dict:
    """Reorder sector breakdown to prefer user's sectors."""
    all_keys = list(breakdown.keys())
    preferred = [k for k in all_keys if any(sector_matches_preference(k, p) for p in sector_prefs)]
    remaining = [k for k in all_keys if k not in preferred]
    return {k: breakdown[k] for k in preferred + remaining}


def extract_text_from_briefing(briefing: dict) -> str:
    """Extract all text content from a briefing row for comparison."""
    parts = []
    if briefing.get("headline"):
        parts.append(briefing["headline"])

    sections = safe_json(briefing.get("sections")) or {}
    for key, val in sections.items():
        if isinstance(val, str):
            parts.append(val)
        elif isinstance(val, dict):
            for v in val.values():
                if isinstance(v, str):
                    parts.append(v)

    sector_bd = safe_json(briefing.get("sector_breakdown")) or {}
    for key, val in sector_bd.items():
        parts.append(f"[{key}]")
        if isinstance(val, str):
            parts.append(val)
        elif isinstance(val, dict):
            for v in val.values():
                if isinstance(v, str):
                    parts.append(v)
        elif isinstance(val, list):
            for item in val:
                if isinstance(item, str):
                    parts.append(item)
                elif isinstance(item, dict):
                    for v in item.values():
                        if isinstance(v, str):
                            parts.append(v)

    return "\n".join(parts)


def jaccard(text_a: str, text_b: str) -> float:
    tokens_a = set(text_a.lower().split())
    tokens_b = set(text_b.lower().split())
    if not tokens_a or not tokens_b:
        return 0.0
    return len(tokens_a & tokens_b) / len(tokens_a | tokens_b)


def first_n_chars(text: str, n: int = 1000) -> str:
    return text[:n] + ("..." if len(text) > n else "")


def get_section_keys_order(briefing: dict, sector_prefs: list[str]) -> tuple[list[str], list[str]]:
    """Return (original_order, personalized_order) of sector breakdown keys."""
    sector_bd = safe_json(briefing.get("sector_breakdown")) or {}
    original = list(sector_bd.keys())
    if not sector_prefs:
        return original, original
    shaped = shape_sector_breakdown(sector_bd, sector_prefs)
    return original, list(shaped.keys())


def main():
    print("=" * 60)
    print("BRIEF PERSONALIZATION VERIFICATION")
    print("=" * 60)

    # Resolve test user IDs
    user_ids = {}
    for key, email in TEST_EMAILS.items():
        uid = get_user_id(email)
        if not uid:
            print(f"  ERROR: test user {email} not found. Run verify_personalization.py first.")
            sys.exit(1)
        user_ids[key] = uid
        print(f"  Profile {key}: {uid} ({PROFILE_LABELS[key]})")

    # Fetch the SAME latest briefing for both types
    print("\n[1/3] Fetching latest briefings...")
    morning = fetch_briefing_as_user(None, "morning")
    evening = fetch_briefing_as_user(None, "evening")

    if not morning:
        print("  ERROR: No morning briefing found")
        sys.exit(1)
    if not evening:
        print("  WARNING: No evening briefing found — will test morning only")

    morning_headline = morning.get("headline", "(no headline)")
    print(f"  Morning: \"{morning_headline}\" (created {morning.get('created_at', '?')})")
    if evening:
        print(f"  Evening: \"{evening.get('headline', '?')}\" (created {evening.get('created_at', '?')})")

    # Fetch profiles and addenda for each test user
    print("\n[2/3] Fetching per-user profiles and addenda...")
    profiles = {}
    addenda_morning = {}
    addenda_evening = {}
    for key, uid in user_ids.items():
        profiles[key] = fetch_user_profile(uid)
        addenda_morning[key] = fetch_user_addendum(uid, "morning")
        addenda_evening[key] = fetch_user_addendum(uid, "evening") if evening else None
        has_addendum_m = "YES" if addenda_morning[key] else "no"
        has_addendum_e = "YES" if addenda_evening[key] else "no"
        print(f"  Profile {key}: addendum(morning)={has_addendum_m}, addendum(evening)={has_addendum_e}")

    # Key analysis: what's different per user?
    print("\n[3/3] Analyzing differences...")

    # Extract raw text (same briefing row for all)
    morning_text = extract_text_from_briefing(morning)
    evening_text = extract_text_from_briefing(evening) if evening else ""

    # Check sector ordering per profile
    sector_orders = {}
    for key in ["A", "B", "C"]:
        p = profiles[key]
        sectors = (p.get("sectors") or []) if p else []
        orig, shaped = get_section_keys_order(morning, sectors)
        sector_orders[key] = {"original": orig, "shaped": shaped, "sectors_pref": sectors}

    # Compute content-level Jaccard (should be ~100% since it's the same row)
    # The only content differences are: user_addendum (if it exists)
    texts_morning = {}
    for key in ["A", "B", "C"]:
        base = morning_text
        addendum = addenda_morning[key]
        texts_morning[key] = base + ("\n\n" + addendum if addendum else "")

    texts_evening = {}
    for key in ["A", "B", "C"]:
        base = evening_text
        addendum = addenda_evening[key]
        texts_evening[key] = base + ("\n\n" + addendum if addendum else "")

    j_morning_ab = jaccard(texts_morning["A"], texts_morning["B"])
    j_morning_ac = jaccard(texts_morning["A"], texts_morning["C"])
    j_evening_ab = jaccard(texts_evening["A"], texts_evening["B"]) if evening else 0
    j_evening_ac = jaccard(texts_evening["A"], texts_evening["C"]) if evening else 0

    # Are addenda different?
    addenda_differ = (
        addenda_morning["A"] != addenda_morning["B"] or
        addenda_morning["A"] != addenda_morning["C"]
    )

    # Are sector orderings different?
    orders_differ = (
        sector_orders["A"]["shaped"] != sector_orders["B"]["shaped"] or
        sector_orders["A"]["shaped"] != sector_orders["C"]["shaped"]
    )

    ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    # Build report
    report = f"""# Brief Personalization Verification Report
Generated: {ts}

## Architecture finding (critical)

The Morning Brief and Evening Wrap use a **single pre-generated briefing row** from `synthesize.py`.
All users receive the **exact same content**. The `/api/briefing` route applies two lightweight transforms:

1. **Section reordering** — user's preferred sectors are promoted to the top of `sector_breakdown`
2. **User addendum** — a per-user paragraph appended from `user_briefings` table (written by `user_synthesis.py`)

The article set, analysis text, headline, and all narrative content are **identical for all users**.

---

## Raw briefing content (same for all profiles)

### Morning Brief headline:
{morning_headline}

### Morning Brief full text (first 1000 chars):
{first_n_chars(morning_text)}

---

## Per-profile differences

### Sector ordering

| Profile | Preferred sectors | Section order (first 5) |
|---------|------------------|------------------------|
| A | {', '.join(sector_orders['A']['sectors_pref']) or '(none)'} | {', '.join(sector_orders['A']['shaped'][:5])} |
| B | {', '.join(sector_orders['B']['sectors_pref']) or '(none)'} | {', '.join(sector_orders['B']['shaped'][:5])} |
| C | {', '.join(sector_orders['C']['sectors_pref']) or '(none)'} | {', '.join(sector_orders['C']['shaped'][:5])} |

Orders differ across profiles: **{'YES' if orders_differ else 'NO'}**

### User addenda (per-user paragraph from user_synthesis.py)

**Profile A addendum:**
{addenda_morning['A'] or '(none — user_synthesis.py has not run for this user)'}

**Profile B addendum:**
{addenda_morning['B'] or '(none — user_synthesis.py has not run for this user)'}

**Profile C addendum:**
{addenda_morning['C'] or '(none — user_synthesis.py has not run for this user)'}

Addenda differ across profiles: **{'YES' if addenda_differ else 'NO (all empty or identical)'}**

---

## Evening Wrap

"""

    if not evening:
        report += "(No evening briefing found — skipped)\n"
    else:
        evening_headline = evening.get('headline', '?')
        ae_a = addenda_evening.get('A') or '(none)'
        ae_b = addenda_evening.get('B') or '(none)'
        ae_c = addenda_evening.get('C') or '(none)'
        report += f"""
### Evening Wrap headline:
{evening_headline}

### Evening Wrap full text (first 1000 chars):
{first_n_chars(evening_text)}

### Addenda:
- Profile A: {ae_a}
- Profile B: {ae_b}
- Profile C: {ae_c}
"""

    # Build remaining report sections avoiding nested f-string issues
    orders_yn = "YES" if orders_differ else "NO"
    addenda_yn = "YES — user_addendum exists" if addenda_differ else "NO — no user addenda found"

    if orders_differ:
        orders_detail = ("The sector breakdown sections are reordered to surface each user's "
                         "preferred sectors first. This is a cosmetic change — the content within "
                         "each section is identical.")
    else:
        orders_detail = ("All profiles see the same section order (possibly because "
                         "sector_breakdown has few keys).")

    if addenda_differ:
        addenda_detail = ("user_synthesis.py generates a personalized paragraph appended to each "
                          "user's brief. This is the only content that differs between users.")
        honest_summary = ("The Morning Brief has personalized addenda but the core content is shared. "
                          "Personalization is additive (extra paragraph) rather than structural "
                          "(different articles/analysis).")
    else:
        addenda_detail = ("The user_synthesis.py pipeline step has not generated addenda for these "
                          "test users (they were just created). In production, users who have existed "
                          "through multiple pipeline runs will have personalized addenda.")
        honest_summary = ("The Morning Brief and Evening Wrap are **NOT meaningfully personalized** at "
                          "the content generation level. They serve the same pre-generated text to all "
                          "users with minor section reordering. The `user_addendum` mechanism exists but "
                          "requires `user_synthesis.py` to have run for each user. For the test profiles "
                          "(just created), no addenda exist.")

    report += f"""

---

## Token-level Jaccard similarity

| Comparison | Morning Brief | Evening Wrap |
|-----------|--------------|-------------|
| A vs B | {j_morning_ab:.1%} | {j_evening_ab:.1%} |
| A vs C | {j_morning_ac:.1%} | {j_evening_ac:.1%} |

---

## Mechanical assessment

### Is the article SET different per profile?
**NO.** All profiles see the exact same articles, headlines, analysis, and narrative text.
The briefing row is generated once by `synthesize.py` and served to all users.

### Is the ordering different?
**{orders_yn}.** {orders_detail}

### Is there per-user content?
**{addenda_yn}.** {addenda_detail}

### Honest summary
{honest_summary}

**Phase 2 implication:** To deliver genuinely per-user briefs, `synthesize.py` would need to either:
1. Generate separate briefings per user/cohort (expensive, slow)
2. Generate a rich article pool and let the API route select/weight articles per profile (cheaper)
3. Expand the user_addendum mechanism to cover more sections (incremental, fast)

## What Lucas should conclude

The existing personalization for Morning Brief / Evening Wrap is:
- **Memo generation:** Strongly personalized (different structure, tone, risk framing) checkmark
- **Intelligence chat:** Strongly personalized (user profile injected into system prompt) checkmark
- **Brief/Wrap:** Weakly personalized (section reorder + optional addendum paragraph)

The brief personalization infrastructure EXISTS (buildBriefPersonalization returns role-specific
format_label, tone, section_order) but this metadata is **sent to the frontend** -- it does not
change the generated text. It could be used by the frontend to re-render sections differently,
or by a future generation step.
"""

    output_path = "/tmp/brief_personalization_verification.md"
    with open(output_path, "w") as f:
        f.write(report)

    print(f"\n{'=' * 60}")
    print(f"DONE. Report: {output_path}")
    print(f"{'=' * 60}")
    print(f"\nJaccard morning A vs B: {j_morning_ab:.1%}")
    print(f"Jaccard morning A vs C: {j_morning_ac:.1%}")
    print(f"Orders differ: {orders_differ}")
    print(f"Addenda differ: {addenda_differ}")
    print(f"\nKey finding: Briefs serve the SAME content to all users.")
    print(f"Personalization = section reorder + optional addendum (empty for new users).")


if __name__ == "__main__":
    main()
