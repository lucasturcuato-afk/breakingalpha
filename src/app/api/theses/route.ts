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
      theses = parsed.filter(validateThesis);
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

    const rows = theses.map(
      (t) => ({
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
