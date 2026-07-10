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

from outputs import record_output
from output_constants import DEAL_PROMPT_VERSION
# Reused (not modified) for the strongest-anchor dedup magnitude check. This is
# a valuation parser, not lead_preselect's A2 predicate — strength stays
# decoupled from the lead-eligibility logic.
from lead_preselect import parse_valuation_to_usd_b
try:
    from usage_log import log_gemini_usage
except Exception:  # pragma: no cover - usage logging must never break import
    try:
        from backend.usage_log import log_gemini_usage
    except Exception:
        def log_gemini_usage(*a, **k):
            return

supabase = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_ANON_KEY"])
gemini_client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
from models import GEMINI_MODEL

SYSTEM_PROMPT = """You are a senior investment banking analyst
extracting deal intelligence from financial news articles.

A qualifying deal MUST be a specific, named financial transaction
that has been announced, rumored, or closed. It qualifies under EITHER
of two paths:

PATH 1 — M&A / INVESTMENT: a named target company AND a named acquirer
or lead investor (acquisition, merger, buyout, PE/VC investment, stake
purchase, debt financing with a named lender). A named counterparty is
REQUIRED on this path. Do NOT relax it.

PATH 2 — PRIMARY-MARKET OFFERING: a named company conducting a
primary-market capital event — an IPO, direct listing, or primary
capital raise — where securities are actually being offered, are
pricing, have priced, or have begun trading. This path does NOT require
an acquirer or lead investor (an IPO or direct listing has no
counterparty). It qualifies ONLY when there is a REAL offering or raise
(priced / pricing / launched / began trading / raising a stated amount),
NOT a bare valuation or stock-price headline. Map it to deal_type "IPO".
Set stage = "closed" if shares have priced or begun trading, else
"announced". The deal amount is the gross proceeds / offering size /
amount raised.

HARD DISQUALIFIERS — return {"is_deal": false} immediately if:
- The article is about a bare company valuation, market cap, or
  stock price with NO transaction and NO offering (e.g. "Anthropic
  valued at $X", "Nvidia market cap tops $X"). NOTE: an IPO, direct
  listing, or capital raise that is pricing / priced / launched or
  raising a stated amount is a PATH 2 deal and DOES qualify — it is
  not a bare valuation.
- The article is about earnings, revenue, profit, or guidance
- The article mentions a company "in talks" with no named
  counterparty (this does NOT block a PATH 2 offering that has priced
  or is raising a stated amount)
- The article is about a fund's general portfolio or strategy,
  not a specific investment
- The only dollar figure is a bare company valuation or market cap with
  no transaction and no offering (an IPO / offering's proceeds or amount
  raised IS a deal size and qualifies under PATH 2)

DEAL VALUE vs VALUATION — critical distinction:
- Deal value: the amount paid in an M&A deal, invested in a round, or
  RAISED / offered in a primary-market offering (IPO proceeds, offering
  size, amount raised). This is a deal size and QUALIFIES.
- Valuation: what the company is worth (market cap, post-money val,
  enterprise value) stated on its own with no transaction and no offering.
- If only a bare valuation / market cap / stock price is mentioned and
  there is NO transaction and NO offering, is_deal = false.
- An IPO or offering that states proceeds / offering size / amount raised
  IS a deal size and qualifies — extract that figure as "valuation".
- Only populate "valuation" if a specific deal / raise / offering amount
  is stated.

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

LANGUAGE CONSTRAINT — NO EMPTY-CALORIE PHRASES (applies to thesis field):

The following constructions are banned in the thesis field:
- 'signals [vague trend]', 'underscores [vague importance]', 'highlights [vague trend]', 'reflects [vague continuation]', 'demonstrates [vague positive]', 'indicates [vague positive]'
- '[X]'s strong/continued appetite for [Y]' without a named deal or data point
- Abstract sector-trend language when specifics are in source material
- Impact filler ('significant', 'substantial', 'major') without a specific number

REQUIRED: the thesis must either name a specific strategic rationale (comparable transaction, concrete financial metric, named peer company) OR be a single bare-fact sentence. A shorter thesis with one real fact beats a longer thesis with wire-copy padding.

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
        log_gemini_usage("deal_extractor", GEMINI_MODEL, response)
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


# Stage confirmation rank for strongest-anchor dedup. Higher = more confirmed.
# Operates on the STORED stage vocabulary emitted by stage_label() above
# (closed/signed/loi/diligence/announced/rumored). Closed and signed are the
# top, confirmed tier; #359 maps a priced/trading IPO to "closed".
_STAGE_RANK = {
    "closed": 4, "signed": 4,
    "loi": 3, "diligence": 3,
    "announced": 2,
    "rumored": 1,
}


def _stage_rank(stage):
    return _STAGE_RANK.get((stage or "").lower(), 0)


def deal_strength(stage, valuation):
    """Total-order completeness/confirmation key for a deal_flow representation.

    Higher tuple = a more complete and more confirmed anchor. Ordering:
      1. a parseable valuation present beats null/unparseable,
      2. then stage confirmation rank (closed/signed > announced > rumored > unknown),
      3. then larger USD-normalized magnitude.
    Compared with strict ">" by the caller, so an exact tie keeps the existing
    row (no churn). This ranks COMPLETENESS only; it deliberately does NOT
    replicate lead_preselect/A2's lead-eligibility predicate.
    """
    mag = parse_valuation_to_usd_b(valuation)
    has_val = 1 if mag is not None else 0
    return (has_val, _stage_rank(stage), mag if mag is not None else 0.0)


def dedup_update_fields(row, existing_stage, existing_valuation):
    """Decide what to write when a matching (company, deal_type) article lands.

    Recency and strength are SEPARATE concerns:
      - `updated_at` (last-seen / recency) ALWAYS advances, so every qualifying
        mention keeps the row inside lead_preselect's updated_at window.
      - the strength-bearing anchor fields (source_url, stage, valuation, thesis,
        sentiment) move ONLY when the new article is strictly stronger
        (deal_strength), so the anchor never downgrades and a null-valuation
        sibling cannot clobber a priced one.
    Pure and DB-free so the decision is unit-testable. Returns
    (fields_to_update, is_stronger). `created_at` is never touched here.
    """
    fields = {"updated_at": row["updated_at"]}
    is_stronger = (
        deal_strength(row["stage"], row["valuation"])
        > deal_strength(existing_stage, existing_valuation)
    )
    if is_stronger:
        fields.update({
            "stage":      row["stage"],
            "thesis":     row["thesis"],
            "valuation":  row["valuation"],
            "sentiment":  row["sentiment"],
            "source_url": row["source_url"],
        })
    return fields, is_stronger


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
                .select("id, stage, valuation, source_url")\
                .eq("company", row["company"])\
                .eq("deal_type", row["deal_type"])\
                .execute()

            if existing.data:
                deal_id = existing.data[0]["id"]
                # Strongest-anchor dedup with decoupled recency: every matching
                # article advances updated_at (last-seen), but the anchor fields
                # (source_url, stage, valuation, thesis, sentiment) move only to a
                # STRICTLY stronger article, so the row keeps its most complete +
                # confirmed anchor and a null-valuation sibling cannot clobber a
                # priced one. One UPDATE per matching article (same write volume
                # as the original pre-strength behavior), just conditional content.
                update_fields, is_stronger = dedup_update_fields(
                    row,
                    existing.data[0].get("stage"),
                    existing.data[0].get("valuation"),
                )
                supabase.table("deal_flow").update(update_fields)\
                    .eq("id", deal_id).execute()
                if is_stronger:
                    print(f"    → Updated existing deal (stronger anchor) (id: {deal_id})")
                else:
                    print(f"    → Refreshed recency, kept anchor (id: {deal_id})")
            else:
                row["created_at"] = datetime.now(timezone.utc).isoformat()
                ins_resp = supabase.table("deal_flow").insert(row).execute()
                deal_id = None
                try:
                    if ins_resp.data and isinstance(ins_resp.data[0], dict):
                        deal_id = ins_resp.data[0].get("id")
                except Exception:
                    pass
                print(f"    → Inserted new deal")
                upserted += 1

            # Record to universal outputs table
            try:
                record_output(
                    supabase,
                    output_type='deal_extraction',
                    content={
                        'deal_id': str(deal_id) if deal_id else None,
                        'company': deal.get('company'),
                        'acquirer': deal.get('acquirer'),
                        'deal_type': deal.get('deal_type'),
                        'valuation': deal.get('valuation'),
                        'sector': deal.get('sector') or article.get('sector'),
                    },
                    generation_context={
                        'model': GEMINI_MODEL,
                        'prompt_version': DEAL_PROMPT_VERSION,
                        'source_article_id': article.get('id'),
                    },
                    source_table='deal_flow',
                    source_id=deal_id,
                )
            except Exception as rec_err:
                print(f"    ⚠ record_output(deal_extraction) failed: {rec_err}")

        except Exception as e:
            print(f"  ⚠ Supabase error: {e}")

    print(f"\n✅ Done — {extracted} deals extracted, {upserted} new deals added to pipeline")
    return {"extracted": extracted, "upserted": upserted}


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
