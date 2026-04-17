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
          .select("first_name, role, firm_or_school, sectors, risk_appetite, watchlist_tickers, onboarding_completed")
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

  // Run both queries in parallel — briefing row + latest pipeline_run for this type
  const [briefingResult, runResult] = await Promise.all([
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
  ]);

  const { data: bData, error } = briefingResult;
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
