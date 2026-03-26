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

You will receive a list of recent news articles. Produce a structured JSON briefing that is detailed, analytical, and immediately actionable for IB/PE/VC professionals.

Respond ONLY with valid JSON in this exact schema — no preamble, no markdown fences:
{
  "headline": "Punchy 10-15 word headline capturing the single biggest market story",
  "summary": "3-4 sentence executive summary of the day's most important developments. Be specific — name companies, figures, and implications.",
  "market_tone": "One of: RISK-ON | RISK-OFF | MIXED | NEUTRAL",
  "sections": {
    "deals_and_ma": "2-3 sentences on the most significant M&A, PE, and VC deal activity. Name specific companies, valuations, acquirers.",
    "public_markets": "2-3 sentences on equity market moves, earnings, IPO pipeline, and public market signals that matter for deal activity.",
    "macro_and_rates": "2-3 sentences on macro environment — Fed signals, rates, inflation, FX moves, and how they affect deal math (LBO spreads, multiples, cost of capital).",
    "geopolitics": "2-3 sentences on geopolitical developments with direct market or deal implications.",
    "sector_spotlight": "2-3 sentences on the single sector with the most deal/news activity today and why it matters.",
    "what_to_watch": "3-4 specific things to monitor today — earnings releases, Fed speakers, deal announcements expected, regulatory decisions. Be concrete."
  },
  "top_deals": [
    {
      "company": "Target company name",
      "deal_type": "M&A / LBO / IPO / VC Round / etc",
      "valuation": "$Xb or null",
      "one_liner": "One sentence on why this deal matters"
    }
  ],
  "sector_breakdown": {
    "Technology M&A & Investment Banking": "1-2 sentence signal",
    "Private Equity & Buyouts": "1-2 sentence signal",
    "Venture Capital & Startup Funding": "1-2 sentence signal",
    "Public Markets & Earnings": "1-2 sentence signal",
    "Geopolitics & Macro": "1-2 sentence signal"
  }
}

Only include sectors with meaningful activity. top_deals should have 3-5 entries max. Be precise and analytical — avoid generic filler."""

EVENING_SYSTEM = """You are a senior investment banking analyst preparing the evening market wrap briefing.

You will receive today's news articles. Produce a structured JSON evening wrap that reviews what happened and sets up tomorrow.

Respond ONLY with valid JSON in this exact schema — no preamble, no markdown fences:
{
  "headline": "Punchy headline capturing the day's defining story",
  "summary": "3-4 sentence wrap of the day's most important developments and what they signal going forward.",
  "market_tone": "One of: RISK-ON | RISK-OFF | MIXED | NEUTRAL",
  "sections": {
    "deals_and_ma": "2-3 sentences wrapping deal activity — what closed, what was announced, what rumors emerged.",
    "public_markets": "2-3 sentences on how markets closed, key movers, and what the tape is signaling.",
    "macro_and_rates": "2-3 sentences on macro developments and rate environment into tomorrow.",
    "geopolitics": "2-3 sentences on geopolitical developments and overnight risk.",
    "tomorrow_setup": "3-4 concrete things to watch tomorrow — pre-market catalysts, scheduled announcements, international markets to monitor."
  },
  "top_deals": [
    {
      "company": "Target company name",
      "deal_type": "M&A / LBO / IPO / VC Round / etc",
      "valuation": "$Xb or null",
      "one_liner": "One sentence on why this deal matters"
    }
  ],
  "sector_breakdown": {
    "Technology M&A & Investment Banking": "1-2 sentence signal",
    "Private Equity & Buyouts": "1-2 sentence signal",
    "Venture Capital & Startup Funding": "1-2 sentence signal",
    "Public Markets & Earnings": "1-2 sentence signal",
    "Geopolitics & Macro": "1-2 sentence signal"
  }
}

Only include sectors with meaningful activity. top_deals should have 3-5 entries max."""

def groq_with_backoff(messages, temperature=0.3, max_tokens=2000, max_retries=5):
    """Call Groq with exponential backoff + jitter on 429 rate limit errors."""
    for attempt in range(max_retries):
        try:
            resp = groq.chat.completions.create(
                model="llama-3.1-8b-instant",
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

    # Pull articles from last 24 hours
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
    resp = supabase.table("articles")\
        .select("title, summary, sector, companies, relevance_score")\
        .gte("ingested_at", cutoff)\
        .order("relevance_score", desc=True)\
        .limit(60)\
        .execute()

    articles = resp.data or []
    if not articles:
        resp = supabase.table("articles")\
            .select("title, summary, sector, companies, relevance_score")\
            .order("ingested_at", desc=True)\
            .limit(60)\
            .execute()
        articles = resp.data or []

    print(f"  📰 Using {len(articles)} articles for synthesis")

    article_text = "\n\n".join([
        f"[{a.get('sector','')}] {a.get('title','')}\n{a.get('summary','')}"
        for a in articles
    ])

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
