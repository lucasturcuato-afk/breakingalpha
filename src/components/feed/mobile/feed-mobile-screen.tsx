"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import styles from "./feed-mobile.module.css";
import { FEED_FIXTURE } from "./fixture";
import type {
  FeedBucket,
  FeedData,
  FeedLens,
  FeedRowBadge,
  FeedStage,
  FeedStory,
} from "./types";

/**
 * Live Feed, mobile.
 *
 * The screen the design draws, composed beside the desk rather than instead of
 * it. `src/app/live-feed/page.tsx` keeps its query, its dedupe, its bucketing
 * and its signed-out gate; this renders what that page already computed, at
 * phone width, and the desktop layout is untouched at every width above md.
 *
 * Every measurement here is read off the rendered prototype with
 * getComputedStyle, through scripts/parity_harness.py. Where the build departs
 * from the drawing the departure is commented at its site and repeated in the
 * PR body.
 *
 * ONE GUTTER. The prototype applies the page gutter on each block that needs
 * it, and applies it exactly once. The harness wraps the whole screen in
 * `#v3phone{padding:0 var(--v3-pad)}`, which the prototype itself does not
 * have, so a build that copies the harness ends up with two. The root below
 * carries no horizontal padding at all; every gutter is on the block that
 * draws it.
 */

const PAD = "var(--v3-pad)";

/**
 * The fixture is a development and preview affordance only, and the gate fails
 * closed: anything that is not a non-production build, or an explicitly
 * flagged Vercel preview, gets the real feed. `/live-feed` is publicly
 * reachable signed out, so an ungated fixture would show invented coverage to
 * anyone on the internet. Both values are inlined at build time.
 */
export const FIXTURE_ALLOWED =
  process.env.NODE_ENV !== "production" ||
  process.env.NEXT_PUBLIC_VERCEL_ENV === "preview";

const LENSES: { id: FeedLens; label: string }[] = [
  { id: "yours", label: "Yours" },
  { id: "all", label: "Everything" },
  { id: "alerts", label: "Alerts" },
  { id: "saved", label: "Saved" },
];

const SENTIMENT_INK: Record<FeedStory["sentiment"], string> = {
  bullish: "var(--c-greenink)",
  bearish: "var(--c-redink)",
  neutral: "var(--c-secondary)",
};

const SENTIMENT_WORD: Record<FeedStory["sentiment"], string> = {
  bullish: "Bullish",
  bearish: "Bearish",
  neutral: "Neutral",
};

const BADGE: Record<
  FeedRowBadge,
  { label: string; ink: string; edge: string; fill: string; icon: boolean }
> = {
  alert: {
    label: "Alert",
    ink: "var(--c-redink)",
    edge: "var(--c-red-edge)",
    fill: "var(--c-red-well)",
    icon: false,
  },
  saved: {
    label: "Saved",
    ink: "var(--c-secondary)",
    edge: "var(--c-border)",
    fill: "var(--c-surface)",
    icon: true,
  },
  unfollowed: {
    label: "Not followed",
    ink: "var(--c-secondary)",
    edge: "var(--c-edge)",
    fill: "var(--c-well)",
    icon: false,
  },
};

const STAGES: FeedStage[] = ["ready", "loading", "error", "empty", "stale"];

/* Module scope so the store identity is stable across renders. */
const subscribeNever = () => () => {};
const readSearch = () => window.location.search;
const readNoSearch = () => "";

const MONO = "'JetBrains Mono', monospace";
const INTER = "Inter, sans-serif";
const PLAYFAIR = "'Playfair Display', serif";

export function FeedMobileScreen({
  data,
  stage = "ready",
  lens,
  onLensChange,
  onRetry,
  onSignIn,
}: {
  data: FeedData;
  stage?: FeedStage;
  lens: FeedLens;
  onLensChange: (next: FeedLens) => void;
  onRetry?: () => void;
  onSignIn?: () => void;
}) {
  const [openSources, setOpenSources] = useState<string | null>(null);

  /* Both dev switches come from the query string, and the query string is a
   * client-only value on a route the server also renders. useSyncExternalStore
   * with a server snapshot is the sanctioned way to read one: React hydrates
   * against the empty snapshot and swaps to the real one, so there is no
   * mismatch and no setState inside an effect. The store never emits, because
   * a full navigation remounts the tree anyway.
   *
   * ?state= exists because the lifecycle states cannot be reached by
   * reproducing their conditions on a live wire, and a state that cannot be
   * opened cannot be audited. Same gate as the fixture, same fail-closed
   * behaviour. */
  const search = useSyncExternalStore(subscribeNever, readSearch, readNoSearch);
  const params = useMemo(() => new URLSearchParams(search), [search]);
  const fixtureOn = FIXTURE_ALLOWED && params.get("fixture") === "1";
  const rawStage = params.get("state");
  const stageOverride: FeedStage | null =
    FIXTURE_ALLOWED && rawStage && STAGES.includes(rawStage as FeedStage)
      ? (rawStage as FeedStage)
      : null;

  const view = fixtureOn ? FEED_FIXTURE : data;
  const counts = view.counts;
  /* The fixture is a complete drawn state, so it carries its own stage. Left
   * on the live one it would render the design's chips above whatever the real
   * wire happened to be doing, which is neither screen. */
  const shown = stageOverride ?? (fixtureOn ? "ready" : stage);

  return (
    <div
      data-parity="feed"
      className={styles.enter}
      style={{
        backgroundColor: "var(--c-bg)",
        /* Not `100%`. The shell wraps the page in a transition div with no
           height of its own, so a percentage resolves against nothing and the
           screen ends where its content does, leaving the desk's parchment
           showing beneath it on any short state. Measured: the error state
           stopped at 540px inside an 844px viewport. The shell's scroller is
           the viewport minus the tab bar and the safe area, which is exactly
           this. dvh, never vh. */
        minHeight:
          "calc(100dvh - var(--mobile-tabbar-height) - env(safe-area-inset-bottom))",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <Header updatedAt={view.updatedAt} stale={shown === "stale"} />

      <div style={{ flex: "none", padding: `14px ${PAD} 0` }}>
        <h1
          style={{
            margin: 0,
            font: `700 24px/1.14 ${PLAYFAIR}`,
            letterSpacing: "-0.02em",
            color: "var(--c-ink)",
          }}
        >
          Live Feed
        </h1>
        <p
          style={{
            margin: "7px 0 0",
            font: `400 12.5px/1.5 ${INTER}`,
            color: "var(--c-secondary)",
          }}
        >
          {view.standfirst}
        </p>
      </div>

      <div
        style={{
          flex: "none",
          display: "flex",
          flexWrap: "wrap",
          gap: "12px",
          padding: `14px ${PAD}`,
        }}
      >
        {LENSES.map((l) => (
          <LensChip
            key={l.id}
            label={l.label}
            /* Everything carries no count in the design, and it is the only
             * one of the four that does not. The other three are counts, not
             * rates. */
            count={
              l.id === "all"
                ? undefined
                : l.id === "yours"
                  ? counts.yours
                  : l.id === "alerts"
                    ? counts.alerts
                    : counts.saved
            }
            active={(fixtureOn ? "yours" : lens) === l.id}
            onClick={() => onLensChange(l.id)}
          />
        ))}
      </div>

      {shown === "stale" ? <StaleNotice onRetry={onRetry} /> : null}

      <div style={{ flex: 1, minWidth: 0, padding: `0 ${PAD}` }}>
        {shown === "loading" ? <FeedSkeleton /> : null}

        {shown === "error" ? <FeedError onRetry={onRetry} /> : null}

        {/* Stale is a ready screen with a warning on it, so it reaches the
            empty placard too. Without the second clause a poll that fails
            while the chosen lens holds nothing draws the notice over a blank
            column: `empty` is unreachable once `stale` has won the stage. */}
        {shown === "empty" || (shown === "stale" && view.buckets.length === 0) ? (
          <FeedEmpty
            title={view.empty?.title ?? "Nothing on the wire"}
            body={view.empty?.body ?? "No stories match this lens right now."}
          />
        ) : null}

        {shown === "ready" || shown === "stale"
          ? view.buckets.map((bucket, i) => (
              <Bucket
                key={bucket.id}
                bucket={bucket}
                first={i === 0}
                openSources={openSources}
                onToggleSources={(id) =>
                  setOpenSources((prev) => (prev === id ? null : id))
                }
              />
            ))
          : null}

        {view.gated && (shown === "ready" || shown === "stale") ? (
          <GateTail onSignIn={onSignIn} />
        ) : null}

        {/* The design's 24px tail plus clearance for the tab bar, as a real
            box rather than as trailing padding on the block above it.
            MEASURED, not assumed, and measured twice. The shell's <main> is
            the scroll container and it carries
            padding-bottom: calc(tab bar + safe area), which resolves to 59px.
            Chrome drops it once the content overflows: with only the design's
            24px here, the last thing a reader sees ended 35px BEHIND the bar
            at 390x844. Carrying the bar height in a real box puts it back. */}
        <div
          style={{
            height:
              "calc(24px + var(--mobile-tabbar-height) + env(safe-area-inset-bottom))",
          }}
        />
      </div>
    </div>
  );
}

/* ── chrome ─────────────────────────────────────────────────────────── */

function Header({
  updatedAt,
  stale,
}: {
  updatedAt: string | null;
  stale: boolean;
}) {
  return (
    <div
      style={{
        flex: "none",
        minHeight: "48px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: `0 ${PAD}`,
        borderBottom: "1px solid var(--c-border)",
      }}
    >
      {/* The design labels this Ask and the Ask pole's live destination is
          /intelligence, so the label is the design's and the href is the one
          the shell already owns. */}
      <Link
        href="/intelligence"
        style={{
          minHeight: "44px",
          display: "flex",
          alignItems: "center",
          gap: "6px",
          font: `500 13px/1 ${INTER}`,
          color: "var(--c-secondary)",
          textDecoration: "none",
        }}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M15 6l-6 6 6 6" />
        </svg>
        Ask
      </Link>
      <span
        style={{
          font: `400 10px/1 ${MONO}`,
          letterSpacing: "0.07em",
          color: stale ? "var(--c-amberink)" : "var(--c-muted)",
        }}
      >
        {updatedAt ? `UPDATED ${updatedAt}` : "UPDATING"}
      </span>
    </div>
  );
}

function LensChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={{
        flex: "none",
        minHeight: "44px",
        display: "flex",
        alignItems: "center",
        padding: "0 12px",
        borderRadius: "6px",
        whiteSpace: "nowrap",
        cursor: "pointer",
        border: `1px solid ${active ? "var(--c-ink)" : "var(--c-border)"}`,
        font: `${active ? 600 : 500} 12px/1 ${INTER}`,
        color: active ? "var(--c-ink)" : "var(--c-secondary)",
        backgroundColor: active ? "var(--c-surface)" : "transparent",
      }}
    >
      {count === undefined ? label : `${label} ${count}`}
    </button>
  );
}

/* ── the list ───────────────────────────────────────────────────────── */

function Bucket({
  bucket,
  first,
  openSources,
  onToggleSources,
}: {
  bucket: FeedBucket;
  first: boolean;
  openSources: string | null;
  onToggleSources: (id: string) => void;
}) {
  const n = bucket.stories.length;
  /* Counted off the rows this rule actually sits over, not handed down as one
     wire-wide total pinned to whichever bucket came first. Those are the same
     number only on Everything with a populated Last hour. Under Saved, with
     three unsaved arrivals on the wire and the first bucket reading Earlier,
     the old form drew "3 new" beside Earlier on a list where nothing had
     moved. */
  const newCount = bucket.stories.reduce((k, s) => k + (s.isNew ? 1 : 0), 0);
  return (
    <div>
      {/* The design makes this rule a control that opens a story, which is a
          time rule opening one arbitrary article underneath it. It is a
          heading here, and the padding and the negative margins are the
          drawn ones so the rhythm is unchanged. */}
      <div
        style={{
          boxSizing: "content-box",
          display: "flex",
          alignItems: "center",
          gap: "9px",
          padding: first ? "15px 0 19px" : "22px 0 22px",
          margin: first ? "-15px 0 -15px" : "-6px 0 -18px",
        }}
      >
        <span style={{ font: `600 10.5px/1 ${INTER}`, color: "var(--c-secondary)" }}>
          {bucket.label}
        </span>
        <span style={{ font: `400 10px/1 ${INTER}`, color: "var(--c-muted)" }}>
          {n} {n === 1 ? "article" : "articles"}
        </span>
        {newCount > 0 ? (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "5px",
              marginLeft: "auto",
            }}
          >
            <span
              style={{
                width: "6px",
                height: "6px",
                borderRadius: "50%",
                backgroundColor: "var(--c-green)",
              }}
            />
            <span style={{ font: `600 10px/1 ${INTER}`, color: "var(--c-greenink)" }}>
              {newCount} new
            </span>
          </span>
        ) : null}
      </div>

      {bucket.stories.map((story) => (
        <Row
          key={story.id}
          story={story}
          sourcesOpen={openSources === story.id}
          onToggleSources={() => onToggleSources(story.id)}
        />
      ))}
    </div>
  );
}

function Row({
  story,
  sourcesOpen,
  onToggleSources,
}: {
  story: FeedStory;
  sourcesOpen: boolean;
  onToggleSources: () => void;
}) {
  const badge = story.badge ? BADGE[story.badge] : null;

  return (
    <article
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "6px",
        padding: "14px 0",
        borderTop: "1px solid var(--c-hair)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "10px",
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
          <span
            style={{
              font: `600 10.5px/1 ${INTER}`,
              color: SENTIMENT_INK[story.sentiment],
            }}
          >
            {SENTIMENT_WORD[story.sentiment]}
          </span>
          {badge ? (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: badge.icon ? "4px" : undefined,
                padding: "2px 6px",
                border: `1px solid ${badge.edge}`,
                borderRadius: "4px",
                backgroundColor: badge.fill,
                font: `600 10px/1 ${INTER}`,
                color: badge.ink,
              }}
            >
              {badge.icon ? (
                <svg width="8" height="8" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M6 3h12v18l-6-5-6 5z" />
                </svg>
              ) : null}
              {badge.label}
            </span>
          ) : null}
        </span>
        <span
          style={{
            font: `400 10px/1 ${MONO}`,
            letterSpacing: "0.07em",
            color: "var(--c-muted)",
            whiteSpace: "nowrap",
          }}
        >
          {story.source.toLocaleUpperCase()} {"·"} {story.timeAgo}
        </span>
      </div>

      {/* TODO(unit 22, Story): the design opens a reader at /story/[id] from
          here. That unit is NEEDS RULING (production links out to the
          publisher and the design renders body text the product states it does
          not host), so the headline is drawn exactly as designed and is not a
          control. Nothing is lost: Read source below is the destination
          production actually has. */}
      <p
        style={{
          boxSizing: "content-box",
          margin: "-2px 0",
          padding: "2px 0",
          minHeight: "40px",
          font: `700 14.5px/1.4 ${PLAYFAIR}`,
          color: "var(--c-ink)",
          textWrap: "pretty",
        }}
      >
        {story.headline}
      </p>

      {story.summary ? (
        <p
          className={styles.clamp2}
          style={{ margin: 0, font: `400 12px/1.5 ${INTER}`, color: "var(--c-body)" }}
        >
          {story.summary}
        </p>
      ) : null}

      <div
        style={{
          marginTop: "2px",
          display: "flex",
          gap: "12px",
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        {story.entity ? (
          story.entity.href ? (
            <Link
              href={story.entity.href}
              style={{
                minHeight: "44px",
                display: "inline-flex",
                alignItems: "center",
                font: `500 10px/1 ${MONO}`,
                letterSpacing: "0.07em",
                color: "var(--c-secondary)",
                textDecoration: "underline",
                textUnderlineOffset: "3px",
              }}
            >
              {story.entity.label}
            </Link>
          ) : (
            <span
              style={{
                font: `500 10px/1 ${MONO}`,
                letterSpacing: "0.07em",
                color: "var(--c-muted)",
              }}
            >
              {story.entity.label}
            </span>
          )
        ) : null}

        {/* TODO(unit 20, Signal): the design opens a cluster from here. That
            unit is NEEDS RULING on two counts, the route name (/signal versus
            /trends/[signal_id]) and an entry point that needs an edit to a
            propose-only file. Drawn as designed, no handler, until it is
            ruled. Nothing in production populates this field today. */}
        {story.cluster ? (
          <span
            style={{
              font: `500 10px/1 ${MONO}`,
              letterSpacing: "0.07em",
              color: "var(--c-secondary)",
              textDecoration: "underline",
              textUnderlineOffset: "3px",
            }}
          >
            {story.cluster}
          </span>
        ) : null}

        {story.duplicates.length > 0 ? (
          <button
            type="button"
            onClick={onToggleSources}
            aria-expanded={sourcesOpen}
            style={{
              minHeight: "44px",
              display: "inline-flex",
              alignItems: "center",
              padding: "0 8px",
              border: "1px solid var(--c-border)",
              borderRadius: "4px",
              backgroundColor: "var(--c-surface)",
              font: `600 10px/1 ${INTER}`,
              letterSpacing: "0.02em",
              color: "var(--c-secondary)",
              cursor: "pointer",
            }}
          >
            {sourcesOpen ? "▴" : "▾"} +{story.duplicates.length}{" "}
            {story.duplicates.length === 1 ? "source" : "sources"}:{" "}
            {story.duplicates.slice(0, 3).map((d) => d.source).join(", ")}
          </button>
        ) : null}

        {story.url ? (
          <a
            href={story.url}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              minHeight: "44px",
              marginLeft: "auto",
              display: "inline-flex",
              alignItems: "center",
              font: `600 10.5px/1 ${INTER}`,
              color: "var(--c-goldink)",
              textDecoration: "none",
            }}
          >
            Read source {"→"}
          </a>
        ) : (
          <span
            style={{
              marginLeft: "auto",
              font: `600 10.5px/1 ${INTER}`,
              color: "var(--c-muted)",
            }}
          >
            No link
          </span>
        )}
      </div>

      {sourcesOpen ? (
        <div
          className={styles.reveal}
          /* The design rules this group off with a 2px left border. README
             lists coloured left borders among the forbidden treatments and the
             runtime audit fires on any left border wider than its right, so
             the rule is dropped and the indent alone carries the grouping. */
          style={{
            marginTop: "2px",
            marginLeft: "6px",
            paddingLeft: "12px",
            display: "flex",
            flexDirection: "column",
            gap: "10px",
          }}
        >
          {story.duplicates.map((dup) => (
            <div
              key={dup.id}
              style={{
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "space-between",
                gap: "10px",
              }}
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                <p style={{ margin: 0, font: `400 12px/1.45 ${INTER}`, color: "var(--c-ink)" }}>
                  {dup.title}
                </p>
                <p
                  style={{
                    margin: "3px 0 0",
                    font: `400 10px/1 ${MONO}`,
                    color: "var(--c-muted)",
                  }}
                >
                  {/* A duplicate with no published_at arrives here with an
                      empty timeAgo, and an unconditional separator draws
                      "BLOOMBERG ·" trailing into nothing. */}
                  {dup.source.toLocaleUpperCase()}
                  {dup.timeAgo ? ` · ${dup.timeAgo}` : ""}
                </p>
              </div>
              {dup.url ? (
                <a
                  href={dup.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    flex: "none",
                    minHeight: "44px",
                    display: "inline-flex",
                    alignItems: "center",
                    font: `600 10.5px/1 ${INTER}`,
                    color: "var(--c-goldink)",
                    textDecoration: "none",
                  }}
                >
                  Read {"→"}
                </a>
              ) : (
                <span
                  style={{
                    flex: "none",
                    font: `600 10.5px/1 ${INTER}`,
                    color: "var(--c-muted)",
                  }}
                >
                  No link
                </span>
              )}
            </div>
          ))}
        </div>
      ) : null}
    </article>
  );
}

/* ── states ─────────────────────────────────────────────────────────── */

function StaleNotice({ onRetry }: { onRetry?: () => void }) {
  /* UNSPECIFIED in the design. The prototype draws an UPDATED clock and a
     green new marker and gives no rule for the poll having stopped coming
     back. This is the smallest honest thing: say the age, offer the retry,
     leave the rows exactly where they were. */
  return (
    <div
      style={{
        margin: `0 ${PAD} 16px`,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "10px",
        padding: "8px 12px",
        border: "1px solid var(--c-border)",
        borderRadius: "12px",
        backgroundColor: "var(--c-well)",
      }}
    >
      <span style={{ font: `400 11px/1.4 ${INTER}`, color: "var(--c-secondary)" }}>
        The feed has not refreshed in a few minutes. These stories may be behind.
      </span>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className={styles.bare}
          style={{
            boxSizing: "content-box",
            flex: "none",
            minHeight: "12px",
            padding: "16px 0",
            margin: "-16px 0",
            display: "inline-flex",
            alignItems: "center",
            font: `500 11px/1 ${INTER}`,
            color: "var(--c-secondary)",
            whiteSpace: "nowrap",
          }}
        >
          Refresh {"→"}
        </button>
      ) : null}
    </div>
  );
}

function Placard({
  path,
  title,
  body,
  action,
}: {
  path: string;
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "9px",
        padding: "44px 20px",
      }}
    >
      <div
        style={{
          width: "42px",
          height: "42px",
          borderRadius: "50%",
          backgroundColor: "var(--c-well)",
          border: "1px solid var(--c-border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--c-muted)",
        }}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d={path} />
        </svg>
      </div>
      <div style={{ font: `600 13px/1.3 ${INTER}`, color: "var(--c-ink)" }}>{title}</div>
      <p
        style={{
          margin: 0,
          maxWidth: "220px",
          textAlign: "center",
          font: `400 12px/1.5 ${INTER}`,
          color: "var(--c-secondary)",
        }}
      >
        {body}
      </p>
      {action}
    </div>
  );
}

function FeedEmpty({ title, body }: { title: string; body: string }) {
  return <Placard path="M4 6h16M4 12h16M4 18h10" title={title} body={body} />;
}

function FeedError({ onRetry }: { onRetry?: () => void }) {
  /* Absent from the design and absent from the desk, which logs the failure
     and renders the last good list forever. A feed that silently stops is the
     one state a live surface cannot leave unbuilt. */
  return (
    <Placard
      path="M12 8v5M12 16.5v.5M4.5 19h15L12 5z"
      title="The feed did not load"
      body="Something went wrong reaching the wire. Nothing here is stale, it is simply not here yet."
      action={
        onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            style={{
              marginTop: "5px",
              minHeight: "44px",
              display: "inline-flex",
              alignItems: "center",
              padding: "0 14px",
              borderRadius: "6px",
              border: "1px solid var(--c-ink)",
              backgroundColor: "var(--c-surface)",
              font: `600 12px/1 ${INTER}`,
              color: "var(--c-ink)",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        ) : undefined
      }
    />
  );
}

function GateTail({ onSignIn }: { onSignIn?: () => void }) {
  /* The desk truncates a signed-out feed at five stories. The design has no
     gate on any of its five screens, but dropping a shipped gate is a product
     change, not a port, so mobile carries it and says so in place of showing
     a list that just stops. */
  return (
    <div
      style={{
        marginTop: "14px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "10px",
        padding: "10px 12px",
        border: "1px solid var(--c-border)",
        borderRadius: "12px",
        backgroundColor: "var(--c-well)",
      }}
    >
      <span style={{ font: `400 12px/1.4 ${INTER}`, color: "var(--c-secondary)" }}>
        You are seeing the first five stories.
      </span>
      {onSignIn ? (
        <button
          type="button"
          onClick={onSignIn}
          className={styles.bare}
          style={{
            boxSizing: "content-box",
            flex: "none",
            minHeight: "12px",
            padding: "16px 0",
            margin: "-16px 0",
            display: "inline-flex",
            alignItems: "center",
            font: `600 12px/1 ${INTER}`,
            color: "var(--c-goldink)",
            whiteSpace: "nowrap",
          }}
        >
          Sign in {"→"}
        </button>
      ) : null}
    </div>
  );
}

function FeedSkeleton() {
  /* Five rows, the desk's count, in this screen's row geometry rather than the
     desk's. The design has no loading state; the anatomy is the row's own. */
  return (
    <div>
      {[0, 1, 2, 3, 4].map((i) => (
        <div
          key={i}
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "6px",
            padding: "14px 0",
            borderTop: i === 0 ? undefined : "1px solid var(--c-hair)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: "10px" }}>
            <div className={styles.sk} style={{ width: "84px", height: "11px" }} />
            <div className={styles.sk} style={{ width: "110px", height: "10px" }} />
          </div>
          <div className={styles.sk} style={{ width: "100%", height: "20px" }} />
          <div className={styles.sk} style={{ width: "72%", height: "20px" }} />
          <div className={styles.sk} style={{ width: "90%", height: "12px" }} />
        </div>
      ))}
    </div>
  );
}
