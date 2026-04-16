import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { getSupabaseWithUser } from "@/lib/supabase-server";
import { createClient } from "@supabase/supabase-js";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

/* ── User profile helpers for personalization ── */
interface UserProfile {
  full_name?: string | null;
  role?: string | null;
  firm_or_school?: string | null;
  sectors?: string[] | null;
  risk_appetite?: string | null;
  watchlist_tickers?: string[] | null;
  onboarding_completed?: boolean | null;
}

const roleLabels: Record<string, string> = {
  student_analyst: "a student analyst building investment knowledge",
  buy_side: "a buy-side analyst at an investment fund",
  sell_side: "a sell-side analyst covering equities",
  private_equity: "a private equity professional evaluating deals",
  ria: "a registered investment advisor managing client portfolios",
  family_office: "a family office investment professional",
  other: "a finance professional",
};

async function fetchUserProfile(userId: string): Promise<UserProfile | null> {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
    const { data, error } = await supabase
      .from("user_profiles")
      .select("full_name, role, firm_or_school, sectors, risk_appetite, watchlist_tickers, onboarding_completed")
      .eq("id", userId)
      .single();
    if (error || !data) return null;
    return data as UserProfile;
  } catch (err) {
    console.warn("Failed to fetch user profile for memo personalization:", err);
    return null;
  }
}

function buildMemoUserContext(profile: UserProfile): string {
  const role = profile.role ?? "";
  const roleLabel = roleLabels[role] ?? "a finance professional";

  let ctx = `\nUSER CONTEXT FOR MEMO:\nThis memo is for ${roleLabel}.\n`;

  if (role === "private_equity" || role === "buy_side") {
    ctx += "Include deal structure analysis, entry multiple context, and return profile framing.\n";
  }
  if (role === "student_analyst") {
    ctx += 'Include a "Why this matters" section explaining the signal in educational context.\n';
  }
  if (profile.risk_appetite === "aggressive") {
    ctx += "Emphasize upside scenarios and catalysts.\n";
  }
  if (profile.risk_appetite === "defensive") {
    ctx += "Emphasize downside risks and mitigation factors prominently.\n";
  }

  return ctx;
}

async function buildMemoContext(sector: string | undefined): Promise<string> {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );

    // 1. Recent resolved theses
    let thesesQuery = supabase
      .from("theses")
      .select("sector, outcome, horizon, generated_at")
      .in("outcome", ["confirmed", "invalidated"])
      .order("generated_at", { ascending: false })
      .limit(5);
    if (sector) thesesQuery = thesesQuery.eq("sector", sector);
    const { data: theses } = await thesesQuery;

    // 2. Top 3 sources by win_rate
    const { data: sources } = await supabase
      .from("source_credibility")
      .select("source, win_rate")
      .order("win_rate", { ascending: false })
      .limit(3);

    // 3. Top patterns for sector
    let patternQuery = supabase
      .from("pattern_library")
      .select("sector, horizon, win_rate")
      .order("win_rate", { ascending: false })
      .limit(3);
    if (sector) patternQuery = patternQuery.eq("sector", sector);
    const { data: patterns } = await patternQuery;

    const lines: string[] = [];

    if (theses && theses.length > 0) {
      const confirmed = theses.filter((t) => t.outcome === "confirmed").length;
      const total = theses.length;
      const pct = Math.round((confirmed / total) * 100);
      const horizon = theses[0].horizon || "medium-term";
      lines.push(
        `- In ${sector || "this sector"}, recent theses have confirmed at ${pct}% over ${horizon} horizons (n=${total}).`,
      );
    }

    if (sources && sources.length > 0) {
      for (const s of sources) {
        lines.push(`- Source "${s.source}" has ${Math.round(s.win_rate * 100)}% win rate.`);
      }
    }

    if (patterns && patterns.length > 0) {
      for (const p of patterns) {
        lines.push(
          `- Pattern in ${p.sector} (${p.horizon}): ${Math.round(p.win_rate * 100)}% confirmation rate.`,
        );
      }
    }

    if (lines.length === 0) return "";
    return "HISTORICAL CONTEXT:\n" + lines.join("\n");
  } catch {
    return "";
  }
}

const TYPE_PROMPTS: Record<string, string> = {
  deal: `You are a senior M&A analyst. Write a sharp deal memo with exactly these 4 sections in this order:

**Deal Snapshot**
Bullet list of facts from the input only: Target, Acquirer, Type, Value, Status, Sector. Use "Undisclosed" for missing facts. No commentary here.

**Why It Makes Sense**
Infer the likely strategic logic from the deal type, sector, size, and any NOTES/CONTEXT in the input. Use grounded cautious language — "appears aimed at…", "likely reflects…", "suggests a push into…". This section must always be substantive and specific to THIS deal. Banned phrases: "wave of consolidation", "consolidation trend", "broader consolidation", "part of a trend", "fits a broader pattern", "reflects broader", "amid a wave", "signals a trend". If you cannot be specific, describe what the acquirer likely gains from this specific target.

**Why It Matters**
State the investor, operator, or market implication in 2–3 concrete sentences tied to the specific companies and sector. Do not write generic macro commentary. Do not repeat Snapshot facts unless they directly drive the implication.

**What To Watch**
List 2–3 grounded watchpoints specific to THIS deal: regulatory approvals for this sector, financing risk based on the disclosed value, integration complexity between these two entities, or execution timeline for this transaction type. Never write generic watchpoints that could apply to any M&A deal.

Hard rules: no invented counterparties, dollar figures, or valuation assumptions beyond what is provided. No recommendation section. No standalone valuation section. No empty sections. Every sentence must reference something specific from the input. Under 320 words.`,
  thesis: "You are a buy-side equity research analyst. Write an investment thesis memo using ONLY the facts provided. Do NOT invent price targets, ratings, or figures not present in the input. Sections: Core Thesis, Supporting Evidence, Bear Case, Catalysts to Watch. Under 300 words.",
  brief: "You are a market strategist. Write a market brief: Key Macro Takeaway, Sector Implications, Risk Flags. Under 300 words.",
  article: "You are a financial analyst. Summarize market implications using only what is stated: What Happened, Market Impact, Actionable Insight. Under 250 words.",
  company: "You are a sector analyst. Write a company intelligence brief. Use only facts from the provided articles. Sections: Company Brief (sector and primary business), Recent Developments (Direct articles only), Sector Context (Context articles as backdrop), Key Watchpoints (2–3 from Direct articles only), Signal Quality (one controlled label + one sentence). Under 300 words.",
};

export async function POST(request: NextRequest) {
  const { user } = await getSupabaseWithUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  // Fetch user profile for personalization (soft-fail)
  const profile = await fetchUserProfile(user.id);
  const memoUserContext = profile ? buildMemoUserContext(profile) : "";

  let body: {
    company?: string;
    acquirer?: string;
    deal_type?: string;
    value?: string;
    sector?: string;
    description?: string;
    type?: string;
    systemPrompt?: string;
    content?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const {
    company,
    acquirer,
    deal_type,
    value,
    sector,
    description,
    type,
    systemPrompt,
    content,
  } = body;

  // New path: type-based memo with content string
  if (content || systemPrompt) {
    const system = systemPrompt || (type ? TYPE_PROMPTS[type] : undefined) || TYPE_PROMPTS.article;
    const truncated = String(content || "").slice(0, 4000);

    const memoCtx = await buildMemoContext(sector || undefined);
    const augmentedSystem = (memoUserContext ? memoUserContext + "\n\n" : "")
      + (memoCtx ? memoCtx + "\n\n" : "")
      + system;

    try {
      const completion = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [{ role: "user", parts: [{ text: truncated }] }],
        config: {
          systemInstruction: augmentedSystem,
          temperature: 0.35,
          maxOutputTokens: 750,
          thinkingConfig: { thinkingBudget: 0 },
        },
      });

      const memo = completion.text;
      if (!memo) {
        return NextResponse.json({ error: "Gemini returned empty memo — retry" }, { status: 500 });
      }
      return NextResponse.json({ memo });
    } catch (err) {
      console.error("Gemini memo error:", err);
      return NextResponse.json(
        { error: "Failed to generate memo" },
        { status: 500 }
      );
    }
  }

  // Legacy path: deal-flow deal memo (company required)
  if (!company)
    return NextResponse.json(
      { error: "company or content is required" },
      { status: 400 }
    );

  const prompt = `${memoUserContext ? memoUserContext + "\n" : ""}You are a senior IB analyst. Write a concise deal memo for this transaction. Be specific, use bullet points.

TARGET: ${company}
ACQUIRER: ${acquirer || "Undisclosed"}
TYPE: ${deal_type || "M&A"}
VALUE: ${value || "Undisclosed"}
SECTOR: ${sector || "Technology"}
CONTEXT: ${(description || "").slice(0, 400)}

Sections: TRANSACTION OVERVIEW, STRATEGIC RATIONALE, KEY RISKS, ANALYST TAKE. Under 300 words.`;

  try {
    const completion = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        temperature: 0.35,
        maxOutputTokens: 600,
        thinkingConfig: { thinkingBudget: 0 },
      },
    });

    const memo = completion.text;
    if (!memo) {
      return NextResponse.json({ error: "Gemini returned empty memo — retry" }, { status: 500 });
    }
    return NextResponse.json({ memo });
  } catch (err) {
    console.error("Gemini memo error:", err);
    return NextResponse.json(
      { error: "Failed to generate memo" },
      { status: 500 }
    );
  }
}
