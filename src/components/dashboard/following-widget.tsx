"use client";

import { useEffect, useState } from "react";
import { useDashboardSource } from "@/components/dashboard/dashboard-ready";
import Link from "next/link";
import { ExternalLink } from "lucide-react";

/**
 * FollowingWidget — the user's real Radar follows, from
 * GET /api/radar/following-feed (follows scoped to user_id, each returned
 * with the articles matched against the ingested corpus).
 *
 * One endpoint supplies both halves, so a follow and its latest matching
 * headline can never drift apart. Nothing is fabricated:
 *  - A follow with no recent match says so rather than borrowing another
 *    follow's article.
 *  - Muted follows come back with an empty article list by design and are
 *    listed quietly.
 *  - No follows at all renders an honest empty state pointing at Radar.
 */

const FOLLOWING_HREF = "/radar/following";
const WINDOW_DAYS = 7;

interface FollowMeta {
  id: string;
  follow_type: string;
  target: string;
  display_name: string | null;
  muted: boolean;
}

interface FollowArticle {
  id: string;
  title: string;
  source: string | null;
  url: string | null;
  published_at: string | null;
}

interface Development {
  follow: FollowMeta;
  articles: FollowArticle[];
}

function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const hrs = Math.floor(diff / 3600000);
  if (hrs < 1) return "just now";
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function FollowingWidget() {
  // undefined = loading
  const [data, setData] = useState<{ developments?: Development[]; unavailable?: boolean } | undefined>(
    undefined,
  );

  // Dashboard reveal gate. /api/radar/following-feed was the second-slowest
  // source measured (max 7.9s cold). Settles on first completion either way:
  // the catch below sets data to an empty developments list.
  const settleDashboard = useDashboardSource("following");
  useEffect(() => {
    if (data !== undefined) settleDashboard();
  }, [data, settleDashboard]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/radar/following-feed?days=${WINDOW_DAYS}`);
        if (!res.ok) {
          if (!cancelled) setData({ developments: [] });
          return;
        }
        const json = await res.json();
        if (!cancelled) setData(json);
      } catch {
        if (!cancelled) setData({ developments: [] });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (data === undefined) {
    return (
      <div className="space-y-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-[46px] rounded-lg bg-parchment-mid/40 animate-pulse" />
        ))}
      </div>
    );
  }

  const devs = data.developments ?? [];

  if (devs.length === 0) {
    return (
      <div>
        <p className="font-sans text-[11px] text-text-muted italic leading-snug py-1">
          {data.unavailable
            ? "Following is not available yet."
            : "You are not following anything yet. Follow a desk, sector or topic in Radar to see it here."}
        </p>
        <Link
          href={FOLLOWING_HREF}
          className="block mt-2 font-sans text-[10px] font-semibold text-gold hover:text-gold-dark transition-colors"
        >
          Browse Radar →
        </Link>
      </div>
    );
  }

  // Follows with a fresh match lead; quiet ones still listed, honestly.
  const withNews = devs.filter((d) => d.articles.length > 0);
  const quiet = devs.filter((d) => d.articles.length === 0);

  return (
    <div className="dash-fill-in">
      <div className="space-y-2.5">
        {withNews.slice(0, 4).map((d) => {
          const a = d.articles[0];
          const label = d.follow.display_name ?? d.follow.target;
          return (
            <div key={d.follow.id} className="min-w-0">
              <div className="flex items-baseline gap-2 mb-0.5">
                <span className="font-data text-[9.5px] text-gold-dark uppercase tracking-[0.04em] truncate">
                  {label}
                </span>
                <span className="font-data text-[9px] text-text-faint tabular-nums ml-auto whitespace-nowrap">
                  {d.articles.length} in {WINDOW_DAYS}d
                </span>
              </div>
              {a.url ? (
                <a
                  href={a.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group font-sans text-[11.5px] text-text-primary leading-snug hover:text-gold-dark transition-colors line-clamp-2 block"
                >
                  {a.title}
                  <ExternalLink
                    size={9}
                    className="inline ml-1 opacity-0 group-hover:opacity-60 transition-opacity"
                  />
                </a>
              ) : (
                <p className="font-sans text-[11.5px] text-text-primary leading-snug line-clamp-2 m-0">
                  {a.title}
                </p>
              )}
              <span className="font-data text-[9px] text-text-faint tabular-nums">
                {a.source} · {timeAgo(a.published_at)}
              </span>
            </div>
          );
        })}
      </div>

      {quiet.length > 0 && (
        <p className="font-sans text-[9.5px] text-text-faint italic mt-2.5 pt-2 border-t border-border-subtle">
          Quiet this week: {quiet.map((d) => d.follow.display_name ?? d.follow.target).join(", ")}
        </p>
      )}

      <Link
        href={FOLLOWING_HREF}
        className="block mt-2 font-sans text-[10px] font-semibold text-gold hover:text-gold-dark transition-colors"
      >
        All follows →
      </Link>
    </div>
  );
}
