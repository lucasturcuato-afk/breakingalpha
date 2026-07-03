"use client";

/**
 * Renders the per-user watchlist bullet section at the top of the brief.
 *
 * Presentational + light interaction. It takes the section payload from
 * /api/watchlist-brief and renders the three states (populated / quiet /
 * empty). Shared by the morning-brief and evening-wrap pages so copy and
 * styling stay in one place. The page owns the fetch and fails soft (renders
 * nothing) on error.
 *
 * Interactions (all fail-soft; a broken link/trigger never breaks the section):
 *  - headline links out to the article source in a new tab (articles.url),
 *    mirroring the dc-story-row pattern;
 *  - a "Generate Memo" button opens the EXISTING on-demand memo flow
 *    (MemoModal) for that bullet's ticker. No generation happens at brief
 *    render time, so the brief stays $0; the cost lives in the existing
 *    on-click memo path;
 *  - the ticker links to the watchlist detail page (/watchlist/[identifier]).
 */

import { useState } from "react";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import { MemoModal } from "@/components/memo/MemoModal";
import { withCompanyLine } from "@/lib/memo-company-line";
import type {
  WatchlistBriefSection as SectionData,
  WatchlistBullet,
} from "@/lib/watchlist-brief";

/**
 * Fetch lifecycle status, distinct from the section's data state:
 *  - loading: fetch in flight (render nothing, no flash above the lead)
 *  - loaded : fetch resolved (render per section.state; null section = signed out)
 *  - error  : fetch failed after a bounded retry (render a quiet fallback, NOT
 *             the empty-watchlist nudge, so a failure is no longer silent and
 *             indistinguishable from "no watchlist news")
 */
export type WatchlistFetchStatus = "loading" | "loaded" | "error";

interface Props {
  section: SectionData | null;
  status?: WatchlistFetchStatus;
  briefType: "morning" | "evening";
}

const GOLD_DARK = "var(--gold-dark)";

/**
 * Relative article age within the 72h window. Same Date.now() computation as the
 * page-level timeAgo helpers, but renders "yesterday" / a short date for older
 * items so a day-old story is not mistaken for today's news in a brief dated
 * today. Empty string on a missing/unparseable date (caller renders nothing).
 */
function relativeTime(iso: string | null): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const mins = Math.floor((Date.now() - t) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (new Date(iso).toDateString() === yesterday.toDateString()) return "yesterday";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function WatchlistBriefSection({
  section,
  status = "loaded",
  briefType,
}: Props) {
  // The bullet whose memo modal is open (null = closed). One modal at a time.
  const [memoBullet, setMemoBullet] = useState<WatchlistBullet | null>(null);

  const eyebrow = (
    <p
      className="font-sans"
      style={{
        fontSize: 10,
        color: "var(--text-muted)",
        fontWeight: 800,
        margin: "0 0 12px",
      }}
    >
      Your Watchlist
    </p>
  );

  // Loading: render nothing (avoids a skeleton flash above the lead).
  if (status === "loading") return null;

  // Error: a quiet, distinct fallback. Never the onboarding nudge, never blank.
  if (status === "error") {
    return (
      <section style={wrapStyle} aria-label="Your watchlist">
        {eyebrow}
        <p className="font-sans" style={{ ...bodyStyle, color: "var(--text-secondary)" }}>
          Your watchlist couldn&rsquo;t load right now. Refresh to try again.
        </p>
      </section>
    );
  }

  // Loaded but no section (e.g. signed out): show nothing, not an error.
  if (!section) return null;

  if (section.state === "empty") {
    return (
      <section style={wrapStyle} aria-label="Your watchlist">
        {eyebrow}
        <p className="font-sans" style={bodyStyle}>
          Add companies to your{" "}
          <Link
            href="/settings/profile"
            style={{ color: GOLD_DARK, textDecoration: "underline", fontWeight: 600 }}
          >
            watchlist
          </Link>{" "}
          to see what&rsquo;s moving on your names at the top of every brief.
        </p>
      </section>
    );
  }

  if (section.state === "quiet") {
    return (
      <section style={wrapStyle} aria-label="Your watchlist">
        {eyebrow}
        <p className="font-sans" style={bodyStyle}>
          {briefType === "evening"
            ? "Quiet session for your watchlist."
            : "Quiet morning for your watchlist."}
        </p>
      </section>
    );
  }

  return (
    <section style={wrapStyle} aria-label="Your watchlist">
      {eyebrow}
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {section.bullets.map((b: WatchlistBullet) => (
          <li
            key={b.articleId}
            style={{
              display: "flex",
              gap: 12,
              alignItems: "baseline",
              padding: "10px 0",
              borderBottom: "1px solid var(--gold-border)",
            }}
          >
            {/* Ticker -> watchlist detail page */}
            <Link
              href={`/watchlist/${encodeURIComponent(b.ticker)}`}
              className="font-display"
              style={{
                flex: "0 0 auto",
                fontSize: 12,
                fontWeight: 800,
                color: GOLD_DARK,
                minWidth: 52,
                letterSpacing: "0.02em",
                textDecoration: "none",
              }}
            >
              {b.ticker}
            </Link>

            <span style={{ minWidth: 0, flex: 1 }}>
              {/* Headline -> article source (new tab), or plain text if no url */}
              {b.url ? (
                <a
                  href={b.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-sans"
                  style={{
                    fontSize: 13.5,
                    lineHeight: 1.4,
                    color: "var(--text-primary)",
                    fontWeight: 600,
                    textDecoration: "none",
                  }}
                >
                  {b.headline}
                </a>
              ) : (
                <span
                  className="font-sans"
                  style={{
                    fontSize: 13.5,
                    lineHeight: 1.4,
                    color: "var(--text-primary)",
                    fontWeight: 600,
                  }}
                >
                  {b.headline}
                </span>
              )}
              {/* Subtle article age so a day-old story is not read as today's. */}
              {relativeTime(b.publishedAt) ? (
                <span
                  className="font-data"
                  style={{
                    display: "block",
                    fontSize: 10.5,
                    lineHeight: 1.4,
                    color: "var(--text-faint)",
                    marginTop: 2,
                    letterSpacing: "0.02em",
                  }}
                >
                  {relativeTime(b.publishedAt)}
                </span>
              ) : null}
              {b.whyTag ? (
                <span
                  className="font-sans"
                  style={{
                    display: "block",
                    fontSize: 12,
                    lineHeight: 1.45,
                    color: "var(--text-secondary)",
                    marginTop: 2,
                  }}
                >
                  {b.whyTag}
                </span>
              ) : null}
            </span>

            {/* Generate Memo -> existing on-demand memo flow for this ticker */}
            <button
              type="button"
              onClick={() => setMemoBullet(b)}
              aria-label={`Generate memo for ${b.ticker}`}
              style={{
                flex: "0 0 auto",
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                padding: "5px 10px",
                borderRadius: 8,
                background: "transparent",
                color: GOLD_DARK,
                border: "1px solid var(--gold-border)",
                fontFamily: "var(--font-inter), Inter, sans-serif",
                fontSize: 11,
                fontWeight: 700,
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              <Sparkles size={11} />
              Memo
            </button>
          </li>
        ))}
      </ul>

      {/* Single memo modal, driven by the selected bullet. Reuses the existing
          on-demand generation flow; nothing generates at brief render time. */}
      {memoBullet ? (
        <MemoModal
          isOpen={true}
          onClose={() => setMemoBullet(null)}
          title={memoBullet.headline}
          content={withCompanyLine(
            [memoBullet.headline, memoBullet.whyTag].filter(Boolean).join("\n\n"),
            memoBullet.ticker,
          )}
          type="article"
        />
      ) : null}
    </section>
  );
}

const wrapStyle: React.CSSProperties = {
  marginBottom: 28,
  padding: "16px 18px",
  borderRadius: 14,
  border: "1px solid var(--gold-border)",
  background: "var(--gold-muted)",
};

const bodyStyle: React.CSSProperties = {
  fontSize: 13,
  lineHeight: 1.6,
  color: "var(--text-primary)",
  margin: 0,
};
