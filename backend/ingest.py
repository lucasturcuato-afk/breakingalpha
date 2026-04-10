"""
BreakingAlpha - News Ingestion Pipeline
Fetches from 15+ sources, scores relevance across all sectors,
stores in Supabase.
"""

import os, json, re, time, requests, feedparser
from datetime import datetime, timezone, timedelta
from supabase import create_client
from groq import Groq, RateLimitError
from dotenv import load_dotenv
from watchlist import boost_watchlist_relevance

load_dotenv()

supabase = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_ANON_KEY"])
groq_client = Groq(api_key=os.environ["GROQ_API_KEY"])

RSS_FEEDS = {
    "WSJ Markets":      "https://feeds.a.dj.com/rss/RSSMarketsMain.xml",
    "WSJ Tech":         "https://feeds.a.dj.com/rss/RSSWSJD.xml",
    "NYT Technology":   "https://rss.nytimes.com/services/xml/rss/nyt/Technology.xml",
    "NYT Business":     "https://rss.nytimes.com/services/xml/rss/nyt/Business.xml",
    "NYT World":        "https://rss.nytimes.com/services/xml/rss/nyt/World.xml",
    "TechCrunch":       "https://techcrunch.com/feed/",
    "Reuters Tech":     "https://feeds.reuters.com/reuters/technologyNews",
    "Reuters Business": "https://feeds.reuters.com/reuters/businessNews",
    "Reuters World":    "https://feeds.reuters.com/Reuters/worldNews",
    "FT Tech":          "https://www.ft.com/technology?format=rss",
    "Axios":            "https://www.axios.com/feeds/feed.rss",
    "Bloomberg Tech":   "https://feeds.bloomberg.com/technology/news.rss",
    "Pitchbook":        "https://pitchbook.com/news/rss",
    "Crunchbase News":  "https://news.crunchbase.com/feed/",
    "PE Hub":           "https://www.pehub.com/feed/",
    "Defense News":     "https://www.defensenews.com/arc/outboundfeeds/rss/",
    "Breaking Defense": "https://breakingdefense.com/feed/",
    "C4ISRNET":         "https://www.c4isrnet.com/arc/outboundfeeds/rss/",
}

SECTORS = [
    "Technology M&A & Investment Banking",
    "Venture Capital & Startup Funding",
    "Private Equity & Buyouts",
    "Public Markets & Earnings",
    "Geopolitics & Macro",
    "Real Estate & REITs",
    "Fintech & Crypto",
    "Healthcare & Biotech",
    "Energy & Climate",
    "Consumer & Retail",
]

FILTER_PROMPT = """You are a senior analyst at a top investment firm. Analyze this article and determine its relevance to financial markets and investing.

Article Title: {title}
Summary: {summary}
Source: {source}

Relevant topics include: M&A deals, IPOs, fundraising, valuations, earnings, market movements, geopolitical events affecting markets, macro trends, regulatory changes, PE/VC activity, public company news, economic data.

SECTOR (required): Pick exactly one sector from this list that best fits the article's primary topic. Copy the name character-for-character — no abbreviations, no combining, no rewording.
Allowed sectors: {sectors}

COMPANIES (required): In the JSON below, "companies" must be a JSON array of strings listing EVERY company, fund, or firm explicitly named in the title or summary. Include the primary subject AND all secondary named entities — investors, investment targets, acquirers, merger partners, named competitors, named customers, named advisors. Examples: "Nvidia invests in Marvell" → ["Nvidia", "Marvell"]. "Goldman leads Apple bond offering" → ["Goldman Sachs", "Apple"]. "RGP survey finds CFOs say..." → ["RGP"]. Return [] only when no specific company, fund, or firm name appears anywhere in the title or summary. Never return a string — always return a JSON array.

Respond ONLY in valid JSON:
{{
  "relevant": true/false,
  "relevance_score": 1-10,
  "relevance_reason": "GATE — apply before writing: If this article is primarily an opinion piece, profile, cultural commentary, or trend piece with no named transaction, earnings result, financing event, guidance change, regulatory action, or specific market-moving event — set relevant: false and leave this field as an empty string. Do not fabricate a read-through. Articles discussing a named person's political views, cultural influence, public commentary, or personal philosophy are not market-moving events even if that person runs a public or private company — set relevant: false. Internal staff promotions, appointments, hires, or departures are not market-moving events unless the article explicitly links the change to a named transaction, fundraising event, earnings event, guidance change, or regulatory action — if no such link exists, set relevant: false. For articles that pass the gate: 1-2 sentences max. Lead with the concrete market implication — the named deal, specific dollar figure, rate level, or event — not a description of what happened. Only name comp companies or sector read-throughs if the mechanism directly follows from what this article reports; do not append a comp list just to fill the format. Use specific company names, dollar figures, or named sectors where available. BANNED outputs — never write these: vague taxonomy ('this is relevant to PE / VC / financial markets / investing'), article restatements that just paraphrase the headline, fabricated comp lists, filler like 'this matters because it is a transaction in private equity'. For macro or rates articles, state the concrete effect on deal economics — LBO spreads, floating-rate credit costs, buyout multiples, M&A financing conditions, or risk appetite for new deals — never write that rates moved, banks are impacted, or that interest rates affect markets generally. Write as a buy-side analyst flagging a signal to a portfolio manager.",
  "sector": "<copy one sector name exactly from the allowed list above>",
  "companies": ["Company A", "Company B"],
  "themes": ["M&A", "IPO", "Earnings", "Macro", "Geopolitics", "VC", "PE", "Regulation", "AI", "Crypto"],
  "sentiment": "bullish/bearish/neutral",
  "deal_type": "M&A/IPO/Funding/Earnings/Macro/Geopolitical/Other or null",
  "primary_company": "If this article is primarily about one specific named company — covering its earnings result, contract award, IPO, acquisition, or a named announcement by that company — copy that company name exactly as it appears in the companies array above. If this article covers a sector trend, government policy, macroeconomic event, or multiple-company topic with no single primary subject, return null. Return null when uncertain. Never invent a name not present in the companies array."
}}"""


def fetch_all_articles():
    articles = []
    for source, url in RSS_FEEDS.items():
        try:
            feed = feedparser.parse(url)
            for e in feed.entries[:8]:
                articles.append({
                    "title": e.get("title", ""),
                    "summary": e.get("summary", e.get("description", ""))[:500],
                    "url": e.get("link", ""),
                    "source": source,
                    "published_at": e.get("published", datetime.now(timezone.utc).isoformat())
                })
        except Exception as ex:
            print(f"  RSS error {source}: {ex}")

    # NewsAPI
    try:
        queries = ["M&A acquisition merger deal", "IPO valuation funding round", "earnings revenue profit", "geopolitics trade war sanctions", "private equity buyout"]
        for q in queries:
            r = requests.get("https://newsapi.org/v2/everything", params={
                "q": q, "sortBy": "publishedAt", "pageSize": 8,
                "language": "en", "apiKey": os.environ["NEWS_API_KEY"]
            }, timeout=10)
            for a in r.json().get("articles", []):
                articles.append({
                    "title": a.get("title", ""),
                    "summary": a.get("description", "")[:500],
                    "url": a.get("url", ""),
                    "source": a.get("source", {}).get("name", "NewsAPI"),
                    "published_at": a.get("publishedAt", datetime.now(timezone.utc).isoformat())
                })
            time.sleep(0.3)
    except Exception as ex:
        print(f"  NewsAPI error: {ex}")

    # Deduplicate
    seen, unique = set(), []
    for a in articles:
        if a["url"] and a["url"] not in seen and a["title"]:
            seen.add(a["url"])
            unique.append(a)
    return unique


def filter_article(article):
    prompt = FILTER_PROMPT.format(
        title=article["title"],
        summary=article["summary"],
        source=article["source"],
        sectors=", ".join(SECTORS)
    )
    for attempt in range(3):
        try:
            resp = groq_client.chat.completions.create(
                model="llama-3.1-8b-instant",
                messages=[{"role": "user", "content": prompt}],
                temperature=0.1
            )
            text = resp.choices[0].message.content.strip()
            if text.startswith("```"):
                text = text.split("```")[1]
                if text.startswith("json"): text = text[4:]
            return json.loads(text.strip())
        except RateLimitError:
            wait = [5, 10, 20][attempt]
            print(f"  ⚠ Groq 429 — waiting {wait}s (attempt {attempt+1}/3)")
            time.sleep(wait)
        except Exception as ex:
            print(f"  Filter error: {ex}")
            return None
    print(f"  ✗ Groq rate limit exhausted for: {article['title'][:50]}")
    return None


def upsert_company(name, themes, sentiment):
    try:
        ex = supabase.table("companies").select("*").eq("name", name).execute()
        if ex.data:
            c = ex.data[0]
            supabase.table("companies").update({
                "mention_count": c["mention_count"] + 1,
                "last_updated": datetime.now(timezone.utc).isoformat(),
                "key_themes": list(set((c.get("key_themes") or []) + themes))
            }).eq("id", c["id"]).execute()
            return c["id"]
        else:
            r = supabase.table("companies").insert({
                "name": name, "key_themes": themes,
                "sentiment_trend": sentiment, "mention_count": 1
            }).execute()
            return r.data[0]["id"]
    except Exception as ex:
        print(f"  Company error {name}: {ex}")
        return None


def _normalize_title(title):
    """Lowercase, strip punctuation, collapse whitespace for exact-title dedup."""
    t = title.lower()
    t = re.sub(r"[^\w\s]", "", t)
    t = re.sub(r"\s+", " ", t).strip()
    return t


def store_article(article, analysis):
    try:
        if supabase.table("articles").select("id").eq("url", article["url"]).execute().data:
            return None

        # Title dedup: skip if same normalized title stored in last 24h
        cutoff = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
        recent = supabase.table("articles").select("title").gte("ingested_at", cutoff).execute().data or []
        norm_new = _normalize_title(article["title"])
        for row in recent:
            if _normalize_title(row.get("title", "")) == norm_new:
                print(f"  ⊘ Title dedup skip: {article['title'][:70]}")
                return None
        r = supabase.table("articles").insert({
            "title": article["title"],
            "summary": article["summary"] or "",
            "url": article["url"],
            "source": article["source"],
            "published_at": article["published_at"],
            "relevance_score": analysis["relevance_score"],
            "relevance_reason": analysis.get("relevance_reason", ""),
            "companies": analysis.get("companies", []),
            "themes": analysis.get("themes", []),
            "sentiment": analysis.get("sentiment", "neutral"),
            "sector": analysis.get("sector", "") if analysis.get("sector", "") in SECTORS else "",
            "deal_type": analysis.get("deal_type"),
            "primary_company": analysis.get("primary_company"),
        }).execute()
        article_id = r.data[0]["id"]
        for company in analysis.get("companies", []):
            cid = upsert_company(company, analysis.get("themes", []), analysis.get("sentiment", "neutral"))
            if cid:
                supabase.table("company_mentions").insert({
                    "company_id": cid, "article_id": article_id,
                    "context": article["summary"][:300],
                    "sentiment": analysis.get("sentiment", "neutral")
                }).execute()
        return article_id
    except Exception as ex:
        print(f"  Store error: {ex}")
        return None


def run_ingestion():
    print(f"\n{'='*60}\nBreakingAlpha Ingestion — {datetime.now().strftime('%Y-%m-%d %H:%M')}\n{'='*60}")
    print("\n[1/3] Fetching articles...")
    articles = fetch_all_articles()
    print(f"  {len(articles)} unique articles")

    print("\n[2/3] Filtering with Groq...")
    relevant = []
    for a in articles:
        result = filter_article(a)
        if result and result.get("relevant") and result.get("relevance_score", 0) >= 6:
            relevant.append((a, result))
            print(f"  ✓ [{result['relevance_score']}/10] [{result.get('sector','?')[:20]}] {a['title'][:60]}...")
        time.sleep(2.0)

    print(f"\n[3/3] Storing {len(relevant)} articles...")
    article_ids = [aid for a, r in relevant if (aid := store_article(a, r))]
    stored = len(article_ids)
    print(f"\n✅ Done — {stored} new articles stored")

    boosted = boost_watchlist_relevance(article_ids)
    print(f"  ★ {boosted} articles boosted by watchlist relevance")
    return stored

if __name__ == "__main__":
    run_ingestion()
