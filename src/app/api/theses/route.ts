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
          `${i + 1}. [ID:${a.id}] [${a.sector || "General"}] "${a.title}" (${a.source || "?"})${a.summary ? " — " + a.summary.slice(0, 180) : ""}`
      )
      .join("\n");

    const prompt = `You are a senior investment banking analyst at a top-tier firm. Analyze these articles and generate 3-5 high-conviction investment theses.

Be selective. Only surface theses where there is strong signal across multiple articles. Do not generate a thesis for every sector. Quality over quantity — 3 excellent theses beat 5 mediocre ones.

ARTICLES:
${articleContext}

Respond ONLY with a JSON array, no markdown:
[
  {
    "title": "Specific thesis naming a company, deal, or trend (5-8 words)",
    "conviction": "BULLISH" or "BEARISH" or "WATCH",
    "rationale": "3-4 sentence analytical rationale (60-100 words). Must cite specific companies, figures, and deal values from the articles. Structure: key data point → why it matters → sector implications → forward outlook matching conviction level.",
    "sector": "One of: Technology M&A, Private Equity, Venture Capital, Public Markets, Geopolitics & Macro, Fintech & Crypto, Healthcare & Biotech, Energy & Climate",
    "catalyst": "Specific near-term catalyst with timeframe (e.g. 'Q2 earnings report', 'regulatory decision by June')",
    "catalyst_note": "2-3 sentences: what the catalyst is, why it matters structurally, what to watch for.",
    "supporting_article_ids": ["id1", "id2", "id3"],
    "evidence_chain": [
      {"article_index": 0, "label": "2-4 word tag", "type": "support" or "context" or "risk", "bridge": "One sentence connecting article to thesis with specific data."}
    ]
  }
]

RULES:
- Generate exactly 3-5 theses. No more than 5.
- Each thesis must be supported by at least 2 articles. Include the article IDs (from the [ID:xxx] tags) in supporting_article_ids.
- evidence_chain: 2-3 items per thesis, cite exact names/figures from articles.
- conviction must reflect signal strength: BULLISH/BEARISH only when multiple articles converge on a clear directional signal. Use WATCH when signal is emerging but ambiguous.
- Do NOT generate generic sector overviews. Each thesis must have a specific, testable claim.`;

    const completion = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 3000,
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
