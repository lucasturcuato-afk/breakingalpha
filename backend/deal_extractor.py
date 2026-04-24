"""
deal_extractor.py
Runs after ingest — scans recent articles with Gemini AI,
extracts deals, and upserts them into the deal_flow Supabase table.
"""

import os, json, re
from datetime import datetime, timezone, timedelta
from supabase import create_client
from google import genai
from google.genai import types

supabase = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_ANON_KEY"])
gemini_client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
GEMINI_MODEL = "gemini-2.0-flash"

SYSTEM_PROMPT = """You are a senior investment banking analyst
extracting deal intelligence from financial news articles.

A qualifying deal MUST be a specific, named financial transaction
that has been announced, rumored, or closed. It must have a named
target company AND a named acquirer or lead investor.

HARD DISQUALIFIERS — return {"is_deal": false} immediately if:
- The article is about a company valuation, market cap, or
  stock price (e.g. "Anthropic valued at $X" with no transaction)
- The article is about earnings, revenue, profit, or guidance
- The article mentions a company "in talks" with no named
  counterparty
- The article is about a fund's general portfolio or strategy,
  not a specific investment
- The only dollar figure is a company valuation, not deal size

DEAL VALUE vs VALUATION — critical distinction:
- Deal value: the amount being paid or raised in this transaction
- Valuation: what the company is worth (market cap, post-money val)
- If only a valuation is mentioned with no transaction, is_deal = false
- Only populate "valuation" field if a specific deal amount is stated

DEAL VALUE EXTRACTION — read the BODY, not just the title or summary:
Dollar figures for a transaction typically appear in the opening body
paragraphs ("SpaceX is in talks to acquire Cursor for around $60 billion"),
not in the headline. Scan the full article text for phrases like
"$X billion", "$XB", "A$X billion", "€X million", "£X million", a "round
worth $X", "values the company at $X in the deal". If a figure is stated
anywhere in the body, extract it and normalize as:
 - USD billions → "$XB"   (e.g. "$60 billion"        → "$60B")
 - USD millions → "$XM"   (e.g. "$500 million round" → "$500M")
 - AUD         → "A$XB"  (e.g. "A$25 billion"        → "A$25B")
 - EUR         → "€XB" / "€XM"
 - GBP         → "£XB" / "£XM"
Preserve the non-USD currency — NEVER convert to USD. Only leave
"valuation" as null when NO transaction figure appears anywhere in the
article body.

If a qualifying deal is present, respond ONLY with valid JSON:
{
  "is_deal": true,
  "company": "Target company name",
  "acquirer": "Named acquirer or lead investor (null if genuinely
               unknown — not 'undisclosed investors')",
  "deal_type": "One of: M&A | LBO | IPO | VC Round | PE Investment
                | Asset Sale | SPAC | Recap | Minority Stake
                | Restructuring | Debt Financing",
  "stage": "One of: rumored | announced | under_loi | closed",
  "valuation": "Deal amount from the body, normalized per DEAL VALUE
                EXTRACTION above. null only if no figure in body.",
  "sentiment": "One of: BULLISH | BEARISH | NEUTRAL | MIXED — the market
                read for this deal. BULLISH for a strategic acquirer in
                a clear consolidation thesis or a hot VC round. BEARISH
                for a target in a forced/distressed/regulator-driven
                sale or a deal that signals a sector top. MIXED for
                material regulatory/antitrust risk or buyer-discipline
                concerns. NEUTRAL only when genuinely ambiguous. Do NOT
                default to NEUTRAL.",
  "sector": "One of: Technology | Venture Capital | Private Equity
             | Public Markets | Fintech | Healthcare | Energy
             | Consumer & Retail | Real Estate | Geopolitics",
  "thesis": "One sentence: why this deal matters from an IB/PE/VC
             perspective. Name the strategic rationale, not just
             what happened.",
  "source_url": null
}

If no qualifying deal: {"is_deal": false}
No text outside the JSON. No markdown."""


def gemini_extract(system_prompt, user_content):
    try:
        response = gemini_client.models.generate_content(
            model=GEMINI_MODEL,
            contents=user_content,
            config=types.GenerateContentConfig(
                system_instruction=system_prompt,
                temperature=0.1,
                max_output_tokens=500,
                thinking_config=types.ThinkingConfig(thinking_budget=0),
                response_mime_type="application/json",
            ),
        )
        return (response.text or "").strip()
    except Exception as e:
        print(f"  ⚠ Gemini error: {e}")
        return None


def extract_deal(title, summary, body, url):
    # Include the scraped body when available — dollar figures for the
    # transaction usually live in the opening paragraphs, not the headline.
    # Capped at 2500 chars to stay under a token budget while still capturing
    # the "for $X billion" clause in the lead paragraphs.
    body_block = ""
    if body and len(body.strip()) > 80:
        body_block = f"\nBody: {body.strip()[:2500]}"
    content = f"Title: {title}\nSummary: {summary or ''}{body_block}"
    try:
        raw = gemini_extract(SYSTEM_PROMPT, content)
        if not raw:
            return None
        raw = re.sub(r"^```json|^```|```$", "", raw, flags=re.MULTILINE).strip()
        data = json.loads(raw)
        if data.get("is_deal"):
            data["source_url"] = url
            return data
        return None
    except Exception as e:
        print(f"  ⚠ Error for '{title[:50]}': {e}")
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
        .select("id, title, summary, content, url, sector")\
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
        body    = article.get("content", "")
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

        deal = extract_deal(title, summary, body, url)

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
            "sentiment":      deal.get("sentiment"),
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
                    "sentiment":  row["sentiment"],
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


def cleanup_bad_deals():
    """
    One-time cleanup: remove deals that were extracted with bad
    data quality (deal_type=Other with no valuation and no
    acquirer, or auto_extracted=True deals where both valuation
    and acquirer are null).
    Run once manually after deploying the Gemini migration.
    """
    print("🧹 Cleaning up low-quality auto-extracted deals...")
    try:
        # Delete deals with type Other AND no acquirer AND no valuation
        supabase.table("deal_flow")\
            .delete()\
            .eq("auto_extracted", True)\
            .eq("deal_type", "Other")\
            .is_("acquirer", "null")\
            .is_("valuation", "null")\
            .execute()
        print(f"  ✓ Removed Other/empty deals")

        # Delete auto-extracted deals with no acquirer AND no valuation
        # (regardless of type — these are the lowest quality extractions)
        supabase.table("deal_flow")\
            .delete()\
            .eq("auto_extracted", True)\
            .is_("acquirer", "null")\
            .is_("valuation", "null")\
            .execute()
        print(f"  ✓ Removed no-acquirer/no-valuation deals")
        print("✅ Cleanup complete")
    except Exception as e:
        print(f"  ✗ Cleanup error: {e}")


if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1 and sys.argv[1] == "cleanup":
        cleanup_bad_deals()
    else:
        run()
