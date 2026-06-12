/**
 * Renders the per-user watchlist bullet section at the top of the brief.
 *
 * Presentational only: it takes the section payload from /api/watchlist-brief
 * and renders the three states (populated / quiet / empty). Shared by the
 * morning-brief and evening-wrap pages so the copy and styling stay in one
 * place. The page owns the fetch and fails soft (renders nothing) on error.
 */

import Link from "next/link";
import type {
  WatchlistBriefSection as SectionData,
  WatchlistBullet,
} from "@/lib/watchlist-brief";

interface Props {
  section: SectionData | null;
  briefType: "morning" | "evening";
}

const GOLD_DARK = "var(--gold-dark)";

export default function WatchlistBriefSection({ section, briefType }: Props) {
  // Fail-soft: nothing to show until the fetch resolves.
  if (!section) return null;

  const eyebrow = (
    <p
      className="font-sans"
      style={{
        fontSize: 10,
        letterSpacing: "0.22em",
        textTransform: "uppercase",
        color: GOLD_DARK,
        fontWeight: 800,
        margin: "0 0 12px",
      }}
    >
      Your Watchlist
    </p>
  );

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
              padding: "8px 0",
              borderBottom: "1px solid var(--gold-border)",
            }}
          >
            <span
              className="font-data"
              style={{
                flex: "0 0 auto",
                fontSize: 12,
                fontWeight: 800,
                color: GOLD_DARK,
                minWidth: 52,
                letterSpacing: "0.02em",
              }}
            >
              {b.ticker}
            </span>
            <span style={{ minWidth: 0 }}>
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
          </li>
        ))}
      </ul>
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
