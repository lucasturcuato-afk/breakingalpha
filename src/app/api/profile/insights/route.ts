import { NextResponse } from "next/server";
import { getSupabaseWithUser } from "@/lib/supabase-server";
import {
  getUserProfile,
  updateInferredWeights,
  type UserEventType,
} from "@/lib/user-profile";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface SectorActivity {
  sector: string;
  positive: number; // viewed / approved / memo / pattern
  negative: number; // dismissed
  net: number;
  weight: number;
}

interface InsightsResponse {
  profile: {
    first_name: string | null;
    role: string | null;
    sectors: string[];
    risk_appetite: string;
    watchlist_tickers: string[];
  };
  weights_updated_at: string | null;
  event_count_30d: number;
  top_boosted: { sector: string; weight: number }[];
  top_muted: { sector: string; weight: number }[];
  sector_activity: SectorActivity[];
  event_type_breakdown: Record<string, number>;
  narrative: string;
}

const POSITIVE: UserEventType[] = [
  "thesis_viewed",
  "thesis_approved",
  "memo_generated",
  "pattern_clicked",
  "watchlist_added",
];
const NEGATIVE: UserEventType[] = ["thesis_dismissed", "watchlist_removed"];

function narrative(
  topBoosted: { sector: string; weight: number }[],
  topMuted: { sector: string; weight: number }[],
  eventCount: number,
  risk: string,
): string {
  if (eventCount === 0) {
    return "Not enough activity yet to show learned preferences. Interact with a few theses and come back.";
  }
  const bits: string[] = [];
  if (topBoosted.length > 0) {
    const names = topBoosted.map((b) => b.sector).join(", ");
    bits.push(`You're leaning into ${names}.`);
  }
  if (topMuted.length > 0) {
    const names = topMuted.map((b) => b.sector).join(", ");
    bits.push(`You've been dismissing ${names}.`);
  }
  bits.push(`Risk posture is set to ${risk}.`);
  return bits.join(" ");
}

export async function GET() {
  try {
    const { supabase, user } = await getSupabaseWithUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const profile = await getUserProfile(supabase, user.id);

    // Refresh weights so the response is always current.
    const { weights, eventCount, updatedAt } = await updateInferredWeights(
      supabase,
      user.id,
    ).catch(() => ({
      weights: profile.inferred_sector_weights,
      eventCount: 0,
      updatedAt: null,
    }));

    // Pull the raw events for sector-level positive/negative breakdown.
    const since = new Date(
      Date.now() - 30 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const { data: events, error: eventsError } = await supabase
      .from("user_events")
      .select("event_type, payload, created_at")
      .eq("user_id", user.id)
      .gte("created_at", since)
      .limit(1000);
    /* THE CALLER CANNOT TELL ZEROS FROM SILENCE, so this route stops sending
       them. `events` used to be read as `events ?? []`, and a fault therefore
       produced an empty `sector_activity` and an empty `event_type_breakdown`
       in a 200: byte for byte what a reader with no activity at all gets.
       BehavioralInsights.tsx already draws its own failure state off a
       non-200, so raising here is what makes that state reachable. */
    if (eventsError) throw eventsError;

    const sectorActivity = new Map<string, SectorActivity>();
    const typeCounts: Record<string, number> = {};

    for (const ev of (events ?? []) as {
      event_type: UserEventType;
      payload: Record<string, unknown> | null;
    }[]) {
      typeCounts[ev.event_type] = (typeCounts[ev.event_type] ?? 0) + 1;

      const sector =
        typeof ev.payload?.sector === "string"
          ? (ev.payload.sector as string).trim()
          : "";
      if (!sector) continue;

      if (!sectorActivity.has(sector)) {
        sectorActivity.set(sector, {
          sector,
          positive: 0,
          negative: 0,
          net: 0,
          weight: weights[sector] ?? 1.0,
        });
      }
      const row = sectorActivity.get(sector)!;
      if (POSITIVE.includes(ev.event_type)) row.positive += 1;
      else if (NEGATIVE.includes(ev.event_type)) row.negative += 1;
      row.net = row.positive - row.negative;
    }

    const sortedWeights = Object.entries(weights).sort((a, b) => b[1] - a[1]);
    const topBoosted = sortedWeights
      .filter(([, w]) => w >= 1.1)
      .slice(0, 3)
      .map(([sector, weight]) => ({ sector, weight }));
    const topMuted = sortedWeights
      .filter(([, w]) => w <= 0.9)
      .slice(-3)
      .map(([sector, weight]) => ({ sector, weight }));

    const body: InsightsResponse = {
      profile: {
        first_name: profile.first_name,
        role: profile.role,
        sectors: profile.sectors,
        risk_appetite: profile.risk_appetite,
        watchlist_tickers: profile.watchlist_tickers,
      },
      /* The refresh above WRITES this column, and `profile` was read before it
       * ran, so the snapshot's copy is always one call stale and always null on
       * a first call. Take the value the refresh reports, and fall back to the
       * snapshot only when the refresh wrote nothing. */
      weights_updated_at: updatedAt ?? profile.inferred_weights_updated_at,
      event_count_30d: eventCount,
      top_boosted: topBoosted,
      top_muted: topMuted,
      sector_activity: Array.from(sectorActivity.values()).sort(
        (a, b) => b.net - a.net,
      ),
      event_type_breakdown: typeCounts,
      narrative: narrative(topBoosted, topMuted, eventCount, profile.risk_appetite),
    };

    return NextResponse.json(body);
  } catch (err) {
    console.error("[profile/insights] read did not answer:", err);
    return NextResponse.json(
      { error: "Could not load insights." },
      { status: 500 },
    );
  }
}
