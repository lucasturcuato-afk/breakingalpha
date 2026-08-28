import { LEVEL_TONES } from "./trend-level-tone";
import { strengthToLevel, timeAgo, trendTags, trendTitle, type TrendSignal } from "@/lib/trend-signals";
import styles from "./trends.module.css";
import { FONT_DISPLAY, FONT_MONO, FONT_SANS } from "@/components/mobile/fonts";

/**
 * One clustered signal, as the prototype draws it at `:2140-2158`.
 *
 * Not ported from `src/components/trends/signal-card.tsx`. That file is dead
 * code: its only reference anywhere in `src/` is the barrel re-export beside
 * it, and the barrel has no importer either. Its markup is Tailwind palette
 * classes rather than tokens, and its `sparkData` is optional with nothing in
 * the repo populating it.
 *
 * THE SPARKLINE IS NOT BUILT. The design draws a 64x24 polyline on every card
 * with seven hand-authored points, and `trend_clusters` carries no time series
 * in any of its columns. The dead card's `MiniSparkline` draws at exactly
 * 80x24 stroke 1.5, which is the design's viewBox, so the shape was taken from
 * a component nothing has ever fed. Drawing it would mean inventing the
 * series. Its three strokes are also literal light-theme hexes on a card that
 * flips with the theme. Omitted, and the headline takes the width the
 * sparkline would have occupied. Recorded in the PR body as a real parity
 * difference rather than absorbed.
 *
 * NOT INTERACTIVE, deliberately. The card used to be a `<button>` wrapping its
 * whole body with an empty click handler, which put a tab stop on every row of
 * a live production list and announced each row to a screen reader as a button
 * whose accessible name is the entire card. The destination is the Signal
 * detail screen, a separate unit blocked on a route-name ruling and not being
 * built, so there is nothing to go to.
 *
 * PR #649 hit the same wall and took native `disabled`, reasoning that a
 * destination that does not exist should not cost a tab stop. That screen drew
 * eight rows. This one draws every cluster the predicate admits, up to
 * `TREND_LIMIT`, so `disabled` would still leave hundreds of announced controls
 * in the tree with nothing behind any of them. An article carries no control
 * semantics at all, which is the honest shape for a row that is only ever
 * content. When the ruling lands the row becomes a link to a real route. It
 * does not get a click handler bolted on here.
 */
export function TrendSignalCard({
  signal,
  now,
  first = false,
}: {
  signal: TrendSignal;
  now: number;
  first?: boolean;
}) {
  const tone = LEVEL_TONES[strengthToLevel(signal.strength_score)];
  const tags = trendTags(signal);
  const ago = timeAgo(signal.created_at, now);
  const body = signal.tagline ?? "";

  return (
    <article
      style={{
        width: "100%",
        marginTop: first ? 0 : "11px",
        display: "flex",
        flexDirection: "column",
        border: "1px solid var(--c-border)",
        borderRadius: "12px",
        backgroundColor: "var(--c-card)",
        overflow: "hidden",
      }}
    >
      {/* State is a 2px top edge, never a coloured left rule. */}
      <div style={{ width: "100%", height: "2px", backgroundColor: tone.edge }} />

      <div style={{ width: "100%", padding: "14px 15px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "10px",
          }}
        >
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              padding: "3px 8px",
              border: `1px solid ${tone.border}`,
              borderRadius: "6px",
              backgroundColor: tone.fill,
              font: `600 10px/1 ${FONT_SANS}`,
              color: tone.ink,
            }}
          >
            <span
              style={{
                width: "6px",
                height: "6px",
                borderRadius: "50%",
                backgroundColor: tone.dot,
              }}
            />
            {tone.word}
          </span>
          {ago ? (
            <span
              style={{
                font: `400 10px/1 ${FONT_MONO}`,
                letterSpacing: "0.07em",
                color: "var(--c-muted)",
              }}
            >
              {ago}
            </span>
          ) : null}
        </div>

        {tags.length > 0 ? (
          <div style={{ marginTop: "10px", display: "flex", gap: "6px", flexWrap: "wrap" }}>
            {tags.map((tag) => (
              <span
                key={tag}
                style={{
                  display: "inline-flex",
                  padding: "3px 7px",
                  border: "1px solid var(--c-edge)",
                  borderRadius: "6px",
                  backgroundColor: "var(--c-well)",
                  font: `600 10px/1 ${FONT_SANS}`,
                  letterSpacing: "0.02em",
                  color: "var(--c-secondary)",
                }}
              >
                {tag}
              </span>
            ))}
          </div>
        ) : null}

        <h4
          style={{
            margin: "11px 0 0",
            font: `700 15px/1.35 ${FONT_DISPLAY}`,
            color: "var(--c-ink)",
            textWrap: "pretty",
          }}
        >
          {trendTitle(signal)}
        </h4>

        {body ? (
          <p
            className={styles.clamp2}
            style={{
              margin: "8px 0 0",
              font: `400 12px/1.5 ${FONT_SANS}`,
              color: "var(--c-body)",
            }}
          >
            {body}
          </p>
        ) : null}
      </div>
    </article>
  );
}
