"""
BreakingAlpha - AI Synthesis Engine
Generates morning/evening briefings across all sectors.
"""

import os, json, sys
from datetime import datetime, timezone, timedelta
from supabase import create_client
from groq import Groq
from dotenv import load_dotenv

load_dotenv()

supabase = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_ANON_KEY"])
groq_client = Groq(api_key=os.environ["GROQ_API_KEY"])

BRIEFING_PROMPT = """You are a senior analyst at a top-tier investment firm preparing a {type} briefing for sophisticated investors and finance professionals.

Date: {date}
Recent Articles: {articles}
Company Context: {company_context}

Generate a comprehensive {type} market briefing. Cover ALL relevant sectors present in the articles: tech M&A, VC/startup, PE/buyouts, public markets, geopolitics, macro, real estate, fintech, healthcare, energy.

Respond ONLY in valid JSON:
{{
  "headline": "One punchy sentence capturing the single most important market development",
  "executive_summary": "3-4 sentences covering what matters most across all sectors",
  "top_stories": [
    {{
      "title": "Story title",
      "source": "Source",
      "summary": "2-3 sentences with investment implications",
      "sector": "Sector name",
      "companies": ["Company"],
      "signal": "What this means for deal flow, valuations, or positioning"
    }}
  ],
  "sector_breakdown": [
    {{
      "sector": "Sector name",
      "headline": "One line on what happened in this sector today",
      "key_developments": "2-3 sentences",
      "companies": ["Company"],
      "opportunity": "Specific actionable insight"
    }}
  ],
  "thesis": "Write a full one-page investment thesis covering: (1) the dominant macro theme today, (2) specific deals or transactions likely to emerge from today's news, (3) which sectors have the most momentum, (4) key risks to watch, (5) your recommended positioning for the next 30 days. Be specific and write like a top-tier analyst.",
  "tailwinds": [{{"trend": "name", "description": "why this accelerates deal activity"}}],
  "headwinds": [{{"trend": "name", "description": "why this creates friction"}}],
  "watch_list": ["Company or theme to watch 1", "Company or theme 2", "Company or theme 3"]
}}"""


def get_articles(hours=14):
    since = (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()
    r = supabase.table("articles").select("*").gte("ingested_at", since).order("relevance_score", desc=True).limit(30).execute()
    return r.data or []


def get_company_context(companies):
    ctx = {}
    for name in list(set(companies))[:10]:
        r = supabase.table("companies").select("*").eq("name", name).execute()
        if r.data:
            c = r.data[0]
            ctx[name] = {"mentions": c.get("mention_count", 0), "themes": c.get("key_themes", []), "first_seen": c.get("first_seen", "")[:10]}
    return ctx


def store_briefing(btype, data):
    today = datetime.now(timezone.utc).date().isoformat()
    try:
        r = supabase.table("briefings").insert({
            "briefing_type": btype,
            "briefing_date": today,
            "headline": data.get("headline", ""),
            "summary": data.get("executive_summary", ""),
            "top_stories": json.dumps(data.get("top_stories", [])),
            "market_themes": json.dumps(data.get("sector_breakdown", [])),
            "thesis": data.get("thesis", ""),
            "tailwinds": json.dumps(data.get("tailwinds", [])),
            "headwinds": json.dumps(data.get("headwinds", []))
        }).execute()
        return r.data[0]["id"]
    except Exception as e:
        print(f"  Store error: {e}")
        return None


def update_trends(data):
    for item in (data.get("tailwinds", []) + data.get("headwinds", [])):
        name = item.get("trend", "")
        if not name: continue
        try:
            ex = supabase.table("trends").select("*").eq("name", name).execute()
            if ex.data:
                supabase.table("trends").update({"mention_count": ex.data[0]["mention_count"] + 1, "last_seen": datetime.now(timezone.utc).isoformat()}).eq("name", name).execute()
            else:
                cat = "tailwind" if item in data.get("tailwinds", []) else "headwind"
                supabase.table("trends").insert({"name": name, "category": cat, "description": item.get("description", ""), "mention_count": 1}).execute()
        except: pass


def generate_briefing(btype):
    print(f"\n{'='*60}\nBreakingAlpha {btype.title()} Synthesis — {datetime.now().strftime('%Y-%m-%d %H:%M')}\n{'='*60}")
    hours = 14 if btype == "morning" else 12
    articles = get_articles(hours)
    if not articles:
        print("  No articles found")
        return None

    all_companies = [c for a in articles for c in (a.get("companies") or [])]
    company_ctx = get_company_context(all_companies)

    articles_text = json.dumps([{
        "title": a["title"], "source": a["source"], "summary": a["summary"],
        "sector": a.get("sector", ""), "companies": a.get("companies", []),
        "themes": a.get("themes", []), "sentiment": a.get("sentiment"),
        "score": a.get("relevance_score")
    } for a in articles[:25]], indent=2)

    prompt = BRIEFING_PROMPT.format(
        type=btype, date=datetime.now().strftime("%A, %B %d, %Y"),
        articles=articles_text, company_context=json.dumps(company_ctx, indent=2)
    )

    try:
        resp = groq_client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.1
        )
        text = resp.choices[0].message.content.strip()
        if text.startswith("```"):
            text = text.split("```")[1]
            if text.startswith("json"): text = text[4:]
        briefing = json.loads(text.strip())
    except Exception as e:
        print(f"  Synthesis error: {e}")
        return None

    print(f"  Headline: {briefing.get('headline', '')[:80]}")
    bid = store_briefing(btype, briefing)
    update_trends(briefing)
    print(f"✅ {btype.title()} briefing stored (id: {bid})")
    return briefing

if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "morning"
    generate_briefing(mode)
