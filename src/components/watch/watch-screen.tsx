"use client";

import { useEffect, useMemo, useState, Fragment } from "react";
import Link from "next/link";
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
/* A VALUE import, deliberately. This is the product's own reason for something
   it does not draw, it has to reach the browser, and it is not sample content.
   The rule the import beside it obeys is about `fixture.ts`'s invented prose
   reaching `.next/static`; this is the opposite of invented. */
import { WATCH_OMISSIONS } from "./omissions";
import styles from "./watch.module.css";
import { FONT_DISPLAY, FONT_MONO, FONT_SANS } from "@/components/mobile/fonts";

/**
 * Watch. The reader's watchlist and what they follow, as two visually distinct
 * tiers in one scroll region.
 *
 * WHAT IS DRAWN AND WHAT IS NOT.
 *
 * FOUR THINGS ARE OMITTED AND ONE OF THEM SAYS SO. Tracked views, the
 * pinned-espresso hero, theme headings over following and staleness are all
 * absent, and the measurements behind each are unchanged. What changed is how
 * many of them are stated on screen. The ruling of 2026-08-29 narrowed the
 * one this screen shipped under: the app must never assert something false,
 * but it does not have to enumerate everything absent, and four stacked "not
 * shown here" explanations read as a product apologizing for itself. The test
 * is whether ABSENCE WOULD MISLEAD, applied per entry.
 *
 * Three of the four fail that test and are now silent. Nothing on this screen
 * names a third tier, no figure counts claims, every entry renders as the same
 * card so no rank is implied, and `ThemeCluster` already draws no heading where
 * there is no label, so the rows read as the list they are. A reader has no way
 * to know any of the three was ever meant to be here, and no rendered line
 * becomes wrong without the note.
 *
 * Staleness passes it and is kept. This screen renders dated claims off an
 * undated store - "No news today", the with-news and quiet counts, "This
 * week's coverage" - and nothing records when THIS DESK'S rows were last
 * refreshed. Silence there would let "No news today" read as a check made
 * today. The scope matters and the copy carries it: run times ARE recorded
 * (`articles.fetched_at`, `ingest_run_stats.run_started_at`), so the
 * product-wide version of that sentence would be false. `omissions.ts` carries
 * the full per-entry reasoning; `OmittedNotes` at the foot of this file draws
 * what survives.
 *
 * The register is unchanged: a REASON is about the PRODUCT, an EMPTY STATE is
 * about the READER and needs a read behind it.
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

/**
 * How a short screen's free space is divided, as flex-grow weights on the
 * `Slack` blocks. Three at the root, and the middle one is the body, which
 * splits its own share equally between its two seams.
 *
 * Read them as sixteenths of the free space once the body's split is unrolled:
 * 3 above the masthead, 4 above the first section rule, 4 between the tiers, 1
 * below the last notice. The tail is smallest because it is the only seam that
 * starts with a structural floor under it, 83px of tab-bar clearance and
 * padding that no layout here can remove. The arithmetic against the 844px
 * viewport is in the block comment on the body.
 */
const SLACK_LEAD = 3;
const SLACK_BODY = 8;
const SLACK_TAIL = 1;

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
   * And null is not the same value as an every-tier-empty shape. This screen
   * was once mounted in production with `stage: "ready"` over empty data, so it
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
        {/* STILL CENTRED, and this is the one branch that is. The block below
            distributes its free space across the seams the layout already has,
            which is what stops a short screen reading as a hole under the
            masthead. This branch has no seams: one notice, nothing above it and
            nothing below it, so there is nothing to distribute into and a
            weighted split would collapse into the same two lumps. A single
            block centred in the free space is a composition; the same block
            left dangling under the masthead is the defect PR #710 shipped on
            `/claim` (415px, 49.1% of the viewport).

            IT IS ALSO NOT REACHABLE ON A DEVELOPMENT SERVER, so nothing about
            it is stated here as measured. It needs a signed-out PRODUCTION
            build, and `src/proxy.ts` redirects that request to `/auth` before
            this component runs. What can be said from the code is that it draws
            one notice under the masthead and nothing else, which is the
            shortest body on this screen by a distance and leaves far more free
            space than any weighting could place inside the 15% gate. The
            per-entry failure branch is unreachable for its own reason: it needs
            a database error, and the sample content's `watchlistCouldNotRead`
            is empty. Both are named rather than tabulated. */}
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

  /* LOADING IS ITS OWN NAME, and it outranks the other two.
     `sparse` is computed off `data`, which under `stage: "loading"` is whatever
     the caller had before the read settled. So a loading screen drawing nothing
     but skeletons reported "populated", which is the one thing an attribute
     whose whole job is to name the state must not do. Measured at
     `/watch?stage=loading`. The tri-state discipline this screen is built on is
     that a read in flight is not an answer; the attribute now says so too. */
  const watchState = loading ? "loading" : sparse ? "sparse" : "populated";

  const followingEmpty =
    coverage === 0 &&
    data.followsQuiet === 0 &&
    data.followsMuted === 0 &&
    data.followsCouldNotCheck.length === 0;

  return (
    <div
      data-parity="watch"
      data-watch-state={watchState}
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
      <Slack grow={SLACK_LEAD} />
      <WatchMasthead />

      {/* THE SLACK IS SPREAD ACROSS THE LAYOUT'S OWN SEAMS, not dumped in one
          place. This replaces `justifyContent: center` on this block, and the
          reason centring was here in the first place still stands: omitting a
          whole tier plus a hero without reflowing is how PR #710 shipped 415px
          of dead screen on `/claim`, 49.1% of the viewport. So the short states
          still absorb their free space rather than piling it under the last
          notice. What changed is WHERE.

          Centring has two lumps and only two, and the masthead is in neither.
          Measured on the empty state at 390x844: 785px root, 548px of content,
          237px of free space, split into a 134px hole between the masthead and
          the first section rule and a 204px tail. The masthead stayed pinned to
          the top while the rules floated in the middle, which is the part that
          read as unfinished. Both lumps also sat over the 15% gate on their own.

          Four weighted `Slack` blocks take that free space instead: above the
          masthead, above the first section rule, between the two tiers, and
          below the last notice. The weights are the arithmetic. 237px at
          3:8:1 across the root gives the lead 59px, this block 158px and the
          tail 20px, and this block splits its 158px equally between its two
          seams. Against the 844px viewport that is 7.7% lead, 11.5% and 12.4%
          interior, 12.2% trailing, every one of them inside the gate, where
          centring measured 15.9% and 24.1%. Re-measured numbers for all four
          states are in the PR body.

          THE TAIL WEIGHT IS THE SMALLEST ON PURPOSE, because the tail is the
          only gap that starts in a hole. `#main-content` already carries
          `padding-bottom: var(--mobile-tabbar-height)`, measured at 59px, and
          the fixed bar sits at top 785 in an 844 viewport, so the 59px
          clearance block below plus this block's own 24px is 83px of structural
          gap under every state, short or tall. 83px is 9.8% of the viewport and
          it is the floor the 15% gate is measured against, which leaves the
          tail 43px of headroom where every other seam has over 100.

          A TALL STATE IS UNTOUCHED, for the same reason centring was safe on
          one: a `Slack` is `flex-basis: 0`, so with no free space to distribute
          it is 0px high and the block lays out exactly as it did. Measured on
          the populated state, whose root is 1319px: lead, both seams and the
          tail are unchanged from before this edit. */}
      <div
        style={{
          flex: `${SLACK_BODY} 1 auto`,
          display: "flex",
          flexDirection: "column",
          padding: `18px ${PAD} 24px`,
        }}
      >
        <Slack grow={1} />
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
        {/* The second seam. It sits between the tiers rather than inside
            either, so a short screen opens the gap the two sections already
            have between them instead of inventing a new one. */}
        <Slack grow={1} />
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

        {/* ── what is not drawn here ─────────────────────────────────── */}
        {/* DRAWN IN EVERY STAGE BUT ONE, and the exception is not a read about
            the reader. A reason is a statement about the product, so it holds
            while a tier is loading and while a tier has failed, and gating it
            on either would make it behave like an empty state. The one stage
            it cannot hold in is `stale`, where the notice above draws "Last
            checked <time>": a foot note saying this screen never dates the
            readings above, under a line that just dated them, is the false
            assertion the ruling did not loosen. So it stands down there and
            only there. */}
        {stale ? null : <OmittedNotes />}
      </div>

      <Slack grow={SLACK_TAIL} />
      <TabBarClearance />
    </div>
  );
}

/**
 * Free space, taken deliberately rather than left over.
 *
 * `flex-basis: 0` with an explicit grow is the whole of it: with free space to
 * distribute the block takes its weighted share, and with none it is 0px high
 * and the layout is exactly what it was. That is what lets one set of weights
 * serve a 785px empty screen and a 1319px populated one without a branch.
 *
 * `flex-shrink: 0` because a `Slack` has nothing to shrink and must never be
 * asked to absorb an overflow that belongs to the content.
 *
 * Empty and `aria-hidden`, so a screen reader walks from the masthead to the
 * first section rule with nothing between them.
 */
function Slack({ grow }: { grow: number }) {
  return <div aria-hidden="true" style={{ flex: `${grow} 0 0`, minHeight: 0 }} />;
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
        Radar
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

  /* WHERE THE CARD GOES IS NOT DECIDED HERE, and that is the whole design of
     it. `item.href` arrives from the loader, which PROVED it against
     `companies` before setting it (`src/lib/watch-links.ts`). This component
     runs in the browser and cannot check anything, so it renders a destination
     rather than inventing one.

     WHAT CHANGED. Every card was a `<button>` with `onClick={() => {}}`, on the
     stated grounds that neither destination existed. Half of that expired:
     `/company/[id]` shipped in PR #721. This was also the only path from a
     phone reader's own watchlist to Company Intel, and it was not connected.

     WHY IT IS PROVED RATHER THAN BUILT. The obvious version, `/company/` plus
     the identifier, tells a reader with BRK.B on their list that Berkshire
     Hathaway is not on Signalera, over a company with 540 corpus mentions. The
     resolver's ticker regex rejects the dot. So a card links only when the
     route's own reconstruction has been shown to land, and draws as a plain
     card otherwise. An unlinked card is a card; a card that lands on the miss
     surface is a false claim about the reader's own list, which is the thing
     `watch-data.ts` spends its header refusing to make.

     TODO, see #643: open the industry signal. `/signal` is step 10 and still
     does not exist, so an industry never carries an href.

     A REAL ANCHOR, never a button with a router push. It gives back long press,
     open in a new tab and the status-bar preview, and it is what
     `watch-notice.tsx` already does for the two desk links on this screen.
     Nothing is lost with the `<button>`: the card carried no handler, no
     `aria-pressed` and no disabled state, so `styles.bare` is the whole of what
     it was, and the same class resets the anchor. `text-decoration` is the one
     thing that reset does not cover, so the anchor turns it off inline. */
  if (item.href === null) return <div style={shape}>{body}</div>;

  return (
    <Link href={item.href} prefetch={false} className={styles.bare} style={{ ...shape, textDecoration: "none" }}>
      {body}
    </Link>
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

/**
 * What Radar does not draw, and why, at the foot of the screen.
 *
 * THE RULING: omit silently unless absence would mislead. One absence on this
 * screen clears that bar and the block carries it; the other three are silent.
 * A reason is still not an empty state, and what is here says what is absent
 * and why, in the register the rest of this file uses.
 *
 * That register is used well in two other places here: the per-entry fault
 * notice names the identifiers and then says "They are not quiet and they are
 * not counted quiet", and `FollowingTail` withdraws its own claim when a follow
 * could not be checked. Both correct a rendered figure, and so does this. Flat,
 * specific, about the product. So the copy is `tailCopy`, the quieter of the
 * two surfaces, because nothing here went wrong: the notice surface is for a
 * fault, and an absence is not one.
 *
 * THE BLOCK SURVIVES A SINGLE ENTRY, and the heading with it. "NOT SHOWN HERE"
 * over one line is a label on a thing rather than a wall of apology, which is
 * the shape the ruling rules out. If the last entry ever goes, this function
 * and `omissions.ts` go with it rather than being left as a mechanism with no
 * consumers.
 *
 * The heading is a heading and not a `SectionRule`: a rule with a label and a
 * hairline is this screen's shape for A TIER, and a tier is the one thing this
 * block must not look like.
 */
function OmittedNotes() {
  return (
    <section
      aria-labelledby="watch-omitted"
      style={{
        marginTop: "26px",
        paddingTop: "16px",
        borderTop: "1px solid var(--c-border)",
      }}
    >
      <h2
        id="watch-omitted"
        style={{
          margin: 0,
          font: `600 11px/1.3 ${FONT_SANS}`,
          letterSpacing: "0.12em",
          color: "var(--c-secondary)",
        }}
      >
        NOT SHOWN HERE
      </h2>
      {WATCH_OMISSIONS.map((o) => (
        <p key={o.id} style={tailCopy}>
          <span style={{ fontWeight: 600, color: "var(--c-body)" }}>{o.absent}.</span>{" "}
          {o.reason}
        </p>
      ))}
    </section>
  );
}
