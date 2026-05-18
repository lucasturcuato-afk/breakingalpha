import { NextRequest, NextResponse, after } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { getSupabaseWithUser } from "@/lib/supabase-server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { checkRateLimit } from "@/lib/rate-limit";
import { isAdmin } from "@/lib/admin-emails";
import { recordOutput } from "@/lib/outputs";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// WD70: BriefTab Regenerate button daily per-user quota.
const MEMO_REGENERATIONS_PER_DAY = 3;

/** Returns the ISO timestamp of the next UTC midnight from now. */
function nextUtcMidnightISO(): string {
  const d = new Date();
  d.setUTCHours(24, 0, 0, 0);
  return d.toISOString();
}

/** Returns the ISO timestamp of the most recent UTC midnight. */
function todayUtcMidnightISO(): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

/**
 * Counts how many regeneration rows the user has logged since the most recent
 * UTC midnight. Uses the user-scoped client so RLS enforces ownership.
 */
async function countRegenerationsToday(
  supabase: SupabaseClient,
  userId: string,
): Promise<number> {
  const { count, error } = await supabase
    .from("user_memo_regeneration_quota")
    .select("user_id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("regenerated_at", todayUtcMidnightISO());
  if (error) {
    console.warn("[memo] regeneration quota count failed:", error.message);
    return 0;
  }
  return count ?? 0;
}

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

  // Risk appetite framing
  const riskAppetite = profile.risk_appetite;
  if (riskAppetite === "defensive") {
    augmented += "\n\nRISK POSTURE: Reader has a defensive risk appetite. Emphasize downside risks, capital preservation, and hedging considerations. Lead bear case analysis.";
  } else if (riskAppetite === "aggressive") {
    augmented += "\n\nRISK POSTURE: Reader has an aggressive risk appetite. Emphasize asymmetric upside, contrarian angles, and catalyst-driven opportunities. Frame risks as manageable where evidence supports it.";
  }

  // Investment horizon context
  const horizon = (profile as Record<string, unknown>).investment_horizon as string | null;
  if (horizon === "short") {
    augmented += "\n\nTIME HORIZON: Reader operates on a short-term horizon (weeks to months). Prioritize near-term catalysts, event-driven angles, and technical setup.";
  } else if (horizon === "long") {
    augmented += "\n\nTIME HORIZON: Reader operates on a long-term horizon (multi-year). Prioritize structural themes, secular trends, and durable competitive advantages over near-term noise.";
  }

  // Watchlist ticker awareness
  const watchlist = profile.watchlist_tickers ?? [];
  if (watchlist.length > 0) {
    augmented += `\n\nWATCHLIST: Reader actively monitors these tickers: ${watchlist.join(", ")}. If the memo subject relates to any of these, call out the connection explicitly.`;
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
  // Fallback prompt for type "company-web". In normal operation the caller
  // (frontend) will pass the full buildWebFallbackMemoSystemPrompt(name) text
  // via systemPrompt; this is the safety net if it forgets.
  "company-web": "You are a senior equity research analyst writing a company intelligence brief grounded in WEB SEARCH RESULTS. Use only facts from the provided results. Every factual sentence must end with a bracketed citation [n] mapping to the result number. Sections: Analyst Brief, What Just Changed (or Coverage Note if no direct developments), Cross-Signals, What To Do With This (two if/then bullets), Signal Quality. Under 300 words. No em-dashes. No bullets outside What To Do With This.",
};

const RATE_LIMIT_MEMO = 10; // memos per 24h

export async function POST(request: NextRequest) {
  const { supabase: userSupabase, user } = await getSupabaseWithUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  // WD70: regenerate flag opts the request into the daily-quota path. The
  // synthesis branch is unchanged; only the gating + cache-invalidation steps
  // run first when this is set.
  const isRegenerate = request.nextUrl.searchParams.get("regenerate") === "true";

  /* ── Rate limit ── */
  // Admins bypass rate limits
  const rl = isAdmin(user.email)
    ? { allowed: true, remaining: Infinity, limit: Infinity, resetAt: 0 }
    : checkRateLimit(user.id, "memo", RATE_LIMIT_MEMO);
  if (!rl.allowed) {
    return NextResponse.json(
      {
        error: `Rate limit exceeded — ${rl.limit} memos per day. Resets ${new Date(rl.resetAt).toLocaleTimeString()}.`,
        remaining: 0,
        resetAt: rl.resetAt,
      },
      { status: 429 },
    );
  }

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

  // Web-fallback memos are gated behind the same feature flag the frontend
  // uses. Reject early if the flag is off so a stray client-side bypass cannot
  // burn Gemini budget on this path. The article-grounded path (type "company")
  // is unaffected.
  if (type === "company-web" && process.env.NEXT_PUBLIC_WEB_FALLBACK_ENABLED !== "true") {
    return NextResponse.json(
      { error: "Web fallback is not enabled" },
      { status: 503 },
    );
  }

  // WD70: BriefTab regenerate flow. We only support the article-grounded
  // company path through this gate (the only caller). The block:
  //   1. enforces a 3-per-UTC-day quota,
  //   2. logs the attempt before invoking Gemini so a click burst cannot bypass,
  //   3. invalidates the prior cached memo so the next mount picks up the new row.
  // The synthesis itself is unchanged below.
  if (isRegenerate) {
    if (type !== "company" || !company) {
      return NextResponse.json(
        { error: "regenerate requires type=company and a company identifier" },
        { status: 400 },
      );
    }
    const used = await countRegenerationsToday(userSupabase, user.id);
    if (used >= MEMO_REGENERATIONS_PER_DAY) {
      return NextResponse.json(
        {
          error: "Daily regeneration limit reached. Resets at midnight UTC.",
          remaining: 0,
          resetsAt: nextUtcMidnightISO(),
        },
        { status: 429 },
      );
    }
    const { error: insertErr } = await userSupabase
      .from("user_memo_regeneration_quota")
      .insert({ user_id: user.id, company_id: company });
    if (insertErr) {
      console.error("[memo] failed to record regeneration quota row:", insertErr.message);
      return NextResponse.json(
        { error: "Failed to record regeneration attempt" },
        { status: 500 },
      );
    }
    // Invalidate the prior cached memo row(s) for this user+company so the
    // next BriefTab mount cannot return stale content while after() is still
    // writing the fresh row.
    try {
      const svcSupabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      );
      await svcSupabase
        .from("output_log_v0_stub")
        .delete()
        .eq("output_type", "memo")
        .eq("source_table", "companies")
        .eq("source_id", company)
        .eq("metadata->>variant", "articles")
        .eq("metadata->>user_id", user.id);
    } catch (e) {
      console.warn("[memo] cache invalidation soft-failed:", e);
    }
  }

  // New path: type-based memo with content string
  if (content || systemPrompt) {
    const system = systemPrompt || (type ? TYPE_PROMPTS[type] : undefined) || TYPE_PROMPTS.article;
    const truncated = String(content || "").slice(0, 4000);

    // Skip the historical-context overlay for the web-fallback path: that
    // overlay is keyed on indexed sectors and theses, neither of which exist
    // for an un-indexed company. Article-grounded memos still get the overlay.
    const memoCtx = type === "company-web" ? "" : await buildMemoContext(sector || undefined);
    const baseSystem = (memoCtx ? memoCtx + "\n\n" : "") + system;
    const augmentedSystem = buildMemoPrompt(profile, baseSystem);

    // Web-fallback memos need a higher output ceiling than article-grounded.
    // The web prompt has 5 sections plus per-claim [n] citations plus two
    // 75-word "What To Do With This" bullets, which routinely lands in the
    // 700 to 950 output-token range. Other types fit comfortably in 2400.
    const maxOutputTokens = type === "company-web" ? 8192 : 2400;
    try {
      const t0 = Date.now();
      const completion = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [{ role: "user", parts: [{ text: truncated }] }],
        config: {
          systemInstruction: augmentedSystem,
          temperature: 0.35,
          maxOutputTokens,
          thinkingConfig: { thinkingBudget: 0 },
        },
      });
      const latencyMs = Date.now() - t0;

      const memo = completion.text;
      if (!memo) {
        return NextResponse.json({ error: "Gemini returned empty memo, retry" }, { status: 500 });
      }

      // Pattern A: fire-and-forget output capture after response is flushed.
      after(async () => {
        try {
          const svcSupabase = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
          );
          await recordOutput(svcSupabase, {
            output_type: "memo",
            source_table: "companies",
            source_id: company ?? "unknown",
            prompt_inputs: {
              type: type ?? null,
              sector: sector ?? null,
              content_chars: truncated.length,
            },
            latency_ms: latencyMs,
            metadata: {
              variant: type === "company-web" ? "web" : "articles",
              model: "gemini-2.5-flash",
              max_output_tokens: maxOutputTokens,
              memo_chars: memo.length,
              markdown_memo: memo,
              user_id: user.id,
            },
          });
        } catch (e) {
          console.error("[memo] recordOutput after() failed:", e);
        }
      });

      // WD70: surface remaining quota when the caller is a regenerate-eligible
      // request so the frontend can render the counter without a second round
      // trip. Only the article-grounded company path is gated, so we mirror
      // that in the payload condition.
      if (type === "company") {
        const used = await countRegenerationsToday(userSupabase, user.id);
        const remaining = Math.max(0, MEMO_REGENERATIONS_PER_DAY - used);
        return NextResponse.json({ memo, regenerations_remaining_today: remaining });
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
    const t0 = Date.now();
    const completion = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        temperature: 0.35,
        maxOutputTokens: 2400,
        thinkingConfig: { thinkingBudget: 0 },
      },
    });
    const latencyMs = Date.now() - t0;

    const memo = completion.text;
    if (!memo) {
      return NextResponse.json({ error: "Gemini returned empty memo — retry" }, { status: 500 });
    }

    // Pattern A: fire-and-forget output capture after response is flushed.
    after(async () => {
      try {
        const svcSupabase = createClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        );
        await recordOutput(svcSupabase, {
          output_type: "memo",
          source_table: "companies",
          source_id: company,
          prompt_inputs: {
            acquirer: acquirer ?? null,
            deal_type: deal_type ?? null,
            value: value ?? null,
            sector: sector ?? null,
          },
          latency_ms: latencyMs,
          metadata: {
            variant: "legacy",
            model: "gemini-2.5-flash",
            max_output_tokens: 2400,
            memo_chars: memo.length,
          },
        });
      } catch (e) {
        console.error("[memo] recordOutput after() failed:", e);
      }
    });

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
