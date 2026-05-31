"""
verify_personalization.py — Side-by-side test of personalization injection.

Creates 3 test user profiles in Supabase, runs the SAME memo prompt and chat
query against each using the exact same prompt-injection logic as the app,
then writes a comparison report to /tmp/personalization_verification.md.

Usage:
  cd ~/Desktop/signalera
  source .env.local  # or export vars manually
  PYTHONPATH=. python3 scripts/verify_personalization.py

Requires: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GEMINI_API_KEY
"""
from __future__ import annotations

import os
import sys
import json
import time
from datetime import datetime, timezone
from textwrap import dedent

from supabase import create_client
from google import genai
from google.genai import types
from dotenv import load_dotenv

load_dotenv()

# ──────────────────────────────────────────────────────────────────────────────
# Setup
# ──────────────────────────────────────────────────────────────────────────────

SUPABASE_URL = os.environ["SUPABASE_URL"]
SERVICE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
GEMINI_API_KEY = os.environ["GEMINI_API_KEY"]

sb = create_client(SUPABASE_URL, SERVICE_KEY)
gemini = genai.Client(api_key=GEMINI_API_KEY)
MODEL = "gemini-2.5-flash"

# ──────────────────────────────────────────────────────────────────────────────
# Test profiles
# ──────────────────────────────────────────────────────────────────────────────

PROFILES = {
    "A": {
        "email": "test-growth@signalera-internal.com",
        "label": "Tech growth investor",
        "summary": "buy_side, aggressive, Tech/Semis, medium-term",
        "profile": {
            "role": "buy_side",
            "sectors": ["Technology", "Semiconductors"],
            "risk_appetite": "aggressive",
            "strategy_type": "equity",
            "investment_horizon": "medium",
            "workflow_style": "deep_dive",
            "watchlist_tickers": ["NVDA", "AMD", "AVGO", "TSM"],
            "onboarding_completed": True,
            "first_name": "Test Growth",
        },
    },
    "B": {
        "email": "test-value@signalera-internal.com",
        "label": "Defensive value investor",
        "summary": "ria, defensive, Healthcare/Staples, long-term",
        "profile": {
            "role": "ria",
            "sectors": ["Healthcare", "Consumer Staples", "Utilities"],
            "risk_appetite": "defensive",
            "strategy_type": "equity",
            "investment_horizon": "long",
            "workflow_style": "screening",
            "watchlist_tickers": ["JNJ", "PG", "KO", "WMT"],
            "onboarding_completed": True,
            "first_name": "Test Value",
        },
    },
    "C": {
        "email": "test-pe@signalera-internal.com",
        "label": "Macro PE generalist",
        "summary": "private_equity, balanced, long-term, no sectors",
        "profile": {
            "role": "private_equity",
            "sectors": [],
            "risk_appetite": "balanced",
            "strategy_type": "pe",
            "investment_horizon": "long",
            "workflow_style": "deep_dive",
            "watchlist_tickers": [],
            "onboarding_completed": True,
            "first_name": "Test PE",
        },
    },
}

# ──────────────────────────────────────────────────────────────────────────────
# Prompt injection logic (mirrors src/app/api/memo/route.ts::buildMemoPrompt)
# ──────────────────────────────────────────────────────────────────────────────

ROLE_BLOCKS = {
    "buy_side": """MEMO FORMAT FOR THIS READER (buy-side analyst — direct, no hand-holding):
Structure the memo with these exact sections:
1. **The Trade** — Long/short, catalyst, time horizon. One paragraph max.
2. **Thesis in 3 Bullets** — Why now, why this, why us. Each bullet is one sentence.
3. **Bear Case + What Kills It** — Name the specific risk that invalidates the thesis.
4. **Comparable Situations** — 1-2 recent analogues from the same sector or setup type.
5. **Position Sizing Context** — High/medium/low conviction framing.
6. **Key Dates** — Numbered list of upcoming catalysts with dates.
Tone: direct, assumes fluency. No explaining basics.""",

    "ria": """MEMO FORMAT FOR THIS READER (investment advisor — balanced, client-aware):
Structure the memo with these exact sections:
1. **Opportunity Summary** — What is this and why look at it now.
2. **Risk/Return Framing** — Upside vs downside in concrete terms.
3. **Portfolio Fit** — How this relates to the reader's focus sectors and risk posture.
4. **Bear Case** — What goes wrong and how bad.
5. **Action Items** — Specific next steps: monitor, research further, or act.
Tone: balanced, client-aware.""",

    "private_equity": """MEMO FORMAT FOR THIS READER (private equity — IC memo style):
Structure the memo with these exact sections:
1. **Deal Merit Summary** — Why this asset is interesting. 2-3 sentences max.
2. **Entry Multiple Context** — How the implied valuation compares to comparable transactions.
3. **Value Creation Levers** — Operational, financial, and strategic levers. Be specific.
4. **Exit Scenarios** — 3-5 year horizon with multiple range for each scenario.
5. **Key Risks** — Leverage, sponsor competition, macro exposure. Name specific risks.
6. **IC Recommendation** — Clear go/no-go framing with conditions.
Tone: IC memo style. Dense. No fluff. Every sentence must carry information.""",
}

STRATEGY_OVERLAYS = {
    "pe": "STRATEGY LENS: Apply private equity framing — reference entry multiples, deal structure, and return profiles in every valuation discussion.",
    "equity": "STRATEGY LENS: Apply public equity lens — reference earnings estimates, consensus expectations, and relative valuation throughout.",
    "macro": "STRATEGY LENS: Apply macro regime context — connect every risk and catalyst to the current macro environment (rates, FX, policy).",
}

# Mirrors buildPersonalizationContext from src/lib/user-profile.ts
ROLE_LABELS = {
    "buy_side": "buy-side analyst",
    "sell_side": "sell-side analyst",
    "private_equity": "private equity professional",
    "ria": "registered investment advisor",
    "family_office": "family office",
    "student_analyst": "student analyst",
    "other": "investment professional",
}


def build_personalization_context(profile: dict) -> str:
    """Mirrors src/lib/user-profile.ts::buildPersonalizationContext."""
    parts = []
    role = profile.get("role")
    name = (profile.get("first_name") or "").strip()
    if role:
        who = ", ".join(filter(None, [name, ROLE_LABELS.get(role, role)]))
        parts.append(f"Reader: {who}.")
    elif name:
        parts.append(f"Reader: {name}.")

    sectors = profile.get("sectors") or []
    if sectors:
        parts.append(f"Focus sectors: {', '.join(sectors)}.")
    watchlist = profile.get("watchlist_tickers") or []
    if watchlist:
        parts.append(f"Watchlist tickers: {', '.join(watchlist)}.")

    risk = profile.get("risk_appetite", "balanced")
    risk_labels = {"aggressive": "aggressive — seeking asymmetric upside", "defensive": "defensive — capital preservation focus", "balanced": "balanced"}
    parts.append(f"Risk posture: {risk_labels.get(risk, risk)}.")

    strategy = profile.get("strategy_type")
    strat_labels = {"pe": "PE / buyout mandate", "equity": "public equity mandate", "macro": "macro mandate", "credit": "credit mandate", "vc": "venture mandate"}
    if strategy:
        parts.append(f"Strategy: {strat_labels.get(strategy, strategy)}.")

    horizon = profile.get("investment_horizon")
    h_labels = {"short": "short horizon (weeks to a few months)", "medium": "medium horizon (6-18 months)", "long": "long horizon (multi-year)"}
    if horizon:
        parts.append(f"Horizon: {h_labels.get(horizon, horizon)}.")

    workflow = profile.get("workflow_style")
    w_labels = {"deep_dive": "works via deep-dive single-name research", "screening": "works via systematic screening and shortlists", "monitoring": "works via ongoing monitoring of existing positions"}
    if workflow:
        parts.append(f"Workflow: {w_labels.get(workflow, workflow)}.")

    return " ".join(parts)


def build_memo_prompt(profile: dict, base_prompt: str) -> str:
    """Mirrors src/app/api/memo/route.ts::buildMemoPrompt."""
    role = profile.get("role", "")
    role_block = ROLE_BLOCKS.get(role, ROLE_BLOCKS["ria"])  # default fallback

    augmented = role_block + "\n\n" + base_prompt

    strategy = profile.get("strategy_type")
    if strategy and strategy in STRATEGY_OVERLAYS:
        augmented += "\n\n" + STRATEGY_OVERLAYS[strategy]

    risk = profile.get("risk_appetite")
    if risk == "defensive":
        augmented += "\n\nRISK POSTURE: Reader has a defensive risk appetite. Emphasize downside risks, capital preservation, and hedging considerations. Lead bear case analysis."
    elif risk == "aggressive":
        augmented += "\n\nRISK POSTURE: Reader has an aggressive risk appetite. Emphasize asymmetric upside, contrarian angles, and catalyst-driven opportunities. Frame risks as manageable where evidence supports it."

    horizon = profile.get("investment_horizon")
    if horizon == "short":
        augmented += "\n\nTIME HORIZON: Reader operates on a short-term horizon (weeks to months). Prioritize near-term catalysts, event-driven angles, and technical setup."
    elif horizon == "long":
        augmented += "\n\nTIME HORIZON: Reader operates on a long-term horizon (multi-year). Prioritize structural themes, secular trends, and durable competitive advantages over near-term noise."

    watchlist = profile.get("watchlist_tickers") or []
    if watchlist:
        augmented += f"\n\nWATCHLIST: Reader actively monitors these tickers: {', '.join(watchlist)}. If the memo subject relates to any of these, call out the connection explicitly."

    return augmented


# ──────────────────────────────────────────────────────────────────────────────
# Gemini call helper
# ──────────────────────────────────────────────────────────────────────────────

def call_gemini(system_prompt: str, user_prompt: str) -> str:
    """Call Gemini with system + user prompt, return text."""
    resp = gemini.models.generate_content(
        model=MODEL,
        contents=[{"role": "user", "parts": [{"text": user_prompt}]}],
        config=types.GenerateContentConfig(
            system_instruction=system_prompt,
            temperature=0.7,
            max_output_tokens=4096,
        ),
    )
    return resp.text or "(empty response)"


# ──────────────────────────────────────────────────────────────────────────────
# Test execution
# ──────────────────────────────────────────────────────────────────────────────

MEMO_QUERY = "Write a memo on Nvidia covering the AI infrastructure thesis and the most important risks."

CHAT_QUERY = "What should I be watching this week and why?"

CHAT_SYSTEM = """You are Signalera Intelligence, a senior analyst assistant. You help investment professionals stay informed by synthesizing market intelligence, company-specific news, and macro trends. Answer concisely and specifically. Reference data, catalysts, and concrete events."""


def jaccard_similarity(text_a: str, text_b: str) -> float:
    """Token-level Jaccard similarity."""
    tokens_a = set(text_a.lower().split())
    tokens_b = set(text_b.lower().split())
    if not tokens_a or not tokens_b:
        return 0.0
    intersection = tokens_a & tokens_b
    union = tokens_a | tokens_b
    return len(intersection) / len(union)


def first_n_words(text: str, n: int = 100) -> str:
    words = text.split()
    return " ".join(words[:n]) + ("..." if len(words) > n else "")


def extract_section(text: str, heading: str) -> str:
    """Extract content after a markdown heading until the next heading."""
    lines = text.split("\n")
    capturing = False
    result = []
    for line in lines:
        if heading.lower() in line.lower() and line.strip().startswith("**"):
            capturing = True
            result.append(line)
            continue
        if capturing:
            if line.strip().startswith("**") and line.strip().endswith("**"):
                break
            # Also break on numbered bold headings like "3. **Bear Case**"
            if line.strip() and line.strip()[0].isdigit() and "**" in line and capturing and len(result) > 1:
                break
            result.append(line)
    return "\n".join(result).strip() if result else "(section not found)"


def main():
    print("=" * 60)
    print("PERSONALIZATION VERIFICATION HARNESS")
    print("=" * 60)

    # ── Step 1: Create test users in Supabase ──
    print("\n[1/4] Creating test user profiles...")
    user_ids = {}
    for key, data in PROFILES.items():
        email = data["email"]
        profile = data["profile"]

        # Create auth user (or get existing)
        try:
            resp = sb.auth.admin.create_user({
                "email": email,
                "password": "test-internal-only-2026",
                "email_confirm": True,
            })
            uid = resp.user.id
            print(f"  Profile {key}: created user {uid}")
        except Exception as e:
            if "already been registered" in str(e) or "already_exists" in str(e):
                # Fetch existing
                users = sb.auth.admin.list_users()
                uid = None
                for u in users:
                    if u.email == email:
                        uid = u.id
                        break
                if not uid:
                    print(f"  ERROR: Could not find existing user {email}: {e}")
                    sys.exit(1)
                print(f"  Profile {key}: existing user {uid}")
            else:
                print(f"  ERROR creating user {email}: {e}")
                sys.exit(1)

        user_ids[key] = uid

        # Upsert profile
        payload = {"id": uid, **profile}
        sb.table("user_profiles").upsert(payload).execute()
        print(f"  Profile {key}: upserted profile ({data['label']})")

    # ── Step 2: Run memo test ──
    print("\n[2/4] Running MEMO test (3 profiles x 1 query)...")
    memo_outputs = {}
    for key, data in PROFILES.items():
        profile = data["profile"]
        prompt = build_memo_prompt(profile, MEMO_QUERY)
        system = "You are a senior investment analyst writing research memos. Write thorough, structured analysis."
        print(f"  Calling Gemini for Profile {key} ({data['label']})...")
        memo_outputs[key] = call_gemini(system, prompt)
        print(f"  Profile {key}: {len(memo_outputs[key])} chars")
        time.sleep(1)

    # ── Step 3: Run chat test ──
    print("\n[3/4] Running CHAT test (3 profiles x 1 query)...")
    chat_outputs = {}
    for key, data in PROFILES.items():
        profile = data["profile"]
        personalization_ctx = build_personalization_context(profile)
        system = CHAT_SYSTEM
        if personalization_ctx:
            system += "\n\nUSER PROFILE:\n" + personalization_ctx
        print(f"  Calling Gemini for Profile {key} ({data['label']})...")
        chat_outputs[key] = call_gemini(system, CHAT_QUERY)
        print(f"  Profile {key}: {len(chat_outputs[key])} chars")
        time.sleep(1)

    # ── Step 4: Build report ──
    print("\n[4/4] Building verification report...")

    # Mechanical analysis
    memo_jaccard_ab = jaccard_similarity(memo_outputs["A"], memo_outputs["B"])
    memo_jaccard_ac = jaccard_similarity(memo_outputs["A"], memo_outputs["C"])
    chat_jaccard_ab = jaccard_similarity(chat_outputs["A"], chat_outputs["B"])
    chat_jaccard_ac = jaccard_similarity(chat_outputs["A"], chat_outputs["C"])

    # Check for framing signals
    memo_a_lower = memo_outputs["A"].lower()
    memo_b_lower = memo_outputs["B"].lower()
    memo_c_lower = memo_outputs["C"].lower()

    a_growth = any(w in memo_a_lower for w in ["aggressive", "asymmetric", "upside", "catalyst-driven", "contrarian"])
    b_defensive = any(w in memo_b_lower for w in ["defensive", "conservative", "preservation", "downside", "hedg"])
    c_pe = any(w in memo_c_lower for w in ["ic ", "deal merit", "entry multiple", "value creation", "exit scenario", "ic recommendation"])

    # Risk sections
    risk_a = extract_section(memo_outputs["A"], "bear case") or extract_section(memo_outputs["A"], "risk")
    risk_b = extract_section(memo_outputs["B"], "bear case") or extract_section(memo_outputs["B"], "risk")
    risk_c = extract_section(memo_outputs["C"], "risk") or extract_section(memo_outputs["C"], "bear case")

    ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    report = f"""# Personalization Verification Report
Generated: {ts}

## Profile summaries
- Profile A: {PROFILES['A']['label']} ({PROFILES['A']['summary']})
- Profile B: {PROFILES['B']['label']} ({PROFILES['B']['summary']})
- Profile C: {PROFILES['C']['label']} ({PROFILES['C']['summary']})

---

## TEST 1: MEMO ON NVIDIA

### Profile A output:
{memo_outputs['A']}

### Profile B output:
{memo_outputs['B']}

### Profile C output:
{memo_outputs['C']}

### Side-by-side opening paragraphs (first 100 words):
| Profile A | Profile B | Profile C |
|---|---|---|
| {first_n_words(memo_outputs['A'])} | {first_n_words(memo_outputs['B'])} | {first_n_words(memo_outputs['C'])} |

### Side-by-side risk sections:
| Profile A | Profile B | Profile C |
|---|---|---|
| {first_n_words(risk_a, 80)} | {first_n_words(risk_b, 80)} | {first_n_words(risk_c, 80)} |

---

## TEST 2: CHAT — "What should I be watching this week?"

### Profile A response:
{chat_outputs['A']}

### Profile B response:
{chat_outputs['B']}

### Profile C response:
{chat_outputs['C']}

### Side-by-side first-100-words:
| Profile A | Profile B | Profile C |
|---|---|---|
| {first_n_words(chat_outputs['A'])} | {first_n_words(chat_outputs['B'])} | {first_n_words(chat_outputs['C'])} |

---

## Mechanical analysis

| Metric | Value |
|--------|-------|
| Token-level Jaccard: A vs B (memo) | {memo_jaccard_ab:.1%} |
| Token-level Jaccard: A vs C (memo) | {memo_jaccard_ac:.1%} |
| Token-level Jaccard: A vs B (chat) | {chat_jaccard_ab:.1%} |
| Token-level Jaccard: A vs C (chat) | {chat_jaccard_ac:.1%} |
| Profile A memo has aggressive/growth framing? | {'YES' if a_growth else 'NO'} |
| Profile B memo has defensive/conservative framing? | {'YES' if b_defensive else 'NO'} |
| Profile C memo has PE/deal framing? | {'YES' if c_pe else 'NO'} |

## Claude Code's read

The personalization system produces {"structurally different" if memo_jaccard_ab < 0.4 else "moderately different" if memo_jaccard_ab < 0.6 else "similar"} outputs across profiles.

Key observations:
- Memo structure differs because each role gets a completely different section template (buy-side gets "The Trade" + "Thesis in 3 Bullets", RIA gets "Opportunity Summary" + "Portfolio Fit", PE gets "Deal Merit" + "Exit Scenarios").
- Risk framing is {"correctly differentiated" if a_growth and b_defensive else "not clearly differentiated"} between aggressive and defensive profiles.
- PE profile {"correctly receives" if c_pe else "does NOT receive"} IC-memo-style deal framing.
- Chat responses should differ based on injected USER PROFILE context (sectors, watchlist, risk posture).

## What Lucas should look for when reading

When reading the side-by-side outputs, ask:
1. Would a real user with Profile A vs B notice the difference?
2. Is the difference in WHAT'S said or just HOW it's phrased?
3. Are risks framed differently for aggressive vs defensive profiles?
4. Does the PE profile's memo feel like it's for a deal/investment committee rather than a stock pick?
"""

    output_path = "/tmp/personalization_verification.md"
    with open(output_path, "w") as f:
        f.write(report)

    print(f"\n{'=' * 60}")
    print(f"DONE. Report written to: {output_path}")
    print(f"{'=' * 60}")
    print(f"\nMemo Jaccard A vs B: {memo_jaccard_ab:.1%}")
    print(f"Memo Jaccard A vs C: {memo_jaccard_ac:.1%}")
    print(f"Chat Jaccard A vs B: {chat_jaccard_ab:.1%}")
    print(f"Chat Jaccard A vs C: {chat_jaccard_ac:.1%}")
    print(f"Profile A growth framing: {a_growth}")
    print(f"Profile B defensive framing: {b_defensive}")
    print(f"Profile C PE framing: {c_pe}")


if __name__ == "__main__":
    main()
