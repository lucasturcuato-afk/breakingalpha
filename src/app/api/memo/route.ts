import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { getSupabaseWithUser } from "@/lib/supabase-server";
import { createClient } from "@supabase/supabase-js";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

/* ── User profile helpers for personalization ── */
interface UserProfile {
  first_name?: string | null;
  role?: string | null;
  firm_or_school?: string | null;
  sectors?: string[] | null;
  risk_appetite?: string | null;
  strategy_type?: string | null;
  watchlist_tickers?: string[] | null;
  onboarding_completed?: boolean | null;
}

async function fetchUserProfile(userId: string): Promise<UserProfile | null> {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
    const { data, error } = await supabase
      .from("user_profiles")
      .select("first_name, role, firm_or_school, sectors, risk_appetite, strategy_type, watchlist_tickers, onboarding_completed")
      .eq("id", userId)
      .single();
    if (error || !data) return null;
    return data as UserProfile;
  } catch (err) {
    console.warn("Failed to fetch user profile for memo personalization:", err);
    return null;
  }
}

function buildMemoPrompt(profile: UserProfile | null, basePrompt: string): string {
  if (!profile) return basePrompt;

  const role = profile.role ?? "";

  const roleBlocks: Record<string, string> = {
    student_analyst: `MEMO FORMAT FOR THIS READER (student analyst — educational tone):
Structure the memo with these exact sections:
1. **What's Happening** — Plain English, no jargon. Explain the situation as if the reader is smart but unfamiliar with this specific event.
2. **Why It Matters** — Explain the mechanism: how does this event create or destroy value? Connect cause to effect.
3. **The Thesis** — State what to believe and why. Be specific about direction and timeframe.
4. **Bear Case** — What would make this thesis wrong? Name specific risks.
5. **What to Watch** — 3 specific upcoming catalysts with dates if known.
Define any technical terms inline when first used.
Tone: educational, assumes no prior knowledge of this specific situation. Never say "as you know."`,

    buy_side: `MEMO FORMAT FOR THIS READER (buy-side analyst — direct, no hand-holding):
Structure the memo with these exact sections:
1. **The Trade** — Long/short, catalyst, time horizon. One paragraph max.
2. **Thesis in 3 Bullets** — Why now, why this, why us. Each bullet is one sentence.
3. **Bear Case + What Kills It** — Name the specific risk that invalidates the thesis.
4. **Comparable Situations** — 1-2 recent analogues from the same sector or setup type.
5. **Position Sizing Context** — High/medium/low conviction framing.
6. **Key Dates** — Numbered list of upcoming catalysts with dates.
Tone: direct, assumes fluency. No explaining basics.`,

    sell_side: `MEMO FORMAT FOR THIS READER (sell-side analyst — client-facing, distributable):
Structure the memo with these exact sections:
1. **Executive Summary** — 2 sentences, client-ready. Lead with the conclusion.
2. **Rating + Thesis** — Frame as Outperform/Neutral/Underperform with supporting thesis.
3. **Key Catalysts** — Numbered, dated where possible.
4. **Risks** — Bull case / base case / bear case with scenario probabilities if appropriate.
5. **Valuation Context** — Relative and/or absolute valuation framing.
6. **Recommendation** — Use "We recommend..." language. Be explicit about action.
Tone: formal, client-facing, distribution-ready.`,

    private_equity: `MEMO FORMAT FOR THIS READER (private equity — IC memo style):
Structure the memo with these exact sections:
1. **Deal Merit Summary** — Why this asset is interesting. 2-3 sentences max.
2. **Entry Multiple Context** — How the implied valuation compares to comparable transactions.
3. **Value Creation Levers** — Operational, financial, and strategic levers. Be specific.
4. **Exit Scenarios** — 3-5 year horizon with multiple range for each scenario.
5. **Key Risks** — Leverage, sponsor competition, macro exposure. Name specific risks.
6. **IC Recommendation** — Clear go/no-go framing with conditions.
Tone: IC memo style. Dense. No fluff. Every sentence must carry information.`,
  };

  const defaultRoleBlock = `MEMO FORMAT FOR THIS READER (investment advisor — balanced, client-aware):
Structure the memo with these exact sections:
1. **Opportunity Summary** — What is this and why look at it now.
2. **Risk/Return Framing** — Upside vs downside in concrete terms.
3. **Portfolio Fit** — How this relates to the reader's focus sectors and risk posture.
4. **Bear Case** — What goes wrong and how bad.
5. **Action Items** — Specific next steps: monitor, research further, or act.
Tone: balanced, client-aware.`;

  const strategyOverlays: Record<string, string> = {
    pe: "STRATEGY LENS: Apply private equity framing — reference entry multiples, deal structure, and return profiles in every valuation discussion.",
    macro: "STRATEGY LENS: Apply macro regime context — connect every risk and catalyst to the current macro environment (rates, FX, policy).",
    credit: "STRATEGY LENS: Apply credit lens — reference spreads, covenant quality, and default risk in the risk section.",
    vc: "STRATEGY LENS: Apply venture lens — reference TAM sizing, round dynamics, and runway implications in the thesis section.",
    equity: "STRATEGY LENS: Apply public equity lens — reference earnings estimates, consensus expectations, and relative valuation throughout.",
  };

  const roleBlock = roleBlocks[role] ?? defaultRoleBlock;

  let augmented = roleBlock + "\n\n" + basePrompt;

  const strategyType = profile.strategy_type ?? undefined;
  if (strategyType && strategyOverlays[strategyType]) {
    augmented += "\n\n" + strategyOverlays[strategyType];
  }

  return augmented;
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
    const baseSystem = (memoCtx ? memoCtx + "\n\n" : "") + system;
    const augmentedSystem = buildMemoPrompt(profile, baseSystem);

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
      console.error("[memo] Gemini content-path error:", err);
      console.error("[memo] error detail:", err instanceof Error ? err.message : String(err));
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

  const legacyBase = `You are a senior IB analyst. Write a concise deal memo for this transaction. Be specific, use bullet points.

TARGET: ${company}
ACQUIRER: ${acquirer || "Undisclosed"}
TYPE: ${deal_type || "M&A"}
VALUE: ${value || "Undisclosed"}
SECTOR: ${sector || "Technology"}
CONTEXT: ${(description || "").slice(0, 400)}

Sections: TRANSACTION OVERVIEW, STRATEGIC RATIONALE, KEY RISKS, ANALYST TAKE. Under 300 words.`;
  const prompt = buildMemoPrompt(profile, legacyBase);

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
    console.error("[memo] Gemini legacy-path error:", err);
    console.error("[memo] error detail:", err instanceof Error ? err.message : String(err));
    return NextResponse.json(
      { error: "Failed to generate memo" },
      { status: 500 }
    );
  }
}
