"use client";

import { useEffect, useMemo, useState, Fragment } from "react";
import { useRouter } from "next/navigation";
import { SectionRule } from "./section-rule";
import { WatchNotice, WatchSkeleton } from "./watch-notice";
import { WATCH_RECENCY_DAYS } from "./recency";
/* Type-only. A value import out of this path would drag the sample headlines
   beside the types into this client component's chunk in `.next/static`, which
   is design-lint rule `fixture-in-client-bundle`. Types erase. */
import type {
  FollowCluster,
  WatchData,
  WatchLens,
  WatchlistItem,
  WatchQuote,
  WatchQuotes,
} from "./fixture";
import styles from "./watch.module.css";
import { FONT_DISPLAY, FONT_MONO, FONT_SANS } from "@/components/mobile/fonts";

/**
 * Watch. The reader's watchlist and what they follow, as two visually distinct
 * tiers in one scroll region.
 *
 * WHAT IS DRAWN AND WHAT IS NOT.
 *
 * TRACKED VIEWS ARE NOT DRAWN. The design puts them first, as ruled italic
 * prose. `TrackedView` needs a headline, and `user_claims` carries no article
 * foreign key, no article_id and no title column, so the story a note was
 * written against is not recoverable. `fixture.ts` records the two ways out and
 * both need an owner. An empty-tier notice was not shipped in its place either:
 * "No tracked views yet" is a claim about the reader, and there is no read
 * behind it to make.
 *
 * THE PINNED-ESPRESSO HERO IS NOT DRAWN. The design promotes one entity to a
 * dark panel carrying "today's strongest story". Nothing in the schema ranks a
 * reader's names against each other, and deriving a winner from `published_at`
 * would dress a timestamp up as a judgement. Every entry renders as the same
 * card.
 *
 * THEME HEADINGS ARE NOT DRAWN over following. Cluster labels come from a lazy
 * model pass and are null until it runs, so the rows ship under one unlabelled
 * rule.
 *
 * Every measurement is taken off the rendered prototype with getComputedStyle.
 * The prototype's sc-if blocks need a runtime that does not resolve over
 * file://, so the screen was rendered through `scripts/parity_harness.py`,
 * which resolves those branches from the prototype's own state map. See the PR
 * body for the parity numbers.
 *
 * The two tiers are distinct by anatomy, not by decoration. The watchlist is
 * cards; following is hairline-separated rows. Nothing on this screen is
 * graded, so nothing on it carries an outcome state, a top edge or a state
 * word.
 */

export type WatchStage = "ready" | "loading" | "error" | "stale";

const PAD = "var(--v3-pad)";

/** Where a reader adds names and follows. `/watch` has no add affordance. */
const WATCHLIST_DESK = "/radar/watchlist";
const FOLLOWING_DESK = "/radar/following";

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

function sentenceCase(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
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

/**
 * The signed move, per ticker, read after mount.
 *
 * NOT part of `WatchData` and never blocking the server read.
 * `/api/watchlist-quotes` reaches Finnhub and Yahoo, and the design calls price
 * "the quiet part"; paying for it with the whole screen's time to first byte is
 * the wrong trade.
 *
 * Absence is the only failure mode this needs. A read in flight and a read that
 * faulted both render NOTHING rather than a number, so the transiently wrong
 * figure a `?? 0` produces on the desk cannot happen here. `pct >= 0` decides
 * direction, which is the rule `/api/watchlist-quotes` callers already use.
 *
 * That route caps its symbol list at twenty. Past that a name simply has no
 * quote, which draws no price rather than a wrong one. Logged as a defect this
 * unit does not own.
 */
function useQuotes(symbols: string[]): WatchQuotes {
  const [quotes, setQuotes] = useState<WatchQuotes>({});
  const key = symbols.join(",");
  useEffect(() => {
    if (key.length === 0) return;
    let live = true;
    fetch(`/api/watchlist-quotes?symbols=${encodeURIComponent(key)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json: { quotes?: Record<string, { pct: number }> } | null) => {
        if (!live || !json?.quotes) return;
        const next: WatchQuotes = {};
        for (const [symbol, q] of Object.entries(json.quotes)) {
          if (typeof q?.pct !== "number" || Number.isNaN(q.pct)) continue;
          next[symbol] = {
            move: `${q.pct >= 0 ? "+" : ""}${q.pct.toFixed(2)}%`,
            direction: q.pct >= 0 ? "up" : "down",
          };
        }
        setQuotes(next);
      })
      .catch(() => {
        /* Nothing drawn. An absent price is honest; a stale one is not. */
      });
    return () => {
      live = false;
    };
  }, [key]);
  return quotes;
}

export function WatchScreen({
  stage = "ready",
  data,
  onRetry,
}: {
  stage?: WatchStage;
  /**
   * REQUIRED and NULLABLE, and never defaulted to the sample content. Two
   * separate reasons, and the second is the one that blocked PR #653.
   *
   * A default of WATCH_FIXTURE puts every sample headline in this screen's
   * PRODUCTION client bundle, since a default parameter is a live reference
   * the bundler cannot drop.
   *
   * And null is not the same value as WATCH_EMPTY. This screen was once
   * mounted in production with `stage: "ready"` over the empty data, so it
   * told a reader "Nothing on your watchlist yet" when nothing had been read
   * at all. Those are claims about the reader, made with no source. Now there
   * IS a loader (`src/lib/watch-data.ts`), and it hands back null on exactly
   * one condition: no reader to scope the tiers to. The early return below says
   * that and nothing more.
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

  const tickers = useMemo(
    () =>
      (data?.watchlist ?? [])
        .filter((i) => i.kind === "public")
        .map((i) => i.identifier.toUpperCase()),
    [data],
  );
  const quotes = useQuotes(tickers);

  const loading = stage === "loading";
  const stale = stage === "stale";

  /* No reader, no tiers. This is an EARLY RETURN on purpose: below this line
     TypeScript knows `data` is non-null, so no later reader needs a guard and
     no later edit can reintroduce the sample content, or the empty data, by
     leaving the prop off. That omission is exactly how `/ledger` shipped an
     invented brief (PR #670).

     This is NOT an empty state and NOT a per-tier failure. Both of those are
     drawn below, off real reads. This one branch says the screen could not
     work out whose watchlist to read, which is the only thing it knows. */
  if (data === null) {
    return (
      <div
        data-parity="watch"
        data-watch-state="no-reader"
        className={styles.enter}
        style={{
          backgroundColor: "var(--c-bg)",
          minHeight: "100%",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <WatchMasthead />
        {/* Centred rather than left dangling under the masthead. A short state
            that keeps the tall layout's top alignment leaves half the viewport
            as dead screen, which is the defect PR #710 shipped on `/claim`
            (415px, 49.1% of the viewport). Measurements in the PR body. */}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            padding: `18px ${PAD} 24px`,
          }}
        >
          <WatchNotice
            heading="Could not work out whose watchlist to read."
            body="Your session did not resolve, so nothing was read. This is not an empty watchlist, and nothing you track has been lost."
            onRetry={retry}
          />
        </div>
        <TabBarClearance />
      </div>
    );
  }

  const visible = data.watchlist.filter((i) => matchesLens(i, lens));
  /* Per-tier failure, because one tier failing says nothing about the other.
     `stage === "error"` stays as a whole-screen override so the runtime audit
     can still reach both notices at once. */
  const watchlistFailed = stage === "error" || data.watchlistRead === "failed";
  const followingFailed = stage === "error" || data.followingRead === "failed";
  /* Follows that produced coverage, which is the count this line and the tail
     below both speak in. It is neither the cluster count nor the story count:
     a cluster is a theme, several follows can land in one, and one follow can
     produce several stories. The loader knows this number. */
  const coverage = data.followsWithCoverage;
  /* Quiet names are hidden under the private and industries lenses, matching
     `setWatch` in the prototype: neither lens carries a name that could be
     quiet, so the line would describe a set the screen is not showing. */
  const quietVisible =
    (lens === "all" || lens === "public") && data.quietNames.length > 0;
  const followRows = data.following.reduce((n, c) => n + c.rows.length, 0);

  /* A screen with no cards and no rows in either tier. Reported on the root so
     a test and a measurement script can name the state they are looking at;
     the centring below does not depend on it. */
  const sparse =
    (watchlistFailed || visible.length === 0) && (followingFailed || followRows === 0);

  const followingEmpty =
    coverage === 0 &&
    data.followsQuiet === 0 &&
    data.followsMuted === 0 &&
    data.followsCouldNotCheck.length === 0;

  return (
    <div
      data-parity="watch"
      data-watch-state={sparse ? "sparse" : "populated"}
      /* The skeletons are aria-hidden, so without this a screen reader gets
         two section headings with nothing under either and no signal that
         anything is on its way. */
      aria-busy={loading || undefined}
      className={styles.enter}
      style={{
        backgroundColor: "var(--c-bg)",
        minHeight: "100%",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <WatchMasthead />

      {/* THE SHORT STATE IS CENTRED, and it is centred unconditionally.
          Omitting a whole tier plus a hero without reflowing is how PR #710
          shipped 415px of dead screen on `/claim`, 49.1% of the viewport.
          `justifyContent: center` is safe on every state rather than only the
          short ones: `flex: 1` leaves `min-height: auto` on a column flex
          item, so a body taller than the free space has no free space to
          distribute and centring is a no-op. Measured both ways; the numbers
          are in the PR body.

          What centring CANNOT remove is the floor. `#main-content` already
          carries `padding-bottom: var(--mobile-tabbar-height)`, measured at
          59px, and the fixed bar sits at top 785 in a 844 viewport, so the
          59px clearance block below plus this block's own 24px is 83px of
          structural gap under every state, short or tall. 83px is 9.8% of the
          viewport and it is the floor the 15% gate is measured against. */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: `18px ${PAD} 24px`,
        }}
      >
        {stale ? (
          <WatchNotice
            body={`Last checked ${data.lastCheckedLabel}. Today's pass has not run yet, so everything below is the last reading rather than this morning's.`}
            onRetry={retry}
            retryLabel="Check again"
          />
        ) : null}

        {/* ── watchlist ──────────────────────────────────────────────── */}
        <SectionRule
          label="watchlist"
          /* Both halves are read off what the screen is actually drawing under
             the active lens. `data.watchlist.length` here said "5 with news"
             over a single card once Private was selected, which reads as a
             broken filter, and the quiet half described a set the lens hides. */
          count={
            loading || watchlistFailed
              ? undefined
              : quietVisible
                ? `${visible.length} with news · ${data.quietNames.length} quiet`
                : `${visible.length} with news`
          }
          marginTop={stale ? "22px" : 0}
        />
        <TierStandfirst>
          News about what you watch: names, private companies and industries. Price is the quiet part.
        </TierStandfirst>
        {loading ? <WatchSkeleton rows={4} /> : null}
        {watchlistFailed ? (
          <WatchNotice
            heading="Could not load your watchlist."
            body="This is a loading failure, not an empty watchlist. Nothing you track has been lost."
            onRetry={retry}
          />
        ) : null}
        {!loading && !watchlistFailed ? (
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

            {visible.map((item) => (
              <WatchlistCard
                key={item.id}
                item={item}
                quote={quotes[item.identifier.toUpperCase()]}
              />
            ))}

            {data.watchlist.length === 0 &&
            data.quietNames.length === 0 &&
            data.watchlistCouldNotRead.length === 0 ? (
              <WatchNotice
                body="Nothing on your watchlist yet. Names, private companies and industries are added on the desk."
                action={{ href: WATCHLIST_DESK, label: "Open the watchlist desk" }}
              />
            ) : visible.length === 0 && data.watchlist.length > 0 ? (
              <WatchNotice body="Nothing tracked under this filter yet." />
            ) : null}

            {/* THE PER-ENTRY FAULT. A read that errored is not a name with no
                news, so these names are omitted from the cards AND from the
                quiet line, and named here with the reason instead. Without
                this block a Postgres error on one identifier would be
                indistinguishable from that name having a quiet day, in prose,
                about the reader's own list. */}
            {data.watchlistCouldNotRead.length > 0 ? (
              <WatchNotice
                heading={`Could not read: ${data.watchlistCouldNotRead.join(" · ")}`}
                body="The article read failed for these, so they are left out rather than drawn. They are not quiet and they are not counted quiet."
                onRetry={retry}
              />
            ) : null}

            {quietVisible ? <QuietLine names={data.quietNames} shown={data.quietShown} /> : null}
          </>
        ) : null}

        {/* ── following ──────────────────────────────────────────────── */}
        <SectionRule
          label="following"
          count={
            loading || followingFailed
              ? undefined
              : followingCount(coverage, data.followsQuiet, data.followsMuted)
          }
          marginTop="26px"
        />
        <TierStandfirst>This week&apos;s coverage.</TierStandfirst>
        {loading ? <WatchSkeleton rows={5} /> : null}
        {followingFailed ? (
          <WatchNotice
            heading="Could not load what you follow."
            body="This is a loading failure, not an empty feed. Your follows are intact."
            onRetry={retry}
          />
        ) : null}
        {!loading && !followingFailed ? (
          <>
            {data.following.map((cluster, i) => (
              <ThemeCluster key={cluster.id} cluster={cluster} first={i === 0} />
            ))}
            {followingEmpty ? (
              <WatchNotice
                body="You follow nothing yet. Themes, companies and people are followed on the desk."
                action={{ href: FOLLOWING_DESK, label: "Open the following desk" }}
              />
            ) : null}
            <FollowingTail
              quiet={data.followsQuiet}
              muted={data.followsMuted}
              couldNotCheck={data.followsCouldNotCheck}
            />
          </>
        ) : null}
      </div>

      <TabBarClearance />
    </div>
  );
}

/**
 * Clearance for the tab bar, as an element rather than as padding on the
 * shell's scroll container.
 *
 * `app-shell.tsx` already puts
 * `pb-[calc(var(--mobile-tabbar-height)+env(safe-area-inset-bottom))]` on
 * #main-content, and on this route that padding is not honoured at the end of
 * the scroll. Measured on the running page at 390 with
 * `scripts/screen-geometry.mjs`: without this element the last line bottomed
 * out at 820px against a bar top of 785px, so 35px of it sat behind the bar.
 * A synthetic reproduction of the container does honour the padding, which is
 * what makes this worth measuring on the real page rather than reasoning about.
 *
 * It is the LAST child of the screen ROOT rather than of the body, so the
 * sparse state's centring cannot push content under the bar: the centred
 * region is the space between the masthead and this block.
 */
function TabBarClearance() {
  return (
    <div
      aria-hidden="true"
      style={{
        flex: "none",
        height: "calc(var(--mobile-tabbar-height) + env(safe-area-inset-bottom))",
      }}
    />
  );
}

/** "3 with coverage · 2 quiet · 1 muted". Muted only when there are muted. */
function followingCount(coverage: number, quiet: number, muted: number): string {
  const parts = [`${coverage} with coverage`, `${quiet} quiet`];
  if (muted > 0) parts.push(`${muted} muted`);
  return parts.join(" · ");
}

/** The one-line note under each section rule. Same type on both tiers. */
function TierStandfirst({ children }: { children: React.ReactNode }) {
  return (
    <p
      style={{
        margin: "8px 0 0",
        font: `400 11.5px/1.5 ${FONT_SANS}`,
        color: "var(--c-muted)",
      }}
    >
      {children}
    </p>
  );
}

/**
 * Title and standfirst. Drawn once and shared by every branch, so they cannot
 * drift into two different mastheads.
 *
 * The gutter is applied ONCE, here and on the body below, never on both an
 * ancestor and a descendant. A doubled gutter measures a 310px text column
 * where the design draws 350px at 390.
 *
 * Neither string is a claim about the reader. They describe what the screen is
 * for, which is true whether or not anything was read.
 */
function WatchMasthead() {
  return (
    <div style={{ flex: "none", padding: `6px ${PAD} 0` }}>
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
        Your watchlist and what you follow. Nothing on this screen is ever graded.
      </p>
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
 * Every watchlist entry. Three type branches, one card shape.
 *
 * There is no second shape. The design promotes one entry to a pinned-espresso
 * hero carrying "today's strongest story", and nothing in the schema ranks a
 * reader's names against each other. Deriving the winner from `published_at`
 * would present a timestamp as a judgement, so the promotion is not made.
 */
function WatchlistCard({ item, quote }: { item: WatchlistItem; quote?: WatchQuote }) {
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
        {/* A name carries its move beside it on a baseline row, once the quote
            lands. A private company and an industry carry no price at all, and
            the design draws their qualifier as one plain line rather than a row
            of one. A name whose quote has not landed, or did not answer, draws
            that same plain line: nothing, rather than a number that might be
            wrong. */}
        {quote ? (
          <div style={{ display: "flex", alignItems: "baseline", gap: "8px", flexWrap: "wrap" }}>
            <span style={{ font: `600 11px/1 ${FONT_SANS}`, color: "var(--c-secondary)" }}>
              {item.qualifier}
            </span>
            <span
              style={{
                font: `400 11px/1 ${FONT_MONO}`,
                color: quote.direction === "down" ? "var(--c-redink)" : "var(--c-greenink)",
              }}
            >
              {quote.move}
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
 * Quiet is a real answer, and a distinct state both from an empty watchlist and
 * from a read that did not answer. The loader keeps all three apart; a name
 * whose read faulted never reaches this line.
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
      {/* The heading is drawn only when there is a real label. Cluster names
          are null until a lazy model pass writes them, and an empty uppercase
          rule over a list of stories is worse than no rule at all. */}
      {cluster.label ? (
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
      ) : null}
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
          {row.meta ? (
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
          ) : null}
        </button>
      ))}
    </div>
  );
}

const tailCopy = {
  margin: "14px 0 0",
  font: `400 11.5px/1.55 ${FONT_SANS}`,
  color: "var(--c-muted)",
  textWrap: "pretty",
} as const;

/**
 * The tail lines, and the one place this screen refuses the design's copy.
 *
 * The prototype asserts "That is an empty week, not a failed load". That
 * sentence is true only when every follow was actually checked. The desktop
 * source separates a follow whose match query errored from a quiet one for
 * precisely this reason, and without that separation the screen states, out
 * loud, something it does not know. So when a follow could not be checked the
 * claim is withdrawn and the failures are named.
 *
 * MUTED IS A THIRD STATE and gets its own sentence. `radar/following/page.tsx`
 * lines 196 to 201 count a muted follow as quiet; a muted follow was never
 * matched, so it has no coverage answer either way, and saying it had none is a
 * claim with nothing behind it.
 */
function FollowingTail({
  quiet,
  muted,
  couldNotCheck,
}: {
  quiet: number;
  muted: number;
  couldNotCheck: string[];
}) {
  if (quiet === 0 && muted === 0 && couldNotCheck.length === 0) return null;
  const unchecked = couldNotCheck.length > 0;
  /* The count decides the noun as well as the number. A figure read from state
     drags its grammar with it, and "The other one follows" is the shape that
     bug takes if only the number is derived. */
  const subject = quiet === 1 ? "The other follow" : `The other ${spell(quiet)} follows`;
  const mutedSentence =
    muted === 1
      ? "One follow is muted, so it was not checked at all."
      : `${sentenceCase(spell(muted))} follows are muted, so they were not checked at all.`;
  return (
    <>
      {quiet > 0 ? (
        <p style={tailCopy}>
          {unchecked
            ? `${subject} had no coverage this week.`
            : `${subject} had no coverage this week. That is an empty week, not a failed load; your follows are intact.`}
        </p>
      ) : null}
      {muted > 0 ? <p style={tailCopy}>{mutedSentence}</p> : null}
      {unchecked ? (
        <WatchNotice
          heading={`Could not check: ${couldNotCheck.join(" · ")}`}
          body="Matching failed for these. This is an error, not an empty result, and they are not counted as quiet."
        />
      ) : null}
    </>
  );
}
