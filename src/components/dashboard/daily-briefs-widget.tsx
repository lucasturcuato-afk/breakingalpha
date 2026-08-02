"use client";

import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";
import Link from "next/link";
import { createBrowserClient } from "@supabase/ssr";

/**
 * Daily Briefs tile — the latest REAL morning brief and evening wrap from the
 * briefings table (headline + summary snippet + generated time). Previously
 * this widget shipped hardcoded placeholder "signals"; those are gone. When a
 * brief type has no row yet, the tab says so honestly.
 */

interface BriefRow {
  briefing_type: string;
  headline: string | null;
  summary: string | null;
  created_at: string;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const hrs = Math.floor(diff / 3600000);
  if (hrs < 1) return "just now";
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function DailyBriefsWidget() {
  const [active, setActive] = useState<"morning" | "evening">("morning");
  // undefined = loading, null = none exists, BriefRow = latest real brief
  const [briefs, setBriefs] = useState<Record<string, BriefRow | null> | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = createBrowserClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        );
        const { data } = await supabase
          .from("briefings")
          .select("briefing_type, headline, summary, created_at")
          .neq("headline", "Market Intelligence Unavailable")
          .order("created_at", { ascending: false })
          .limit(12);
        if (cancelled) return;
        const latest: Record<string, BriefRow | null> = { morning: null, evening: null };
        for (const row of (data ?? []) as BriefRow[]) {
          const t = row.briefing_type;
          if ((t === "morning" || t === "evening") && !latest[t]) latest[t] = row;
        }
        setBriefs(latest);
      } catch {
        if (!cancelled) setBriefs({ morning: null, evening: null });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const brief = briefs?.[active] ?? null;

  return (
    <div>
      {/* Toggle buttons */}
      <div className="flex gap-1.5 mb-3">
        <button
          type="button"
          onClick={() => setActive("morning")}
          className={cn(
            "flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg",
            "font-sans text-[11px] font-semibold transition-all duration-[var(--duration-base)]",
            "cursor-pointer",
            active === "morning"
              ? "bg-espresso text-cream"
              : "bg-parchment text-text-muted hover:bg-parchment-mid",
          )}
        >
          ☀️ Morning
        </button>
        <button
          type="button"
          onClick={() => setActive("evening")}
          className={cn(
            "flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg",
            "font-sans text-[11px] font-semibold transition-all duration-[var(--duration-base)]",
            "cursor-pointer",
            active === "evening"
              ? "bg-espresso text-cream"
              : "bg-parchment text-text-muted hover:bg-parchment-mid",
          )}
        >
          🌙 Evening
        </button>
      </div>

      {/* Latest real brief for the active tab */}
      {briefs === undefined ? (
        <div className="space-y-2">
          <div className="h-4 bg-parchment-mid/50 rounded animate-pulse" />
          <div className="h-3 bg-parchment-mid/40 rounded w-4/5 animate-pulse" />
        </div>
      ) : brief ? (
        <div>
          <p className="font-display text-[15px] font-medium text-espresso leading-[1.3] m-0">
            {brief.headline}
          </p>
          {brief.summary && (
            <p className="font-sans text-[11px] text-text-secondary leading-[1.5] mt-1.5 line-clamp-3 m-0">
              {brief.summary}
            </p>
          )}
          <p className="font-data text-[9.5px] text-text-faint tabular-nums mt-2 m-0">
            generated {timeAgo(brief.created_at)}
          </p>
        </div>
      ) : (
        <p className="font-sans text-[11px] text-text-muted italic py-2">
          No {active === "morning" ? "morning brief" : "evening wrap"} published yet.
        </p>
      )}

      {/* Link */}
      <Link
        href={active === "morning" ? "/morning-brief" : "/evening-wrap"}
        className="block mt-3 font-sans text-[10px] font-semibold text-gold hover:text-gold-dark transition-colors"
      >
        Read full {active === "morning" ? "brief" : "wrap"} →
      </Link>
    </div>
  );
}
