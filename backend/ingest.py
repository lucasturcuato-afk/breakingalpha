"""
BreakingAlpha - News Ingestion Pipeline
Fetches from 15+ sources, scores relevance across all sectors,
stores in Supabase.
"""

import os, json, re, time, requests, feedparser, html as _html
from datetime import datetime, timezone, timedelta
from supabase import create_client
from google import genai
from google.genai import types
from dotenv import load_dotenv
from watchlist import boost_watchlist_relevance
from wikidata import is_valid_company
from fulltext import fetch_full_text, SCRAPEABLE_SOURCES

load_dotenv()

supabase = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_ANON_KEY"])
gemini_client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
GEMINI_MODEL = "gemini-2.5-flash"

RSS_FEEDS = {
    "WSJ Markets":      "https://feeds.a.dj.com/rss/RSSMarketsMain.xml",
    "WSJ Tech":         "https://feeds.a.dj.com/rss/RSSWSJD.xml",
    "NYT Technology":   "https://rss.nytimes.com/services/xml/rss/nyt/Technology.xml",
    "NYT Business":     "https://rss.nytimes.com/services/xml/rss/nyt/Business.xml",
    "NYT World":        "https://rss.nytimes.com/services/xml/rss/nyt/World.xml",
    "MarketWatch Top":  "https://feeds.content.dowjones.io/public/rss/mw_topstories",
    "MarketWatch Markets": "https://feeds.content.dowjones.io/public/rss/mw_marketpulse",
    "MarketWatch Real-time": "https://feeds.content.dowjones.io/public/rss/mw_realtimeheadlines",
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
    "SEC 8-K":          "https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=8-K&dateb=&owner=include&count=40&search_text=&output=atom",
    "SEC 10-Q":         "https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=10-Q&dateb=&owner=include&count=10&search_text=&output=atom",
    "Federal Reserve":  "https://www.federalreserve.gov/feeds/press_all.xml",
    "PR Newswire":      "https://www.prnewswire.com/rss/news-releases-list.rss",
}

FULL_TEXT_SOURCES = {"SEC 8-K", "SEC 10-Q", "Federal Reserve"}

INDUSTRY_VERTICALS = [
    "Technology",
    "Healthcare & Biotech",
    "Energy & Oil/Gas",
    "Financial Services",
    "Consumer & Retail",
    "Industrials & Manufacturing",
    "Aerospace & Defense",
    "Real Estate",
    "Media & Telecom",
    "Materials & Mining",
    "Agriculture",
]

ACTIVITY_TYPES = [
    "Mergers & Acquisitions",
    "Private Equity",
    "Venture Capital",
    "IPO & Capital Markets",
    "Earnings & Results",
    "Macro & Policy",
    "Geopolitics",
    "Regulation & Legal",
    "Fundraising",
    "Crypto & Digital Assets",
    "Leadership & Operations",
]


def validate_tags(tags, whitelist: list, max_count: int = 3) -> list:
    """Validate tags against a whitelist and cap at max_count.

    Robust to LLMs that return a bare string, a list containing
    comma-concatenated elements (e.g. ["Technology, Financial Services"]),
    or mixed-case / padded values. Every input is split on commas and each
    piece must match an entry in the whitelist character-for-character
    (after stripping surrounding whitespace). Anything that doesn't match
    is dropped; duplicates are removed preserving first-seen order.
    """
    if isinstance(tags, str):
        tags = [tags]
    if not isinstance(tags, list):
        return []

    whitelist_set = set(whitelist)
    result: list = []
    seen: set = set()
    for raw in tags:
        if not isinstance(raw, str):
            continue
        for piece in raw.split(","):
            t = piece.strip()
            if t and t in whitelist_set and t not in seen:
                seen.add(t)
                result.append(t)
                if len(result) >= max_count:
                    return result
    return result

FILTER_PROMPT = """You are a senior analyst at a top investment firm. Analyze this article and determine its relevance to financial markets and investing.

Article Title: {title}
Summary: {summary}
Source: {source}

Relevant topics include: M&A deals, IPOs, fundraising, valuations, earnings, market movements, geopolitical events affecting markets, macro trends, regulatory changes, PE/VC activity, public company news, economic data.

INDUSTRY_VERTICALS (required): Return a JSON array of 1-3 values from this exact list — the industry sector(s) the companies or subjects in this article operate in. Copy values character-for-character. Return [] if none clearly apply.
Allowed values: Technology, Healthcare & Biotech, Energy & Oil/Gas, Financial Services, Consumer & Retail, Industrials & Manufacturing, Aerospace & Defense, Real Estate, Media & Telecom, Materials & Mining, Agriculture

ACTIVITY_TYPES (optional): Return a JSON array of 0-3 values from this exact list — the type of event or activity the article covers. Copy values character-for-character. Return [] if none clearly apply.
Allowed values: Mergers & Acquisitions, Private Equity, Venture Capital, IPO & Capital Markets, Earnings & Results, Macro & Policy, Geopolitics, Regulation & Legal, Fundraising, Crypto & Digital Assets, Leadership & Operations

COMPANIES (required): Return a JSON array of entity objects. Each object must have exactly two fields: "name" (the entity name, verbatim from the title or summary) and "entity_type" (must be the string "company" — see definition below). Only include entities where you are confident entity_type is "company". Default to exclusion when uncertain.

COMPANY definition: A for-profit or non-profit private organization, publicly traded corporation, startup, or financial institution that has employees, operates a business, and would have a LinkedIn company page.

EXCLUDE — never include an entity that falls into any of these categories:
- Individual people, executives, politicians, or named persons (e.g. "Elon Musk", "Xi Jinping", "Trump")
- Countries, nation-states, territories, or regions (e.g. "China", "Iran", "Vietnam", "Greece")
- Government agencies, regulatory bodies, courts, or military branches (e.g. "NASA", "FAA", "Pentagon", "Space Force", "U.S. Navy", "Federal Reserve", "SEC", "DOJ")
- Currencies or crypto assets (e.g. "Bitcoin", "Ethereum", "USD")
- Stock market indexes (e.g. "S&P 500", "Nifty 50", "Nasdaq", "Sensex")
- Abstract noun phrases describing a concept, trend, or group rather than a named organization (e.g. "Ukrainian drone makers", "Russia's energy sector", "Foundation AI model for plants", "Candy stocks")
- Software products, AI models, or platforms — include the company that owns them, not the product (e.g. use "OpenAI" not "ChatGPT"; use "Anthropic" not "Claude"; use "Microsoft" not "Windows")
- Named investment vehicles, SPVs, trusts, or sovereign wealth funds (e.g. "Blackstone Digital Infrastructure Trust", "Abu Dhabi Investment Authority", "GIC") — use the parent firm ("Blackstone") if it is the primary actor
- Political parties, religious institutions, advocacy organizations (e.g. "Republican Party", "Heritage Foundation")

Good examples: "Nvidia invests in Marvell" → [{{"name": "Nvidia", "entity_type": "company"}}, {{"name": "Marvell", "entity_type": "company"}}]. "Goldman leads Apple bond offering" → [{{"name": "Goldman Sachs", "entity_type": "company"}}, {{"name": "Apple", "entity_type": "company"}}]. "Fed raises rates amid China tension" → [] (no companies — Fed is a government body, China is a country). Return [] when no entities pass the definition.

Respond ONLY in valid JSON:
{{
  "relevant": true/false,
  "relevance_score": 1-10,
  "relevance_reason": "GATE — apply before writing: If this article is primarily an opinion piece, profile, cultural commentary, or trend piece with no named transaction, earnings result, financing event, guidance change, regulatory action, or specific market-moving event — set relevant: false and leave this field as an empty string. Do not fabricate a read-through. Articles discussing a named person's political views, cultural influence, public commentary, or personal philosophy are not market-moving events even if that person runs a public or private company — set relevant: false. Internal staff promotions, appointments, hires, or departures are not market-moving events unless the article explicitly links the change to a named transaction, fundraising event, earnings event, guidance change, or regulatory action — if no such link exists, set relevant: false. For articles that pass the gate: 1-2 sentences max. Lead with the concrete market implication — the named deal, specific dollar figure, rate level, or event — not a description of what happened. Only name comp companies or sector read-throughs if the mechanism directly follows from what this article reports; do not append a comp list just to fill the format. Use specific company names, dollar figures, or named sectors where available. BANNED outputs — never write these: vague taxonomy ('this is relevant to PE / VC / financial markets / investing'), article restatements that just paraphrase the headline, fabricated comp lists, filler like 'this matters because it is a transaction in private equity'. For macro or rates articles, state the concrete effect on deal economics — LBO spreads, floating-rate credit costs, buyout multiples, M&A financing conditions, or risk appetite for new deals — never write that rates moved, banks are impacted, or that interest rates affect markets generally. Write as a buy-side analyst flagging a signal to a portfolio manager.",
  "industry_verticals": ["<1-3 values from the allowed industry verticals list above>"],
  "activity_types": ["<0-3 values from the allowed activity types list above>"],
  "companies": [{{"name": "Company A", "entity_type": "company"}}],
  "themes": ["M&A", "IPO", "Earnings", "Macro", "Geopolitics", "VC", "PE", "Regulation", "AI", "Crypto"],
  "sentiment": "bullish/bearish/neutral",
  "deal_type": "Classify as exactly one of these — apply the first definition that matches: M&A (a named company is acquiring, merging with, or being acquired by another named company), IPO (a specific named company is going public), Funding (a named company is receiving investment capital — a venture round, private equity investment, debt financing, or fundraising raise; the company receiving the money determines the type), Earnings (ONLY a company's own officially reported financial results — revenue figures, EPS, net income, or forward guidance issued as part of a formal results announcement; NEVER apply Earnings to analyst recommendations, investment theses, portfolio manager commentary, market outlooks, or forecasts — those are Other), Macro (central bank decisions, interest rate policy, inflation data, GDP, tariff or trade policy affecting broad markets — not specific to one company), Geopolitical (wars, sanctions, elections, cross-border disputes with market impact), Other (regulatory action, product launch, contract award, partnership announcement, legal settlement, personnel change, analyst note, market commentary — use this as a catch-all for anything that does not clearly fit the above). Return null only if the article is so general it fits none of these. Default to Other over null.",
  "primary_company": "The single company that is the MAIN ACTOR of the event this article covers — the company doing the action, not a company that is merely named or mentioned. Apply these rules in order: (1) Funding/IPO: primary_company is the company RECEIVING the investment or going public — not the investor, not a chip or technology supplier the article mentions, not a competitor named for comparison. Example: 'Mistral raises $830M to house Nvidia chips' → primary_company is Mistral, not Nvidia. (2) M&A: primary_company is the acquirer or the acquisition target — whichever is the article's central subject. Example: 'Goldman leads buyout of PortfolioCo' → primary_company is PortfolioCo (the target), not Goldman (the advisor). (3) Earnings: primary_company is the company that issued the results. (4) Commentary or market opinion: if a company's employee, analyst, or executive is quoted giving views on markets, sectors, or other companies — but the article is NOT about that company's own named event — return null. Example: 'Goldman's analyst recommends semiconductors' → null. (5) When one company is clearly driving the event and others are mentioned incidentally as suppliers, partners, advisors, or comparisons, always name the driving company. Return null only when two or more companies are genuinely co-equal actors with no single driver (e.g. a true joint venture announced by both parties equally). Never invent a name not present in the companies array."
}}"""


BATCH_FILTER_PROMPT = """You are a senior analyst at a top investment firm. Analyze EACH article in the batch below and score it for relevance to financial markets and investing.

Relevant topics include: M&A deals, IPOs, fundraising, valuations, earnings, market movements, geopolitical events affecting markets, macro trends, regulatory changes, PE/VC activity, public company news, economic data.

INDUSTRY_VERTICALS RULE (required per article): Return a JSON array of 1-3 values from this exact list — the industry sector(s) the companies or subjects operate in. Copy values character-for-character. Return [] if none clearly apply.
Allowed values: Technology, Healthcare & Biotech, Energy & Oil/Gas, Financial Services, Consumer & Retail, Industrials & Manufacturing, Aerospace & Defense, Real Estate, Media & Telecom, Materials & Mining, Agriculture

ACTIVITY_TYPES RULE (optional per article): Return a JSON array of 0-3 values from this exact list — the type of event or activity the article covers. Copy values character-for-character. Return [] if none clearly apply.
Allowed values: Mergers & Acquisitions, Private Equity, Venture Capital, IPO & Capital Markets, Earnings & Results, Macro & Policy, Geopolitics, Regulation & Legal, Fundraising, Crypto & Digital Assets, Leadership & Operations

COMPANIES RULE: Return a JSON array of entity objects. Each object must have exactly: "name" (verbatim from title or summary) and "entity_type" (must equal "company"). Only include entities where you are confident entity_type is "company". Default to exclusion when uncertain.

COMPANY = a for-profit or non-profit private organization, publicly traded corporation, startup, or financial institution with employees and a business operation (would have a LinkedIn company page).

EXCLUDE — do not include:
- People (executives, politicians, named individuals — e.g. "Elon Musk", "Xi Jinping", "Trump")
- Countries or regions ("China", "Iran", "Vietnam", "Greece", "the Gulf")
- Government bodies, regulators, military branches ("NASA", "FAA", "Pentagon", "Space Force", "U.S. Navy", "Federal Reserve", "SEC", "DOJ", "FOMC")
- Currencies and crypto ("Bitcoin", "USD", "ETH")
- Stock indexes ("S&P 500", "Nifty 50", "Nasdaq", "Sensex", "Nikkei")
- Abstract phrases ("Ukrainian drone makers", "Russia's energy sector", "Candy stocks", "Foundation AI model for plants")
- Software products or AI models — include the owning company instead ("OpenAI" not "ChatGPT", "Microsoft" not "Windows", "Anthropic" not "Claude")
- Investment vehicles, SPVs, sovereign wealth funds ("Blackstone Digital Infrastructure Trust", "Abu Dhabi Investment Authority", "GIC") — use parent firm if applicable
- Political parties, advocacy groups, religious institutions

Good: "Nvidia invests in Marvell" → [{{"name":"Nvidia","entity_type":"company"}},{{"name":"Marvell","entity_type":"company"}}]. "Fed raises rates amid China tension" → []. Return [] when no entities pass the definition.

RELEVANCE_REASON GATE (apply before writing): If an article is primarily an opinion piece, profile, cultural commentary, or trend piece with no named transaction, earnings result, financing event, guidance change, regulatory action, or specific market-moving event — set relevant: false and leave relevance_reason as an empty string. Do not fabricate a read-through. Articles discussing a named person's political views, cultural influence, public commentary, or personal philosophy are not market-moving events even if that person runs a company — set relevant: false. Internal staff promotions, appointments, hires, or departures are not market-moving unless explicitly linked to a named transaction, fundraising, earnings, guidance, or regulatory action. For articles that pass the gate: 1-2 sentences max. Lead with the concrete market implication — the named deal, specific dollar figure, rate level, or event. Use specific company names, dollar figures, or named sectors. Write as a buy-side analyst flagging a signal to a portfolio manager. BANNED outputs: vague taxonomy ('relevant to PE/VC/financial markets'), article restatements, fabricated comp lists, filler like 'this matters because it is a transaction in private equity'. For macro/rates articles, state the concrete effect on deal economics — LBO spreads, floating-rate credit costs, buyout multiples, M&A financing, risk appetite — never write that rates moved or that interest rates affect markets generally.

DEAL_TYPE RULE (apply first matching definition): M&A (named company acquiring/merging with/being acquired by another named company), IPO (named company going public), Funding (named company receiving investment capital — VC round, PE investment, debt financing, or fundraising raise), Earnings (ONLY a company's own officially reported financial results — revenue, EPS, net income, or forward guidance issued as part of a formal results announcement; NEVER apply Earnings to analyst recommendations, investment theses, PM commentary, market outlooks, or forecasts — those are Other), Macro (central bank decisions, interest rate policy, inflation data, GDP, tariff/trade policy affecting broad markets), Geopolitical (wars, sanctions, elections, cross-border disputes with market impact), Other (regulatory action, product launch, contract award, partnership, legal settlement, personnel change, analyst note, market commentary — catch-all). Return null only if the article fits none. Default to Other over null.

PRIMARY_COMPANY RULE: The single company that is the MAIN ACTOR of the event. (1) Funding/IPO: the company RECEIVING the investment or going public — not the investor, not a supplier, not a competitor named for comparison. (2) M&A: the acquirer or target — whichever is the central subject. (3) Earnings: the company that issued the results. (4) Commentary/market opinion where a company's employee, analyst, or executive is quoted giving views on OTHER companies or markets — return null. (5) When one company is clearly driving the event and others are mentioned incidentally as suppliers/partners/advisors/comparisons, always name the driving company. Return null only for genuine co-equal actors (e.g. a true joint venture). Never invent a name not present in the companies array.

ARTICLES (each prefixed with its 0-based index in square brackets):
{articles_block}

Respond ONLY with a valid JSON array containing EXACTLY {n} objects, one per article, in the same order as the input. Do not include any text before or after the array. Each object must have exactly these fields:
{{
  "index": <int, the 0-based index from the article list>,
  "relevant": true or false,
  "relevance_score": 1-10,
  "relevance_reason": "...",
  "industry_verticals": ["<1-3 values from the allowed industry verticals list>"],
  "activity_types": ["<0-3 values from the allowed activity types list>"],
  "companies": [{{"name": "Company A", "entity_type": "company"}}],
  "themes": ["M&A", "IPO", "Earnings", "Macro", "Geopolitics", "VC", "PE", "Regulation", "AI", "Crypto"],
  "sentiment": "bullish" or "bearish" or "neutral",
  "deal_type": "M&A" or "IPO" or "Funding" or "Earnings" or "Macro" or "Geopolitical" or "Other" or null,
  "primary_company": "..." or null
}}"""


# ---------------------------------------------------------------------------
# Entity quality gate — blocks currencies, countries, government bodies,
# and law firms from being written to the companies / company_mentions tables.
# ---------------------------------------------------------------------------

_CURRENCY_BLOCKLIST = {
    "bitcoin", "ethereum", "usd", "btc", "eth", "usdc", "usdt", "crypto",
    "tether", "ripple", "solana", "dogecoin", "litecoin", "binance coin",
    "binance", "eur", "gbp", "yuan", "yen", "cny", "jpy", "euro",
}

_COUNTRY_BLOCKLIST = {
    "iran", "china", "russia", "usa", "united states", "united states of america",
    "uk", "united kingdom", "israel", "north korea", "south korea", "germany",
    "france", "japan", "india", "brazil", "australia", "canada", "mexico",
    "turkey", "saudi arabia", "ukraine", "taiwan", "pakistan", "egypt",
    "indonesia", "nigeria", "south africa", "argentina",
}

_GOV_SUBSTRINGS = [
    "department of", "ministry of", "federal reserve", "sec ", "the sec",
    "congress", "senate", "white house", "pentagon",
    "european union", "world bank",
    "department of justice", "department of defense", "u.s. army",
    "u.s. navy", "u.s. air force", "treasury department",
    "internal revenue", "federal bureau",
    "securities and exchange commission",
    "federal trade commission",
    "federal deposit insurance",
    "consumer financial protection",
    "international monetary fund",
    "european commission",
    "european central bank",
    "bank of england",
    "bank of japan",
    "bank of canada",
    "reserve bank of",
]

_GOV_ACRONYM_RE = re.compile(r"\b(cia|imf|nato|doj|fbi|fda|ftc|cfpb|cftc|finra|fdic|occ|nasa|faa)\b")

_LAW_SUBSTRINGS = [
    "law offices of", "law office of", " llp", " & associates",
    "attorneys at law", "legal group", "law group", " p.c.", " pllc",
    "law firm", "legal counsel",
]


def is_blocked_entity(name: str) -> bool:
    """Return True if the entity name is a currency, country, government body,
    or law firm that should not be written to the companies table."""
    low = name.lower().strip()
    if low in _CURRENCY_BLOCKLIST:
        return True
    if low in _COUNTRY_BLOCKLIST:
        return True
    if _GOV_ACRONYM_RE.search(low):
        return True
    for pat in _GOV_SUBSTRINGS:
        if pat in low:
            return True
    for pat in _LAW_SUBSTRINGS:
        if pat in low:
            return True
    return False


# ---------------------------------------------------------------------------
# Ingest keyword blocklist — pre-filters articles before Gemini batch scoring
# to avoid wasting API tokens on class-action / law-firm PRs.
# ---------------------------------------------------------------------------

_INGEST_KEYWORD_BLOCKLIST = (
    # Class-action and shareholder lawsuit boilerplate
    "securities class action",
    "class action lawsuit",
    "shareholder lawsuit",
    "lead plaintiff deadline",
    "lead plaintiff",
    "remind investors",
    "encourages investors to contact",
    "securities fraud investigation",
    "loss recovery",
    "no cost to investors",
    # Investigation announcement boilerplate
    "announces investigation into",
    "filing deadline",
)


def matches_ingest_blocklist(article: dict) -> bool:
    """Return True if the article's title or summary matches any blocked phrase.
    Logs the matched phrase and article title for audit purposes."""
    text = ((article.get("title") or "") + " " + (article.get("summary") or "")).lower()
    for phrase in _INGEST_KEYWORD_BLOCKLIST:
        if phrase in text:
            print(f"  ⊘ Blocklist skip [{phrase!r}]: {article.get('title', '')[:80]}")
            return True
    return False


def extract_company_names(companies_raw: list) -> list[str]:
    """Parse Gemini's companies field.

    Handles two formats:
      New format: [{"name": "Acme Corp", "entity_type": "company"}, ...]
      Old format: ["Acme Corp", ...]  (fallback — model may not comply immediately)

    Returns a flat list of company name strings, filtering out any objects where
    entity_type != "company".
    """
    if not companies_raw:
        return []
    names = []
    for item in companies_raw:
        if isinstance(item, str):
            # Old format — include as-is; downstream blocklists handle quality
            if item.strip():
                names.append(item.strip())
        elif isinstance(item, dict):
            # New format — only include if entity_type is explicitly "company"
            if item.get("entity_type") == "company":
                name = (item.get("name") or "").strip()
                if name:
                    names.append(name)
        # Any other type (int, bool, etc.) — skip silently
    return names


def strip_html(text: str) -> str:
    """Strip HTML tags, decode entities, remove bare URLs, collapse whitespace.
    Mirrors the logic in src/lib/strip-html.ts so stored summaries are clean
    for both LLM extraction and downstream UI rendering."""
    if not text:
        return ""
    text = re.sub(r"<[^>]+>", " ", text)                          # remove tags
    text = _html.unescape(text)                                    # decode &amp; &#038; etc.
    text = re.sub(r"https?://\S+", "", text)                       # bare URLs add no signal
    text = re.sub(r"\s*The post .+? appeared first on .+?\.\s*$",  # PE Hub boilerplate
                  "", text, flags=re.DOTALL)
    text = re.sub(r"\s{2,}", " ", text)                            # collapse whitespace
    return text.strip()


def fetch_watchlist_finnhub_articles() -> list[dict]:
    """Watchlist-driven Finnhub fetch (v1).

    Pulls DISTINCT ticker identifiers from the `watchlist` table, fetches
    Finnhub company-news for the last 7 days (cap 8 per ticker), dedupes
    candidates against the last 30 days of existing rows in the `articles`
    table by URL, and returns article dicts in the same shape that
    fetch_all_articles produces. The returned articles flow through the
    existing Gemini filter + articles-table insert path — no separate
    storage path, no watchlist_articles writes.

    Emits a structured log line:
      watchlist-finnhub: N tickers, M articles fetched, K inserted, J duplicates
    where K is candidates passed back to the caller (post-DB-dedup) and
    J is the count rejected as URL-duplicates of existing rows. Final
    insert success is determined downstream by store_article.
    """
    finnhub_key = os.environ.get("FINNHUB_API_KEY", "")
    if not finnhub_key:
        print("  watchlist-finnhub: FINNHUB_API_KEY not set, skipping")
        return []

    # Pull DISTINCT ticker identifiers from watchlist (same client pattern as
    # watchlist_sync.run_sync). Uppercased + de-duplicated in Python because
    # supabase-py does not expose a DISTINCT primitive.
    try:
        resp = supabase.table("watchlist").select("identifier").eq("type", "ticker").execute()
        rows = resp.data or []
    except Exception as ex:
        print(f"  watchlist-finnhub: watchlist read failed: {ex}")
        return []

    tickers: list[str] = []
    seen_t: set[str] = set()
    for row in rows:
        ident = (row.get("identifier") or "").strip().upper()
        if ident and ident not in seen_t:
            seen_t.add(ident)
            tickers.append(ident)

    if not tickers:
        print("  watchlist-finnhub: 0 tickers, 0 articles fetched, 0 inserted, 0 duplicates")
        return []

    # Pre-load existing article URLs from the last 30 days so we can dedupe
    # candidates BEFORE handing them to the Gemini filter (saves tokens and
    # gives an accurate duplicate count in the structured log line).
    existing_urls: set[str] = set()
    try:
        cutoff = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
        ex_resp = supabase.table("articles").select("url").gte("ingested_at", cutoff).execute()
        for r in (ex_resp.data or []):
            u = r.get("url")
            if u:
                existing_urls.add(u)
    except Exception as ex:
        print(f"  watchlist-finnhub: existing-url preload failed (continuing without DB dedupe): {ex}")

    now = datetime.now(timezone.utc)
    from_dt = now - timedelta(days=7)
    fetched = 0
    duplicates = 0
    out: list[dict] = []
    out_urls: set[str] = set()

    for ticker in tickers:
        try:
            r = requests.get(
                "https://finnhub.io/api/v1/company-news",
                params={
                    "symbol": ticker,
                    "from": from_dt.strftime("%Y-%m-%d"),
                    "to": now.strftime("%Y-%m-%d"),
                    "token": finnhub_key,
                },
                timeout=8,
            )
            r.raise_for_status()
            items = r.json() or []
        except Exception as ex:
            print(f"  watchlist-finnhub: fetch failed for {ticker}: {ex}")
            time.sleep(1.0)
            continue

        for item in items[:8]:
            url = item.get("url", "")
            title = item.get("headline", "")
            if not url or not title:
                continue
            fetched += 1
            if url in existing_urls or url in out_urls:
                duplicates += 1
                continue
            ts = item.get("datetime")
            published_at = now.isoformat()
            if ts:
                try:
                    published_at = datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()
                except Exception:
                    pass
            out.append({
                "title": title,
                "summary": strip_html(item.get("summary", ""))[:500],
                "url": url,
                "source": item.get("source") or "Finnhub",
                "published_at": published_at,
                "content_type": "snippet",
            })
            out_urls.add(url)
        time.sleep(1.0)  # polite pacing — mirrors watchlist_sync.fetch_finnhub_articles

    print(
        f"  watchlist-finnhub: {len(tickers)} tickers, {fetched} articles fetched, "
        f"{len(out)} inserted, {duplicates} duplicates"
    )
    return out


def fetch_all_articles():
    articles = []
    for source, url in RSS_FEEDS.items():
        try:
            feed = feedparser.parse(url)
            for e in feed.entries[:8]:
                articles.append({
                    "title": e.get("title", ""),
                    "summary": strip_html(e.get("summary", e.get("description", "")))[:500],
                    "url": e.get("link", ""),
                    "source": source,
                    "published_at": e.get("published", datetime.now(timezone.utc).isoformat()),
                    "content_type": "full_text" if source in FULL_TEXT_SOURCES else "snippet"
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
                    "summary": strip_html(a.get("description", ""))[:500],
                    "url": a.get("url", ""),
                    "source": a.get("source", {}).get("name", "NewsAPI"),
                    "published_at": a.get("publishedAt", datetime.now(timezone.utc).isoformat()),
                    "content_type": "snippet"
                })
            time.sleep(0.3)
    except Exception as ex:
        print(f"  NewsAPI error: {ex}")

    # Watchlist-driven Finnhub fetch (v1) — single integration point.
    # Articles route through the same articles-table insert path as RSS/NewsAPI
    # (Gemini filter, entity validation, company_mentions linkage). This does
    # NOT touch watchlist_articles. See fetch_watchlist_finnhub_articles().
    try:
        articles.extend(fetch_watchlist_finnhub_articles())
    except Exception as ex:
        print(f"  watchlist-finnhub error: {ex}")

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
    )
    try:
        response = gemini_client.models.generate_content(
            model=GEMINI_MODEL,
            contents=prompt,
        )
        text = (response.text or "").strip()
        if text.startswith("```"):
            text = text.split("```")[1]
            if text.startswith("json"): text = text[4:]
        return json.loads(text.strip())
    except Exception as ex:
        print(f"  Filter error: {ex}")
        return None


def filter_articles_batch(articles):
    """Score a batch of articles in a single Gemini call.

    Returns a list of analysis dicts aligned by index with `articles`.
    Any slots the model fails to return are back-filled with per-article calls.
    If the entire batch call fails, falls back to per-article filtering.
    """
    if not articles:
        return []

    lines = []
    for i, a in enumerate(articles):
        title = (a.get("title") or "").replace("\n", " ").strip()
        summary = (a.get("summary") or "").replace("\n", " ").strip()[:400]
        source = a.get("source") or ""
        lines.append(f"[{i}] SOURCE: {source} | TITLE: {title} | SUMMARY: {summary}")
    articles_block = "\n".join(lines)

    prompt = BATCH_FILTER_PROMPT.format(
        articles_block=articles_block,
        n=len(articles),
    )

    try:
        response = gemini_client.models.generate_content(
            model=GEMINI_MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(
                temperature=0.2,
                max_output_tokens=65536,
                response_mime_type="application/json",
            ),
        )
        text = (response.text or "").strip()
        if text.startswith("```"):
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
            text = text.strip()
        # Extract the JSON array if the model wrapped it in prose
        m = re.search(r"\[[\s\S]*\]", text)
        if m:
            text = m.group(0)
        parsed = json.loads(text)
        if not isinstance(parsed, list):
            raise ValueError("Batch response was not a JSON array")

        results = [None] * len(articles)
        for item in parsed:
            if not isinstance(item, dict):
                continue
            idx = item.get("index")
            if isinstance(idx, int) and 0 <= idx < len(articles) and results[idx] is None:
                results[idx] = item

        missing = [i for i, r in enumerate(results) if r is None]
        if missing:
            print(f"  ⚠ Batch returned {len(parsed)}/{len(articles)} results, filling {len(missing)} individually...")
            for i in missing:
                results[i] = filter_article(articles[i])
        return results
    except Exception as ex:
        print(f"  Batch filter error ({ex}); falling back to per-article...")
        return [filter_article(a) for a in articles]


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
        raw_companies = extract_company_names(analysis.get("companies", []))
        clean_companies = []
        for company in raw_companies:
            if is_blocked_entity(company):
                print(f"  ⊘ Blocked entity: {company}")
                continue
            if not is_valid_company(company, supabase):
                continue
            clean_companies.append(company)

        industry_verticals = validate_tags(analysis.get("industry_verticals", []), INDUSTRY_VERTICALS)
        activity_types = validate_tags(analysis.get("activity_types", []), ACTIVITY_TYPES)

        # Backward compat: write sector as first vertical so synthesize.py and
        # any frontend code still reading the old column keeps working.
        sector_fallback = industry_verticals[0] if industry_verticals else ""

        r = supabase.table("articles").insert({
            "title": article["title"],
            "summary": article["summary"] or "",
            "url": article["url"],
            "source": article["source"],
            "published_at": article["published_at"],
            "relevance_score": analysis["relevance_score"],
            "relevance_reason": analysis.get("relevance_reason", ""),
            "companies": clean_companies,
            "themes": analysis.get("themes", []),
            "sentiment": analysis.get("sentiment", "neutral"),
            "sector": sector_fallback,
            "industry_verticals": industry_verticals,
            "activity_types": activity_types,
            "deal_type": analysis.get("deal_type"),
            "primary_company": analysis.get("primary_company"),
            "content_type": article.get("content_type", "snippet"),
        }).execute()
        article_id = r.data[0]["id"]
        for company in clean_companies:
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
    print("\n[1/4] Fetching articles...")
    articles = fetch_all_articles()
    print(f"  {len(articles)} unique articles")

    print(f"\n[2/4] Pre-filtering {len(articles)} articles against keyword blocklist...")
    articles = [a for a in articles if not matches_ingest_blocklist(a)]
    print(f"  {len(articles)} articles after keyword pre-filter")

    print(f"\n[3/4] Filtering {len(articles)} articles with Gemini (batch)...")
    results = filter_articles_batch(articles)
    relevant = []
    for a, result in zip(articles, results):
        if result and result.get("relevant") and result.get("relevance_score", 0) >= 6:
            relevant.append((a, result))
            print(f"  ✓ [{result['relevance_score']}/10] [{result.get('sector','?')[:20]}] {a['title'][:60]}...")

    print(f"\n[4/4] Storing {len(relevant)} articles...")
    stored_pairs = []  # (article_id, article_dict) for enrichment
    for a, r in relevant:
        aid = store_article(a, r)
        if aid:
            stored_pairs.append((aid, a))
    article_ids = [aid for aid, _ in stored_pairs]
    stored = len(article_ids)
    print(f"\n✅ Done — {stored} new articles stored")

    # [4b] Full-text enrichment for scrapeable sources
    enriched = 0
    for aid, a in stored_pairs:
        if a["source"] not in SCRAPEABLE_SOURCES:
            continue
        try:
            full_text = fetch_full_text(a["url"], a["source"])
            if full_text:
                supabase.table("articles").update({"content": full_text}).eq("id", aid).execute()
                print(f"  Full text fetched: {a['source']} {a['title'][:50]} ({len(full_text)} chars)")
                enriched += 1
            time.sleep(0.5)
        except Exception as ex:
            print(f"  ⚠ Enrichment failed for {a['title'][:50]}: {ex}")
    if enriched:
        print(f"  📝 {enriched} articles enriched with full text")

    boosted = boost_watchlist_relevance(article_ids)
    print(f"  ★ {boosted} articles boosted by watchlist relevance")
    return stored

if __name__ == "__main__":
    run_ingestion()
