import { NextResponse } from "next/server";
import Groq from "groq-sdk";
import { createClient } from "@supabase/supabase-js";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function POST() {
  try {
    const { data: articles, error: articlesError } = await supabase
      .from("articles")
      .select(
        "id, title, summary, sector, sentiment, companies, deal_type, source"
      )
      .order("ingested_at", { ascending: false })
      .limit(15);

    if (articlesError) throw articlesError;
    if (!articles || articles.length === 0) {
      return NextResponse.json({ theses: [] });
    }

    const articleContext = articles
      .map(
        (a, i) =>
          `${i + 1}. [${a.sector || "General"}] "${a.title}" (${a.source || "?"})${a.summary ? " — " + a.summary.slice(0, 120) : ""}`
      )
      .join("\n");

    const prompt = `You are a senior IB analyst. Based on these articles, generate exactly 5 investment theses as actionable research.

ARTICLES:
${articleContext}

Respond ONLY with a JSON array, no markdown:
[
  {
    "title": "Thesis title naming a specific company or sector (5-8 words)",
    "conviction": "BULLISH" or "BEARISH" or "WATCH",
    "rationale": "4-6 sentence analytical paragraph (80-120 words). Cite specific companies, figures, deal values from articles. Structure: key data point → why it matters → sector implications → forward outlook matching conviction.",
    "sector": "One of: Technology M&A, Private Equity, Venture Capital, Public Markets, Geopolitics & Macro, Fintech & Crypto, Healthcare & Biotech, Energy & Climate",
    "catalyst": "Specific near-term catalyst with timeframe",
    "catalyst_note": "2-3 sentences: what the catalyst is, why it matters structurally, what to watch.",
    "evidence_chain": [
      {"article_index": 0, "label": "2-4 word tag", "type": "support" or "context" or "risk", "bridge": "One sentence connecting article to thesis with specific data."}
    ]
  }
]

Rules: evidence_chain 2-3 items per thesis, cite exact names/figures from articles, conviction reflects signal strength.`;

    const completion = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 3000,
      temperature: 0.3,
    });

    const raw = completion.choices[0]?.message?.content || "[]";

    let theses = [];
    try {
      const cleaned = raw.replace(/```json|```/g, "").trim();
      theses = JSON.parse(cleaned);
    } catch {
      console.error("Failed to parse Groq response:", raw);
      return NextResponse.json(
        { error: "Failed to parse thesis response" },
        { status: 500 }
      );
    }

    const rows = theses.map(
      (t: {
        title: string;
        conviction: string;
        rationale: string;
        sector: string;
        catalyst: string;
        catalyst_note?: string;
        evidence_chain?: unknown;
      }) => ({
        title: t.title,
        conviction: t.conviction,
        rationale: t.rationale,
        sector: t.sector,
        catalyst: t.catalyst,
        catalyst_note: t.catalyst_note || null,
        evidence_chain: t.evidence_chain || null,
        generated_at: new Date().toISOString(),
        source: "ai-generated",
      })
    );

    const { error: insertError } = await supabase.from("theses").insert(rows);
    if (insertError) {
      console.error("Supabase insert error:", insertError);
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
