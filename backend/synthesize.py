"""
synthesize.py — BreakingAlpha
Generates a detailed analyst-style morning/evening briefing using Google Gemini.
"""

import os, json, re
from datetime import datetime, timezone, timedelta, date
from supabase import create_client
from google import genai
from google.genai import types

supabase = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_ANON_KEY"])
# Admin client for writes that must bypass RLS (e.g. morning_brief_calls).
# Falls back to the anon client if the service role key is unavailable so
# local dev does not hard-crash — inserts will simply fail closed.
_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
supabase_admin = (
    create_client(os.environ["SUPABASE_URL"], _SERVICE_KEY) if _SERVICE_KEY else supabase
)
gemini_client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
GEMINI_MODEL = "gemini-2.5-flash"

MORNING_SYSTEM = """You are a senior investment banking analyst preparing the daily morning briefing for a capital markets team.

WATCHLIST DIRECTIVE:
The articles marked [WATCHLIST] below are from companies and tickers that users are actively tracking. When these companies appear in the news, prioritize them in your analysis:
- If a watchlist company is involved in a deal, it MUST appear in top_deals and deals_and_ma
- If a watchlist company has notable earnings or market moves, it MUST appear in public_markets or sector_spotlight
- Mention watchlist companies by name explicitly — do not bury them in generic sector commentary
- If watchlist signals are weak or off-topic today, it is acceptable to omit them — do not force irrelevant content

This directive applies only when [WATCHLIST] articles are present in the input. If no [WATCHLIST] articles are provided, ignore this directive entirely.

You will receive a list of recent news articles, each tagged with a Signal line written by a buy-side analyst. Use those signals to anchor your analysis.

SECTION RULES — read before writing anything: Only include a section if you have specific, non-generic content from the provided articles. If a section has no real signal — no named company, concrete rate figure, specific country, or actionable catalyst — OMIT that key from the JSON output entirely. Fewer sections with strong signal beats a complete schema with filler. BANNED phrases in every field: "does not directly impact", "no geopolitical developments", "no direct geopolitical", "investors should monitor", "broadly supportive", "ongoing uncertainty", "markets reacted to", "could also affect", "this is consistent with", "highlight", "broadly positive", "limited direct impact", "while not directly". If you cannot write a sentence without a banned phrase, omit the section.

HEADLINE SELECTION — complete this step before writing any JSON: Scan every article and Signal line. Rank stories by market significance in this order: (1) largest named dollar figure or confirmed transaction; (2) broadest macro or rates signal (Fed statement, inflation print, credit spread move); (3) widest sector or market-moving development. The dominant story is the one a capital markets desk would open their morning call with. Identify it explicitly, then write the headline around it. Do not let a narrower or merely interesting item displace a larger macro or deal story.

Respond ONLY with valid JSON in this exact schema — no preamble, no markdown fences:
{
  "headline": "Write the headline for the dominant story you identified above — not a category label, not a topic area, the actual named development. Count the words: must be 10–15 words. If under 10 words, rewrite it. Name the specific company, institution, index, or data point involved. State what happened or is happening, not just the subject. Must not be a generic phrase interchangeable with headlines from other days. Never bundle two unrelated themes with 'and'. BANNED patterns: any headline under 8 words; vague labels ('Markets Face Uncertainty', 'Tech Sector Active', 'Volatility Returns'); naming a secondary story when a larger deal or macro story is present in the articles. BAD example: 'SpaceX Files for IPO' (4 words, no market implication). GOOD example: 'Fed Signals June Pause as May CPI Beats, Compressing Near-Term Rate-Cut Expectations'.",
  "summary": "3-4 sentences. Each sentence must cover ONE story or ONE data point — never blend two unrelated topics into a single sentence with 'while', 'as', 'amid', or 'even as'. Every sentence must contain at least one specific company name, dollar figure, rate level, or index move. Lead with the most important implication, not a description of what happened. Banned phrases: 'mix of', 'ongoing activity', 'investment landscape', 'markets reacted to', 'could also', 'highlight', 'alongside', 'coupled with'.",
  "market_tone": "One of: RISK-ON | RISK-OFF | MIXED | NEUTRAL",
  "market_pulse": {
    "sentiment_word": "A single evocative adjective that captures the market's psychological state today — e.g., 'anxious', 'complacent', 'exuberant', 'defensive', 'bifurcated', 'numb'. One word. Lower-case. No punctuation.",
    "narrative": "2-3 short paragraphs (separated by \\n\\n) written in an editorial voice. State the dominant emotional posture of capital markets today, then the two or three concrete catalysts driving that posture. Name specific companies, prints, or policy actions — no vague prose. Read it like a Stratechery opener, not a bank research note."
  },
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
    "Technology M&A": "2-3 sentence narrative on deal activity, named companies, multiples, and strategic signals in this sector. Replace this key with the actual sector name — use as many sector keys as you have real data for. Only include a sector if you can name at least one specific company and state a concrete signal from the articles. Omit sectors with no real data."
  }
}

Only include sectors with meaningful activity. top_deals should have 0-5 entries — returning 0, 1, or 2 entries is always correct when fewer articles satisfy all four criteria below. Never pad the array to reach a minimum count. The Signal line on each article describes capital markets relevance only — it does NOT qualify an article as a top_deals entry. Apply the HARD GATE based on the article's PRIMARY subject, not its Signal.

HARD GATE — apply this test first, before anything else: Is the article's PRIMARY subject the announcement, signing, or closing of a named transaction? If the article is primarily about a company's earnings, profit, revenue, stock move, product, or general business news — even if that company has also done deals — it does NOT qualify. Discard it immediately.

A qualifying top_deals entry MUST satisfy ALL FOUR of the following — if any one is missing, exclude the entry entirely: (1) a named, specific acquirer, investor, or lead party — "undisclosed" or "investors" does not count; (2) a named target company or asset; (3) a confirmed or publicly reported transaction type (acquisition, merger, LBO, IPO, VC round, strategic investment, or debt financing) — fundraising interest, plans, or activity without a confirmed round, named lead investor, and disclosed amount does not qualify; (4) the transaction must be the primary subject of the article, not background context or analyst commentary.

Exclude without exception: earnings reports, revenue or profit results, stock price moves, analyst upgrades or downgrades, product launches, index inclusions, executive appointments, general company performance news, and fundraising stories without a named lead investor and confirmed amount — even if the article features a well-known company. If no qualifying deal exists in the provided articles, return an empty top_deals array rather than filling it with non-deal stories. Never use bracket placeholders — always write the actual name. When stating implications, use hedged language ('may signal', 'suggests') unless multiple articles confirm the same direction — never imply sector-wide repricing, macro conclusions, or broader competitive dynamics from a single story. Banned phrases unless strongly evidenced by multiple articles: 'ongoing consolidation', 'sector rotation', 'broader trend', 'continued pressure'."""

EVENING_SYSTEM = """You are a senior investment banking analyst preparing the evening market wrap briefing.

WATCHLIST DIRECTIVE:
The articles marked [WATCHLIST] below are from companies and tickers that users are actively tracking. When these companies appear in the news, prioritize them in your analysis:
- If a watchlist company is involved in a deal, it MUST appear in top_deals and deals_and_ma
- If a watchlist company has notable earnings or market moves, it MUST appear in public_markets or sector_spotlight
- Mention watchlist companies by name explicitly — do not bury them in generic sector commentary
- If watchlist signals are weak or off-topic today, it is acceptable to omit them — do not force irrelevant content

This directive applies only when [WATCHLIST] articles are present in the input. If no [WATCHLIST] articles are provided, ignore this directive entirely.

You will receive today's news articles, each tagged with a Signal line written by a buy-side analyst. Use those signals to anchor your wrap.

SECTION RULES — read before writing anything: Only include a section if you have specific, non-generic content from the provided articles. If a section has no real signal — no named company, concrete rate figure, specific country, or actionable catalyst — OMIT that key from the JSON output entirely. Fewer sections with strong signal beats a complete schema with filler. BANNED phrases in every field: "does not directly impact", "no geopolitical developments", "no direct geopolitical", "investors should monitor", "broadly supportive", "ongoing uncertainty", "markets reacted to", "could also affect", "this is consistent with", "highlight", "broadly positive", "limited direct impact", "while not directly". If you cannot write a sentence without a banned phrase, omit the section.

HEADLINE SELECTION — complete this step before writing any JSON: Scan every article and Signal line. Rank stories by market significance in this order: (1) largest named dollar figure or confirmed transaction; (2) broadest macro or rates signal (Fed statement, inflation print, credit spread move); (3) widest sector or market-moving development. The dominant story is the one a capital markets desk would close their evening call with. Identify it explicitly, then write the headline around it. Do not let a narrower or merely interesting item displace a larger macro or deal story.

Respond ONLY with valid JSON in this exact schema — no preamble, no markdown fences:
{
  "headline": "Write the headline for the dominant story you identified above — not a category label, not a topic area, the actual named development. Count the words: must be 10–15 words. If under 10 words, rewrite it. Name the specific company, institution, index, or data point involved. State what drove the tape today, not just the subject. Must not be a generic phrase interchangeable with headlines from other days. Never bundle two unrelated themes with 'and'. BANNED patterns: any headline under 8 words; vague labels ('Markets Close Mixed', 'Tech Sells Off', 'Volatility Spikes'); naming a secondary story when a larger deal or macro story is present in the articles. BAD example: 'Stocks Close Lower' (3 words, no named driver). GOOD example: 'S&P 500 Falls 1.4% as Hotter-Than-Expected May CPI Wipes Out June Fed Cut Pricing'.",
  "summary": "3-4 sentences. Each sentence must cover ONE story or ONE data point — never blend two unrelated topics into a single sentence with 'while', 'as', 'amid', or 'even as'. Every sentence must contain a specific company name, dollar figure, rate level, or index move. State what today's developments signal going into tomorrow. Banned phrases: 'mix of', 'ongoing activity', 'investment landscape', 'markets reacted to', 'could also', 'highlight', 'alongside', 'coupled with'.",
  "market_tone": "One of: RISK-ON | RISK-OFF | MIXED | NEUTRAL",
  "market_pulse": {
    "sentiment_word": "A single evocative adjective capturing how today's session closed psychologically — e.g., 'relieved', 'rattled', 'bifurcated', 'defensive', 'numb', 'exuberant'. One word. Lower-case. No punctuation.",
    "narrative": "2-3 short paragraphs (separated by \\n\\n) written in an editorial voice. Lead with the dominant emotional posture of the tape at the close, then the two or three concrete drivers — named earnings prints, Fed signal, sector moves. No hedging prose. Read it like a Stratechery close-of-day column, not a bank wrap."
  },
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
    "Technology M&A": "2-3 sentence narrative on deal activity, named companies, multiples, and strategic signals in this sector. Replace this key with the actual sector name — use as many sector keys as you have real data for. Only include a sector if you can name at least one specific company and state a concrete signal from the articles. Omit sectors with no real data."
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
        sector = (a.get("industry_verticals") or [a.get("sector", "")])[0]
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
        sector    = (a.get("industry_verticals") or [a.get("sector", "")])[0]
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
    covered_sectors = {(a.get("industry_verticals") or [a.get("sector", "")])[0] for a in spine}
    best_per_sector = {}

    for a in articles:
        if id(a) in spine_ids:
            continue
        score  = a.get("relevance_score") or 0
        sector = (a.get("industry_verticals") or [a.get("sector", "")])[0]
        if not sector or sector in covered_sectors:
            continue
        if score < FLOOR_MIN_SCORE:
            continue
        if sector not in best_per_sector:
            best_per_sector[sector] = a  # first = highest score for this sector

    floor = list(best_per_sector.values())[:floor_count]

    return spine, floor


def _validate_sector_breakdown(sb):
    """
    Validate and repair sector_breakdown after parsing.

    The JSON schema example in the system prompt uses 'Technology M&A' as a
    placeholder key to show the model the expected shape. If the model echoes
    the schema instruction text as a value (rather than writing a real narrative),
    that entry is detected and dropped.

    Detection strategy: check the VALUE for instruction-language markers.
    This catches schema-echo regardless of which key the model used.

    Returns a clean dict of {sector_name: narrative} or {} if nothing valid.
    """
    if not isinstance(sb, dict):
        return {}

    # Phrases that appear in schema instruction text but never in real narratives.
    INSTRUCTION_MARKERS = (
        'only include',
        'do not invent',
        'omit sectors',
        'replace this key',
        'real data for',
        'concrete signal from the articles',
    )

    clean = {}
    skipped = []
    for k, v in sb.items():
        if not isinstance(k, str) or not isinstance(v, str):
            skipped.append(k)
            continue
        v_lower = v.lower()
        if any(marker in v_lower for marker in INSTRUCTION_MARKERS):
            skipped.append(k)  # schema-echo value — model copied the instruction
            continue
        if len(v.strip()) < 20:
            skipped.append(k)  # too short to be a real narrative
            continue
        clean[k] = v

    if skipped:
        print(f"  ⚠ sector_breakdown: dropped {len(skipped)} invalid key(s): {skipped}")

    return clean


def gemini_generate(system, user_content, temperature=0.3, max_tokens=4096):
    """Call Gemini with a system instruction and user prompt."""
    response = gemini_client.models.generate_content(
        model=GEMINI_MODEL,
        contents=user_content,
        config=types.GenerateContentConfig(
            system_instruction=system,
            temperature=temperature,
            max_output_tokens=max_tokens,
            thinking_config=types.ThinkingConfig(thinking_budget=0),
            response_mime_type="application/json",
        ),
    )
    return (response.text or "").strip()

def fetch_watchlist_signals(cutoff_hours: int = 24) -> tuple[list[dict], list[str]]:
    """
    Fetch recently cached watchlist articles across all tracked identifiers.
    Returns (articles, identifiers) where:
      - articles: list of article dicts with title, summary, identifier, source_type
      - identifiers: list of all distinct identifiers currently in the watchlist table

    Designed to be called during synthesis to inject watchlist context into the brief.
    Always fails gracefully — returns ([], []) on any error so the main pipeline never crashes.
    """
    try:
        cutoff = (datetime.now(timezone.utc) - timedelta(hours=cutoff_hours)).isoformat()

        # Fetch all distinct identifiers currently tracked by any user
        watchlist_resp = supabase.table("watchlist")\
            .select("identifier")\
            .execute()

        if not watchlist_resp.data:
            print("  ℹ Watchlist empty — no watchlist signals to inject")
            return [], []

        identifiers = list({row["identifier"] for row in watchlist_resp.data if row.get("identifier")})

        if not identifiers:
            return [], []

        # Cap at 50 identifiers to keep the .in_() query manageable
        identifiers = identifiers[:50]

        print(f"  📋 Watchlist: {len(identifiers)} tracked identifiers")

        # Fetch cached articles for those identifiers from the last cutoff_hours
        articles_resp = supabase.table("watchlist_articles")\
            .select("identifier, title, summary, source, source_type, published_at, relevance_score, url")\
            .in_("identifier", identifiers)\
            .gte("fetched_at", cutoff)\
            .order("relevance_score", desc=True)\
            .limit(50)\
            .execute()

        articles = articles_resp.data or []

        if not articles:
            print(f"  ℹ No recent watchlist articles found (cutoff: {cutoff_hours}h)")
            return [], identifiers

        # Deduplicate by title (exact match)
        seen_titles = set()
        deduped = []
        for a in articles:
            title = (a.get("title") or "").strip().lower()
            if title and title not in seen_titles:
                seen_titles.add(title)
                deduped.append(a)

        # Take top 8 by relevance_score
        top_articles = deduped[:8]

        print(f"  ✅ Watchlist signals: {len(top_articles)} articles from {len(identifiers)} identifiers")
        return top_articles, identifiers

    except Exception as e:
        print(f"  ⚠ fetch_watchlist_signals failed (non-fatal): {e}")
        return [], []


def _fetch_aggregate_engagement() -> str:
    """
    Query user_signal_digest to build a short engagement-context block for
    the synthesis prompt. Aggregates across all users to surface what the
    readership collectively cares about most. Soft-fails to "".
    """
    try:
        resp = (
            supabase.table("user_signal_digest")
            .select("top_sectors, top_tickers, engagement_level, event_count")
            .execute()
        )
        rows = resp.data or []
        if not rows:
            return ""

        from collections import defaultdict
        sector_agg: dict[str, float] = defaultdict(float)
        ticker_agg: dict[str, float] = defaultdict(float)
        total_events = 0

        for row in rows:
            total_events += row.get("event_count", 0)

            sectors = row.get("top_sectors") or []
            if isinstance(sectors, str):
                sectors = json.loads(sectors)
            for s in sectors:
                if isinstance(s, dict) and s.get("sector"):
                    sector_agg[s["sector"]] += s.get("score", 0)

            tickers = row.get("top_tickers") or []
            if isinstance(tickers, str):
                tickers = json.loads(tickers)
            for t in tickers:
                if isinstance(t, dict) and t.get("ticker"):
                    ticker_agg[t["ticker"]] += t.get("score", 0)

        if not sector_agg and not ticker_agg:
            return ""

        lines = ["USER ENGAGEMENT SIGNALS (last 30 days):"]
        top_sectors = sorted(sector_agg.items(), key=lambda x: -x[1])[:5]
        if top_sectors:
            sector_list = ", ".join(f"{s} ({round(v, 1)})" for s, v in top_sectors)
            lines.append(f"- Most engaged sectors: {sector_list}")

        top_tickers = sorted(ticker_agg.items(), key=lambda x: -x[1])[:5]
        if top_tickers:
            ticker_list = ", ".join(f"{t} ({round(v, 1)})" for t, v in top_tickers)
            lines.append(f"- Most engaged tickers: {ticker_list}")

        lines.append(f"- Total engagement events: {total_events}")
        lines.append(
            "When these sectors or tickers appear in today's articles, "
            "give them slightly more prominence in your analysis — but never "
            "force irrelevant content or invent information."
        )

        return "\n".join(lines)
    except Exception as e:
        print(f"  ⚠ _fetch_aggregate_engagement failed (non-fatal): {e}")
        return ""


CLAIMS_EXTRACTION_SYSTEM = """You extract gradeable market calls from a morning brief.

A "claim" is a directional statement about a market, sector, index, or ticker that can be verified against end-of-day price action. Examples of gradeable claims:
- "The S&P is likely to close higher on a dovish Fed tone" -> aggregate / SPY / bullish
- "Tech will outperform today on NVDA earnings" -> sector / XLK / bullish
- "Energy faces pressure as crude slides" -> sector / XLE / bearish
- "NVDA will rally on its AI guidance" -> ticker / NVDA / bullish

NOT gradeable: vague commentary, retrospective observations, "watch for X", non-directional context, commentary about the previous day.

For sector claims, pick the appropriate US sector ETF:
- Technology -> XLK
- Energy -> XLE
- Financials -> XLF
- Healthcare -> XLV
- Consumer Discretionary -> XLY
- Consumer Staples -> XLP
- Industrials -> XLI
- Materials -> XLB
- Real Estate -> XLRE
- Utilities -> XLU
- Communication Services -> XLC

For aggregate/broad-market claims, use SPY as target_symbol (or null). For index claims, use the literal ETF (SPY, QQQ, DIA).

Return 3 to 7 claims. If the brief is genuinely non-directional, it is acceptable to return fewer (even zero).

Respond ONLY with valid JSON in this exact schema — no preamble, no markdown fences:
{
  "claims": [
    {
      "claim_text": "<short sentence stating the directional call>",
      "claim_type": "aggregate" | "sector" | "index" | "ticker",
      "target_symbol": "<ticker or ETF symbol; null only for pure aggregate with no proxy>",
      "expected_direction": "bullish" | "bearish" | "neutral",
      "confidence": <float between 0.0 and 1.0>
    }
  ]
}
"""


def extract_and_persist_claims(
    brief_id: str,
    brief_headline: str,
    brief_summary: str,
    brief_sections: dict,
) -> int:
    """
    Extract gradeable market calls from a morning brief and persist them to
    `morning_brief_calls`. Idempotent: deletes any existing rows for this
    brief_id before inserting so re-runs produce a clean set.

    Returns the number of claims persisted. Fails soft: any error yields 0
    and a logged warning so the caller can safely wrap in a try/except.
    """
    if not brief_id:
        print("  ⚠ extract_and_persist_claims: missing brief_id, skipping")
        return 0

    # Assemble the brief text the model will read.
    sections_text = ""
    if isinstance(brief_sections, dict):
        for key, val in brief_sections.items():
            if isinstance(val, str) and val.strip():
                sections_text += f"\n\n[{key}]\n{val}"

    user_content = (
        f"HEADLINE: {brief_headline}\n\n"
        f"SUMMARY: {brief_summary}\n"
        f"{sections_text}"
    )

    try:
        raw = gemini_generate(
            system=CLAIMS_EXTRACTION_SYSTEM,
            user_content=user_content,
            temperature=0.2,
            max_tokens=1024,
        )
    except Exception as e:
        print(f"  ⚠ claims extraction: Gemini call failed: {e}")
        return 0

    # Strip possible code fences, then parse JSON.
    raw = re.sub(r"^```json|^```|```$", "", raw or "", flags=re.MULTILINE).strip()
    parsed = None
    try:
        parsed = json.loads(raw)
    except Exception:
        match = re.search(r"\{.*\}", raw, re.DOTALL)
        if match:
            try:
                parsed = json.loads(match.group())
            except Exception:
                pass

    if not isinstance(parsed, dict):
        print(f"  ⚠ claims extraction: non-JSON response, skipping. raw={raw[:200]!r}")
        return 0

    claims = parsed.get("claims") or []
    if not isinstance(claims, list) or not claims:
        print("  ℹ claims extraction: model returned 0 claims")
        # Still run the idempotent delete so stale data is not left behind.
        try:
            supabase_admin.table("morning_brief_calls").delete().eq("brief_id", brief_id).execute()
        except Exception as e:
            print(f"  ⚠ claims extraction: idempotent delete failed: {e}")
        return 0

    # Validate/normalize each claim before insert.
    allowed_types = {"aggregate", "sector", "index", "ticker"}
    allowed_dirs = {"bullish", "bearish", "neutral"}

    rows = []
    for c in claims:
        if not isinstance(c, dict):
            continue
        claim_text = (c.get("claim_text") or "").strip()
        claim_type = (c.get("claim_type") or "").strip().lower()
        target_symbol = c.get("target_symbol")
        if isinstance(target_symbol, str):
            target_symbol = target_symbol.strip().upper() or None
        else:
            target_symbol = None
        direction = (c.get("expected_direction") or "").strip().lower()

        confidence = c.get("confidence")
        try:
            confidence = float(confidence) if confidence is not None else None
            if confidence is not None:
                confidence = max(0.0, min(1.0, confidence))
        except Exception:
            confidence = None

        if not claim_text or claim_type not in allowed_types or direction not in allowed_dirs:
            continue

        rows.append({
            "brief_id": brief_id,
            "claim_text": claim_text,
            "claim_type": claim_type,
            "target_symbol": target_symbol,
            "expected_direction": direction,
            "confidence": confidence,
        })

    if not rows:
        print("  ⚠ claims extraction: no valid claims after normalization")
        return 0

    # Idempotency: clear any prior rows for this brief_id before inserting.
    try:
        supabase_admin.table("morning_brief_calls").delete().eq("brief_id", brief_id).execute()
    except Exception as e:
        print(f"  ⚠ claims extraction: idempotent delete failed (continuing): {e}")

    try:
        supabase_admin.table("morning_brief_calls").insert(rows).execute()
    except Exception as e:
        print(f"  ⚠ claims extraction: insert failed: {e}")
        return 0

    print(f"  ✅ claims extraction: persisted {len(rows)} claim(s) for brief {brief_id}")
    return len(rows)


def generate_morning_review_for_evening(today_date, sb):
    """Query today's graded morning brief calls and generate an LLM self-reflection.

    Returns a dict shaped like::

        {
          "aggregate_sentence": "...",
          "sector_reflections": [{ "sector": str, "verdict": str, "paragraph": str }],
          "ticker_reflection": { "symbol": str, "verdict": str, "paragraph": str } | None,
        }

    Returns ``None`` if there are no graded calls yet, or if anything fails
    (missing tables, API errors, JSON parse issues). Caller MUST treat this
    as best-effort — an evening wrap must still ship without a review.
    """
    try:
        calls_resp = (
            sb.table("morning_brief_calls")
            .select("*")
            .eq("brief_date", today_date.isoformat())
            .execute()
        )
    except Exception as e:
        print(f"[synthesize] morning_brief_calls lookup failed: {e}")
        return None

    calls = calls_resp.data or []
    if not calls:
        return None

    call_ids = [c["id"] for c in calls]
    try:
        outcomes_resp = (
            sb.table("morning_brief_call_outcomes")
            .select("*")
            .in_("call_id", call_ids)
            .execute()
        )
    except Exception as e:
        print(f"[synthesize] morning_brief_call_outcomes lookup failed: {e}")
        return None

    outcomes_by_call = {o["call_id"]: o for o in (outcomes_resp.data or [])}
    graded = [(c, outcomes_by_call[c["id"]]) for c in calls if c["id"] in outcomes_by_call]
    if not graded:
        return None  # no graded calls yet

    # Aggregate stats
    correct = sum(1 for _, o in graded if o.get("verdict") == "correct")
    wrong = sum(1 for _, o in graded if o.get("verdict") == "wrong")
    partial = sum(1 for _, o in graded if o.get("verdict") == "partial")

    def _fmt_pct(x):
        try:
            return f"{float(x) * 100:+.2f}%"
        except Exception:
            return "n/a"

    summary_block = "\n".join(
        f"- [{o.get('verdict', '?')}] {c.get('claim_text', '')} "
        f"→ {c.get('expected_direction', '?')} expected, "
        f"{o.get('actual_direction', '?')} actual ({_fmt_pct(o.get('actual_pct_change'))})"
        for c, o in graded
    )

    prompt = (
        "Generate a self-reflection for today's evening wrap comparing the morning "
        "brief's market calls to what actually happened.\n\n"
        f"Morning brief calls and outcomes:\n{summary_block}\n\n"
        f"Aggregate: {correct} correct, {wrong} wrong, {partial} partial.\n\n"
        "Produce JSON only:\n"
        "{\n"
        "  \"aggregate_sentence\": \"<1-2 sentence summary — honest, never defensive>\",\n"
        "  \"sector_reflections\": [\n"
        "    { \"sector\": \"<name>\", \"verdict\": \"<correct|wrong|partial>\", \"paragraph\": \"<1 paragraph>\" }\n"
        "  ],\n"
        "  \"ticker_reflection\": { \"symbol\": \"<sym>\", \"verdict\": \"<v>\", \"paragraph\": \"<1 paragraph>\" } | null\n"
        "}\n\n"
        "Rules:\n"
        "- Include sector_reflections only for sector calls with meaningful outcome.\n"
        "- ticker_reflection: only if a high-confidence ticker call was made. Otherwise null.\n"
        "- Total length: 200-400 words.\n"
        "- Tone: confident, honest. \"We were wrong about X because Y\" > vague excuses.\n"
        "- Output JSON only, no prose."
    )

    try:
        resp = gemini_client.models.generate_content(
            model=GEMINI_MODEL,
            contents=prompt,
        )
        text = (resp.text or "").strip()
        # Strip code fences if present (```json ... ``` or ``` ... ```)
        if text.startswith("```"):
            parts = text.split("```")
            if len(parts) >= 2:
                text = parts[1]
            text = text.removeprefix("json").strip()
        return json.loads(text)
    except Exception as e:
        print(f"[synthesize] morning review generation failed: {e}")
        return None


def run(brief_type="morning"):
    print(f"📝 Synthesizing {brief_type} briefing...")

    # Pull a larger pool from last 24 hours, then diversify to prevent
    # a single deal cluster or company from dominating the briefing.
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
    resp = supabase.table("articles")\
        .select("title, summary, sector, industry_verticals, companies, relevance_score, relevance_reason")\
        .gte("ingested_at", cutoff)\
        .order("relevance_score", desc=True)\
        .limit(60)\
        .execute()

    articles = resp.data or []
    if not articles:
        resp = supabase.table("articles")\
            .select("title, summary, sector, industry_verticals, companies, relevance_score, relevance_reason")\
            .order("ingested_at", desc=True)\
            .limit(60)\
            .execute()
        articles = resp.data or []

    spine, floor = _select_articles_for_synthesis(articles)
    print(f"  📰 Synthesis input: {len(spine)} spine + {len(floor)} floor articles "
          f"({len(spine) + len(floor)} total, from pool of up to 60)")

    # ── Watchlist signal injection ──────────────────────────────────────────
    watchlist_articles, watchlist_identifiers = fetch_watchlist_signals(cutoff_hours=24)

    watchlist_text = ""
    if watchlist_articles:
        watchlist_lines = []
        for a in watchlist_articles:
            identifier = a.get("identifier", "")
            title = a.get("title", "")
            summary = (a.get("summary") or "")[:200]
            source = a.get("source", "")
            score = a.get("relevance_score", "")
            line = f"[WATCHLIST: {identifier}] {title}"
            if summary:
                line += f"\n{summary}"
            if source:
                line += f"\nSource: {source}"
            if score:
                line += f" | Relevance: {score}"
            watchlist_lines.append(line)

        watchlist_text = (
            "\n\n--- WATCHLIST SIGNALS (actively tracked by users) ---\n\n"
            + "\n\n".join(watchlist_lines)
        )
        print(f"  📌 Injecting {len(watchlist_articles)} watchlist signals into prompt")
    elif watchlist_identifiers:
        # Identifiers exist but no fresh articles — note the tracked companies only
        watchlist_text = (
            f"\n\n--- TRACKED COMPANIES (no fresh articles today) ---\n"
            f"Users are tracking: {', '.join(watchlist_identifiers[:20])}\n"
            f"Mention these if they appear in the main articles above."
        )
        print(f"  📌 No fresh watchlist articles, but noting {len(watchlist_identifiers)} tracked identifiers")
    # ── End watchlist injection ──────────────────────────────────────────────

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
    if watchlist_text:
        article_text += watchlist_text

    system = MORNING_SYSTEM if brief_type == "morning" else EVENING_SYSTEM

    # --- Feedback loop: prepend cached brief improvement addendum ----------
    brief_addendum_used = None
    try:
        resp = (
            supabase.table("weekly_digests")
            .select("morning_brief_addendum, evening_brief_addendum")
            .order("generated_at", desc=True)
            .limit(1)
            .execute()
        )
        if resp.data:
            col = f"{brief_type}_brief_addendum"
            addendum_text = resp.data[0].get(col)
            if addendum_text:
                system = (
                    "[BRIEF IMPROVEMENT DIRECTIVE — incorporate into your analysis]\n"
                    + addendum_text
                    + "\n\n"
                    + system
                )
                brief_addendum_used = {"source": "weekly_digests", "chars": len(addendum_text)}
                print(f"  📎 Injected {len(addendum_text)}-char brief improvement addendum")
    except Exception as e:
        print(f"  ⚠ Brief addendum injection skipped: {e}")

    # --- User engagement signal injection (soft-fail) ---
    engagement_ctx = _fetch_aggregate_engagement()
    if engagement_ctx:
        system = engagement_ctx + "\n\n" + system
        print(f"  📈 Injected {len(engagement_ctx)}-char user engagement context")

    data = None
    raw = ""
    try:
        raw = gemini_generate(
            system=system,
            user_content=f"Today's articles:\n\n{article_text}",
            temperature=0.3,
            max_tokens=4096,
        )
        raw = re.sub(r"^```json|^```|```$", "", raw, flags=re.MULTILINE).strip()
        try:
            data = json.loads(raw)
        except Exception:
            # tier 2: extract first {...} block
            match = re.search(r'\{.*\}', raw, re.DOTALL)
            if match:
                try:
                    data = json.loads(match.group())
                except Exception:
                    pass
        if data is None:
            raise ValueError(f"Could not parse Gemini response as JSON. Raw: {raw[:200]}")
    except Exception as e:
        print(f"  ✗ Gemini error: {e} — raw response: {repr(raw[:200])} — falling back to stub briefing")

    if data is None:
        data = {
            "headline": "Market Intelligence Unavailable",
            "summary": "Briefing generation failed. Please check logs.",
            "market_tone": "NEUTRAL",
            "sections": {},
            "top_deals": [],
            "sector_breakdown": {}
        }

    sector_breakdown = _validate_sector_breakdown(data.get("sector_breakdown", {}))
    print(f"  📊 sector_breakdown: {len(sector_breakdown)} sector(s) — {list(sector_breakdown.keys())}")

    now = datetime.now(timezone.utc).isoformat()
    row = {
        "briefing_type":    brief_type,
        "headline":         data.get("headline", ""),
        "summary":          data.get("summary", ""),
        "market_tone":      data.get("market_tone", "NEUTRAL"),
        "sections":         json.dumps(data.get("sections", {})),
        "top_deals":        json.dumps(data.get("top_deals", [])),
        "sector_breakdown": json.dumps(sector_breakdown),
        "created_at":       now,
    }

    # Insert with optional market_pulse (column may not exist yet on older DBs —
    # fall back to base row if DB rejects the extra field). Capture the
    # generated id so downstream steps can attach (claims extraction on morning,
    # morning_review on evening).
    mp_raw = data.get("market_pulse")
    has_pulse = (
        isinstance(mp_raw, dict)
        and mp_raw.get("sentiment_word")
        and mp_raw.get("narrative")
    )
    insert_resp = None
    if has_pulse:
        row_with_pulse = {**row, "market_pulse": json.dumps(mp_raw)}
        try:
            insert_resp = supabase.table("briefings").insert(row_with_pulse).execute()
            print(f"  ✨ market_pulse saved: {mp_raw.get('sentiment_word', '')[:30]}")
        except Exception as mp_err:
            print(f"  ⚠ market_pulse insert failed ({mp_err}) — falling back to base row")
            insert_resp = supabase.table("briefings").insert(row).execute()
    else:
        insert_resp = supabase.table("briefings").insert(row).execute()

    brief_id = None
    try:
        inserted_rows = getattr(insert_resp, "data", None) or []
        if inserted_rows and isinstance(inserted_rows[0], dict):
            brief_id = inserted_rows[0].get("id")
    except Exception:
        brief_id = None


    print(f"  ✅ {brief_type.capitalize()} briefing stored")
    print(f"  Headline: {row['headline'][:80]}")

    # --- Self-grading claims extraction (morning brief only, non-fatal) ------
    # Runs as a second, additive LLM call. Any failure is logged and swallowed
    # so the brief still ships.
    if brief_type == "morning":
        try:
            if brief_id:
                extract_and_persist_claims(
                    brief_id=brief_id,
                    brief_headline=data.get("headline", ""),
                    brief_summary=data.get("summary", ""),
                    brief_sections=data.get("sections", {}) or {},
                )
            else:
                print("  ⚠ claims extraction skipped: briefings insert did not return an id")
        except Exception as e:
            print(f"  ⚠ claims extraction failed (non-fatal): {e}")

    # ── Evening wrap: attach self-reflection on morning brief vs market outcomes ──
    # Non-fatal: reflection is additive and must never block the briefing from shipping.
    if brief_type == "evening":
        try:
            review = generate_morning_review_for_evening(date.today(), supabase)
            if review and brief_id:
                supabase.table("briefings").update(
                    {"morning_review": review}
                ).eq("id", brief_id).execute()
                print(f"  🔁 Attached morning_review to evening brief {brief_id}")
            elif review and not brief_id:
                print("  ⚠ Generated morning_review but no brief_id returned from insert")
        except Exception as e:
            print(f"[synthesize] morning review attach failed: {e}")  # non-fatal

    # Return brief text and addendum metadata for downstream consumers
    # (e.g. brief_feedback_loop.score_brief in run.py)
    brief_text = json.dumps(data, indent=2)
    return {"brief_text": brief_text, "brief_addendum_used": brief_addendum_used}

if __name__ == "__main__":
    import sys
    brief_type = sys.argv[1] if len(sys.argv) > 1 else "morning"
    run(brief_type)
