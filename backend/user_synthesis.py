"""
user_synthesis.py — BreakingAlpha personalization step (pipeline step 14).

Generates a short per-user "For You" addendum that personalizes the global
morning/evening briefing based on the user's onboarding profile and the
last 30 days of inferred sector weights.

Run order: executes after synthesize.py has written the canonical briefing
for today, so we can re-read it here and derive each user's personal hook
instead of re-generating the whole brief per user (too many Gemini calls).

Soft-fails everywhere:
  - Missing user_profiles / user_briefings tables → pipeline continues.
  - Gemini call fails for one user → log, skip that user, continue.
"""

import hashlib
import json
import os
from datetime import datetime, timezone

from supabase import create_client
from google import genai
from google.genai import types


from outputs import record_output
from output_constants import ADDENDUM_PROMPT_VERSION
from supabase_client import get_service_client

supabase = get_service_client()
gemini_client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
GEMINI_MODEL = "gemini-2.5-flash"


# ─────────────────────────────────────────────────────────────────────────────
# Profile helpers (mirror of src/lib/user-profile.ts)
# ─────────────────────────────────────────────────────────────────────────────

ROLE_LABEL = {
    "student_analyst": "student analyst learning equity research",
    "buy_side": "buy-side analyst at an investment manager",
    "sell_side": "sell-side analyst covering public equities",
    "private_equity": "private-equity investor evaluating deals",
    "ria": "registered investment advisor managing client portfolios",
    "family_office": "family-office investor allocating private capital",
    "other": "investor",
}

RISK_LABEL = {
    "aggressive": "comfortable with higher-beta ideas and contrarian positioning",
    "balanced": "looking for well-supported ideas across the risk spectrum",
    "defensive": "prefers lower-volatility compounders and downside-protected setups",
}


def get_user_profiles():
    """Return all onboarded users as a list of profile dicts. Soft-fails to []."""
    try:
        resp = (
            supabase.table("user_profiles")
            .select(
                "id, first_name, role, firm_or_school, sectors, risk_appetite, "
                "watchlist_tickers, inferred_sector_weights, onboarding_completed"
            )
            .eq("onboarding_completed", True)
            .execute()
        )
        return resp.data or []
    except Exception as e:
        print(f"  ⚠ user_synthesis: get_user_profiles failed: {e}")
        return []


def build_user_context_paragraph(profile: dict) -> str:
    """Render a profile as a short prompt-ready paragraph."""
    parts = []
    name = (profile.get("first_name") or "").strip() or None
    role_id = profile.get("role")
    role = ROLE_LABEL.get(role_id) if role_id else None
    firm_or_school = (profile.get("firm_or_school") or "").strip() or None

    if role:
        who_bits = [
            b for b in [name, role, f"at {firm_or_school}" if firm_or_school else None] if b
        ]
        parts.append(f"Reader: {', '.join(who_bits)}.")
    elif name:
        parts.append(f"Reader: {name}.")

    sectors = profile.get("sectors") or []
    if sectors:
        parts.append(f"Focus sectors: {', '.join(sectors)}.")

    tickers = profile.get("watchlist_tickers") or []
    if tickers:
        parts.append(f"Watchlist tickers: {', '.join(tickers)}.")

    risk = profile.get("risk_appetite") or "balanced"
    parts.append(f"Risk posture: {RISK_LABEL.get(risk, RISK_LABEL['balanced'])}.")

    weights = profile.get("inferred_sector_weights") or {}
    if isinstance(weights, dict) and weights:
        boosted = sorted(
            [(k, v) for k, v in weights.items() if isinstance(v, (int, float)) and v >= 1.2],
            key=lambda kv: -kv[1],
        )[:3]
        muted = sorted(
            [(k, v) for k, v in weights.items() if isinstance(v, (int, float)) and v <= 0.8],
            key=lambda kv: kv[1],
        )[:3]
        if boosted:
            parts.append(f"Recently engaged most with: {', '.join(k for k, _ in boosted)}.")
        if muted:
            parts.append(f"Has been dismissing: {', '.join(k for k, _ in muted)}.")

    return " ".join(parts)


def _profile_hash(profile: dict) -> str:
    """Stable sha256 of the profile fields that influence the addendum."""
    canonical = {
        "role": profile.get("role"),
        "sectors": sorted(profile.get("sectors") or []),
        "tickers": sorted(profile.get("watchlist_tickers") or []),
        "risk": profile.get("risk_appetite"),
        "weights": profile.get("inferred_sector_weights") or {},
    }
    return hashlib.sha256(
        json.dumps(canonical, sort_keys=True, default=str).encode("utf-8")
    ).hexdigest()


# ─────────────────────────────────────────────────────────────────────────────
# Briefing lookup
# ─────────────────────────────────────────────────────────────────────────────


def _fetch_latest_briefing(brief_type: str):
    try:
        resp = (
            supabase.table("briefings")
            .select("id, headline, summary, sections, top_deals, sector_breakdown, created_at")
            .eq("briefing_type", brief_type)
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
        return (resp.data or [None])[0]
    except Exception as e:
        print(f"  ⚠ user_synthesis: fetch latest briefing failed: {e}")
        return None


def _format_briefing_for_prompt(brief: dict) -> str:
    """Flatten the briefing JSON into a short analyst-readable block."""
    if not brief:
        return ""
    sections = brief.get("sections")
    if isinstance(sections, str):
        try:
            sections = json.loads(sections)
        except Exception:
            sections = {}
    sector_breakdown = brief.get("sector_breakdown")
    if isinstance(sector_breakdown, str):
        try:
            sector_breakdown = json.loads(sector_breakdown)
        except Exception:
            sector_breakdown = {}

    lines = []
    if brief.get("headline"):
        lines.append(f"Headline: {brief['headline']}")
    if brief.get("summary"):
        lines.append(f"Summary: {brief['summary']}")
    if isinstance(sections, dict):
        for k, v in sections.items():
            if isinstance(v, str) and v.strip():
                lines.append(f"{k}: {v}")
    if isinstance(sector_breakdown, dict) and sector_breakdown:
        sb = "; ".join(f"{k}: {v}" for k, v in sector_breakdown.items() if isinstance(v, str))
        if sb:
            lines.append(f"Sector breakdown: {sb}")
    return "\n".join(lines)


# ─────────────────────────────────────────────────────────────────────────────
# Gemini call
# ─────────────────────────────────────────────────────────────────────────────


def _generate_addendum(brief_block: str, context_paragraph: str) -> str:
    """Generate a ~2-3 sentence personalized takeaway for one user. Soft-fails to ''."""
    if not brief_block or not context_paragraph:
        return ""

    system = (
        "You are a senior investment banking analyst writing a one-paragraph "
        "'For You' addendum that personalizes today's market briefing for a "
        "specific reader. You will receive the briefing and a short reader "
        "profile. Write 2-3 sentences of continuous prose — no bullets, no "
        "headers. Lead with the single most relevant item from the briefing "
        "for THIS reader (anchor on their focus sectors, watchlist tickers, "
        "or risk posture). Name specific companies, figures, or catalysts "
        "that actually appeared in the briefing — never invent. If nothing "
        "in the briefing is relevant to the reader, return an empty string."
    )
    user = (
        f"READER PROFILE:\n{context_paragraph}\n\n"
        f"TODAY'S BRIEFING:\n{brief_block}\n\n"
        "Write the 'For You' addendum now."
    )
    try:
        resp = gemini_client.models.generate_content(
            model=GEMINI_MODEL,
            contents=user,
            config=types.GenerateContentConfig(
                system_instruction=system,
                temperature=0.3,
                max_output_tokens=400,
                thinking_config=types.ThinkingConfig(thinking_budget=0),
            ),
        )
        text = (resp.text or "").strip()
        # Strip markdown fences if the model added any
        if text.startswith("```"):
            text = text.strip("`").strip()
        return text
    except Exception as e:
        print(f"  ⚠ user_synthesis: Gemini call failed: {e}")
        return ""


# ─────────────────────────────────────────────────────────────────────────────
# Entrypoint
# ─────────────────────────────────────────────────────────────────────────────


def run(brief_type: str = "morning") -> None:
    """
    Generate one per-user addendum row for each onboarded user.
    Meant to run as step 14 in backend/run.py, after synthesize.py.
    """
    print(f"🧭 Personalizing {brief_type} briefing per user...")

    brief = _fetch_latest_briefing(brief_type)
    if not brief:
        print("  ⚠ No briefing found — skipping user personalization.")
        return

    brief_block = _format_briefing_for_prompt(brief)
    users = get_user_profiles()
    if not users:
        print("  (no onboarded users — skipping)")
        return

    print(f"  → {len(users)} onboarded user(s)")
    now = datetime.now(timezone.utc).isoformat()
    written = 0
    skipped = 0

    for p in users:
        uid = p.get("id")
        if not uid:
            continue
        context = build_user_context_paragraph(p)
        if not context:
            skipped += 1
            continue

        addendum = _generate_addendum(brief_block, context)
        if not addendum:
            skipped += 1
            continue

        row = {
            "user_id": uid,
            "briefing_type": brief_type,
            "addendum": addendum,
            "profile_hash": _profile_hash(p),
            "generated_at": now,
        }
        try:
            ub_resp = supabase.table("user_briefings").insert(row).execute()
            ub_id = None
            try:
                if ub_resp.data and isinstance(ub_resp.data[0], dict):
                    ub_id = ub_resp.data[0].get("id")
            except Exception:
                pass
            written += 1

            # Record to universal outputs table
            try:
                record_output(
                    supabase,
                    output_type='user_addendum',
                    content={
                        'user_briefing_id': str(ub_id) if ub_id else None,
                        'briefing_type': brief_type,
                        'addendum_excerpt': (addendum or '')[:500],
                        'profile_hash': _profile_hash(p),
                    },
                    generation_context={
                        'model': GEMINI_MODEL,
                        'prompt_version': ADDENDUM_PROMPT_VERSION,
                    },
                    user_id=uid,
                    source_table='user_briefings',
                    source_id=ub_id,
                )
            except Exception as rec_err:
                print(f"  ⚠ record_output(user_addendum) failed for {uid}: {rec_err}")
        except Exception as e:
            print(f"  ⚠ user_briefings insert failed for {uid}: {e}")
            skipped += 1

    print(f"  ✅ Wrote {written} per-user addenda ({skipped} skipped)")


if __name__ == "__main__":
    import sys

    bt = sys.argv[1] if len(sys.argv) > 1 else "morning"
    run(bt)
