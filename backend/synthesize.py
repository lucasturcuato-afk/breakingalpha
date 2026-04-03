"""
synthesize.py — BreakingAlpha
Generates a detailed analyst-style morning/evening briefing using Groq.
"""

import os, json, re, time, random
from datetime import datetime, timezone, timedelta
from supabase import create_client
from groq import Groq, RateLimitError

supabase = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_ANON_KEY"])
groq     = Groq(api_key=os.environ["GROQ_API_KEY"])

MORNING_SYSTEM = """You are a senior investment banking analyst preparing the daily morning briefing for a capital markets team.

You will receive a list of recent news articles, each tagged with a Signal line written by a buy-side analyst. Use those signals to anchor your analysis.

SECTION RULES — read before writing anything: Only include a section if you have specific, non-generic content from the provided articles. If a section has no real signal — no named company, concrete rate figure, specific country, or actionable catalyst — OMIT that key from the JSON output entirely. Fewer sections with strong signal beats a complete schema with filler. BANNED phrases in every field: "does not directly impact", "no geopolitical developments", "no direct geopolitical", "investors should monitor", "broadly supportive", "ongoing uncertainty", "markets reacted to", "could also affect", "this is consistent with", "highlight", "broadly positive", "limited direct impact", "while not directly". If you cannot write a sentence without a banned phrase, omit the section.

Respond ONLY with valid JSON in this exact schema — no preamble, no markdown fences:
{
  "headline": "Single dominant theme only — pick the highest-signal deal, rate move, or macro catalyst and state it precisely. Name the company or figure involved. Never bundle two unrelated themes with 'and'. 10-15 words.",
  "summary": "3-4 sentences. Every sentence must contain at least one specific company name, dollar figure, rate level, or index move. Lead with the most important implication, not a description of what happened. Banned phrases: 'mix of', 'ongoing activity', 'investment landscape', 'markets reacted to', 'could also', 'highlight'.",
  "market_tone": "One of: RISK-ON | RISK-OFF | MIXED | NEUTRAL",
  "sections": {
    "deals_and_ma": "2-3 sentences. For each deal, state the acquirer, target, price or multiple, and what the transaction signals about the buyer's strategy or sector consolidation pressure — not just that the deal happened. OMIT if no named transactions in the articles.",
    "public_markets": "2-3 sentences on equity market moves, earnings beats/misses, and IPO pipeline. State the directional implication for deal valuations or risk appetite, not just the move. OMIT if no specific market moves or earnings in the articles.",
    "macro_and_rates": "2-3 sentences on rates, Fed signals, or FX moves. State the concrete effect on LBO spreads, deal multiples, or cost of capital — not just that rates moved. OMIT if no concrete rates or macro signal in the articles.",
    "geopolitics": "2-3 sentences naming the specific countries and sectors in the blast radius and the mechanism of impact on capital flows or deal activity. OMIT THIS KEY ENTIRELY if no geopolitical event materially affected markets today — do not write a placeholder, a 'no developments' statement, or a vague monitoring sentence.",
    "sector_spotlight": "2-3 sentences on the single sector with the most concentrated deal or news activity today. Explain why the cluster is happening now — regulatory, cycle, or competitive pressure. Write the sector name explicitly. OMIT if no clear sector cluster exists.",
    "what_to_watch": "Write 3-4 sentences of continuous prose — no bullets, no numbered list. Each sentence must name a specific company, ticker, Fed speaker, or scheduled data release, state the exact expected catalyst, and commit to the binary outcome that matters (e.g., 'A miss from X would signal demand destruction in Y, pressuring comps Z and W'). Write it as a paragraph a senior analyst would read aloud. BANNED phrases: 'investors should monitor', 'watch for', 'could be impacted', 'may be affected', 'bears watching', 'remain cautious'."
  },
  "top_deals": [
    {
      "company": "Target company name",
      "deal_type": "M&A | LBO | IPO | VC Round | Strategic Investment | Debt Financing",
      "valuation": "$Xb or null",
      "one_liner": "State acquirer, target, price or multiple, and why investors in adjacent names should reprice — one sentence, no filler."
    }
  ],
  "sector_breakdown": {
    "note": "Only include sectors where the provided articles contain a specific, named signal — omit any sector with nothing concrete. Do not invent signals for uncovered sectors."
  }
}

Only include sectors with meaningful activity. top_deals should have 0-5 entries — returning 0, 1, or 2 entries is always correct when fewer articles satisfy all four criteria below. Never pad the array to reach a minimum count. The Signal line on each article describes capital markets relevance only — it does NOT qualify an article as a top_deals entry. Apply the HARD GATE based on the article's PRIMARY subject, not its Signal.

HARD GATE — apply this test first, before anything else: Is the article's PRIMARY subject the announcement, signing, or closing of a named transaction? If the article is primarily about a company's earnings, profit, revenue, stock move, product, or general business news — even if that company has also done deals — it does NOT qualify. Discard it immediately.

A qualifying top_deals entry MUST satisfy ALL FOUR of the following — if any one is missing, exclude the entry entirely: (1) a named, specific acquirer, investor, or lead party — "undisclosed" or "investors" does not count; (2) a named target company or asset; (3) a confirmed or publicly reported transaction type (acquisition, merger, LBO, IPO, VC round, strategic investment, or debt financing) — fundraising interest, plans, or activity without a confirmed round, named lead investor, and disclosed amount does not qualify; (4) the transaction must be the primary subject of the article, not background context or analyst commentary.

Exclude without exception: earnings reports, revenue or profit results, stock price moves, analyst upgrades or downgrades, product launches, index inclusions, executive appointments, general company performance news, and fundraising stories without a named lead investor and confirmed amount — even if the article features a well-known company. If no qualifying deal exists in the provided articles, return an empty top_deals array rather than filling it with non-deal stories. Never use bracket placeholders — always write the actual name. When stating implications, use hedged language ('may signal', 'suggests') unless multiple articles confirm the same direction — never imply sector-wide repricing, macro conclusions, or broader competitive dynamics from a single story. Banned phrases unless strongly evidenced by multiple articles: 'ongoing consolidation', 'sector rotation', 'broader trend', 'continued pressure'."""

EVENING_SYSTEM = """You are a senior investment banking analyst preparing the evening market wrap briefing.

You will receive today's news articles, each tagged with a Signal line written by a buy-side analyst. Use those signals to anchor your wrap.

SECTION RULES — read before writing anything: Only include a section if you have specific, non-generic content from the provided articles. If a section has no real signal — no named company, concrete rate figure, specific country, or actionable catalyst — OMIT that key from the JSON output entirely. Fewer sections with strong signal beats a complete schema with filler. BANNED phrases in every field: "does not directly impact", "no geopolitical developments", "no direct geopolitical", "investors should monitor", "broadly supportive", "ongoing uncertainty", "markets reacted to", "could also affect", "this is consistent with", "highlight", "broadly positive", "limited direct impact", "while not directly". If you cannot write a sentence without a banned phrase, omit the section.

Respond ONLY with valid JSON in this exact schema — no preamble, no markdown fences:
{
  "headline": "Single defining story from the day — name the company, deal, or data point that drove the tape. 10-15 words. No multi-theme bundles.",
  "summary": "3-4 sentences. Every sentence must contain a specific company name, dollar figure, rate level, or index move. State what today's developments signal going into tomorrow. Banned phrases: 'mix of', 'ongoing activity', 'investment landscape', 'markets reacted to', 'could also', 'highlight'.",
  "market_tone": "One of: RISK-ON | RISK-OFF | MIXED | NEUTRAL",
  "sections": {
    "deals_and_ma": "2-3 sentences. For each deal, name acquirer and target, state the price or multiple, and explain what the transaction signals about buyer strategy or sector consolidation pressure. OMIT if no named transactions in the articles.",
    "public_markets": "2-3 sentences on how markets closed. Name the key movers and state what the tape is pricing in for tomorrow — not just that stocks went up or down. OMIT if no specific market close data or named movers in the articles.",
    "macro_and_rates": "2-3 sentences on macro and rates. State the concrete implication for deal multiples, credit spreads, or risk appetite into tomorrow. OMIT if no concrete rates or macro signal in the articles.",
    "geopolitics": "2-3 sentences naming the specific countries and sectors in the blast radius and the mechanism of impact on capital flows or deal activity. OMIT THIS KEY ENTIRELY if nothing geopolitical materially affected markets today — do not write a placeholder, a 'no developments' statement, or a vague monitoring sentence.",
    "tomorrow_setup": "Write 3-4 sentences of continuous prose — no bullets, no numbered list. Each sentence must name a specific company, speaker, or data release, state the exact expected catalyst, and commit to what a beat or miss would signal for the broader market or sector. Write it as a paragraph a senior analyst would read aloud. BANNED phrases: 'investors should monitor', 'watch for', 'could be impacted', 'may be affected', 'bears watching', 'remain cautious'."
  },
  "top_deals": [
    {
      "company": "Target company name",
      "deal_type": "M&A | LBO | IPO | VC Round | Strategic Investment | Debt Financing",
      "valuation": "$Xb or null",
      "one_liner": "State acquirer, target, price or multiple, and why investors in adjacent names should reprice — one sentence, no filler."
    }
  ],
  "sector_breakdown": {
    "note": "Only include sectors where the provided articles contain a specific, named signal — omit any sector with nothing concrete. Do not invent signals for uncovered sectors."
  }
}

Only include sectors with meaningful activity. top_deals should have 0-5 entries — returning 0, 1, or 2 entries is always correct when fewer articles satisfy all four criteria below. Never pad the array to reach a minimum count. The Signal line on each article describes capital markets relevance only — it does NOT qualify an article as a top_deals entry. Apply the HARD GATE based on the article's PRIMARY subject, not its Signal.

HARD GATE — apply this test first, before anything else: Is the article's PRIMARY subject the announcement, signing, or closing of a named transaction? If the article is primarily about a company's earnings, profit, revenue, stock move, product, or general business news — even if that company has also done deals — it does NOT qualify. Discard it immediately.

A qualifying top_deals entry MUST satisfy ALL FOUR of the following — if any one is missing, exclude the entry entirely: (1) a named, specific acquirer, investor, or lead party — "undisclosed" or "investors" does not count; (2) a named target company or asset; (3) a confirmed or publicly reported transaction type (acquisition, merger, LBO, IPO, VC round, strategic investment, or debt financing) — fundraising interest, plans, or activity without a confirmed round, named lead investor, and disclosed amount does not qualify; (4) the transaction must be the primary subject of the article, not background context or analyst commentary.

Exclude without exception: earnings reports, revenue or profit results, stock price moves, analyst upgrades or downgrades, product launches, index inclusions, executive appointments, general company performance news, and fundraising stories without a named lead investor and confirmed amount — even if the article features a well-known company. If no qualifying deal exists in the provided articles, return an empty top_deals array rather than filling it with non-deal stories. Never use bracket placeholders — always write the actual name. When stating implications, use hedged language ('may signal', 'suggests') unless multiple articles confirm the same direction — never imply sector-wide repricing, macro conclusions, or broader competitive dynamics from a single story. Banned phrases unless strongly evidenced by multiple articles: 'ongoing consolidation', 'sector rotation', 'broader trend', 'continued pressure'."""

def _diversify_articles(articles, sector_cap=4, company_cap=2, total=20):
    """
    Prevent any single deal cluster or company from dominating synthesis input.
    Walks the relevance-sorted list greedily, capping per-sector and per-company
    representation. Returns at most `total` articles.
    """
    from collections import defaultdict
    sector_counts = defaultdict(int)
    company_counts = defaultdict(int)
    selected = []
    for a in articles:  # already sorted by relevance_score desc
        sector = a.get("sector") or ""
        companies = a.get("companies") or []
        if isinstance(companies, str):
            try:
                companies = json.loads(companies)
            except Exception:
                companies = []

        if sector_counts[sector] >= sector_cap:
            continue
        if companies and any(company_counts[c] >= company_cap for c in companies):
            continue

        selected.append(a)
        sector_counts[sector] += 1
        for c in companies:
            company_counts[c] += 1

        if len(selected) >= total:
            break

    return selected


# Minimum relevance_score for a floor (breadth) article to be included.
# All stored articles have score >= 6 (ingest filter), but score-6 articles
# are borderline — their summaries are often weak. Score 7+ means the article
# has a genuine market implication worth surfacing as sector context.
FLOOR_MIN_SCORE = 7


def _select_articles_for_synthesis(
    articles,
    spine_count=12,
    floor_count=6,
    spine_sector_cap=3,
    company_cap=2,
):
    """
    Two-bucket article selection for synthesis input.

    Spine (spine_count slots): depth-first greedy walk, sector_cap=spine_sector_cap.
    Captures the dominant editorial stories with enough per-sector depth for
    the LLM to write concrete analysis. sector_cap=3 (vs old 4) allows up to
    4 distinct sectors in 12 articles.

    Floor (up to floor_count slots): one best article per sector NOT already in
    the spine, minimum score FLOOR_MIN_SCORE. Ensures the LLM sees at least one
    data point from each active sector today, increasing the chance that any
    given sector appears in sector_breakdown and analyst sections.

    Returns (spine, floor) so the caller can format them with different
    summary truncation: spine gets full context, floor gets shorter context
    since they are breadth signals, not primary stories.

    articles must already be sorted by relevance_score descending.
    """
    from collections import defaultdict

    def _parse_companies(a):
        companies = a.get("companies") or []
        if isinstance(companies, str):
            try:
                return json.loads(companies)
            except Exception:
                return []
        return companies

    # ── Spine: greedy walk, sector_cap=spine_sector_cap ───────────────────────
    sector_counts  = defaultdict(int)
    company_counts = defaultdict(int)
    spine     = []
    spine_ids = set()

    for a in articles:
        sector    = a.get("sector") or ""
        companies = _parse_companies(a)

        if sector_counts[sector] >= spine_sector_cap:
            continue
        if companies and any(company_counts[c] >= company_cap for c in companies):
            continue

        spine.append(a)
        spine_ids.add(id(a))
        sector_counts[sector] += 1
        for c in companies:
            company_counts[c] += 1

        if len(spine) >= spine_count:
            break

    # ── Floor: one best article per uncovered sector ───────────────────────────
    # articles is already score-sorted, so the first eligible article per sector
    # is automatically the highest-scoring one for that sector.
    covered_sectors = {a.get("sector") or "" for a in spine}
    best_per_sector = {}

    for a in articles:
        if id(a) in spine_ids:
            continue
        score  = a.get("relevance_score") or 0
        sector = a.get("sector") or ""
        if not sector or sector in covered_sectors:
            continue
        if score < FLOOR_MIN_SCORE:
            continue
        if sector not in best_per_sector:
            best_per_sector[sector] = a  # first = highest score for this sector

    floor = list(best_per_sector.values())[:floor_count]

    return spine, floor


def groq_with_backoff(messages, temperature=0.3, max_tokens=2000, max_retries=5):
    """Call Groq with exponential backoff + jitter on 429 rate limit errors."""
    for attempt in range(max_retries):
        try:
            resp = groq.chat.completions.create(
                model="llama-3.3-70b-versatile",
                messages=messages,
                temperature=temperature,
                max_tokens=max_tokens,
            )
            return resp.choices[0].message.content.strip()
        except RateLimitError:
            if attempt == max_retries - 1:
                raise
            wait = (2 ** attempt) + random.uniform(0, 1)
            print(f"  ⚠ Groq 429 — waiting {wait:.1f}s (attempt {attempt+1}/{max_retries})")
            time.sleep(wait)
        except Exception:
            raise
    raise RateLimitError("Groq rate limit: max retries exceeded")

def run(brief_type="morning"):
    print(f"📝 Synthesizing {brief_type} briefing...")

    # Pull a larger pool from last 24 hours, then diversify to prevent
    # a single deal cluster or company from dominating the briefing.
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
    resp = supabase.table("articles")\
        .select("title, summary, sector, companies, relevance_score, relevance_reason")\
        .gte("ingested_at", cutoff)\
        .order("relevance_score", desc=True)\
        .limit(60)\
        .execute()

    articles = resp.data or []
    if not articles:
        resp = supabase.table("articles")\
            .select("title, summary, sector, companies, relevance_score, relevance_reason")\
            .order("ingested_at", desc=True)\
            .limit(60)\
            .execute()
        articles = resp.data or []

    spine, floor = _select_articles_for_synthesis(articles)
    print(f"  📰 Synthesis input: {len(spine)} spine + {len(floor)} floor articles "
          f"({len(spine) + len(floor)} total, from pool of up to 60)")

    # Spine: full summary context (300 chars) — these are the dominant stories
    spine_texts = [
        f"[{a.get('sector','')}] {a.get('title','')}\n{(a.get('summary','') or '')[:300]}"
        + (f"\nSignal: {a['relevance_reason']}" if a.get('relevance_reason') else "")
        for a in spine
    ]
    # Floor: shortened summary (150 chars) — breadth signals, not lead stories
    floor_texts = [
        f"[{a.get('sector','')}] {a.get('title','')}\n{(a.get('summary','') or '')[:150]}"
        + (f"\nSignal: {a['relevance_reason']}" if a.get('relevance_reason') else "")
        for a in floor
    ]

    article_text = "\n\n".join(spine_texts)
    if floor_texts:
        article_text += "\n\n--- ADDITIONAL SECTOR SIGNALS ---\n\n" + "\n\n".join(floor_texts)

    system = MORNING_SYSTEM if brief_type == "morning" else EVENING_SYSTEM

    data = None
    try:
        raw = groq_with_backoff(
            messages=[
                {"role": "system", "content": system},
                {"role": "user",   "content": f"Today's articles:\n\n{article_text}"},
            ],
            temperature=0.3,
            max_tokens=2000,
        )
        raw = re.sub(r"^```json|^```|```$", "", raw, flags=re.MULTILINE).strip()
        data = json.loads(raw)
    except RateLimitError:
        print(f"  ✗ Groq rate limit exhausted after retries — falling back to stub briefing")
    except Exception as e:
        print(f"  ✗ Groq error: {e} — falling back to stub briefing")

    if data is None:
        data = {
            "headline": "Market Intelligence Unavailable",
            "summary": "Briefing generation failed. Please check logs.",
            "market_tone": "NEUTRAL",
            "sections": {},
            "top_deals": [],
            "sector_breakdown": {}
        }

    now = datetime.now(timezone.utc).isoformat()
    row = {
        "briefing_type":    brief_type,
        "headline":         data.get("headline", ""),
        "summary":          data.get("summary", ""),
        "market_tone":      data.get("market_tone", "NEUTRAL"),
        "sections":         json.dumps(data.get("sections", {})),
        "top_deals":        json.dumps(data.get("top_deals", [])),
        "sector_breakdown": json.dumps(data.get("sector_breakdown", {})),
        "created_at":       now,
    }

    supabase.table("briefings").insert(row).execute()
    print(f"  ✅ {brief_type.capitalize()} briefing stored")
    print(f"  Headline: {row['headline'][:80]}")

if __name__ == "__main__":
    import sys
    brief_type = sys.argv[1] if len(sys.argv) > 1 else "morning"
    run(brief_type)
