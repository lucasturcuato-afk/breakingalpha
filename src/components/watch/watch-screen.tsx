"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import { SectionRule } from "./section-rule";
import { WatchNotice, WatchSkeleton } from "./watch-notice";
import { WATCH_RECENCY_DAYS } from "./recency";
/* Type-only. A value import out of this path would drag the invented headlines
   beside the types into this client component's chunk in `.next/static`, which
   is design-lint rule `fixture-in-client-bundle`. Types erase. */
import type {
  FollowCluster,
  TrackedView,
  WatchData,
  WatchLens,
  WatchlistItem,
} from "./fixture";
import styles from "./watch.module.css";
import { FONT_DISPLAY, FONT_MONO, FONT_SANS } from "@/components/mobile/fonts";

/**
 * Watch. Tracked views, watchlist and following as three visually distinct
 * tiers in one scroll region.
 *
 * Every measurement is taken off the rendered prototype with getComputedStyle.
 * The prototype's sc-if blocks need a runtime that does not resolve over
 * file://, so the screen was rendered through `scripts/parity_harness.py`,
 * which resolves those branches from the prototype's own state map. See the PR
 * body for the parity numbers and for the gutter correction the harness itself
 * needs before those numbers mean anything.
 *
 * The three tiers are distinct by anatomy, not by decoration. Tracked views are
 * ruled prose with no card and no fill. The watchlist is cards, one of them on
 * pinned espresso. Following is hairline-separated rows under uppercase theme
 * headings. Nothing on this screen is graded, so nothing on it carries an
 * outcome state, a top edge or a state word.
 */

export type WatchStage = "ready" | "loading" | "error" | "stale";

const PAD = "var(--v3-pad)";

/**
 * Small counts are spelled, matching the design's own prose. Above twelve the
 * numeral reads better and the design never draws one. Either way the word is
 * derived from the count and never typed beside it, which is the rule that
 * stops a figure and the list it describes from drifting apart.
 */
const NUMBER_WORDS = [
  "zero", "one", "two", "three", "four", "five", "six",
  "seven", "eight", "nine", "ten", "eleven", "twelve",
];

function spell(n: number): string {
  return NUMBER_WORDS[n] ?? String(n);
}

/**
 * The window the quiet line describes, said in words rather than typed beside
 * the count. The desktop source filters at two days and says "in the last two
 * days"; the design says "today". The copy is derived from the constant so the
 * two cannot disagree again, whichever way the window is eventually settled.
 */
const RECENCY_LABEL =
  WATCH_RECENCY_DAYS === 1 ? "today" : `in the last ${spell(WATCH_RECENCY_DAYS)} days`;

const LENSES: { key: WatchLens; label: string }[] = [
  { key: "all", label: "All" },
  { key: "public", label: "Public" },
  { key: "private", label: "Private" },
  { key: "industries", label: "Industries" },
];

function matchesLens(item: WatchlistItem, lens: WatchLens): boolean {
  if (lens === "all") return true;
  if (lens === "industries") return item.kind === "industry";
  return item.kind === lens;
}

export function WatchScreen({
  stage = "ready",
  data,
  onRetry,
}: {
  stage?: WatchStage;
  /**
   * REQUIRED and NULLABLE, and never defaulted to the fixture. Two separate
   * reasons, and the second is the one that blocked PR #653.
   *
   * A default of WATCH_FIXTURE puts every invented headline in this screen's
   * PRODUCTION client bundle, since a default parameter is a live reference
   * the bundler cannot drop.
   *
   * And null is not the same value as WATCH_EMPTY. This screen used to be
   * mounted in production with `stage: "ready"` over the empty data, so it
   * told a reader "Nothing on your watchlist yet" and "You follow nothing
   * yet" when nothing had been read at all. Those are claims about the
   * reader, made with no source. There is no loader behind this screen, so
   * the honest value is null and the honest state is unwired.
   */
  data: WatchData | null;
  /**
   * Re-read the tiers. Defaults to a router refresh, which is a real retry
   * rather than a control that does nothing: the tiers are supplied by the
   * server component above this one, so refreshing it re-runs the read.
   */
  onRetry?: () => void;
}) {
  const router = useRouter();
  const retry = onRetry ?? (() => router.refresh());
  const [lens, setLens] = useState<WatchLens>("all");

  const loading = stage === "loading";
  const failed = stage === "error";
  const stale = stage === "stale";

  /* No source, no tiers. This is an EARLY RETURN on purpose: below this line
     TypeScript knows `data` is non-null, so no later reader needs a guard and
     no later edit can reintroduce the fixture, or the empty data, by leaving
     the prop off. That omission is exactly how `/ledger` shipped an invented
     brief (PR #670) and how this screen shipped "Nothing on your watchlist
     yet" over a read that never happened.

     `unwired` is not `empty`. `empty` claims a source answered with nothing;
     this claims only that nothing is reading, which is the one thing the
     screen actually knows. The wording is the rule /ask settled on in PR 654. */
  if (data === null) {
    return (
      <div
        data-parity="watch"
        className={styles.enter}
        style={{ backgroundColor: "var(--c-bg)", minHeight: "100%" }}
      >
        <WatchMasthead />
        <div style={{ padding: `18px ${PAD} 24px` }}>
          <WatchNotice
            heading="Watch is not wired to a source yet."
            body="The three tiers read from three different places and none of them is connected to this screen. Nothing here is an empty list and nothing here has failed to load: there is simply nothing reading yet."
          />
          <div
            aria-hidden="true"
            style={{
              height: "calc(var(--mobile-tabbar-height) + env(safe-area-inset-bottom))",
            }}
          />
        </div>
      </div>
    );
  }

  const visible = data.watchlist.filter((i) => matchesLens(i, lens));
  const hero = visible.find((i) => i.hero);
  /* Excluded by identity, not by the flag. Filtering on `!i.hero` drops EVERY
     flagged item, so a loader that marks two heroes would draw the first and
     silently delete the second: it is neither the hero nor in the rest. */
  const rest = visible.filter((i) => i !== hero);
  /* Follows that produced coverage, which is the count this line and the tail
     below both speak in. It is neither the cluster count nor the story count:
     a cluster is a theme, several follows can land in one, and one follow can
     produce several stories. Summing `rows` said 3 off two clusters and made
     the tail's "the other three follows" describe a total that never existed;
     counting clusters says 2 and breaks it the other way. The loader knows
     this number and the fixture carries it. */
  const coverage = data.followsWithCoverage;
  /* Quiet names are hidden under the private and industries lenses, matching
     `setWatch` in the prototype: neither lens carries a name that could be
     quiet, so the line would describe a set the screen is not showing. */
  const quietVisible =
    (lens === "all" || lens === "public") && data.quietNames.length > 0;

  return (
    <div
      data-parity="watch"
      /* The skeletons are aria-hidden, so without this a screen reader gets
         three section headings with nothing under any of them and no signal
         that anything is on its way. */
      aria-busy={loading || undefined}
      className={styles.enter}
      style={{ backgroundColor: "var(--c-bg)", minHeight: "100%" }}
    >
      <WatchMasthead />

      <div style={{ padding: `18px ${PAD} 24px` }}>
        {stale ? (
          <WatchNotice
            body={`Last checked ${data.lastCheckedLabel}. Today's pass has not run yet, so everything below is the last reading rather than this morning's.`}
            onRetry={retry}
            retryLabel="Check again"
          />
        ) : null}

        {/* ── tracked views ──────────────────────────────────────────── */}
        <SectionRule
          label="tracked views"
          count={loading || failed ? undefined : String(data.trackedViews.length)}
          marginTop={stale ? "22px" : 0}
        />
        {loading ? <WatchSkeleton rows={2} /> : null}
        {failed ? (
          <WatchNotice
            heading="Could not load your tracked views."
            body="This is a loading failure, not an empty list. Nothing you wrote has been lost."
            onRetry={retry}
          />
        ) : null}
        {!loading && !failed && data.trackedViews.length === 0 ? (
          <WatchNotice body="No tracked views yet. A view with no direction and no window on it lives here, and is never graded." />
        ) : null}
        {!loading && !failed
          ? data.trackedViews.map((view, i) => (
              <TrackedViewCard key={view.id} view={view} first={i === 0} />
            ))
          : null}

        {/* ── watchlist ──────────────────────────────────────────────── */}
        <SectionRule
          label="watchlist"
          /* Both halves are read off what the screen is actually drawing under
             the active lens. `data.watchlist.length` here said "5 with news"
             over a single card once Private was selected, which reads as a
             broken filter, and the quiet half described a set the lens hides. */
          count={
            loading || failed
              ? undefined
              : quietVisible
                ? `${visible.length} with news · ${data.quietNames.length} quiet`
                : `${visible.length} with news`
          }
          marginTop="26px"
        />
        <p
          style={{
            margin: "8px 0 0",
            font: `400 11.5px/1.5 ${FONT_SANS}`,
            color: "var(--c-muted)",
          }}
        >
          News about what you watch: names, private companies and industries. Price is the quiet part.
        </p>
        {loading ? <WatchSkeleton rows={3} /> : null}
        {failed ? (
          <WatchNotice
            heading="Could not load your watchlist."
            body="This is a loading failure, not an empty watchlist. Nothing you track has been lost."
            onRetry={retry}
          />
        ) : null}
        {!loading && !failed ? (
          <>
            {/* A lens over an empty set is four controls that do nothing, so
                the row is drawn only once there is something to filter. */}
            {data.watchlist.length > 0 ? (
              <div
                role="group"
                aria-label="Watchlist filter"
                style={{ marginTop: "11px", display: "flex", flexWrap: "wrap", gap: "12px" }}
              >
                {LENSES.map((l) => (
                  <LensChip
                    key={l.key}
                    label={l.label}
                    active={lens === l.key}
                    onSelect={() => setLens(l.key)}
                  />
                ))}
              </div>
            ) : null}

            {hero ? <WatchlistHero item={hero} /> : null}
            {rest.map((item) => (
              <WatchlistCard key={item.id} item={item} />
            ))}

            {data.watchlist.length === 0 ? (
              <WatchNotice body="Nothing on your watchlist yet. Names, private companies and industries are added on the desk." />
            ) : visible.length === 0 ? (
              <WatchNotice body="Nothing tracked under this filter yet." />
            ) : null}

            {quietVisible ? <QuietLine names={data.quietNames} shown={data.quietShown} /> : null}
          </>
        ) : null}

        {/* ── following ──────────────────────────────────────────────── */}
        <SectionRule
          label="following"
          count={
            loading || failed
              ? undefined
              : `${coverage} with coverage · ${data.followsQuiet} quiet`
          }
          marginTop="26px"
        />
        <p
          style={{
            margin: "8px 0 0",
            font: `400 11.5px/1.5 ${FONT_SANS}`,
            color: "var(--c-muted)",
          }}
        >
          This week&apos;s coverage, grouped by theme.
        </p>
        {loading ? <WatchSkeleton rows={3} /> : null}
        {failed ? (
          <WatchNotice
            heading="Could not load what you follow."
            body="This is a loading failure, not an empty feed. Your follows are intact."
            onRetry={retry}
          />
        ) : null}
        {!loading && !failed ? (
          <>
            {data.following.map((cluster, i) => (
              <ThemeCluster key={cluster.id} cluster={cluster} first={i === 0} />
            ))}
            {data.following.length === 0 ? (
              <WatchNotice body="You follow nothing yet. Themes, companies and people are followed on the desk." />
            ) : null}
            <FollowingTail
              quiet={data.followsQuiet}
              couldNotCheck={data.followsCouldNotCheck}
            />
          </>
        ) : null}

        {/* Clearance for the tab bar, as an element rather than as padding on
            the shell's scroll container.
            `app-shell.tsx` already puts
            `pb-[calc(var(--mobile-tabbar-height)+env(safe-area-inset-bottom))]`
            on #main-content, and on this route that padding is not honoured at
            the end of the scroll. Measured on the running page at 390 with
            `scripts/screen-geometry.mjs`: without this element the last line
            bottoms out at 820px against a bar top of 785px, so 35px of it sits
            behind the bar. With it, 761px, clear by the block's own 24px.
            A synthetic reproduction of the container does honour the padding,
            which is what makes this worth measuring on the real page rather
            than reasoning about. */}
        <div
          aria-hidden="true"
          style={{
            height: "calc(var(--mobile-tabbar-height) + env(safe-area-inset-bottom))",
          }}
        />
      </div>
    </div>
  );
}

/**
 * Title and standfirst. Drawn once and shared by the wired render and the
 * unwired one, so the two cannot drift into two different mastheads.
 *
 * The gutter is applied ONCE, here and on the body below, never on both an
 * ancestor and a descendant. A doubled gutter measures a 310px text column
 * where the design draws 350px at 390.
 *
 * Neither string is a claim about the reader. They describe what the screen is
 * for, which is true whether or not anything is reading.
 */
function WatchMasthead() {
  return (
    <div style={{ padding: `6px ${PAD} 0` }}>
      <h1
        style={{
          margin: 0,
          font: `700 26px/1.14 ${FONT_DISPLAY}`,
          letterSpacing: "-0.02em",
          color: "var(--c-ink)",
        }}
      >
        Watch
      </h1>
      <p
        style={{
          margin: "8px 0 0",
          font: `400 12.5px/1.5 ${FONT_SANS}`,
          color: "var(--c-secondary)",
        }}
      >
        Tracked views, watchlist and following. Nothing on this screen is ever graded.
      </p>
    </div>
  );
}

/* ── tracked views ──────────────────────────────────────────────────── */

/**
 * A view with no direction and no window, therefore never gradeable and never
 * on the ledger. The meta line's second half says so on every card.
 *
 * The design draws the rule as a 2px left rule on --c-border. It
 * ships as a 2px element instead. The README forbids coloured left borders and
 * both gates enforce that on the property rather than on the colour, so a
 * neutral left rule fails a rule it was never the target of. Same pixels, same
 * geometry, and the tension is recorded in the PR body rather than argued away
 * in a comment.
 */
function TrackedViewCard({ view, first }: { view: TrackedView; first: boolean }) {
  return (
    <div
      style={{
        marginTop: first ? "13px" : "20px",
        display: "flex",
        alignItems: "stretch",
        gap: "15px",
      }}
    >
      <span
        aria-hidden="true"
        style={{ flex: "none", width: "2px", backgroundColor: "var(--c-border)" }}
      />
      <div style={{ minWidth: 0, flex: 1, padding: "2px 0" }}>
        <p
          style={{
            margin: 0,
            font: `400 italic 16px/1.62 ${FONT_DISPLAY}`,
            color: "var(--c-ink)",
            textWrap: "pretty",
          }}
        >
          {view.note}
        </p>
        <p
          style={{
            margin: "10px 0 0",
            font: `500 12.5px/1.5 ${FONT_SANS}`,
            color: "var(--c-body)",
          }}
        >
          {view.headline}
        </p>
        <p
          style={{
            margin: "6px 0 0",
            font: `400 10px/1 ${FONT_MONO}`,
            letterSpacing: "0.07em",
            color: "var(--c-muted)",
          }}
        >
          {view.date} · NO DIRECTION, NO WINDOW
        </p>
      </div>
    </div>
  );
}

/* ── watchlist ──────────────────────────────────────────────────────── */

function LensChip({
  label,
  active,
  onSelect,
}: {
  label: string;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={styles.bare}
      style={{
        flex: "none",
        minHeight: "44px",
        display: "flex",
        alignItems: "center",
        padding: "0 12px",
        borderRadius: "6px",
        whiteSpace: "nowrap",
        border: active ? "1px solid var(--c-ink)" : "1px solid var(--c-border)",
        font: active ? `600 12px/1 ${FONT_SANS}` : `500 12px/1 ${FONT_SANS}`,
        color: active ? "var(--c-ink)" : "var(--c-secondary)",
        backgroundColor: active ? "var(--c-surface)" : "transparent",
      }}
    >
      {label}
    </button>
  );
}

/**
 * The hero. One entity on pinned espresso carrying today's strongest story.
 *
 * The design puts a second control on the headline, opening the story from
 * inside a card that is itself a control. A focusable container wrapping a
 * focusable child is what the accessibility rule forbids outright, so the card
 * resolves to one control and the headline is prose. The story surface does not
 * exist yet either; see the TODO.
 */
function WatchlistHero({ item }: { item: WatchlistItem }) {
  return (
    <button
      type="button"
      // TODO, see #643: open the company surface. /company/[id] is step 9 and the
      // fixture carries no resolvable id, so this is deliberately a no-op.
      onClick={() => {}}
      className={styles.bare}
      style={{
        marginTop: "12px",
        width: "100%",
        display: "flex",
        flexDirection: "column",
        borderRadius: "12px",
        backgroundColor: "var(--c-inverse)",
        padding: "16px",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: "12px", width: "100%" }}>
        <span
          style={{
            flex: "none",
            minWidth: "38px",
            height: "36px",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "0 7px",
            borderRadius: "6px",
            backgroundColor: "var(--c-green-surface)",
            font: `700 13px/1 ${FONT_MONO}`,
            color: "var(--c-oninv)",
          }}
        >
          {item.badge}
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: "8px", flexWrap: "wrap" }}>
            <span style={{ font: `600 11px/1 ${FONT_SANS}`, color: "var(--c-oninv-body)" }}>
              {item.qualifier}
            </span>
            {item.move ? (
              <span
                style={{
                  font: `400 11px/1 ${FONT_MONO}`,
                  /* On pinned espresso the on-espresso literal is the token,
                     not the ink token: tokens.reference.css states that rule
                     outright and measures the ink tokens at 2.86 to 3.76:1
                     here. The design draws the dark theme's own
                     --c-greenink literal here, which is exactly the kind of
                     value that rule names. Flagged in the PR body as a parity
                     mismatch the design owns. */
                  color:
                    item.moveDirection === "down"
                      ? "var(--c-inv-red)"
                      : "var(--c-inv-green)",
                }}
              >
                {item.move}
              </span>
            ) : null}
          </div>
          <p
            style={{
              margin: "8px 0 0",
              font: `600 17px/1.32 ${FONT_DISPLAY}`,
              color: "var(--c-oninv-strong)",
              textWrap: "pretty",
            }}
          >
            {item.headline}
          </p>
          <p
            style={{
              margin: "7px 0 0",
              font: `400 11.5px/1.4 ${FONT_SANS}`,
              color: "var(--c-oninv-dim)",
            }}
          >
            {item.source}
          </p>
        </div>
      </div>
    </button>
  );
}

/** Every non-hero watchlist entry. Three type branches, one card shape. */
function WatchlistCard({ item }: { item: WatchlistItem }) {
  const shape = {
    marginTop: "10px",
    width: "100%",
    display: "flex",
    alignItems: "flex-start",
    gap: "12px",
    padding: "13px 14px",
    border: "1px solid var(--c-border)",
    borderRadius: "12px",
    backgroundColor: "var(--c-card)",
  } as const;

  const body = (
    <>
      <Badge item={item} />
      <div style={{ minWidth: 0, flex: 1 }}>
        {/* A name carries its move beside it on a baseline row. A private
            company and an industry carry no price at all, and the design draws
            their qualifier as one plain line rather than a row of one. */}
        {item.move ? (
          <div style={{ display: "flex", alignItems: "baseline", gap: "8px", flexWrap: "wrap" }}>
            <span style={{ font: `600 11px/1 ${FONT_SANS}`, color: "var(--c-secondary)" }}>
              {item.qualifier}
            </span>
            <span
              style={{
                font: `400 11px/1 ${FONT_MONO}`,
                color:
                  item.moveDirection === "down" ? "var(--c-redink)" : "var(--c-greenink)",
              }}
            >
              {item.move}
            </span>
          </div>
        ) : (
          <div style={{ font: `600 11px/1 ${FONT_SANS}`, color: "var(--c-secondary)" }}>
            {item.qualifier}
          </div>
        )}
        <p
          style={{
            margin: "6px 0 0",
            font: `600 14px/1.35 ${FONT_DISPLAY}`,
            color: "var(--c-ink)",
            textWrap: "pretty",
          }}
        >
          {item.headline}
        </p>
        <p
          style={{
            margin: "6px 0 0",
            font: `400 11px/1.4 ${FONT_SANS}`,
            color: "var(--c-muted)",
          }}
        >
          {item.source}
        </p>
      </div>
    </>
  );

  /* The private card is drawn without a handler in the design and stays a plain
     container here. A card that looks tappable and is not is worse than one
     that does not, and there is no private-company surface to open. */
  if (item.kind === "private") return <div style={shape}>{body}</div>;

  return (
    <button
      type="button"
      // TODO, see #643: open the company or the industry signal. /company/[id] is
      // step 9 and /signal is step 10; neither exists, so this is a no-op.
      onClick={() => {}}
      className={styles.bare}
      style={shape}
    >
      {body}
    </button>
  );
}

function Badge({ item }: { item: WatchlistItem }) {
  if (item.kind === "public") {
    return (
      <span
        style={{
          flex: "none",
          minWidth: "38px",
          height: "36px",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "0 7px",
          borderRadius: "6px",
          backgroundColor: "var(--c-green-surface)",
          font: `700 13px/1 ${FONT_MONO}`,
          color: "var(--c-oninv)",
        }}
      >
        {item.badge}
      </span>
    );
  }
  if (item.kind === "private") {
    return (
      <span
        style={{
          flex: "none",
          height: "36px",
          display: "inline-flex",
          alignItems: "center",
          font: `600 15px/1 ${FONT_DISPLAY}`,
          color: "var(--c-ink)",
        }}
      >
        {item.badge}
      </span>
    );
  }
  return (
    <span
      style={{
        flex: "none",
        height: "36px",
        display: "inline-flex",
        alignItems: "center",
        padding: "0 9px",
        borderRadius: "6px",
        backgroundColor: "var(--c-gold)",
        font: `600 10.5px/1 ${FONT_SANS}`,
        letterSpacing: "0.06em",
        color: "var(--c-ongold)",
      }}
    >
      {item.badge}
    </span>
  );
}

/**
 * Quiet is a real answer and a distinct state from an empty watchlist.
 *
 * The names are underlined and are not controls, exactly as the design draws
 * them. The desktop source links each one to /watchlist/<identifier>; an inline
 * anchor in an 11.5px prose line cannot carry a 44px target without moving the
 * text, and the inline-citation carve-out is for citations. Recorded as a
 * deviation rather than taken.
 */
function QuietLine({ names, shown }: { names: string[]; shown: number }) {
  const head = names.slice(0, shown);
  const more = names.length - head.length;
  return (
    <p
      style={{
        margin: "12px 0 0",
        font: `400 11.5px/1.6 ${FONT_SANS}`,
        color: "var(--c-muted)",
        textWrap: "pretty",
      }}
    >
      No news {RECENCY_LABEL}:{" "}
      {head.map((n, i) => (
        <Fragment key={n}>
          {i > 0 ? " · " : null}
          <span style={{ textDecoration: "underline", textUnderlineOffset: "2px" }}>{n}</span>
        </Fragment>
      ))}
      {more > 0 ? ` · +${more} more` : null}
    </p>
  );
}

/* ── following ──────────────────────────────────────────────────────── */

function ThemeCluster({ cluster, first }: { cluster: FollowCluster; first: boolean }) {
  return (
    <div style={{ marginTop: first ? "12px" : "18px" }}>
      <h3
        style={{
          margin: 0,
          paddingBottom: "6px",
          borderBottom: "1px solid var(--c-border)",
          font: `600 11px/1.3 ${FONT_SANS}`,
          letterSpacing: "0.12em",
          color: "var(--c-secondary)",
        }}
      >
        {cluster.label}
      </h3>
      {cluster.rows.map((row) => (
        <button
          key={row.id}
          type="button"
          // TODO, see #643: open the story. /story is step 10 and does not exist.
          onClick={() => {}}
          className={styles.bare}
          style={{
            width: "100%",
            display: "flex",
            flexDirection: "column",
            gap: "4px",
            padding: "12px 0",
            borderBottom: "1px solid var(--c-hair)",
          }}
        >
          <p
            style={{
              margin: 0,
              font: `500 13.5px/1.4 ${FONT_SANS}`,
              color: "var(--c-ink)",
              textWrap: "pretty",
            }}
          >
            {row.headline}
          </p>
          <p
            style={{
              margin: 0,
              font: `400 10px/1 ${FONT_MONO}`,
              letterSpacing: "0.07em",
              color: "var(--c-muted)",
            }}
          >
            {row.meta}
          </p>
        </button>
      ))}
    </div>
  );
}

/**
 * The tail line, and the one place this screen refuses the design's copy.
 *
 * The prototype asserts "That is an empty week, not a failed load". That
 * sentence is true only when every follow was actually checked. The desktop
 * source separates a follow whose match query errored from a quiet one for
 * precisely this reason, and without that separation the screen states, out
 * loud, something it does not know. So when a follow could not be checked the
 * claim is withdrawn and the failures are named.
 */
function FollowingTail({ quiet, couldNotCheck }: { quiet: number; couldNotCheck: string[] }) {
  if (quiet === 0 && couldNotCheck.length === 0) return null;
  const unchecked = couldNotCheck.length > 0;
  /* The count decides the noun as well as the number. A figure read from state
     drags its grammar with it, and "The other one follows" is the shape that
     bug takes if only the number is derived. */
  const subject =
    quiet === 1 ? "The other follow" : `The other ${spell(quiet)} follows`;
  return (
    <>
      {quiet > 0 ? (
        <p
          style={{
            margin: "14px 0 0",
            font: `400 11.5px/1.55 ${FONT_SANS}`,
            color: "var(--c-muted)",
            textWrap: "pretty",
          }}
        >
          {unchecked
            ? `${subject} had no coverage this week.`
            : `${subject} had no coverage this week. That is an empty week, not a failed load; your follows are intact.`}
        </p>
      ) : null}
      {unchecked ? (
        <WatchNotice
          heading={`Could not check: ${couldNotCheck.join(" · ")}`}
          body="Matching failed for these. This is an error, not an empty result, and they are not counted as quiet."
        />
      ) : null}
    </>
  );
}
