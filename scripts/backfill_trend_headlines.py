"""
One-time script to backfill headline and tagline for existing trend_clusters.
Run with: python scripts/backfill_trend_headlines.py
"""

import os
import json
import time
from pathlib import Path
from dotenv import load_dotenv

# Load env vars from .env.local
load_dotenv(Path(__file__).resolve().parent.parent / ".env.local")

from google import genai
from google.genai.types import GenerateContentConfig, ThinkingConfig
from supabase import create_client

SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")
GEMINI_KEY = os.environ.get("GEMINI_API_KEY")

client = genai.Client(api_key=GEMINI_KEY)
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
MODEL = "gemini-2.5-flash"


def safe_list(raw):
    if isinstance(raw, list):
        return raw
    if isinstance(raw, str):
        try:
            p = json.loads(raw)
            return p if isinstance(p, list) else []
        except Exception:
            return []
    return []


def generate_headline(cluster: dict) -> tuple:
    themes = safe_list(cluster.get("top_themes", []))
    companies = safe_list(cluster.get("top_companies", []))
    sectors = safe_list(cluster.get("top_sectors", []))
    label = cluster.get("label", "")
    article_count = cluster.get("article_count", 0)
    source_count = cluster.get("source_count", 0)

    prompt = (
        "Generate a professional financial signal headline and tagline for this "
        "market trend cluster.\n\n"
        f"Cluster label: {label}\n"
        f"Themes: {', '.join(themes[:5]) if themes else 'N/A'}\n"
        f"Companies: {', '.join(companies[:5]) if companies else 'N/A'}\n"
        f"Sectors: {', '.join(sectors[:3]) if sectors else 'N/A'}\n"
        f"Evidence: {article_count} articles from {source_count} sources\n\n"
        "Rules:\n"
        "- Headline: 5-8 words. Bloomberg terminal style. Focus on the market "
        "action, not who's involved (unless the company IS the story).\n"
        "- Tagline: One sentence, 15-25 words. Names key companies and the "
        "\"so what\" — why this signal matters.\n"
        "- Professional tone. No hype, no clickbait, no questions.\n\n"
        'Respond in EXACTLY this JSON format, nothing else:\n'
        '{"headline": "Your headline here", "tagline": "Your tagline here"}'
    )

    try:
        response = client.models.generate_content(
            model=MODEL,
            contents=prompt,
            config=GenerateContentConfig(
                temperature=0.3,
                max_output_tokens=200,
                thinking_config=ThinkingConfig(thinking_budget=0),
                response_mime_type="application/json",
            ),
        )
        text = (response.text or "").strip()
        if text.startswith("```"):
            text = text.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
        parsed = json.loads(text)
        return parsed.get("headline", label), parsed.get("tagline", "")
    except Exception as e:
        print(f"  FAILED: {e}")
        return label, ""


def main():
    result = (
        supabase.table("trend_clusters")
        .select("id, label, top_themes, top_companies, top_sectors, article_count, source_count")
        .is_("headline", "null")
        .order("created_at", desc=True)
        .limit(300)
        .execute()
    )

    clusters = result.data or []
    print(f"Found {len(clusters)} clusters without headlines")

    for i, cluster in enumerate(clusters):
        print(f"[{i + 1}/{len(clusters)}] {cluster['label'][:60]}...", end=" ")
        headline, tagline = generate_headline(cluster)

        supabase.table("trend_clusters").update({
            "headline": headline,
            "tagline": tagline,
        }).eq("id", cluster["id"]).execute()

        print(f"-> {headline}")
        time.sleep(0.5)

    print(f"\nDone. Backfilled {len(clusters)} clusters.")


if __name__ == "__main__":
    main()
