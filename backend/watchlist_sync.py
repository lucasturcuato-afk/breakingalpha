"""
BreakingAlpha - Watchlist Article Sync (Step 13)
Pre-fetches articles for all watchlist identifiers from Finnhub, Exa, and GDELT,
then upserts them into the watchlist_articles Supabase table.
"""

import os, hashlib, re, time
from datetime import datetime, timezone, timedelta
from urllib.parse import urlparse
import requests
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()
supabase = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_ANON_KEY"])


def strip_html(text: str) -> str:
    if not text:
        return text
    text = re.sub(r'<[^>]+>', '', text)
    text = (text.replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>')
                .replace('&quot;', '"').replace('&#39;', "'").replace('&nbsp;', ' '))
    return re.sub(r'\s+', ' ', text).strip()
FINNHUB_KEY = os.environ.get("FINNHUB_API_KEY", "")
EXA_KEY = os.environ.get("EXA_API_KEY", "")

LEGACY_TICKER_NAMES: dict[str, str] = {
    "NVDA": "Nvidia", "AMZN": "Amazon", "TSLA": "Tesla", "AAPL": "Apple",
    "MSFT": "Microsoft", "GOOGL": "Alphabet", "GOOG": "Alphabet",
    "META": "Meta", "IONQ": "IonQ", "FCX": "Freeport-McMoRan",
    "SPMO": "Invesco", "BRK.B": "Berkshire Hathaway", "BRK": "Berkshire Hathaway",
    "V": "Visa", "BX": "Blackstone", "APO": "Apollo Global", "KKR": "KKR",
    "GS": "Goldman Sachs", "MS": "Morgan Stanley", "JPM": "JPMorgan",
    "BAC": "Bank of America", "CG": "Carlyle", "BAM": "Brookfield",
    "AMD": "AMD", "INTC": "Intel", "TSM": "TSMC", "BABA": "Alibaba",
    "NFLX": "Netflix", "DIS": "Disney", "PYPL": "PayPal", "COIN": "Coinbase",
    "PLTR": "Palantir", "UBER": "Uber", "CLS": "Celestica", "RR": "Richtech Robotics",
}

NOISE_TITLE_PATTERNS = [
    "stocks", "market wrap", "session:", "whale activity", "intraday",
    "gap up", "gap down", "best pheromone", "celebrity", "gossip",
    "entertainment", "movies", "fashion", "beauty", "perfume",
    "prostate", "supplement", "diet", "weight loss", "horoscope",
    "recipe", "travel", "real estate listing", "obituary",
    "commissioned", "tv series", "television", "box office", "film review",
    "album", "music video", "tour dates", "concert", "nominated", "award show",
]

FINANCIAL_BOOST_PATTERNS = [
    "raises", "funding", "acquisition", "merger", "ipo", "earnings",
    "revenue", "profit", "quarterly", "analyst", "investor",
    "valuation", "series a", "series b", "series c", "billion",
    "million", "deal", "partnership", "ceo", "launches", "expands",
]

BLOCKED_DOMAINS = [
    "linkedin.com", "twitter.com", "facebook.com", "instagram.com",
    "crunchbase.com", "pitchbook.com", "bloomberg.com/profile",
    "glassdoor.com", "indeed.com", "wellfound.com", "ycombinator.com",
    "angel.co", "wikipedia.org", "wikidata.org",
]

BLOCKED_URL_PATTERNS = [
    "/jobs", "/careers", "/about", "/team", "/contact",
    "/company/", "/profile/", "/people/", "/person/",
    "/experts", "/directory", "/listing",
]

STOP_WORDS = {
    "the","a","an","of","in","at","to","for","and","or","is","are","was","were",
    "it","its","with","on","by","as","from","that","this","be","been","has","have",
    "had","will","would","could","should","may","might","news","says","said","new",
    "how","what","why","when","who","after","before","over","up","down","about",
}


def normalize_title(title: str) -> set:
    words = re.sub(r'[^\w\s]', '', title.lower()).split()
    return {w for w in words if w not in STOP_WORDS and len(w) > 2}


def extract_key_entities(title: str) -> set:
    """Extract financial entities only — dollar amounts and percentages.
    Company names are intentionally excluded to prevent over-clustering
    stories that share only a company name but cover different events.
    """
    entities: set = set()
    entities.update(re.findall(r'\$[\d,.]+[MBKTmbt]?', title))
    entities.update(re.findall(r'\b[\d,.]+%', title))
    return entities


def token_similarity(title_a: str, title_b: str) -> float:
    words_a = normalize_title(title_a)
    words_b = normalize_title(title_b)
    if len(words_a) < 3 or len(words_b) < 3:
        return 0.0
    intersection = words_a & words_b
    union = words_a | words_b
    return len(intersection) / len(union) if union else 0.0


def is_same_story(a: dict, b: dict) -> bool:
    """Returns True if two articles are likely covering the same news story.

    BOTH conditions must be true:
    1. They share at least one financial entity (dollar amount or percentage)
       — company name alone does NOT trigger clustering.
    2. Token similarity > 0.35.
    3. Published within 48 hours of each other.
    """
    entities_a = extract_key_entities(a.get('title', ''))
    entities_b = extract_key_entities(b.get('title', ''))
    if not (entities_a & entities_b):
        return False
    if token_similarity(a.get('title', ''), b.get('title', '')) < 0.35:
        return False
    try:
        pub_a = datetime.fromisoformat((a.get('published_at') or '').replace('Z', '+00:00'))
        pub_b = datetime.fromisoformat((b.get('published_at') or '').replace('Z', '+00:00'))
        if abs((pub_a - pub_b).total_seconds()) > 172800:
            return False
    except Exception:
        return False
    return True


def is_article_url(url: str) -> bool:
    if not url:
        return False
    parsed = urlparse(url)
    domain = parsed.netloc.lower()
    path = parsed.path.lower()

    # Block known non-news domains
    if any(blocked in domain for blocked in BLOCKED_DOMAINS):
        return False

    # Block non-article URL patterns
    if any(pattern in path for pattern in BLOCKED_URL_PATTERNS):
        return False

    # Block root domain pages (path is just "/" or empty)
    if path in ("", "/", "/#"):
        return False

    # Block URLs that are just the company name (e.g. afterquery.com or afterquery.com/home)
    path_parts = [p for p in path.split("/") if p]
    if len(path_parts) == 0:
        return False

    return True


def resolve_company_name(identifier: str, entry_type: str, display_name: str | None) -> str:
    if entry_type == "ticker":
        return LEGACY_TICKER_NAMES.get(identifier.upper()) or display_name or identifier
    return display_name or identifier


def score_relevance(article: dict, company_name: str) -> int:
    title = (article.get("title") or "").lower()
    summary = (article.get("summary") or "").lower()
    name = company_name.lower()

    score = 5

    # Company name match
    if name in title:
        score += 2
    elif name in summary:
        score += 1

    # Financial signal boost
    combined = title + " " + summary
    if any(pattern in combined for pattern in FINANCIAL_BOOST_PATTERNS):
        score += 1

    # Noise penalty — non-financial content
    if any(pattern in title for pattern in NOISE_TITLE_PATTERNS):
        score -= 3

    # Very short or empty title penalty
    if len(title.strip()) < 20:
        score -= 1

    return max(1, min(10, score))


def fetch_finnhub_articles(identifier: str, company_name: str) -> list[dict]:
    try:
        now = datetime.now(timezone.utc)
        from_dt = now - timedelta(days=30)
        params = {
            "symbol": identifier,
            "from": from_dt.strftime("%Y-%m-%d"),
            "to": now.strftime("%Y-%m-%d"),
            "token": FINNHUB_KEY,
        }
        resp = requests.get(
            "https://finnhub.io/api/v1/company-news",
            params=params,
            timeout=8,
        )
        resp.raise_for_status()
        items = resp.json()[:20]
        articles = []
        for item in items:
            item_id = item.get("id")
            if not item_id or not item.get("headline"):
                continue
            url = item.get("url", "")
            published_at = None
            ts = item.get("datetime")
            if ts:
                try:
                    published_at = datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()
                except Exception:
                    published_at = None
            articles.append({
                "article_id": f"finnhub-{item_id}",
                "title": item.get("headline", ""),
                "url": url,
                "source": item.get("source", ""),
                "source_type": "finnhub",
                "summary": item.get("summary", ""),
                "published_at": published_at,
            })
        return articles
    except Exception as ex:
        print(f"⚠ Finnhub fetch failed for {identifier}: {ex}")
        return []
    finally:
        time.sleep(1.0)


def fetch_exa_articles(identifier: str, company_name: str) -> list[dict]:
    try:
        thirty_days_ago = (datetime.now(timezone.utc) - timedelta(days=30)).strftime("%Y-%m-%dT%H:%M:%SZ")
        payload = {
            "query": f"{company_name} news",
            "type": "auto",
            "category": "news",
            "numResults": 10,
            "startPublishedDate": thirty_days_ago,
            "contents": {
                "highlights": {
                    "maxCharacters": 400,
                    "numSentences": 3,
                }
            },
        }
        resp = requests.post(
            "https://api.exa.ai/search",
            json=payload,
            headers={"x-api-key": EXA_KEY, "Content-Type": "application/json"},
            timeout=10,
        )
        if resp.status_code in (401, 402):
            print(f"⚠ Exa API key issue ({resp.status_code}) for {identifier} — skipping")
            return []
        resp.raise_for_status()
        results = resp.json().get("results", [])
        articles = []
        for item in results:
            url = item.get("url", "")
            article_id = "exa-" + hashlib.md5(url.encode()).hexdigest()[:12]
            highlights = item.get("highlights") or []
            summary = " ".join(highlights) if highlights else ""
            published_at = item.get("publishedDate")
            articles.append({
                "article_id": article_id,
                "title": item.get("title", ""),
                "url": url,
                "source": item.get("author") or "Exa",
                "source_type": "exa",
                "summary": summary,
                "published_at": published_at,
            })
        articles = [a for a in articles if is_article_url(a.get("url", ""))]
        articles = [a for a in articles if len(a.get("title", "").strip()) > 15]
        return articles
    except Exception as ex:
        print(f"⚠ Exa fetch failed for {identifier}: {ex}")
        return []


def fetch_gdelt_articles(identifier: str, company_name: str) -> list[dict]:
    try:
        params = {
            "query": company_name,
            "mode": "artlist",
            "maxrecords": "10",
            "format": "json",
            "sort": "DateDesc",
        }
        backoff_delays = [2, 4, 8]
        resp = None
        for attempt, delay in enumerate(backoff_delays + [None], start=1):
            resp = requests.get(
                "https://api.gdeltproject.org/api/v2/doc/doc",
                params=params,
                headers={"User-Agent": "Signalera/1.0"},
                timeout=8,
            )
            if resp.status_code == 429 and delay is not None:
                print(f"⚠ GDELT 429 for {identifier}, retry {attempt}/3 in {delay}s")
                time.sleep(delay)
                continue
            break
        resp.raise_for_status()
        data = resp.json()
        articles_raw = data.get("articles", [])
        articles = []
        for item in articles_raw:
            if item.get("language", "") != "English":
                continue
            url = item.get("url", "")
            article_id = "gdelt-" + hashlib.md5(url.encode()).hexdigest()[:12]
            published_at = None
            seendate = item.get("seendate", "")
            if seendate:
                try:
                    # Format: "20260414T120000Z"
                    dt = datetime.strptime(seendate, "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc)
                    published_at = dt.isoformat()
                except Exception:
                    published_at = None
            articles.append({
                "article_id": article_id,
                "title": item.get("title", ""),
                "url": url,
                "source": item.get("domain", "GDELT"),
                "source_type": "gdelt",
                "summary": "",
                "published_at": published_at,
            })
        return articles
    except Exception as ex:
        print(f"⚠ GDELT fetch failed for {identifier}: {ex}")
        return []


def _normalize_title(title: str) -> str:
    t = title.lower()
    t = re.sub(r'[^a-z0-9\s]', '', t)
    return re.sub(r'\s+', ' ', t).strip()


def dedup_articles(articles: list[dict]) -> list[dict]:
    # Sort best version first so highest-scored duplicate is kept
    articles = sorted(articles, key=lambda a: a.get("relevance_score", 5), reverse=True)
    seen_ids: set[str] = set()
    seen_titles: set[str] = set()
    result = []
    for article in articles:
        aid = article["article_id"]
        if aid in seen_ids:
            continue
        seen_ids.add(aid)
        nt = _normalize_title(article.get("title", ""))
        if nt and nt in seen_titles:
            continue
        if nt:
            seen_titles.add(nt)
        result.append(article)

    # Story clustering: remove articles that cover the same story as a representative
    before_clustering = len(result)
    representatives: list[dict] = []
    for article in result:
        if not any(is_same_story(article, r) for r in representatives):
            representatives.append(article)
    after_clustering = len(representatives)
    removed = before_clustering - after_clustering
    print(f"  Story clustering: {before_clustering} → {after_clustering} articles ({removed} removed)")
    return representatives


def upsert_articles_batch(identifier: str, articles: list[dict]) -> int:
    now_iso = datetime.now(timezone.utc).isoformat()
    total = 0
    batch_size = 20
    for i in range(0, len(articles), batch_size):
        batch = articles[i : i + batch_size]
        rows = [
            {
                "identifier": identifier,
                "article_id": a["article_id"],
                "title": a["title"],
                "url": a.get("url"),
                "source": a.get("source"),
                "source_type": a["source_type"],
                "summary": a.get("summary"),
                "published_at": a.get("published_at"),
                "relevance_score": a.get("relevance_score", 5),
                "fetched_at": now_iso,
            }
            for a in batch
        ]
        try:
            supabase.table("watchlist_articles").upsert(
                rows,
                on_conflict="identifier,article_id",
            ).execute()
            total += len(rows)
        except Exception as ex:
            print(f"  ⚠ Upsert batch error for {identifier} (batch {i//batch_size + 1}): {ex}")
    return total


def cleanup_stale_articles(identifier: str) -> None:
    try:
        cutoff = (datetime.now(timezone.utc) - timedelta(days=35)).isoformat()
        supabase.table("watchlist_articles").delete().eq("identifier", identifier).lt("fetched_at", cutoff).execute()
        print(f"🗑 Cleaned stale articles for {identifier}")
    except Exception as ex:
        print(f"⚠ Failed to clean stale articles for {identifier}: {ex}")


def cleanup_orphaned_identifiers(active_identifiers: set[str]) -> None:
    try:
        resp = supabase.table("watchlist_articles").select("identifier").execute()
        all_ids = {row["identifier"] for row in (resp.data or [])}
        orphaned = all_ids - active_identifiers
        for oid in orphaned:
            supabase.table("watchlist_articles").delete().eq("identifier", oid).execute()
            print(f"🗑 Removed orphaned identifier: {oid}")
    except Exception as ex:
        print(f"⚠ Failed to cleanup orphaned identifiers: {ex}")


def sync_identifier(identifier: str, entry_type: str, display_name: str | None) -> dict:
    try:
        company_name = resolve_company_name(identifier, entry_type, display_name)
        cleanup_stale_articles(identifier)

        finnhub_articles = []
        exa_articles = []
        gdelt_articles = []

        try:
            finnhub_articles = fetch_finnhub_articles(identifier, company_name)
        except Exception as ex:
            print(f"⚠ Finnhub error for {identifier}: {ex}")

        try:
            exa_articles = fetch_exa_articles(identifier, company_name)
        except Exception as ex:
            print(f"⚠ Exa error for {identifier}: {ex}")

        try:
            gdelt_articles = fetch_gdelt_articles(identifier, company_name)
            time.sleep(1.5)
        except Exception as ex:
            print(f"⚠ GDELT error for {identifier}: {ex}")

        all_articles = finnhub_articles + exa_articles + gdelt_articles
        now = datetime.now(timezone.utc)
        cutoff_past = now - timedelta(days=35)
        all_articles = [
            a for a in all_articles
            if a.get("published_at") is None or (
                datetime.fromisoformat(a["published_at"].replace("Z", "+00:00")) >= cutoff_past
                and datetime.fromisoformat(a["published_at"].replace("Z", "+00:00")) <= now
            )
        ]
        for article in all_articles:
            article["title"] = strip_html(article.get("title") or "")
            article["summary"] = strip_html(article.get("summary") or "")
            article["relevance_score"] = score_relevance(article, company_name)

        # Drop articles with very low relevance scores
        all_articles = [a for a in all_articles if a.get("relevance_score", 5) >= 3]

        deduped = dedup_articles(all_articles)
        count = upsert_articles_batch(identifier, deduped)
        print(f"✓ {identifier} ({company_name}): {count} articles upserted ({len(finnhub_articles)} FH / {len(exa_articles)} Exa / {len(gdelt_articles)} GDELT)")
        return {"identifier": identifier, "count": count, "error": None}
    except Exception as ex:
        print(f"✗ sync_identifier failed for {identifier}: {ex}")
        return {"identifier": identifier, "count": 0, "error": str(ex)}


def run_sync() -> None:
    try:
        resp = supabase.table("watchlist").select("identifier, type, display_name").neq("type", "sector").execute()
        rows = resp.data or []

        # Deduplicate by identifier.upper() + type — multiple users may track the same ticker
        seen: dict[str, dict] = {}
        for row in rows:
            key = f"{row['identifier'].upper()}::{row['type']}"
            if key not in seen:
                seen[key] = row

        unique_entries = list(seen.values())
        active_identifiers = {row["identifier"] for row in unique_entries}

        print(f"⚙ watchlist_sync: {len(unique_entries)} unique identifiers to sync")

        results = [sync_identifier(row["identifier"], row["type"], row.get("display_name")) for row in unique_entries]

        successes = sum(1 for r in results if r["error"] is None)
        failures = len(results) - successes
        print(f"✓ watchlist_sync complete: {successes} ok, {failures} failed")

        cleanup_orphaned_identifiers(active_identifiers)
    except Exception as ex:
        print(f"✗ run_sync failed: {ex}")


if __name__ == "__main__":
    run_sync()
