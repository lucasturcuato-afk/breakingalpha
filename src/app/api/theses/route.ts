import { NextResponse } from "next/server";
import Groq from "groq-sdk";
import { getSupabaseWithUser } from "@/lib/supabase-server";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

interface RawThesis {
  title: string;
  conviction: string;
  rationale: string;
  sector: string;
  catalyst: string;
  catalyst_note?: string;
  evidence_chain?: unknown;
  supporting_article_ids?: string[];
}

function validateThesis(t: unknown): t is RawThesis {
  if (!t || typeof t !== "object") return false;
  const obj = t as Record<string, unknown>;
  return (
    typeof obj.title === "string" && obj.title.length > 0 &&
    typeof obj.conviction === "string" && obj.conviction.length > 0 &&
    typeof obj.sector === "string" && obj.sector.length > 0
  );
}

export async function POST() {
  const { supabase, user } = await getSupabaseWithUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const { data: articles, error: articlesError } = await supabase
      .from("articles")
      .select(
        "id, title, summary, sector, sentiment, companies, deal_type, source"
      )
      .order("ingested_at", { ascending: false })
      .limit(30);

    if (articlesError) throw articlesError;
    if (!articles || articles.length === 0) {
      return NextResponse.json({ theses: [] });
    }

    const articleContext = articles
      .map(
        (a, i) =>
          `ARTICLE ${i + 1}\n  id: "${a.id}"\n  sector: ${a.sector || "General"}\n  title: "${a.title}"\n  source: ${a.source || "?"}\n  summary: ${a.summary ? a.summary.slice(0, 180) : "N/A"}\n`
      )
      .join("\n");

    const exampleId1 = articles[0]?.id || "example-uuid";
    const exampleId2 = articles[1]?.id || "example-uuid-2";

    const prompt = `You are a senior investment banking analyst at a top-tier firm. Analyze these articles and generate 3-5 high-conviction investment theses.

Be selective. Only surface theses where there is strong signal across multiple articles. Quality over quantity — 3 excellent theses beat 5 mediocre ones.

ARTICLES:
${articleContext}

IMPORTANT: Each article above has an "id" field (a UUID string like "${exampleId1}"). You MUST copy these exact id strings into supporting_article_ids for each thesis. Do NOT make up IDs — use only the exact id values from the articles above.

Respond ONLY with a JSON array. No markdown, no code fences, no explanation.

EXAMPLE (showing correct format — note the real article IDs):
[
  {
    "title": "AI Chip Demand Drives Semiconductor M&A Wave",
    "conviction": "BULLISH",
    "rationale": "Multiple semiconductor deals signal accelerating consolidation...",
    "sector": "Technology M&A",
    "catalyst": "Q2 earnings reports from NVDA and AMD in late July",
    "catalyst_note": "Upcoming earnings will reveal AI chip demand trajectory. Strong guidance would validate the consolidation thesis and potentially trigger further M&A.",
    "supporting_article_ids": ["${exampleId1}", "${exampleId2}"],
    "evidence_chain": [
      {"label": "Deal catalyst", "type": "support", "bridge": "Article describes $5B acquisition driven by AI demand."},
      {"label": "Market context", "type": "context", "bridge": "Semiconductor index up 12% YTD on AI tailwinds."}
    ]
  }
]

RULES:
- Generate exactly 3-5 theses. No more than 5.
- supporting_article_ids: MUST contain 2-3 exact UUID strings copied from the article id fields above. This is critical.
- evidence_chain: 2-3 items per thesis, cite exact names/figures from articles.
- conviction: BULLISH/BEARISH only when multiple articles converge on a clear signal. Use WATCH when ambiguous.
- Do NOT generate generic sector overviews. Each thesis must have a specific, testable claim.`;

    const completion = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 4000,
      temperature: 0.3,
    });

    const raw = completion.choices[0]?.message?.content || "[]";

    let theses: RawThesis[] = [];
    try {
      const cleaned = raw.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(cleaned);
      if (!Array.isArray(parsed)) {
        return NextResponse.json(
          { error: "AI response was not an array" },
          { status: 500 }
        );
      }
      theses = parsed.filter(validateThesis).slice(0, 5);
      console.log("[Theses API] supporting_article_ids from Groq:", theses.map(t => ({ title: t.title.slice(0, 40), ids: t.supporting_article_ids })));
    } catch {
      console.error("Failed to parse Groq response:", raw);
      return NextResponse.json(
        { error: "Failed to parse thesis response" },
        { status: 500 }
      );
    }

    if (theses.length === 0) {
      return NextResponse.json(
        { error: "Groq returned no valid theses — retry" },
        { status: 500 }
      );
    }

    // Dedup: delete any AI-generated theses from today before inserting
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    await supabase
      .from("theses")
      .delete()
      .eq("source", "ai-generated")
      .gte("generated_at", todayStart.toISOString());

    // Validate supporting_article_ids against actual article IDs
    const validIds = new Set(articles.map((a) => a.id));

    const rows = theses.map(
      (t) => ({
        title: t.title,
        conviction: t.conviction,
        rationale: t.rationale,
        sector: t.sector,
        catalyst: t.catalyst,
        catalyst_note: t.catalyst_note || null,
        evidence_chain: t.evidence_chain || null,
        supporting_articles: Array.isArray(t.supporting_article_ids)
          ? t.supporting_article_ids.filter((id) => validIds.has(id))
          : null,
        status: "new-signal",
        generated_at: new Date().toISOString(),
        source: "ai-generated",
      })
    );

    const { error: insertError } = await supabase.from("theses").insert(rows);
    if (insertError) {
      console.error("Supabase insert error:", insertError);
      return NextResponse.json(
        { error: "Failed to save theses", detail: insertError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ theses, count: theses.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Theses API error:", message);
    return NextResponse.json(
      { error: "Failed to generate theses", detail: message },
      { status: 500 }
    );
  }
}
