import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

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
        const { data: prefs } = await authedClient
          .from("user_preferences")
          .select("sectors, modules")
          .eq("user_id", user.id)
          .single();
        if (prefs) userPreferences = prefs;
      }
    } catch {
      // Preference load failed — fall through to unmodified briefing
    }
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const { data: bData, error } = await supabase
    .from("briefings")
    .select("*")
    .eq("briefing_type", type)
    .neq("headline", "Market Intelligence Unavailable")
    .order("created_at", { ascending: false })
    .limit(1);

  if (error || !bData?.[0]) {
    return NextResponse.json({ briefing: null, pref_applied: false });
  }

  const raw = bData[0];
  const hasModulePrefs = (userPreferences?.modules?.length ?? 0) > 0;
  const hasSectorPrefs = (userPreferences?.sectors?.length ?? 0) > 0;

  const sections = (safeParseJSON(raw.sections) || {}) as Record<string, unknown>;
  const sectorBreak = (safeParseJSON(raw.sector_breakdown) || {}) as Record<string, unknown>;

  if (!hasModulePrefs && !hasSectorPrefs) {
    return NextResponse.json({
      briefing: raw,
      pref_applied: false,
      _debug: {
        sector_breakdown_keys: Object.keys(sectorBreak),
        sectors_matched: [],
      },
    });
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

  return NextResponse.json({
    briefing,
    pref_applied: true,
    modules_used: hasModulePrefs ? userPreferences!.modules : [],
    sectors_used: hasSectorPrefs ? userPreferences!.sectors : [],
    _debug: {
      sector_breakdown_keys: Object.keys(shapedSectorBreak),
      sectors_matched: sectorsMatched,
    },
  });
}
