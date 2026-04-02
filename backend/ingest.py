"""
BreakingAlpha - News Ingestion Pipeline
Fetches from 15+ sources, scores relevance across all sectors,
stores in Supabase.
"""

import os, json, time, requests, feedparser
from datetime import datetime, timezone
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
}

SECTORS = [
    "Technology M&A & Investment Banking",
    "Venture Capital & Startup Funding",
    "Private Equity & Buyouts",
    "Public Markets & Earnings",
    "Geopolitics & Macro",
    "Real Estate & Infrastructure",
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

Respond ONLY in valid JSON:
{{
  "relevant": true/false,
  "relevance_score": 1-10,
  "relevance_reason": "GATE — apply before writing: If this article is primarily an opinion piece, profile, cultural commentary, or trend piece with no named transaction, earnings result, financing event, guidance change, regulatory action, or specific market-moving event — set relevant: false and leave this field as an empty string. Do not fabricate a read-through. Articles discussing a named person's political views, cultural influence, public commentary, or personal philosophy are not market-moving events even if that person runs a public or private company — set relevant: false. For articles that pass the gate: 1-2 sentences max. Lead with the concrete market implication — the named deal, specific dollar figure, rate level, or event — not a description of what happened. Only name comp companies or sector read-throughs if the mechanism directly follows from what this article reports; do not append a comp list just to fill the format. Use specific company names, dollar figures, or named sectors where available. BANNED outputs — never write these: vague taxonomy ('this is relevant to PE / VC / financial markets / investing'), article restatements that just paraphrase the headline, fabricated comp lists, filler like 'this matters because it is a transaction in private equity'. For macro or rates articles, state the concrete effect on deal economics — LBO spreads, floating-rate credit costs, buyout multiples, M&A financing conditions, or risk appetite for new deals — never write that rates moved, banks are impacted, or that interest rates affect markets generally. Write as a buy-side analyst flagging a signal to a portfolio manager. Style examples: 'Signals continued PE appetite for scaled consumer franchise assets, supporting sentiment for comparable operators and sponsor-backed exits.' / 'AI infrastructure demand remains elevated — read-through for hyperscalers, chip suppliers, and adjacent names pricing in capex acceleration.' / 'May reprice margin expectations across the sector if pricing power narrative softens at comparable operators.'",
  "sector": "one of: {sectors}",
  "companies": ["Company A", "Company B"],
  "themes": ["M&A", "IPO", "Earnings", "Macro", "Geopolitics", "VC", "PE", "Regulation", "AI", "Crypto"],
  "sentiment": "bullish/bearish/neutral",
  "deal_type": "M&A/IPO/Funding/Earnings/Macro/Geopolitical/Other or null"
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


def store_article(article, analysis):
    try:
        if supabase.table("articles").select("id").eq("url", article["url"]).execute().data:
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
            "sector": analysis.get("sector", ""),
            "deal_type": analysis.get("deal_type")
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
