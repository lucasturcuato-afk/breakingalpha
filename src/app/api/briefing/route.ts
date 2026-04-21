import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/* ── User profile types for personalization ── */
interface UserProfile {
  first_name?: string | null;
  role?: string | null;
  firm_or_school?: string | null;
  sectors?: string[] | null;
  risk_appetite?: string | null;
  watchlist_tickers?: string[] | null;
  onboarding_completed?: boolean | null;
  strategy_type?: string | null;
  investment_horizon?: string | null;
  workflow_style?: string | null;
}

// Maps preference panel module names → briefing section keys.
const MODULE_TO_SECTION: Record<string, string> = {
  "Macro & Rates": "macro_and_rates",
  "Deals & M&A": "deals_and_ma",
  "Public Markets": "public_markets",
  "Sector Signals": "sector_spotlight",
};

const PINNED_LAST = ["what_to_watch", "tomorrow_setup"];

const PREF_ALIASES: Record<string, string[]> = {
  "technology m&a": ["tech m&a", "tech"],
  "venture capital": ["vc"],
  "private equity": ["pe", "buyout", "lbo"],
  geopolitics: ["geopolit"],
  healthcare: ["biotech", "pharma", "life science"],
  energy: ["oil", "renewable", "clean energy"],
  consumer: ["retail"],
};

function sectorMatchesPreference(breakdownSector: string, prefSector: string) {
  const bs = breakdownSector.toLowerCase();
  const ps = prefSector.toLowerCase();
  if (bs.includes(ps) || ps.includes(bs)) return true;
  const aliases = PREF_ALIASES[ps] ?? [];
  return aliases.some((alias) => bs.includes(alias));
}

function shapeSections(
  sections: Record<string, unknown>,
  modulePrefs: string[]
) {
  const canonicalOrder = Object.keys(MODULE_TO_SECTION);
  const sorted = [...modulePrefs].sort(
    (a, b) => canonicalOrder.indexOf(a) - canonicalOrder.indexOf(b)
  );
  const preferredKeys = sorted
    .map((m) => MODULE_TO_SECTION[m])
    .filter((k) => k && k in sections);
  const pinnedKeys = PINNED_LAST.filter((k) => k in sections);
  const remainingKeys = Object.keys(sections).filter(
    (k) => !preferredKeys.includes(k) && !pinnedKeys.includes(k)
  );
  const result: Record<string, unknown> = {};
  for (const key of [...preferredKeys, ...remainingKeys, ...pinnedKeys]) {
    result[key] = sections[key];
  }
  return result;
}

function shapeSectorBreakdown(
  breakdown: Record<string, unknown>,
  sectorPrefs: string[]
) {
  const allKeys = Object.keys(breakdown);
  const preferredKeys = allKeys.filter((k) =>
    sectorPrefs.some((pref) => sectorMatchesPreference(k, pref))
  );
  const remainingKeys = allKeys.filter((k) => !preferredKeys.includes(k));
  const result: Record<string, unknown> = {};
  for (const key of [...preferredKeys, ...remainingKeys]) {
    result[key] = breakdown[key];
  }
  return result;
}

/* ── Role-differentiated brief/wrap formatting hints ── */
interface BriefPersonalization {
  format_label: string;
  section_order: string[];
  tone: string;
  length_modifier: number; // 1.0 = normal, 0.5 = half, 1.5 = expanded
  lead_with: string;
  end_with: string;
  role_context: string;
  watchlist_tickers: string[];
  risk_appetite: string;
}

function buildBriefPersonalization(
  profile: UserProfile | null,
  type: string,
): BriefPersonalization | null {
  if (!profile?.role) return null;

  const role = profile.role;
  const workflow = (profile as Record<string, unknown>).workflow_style as string | null;
  const horizon = (profile as Record<string, unknown>).investment_horizon as string | null;

  // Base personalization by role + type
  const isMorning = type === "morning";

  let format_label = "Market Brief";
  let section_order: string[] = [];
  let tone = "professional";
  let length_modifier = 1.0;
  let lead_with = "";
  let end_with = "";
  let role_context = "";

  switch (role) {
    case "student_analyst":
      format_label = isMorning ? "3 Things That Moved Markets" : "What Happened Today";
      tone = "explanatory, curious, never condescending";
      role_context = "Educational format — explain mechanisms, not just events";
      lead_with = isMorning ? "what_happened" : "day_recap";
      end_with = isMorning ? "what_to_watch" : "tomorrow_watch";
      section_order = isMorning
        ? ["what_happened", "why_it_matters", "what_to_watch"]
        : ["day_recap", "mechanism", "tomorrow_watch"];
      break;

    case "buy_side":
      if (workflow === "screening") {
        format_label = isMorning ? "5 Bullets" : "Day's Scorecard";
        tone = "maximum signal density, no explanation";
        length_modifier = 0.5;
        lead_with = isMorning ? "sector_signals" : "winners_losers";
        end_with = isMorning ? "key_events" : "positioning";
        section_order = isMorning
          ? ["sector_signals", "key_events"]
          : ["winners_losers", "positioning"];
      } else {
        format_label = isMorning ? "3 Actionable Signals" : "Thesis Updates";
        tone = "direct, assumes fluency";
        lead_with = isMorning ? "actionable_signals" : "thesis_updates";
        end_with = isMorning ? "entry_triggers" : "tomorrow_events";
        section_order = isMorning
          ? ["actionable_signals", "catalysts", "entry_triggers"]
          : ["thesis_updates", "new_signals", "tomorrow_events"];
      }
      break;

    case "sell_side":
      format_label = isMorning ? "Client Morning Note" : "After-Hours Note";
      tone = "professional, distributable";
      lead_with = isMorning ? "market_summary" : "ratings_changes";
      end_with = isMorning ? "key_events_today" : "catalyst_calendar";
      section_order = isMorning
        ? ["market_summary", "top_stories", "key_events_today"]
        : ["ratings_changes", "day_recap", "catalyst_calendar"];
      break;

    case "private_equity":
      format_label = isMorning ? "Deal Flow Morning Brief" : "Transaction Activity";
      tone = "IC memo style, deal-focused";
      lead_with = isMorning ? "overnight_ma" : "deals_announced";
      end_with = isMorning ? "regulatory_news" : "sector_valuations";
      section_order = isMorning
        ? ["overnight_ma", "macro_deal_pricing", "regulatory_news"]
        : ["deals_announced", "credit_markets", "sector_valuations"];
      break;

    default: // ria, family_office, other
      format_label = isMorning ? "Portfolio Morning Brief" : "End of Day Summary";
      tone = "balanced, client-aware";
      lead_with = isMorning ? "market_moves" : "portfolio_moves";
      end_with = isMorning ? "client_talking_points" : "overnight_risks";
      section_order = isMorning
        ? ["market_moves", "risk_framing", "client_talking_points"]
        : ["portfolio_moves", "client_questions", "overnight_risks"];
      break;
  }

  // Workflow modifier
  if (workflow === "screening") length_modifier = Math.min(length_modifier, 0.5);
  if (workflow === "deep_dive") length_modifier = Math.max(length_modifier, 1.5);

  // Horizon modifier
  if (horizon === "short") role_context += " Prioritize events in the next 7 days.";
  if (horizon === "medium") role_context += " Prioritize events in the next 30 days.";
  if (horizon === "long") role_context += " Include structural/thematic context, de-emphasize daily noise.";

  // Risk appetite context
  const riskAppetite = profile.risk_appetite;
  if (riskAppetite === "defensive") {
    role_context += " Emphasize downside risks and hedging opportunities.";
  } else if (riskAppetite === "aggressive") {
    role_context += " Emphasize upside catalysts and contrarian opportunities.";
  }

  // Watchlist awareness
  const watchlist = profile.watchlist_tickers ?? [];
  if (watchlist.length > 0) {
    role_context += ` Highlight any mentions of watchlist tickers: ${watchlist.join(", ")}.`;
  }

  return {
    format_label,
    section_order,
    tone,
    length_modifier,
    lead_with,
    end_with,
    role_context: role_context.trim(),
    watchlist_tickers: watchlist,
    risk_appetite: riskAppetite ?? "balanced",
  };
}

function safeParseJSON(val: unknown) {
  if (!val) return null;
  if (typeof val === "object") return val;
  try {
    return JSON.parse(val as string);
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const type = request.nextUrl.searchParams.get("type") || "morning";
  if (!["morning", "evening"].includes(type)) {
    return NextResponse.json(
      { error: "type must be morning or evening" },
      { status: 400 }
    );
  }

  let userPreferences: { sectors?: string[]; modules?: string[] } | null = null;
  let userProfile: UserProfile | null = null;
  const token = request.headers
    .get("authorization")
    ?.replace("Bearer ", "");

  if (token) {
    try {
      const authedClient = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { global: { headers: { Authorization: `Bearer ${token}` } } }
      );
      const {
        data: { user },
      } = await authedClient.auth.getUser();
      if (user) {
        const { data: profileData, error: profileError } = await authedClient
          .from("user_profiles")
          .select("first_name, role, firm_or_school, sectors, risk_appetite, watchlist_tickers, onboarding_completed, strategy_type, investment_horizon, workflow_style")
          .eq("id", user.id)
          .single();

        if (profileError && profileError.code !== "PGRST116") {
          console.warn("Profile query error:", profileError.message);
        }
        if (profileData) {
          userProfile = profileData as UserProfile;
          // Derive preferences from user_profiles (single source of truth)
          userPreferences = {
            sectors: userProfile.sectors ?? [],
            modules: userProfile.role ? [userProfile.role] : [],
          };
        }
      }
    } catch {
      // Profile load failed — fall through to unmodified briefing
    }
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  // DDL for user_briefings — see Supabase migrations

  // Run queries in parallel — briefing row + latest pipeline_run + user addendum
  const userId = token ? await (async () => {
    try {
      const authedClient = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { global: { headers: { Authorization: `Bearer ${token}` } } }
      );
      const { data: { user } } = await authedClient.auth.getUser();
      return user?.id ?? null;
    } catch { return null; }
  })() : null;

  const [briefingResult, runResult, addendumResult] = await Promise.all([
    supabase
      .from("briefings")
      .select("*")
      .eq("briefing_type", type)
      .neq("headline", "Market Intelligence Unavailable")
      .order("created_at", { ascending: false })
      .limit(1),
    supabase
      .from("pipeline_runs")
      .select("id, status, started_at, completed_at, duration_s, error_notes, headline_snap")
      .eq("brief_type", type)
      .order("started_at", { ascending: false })
      .limit(1),
    // Best-effort: fetch per-user addendum from user_briefings (written by user_synthesis.py)
    userId
      ? supabase
          .from("user_briefings")
          .select("addendum, generated_at")
          .eq("user_id", userId)
          .eq("briefing_type", type)
          .order("generated_at", { ascending: false })
          .limit(1)
      : Promise.resolve({ data: null, error: null }),
  ]);

  const { data: bData, error } = briefingResult;
  // Per-user addendum from user_synthesis.py (best-effort, never blocks)
  const userAddendum: string | null = (() => {
    try {
      const row = addendumResult?.data?.[0];
      if (row && typeof (row as Record<string, unknown>).addendum === "string") {
        return (row as Record<string, unknown>).addendum as string;
      }
    } catch {
      // user_briefings table may not exist yet — soft-fail
    }
    return null;
  })();
  if (addendumResult?.error) {
    console.log("[briefing] user_briefings lookup failed (continuing):", addendumResult.error.message);
  }

  // pipeline_runs is not in the generated Supabase Database type; cast explicitly.
  const lastRun = (runResult.data?.[0] ?? null) as {
    id: string; status: string; started_at: string;
    completed_at: string | null; duration_s: number | null;
    error_notes: string | null; headline_snap: string | null;
  } | null;

  if (error || !bData?.[0]) {
    const emptyResp = NextResponse.json({
      briefing: null,
      pref_applied: false,
      last_attempt_status: lastRun?.status ?? null,
      last_attempt_started_at: lastRun?.started_at ?? null,
    });
    emptyResp.headers.set("Cache-Control", "no-store, no-cache");
    return emptyResp;
  }

  const raw = bData[0];

  // Freshness metadata — how old is this briefing row?
  const briefingCreatedAt = raw.created_at ? new Date(raw.created_at) : null;
  const ageMs = briefingCreatedAt ? Date.now() - briefingCreatedAt.getTime() : null;
  const briefingAgeHours = ageMs !== null ? Math.round(ageMs / 1000 / 60 / 60 * 10) / 10 : null;
  // Stale = brief is >20 hours old (likely from a prior pipeline run day)
  const isStale = briefingAgeHours !== null && briefingAgeHours > 20;

  // Operator console log — visible in Vercel function logs
  console.log(
    `[briefing/${type}] serving id=${raw.id ?? "?"} created_at=${raw.created_at} ` +
    `age=${briefingAgeHours}h is_stale=${isStale} ` +
    `last_run_status=${lastRun?.status ?? "unknown"} last_run_started=${lastRun?.started_at ?? "unknown"}`
  );
  const hasModulePrefs = (userPreferences?.modules?.length ?? 0) > 0;
  const hasSectorPrefs = (userPreferences?.sectors?.length ?? 0) > 0;

  const sections = (safeParseJSON(raw.sections) || {}) as Record<string, unknown>;
  const sectorBreak = (safeParseJSON(raw.sector_breakdown) || {}) as Record<string, unknown>;

  if (!hasModulePrefs && !hasSectorPrefs) {
    const resp = NextResponse.json({
      briefing: raw,
      pref_applied: false,
      personalization: buildBriefPersonalization(userProfile, type),
      user_addendum: userAddendum,
      briefing_age_hours: briefingAgeHours,
      is_stale: isStale,
      last_attempt_status: lastRun?.status ?? null,
      last_attempt_started_at: lastRun?.started_at ?? null,
      last_successful_created_at: raw.created_at ?? null,
      _debug: {
        sector_breakdown_keys: Object.keys(sectorBreak),
        sectors_matched: [],
      },
    });
    resp.headers.set("Cache-Control", "no-store, no-cache");
    return resp;
  }

  const shapedSections = hasModulePrefs
    ? shapeSections(sections, userPreferences!.modules!)
    : sections;

  const shapedSectorBreak = hasSectorPrefs
    ? shapeSectorBreakdown(sectorBreak, userPreferences!.sectors!)
    : sectorBreak;

  const sectorsMatched = hasSectorPrefs
    ? Object.keys(sectorBreak).filter((k) =>
        userPreferences!.sectors!.some((pref) =>
          sectorMatchesPreference(k, pref)
        )
      )
    : [];

  const briefing = {
    ...raw,
    sections: shapedSections,
    sector_breakdown: shapedSectorBreak,
  };

  const resp = NextResponse.json({
    briefing,
    pref_applied: true,
    personalization: buildBriefPersonalization(userProfile, type),
    user_addendum: userAddendum,
    profile_role: userProfile?.role ?? null,
    profile_risk_appetite: userProfile?.risk_appetite ?? null,
    briefing_age_hours: briefingAgeHours,
    is_stale: isStale,
    last_attempt_status: lastRun?.status ?? null,
    last_attempt_started_at: lastRun?.started_at ?? null,
    last_successful_created_at: raw.created_at ?? null,
    modules_used: hasModulePrefs ? userPreferences!.modules : [],
    sectors_used: hasSectorPrefs ? userPreferences!.sectors : [],
    _debug: {
      sector_breakdown_keys: Object.keys(shapedSectorBreak),
      sectors_matched: sectorsMatched,
    },
  });
  resp.headers.set("Cache-Control", "no-store, no-cache");
  return resp;
}
