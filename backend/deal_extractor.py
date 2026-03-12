"""
deal_extractor.py
Runs after ingest — scans recent articles with Groq AI,
extracts deals, and upserts them into the deal_flow Supabase table.
"""

import os, json, re
from datetime import datetime, timezone, timedelta
from supabase import create_client
from groq import Groq

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

def extract_deal(title, summary, url):
    content = f"Title: {title}\nSummary: {summary or ''}"
    try:
        resp = groq.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user",   "content": content},
            ],
            temperature=0.1,
            max_tokens=400,
        )
        raw = resp.choices[0].message.content.strip()
        # Strip markdown fences if present
        raw = re.sub(r"^```json|^```|```$", "", raw, flags=re.MULTILINE).strip()
        data = json.loads(raw)
        if data.get("is_deal"):
            data["source_url"] = url
            return data
    except Exception as e:
        print(f"  ⚠ Groq error for '{title[:50]}': {e}")
    return None

def stage_label(stage):
    mapping = {
        "rumored":    "rumored",
        "announced":  "announced",
        "under_loi":  "loi",
        "diligence":  "diligence",
        "signed":     "signed",
        "closed":     "closed",
    }
    return mapping.get(stage, "rumored")

def run():
    print("🔍 Deal Extractor starting...")

    # Pull articles from last 48 hours
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

        # Quick pre-filter — skip obviously non-deal articles
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
        if not deal:
            continue

        extracted += 1
        print(f"  ✓ Deal found: {deal['company']} — {deal['deal_type']} ({deal['stage']})")

        # Upsert into deal_flow table (dedupe on company + deal_type)
        row = {
            "company":    deal["company"],
            "acquirer":   deal.get("acquirer"),
            "deal_type":  deal["deal_type"],
            "stage":      stage_label(deal["stage"]),
            "valuation":  deal.get("valuation"),
            "sector":     deal.get("sector") or article.get("sector"),
            "thesis":     deal.get("thesis"),
            "source_url": deal.get("source_url") or url,
            "auto_extracted": True,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }

        try:
            # Check if this deal already exists
            existing = supabase.table("deal_flow")\
                .select("id, stage")\
                .eq("company", row["company"])\
                .eq("deal_type", row["deal_type"])\
                .execute()

            if existing.data:
                # Update stage and thesis if deal already tracked
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

if __name__ == "__main__":
    run()
