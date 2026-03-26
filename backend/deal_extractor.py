"""
deal_extractor.py
Runs after ingest — scans recent articles with Groq AI,
extracts deals, and upserts them into the deal_flow Supabase table.
"""

import os, json, re, time, random
from datetime import datetime, timezone, timedelta
from supabase import create_client
from groq import Groq, RateLimitError

supabase = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_ANON_KEY"])
groq     = Groq(api_key=os.environ["GROQ_API_KEY"])

SYSTEM_PROMPT = """You are a financial analyst extracting deal intelligence from news articles.

Given an article title and summary, determine if it describes a specific financial transaction or deal.
Qualifying deals include: M&A, LBO, IPO, VC/PE funding rounds, SPAC mergers, asset sales, minority stake acquisitions, recapitalizations, bankruptcy restructurings.

If a deal is present, respond ONLY with a valid JSON object using this exact schema:
{
  "is_deal": true,
  "company": "Target company name (the company being acquired, funded, or going public)",
  "acquirer": "Acquiring company or investor (if known, else null)",
  "deal_type": "One of: M&A | LBO | IPO | VC Round | PE Investment | Asset Sale | SPAC | Recap | Minority Stake | Restructuring | Other",
  "stage": "One of: rumored | announced | under_loi | diligence | signed | closed",
  "valuation": "Dollar value string if mentioned (e.g. '$4.2B', '$850M EV'), else null",
  "sector": "One of: Technology M&A & Investment Banking | Venture Capital & Startup Funding | Private Equity & Buyouts | Public Markets & Earnings | Geopolitics & Macro | Fintech & Crypto | Healthcare & Biotech | Energy & Climate | Consumer & Retail | Real Estate & REITs",
  "thesis": "One sentence: why this deal matters from an IB/PE/VC perspective",
  "source_url": null
}

If no specific deal is present, respond ONLY with: {"is_deal": false}
Do not add any text outside the JSON."""

def groq_with_backoff(messages, temperature=0.1, max_tokens=400, max_retries=5):
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

def extract_deal(title, summary, url):
    content = f"Title: {title}\nSummary: {summary or ''}"
    try:
        raw = groq_with_backoff(
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user",   "content": content},
            ],
            temperature=0.1,
            max_tokens=400,
        )
        raw = re.sub(r"^```json|^```|```$", "", raw, flags=re.MULTILINE).strip()
        data = json.loads(raw)
        if data.get("is_deal"):
            data["source_url"] = url
            return data
        return None
    except RateLimitError:
        print(f"  ✗ Groq rate limit exhausted for '{title[:50]}'")
        return None
    except Exception as e:
        print(f"  ⚠ Groq error for '{title[:50]}': {e}")
        return None

def stage_label(stage):
    mapping = {
        "rumored":   "rumored",
        "announced": "announced",
        "under_loi": "loi",
        "diligence": "diligence",
        "signed":    "signed",
        "closed":    "closed",
    }
    return mapping.get(stage, "rumored")

def run():
    print("🔍 Deal Extractor starting...")

    cutoff = (datetime.now(timezone.utc) - timedelta(hours=48)).isoformat()
    resp = supabase.table("articles")\
        .select("id, title, summary, url, sector")\
        .gte("ingested_at", cutoff)\
        .order("ingested_at", desc=True)\
        .limit(150)\
        .execute()

    articles = resp.data or []
    print(f"  📰 Processing {len(articles)} recent articles...")

    extracted = 0
    upserted  = 0

    for article in articles:
        title   = article.get("title", "")
        summary = article.get("summary", "")
        url     = article.get("url", "")

        deal_keywords = [
            "acqui", "merger", "buyout", "takeover", "ipo", "fund", "raises",
            "invest", "stake", "deal", "sale", "billion", "million", "close",
            "round", "valua", "capital", "backs", "buys", "sells", "spac",
            "lbo", "recap", "restructur", "bankrupt", "listing"
        ]
        combined = (title + " " + (summary or "")).lower()
        if not any(kw in combined for kw in deal_keywords):
            continue

        deal = extract_deal(title, summary, url)

        # Inter-article sleep with jitter to avoid bursting the rate limit
        time.sleep(1.0 + random.uniform(0, 0.5))

        if not deal:
            continue

        if not deal.get("company"):
            print("↷ Skipping deal with missing company")
            continue

        extracted += 1
        print(f"  ✓ Deal found: {deal['company']} — {deal['deal_type']} ({deal['stage']})")

        row = {
            "company":        deal["company"],
            "acquirer":       deal.get("acquirer"),
            "deal_type":      deal["deal_type"],
            "stage":          stage_label(deal["stage"]),
            "valuation":      deal.get("valuation"),
            "sector":         deal.get("sector") or article.get("sector"),
            "thesis":         deal.get("thesis"),
            "source_url":     deal.get("source_url") or url,
            "auto_extracted": True,
            "updated_at":     datetime.now(timezone.utc).isoformat(),
        }

        try:
            existing = supabase.table("deal_flow")\
                .select("id, stage")\
                .eq("company", row["company"])\
                .eq("deal_type", row["deal_type"])\
                .execute()

            if existing.data:
                deal_id = existing.data[0]["id"]
                supabase.table("deal_flow").update({
                    "stage":      row["stage"],
                    "thesis":     row["thesis"],
                    "valuation":  row["valuation"],
                    "source_url": row["source_url"],
                    "updated_at": row["updated_at"],
                }).eq("id", deal_id).execute()
                print(f"    → Updated existing deal (id: {deal_id})")
            else:
                row["created_at"] = datetime.now(timezone.utc).isoformat()
                supabase.table("deal_flow").insert(row).execute()
                print(f"    → Inserted new deal")
                upserted += 1

        except Exception as e:
            print(f"  ⚠ Supabase error: {e}")

    print(f"\n✅ Done — {extracted} deals extracted, {upserted} new deals added to pipeline")
